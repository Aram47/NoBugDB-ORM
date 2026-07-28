import { afterEach, describe, expect, it } from 'vitest';
import { Connection } from '../../../src/driver/connection.js';
import type { NoBugDbError } from '../../../src/driver/errors.js';
import { deferred, startMockServer } from '../../helpers/mock-tcp-server.js';

describe('Connection', () => {
  let server: Awaited<ReturnType<typeof startMockServer>> | null = null;
  let connection: Connection | null = null;

  afterEach(async () => {
    if (connection) {
      await connection.close().catch(() => undefined);
      connection = null;
    }
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('serializes concurrent queries and preserves order', async () => {
    const releaseFirst = deferred<void>();

    server = await startMockServer((request, socket) => {
      if (!request.startsWith('QUERY|')) {
        if (request.startsWith('QUIT|')) {
          socket.write('OK|Goodbye\n');
        }
        return;
      }

      const sql = request.slice('QUERY|'.length, -1);
      if (sql === 'first') {
        void releaseFirst.promise.then(() => {
          socket.write('OK|n\n1\n');
        });
        return;
      }
      socket.write('OK|n\n2\n');
    });

    connection = await Connection.connect({
      host: server.host,
      port: server.port,
    });

    const first = connection.query('first');
    const second = connection.query('second');

    await new Promise((r) => setTimeout(r, 20));
    releaseFirst.resolve();

    const [a, b] = await Promise.all([first, second]);
    expect(a.rows).toEqual([['1']]);
    expect(b.rows).toEqual([['2']]);
    expect(server.requestLog.filter((r) => r.startsWith('QUERY|'))).toEqual([
      'QUERY|first\n',
      'QUERY|second\n',
    ]);
  });

  it('rejects oversized requests before write', async () => {
    server = await startMockServer((request, socket) => {
      if (request.startsWith('QUIT|')) {
        socket.write('OK|Goodbye\n');
      } else {
        socket.write('OK|\n');
      }
    });

    connection = await Connection.connect({
      host: server.host,
      port: server.port,
      maxRequestBytes: 64,
    });

    const huge = 'SELECT ' + 'x'.repeat(200);
    await expect(connection.query(huge)).rejects.toMatchObject({
      code: 'REQUEST_TOO_LARGE',
    } satisfies Partial<NoBugDbError>);

    expect(server.requestLog.some((r) => r.startsWith('QUERY|'))).toBe(false);
  });

  it('pings successfully', async () => {
    server = await startMockServer((request, socket) => {
      if (request.startsWith('PING|')) {
        socket.write('PONG\n');
      } else if (request.startsWith('QUIT|')) {
        socket.write('OK|Goodbye\n');
      }
    });

    connection = await Connection.connect({
      host: server.host,
      port: server.port,
    });

    await expect(connection.ping()).resolves.toBeUndefined();
  });
});
