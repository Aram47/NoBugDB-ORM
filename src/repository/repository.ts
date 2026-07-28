import { randomUUID } from 'node:crypto';
import type { QueryResult } from '../driver/types.js';
import type { UnitOfWork } from '../entity-manager/unit-of-work.js';
import type { EntityMapper } from '../metadata/entity-mapper.js';
import type { MetadataRegistry } from '../metadata/metadata-registry.js';
import type { EntityMetadata } from '../metadata/types.js';
import { QueryBuilder } from '../query-builder/query-builder.js';
import type { QueryExecutor } from '../query-builder/prepared.js';
import { sql } from '../query-builder/sql-fragments.js';
import type { FindOptions } from './find-options.js';
import { RelationLoader } from './relation-loader.js';

export interface RepositoryContext {
  executor: QueryExecutor;
  meta: EntityMetadata;
  mapper: EntityMapper;
  registry: MetadataRegistry;
  unitOfWork: UnitOfWork;
  flush: () => Promise<void>;
}

/**
 * Data Mapper repository: plain entities, no Active Record methods on entities.
 */
export class Repository<T extends object> {
  readonly #executor: QueryExecutor;
  readonly #meta: EntityMetadata<T>;
  readonly #mapper: EntityMapper;
  readonly #registry: MetadataRegistry;
  readonly #unitOfWork: UnitOfWork;
  readonly #flush: () => Promise<void>;

  constructor(ctx: RepositoryContext) {
    this.#executor = ctx.executor;
    this.#meta = ctx.meta;
    this.#mapper = ctx.mapper;
    this.#registry = ctx.registry;
    this.#unitOfWork = ctx.unitOfWork;
    this.#flush = ctx.flush;
  }

  get metadata(): EntityMetadata<T> {
    return this.#meta;
  }

  #qb(): QueryBuilder {
    return new QueryBuilder(this.#executor, {
      columnTypes: this.#mapper.getDbColumnTypes(this.#meta),
    });
  }

  async find(options: FindOptions = {}): Promise<T[]> {
    if (options.relations !== undefined && options.relations.length > 0) {
      const loader = new RelationLoader(
        this.#executor,
        this.#registry,
        this.#mapper,
        this.#unitOfWork,
      );
      return loader.find(this.#meta, options);
    }

    let qb = this.#qb()
      .select(...this.#mapper.getSelectColumns(this.#meta, options.select))
      .from(this.#meta.tableName);

    if (options.where !== undefined) {
      qb = qb.where(this.#mapper.translateWhere(options.where, this.#meta));
    }

    if (options.order !== undefined) {
      for (const { column, dir } of this.#mapper.translateOrder(
        options.order,
        this.#meta,
      )) {
        qb = qb.orderBy(column, dir);
      }
    }

    if (options.limit !== undefined) {
      qb = qb.limit(options.limit);
    }
    if (options.offset !== undefined) {
      qb = qb.offset(options.offset);
    }

    const rows = await qb.execute<Record<string, unknown>>();
    return rows.map((row) => this.#hydrate(row));
  }

  async findOne(options: FindOptions): Promise<T | null> {
    const rows = await this.find({ ...options, limit: 1 });
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<T | null> {
    return this.findOne({
      where: { [this.#meta.primaryKey]: id },
    });
  }

  async insert(plain: Partial<T>): Promise<T>;
  async insert(plain: Partial<T>[]): Promise<T[]>;
  async insert(plain: Partial<T> | Partial<T>[]): Promise<T | T[]> {
    const isArray = Array.isArray(plain);
    const items = isArray ? plain : [plain];
    const entities = items.map((item) => this.#prepareForInsert(item));

    const dbRows = entities.map((entity) =>
      this.#mapper.toDbRow(entity, this.#meta),
    );

    await this.#qb()
      .insertInto(this.#meta.tableName)
      .values(dbRows)
      .executeCommand();

    const managed = entities.map((entity) =>
      this.#unitOfWork.registerManaged(entity, this.#meta),
    );

    return isArray ? managed : managed[0]!;
  }

  async update(criteria: Partial<T>, patch: Partial<T>): Promise<number> {
    const where = this.#mapper.translateWhere(
      criteria as Record<string, unknown>,
      this.#meta,
    );
    const set = this.#mapper.toDbRow(patch, this.#meta);

    if (Object.keys(set).length === 0) {
      return 0;
    }

    await this.#qb()
      .update(this.#meta.tableName)
      .set(set)
      .where(where)
      .executeCommand();

    return 1;
  }

  async delete(criteria: Partial<T>): Promise<number> {
    const where = this.#mapper.translateWhere(
      criteria as Record<string, unknown>,
      this.#meta,
    );

    await this.#qb()
      .deleteFrom(this.#meta.tableName)
      .where(where)
      .executeCommand();

    const pk = this.#mapper.getPrimaryKeyValue(criteria, this.#meta);
    if (pk !== undefined && pk !== null && pk !== '') {
      this.#unitOfWork.identityMap.delete(this.#meta.tableName, String(pk));
    }

    return 1;
  }

  async save(entity: T): Promise<T>;
  async save(entity: T[]): Promise<T[]>;
  async save(entity: T | T[]): Promise<T | T[]> {
    const isArray = Array.isArray(entity);
    const items = isArray ? entity : [entity];
    const results: T[] = [];

    for (const item of items) {
      results.push(await this.#saveOne(item));
    }

    return isArray ? results : results[0]!;
  }

  async count(options: FindOptions = {}): Promise<number> {
    let qb = this.#qb().select(sql.count('*')).from(this.#meta.tableName);

    if (options.where !== undefined) {
      qb = qb.where(this.#mapper.translateWhere(options.where, this.#meta));
    }

    const rows = await qb.execute<Record<string, unknown>>();
    const first = rows[0];
    if (!first) {
      return 0;
    }
    const value = Object.values(first)[0];
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return Number(value);
    }
    return 0;
  }

  /** Escape hatch used by EntityManager.flush for direct DML. */
  async executeRaw(sqlText: string): Promise<QueryResult> {
    return this.#executor.query(sqlText);
  }

  #prepareForInsert(plain: Partial<T>): T {
    const entity = { ...plain } as T;
    const pk = this.#mapper.getPrimaryKeyValue(entity, this.#meta);
    if (pk === undefined || pk === null || pk === '') {
      (entity as Record<string, unknown>)[this.#meta.primaryKey] = randomUUID();
    }
    return entity;
  }

  async #saveOne(entity: T): Promise<T> {
    const tracked = this.#unitOfWork.getTracked(entity);
    if (tracked) {
      this.#unitOfWork.persist(entity, this.#meta);
      await this.#flush();
      return entity;
    }

    const pk = this.#mapper.getPrimaryKeyValue(entity, this.#meta);
    if (pk !== undefined && pk !== null && pk !== '') {
      const existing = await this.findById(String(pk));
      if (existing) {
        const existingRecord = existing as Record<string, unknown>;
        const source = entity as Record<string, unknown>;
        for (const propertyName of Object.keys(this.#meta.columns)) {
          if (propertyName in source) {
            existingRecord[propertyName] = source[propertyName];
          }
        }
        this.#unitOfWork.persist(existing, this.#meta);
        await this.#flush();
        return existing;
      }
    }

    return this.insert(entity);
  }

  #hydrate(row: Record<string, unknown>): T {
    const entity = this.#mapper.fromDbRow<T>(row, this.#meta);
    return this.#unitOfWork.registerManaged(entity, this.#meta);
  }
}
