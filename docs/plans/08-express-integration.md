# Phase 8 — Express Integration

## Goal

Тонкий опциональный слой для Express: инициализация DataSource, request-scoped `EntityManager`, graceful shutdown. Ядро ORM остаётся framework-agnostic.

## Depends on

- [05-data-mapper-core.md](./05-data-mapper-core.md)
- [07-migrations.md](./07-migrations.md) optional for sample app

## Design

- Entry: `nobugdb-orm/express` subpath export (не тащить `express` в обязательные dependencies)
- `peerDependencies`: `express` `>=4`
- Middleware создаёт или достаёт EM; **не** открывает TX на каждый request по умолчанию

## Public API (draft)

```ts
import type { Request, Response, NextFunction } from 'express';
import type { DataSource, EntityManager } from 'nobugdb-orm';

export interface ExpressOrmOptions {
  dataSource: DataSource;
  /** Property on Request, default 'em' */
  property?: string;
  /**
   * If true, wrap each request in dataSource.transaction.
   * Default false — handlers call em / repositories; use transaction explicitly when needed.
   */
  perRequestTransaction?: boolean;
}

export function nobugdbMiddleware(options: ExpressOrmOptions) {
  return function (req: Request, res: Response, next: NextFunction): void;
}

export function getEntityManager(req: Request): EntityManager;

export function attachDataSource(
  app: { locals: Record<string, unknown> },
  ds: DataSource,
): void;

export async function gracefulShutdown(
  ds: DataSource,
  server: { close: (cb: (err?: Error) => void) => void },
): Promise<void>;
```

### Request typing (docs)

```ts
declare global {
  namespace Express {
    interface Request {
      em: EntityManager;
    }
  }
}
```

Опубликовать optional `express.d.ts` augmentation example в README, не обязательно глобально в пакете.

## package.json exports

```json
{
  "exports": {
    ".": { "...": "..." },
    "./express": {
      "types": "./dist/esm/express/index.d.ts",
      "import": "./dist/esm/express/index.js",
      "require": "./dist/cjs/express/index.js"
    }
  }
}
```

## Implementation steps

1. `src/express/middleware.ts` — create EM per request from `DataSource.manager` fork **or** lightweight EM bound to pool
   - Важно: shared Identity Map между запросами **запрещён** — новый EM (или `clear()`) на request
2. Optional `perRequestTransaction` using `dataSource.transaction`
3. Error propagation: TX rollback on `next(err)` if perRequestTransaction
4. `gracefulShutdown`: stop accepting → `ds.destroy()` → `server.close`
5. Example snippet in docs (не обязательно отдельный app в монорепо)

## Recommended Express usage pattern

```ts
const ds = new DataSource({ /* ... */ entities: [User] });
await ds.initialize();

app.use(nobugdbMiddleware({ dataSource: ds }));

app.get('/users/:id', async (req, res, next) => {
  try {
    const user = await req.em.getRepository(User).findById(req.params.id);
    if (!user) return res.status(404).end();
    res.json(user);
  } catch (e) {
    next(e);
  }
});

app.post('/transfer', async (req, res, next) => {
  try {
    await ds.transaction(async (em) => {
      // multi-write
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
```

Для multi-write предпочтительнее явный `ds.transaction`, а не глобальный per-request TX.

## Tests

- [ ] Middleware sets `req.em`
- [ ] Two requests get different EM / identity maps
- [ ] `perRequestTransaction` rolls back when handler throws
- [ ] `getEntityManager` throws if middleware missing
- [ ] peerDependency: package builds without express installed (types only in express entry) — verify build graph

## Definition of Done

- [ ] Subpath `nobugdb-orm/express` опубликован в exports
- [ ] peerDependency на express
- [ ] Пример в README
- [ ] Ядро не импортирует express

## Known limitations

- Нет NestJS module / Fastify plugin в v1
- AsyncLocalStorage optional enhancement — можно добавить если middleware неудобен; не блокер
- Не управляет HTTP server lifecycle кроме helper shutdown

## Out of scope

- Auth middleware for NoBugDB users
- Session store on NoBugDB
