import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createMigrationFile } from '../../../src/cli/commands/migration-create.js';

describe('migration:create', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('writes a timestamped migration file', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'nobugdb-cli-create-'));
    await mkdir(tempDir, { recursive: true });

    const filePath = await createMigrationFile(tempDir, 'Create Users');
    const basename = path.basename(filePath);

    expect(basename).toMatch(/^\d{14}_create_users\.ts$/);
    const content = await readFile(filePath, 'utf8');
    expect(content).toContain('export const id');
    expect(content).toContain('export async function up');
    expect(content).toContain('export async function down');
    expect(content).toContain(basename.replace('.ts', ''));
  });
});
