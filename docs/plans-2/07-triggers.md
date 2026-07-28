# Phase 7 — Triggers

## Goal

Добавить в migration API создание и удаление row-level триггеров NoBugDB: `CREATE TRIGGER` / `DROP TRIGGER`.

## Depends on

- [00-overview.md](./00-overview.md)
- v1 `MigrationBuilder` (`createView`/`raw` как образец trusted SQL body)

## Engine surface

Из NoBugDB README / `trigger_test.cc` / ARCHITECTURE:

```sql
CREATE TRIGGER name
  BEFORE|AFTER INSERT|UPDATE|DELETE ON table
  FOR EACH ROW
  EXECUTE $$ ... $$;

DROP TRIGGER name;
```

- Только **row-level** BEFORE/AFTER + INSERT|UPDATE|DELETE.
- Body: statements; `NEW`/`OLD` column refs; `SET NEW.col = expr` в BEFORE INSERT/UPDATE; допускается `CALL`.
- Recursion depth capped at 16.
- Persist under `data/_triggers/*.trig`.
- Нет: statement-level, INSTEAD OF, WHEN clause.

## Public API (draft)

```ts
export type TriggerTiming = 'BEFORE' | 'AFTER';
export type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export interface CreateTriggerOptions {
  timing: TriggerTiming;
  event: TriggerEvent;
  table: string;
  /** SQL body inside $$ ... $$ (trusted). Semicolon-separated statements. */
  body: string;
}

export interface MigrationBuilder {
  // existing...
  createTrigger(name: string, options: CreateTriggerOptions): Promise<void>;
  dropTrigger(name: string): Promise<void>;
}
```

Пример:

```ts
await ctx.schema.createTrigger('trg_users_bi', {
  timing: 'BEFORE',
  event: 'INSERT',
  table: 'users',
  body: `SET NEW.name = UPPER(NEW.name);`,
});

await ctx.schema.dropTrigger('trg_users_bi');
```

## SQL generation

```sql
CREATE TRIGGER trg_users_bi BEFORE INSERT ON users FOR EACH ROW EXECUTE $$
SET NEW.name = UPPER(NEW.name);
$$;

DROP TRIGGER trg_users_bi;
```

Проверить точный синтаксисdelimiter/`EXECUTE $$` по parser/tests движка; не изобретать `FOR EACH STATEMENT`.

Body size: fail-fast если весь QUERY превышает ~4 KiB wire limit.

## Implementation steps

1. Типы + методы `MigrationBuilder`.
2. SQL helper `generateCreateTriggerSql` / `generateDropTriggerSql`.
3. Валидация enum timing/event; non-empty name/table/body.
4. Unit + integration (INSERT fires BEFORE trigger with SET NEW).
5. Документация: SET NEW only BEFORE INSERT/UPDATE; depth 16; no WHEN/INSTEAD OF.

## Tests

| Case | Expect |
|------|--------|
| create BEFORE INSERT | SQL matches engine grammar |
| create AFTER DELETE | OK |
| dropTrigger | `DROP TRIGGER name` |
| empty body | ошибка ORM |
| integration SET NEW | inserted row reflects trigger |
| unsupported combo (document only) | — |

## Risks

- Dollar-quoting вложенных `$$` в body — документировать: не использовать `$$` внутри body без тегов движка (движок может не поддерживать tagged dollars) → body без `$$`.
- Auth: DDL требует admin role.

## Definition of Done

- [ ] `createTrigger` / `dropTrigger` экспортированы
- [ ] Unit + integration тесты
- [ ] JSDoc отражает row-level only + SET NEW rules
- [ ] Size guard на wire buffer
