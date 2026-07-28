import { describe, expect, it } from 'vitest';
import { defineEntity } from '../../../src/metadata/define-entity.js';
import { MetadataRegistry } from '../../../src/metadata/metadata-registry.js';
import { SchemaRegistry } from '../../../src/metadata/schema-registry.js';
import type { NoBugDbError } from '../../../src/driver/errors.js';

const User = defineEntity<{ id: string; name: string }>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'UUID', primary: true },
    name: { type: 'STRING' },
  },
  relations: {
    posts: { type: 'one-to-many', target: 'Post', inverseSide: 'author' },
  },
});

const Post = defineEntity<{ id: string; title: string; authorId: string }>({
  name: 'Post',
  tableName: 'posts',
  columns: {
    id: { type: 'UUID', primary: true },
    title: { type: 'STRING' },
    authorId: { type: 'UUID' },
  },
  relations: {
    author: {
      type: 'many-to-one',
      target: 'User',
      joinColumn: 'authorId',
      inverseSide: 'posts',
    },
  },
});

describe('SchemaRegistry', () => {
  it('assertConsistent passes for valid bidirectional relations', () => {
    const registry = new MetadataRegistry();
    registry.register(User);
    registry.register(Post);

    expect(() => new SchemaRegistry(registry).assertConsistent()).not.toThrow();
  });

  it('rejects unknown relation target', () => {
    const Bad = defineEntity<{ id: string; authorId: string }>({
      name: 'Bad',
      tableName: 'bad',
      columns: {
        id: { type: 'UUID', primary: true },
        authorId: { type: 'UUID' },
      },
      relations: {
        author: {
          type: 'many-to-one',
          target: 'Missing',
          joinColumn: 'authorId',
        },
      },
    });

    const registry = new MetadataRegistry();
    registry.register(Bad);

    expect(() => new SchemaRegistry(registry).assertConsistent()).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });

  it('rejects broken inverseSide on one-to-many', () => {
    const BrokenUser = defineEntity<{ id: string }>({
      name: 'BrokenUser',
      tableName: 'broken_users',
      columns: {
        id: { type: 'UUID', primary: true },
      },
      relations: {
        posts: { type: 'one-to-many', target: 'Post', inverseSide: 'missing' },
      },
    });

    const registry = new MetadataRegistry();
    registry.register(BrokenUser);
    registry.register(Post);

    expect(() => new SchemaRegistry(registry).assertConsistent()).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });

  it('tables() returns entity metadata with relations', () => {
    const registry = new MetadataRegistry();
    registry.register(User);
    registry.register(Post);

    const tables = new SchemaRegistry(registry).tables();
    expect(tables).toHaveLength(2);
    expect(tables.find((t) => t.entity.name === 'User')?.relations).toHaveLength(1);
  });
});
