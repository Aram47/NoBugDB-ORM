import { NoBugDbError } from '../../driver/errors.js';
import { DEFAULT_MAX_REQUEST_BYTES } from '../../driver/types.js';
import type { NoBugDbDataType } from '../../types/type-mapper.js';
import type { FunctionBodyStyle, RoutineParam } from '../types.js';

const DATA_TYPES = new Set<NoBugDbDataType>([
  'INT',
  'FLOAT',
  'STRING',
  'BOOLEAN',
  'DATE',
  'UUID',
]);

const BODY_STYLES = new Set<FunctionBodyStyle>(['dollar', 'expr']);

/**
 * Asserts a routine name is non-empty after trim.
 */
export function assertValidRoutineName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new NoBugDbError('INVALID_IDENTIFIER', 'Routine name cannot be empty');
  }
  return trimmed;
}

/**
 * Asserts routine body is non-empty and does not nest `$$` delimiters.
 * Body is a trusted SQL fragment.
 */
export function assertValidRoutineBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new NoBugDbError('UNSUPPORTED_SQL', 'Routine body cannot be empty');
  }
  if (trimmed.includes('$$')) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      'Routine body must not contain $$ (nested dollar-quoting is not supported)',
    );
  }
  return trimmed;
}

/**
 * Asserts `type` is a supported NoBugDB data type.
 */
export function assertValidRoutineDataType(type: string): NoBugDbDataType {
  if (!DATA_TYPES.has(type as NoBugDbDataType)) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      `Unsupported routine type: ${type} (expected INT|FLOAT|STRING|BOOLEAN|DATE|UUID)`,
    );
  }
  return type as NoBugDbDataType;
}

/**
 * Asserts function RETURNS type.
 */
export function assertValidFunctionReturns(type: string): NoBugDbDataType {
  return assertValidRoutineDataType(type);
}

/**
 * Asserts function body style is dollar or expr.
 */
export function assertValidFunctionStyle(style: string): FunctionBodyStyle {
  if (!BODY_STYLES.has(style as FunctionBodyStyle)) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      `Unsupported function body style: ${style} (expected dollar or expr)`,
    );
  }
  return style as FunctionBodyStyle;
}

/**
 * Validates IN params (name + type). Empty param list is allowed.
 */
export function assertValidRoutineParams(
  params: readonly RoutineParam[],
): RoutineParam[] {
  return params.map((param, index) => {
    const name = param.name.trim();
    if (name.length === 0) {
      throw new NoBugDbError(
        'INVALID_IDENTIFIER',
        `Routine parameter name at index ${index} cannot be empty`,
      );
    }
    return {
      name,
      type: assertValidRoutineDataType(param.type),
    };
  });
}

/**
 * Fail-fast if the encoded QUERY frame would exceed the wire buffer (default 1 MiB).
 */
export function assertRoutineSqlFitsWire(
  sql: string,
  maxRequestBytes: number = DEFAULT_MAX_REQUEST_BYTES,
): void {
  const size = Buffer.byteLength(`QUERY|${sql}\n`, 'utf8');
  if (size > maxRequestBytes) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      `Routine SQL request is ${size} bytes; max is ${maxRequestBytes}`,
    );
  }
}
