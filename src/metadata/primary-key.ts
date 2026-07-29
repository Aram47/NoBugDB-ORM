import { randomUUID } from 'node:crypto';
import { NoBugDbError } from '../driver/errors.js';
import type { EntityMetadata, PrimaryKeyValue } from './types.js';

function isEmptyPkPart(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Stable Identity Map / UoW key fragment for scalar or composite PKs. */
export function serializePrimaryKey(
  pk: unknown,
  meta: EntityMetadata,
): string {
  if (meta.primaryKeys.length === 1) {
    return String(pk);
  }
  const record =
    typeof pk === 'object' && pk !== null
      ? (pk as Record<string, unknown>)
      : null;
  if (!record) {
    throw new NoBugDbError(
      'METADATA',
      `Entity "${meta.name}" expects a composite primary key object`,
    );
  }
  return meta.primaryKeys.map((prop) => String(record[prop])).join('|');
}

export function isPrimaryKeyComplete(
  pk: unknown,
  meta: EntityMetadata,
): boolean {
  if (meta.primaryKeys.length === 1) {
    return !isEmptyPkPart(pk);
  }
  if (typeof pk !== 'object' || pk === null) {
    return false;
  }
  const record = pk as Record<string, unknown>;
  return meta.primaryKeys.every((prop) => !isEmptyPkPart(record[prop]));
}

export function primaryKeyWhere(
  id: PrimaryKeyValue,
  meta: EntityMetadata,
): Record<string, unknown> {
  if (meta.primaryKeys.length === 1) {
    const prop = meta.primaryKeys[0]!;
    if (typeof id === 'object' && id !== null) {
      const record = id as Record<string, unknown>;
      if (prop in record) {
        return { [prop]: record[prop] };
      }
    }
    return { [prop]: id };
  }
  if (typeof id !== 'object' || id === null) {
    throw new NoBugDbError(
      'METADATA',
      `Entity "${meta.name}" findById requires an object with keys: ${meta.primaryKeys.join(', ')}`,
    );
  }
  const record = id as Record<string, unknown>;
  const where: Record<string, unknown> = {};
  for (const prop of meta.primaryKeys) {
    if (!(prop in record) || isEmptyPkPart(record[prop])) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${meta.name}" findById missing primary key part "${prop}"`,
      );
    }
    where[prop] = record[prop];
  }
  return where;
}

export function primaryKeyWhereDb(
  entity: object,
  meta: EntityMetadata,
): Record<string, unknown> {
  const source = entity as Record<string, unknown>;
  const where: Record<string, unknown> = {};
  for (const prop of meta.primaryKeys) {
    const col = meta.columns[prop]!;
    where[col.columnName] = source[prop];
  }
  return where;
}

/** Assign UUID only for generated UUID PK columns that are missing. */
export function ensureGeneratedPrimaryKeys(
  entity: object,
  meta: EntityMetadata,
): void {
  const source = entity as Record<string, unknown>;
  for (const prop of meta.primaryKeys) {
    const col = meta.columns[prop]!;
    if (col.generated === 'uuid' && isEmptyPkPart(source[prop])) {
      source[prop] = randomUUID();
    }
  }
  assertPrimaryKeysPresent(entity, meta);
}

export function assertPrimaryKeysPresent(
  entity: object,
  meta: EntityMetadata,
): void {
  const source = entity as Record<string, unknown>;
  for (const prop of meta.primaryKeys) {
    if (isEmptyPkPart(source[prop])) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${meta.name}" primary key "${prop}" is required before flush`,
      );
    }
  }
}
