import { describe, expect, it } from 'vitest';
import {
  defineEntity,
  isEntityMetadata,
  MetadataRegistry,
} from '../../../src/metadata/index.js';
import type { NoBugDbError } from '../../../src/driver/errors.js';

describe('defineEntity', () => {
  it('registers metadata with primary UUID and column mapping', () => {
    const User = defineEntity<{ id: string; email: string; fullName: string }>({
      name: 'User',
      tableName: 'users',
      columns: {
        id: { type: 'UUID', primary: true },
        email: { type: 'STRING', unique: true },
        fullName: { name: 'full_name', type: 'STRING' },
      },
    });

    expect(isEntityMetadata(User)).toBe(true);
    expect(User.name).toBe('User');
    expect(User.tableName).toBe('users');
    expect(User.primaryKey).toBe('id');
    expect(User.columns.fullName.columnName).toBe('full_name');
    expect(User.columns.id.primary).toBe(true);
  });

  it('rejects missing primary key', () => {
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'NoPk',
        tableName: 'nopk',
        columns: {
          id: { type: 'UUID' },
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });

  it('rejects non-UUID primary key', () => {
    expect(() =>
      defineEntity<{ id: number }>({
        name: 'IntPk',
        tableName: 'intpk',
        columns: {
          id: { type: 'INT', primary: true },
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });

  it('rejects multiple primary keys', () => {
    expect(() =>
      defineEntity<{ a: string; b: string }>({
        name: 'Composite',
        tableName: 'composite',
        columns: {
          a: { type: 'UUID', primary: true },
          b: { type: 'UUID', primary: true },
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });
});

describe('MetadataRegistry', () => {
  it('registers and resolves by name and table', () => {
    const User = defineEntity<{ id: string; name: string }>({
      name: 'User',
      tableName: 'users',
      columns: {
        id: { type: 'UUID', primary: true },
        name: { type: 'STRING' },
      },
    });

    const registry = new MetadataRegistry();
    registry.register(User);

    expect(registry.getByTarget('User')).toBe(User);
    expect(registry.getByTarget(User)).toBe(User);
    expect(registry.getByTable('users')).toBe(User);
    expect(registry.getAll()).toEqual([User]);
  });

  it('rejects duplicate entity names', () => {
    const A = defineEntity<{ id: string }>({
      name: 'Dup',
      tableName: 'a',
      columns: { id: { type: 'UUID', primary: true } },
    });
    const B = defineEntity<{ id: string }>({
      name: 'Dup',
      tableName: 'b',
      columns: { id: { type: 'UUID', primary: true } },
    });

    const registry = new MetadataRegistry();
    registry.register(A);
    expect(() => registry.register(B)).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });
});
