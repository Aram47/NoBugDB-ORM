# Phase 6 — Partitioning

## Goal

Migration helpers для декларативного partitioning NoBugDB: parent `PARTITION BY RANGE|HASH` и children `PARTITION OF … FOR VALUES`.

## Depends on

- [00-overview.md](./00-overview.md)
- [05-check-constraints.md](./05-check-constraints.md) (общая DDL-поверхность; можно начать параллельно после overview, но лучше после стабилизации TableBuilder)
- v1 `MigrationBuilder`

## Engine surface

Из NoBugDB README / `partition_test.cc` / ARCHITECTURE:

- Parent: `CREATE TABLE … (…) PARTITION BY RANGE (col)` | `PARTITION BY HASH (col)`.
- Child RANGE: `CREATE TABLE child PARTITION OF parent FOR VALUES FROM (a) TO (b)`.
- Child HASH: `CREATE TABLE child PARTITION OF parent FOR VALUES WITH (MODULUS n, REMAINDER r)`.
- Parent catalog-only; INSERT routing + SELECT prune (`PartitionPrune` в EXPLAIN).
- DROP partition / parent cascade — поведение движка; ORM `dropTable` уже есть.
- Нет: SUBPARTITION, global indexes, FK на parent.

## Public API (draft)

```ts
export type PartitionStrategy = 'RANGE' | 'HASH';

export interface PartitionedTableOptions {
  strategy: PartitionStrategy;
  column: string;
}

export interface RangePartitionValues {
  from: unknown;
  to: unknown;
}

export interface HashPartitionValues {
  modulus: number;
  remainder: number;
}

export interface MigrationBuilder {
  // existing...

  createPartitionedTable(
    name: string,
    options: PartitionedTableOptions,
    fn: (t: TableBuilder) => void,
  ): Promise<void>;

  createPartition(
    name: string,
    parent: string,
    values: RangePartitionValues | HashPartitionValues,
  ): Promise<void>;
}
```

Пример:

```ts
await ctx.schema.createPartitionedTable(
  'sales',
  { strategy: 'RANGE', column: 'y' },
  (t) => {
    t.int('id').primary();
    t.int('y').notNull();
  },
);

await ctx.schema.createPartition('sales_2024', 'sales', { from: 2024, to: 2025 });
await ctx.schema.createPartition('sales_h0', 'sales_hash', { modulus: 4, remainder: 0 });
```

Литералы границ — через TypeMapper по типу колонки **или** принимать уже SQL-literal string в options для KISS:

```ts
values: { from: '2024', to: '2025' } // rendered as FROM (2024) TO (2025) with escape
```

Для INT — без кавычек; для STRING/DATE — с экранированием. Определять по runtime typeof + optional `type` в options.

## SQL generation

```sql
CREATE TABLE sales (
  id INT PRIMARY KEY,
  y INT NOT NULL
) PARTITION BY RANGE (y);

CREATE TABLE sales_2024 PARTITION OF sales FOR VALUES FROM (2024) TO (2025);

CREATE TABLE sales_h0 PARTITION OF sales_hash FOR VALUES WITH (MODULUS 4, REMAINDER 0);
```

## Implementation steps

1. Методы на `MigrationBuilder` + SQL helpers в `ddl/`.
2. Валидация: HASH values требуют modulus > 0, 0 ≤ remainder < modulus; RANGE — оба bound обязательны.
3. Документировать ограничения движка (no FK on parent, no SUBPARTITION).
4. Unit + integration (`partition_test` scenarios: insert routing optional; create/drop enough for ORM).

## Tests

| Case | Expect |
|------|--------|
| RANGE parent SQL | `PARTITION BY RANGE (col)` |
| HASH parent SQL | `PARTITION BY HASH (col)` |
| RANGE child | `FOR VALUES FROM (…) TO (…)` |
| HASH child | `WITH (MODULUS n, REMAINDER r)` |
| invalid remainder | ошибка ORM |
| integration create parent+child | OK |

## Risks

- Column list на PARTITION OF — движок может не принимать полный schema на child; не дублировать колонки в `createPartition`.
- Путаница drop parent vs child — документировать cascade поведение NoBugDB.

## Definition of Done

- [x] `createPartitionedTable` / `createPartition` в API
- [x] Unit + integration тесты
- [x] Limitations: no SUBPARTITION / no FK on parent в JSDoc и README фазы
