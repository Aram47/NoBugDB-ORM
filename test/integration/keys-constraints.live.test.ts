import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DataSource,
  defineEntity,
  NoBugDbError,
  Pool,
  createMigrationContext,
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

describe.skipIf(!host)('Keys and constraints live', () => {
  let pool: Pool | null = null;
  const suffix = randomUUID().replace(/-/g, '_');
  const itemsTable = `orm_items_${suffix}`;
  const orderItemsTable = `orm_oi_${suffix}`;
  const authorsTable = `orm_authors_${suffix}`;
  const postsTable = `orm_posts_${suffix}`;

  afterEach(async () => {
    if (pool) {
      for (const name of [postsTable, authorsTable, orderItemsTable, itemsTable]) {
        await pool.query(`DROP TABLE IF EXISTS ${name}`).catch(() => undefined);
      }
      await pool.end().catch(() => undefined);
      pool = null;
    }
  });

  it('supports INT PK, composite PK/UNIQUE DDL, and M2O on INT PK', async () => {
    pool = new Pool(liveOptions());
    const ctx = createMigrationContext(pool);

    await ctx.schema.createTable(itemsTable, (t) => {
      t.int('id').primary();
      t.string('name').notNull();
    });

    await ctx.schema.createTable(orderItemsTable, (t) => {
      t.int('order_id').notNull();
      t.int('product_id').notNull();
      t.int('qty').notNull();
      t.primaryKey('order_id', 'product_id');
      t.unique(null, 'order_id', 'product_id');
    });

    await expect(
      ctx.query(`INSERT INTO ${itemsTable} VALUES (1, 'a')`),
    ).resolves.toMatchObject({ success: true });
    await expect(
      ctx.query(`INSERT INTO ${itemsTable} VALUES (1, 'b')`),
    ).rejects.toBeInstanceOf(NoBugDbError);

    await expect(
      ctx.query(`INSERT INTO ${orderItemsTable} VALUES (1, 10, 2)`),
    ).resolves.toMatchObject({ success: true });
    await expect(
      ctx.query(`INSERT INTO ${orderItemsTable} VALUES (1, 10, 3)`),
    ).rejects.toBeInstanceOf(NoBugDbError);

    await ctx.schema.createTable(authorsTable, (t) => {
      t.int('id').primary();
      t.string('name').notNull();
    });
    await ctx.schema.createTable(postsTable, (t) => {
      t.int('id').primary();
      t.int('author_id').notNull();
      t.string('title').notNull();
    });

    interface Author {
      id: number;
      name: string;
    }
    interface Post {
      id: number;
      authorId: number;
      title: string;
      author?: Author | null;
    }

    const Author = defineEntity<Author>({
      name: `Author_${suffix}`,
      tableName: authorsTable,
      columns: {
        id: { type: 'INT', primary: true },
        name: { type: 'STRING' },
      },
    });
    const Post = defineEntity<Post>({
      name: `Post_${suffix}`,
      tableName: postsTable,
      columns: {
        id: { type: 'INT', primary: true },
        authorId: { name: 'author_id', type: 'INT' },
        title: { type: 'STRING' },
      },
      relations: {
        author: {
          type: 'many-to-one',
          target: Author.name,
          joinColumn: 'authorId',
        },
      },
    });

    const ds = new DataSource({
      ...liveOptions(),
      entities: [Author, Post],
    });
    await ds.initialize();
    try {
      const em = ds.manager;
      await em.getRepository(Author).insert({ id: 1, name: 'Ada' });
      await em.getRepository(Post).insert({
        id: 10,
        authorId: 1,
        title: 'Hello',
      });
      const post = await em.getRepository(Post).findOne({
        where: { id: 10 },
        relations: ['author'],
      });
      expect(post?.author?.name).toBe('Ada');
      await expect(
        em.getRepository(Author).insert({ name: 'no-id' } as Author),
      ).rejects.toMatchObject({ code: 'METADATA' });
    } finally {
      await ds.destroy();
    }
  });
});
