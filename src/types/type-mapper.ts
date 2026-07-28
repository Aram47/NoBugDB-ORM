import { NoBugDbError } from '../driver/errors.js';

export type NoBugDbDataType =
  | 'INT'
  | 'FLOAT'
  | 'STRING'
  | 'BOOLEAN'
  | 'DATE'
  | 'UUID';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

function toDateString(value: Date): string {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateString(value: string): Date {
  if (!isValidDateString(value)) {
    throw new NoBugDbError('TYPE_MISMATCH', `Invalid DATE value: ${value}`);
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day));
}

export class TypeMapper {
  toSql(value: unknown, type: NoBugDbDataType): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    switch (type) {
      case 'INT': {
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
          throw new NoBugDbError(
            'TYPE_MISMATCH',
            `Expected safe integer for INT, got ${typeof value}`,
          );
        }
        return String(value);
      }
      case 'FLOAT': {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new NoBugDbError(
            'TYPE_MISMATCH',
            `Expected number for FLOAT, got ${typeof value}`,
          );
        }
        return String(value);
      }
      case 'STRING': {
        if (typeof value !== 'string') {
          throw new NoBugDbError(
            'TYPE_MISMATCH',
            `Expected string for STRING, got ${typeof value}`,
          );
        }
        return `'${value.replace(/'/g, "''")}'`;
      }
      case 'BOOLEAN': {
        if (typeof value !== 'boolean') {
          throw new NoBugDbError(
            'TYPE_MISMATCH',
            `Expected boolean for BOOLEAN, got ${typeof value}`,
          );
        }
        return value ? 'TRUE' : 'FALSE';
      }
      case 'DATE': {
        let dateStr: string;
        if (value instanceof Date) {
          dateStr = toDateString(value);
        } else if (typeof value === 'string') {
          if (!isValidDateString(value)) {
            throw new NoBugDbError(
              'TYPE_MISMATCH',
              `Invalid DATE string: ${value}`,
            );
          }
          dateStr = value;
        } else {
          throw new NoBugDbError(
            'TYPE_MISMATCH',
            `Expected Date or YYYY-MM-DD string for DATE, got ${typeof value}`,
          );
        }
        return `'${dateStr}'`;
      }
      case 'UUID': {
        if (typeof value !== 'string' || !isValidUuid(value)) {
          throw new NoBugDbError(
            'TYPE_MISMATCH',
            `Expected canonical UUID string, got ${String(value)}`,
          );
        }
        return `'${value}'`;
      }
      default: {
        const _exhaustive: never = type;
        throw new NoBugDbError('TYPE_MISMATCH', `Unknown type: ${_exhaustive}`);
      }
    }
  }

  fromWire(raw: string | null, type: NoBugDbDataType): unknown {
    if (raw === null) {
      return null;
    }

    switch (type) {
      case 'INT': {
        const n = Number(raw);
        if (!Number.isSafeInteger(n)) {
          throw new NoBugDbError(
            'TYPE_MISMATCH',
            `Invalid INT wire value: ${raw}`,
          );
        }
        return n;
      }
      case 'FLOAT': {
        const n = Number(raw);
        if (Number.isNaN(n)) {
          throw new NoBugDbError(
            'TYPE_MISMATCH',
            `Invalid FLOAT wire value: ${raw}`,
          );
        }
        return n;
      }
      case 'STRING':
        return raw;
      case 'BOOLEAN': {
        const lower = raw.toLowerCase();
        if (lower === 'true' || lower === '1') {
          return true;
        }
        if (lower === 'false' || lower === '0') {
          return false;
        }
        throw new NoBugDbError(
          'TYPE_MISMATCH',
          `Invalid BOOLEAN wire value: ${raw}`,
        );
      }
      case 'DATE':
        return parseDateString(raw);
      case 'UUID': {
        if (!isValidUuid(raw)) {
          throw new NoBugDbError(
            'TYPE_MISMATCH',
            `Invalid UUID wire value: ${raw}`,
          );
        }
        return raw;
      }
      default: {
        const _exhaustive: never = type;
        throw new NoBugDbError('TYPE_MISMATCH', `Unknown type: ${_exhaustive}`);
      }
    }
  }
}

export const defaultTypeMapper = new TypeMapper();
