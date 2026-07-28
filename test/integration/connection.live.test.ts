import { afterEach, describe, expect, it } from 'vitest';
import { Client, Connection } from '../../src/index.js';
import type { ConnectionOptions } from '../../src/index.js';

const host = process.env.NOBUGDB_HOST;
const port = Number(process.env.NOBUGDB_PORT ?? '9000');
const user = process.env.NOBUGDB_USER;
const password = process.env.NOBUGDB_PASSWORD;

function liveOptions(): ConnectionOptions {
  if (!host) {
    throw new Error('NOBUGDB_HOST is required for live tests');
  }

  const options: ConnectionOptions = {
    host,
    port,
  };

  if (user !== undefined) {
    options.user = user;
    options.password = password ?? '';
  }

  return options;
}

describe.skipIf(!host)('Connection live', () => {
  let connection: Connection | null = null;

  afterEach(async () => {
    if (connection) {
      await connection.close().catch(() => undefined);
      connection = null;
    }
  });

  it('connects, queries, pings, and quits', async () => {
    connection = await Connection.connect(liveOptions());
    expect(connection.isOpen).toBe(true);

    const result = await connection.query('SELECT 1 AS n');
    expect(result.success).toBe(true);

    await connection.ping();
    await connection.close();
    connection = null;
  });

  it('works through Client', async () => {
    const client = new Client(liveOptions());
    await client.connect();
    await client.ping();
    await client.end();
  });
});
