import type { DataSource } from '../data-source/data-source.js';
import type { QueryExecutor } from '../query-builder/prepared.js';
import { createMigrationContext } from './migration-builder.js';
import {
  DEFAULT_HISTORY_TABLE,
  ensureHistoryTable,
  getAppliedIds,
  recordApplied,
  removeApplied,
} from './history.js';
import { loadMigrations } from './loader.js';
import type { MigrationStatusEntry, MigratorOptions } from './types.js';

/**
 * Applies and reverts filesystem migrations against a {@link DataSource}.
 *
 * Tracks applied ids in a history table (default `orm_migrations`).
 * Each `up` / `down` step runs inside a sticky pooled transaction
 * (`BEGIN` … `COMMIT` / `ROLLBACK`).
 *
 * Typical flow: {@link Migrator.status}, {@link Migrator.up}, {@link Migrator.down}.
 * Prefer the CLI (`nobugdb-orm migration:*`) for day-to-day use.
 */
export class Migrator {
  readonly #dataSource: DataSource;
  readonly #migrationsDir: string;
  readonly #historyTable: string;

  constructor(dataSource: DataSource, options: MigratorOptions) {
    this.#dataSource = dataSource;
    this.#migrationsDir = options.migrationsDir;
    this.#historyTable = options.historyTable ?? DEFAULT_HISTORY_TABLE;
  }

  async pending(): Promise<string[]> {
    const migrations = await loadMigrations(this.#migrationsDir);
    const executor = this.#getExecutor();
    await ensureHistoryTable(executor, this.#historyTable);
    const applied = new Set(await getAppliedIds(executor, this.#historyTable));
    return migrations.filter((m) => !applied.has(m.id)).map((m) => m.id);
  }

  async status(): Promise<MigrationStatusEntry[]> {
    const migrations = await loadMigrations(this.#migrationsDir);
    const executor = this.#getExecutor();
    await ensureHistoryTable(executor, this.#historyTable);
    const applied = new Set(await getAppliedIds(executor, this.#historyTable));

    return migrations.map((m) => ({
      id: m.id,
      applied: applied.has(m.id),
    }));
  }

  async up(): Promise<string[]> {
    const migrations = await loadMigrations(this.#migrationsDir);
    const pool = this.#dataSource.pool;
    const applied: string[] = [];

    await ensureHistoryTable(pool, this.#historyTable);
    const appliedSet = new Set(await getAppliedIds(pool, this.#historyTable));

    for (const migration of migrations) {
      if (appliedSet.has(migration.id)) {
        continue;
      }

      await pool.transaction(async (conn) => {
        const ctx = createMigrationContext(conn);
        await migration.up(ctx);
        await recordApplied(
          conn,
          migration.id,
          new Date().toISOString(),
          this.#historyTable,
        );
      });

      applied.push(migration.id);
      appliedSet.add(migration.id);
    }

    return applied;
  }

  async down(steps = 1): Promise<string[]> {
    if (steps < 1) {
      throw new Error('down steps must be at least 1');
    }

    const migrations = await loadMigrations(this.#migrationsDir);
    const pool = this.#dataSource.pool;
    const migrationById = new Map(migrations.map((m) => [m.id, m]));

    await ensureHistoryTable(pool, this.#historyTable);
    const appliedIds = await getAppliedIds(pool, this.#historyTable);
    const toRevert = appliedIds.slice(-steps).reverse();
    const reverted: string[] = [];

    for (const id of toRevert) {
      const migration = migrationById.get(id);
      if (!migration) {
        throw new Error(`Applied migration ${id} has no matching file in migrationsDir`);
      }

      await pool.transaction(async (conn) => {
        const ctx = createMigrationContext(conn);
        await migration.down(ctx);
        await removeApplied(conn, id, this.#historyTable);
      });

      reverted.push(id);
    }

    return reverted;
  }

  #getExecutor(): QueryExecutor {
    return this.#dataSource.pool;
  }
}
