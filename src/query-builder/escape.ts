import { NoBugDbError } from '../driver/errors.js';
import type {
  TypeMapper} from '../types/type-mapper.js';
import {
  defaultTypeMapper,
  type NoBugDbDataType,
} from '../types/type-mapper.js';

const UNQUOTED_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const UNSUPPORTED_KEYWORDS = [
  'LIKE',
  'ILIKE',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'RETURNING',
  'ON CONFLICT',
  'WITH',
  'OVER',
] as const;

export function assertValidIdentifier(name: string): void {
  if (name.length === 0) {
    throw new NoBugDbError('INVALID_IDENTIFIER', 'Identifier cannot be empty');
  }

  if (/[;\s]/.test(name)) {
    throw new NoBugDbError(
      'INVALID_IDENTIFIER',
      `Invalid identifier (contains whitespace or semicolon): ${name}`,
    );
  }

  if (!UNQUOTED_IDENT_RE.test(name) && !name.startsWith('"')) {
    throw new NoBugDbError(
      'INVALID_IDENTIFIER',
      `Identifier must match [a-zA-Z_][a-zA-Z0-9_]* or be quoted: ${name}`,
    );
  }
}

export function quoteIdent(name: string): string {
  assertValidIdentifier(name);

  if (UNQUOTED_IDENT_RE.test(name)) {
    return name;
  }

  if (name.startsWith('"') && name.endsWith('"')) {
    const inner = name.slice(1, -1);
    return `"${inner.replace(/"/g, '""')}"`;
  }

  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteQualifiedIdent(qualified: string): string {
  const parts = qualified.split('.');
  return parts.map((part) => quoteIdent(part)).join('.');
}

export function escapeLiteral(
  value: unknown,
  type?: NoBugDbDataType,
  mapper: TypeMapper = defaultTypeMapper,
): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (type !== undefined) {
    return mapper.toSql(value, type);
  }

  if (typeof value === 'string') {
    return mapper.toSql(value, 'STRING');
  }
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) {
      return mapper.toSql(value, 'INT');
    }
    return mapper.toSql(value, 'FLOAT');
  }
  if (typeof value === 'boolean') {
    return mapper.toSql(value, 'BOOLEAN');
  }
  if (value instanceof Date) {
    return mapper.toSql(value, 'DATE');
  }

  throw new NoBugDbError(
    'TYPE_MISMATCH',
    `Cannot infer SQL literal type for value of type ${typeof value}`,
  );
}

export function assertSupportedSqlFragment(text: string): void {
  const upper = text.toUpperCase();
  for (const keyword of UNSUPPORTED_KEYWORDS) {
    if (upper.includes(keyword)) {
      throw new NoBugDbError(
        'UNSUPPORTED_SQL',
        `Unsupported SQL feature: ${keyword}`,
      );
    }
  }
}

export function assertNotOrderByOrdinal(column: string): void {
  if (/^\d+$/.test(column.trim())) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      'ORDER BY ordinal positions are not supported',
    );
  }
}
