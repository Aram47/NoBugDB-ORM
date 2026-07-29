import type { NoBugDbDataType } from '../../types/type-mapper.js';
import type { ColumnBuilder, FkOptions, TableBuilder } from '../types.js';
import {
  assertValidCheckExpression,
  assertValidCheckName,
  type CheckConstraintState,
} from './check-constraint.js';
import { createColumnState, type ColumnState } from './column-state.js';
import type {
  TableKeyConstraintState,
  TableUniqueConstraintState,
} from './table-constraint.js';

export class ColumnBuilderImpl implements ColumnBuilder {
  readonly #column: ColumnState;

  constructor(column: ColumnState) {
    this.#column = column;
  }

  primary(): this {
    this.#column.primary = true;
    return this;
  }

  unique(): this {
    this.#column.unique = true;
    return this;
  }

  notNull(): this {
    this.#column.notNull = true;
    return this;
  }

  nullable(): this {
    this.#column.notNull = false;
    return this;
  }

  default(value: unknown): this {
    this.#column.defaultValue = value;
    return this;
  }

  references(table: string, column: string, opts?: FkOptions): this {
    this.#column.references = {
      table,
      column,
      ...(opts?.onDelete !== undefined ? { onDelete: opts.onDelete } : {}),
      ...(opts?.onUpdate !== undefined ? { onUpdate: opts.onUpdate } : {}),
    };
    return this;
  }

  check(expression: string): this {
    this.#column.checkExpression = assertValidCheckExpression(expression);
    return this;
  }
}

function assertNonEmptyColumns(columns: string[], kind: string): string[] {
  const cleaned = columns.map((c) => c.trim()).filter((c) => c.length > 0);
  if (cleaned.length === 0) {
    throw new Error(`${kind} requires at least one column`);
  }
  return cleaned;
}

export class TableBuilderImpl implements TableBuilder {
  readonly #columns: ColumnState[] = [];
  readonly #checks: CheckConstraintState[] = [];
  #primaryKey: TableKeyConstraintState | null = null;
  readonly #uniques: TableUniqueConstraintState[] = [];

  addColumn(name: string, type: NoBugDbDataType): ColumnBuilder {
    const col = createColumnState(name, type);
    this.#columns.push(col);
    return new ColumnBuilderImpl(col);
  }

  int(name: string): ColumnBuilder {
    return this.addColumn(name, 'INT');
  }

  float(name: string): ColumnBuilder {
    return this.addColumn(name, 'FLOAT');
  }

  string(name: string): ColumnBuilder {
    return this.addColumn(name, 'STRING');
  }

  boolean(name: string): ColumnBuilder {
    return this.addColumn(name, 'BOOLEAN');
  }

  date(name: string): ColumnBuilder {
    return this.addColumn(name, 'DATE');
  }

  uuid(name: string): ColumnBuilder {
    return this.addColumn(name, 'UUID');
  }

  check(name: string, expression: string): this {
    this.#checks.push({
      name: assertValidCheckName(name),
      expression: assertValidCheckExpression(expression),
    });
    return this;
  }

  primaryKey(...columns: string[]): this {
    if (this.#primaryKey !== null) {
      throw new Error('PRIMARY KEY already defined on this table');
    }
    this.#primaryKey = { columns: assertNonEmptyColumns(columns, 'PRIMARY KEY') };
    return this;
  }

  unique(name: string | null, ...columns: string[]): this {
    this.#uniques.push({
      name: name === null || name === '' ? null : assertValidCheckName(name),
      columns: assertNonEmptyColumns(columns, 'UNIQUE'),
    });
    return this;
  }

  getColumns(): ColumnState[] {
    return this.#columns;
  }

  getChecks(): CheckConstraintState[] {
    return this.#checks;
  }

  getPrimaryKey(): TableKeyConstraintState | null {
    return this.#primaryKey;
  }

  getUniques(): TableUniqueConstraintState[] {
    return this.#uniques;
  }
}

export function buildColumn(
  name: string,
  type: NoBugDbDataType,
  fn?: (col: ColumnBuilder) => void,
): ColumnState {
  const builder = new TableBuilderImpl();
  const colBuilder = builder.addColumn(name, type);
  if (fn) {
    fn(colBuilder);
  }
  return builder.getColumns()[0]!;
}
