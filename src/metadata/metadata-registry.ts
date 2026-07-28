import { NoBugDbError } from '../driver/errors.js';
import { isEntityMetadata, type EntityMetadata } from './types.js';

/**
 * Registry of entity metadata keyed by logical name and table name.
 */
export class MetadataRegistry {
  readonly #byName = new Map<string, EntityMetadata>();
  readonly #byTable = new Map<string, EntityMetadata>();

  register(meta: EntityMetadata): void {
    const existingByName = this.#byName.get(meta.name);
    if (existingByName && existingByName !== meta) {
      throw new NoBugDbError(
        'METADATA',
        `Entity name "${meta.name}" is already registered`,
      );
    }

    const existingByTable = this.#byTable.get(meta.tableName);
    if (existingByTable && existingByTable !== meta) {
      throw new NoBugDbError(
        'METADATA',
        `Table name "${meta.tableName}" is already registered by entity "${existingByTable.name}"`,
      );
    }

    this.#byName.set(meta.name, meta);
    this.#byTable.set(meta.tableName, meta);
  }

  getByTarget(target: string | EntityMetadata): EntityMetadata {
    if (isEntityMetadata(target) || typeof target === 'object') {
      const meta = target as EntityMetadata;
      const registered = this.#byName.get(meta.name);
      if (registered) {
        return registered;
      }
      return meta;
    }

    const found = this.#byName.get(target);
    if (!found) {
      throw new NoBugDbError(
        'ENTITY_NOT_FOUND',
        `Entity "${target}" is not registered`,
      );
    }
    return found;
  }

  getByTable(table: string): EntityMetadata {
    const found = this.#byTable.get(table);
    if (!found) {
      throw new NoBugDbError(
        'ENTITY_NOT_FOUND',
        `No entity registered for table "${table}"`,
      );
    }
    return found;
  }

  getAll(): EntityMetadata[] {
    return [...this.#byName.values()];
  }

  has(name: string): boolean {
    return this.#byName.has(name);
  }

  clear(): void {
    this.#byName.clear();
    this.#byTable.clear();
  }
}
