# NoBugDB ORM — Implementation Plans

Пофазные планы npm-пакета **`nobugdb-orm`**: TypeScript ORM с парадигмой **Data Mapper + Repository** для [NoBugDB](https://github.com/Aram47/NoBugDB).

## Порядок реализации

Выполнять фазы строго по номерам. Каждая фаза зависит от предыдущих.

| Фаза | Файл | Кратко |
|------|------|--------|
| 0 | [00-overview.md](./00-overview.md) | Цели, архитектура, риски, non-goals |
| 1 | [01-package-scaffold.md](./01-package-scaffold.md) | Каркас пакета, TS, dual ESM/CJS, тесты |
| 2 | [02-tcp-driver.md](./02-tcp-driver.md) | TCP-протокол NoBugDB, Connection, Client |
| 3 | [03-pool-transactions.md](./03-pool-transactions.md) | Pool, sticky TX, `transaction(fn)` |
| 4 | [04-types-and-query-builder.md](./04-types-and-query-builder.md) | Типы JS↔SQL, Query Builder, PREPARE |
| 5 | [05-data-mapper-core.md](./05-data-mapper-core.md) | Entity metadata, Repository, EntityManager |
| 6 | [06-relations-and-schema.md](./06-relations-and-schema.md) | Relations, FK, schema metadata |
| 7 | [07-migrations.md](./07-migrations.md) | Migrations CLI и runner |
| 8 | [08-express-integration.md](./08-express-integration.md) | Express middleware / request-scoped EM |
| 9 | [09-npm-publish-and-docs.md](./09-npm-publish-and-docs.md) | Docs, CI, semver, `npm publish` |

## Definition of Done (на каждую фазу)

- [ ] Код фазы реализован и экспортирован из публичного API (если фаза это предполагает)
- [ ] Unit-тесты зелёные; интеграционные — где требуется живой NoBugDB
- [ ] Нет неиспользуемого кода
- [ ] Ограничения NoBugDB отражены в JSDoc / README фазы
- [ ] Следующая фаза может стартовать без блокирующих TODO в предыдущей

## Зафиксированные решения

- **Парадигма:** Data Mapper + Repository (`EntityManager`, `Repository`)
- **Язык:** TypeScript (ESM primary, dual CJS)
- **Пакет:** `nobugdb-orm`
- **Транспорт:** собственный TCP-драйвер (не pg/mysql2)

## Связанный движок

Спецификацию протокола и SQL-subset брать из репозитория NoBugDB (`docs/ARCHITECTURE.md`, `include/network/protocol.h`). README движка может отставать от кода.
