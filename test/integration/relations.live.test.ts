import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DataSource,
  defineEntity,
  MAX_RELATION_DEPTH,
} from '../../src/index.js';
import type { ConnectionOptions } from '../../src/index.js';

const host = process.env.NOBUGDB_HOST;
const port = Number(process.env.NOBUGDB_PORT ?? '9000');
const user = process.env.NOBUGDB_USER;
const password = process.env.NOBUGDB_PASSWORD;

function liveOptions(): ConnectionOptions {
  if (!host) {
    throw new Error('NOBUGDB_HOST is required for live tests');
  }

  const options: ConnectionOptions = {
    host,
    port,
  };

  if (user !== undefined) {
    options.user = user;
    options.password = password ?? '';
  }

  return options;
}

interface LiveUser {
  id: string;
  name: string;
}

interface LivePostRow {
  id: string;
  title: string;
  authorId: string;
}

interface LivePost extends LivePostRow {
  author?: LiveUser | null;
  comments?: LiveComment[];
}

interface LiveComment {
  id: string;
  body: string;
  postId: string;
}

describe.skipIf(!host)('Relations live', () => {
  let ds: DataSource | null = null;
  const suffix = randomUUID().replace(/-/g, '_');
  const usersTable = `orm_rel_users_${suffix}`;
  const postsTable = `orm_rel_posts_${suffix}`;
  const commentsTable = `orm_rel_comments_${suffix}`;

  const User = defineEntity<LiveUser>({
    name: 'RelUser',
    tableName: usersTable,
    columns: {
      id: { type: 'UUID', primary: true },
      name: { type: 'STRING' },
    },
    relations: {
      posts: { type: 'one-to-many', target: 'RelPost', inverseSide: 'author' },
    },
  });

  const Post = defineEntity<LivePostRow>({
    name: 'RelPost',
    tableName: postsTable,
    columns: {
      id: { type: 'UUID', primary: true },
      title: { type: 'STRING' },
      authorId: { type: 'UUID' },
    },
    relations: {
      author: {
        type: 'many-to-one',
        target: 'RelUser',
        joinColumn: 'authorId',
        inverseSide: 'posts',
      },
      comments: {
        type: 'one-to-many',
        target: 'RelComment',
        inverseSide: 'post',
      },
    },
  });

  const Comment = defineEntity<LiveComment>({
    name: 'RelComment',
    tableName: commentsTable,
    columns: {
      id: { type: 'UUID', primary: true },
      body: { type: 'STRING' },
      postId: { type: 'UUID' },
    },
    relations: {
      post: {
        type: 'many-to-one',
        target: 'RelPost',
        joinColumn: 'postId',
        inverseSide: 'comments',
      },
    },
  });

  afterEach(async () => {
    if (ds?.isInitialized) {
      await ds.manager
        .query(`DROP TABLE IF EXISTS ${commentsTable}`)
        .catch(() => undefined);
      await ds.manager
        .query(`DROP TABLE IF EXISTS ${postsTable}`)
        .catch(() => undefined);
      await ds.manager
        .query(`DROP TABLE IF EXISTS ${usersTable}`)
        .catch(() => undefined);
      await ds.destroy().catch(() => undefined);
      ds = null;
    }
  });

  async function setup(): Promise<DataSource> {
    ds = new DataSource({
      ...liveOptions(),
      entities: [User, Post, Comment],
    });
    await ds.initialize();

    await ds.manager.query(
      `CREATE TABLE ${usersTable} (id UUID PRIMARY KEY, name STRING)`,
    );
    await ds.manager.query(
      `CREATE TABLE ${postsTable} (id UUID PRIMARY KEY, title STRING, authorId UUID)`,
    );
    await ds.manager.query(
      `CREATE TABLE ${commentsTable} (id UUID PRIMARY KEY, body STRING, postId UUID)`,
    );

    return ds;
  }

  it('find with relations hydrates many-to-one author', async () => {
    const dataSource = await setup();
    const users = dataSource.getRepository(User);
    const posts = dataSource.getRepository(Post);

    const user = await users.insert({ name: 'Ada' });
    await posts.insert({
      title: 'Hello',
      authorId: user.id,
    });

    const found = await posts.find({ relations: ['author'] });
    expect(found).toHaveLength(1);
    expect((found[0] as LivePost).author?.name).toBe('Ada');
  });

  it('find with relations loads one-to-many comments', async () => {
    const dataSource = await setup();
    const users = dataSource.getRepository(User);
    const posts = dataSource.getRepository(Post);
    const comments = dataSource.getRepository(Comment);

    const user = await users.insert({ name: 'Ada' });
    const post = await posts.insert({
      title: 'Hello',
      authorId: user.id,
    });
    await comments.insert({
      body: 'Nice post',
      postId: post.id,
    });

    const found = await posts.find({ relations: ['comments'] });
    expect((found[0] as LivePost).comments).toHaveLength(1);
    expect((found[0] as LivePost).comments?.[0]?.body).toBe('Nice post');
  });

  it('flush inserts parent then child when relation object is assigned', async () => {
    const dataSource = await setup();
    const posts = dataSource.getRepository(Post);

    const user = dataSource.manager.create(User, { name: 'Grace' });
    dataSource.manager.persist(user);

    const post = dataSource.manager.create(Post, {
      title: 'ORM relations',
    }) as LivePost;
    post.author = user;
    dataSource.manager.persist(post);
    await dataSource.manager.flush();

    const reloaded = await posts.findOne({
      where: { title: 'ORM relations' },
      relations: ['author'],
    });
    const row = reloaded as LivePost | null;
    expect(row?.author?.name).toBe('Grace');
    expect(row?.authorId).toBe(user.id);
  });

  it('shares author instance across posts via identity map', async () => {
    const dataSource = await setup();
    const users = dataSource.getRepository(User);
    const posts = dataSource.getRepository(Post);

    const user = await users.insert({ name: 'Shared' });
    await posts.insert({ title: 'A', authorId: user.id });
    await posts.insert({ title: 'B', authorId: user.id });

    const found = await posts.find({ relations: ['author'] });
    expect(found).toHaveLength(2);
    expect((found[0] as LivePost).author).toBe((found[1] as LivePost).author);
  });

  it('rejects relation paths deeper than max depth', async () => {
    const dataSource = await setup();
    const posts = dataSource.getRepository(Post);

    const tooDeep = Array.from({ length: MAX_RELATION_DEPTH + 1 }, (_, i) => `r${i}`).join('.');
    await expect(
      posts.find({ relations: [tooDeep] }),
    ).rejects.toThrow(/max depth/i);
  });

  it('initialize fails when relation target is unknown', async () => {
    const BrokenPost = defineEntity<{ id: string; authorId: string }>({
      name: 'BrokenRelPost',
      tableName: `broken_${suffix}`,
      columns: {
        id: { type: 'UUID', primary: true },
        authorId: { type: 'UUID' },
      },
      relations: {
        author: {
          type: 'many-to-one',
          target: 'MissingEntity',
          joinColumn: 'authorId',
        },
      },
    });

    const brokenDs = new DataSource({
      ...liveOptions(),
      entities: [BrokenPost],
    });

    await expect(brokenDs.initialize()).rejects.toThrow(/unknown entity/i);
  });
});
