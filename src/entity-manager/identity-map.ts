/**
 * Identity Map keyed by (tableName, primaryKey).
 * Ensures the same DB row maps to the same object instance within an EntityManager.
 */
export class IdentityMap {
  readonly #store = new Map<string, object>();

  static key(tableName: string, pk: string | number): string {
    return `${tableName}:${pk}`;
  }

  get<T extends object>(tableName: string, pk: string | number): T | undefined {
    return this.#store.get(IdentityMap.key(tableName, pk)) as T | undefined;
  }

  set<T extends object>(tableName: string, pk: string | number, entity: T): void {
    this.#store.set(IdentityMap.key(tableName, pk), entity);
  }

  has(tableName: string, pk: string | number): boolean {
    return this.#store.has(IdentityMap.key(tableName, pk));
  }

  delete(tableName: string, pk: string | number): boolean {
    return this.#store.delete(IdentityMap.key(tableName, pk));
  }

  clear(): void {
    this.#store.clear();
  }

  get size(): number {
    return this.#store.size;
  }
}
