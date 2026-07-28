import type { PoolOptions } from '../pool/types.js';

export interface OrmConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  migrationsDir: string;
  historyTable?: string;
  pool?: Omit<PoolOptions, 'host' | 'port' | 'user' | 'password'>;
}

export function isOrmConfig(value: unknown): value is OrmConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.migrationsDir === 'string';
}
