import { NoBugDbError } from '../../driver/errors.js';
import type {
  HashPartitionValues,
  PartitionStrategy,
  RangePartitionValues,
} from '../types.js';

/**
 * Asserts a partition key column name is non-empty after trim.
 */
export function assertValidPartitionColumn(column: string): string {
  const trimmed = column.trim();
  if (trimmed.length === 0) {
    throw new NoBugDbError('INVALID_IDENTIFIER', 'Partition column cannot be empty');
  }
  return trimmed;
}

/**
 * Asserts strategy is RANGE or HASH.
 */
export function assertValidPartitionStrategy(strategy: string): PartitionStrategy {
  if (strategy !== 'RANGE' && strategy !== 'HASH') {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      `Unsupported partition strategy: ${strategy} (expected RANGE or HASH)`,
    );
  }
  return strategy;
}

export function isHashPartitionValues(
  values: RangePartitionValues | HashPartitionValues,
): values is HashPartitionValues {
  return (
    typeof values === 'object' &&
    values !== null &&
    'modulus' in values &&
    'remainder' in values
  );
}

export function isRangePartitionValues(
  values: RangePartitionValues | HashPartitionValues,
): values is RangePartitionValues {
  return (
    typeof values === 'object' &&
    values !== null &&
    'from' in values &&
    'to' in values
  );
}

/**
 * Validates HASH partition values: modulus > 0, 0 ≤ remainder < modulus.
 */
export function assertValidHashPartitionValues(
  values: HashPartitionValues,
): HashPartitionValues {
  const { modulus, remainder } = values;
  if (!Number.isInteger(modulus) || modulus <= 0) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      `HASH partition modulus must be a positive integer, got ${String(modulus)}`,
    );
  }
  if (!Number.isInteger(remainder) || remainder < 0 || remainder >= modulus) {
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      `HASH partition remainder must satisfy 0 <= remainder < modulus (got remainder=${String(remainder)}, modulus=${modulus})`,
    );
  }
  return values;
}

/**
 * Validates RANGE partition bounds are both present (not null/undefined).
 */
export function assertValidRangePartitionValues(
  values: RangePartitionValues,
): RangePartitionValues {
  if (values.from === undefined || values.from === null) {
    throw new NoBugDbError('UNSUPPORTED_SQL', 'RANGE partition "from" bound is required');
  }
  if (values.to === undefined || values.to === null) {
    throw new NoBugDbError('UNSUPPORTED_SQL', 'RANGE partition "to" bound is required');
  }
  return values;
}

/**
 * Narrows and validates partition values for CREATE PARTITION.
 */
export function assertValidPartitionValues(
  values: RangePartitionValues | HashPartitionValues,
): RangePartitionValues | HashPartitionValues {
  if (isHashPartitionValues(values)) {
    return assertValidHashPartitionValues(values);
  }
  if (isRangePartitionValues(values)) {
    return assertValidRangePartitionValues(values);
  }
  throw new NoBugDbError(
    'UNSUPPORTED_SQL',
    'Partition values must be RANGE { from, to } or HASH { modulus, remainder }',
  );
}
