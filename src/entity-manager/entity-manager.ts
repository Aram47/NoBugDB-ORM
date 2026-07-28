import { randomUUID } from 'node:crypto';
import { NoBugDbError } from '../driver/errors.js';
import type { QueryResult } from '../driver/types.js';
import { EntityMapper } from '../metadata/entity-mapper.js';
import type { MetadataRegistry } from '../metadata/metadata-registry.js';
import type { EntityMetadata } from '../metadata/types.js';
import type { QueryExecutor } from '../query-builder/prepared.js';
import { QueryBuilder } from '../query-builder/query-builder.js';
import type { FindOptions } from '../repository/find-options.js';
import { Repository } from '../repository/repository.js';
import type { TypeMapper } from '../types/type-mapper.js';
import { sortForDelete, sortForInsert } from './flush-order.js';
import { IdentityMap } from './identity-map.js';
import { UnitOfWork } from './unit-of-work.js';

/** Internal cache key type for heterogeneous repositories. */
type EntityRecord = Record<string, unknown>;

export interface EntityManagerOptions {
  strictUnknownColumns?: boolean;
  typeMapper?: TypeMapper;
}

export interface EntityManagerDeps {
  executor: QueryExecutor;
  registry: MetadataRegistry;
  mapper?: EntityMapper;
  unitOfWork?: UnitOfWork;
  identityMap?: IdentityMap;
  strictUnknownColumns?: boolean;
  typeMapper?: TypeMapper;
}

/**
 * Facade over repositories, Unit of Work, and Identity Map.
 * Entities are plain objects — persistence goes through EM / Repository only.
 */
export class EntityManager {
  readonly #executor: QueryExecutor;
  readonly #registry: MetadataRegistry;
  readonly #mapper: EntityMapper;
  readonly #unitOfWork: UnitOfWork;
  readonly #repos = new Map<string, Repository<EntityRecord>>();
  /** Associates plain entity instances with their metadata (e.g. from create()). */
  readonly #metaByEntity = new WeakMap<object, EntityMetadata>();
  readonly #strictUnknownColumns: boolean;
  readonly #typeMapper: TypeMapper | undefined;

  constructor(deps: EntityManagerDeps) {
    this.#executor = deps.executor;
    this.#registry = deps.registry;
    this.#strictUnknownColumns = deps.strictUnknownColumns === true;
    this.#typeMapper = deps.typeMapper;
    this.#mapper =
      deps.mapper ??
      new EntityMapper({
        strictUnknownColumns: this.#strictUnknownColumns,
        registry: this.#registry,
        ...(deps.typeMapper !== undefined
          ? { typeMapper: deps.typeMapper }
          : {}),
      });
    this.#unitOfWork =
      deps.unitOfWork ??
      new UnitOfWork(deps.identityMap ?? new IdentityMap(), this.#mapper);
  }

  get unitOfWork(): UnitOfWork {
    return this.#unitOfWork;
  }

  getRepository<T extends object>(
    entity: string | EntityMetadata<T>,
  ): Repository<T> {
    const meta = this.#registry.getByTarget(
      entity as string | EntityMetadata,
    ) as EntityMetadata<T>;

    const cached = this.#repos.get(meta.name);
    if (cached) {
      return cached as Repository<T>;
    }

    const repo = new Repository<T>({
      executor: this.#executor,
      meta,
      mapper: this.#mapper,
      registry: this.#registry,
      unitOfWork: this.#unitOfWork,
      flush: () => this.flush(),
    });

    this.#repos.set(meta.name, repo as unknown as Repository<EntityRecord>);
    return repo;
  }

  create<T extends object>(
    entity: EntityMetadata<T>,
    plain: Partial<T> = {},
  ): T {
    const meta = this.#registry.getByTarget(entity) as EntityMetadata<T>;
    const instance = { ...plain } as T;
    this.#metaByEntity.set(instance, meta);
    return instance;
  }

  persist<T extends object>(entity: T): void {
    const meta = this.#resolveMeta(entity);
    const pk = this.#mapper.getPrimaryKeyValue(entity, meta);
    if (pk === undefined || pk === null || pk === '') {
      (entity as Record<string, unknown>)[meta.primaryKey] = randomUUID();
    }
    this.#unitOfWork.persist(entity, meta);
    this.#metaByEntity.set(entity, meta);
  }

  remove<T extends object>(entity: T): void {
    this.#resolveMeta(entity);
    this.#unitOfWork.remove(entity);
  }

  async flush(): Promise<void> {
    const plan = this.#unitOfWork.getFlushPlan();
    const inserts = sortForInsert(plan.inserts);
    const deletes = sortForDelete(plan.deletes);

    for (const tracked of inserts) {
      const meta = tracked.meta;
      const pk = this.#mapper.getPrimaryKeyValue(tracked.entity, meta);
      if (pk === undefined || pk === null || pk === '') {
        (tracked.entity as Record<string, unknown>)[meta.primaryKey] =
          randomUUID();
      }
      const row = this.#mapper.toDbRow(tracked.entity, meta);
      await new QueryBuilder(this.#executor, {
        columnTypes: this.#mapper.getDbColumnTypes(meta),
      })
        .insertInto(meta.tableName)
        .values(row)
        .executeCommand();
    }

    for (const tracked of plan.updates) {
      const meta = tracked.meta;
      const patch = this.#mapper.getDirtyPatch(
        tracked.entity,
        tracked.snapshot,
        meta,
      );
      if (Object.keys(patch).length === 0) {
        continue;
      }
      const pk = this.#mapper.getPrimaryKeyValue(tracked.entity, meta);
      const pkCol = meta.columns[meta.primaryKey]!.columnName;
      await new QueryBuilder(this.#executor, {
        columnTypes: this.#mapper.getDbColumnTypes(meta),
      })
        .update(meta.tableName)
        .set(patch)
        .where({ [pkCol]: pk })
        .executeCommand();
    }

    for (const tracked of deletes) {
      const meta = tracked.meta;
      const pk = this.#mapper.getPrimaryKeyValue(tracked.entity, meta);
      const pkCol = meta.columns[meta.primaryKey]!.columnName;
      await new QueryBuilder(this.#executor, {
        columnTypes: this.#mapper.getDbColumnTypes(meta),
      })
        .deleteFrom(meta.tableName)
        .where({ [pkCol]: pk })
        .executeCommand();
    }

    this.#unitOfWork.applyFlushResult(plan);
  }

  clear(): void {
    this.#unitOfWork.clear();
    this.#repos.clear();
  }

  async find<T extends object>(
    entity: EntityMetadata<T>,
    options?: FindOptions,
  ): Promise<T[]> {
    return this.getRepository(entity).find(options);
  }

  async findOne<T extends object>(
    entity: EntityMetadata<T>,
    options: FindOptions,
  ): Promise<T | null> {
    return this.getRepository(entity).findOne(options);
  }

  async query(sqlText: string): Promise<QueryResult> {
    return this.#executor.query(sqlText);
  }

  /**
   * Fork a new EntityManager bound to a sticky transaction connection.
   * Fresh Identity Map + Unit of Work for the transaction scope.
   */
  withExecutor(executor: QueryExecutor): EntityManager {
    return new EntityManager({
      executor,
      registry: this.#registry,
      strictUnknownColumns: this.#strictUnknownColumns,
      ...(this.#typeMapper !== undefined
        ? { typeMapper: this.#typeMapper }
        : {}),
      identityMap: new IdentityMap(),
    });
  }

  #resolveMeta<T extends object>(entity: T): EntityMetadata<T> {
    const fromMap = this.#metaByEntity.get(entity);
    if (fromMap) {
      return fromMap as EntityMetadata<T>;
    }

    const tracked = this.#unitOfWork.getTracked(entity);
    if (tracked) {
      return tracked.meta as EntityMetadata<T>;
    }

    throw new NoBugDbError(
      'METADATA',
      'Entity is not associated with metadata; create it via EntityManager.create() or load via Repository',
    );
  }
}
