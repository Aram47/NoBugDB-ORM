import { describe, expect, it } from 'vitest';
import { isValidUuid } from '../../../src/types/type-mapper.js';
import type { QueryResult } from '../../../src/driver/types.js';
import { IdentityMap } from '../../../src/entity-manager/identity-map.js';
import { UnitOfWork } from '../../../src/entity-manager/unit-of-work.js';
import { defineEntity } from '../../../src/metadata/define-entity.js';
import { EntityMapper } from '../../../src/metadata/entity-mapper.js';
import { MetadataRegistry } from '../../../src/metadata/metadata-registry.js';
import { Repository } from '../../../src/repository/repository.js';

interface User {
  id: string;
  email: string;
  name: string;
}

const UserMeta = defineEntity<User>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'UUID', primary: true },
    email: { type: 'STRING', unique: true },
    name: { type: 'STRING' },
  },
});

function mockExecutor(
  onQuery?: (sql: string) => QueryResult | void,
): { query: (sql: string) => Promise<QueryResult>; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async query(sqlText: string): Promise<QueryResult> {
      queries.push(sqlText);
      const override = onQuery?.(sqlText);
      if (override) {
        return override;
      }
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
          columns: ['id', 'email', 'name'],
          rows: [
            [
              '11111111-1111-4111-8111-111111111111',
              'a@b.c',
              'Ada',
            ],
          ],
        };
      }
      return { success: true, message: '', columns: [], rows: [] };
    },
  };
}

function createRepo(
  executor = mockExecutor(),
  flush: () => Promise<void> = async () => undefined,
): { repo: Repository<User>; uow: UnitOfWork; executor: ReturnType<typeof mockExecutor> } {
  const mapper = new EntityMapper();
  const registry = new MetadataRegistry();
  registry.register(UserMeta);
  const uow = new UnitOfWork(new IdentityMap(), mapper);
  const repo = new Repository<User>({
    executor,
    meta: UserMeta,
    mapper,
    registry,
    unitOfWork: uow,
    flush,
  });
  return { repo, uow, executor };
}

describe('Repository', () => {
  it('generates UUID PK on insert when missing', async () => {
    const { repo } = createRepo();
    const inserted = await repo.insert({ email: 'a@b.c', name: 'Ada' });

    expect(isValidUuid(inserted.id)).toBe(true);
    expect(inserted.email).toBe('a@b.c');
    expect(inserted.name).toBe('Ada');
  });

  it('findById maps types and returns identity-map reference', async () => {
    const { repo, uow } = createRepo();
    const found = await repo.findById('11111111-1111-4111-8111-111111111111');

    expect(found).not.toBeNull();
    expect(found?.name).toBe('Ada');
    expect(found?.email).toBe('a@b.c');

    const again = await repo.findById('11111111-1111-4111-8111-111111111111');
    expect(again).toBe(found);
    expect(uow.identityMap.get('users', '11111111-1111-4111-8111-111111111111')).toBe(
      found,
    );
  });

  it('update and delete emit SQL via query builder', async () => {
    const executor = mockExecutor();
    const { repo } = createRepo(executor);

    await repo.update(
      { id: '11111111-1111-4111-8111-111111111111' },
      { name: 'Grace' },
    );
    await repo.delete({ id: '11111111-1111-4111-8111-111111111111' });

    const prepares = executor.queries.filter((q) => q.startsWith('PREPARE'));
    expect(prepares.some((q) => q.includes('UPDATE'))).toBe(true);
    expect(prepares.some((q) => q.includes('DELETE'))).toBe(true);
  });

  it('save inserts when entity has no primary key', async () => {
    const { repo } = createRepo();
    const saved = await repo.save({
      email: 'x@y.z',
      name: 'X',
    } as User);

    expect(isValidUuid(saved.id)).toBe(true);
    expect(saved.email).toBe('x@y.z');
  });

  it('count runs aggregate select', async () => {
    const executor = mockExecutor((sqlText) => {
      if (sqlText.startsWith('EXECUTE')) {
        return {
          success: true,
          message: '',
          columns: ['COUNT(*)'],
          rows: [['3']],
        };
      }
      return undefined;
    });
    const { repo } = createRepo(executor);
    const n = await repo.count();
    expect(n).toBe(3);
  });
});
