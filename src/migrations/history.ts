import { NoBugDbError } from '../driver/errors.js';
import { escapeLiteral, quoteIdent } from '../query-builder/escape.js';
import type { QueryExecutor } from '../query-builder/prepared.js';

export const DEFAULT_HISTORY_TABLE = 'orm_migrations';

export function generateCreateHistoryTableSql(tableName: string): string {
  return `CREATE TABLE ${quoteIdent(tableName)} (id STRING PRIMARY KEY, applied_at STRING NOT NULL)`;
}

export async function ensureHistoryTable(
  executor: QueryExecutor,
  tableName = DEFAULT_HISTORY_TABLE,
): Promise<void> {
  const probe = await executor.query(
    `SELECT id FROM ${quoteIdent(tableName)} LIMIT 1`,
  );

  if (probe.success) {
    return;
  }

  const create = await executor.query(generateCreateHistoryTableSql(tableName));
  if (!create.success) {
    throw new NoBugDbError(
      'QUERY_FAILED',
      create.message || `Failed to create history table ${tableName}`,
    );
  }
}

export async function getAppliedIds(
  executor: QueryExecutor,
  tableName = DEFAULT_HISTORY_TABLE,
): Promise<string[]> {
  const result = await executor.query(
    `SELECT id FROM ${quoteIdent(tableName)} ORDER BY id`,
  );

  if (!result.success) {
    throw new NoBugDbError(
      'QUERY_FAILED',
      result.message || `Failed to read migration history from ${tableName}`,
    );
  }

  const idIndex = result.columns.indexOf('id');
  if (idIndex === -1) {
    return [];
  }

  return result.rows.map((row) => row[idIndex] ?? '');
}

export async function recordApplied(
  executor: QueryExecutor,
  id: string,
  appliedAt: string,
  tableName = DEFAULT_HISTORY_TABLE,
): Promise<void> {
  const sql = `INSERT INTO ${quoteIdent(tableName)} (id, applied_at) VALUES (${escapeLiteral(id, 'STRING')}, ${escapeLiteral(appliedAt, 'STRING')})`;
  const result = await executor.query(sql);
  if (!result.success) {
    throw new NoBugDbError(
      'QUERY_FAILED',
      result.message || `Failed to record migration ${id}`,
    );
  }
}

export async function removeApplied(
  executor: QueryExecutor,
  id: string,
  tableName = DEFAULT_HISTORY_TABLE,
): Promise<void> {
  const sql = `DELETE FROM ${quoteIdent(tableName)} WHERE id = ${escapeLiteral(id, 'STRING')}`;
  const result = await executor.query(sql);
  if (!result.success) {
    throw new NoBugDbError(
      'QUERY_FAILED',
      result.message || `Failed to remove migration ${id} from history`,
    );
  }
}
