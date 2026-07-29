import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DataSource,
  Pool,
  createMigrationContext,
  sql,
} from '../../src/index.js';
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

describe.skipIf(!host)('routines live', () => {
  let pool: Pool | null = null;
  let dataSource: DataSource | null = null;
  const suffix = randomUUID().replace(/-/g, '_');
  const tableName = `orm_rtn_${suffix}`;
  const fnName = `double_it_${suffix}`;
  const fnExprName = `triple_it_${suffix}`;
  const procName = `add_row_${suffix}`;

  afterEach(async () => {
    if (dataSource) {
      await dataSource.destroy().catch(() => undefined);
      dataSource = null;
    }
    if (pool) {
      await pool.query(`DROP PROCEDURE ${procName}`).catch(() => undefined);
      await pool.query(`DROP FUNCTION ${fnName}`).catch(() => undefined);
      await pool.query(`DROP FUNCTION ${fnExprName}`).catch(() => undefined);
      await pool.query(`DROP TABLE IF EXISTS ${tableName}`).catch(() => undefined);
      await pool.end().catch(() => undefined);
      pool = null;
    }
  });

  it('createFunction dollar + expr; SELECT uses UDF; drop stops resolving', async () => {
    pool = new Pool(liveOptions());
    const ctx = createMigrationContext(pool);

    await ctx.schema.createFunction(fnName, {
      params: [{ name: 'x', type: 'INT' }],
      returns: 'INT',
      body: 'RETURN x * 2;',
    });

    await ctx.schema.createFunction(fnExprName, {
      params: [{ name: 'x', type: 'INT' }],
      returns: 'INT',
      body: 'x * 3',
      style: 'expr',
    });

    const doubled = await ctx.query(`SELECT ${fnName}(21)`);
    expect(doubled.success).toBe(true);
    expect(doubled.rows[0]?.[0]).toBe('42');

    const viaFn = sql.fn(fnName, 7);
    const fromSqlFn = await ctx.query(`SELECT ${viaFn.text}`);
    expect(fromSqlFn.success).toBe(true);
    expect(fromSqlFn.rows[0]?.[0]).toBe('14');

    const tripled = await ctx.query(`SELECT ${fnExprName}(4)`);
    expect(tripled.success).toBe(true);
    expect(tripled.rows[0]?.[0]).toBe('12');

    await ctx.schema.dropFunction(fnName);
    await expect(ctx.query(`SELECT ${fnName}(1)`)).rejects.toThrow();
  });

  it('createProcedure + CALL via schema and DataSource.callProcedure', async () => {
    pool = new Pool(liveOptions());
    const ctx = createMigrationContext(pool);

    await ctx.schema.createTable(tableName, (t) => {
      t.int('id').primary();
      t.string('name').notNull();
    });

    await ctx.schema.createProcedure(procName, {
      params: [
        { name: 'uid', type: 'INT' },
        { name: 'uname', type: 'STRING' },
      ],
      body: `INSERT INTO ${tableName} VALUES (uid, uname);`,
    });

    await ctx.schema.call(procName, [1, 'Ada']);

    const afterCall = await ctx.query(`SELECT name FROM ${tableName} WHERE id = 1`);
    expect(afterCall.success).toBe(true);
    expect(afterCall.rows[0]?.[0]).toBe('Ada');

    dataSource = new DataSource(liveOptions());
    await dataSource.initialize();
    const dsResult = await dataSource.callProcedure(procName, [2, "O'Brien"]);
    expect(dsResult.success).toBe(true);

    const emResult = await dataSource.manager.callProcedure(procName, [3, 'Bob']);
    expect(emResult.success).toBe(true);

    const rows = await ctx.query(`SELECT id, name FROM ${tableName} ORDER BY id`);
    expect(rows.success).toBe(true);
    expect(rows.rows).toEqual([
      ['1', 'Ada'],
      ['2', "O'Brien"],
      ['3', 'Bob'],
    ]);

    await ctx.schema.dropProcedure(procName);
    await expect(ctx.schema.call(procName, [4, 'X'])).rejects.toThrow();
  });
});
