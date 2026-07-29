import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NoBugDbError, Pool, createMigrationContext } from '../../src/index.js';
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

describe.skipIf(!host)('CHECK constraints live', () => {
  let pool: Pool | null = null;
  const tableName = `orm_chk_${randomUUID().replace(/-/g, '_')}`;

  afterEach(async () => {
    if (pool) {
      await pool.query(`DROP TABLE IF EXISTS ${tableName}`).catch(() => undefined);
      await pool.end().catch(() => undefined);
      pool = null;
    }
  });

  it('enforces column and table CHECK on CREATE; ALTER add/drop CHECK', async () => {
    pool = new Pool(liveOptions());
    const ctx = createMigrationContext(pool);

    await ctx.schema.createTable(tableName, (t) => {
      t.int('id').primary();
      t.int('price').notNull().check('price >= 0');
      t.check('chk_range', 'price <= 1000000');
    });

    await expect(
      ctx.query(`INSERT INTO ${tableName} VALUES (1, 10)`),
    ).resolves.toMatchObject({ success: true });

    await expect(
      ctx.query(`INSERT INTO ${tableName} VALUES (2, -1)`),
    ).rejects.toBeInstanceOf(NoBugDbError);

    await expect(
      ctx.query(`INSERT INTO ${tableName} VALUES (3, 1000001)`),
    ).rejects.toBeInstanceOf(NoBugDbError);

    await ctx.schema.alterTable(tableName, (t) => {
      t.dropCheck('chk_range');
    });

    await expect(
      ctx.query(`INSERT INTO ${tableName} VALUES (4, 1000001)`),
    ).resolves.toMatchObject({ success: true });

    await ctx.schema.alterTable(tableName, (t) => {
      t.addCheck('chk_range', 'price <= 1000000');
    });

    await expect(
      ctx.query(`INSERT INTO ${tableName} VALUES (5, 2000000)`),
    ).rejects.toBeInstanceOf(NoBugDbError);
  });
});
