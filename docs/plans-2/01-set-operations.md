# Phase 1 — Set Operations

## Goal

Добавить в QueryBuilder top-level set operations NoBugDB: `UNION`, `UNION ALL`, `INTERSECT`, `EXCEPT`.

## Depends on

- [00-overview.md](./00-overview.md)
- v1 QueryBuilder ([`../plans/04-types-and-query-builder.md`](../plans/04-types-and-query-builder.md))

## Engine surface

Из NoBugDB README / `set_operation_test.cc`:

- Операторы: `UNION` | `UNION ALL` | `INTERSECT` | `EXCEPT` (без `ALL` у INTERSECT/EXCEPT).
- Операнды: SELECT (или parenthesized SELECT); одинаковая ширина и exact `DataType` match.
- `ORDER BY` / `LIMIT` / `OFFSET` — только на outermost set-op.
- Не во views и не во вложенных subquery (движок: top-level only).

## Public API (draft)

```ts
export type SetOperationKind = 'union' | 'intersect' | 'except';

export interface SetOperationOptions {
  /** Only valid for UNION. Default false. */
  all?: boolean;
}

export class QueryBuilder {
  /**
   * Combine this SELECT with `other` via UNION / INTERSECT / EXCEPT.
   * Both builders must be SELECT statements (not INSERT/UPDATE/DELETE).
   */
  union(other: QueryBuilder, options?: { all?: boolean }): this;
  intersect(other: QueryBuilder): this;
  except(other: QueryBuilder): this;

  /** Chain additional set-op operands (left-associative). */
  // Implementation may store a list: (qb0 OP qb1) OP qb2 ...
}
```

Альтернатива (KISS, если цепочки редки): один метод

```ts
setOperation(kind: SetOperationKind, other: QueryBuilder, options?: SetOperationOptions): this;
```

плюс сахар `union` / `intersect` / `except`.

## Behaviour

1. Левый builder — текущий SELECT state; правый — другой `QueryBuilder` в SELECT-режиме.
2. `toSql()` / `execute()` рендерит:

```sql
(<left>) UNION [ALL] (<right>)
[ORDER BY ...] [LIMIT ...] [OFFSET ...]
```

Скобки — для безопасного nesting цепочек.

3. `ORDER BY` / `LIMIT` / `OFFSET`, заданные на **результирующем** builder после set-op, относятся к outermost expression.
4. `ORDER BY` / `LIMIT` на внутренних операндах — либо запретить с ясной ошибкой, либо рендерить только внутри скобок если движок это принимает; **предпочтение:** запретить на операндах до set-op (KISS, меньше сюрпризов). Проверить интеграционным тестом против NoBugDB.

## Escape / unsupported keywords

В [`src/query-builder/escape.ts`](../../src/query-builder/escape.ts):

- Убрать `UNION`, `INTERSECT`, `EXCEPT` из глобального `UNSUPPORTED_KEYWORDS` **или** пропускать проверку для SQL, собранного typed set-op API.
- `assertSupportedSqlFragment` для `sql.raw` по-прежнему может отказывать на этих словах **или** разрешать с предупреждением в docs — выбрать: **разрешить raw** (escape hatch) после фазы 1, т.к. движок поддерживает.

Не добавлять генерацию `INTERSECT ALL` / `EXCEPT ALL`.

## Implementation steps

1. Расширить внутренний `QueryBuilderState`: `setOps?: Array<{ kind; all?; right: QueryBuilderState | sql }>`.
2. Методы `union` / `intersect` / `except` — валидация «оба SELECT».
3. Рендерер set-op в `toSql()`.
4. `execute` / `executeCommand`: для set-op SELECT использовать тот же путь, что обычный SELECT (PREPARE если применимо; иначе literal SQL с size guard).
5. Обновить JSDoc класса QueryBuilder (убрать «rejects UNION»).
6. Unit-тесты рендера + integration против NoBugDB.

## Tests

| Case | Expect |
|------|--------|
| `qb.union(qb2).toSql()` | `(SELECT …) UNION (SELECT …)` |
| `union({ all: true })` | `UNION ALL` |
| `intersect` / `except` | корректные ключевые слова |
| Chain `a.union(b).except(c)` | вложенные скобки / left-assoc |
| Outer `orderBy` + `limit` after set-op | хвост только снаружи |
| Non-SELECT operand | `NoBugDbError` / `UNSUPPORTED_SQL` |
| Column count / type mismatch | ошибка от сервера (integration) |

## Risks

- 4 KiB buffer на длинных цепочках UNION.
- PREPARE + set-op: убедиться, что сервер принимает prepared set-op; иначе one-shot QUERY.

## Definition of Done

- [ ] `union` / `intersect` / `except` в публичном API и экспорте
- [ ] Unit + integration тесты зелёные
- [ ] Документация: top-level only; нет INTERSECT/EXCEPT ALL
- [ ] README Limitations больше не перечисляет UNION как unsupported (после merge фазы)
