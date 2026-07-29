import { NoBugDbError } from '../driver/errors.js';
import {
  DEFAULT_MAX_REQUEST_BYTES,
  type QueryResult,
} from '../driver/types.js';
import type { ExplainResult } from './types.js';

const EXPLAIN_PREFIX = /^EXPLAIN\b/i;

/**
 * Fail-fast if the encoded QUERY frame would exceed the wire buffer (default 1 MiB).
 */
export function assertAdminSqlFitsWire(
  sql: string,
  maxRequestBytes: number = DEFAULT_MAX_REQUEST_BYTES,
): void {
  const size = Buffer.byteLength(`QUERY|${sql}\n`, 'utf8');
  if (size > maxRequestBytes) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      `Admin SQL request is ${size} bytes; max is ${maxRequestBytes}`,
    );
  }
}

export function assertNonEmptySql(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    throw new NoBugDbError('UNSUPPORTED_SQL', 'EXPLAIN SQL cannot be empty');
  }
  return trimmed;
}

/**
 * Build `EXPLAIN <statement>` without double-prefixing.
 * Nested EXPLAIN is rejected by the NoBugDB parser.
 */
export function generateExplainSql(sql: string): string {
  const trimmed = assertNonEmptySql(sql);
  const out = EXPLAIN_PREFIX.test(trimmed) ? trimmed : `EXPLAIN ${trimmed}`;
  assertAdminSqlFitsWire(out);
  return out;
}

/**
 * Map an EXPLAIN QueryResult into plan lines from the QUERY PLAN column.
 */
export function toExplainResult(raw: QueryResult): ExplainResult {
  const idx = raw.columns.indexOf('QUERY PLAN');
  const col = idx >= 0 ? idx : 0;
  const plan = raw.rows.map((row) => row[col] ?? '');
  return { plan, raw };
}
