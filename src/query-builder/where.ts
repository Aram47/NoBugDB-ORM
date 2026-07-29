import { NoBugDbError } from '../driver/errors.js';
import type {
  TypeMapper} from '../types/type-mapper.js';
import {
  defaultTypeMapper,
  type NoBugDbDataType,
} from '../types/type-mapper.js';
import {
  assertSupportedSqlFragment,
  escapeLiteral,
  quoteQualifiedIdent,
} from './escape.js';
import { isSqlExpression } from './sql-fragments.js';
import type { SubquerySource } from './subquery.js';

export type { SubquerySource } from './subquery.js';

export type WhereComparisonOp =
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>='
  | 'in'
  | 'between'
  | 'isNull'
  | 'isNotNull';

export interface WhereCondition {
  col: string;
  op: WhereComparisonOp;
  value?: unknown;
}

export interface WhereAnd {
  and: WhereInput[];
}

export interface WhereOr {
  or: WhereInput[];
}

export interface WhereNot {
  not: WhereInput;
}

export interface WhereInSubquery {
  col: string;
  inSubquery: SubquerySource;
}

export interface WhereNotInSubquery {
  col: string;
  notInSubquery: SubquerySource;
}

export interface WhereExists {
  exists: SubquerySource;
}

export interface WhereNotExists {
  notExists: SubquerySource;
}

export type WhereInput =
  | WhereCondition
  | WhereAnd
  | WhereOr
  | WhereNot
  | WhereInSubquery
  | WhereNotInSubquery
  | WhereExists
  | WhereNotExists
  | Record<string, unknown>;

export interface CompiledWhere {
  sql: string;
  params: unknown[];
  paramTypes: (NoBugDbDataType | undefined)[];
}

export interface WhereCompileOptions {
  mapper?: TypeMapper;
  columnTypes?: Record<string, NoBugDbDataType>;
  usePlaceholders?: boolean;
}

function isWhereCondition(input: WhereInput): input is WhereCondition {
  return (
    typeof input === 'object' &&
    input !== null &&
    'col' in input &&
    'op' in input
  );
}

function isWhereAnd(input: WhereInput): input is WhereAnd {
  return typeof input === 'object' && input !== null && 'and' in input;
}

function isWhereOr(input: WhereInput): input is WhereOr {
  return typeof input === 'object' && input !== null && 'or' in input;
}

function isWhereNot(input: WhereInput): input is WhereNot {
  return typeof input === 'object' && input !== null && 'not' in input;
}

function isWhereInSubquery(input: WhereInput): input is WhereInSubquery {
  return (
    typeof input === 'object' &&
    input !== null &&
    'col' in input &&
    'inSubquery' in input
  );
}

function isWhereNotInSubquery(input: WhereInput): input is WhereNotInSubquery {
  return (
    typeof input === 'object' &&
    input !== null &&
    'col' in input &&
    'notInSubquery' in input
  );
}

function isWhereExists(input: WhereInput): input is WhereExists {
  return typeof input === 'object' && input !== null && 'exists' in input;
}

function isWhereNotExists(input: WhereInput): input is WhereNotExists {
  return typeof input === 'object' && input !== null && 'notExists' in input;
}

function isRecordWhere(
  input: WhereInput,
): input is Record<string, unknown> {
  return (
    typeof input === 'object' &&
    input !== null &&
    !isWhereCondition(input) &&
    !isWhereAnd(input) &&
    !isWhereOr(input) &&
    !isWhereNot(input) &&
    !isWhereInSubquery(input) &&
    !isWhereNotInSubquery(input) &&
    !isWhereExists(input) &&
    !isWhereNotExists(input)
  );
}

function recordToConditions(record: Record<string, unknown>): WhereInput[] {
  return Object.entries(record).map(([col, value]) => {
    if (value === null) {
      return { col, op: 'isNull' as const };
    }
    return { col, op: '=' as const, value };
  });
}

function renderValue(
  value: unknown,
  col: string,
  options: WhereCompileOptions,
  params: unknown[],
  paramTypes: (NoBugDbDataType | undefined)[],
): string {
  if (isSqlExpression(value)) {
    return value.text;
  }

  const mapper = options.mapper ?? defaultTypeMapper;
  const type = options.columnTypes?.[col];

  if (options.usePlaceholders) {
    params.push(value);
    paramTypes.push(type);
    return `$${params.length}`;
  }

  return escapeLiteral(value, type, mapper);
}

function compileCondition(
  condition: WhereCondition,
  options: WhereCompileOptions,
  params: unknown[],
  paramTypes: (NoBugDbDataType | undefined)[],
): string {
  const col = quoteQualifiedIdent(condition.col);

  switch (condition.op) {
    case 'isNull':
      return `${col} IS NULL`;
    case 'isNotNull':
      return `${col} IS NOT NULL`;
    case 'in': {
      if (!Array.isArray(condition.value)) {
        throw new NoBugDbError(
          'TYPE_MISMATCH',
          'IN operator requires an array value',
        );
      }
      if (condition.value.length === 0) {
        throw new NoBugDbError(
          'UNSUPPORTED_SQL',
          'IN operator requires at least one value',
        );
      }
      const values = condition.value.map((v) =>
        renderValue(v, condition.col, options, params, paramTypes),
      );
      return `${col} IN (${values.join(', ')})`;
    }
    case 'between': {
      if (
        !Array.isArray(condition.value) ||
        condition.value.length !== 2
      ) {
        throw new NoBugDbError(
          'TYPE_MISMATCH',
          'BETWEEN operator requires a two-element array',
        );
      }
      const [low, high] = condition.value;
      return `${col} BETWEEN ${renderValue(low, condition.col, options, params, paramTypes)} AND ${renderValue(high, condition.col, options, params, paramTypes)}`;
    }
    default:
      return `${col} ${condition.op} ${renderValue(condition.value, condition.col, options, params, paramTypes)}`;
  }
}

function compileWhereInput(
  input: WhereInput,
  options: WhereCompileOptions,
  params: unknown[],
  paramTypes: (NoBugDbDataType | undefined)[],
): string {
  if (isWhereAnd(input)) {
    if (input.and.length === 0) {
      throw new NoBugDbError('UNSUPPORTED_SQL', 'AND group cannot be empty');
    }
    const parts = input.and.map((child) =>
      compileWhereInput(child, options, params, paramTypes),
    );
    return parts.length === 1 ? parts[0]! : `(${parts.join(' AND ')})`;
  }

  if (isWhereOr(input)) {
    if (input.or.length === 0) {
      throw new NoBugDbError('UNSUPPORTED_SQL', 'OR group cannot be empty');
    }
    const parts = input.or.map((child) =>
      compileWhereInput(child, options, params, paramTypes),
    );
    return parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`;
  }

  if (isWhereNot(input)) {
    return `NOT (${compileWhereInput(input.not, options, params, paramTypes)})`;
  }

  if (isWhereExists(input)) {
    return `EXISTS ${input.exists.toSubquerySql()}`;
  }

  if (isWhereNotExists(input)) {
    return `NOT EXISTS ${input.notExists.toSubquerySql()}`;
  }

  if (isWhereInSubquery(input)) {
    return `${quoteQualifiedIdent(input.col)} IN ${input.inSubquery.toSubquerySql()}`;
  }

  if (isWhereNotInSubquery(input)) {
    return `${quoteQualifiedIdent(input.col)} NOT IN ${input.notInSubquery.toSubquerySql()}`;
  }

  if (isRecordWhere(input)) {
    const conditions = recordToConditions(input);
    if (conditions.length === 0) {
      throw new NoBugDbError('UNSUPPORTED_SQL', 'WHERE record cannot be empty');
    }
    if (conditions.length === 1) {
      return compileWhereInput(conditions[0]!, options, params, paramTypes);
    }
    return compileWhereInput({ and: conditions }, options, params, paramTypes);
  }

  if (isWhereCondition(input)) {
    return compileCondition(input, options, params, paramTypes);
  }

  throw new NoBugDbError('UNSUPPORTED_SQL', 'Invalid WHERE input');
}

export function compileWhere(
  input: WhereInput,
  options: WhereCompileOptions = {},
): CompiledWhere {
  const params: unknown[] = [];
  const paramTypes: (NoBugDbDataType | undefined)[] = [];
  const sql = compileWhereInput(input, options, params, paramTypes);
  assertSupportedSqlFragment(sql);
  return { sql, params, paramTypes };
}

export function mergeWhere(
  existing: WhereInput | undefined,
  clause: WhereInput,
  combiner: 'and' | 'or',
): WhereInput {
  if (existing === undefined) {
    return clause;
  }
  return combiner === 'and'
    ? { and: [existing, clause] }
    : { or: [existing, clause] };
}
