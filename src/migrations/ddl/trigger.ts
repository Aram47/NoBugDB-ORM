import { NoBugDbError } from '../../driver/errors.js';
import { DEFAULT_MAX_REQUEST_BYTES } from '../../driver/types.js';
import type { TriggerEvent, TriggerTiming } from '../types.js';

const TIMINGS = new Set<TriggerTiming>(['BEFORE', 'AFTER']);
const EVENTS = new Set<TriggerEvent>(['INSERT', 'UPDATE', 'DELETE']);

/**
 * Asserts a trigger name is non-empty after trim.
 */
export function assertValidTriggerName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new NoBugDbError('INVALID_IDENTIFIER', 'Trigger name cannot be empty');
  }
  return trimmed;
}

/**
 * Asserts a trigger target table name is non-empty after trim.
 */
export function assertValidTriggerTable(table: string): string {
  const trimmed = table.trim();
  if (trimmed.length === 0) {
    throw new NoBugDbError('INVALID_IDENTIFIER', 'Trigger table cannot be empty');
  }
  return trimmed;
}

/**
 * Asserts timing is BEFORE or AFTER.
 */
export function assertValidTriggerTiming(timing: string): TriggerTiming {
  if (!TIMINGS.has(timing as TriggerTiming)) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      `Unsupported trigger timing: ${timing} (expected BEFORE or AFTER)`,
    );
  }
  return timing as TriggerTiming;
}

/**
 * Asserts event is INSERT, UPDATE, or DELETE.
 */
export function assertValidTriggerEvent(event: string): TriggerEvent {
  if (!EVENTS.has(event as TriggerEvent)) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      `Unsupported trigger event: ${event} (expected INSERT, UPDATE, or DELETE)`,
    );
  }
  return event as TriggerEvent;
}

/**
 * Asserts trigger body is non-empty and does not nest `$$` delimiters.
 * Body is a trusted SQL fragment (semicolon-separated statements).
 */
export function assertValidTriggerBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new NoBugDbError('UNSUPPORTED_SQL', 'Trigger body cannot be empty');
  }
  if (trimmed.includes('$$')) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      'Trigger body must not contain $$ (nested dollar-quoting is not supported)',
    );
  }
  return trimmed;
}

/**
 * Fail-fast if the encoded QUERY frame would exceed the ~4 KiB wire buffer.
 */
export function assertTriggerSqlFitsWire(
  sql: string,
  maxRequestBytes: number = DEFAULT_MAX_REQUEST_BYTES,
): void {
  const size = Buffer.byteLength(`QUERY|${sql}\n`, 'utf8');
  if (size > maxRequestBytes) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      `Trigger SQL request is ${size} bytes; max is ${maxRequestBytes}`,
    );
  }
}
