import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../../src/driver/types.js';
import { EntityManager } from '../../../src/entity-manager/entity-manager.js';
import { defineEntity } from '../../../src/metadata/define-entity.js';
import { MetadataRegistry } from '../../../src/metadata/metadata-registry.js';
import { isValidUuid } from '../../../src/types/type-mapper.js';

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
    email: { type: 'STRING' },
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
      if (sqlText.startsWith('PREPARE') || sqlText.startsWith('DEALLOCATE')) {
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

function createEm(
  executor = mockExecutor(),
): { em: EntityManager; executor: ReturnType<typeof mockExecutor> } {
  const registry = new MetadataRegistry();
  registry.register(UserMeta);
  const em = new EntityManager({ executor, registry });
  return { em, executor };
}

describe('EntityManager', () => {
  it('persist + flush inserts new entities with generated UUID', async () => {
    const { em, executor } = createEm();
    const user = em.create(UserMeta, { email: 'a@b.c', name: 'Ada' });

    em.persist(user);
    expect(isValidUuid(user.id)).toBe(true);

    await em.flush();

    const prepares = executor.queries.filter((q) => q.startsWith('PREPARE'));
    expect(prepares.some((q) => q.includes('INSERT INTO'))).toBe(true);
  });

  it('dirty update on flush', async () => {
    const { em, executor } = createEm();
    const found = await em.getRepository(UserMeta).findById(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(found).not.toBeNull();

    found!.name = 'Grace';
    await em.flush();

    const prepares = executor.queries.filter((q) => q.startsWith('PREPARE'));
    expect(prepares.some((q) => q.includes('UPDATE'))).toBe(true);
  });

  it('remove + flush deletes', async () => {
    const { em, executor } = createEm();
    const found = await em.getRepository(UserMeta).findById(
      '11111111-1111-4111-8111-111111111111',
    );
    em.remove(found!);
    await em.flush();

    const prepares = executor.queries.filter((q) => q.startsWith('PREPARE'));
    expect(prepares.some((q) => q.includes('DELETE FROM'))).toBe(true);
  });

  it('identity map returns same reference across finds', async () => {
    const { em } = createEm();
    const a = await em.findOne(UserMeta, {
      where: { id: '11111111-1111-4111-8111-111111111111' },
    });
    const b = await em.findOne(UserMeta, {
      where: { id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(a).toBe(b);
  });

  it('clear resets identity map and unit of work', async () => {
    const { em } = createEm();
    const found = await em.getRepository(UserMeta).findById(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(found).not.toBeNull();

    em.clear();
    expect(em.unitOfWork.identityMap.size).toBe(0);
    expect(em.unitOfWork.getTracked(found!)).toBeUndefined();
  });

  it('withExecutor creates isolated identity map', async () => {
    const { em } = createEm();
    const found = await em.getRepository(UserMeta).findById(
      '11111111-1111-4111-8111-111111111111',
    );

    const forked = em.withExecutor(mockExecutor());
    expect(forked.unitOfWork.identityMap.size).toBe(0);
    expect(em.unitOfWork.identityMap.get('users', found!.id)).toBe(found);
  });
});
