# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

In `0.x`, the API may break between minor versions; breaking changes are listed here.

## [Unreleased]

## [0.1.3] - 2026-07-29

### Fixed

- PREPARE UPDATE: continuous `$n` placeholders across SET + WHERE (`renumberPlaceholders`)
- Migrator creates history table when the driver throws missing-table `SERVER_ERROR` (fixes CLI `migration:up` on fresh DB)
- Inverse one-to-one relations without a local `joinColumn` (mappedBy / `inverseSide`)
- Default max request size raised to **1 MiB** (aligned with NoBugDB server read buffer)
- Wire protocol decode: SQL NULL as `\N` → `null`; empty STRING rows preserved

## [0.1.2] - 2026-07-29

### Added

- Admin commands: `DataSource.explain` / `explainQuery` / `vacuum` and `EntityManager.explain` / `vacuum` (bare `VACUUM`; EXPLAIN returns raw `QUERY PLAN` lines)
- Keys and constraints: composite / non-UUID primary keys in `defineEntity` + `Repository.findById`; table-level multi-column `PRIMARY KEY` / `UNIQUE` in migrations (`TableBuilder.primaryKey` / `unique`, ALTER multi-col); UUID PK auto-generate remains default (`generated: 'uuid'`)
- Query builder set operations: `union` / `unionAll` / `intersect` / `except`
- Window helpers: `ROW_NUMBER` / `RANK` / `DENSE_RANK` and running `SUM`/`AVG` via `sql.*.over()`
- Subqueries: `IN` / `EXISTS` / scalar (`whereInSubquery`, `whereExists`, `sql.subquery`, `sql.ref`)
- Scalar helpers: `COALESCE` / `NULLIF` / `SUBSTRING` / `CAST` / `CURRENT_DATE`
- Migrations DDL: CHECK, RANGE/HASH partitioning + `PARTITION OF`, triggers, functions/procedures/`CALL`

### Fixed

- TypeScript / ESLint CI failures under `exactOptionalPropertyTypes` and `prefer-const`

### Known limitations

See [README Limitations](./README.md#limitations). Highlights: 1 MiB wire buffer, no `SERIAL`/`RETURNING`, no `LIKE`/CTE/`UPSERT`, client-supplied non-UUID/composite PKs (UUID auto-generate by default), no runtime introspection, no TLS on the wire.

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

See [README Limitations](./README.md#limitations). Highlights: 1 MiB wire buffer, no `SERIAL`/`RETURNING`, no `LIKE`/CTE/`UPSERT`, client-supplied non-UUID/composite PKs (UUID auto-generate by default), no runtime introspection, no TLS on the wire.

[0.1.0]: https://github.com/Aram47/NoBugDB-ORM/releases/tag/v0.1.0
[0.1.1]: https://github.com/Aram47/NoBugDB-ORM/releases/tag/v0.1.1
[0.1.2]: https://github.com/Aram47/NoBugDB-ORM/releases/tag/v0.1.2
[0.1.3]: https://github.com/Aram47/NoBugDB-ORM/releases/tag/v0.1.3
