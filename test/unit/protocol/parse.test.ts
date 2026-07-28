import { describe, expect, it } from 'vitest';
import {
  isCompleteResponse,
  needsIdleFlush,
  parseResponse,
} from '../../../src/protocol/parse.js';

describe('protocol parse', () => {
  it('parses multi-row SELECT fixture', () => {
    const parsed = parseResponse('OK|a\tb\n1\tx\n2\ty\n');
    expect(parsed).toEqual({
      kind: 'ok',
      message: '',
      columns: ['a', 'b'],
      rows: [
        ['1', 'x'],
        ['2', 'y'],
      ],
    });
  });

  it('parses empty result set with columns', () => {
    const parsed = parseResponse('OK|only\n');
    expect(parsed).toEqual({
      kind: 'ok',
      message: '',
      columns: ['only'],
      rows: [],
    });
  });

  it('parses DML OK', () => {
    expect(parseResponse('OK|\n')).toEqual({
      kind: 'ok',
      message: '',
      columns: [],
      rows: [],
    });
  });

  it('parses AUTH / Goodbye status', () => {
    expect(parseResponse('OK|authenticated\n')).toEqual({
      kind: 'ok',
      message: 'authenticated',
      columns: [],
      rows: [],
    });
    expect(parseResponse('OK|Goodbye\n')).toEqual({
      kind: 'ok',
      message: 'Goodbye',
      columns: [],
      rows: [],
    });
  });

  it('parses ERROR', () => {
    expect(parseResponse('ERROR|oops\n')).toEqual({
      kind: 'error',
      message: 'oops',
    });
  });

  it('parses PONG', () => {
    expect(parseResponse('PONG\n')).toEqual({ kind: 'pong' });
  });

  it('detects completeness and idle flush for result sets', () => {
    expect(isCompleteResponse('OK|')).toBe(false);
    expect(isCompleteResponse('OK|\n')).toBe(true);
    expect(isCompleteResponse('ERROR|x\n')).toBe(true);
    expect(isCompleteResponse('PONG\n')).toBe(true);
    expect(isCompleteResponse('OK|a\tb\n')).toBe(true);
    expect(needsIdleFlush('OK|a\tb\n')).toBe(true);
    expect(needsIdleFlush('OK|\n')).toBe(false);
    expect(needsIdleFlush('OK|authenticated\n')).toBe(false);
  });
});
