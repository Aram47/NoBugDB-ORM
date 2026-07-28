# Phase 2 — Window Functions

## Goal

Typed helpers для window-функций NoBugDB: `ROW_NUMBER`, `RANK`, `DENSE_RANK`, running `SUM` / `AVG` с `OVER (PARTITION BY … ORDER BY …)`.

## Depends on

- [00-overview.md](./00-overview.md)
- Желательно [04-scalar-expressions.md](./04-scalar-expressions.md) (выражения в `SUM`/`AVG`)
- v1 QueryBuilder + `sql.*` fragments

## Engine surface

Из NoBugDB README / `window_function_test.cc`:

- Функции: `ROW_NUMBER()`, `RANK()`, `DENSE_RANK()`, `SUM(expr)`, `AVG(expr)` + `OVER (...)`.
- В `OVER`: `PARTITION BY` (опционально), `ORDER BY` (**обязателен** в v1).
- Frame для running aggregates фиксирован движком: `ROWS UNBOUNDED PRECEDING … CURRENT ROW` (не генерировать явный frame, если парсер его не принимает / не нужен).
- Колонки, упомянутые в `OVER`, должны присутствовать в SELECT list (resolve по именам проекции).
- Нет: LEAD/LAG/NTILE, named `WINDOW`, явный `ROWS BETWEEN` / `RANGE`.

## Public API (draft)

```ts
export interface OverSpec {
  partitionBy?: Array<string | SqlExpression>;
  orderBy: Array<string | SqlExpression | { column: string | SqlExpression; direction?: 'ASC' | 'DESC' }>;
}

export const sql = {
  // existing...
  rowNumber(): SqlExpression;
  rank(): SqlExpression;
  denseRank(): SqlExpression;
  // Reuse sum/avg — add over():
  // Option A: sql.sum(expr).over(spec)
  // Option B: sql.sumOver(expr, spec)
};

export interface SqlExpression {
  over(spec: OverSpec): SqlExpression;
}
```

Предпочтение **Option A**: цепочка `.over(spec)` на expression, возвращаемом `sql.sum` / `sql.avg` / ranking helpers.

Использование:

```ts
qb.select(
  'dept',
  'salary',
  sql.rowNumber().over({ partitionBy: ['dept'], orderBy: ['salary'] }).as('rn'),
  sql.sum('salary').over({ orderBy: [{ column: 'salary', direction: 'ASC' }] }).as('running'),
);
```

Если у `SqlExpression` ещё нет `.as(alias)` — добавить тонкий helper или принимать alias в `select(expr, alias)`.

## Escape / OVER keyword

- Сейчас `OVER` в `UNSUPPORTED_KEYWORDS`. После фазы: разрешить `OVER` в SQL, собранном typed helpers.
- Для `sql.raw('... OVER ...')`: разрешить (движок умеет) **или** оставить refuse — предпочтение: **разрешить**, т.к. surface движка официальный.
- Не генерировать LEAD/LAG и т.п.

## Validation (ORM-side, KISS)

1. `orderBy` в `OverSpec` не пустой → иначе `NoBugDbError('UNSUPPORTED_SQL', 'OVER requires ORDER BY')`.
2. Идентификаторы в `partitionBy` / `orderBy` — через `quoteIdent` / expression renderer.
3. Документировать требование движка: колонки OVER ⊆ SELECT list (ORM может soft-warn в JSDoc; жёсткая проверка опциональна).

## Implementation steps

1. Расширить `sql-fragments.ts`: ranking helpers + `over()` на expression.
2. Рендер: `ROW_NUMBER() OVER (PARTITION BY a ORDER BY b DESC)`.
3. Интегрировать в `select(...)` path (уже принимает `SqlExpression`).
4. Обновить `escape.ts` / docs QueryBuilder.
5. Unit + integration tests.

## Tests

| Case | Expect |
|------|--------|
| `rowNumber().over({ orderBy: ['id'] })` | `ROW_NUMBER() OVER (ORDER BY id)` |
| partition + order | `PARTITION BY … ORDER BY …` |
| `sum('x').over({ orderBy: ['x'] })` | `SUM(x) OVER (ORDER BY x)` |
| empty `orderBy` | ошибка ORM |
| EXPLAIN contains Window (integration) | plan line / success |

## Risks

- Alias / projection name mismatch с правилом «OVER columns in SELECT list».
- Путаница с aggregate `SUM` без OVER (GROUP BY) — один helper, два режима: без `.over()` = обычный aggregate.

## Definition of Done

- [ ] Helpers экспортированы через `sql`
- [ ] `OVER` больше не блокирует typed window SQL
- [ ] Unit + integration тесты
- [ ] JSDoc: только функции движка v1; ORDER BY обязателен
