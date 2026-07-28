import { DataSource } from '../../data-source/data-source.js';
import { Migrator } from '../../migrations/migrator.js';
import type { OrmConfig } from '../types.js';
import { resolveMigrationsDir } from '../config.js';

export async function runMigrationDown(
  config: OrmConfig,
  configPath: string,
  steps: number,
): Promise<string[]> {
  const ds = new DataSource(buildDataSourceOptions(config));
  await ds.initialize();

  try {
    const migrator = new Migrator(ds, {
      migrationsDir: resolveMigrationsDir(config, configPath),
      ...(config.historyTable !== undefined ? { historyTable: config.historyTable } : {}),
    });
    return await migrator.down(steps);
  } finally {
    await ds.destroy();
  }
}

function buildDataSourceOptions(config: OrmConfig) {
  return {
    ...(config.host !== undefined ? { host: config.host } : {}),
    ...(config.port !== undefined ? { port: config.port } : {}),
    ...(config.user !== undefined ? { user: config.user } : {}),
    ...(config.password !== undefined ? { password: config.password } : {}),
    ...(config.pool !== undefined ? config.pool : {}),
  };
}
