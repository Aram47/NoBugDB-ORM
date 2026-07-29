import { NoBugDbError } from '../driver/errors.js';
import type { NoBugDbDataType } from '../types/type-mapper.js';
import {
  assertSupportedSqlFragment,
  assertValidIdentifier,
  escapeLiteral,
  quoteIdent,
  quoteQualifiedIdent,
} from './escape.js';
import type { SubquerySource } from './subquery.js';

const SQL_RAW = Symbol('sql.raw');

const CAST_TYPES = new Set<NoBugDbDataType>([
  'INT',
  'FLOAT',
  'STRING',
  'BOOLEAN',
  'DATE',
  'UUID',
]);

export interface SqlRaw {
  readonly [SQL_RAW]: true;
  readonly text: string;
}

/**
 * Window OVER clause for engine-supported window functions.
 *
 * Engine v1 requires non-empty `orderBy`. Columns referenced in OVER should
 * also appear in the SELECT list (engine resolve rule).
 *
 * Supported functions only: ROW_NUMBER, RANK, DENSE_RANK, and running SUM/AVG.
 * No LEAD/LAG/NTILE, named WINDOW, or explicit ROWS/RANGE frame.
 */
export interface OverSpec {
  partitionBy?: Array<string | SqlExpression>;
  orderBy: Array<
    | string
    | SqlExpression
    | { column: string | SqlExpression; direction?: 'ASC' | 'DESC' }
  >;
}

/**
 * Typed SQL expression fragment for SELECT lists and similar positions.
 *
 * Chain `.over(spec)` for window functions (ORDER BY required).
 * Chain `.as(alias)` for a column alias.
 */
export interface SqlExpression {
  readonly text: string;
  over(spec: OverSpec): SqlExpression;
  as(alias: string): SqlExpression;
}

type OverOrderItem =
  | string
  | SqlExpression
  | { column: string | SqlExpression; direction?: 'ASC' | 'DESC' };

function isOrderByObject(
  item: OverOrderItem,
): item is { column: string | SqlExpression; direction?: 'ASC' | 'DESC' } {
  return typeof item === 'object' && item !== null && 'column' in item;
}

function renderOverExpr(item: string | SqlExpression): string {
  if (typeof item === 'string') {
    return quoteQualifiedIdent(item);
  }
  return item.text;
}

function renderOrderItem(item: OverOrderItem): string {
  if (isOrderByObject(item)) {
    const column = renderOverExpr(item.column);
    return item.direction !== undefined
      ? `${column} ${item.direction}`
      : column;
  }
  return renderOverExpr(item);
}

function renderOverClause(spec: OverSpec): string {
  if (spec.orderBy.length === 0) {
    throw new NoBugDbError('UNSUPPORTED_SQL', 'OVER requires ORDER BY');
  }

  const parts: string[] = [];
  if (spec.partitionBy !== undefined && spec.partitionBy.length > 0) {
    parts.push(
      `PARTITION BY ${spec.partitionBy.map(renderOverExpr).join(', ')}`,
    );
  }
  parts.push(`ORDER BY ${spec.orderBy.map(renderOrderItem).join(', ')}`);
  return parts.join(' ');
}

function columnArg(column: string | SqlExpression): string {
  return typeof column === 'string' ? column : column.text;
}

function expression(text: string): SqlExpression {
  assertSupportedSqlFragment(text);
  return {
    text,
    over(spec: OverSpec): SqlExpression {
      return expression(`${text} OVER (${renderOverClause(spec)})`);
    },
    as(alias: string): SqlExpression {
      return expression(`${text} AS ${quoteIdent(alias)}`);
    },
  };
}

export function isSqlRaw(value: unknown): value is SqlRaw {
  return (
    typeof value === 'object' &&
    value !== null &&
    SQL_RAW in value &&
    (value as SqlRaw)[SQL_RAW] === true
  );
}

export function isSqlExpression(value: unknown): value is SqlExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    typeof (value as SqlExpression).text === 'string' &&
    typeof (value as SqlExpression).over === 'function' &&
    typeof (value as SqlExpression).as === 'function'
  );
}

type ScalarArg = string | SqlExpression | SqlRaw | unknown;

function renderScalarArg(value: ScalarArg): string {
  if (isSqlRaw(value) || isSqlExpression(value)) {
    return value.text;
  }
  if (typeof value === 'string') {
    return value;
  }
  return escapeLiteral(value);
}

function assertCastType(type: string): asserts type is NoBugDbDataType {
  if (!CAST_TYPES.has(type as NoBugDbDataType)) {
    throw new NoBugDbError(
      'TYPE_MISMATCH',
      `Invalid CAST type: ${type}. Expected INT, FLOAT, STRING, BOOLEAN, DATE, or UUID`,
    );
  }
}

export const sql = {
  /**
   * Dangerous escape hatch for trusted SQL fragments only.
   * Never pass user-controlled input here.
   */
  raw(text: string): SqlRaw {
    assertSupportedSqlFragment(text);
    return { [SQL_RAW]: true, text };
  },

  count(column = '*'): SqlExpression {
    return expression(`COUNT(${column})`);
  },

  sum(column: string | SqlExpression): SqlExpression {
    return expression(`SUM(${columnArg(column)})`);
  },

  avg(column: string | SqlExpression): SqlExpression {
    return expression(`AVG(${columnArg(column)})`);
  },

  min(column: string): SqlExpression {
    return expression(`MIN(${column})`);
  },

  max(column: string): SqlExpression {
    return expression(`MAX(${column})`);
  },

  upper(column: string): SqlExpression {
    return expression(`UPPER(${column})`);
  },

  lower(column: string): SqlExpression {
    return expression(`LOWER(${column})`);
  },

  length(column: string): SqlExpression {
    return expression(`LENGTH(${column})`);
  },

  coalesce(...args: ScalarArg[]): SqlExpression {
    if (args.length === 0) {
      throw new NoBugDbError(
        'UNSUPPORTED_SQL',
        'COALESCE requires at least one argument',
      );
    }
    return expression(`COALESCE(${args.map(renderScalarArg).join(', ')})`);
  },

  nullif(
    a: string | SqlExpression | SqlRaw,
    b: string | SqlExpression | SqlRaw | unknown,
  ): SqlExpression {
    return expression(`NULLIF(${renderScalarArg(a)}, ${renderScalarArg(b)})`);
  },

  substring(
    source: string | SqlExpression | SqlRaw,
    start: number | SqlExpression,
    length?: number | SqlExpression,
  ): SqlExpression {
    const sourceSql = renderScalarArg(source);
    const startSql = renderScalarArg(start);
    if (length === undefined) {
      return expression(`SUBSTRING(${sourceSql}, ${startSql})`);
    }
    return expression(
      `SUBSTRING(${sourceSql}, ${startSql}, ${renderScalarArg(length)})`,
    );
  },

  cast(
    expr: string | SqlExpression | SqlRaw,
    type: NoBugDbDataType,
  ): SqlExpression {
    assertCastType(type);
    return expression(`CAST(${renderScalarArg(expr)} AS ${type})`);
  },

  currentDate(): SqlExpression {
    return expression('CURRENT_DATE');
  },

  /**
   * Generic function call for builtins/UDF; identifiers validated.
   */
  fn(
    name: string,
    ...args: Array<string | SqlExpression | SqlRaw | unknown>
  ): SqlExpression {
    assertValidIdentifier(name);
    if (args.length === 0) {
      return expression(`${name}()`);
    }
    return expression(`${name}(${args.map(renderScalarArg).join(', ')})`);
  },

  /**
   * ROW_NUMBER() — chain `.over({ orderBy })` (ORDER BY required by engine).
   * Columns in OVER should appear in the SELECT list.
   */
  rowNumber(): SqlExpression {
    return expression('ROW_NUMBER()');
  },

  /**
   * RANK() — chain `.over({ orderBy })` (ORDER BY required by engine).
   * Columns in OVER should appear in the SELECT list.
   */
  rank(): SqlExpression {
    return expression('RANK()');
  },

  /**
   * DENSE_RANK() — chain `.over({ orderBy })` (ORDER BY required by engine).
   * Columns in OVER should appear in the SELECT list.
   */
  denseRank(): SqlExpression {
    return expression('DENSE_RANK()');
  },

  /**
   * Scalar subquery for SELECT/expression positions.
   * Inner must be a plain SELECT (no set operations).
   * Chain `.as(alias)` for a column alias.
   */
  subquery(source: SubquerySource): SqlExpression {
    return expression(source.toSubquerySql());
  },

  /**
   * Qualified column reference (e.g. outer correlation `u.id`).
   * Renders as an identifier, not a string literal.
   */
  ref(qualified: string): SqlExpression {
    return expression(quoteQualifiedIdent(qualified));
  },
};

export function columnToSql(column: string | SqlExpression | SqlRaw): string {
  if (isSqlRaw(column)) {
    return column.text;
  }
  if (isSqlExpression(column)) {
    return column.text;
  }
  return column;
}
