import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DataSource,
  defineEntity,
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

interface User {
  id: string;
  email: string;
  name: string;
}

describe.skipIf(!host)('Data Mapper live', () => {
  let ds: DataSource | null = null;
  const tableName = `orm_users_${randomUUID().replace(/-/g, '_')}`;

  const User = defineEntity<User>({
    name: 'User',
    tableName,
    columns: {
      id: { type: 'UUID', primary: true },
      email: { type: 'STRING', unique: true },
      name: { type: 'STRING' },
    },
  });

  afterEach(async () => {
    if (ds?.isInitialized) {
      await ds.manager.query(`DROP TABLE IF EXISTS ${tableName}`).catch(() => undefined);
      await ds.destroy().catch(() => undefined);
      ds = null;
    }
  });

  it('runs CRUD via Repository and EntityManager Unit of Work', async () => {
    ds = new DataSource({
      ...liveOptions(),
      entities: [User],
    });
    await ds.initialize();

    await ds.manager.query(
      `CREATE TABLE ${tableName} (id UUID PRIMARY KEY, email STRING, name STRING)`,
    );

    const users = ds.getRepository(User);

    const inserted = await users.insert({
      email: 'ada@example.com',
      name: 'Ada',
    });
    expect(inserted.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const found = await users.findById(inserted.id);
    expect(found).not.toBeNull();
    expect(found?.email).toBe('ada@example.com');
    expect(found).toBe(
      await users.findById(inserted.id),
    );

    found!.name = 'Ada Lovelace';
    await ds.manager.flush();

    const updated = await users.findById(inserted.id);
    expect(updated?.name).toBe('Ada Lovelace');
    expect(updated).toBe(found);

    const created = ds.manager.create(User, {
      email: 'grace@example.com',
      name: 'Grace',
    });
    ds.manager.persist(created);
    await ds.manager.flush();

    const byEmail = await users.findOne({
      where: { email: 'grace@example.com' },
    });
    expect(byEmail?.name).toBe('Grace');

    ds.manager.remove(found!);
    await ds.manager.flush();

    expect(await users.findById(inserted.id)).toBeNull();
  });

  it('rolls back failed transaction work', async () => {
    ds = new DataSource({
      ...liveOptions(),
      entities: [User],
    });
    await ds.initialize();

    await ds.manager.query(
      `CREATE TABLE ${tableName} (id UUID PRIMARY KEY, email STRING, name STRING)`,
    );

    const users = ds.getRepository(User);
    const baseline = await users.insert({
      email: 'base@example.com',
      name: 'Base',
    });

    await expect(
      ds.transaction(async (em) => {
        const repo = em.getRepository(User);
        await repo.insert({
          email: 'tx@example.com',
          name: 'Tx',
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(await users.findOne({ where: { email: 'tx@example.com' } })).toBeNull();
    expect(await users.findById(baseline.id)).not.toBeNull();
  });

  it('Repository.save inserts and updates correctly', async () => {
    ds = new DataSource({
      ...liveOptions(),
      entities: [User],
    });
    await ds.initialize();

    await ds.manager.query(
      `CREATE TABLE ${tableName} (id UUID PRIMARY KEY, email STRING, name STRING)`,
    );

    const users = ds.getRepository(User);
    const saved = await users.save({
      email: 'save@example.com',
      name: 'Save',
    } as User);

    expect(saved.id).toBeTruthy();

    saved.name = 'Saved Again';
    const updated = await users.save(saved);
    expect(updated.name).toBe('Saved Again');
    expect(updated).toBe(saved);

    const reloaded = await users.findById(saved.id);
    expect(reloaded?.name).toBe('Saved Again');
  });
});
