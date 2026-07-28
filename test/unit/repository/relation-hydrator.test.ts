import { describe, expect, it } from 'vitest';
import { IdentityMap } from '../../../src/entity-manager/identity-map.js';
import { UnitOfWork } from '../../../src/entity-manager/unit-of-work.js';
import { defineEntity } from '../../../src/metadata/define-entity.js';
import { EntityMapper } from '../../../src/metadata/entity-mapper.js';
import { MetadataRegistry } from '../../../src/metadata/metadata-registry.js';
import {
  RelationHydrator,
  type JoinedRelationSpec,
} from '../../../src/repository/relation-hydrator.js';

const User = defineEntity<{ id: string; name: string }>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'UUID', primary: true },
    name: { type: 'STRING' },
  },
});

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

describe('RelationHydrator', () => {
  const registry = new MetadataRegistry();
  registry.register(User);
  registry.register(Post);
  const mapper = new EntityMapper({ registry });
  const uow = new UnitOfWork(new IdentityMap(), mapper);
  const hydrator = new RelationHydrator(mapper, uow, registry);

  const authorJoin: JoinedRelationSpec = {
    property: 'author',
    path: ['author'],
    prefix: 'author',
    alias: 't1',
    ownerAlias: 't0',
    meta: User,
    relation: Post.relations.author,
  };

  it('hydrates many-to-one relation from prefixed columns', () => {
    const post = hydrator.hydrateRootRow(
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Hello',
        authorId: '11111111-1111-4111-8111-111111111111',
        author__id: '11111111-1111-4111-8111-111111111111',
        author__name: 'Ada',
      },
      Post,
      [authorJoin],
    );

    expect(post.title).toBe('Hello');
    expect((post as unknown as { author: { name: string } }).author.name).toBe('Ada');
  });

  it('sets relation to null when joined PK is missing', () => {
    const post = hydrator.hydrateRootRow(
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Hello',
        authorId: null,
        author__id: null,
        author__name: null,
      },
      Post,
      [authorJoin],
    );

    expect((post as unknown as { author: unknown }).author).toBeNull();
  });

  it('reuses identity map instance for the same related PK', () => {
    const first = hydrator.hydrateRootRow(
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'A',
        authorId: '11111111-1111-4111-8111-111111111111',
        author__id: '11111111-1111-4111-8111-111111111111',
        author__name: 'Ada',
      },
      Post,
      [authorJoin],
    );

    const second = hydrator.hydrateRootRow(
      {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'B',
        authorId: '11111111-1111-4111-8111-111111111111',
        author__id: '11111111-1111-4111-8111-111111111111',
        author__name: 'Ada',
      },
      Post,
      [authorJoin],
    );

    expect((first as unknown as { author: object }).author).toBe(
      (second as unknown as { author: object }).author,
    );
  });

  it('attaches one-to-many collections grouped by FK', () => {
    const Comment = defineEntity<{ id: string; body: string; postId: string }>({
      name: 'Comment',
      tableName: 'comments',
      columns: {
        id: { type: 'UUID', primary: true },
        body: { type: 'STRING' },
        postId: { type: 'UUID' },
      },
      relations: {
        post: {
          type: 'many-to-one',
          target: 'Post',
          joinColumn: 'postId',
        },
      },
    });

    registry.register(Comment);

    const PostWithComments = defineEntity<{
      id: string;
      title: string;
      authorId: string;
    }>({
      name: 'PostWithComments',
      tableName: 'posts',
      columns: {
        id: { type: 'UUID', primary: true },
        title: { type: 'STRING' },
        authorId: { type: 'UUID' },
      },
      relations: {
        comments: {
          type: 'one-to-many',
          target: 'Comment',
          inverseSide: 'post',
        },
      },
    });

    const parents = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'A',
        authorId: '11111111-1111-4111-8111-111111111111',
      },
    ] as Array<{ id: string; title: string; authorId: string; comments?: unknown[] }>;

    const children = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        body: 'Nice',
        postId: '22222222-2222-4222-8222-222222222222',
      },
    ];

    hydrator.attachCollection(
      parents,
      PostWithComments,
      'comments',
      children,
      Comment,
      'postId',
    );

    expect(parents[0]!.comments).toHaveLength(1);
    expect((parents[0]!.comments![0] as { body: string }).body).toBe('Nice');
  });
});
