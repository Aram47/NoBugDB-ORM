import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryBuilder } from '../../src/index.js';
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

describe.skipIf(!host)('admin commands live', () => {
  let dataSource: DataSource | null = null;
  const suffix = randomUUID().replace(/-/g, '_');
  const tableName = `orm_admin_${suffix}`;

  afterEach(async () => {
    if (dataSource) {
      await dataSource.pool
        .query(`DROP TABLE IF EXISTS ${tableName}`)
        .catch(() => undefined);
      await dataSource.destroy().catch(() => undefined);
      dataSource = null;
    }
  });

  it('explain SELECT returns non-empty plan', async () => {
    dataSource = new DataSource(liveOptions());
    await dataSource.initialize();

    const { plan, raw } = await dataSource.explain('SELECT 1');
    expect(raw.success).toBe(true);
    expect(plan.length).toBeGreaterThan(0);

    const em = await dataSource.manager.explain('SELECT 1');
    expect(em.raw.success).toBe(true);
    expect(em.plan.length).toBeGreaterThan(0);
  });

  it('explainQuery prefixes QueryBuilder SQL', async () => {
    dataSource = new DataSource(liveOptions());
    await dataSource.initialize();

    await dataSource.pool.query(
      `CREATE TABLE ${tableName} (id UUID PRIMARY KEY, name STRING)`,
    );

    const qb = new QueryBuilder(dataSource.pool)
      .select('id', 'name')
      .from(tableName);

    const { plan, raw } = await dataSource.explainQuery(qb);
    expect(raw.success).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  });

  it('vacuum succeeds on DataSource and EntityManager', async () => {
    dataSource = new DataSource(liveOptions());
    await dataSource.initialize();

    const dsResult = await dataSource.vacuum();
    expect(dsResult.success).toBe(true);
    expect(dsResult.message).toContain('VACUUM');

    const emResult = await dataSource.manager.vacuum();
    expect(emResult.success).toBe(true);
    expect(emResult.message).toContain('VACUUM');
  });
});
