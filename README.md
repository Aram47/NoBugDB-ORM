# NoBugDB ORM

TypeScript **Data Mapper** ORM for [NoBugDB](https://github.com/Aram47/NoBugDB) — Node.js / Express, published as npm package [`nobugdb-orm`](https://www.npmjs.com/package/nobugdb-orm).

## Status

**0.1.0** — first public release: TCP driver, pool, query builder, Data Mapper CRUD, relations, migrations CLI, optional Express subpath.

See [CHANGELOG.md](./CHANGELOG.md). Implementation roadmap: [docs/plans/README.md](./docs/plans/README.md).

## Requirements

- Node.js `>=18`
- A running [NoBugDB](https://github.com/Aram47/NoBugDB) server (default `127.0.0.1:9000`)

## Install

```bash
npm install nobugdb-orm
```

Express is an **optional** peer dependency — only needed if you use `nobugdb-orm/express`.

## Stack

- TypeScript (ESM primary, dual CJS)
- Data Mapper + Repository (`EntityManager`, not Active Record)
- TCP driver for NoBugDB wire protocol (`AUTH` / `QUERY` / `PING` / `QUIT`)
- Connection pool with sticky transactions (default `max: 4`)
- Client-generated **UUID** primary keys (no `RETURNING` / `SERIAL`)

## Data Mapper usage

Entities are plain objects. Persistence goes through `Repository` / `EntityManager` — there is no `save()` on the entity itself.

```ts
import { DataSource, defineEntity } from 'nobugdb-orm';

const User = defineEntity<{ id: string; email: string; name: string }>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'UUID', primary: true },
    email: { type: 'STRING', unique: true },
    name: { type: 'STRING' },
  },
});

const ds = new DataSource({
  host: '127.0.0.1',
  port: 9000,
  entities: [User],
});
await ds.initialize();

const users = ds.getRepository(User);
const u = await users.insert({ email: 'a@b.c', name: 'Ada' });
const found = await users.findById(u.id);

// Explicit Unit of Work
const created = ds.manager.create(User, { email: 'g@h.i', name: 'Grace' });
ds.manager.persist(created);
await ds.manager.flush();

await ds.destroy();
```

If the primary UUID is empty on `insert` / `persist`, the ORM generates one with `randomUUID()`. You may also set the UUID yourself before insert.

## Relations

Declare FK columns explicitly in `columns`, then describe relations in metadata. Relations are **eager-loaded only** when requested — there is no lazy loading and no runtime DB introspection (`information_schema` is not available in NoBugDB).

```ts
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

const ds = new DataSource({ host: '127.0.0.1', port: 9000, entities: [User, Post] });
await ds.initialize(); // runs SchemaRegistry.assertConsistent()

const posts = await ds.getRepository(Post).find({ relations: ['author'] });
// posts[0].author is a hydrated User (shared via identity map when reused)

// Assign relation object; flush writes authorId FK (no ORM cascade insert)
const user = await ds.getRepository(User).insert({ name: 'Ada' });
const post = ds.manager.create(Post, { title: 'Hello' });
(post as { author: typeof user }).author = user;
ds.manager.persist(post);
await ds.manager.flush();
```

**Notes:**

- Many-to-many in v1: model via an explicit join entity with two M2O relations.
- Relation targets for writes must be base tables (views are read-only in NoBugDB).
- Prefer `find({ relations: [...] })` over manual loops to avoid N+1 queries.
- ORM does not cascade insert/update/delete — persist related entities explicitly.

## Pool usage

NoBugDB keeps transaction state on the TCP session (snapshot isolation / MVCC). Use `pool.transaction` (or `DataSource.transaction`) so `BEGIN`…`COMMIT` stay on one connection:

```ts
import { Pool } from 'nobugdb-orm';

const pool = new Pool({ host: '127.0.0.1', port: 9000, max: 4 });

await pool.transaction(async (conn) => {
  await conn.query('INSERT INTO users (id, name) VALUES (...)');
});
await pool.end();
```

Default `max: 4` matches server-side serialization (`db_mutex_`); raising the pool size rarely improves throughput.

## Query builder usage

```ts
import { Pool, QueryBuilder } from 'nobugdb-orm';

const pool = new Pool({ host: '127.0.0.1', port: 9000, max: 4 });

const rows = await new QueryBuilder(pool)
  .select('id', 'name')
  .from('users')
  .where({ active: true })
  .orderBy('name', 'ASC')
  .limit(10)
  .execute();

await new QueryBuilder(pool)
  .insertInto('users')
  .values({ id: '...', name: 'Ada' })
  .executeCommand();

await pool.end();
```

`toSql()` renders escaped inline literals for ad-hoc SQL. `execute()` / `executeCommand()` use `PREPARE` / `EXECUTE` / `DEALLOCATE` on the connection session.

## Supported SQL / types

| Area | Supported |
|------|-----------|
| DML | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| Clauses | `JOIN` (INNER/LEFT/RIGHT/FULL/CROSS), `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT` / `OFFSET` |
| Aggregates | Basic (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`) via expression helpers |
| Types | `INT`, `FLOAT`, `STRING`, `BOOLEAN`, `DATE`, `UUID` |
| Not supported | `LIKE`, `UNION`, CTE, window functions, `UPSERT`, `RETURNING`, `SERIAL` / sequences |

Wire values: `DATE` and `UUID` travel as strings; the ORM maps `DATE` ↔ `Date` and keeps UUID as `string`.

## Limitations

- Server read buffer is ~**4 KiB** — large queries / wide rows fail fast; keep payloads small.
- No `SERIAL` / `RETURNING` — use client-generated **UUID** primary keys.
- No `LIKE` / `UNION` / CTE / window functions / `UPSERT`.
- No runtime introspection (`information_schema` does not exist) — schema comes from entity metadata + migrations.
- No TLS on the wire yet (development-grade auth; do not log passwords).
- Views are read-only — never write through view targets.
- Server uses a global DB mutex — keep pools small (default `max: 4`).

## Migrations

NoBugDB has no `information_schema` — schema changes are **explicit migrations**, not auto-sync.

### Config

Create `nobugdb-orm.config.ts` in your project:

```ts
export default {
  host: '127.0.0.1',
  port: 9000,
  migrationsDir: './migrations',
};
```

### CLI

```bash
nobugdb-orm migration:create create_users
nobugdb-orm migration:up
nobugdb-orm migration:down        # revert last migration
nobugdb-orm migration:down 2      # revert last 2
nobugdb-orm migration:status
nobugdb-orm --config ./my.config.ts migration:up
```

### Migration file

```ts
import type { MigrationContext } from 'nobugdb-orm';

export const id = '20260728120000_create_users';

export async function up(ctx: MigrationContext): Promise<void> {
  await ctx.schema.createTable('users', (t) => {
    t.uuid('id').primary();
    t.string('email').unique().notNull();
    t.string('name').notNull();
  });
}

export async function down(ctx: MigrationContext): Promise<void> {
  await ctx.schema.dropTable('users');
}
```

Filename must be `{timestamp}_{slug}.ts` and match exported `id`.

### Migrator API

```ts
import { DataSource, Migrator } from 'nobugdb-orm';

const ds = new DataSource({ host: '127.0.0.1', port: 9000 });
await ds.initialize();

const migrator = new Migrator(ds, { migrationsDir: './migrations' });
await migrator.up();
await migrator.status();
await migrator.down(1);

await ds.destroy();
```

`DataSource` can be initialized without `entities` for migration-only use.

### Transactional semantics

Each migration runs inside `BEGIN` … `COMMIT` on a sticky pooled connection. DDL and the history `INSERT` are applied in the same transaction when the server supports it. If a migration fails, the transaction rolls back and no history row is recorded.

History table (created on first `migrate`):

```sql
CREATE TABLE orm_migrations (
  id STRING PRIMARY KEY,
  applied_at STRING NOT NULL
);
```

**Migration notes:** no auto-generate from entity diff (v2); `ALTER TABLE` support matches NoBugDB engine capabilities; wide DDL may hit the ~4 KiB wire buffer limit.

## Express integration

`nobugdb-orm` ships an optional thin layer for Express: `nobugdb-orm/express`.
It provides a request-scoped `EntityManager` so each request has its own Identity Map.

### Middleware

```ts
import express from 'express';
import { DataSource, defineEntity } from 'nobugdb-orm';
import { nobugdbMiddleware } from 'nobugdb-orm/express';

const app = express();

// Your entities...
// const User = defineEntity(...);

const ds = new DataSource({ host: '127.0.0.1', port: 9000, entities: [] });
await ds.initialize();

app.use(nobugdbMiddleware({ dataSource: ds })); // mounts req.em

app.get('/users/:id', async (req, res, next) => {
  try {
    // Optional: type augmentation for req.em (see below).
    const user = await req.em.getRepository('User').findById(req.params.id);
    if (!user) return res.status(404).end();
    res.json(user);
  } catch (e) {
    next(e);
  }
});
```

### Request typing (`req.em`)

If you want `req.em` typed, add this augmentation in your app:

```ts
import type { EntityManager } from 'nobugdb-orm';

declare global {
  namespace Express {
    interface Request {
      em: EntityManager;
    }
  }
}
```

### Optional per-request transaction

By default, each ORM query uses pooled connections (request-scoped Identity Map, no automatic TCP transaction).
If you need a single TCP-session transaction for the whole request, enable it:

```ts
app.use(
  '/transfer',
  nobugdbMiddleware({ dataSource: ds, perRequestTransaction: true }),
);
```

## License

[MIT](./LICENSE)
