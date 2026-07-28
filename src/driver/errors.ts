export type NoBugDbErrorCode =
  | 'REQUEST_TOO_LARGE'
  | 'RESPONSE_TOO_LARGE'
  | 'TIMEOUT'
  | 'CONNECTION_CLOSED'
  | 'SOCKET'
  | 'AUTH_FAILED'
  | 'SERVER_ERROR'
  | 'PROTOCOL'
  | 'NOT_CONNECTED'
  | 'EXPRESS_EM_MISSING'
  | 'NESTED_TX_UNSUPPORTED'
  | 'IN_TRANSACTION'
  | 'POOL_CLOSED'
  | 'UNSUPPORTED_SQL'
  | 'TYPE_MISMATCH'
  | 'INVALID_IDENTIFIER'
  | 'METADATA'
  | 'ENTITY_NOT_FOUND'
  | 'NOT_INITIALIZED'
  | 'QUERY_FAILED'
  | 'INVALID_MIGRATION';

export class NoBugDbError extends Error {
  readonly code: NoBugDbErrorCode;
  readonly sql?: string;

  constructor(
    code: NoBugDbErrorCode,
    message: string,
    options?: { sql?: string; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'NoBugDbError';
    this.code = code;
    if (options?.sql !== undefined) {
      this.sql = options.sql;
    }
  }
}
