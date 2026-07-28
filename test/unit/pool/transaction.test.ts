import { afterEach, describe, expect, it } from 'vitest';
import type { NoBugDbError } from '../../../src/driver/errors.js';
import { Pool } from '../../../src/pool/pool.js';
import {
  handleDefaultQuery,
  replyError,
  sqlFromQuery,
  startMockServer,
} from '../../helpers/mock-tcp-server.js';

describe('Pool.transaction', () => {
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

  it('commits on success', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({ host: server.host, port: server.port });

    const value = await pool.transaction(async (conn) => {
      await conn.query('SELECT 1');
      return 42;
    });

    expect(value).toBe(42);
    expect(server.requestLog.filter((r) => r.startsWith('QUERY|'))).toEqual([
      'QUERY|BEGIN\n',
      'QUERY|SELECT 1\n',
      'QUERY|COMMIT\n',
    ]);
    expect(pool.idleCount).toBe(1);
  });

  it('rollbacks on throw', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({ host: server.host, port: server.port });

    await expect(
      pool.transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const queries = server.requestLog
      .filter((r) => r.startsWith('QUERY|'))
      .map((r) => sqlFromQuery(r).toUpperCase());
    expect(queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(pool.idleCount).toBe(1);
  });

  it('rejects release while in transaction', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({ host: server.host, port: server.port });

    const conn = await pool.acquire();
    await conn.query('BEGIN');
    expect(conn.inTransaction).toBe(true);

    expect(() => conn.release()).toThrowError(
      expect.objectContaining({ code: 'IN_TRANSACTION' }),
    );

    await conn.query('ROLLBACK');
    conn.release();
  });

  it('rejects nested BEGIN inside transaction', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({ host: server.host, port: server.port });

    await expect(
      pool.transaction(async (conn) => {
        await conn.query('BEGIN');
      }),
    ).rejects.toMatchObject({
      code: 'NESTED_TX_UNSUPPORTED',
    } satisfies Partial<NoBugDbError>);

    const queries = server.requestLog
      .filter((r) => r.startsWith('QUERY|'))
      .map((r) => sqlFromQuery(r).toUpperCase());
    expect(queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(pool.idleCount).toBe(1);
  });

  it('destroys connection when ROLLBACK fails', async () => {
    server = await startMockServer((request, socket) => {
      if (!request.startsWith('QUERY|')) {
        handleDefaultQuery(request, socket);
        return;
      }

      const sql = sqlFromQuery(request).trim().toUpperCase();
      if (sql === 'ROLLBACK') {
        replyError(socket, 'rollback failed');
        return;
      }

      handleDefaultQuery(request, socket);
    });

    pool = new Pool({ host: server.host, port: server.port, max: 2 });
    const warm = await pool.acquire();
    warm.release();
    const sizeBefore = pool.size;

    await expect(
      pool.transaction(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');

    expect(pool.size).toBe(sizeBefore - 1);

    const conn = await pool.acquire();
    conn.release();
    expect(pool.size).toBe(sizeBefore);
  });

  it('allows manual BEGIN/COMMIT lifecycle', async () => {
    server = await startMockServer(handleDefaultQuery);
    pool = new Pool({ host: server.host, port: server.port });

    const conn = await pool.acquire();
    await conn.query('BEGIN');
    await conn.query('SELECT 1');
    await conn.query('COMMIT');
    expect(conn.inTransaction).toBe(false);
    conn.release();

    expect(pool.idleCount).toBe(1);
  });
});
