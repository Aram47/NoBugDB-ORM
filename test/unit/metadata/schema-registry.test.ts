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

  it('assertConsistent passes for inverse one-to-one without local joinColumn', () => {
    const O2OUser = defineEntity<{ id: string; name: string }>({
      name: 'O2OUser',
      tableName: 'o2o_users',
      columns: {
        id: { type: 'UUID', primary: true },
        name: { type: 'STRING' },
      },
      relations: {
        profile: {
          type: 'one-to-one',
          target: 'O2OProfile',
          inverseSide: 'user',
        },
      },
    });

    const O2OProfile = defineEntity<{ id: string; bio: string; userId: string }>({
      name: 'O2OProfile',
      tableName: 'o2o_profiles',
      columns: {
        id: { type: 'UUID', primary: true },
        bio: { type: 'STRING' },
        userId: { type: 'UUID' },
      },
      relations: {
        user: {
          type: 'one-to-one',
          target: 'O2OUser',
          joinColumn: 'userId',
          inverseSide: 'profile',
        },
      },
    });

    const registry = new MetadataRegistry();
    registry.register(O2OUser);
    registry.register(O2OProfile);

    expect(() => new SchemaRegistry(registry).assertConsistent()).not.toThrow();
  });

  it('rejects inverse one-to-one when owning side lacks joinColumn', () => {
    const BadUser = defineEntity<{ id: string }>({
      name: 'BadO2OUser',
      tableName: 'bad_o2o_users',
      columns: {
        id: { type: 'UUID', primary: true },
      },
      relations: {
        profile: {
          type: 'one-to-one',
          target: 'BadO2OProfile',
          inverseSide: 'user',
        },
      },
    });

    // Inverse without joinColumn — both sides non-owning (invalid).
    const BadProfile = defineEntity<{ id: string }>({
      name: 'BadO2OProfile',
      tableName: 'bad_o2o_profiles',
      columns: {
        id: { type: 'UUID', primary: true },
      },
      relations: {
        user: {
          type: 'one-to-one',
          target: 'BadO2OUser',
          inverseSide: 'profile',
        },
      },
    });

    const registry = new MetadataRegistry();
    registry.register(BadUser);
    registry.register(BadProfile);

    expect(() => new SchemaRegistry(registry).assertConsistent()).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });
});
