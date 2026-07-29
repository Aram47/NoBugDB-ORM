# Phase 9 — Admin Commands (EXPLAIN, VACUUM)

## Goal

Тонкие typed-обёртки над `EXPLAIN` и `VACUUM` NoBugDB на `DataSource` / `EntityManager`.

## Depends on

- [00-overview.md](./00-overview.md)
- v1 `DataSource.query` / Connection QUERY path

## Engine surface

**EXPLAIN** (README / `explain_test.cc`):

- Prefix: `EXPLAIN <statement>`.
- Statement is executed; result set column `QUERY PLAN` (access path, join method, `PartitionPrune`, `Window`, `ViewScan`, …).
- Reader may EXPLAIN allowed (read) statements.

**VACUUM** (ARCHITECTURE / AST):

- SQL `VACUUM` — version GC / cleanup path alongside commit/rollback vacuum and background worker.
- Engine also parses `VACUUM table`, but Phase 9 ORM API exposes **bare `VACUUM` only**.

## Public API

```ts
export interface ExplainResult {
  /** Raw plan lines from QUERY PLAN column */
  plan: string[];
  /** Full QueryResult if caller needs columns/rows */
  raw: QueryResult;
}

export class DataSource {
  explain(sql: string): Promise<ExplainResult>;
  /** Prefer passing QueryBuilder when available */
  explainQuery(qb: QueryBuilder): Promise<ExplainResult>;

  vacuum(): Promise<QueryResult>;
}

export class EntityManager {
  explain(sql: string): Promise<ExplainResult>;
  vacuum(): Promise<QueryResult>;
}
```

Поведение:

```ts
const { plan } = await ds.explain('SELECT * FROM users WHERE id = 1');
// sends: EXPLAIN SELECT * FROM users WHERE id = 1

await ds.explainQuery(qb.select('*').from('users').where({ active: true }));
// EXPLAIN + qb.toSql()

await ds.vacuum();
// VACUUM
```

Не дублировать парсинг плана — вернуть строки как есть.

## Validation

1. `explain(sql)`: sql не должен уже начинаться с `EXPLAIN` (или normalize strip) — KISS: если начинается, не дублировать prefix.
2. Reject empty sql.
3. `vacuum()` — bare only; per-table option not exposed in Phase 9.

## Implementation steps

1. Helpers в `data-source` (или маленький `src/admin/`).
2. Прокинуть на `EntityManager` через тот же executor.
3. Unit: формирование SQL prefix; mock result → `plan` lines.
4. Integration: EXPLAIN SELECT returns non-empty plan; VACUUM succeeds as admin.

## Tests

| Case | Expect |
|------|--------|
| `explain('SELECT 1')` | QUERY `EXPLAIN SELECT 1` |
| already prefixed | no double EXPLAIN |
| `explainQuery(qb)` | EXPLAIN + select SQL |
| `vacuum()` | `VACUUM` |
| empty sql | ошибка ORM |

## Risks

- EXPLAIN выполняет statement (side effects) — документировать явно в JSDoc.
- VACUUM syntax drift — сверить с parser перед merge.

## Definition of Done

- [x] `explain` / `vacuum` на DataSource (и EM)
- [x] Unit + integration тесты
- [x] JSDoc: EXPLAIN executes the statement; role requirements
