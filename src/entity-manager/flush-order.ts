import type { TrackedEntity } from './unit-of-work.js';
import type { RelationMetadata } from '../metadata/types.js';

/**
 * Orders flush operations so FK parents are inserted before children
 * and children are deleted before parents.
 */
export function sortForInsert(tracked: TrackedEntity[]): TrackedEntity[] {
  return topologicalSort(tracked, 'insert');
}

export function sortForDelete(tracked: TrackedEntity[]): TrackedEntity[] {
  return topologicalSort(tracked, 'delete');
}

function topologicalSort(
  tracked: TrackedEntity[],
  mode: 'insert' | 'delete',
): TrackedEntity[] {
  if (tracked.length <= 1) {
    return [...tracked];
  }

  const byEntity = new Map<object, TrackedEntity>();
  for (const item of tracked) {
    byEntity.set(item.entity, item);
  }

  const graph = new Map<object, Set<object>>();
  for (const item of tracked) {
    graph.set(item.entity, new Set());
  }

  for (const item of tracked) {
    for (const relation of Object.values(item.meta.relations)) {
      if (
        relation.type !== 'many-to-one' &&
        relation.type !== 'one-to-one'
      ) {
        continue;
      }

      const parent = resolveRelationTarget(item.entity, relation);
      if (!parent || !byEntity.has(parent)) {
        continue;
      }

      if (mode === 'insert') {
        graph.get(item.entity)!.add(parent);
      } else {
        graph.get(parent)!.add(item.entity);
      }
    }
  }

  const visited = new Set<object>();
  const visiting = new Set<object>();
  const result: TrackedEntity[] = [];

  const visit = (entity: object): void => {
    if (visited.has(entity)) {
      return;
    }
    if (visiting.has(entity)) {
      return;
    }

    visiting.add(entity);
    const deps = graph.get(entity);
    if (deps) {
      for (const dep of deps) {
        visit(dep);
      }
    }
    visiting.delete(entity);
    visited.add(entity);
    const trackedEntity = byEntity.get(entity);
    if (trackedEntity) {
      result.push(trackedEntity);
    }
  };

  for (const item of tracked) {
    visit(item.entity);
  }

  return result;
}

function resolveRelationTarget(
  entity: object,
  relation: RelationMetadata,
): object | null {
  const value = (entity as Record<string, unknown>)[relation.propertyName];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  return null;
}
