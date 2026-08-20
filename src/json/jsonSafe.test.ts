/**
 * JSON Safety Utilities Tests
 *
 * Ported from courtpuzzle/src/common/__tests__/copilotContract.test.ts
 * (JSON safety describe block).
 */
import { describe, it, expect } from 'vitest';
import { assertJsonSafe, isJsonSafe } from './jsonSafe';

describe('assertJsonSafe and isJsonSafe', () => {
  it('accepts valid JSON-serializable values', () => {
    const valid = {
      name: 'test',
      count: 42,
      active: true,
      list: [1, 2, 3],
      nested: { inner: 'val' }
    };
    expect(() => assertJsonSafe(valid)).not.toThrow();
    expect(isJsonSafe(valid)).toBe(true);
  });

  it('rejects NaN, Infinity, -Infinity', () => {
    expect(() => assertJsonSafe({ val: NaN })).toThrow(/JSON safety violation/);
    expect(() => assertJsonSafe({ val: Infinity })).toThrow(/JSON safety violation/);
    expect(() => assertJsonSafe([1, 2, -Infinity])).toThrow(/JSON safety violation/);
    expect(isJsonSafe({ bad: NaN })).toBe(false);
  });

  it('rejects functions, symbols, and bigints', () => {
    expect(() => assertJsonSafe({ fn: () => {} })).toThrow(/JSON safety violation/);
    expect(() => assertJsonSafe({ sym: Symbol('foo') })).toThrow(/JSON safety violation/);
    // Use BigInt constructor for ES2017 compatibility (test validates rejection behavior)
    if (typeof BigInt !== 'undefined') {
      expect(() => assertJsonSafe({ big: BigInt(10) })).toThrow(/JSON safety violation/);
    }
    expect(isJsonSafe({ fn: () => {} })).toBe(false);
  });

  it('handles nested structures recursively', () => {
    const valid = {
      level1: {
        level2: {
          level3: {
            array: [{ a: 1, b: 2 }, { c: 3 }],
            number: 123
          }
        }
      }
    };
    expect(() => assertJsonSafe(valid)).not.toThrow();
  });

  it('handles empty arrays and objects', () => {
    expect(() => assertJsonSafe({})).not.toThrow();
    expect(() => assertJsonSafe([])).not.toThrow();
    expect(isJsonSafe({})).toBe(true);
    expect(isJsonSafe([])).toBe(true);
  });

  it('handles null and undefined', () => {
    expect(() => assertJsonSafe(null)).not.toThrow();
    expect(() => assertJsonSafe(undefined)).not.toThrow();
    expect(isJsonSafe(null)).toBe(true);
    expect(isJsonSafe(undefined)).toBe(true);
  });

  it('detects circular references', () => {
    const circular: Record<string, unknown> = { name: 'test' };
    circular.self = circular;
    expect(() => assertJsonSafe(circular)).toThrow(/circular reference/);
    expect(isJsonSafe(circular)).toBe(false);
  });

  it('reports correct path in error messages', () => {
    expect(() => assertJsonSafe({ a: { b: NaN } })).toThrow(/path "\$\.a\.b"/);
    expect(() => assertJsonSafe([1, [2, Infinity]])).toThrow(/path "\$\[1\]\[1\]"/);
  });
});
