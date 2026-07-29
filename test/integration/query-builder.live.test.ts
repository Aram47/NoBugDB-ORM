import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool, QueryBuilder, sql } from '../../src/index.js';
import type { ConnectionOptions } from '../../src/index.js';

const host = process.env.NOBUGDB_HOST;
const port = Number(process.env.NOBUGDB_PORT ?? '9000');
const user = process.env.NOBUGDB_USER;
const password = process.env.NOBUGDB_PASSWORD;

function liveOptions(): ConnectionOptions {
  if (!host) {
    throw new Error('NOBUGDB_HOST is required for live tests');
  }

  const options: ConnectionOptions = {
    host,
    port,
  };

  if (user !== undefined) {
    options.user = user;
    options.password = password ?? '';
  }

  return options;
}

describe.skipIf(!host)('QueryBuilder live', () => {
  let pool: Pool | null = null;
  const tableName = `qb_users_${randomUUID().replace(/-/g, '_')}`;

  afterEach(async () => {
    if (pool) {
      await pool.query(`DROP TABLE IF EXISTS ${tableName}`).catch(() => undefined);
      await pool.end().catch(() => undefined);
      pool = null;
    }
  });

  it('runs CRUD against live NoBugDB', async () => {
    pool = new Pool(liveOptions());
    const id = randomUUID();

    await pool.query(
      `CREATE TABLE ${tableName} (id UUID PRIMARY KEY, name STRING, active BOOLEAN)`,
    );

    const insert = await new QueryBuilder(pool)
      .insertInto(tableName)
      .values({ id, name: "O'Brien", active: true })
      .executeCommand();
    expect(insert.affectedRows).toBe(1);

    const rows = await new QueryBuilder(pool, {
      columnTypes: { id: 'UUID', name: 'STRING', active: 'BOOLEAN' },
    })
      .select('id', 'name', 'active')
      .from(tableName)
      .where({ id })
      .execute<{ id: string; name: string; active: boolean }>();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("O'Brien");
    expect(rows[0]?.active).toBe(true);

    await new QueryBuilder(pool)
      .update(tableName)
      .set({ name: 'Ada' })
      .where({ id })
      .executeCommand();

    const updated = await new QueryBuilder(pool)
      .select('name')
      .from(tableName)
      .where({ id })
      .execute<{ name: string }>();
    expect(updated[0]?.name).toBe('Ada');

    await new QueryBuilder(pool)
      .deleteFrom(tableName)
      .where({ id })
      .executeCommand();

    const remaining = await new QueryBuilder(pool)
      .select('id')
      .from(tableName)
      .execute();
    expect(remaining).toHaveLength(0);
  });

  it('runs UNION / UNION ALL against live NoBugDB', async () => {
    pool = new Pool(liveOptions());
    const idA = randomUUID();
    const idB = randomUUID();

    await pool.query(
      `CREATE TABLE ${tableName} (id UUID PRIMARY KEY, name STRING)`,
    );
    await pool.query(
      `INSERT INTO ${tableName} (id, name) VALUES ('${idA}', 'Ada')`,
    );
    await pool.query(
      `INSERT INTO ${tableName} (id, name) VALUES ('${idB}', 'Grace')`,
    );

    const unionRows = await new QueryBuilder(pool)
      .select('name')
      .from(tableName)
      .where({ name: 'Ada' })
      .union(
        new QueryBuilder(pool).select('name').from(tableName).where({ name: 'Grace' }),
      )
      .execute<{ name: string }>();

    expect(unionRows.map((r) => r.name).sort()).toEqual(['Ada', 'Grace']);

    const allRows = await new QueryBuilder(pool)
      .select('name')
      .from(tableName)
      .where({ name: 'Ada' })
      .union(
        new QueryBuilder(pool).select('name').from(tableName).where({ name: 'Ada' }),
        { all: true },
      )
      .execute<{ name: string }>();

    expect(allRows).toHaveLength(2);
    expect(allRows.every((r) => r.name === 'Ada')).toBe(true);
  });

  it('surfaces server error on set-op column mismatch', async () => {
    pool = new Pool(liveOptions());

    await pool.query(
      `CREATE TABLE ${tableName} (id UUID PRIMARY KEY, name STRING, active BOOLEAN)`,
    );

    await expect(
      new QueryBuilder(pool)
        .select('id', 'name')
        .from(tableName)
        .union(new QueryBuilder(pool).select('id').from(tableName))
        .execute(),
    ).rejects.toThrow();
  });

  it('runs ROW_NUMBER OVER against live NoBugDB', async () => {
    pool = new Pool(liveOptions());
    const salesTable = `qb_sales_${randomUUID().replace(/-/g, '_')}`;

    await pool.query(
      `CREATE TABLE ${salesTable} (id INT PRIMARY KEY, dept STRING, amount INT)`,
    );
    await pool.query(
      `INSERT INTO ${salesTable} VALUES (1, 'A', 10), (2, 'A', 20), (3, 'A', 20), (4, 'B', 5), (5, 'B', 15)`,
    );

    try {
      const rows = await new QueryBuilder(pool, {
        columnTypes: { dept: 'STRING', amount: 'INT', rn: 'INT' },
      })
        .select(
          'dept',
          'amount',
          sql
            .rowNumber()
            .over({
              partitionBy: ['dept'],
              orderBy: ['amount', 'id'],
            })
            .as('rn'),
        )
        .from(salesTable)
        .orderBy('dept')
        .orderBy('rn')
        .execute<{ dept: string; amount: number; rn: number }>();

      expect(rows).toHaveLength(5);
      expect(rows[0]).toMatchObject({ dept: 'A', rn: 1 });
      expect(rows[1]?.rn).toBe(2);
      expect(rows[2]?.rn).toBe(3);
      expect(rows[3]).toMatchObject({ dept: 'B', rn: 1 });
      expect(rows[4]?.rn).toBe(2);

      const explain = await pool.query(
        `EXPLAIN SELECT dept, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY id) FROM ${salesTable}`,
      );
      const plan = [
        explain.message,
        ...explain.rows.map((row) => row.join(' ')),
      ].join('\n');
      expect(plan).toContain('Window');
    } finally {
      await pool.query(`DROP TABLE IF EXISTS ${salesTable}`).catch(() => undefined);
    }
  });

  it('runs IN / EXISTS / correlated / scalar subqueries', async () => {
    pool = new Pool(liveOptions());
    const usersTable = `qb_sub_users_${randomUUID().replace(/-/g, '_')}`;
    const ordersTable = `qb_sub_orders_${randomUUID().replace(/-/g, '_')}`;
    const userA = randomUUID();
    const userB = randomUUID();
    const orderId = randomUUID();

    await pool.query(
      `CREATE TABLE ${usersTable} (id UUID PRIMARY KEY, name STRING)`,
    );
    await pool.query(
      `CREATE TABLE ${ordersTable} (id UUID PRIMARY KEY, user_id UUID, amount INT)`,
    );
    await pool.query(
      `INSERT INTO ${usersTable} (id, name) VALUES ('${userA}', 'Ada'), ('${userB}', 'Grace')`,
    );
    await pool.query(
      `INSERT INTO ${ordersTable} (id, user_id, amount) VALUES ('${orderId}', '${userA}', 42)`,
    );

    try {
      const inRows = await new QueryBuilder(pool)
        .select('name')
        .from(usersTable)
        .whereInSubquery(
          'id',
          new QueryBuilder(pool).select('user_id').from(ordersTable),
        )
        .execute<{ name: string }>();
      expect(inRows.map((r) => r.name)).toEqual(['Ada']);

      const existsRows = await new QueryBuilder(pool)
        .select('name')
        .from(usersTable, 'u')
        .whereExists(
          new QueryBuilder(pool)
            .select('id')
            .from(ordersTable)
            .where({ user_id: sql.ref('u.id') }),
        )
        .execute<{ name: string }>();
      expect(existsRows.map((r) => r.name)).toEqual(['Ada']);

      const scalarRows = await new QueryBuilder(pool, {
        columnTypes: { name: 'STRING', order_count: 'INT' },
      })
        .select(
          'name',
          sql
            .subquery(
              new QueryBuilder(pool)
                .select(sql.count('*'))
                .from(ordersTable)
                .where({ user_id: sql.ref('u.id') }),
            )
            .as('order_count'),
        )
        .from(usersTable, 'u')
        .orderBy('name')
        .execute<{ name: string; order_count: number }>();

      expect(scalarRows).toEqual([
        { name: 'Ada', order_count: 1 },
        { name: 'Grace', order_count: 0 },
      ]);
    } finally {
      await pool
        .query(`DROP TABLE IF EXISTS ${ordersTable}`)
        .catch(() => undefined);
      await pool
        .query(`DROP TABLE IF EXISTS ${usersTable}`)
        .catch(() => undefined);
    }
  });

  it('runs CAST / COALESCE / CURRENT_DATE against live NoBugDB', async () => {
    pool = new Pool(liveOptions());
    const scalarsTable = `qb_scalars_${randomUUID().replace(/-/g, '_')}`;

    await pool.query(
      `CREATE TABLE ${scalarsTable} (id INT PRIMARY KEY, label STRING, amount INT)`,
    );
    await pool.query(
      `INSERT INTO ${scalarsTable} VALUES (1, '42', NULL), (2, 'x', 7)`,
    );

    try {
      const rows = await new QueryBuilder(pool, {
        columnTypes: {
          casted: 'INT',
          filled: 'INT',
          today: 'DATE',
        },
      })
        .select(
          sql.cast('label', 'INT').as('casted'),
          sql.coalesce('amount', 0).as('filled'),
          sql.currentDate().as('today'),
        )
        .from(scalarsTable)
        .where({ id: 1 })
        .execute<{ casted: number; filled: number; today: Date }>();

      expect(rows).toHaveLength(1);
      expect(rows[0]?.casted).toBe(42);
      expect(rows[0]?.filled).toBe(0);
      expect(rows[0]?.today).toBeInstanceOf(Date);
    } finally {
      await pool
        .query(`DROP TABLE IF EXISTS ${scalarsTable}`)
        .catch(() => undefined);
    }
  });
});
