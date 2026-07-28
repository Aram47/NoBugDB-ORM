# Phase 5 — Data Mapper Core

## Goal

Реализовать ядро ORM в стиле Data Mapper: metadata сущностей, `Repository`, `EntityManager`, Unit of Work и Identity Map. Сущности — обычные объекты данных **без** SQL-методов (`save` на entity нет).

## Depends on

- [04-types-and-query-builder.md](./04-types-and-query-builder.md)

## Design principles

- Entity = plain class / object + metadata (не Active Record)
- Persistence через `Repository` / `EntityManager`
- PK по умолчанию: клиентский **UUID** до INSERT
- Явный Unit of Work: `persist` / `remove` → `flush`

## Metadata API

Предпочтение v1: **`defineEntity` (code-first, без обязательных decorators)** — проще для ESM и `emitDecoratorMetadata`.

Decorators (`@Entity`, `@Column`) — опциональный сахар, если `experimentalDecorators` приемлем; не блокировать сборку без них.

```ts
export interface ColumnOptions {
  name?: string;
  type: NoBugDbDataType;
  primary?: boolean;
  unique?: boolean;
  nullable?: boolean;
  default?: unknown;
}

export interface EntitySchema<T> {
  name: string;           // class/logical name
  tableName: string;
  columns: Record<keyof T & string, ColumnOptions>;
}

export function defineEntity<T>(schema: EntitySchema<T>): EntityMetadata<T>;

export class MetadataRegistry {
  register(meta: EntityMetadata): void;
  getByTarget(target: string | Function): EntityMetadata;
  getByTable(table: string): EntityMetadata;
}
```

## Public API (draft)

```ts
export interface DataSourceOptions extends PoolOptions {
  entities: Array<EntityMetadata | EntitySchema<any>>;
}

export class DataSource {
  readonly isInitialized: boolean;
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  getRepository<T>(entity: string | EntityMetadata<T>): Repository<T>;
  manager: EntityManager;
  transaction<R>(fn: (manager: EntityManager) => Promise<R>): Promise<R>;
}

export class EntityManager {
  getRepository<T>(entity: string | EntityMetadata<T>): Repository<T>;
  create<T>(entity: EntityMetadata<T>, plain: Partial<T>): T;
  persist<T>(entity: T): void;
  remove<T>(entity: T): void;
  flush(): Promise<void>;
  clear(): void; // clear identity map + UoW
  find<T>(entity: EntityMetadata<T>, options?: FindOptions): Promise<T[]>;
  findOne<T>(entity: EntityMetadata<T>, options: FindOptions): Promise<T | null>;
  query(sql: string): Promise<QueryResult>; // escape hatch
}

export class Repository<T> {
  find(options?: FindOptions): Promise<T[]>;
  findOne(options: FindOptions): Promise<T | null>;
  findById(id: string): Promise<T | null>;
  insert(plain: Partial<T> | Partial<T>[]): Promise<T | T[]>;
  update(criteria: Partial<T>, patch: Partial<T>): Promise<number>;
  delete(criteria: Partial<T>): Promise<number>;
  save(entity: T | T[]): Promise<T | T[]>; // persist + flush shortcut
  count(options?: FindOptions): Promise<number>;
}

export interface FindOptions {
  where?: Record<string, unknown>;
  order?: Record<string, 'ASC' | 'DESC'>;
  limit?: number;
  offset?: number;
  select?: string[];
}
```

## Unit of Work + Identity Map

1. **Identity Map** — ключ `(tableName, pk)`; повторный SELECT той же строки возвращает тот же объект instance в пределах EM.
2. **UoW states:** `new` | `managed` | `removed` | `detached`
3. **`flush()` order:** INSERT new → UPDATE dirty managed → DELETE removed
4. **Dirty checking:** shallow compare snapshot at load vs current fields (KISS; deep nested objects — фаза 6 relations)

## PK generation

```ts
// on insert/persist if primary UUID column empty:
entity.id = randomUUID();
```

Документировать: приложение может задать UUID заранее.

## Mapping rows ↔ entities

- Использовать `TypeMapper.fromWire` + column metadata
- Column name mapping: property ↔ DB column (`name` option)
- Unknown columns in result: ignore or strict mode flag

## Implementation steps

1. `metadata/` — schema types, registry, `defineEntity`
2. `unit-of-work.ts` + `identity-map.ts`
3. `repository.ts` — CRUD через QueryBuilder + metadata
4. `entity-manager.ts` — facade
5. `data-source.ts` — lifecycle, pool ownership
6. Wire `DataSource.transaction` → `pool.transaction` + EM bound to sticky connection
7. Export from `src/index.ts`

## Example (target DX)

```ts
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
```

## Tests

- [ ] defineEntity registers metadata
- [ ] insert generates UUID PK
- [ ] find/findById maps types
- [ ] persist + flush inserts
- [ ] dirty update on flush
- [ ] remove + flush deletes
- [ ] identity map returns same reference
- [ ] transaction rolls back failed EM work
- [ ] Repository.save inserts and updates correctly

## Definition of Done

- [ ] DataSource / EntityManager / Repository работают end-to-end на CRUD
- [ ] Entities без Active Record методов
- [ ] UUID PK strategy documented
- [ ] Unit + integration tests зелёные

## Known limitations

- Relations / cascades — фаза 6
- Нет schema sync из metadata в БД автоматически (миграции — фаза 7)
- Нет optimistic locking / version column в v1
- Composite PK — отложить (NoBugDB поддерживает multi-column PK, но ORM v1 = single UUID PK)

## Out of scope

- Decorators-only API as requirement
- Lazy loading proxies
- Soft deletes
