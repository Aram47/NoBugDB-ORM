import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';
import { NoBugDbError } from '../driver/errors.js';
import type { MigrationModule } from './types.js';

const MIGRATION_FILE_RE = /^\d{14}_[a-z0-9_]+$/;
const MIGRATION_EXT_RE = /\.(ts|js|mjs|cjs)$/;

export function migrationIdFromFilename(filename: string): string {
  const base = filename.replace(MIGRATION_EXT_RE, '');
  return base;
}

export function isMigrationFilename(filename: string): boolean {
  if (filename.startsWith('.')) {
    return false;
  }
  if (!MIGRATION_EXT_RE.test(filename)) {
    return false;
  }
  const id = migrationIdFromFilename(filename);
  return MIGRATION_FILE_RE.test(id);
}

export async function listMigrationFiles(migrationsDir: string): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && isMigrationFilename(e.name))
    .map((e) => e.name)
    .sort();

  return files;
}

async function importModule(filePath: string): Promise<unknown> {
  const jiti = createJiti(filePath, {
    interopDefault: true,
  });
  return jiti(filePath);
}

function validateMigrationModule(
  module: unknown,
  expectedId: string,
): MigrationModule {
  if (typeof module !== 'object' || module === null) {
    throw new NoBugDbError(
      'INVALID_MIGRATION',
      `Migration ${expectedId} must export id, up, and down`,
    );
  }

  const record = module as Record<string, unknown>;
  const { id, up, down } = record;

  if (typeof id !== 'string' || id !== expectedId) {
    throw new NoBugDbError(
      'INVALID_MIGRATION',
      `Migration file id must match filename: expected "${expectedId}", got "${String(id)}"`,
    );
  }

  if (typeof up !== 'function' || typeof down !== 'function') {
    throw new NoBugDbError(
      'INVALID_MIGRATION',
      `Migration ${expectedId} must export async up() and down() functions`,
    );
  }

  return {
    id,
    up: up as MigrationModule['up'],
    down: down as MigrationModule['down'],
  };
}

export async function loadMigrations(migrationsDir: string): Promise<MigrationModule[]> {
  const files = await listMigrationFiles(migrationsDir);
  const migrations: MigrationModule[] = [];

  for (const filename of files) {
    const expectedId = migrationIdFromFilename(filename);
    const filePath = path.join(migrationsDir, filename);
    const module = await importModule(filePath);
    migrations.push(validateMigrationModule(module, expectedId));
  }

  return migrations;
}
