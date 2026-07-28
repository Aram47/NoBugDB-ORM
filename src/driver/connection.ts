import { createConnection, type Socket } from 'node:net';
import {
  encodeAuth,
  encodePing,
  encodeQuery,
  encodeQuit,
} from '../protocol/encode.js';
import {
  isCompleteResponse,
  needsIdleFlush,
  parseResponse,
} from '../protocol/parse.js';
import { NoBugDbError } from './errors.js';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_HOST,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_PORT,
  DEFAULT_QUERY_TIMEOUT_MS,
  RESPONSE_IDLE_MS,
  type ConnectionOptions,
  type QueryResult,
} from './types.js';

interface ResolvedOptions {
  host: string;
  port: number;
  user?: string;
  password?: string;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
}

type QueueTask<T> = () => Promise<T>;

/**
 * Single TCP session to NoBugDB. One in-flight request at a time (serial queue).
 */
export class Connection {
  readonly #options: ResolvedOptions;
  #socket: Socket | null = null;
  #open = false;
  #queue: Promise<unknown> = Promise.resolve();
  #receiveBuffer = '';
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #pending:
    | {
        resolve: (value: string) => void;
        reject: (err: unknown) => void;
        timeout: ReturnType<typeof setTimeout>;
      }
    | null = null;

  private constructor(options: ResolvedOptions, socket: Socket) {
    this.#options = options;
    this.#socket = socket;
    this.#open = true;
    this.#attachSocketHandlers(socket);
  }

  static async connect(options: ConnectionOptions = {}): Promise<Connection> {
    const resolved = resolveOptions(options);
    const socket = await openSocket(resolved);
    const connection = new Connection(resolved, socket);

    try {
      if (resolved.user !== undefined) {
        await connection.#authenticate(resolved.user, resolved.password ?? '');
      }
      return connection;
    } catch (err) {
      await connection.close().catch(() => undefined);
      throw err;
    }
  }

  get isOpen(): boolean {
    return this.#open && this.#socket !== null && !this.#socket.destroyed;
  }

  query(sql: string): Promise<QueryResult> {
    return this.#enqueue(async () => {
      this.#assertOpen();
      const wire = encodeQuery(sql);
      this.#assertRequestSize(wire);
      const raw = await this.#roundTrip(wire);
      return this.#toQueryResult(raw, sql);
    });
  }

  ping(): Promise<void> {
    return this.#enqueue(async () => {
      this.#assertOpen();
      const wire = encodePing();
      this.#assertRequestSize(wire);
      const raw = await this.#roundTrip(wire);
      const parsed = parseResponse(raw);
      if (parsed.kind !== 'pong') {
        throw new NoBugDbError(
          'PROTOCOL',
          `Expected PONG, got: ${raw.slice(0, 64)}`,
        );
      }
    });
  }

  close(): Promise<void> {
    return this.#enqueue(async () => {
      if (!this.isOpen) {
        this.#open = false;
        return;
      }

      const socket = this.#socket;
      this.#open = false;

      try {
        if (socket && !socket.destroyed) {
          const wire = encodeQuit();
          if (Buffer.byteLength(wire, 'utf8') <= this.#options.maxRequestBytes) {
            try {
              await this.#roundTrip(wire);
            } catch {
              // Best-effort QUIT; still destroy the socket.
            }
          }
        }
      } finally {
        this.#destroySocket();
      }
    });
  }

  #authenticate(user: string, password: string): Promise<void> {
    return this.#enqueue(async () => {
      const wire = encodeAuth(user, password);
      this.#assertRequestSize(wire);
      const raw = await this.#roundTrip(wire);
      const parsed = parseResponse(raw);
      if (parsed.kind === 'error') {
        throw new NoBugDbError('AUTH_FAILED', parsed.message);
      }
      if (parsed.kind !== 'ok' || parsed.message !== 'authenticated') {
        throw new NoBugDbError(
          'AUTH_FAILED',
          `Unexpected AUTH response: ${raw.slice(0, 64)}`,
        );
      }
    });
  }

  #enqueue<T>(task: QueueTask<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #assertOpen(): void {
    if (!this.isOpen) {
      throw new NoBugDbError('NOT_CONNECTED', 'Connection is not open');
    }
  }

  #assertRequestSize(message: string): void {
    const size = Buffer.byteLength(message, 'utf8');
    if (size > this.#options.maxRequestBytes) {
      throw new NoBugDbError(
        'REQUEST_TOO_LARGE',
        `Request is ${size} bytes; max is ${this.#options.maxRequestBytes} (NoBugDB ~4 KiB read buffer)`,
      );
    }
  }

  #toQueryResult(raw: string, sql: string): QueryResult {
    const parsed = parseResponse(raw);
    if (parsed.kind === 'error') {
      throw new NoBugDbError('SERVER_ERROR', parsed.message, { sql });
    }
    if (parsed.kind === 'pong') {
      throw new NoBugDbError('PROTOCOL', 'Unexpected PONG for QUERY', { sql });
    }
    return {
      success: true,
      message: parsed.message,
      columns: parsed.columns,
      rows: parsed.rows,
    };
  }

  #roundTrip(message: string): Promise<string> {
    const socket = this.#socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(
        new NoBugDbError('CONNECTION_CLOSED', 'Socket is closed'),
      );
    }

    return new Promise<string>((resolve, reject) => {
      if (this.#pending) {
        reject(new NoBugDbError('PROTOCOL', 'Internal: overlapping round-trip'));
        return;
      }

      this.#receiveBuffer = '';
      const timeout = setTimeout(() => {
        this.#failPending(
          new NoBugDbError(
            'TIMEOUT',
            `Query timed out after ${this.#options.queryTimeoutMs}ms`,
          ),
        );
      }, this.#options.queryTimeoutMs);

      this.#pending = {
        resolve: (value) => {
          clearTimeout(timeout);
          this.#pending = null;
          this.#clearIdleTimer();
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.#pending = null;
          this.#clearIdleTimer();
          reject(err);
        },
        timeout,
      };

      socket.write(message, (err) => {
        if (err) {
          this.#failPending(
            new NoBugDbError('SOCKET', err.message, { cause: err }),
          );
        }
      });
    });
  }

  #attachSocketHandlers(socket: Socket): void {
    socket.setEncoding('utf8');

    socket.on('data', (chunk: string) => {
      if (!this.#pending) {
        return;
      }

      this.#receiveBuffer += chunk;

      if (Buffer.byteLength(this.#receiveBuffer, 'utf8') > this.#options.maxResponseBytes) {
        this.#failPending(
          new NoBugDbError(
            'RESPONSE_TOO_LARGE',
            `Response exceeded ${this.#options.maxResponseBytes} bytes`,
          ),
        );
        return;
      }

      this.#maybeCompleteResponse();
    });

    socket.on('error', (err) => {
      this.#failPending(new NoBugDbError('SOCKET', err.message, { cause: err }));
      this.#open = false;
    });

    socket.on('close', () => {
      this.#open = false;
      this.#failPending(
        new NoBugDbError('CONNECTION_CLOSED', 'Connection closed by peer'),
      );
    });
  }

  #maybeCompleteResponse(): void {
    if (!this.#pending) {
      return;
    }

    if (!isCompleteResponse(this.#receiveBuffer)) {
      return;
    }

    if (needsIdleFlush(this.#receiveBuffer)) {
      this.#clearIdleTimer();
      this.#idleTimer = setTimeout(() => {
        this.#idleTimer = null;
        if (this.#pending && isCompleteResponse(this.#receiveBuffer)) {
          this.#pending.resolve(this.#receiveBuffer);
        }
      }, RESPONSE_IDLE_MS);
      return;
    }

    this.#pending.resolve(this.#receiveBuffer);
  }

  #failPending(err: unknown): void {
    if (this.#pending) {
      this.#pending.reject(err);
    }
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
  }

  #destroySocket(): void {
    this.#clearIdleTimer();
    const socket = this.#socket;
    this.#socket = null;
    this.#open = false;
    if (socket && !socket.destroyed) {
      socket.removeAllListeners();
      socket.destroy();
    }
  }
}

function resolveOptions(options: ConnectionOptions): ResolvedOptions {
  const resolved: ResolvedOptions = {
    host: options.host ?? DEFAULT_HOST,
    port: options.port ?? DEFAULT_PORT,
    connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    queryTimeoutMs: options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    maxRequestBytes: options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  };

  if (options.user !== undefined) {
    resolved.user = options.user;
  }
  if (options.password !== undefined) {
    resolved.password = options.password;
  }

  return resolved;
}

function openSocket(options: ResolvedOptions): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: options.host,
      port: options.port,
    });

    const onError = (err: Error): void => {
      cleanup();
      socket.destroy();
      reject(new NoBugDbError('SOCKET', err.message, { cause: err }));
    };

    const onTimeout = (): void => {
      cleanup();
      socket.destroy();
      reject(
        new NoBugDbError(
          'TIMEOUT',
          `Connect timed out after ${options.connectTimeoutMs}ms`,
        ),
      );
    };

    const timer = setTimeout(onTimeout, options.connectTimeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('error', onError);
      socket.off('connect', onConnect);
    };

    const onConnect = (): void => {
      cleanup();
      socket.setNoDelay(true);
      resolve(socket);
    };

    socket.once('error', onError);
    socket.once('connect', onConnect);
  });
}
