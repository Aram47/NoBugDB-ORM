import { describe, expect, it } from 'vitest';
import {
  assertAdminSqlFitsWire,
  generateExplainSql,
  generateVacuumSql,
  toExplainResult,
} from '../../../src/admin/index.js';
import { NoBugDbError } from '../../../src/driver/errors.js';
import { DEFAULT_MAX_REQUEST_BYTES } from '../../../src/driver/types.js';
import type { QueryResult } from '../../../src/driver/types.js';

describe('admin explain SQL', () => {
  it('prefixes SELECT with EXPLAIN', () => {
    expect(generateExplainSql('SELECT 1')).toBe('EXPLAIN SELECT 1');
  });

  it('does not double-prefix already EXPLAIN SQL', () => {
    expect(generateExplainSql('EXPLAIN SELECT 1')).toBe('EXPLAIN SELECT 1');
    expect(generateExplainSql('explain SELECT 1')).toBe('explain SELECT 1');
    expect(generateExplainSql('  ExPlAiN SELECT 1  ')).toBe('ExPlAiN SELECT 1');
  });

  it('rejects empty or whitespace SQL', () => {
    expect(() => generateExplainSql('')).toThrow(NoBugDbError);
    expect(() => generateExplainSql('   ')).toThrow(NoBugDbError);
    try {
      generateExplainSql('');
    } catch (err) {
      expect(err).toBeInstanceOf(NoBugDbError);
      expect((err as NoBugDbError).code).toBe('UNSUPPORTED_SQL');
    }
  });

  it('rejects oversized EXPLAIN body', () => {
    const huge = `SELECT '${'x'.repeat(DEFAULT_MAX_REQUEST_BYTES)}'`;
    expect(() => generateExplainSql(huge)).toThrow(NoBugDbError);
  });
});

describe('toExplainResult', () => {
  it('maps QUERY PLAN column lines', () => {
    const raw: QueryResult = {
      success: true,
      message: 'EXPLAIN OK',
      columns: ['QUERY PLAN'],
      rows: [['SeqScan(users)'], ['Filter: id = 1']],
    };
    const result = toExplainResult(raw);
    expect(result.plan).toEqual(['SeqScan(users)', 'Filter: id = 1']);
    expect(result.raw).toBe(raw);
  });

  it('falls back to column 0 when QUERY PLAN is missing', () => {
    const raw: QueryResult = {
      success: true,
      message: 'EXPLAIN OK',
      columns: ['plan'],
      rows: [['HashJoin']],
    };
    expect(toExplainResult(raw).plan).toEqual(['HashJoin']);
  });
});

describe('admin vacuum SQL', () => {
  it('generates bare VACUUM', () => {
    expect(generateVacuumSql()).toBe('VACUUM');
  });
});

describe('assertAdminSqlFitsWire', () => {
  it('rejects when frame exceeds limit', () => {
    expect(() => assertAdminSqlFitsWire('SELECT 1', 8)).toThrow(NoBugDbError);
    expect(() => assertAdminSqlFitsWire('SELECT 1')).not.toThrow();
  });
});
