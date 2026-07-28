import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryResult } from '../../../src/driver/types.js';
import type { DataSource } from '../../../src/data-source/data-source.js';
import { Migrator } from '../../../src/migrations/migrator.js';

class RecordingExecutor {
  readonly queries: string[] = [];
  #historyExists = false;
  #applied: string[] = [];

  async query(sql: string): Promise<QueryResult> {
    this.queries.push(sql);
    const upper = sql.toUpperCase();

    if (upper.startsWith('CREATE TABLE ORM_MIGRATIONS')) {
      this.#historyExists = true;
      return { success: true, message: 'OK', columns: [], rows: [] };
    }

    if (upper.startsWith('SELECT ID FROM ORM_MIGRATIONS') && upper.includes('LIMIT 1')) {
      if (!this.#historyExists) {
        return { success: false, message: 'table not found', columns: [], rows: [] };
      }
      return { success: true, message: 'OK', columns: ['id'], rows: [] };
    }

    if (upper.startsWith('SELECT ID FROM ORM_MIGRATIONS ORDER BY')) {
      const rows = this.#applied.map((id) => [id]);
      return { success: true, message: 'OK', columns: ['id'], rows };
    }

    if (upper.startsWith('INSERT INTO ORM_MIGRATIONS')) {
      const match = sql.match(/VALUES \('([^']+)'/);
      if (match) {
        this.#applied.push(match[1]!);
      }
      return { success: true, message: 'OK', columns: [], rows: [] };
    }

    if (upper.startsWith('DELETE FROM ORM_MIGRATIONS')) {
      const match = sql.match(/WHERE id = '([^']+)'/);
      if (match) {
        this.#applied = this.#applied.filter((id) => id !== match[1]);
      }
      return { success: true, message: 'OK', columns: [], rows: [] };
    }

    return { success: true, message: 'OK', columns: [], rows: [] };
  }
}

class MockPool {
  readonly #executor = new RecordingExecutor();

  get queries(): string[] {
    return this.#executor.queries;
  }

  async query(sql: string): Promise<QueryResult> {
    return this.#executor.query(sql);
  }

  async transaction<T>(fn: (conn: RecordingExecutor) => Promise<T>): Promise<T> {
    return fn(this.#executor);
  }
}

describe('Migrator', () => {
  let tempDir: string | null = null;
  let pool: MockPool;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function setupMigrations(ids: string[]): Promise<string> {
    tempDir = await mkdtemp(path.join(tmpdir(), 'nobugdb-migrator-'));
    await mkdir(tempDir, { recursive: true });

    for (const id of ids) {
      const content = `
        export const id = '${id}';
        export async function up(ctx) {
          await ctx.schema.raw('CREATE TABLE ${id}_tbl (id INT PRIMARY KEY)');
        }
        export async function down(ctx) {
          await ctx.schema.raw('DROP TABLE ${id}_tbl');
        }
      `;
      await writeFile(path.join(tempDir, `${id}.ts`), content, 'utf8');
    }

    return tempDir;
  }

  function createMigrator(dir: string): Migrator {
    pool = new MockPool();
    const ds = { pool } as unknown as DataSource;
    return new Migrator(ds, { migrationsDir: dir });
  }

  it('reports pending migrations', async () => {
    const dir = await setupMigrations(['20260728120000_first', '20260728120001_second']);
    const migrator = createMigrator(dir);

    const pending = await migrator.pending();
    expect(pending).toEqual(['20260728120000_first', '20260728120001_second']);
  });

  it('applies migrations in order and skips on second up', async () => {
    const dir = await setupMigrations(['20260728120000_first', '20260728120001_second']);
    const migrator = createMigrator(dir);

    const applied = await migrator.up();
    expect(applied).toEqual(['20260728120000_first', '20260728120001_second']);

    const secondRun = await migrator.up();
    expect(secondRun).toEqual([]);

    expect(pool.queries.some((q) => q.includes('CREATE TABLE 20260728120000_first_tbl'))).toBe(true);
    expect(pool.queries.some((q) => q.includes('CREATE TABLE 20260728120001_second_tbl'))).toBe(true);
  });

  it('reverts last migration on down', async () => {
    const dir = await setupMigrations(['20260728120000_first', '20260728120001_second']);
    const migrator = createMigrator(dir);

    await migrator.up();
    const reverted = await migrator.down(1);
    expect(reverted).toEqual(['20260728120001_second']);

    const status = await migrator.status();
    expect(status).toEqual([
      { id: '20260728120000_first', applied: true },
      { id: '20260728120001_second', applied: false },
    ]);
  });
});
