import { describe, expect, it } from 'vitest';
import { defineEntity } from '../../../src/metadata/define-entity.js';
import { EntityMapper } from '../../../src/metadata/entity-mapper.js';
import { MetadataRegistry } from '../../../src/metadata/metadata-registry.js';

const User = defineEntity<{ id: string; name: string }>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'UUID', primary: true },
    name: { type: 'STRING' },
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
    },
  },
});

describe('EntityMapper relations', () => {
  const registry = new MetadataRegistry();
  registry.register(User);
  registry.register(Post);
  const mapper = new EntityMapper({ registry });

  it('writes FK from assigned relation object in toDbRow', () => {
    const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada' };
    const post = {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Hi',
      authorId: '',
      author: user,
    };

    const row = mapper.toDbRow(post, Post);
    expect(row.authorId).toBe(user.id);
  });

  it('detects dirty state when relation assignment changes FK', () => {
    const userA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada' };
    const userB = { id: '33333333-3333-4333-8333-333333333333', name: 'Bob' };
    const post = {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Hi',
      authorId: userA.id,
      author: userA,
    };

    const snapshot = mapper.takeSnapshot(post, Post);
    post.author = userB;
    post.authorId = userB.id;

    expect(mapper.isDirty(post, snapshot, Post)).toBe(true);
    expect(mapper.getDirtyPatch(post, snapshot, Post)).toEqual({
      authorId: userB.id,
    });
  });

  it('sets FK to null when relation is null and nullable', () => {
    const PostNullable = defineEntity<{
      id: string;
      authorId: string | null;
    }>({
      name: 'PostNullable',
      tableName: 'posts_nullable',
      columns: {
        id: { type: 'UUID', primary: true },
        authorId: { type: 'UUID', nullable: true },
      },
      relations: {
        author: {
          type: 'many-to-one',
          target: 'User',
          joinColumn: 'authorId',
          nullable: true,
        },
      },
    });

    const row = mapper.toDbRow(
      {
        id: '22222222-2222-4222-8222-222222222222',
        authorId: null,
        author: null,
      } as { id: string; authorId: string | null; author: null },
      PostNullable,
    );
    expect(row.authorId).toBeNull();
  });
});
