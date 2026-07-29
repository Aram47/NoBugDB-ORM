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

describe.skipIf(!host)('partitioning live', () => {
  let pool: Pool | null = null;
  const suffix = randomUUID().replace(/-/g, '_');
  const parentTable = `orm_part_${suffix}`;
  const child2024 = `orm_part_${suffix}_2024`;
  const child2025 = `orm_part_${suffix}_2025`;

  afterEach(async () => {
    if (pool) {
      await pool.query(`DROP TABLE IF EXISTS ${parentTable}`).catch(() => undefined);
      await pool.end().catch(() => undefined);
      pool = null;
    }
  });

  it('creates RANGE parent+children, routes inserts, drop child keeps parent', async () => {
    pool = new Pool(liveOptions());
    const ctx = createMigrationContext(pool);

    await ctx.schema.createPartitionedTable(
      parentTable,
      { strategy: 'RANGE', column: 'y' },
      (t) => {
        t.int('id').primary();
        t.int('y').notNull();
      },
    );

    await ctx.schema.createPartition(child2024, parentTable, { from: 2024, to: 2025 });
    await ctx.schema.createPartition(child2025, parentTable, { from: 2025, to: 2026 });

    await expect(
      ctx.query(`INSERT INTO ${parentTable} VALUES (1, 2024)`),
    ).resolves.toMatchObject({ success: true });

    await expect(
      ctx.query(`INSERT INTO ${parentTable} VALUES (2, 2025)`),
    ).resolves.toMatchObject({ success: true });

    await expect(
      ctx.query(`INSERT INTO ${parentTable} VALUES (3, 2023)`),
    ).rejects.toBeInstanceOf(NoBugDbError);

    await ctx.schema.dropTable(child2024);

    await expect(
      ctx.query(`INSERT INTO ${parentTable} VALUES (4, 2024)`),
    ).rejects.toBeInstanceOf(NoBugDbError);

    await expect(
      ctx.query(`INSERT INTO ${parentTable} VALUES (5, 2025)`),
    ).resolves.toMatchObject({ success: true });

    await ctx.schema.dropTable(parentTable);
  });
});
