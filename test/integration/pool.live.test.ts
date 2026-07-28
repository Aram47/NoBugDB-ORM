import { afterEach, describe, expect, it } from 'vitest';
import { Pool } from '../../src/index.js';
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

describe.skipIf(!host)('Pool live', () => {
  let pool: Pool | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.end().catch(() => undefined);
      pool = null;
    }
  });

  it('runs two sequential transactions', async () => {
    pool = new Pool(liveOptions());

    await pool.transaction(async (conn) => {
      const result = await conn.query('SELECT 1 AS n');
      expect(result.success).toBe(true);
    });

    await pool.transaction(async (conn) => {
      const result = await conn.query('SELECT 2 AS n');
      expect(result.success).toBe(true);
    });
  });

  it('respects max with concurrent pool.query calls', async () => {
    pool = new Pool({ ...liveOptions(), max: 2 });

    const results = await Promise.all([
      pool.query('SELECT 1 AS n'),
      pool.query('SELECT 2 AS n'),
      pool.query('SELECT 3 AS n'),
    ]);

    for (const result of results) {
      expect(result.success).toBe(true);
    }
  });
});
