# Phase 8 — Routines (Functions, Procedures, CALL)

## Goal

Покрыть SQL-routines NoBugDB: `CREATE`/`DROP FUNCTION`, `CREATE`/`DROP PROCEDURE`, и клиентский `CALL` через migrations + DataSource helper.

## Depends on

- [00-overview.md](./00-overview.md)
- v1 migrations + DataSource
- Опционально [04-scalar-expressions.md](./04-scalar-expressions.md) (`sql.fn` для вызова UDF в SELECT)

## Engine surface

Из NoBugDB README:

**Function (scalar UDF):**

```sql
CREATE FUNCTION double_it(x INT) RETURNS INT AS $$
RETURN x * 2;
$$;
-- short forms: AS (expr) / AS expr
DROP FUNCTION double_it;
```

**Procedure:**

```sql
CREATE PROCEDURE add_user(uid INT, uname STRING) AS $$
INSERT INTO users VALUES (uid, uname);
$$;
DROP PROCEDURE add_user;
CALL add_user(1, 'Ada');
```

- IN params only; нет OUT/INOUT / table-valued.
- Function body: RETURN expr; procedure: semicolon-separated statements; no nested TX-`BEGIN`.
- Name must not collide with builtin (server error).
- Reader role: CALL denied; admin for DDL.

## Public API (draft)

```ts
export interface RoutineParam {
  name: string;
  type: NoBugDbDataType;
}

export interface CreateFunctionOptions {
  params: RoutineParam[];
  returns: NoBugDbDataType;
  /** Body inside $$ or short expression mode */
  body: string;
  /** default 'dollar' → AS $$ body $$; 'expr' → AS (body) */
  style?: 'dollar' | 'expr';
}

export interface CreateProcedureOptions {
  params: RoutineParam[];
  body: string; // AS $$ stmts $$
}

export interface MigrationBuilder {
  createFunction(name: string, options: CreateFunctionOptions): Promise<void>;
  dropFunction(name: string): Promise<void>;
  createProcedure(name: string, options: CreateProcedureOptions): Promise<void>;
  dropProcedure(name: string): Promise<void>;
  /** Optional: CALL inside migration */
  call(name: string, args?: unknown[]): Promise<void>;
}

export class DataSource {
  /** Execute CALL name(args) and return QueryResult */
  callProcedure(name: string, args?: unknown[]): Promise<QueryResult>;
}
```

Пример миграции:

```ts
await ctx.schema.createFunction('double_it', {
  params: [{ name: 'x', type: 'INT' }],
  returns: 'INT',
  body: 'RETURN x * 2;',
});

await ctx.schema.createProcedure('add_user', {
  params: [
    { name: 'uid', type: 'INT' },
    { name: 'uname', type: 'STRING' },
  ],
  body: 'INSERT INTO users (id, name) VALUES (uid, uname);',
});
```

Клиент:

```ts
await ds.callProcedure('add_user', [1, 'Ada']);
// SELECT double_it(id) via QueryBuilder + sql.fn('double_it', 'id')
```

## SQL generation

Параметры: `name TYPE` через `quoteIdent` + type token.

Аргументы CALL: TypeMapper literals (INT без кавычек, STRING escaped, …).

Size guard на DDL body (~4 KiB).

## Implementation steps

1. DDL generators + MigrationBuilder methods.
2. `DataSource.callProcedure` / при желании `EntityManager.callProcedure` делегат.
3. Расширить `sql.fn` (если ещё не сделано в фазе 04) для UDF в SELECT.
4. Unit + integration: create function, SELECT uses it; create procedure, CALL; drop.
5. Документировать: no OUT params; reader cannot CALL; no nested BEGIN in body.

## Tests

| Case | Expect |
|------|--------|
| createFunction dollar style | valid CREATE FUNCTION SQL |
| createFunction expr style | `AS (…)` / `AS …` |
| createProcedure + CALL | integration OK |
| dropFunction / dropProcedure | DROP SQL |
| callProcedure args escaping | STRING quotes correct |
| empty name | ошибка ORM |

## Risks

- Short AS forms vs `RETURN` inside `$$` — тестировать оба style против парсера.
- Collision with builtins (`UPPER`, …) — полагаться на ошибку сервера.
- Wire size for large procedure bodies.

## Definition of Done

- [ ] CREATE/DROP FUNCTION|PROCEDURE в migrations
- [ ] `DataSource.callProcedure` работает
- [ ] Unit + integration тесты
- [ ] Limitations OUT/INOUT / nested BEGIN задокументированы
