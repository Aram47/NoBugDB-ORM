import { NoBugDbError } from '../driver/errors.js';
import type { MetadataRegistry } from './metadata-registry.js';
import {
  defaultTypeMapper,
  type NoBugDbDataType,
  type TypeMapper,
} from '../types/type-mapper.js';
import type { ColumnMetadata, EntityMetadata, RelationMetadata } from './types.js';

export interface EntityMapperOptions {
  typeMapper?: TypeMapper;
  strictUnknownColumns?: boolean;
  registry?: MetadataRegistry;
}

/**
 * Maps between entity property names and DB column names / wire types.
 */
export class EntityMapper {
  readonly #typeMapper: TypeMapper;
  readonly #strictUnknownColumns: boolean;
  readonly #registry: MetadataRegistry | undefined;

  constructor(options: EntityMapperOptions = {}) {
    this.#typeMapper = options.typeMapper ?? defaultTypeMapper;
    this.#strictUnknownColumns = options.strictUnknownColumns === true;
    this.#registry = options.registry;
  }

  getDbColumnName<T>(
    meta: EntityMetadata<T>,
    propertyName: keyof T & string,
  ): string {
    const column = meta.columns[propertyName];
    if (!column) {
      throw new NoBugDbError(
        'METADATA',
        `Unknown property "${propertyName}" on entity "${meta.name}"`,
      );
    }
    return column.columnName;
  }

  getDbColumnTypes<T>(meta: EntityMetadata<T>): Record<string, NoBugDbDataType> {
    const types: Record<string, NoBugDbDataType> = {};
    for (const column of Object.values(meta.columns) as ColumnMetadata[]) {
      types[column.columnName] = column.type;
    }
    return types;
  }

  getSelectColumns<T>(meta: EntityMetadata<T>, select?: string[]): string[] {
    if (select === undefined || select.length === 0) {
      return (Object.values(meta.columns) as ColumnMetadata[]).map(
        (column) => column.columnName,
      );
    }

    return select.map((propertyName) => {
      const column = meta.columns[propertyName as keyof T & string];
      if (!column) {
        throw new NoBugDbError(
          'METADATA',
          `Unknown select property "${propertyName}" on entity "${meta.name}"`,
        );
      }
      return column.columnName;
    });
  }

  /**
   * Translate FindOptions.where (property keys) to DB column keys.
   * Nested WhereInput structures are left as-is except plain object keys.
   */
  translateWhere<T>(
    where: Record<string, unknown>,
    meta: EntityMetadata<T>,
  ): Record<string, unknown> {
    const translated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(where)) {
      if (key === 'and' || key === 'or' || key === 'not' || key === 'col') {
        translated[key] = value;
        continue;
      }
      const column = meta.columns[key as keyof T & string];
      if (!column) {
        throw new NoBugDbError(
          'METADATA',
          `Unknown where property "${key}" on entity "${meta.name}"`,
        );
      }
      translated[column.columnName] = value;
    }
    return translated;
  }

  translateOrder<T>(
    order: Record<string, 'ASC' | 'DESC'>,
    meta: EntityMetadata<T>,
  ): Array<{ column: string; dir: 'ASC' | 'DESC' }> {
    return Object.entries(order).map(([propertyName, dir]) => {
      const column = meta.columns[propertyName as keyof T & string];
      if (!column) {
        throw new NoBugDbError(
          'METADATA',
          `Unknown order property "${propertyName}" on entity "${meta.name}"`,
        );
      }
      return { column: column.columnName, dir };
    });
  }

  toDbRow<T extends object>(
    entity: Partial<T>,
    meta: EntityMetadata<T>,
    options?: { includeUndefined?: boolean },
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    const source = entity as Record<string, unknown>;
    const resolved = this.#resolveRelationForeignKeys(source, meta);

    for (const [propertyName, column] of Object.entries(meta.columns) as Array<
      [string, ColumnMetadata]
    >) {
      const value =
        propertyName in resolved
          ? resolved[propertyName]
          : propertyName in source
            ? source[propertyName]
            : undefined;

      if (value === undefined && options?.includeUndefined !== true) {
        continue;
      }
      if (!(propertyName in source) && !(propertyName in resolved)) {
        continue;
      }
      row[column.columnName] = value;
    }
    return row;
  }

  /**
   * Hydrate an entity from a QueryBuilder row (already typed via columnTypes)
   * or raw string wire values.
   */
  fromDbRow<T extends object>(
    row: Record<string, unknown>,
    meta: EntityMetadata<T>,
  ): T {
    if (this.#strictUnknownColumns) {
      const known = new Set(
        (Object.values(meta.columns) as ColumnMetadata[]).map(
          (column) => column.columnName,
        ),
      );
      for (const key of Object.keys(row)) {
        if (!known.has(key)) {
          throw new NoBugDbError(
            'METADATA',
            `Unknown column "${key}" in result for entity "${meta.name}"`,
          );
        }
      }
    }

    const entity = {} as T;
    for (const column of Object.values(meta.columns) as ColumnMetadata[]) {
      if (!(column.columnName in row)) {
        continue;
      }
      const raw = row[column.columnName];
      // QueryBuilder already applies fromWire when columnTypes are set;
      // accept both typed values and raw wire strings.
      if (typeof raw === 'string' || raw === null) {
        (entity as Record<string, unknown>)[column.propertyName] =
          this.#typeMapper.fromWire(raw, column.type);
      } else {
        (entity as Record<string, unknown>)[column.propertyName] = raw;
      }
    }
    return entity;
  }

  takeSnapshot<T extends object>(
    entity: T,
    meta: EntityMetadata<T>,
  ): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    const source = entity as Record<string, unknown>;
    const resolved = this.#resolveRelationForeignKeys(source, meta);

    for (const propertyName of Object.keys(meta.columns)) {
      snapshot[propertyName] =
        propertyName in resolved
          ? resolved[propertyName]
          : source[propertyName];
    }
    return snapshot;
  }

  isDirty<T extends object>(
    entity: T,
    snapshot: Record<string, unknown>,
    meta: EntityMetadata<T>,
  ): boolean {
    const currentSnapshot = this.takeSnapshot(entity, meta);
    for (const propertyName of Object.keys(meta.columns)) {
      if (currentSnapshot[propertyName] !== snapshot[propertyName]) {
        return true;
      }
    }
    return false;
  }

  getPrimaryKeyValue<T extends object>(
    entity: Partial<T>,
    meta: EntityMetadata<T>,
  ): unknown {
    return (entity as Record<string, unknown>)[meta.primaryKey];
  }

  getDirtyPatch<T extends object>(
    entity: T,
    snapshot: Record<string, unknown>,
    meta: EntityMetadata<T>,
  ): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    const currentSnapshot = this.takeSnapshot(entity, meta);

    for (const [propertyName, column] of Object.entries(meta.columns) as Array<
      [string, ColumnMetadata]
    >) {
      if (propertyName === meta.primaryKey) {
        continue;
      }
      const current = currentSnapshot[propertyName];
      if (current !== snapshot[propertyName]) {
        patch[column.columnName] = current;
      }
    }
    return patch;
  }

  #resolveRelationForeignKeys(
    source: Record<string, unknown>,
    meta: EntityMetadata,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const relation of Object.values(meta.relations) as RelationMetadata[]) {
      if (
        relation.type !== 'many-to-one' &&
        relation.type !== 'one-to-one'
      ) {
        continue;
      }

      if (!relation.joinColumnProperty) {
        continue;
      }

      if (!(relation.propertyName in source)) {
        continue;
      }

      const value = source[relation.propertyName];
      if (value === null) {
        resolved[relation.joinColumnProperty] = null;
        continue;
      }

      if (typeof value === 'object' && value !== null) {
        const pk = this.#extractRelatedPrimaryKey(relation, value as object);
        resolved[relation.joinColumnProperty] = pk;
      }
    }

    return resolved;
  }

  #extractRelatedPrimaryKey(
    relation: RelationMetadata,
    related: object,
  ): unknown {
    if (this.#registry) {
      const targetMeta = this.#registry.getByTarget(relation.target);
      return this.getPrimaryKeyValue(related, targetMeta);
    }

    const record = related as Record<string, unknown>;
    if ('id' in record) {
      return record.id;
    }

    throw new NoBugDbError(
      'METADATA',
      `Cannot resolve primary key for relation "${relation.propertyName}" without MetadataRegistry`,
    );
  }
}
