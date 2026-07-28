import { describe, expect, it } from 'vitest';
import type { NoBugDbError } from '../../../src/driver/errors.js';
import type { QueryResult } from '../../../src/driver/types.js';
import { QueryBuilder } from '../../../src/query-builder/query-builder.js';
import { runPrepared } from '../../../src/query-builder/prepared.js';
import { sql } from '../../../src/query-builder/sql-fragments.js';

function mockExecutor(
  onQuery?: (sql: string) => QueryResult | void,
): { query: (sql: string) => Promise<QueryResult> } {
  return {
    async query(sqlText: string): Promise<QueryResult> {
      onQuery?.(sqlText);
      if (sqlText.startsWith('PREPARE')) {
        return { success: true, message: '', columns: [], rows: [] };
      }
      if (sqlText.startsWith('DEALLOCATE')) {
        return { success: true, message: '', columns: [], rows: [] };
      }
      if (sqlText.startsWith('EXECUTE')) {
        return {
          success: true,
          message: '',
          columns: ['id', 'name'],
          rows: [['1', 'Ada']],
        };
      }
      return { success: true, message: '', columns: [], rows: [] };
    },
  };
}

describe('QueryBuilder', () => {
  it('builds SELECT with JOIN, ORDER, LIMIT snapshot', () => {
    const { sql: built } = new QueryBuilder(mockExecutor())
      .select('u.id', 'u.name')
      .from('users', 'u')
      .leftJoin('orders', 'u.id = orders.user_id', 'o')
      .where({ active: true })
      .orderBy('u.name', 'DESC')
      .limit(5)
      .offset(10)
      .toSql();

    expect(built).toBe(
      "SELECT u.id, u.name FROM users u LEFT JOIN orders o ON u.id = orders.user_id WHERE active = TRUE ORDER BY u.name DESC LIMIT 5 OFFSET 10",
    );
  });

  it('builds aggregate SELECT columns', () => {
    const { sql: built } = new QueryBuilder(mockExecutor())
      .select(sql.count('id'), 'name')
      .from('users')
      .groupBy('name')
      .toSql();

    expect(built).toBe('SELECT COUNT(id), name FROM users GROUP BY name');
  });

  it('rejects ORDER BY ordinal', () => {
    expect(() =>
      new QueryBuilder(mockExecutor())
        .select('id')
        .from('users')
        .orderBy('1')
        .toSql(),
    ).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_SQL' } satisfies Partial<NoBugDbError>),
    );
  });

  it('splits multi-row INSERT when exceeding maxRequestBytes', async () => {
    const executes: string[] = [];
    const executor = mockExecutor((sqlText) => {
      if (sqlText.startsWith('EXECUTE')) {
        executes.push(sqlText);
      }
    });

    await new QueryBuilder(executor, { maxRequestBytes: 70 })
      .insertInto('users')
      .values([
        { id: '1', name: 'aaaaaaaaaa' },
        { id: '2', name: 'bbbbbbbbbb' },
        { id: '3', name: 'cccccccccc' },
      ])
      .executeCommand();

    expect(executes.length).toBeGreaterThan(1);
  });

  it('executes SELECT via PREPARE and deallocates', async () => {
    const queries: string[] = [];
    const executor = mockExecutor((sqlText) => {
      queries.push(sqlText);
    });

    const rows = await new QueryBuilder(executor)
      .select('id', 'name')
      .from('users')
      .where({ id: 1 })
      .execute();

    expect(rows).toEqual([{ id: '1', name: 'Ada' }]);
    expect(queries.some((q) => q.startsWith('PREPARE orm_'))).toBe(true);
    expect(queries.some((q) => q.startsWith('EXECUTE orm_'))).toBe(true);
    expect(queries.some((q) => q.startsWith('DEALLOCATE PREPARE orm_'))).toBe(
      true,
    );
  });
});

describe('runPrepared', () => {
  it('uses unique statement names', async () => {
    const names: string[] = [];
    const executor = mockExecutor((sqlText) => {
      const match = sqlText.match(/^PREPARE (orm_[a-f0-9]+)/);
      if (match) {
        names.push(match[1]!);
      }
    });

    await runPrepared(executor, 'SELECT 1 WHERE id = $1', [1]);
    await runPrepared(executor, 'SELECT 1 WHERE id = $1', [2]);

    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
  });
});
