import { NoBugDbError } from '../../driver/errors.js';

export interface CheckConstraintState {
  name: string;
  expression: string;
}

const FORBIDDEN_CHECK_PATTERN = /\b(?:SELECT|EXISTS)\b/i;

/**
 * Asserts a CHECK constraint name is non-empty after trim.
 */
export function assertValidCheckName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new NoBugDbError('INVALID_IDENTIFIER', 'CHECK constraint name cannot be empty');
  }
  return trimmed;
}

/**
 * Asserts a CHECK predicate expression is non-empty after trim.
 * Expression is a trusted SQL fragment (no ORM parsing). Engine v1 rejects
 * subquery and aggregate constructs inside CHECK.
 */
export function assertValidCheckExpression(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    throw new NoBugDbError('UNSUPPORTED_SQL', 'CHECK expression cannot be empty');
  }
  assertNoForbiddenCheckConstruct(trimmed);
  return trimmed;
}

/**
 * Best-effort guard: rejects SELECT / EXISTS which usually indicate a subquery.
 */
export function assertNoForbiddenCheckConstruct(expression: string): void {
  if (FORBIDDEN_CHECK_PATTERN.test(expression)) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      'CHECK expression must not contain SELECT or EXISTS (subqueries are not supported)',
    );
  }
}
