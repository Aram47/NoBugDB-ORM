/**
 * Identity Map keyed by (tableName, primaryKey).
 * Ensures the same DB row maps to the same object instance within an EntityManager.
 */
export class IdentityMap {
  readonly #store = new Map<string, object>();

  /** Prefer serializePrimaryKey from metadata/primary-key for composite keys. */
  static key(tableName: string, pk: string | number | unknown): string {
    if (typeof pk === 'object' && pk !== null) {
      const parts = Object.keys(pk as Record<string, unknown>)
        .sort()
        .map((k) => String((pk as Record<string, unknown>)[k]));
      return `${tableName}|${parts.join('|')}`;
    }
    return `${tableName}|${String(pk)}`;
  }

  get<T extends object>(
    tableName: string,
    pk: string | number | unknown,
  ): T | undefined {
    return this.#store.get(IdentityMap.key(tableName, pk)) as T | undefined;
  }

  set<T extends object>(
    tableName: string,
    pk: string | number | unknown,
    entity: T,
  ): void {
    this.#store.set(IdentityMap.key(tableName, pk), entity);
  }

  has(tableName: string, pk: string | number | unknown): boolean {
    return this.#store.has(IdentityMap.key(tableName, pk));
  }

  delete(tableName: string, pk: string | number | unknown): boolean {
    return this.#store.delete(IdentityMap.key(tableName, pk));
  }

  clear(): void {
    this.#store.clear();
  }

  get size(): number {
    return this.#store.size;
  }
}
