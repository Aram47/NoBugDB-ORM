# Phase 6 — Relations and Schema Metadata

## Goal

Добавить описание связей (relations) и загрузку через JOIN, опираясь на FK NoBugDB. Зафиксировать registry схемы приложения без runtime `information_schema`.

## Depends on

- [05-data-mapper-core.md](./05-data-mapper-core.md)

## Relation kinds (v1)

| Kind | DB shape | Load strategy v1 |
|------|----------|------------------|
| `many-to-one` | FK on owner | JOIN or follow-up SELECT |
| `one-to-many` | inverse of M2O | JOIN / separate SELECT by FK |
| `one-to-one` | FK unique | as M2O with uniqueness |
| `many-to-many` | join table | explicit join entity **or** auto join-table metadata |

Для KISS в v1: **many-to-one + one-to-many обязательны**; one-to-one как частный случай; many-to-many через явную join-entity (две M2O), без скрытой magic join-table если это усложняет.

## Metadata extension

```ts
export interface RelationOptions {
  type: 'many-to-one' | 'one-to-many' | 'one-to-one';
  target: string;              // entity name
  joinColumn?: string;         // FK column on this table (M2O / O2O owning)
  inverseSide?: string;        // property on target
  nullable?: boolean;
  onDelete?: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
}

// on EntitySchema
relations?: Record<string, RelationOptions>;
```

FK DDL сам по себе создаётся миграциями (фаза 7); metadata нужна ORM для JOIN и persist order.

## Find options

```ts
export interface FindOptions {
  // ... from phase 5
  relations?: string[];  // e.g. ['author', 'author.profile']
}
```

### Loading strategy (v1 — explicit, no Proxy lazy)

- Default: relations **не** грузятся
- `relations: ['author']` → LEFT JOIN + hydrate nested object
- Nested path depth limit (e.g. 3) — защита от explosion
- Circular graphs: identity map предотвращает дубликаты объектов

Lazy loading proxies **не** делать в v1 (сложность + скрытые query).

## Persist / flush with relations

1. Insert order: parents before children when FK required
2. Delete order: children before parents unless DB `ON DELETE CASCADE`
3. Assigning `post.author = authorEntity` пишет FK column `author_id` при flush
4. Cascades в ORM (`cascade: ['insert']`) — **опционально minimal**; иначе только FK field assignment (предпочтительнее KISS)

## Schema metadata module

```ts
export class SchemaRegistry {
  // aggregates all EntityMetadata
  tables(): TableMetadata[];
  assertConsistent(): void; // FK targets exist, join columns exist, types match
}
```

`DataSource.initialize()` вызывает `assertConsistent()`.

**Нет** сравнения с живой БД в v1 (нет introspection). Опционально позже: `schema: 'validate'` через пробные queries — не блокер.

## Implementation steps

1. Расширить `defineEntity` / metadata типами relations
2. `RelationHydrator` — map flat JOIN rows → nested entities
3. QueryBuilder helpers: `leftJoin` from relation metadata
4. Flush ordering graph (topological by FK)
5. `SchemaRegistry.assertConsistent`
6. Tests for M2O / O2M load + persist FK

## Tests

- [ ] Metadata rejects unknown target entity
- [ ] find with `relations: ['author']` hydrates author
- [ ] one-to-many loads collection array
- [ ] flush inserts parent then child FK
- [ ] Identity map: same author shared across posts
- [ ] Depth limit enforced
- [ ] Views: documenting that relation targets must be base tables for writes

## Definition of Done

- [ ] M2O и O2M работают через FindOptions.relations
- [ ] Schema consistency check на initialize
- [ ] Документировано: no lazy load, no DB introspection
- [ ] Cascade ORM минимален или отсутствует — поведение явно описано

## Known limitations

- NoBugDB views read-only — не мапить writable entities на views
- Many-to-many без join-entity — v2
- Partial/select of relation columns — basic only
- N+1 если пользователь грузит relations вручную циклом — дать JOIN path как default recommendation

## Out of scope

- GraphQL dataloaders
- Automatic schema diff against database
- Polymorphic associations
