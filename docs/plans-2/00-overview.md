# Phase 0 — Overview (Plans 2)

## Goal

Зафиксировать цели v2 ORM: полное покрытие **поддерживаемого** SQL/DDL surface NoBugDB через QueryBuilder, миграции и тонкие helpers — без эмуляции фич, которых нет в движке.

## Product goal

После реализации фаз 01–10 разработчик на `nobugdb-orm` может:

- строить SELECT с set operations, windows, subqueries и полным набором builtin-скаляров;
- описывать в миграциях CHECK, partitioning, triggers, functions/procedures;
- вызывать `CALL`, `EXPLAIN`, `VACUUM` через typed API;
- использовать composite / non-UUID PK (client-supplied), согласованный с DDL движка.

## Gap matrix (ORM v0.1.1 ↔ NoBugDB)

### Уже покрыто (v1 — не дублировать здесь)

| Область | ORM |
|---------|-----|
| TCP AUTH / QUERY / PING / QUIT | `Connection`, `Client` |
| Pool + sticky TX | `Pool`, `DataSource.transaction` |
| PREPARE / EXECUTE / DEALLOCATE | `runPrepared` |
| CRUD + JOIN + WHERE/GROUP/HAVING/ORDER/LIMIT | `QueryBuilder` |
| Aggregates COUNT/SUM/AVG/MIN/MAX | `sql.*` |
| Scalars UPPER/LOWER/LENGTH | `sql.*` |
| Entities / Repository / EM / UoW | Data Mapper |
| Relations M2O / O2M / O2O | `defineEntity` + loader |
| Migrations CREATE/DROP/ALTER TABLE, INDEX, VIEW, FK | `Migrator` |
| Express middleware | `nobugdb-orm/express` |

### Пробелы (этот каталог планов)

| Область БД | Evidence в NoBugDB | ORM сейчас | Фаза |
|------------|-------------------|------------|------|
| `UNION` / `INTERSECT` / `EXCEPT` | `SetOperationStatement`, `set_operation_test.cc` | forbidden в `escape.ts` | 01 |
| Window `ROW_NUMBER`/`RANK`/`DENSE_RANK`/running SUM·AVG + `OVER` | `window_operator.h` | forbidden (`OVER`) | 02 |
| Subqueries IN/EXISTS/scalar/correlated | `subquery_test.cc` | нет builder API | 03 |
| `COALESCE`/`NULLIF`/`SUBSTRING`/`CAST`/`CURRENT_DATE` | `scalar_function.cc` | нет helpers | 04 |
| CHECK (+ ALTER ADD/DROP CHECK) | `check_constraint.h` | нет в миграциях | 05 |
| `PARTITION BY` RANGE/HASH, `PARTITION OF` | `partition.h` | нет | 06 |
| `CREATE`/`DROP TRIGGER` | `trigger.h` | нет | 07 |
| FUNCTION / PROCEDURE / `CALL` | `routine_catalog.h` | нет | 08 |
| `EXPLAIN`, `VACUUM` | AST + tests | нет API | 09 |
| Composite / non-UUID PK, multi-col UNIQUE | CREATE/ALTER TABLE | только single UUID PK; UNIQUE — одна колонка | 10 |

### Не планировать (движок не поддерживает)

| Фича | Причина |
|------|---------|
| `LIKE` / `ILIKE` | нет в парсере |
| CTE / `WITH` | нет |
| `RETURNING` | нет |
| `SERIAL` / sequences / auto-increment | нет |
| `UPSERT` / `ON CONFLICT` | нет |
| `INFORMATION_SCHEMA` / SHOW / DESCRIBE | нет SQL-introspection |
| Updatable views | views read-only |
| Statement-level / INSTEAD OF / WHEN triggers | только row-level BEFORE/AFTER |
| `INTERSECT ALL` / `EXCEPT ALL` / CORRESPONDING | нет в движке |
| LEAD/LAG/NTILE, named WINDOW, явный `ROWS BETWEEN` | нет в v1 windows |

Их отсутствие в ORM **корректно**; не добавлять stubs, которые генерируют невалидный SQL.

## Architecture (additive)

```text
Express App
  └─ EntityManager / DataSource
       ├─ Repository
       ├─ QueryBuilder  ←── phases 01–04 (+ typed sql.* helpers)
       ├─ Migrator / schema  ←── phases 05–08
       └─ Admin helpers  ←── phase 09 (explain, vacuum)
            └─ Pool → Connection → Protocol → NoBugDB
```

### Layers to touch

| Layer | Phases | Change style |
|-------|--------|--------------|
| `query-builder` | 01–04 | Additive methods; refine `UNSUPPORTED_KEYWORDS` so typed APIs can emit previously forbidden tokens |
| `migrations/ddl` | 05–08, 10 | Extend `TableBuilder` / `AlterTableBuilder` / `MigrationBuilder` |
| `metadata` / `repository` | 10 | Composite / non-UUID PK support |
| `data-source` | 08–09 | `callProcedure`, `explain`, `vacuum` |
| `protocol` / `driver` / `pool` | — | No protocol changes expected |

Правило зависимости v1 сохраняется: нижние слои не импортируют Express/ORM facade.

## NoBugDB constraints (must respect)

| Constraint | ORM consequence |
|------------|-----------------|
| ~4 KiB wire buffer | Size-guard large generated SQL (set-op unions, trigger bodies, routine DDL) |
| Set ops только top-level | Не вкладывать UNION внутрь subquery/view helpers |
| Window: `ORDER BY` в `OVER` обязателен; колонки OVER ⊆ SELECT list | Валидация в helpers |
| CHECK: без subquery/aggregate | Документировать; не генерировать запрещённое |
| Triggers: row-level only, depth ≤ 16 | Typed options только BEFORE/AFTER + INSERT/UPDATE/DELETE |
| Routines: SQL-bodied; no OUT/INOUT | API только IN params + RETURN expr / stmt list |
| No SERIAL | PK по-прежнему client-supplied (UUID или явные значения) |
| No SQL catalog | Schema truth = migrations + entity metadata |

## Phase map

1. Set operations  
2. Window functions  
3. Subqueries  
4. Scalar expressions  
5. CHECK constraints  
6. Partitioning  
7. Triggers  
8. Routines (FUNCTION / PROCEDURE / CALL)  
9. Admin commands (EXPLAIN / VACUUM)  
10. Keys and constraints (composite / non-UUID PK, multi-col UNIQUE)

Рекомендуемый порядок по зависимостям:

- 04 перед 02 (скаляры полезны в window expressions);
- 03 перед глубоким использованием 01 в сложных запросах (set-op операнды — обычные SELECT);
- 05 перед 06 и 10 (CHECK и ключи — общая DDL-поверхность);
- 07–09 независимы друг от друга после overview.

## Risks

1. **v1 non-goals drift** — README ORM всё ещё запрещает UNION/windows; обновить Limitations после реализации, не раньше кода.
2. **4 KiB buffer** — DDL триггеров/процедур и широкие UNION легко упираются в лимит; fail-fast с понятной ошибкой.
3. **Breaking PK policy** — фаза 10 меняет инвариант «ровно один UUID PK»; нужен semver minor/major и миграционные notes.
4. **Raw SQL escape hatch** — `sql.raw` / `schema.raw` уже обходят проверки; typed API не должен ослаблять `assertSupportedSqlFragment` для произвольного текста без необходимости.

## Success criteria (весь plans-2)

- Каждая строка gap-матрицы «Пробелы» закрыта публичным API + тестами.
- README ORM отражает новый supported surface и актуальные Limitations (только то, чего нет в движке).
- Нет генерации SQL для фич вне NoBugDB v1.
