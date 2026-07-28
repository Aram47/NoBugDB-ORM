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
}

export interface TableBuilder {
  int(name: string): ColumnBuilder;
  float(name: string): ColumnBuilder;
  string(name: string): ColumnBuilder;
  boolean(name: string): ColumnBuilder;
  date(name: string): ColumnBuilder;
  uuid(name: string): ColumnBuilder;
}

export interface AlterTableBuilder {
  addColumn(name: string, type: NoBugDbDataType, fn?: (col: ColumnBuilder) => void): void;
  dropColumn(name: string): void;
  renameColumn(from: string, to: string): void;
  renameTable(to: string): void;
  addPrimaryKey(column: string): void;
  dropPrimaryKey(): void;
  addUnique(column: string): void;
  dropUnique(column: string): void;
  setNotNull(column: string): void;
  dropNotNull(column: string): void;
}

export interface MigrationBuilder {
  createTable(name: string, fn: (t: TableBuilder) => void): Promise<void>;
  dropTable(name: string): Promise<void>;
  alterTable(name: string, fn: (t: AlterTableBuilder) => void): Promise<void>;
  createIndex(name: string, table: string, columns: string[]): Promise<void>;
  dropIndex(name: string): Promise<void>;
  createView(name: string, sql: string): Promise<void>;
  dropView(name: string): Promise<void>;
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
