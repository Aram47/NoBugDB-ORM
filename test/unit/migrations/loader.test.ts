import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isMigrationFilename,
  listMigrationFiles,
  loadMigrations,
  migrationIdFromFilename,
} from '../../../src/migrations/loader.js';

describe('migration loader', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function createTempMigrationsDir(): Promise<string> {
    tempDir = await mkdtemp(path.join(tmpdir(), 'nobugdb-migrations-'));
    return tempDir;
  }

  it('identifies migration filenames', () => {
    expect(isMigrationFilename('20260728120000_create_users.ts')).toBe(true);
    expect(isMigrationFilename('20260728120000_create_users.js')).toBe(true);
    expect(isMigrationFilename('.hidden.ts')).toBe(false);
    expect(isMigrationFilename('invalid_name.ts')).toBe(false);
  });

  it('extracts id from filename', () => {
    expect(migrationIdFromFilename('20260728120000_create_users.ts')).toBe(
      '20260728120000_create_users',
    );
  });

  it('lists migration files in sorted order', async () => {
    const dir = await createTempMigrationsDir();
    await writeFile(path.join(dir, '20260728120001_second.ts'), '', 'utf8');
    await writeFile(path.join(dir, '20260728120000_first.ts'), '', 'utf8');
    await writeFile(path.join(dir, 'readme.md'), '', 'utf8');

    const files = await listMigrationFiles(dir);
    expect(files).toEqual([
      '20260728120000_first.ts',
      '20260728120001_second.ts',
    ]);
  });

  it('loads valid migration modules', async () => {
    const dir = await createTempMigrationsDir();
    const id = '20260728120000_create_users';
    const content = `
      export const id = '${id}';
      export async function up() {}
      export async function down() {}
    `;
    await writeFile(path.join(dir, `${id}.ts`), content, 'utf8');

    const migrations = await loadMigrations(dir);
    expect(migrations).toHaveLength(1);
    expect(migrations[0]!.id).toBe(id);
  });

  it('rejects migration with mismatched id', async () => {
    const dir = await createTempMigrationsDir();
    const filename = '20260728120000_create_users.ts';
    const content = `
      export const id = 'wrong_id';
      export async function up() {}
      export async function down() {}
    `;
    await writeFile(path.join(dir, filename), content, 'utf8');

    await expect(loadMigrations(dir)).rejects.toThrow(/must match filename/);
  });
});
