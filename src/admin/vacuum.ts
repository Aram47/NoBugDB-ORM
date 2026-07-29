/**
 * Build bare `VACUUM` (global version GC).
 * Per-table `VACUUM name` exists on the engine but is not exposed in Phase 9.
 */
export function generateVacuumSql(): string {
  return 'VACUUM';
}
