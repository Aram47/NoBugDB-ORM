import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../../src/driver/types.js';
import { IdentityMap } from '../../../src/entity-manager/identity-map.js';
import { UnitOfWork } from '../../../src/entity-manager/unit-of-work.js';
import { defineEntity } from '../../../src/metadata/define-entity.js';
import { EntityMapper } from '../../../src/metadata/entity-mapper.js';
import { MetadataRegistry } from '../../../src/metadata/metadata-registry.js';
import { RelationLoader } from '../../../src/repository/relation-loader.js';

const User = defineEntity<{ id: string; name: string }>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'UUID', primary: true },
    name: { type: 'STRING' },
  },
  relations: {
    posts: { type: 'one-to-many', target: 'Post', inverseSide: 'author' },
  },
});

const Post = defineEntity<{
  id: string;
  title: string;
  authorId: string;
}>({
  name: 'Post',
  tableName: 'posts',
  columns: {
    id: { type: 'UUID', primary: true },
    title: { type: 'STRING' },
    authorId: { type: 'UUID' },
  },
  relations: {
    author: {
      type: 'many-to-one',
      target: 'User',
      joinColumn: 'authorId',
      inverseSide: 'posts',
    },
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
      return { success: true, message: '', columns: [], rows: [] };
    },
  };
}

describe('RelationLoader', () => {
  const registry = new MetadataRegistry();
  registry.register(User);
  registry.register(Post);
  const mapper = new EntityMapper({ registry });
  const uow = new UnitOfWork(new IdentityMap(), mapper);

  it('builds LEFT JOIN SQL for many-to-one relations', async () => {
    const executor = mockExecutor((sqlText) => {
      if (sqlText.startsWith('EXECUTE')) {
        return {
          success: true,
          message: '',
          columns: [
            'id',
            'title',
            'authorId',
            'author__id',
            'author__name',
          ],
          rows: [
            [
              '22222222-2222-4222-8222-222222222222',
              'Hello',
              '11111111-1111-4111-8111-111111111111',
              '11111111-1111-4111-8111-111111111111',
              'Ada',
            ],
          ],
        };
      }
      return undefined;
    });

    const loader = new RelationLoader(executor, registry, mapper, uow);
    const posts = await loader.find(Post, { relations: ['author'] });

    const prepare = executor.queries.find((q) => q.startsWith('PREPARE'));
    expect(prepare).toContain('LEFT JOIN');
    expect(prepare).toContain('authorId');
    expect(posts[0]?.title).toBe('Hello');
    expect((posts[0] as unknown as { author: { name: string } }).author.name).toBe('Ada');
  });
});
