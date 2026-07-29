# Phase 2 — TCP Driver

## Goal

Реализовать низкоуровневый TCP-клиент NoBugDB: протокол, соединение, выполнение запросов, ошибки и лимиты размера сообщений.

## Depends on

- [01-package-scaffold.md](./01-package-scaffold.md)

## Wire protocol (NoBugDB)

Запросы (UTF-8, завершаются `\n`):

| Type | Format |
|------|--------|
| AUTH | `AUTH\|user\|password\n` |
| QUERY | `QUERY\|<sql>\n` |
| PING | `PING\|\n` |
| QUIT | `QUIT\|\n` |

Ответы:

- Success: `OK|...` (для SELECT: заголовки колонок и строки через `\t` / `\n`)
- Error: `ERROR|<message>\n`
- PING → `PONG\n`

Источник истины: NoBugDB `include/network/protocol.h`, `src/network/protocol.cc`, CLI `client/cli_client.cc`.

## Public API (draft)

```ts
export interface ConnectionOptions {
  host?: string;          // default '127.0.0.1'
  port?: number;          // default 9000
  user?: string;
  password?: string;
  connectTimeoutMs?: number;
  queryTimeoutMs?: number;
  /** Max encoded request size; default aligned with server ~4KiB read buffer */
  maxRequestBytes?: number;
  /** Max response bytes to accumulate before failing */
  maxResponseBytes?: number;
}

export interface QueryResult {
  success: boolean;
  message: string;
  columns: string[];
  rows: string[][];       // raw wire strings; typed mapping in phase 4
  affectedRows?: number;
}

export class NoBugDbError extends Error {
  readonly code: string;
  readonly sql?: string;
}

export class Connection {
  static connect(options?: ConnectionOptions): Promise<Connection>;
  query(sql: string): Promise<QueryResult>;
  ping(): Promise<void>;
  close(): Promise<void>;
  readonly isOpen: boolean;
}

export class Client {
  constructor(options?: ConnectionOptions);
  connect(): Promise<void>;
  query(sql: string): Promise<QueryResult>;
  ping(): Promise<void>;
  end(): Promise<void>;
}
```

Классы разместить в `src/protocol/` и `src/driver/`.

## Implementation steps

1. **`Protocol` (pure functions / class, no I/O)**
   - `encodeAuth(user, password)`
   - `encodeQuery(sql)`
   - `encodePing()` / `encodeQuit()`
   - `parseResponse(buffer: string): ParsedResponse`
   - Парсинг result set: первая линия после `OK|` — метаданные/колонки по правилам сервера; сверить с `Protocol::format_query_result` и CLI

2. **Validate request size**
   - Перед `socket.write` проверить `Buffer.byteLength(message) <= maxRequestBytes`
   - Default `maxRequestBytes = 1 MiB` (серверный `Connection::read_message` buffer)
   - Бросать `NoBugDbError` с code `REQUEST_TOO_LARGE`

3. **`Connection`**
   - `net.Socket`, один in-flight request на соединение (сервер обрабатывает сообщения последовательно на connection)
   - Очередь запросов на клиенте **или** явный запрет concurrent `query` на одном Connection — выбрать **serial queue** (проще для pool/TX)
   - Framing: читать до `\n` для простых ответов; для multi-line OK result — определить framing по протоколу сервера (изучить `format_query_result`: сколько строк, есть ли terminator)
   - Таймауты connect/query
   - Опциональный AUTH сразу после connect
   - `QUIT` + destroy socket на `close()`

4. **`Client`**
   - Тонкая обёртка над одним `Connection` для простых скриптов
   - Pool появится в фазе 3

5. **Errors**
   - `ERROR|...` → `NoBugDbError` с сообщением сервера
   - Socket errors / timeouts / closed while waiting

6. **Exports**
   - Реэкспорт из `src/index.ts`

## Response parsing notes

Перед реализацией зафиксировать контракт, прогнав CLI / unit-фикстуры на реальных ответах сервера:

- DML: `OK|... affected ...` vs tabular
- SELECT: column header row + data rows
- Empty result set
- Auth failure

Добавить golden fixtures в `test/unit/protocol/` (строки ответов без живого сервера).

## Tests

### Unit

- [ ] Encode AUTH/QUERY/PING/QUIT
- [ ] Parse OK / ERROR / PONG
- [ ] Parse multi-row SELECT fixture
- [ ] Reject oversized request
- [ ] Concurrent queries on one Connection are serialized (order preserved)

### Integration (optional but recommended)

- [ ] Against local `nobugdb`: connect, AUTH, `SELECT 1` or create table smoke, PING, QUIT
- [ ] Skip if `NOBUGDB_HOST` не задан (`describe.skipIf`)

## Definition of Done

- [ ] `Connection` / `Client` / `Protocol` / `NoBugDbError` экспортированы
- [ ] Unit-тесты протокола зелёные
- [ ] Документирован лимит ~4 KB в JSDoc `ConnectionOptions`
- [ ] Нет утечек сокетов в тестах (`afterEach` close)

## Known limitations

- Нет length-prefixed framing — хрупкость multi-line ответов; парсер должен строго следовать серверному формату
- Нет TLS
- Один логический запрос за раз на connection (очередь)
- Raw `string[][]` rows — типизация в фазе 4

## Out of scope

- Pool, transactions helpers
- Query builder
- Entity mapping
