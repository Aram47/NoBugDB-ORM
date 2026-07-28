# Phase 0 — Overview

## Goal

Зафиксировать цели, границы и архитектуру npm-пакета `nobugdb-orm` до начала реализации. Этот документ — источник истины для всех последующих фаз.

## Product goal

Дать Node.js / Express приложениям типобезопасный ORM для NoBugDB:

- подключение по TCP-протоколу NoBugDB;
- Data Mapper API (`EntityManager` + `Repository`);
- query builder под поддерживаемый SQL-subset;
- миграции схемы;
- публикация в npm как `nobugdb-orm`.

## In scope

- TypeScript library (ESM + CJS)
- TCP driver: AUTH, QUERY, PING, QUIT
- Connection pool + session-bound transactions
- Type mapping: INT, FLOAT, STRING, BOOLEAN, DATE, UUID
- Query builder: SELECT / INSERT / UPDATE / DELETE (+ JOIN, WHERE, ORDER, LIMIT/OFFSET, базовые агрегаты)
- Entity metadata + Repository + EntityManager + Unit of Work
- Relations поверх JOIN / FK
- Migration runner + CLI
- Тонкая Express-интеграция (request-scoped EM)
- Документация и npm publish pipeline

## Non-goals (v1)

- Совместимость с Prisma / TypeORM / Sequelize API 1:1
- PostgreSQL / MySQL wire protocol
- Embedded / in-process NoBugDB (только client–server TCP)
- Генерация SQL с `LIKE`, `UNION`, CTE, window functions, `UPSERT`, `RETURNING`
- Auto-increment / SERIAL / sequences
- Runtime introspection через `information_schema` (его нет в NoBugDB)
- TLS на wire (пока сервер не поддерживает)
- GraphQL / NestJS / Koa first-class adapters (можно позже)

## Architecture

```text
Express App
    └─ EntityManager
         ├─ Repository<T>
         ├─ UnitOfWork / IdentityMap
         └─ QueryBuilder
              └─ Connection (from Pool)
                   └─ Protocol (encode/decode)
                        └─ net.Socket → NoBugDB :9000
```

### Layers (SOLID / KISS)

| Layer | Responsibility | Depends on |
|-------|----------------|------------|
| `protocol` | Wire encode/decode | Node `net` only |
| `driver` | Connection, Client, errors | `protocol` |
| `pool` | Acquire/release, TX sticky | `driver` |
| `types` | JS ↔ NoBugDB value coercion | — |
| `query-builder` | Safe SQL for supported dialect | `types`, `driver` |
| `metadata` | Entity/column/relation registry | — |
| `repository` | Data Mapper CRUD | QB, metadata, pool |
| `entity-manager` | Facade, UoW, transactions | repository, pool |
| `migrations` | DDL + history table | driver/pool |
| `express` | Optional middleware | entity-manager |

Правило зависимости: верхние слои знают о нижних; нижние **не** импортируют ORM/Express.

## NoBugDB constraints (must respect)

| Constraint | ORM consequence |
|------------|-----------------|
| Text protocol, newline-framed | Custom driver; no `pg`/`mysql2` |
| Server read buffer ~4 KB | Fail fast / document max query & row payload |
| No `RETURNING` / `SERIAL` | Client-generated UUID primary keys |
| No `information_schema` | Schema only from entity metadata + migrations |
| TX bound to TCP session | Sticky connection for whole transaction |
| Global DB mutex on server | Small pools; don't oversubscribe |
| Limited SQL | QB must refuse unsupported constructs |
| DATE/UUID as strings on wire | Map to `Date` / `string` (UUID) in TS |
| Views read-only | Never generate writes against views |

## Primary key strategy

Default: **UUID v4** (or v7 if we choose time-sortable later) generated in ORM before INSERT.

No reliance on server-side identity columns.

## Parameterization strategy

Prefer NoBugDB `PREPARE` / `EXECUTE` / `DEALLOCATE` for repeated statements.

For one-shot queries: typed literal rendering with dialect-safe escaping (never raw string concat from user input).

Binary bind protocol does not exist — parameters become SQL literals inside `EXECUTE name(args)`.

## Package identity

| Field | Value |
|-------|--------|
| npm name | `nobugdb-orm` |
| Language | TypeScript |
| Module | ESM primary + CJS dual publish |
| Node | `>=18` |
| License | MIT (align with NoBugDB if different — confirm at publish phase) |

## Phase map

1. Package scaffold  
2. TCP driver  
3. Pool + transactions  
4. Types + query builder  
5. Data Mapper core  
6. Relations + schema metadata  
7. Migrations  
8. Express integration  
9. Docs + CI + npm publish  

## Risks

1. **4 KB wire buffer** — large INSERT batches / wide SELECTs break silently if not checked.
2. **Doc drift in NoBugDB** — trust `ARCHITECTURE.md` + tests over README features list.
3. **No introspection** — migrations and entity metadata can diverge; need explicit sync checks in later phase.
4. **Auth without TLS** — document as development-grade; don't store secrets in client logs.

## Success criteria for the whole project

- Developer can `npm install nobugdb-orm`, define entities, run migrations, use `EntityManager` in Express.
- All CRUD + relations work against a running NoBugDB.
- Published package has typed exports, README, and semver releases.
