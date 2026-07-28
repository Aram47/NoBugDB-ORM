# NoBugDB ORM — Plans 2 (Engine Feature Coverage)

Пофазные планы **v2**: закрыть пробелы между npm-пакетом [`nobugdb-orm`](../../README.md) и SQL/DDL surface [NoBugDB](https://github.com/Aram47/NoBugDB).

Базовый стек v1 (драйвер, pool/TX, CRUD QB, Data Mapper, relations, migrations, Express) описан в [`../plans/`](../plans/). Этот каталог — только фичи движка, которых ORM ещё не экспонирует.

## Вердикт gap-анализа

ORM **не** покрывает всю функциональность NoBugDB. Планы ниже доводят клиентский API до поддерживаемого движком subset.

## Порядок реализации

Выполнять фазы по номерам. Фазы 01–04 можно частично параллелить после overview; DDL/advanced — после QB-расширений по зависимостям в [00-overview.md](./00-overview.md).

| Фаза | Файл | Кратко |
|------|------|--------|
| 0 | [00-overview.md](./00-overview.md) | Gap-матрица, цели v2, non-goals, архитектура |
| 1 | [01-set-operations.md](./01-set-operations.md) | `UNION` / `INTERSECT` / `EXCEPT` в QueryBuilder |
| 2 | [02-window-functions.md](./02-window-functions.md) | Window helpers + `OVER` |
| 3 | [03-subqueries.md](./03-subqueries.md) | Subquery / `EXISTS` / `IN (SELECT…)` |
| 4 | [04-scalar-expressions.md](./04-scalar-expressions.md) | `COALESCE`, `NULLIF`, `SUBSTRING`, `CAST`, `CURRENT_DATE` |
| 5 | [05-check-constraints.md](./05-check-constraints.md) | CHECK в миграциях (CREATE / ALTER) |
| 6 | [06-partitioning.md](./06-partitioning.md) | PARTITION BY RANGE/HASH helpers |
| 7 | [07-triggers.md](./07-triggers.md) | CREATE/DROP TRIGGER |
| 8 | [08-routines.md](./08-routines.md) | FUNCTION / PROCEDURE / CALL |
| 9 | [09-admin-commands.md](./09-admin-commands.md) | EXPLAIN, VACUUM |
| 10 | [10-keys-and-constraints.md](./10-keys-and-constraints.md) | Composite / non-UUID PK, multi-column UNIQUE |

## Definition of Done (на каждую фазу)

- [ ] Код фазы реализован и экспортирован из публичного API (если фаза это предполагает)
- [ ] Unit-тесты зелёные; интеграционные — против живого NoBugDB, где SQL зависит от движка
- [ ] Нет неиспользуемого кода
- [ ] Ограничения NoBugDB отражены в JSDoc / README
- [ ] Следующая фаза может стартовать без блокирующих TODO в предыдущей

## Зафиксированные решения

- **Не ломать v1 API** без semver-major: расширения additive; ослабление UUID-only PK — в фазе 10 с opt-in / documented migration notes
- **Не эмулировать** то, чего нет в NoBugDB (`LIKE`, CTE, `RETURNING`, `SERIAL`, SQL-introspection)
- **Спецификация SQL** — из репозитория NoBugDB (`README.md`, `docs/ARCHITECTURE.md`, тесты), не из устаревших non-goals v1 ORM

## Связанный движок

Протокол и SQL-subset: NoBugDB `docs/ARCHITECTURE.md`, `include/network/protocol.h`, `tests/*_test.cc`.
