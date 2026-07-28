import { assertSupportedSqlFragment } from './escape.js';

const SQL_RAW = Symbol('sql.raw');

export interface SqlRaw {
  readonly [SQL_RAW]: true;
  readonly text: string;
}

export interface SqlExpression {
  readonly text: string;
}

function expression(text: string): SqlExpression {
  assertSupportedSqlFragment(text);
  return { text };
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

  sum(column: string): SqlExpression {
    return expression(`SUM(${column})`);
  },

  avg(column: string): SqlExpression {
    return expression(`AVG(${column})`);
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
};

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
    typeof (value as SqlExpression).text === 'string'
  );
}

export function columnToSql(column: string | SqlExpression | SqlRaw): string {
  if (isSqlRaw(column)) {
    return column.text;
  }
  if (isSqlExpression(column)) {
    return column.text;
  }
  return column;
}
