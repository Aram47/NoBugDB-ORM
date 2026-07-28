import { describe, expect, it } from 'vitest';
import type { NoBugDbError } from '../../../src/driver/errors.js';
import { TypeMapper } from '../../../src/types/type-mapper.js';

describe('TypeMapper', () => {
  const mapper = new TypeMapper();

  it('round-trips INT', () => {
    expect(mapper.toSql(42, 'INT')).toBe('42');
    expect(mapper.fromWire('42', 'INT')).toBe(42);
  });

  it('round-trips FLOAT', () => {
    expect(mapper.toSql(3.14, 'FLOAT')).toBe('3.14');
    expect(mapper.fromWire('3.14', 'FLOAT')).toBe(3.14);
  });

  it('round-trips STRING with escaped quotes', () => {
    expect(mapper.toSql("O'Brien", 'STRING')).toBe("'O''Brien'");
    expect(mapper.fromWire("O'Brien", 'STRING')).toBe("O'Brien");
  });

  it('round-trips BOOLEAN', () => {
    expect(mapper.toSql(true, 'BOOLEAN')).toBe('TRUE');
    expect(mapper.toSql(false, 'BOOLEAN')).toBe('FALSE');
    expect(mapper.fromWire('true', 'BOOLEAN')).toBe(true);
    expect(mapper.fromWire('false', 'BOOLEAN')).toBe(false);
  });

  it('round-trips DATE from string and Date', () => {
    expect(mapper.toSql('2024-06-15', 'DATE')).toBe("'2024-06-15'");
    const date = new Date(Date.UTC(2024, 5, 15));
    expect(mapper.toSql(date, 'DATE')).toBe("'2024-06-15'");
    const parsed = mapper.fromWire('2024-06-15', 'DATE') as Date;
    expect(parsed.toISOString()).toBe('2024-06-15T00:00:00.000Z');
  });

  it('round-trips UUID', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(mapper.toSql(uuid, 'UUID')).toBe(`'${uuid}'`);
    expect(mapper.fromWire(uuid, 'UUID')).toBe(uuid);
  });

  it('handles NULL', () => {
    expect(mapper.toSql(null, 'STRING')).toBe('NULL');
    expect(mapper.fromWire(null, 'STRING')).toBeNull();
  });

  it('rejects unsafe INT values', () => {
    expect(() => mapper.toSql(1.5, 'INT')).toThrowError(
      expect.objectContaining({ code: 'TYPE_MISMATCH' } satisfies Partial<NoBugDbError>),
    );
  });

  it('rejects invalid UUID', () => {
    expect(() => mapper.toSql('not-a-uuid', 'UUID')).toThrowError(
      expect.objectContaining({ code: 'TYPE_MISMATCH' } satisfies Partial<NoBugDbError>),
    );
  });
});
