import { writeFile } from 'node:fs/promises';
import path from 'node:path';

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function normalizeSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) {
    throw new Error('Migration name must contain at least one alphanumeric character');
  }
  return slug;
}

function migrationTemplate(id: string): string {
  return `import type { MigrationContext } from 'nobugdb-orm';

export const id = '${id}';

export async function up(ctx: MigrationContext): Promise<void> {
  // await ctx.schema.createTable('example', (t) => {
  //   t.uuid('id').primary();
  // });
}

export async function down(ctx: MigrationContext): Promise<void> {
  // await ctx.schema.dropTable('example');
}
`;
}

export async function createMigrationFile(
  migrationsDir: string,
  name: string,
): Promise<string> {
  const slug = normalizeSlug(name);
  const timestamp = formatTimestamp(new Date());
  const id = `${timestamp}_${slug}`;
  const filename = `${id}.ts`;
  const filePath = path.join(migrationsDir, filename);

  await writeFile(filePath, migrationTemplate(id), 'utf8');
  return filePath;
}
