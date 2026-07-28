import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool, QueryBuilder } from '../../src/index.js';
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
});
