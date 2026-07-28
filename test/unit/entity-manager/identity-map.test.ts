import { describe, expect, it } from 'vitest';
import { IdentityMap } from '../../../src/entity-manager/identity-map.js';

describe('IdentityMap', () => {
  it('returns the same reference for the same table and pk', () => {
    const map = new IdentityMap();
    const a = { id: '1', name: 'Ada' };
    map.set('users', '1', a);

    expect(map.has('users', '1')).toBe(true);
    expect(map.get('users', '1')).toBe(a);
    expect(map.get('users', '2')).toBeUndefined();
  });

  it('clears and deletes entries', () => {
    const map = new IdentityMap();
    const a = { id: '1' };
    map.set('users', '1', a);
    expect(map.delete('users', '1')).toBe(true);
    expect(map.has('users', '1')).toBe(false);

    map.set('users', '1', a);
    map.clear();
    expect(map.size).toBe(0);
  });
});
