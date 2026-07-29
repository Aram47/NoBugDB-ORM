import { NoBugDbError } from '../driver/errors.js';
import type { EntityMapper } from '../metadata/entity-mapper.js';
import {
  isPrimaryKeyComplete,
  serializePrimaryKey,
} from '../metadata/primary-key.js';
import type { EntityMetadata } from '../metadata/types.js';
import type { IdentityMap } from './identity-map.js';

export type EntityState = 'new' | 'managed' | 'removed' | 'detached';

/** @public Tracked entity payload; shape comes from defineEntity. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface TrackedEntity<T = any> {
  entity: T;
  meta: EntityMetadata<T>;
  state: EntityState;
  snapshot: Record<string, unknown>;
}

export interface FlushPlan {
  inserts: TrackedEntity[];
  updates: TrackedEntity[];
  deletes: TrackedEntity[];
}

/**
 * Explicit Unit of Work: persist / remove schedule changes; flush writes them.
 */
export class UnitOfWork {
  readonly #tracked = new Map<object, TrackedEntity>();
  readonly #identityMap: IdentityMap;
  readonly #mapper: EntityMapper;

  constructor(identityMap: IdentityMap, mapper: EntityMapper) {
    this.#identityMap = identityMap;
    this.#mapper = mapper;
  }

  get identityMap(): IdentityMap {
    return this.#identityMap;
  }

  get mapper(): EntityMapper {
    return this.#mapper;
  }

  getTracked<T extends object>(entity: T): TrackedEntity<T> | undefined {
    return this.#tracked.get(entity) as TrackedEntity<T> | undefined;
  }

  isTracked(entity: object): boolean {
    return this.#tracked.has(entity);
  }

  /**
   * Schedule entity for INSERT on flush, or re-schedule a removed entity as managed.
   */
  persist<T extends object>(entity: T, meta: EntityMetadata<T>): void {
    const existing = this.#tracked.get(entity) as TrackedEntity<T> | undefined;
    if (existing) {
      if (existing.state === 'removed') {
        existing.state = 'managed';
      }
      return;
    }

    const snapshot = this.#mapper.takeSnapshot(entity, meta);
    this.#tracked.set(entity, {
      entity,
      meta,
      state: 'new',
      snapshot,
    });
  }

  /**
   * Schedule entity for DELETE on flush. New (not yet flushed) entities are dropped.
   */
  remove<T extends object>(entity: T): void {
    const existing = this.#tracked.get(entity);
    if (!existing) {
      throw new NoBugDbError(
        'METADATA',
        'Cannot remove an entity that is not managed by this UnitOfWork',
      );
    }

    if (existing.state === 'new') {
      this.#tracked.delete(entity);
      return;
    }

    existing.state = 'removed';
  }

  /**
   * Register a loaded or freshly inserted entity as managed.
   */
  registerManaged<T extends object>(entity: T, meta: EntityMetadata<T>): T {
    const pk = this.#mapper.getPrimaryKeyValue(entity, meta);
    if (!isPrimaryKeyComplete(pk, meta)) {
      throw new NoBugDbError(
        'METADATA',
        `Cannot manage entity "${meta.name}" without a primary key`,
      );
    }

    const pkKey = serializePrimaryKey(pk, meta);
    const cached = this.#identityMap.get<T>(meta.tableName, pkKey);
    if (cached) {
      // Keep the identity-map instance; refresh its fields from the new row.
      const cachedRecord = cached as Record<string, unknown>;
      const source = entity as Record<string, unknown>;
      for (const propertyName of Object.keys(meta.columns)) {
        cachedRecord[propertyName] = source[propertyName];
      }
      const tracked = this.#tracked.get(cached);
      if (tracked) {
        tracked.state = 'managed';
        tracked.snapshot = this.#mapper.takeSnapshot(cached, meta);
      } else {
        this.#tracked.set(cached, {
          entity: cached,
          meta,
          state: 'managed',
          snapshot: this.#mapper.takeSnapshot(cached, meta),
        });
      }
      return cached;
    }

    this.#identityMap.set(meta.tableName, pkKey, entity);
    this.#tracked.set(entity, {
      entity,
      meta,
      state: 'managed',
      snapshot: this.#mapper.takeSnapshot(entity, meta),
    });
    return entity;
  }

  isDirty(tracked: TrackedEntity): boolean {
    if (tracked.state !== 'managed') {
      return false;
    }
    return this.#mapper.isDirty(
      tracked.entity,
      tracked.snapshot,
      tracked.meta,
    );
  }

  getFlushPlan(): FlushPlan {
    const inserts: TrackedEntity[] = [];
    const updates: TrackedEntity[] = [];
    const deletes: TrackedEntity[] = [];

    for (const tracked of this.#tracked.values()) {
      if (tracked.state === 'new') {
        inserts.push(tracked);
      } else if (tracked.state === 'removed') {
        deletes.push(tracked);
      } else if (tracked.state === 'managed' && this.isDirty(tracked)) {
        updates.push(tracked);
      }
    }

    return { inserts, updates, deletes };
  }

  /**
   * After a successful flush, refresh snapshots and drop deleted entities.
   */
  applyFlushResult(plan: FlushPlan): void {
    for (const tracked of plan.inserts) {
      tracked.state = 'managed';
      tracked.snapshot = this.#mapper.takeSnapshot(
        tracked.entity,
        tracked.meta,
      );
      const pk = this.#mapper.getPrimaryKeyValue(tracked.entity, tracked.meta);
      if (isPrimaryKeyComplete(pk, tracked.meta)) {
        this.#identityMap.set(
          tracked.meta.tableName,
          serializePrimaryKey(pk, tracked.meta),
          tracked.entity,
        );
      }
    }

    for (const tracked of plan.updates) {
      tracked.snapshot = this.#mapper.takeSnapshot(
        tracked.entity,
        tracked.meta,
      );
    }

    for (const tracked of plan.deletes) {
      const pk = this.#mapper.getPrimaryKeyValue(tracked.entity, tracked.meta);
      if (isPrimaryKeyComplete(pk, tracked.meta)) {
        this.#identityMap.delete(
          tracked.meta.tableName,
          serializePrimaryKey(pk, tracked.meta),
        );
      }
      this.#tracked.delete(tracked.entity);
    }
  }

  clear(): void {
    this.#tracked.clear();
    this.#identityMap.clear();
  }
}
