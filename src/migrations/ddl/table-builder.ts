import type { NoBugDbDataType } from '../../types/type-mapper.js';
import type { ColumnBuilder, FkOptions, TableBuilder } from '../types.js';
import { createColumnState, type ColumnState } from './column-state.js';

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
}

export class TableBuilderImpl implements TableBuilder {
  readonly #columns: ColumnState[] = [];

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

  getColumns(): ColumnState[] {
    return this.#columns;
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
