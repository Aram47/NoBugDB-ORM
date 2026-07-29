import { describe, expect, it } from 'vitest';
import type { NoBugDbError } from '../../../src/driver/errors.js';
import {
  escapeLiteral,
  quoteIdent,
} from '../../../src/query-builder/escape.js';
import { sql } from '../../../src/query-builder/sql-fragments.js';
import { compileWhere } from '../../../src/query-builder/where.js';

describe('escape', () => {
  it('quotes simple identifiers', () => {
    expect(quoteIdent('users')).toBe('users');
  });

  it('escapes string literals', () => {
    expect(escapeLiteral("O'Brien")).toBe("'O''Brien'");
  });

  it('rejects invalid identifiers', () => {
    expect(() => quoteIdent('users; drop')).toThrowError(
      expect.objectContaining({ code: 'INVALID_IDENTIFIER' } satisfies Partial<NoBugDbError>),
    );
  });
});

describe('where', () => {
  it('compiles AND/OR nesting', () => {
    const compiled = compileWhere({
      and: [
        { col: 'id', op: '=', value: 1 },
        {
          or: [
            { col: 'name', op: '=', value: 'Ada' },
            { col: 'name', op: '=', value: 'Grace' },
          ],
        },
      ],
    });

    expect(compiled.sql).toBe("(id = 1 AND (name = 'Ada' OR name = 'Grace'))");
  });

  it('compiles record sugar with NULL', () => {
    const compiled = compileWhere({ id: 1, deleted_at: null });
    expect(compiled.sql).toBe('(id = 1 AND deleted_at IS NULL)');
  });

  it('rejects unsupported fragments in raw SQL', () => {
    expect(() => sql.raw('name LIKE %x%')).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_SQL' } satisfies Partial<NoBugDbError>),
    );
  });

  it('allows OVER in sql.raw', () => {
    expect(() =>
      sql.raw('SELECT ROW_NUMBER() OVER (ORDER BY id) FROM t'),
    ).not.toThrow();
  });

  it('renders sql.ref as a column identifier in WHERE', () => {
    const compiled = compileWhere({
      col: 'user_id',
      op: '=',
      value: sql.ref('u.id'),
    });
    expect(compiled.sql).toBe('user_id = u.id');
    expect(compiled.params).toEqual([]);
  });

  it('compiles exists subquery WhereInput', () => {
    const compiled = compileWhere({
      exists: {
        toSubquerySql: () => '(SELECT 1 FROM orders)',
      },
    });
    expect(compiled.sql).toBe('EXISTS (SELECT 1 FROM orders)');
  });
});
