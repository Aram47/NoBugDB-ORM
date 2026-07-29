import type { QueryResult } from '../driver/types.js';

export interface ExplainResult {
  /** Raw plan lines from the QUERY PLAN column (no ORM parsing). */
  plan: string[];
  /** Full wire QueryResult if the caller needs columns/rows/message. */
  raw: QueryResult;
}
