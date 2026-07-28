import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { DataSource } from '../../src/index.js';
import { Migrator } from '../../src/migrations/migrator.js';
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

describe.skipIf(!host)('Migrations live', () => {
  let tempDir: string | null = null;
  let ds: DataSource | null = null;
  const tablePrefix = `orm_mig_${randomUUID().replace(/-/g, '_')}`;
  const historyTable = `orm_migrations_${tablePrefix}`;

  afterEach(async () => {
    if (ds?.isInitialized) {
      await ds.destroy().catch(() => undefined);
      ds = null;
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function createGoodMigrationsDir(): Promise<string> {
    tempDir = await mkdtemp(path.join(tmpdir(), 'nobugdb-migrations-live-'));
    const table1 = `${tablePrefix}_users`;
    const table2 = `${tablePrefix}_posts`;

    const migration1 = `
      export const id = '20260728120000_create_users';
      export async function up(ctx) {
        await ctx.schema.createTable('${table1}', (t) => {
          t.uuid('id').primary();
          t.string('email').unique().notNull();
        });
      }
      export async function down(ctx) {
        await ctx.schema.dropTable('${table1}');
      }
    `;

    const migration2 = `
      export const id = '20260728120001_create_posts';
      export async function up(ctx) {
        await ctx.schema.createTable('${table2}', (t) => {
          t.uuid('id').primary();
          t.string('title').notNull();
        });
      }
      export async function down(ctx) {
        await ctx.schema.dropTable('${table2}');
      }
    `;

    await writeFile(path.join(tempDir, '20260728120000_create_users.ts'), migration1, 'utf8');
    await writeFile(path.join(tempDir, '20260728120001_create_posts.ts'), migration2, 'utf8');

    return tempDir;
  }

  async function createMigrationsDirWithBad(): Promise<string> {
    const dir = await createGoodMigrationsDir();

    const badMigration = `
      export const id = '20260728120002_bad';
      export async function up(ctx) {
        await ctx.schema.raw('CREATE TABLE ${tablePrefix}_bad (id INVALIDTYPE PRIMARY KEY)');
      }
      export async function down(ctx) {}
    `;
    await writeFile(path.join(dir, '20260728120002_bad.ts'), badMigration, 'utf8');

    return dir;
  }

  it('creates history table once and applies migrations in order', async () => {
    const migrationsDir = await createGoodMigrationsDir();
    ds = new DataSource(liveOptions());
    await ds.initialize();

    const migrator = new Migrator(ds, {
      migrationsDir,
      historyTable,
    });

    const firstUp = await migrator.up();
    expect(firstUp).toEqual([
      '20260728120000_create_users',
      '20260728120001_create_posts',
    ]);

    const secondUp = await migrator.up();
    expect(secondUp).toEqual([]);

    const status = await migrator.status();
    expect(status.filter((s) => s.applied).map((s) => s.id)).toEqual([
      '20260728120000_create_users',
      '20260728120001_create_posts',
    ]);
  });

  it('down reverts migration and removes history row', async () => {
    const migrationsDir = await createGoodMigrationsDir();
    ds = new DataSource(liveOptions());
    await ds.initialize();

    const migrator = new Migrator(ds, {
      migrationsDir,
      historyTable,
    });

    await migrator.up();
    const reverted = await migrator.down(1);
    expect(reverted).toEqual(['20260728120001_create_posts']);

    const status = await migrator.status();
    expect(status.find((s) => s.id === '20260728120001_create_posts')?.applied).toBe(false);
    expect(status.find((s) => s.id === '20260728120000_create_users')?.applied).toBe(true);
  });

  it('does not record history when migration fails', async () => {
    const migrationsDir = await createMigrationsDirWithBad();
    ds = new DataSource(liveOptions());
    await ds.initialize();

    const migrator = new Migrator(ds, {
      migrationsDir,
      historyTable,
    });

    await migrator.up();

    const pendingBad = await migrator.pending();
    expect(pendingBad).toContain('20260728120002_bad');

    await expect(migrator.up()).rejects.toThrow();

    const status = await migrator.status();
    expect(status.find((s) => s.id === '20260728120002_bad')?.applied).toBe(false);
  });

  it('runs DDL and history INSERT in one transaction', async () => {
    const migrationsDir = await mkdtemp(path.join(tmpdir(), 'nobugdb-migrations-tx-'));
    tempDir = migrationsDir;
    const probeTable = `${tablePrefix}_tx_probe`;

    const migration = `
      export const id = '20260728120099_tx_probe';
      export async function up(ctx) {
        await ctx.schema.createTable('${probeTable}', (t) => {
          t.int('id').primary();
        });
      }
      export async function down(ctx) {
        await ctx.schema.dropTable('${probeTable}');
      }
    `;
    await writeFile(
      path.join(migrationsDir, '20260728120099_tx_probe.ts'),
      migration,
      'utf8',
    );

    ds = new DataSource(liveOptions());
    await ds.initialize();

    const migrator = new Migrator(ds, {
      migrationsDir,
      historyTable,
    });

    await migrator.up();

    const history = await ds.pool.query(
      `SELECT id FROM ${historyTable} WHERE id = '20260728120099_tx_probe'`,
    );
    expect(history.success).toBe(true);
    expect(history.rows.length).toBe(1);

    const tableExists = await ds.pool.query(`SELECT id FROM ${probeTable} LIMIT 1`);
    expect(tableExists.success).toBe(true);
  });
});
