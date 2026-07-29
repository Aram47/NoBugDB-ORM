/**
 * Narrow contract for nested SELECT fragments.
 * Implemented by {@link QueryBuilder}; used by WHERE / `sql.subquery` to avoid cycles.
 */
export interface SubquerySource {
  /** Parenthesized SELECT fragment with escaped literals, no trailing semicolon. */
  toSubquerySql(): string;
}
