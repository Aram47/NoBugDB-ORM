# Phase 7 — Migrations

## Goal

Миграции схемы NoBugDB: runner, история применений, DDL helpers и CLI `nobugdb-orm migration:*`.

## Depends on

- [05-data-mapper-core.md](./05-data-mapper-core.md) (DataSource / Connection)
- Желательно [06-relations-and-schema.md](./06-relations-and-schema.md) для FK в DDL helpers

## Why migrations (not sync)

NoBugDB не даёт `information_schema`. Авто-sync «entities → DB» опасен и непрозрачен. **Явные миграции** — единственный надёжный путь для npm ORM.

## Migration file format

TypeScript (compiled) или JS:

```ts
import type { MigrationBuilder, MigrationContext } from 'nobugdb-orm';

export const id = '20260728120000_create_users';

export async function up(ctx: MigrationContext): Promise<void> {
  await ctx.schema.createTable('users', (t) => {
    t.uuid('id').primary();
    t.string('email').unique().notNull();
    t.string('name').notNull();
  });
}

export async function down(ctx: MigrationContext): Promise<void> {
  await ctx.schema.dropTable('users');
}
```

Имена файлов: `{timestamp}_{slug}.ts`.

## History table

Создавать при первом `migrate`:

```sql
CREATE TABLE orm_migrations (
  id STRING PRIMARY KEY,
  applied_at STRING NOT NULL
);
```

Типы подобрать под NoBugDB (`STRING`, не TIMESTAMP type — DATE/STRING для ISO timestamp).

Каждый успешный `up` — INSERT в `orm_migrations` **в той же транзакции**, что и миграция (если DDL+DML в одной TX поддерживается сервером; проверить тестами). Если DDL implicit-commit — документировать и применять history insert immediately after.

## Public API (draft)

```ts
export interface MigrationContext {
  query(sql: string): Promise<QueryResult>;
  schema: MigrationBuilder;
}

export interface MigrationBuilder {
  createTable(name: string, fn: (t: TableBuilder) => void): Promise<void>;
  dropTable(name: string): Promise<void>;
  alterTable(name: string, fn: (t: AlterTableBuilder) => void): Promise<void>;
  createIndex(name: string, table: string, columns: string[]): Promise<void>;
  dropIndex(name: string): Promise<void>;
  createView(name: string, sql: string): Promise<void>;
  dropView(name: string): Promise<void>;
  raw(sql: string): Promise<void>;
}

export interface TableBuilder {
  int(name: string): ColumnBuilder;
  float(name: string): ColumnBuilder;
  string(name: string): ColumnBuilder;
  boolean(name: string): ColumnBuilder;
  date(name: string): ColumnBuilder;
  uuid(name: string): ColumnBuilder;
}

export interface ColumnBuilder {
  primary(): this;
  unique(): this;
  notNull(): this;
  nullable(): this;
  default(value: unknown): this;
  references(table: string, column: string, opts?: FkOptions): this;
}

export class Migrator {
  constructor(ds: DataSource, options: { migrationsDir: string });
  pending(): Promise<string[]>;
  up(): Promise<string[]>;      // apply all pending
  down(steps?: number): Promise<string[]>;
  status(): Promise<{ id: string; applied: boolean }[]>;
}
```

Генерируемый SQL — только DDL, поддерживаемый NoBugDB: `CREATE/DROP TABLE`, `ALTER TABLE`, `CREATE/DROP INDEX`, `CREATE/DROP VIEW`, FK clauses как в движке.

## CLI

`package.json`:

```json
{
  "bin": {
    "nobugdb-orm": "./dist/esm/cli/index.js"
  }
}
```

Команды:

| Command | Action |
|---------|--------|
| `nobugdb-orm migration:create <name>` | Scaffold file with timestamp |
| `nobugdb-orm migration:up` | Apply pending |
| `nobugdb-orm migration:down [n]` | Revert last n (default 1) |
| `nobugdb-orm migration:status` | Show applied/pending |

Конфиг: `nobugdb-orm.config.ts` (host, port, auth, migrationsDir, entities optional) — загрузка через path arg `--config`.

## Implementation steps

1. DDL SQL generator from TableBuilder (reuse `quoteIdent` / `escapeLiteral`)
2. `Migrator` + history table bootstrap
3. Migration file loader (dynamic `import()`)
4. CLI with `process.argv` (KISS; можно `commander` если нужно)
5. Document transactional DDL caveats after verifying against NoBugDB
6. Tests with temp migrations dir + live DB (or SQL snapshot unit tests)

## Tests

- [ ] createTable SQL snapshot (PK, UNIQUE, NOT NULL, DEFAULT, FK)
- [ ] History table created once
- [ ] `up` applies in filename order; second run no-op
- [ ] `down` calls down() and removes history row
- [ ] Failed migration does not record history (TX or compensatory behavior documented)
- [ ] CLI create generates file

## Definition of Done

- [ ] Migrator API + CLI работают
- [ ] DDL helpers покрывают базовые типы NoBugDB
- [ ] README section: how to migrate
- [ ] Нет зависимости от introspection

## Known limitations

- Нет auto-generate migration from entity diff (v2)
- ALTER support ограничен тем, что умеет NoBugDB `ALTER TABLE`
- Views non-updatable — migrations могут создавать views, ORM write path их не использует
- Multi-statement migration failure semantics зависят от сервера

## Out of scope

- Seeders framework (можно простой `raw` SQL scripts)
- Squash / baseline tooling beyond documenting manual process
