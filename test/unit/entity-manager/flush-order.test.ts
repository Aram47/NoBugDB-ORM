import { describe, expect, it } from 'vitest';
import { sortForDelete, sortForInsert } from '../../../src/entity-manager/flush-order.js';
import { defineEntity } from '../../../src/metadata/define-entity.js';
import type { TrackedEntity } from '../../../src/entity-manager/unit-of-work.js';

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

function tracked(
  entity: object,
  meta: TrackedEntity['meta'],
  state: TrackedEntity['state'] = 'new',
): TrackedEntity {
  return {
    entity,
    meta,
    state,
    snapshot: {},
  };
}

describe('flush-order', () => {
  it('inserts parent before child when FK relation is assigned', () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ada',
    };
    const post = {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Hi',
      authorId: '',
      author: user,
    };

    const ordered = sortForInsert([
      tracked(post, Post),
      tracked(user, User),
    ]);

    expect(ordered[0]?.entity).toBe(user);
    expect(ordered[1]?.entity).toBe(post);
  });

  it('deletes child before parent', () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ada',
    };
    const post = {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Hi',
      authorId: user.id,
      author: user,
    };

    const ordered = sortForDelete([
      tracked(user, User, 'removed'),
      tracked(post, Post, 'removed'),
    ]);

    expect(ordered[0]?.entity).toBe(post);
    expect(ordered[1]?.entity).toBe(user);
  });
});
