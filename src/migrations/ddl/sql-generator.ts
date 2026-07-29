import type { CheckConstraintState } from './check-constraint.js';
import type { ColumnState } from './column-state.js';
import type {
  TableKeyConstraintState,
  TableUniqueConstraintState,
} from './table-constraint.js';
import {
  assertValidPartitionColumn,
  assertValidPartitionStrategy,
  assertValidPartitionValues,
  isHashPartitionValues,
} from './partition.js';
import {
  assertRoutineSqlFitsWire,
  assertValidFunctionReturns,
  assertValidFunctionStyle,
  assertValidRoutineBody,
  assertValidRoutineName,
  assertValidRoutineParams,
} from './routine.js';
import {
  assertTriggerSqlFitsWire,
  assertValidTriggerBody,
  assertValidTriggerEvent,
  assertValidTriggerName,
  assertValidTriggerTable,
  assertValidTriggerTiming,
} from './trigger.js';
import type {
  CreateFunctionOptions,
  CreateProcedureOptions,
  CreateTriggerOptions,
  FkReferentialAction,
  HashPartitionValues,
  PartitionedTableOptions,
  RangePartitionValues,
  RoutineParam,
} from '../types.js';
import { escapeLiteral, quoteIdent } from '../../query-builder/escape.js';

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
  if (col.checkExpression !== undefined) {
    parts.push(`CHECK (${col.checkExpression})`);
  }

  return parts.join(' ');
}

function renderTableCheck(check: CheckConstraintState): string {
  return `CONSTRAINT ${quoteIdent(check.name)} CHECK (${check.expression})`;
}

function renderQuotedColumnList(columns: readonly string[]): string {
  return columns.map((c) => quoteIdent(c)).join(', ');
}

function renderTablePrimaryKey(pk: TableKeyConstraintState): string {
  return `PRIMARY KEY (${renderQuotedColumnList(pk.columns)})`;
}

function renderTableUnique(uq: TableUniqueConstraintState): string {
  const body = `UNIQUE (${renderQuotedColumnList(uq.columns)})`;
  if (uq.name) {
    return `CONSTRAINT ${quoteIdent(uq.name)} ${body}`;
  }
  return body;
}

export interface CreateTableConstraints {
  checks?: readonly CheckConstraintState[];
  primaryKey?: TableKeyConstraintState | null;
  uniques?: readonly TableUniqueConstraintState[];
}

function renderTableBody(
  columns: ColumnState[],
  constraints: CreateTableConstraints = {},
): string {
  const parts = [
    ...columns.map((col) => renderColumnDefinition(col)),
    ...(constraints.checks ?? []).map((check) => renderTableCheck(check)),
  ];
  if (constraints.primaryKey) {
    parts.push(renderTablePrimaryKey(constraints.primaryKey));
  }
  for (const uq of constraints.uniques ?? []) {
    parts.push(renderTableUnique(uq));
  }
  return parts.join(', ');
}

export function generateCreateTableSql(
  tableName: string,
  columns: ColumnState[],
  checksOrConstraints: readonly CheckConstraintState[] | CreateTableConstraints = [],
): string {
  const constraints: CreateTableConstraints = Array.isArray(checksOrConstraints)
    ? { checks: checksOrConstraints as readonly CheckConstraintState[] }
    : (checksOrConstraints as CreateTableConstraints);
  return `CREATE TABLE ${quoteIdent(tableName)} (${renderTableBody(columns, constraints)})`;
}

export function generateCreatePartitionedTableSql(
  tableName: string,
  columns: ColumnState[],
  options: PartitionedTableOptions,
  checks: readonly CheckConstraintState[] = [],
): string {
  const strategy = assertValidPartitionStrategy(options.strategy);
  const column = assertValidPartitionColumn(options.column);
  const body = renderTableBody(columns, { checks });
  return `CREATE TABLE ${quoteIdent(tableName)} (${body}) PARTITION BY ${strategy} (${quoteIdent(column)})`;
}

export function generateCreatePartitionSql(
  name: string,
  parent: string,
  values: RangePartitionValues | HashPartitionValues,
): string {
  const validated = assertValidPartitionValues(values);
  const child = quoteIdent(name);
  const parentIdent = quoteIdent(parent);

  if (isHashPartitionValues(validated)) {
    return `CREATE TABLE ${child} PARTITION OF ${parentIdent} FOR VALUES WITH (MODULUS ${validated.modulus}, REMAINDER ${validated.remainder})`;
  }

  return `CREATE TABLE ${child} PARTITION OF ${parentIdent} FOR VALUES FROM (${escapeLiteral(validated.from)}) TO (${escapeLiteral(validated.to)})`;
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

export function generateAddPrimaryKeySql(
  tableName: string,
  ...columns: string[]
): string {
  if (columns.length === 0) {
    throw new Error('PRIMARY KEY requires at least one column');
  }
  return `ALTER TABLE ${quoteIdent(tableName)} ADD PRIMARY KEY (${columns.map((c) => quoteIdent(c)).join(', ')})`;
}

export function generateDropPrimaryKeySql(tableName: string): string {
  return `ALTER TABLE ${quoteIdent(tableName)} DROP PRIMARY KEY`;
}

export function generateAddUniqueSql(
  tableName: string,
  ...columns: string[]
): string {
  if (columns.length === 0) {
    throw new Error('UNIQUE requires at least one column');
  }
  return `ALTER TABLE ${quoteIdent(tableName)} ADD UNIQUE (${columns.map((c) => quoteIdent(c)).join(', ')})`;
}

export function generateDropUniqueSql(
  tableName: string,
  ...columns: string[]
): string {
  if (columns.length === 0) {
    throw new Error('UNIQUE requires at least one column');
  }
  return `ALTER TABLE ${quoteIdent(tableName)} DROP UNIQUE (${columns.map((c) => quoteIdent(c)).join(', ')})`;
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

export function generateAddCheckSql(
  tableName: string,
  name: string,
  expression: string,
): string {
  return `ALTER TABLE ${quoteIdent(tableName)} ADD CONSTRAINT ${quoteIdent(name)} CHECK (${expression})`;
}

export function generateDropCheckSql(tableName: string, name: string): string {
  return `ALTER TABLE ${quoteIdent(tableName)} DROP CHECK ${quoteIdent(name)}`;
}

export function generateCreateTriggerSql(
  name: string,
  options: CreateTriggerOptions,
): string {
  const triggerName = assertValidTriggerName(name);
  const timing = assertValidTriggerTiming(options.timing);
  const event = assertValidTriggerEvent(options.event);
  const table = assertValidTriggerTable(options.table);
  const body = assertValidTriggerBody(options.body);
  const sql =
    `CREATE TRIGGER ${quoteIdent(triggerName)} ${timing} ${event} ON ${quoteIdent(table)} ` +
    `FOR EACH ROW EXECUTE $$\n${body}\n$$;`;
  assertTriggerSqlFitsWire(sql);
  return sql;
}

export function generateDropTriggerSql(name: string): string {
  return `DROP TRIGGER ${quoteIdent(assertValidTriggerName(name))}`;
}

function renderRoutineParams(params: readonly RoutineParam[]): string {
  return params
    .map((param) => `${quoteIdent(param.name)} ${param.type}`)
    .join(', ');
}

export function generateCreateFunctionSql(
  name: string,
  options: CreateFunctionOptions,
): string {
  const fnName = assertValidRoutineName(name);
  const params = assertValidRoutineParams(options.params);
  const returns = assertValidFunctionReturns(options.returns);
  const body = assertValidRoutineBody(options.body);
  const style = assertValidFunctionStyle(options.style ?? 'dollar');
  const paramList = renderRoutineParams(params);
  const asClause =
    style === 'expr'
      ? `AS (${body})`
      : `AS $$\n${body}\n$$`;
  const sql =
    `CREATE FUNCTION ${quoteIdent(fnName)}(${paramList}) RETURNS ${returns} ${asClause};`;
  assertRoutineSqlFitsWire(sql);
  return sql;
}

export function generateDropFunctionSql(name: string): string {
  return `DROP FUNCTION ${quoteIdent(assertValidRoutineName(name))}`;
}

export function generateCreateProcedureSql(
  name: string,
  options: CreateProcedureOptions,
): string {
  const procName = assertValidRoutineName(name);
  const params = assertValidRoutineParams(options.params);
  const body = assertValidRoutineBody(options.body);
  const paramList = renderRoutineParams(params);
  const sql =
    `CREATE PROCEDURE ${quoteIdent(procName)}(${paramList}) AS $$\n${body}\n$$;`;
  assertRoutineSqlFitsWire(sql);
  return sql;
}

export function generateDropProcedureSql(name: string): string {
  return `DROP PROCEDURE ${quoteIdent(assertValidRoutineName(name))}`;
}

export function generateCallSql(name: string, args: unknown[] = []): string {
  const procName = assertValidRoutineName(name);
  const rendered = args.map((arg) => escapeLiteral(arg)).join(', ');
  const sql = `CALL ${quoteIdent(procName)}(${rendered})`;
  assertRoutineSqlFitsWire(sql);
  return sql;
}
