import type { ConnectionOptions } from '../driver/types.js';

export interface PoolOptions extends ConnectionOptions {
  /** Minimum warm connections on {@link Pool.connect}. Default 0. */
  min?: number;
  /**
   * Maximum concurrent connections. Default 4 — NoBugDB serializes SQL via
   * `db_mutex_`; raising max rarely improves throughput.
   */
  max?: number;
  /** Close idle connections after this many ms. Default 30_000. */
  idleTimeoutMs?: number;
  /** Max wait when pool is exhausted. Default 10_000. */
  acquireTimeoutMs?: number;
}

export const DEFAULT_POOL_MIN = 0;
export const DEFAULT_POOL_MAX = 4;
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
export const DEFAULT_ACQUIRE_TIMEOUT_MS = 10_000;

export interface ResolvedPoolOptions {
  connection: ConnectionOptions;
  min: number;
  max: number;
  idleTimeoutMs: number;
  acquireTimeoutMs: number;
}

export function resolvePoolOptions(options: PoolOptions = {}): ResolvedPoolOptions {
  const { min, max, idleTimeoutMs, acquireTimeoutMs, ...connection } = options;

  const resolvedMin = min ?? DEFAULT_POOL_MIN;
  const resolvedMax = max ?? DEFAULT_POOL_MAX;

  if (resolvedMin < 0) {
    throw new RangeError('Pool min must be >= 0');
  }
  if (resolvedMax < 1) {
    throw new RangeError('Pool max must be >= 1');
  }
  if (resolvedMin > resolvedMax) {
    throw new RangeError('Pool min must be <= max');
  }

  return {
    connection,
    min: resolvedMin,
    max: resolvedMax,
    idleTimeoutMs: idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    acquireTimeoutMs: acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS,
  };
}
