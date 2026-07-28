import { NoBugDbError } from '../driver/errors.js';
import type { UnitOfWork } from '../entity-manager/unit-of-work.js';
import type { EntityMapper } from '../metadata/entity-mapper.js';
import type { MetadataRegistry } from '../metadata/metadata-registry.js';
import {
  parseRelationPaths,
  type RelationPathNode,
} from '../metadata/relation-path.js';
import type {
  ColumnMetadata,
  EntityMetadata,
  RelationMetadata,
} from '../metadata/types.js';
import type { NoBugDbDataType } from '../types/type-mapper.js';
import { QueryBuilder } from '../query-builder/query-builder.js';
import type { QueryExecutor } from '../query-builder/prepared.js';
import { sql } from '../query-builder/sql-fragments.js';
import type { FindOptions } from './find-options.js';
import {
  RelationHydrator,
  type JoinedRelationSpec,
} from './relation-hydrator.js';

const IN_CHUNK_SIZE = 50;

interface OneToManyLoadSpec {
  readonly property: string;
  readonly parentMeta: EntityMetadata;
  readonly relation: RelationMetadata;
}

interface JoinBuildResult {
  readonly joins: JoinedRelationSpec[];
  readonly oneToMany: OneToManyLoadSpec[];
}

/**
 * Builds JOIN / batch SELECT queries from relation metadata and hydrates results.
 */
export class RelationLoader {
  readonly #executor: QueryExecutor;
  readonly #registry: MetadataRegistry;
  readonly #mapper: EntityMapper;
  readonly #hydrator: RelationHydrator;

  constructor(
    executor: QueryExecutor,
    registry: MetadataRegistry,
    mapper: EntityMapper,
    unitOfWork: UnitOfWork,
  ) {
    this.#executor = executor;
    this.#registry = registry;
    this.#mapper = mapper;
    this.#hydrator = new RelationHydrator(mapper, unitOfWork, registry);
  }

  async find<T extends object>(
    meta: EntityMetadata<T>,
    options: FindOptions = {},
  ): Promise<T[]> {
    const relationPaths = options.relations ?? [];
    if (relationPaths.length === 0) {
      return [];
    }

    const pathTree = parseRelationPaths(relationPaths);
    const { joins, oneToMany } = this.#buildJoinPlan(meta, pathTree, 't0');

    const qb = this.#baseQuery(meta, options, joins);
    const rows = await qb.execute<Record<string, unknown>>();
    const entities = rows.map((row) =>
      this.#hydrator.hydrateRootRow(row, meta, joins),
    );

    for (const spec of oneToMany) {
      await this.#loadOneToMany(entities, spec);
    }

    return entities;
  }

  #baseQuery<T extends object>(
    meta: EntityMetadata<T>,
    options: FindOptions,
    joins: JoinedRelationSpec[],
  ): QueryBuilder {
    const rootAlias = 't0';
    const selectColumns = this.#buildSelectColumns(meta, rootAlias, joins);

    let qb = new QueryBuilder(this.#executor, {
      columnTypes: this.#mergedColumnTypes(meta, joins),
    })
      .select(...selectColumns)
      .from(meta.tableName, rootAlias);

    for (const spec of joins) {
      const joinColumnDb = spec.relation.joinColumnDb!;
      const targetPkDb =
        spec.meta.columns[spec.meta.primaryKey]!.columnName;
      const onClause = `${spec.ownerAlias}.${joinColumnDb} = ${spec.alias}.${targetPkDb}`;
      qb = qb.leftJoin(spec.meta.tableName, onClause, spec.alias);
    }

    if (options.where !== undefined) {
      qb = qb.where(
        this.#translateRootWhere(options.where, meta, rootAlias),
      );
    }

    if (options.order !== undefined) {
      for (const { column, dir } of this.#mapper.translateOrder(
        options.order,
        meta,
      )) {
        qb = qb.orderBy(`${rootAlias}.${column}`, dir);
      }
    }

    if (options.limit !== undefined) {
      qb = qb.limit(options.limit);
    }
    if (options.offset !== undefined) {
      qb = qb.offset(options.offset);
    }

    return qb;
  }

  #buildSelectColumns(
    meta: EntityMetadata,
    rootAlias: string,
    joins: JoinedRelationSpec[],
  ): Array<string | ReturnType<typeof sql.raw>> {
    const columns: Array<string | ReturnType<typeof sql.raw>> = [];

    for (const column of Object.values(meta.columns) as ColumnMetadata[]) {
      columns.push(
        sql.raw(`${rootAlias}.${column.columnName} AS ${column.columnName}`),
      );
    }

    for (const spec of joins) {
      for (const column of Object.values(spec.meta.columns) as ColumnMetadata[]) {
        columns.push(
          sql.raw(
            `${spec.alias}.${column.columnName} AS ${spec.prefix}__${column.columnName}`,
          ),
        );
      }
    }

    return columns;
  }

  #mergedColumnTypes(
    meta: EntityMetadata,
    joins: JoinedRelationSpec[],
  ): Record<string, NoBugDbDataType> {
    const types = { ...this.#mapper.getDbColumnTypes(meta) };

    for (const spec of joins) {
      for (const [dbColumn, type] of Object.entries(
        this.#mapper.getDbColumnTypes(spec.meta),
      )) {
        types[`${spec.prefix}__${dbColumn}`] = type;
      }
    }

    return types;
  }

  #translateRootWhere(
    where: Record<string, unknown>,
    meta: EntityMetadata,
    rootAlias: string,
  ): Record<string, unknown> {
    const translated = this.#mapper.translateWhere(where, meta);
    const prefixed: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(translated)) {
      if (key === 'and' || key === 'or' || key === 'not' || key === 'col') {
        prefixed[key] = value;
        continue;
      }
      prefixed[`${rootAlias}.${key}`] = value;
    }

    return prefixed;
  }

  #buildJoinPlan(
    meta: EntityMetadata,
    nodes: RelationPathNode[],
    ownerAlias: string,
    aliasCounter = { value: 1 },
    pathPrefix: string[] = [],
  ): JoinBuildResult {
    const joins: JoinedRelationSpec[] = [];
    const oneToMany: OneToManyLoadSpec[] = [];

    for (const node of nodes) {
      const relation = meta.relations[node.property];
      if (!relation) {
        throw new NoBugDbError(
          'METADATA',
          `Entity "${meta.name}" has no relation "${node.property}"`,
        );
      }

      if (relation.type === 'one-to-many') {
        oneToMany.push({
          property: node.property,
          parentMeta: meta,
          relation,
        });
        continue;
      }

      const targetMeta = this.#registry.getByTarget(relation.target);
      const alias = `t${aliasCounter.value}`;
      aliasCounter.value += 1;
      const path = [...pathPrefix, node.property];
      const prefix = path.join('__');

      const spec: JoinedRelationSpec = {
        property: node.property,
        path,
        prefix,
        alias,
        ownerAlias,
        meta: targetMeta,
        relation,
      };
      joins.push(spec);

      if (node.children.length > 0) {
        const nested = this.#buildJoinPlan(
          targetMeta,
          node.children,
          alias,
          aliasCounter,
          path,
        );
        joins.push(...nested.joins);
        oneToMany.push(...nested.oneToMany);
      }
    }

    return { joins, oneToMany };
  }

  async #loadOneToMany<T extends object>(
    parents: T[],
    spec: OneToManyLoadSpec,
  ): Promise<void> {
    if (parents.length === 0) {
      return;
    }

    const { childMeta, inverse } = this.#hydrator.resolveInverseManyToOne(
      spec.parentMeta,
      spec.relation,
    );
    const fkProperty = inverse.joinColumnProperty!;
    const fkDb = inverse.joinColumnDb!;

    const parentIds = parents
      .map((parent) =>
        this.#mapper.getPrimaryKeyValue(parent, spec.parentMeta),
      )
      .filter((id) => id !== undefined && id !== null && id !== '')
      .map(String);

    if (parentIds.length === 0) {
      for (const parent of parents) {
        (parent as Record<string, unknown>)[spec.property] = [];
      }
      return;
    }

    const children: object[] = [];
    for (let i = 0; i < parentIds.length; i += IN_CHUNK_SIZE) {
      const chunk = parentIds.slice(i, i + IN_CHUNK_SIZE);
      const rows = await new QueryBuilder(this.#executor, {
        columnTypes: this.#mapper.getDbColumnTypes(childMeta),
      })
        .select(
          ...(Object.values(childMeta.columns) as ColumnMetadata[]).map(
            (column) => column.columnName,
          ),
        )
        .from(childMeta.tableName)
        .where({ col: fkDb, op: 'in', value: chunk })
        .execute<Record<string, unknown>>();

      for (const row of rows) {
        children.push(this.#mapper.fromDbRow(row, childMeta));
      }
    }

    this.#hydrator.attachCollection(
      parents,
      spec.parentMeta,
      spec.property,
      children,
      childMeta,
      fkProperty,
    );
  }
}
