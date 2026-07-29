# Phase 10 — Keys and Constraints

## Goal

Согласовать entity metadata и migration DDL с возможностями NoBugDB по ключам: composite PRIMARY KEY, non-UUID PK (client-supplied), multi-column UNIQUE — без введения SERIAL/sequences (их в движке нет).

## Depends on

- [00-overview.md](./00-overview.md)
- [05-check-constraints.md](./05-check-constraints.md) (AlterTableBuilder expansions)
- v1 `defineEntity`, `EntityMapper`, `Repository`, migrations DDL

## Engine surface

NoBugDB:

- `PRIMARY KEY` — single или multi-column на CREATE; `ALTER … ADD/DROP PRIMARY KEY`.
- `UNIQUE` — column/table; `ALTER … ADD/DROP UNIQUE (col)` (проверить multi-col UNIQUE в CREATE TABLE / ALTER по parser).
- Нет SERIAL / auto-increment — значения PK задаёт клиент (или DEFAULT, если задан).

ORM v1 сегодня ([`define-entity.ts`](../../src/metadata/define-entity.ts)):

- `defineEntity` требует **ровно один** PK типа **UUID**.
- Relation `joinColumn` тоже обязан быть UUID.
- `AlterTableBuilder.addUnique` / `addPrimaryKey` — одна колонка.
- `Repository.findById(id: string)` — scalar UUID.
- `EntityMetadata.primaryKey` — одно поле `keyof T`, не массив.

## Public API (draft)

### Migrations

```ts
export interface TableBuilder {
  // existing column factories...
  /** Table-level composite primary key */
  primaryKey(...columns: string[]): this;
  /** Table-level composite unique */
  unique(name: string | null, ...columns: string[]): this;
}

export interface AlterTableBuilder {
  addPrimaryKey(...columns: string[]): void; // was single column
  addUnique(...columns: string[]): void;     // multi-col
  dropUnique(...columns: string[]): void;
}
```

SQL:

```sql
CREATE TABLE order_items (
  order_id UUID NOT NULL,
  product_id UUID NOT NULL,
  qty INT NOT NULL,
  PRIMARY KEY (order_id, product_id),
  UNIQUE (order_id, product_id) -- if redundant with PK, skip in examples
);

ALTER TABLE t ADD PRIMARY KEY (a, b);
ALTER TABLE t ADD UNIQUE (a, b);
```

Сверять multi-col ALTER UNIQUE с движком; если ALTER только single-column — поддержать multi только в CREATE, а в ALTER документировать ограничение.

### Entity metadata

```ts
export interface ColumnOptions {
  name?: string;
  type: NoBugDbDataType;
  primary?: boolean; // true on each part of composite key
  unique?: boolean;
  nullable?: boolean;
  default?: unknown;
  /** If primary and type UUID: auto-generate on persist when missing (default true for UUID). */
  generated?: 'uuid' | false;
}

export interface EntitySchema<T> {
  name: string;
  tableName: string;
  columns: Record<keyof T & string, ColumnOptions>;
  /** Explicit composite PK order; optional if single primary column */
  primaryColumns?: Array<keyof T & string>;
}
```

Правила:

1. Хотя бы одна primary-колонка (или `primaryColumns`).
2. UUID PK: по умолчанию generate v4/v7 before INSERT, если значение отсутствует.
3. INT/STRING/… PK: **не** генерировать; обязательны до flush (ошибка если missing).
4. Composite: `findById` принимает объект ключа или вводится `findByIds(key: Partial<T> | Record<string, unknown>)`.

```ts
export class Repository<T> {
  findById(id: PrimaryKeyValue<T>): Promise<T | null>;
}

type PrimaryKeyValue<T> =
  | string              // single UUID/string/int-as compatible — keep overload
  | number
  | Record<string, unknown>; // composite
```

Identity Map key: стабильная сериализация всех PK parts (`table|v1|v2`).

### Breaking / semver

- Ослабление «UUID-only» — **minor**, если single non-UUID PK opt-in и UUID path без изменений.
- Смена сигнатуры `findById` на union — обычно minor в TS; задокументировать в CHANGELOG.
- Если ужесточаем/ломаем runtime assert «must be UUID» — major только если удаляем старый путь; предпочтение: **сохранить UUID default**, разрешить другие типы.

## Implementation steps

1. Migration SQL: composite PK/UNIQUE на CREATE; расширить ALTER где движок позволяет.
2. `defineEntity` / `SchemaRegistry`: валидация composite + non-UUID; убрать hard fail «only UUID»; `primaryKey` → `primaryKeys: string[]` (с deprecated getter `primaryKey` для single-key back-compat).
3. Снять UUID-only assert с relation `joinColumn` (тип FK = тип PK родителя).
4. `EntityMapper` + UoW insert: generate UUID только для `generated !== false` && type UUID.
5. `Repository.findById` / IdentityMap: composite keys.
6. Unit + integration: INT PK insert/find; composite PK; unique multi-col migration SQL; M2O на INT PK.

## Tests

| Case | Expect |
|------|--------|
| CREATE composite PK SQL | `PRIMARY KEY (a, b)` |
| CREATE multi UNIQUE | `UNIQUE (a, b)` |
| entity INT PK without value on flush | ошибка ORM |
| entity UUID PK without value | auto UUID |
| `findById({ a, b })` | WHERE a=? AND b=? |
| Identity Map composite | same instance on re-find |
| migration ALTER multi unique | SQL or documented skip if engine-limited |

## Risks

- Relation loader / flush order завязаны на scalar id — регрессии.
- `orm_migrations` history table остаётся STRING PK — не трогать.
- Документы v1 (README Limitations «UUID primary keys») обновить после кода.

## Definition of Done

- [x] Composite PK + non-UUID PK в metadata и Repository
- [x] Multi-column UNIQUE (CREATE; ALTER если движок умеет)
- [x] UUID auto-generate сохранён по умолчанию для UUID PK
- [x] Unit + integration тесты; CHANGELOG / README Limitations обновлены
- [x] Нет мёртвого UUID-only assert кода
