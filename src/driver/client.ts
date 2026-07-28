import { Connection } from './connection.js';
import { NoBugDbError } from './errors.js';
import type { ConnectionOptions, QueryResult } from './types.js';

/**
 * Thin single-connection wrapper for scripts and simple apps.
 * For concurrent workloads use {@link Pool}.
 */
export class Client {
  readonly #options: ConnectionOptions;
  #connection: Connection | null = null;

  constructor(options: ConnectionOptions = {}) {
    this.#options = options;
  }

  async connect(): Promise<void> {
    if (this.#connection?.isOpen) {
      return;
    }
    this.#connection = await Connection.connect(this.#options);
  }

  async query(sql: string): Promise<QueryResult> {
    return (await this.#requireConnection()).query(sql);
  }

  async ping(): Promise<void> {
    await (await this.#requireConnection()).ping();
  }

  async end(): Promise<void> {
    if (!this.#connection) {
      return;
    }
    const connection = this.#connection;
    this.#connection = null;
    await connection.close();
  }

  async #requireConnection(): Promise<Connection> {
    if (!this.#connection?.isOpen) {
      await this.connect();
    }
    if (!this.#connection) {
      throw new NoBugDbError('NOT_CONNECTED', 'Failed to open connection');
    }
    return this.#connection;
  }
}
