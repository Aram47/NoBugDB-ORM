import { describe, expect, it } from 'vitest';
import { defineEntity } from '../../../src/metadata/define-entity.js';
import type { NoBugDbError } from '../../../src/driver/errors.js';

describe('defineEntity relations', () => {
  it('normalizes many-to-one with explicit joinColumn', () => {
    const Post = defineEntity<{
      id: string;
      title: string;
      authorId: string;
    }>({
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

    expect(Post.relations.author.joinColumnProperty).toBe('authorId');
    expect(Post.relations.author.joinColumnDb).toBe('authorId');
    expect(Post.relations.author.type).toBe('many-to-one');
  });

  it('defaults joinColumn to {property}Id when column exists', () => {
    const Post = defineEntity<{ id: string; authorId: string }>({
      name: 'Post',
      tableName: 'posts',
      columns: {
        id: { type: 'UUID', primary: true },
        authorId: { type: 'UUID' },
      },
      relations: {
        author: { type: 'many-to-one', target: 'User' },
      },
    });

    expect(Post.relations.author.joinColumnProperty).toBe('authorId');
  });

  it('rejects missing joinColumn column', () => {
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'Post',
        tableName: 'posts',
        columns: {
          id: { type: 'UUID', primary: true },
        },
        relations: {
          author: { type: 'many-to-one', target: 'User' },
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });

  it('requires inverseSide for one-to-many', () => {
    expect(() =>
      defineEntity<{ id: string }>({
        name: 'User',
        tableName: 'users',
        columns: {
          id: { type: 'UUID', primary: true },
        },
        relations: {
          posts: { type: 'one-to-many', target: 'Post' },
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });

  it('entities without relations have empty relations map', () => {
    const User = defineEntity<{ id: string }>({
      name: 'User',
      tableName: 'users',
      columns: {
        id: { type: 'UUID', primary: true },
      },
    });

    expect(User.relations).toEqual({});
  });

  it('normalizes inverse one-to-one without local joinColumn', () => {
    const User = defineEntity<{ id: string }>({
      name: 'User',
      tableName: 'users',
      columns: {
        id: { type: 'UUID', primary: true },
      },
      relations: {
        profile: {
          type: 'one-to-one',
          target: 'Profile',
          inverseSide: 'user',
        },
      },
    });

    expect(User.relations.profile.joinColumnProperty).toBeUndefined();
    expect(User.relations.profile.joinColumnDb).toBeUndefined();
    expect(User.relations.profile.inverseSide).toBe('user');
  });

  it('keeps owning one-to-one joinColumn when both sides configured', () => {
    const Profile = defineEntity<{ id: string; userId: string }>({
      name: 'Profile',
      tableName: 'profiles',
      columns: {
        id: { type: 'UUID', primary: true },
        userId: { type: 'UUID' },
      },
      relations: {
        user: {
          type: 'one-to-one',
          target: 'User',
          joinColumn: 'userId',
          inverseSide: 'profile',
        },
      },
    });

    expect(Profile.relations.user.joinColumnProperty).toBe('userId');
    expect(Profile.relations.user.joinColumnDb).toBe('userId');
  });
});
