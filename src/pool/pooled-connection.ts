import type { Connection } from '../driver/connection.js';
import { NoBugDbError } from '../driver/errors.js';
import type { QueryResult } from '../driver/types.js';

export type TxStatementKind = 'BEGIN' | 'COMMIT' | 'ROLLBACK';

export function classifyTxStatement(sql: string): TxStatementKind | null {
  const normalized = sql.trim().replace(/;+\s*$/, '').toUpperCase();
  if (normalized === 'BEGIN') {
    return 'BEGIN';
  }
  if (normalized === 'COMMIT') {
    return 'COMMIT';
  }
  if (normalized === 'ROLLBACK') {
    return 'ROLLBACK';
  }
  return null;
}

export interface ConnectionPoolHost {
  onConnectionReleased(conn: PooledConnection): void;
  onConnectionDestroyed(conn: PooledConnection): void;
}

/**
 * Session-bound wrapper around a single {@link Connection}.
 * Tracks transaction state for sticky TX semantics.
 */
export class PooledConnection {
  readonly #pool: ConnectionPoolHost;
  readonly #connection: Connection;
  #inTransaction = false;
  #released = false;
  #destroyed = false;

  constructor(pool: ConnectionPoolHost, connection: Connection) {
    this.#pool = pool;
    this.#connection = connection;
  }

  get inTransaction(): boolean {
    return this.#inTransaction;
  }

  get isDestroyed(): boolean {
    return this.#destroyed;
  }

  /** @internal Resets checkout state when the pool hands out this connection. */
  prepareForAcquire(): void {
    this.#released = false;
  }

  async query(sql: string): Promise<QueryResult> {
    this.#assertUsable();

    const txKind = classifyTxStatement(sql);
    if (txKind === 'BEGIN' && this.#inTransaction) {
      throw new NoBugDbError(
        'NESTED_TX_UNSUPPORTED',
        'Nested transactions are not supported in v1',
        { sql },
      );
    }

    const result = await this.#connection.query(sql);

    if (txKind === 'BEGIN') {
      this.#inTransaction = true;
    } else if (txKind === 'COMMIT' || txKind === 'ROLLBACK') {
      this.#inTransaction = false;
    }

    return result;
  }

  release(): void {
    this.#assertUsable();

    if (this.#inTransaction) {
      throw new NoBugDbError(
        'IN_TRANSACTION',
        'Cannot release a connection while a transaction is open',
      );
    }

    this.#released = true;
    this.#pool.onConnectionReleased(this);
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.#released = true;
    void this.#pool.onConnectionDestroyed(this);
  }

  async close(): Promise<void> {
    await this.#connection.close();
  }

  #assertUsable(): void {
    if (this.#destroyed) {
      throw new NoBugDbError('NOT_CONNECTED', 'Pooled connection was destroyed');
    }
    if (this.#released) {
      throw new NoBugDbError('NOT_CONNECTED', 'Pooled connection was already released');
    }
  }
}
