import { NoBugDbError } from '../driver/errors.js';
import type { EntityMapper } from '../metadata/entity-mapper.js';
import type { MetadataRegistry } from '../metadata/metadata-registry.js';
import type { ColumnMetadata, EntityMetadata, RelationMetadata } from '../metadata/types.js';
import type { UnitOfWork } from '../entity-manager/unit-of-work.js';

export interface JoinedRelationSpec {
  readonly property: string;
  readonly path: string[];
  readonly prefix: string;
  readonly alias: string;
  readonly ownerAlias: string;
  readonly meta: EntityMetadata;
  readonly relation: RelationMetadata;
}

/**
 * Maps flat JOIN result rows to nested entity graphs using the identity map.
 */
export class RelationHydrator {
  readonly #mapper: EntityMapper;
  readonly #unitOfWork: UnitOfWork;
  readonly #registry: MetadataRegistry;

  constructor(
    mapper: EntityMapper,
    unitOfWork: UnitOfWork,
    registry: MetadataRegistry,
  ) {
    this.#mapper = mapper;
    this.#unitOfWork = unitOfWork;
    this.#registry = registry;
  }

  hydrateRootRow<T extends object>(
    row: Record<string, unknown>,
    meta: EntityMetadata<T>,
    joined: JoinedRelationSpec[],
  ): T {
    const rootRow = this.#extractRootRow(row, meta, joined);
    const entity = this.#mapper.fromDbRow<T>(rootRow, meta);
    const managed = this.#unitOfWork.registerManaged(entity, meta);

    for (const spec of joined) {
      const relatedRow = this.#extractPrefixedRow(row, spec.prefix);
      const targetMeta = spec.meta;
      const pkCol = targetMeta.columns[targetMeta.primaryKeys[0]!]!.columnName;

      if (
        relatedRow === null ||
        relatedRow[pkCol] === null ||
        relatedRow[pkCol] === undefined
      ) {
        this.#assignNested(managed, spec.path, null);
        continue;
      }

      const related = this.#mapper.fromDbRow(relatedRow, targetMeta);
      const managedRelated = this.#unitOfWork.registerManaged(
        related,
        targetMeta,
      );
      this.#assignNested(managed, spec.path, managedRelated);
    }

    return managed;
  }

  attachCollection<T extends object>(
    parents: T[],
    parentMeta: EntityMetadata<T>,
    property: string,
    children: object[],
    childMeta: EntityMetadata,
    foreignKeyProperty: string,
  ): void {
    const fkColumn = childMeta.columns[foreignKeyProperty];
    if (!fkColumn) {
      throw new NoBugDbError(
        'METADATA',
        `Foreign key property "${foreignKeyProperty}" not found on "${childMeta.name}"`,
      );
    }

    const parentById = new Map<string, T>();
    for (const parent of parents) {
      const pk = this.#mapper.getPrimaryKeyValue(parent, parentMeta);
      if (pk !== undefined && pk !== null && pk !== '') {
        parentById.set(String(pk), parent);
      }
      (parent as Record<string, unknown>)[property] = [];
    }

    for (const child of children) {
      const fkValue = (child as Record<string, unknown>)[foreignKeyProperty];
      if (fkValue === undefined || fkValue === null || fkValue === '') {
        continue;
      }

      const parent = parentById.get(String(fkValue));
      if (!parent) {
        continue;
      }

      const managedChild = this.#unitOfWork.registerManaged(child, childMeta);
      const collection = (parent as Record<string, unknown>)[property];
      if (Array.isArray(collection)) {
        collection.push(managedChild);
      }
    }
  }

  resolveInverseManyToOne(
    parentMeta: EntityMetadata,
    relation: RelationMetadata,
  ): { childMeta: EntityMetadata; inverse: RelationMetadata } {
    const childMeta = this.#registry.getByTarget(relation.target);
    if (!relation.inverseSide) {
      throw new NoBugDbError(
        'METADATA',
        `Relation "${relation.propertyName}" on "${parentMeta.name}" requires inverseSide`,
      );
    }

    const inverse = childMeta.relations[relation.inverseSide];
    if (!inverse?.joinColumnProperty) {
      throw new NoBugDbError(
        'METADATA',
        `Inverse relation "${relation.inverseSide}" on "${childMeta.name}" is not a valid owning side`,
      );
    }

    return { childMeta, inverse };
  }

  #extractRootRow<T>(
    row: Record<string, unknown>,
    meta: EntityMetadata<T>,
    joined: JoinedRelationSpec[],
  ): Record<string, unknown> {
    const joinedPrefixes = new Set(joined.map((spec) => `${spec.prefix}__`));
    const rootRow: Record<string, unknown> = {};

    for (const column of Object.values(meta.columns) as ColumnMetadata[]) {
      if (column.columnName in row) {
        rootRow[column.columnName] = row[column.columnName];
      }
    }

    for (const [key, value] of Object.entries(row)) {
      if (key.includes('__')) {
        continue;
      }
      const isJoined = [...joinedPrefixes].some((prefix) =>
        key.startsWith(prefix),
      );
      if (!isJoined && !(key in rootRow)) {
        rootRow[key] = value;
      }
    }

    return rootRow;
  }

  #extractPrefixedRow(
    row: Record<string, unknown>,
    prefix: string,
  ): Record<string, unknown> | null {
    const extracted: Record<string, unknown> = {};
    const prefixWithSep = `${prefix}__`;
    let hasAny = false;

    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith(prefixWithSep)) {
        extracted[key.slice(prefixWithSep.length)] = value;
        hasAny = true;
      }
    }

    return hasAny ? extracted : null;
  }

  #assignNested(
    root: object,
    path: string[],
    value: unknown,
  ): void {
    if (path.length === 0) {
      return;
    }

    let current = root as Record<string, unknown>;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = path[i]!;
      const next = current[segment];
      if (next === null || next === undefined || typeof next !== 'object') {
        return;
      }
      current = next as Record<string, unknown>;
    }

    current[path[path.length - 1]!] = value;
  }
}
