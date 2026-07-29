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
  const primary = options.primary === true;
  let generated: 'uuid' | false;
  if (options.generated === false) {
    generated = false;
  } else if (options.generated === 'uuid') {
    generated = 'uuid';
  } else if (primary && options.type === 'UUID') {
    generated = 'uuid';
  } else {
    generated = false;
  }

  const column: ColumnMetadata = {
    propertyName,
    columnName: options.name ?? propertyName,
    type: options.type,
    primary,
    unique: options.unique === true,
    nullable: options.nullable === true,
    generated,
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

  // Inverse one-to-one: mappedBy owning side via inverseSide, no local FK.
  if (
    options.type === 'one-to-one' &&
    options.joinColumn === undefined &&
    options.inverseSide !== undefined &&
    options.inverseSide.trim() !== ''
  ) {
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

function resolvePrimaryKeys<T extends object>(
  schema: EntitySchema<T>,
  columns: Record<keyof T & string, ColumnMetadata>,
  flagged: Array<keyof T & string>,
): Array<keyof T & string> {
  if (schema.primaryColumns !== undefined && schema.primaryColumns.length > 0) {
    const ordered: Array<keyof T & string> = [];
    for (const prop of schema.primaryColumns) {
      if (!columns[prop]) {
        throw new NoBugDbError(
          'METADATA',
          `Entity "${schema.name}" primaryColumns entry "${String(prop)}" is not a column`,
        );
      }
      ordered.push(prop);
    }
    for (const prop of flagged) {
      if (!ordered.includes(prop)) {
        throw new NoBugDbError(
          'METADATA',
          `Entity "${schema.name}" column "${prop}" is marked primary but missing from primaryColumns`,
        );
      }
    }
    for (const prop of ordered) {
      if (!columns[prop]!.primary) {
        columns[prop] = { ...columns[prop]!, primary: true };
      }
    }
    return ordered;
  }
  return flagged;
}

/**
 * Code-first entity definition (no decorators required).
 * Requires at least one primary column; UUID PKs auto-generate by default.
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
  const flaggedPrimary: Array<keyof T & string> = [];

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
      flaggedPrimary.push(propertyName);
    }
  }

  const primaryKeys = resolvePrimaryKeys(schema, columns, flaggedPrimary);

  if (primaryKeys.length === 0) {
    throw new NoBugDbError(
      'METADATA',
      `Entity "${schema.name}" must have at least one primary column`,
    );
  }

  for (const pk of primaryKeys) {
    const col = columns[pk]!;
    if (col.generated === 'uuid' && col.type !== 'UUID') {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${schema.name}" primary key "${pk}" has generated: 'uuid' but type is ${col.type}`,
      );
    }
  }

  const relations = normalizeRelations(
    schema.name,
    schema.relations,
    columns as Record<string, ColumnMetadata>,
  );

  const meta = {
    name: schema.name,
    tableName: schema.tableName,
    columns,
    primaryKeys,
    relations,
  } as unknown as EntityMetadata<T>;

  Object.defineProperty(meta, 'primaryKey', {
    enumerable: true,
    configurable: true,
    get(): keyof T & string {
      if (primaryKeys.length !== 1) {
        throw new NoBugDbError(
          'METADATA',
          `Entity "${schema.name}" has a composite primary key; use primaryKeys instead of primaryKey`,
        );
      }
      return primaryKeys[0]!;
    },
  });

  Object.defineProperty(meta, ENTITY_METADATA, {
    value: true,
    enumerable: false,
  });

  return meta;
}
