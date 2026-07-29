import type { QueryResult } from '../driver/types.js';
import type { RelationOnDelete } from '../metadata/types.js';
import type { NoBugDbDataType } from '../types/type-mapper.js';

export type FkReferentialAction = RelationOnDelete;

export interface FkOptions {
  onDelete?: FkReferentialAction;
  onUpdate?: FkReferentialAction;
}

export interface ColumnBuilder {
  primary(): this;
  unique(): this;
  notNull(): this;
  nullable(): this;
  default(value: unknown): this;
  references(table: string, column: string, opts?: FkOptions): this;
  /**
   * Column-level CHECK; `expression` is a trusted SQL predicate fragment.
   * Engine v1 does not allow subquery or aggregate constructs inside CHECK.
   */
  check(expression: string): this;
}

export interface TableBuilder {
  int(name: string): ColumnBuilder;
  float(name: string): ColumnBuilder;
  string(name: string): ColumnBuilder;
  boolean(name: string): ColumnBuilder;
  date(name: string): ColumnBuilder;
  uuid(name: string): ColumnBuilder;
  /**
   * Table-level named CHECK; `expression` is a trusted SQL predicate fragment.
   * Engine v1 does not allow subquery or aggregate constructs inside CHECK.
   */
  check(name: string, expression: string): this;
  /** Table-level composite PRIMARY KEY. */
  primaryKey(...columns: string[]): this;
  /** Table-level UNIQUE; pass `null` for an unnamed constraint. */
  unique(name: string | null, ...columns: string[]): this;
}

export interface AlterTableBuilder {
  addColumn(name: string, type: NoBugDbDataType, fn?: (col: ColumnBuilder) => void): void;
  dropColumn(name: string): void;
  renameColumn(from: string, to: string): void;
  renameTable(to: string): void;
  addPrimaryKey(...columns: string[]): void;
  dropPrimaryKey(): void;
  addUnique(...columns: string[]): void;
  dropUnique(...columns: string[]): void;
  setNotNull(column: string): void;
  dropNotNull(column: string): void;
  /**
   * Adds a named CHECK; `expression` is a trusted SQL predicate fragment.
   * Engine v1 does not allow subquery or aggregate constructs inside CHECK.
   */
  addCheck(name: string, expression: string): void;
  dropCheck(name: string): void;
}

export type PartitionStrategy = 'RANGE' | 'HASH';

export interface PartitionedTableOptions {
  strategy: PartitionStrategy;
  column: string;
}

export interface RangePartitionValues {
  from: unknown;
  to: unknown;
}

export interface HashPartitionValues {
  modulus: number;
  remainder: number;
}

export type TriggerTiming = 'BEFORE' | 'AFTER';
export type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export interface CreateTriggerOptions {
  timing: TriggerTiming;
  event: TriggerEvent;
  table: string;
  /** Trusted SQL body inside $$ ... $$. Do not nest `$$` (engine has no tagged dollars). */
  body: string;
}

export interface RoutineParam {
  name: string;
  type: NoBugDbDataType;
}

export type FunctionBodyStyle = 'dollar' | 'expr';

export interface CreateFunctionOptions {
  params: RoutineParam[];
  returns: NoBugDbDataType;
  /**
   * Trusted function body. Default style `'dollar'` → `AS $$ body $$`.
   * Style `'expr'` → `AS (body)`. Do not nest `$$`. No OUT/INOUT params.
   */
  body: string;
  /** default `'dollar'` */
  style?: FunctionBodyStyle;
}

export interface CreateProcedureOptions {
  params: RoutineParam[];
  /**
   * Trusted semicolon-separated statements inside `AS $$ … $$`.
   * No OUT/INOUT; no nested TX-`BEGIN` in body. Do not nest `$$`.
   */
  body: string;
}

export interface MigrationBuilder {
  createTable(name: string, fn: (t: TableBuilder) => void): Promise<void>;
  /**
   * Creates a partitioned parent table.
   * Engine v1: no SUBPARTITION; FK on parent is not supported.
   * Drop parent with {@link dropTable} cascades children; drop a child keeps the parent.
   */
  createPartitionedTable(
    name: string,
    options: PartitionedTableOptions,
    fn: (t: TableBuilder) => void,
  ): Promise<void>;
  /**
   * Creates a partition of a parent table (no column list — schema is inherited).
   * RANGE: `{ from, to }`; HASH: `{ modulus, remainder }`.
   * Drop with {@link dropTable}.
   */
  createPartition(
    name: string,
    parent: string,
    values: RangePartitionValues | HashPartitionValues,
  ): Promise<void>;
  dropTable(name: string): Promise<void>;
  alterTable(name: string, fn: (t: AlterTableBuilder) => void): Promise<void>;
  createIndex(name: string, table: string, columns: string[]): Promise<void>;
  dropIndex(name: string): Promise<void>;
  createView(name: string, sql: string): Promise<void>;
  dropView(name: string): Promise<void>;
  /**
   * Creates a row-level trigger: BEFORE|AFTER INSERT|UPDATE|DELETE FOR EACH ROW.
   * `SET NEW.col = expr` is valid only in BEFORE INSERT/UPDATE. No WHEN, INSTEAD OF,
   * or statement-level triggers. Recursion depth capped at 16. Requires admin role.
   */
  createTrigger(name: string, options: CreateTriggerOptions): Promise<void>;
  /**
   * Drops a trigger by name. Requires admin role.
   */
  dropTrigger(name: string): Promise<void>;
  /**
   * Creates a scalar UDF. IN params only; no OUT/INOUT or table-valued.
   * Requires admin. Name must not collide with a builtin (server error).
   */
  createFunction(name: string, options: CreateFunctionOptions): Promise<void>;
  /**
   * Drops a function by name. Requires admin role.
   */
  dropFunction(name: string): Promise<void>;
  /**
   * Creates a procedure (`AS $$ stmts $$`). IN params only; no nested TX-`BEGIN`.
   * Requires admin.
   */
  createProcedure(name: string, options: CreateProcedureOptions): Promise<void>;
  /**
   * Drops a procedure by name. Requires admin role.
   */
  dropProcedure(name: string): Promise<void>;
  /**
   * Executes `CALL name(args)`. Denied for reader role on the server.
   */
  call(name: string, args?: unknown[]): Promise<void>;
  raw(sql: string): Promise<void>;
}

export interface MigrationContext {
  query(sql: string): Promise<QueryResult>;
  schema: MigrationBuilder;
}

export interface MigrationModule {
  id: string;
  up(ctx: MigrationContext): Promise<void>;
  down(ctx: MigrationContext): Promise<void>;
}

export interface MigratorOptions {
  migrationsDir: string;
  historyTable?: string;
}

export interface MigrationStatusEntry {
  id: string;
  applied: boolean;
}
