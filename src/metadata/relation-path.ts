import { NoBugDbError } from '../driver/errors.js';

export const MAX_RELATION_DEPTH = 3;

export interface RelationPathNode {
  readonly property: string;
  readonly children: RelationPathNode[];
}

/**
 * Parse and deduplicate relation paths like `['author', 'author.profile']`.
 * A parent path covers all nested paths with the same prefix.
 */
export function parseRelationPaths(paths: string[]): RelationPathNode[] {
  if (paths.length === 0) {
    return [];
  }

  const roots: RelationPathNode[] = [];

  for (const rawPath of paths) {
    if (rawPath.includes('..') || rawPath.startsWith('.') || rawPath.endsWith('.')) {
      throw new NoBugDbError(
        'METADATA',
        `Invalid relation path "${rawPath}"`,
      );
    }

    const segments = rawPath.split('.').filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      throw new NoBugDbError(
        'METADATA',
        `Invalid relation path "${rawPath}"`,
      );
    }
    if (segments.length > MAX_RELATION_DEPTH) {
      throw new NoBugDbError(
        'METADATA',
        `Relation path "${rawPath}" exceeds max depth of ${MAX_RELATION_DEPTH}`,
      );
    }

    let level = roots;
    for (const segment of segments) {
      let node = level.find((entry) => entry.property === segment);
      if (!node) {
        node = { property: segment, children: [] };
        level.push(node);
      }
      level = node.children;
    }
  }

  return roots;
}
