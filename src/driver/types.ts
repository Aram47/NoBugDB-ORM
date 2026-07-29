export interface ConnectionOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  connectTimeoutMs?: number;
  queryTimeoutMs?: number;
  /**
   * Max encoded request size in bytes. Default 1 MiB — aligned with the
   * NoBugDB server read buffer (`Connection::read_message`).
   * Oversized requests fail fast with code `REQUEST_TOO_LARGE`.
   */
  maxRequestBytes?: number;
  /** Max response bytes to accumulate before failing with `RESPONSE_TOO_LARGE`. */
  maxResponseBytes?: number;
}

export interface QueryResult {
  success: boolean;
  message: string;
  columns: string[];
  /** Raw wire cells; SQL NULL is `null` (`\N` on the wire). */
  rows: (string | null)[][];
  affectedRows?: number;
}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 9000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

/** Idle wait after a tabular OK frame may still receive TCP fragments. */
export const RESPONSE_IDLE_MS = 10;
