import { Connection } from '../driver/connection.js';
import { NoBugDbError } from '../driver/errors.js';
import type { QueryResult } from '../driver/types.js';
import { PooledConnection } from './pooled-connection.js';
import { resolvePoolOptions, type PoolOptions, type ResolvedPoolOptions } from './types.js';

interface PoolWaiter {
  resolve: (conn: PooledConnection) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * TCP connection pool with sticky transactions.
 *
 * NoBugDB stores transaction state in the server session (MVCC snapshot isolation).
 * A transaction must use the same socket for `BEGIN` through `COMMIT`/`ROLLBACK`.
 * The ORM does not emulate SQL isolation levels (`READ UNCOMMITTED`, `SERIALIZABLE`).
 *
 * Default `max` is 4 because the server serializes work through `db_mutex_`;
 * increasing pool size rarely improves throughput.
 */
export class Pool {
  readonly #options: ResolvedPoolOptions;
  readonly #all = new Set<PooledConnection>();
  readonly #idle: PooledConnection[] = [];
  readonly #idleTimers = new Map<PooledConnection, ReturnType<typeof setTimeout>>();
  readonly #waiters: PoolWaiter[] = [];

  #closed = false;
  #acquiredCount = 0;
  #endPromise: Promise<void> | null = null;
  #endResolve: (() => void) | null = null;

  constructor(options?: PoolOptions) {
    this.#options = resolvePoolOptions(options);
  }

  get size(): number {
    return this.#all.size;
  }

  get idleCount(): number {
    return this.#idle.length;
  }

  get waitingCount(): number {
    return this.#waiters.length;
  }

  /**
   * Warm up `min` idle connections.
   */
  async connect(): Promise<void> {
    this.#assertOpen();

    while (this.#all.size < this.#options.min) {
      const pooled = await this.#createConnection();
      this.#enqueueIdle(pooled);
    }
  }

  async acquire(): Promise<PooledConnection> {
    this.#assertOpen();

    const idle = this.#dequeueIdle();
    if (idle) {
      idle.prepareForAcquire();
      this.#acquiredCount += 1;
      return idle;
    }

    if (this.#all.size < this.#options.max) {
      const pooled = await this.#createConnection();
      pooled.prepareForAcquire();
      this.#acquiredCount += 1;
      return pooled;
    }

    return this.#waitForConnection();
  }

  async query(sql: string): Promise<QueryResult> {
    const conn = await this.acquire();
    try {
      return await conn.query(sql);
    } finally {
      conn.release();
    }
  }

  /**
   * Run `fn` inside `BEGIN` … `COMMIT` on one pooled connection.
   * On failure, issues `ROLLBACK`. If rollback fails, the connection is destroyed.
   */
  async transaction<T>(fn: (conn: PooledConnection) => Promise<T>): Promise<T> {
    this.#assertOpen();

    const conn = await this.acquire();
    try {
      await conn.query('BEGIN');
      const result = await fn(conn);
      await conn.query('COMMIT');
      conn.release();
      return result;
    } catch (err) {
      let rollbackOk = false;
      try {
        await conn.query('ROLLBACK');
        rollbackOk = true;
      } catch {
        // Connection may be in an uncertain state.
      }

      if (rollbackOk) {
        conn.release();
      } else {
        conn.destroy();
      }

      throw err;
    }
  }

  async end(): Promise<void> {
    if (this.#endPromise) {
      return this.#endPromise;
    }

    this.#endPromise = this.#shutdown();
    return this.#endPromise;
  }

  onConnectionReleased(conn: PooledConnection): void {
    this.#acquiredCount = Math.max(0, this.#acquiredCount - 1);

    if (this.#closed) {
      void this.#removeConnection(conn);
      this.#maybeResolveEnd();
      return;
    }

    this.#enqueueIdle(conn);
    this.#fulfillWaiter();
    this.#maybeResolveEnd();
  }

  onConnectionDestroyed(conn: PooledConnection): void {
    this.#cancelIdleTimer(conn);
    this.#removeFromIdle(conn);
    this.#all.delete(conn);
    this.#acquiredCount = Math.max(0, this.#acquiredCount - 1);

    void conn.close().catch(() => undefined);
    this.#fulfillWaiter();
    this.#maybeResolveEnd();
  }

  async #shutdown(): Promise<void> {
    this.#closed = true;
    this.#rejectWaiters();

    for (const conn of [...this.#idle]) {
      this.#cancelIdleTimer(conn);
      await this.#removeConnection(conn);
    }
    this.#idle.length = 0;

    if (this.#acquiredCount > 0) {
      await new Promise<void>((resolve) => {
        this.#endResolve = resolve;
      });
    }

    await Promise.all([...this.#all].map((conn) => this.#removeConnection(conn)));
    this.#all.clear();
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new NoBugDbError('POOL_CLOSED', 'Pool has been closed');
    }
  }

  async #createConnection(): Promise<PooledConnection> {
    const connection = await Connection.connect(this.#options.connection);
    const pooled = new PooledConnection(this, connection);
    this.#all.add(pooled);
    return pooled;
  }

  #enqueueIdle(conn: PooledConnection): void {
    this.#idle.push(conn);
    this.#scheduleIdleEviction(conn);
  }

  #dequeueIdle(): PooledConnection | undefined {
    const conn = this.#idle.shift();
    if (conn) {
      this.#cancelIdleTimer(conn);
    }
    return conn;
  }

  #scheduleIdleEviction(conn: PooledConnection): void {
    this.#cancelIdleTimer(conn);

    const timer = setTimeout(() => {
      void this.#evictIdle(conn);
    }, this.#options.idleTimeoutMs);

    this.#idleTimers.set(conn, timer);
  }

  async #evictIdle(conn: PooledConnection): Promise<void> {
    if (this.#closed) {
      return;
    }

    const index = this.#idle.indexOf(conn);
    if (index === -1) {
      return;
    }

    if (this.#all.size <= this.#options.min) {
      this.#scheduleIdleEviction(conn);
      return;
    }

    this.#idle.splice(index, 1);
    this.#cancelIdleTimer(conn);
    await this.#removeConnection(conn);
  }

  #cancelIdleTimer(conn: PooledConnection): void {
    const timer = this.#idleTimers.get(conn);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#idleTimers.delete(conn);
    }
  }

  #removeFromIdle(conn: PooledConnection): void {
    const index = this.#idle.indexOf(conn);
    if (index !== -1) {
      this.#idle.splice(index, 1);
    }
  }

  async #removeConnection(conn: PooledConnection): Promise<void> {
    this.#cancelIdleTimer(conn);
    this.#removeFromIdle(conn);
    this.#all.delete(conn);
    await conn.close().catch(() => undefined);
  }

  #waitForConnection(): Promise<PooledConnection> {
    return new Promise<PooledConnection>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.#waiters.findIndex((w) => w.timer === timer);
        if (index !== -1) {
          this.#waiters.splice(index, 1);
        }
        reject(
          new NoBugDbError(
            'TIMEOUT',
            `Timed out acquiring a connection after ${this.#options.acquireTimeoutMs}ms`,
          ),
        );
      }, this.#options.acquireTimeoutMs);

      this.#waiters.push({ resolve, reject, timer });
    });
  }

  #fulfillWaiter(): void {
    if (this.#closed || this.#waiters.length === 0) {
      return;
    }

    const idle = this.#dequeueIdle();
    if (idle) {
      const waiter = this.#waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        idle.prepareForAcquire();
        this.#acquiredCount += 1;
        waiter.resolve(idle);
      } else {
        this.#enqueueIdle(idle);
      }
      return;
    }

    if (this.#all.size < this.#options.max) {
      const waiter = this.#waiters.shift();
      if (!waiter) {
        return;
      }

      clearTimeout(waiter.timer);
      void this.#createConnection()
        .then((conn) => {
          conn.prepareForAcquire();
          this.#acquiredCount += 1;
          waiter.resolve(conn);
        })
        .catch((err) => {
          waiter.reject(err);
          this.#fulfillWaiter();
        });
    }
  }

  #rejectWaiters(): void {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(new NoBugDbError('POOL_CLOSED', 'Pool has been closed'));
      }
    }
  }

  #maybeResolveEnd(): void {
    if (this.#closed && this.#acquiredCount === 0 && this.#endResolve) {
      this.#endResolve();
      this.#endResolve = null;
    }
  }
}
