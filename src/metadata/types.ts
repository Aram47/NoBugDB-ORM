import type { NoBugDbDataType } from '../types/type-mapper.js';

export interface ColumnOptions {
  name?: string;
  type: NoBugDbDataType;
  primary?: boolean;
  unique?: boolean;
  nullable?: boolean;
  default?: unknown;
}

export interface ColumnMetadata {
  readonly propertyName: string;
  readonly columnName: string;
  readonly type: NoBugDbDataType;
  readonly primary: boolean;
  readonly unique: boolean;
  readonly nullable: boolean;
  readonly default?: unknown;
}

export type RelationKind = 'many-to-one' | 'one-to-many' | 'one-to-one';

export type RelationOnDelete =
  | 'RESTRICT'
  | 'CASCADE'
  | 'SET NULL'
  | 'SET DEFAULT';

export interface RelationOptions {
  type: RelationKind;
  target: string;
  joinColumn?: string;
  inverseSide?: string;
  nullable?: boolean;
  onDelete?: RelationOnDelete;
}

export interface RelationMetadata extends RelationOptions {
  readonly propertyName: string;
  readonly joinColumnProperty?: string;
  readonly joinColumnDb?: string;
}

export interface EntitySchema<T> {
  name: string;
  tableName: string;
  columns: Record<keyof T & string, ColumnOptions>;
  relations?: Record<string, RelationOptions>;
}

/** @public Entity shape is provided by the caller; default is intentionally open. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EntityMetadata<T = any> {
  readonly name: string;
  readonly tableName: string;
  readonly columns: Readonly<Record<keyof T & string, ColumnMetadata>>;
  readonly primaryKey: keyof T & string;
  readonly relations: Readonly<Record<string, RelationMetadata>>;
}

/** Marker so callers can pass defineEntity() results to getRepository. */
export const ENTITY_METADATA = Symbol.for('nobugdb-orm.EntityMetadata');

export function isEntityMetadata(value: unknown): value is EntityMetadata {
  return (
    typeof value === 'object' &&
    value !== null &&
    ENTITY_METADATA in value &&
    (value as { [ENTITY_METADATA]?: boolean })[ENTITY_METADATA] === true
  );
}
