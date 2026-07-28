import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/index.js';

describe('VERSION', () => {
  it('exports the package semver', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
