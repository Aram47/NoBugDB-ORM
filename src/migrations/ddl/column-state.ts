import type { NoBugDbDataType } from '../../types/type-mapper.js';
import type { FkOptions } from '../types.js';

export interface ColumnState {
  name: string;
  type: NoBugDbDataType;
  primary: boolean;
  unique: boolean;
  notNull: boolean;
  defaultValue?: unknown;
  /** Column-level CHECK predicate (trusted SQL fragment). */
  checkExpression?: string;
  references?: {
    table: string;
    column: string;
    onDelete?: FkOptions['onDelete'];
    onUpdate?: FkOptions['onUpdate'];
  };
}

export function createColumnState(name: string, type: NoBugDbDataType): ColumnState {
  return {
    name,
    type,
    primary: false,
    unique: false,
    notNull: false,
  };
}
