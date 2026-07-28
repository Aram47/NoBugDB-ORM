import { NoBugDbError } from '../driver/errors.js';
import { EntityManager } from '../entity-manager/entity-manager.js';
import { defineEntity } from '../metadata/define-entity.js';
import { isEntityMetadata } from '../metadata/types.js';
import type {
  EntityMetadata,
  EntitySchema,
} from '../metadata/types.js';
import { MetadataRegistry } from '../metadata/metadata-registry.js';
import { SchemaRegistry } from '../metadata/schema-registry.js';
import { Pool } from '../pool/pool.js';
import type { PoolOptions } from '../pool/types.js';
import type { Repository } from '../repository/repository.js';

export interface DataSourceOptions extends PoolOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities?: Array<EntityMetadata<any> | EntitySchema<any>>;
  strictUnknownColumns?: boolean;
}

/**
 * Owns the connection pool and root EntityManager.
 * Call {@link initialize} before use and {@link destroy} on shutdown.
 */
export class DataSource {
  readonly #options: DataSourceOptions;
  readonly #registry = new MetadataRegistry();
  #pool: Pool | null = null;
  #manager: EntityManager | null = null;
  #initialized = false;

  constructor(options: DataSourceOptions) {
    this.#options = options;
  }

  get isInitialized(): boolean {
    return this.#initialized;
  }

  get manager(): EntityManager {
    this.#assertInitialized();
    return this.#manager!;
  }

  get pool(): Pool {
    this.#assertInitialized();
    return this.#pool!;
  }

  async initialize(): Promise<this> {
    if (this.#initialized) {
      return this;
    }

    const entities = this.#options.entities ?? [];

    for (const entry of entities) {
      const meta = isEntityMetadata(entry)
        ? entry
        : defineEntity(entry);
      this.#registry.register(meta);
    }

    if (entities.length > 0) {
      new SchemaRegistry(this.#registry).assertConsistent();
    }

    const {
      entities: _entities,
      strictUnknownColumns,
      ...poolOptions
    } = this.#options;

    this.#pool = new Pool(poolOptions);
    await this.#pool.connect();

    this.#manager = new EntityManager({
      executor: this.#pool,
      registry: this.#registry,
      ...(strictUnknownColumns !== undefined
        ? { strictUnknownColumns }
        : {}),
    });

    this.#initialized = true;
    return this;
  }

  async destroy(): Promise<void> {
    if (!this.#initialized) {
      return;
    }

    this.#manager?.clear();
    this.#manager = null;

    if (this.#pool) {
      await this.#pool.end();
      this.#pool = null;
    }

    this.#registry.clear();
    this.#initialized = false;
  }

  getRepository<T extends object>(
    entity: string | EntityMetadata<T>,
  ): Repository<T> {
    return this.manager.getRepository(entity);
  }

  /**
   * Run work inside BEGIN…COMMIT on a sticky pooled connection.
   * The callback receives a forked EntityManager bound to that connection.
   */
  async transaction<R>(
    fn: (manager: EntityManager) => Promise<R>,
  ): Promise<R> {
    this.#assertInitialized();
    return this.#pool!.transaction(async (conn) => {
      const txEm = this.#manager!.withExecutor(conn);
      return fn(txEm);
    });
  }

  #assertInitialized(): void {
    if (!this.#initialized || !this.#pool || !this.#manager) {
      throw new NoBugDbError(
        'NOT_INITIALIZED',
        'DataSource is not initialized; call initialize() first',
      );
    }
  }
}
