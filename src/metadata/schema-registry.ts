import { NoBugDbError } from '../driver/errors.js';
import type { MetadataRegistry } from './metadata-registry.js';
import type { EntityMetadata, RelationMetadata } from './types.js';

export interface TableMetadata {
  entity: EntityMetadata;
  relations: RelationMetadata[];
}

/**
 * Aggregates entity metadata and validates cross-entity relation consistency.
 * No runtime DB introspection — schema is code-first only.
 */
export class SchemaRegistry {
  readonly #registry: MetadataRegistry;

  constructor(registry: MetadataRegistry) {
    this.#registry = registry;
  }

  tables(): TableMetadata[] {
    return this.#registry.getAll().map((entity) => ({
      entity,
      relations: Object.values(entity.relations),
    }));
  }

  assertConsistent(): void {
    for (const entity of this.#registry.getAll()) {
      for (const relation of Object.values(entity.relations)) {
        this.#assertRelation(entity, relation);
      }
    }
  }

  #assertRelation(
    entity: EntityMetadata,
    relation: RelationMetadata,
  ): void {
    if (!this.#registry.has(relation.target)) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" targets unknown entity "${relation.target}"`,
      );
    }

    const target = this.#registry.getByTarget(relation.target);

    if (relation.type === 'one-to-many') {
      this.#assertOneToMany(entity, relation, target);
      return;
    }

    this.#assertOwningSide(entity, relation);
    if (relation.inverseSide !== undefined) {
      this.#assertInverseSide(entity, relation, target);
    }
  }

  #assertOwningSide(
    entity: EntityMetadata,
    relation: RelationMetadata,
  ): void {
    if (!relation.joinColumnProperty || !relation.joinColumnDb) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" (${relation.type}) requires joinColumn`,
      );
    }

    const column = entity.columns[relation.joinColumnProperty];
    if (!column) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" joinColumn "${relation.joinColumnProperty}" does not exist`,
      );
    }

    const target = this.#registry.getByTarget(relation.target);
    if (target.primaryKeys.length !== 1) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" targets "${target.name}" with a composite primary key (multi-column joinColumn is not supported)`,
      );
    }
    const targetPk = target.columns[target.primaryKeys[0]!]!;
    if (column.type !== targetPk.type) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" joinColumn type ${column.type} must match target PK type ${targetPk.type}`,
      );
    }
  }

  #assertOneToMany(
    entity: EntityMetadata,
    relation: RelationMetadata,
    target: EntityMetadata,
  ): void {
    if (!relation.inverseSide || relation.inverseSide.trim() === '') {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" (one-to-many) requires inverseSide`,
      );
    }

    const inverse = target.relations[relation.inverseSide];
    if (!inverse) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" inverseSide "${relation.inverseSide}" does not exist on "${target.name}"`,
      );
    }

    if (inverse.type !== 'many-to-one' && inverse.type !== 'one-to-one') {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" inverseSide "${relation.inverseSide}" on "${target.name}" must be many-to-one or one-to-one`,
      );
    }

    if (inverse.target !== entity.name) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" inverseSide "${relation.inverseSide}" on "${target.name}" must target "${entity.name}"`,
      );
    }
  }

  #assertInverseSide(
    entity: EntityMetadata,
    relation: RelationMetadata,
    target: EntityMetadata,
  ): void {
    const inverse = target.relations[relation.inverseSide!];
    if (!inverse) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" inverseSide "${relation.inverseSide}" does not exist on "${target.name}"`,
      );
    }

    if (inverse.type !== 'one-to-many' && inverse.type !== 'one-to-one') {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" inverseSide "${relation.inverseSide}" on "${target.name}" must be one-to-many or one-to-one`,
      );
    }

    if (inverse.target !== entity.name) {
      throw new NoBugDbError(
        'METADATA',
        `Entity "${entity.name}" relation "${relation.propertyName}" inverseSide "${relation.inverseSide}" on "${target.name}" must target "${entity.name}"`,
      );
    }
  }
}
