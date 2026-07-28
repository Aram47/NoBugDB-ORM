import type { NoBugDbDataType } from '../../types/type-mapper.js';
import type { AlterTableBuilder, ColumnBuilder } from '../types.js';
import {
  generateAddColumnSql,
  generateAddPrimaryKeySql,
  generateAddUniqueSql,
  generateDropColumnSql,
  generateDropNotNullSql,
  generateDropPrimaryKeySql,
  generateDropUniqueSql,
  generateRenameColumnSql,
  generateRenameTableSql,
  generateSetNotNullSql,
} from './sql-generator.js';
import { TableBuilderImpl } from './table-builder.js';

export class AlterTableBuilderImpl implements AlterTableBuilder {
  readonly #tableName: string;
  readonly #statements: string[] = [];

  constructor(tableName: string) {
    this.#tableName = tableName;
  }

  addColumn(name: string, type: NoBugDbDataType, fn?: (col: ColumnBuilder) => void): void {
    const builder = new TableBuilderImpl();
    const colBuilder = builder.addColumn(name, type);
    if (fn) {
      fn(colBuilder);
    }
    const column = builder.getColumns()[0]!;
    this.#statements.push(generateAddColumnSql(this.#tableName, column));
  }

  dropColumn(name: string): void {
    this.#statements.push(generateDropColumnSql(this.#tableName, name));
  }

  renameColumn(from: string, to: string): void {
    this.#statements.push(generateRenameColumnSql(this.#tableName, from, to));
  }

  renameTable(to: string): void {
    this.#statements.push(generateRenameTableSql(this.#tableName, to));
  }

  addPrimaryKey(column: string): void {
    this.#statements.push(generateAddPrimaryKeySql(this.#tableName, column));
  }

  dropPrimaryKey(): void {
    this.#statements.push(generateDropPrimaryKeySql(this.#tableName));
  }

  addUnique(column: string): void {
    this.#statements.push(generateAddUniqueSql(this.#tableName, column));
  }

  dropUnique(column: string): void {
    this.#statements.push(generateDropUniqueSql(this.#tableName, column));
  }

  setNotNull(column: string): void {
    this.#statements.push(generateSetNotNullSql(this.#tableName, column));
  }

  dropNotNull(column: string): void {
    this.#statements.push(generateDropNotNullSql(this.#tableName, column));
  }

  getStatements(): string[] {
    return this.#statements;
  }
}
