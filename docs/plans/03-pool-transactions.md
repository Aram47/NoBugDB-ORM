# Phase 3 — Pool and Transactions

## Goal

Добавить пул TCP-соединений и API транзакций с **sticky connection**: весь `BEGIN`…`COMMIT`/`ROLLBACK` идёт по одному сокету (TX state живёт в `SessionContext` на стороне NoBugDB).

## Depends on

- [02-tcp-driver.md](./02-tcp-driver.md)

## Why sticky connections

NoBugDB хранит транзакцию и prepared statements в сессии соединения. Пул **нельзя** отдавать другой connection mid-transaction. После `COMMIT`/`ROLLBACK` соединение можно вернуть в пул.

## Public API (draft)

```ts
export interface PoolOptions extends ConnectionOptions {
  min?: number;             // default 0
  max?: number;             // default 4 (server is mutex-heavy; keep small)
  idleTimeoutMs?: number;
  acquireTimeoutMs?: number;
}

export class Pool {
  constructor(options?: PoolOptions);
  connect(): Promise<void>;   // optional warm-up of `min` connections
  acquire(): Promise<PooledConnection>;
  query(sql: string): Promise<QueryResult>; // acquire → query → release
  transaction<T>(fn: (conn: PooledConnection) => Promise<T>): Promise<T>;
  end(): Promise<void>;
  readonly size: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

export interface PooledConnection {
  query(sql: string): Promise<QueryResult>;
  release(): void;
  /** True while inside Pool.transaction or manual BEGIN without commit */
  readonly inTransaction: boolean;
}
```

Рекомендуемый путь для приложений: `pool.transaction(async (conn) => { ... })`.

Ручной `BEGIN` через `conn.query('BEGIN')` допускается, но тогда `release()` до COMMIT запрещён (бросить ошибку).

## Implementation steps

1. **`Pool`**
   - Создавать connections lazy до `max`
   - Очередь waiters при исчерпании
   - Idle eviction по `idleTimeoutMs`
   - На `end()`: дождаться in-flight, QUIT всем, reject waiters

2. **`PooledConnection` wrapper**
   - Делегирует `query` в underlying `Connection`
   - Флаг `inTransaction`
   - `release()` возвращает в idle только если `!inTransaction`

3. **`transaction(fn)`**
   ```ts
   const conn = await pool.acquire();
   try {
     await conn.query('BEGIN');
     conn.inTransaction = true;
     const result = await fn(conn);
     await conn.query('COMMIT');
     conn.inTransaction = false;
     conn.release();
     return result;
   } catch (err) {
     try { await conn.query('ROLLBACK'); } catch { /* log */ }
     conn.inTransaction = false;
     // destroy connection on uncertain state instead of reuse if ROLLBACK failed
     conn.release(); // or destroy()
     throw err;
   }
   ```
   - При ошибке ROLLBACK — **уничтожить** соединение, не возвращать в пул

4. **Isolation notes (document)**
   - NoBugDB: snapshot isolation (MVCC)
   - ORM не эмулирует READ UNCOMMITTED / SERIALIZABLE уровни SQL-синтаксисом, которого нет
   - Nested transactions: **не поддерживать в v1** (бросить `NoBugDbError` code `NESTED_TX_UNSUPPORTED`)

5. **Pool sizing guidance**
   - Default `max: 4` — сервер сериализует SQL через `db_mutex_`
   - Документировать в README: увеличение max редко ускоряет throughput

6. **Exports**
   - `Pool`, `PoolOptions` из `src/index.ts`

## Tests

### Unit

- [ ] Acquire/release returns connection to idle
- [ ] Max pool: 5th acquire waits; release unblocks
- [ ] Acquire timeout
- [ ] `transaction` commits on success
- [ ] `transaction` rollbacks on throw
- [ ] Cannot `release()` while `inTransaction`
- [ ] Nested `transaction` rejected
- [ ] Failed ROLLBACK destroys connection (`size` decreases / new conn created)

### Integration

- [ ] Two sequential TX on pool against live NoBugDB
- [ ] Concurrent `pool.query` respects max

## Definition of Done

- [ ] `Pool` и `transaction` работают и покрыты тестами
- [ ] Sticky TX invariant enforced
- [ ] JSDoc описывает snapshot isolation и лимит pool size
- [ ] Driver фазы 2 не сломан (Client по-прежнему usable без pool)

## Known limitations

- Нет savepoints / nested TX
- Prepared statements в сессии: после возврата в пул чужие PREPARE-имена могут конфликтовать — в фазе 4 использовать уникальные имена или DEALLOCATE перед release
- Auth per connection: каждый новый socket делает AUTH

## Out of scope

- Query builder
- EntityManager transaction wrapper (тонкая обёртка над `pool.transaction` — фаза 5)
