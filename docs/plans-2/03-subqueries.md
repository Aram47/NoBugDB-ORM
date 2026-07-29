# Phase 3 — Subqueries

## Goal

Дать QueryBuilder API для subquery-выражений, которые NoBugDB уже исполняет: `IN (SELECT…)`, `EXISTS` / `NOT EXISTS`, scalar subquery в SELECT/WHERE.

## Depends on

- [00-overview.md](./00-overview.md)
- v1 QueryBuilder + WHERE compiler ([`../plans/04-types-and-query-builder.md`](../plans/04-types-and-query-builder.md))
- Полезно до сложных композиций с [01-set-operations.md](./01-set-operations.md) (set-ops не вкладывать в subquery)

## Engine surface

Из NoBugDB `subquery_test.cc` / README:

- Scalar subquery в выражениях.
- `IN` / `NOT IN` (list или subquery).
- `EXISTS` / `NOT EXISTS`.
- Correlated subqueries поддерживаются движком.
- Set operations **не** поддерживаются внутри subquery — ORM не должен предлагать `union` внутри subquery builder без ошибки.

## Public API (draft)

```ts
export class QueryBuilder {
  /** Use this builder as a parenthesized SELECT fragment (no execute). */
  toSubquerySql(): string;

  whereIn(column: string, values: unknown[]): this; // already via WhereInput `in`
  whereInSubquery(column: string, sub: QueryBuilder): this;
  whereNotInSubquery(column: string, sub: QueryBuilder): this;

  whereExists(sub: QueryBuilder): this;
  whereNotExists(sub: QueryBuilder): this;
}

// WhereInput extension (optional, consistent with object WHERE):
export interface WhereInSubquery {
  inSubquery: QueryBuilder;
}
export interface WhereExists {
  exists: QueryBuilder;
}
```

Scalar subquery в SELECT:

```ts
qb.select(
  'id',
  sql.subquery(
    new QueryBuilder(exec).select(sql.count('*')).from('orders').where({ user_id: sql.ref('u.id') })
  ).as('order_count'),
).from('users', 'u');
```

Корреляция: разрешить `sql.ref('outer.col')` / qualified identifiers в inner WHERE (уже есть column refs).

## Behaviour

1. Inner `QueryBuilder` обязан быть SELECT; иначе ошибка.
2. Inner не должен содержать top-level set-op state (если фаза 01 уже есть) → `UNSUPPORTED_SQL`.
3. Рендер: `EXISTS (SELECT …)`, `col IN (SELECT …)`, `(SELECT …)` для scalar.
4. Параметризация: для nested SELECT предпочтительно one-shot escaped SQL **или** тот же PREPARE path, что outer — выбрать путь с меньшей сложностью (KISS: скомпилировать inner в SQL fragment с literal escaping через TypeMapper; PREPARE только outer если просто).

## Implementation steps

1. `toSubquerySql()` — `(${selectSql})` без trailing semicolon.
2. WHERE compiler: ветки `inSubquery` / `exists`.
3. `sql.subquery(qb)` → `SqlExpression`.
4. Запрет set-op / non-SELECT inner.
5. Unit tests на рендер; integration: IN subquery, EXISTS, correlated, scalar.

## Tests

| Case | Expect |
|------|--------|
| `whereInSubquery('id', sub)` | `id IN (SELECT …)` |
| `whereExists(sub)` | `EXISTS (SELECT …)` |
| `whereNotExists` | `NOT EXISTS (…)` |
| scalar in select list | `(SELECT …) AS alias` |
| correlated column ref | SQL содержит outer qualifier; integration OK |
| inner INSERT builder | ошибка ORM |
| inner with `.union(...)` | ошибка ORM |

## Risks

- Prefixed aliases / ambiguous columns в correlated queries.
- 4 KiB при глубокой вложенности.
- Двойной escape при вложении PREPARE — избегать nested PREPARE.

## Definition of Done

- [x] `whereInSubquery` / `whereExists` / `sql.subquery` в API
- [x] Unit + integration (включая correlated)
- [x] Документирован запрет set-op внутри subquery
- [x] Нет мёртвого кода в WHERE compiler
