import { escapeLiteral, quoteIdent } from '../../query-builder/escape.js';
import type { ColumnState } from './column-state.js';
import type { FkReferentialAction } from '../types.js';

function formatReferentialAction(action: FkReferentialAction): string {
  return action.replace('_', ' ');
}

function renderColumnDefinition(col: ColumnState): string {
  const parts: string[] = [
    quoteIdent(col.name),
    col.type,
  ];

  if (col.primary) {
    parts.push('PRIMARY KEY');
  }
  if (col.unique) {
    parts.push('UNIQUE');
  }
  if (col.notNull) {
    parts.push('NOT NULL');
  }
  if (col.defaultValue !== undefined) {
    parts.push(`DEFAULT ${escapeLiteral(col.defaultValue, col.type)}`);
  }
  if (col.references) {
    let ref = `REFERENCES ${quoteIdent(col.references.table)}(${quoteIdent(col.references.column)})`;
    if (col.references.onDelete) {
      ref += ` ON DELETE ${formatReferentialAction(col.references.onDelete)}`;
    }
    if (col.references.onUpdate) {
      ref += ` ON UPDATE ${formatReferentialAction(col.references.onUpdate)}`;
    }
    parts.push(ref);
  }

  return parts.join(' ');
}

export function generateCreateTableSql(tableName: string, columns: ColumnState[]): string {
  const defs = columns.map((col) => renderColumnDefinition(col)).join(', ');
  return `CREATE TABLE ${quoteIdent(tableName)} (${defs})`;
}

export function generateDropTableSql(tableName: string): string {
  return `DROP TABLE ${quoteIdent(tableName)}`;
}

export function generateAddColumnSql(
  tableName: string,
  column: ColumnState,
): string {
  return `ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${renderColumnDefinition(column)}`;
}

export function generateDropColumnSql(tableName: string, columnName: string): string {
  return `ALTER TABLE ${quoteIdent(tableName)} DROP COLUMN ${quoteIdent(columnName)}`;
}

export function generateRenameColumnSql(
  tableName: string,
  from: string,
  to: string,
): string {
  return `ALTER TABLE ${quoteIdent(tableName)} RENAME COLUMN ${quoteIdent(from)} TO ${quoteIdent(to)}`;
}

export function generateRenameTableSql(tableName: string, to: string): string {
  return `ALTER TABLE ${quoteIdent(tableName)} RENAME TO ${quoteIdent(to)}`;
}

export function generateAddPrimaryKeySql(tableName: string, column: string): string {
  return `ALTER TABLE ${quoteIdent(tableName)} ADD PRIMARY KEY (${quoteIdent(column)})`;
}

export function generateDropPrimaryKeySql(tableName: string): string {
  return `ALTER TABLE ${quoteIdent(tableName)} DROP PRIMARY KEY`;
}

export function generateAddUniqueSql(tableName: string, column: string): string {
  return `ALTER TABLE ${quoteIdent(tableName)} ADD UNIQUE (${quoteIdent(column)})`;
}

export function generateDropUniqueSql(tableName: string, column: string): string {
  return `ALTER TABLE ${quoteIdent(tableName)} DROP UNIQUE (${quoteIdent(column)})`;
}

export function generateSetNotNullSql(tableName: string, column: string): string {
  return `ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN ${quoteIdent(column)} SET NOT NULL`;
}

export function generateDropNotNullSql(tableName: string, column: string): string {
  return `ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN ${quoteIdent(column)} DROP NOT NULL`;
}

export function generateCreateIndexSql(
  indexName: string,
  tableName: string,
  columns: string[],
): string {
  const cols = columns.map((c) => quoteIdent(c)).join(', ');
  return `CREATE INDEX ${quoteIdent(indexName)} ON ${quoteIdent(tableName)} (${cols})`;
}

export function generateDropIndexSql(indexName: string): string {
  return `DROP INDEX ${quoteIdent(indexName)}`;
}

export function generateCreateViewSql(viewName: string, sql: string): string {
  return `CREATE VIEW ${quoteIdent(viewName)} AS ${sql}`;
}

export function generateDropViewSql(viewName: string): string {
  return `DROP VIEW ${quoteIdent(viewName)}`;
}
