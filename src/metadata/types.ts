import type { NoBugDbDataType } from '../types/type-mapper.js';

export interface ColumnOptions {
  name?: string;
  type: NoBugDbDataType;
  primary?: boolean;
  unique?: boolean;
  nullable?: boolean;
  default?: unknown;
  /**
   * UUID primary columns default to `'uuid'` (auto-generate on insert).
   * Set `false` to require a client-supplied value. Non-UUID PKs never auto-generate.
   */
  generated?: 'uuid' | false;
}

export interface ColumnMetadata {
  readonly propertyName: string;
  readonly columnName: string;
  readonly type: NoBugDbDataType;
  readonly primary: boolean;
  readonly unique: boolean;
  readonly nullable: boolean;
  readonly default?: unknown;
  readonly generated: 'uuid' | false;
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
  /** Explicit composite PK order; optional when a single column has `primary: true`. */
  primaryColumns?: Array<keyof T & string>;
}

/** Scalar or composite primary key value accepted by Repository.findById. */
export type PrimaryKeyValue<T = unknown> =
  | string
  | number
  | (T extends object ? Partial<T> & Record<string, unknown> : Record<string, unknown>);

/** @public Entity shape is provided by the caller; default is intentionally open. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EntityMetadata<T = any> {
  readonly name: string;
  readonly tableName: string;
  readonly columns: Readonly<Record<keyof T & string, ColumnMetadata>>;
  /** Ordered primary key property names (length >= 1). */
  readonly primaryKeys: ReadonlyArray<keyof T & string>;
  /**
   * Single-column PK shortcut. Throws when the entity has a composite primary key.
   * Prefer `primaryKeys` for new code.
   */
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
