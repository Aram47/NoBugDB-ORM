# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

In `0.x`, the API may break between minor versions; breaking changes are listed here.

## [Unreleased]

### Added

- Admin commands: `DataSource.explain` / `explainQuery` / `vacuum` and `EntityManager.explain` / `vacuum` (bare `VACUUM`; EXPLAIN returns raw `QUERY PLAN` lines)
- Keys and constraints: composite / non-UUID primary keys in `defineEntity` + `Repository.findById`; table-level multi-column `PRIMARY KEY` / `UNIQUE` in migrations (`TableBuilder.primaryKey` / `unique`, ALTER multi-col); UUID PK auto-generate remains default (`generated: 'uuid'`)

## [0.1.1] - 2026-07-28

First public release of `nobugdb-orm`.

### Added

- TCP driver for NoBugDB (`AUTH` / `QUERY` / `PING` / `QUIT`)
- Connection pool with sticky session-bound transactions
- Type mapping: INT, FLOAT, STRING, BOOLEAN, DATE, UUID
- Query builder: SELECT / INSERT / UPDATE / DELETE (+ JOIN, WHERE, ORDER, LIMIT/OFFSET, basic aggregates)
- Data Mapper: `defineEntity`, `Repository`, `EntityManager`, Unit of Work, Identity Map
- Relations (eager load via `find({ relations })`) and schema metadata consistency checks
- Migrations runner + CLI (`nobugdb-orm migration:*`)
- Optional Express integration (`nobugdb-orm/express`) with request-scoped `EntityManager`
- Dual ESM + CJS publish, TypeScript types, Node `>=18`

### Known limitations

See [README Limitations](./README.md#limitations). Highlights: ~4 KiB wire buffer, no `SERIAL`/`RETURNING`, no `LIKE`/CTE/`UPSERT`, client-supplied non-UUID/composite PKs (UUID auto-generate by default), no runtime introspection, no TLS on the wire.

[0.1.0]: https://github.com/Aram47/NoBugDB-ORM/releases/tag/v0.1.0
[0.1.1]: https://github.com/Aram47/NoBugDB-ORM/releases/tag/v0.1.1
