import { afterEach, describe, expect, it } from 'vitest';
import type { NoBugDbError } from '../../../src/driver/errors.js';
import { Pool } from '../../../src/pool/pool.js';
import {
  deferred,
  handleDefaultQuery,
  startMockServer,
} from '../../helpers/mock-tcp-server.js';

describe('Pool', () => {
  let server: Awaited<ReturnType<typeof startMockServer>> | null = null;
  let pool: Pool | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.end().catch(() => undefined);
      pool = null;
    }
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('returns connections to idle on acquire/release', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({ host: server.host, port: server.port, max: 2 });

    const conn = await pool.acquire();
    expect(pool.idleCount).toBe(0);
    expect(pool.size).toBe(1);

    conn.release();
    expect(pool.idleCount).toBe(1);
    expect(pool.size).toBe(1);
  });

  it('waits when max is reached and unblocks on release', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({ host: server.host, port: server.port, max: 4 });

    const connections = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
    ]);
    expect(pool.idleCount).toBe(0);
    expect(pool.size).toBe(4);

    const fifth = pool.acquire();
    await new Promise((r) => setTimeout(r, 30));
    expect(pool.waitingCount).toBe(1);

    connections[0]!.release();
    const acquiredFifth = await fifth;
    expect(acquiredFifth).toBeDefined();

    for (const conn of connections.slice(1)) {
      conn.release();
    }
    acquiredFifth.release();
  });

  it('rejects acquire when timeout elapses', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({
      host: server.host,
      port: server.port,
      max: 1,
      acquireTimeoutMs: 50,
    });

    const first = await pool.acquire();
    await expect(pool.acquire()).rejects.toMatchObject({
      code: 'TIMEOUT',
    } satisfies Partial<NoBugDbError>);

    first.release();
  });

  it('runs pool.query via acquire and release', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({ host: server.host, port: server.port });

    const result = await pool.query('SELECT 1');
    expect(result.success).toBe(true);
    expect(pool.idleCount).toBe(1);
  });

  it('rejects acquire after end', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({ host: server.host, port: server.port });
    await pool.end();

    await expect(pool.acquire()).rejects.toMatchObject({
      code: 'POOL_CLOSED',
    } satisfies Partial<NoBugDbError>);
    pool = null;
  });

  it('warm-up connect creates min idle connections', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({ host: server.host, port: server.port, min: 2, max: 4 });
    await pool.connect();

    expect(pool.size).toBe(2);
    expect(pool.idleCount).toBe(2);
  });
});

describe('Pool acquire ordering', () => {
  let server: Awaited<ReturnType<typeof startMockServer>> | null = null;
  let pool: Pool | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.end().catch(() => undefined);
      pool = null;
    }
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('unblocks the oldest waiter first', async () => {
    const gate = deferred<void>();

    server = await startMockServer((request, socket) => {
      if (request.startsWith('QUERY|')) {
        void gate.promise.then(() => handleDefaultQuery(request, socket));
        return;
      }
      handleDefaultQuery(request, socket);
    });

    pool = new Pool({
      host: server.host,
      port: server.port,
      max: 1,
      acquireTimeoutMs: 500,
    });

    const first = await pool.acquire();
    const secondPromise = pool.acquire();
    const thirdPromise = pool.acquire();

    await new Promise((r) => setTimeout(r, 20));
    expect(pool.waitingCount).toBe(2);

    first.release();
    gate.resolve();

    const second = await secondPromise;
    expect(second).toBeDefined();

    second.release();
    const third = await thirdPromise;
    third.release();
  });
});
