import { describe, expect, it } from 'vitest';
import {
  MAX_RELATION_DEPTH,
  parseRelationPaths,
} from '../../../src/metadata/relation-path.js';
import type { NoBugDbError } from '../../../src/driver/errors.js';

describe('parseRelationPaths', () => {
  it('parses flat and nested paths into a tree', () => {
    const tree = parseRelationPaths(['author', 'author.profile', 'comments']);

    expect(tree).toEqual([
      {
        property: 'author',
        children: [{ property: 'profile', children: [] }],
      },
      { property: 'comments', children: [] },
    ]);
  });

  it('deduplicates when parent path covers nested path', () => {
    const tree = parseRelationPaths(['author', 'author']);

    expect(tree).toEqual([{ property: 'author', children: [] }]);
  });

  it('enforces max relation depth', () => {
    const tooDeep = 'a.b.c.d';
    expect(tooDeep.split('.').length).toBeGreaterThan(MAX_RELATION_DEPTH);

    expect(() => parseRelationPaths([tooDeep])).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });

  it('rejects empty path segments', () => {
    expect(() => parseRelationPaths(['author..profile'])).toThrowError(
      expect.objectContaining({ code: 'METADATA' } satisfies Partial<NoBugDbError>),
    );
  });
});
