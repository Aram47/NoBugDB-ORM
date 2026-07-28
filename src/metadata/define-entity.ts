import { NoBugDbError } from '../driver/errors.js';
import {
  ENTITY_METADATA,
  type ColumnMetadata,
  type ColumnOptions,
  type EntityMetadata,
  type EntitySchema,
  type RelationMetadata,
  type RelationOptions,
} from './types.js';

function normalizeColumn(
  propertyName: string,
  options: ColumnOptions,
): ColumnMetadata {
  const column: ColumnMetadata = {
    propertyName,
    columnName: options.name ?? propertyName,
    type: options.type,
    primary: options.primary === true,
    unique: options.unique === true,
    nullable: options.nullable === true,
  };
  if (options.default !== undefined) {
    return { ...column, default: options.default };
  }
  return column;
}

const VALID_ON_DELETE = new Set([
  'RESTRICT',
  'CASCADE',
  'SET NULL',
  'SET DEFAULT',
]);

function normalizeRelation(
  entityName: string,
  propertyName: string,
  options: RelationOptions,
  columns: Record<string, ColumnMetadata>,
): RelationMetadata {
  if (!options.target || options.target.trim() === '') {
    throw new NoBugDbError(
      'METADATA',
      `Relation "${propertyName}" on entity "${entityName}" requires a target`,
    );
  }

  if (
    options.onDelete !== undefined &&
    !VALID_ON_DELETE.has(options.onDelete)
  ) {
    throw new NoBugDbError(
      'METADATA',
      `Relation "${propertyName}" on entity "${entityName}" has invalid onDelete "${options.onDelete}"`,
    );
  }

  const base: RelationMetadata = {
    propertyName,
    type: options.type,
    target: options.target,
    ...(options.inverseSide !== undefined
      ? { inverseSide: options.inverseSide }
      : {}),
    ...(options.nullable === true ? { nullable: true } : {}),
    ...(options.onDelete !== undefined ? { onDelete: options.onDelete } : {}),
  };

  if (options.type === 'one-to-many') {
    if (!options.inverseSide || options.inverseSide.trim() === '') {
      throw new NoBugDbError(
        'METADATA',
        `Relation "${propertyName}" on entity "${entityName}" (one-to-many) requires inverseSide`,
      );
    }
    return base;
  }

  const joinColumnProperty =
    options.joinColumn ?? `${propertyName}Id`;
  const column = columns[joinColumnProperty];
  if (!column) {
    throw new NoBugDbError(
      'METADATA',
      `Relation "${propertyName}" on entity "${entityName}" joinColumn "${joinColumnProperty}" does not exist`,
    );
  }
  if (column.type !== 'UUID') {
    throw new NoBugDbError(
      'METADATA',
      `Relation "${propertyName}" on entity "${entityName}" joinColumn "${joinColumnProperty}" must be UUID`,
    );
  }

  return {
    ...base,
    joinColumn: joinColumnProperty,
    joinColumnProperty,
    joinColumnDb: column.columnName,
  };
}

function normalizeRelations(
  entityName: string,
  relations: Record<string, RelationOptions> | undefined,
  columns: Record<string, ColumnMetadata>,
): Record<string, RelationMetadata> {
  if (relations === undefined) {
    return {};
  }

  const normalized: Record<string, RelationMetadata> = {};
  for (const [propertyName, options] of Object.entries(relations)) {
    if (normalized[propertyName]) {
      throw new NoBugDbError(
        'METADATA',
        `Duplicate relation property "${propertyName}" on entity "${entityName}"`,
      );
    }
    normalized[propertyName] = normalizeRelation(
      entityName,
      propertyName,
      options,
      columns,
    );
  }
  return normalized;
}

/**
 * Code-first entity definition (no decorators required).
 * Primary key must be a single UUID column with `primary: true`.
 */
export function defineEntity<T extends object>(
  schema: EntitySchema<T>,
): EntityMetadata<T> {
  if (!schema.name || schema.name.trim() === '') {
    throw new NoBugDbError('METADATA', 'EntitySchema.name is required');
  }
  if (!schema.tableName || schema.tableName.trim() === '') {
    throw new NoBugDbError('METADATA', 'EntitySchema.tableName is required');
  }

  const propertyNames = Object.keys(schema.columns) as Array<keyof T & string>;
  if (propertyNames.length === 0) {
    throw new NoBugDbError(
      'METADATA',
      `Entity "${schema.name}" must declare at least one column`,
    );
  }

  const columns = {} as Record<keyof T & string, ColumnMetadata>;
  const primaryKeys: Array<keyof T & string> = [];

  for (const propertyName of propertyNames) {
    const options = schema.columns[propertyName];
    if (options === undefined) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${schema.name}" is missing column options for "${propertyName}"`,
      );
    }
    columns[propertyName] = normalizeColumn(propertyName, options);
    if (options.primary === true) {
      primaryKeys.push(propertyName);
    }
  }

  if (primaryKeys.length !== 1) {
    throw new NoBugDbError(
      'METADATA',
      `Entity "${schema.name}" must have exactly one primary column (found ${primaryKeys.length})`,
    );
  }

  const primaryKey = primaryKeys[0]!;
  const pkColumn = columns[primaryKey]!;
  if (pkColumn.type !== 'UUID') {
    throw new NoBugDbError(
      'METADATA',
      `Entity "${schema.name}" primary key "${primaryKey}" must be UUID (got ${pkColumn.type})`,
    );
  }

  const relations = normalizeRelations(
    schema.name,
    schema.relations,
    columns as Record<string, ColumnMetadata>,
  );

  const meta: EntityMetadata<T> = {
    name: schema.name,
    tableName: schema.tableName,
    columns,
    primaryKey,
    relations,
  };

  Object.defineProperty(meta, ENTITY_METADATA, {
    value: true,
    enumerable: false,
  });

  return meta;
}
