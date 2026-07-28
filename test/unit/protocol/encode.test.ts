import { describe, expect, it } from 'vitest';
import {
  encodeAuth,
  encodePing,
  encodeQuery,
  encodeQuit,
} from '../../../src/protocol/encode.js';

describe('protocol encode', () => {
  it('encodes AUTH', () => {
    expect(encodeAuth('admin', 'secret')).toBe('AUTH|admin|secret\n');
  });

  it('encodes QUERY', () => {
    expect(encodeQuery('SELECT 1')).toBe('QUERY|SELECT 1\n');
  });

  it('encodes PING', () => {
    expect(encodePing()).toBe('PING|\n');
  });

  it('encodes QUIT', () => {
    expect(encodeQuit()).toBe('QUIT|\n');
  });
});
