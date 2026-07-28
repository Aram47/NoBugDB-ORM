# Phase 5 — CHECK Constraints

## Goal

Добавить поддержку `CHECK` в migration DDL: table/column-level на `CREATE TABLE` и `ALTER TABLE … ADD/DROP CHECK`.

## Depends on

- [00-overview.md](./00-overview.md)
- v1 migrations ([`../plans/07-migrations.md`](../plans/07-migrations.md), [`MigrationBuilder`](../../src/migrations/types.ts))

## Engine surface

Из NoBugDB ARCHITECTURE / README / `check_constraint_test.cc`:

- `CREATE TABLE`: column-level sugar и table-level `CHECK (expression)` / `CONSTRAINT name CHECK (...)`.
- `ALTER TABLE … ADD [CONSTRAINT name] CHECK (...)` / `DROP CHECK name`.
- Enforcement на INSERT/UPDATE.
- NULL → predicate UNKNOWN → row accepted.
- v1: **нет** subquery и aggregates внутри CHECK.

## Public API (draft)

```ts
export interface ColumnBuilder {
  // existing...
  /** Column-level CHECK; expression is trusted SQL predicate fragment. */
  check(expression: string): this;
}

export interface TableBuilder {
  // existing column factories...
  /** Table-level named CHECK. */
  check(name: string, expression: string): this;
}

export interface AlterTableBuilder {
  // existing...
  addCheck(name: string, expression: string): void;
  dropCheck(name: string): void;
}
```

Примеры:

```ts
await ctx.schema.createTable('products', (t) => {
  t.int('id').primary();
  t.int('price').notNull().check('price >= 0');
  t.check('chk_range', 'price <= 1000000');
});

await ctx.schema.alterTable('products', (t) => {
  t.addCheck('chk_name', "name <> ''");
  t.dropCheck('chk_range');
});
```

## SQL generation

Согласовать с парсером NoBugDB (проверить на integration):

```sql
CREATE TABLE products (
  id INT PRIMARY KEY,
  price INT NOT NULL CHECK (price >= 0),
  CONSTRAINT chk_range CHECK (price <= 1000000)
);

ALTER TABLE products ADD CONSTRAINT chk_name CHECK (name <> '');
ALTER TABLE products DROP CHECK chk_name;
```

Если column-level `CHECK` в CREATE рендерится inline после типа — следовать формату, который принимают `check_constraint_test.cc` / parser.

Expression — **trusted** fragment (как body у views): без ORM-парсинга; документировать запрет subquery/aggregate.

Опционально лёгкая защита: `assertNoForbiddenCheckConstruct(expr)` отказывает на `SELECT`/`EXISTS`/`IN (` если выглядит как subquery — KISS, best-effort.

## Implementation steps

1. Расширить `ColumnBuilder` / `TableBuilder` / `AlterTableBuilder` + impl классы.
2. Обновить `sql-generator.ts` / create-table renderer.
3. Экспорт типов.
4. Unit-тесты генерации SQL.
5. Integration: CREATE + INSERT violating CHECK → ERROR; ALTER ADD/DROP.

## Tests

| Case | Expect |
|------|--------|
| column `.check(...)` | inline CHECK в CREATE |
| `t.check(name, expr)` | CONSTRAINT / table CHECK |
| `addCheck` / `dropCheck` | ALTER statements |
| violating INSERT (integration) | server ERROR |
| empty name / empty expr | ошибка ORM |

## Risks

- Расхождение синтаксиса CONSTRAINT vs unnamed CHECK — сверять с движком.
- 4 KiB на широких CREATE с несколькими CHECK.

## Definition of Done

- [ ] CREATE + ALTER CHECK в публичном migration API
- [ ] Unit + integration тесты
- [ ] JSDoc: no subquery/aggregate in CHECK
- [ ] Фазы 06 и 10 могут опираться на расширенный DDL builder
