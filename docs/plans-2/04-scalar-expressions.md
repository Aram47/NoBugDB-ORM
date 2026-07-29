# Phase 4 — Scalar Expressions

## Goal

Добавить в `sql.*` helpers все builtin-скаляры NoBugDB, которых ещё нет в ORM: `COALESCE`, `NULLIF`, `SUBSTRING`/`SUBSTR`, `CAST`, `CURRENT_DATE`.

## Depends on

- [00-overview.md](./00-overview.md)
- v1 [`sql-fragments.ts`](../../src/query-builder/sql-fragments.ts) (уже: `count`/`sum`/`avg`/`min`/`max`/`upper`/`lower`/`length`)

## Engine surface

Из NoBugDB `scalar_function.cc` / README:

| Builtin | Notes |
|---------|--------|
| `UPPER` / `LOWER` / `LENGTH` | уже в ORM |
| `COALESCE(a, b, …)` | varargs |
| `NULLIF(a, b)` | |
| `SUBSTRING(s, start[, len])` / `SUBSTR` | ORM генерирует `SUBSTRING` |
| `CURRENT_DATE` | без аргументов |
| `CAST(expr AS type)` | dedicated AST; types: INT/FLOAT/STRING/BOOLEAN/DATE/UUID |

Unknown function names → server error (не silent NULL). UDF из `CREATE FUNCTION` резолвятся после builtins — вызов UDF через `sql.fn(name, ...args)` можно добавить тонко здесь же или отложить на [08-routines.md](./08-routines.md); **в этой фазе** — только builtins + опционально generic `sql.fn` для будущих UDF.

## Public API (draft)

```ts
export const sql = {
  // existing aggregates + upper/lower/length...

  coalesce(...args: Array<string | SqlExpression | SqlRaw | null>): SqlExpression;
  nullif(
    a: string | SqlExpression | SqlRaw,
    b: string | SqlExpression | SqlRaw | unknown,
  ): SqlExpression;
  substring(
    source: string | SqlExpression | SqlRaw,
    start: number | SqlExpression,
    length?: number | SqlExpression,
  ): SqlExpression;
  cast(expr: string | SqlExpression | SqlRaw, type: NoBugDbDataType): SqlExpression;
  currentDate(): SqlExpression;

  /** Generic function call for builtins/UDF; identifiers validated. */
  fn(name: string, ...args: Array<string | SqlExpression | SqlRaw | unknown>): SqlExpression;
};
```

Рендер:

```sql
COALESCE(a, b, c)
NULLIF(a, b)
SUBSTRING(name, 1, 3)
CAST(x AS INT)
CURRENT_DATE
```

Литералы в аргументах — через `TypeMapper` / `escapeLiteral`, колонки — `quoteIdent` если строка-идентификатор; различать column ref vs literal по существующим правилам fragments (как у `upper`).

## Implementation steps

1. Реализовать helpers в `sql-fragments.ts`.
2. Экспорт из `src/index.ts` (если `sql` уже экспортируется — только расширить объект).
3. Unit-тесты рендера каждого helper.
4. Integration: SELECT с CAST/COALESCE/CURRENT_DATE против NoBugDB.
5. Кратко обновить README «Supported scalars».

## Tests

| Case | Expect |
|------|--------|
| `coalesce('a', 'b')` | `COALESCE(a, b)` |
| `nullif('a', 0)` with typed literal | корректный NULLIF |
| `substring('name', 1, 2)` | `SUBSTRING(name, 1, 2)` |
| `cast('id', 'INT')` | `CAST(id AS INT)` |
| `currentDate()` | `CURRENT_DATE` |
| invalid cast type | ошибка ORM на этапе построения |

## Risks

- Путаница string-as-column vs string-as-literal — следовать паттерну существующих `upper`/`length`.
- `CAST` type names должны совпадать с NoBugDB (`INT`, `FLOAT`, `STRING`, …).

## Definition of Done

- [x] Все перечисленные builtins доступны через `sql.*`
- [x] Unit (+ желательно integration) тесты
- [x] Нет дублирования мёртвых helper-ов
- [x] Фаза 02 может опираться на эти expressions в `SUM`/`AVG`
