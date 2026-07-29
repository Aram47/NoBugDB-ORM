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
    expect(User.primaryKeys).toEqual(['id']);
    expect(User.columns.fullName.columnName).toBe('full_name');
    expect(User.columns.id.primary).toBe(true);
    expect(User.columns.id.generated).toBe('uuid');
  });

  it('accepts INT primary key without auto-generate', () => {
    const Item = defineEntity<{ id: number; name: string }>({
      name: 'Item',
      tableName: 'items',
      columns: {
        id: { type: 'INT', primary: true },
        name: { type: 'STRING' },
      },
    });
    expect(Item.primaryKey).toBe('id');
    expect(Item.columns.id.generated).toBe(false);
  });

  it('accepts composite primary keys via primaryColumns', () => {
    const OrderItem = defineEntity<{
      orderId: string;
      productId: string;
      qty: number;
    }>({
      name: 'OrderItem',
      tableName: 'order_items',
      primaryColumns: ['orderId', 'productId'],
      columns: {
        orderId: { type: 'UUID', primary: true },
        productId: { type: 'UUID', primary: true },
        qty: { type: 'INT' },
      },
    });
    expect(OrderItem.primaryKeys).toEqual(['orderId', 'productId']);
    expect(() => OrderItem.primaryKey).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
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
