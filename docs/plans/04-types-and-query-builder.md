# Phase 4 — Types and Query Builder

## Goal

Ввести маппинг JS/TS ↔ типы NoBugDB и типобезопасный Query Builder, который генерирует **только** поддерживаемый SQL-subset, с параметризацией через PREPARE/EXECUTE или безопасный literal escaping.

## Depends on

- [03-pool-transactions.md](./03-pool-transactions.md)

## Type mapping

| NoBugDB | TypeScript | Wire / notes |
|---------|------------|--------------|
| INT / INTEGER | `number` (safe integer) or `bigint` policy: use `number` with range check | decimal string/int text |
| FLOAT / REAL / DOUBLE | `number` | |
| STRING / TEXT / VARCHAR | `string` | escape quotes |
| BOOLEAN / BOOL | `boolean` | `TRUE`/`FALSE` |
| DATE | `Date` (UTC date-only) or `string` `YYYY-MM-DD` — выбрать **`string` branded or `Date` truncated to date** | validate format |
| UUID | `string` | validate UUID canonical form |
| NULL | `null` | |

Реализовать:

```ts
export type NoBugDbDataType =
  | 'INT' | 'FLOAT' | 'STRING' | 'BOOLEAN' | 'DATE' | 'UUID';

export class TypeMapper {
  toSql(value: unknown, type: NoBugDbDataType): string;
  fromWire(raw: string | null, type: NoBugDbDataType): unknown;
}
```

## Query Builder — supported

- `SELECT` columns / `*`
- `FROM` + alias
- `INNER` / `LEFT` / `RIGHT` / `FULL` / `CROSS` `JOIN` … `ON`
- `WHERE` with `=`, `<>`, `<`, `>`, `<=`, `>=`, `AND`, `OR`, `NOT`, `IS NULL`, `IS NOT NULL`, `IN (...)`, `BETWEEN`, simple parentheses
- `DISTINCT`
- `GROUP BY` / `HAVING`
- `ORDER BY` ASC/DESC (by column name, **not** ordinal)
- `LIMIT` / `OFFSET`
- Aggregates: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`
- Scalars: `UPPER`, `LOWER`, `LENGTH` (optional helpers)
- `INSERT INTO … VALUES` (multi-row with size guard)
- `UPDATE … SET … WHERE`
- `DELETE FROM … WHERE`
- Raw fragment escape hatch: `sql.raw` — **documented dangerous**, only for trusted input

## Query Builder — must refuse

Генерировать ошибку `UnsupportedSqlFeatureError` (или `NoBugDbError` code `UNSUPPORTED_SQL`) для:

- `LIKE` / `ILIKE`
- `UNION` / `INTERSECT` / `EXCEPT`
- CTE `WITH`
- Window functions
- `INSERT … SELECT`
- `RETURNING`
- `ON CONFLICT` / UPSERT
- `ORDER BY 1` ordinals
- Subquery builders: можно отложить сложные correlated subqueries на v2; простые `IN (SELECT …)` — только если движок подтверждён тестами

## Public API (draft)

```ts
export class QueryBuilder {
  constructor(executor: { query(sql: string): Promise<QueryResult> });

  select(...columns: string[]): this;
  distinct(on?: boolean): this;
  from(table: string, alias?: string): this;
  leftJoin(table: string, on: string): this;
  // ... join variants
  where(clause: WhereInput): this;
  andWhere(clause: WhereInput): this;
  orWhere(clause: WhereInput): this;
  groupBy(...columns: string[]): this;
  having(clause: WhereInput): this;
  orderBy(column: string, dir?: 'ASC' | 'DESC'): this;
  limit(n: number): this;
  offset(n: number): this;

  insertInto(table: string): this;
  values(row: Record<string, unknown> | Record<string, unknown>[]): this;

  update(table: string): this;
  set(values: Record<string, unknown>): this;

  deleteFrom(table: string): this;

  toSql(): { sql: string };
  execute<T = Record<string, unknown>>(): Promise<T[]>; // SELECT
  executeCommand(): Promise<{ affectedRows: number }>; // DML
}

// Identifier quoting helper
export function quoteIdent(name: string): string;
export function escapeLiteral(value: unknown, type?: NoBugDbDataType): string;
```

Fluent API должен быть **иммутабельным или копирующим** (предпочтительно clone-on-write), чтобы не делить mutable state между ветками.

## Parameterization

### Strategy A — PREPARE/EXECUTE (preferred for Repository hot paths)

```sql
PREPARE orm_q_abc123 AS SELECT * FROM users WHERE id = $1;
EXECUTE orm_q_abc123('...');
DEALLOCATE PREPARE orm_q_abc123;
```

- Генерировать уникальные statement names per connection (`orm_` + random)
- Перед `release()` в pool: DEALLOCATE всех созданных в этом acquire **или** DEALLOCATE сразу после EXECUTE (проще для v1 — **prepare → execute → deallocate** в одном вызове)

### Strategy B — inline escaped literals

Для ad-hoc QB `toSql()` / one-shot.

Никогда не конкатенировать неэкранированный пользовательский ввод.

## Identifier rules

- Разрешить `[a-zA-Z_][a-zA-Z0-9_]*` или quote `"ident"`
- Reject injection via table/column names (`users; drop`)

## Size guards

- Перед execute: `Buffer.byteLength(sql) + overhead('QUERY|') < maxRequestBytes`
- Multi-row INSERT: батчить по размеру, не по «магическому N»

## Implementation steps

1. `src/types/type-mapper.ts` + validation helpers (UUID, DATE)
2. `src/query-builder/escape.ts` — ident + literal
3. `src/query-builder/where.ts` — structured where AST → SQL
4. `src/query-builder/query-builder.ts` — fluent API
5. `src/query-builder/prepared.ts` — prepare/execute/deallocate helper
6. Unit tests with snapshot SQL strings
7. Integration: CRUD against live DB

## Tests

- [ ] TypeMapper round-trip for each type + NULL
- [ ] Escape quotes in strings (`O'Brien`)
- [ ] WHERE AND/OR nesting
- [ ] JOIN + ORDER + LIMIT SQL snapshots
- [ ] INSERT multi-row splits when exceeding maxRequestBytes
- [ ] Reject LIKE / UNION / RETURNING
- [ ] Reject invalid identifiers
- [ ] Prepared path: unique names, deallocate

## Definition of Done

- [ ] QueryBuilder + TypeMapper экспортированы
- [ ] Unsupported features явно падают
- [ ] Size guard на месте
- [ ] Документация поддерживаемого SQL в JSDoc / короткий `docs/sql-support.md` (optional; можно секция в README на фазе 9)

## Known limitations

- Нет expression builder для произвольной арифметики в SET
- CASE / subqueries — минимальный support или v2
- Result rows всё ещё требуют column→type metadata из entity layer (фаза 5) для полного typed mapping; QB может принимать optional schema map

## Out of scope

- Entity decorators / Repository
- Migrations DDL builder (фаза 7 может переиспользовать escape helpers)
