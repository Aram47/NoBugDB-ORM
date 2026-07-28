import type { EntityManager } from '../entity-manager/entity-manager.js';
import type { DataSource } from '../data-source/data-source.js';

/**
 * Minimal Express-like types.
 * We intentionally don't import `express` to keep the ORM core and build
 * free from a hard dependency on Express typings.
 */
export type ExpressNextFunction = (err?: unknown) => void;

export interface ExpressRequestLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface ExpressResponseLike {
  statusCode: number;
  once(event: 'finish' | 'close', listener: () => void): void;
}

export interface ExpressOrmOptions {
  dataSource: DataSource;
  /** Property name on `req`. Default: `em` */
  property?: string;
  /**
   * If true, wrap each request in a TCP-session transaction.
   * Default false — handlers can call `dataSource.transaction()` explicitly.
   */
  perRequestTransaction?: boolean;
}

export interface ExpressRequestWithEntityManager extends ExpressRequestLike {
  em: EntityManager;
}

export const DEFAULT_EM_PROPERTY = 'em';

