import path from 'node:path';
import { createJiti } from 'jiti';
import { NoBugDbError } from '../driver/errors.js';
import type { OrmConfig } from './types.js';
import { isOrmConfig } from './types.js';

export async function loadConfig(configPath: string): Promise<OrmConfig> {
  const resolved = path.resolve(configPath);
  const jiti = createJiti(resolved, { interopDefault: true });
  const loaded = await jiti(resolved);

  const config = (loaded as { config?: unknown }).config ?? loaded;
  if (!isOrmConfig(config)) {
    throw new NoBugDbError(
      'INVALID_MIGRATION',
      `Config at ${resolved} must export migrationsDir`,
    );
  }

  return config;
}

export function resolveMigrationsDir(config: OrmConfig, configPath: string): string {
  const base = path.dirname(path.resolve(configPath));
  return path.resolve(base, config.migrationsDir);
}
