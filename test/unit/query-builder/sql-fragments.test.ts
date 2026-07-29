import { describe, expect, it } from 'vitest';
import type { NoBugDbError } from '../../../src/driver/errors.js';
import { sql } from '../../../src/query-builder/sql-fragments.js';
import type { NoBugDbDataType } from '../../../src/types/type-mapper.js';

describe('sql scalar helpers', () => {
  it('renders coalesce', () => {
    expect(sql.coalesce('a', 'b').text).toBe('COALESCE(a, b)');
  });

  it('renders nullif with typed literal', () => {
    expect(sql.nullif('a', 0).text).toBe('NULLIF(a, 0)');
  });

  it('renders substring with length', () => {
    expect(sql.substring('name', 1, 2).text).toBe('SUBSTRING(name, 1, 2)');
  });

  it('renders substring without length', () => {
    expect(sql.substring('name', 1).text).toBe('SUBSTRING(name, 1)');
  });

  it('renders cast', () => {
    expect(sql.cast('id', 'INT').text).toBe('CAST(id AS INT)');
  });

  it('renders currentDate', () => {
    expect(sql.currentDate().text).toBe('CURRENT_DATE');
  });

  it('renders fn with validated name', () => {
    expect(sql.fn('my_udf', 'id').text).toBe('my_udf(id)');
  });

  it('rejects invalid cast type', () => {
    expect(() => sql.cast('id', 'VARCHAR' as NoBugDbDataType)).toThrowError(
      expect.objectContaining({
        code: 'TYPE_MISMATCH',
      } satisfies Partial<NoBugDbError>),
    );
  });

  it('rejects empty coalesce', () => {
    expect(() => sql.coalesce()).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_SQL',
      } satisfies Partial<NoBugDbError>),
    );
  });

  it('rejects invalid fn name', () => {
    expect(() => sql.fn('bad;name', 'id')).toThrowError(
      expect.objectContaining({
        code: 'INVALID_IDENTIFIER',
      } satisfies Partial<NoBugDbError>),
    );
  });

  it('composes coalesce with nested expression and alias', () => {
    expect(sql.coalesce('a', sql.upper('b')).as('x').text).toBe(
      'COALESCE(a, UPPER(b)) AS x',
    );
  });

  it('renders coalesce with null literal', () => {
    expect(sql.coalesce('a', null).text).toBe('COALESCE(a, NULL)');
  });
});
