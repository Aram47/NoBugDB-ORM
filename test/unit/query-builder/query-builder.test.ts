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

  it('builds UNION / UNION ALL / INTERSECT / EXCEPT', () => {
    const exec = mockExecutor();
    const left = new QueryBuilder(exec).select('id').from('a');
    const right = new QueryBuilder(exec).select('id').from('b');

    expect(left.union(right).toSql().sql).toBe(
      '(SELECT id FROM a) UNION (SELECT id FROM b)',
    );
    expect(
      new QueryBuilder(exec)
        .select('id')
        .from('a')
        .union(new QueryBuilder(exec).select('id').from('b'), { all: true })
        .toSql().sql,
    ).toBe('(SELECT id FROM a) UNION ALL (SELECT id FROM b)');
    expect(
      new QueryBuilder(exec)
        .select('id')
        .from('a')
        .intersect(new QueryBuilder(exec).select('id').from('b'))
        .toSql().sql,
    ).toBe('(SELECT id FROM a) INTERSECT (SELECT id FROM b)');
    expect(
      new QueryBuilder(exec)
        .select('id')
        .from('a')
        .except(new QueryBuilder(exec).select('id').from('b'))
        .toSql().sql,
    ).toBe('(SELECT id FROM a) EXCEPT (SELECT id FROM b)');
  });

  it('chains set operations left-associatively', () => {
    const exec = mockExecutor();
    const { sql: built } = new QueryBuilder(exec)
      .select('id')
      .from('a')
      .union(new QueryBuilder(exec).select('id').from('b'))
      .except(new QueryBuilder(exec).select('id').from('c'))
      .toSql();

    expect(built).toBe(
      '((SELECT id FROM a) UNION (SELECT id FROM b)) EXCEPT (SELECT id FROM c)',
    );
  });

  it('keeps ORDER BY / LIMIT inside left operand of UNION', () => {
    const exec = mockExecutor();
    const { sql: built } = new QueryBuilder(exec)
      .select('id')
      .from('a')
      .orderBy('id')
      .limit(2)
      .union(new QueryBuilder(exec).select('id').from('b'))
      .toSql();

    expect(built).toBe(
      '(SELECT id FROM a ORDER BY id ASC LIMIT 2) UNION (SELECT id FROM b)',
    );
  });

  it('applies ORDER BY / LIMIT after set-op to outermost expression', () => {
    const exec = mockExecutor();
    const { sql: built } = new QueryBuilder(exec)
      .select('id')
      .from('a')
      .union(new QueryBuilder(exec).select('id').from('b'))
      .orderBy('id', 'DESC')
      .limit(5)
      .offset(1)
      .toSql();

    expect(built).toBe(
      '(SELECT id FROM a) UNION (SELECT id FROM b) ORDER BY id DESC LIMIT 5 OFFSET 1',
    );
  });

  it('rejects non-SELECT set-op operand', () => {
    const exec = mockExecutor();
    const select = new QueryBuilder(exec).select('id').from('a');
    const insert = new QueryBuilder(exec).insertInto('a').values({ id: 1 });

    expect(() => select.union(insert)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_SQL' } satisfies Partial<NoBugDbError>),
    );
  });

  it('does not emit INTERSECT ALL or EXCEPT ALL', () => {
    const exec = mockExecutor();
    const intersectSql = new QueryBuilder(exec)
      .select('id')
      .from('a')
      .intersect(new QueryBuilder(exec).select('id').from('b'))
      .toSql().sql;
    const exceptSql = new QueryBuilder(exec)
      .select('id')
      .from('a')
      .except(new QueryBuilder(exec).select('id').from('b'))
      .toSql().sql;

    expect(intersectSql).toBe('(SELECT id FROM a) INTERSECT (SELECT id FROM b)');
    expect(exceptSql).toBe('(SELECT id FROM a) EXCEPT (SELECT id FROM b)');
    expect(intersectSql).not.toContain('ALL');
    expect(exceptSql).not.toContain('ALL');
  });

  it('allows sql.raw that contains UNION', () => {
    expect(() => sql.raw('(SELECT 1) UNION (SELECT 2)')).not.toThrow();
  });

  it('builds ROW_NUMBER OVER ORDER BY', () => {
    const { sql: built } = new QueryBuilder(mockExecutor())
      .select(sql.rowNumber().over({ orderBy: ['id'] }))
      .from('sales')
      .toSql();

    expect(built).toBe('SELECT ROW_NUMBER() OVER (ORDER BY id) FROM sales');
  });

  it('builds partition + order + alias for ranking window', () => {
    const { sql: built } = new QueryBuilder(mockExecutor())
      .select(
        'dept',
        'salary',
        sql
          .rowNumber()
          .over({ partitionBy: ['dept'], orderBy: ['salary'] })
          .as('rn'),
      )
      .from('employees')
      .toSql();

    expect(built).toBe(
      'SELECT dept, salary, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary) AS rn FROM employees',
    );
  });

  it('builds running SUM and AVG OVER', () => {
    const sumSql = new QueryBuilder(mockExecutor())
      .select(sql.sum('x').over({ orderBy: ['x'] }))
      .from('t')
      .toSql().sql;
    expect(sumSql).toBe('SELECT SUM(x) OVER (ORDER BY x) FROM t');

    const avgSql = new QueryBuilder(mockExecutor())
      .select(
        sql.avg('amount').over({
          orderBy: [{ column: 'amount', direction: 'DESC' }],
        }),
      )
      .from('sales')
      .toSql().sql;
    expect(avgSql).toBe(
      'SELECT AVG(amount) OVER (ORDER BY amount DESC) FROM sales',
    );
  });

  it('builds SUM OVER with SqlExpression argument', () => {
    const { sql: built } = new QueryBuilder(mockExecutor())
      .select(
        sql.sum(sql.upper('name')).over({ orderBy: [sql.upper('name')] }),
      )
      .from('users')
      .toSql();

    expect(built).toBe(
      'SELECT SUM(UPPER(name)) OVER (ORDER BY UPPER(name)) FROM users',
    );
  });

  it('rejects empty OVER orderBy', () => {
    expect(() => sql.rowNumber().over({ orderBy: [] })).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_SQL' } satisfies Partial<NoBugDbError>),
    );
  });

  it('allows sql.raw that contains OVER', () => {
    expect(() =>
      sql.raw('ROW_NUMBER() OVER (ORDER BY id)'),
    ).not.toThrow();
  });

  it('builds RANK and DENSE_RANK OVER', () => {
    expect(
      new QueryBuilder(mockExecutor())
        .select(sql.rank().over({ orderBy: ['amount'] }).as('rnk'))
        .from('sales')
        .toSql().sql,
    ).toBe('SELECT RANK() OVER (ORDER BY amount) AS rnk FROM sales');

    expect(
      new QueryBuilder(mockExecutor())
        .select(sql.denseRank().over({ orderBy: ['amount'] }).as('dr'))
        .from('sales')
        .toSql().sql,
    ).toBe('SELECT DENSE_RANK() OVER (ORDER BY amount) AS dr FROM sales');
  });

  it('renumbers placeholders across set-op operands on execute', async () => {
    const prepares: string[] = [];
    const executor = mockExecutor((sqlText) => {
      if (sqlText.startsWith('PREPARE')) {
        prepares.push(sqlText);
      }
    });

    await new QueryBuilder(executor)
      .select('id')
      .from('a')
      .where({ id: 1 })
      .union(
        new QueryBuilder(executor).select('id').from('b').where({ id: 2 }),
      )
      .execute();

    expect(prepares.length).toBe(1);
    expect(prepares[0]).toContain(
      '(SELECT id FROM a WHERE id = $1) UNION (SELECT id FROM b WHERE id = $2)',
    );
  });

  it('builds whereInSubquery', () => {
    const exec = mockExecutor();
    const sub = new QueryBuilder(exec).select('user_id').from('orders');
    const { sql: built } = new QueryBuilder(exec)
      .select('id')
      .from('users')
      .whereInSubquery('id', sub)
      .toSql();

    expect(built).toBe(
      'SELECT id FROM users WHERE id IN (SELECT user_id FROM orders)',
    );
  });

  it('builds whereNotInSubquery / whereExists / whereNotExists', () => {
    const exec = mockExecutor();
    const sub = new QueryBuilder(exec).select('user_id').from('orders');

    expect(
      new QueryBuilder(exec)
        .select('id')
        .from('users')
        .whereNotInSubquery('id', sub)
        .toSql().sql,
    ).toBe(
      'SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM orders)',
    );

    expect(
      new QueryBuilder(exec)
        .select('id')
        .from('users')
        .whereExists(sub)
        .toSql().sql,
    ).toBe(
      'SELECT id FROM users WHERE EXISTS (SELECT user_id FROM orders)',
    );

    expect(
      new QueryBuilder(exec)
        .select('id')
        .from('users')
        .whereNotExists(sub)
        .toSql().sql,
    ).toBe(
      'SELECT id FROM users WHERE NOT EXISTS (SELECT user_id FROM orders)',
    );
  });

  it('builds WhereInput inSubquery and exists forms', () => {
    const exec = mockExecutor();
    const sub = new QueryBuilder(exec).select('user_id').from('orders');

    expect(
      new QueryBuilder(exec)
        .select('id')
        .from('users')
        .where({ col: 'id', inSubquery: sub })
        .toSql().sql,
    ).toBe(
      'SELECT id FROM users WHERE id IN (SELECT user_id FROM orders)',
    );

    expect(
      new QueryBuilder(exec)
        .select('id')
        .from('users')
        .where({ exists: sub })
        .toSql().sql,
    ).toBe(
      'SELECT id FROM users WHERE EXISTS (SELECT user_id FROM orders)',
    );
  });

  it('builds scalar subquery in select list', () => {
    const exec = mockExecutor();
    const { sql: built } = new QueryBuilder(exec)
      .select(
        'id',
        sql
          .subquery(
            new QueryBuilder(exec).select(sql.count('*')).from('orders'),
          )
          .as('order_count'),
      )
      .from('users')
      .toSql();

    expect(built).toBe(
      'SELECT id, (SELECT COUNT(*) FROM orders) AS order_count FROM users',
    );
  });

  it('builds correlated subquery with sql.ref', () => {
    const exec = mockExecutor();
    const { sql: built } = new QueryBuilder(exec)
      .select(
        'id',
        sql
          .subquery(
            new QueryBuilder(exec)
              .select(sql.count('*'))
              .from('orders')
              .where({ user_id: sql.ref('u.id') }),
          )
          .as('order_count'),
      )
      .from('users', 'u')
      .toSql();

    expect(built).toBe(
      'SELECT id, (SELECT COUNT(*) FROM orders WHERE user_id = u.id) AS order_count FROM users u',
    );
  });

  it('rejects INSERT builder as subquery', () => {
    const exec = mockExecutor();
    const insert = new QueryBuilder(exec).insertInto('a').values({ id: 1 });

    expect(() => insert.toSubquerySql()).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_SQL',
      } satisfies Partial<NoBugDbError>),
    );

    expect(() =>
      new QueryBuilder(exec)
        .select('id')
        .from('users')
        .whereInSubquery('id', insert)
        .toSql(),
    ).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_SQL',
      } satisfies Partial<NoBugDbError>),
    );
  });

  it('rejects set-op builder as subquery', () => {
    const exec = mockExecutor();
    const unioned = new QueryBuilder(exec)
      .select('id')
      .from('a')
      .union(new QueryBuilder(exec).select('id').from('b'));

    expect(() => unioned.toSubquerySql()).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_SQL',
      } satisfies Partial<NoBugDbError>),
    );

    expect(() =>
      new QueryBuilder(exec)
        .select('id')
        .from('users')
        .whereExists(unioned)
        .toSql(),
    ).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_SQL',
      } satisfies Partial<NoBugDbError>),
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
