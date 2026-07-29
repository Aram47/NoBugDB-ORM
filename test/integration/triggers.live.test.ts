import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool, createMigrationContext } from '../../src/index.js';
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

describe.skipIf(!host)('triggers live', () => {
  let pool: Pool | null = null;
  const suffix = randomUUID().replace(/-/g, '_');
  const tableName = `orm_trg_${suffix}`;
  const triggerName = `trg_bump_${suffix}`;

  afterEach(async () => {
    if (pool) {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName}`).catch(() => undefined);
      await pool.query(`DROP TABLE IF EXISTS ${tableName}`).catch(() => undefined);
      await pool.end().catch(() => undefined);
      pool = null;
    }
  });

  it('BEFORE INSERT SET NEW adjusts inserted row; drop stops firing', async () => {
    pool = new Pool(liveOptions());
    const ctx = createMigrationContext(pool);

    await ctx.schema.createTable(tableName, (t) => {
      t.int('id').primary();
      t.int('x').notNull();
    });

    await ctx.schema.createTrigger(triggerName, {
      timing: 'BEFORE',
      event: 'INSERT',
      table: tableName,
      body: 'SET NEW.x = NEW.x + 1;',
    });

    await expect(
      ctx.query(`INSERT INTO ${tableName} VALUES (1, 10)`),
    ).resolves.toMatchObject({ success: true });

    const afterInsert = await ctx.query(`SELECT x FROM ${tableName} WHERE id = 1`);
    expect(afterInsert.success).toBe(true);
    expect(afterInsert.rows[0]?.[0]).toBe('11');

    await ctx.schema.dropTrigger(triggerName);

    await expect(
      ctx.query(`INSERT INTO ${tableName} VALUES (2, 10)`),
    ).resolves.toMatchObject({ success: true });

    const afterDrop = await ctx.query(`SELECT x FROM ${tableName} WHERE id = 2`);
    expect(afterDrop.success).toBe(true);
    expect(afterDrop.rows[0]?.[0]).toBe('10');
  });
});
