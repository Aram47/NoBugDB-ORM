import type { NoBugDbDataType } from '../../types/type-mapper.js';
import type { AlterTableBuilder, ColumnBuilder } from '../types.js';
import {
  assertValidCheckExpression,
  assertValidCheckName,
} from './check-constraint.js';
import {
  generateAddCheckSql,
  generateAddColumnSql,
  generateAddPrimaryKeySql,
  generateAddUniqueSql,
  generateDropCheckSql,
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

  addPrimaryKey(...columns: string[]): void {
    this.#statements.push(generateAddPrimaryKeySql(this.#tableName, ...columns));
  }

  dropPrimaryKey(): void {
    this.#statements.push(generateDropPrimaryKeySql(this.#tableName));
  }

  addUnique(...columns: string[]): void {
    this.#statements.push(generateAddUniqueSql(this.#tableName, ...columns));
  }

  dropUnique(...columns: string[]): void {
    this.#statements.push(generateDropUniqueSql(this.#tableName, ...columns));
  }

  setNotNull(column: string): void {
    this.#statements.push(generateSetNotNullSql(this.#tableName, column));
  }

  dropNotNull(column: string): void {
    this.#statements.push(generateDropNotNullSql(this.#tableName, column));
  }

  addCheck(name: string, expression: string): void {
    const validName = assertValidCheckName(name);
    const validExpr = assertValidCheckExpression(expression);
    this.#statements.push(generateAddCheckSql(this.#tableName, validName, validExpr));
  }

  dropCheck(name: string): void {
    const validName = assertValidCheckName(name);
    this.#statements.push(generateDropCheckSql(this.#tableName, validName));
  }

  getStatements(): string[] {
    return this.#statements;
  }
}
