/**
 * JSON Safety Utilities Tests
 *
 * Ported from courtpuzzle/src/common/__tests__/copilotContract.test.ts
 * (JSON safety describe block).
 */
import { describe, it, expect } from 'vitest';
import { assertJsonSafe, isJsonSafe, JsonSafetyError } from './jsonSafe';

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

  it('rejects NaN, Infinity, -Infinity with JsonSafetyError', () => {
    expect(() => assertJsonSafe({ val: NaN })).toThrow(JsonSafetyError);
    expect(() => assertJsonSafe({ val: Infinity })).toThrow(JsonSafetyError);
    expect(() => assertJsonSafe([1, 2, -Infinity])).toThrow(JsonSafetyError);
    expect(isJsonSafe({ bad: NaN })).toBe(false);
  });

  it('JsonSafetyError has structured path and kind fields', () => {
    try {
      assertJsonSafe({ a: { b: NaN } });
      expect.fail('Should have thrown JsonSafetyError');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonSafetyError);
      if (err instanceof JsonSafetyError) {
        expect(err.path).toBe('$.a.b');
        expect(err.kind).toBe('non_finite_number');
        expect(err.message).toContain('$.a.b');
      }
    }
  });

  it('rejects functions, symbols, and bigints with correct kind', () => {
    try {
      assertJsonSafe({ fn: () => {} });
      expect.fail('Should have thrown JsonSafetyError');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonSafetyError);
      if (err instanceof JsonSafetyError) {
        expect(err.kind).toBe('function');
      }
    }

    try {
      assertJsonSafe({ sym: Symbol('foo') });
      expect.fail('Should have thrown JsonSafetyError');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonSafetyError);
      if (err instanceof JsonSafetyError) {
        expect(err.kind).toBe('symbol');
      }
    }

    // Use BigInt constructor for ES2017 compatibility (test validates rejection behavior)
    if (typeof BigInt !== 'undefined') {
      try {
        assertJsonSafe({ big: BigInt(10) });
        expect.fail('Should have thrown JsonSafetyError');
      } catch (err) {
        expect(err).toBeInstanceOf(JsonSafetyError);
        if (err instanceof JsonSafetyError) {
          expect(err.kind).toBe('bigint');
        }
      }
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

  it('detects circular references with JsonSafetyError', () => {
    const circular: Record<string, unknown> = { name: 'test' };
    circular.self = circular;

    try {
      assertJsonSafe(circular);
      expect.fail('Should have thrown JsonSafetyError');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonSafetyError);
      if (err instanceof JsonSafetyError) {
        expect(err.kind).toBe('circular_reference');
        expect(err.path).toBe('$.self');
      }
    }
    expect(isJsonSafe(circular)).toBe(false);
  });

  it('reports correct path in error messages', () => {
    try {
      assertJsonSafe({ a: { b: NaN } });
      expect.fail('Should have thrown JsonSafetyError');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonSafetyError);
      if (err instanceof JsonSafetyError) {
        expect(err.path).toBe('$.a.b');
        expect(err.message).toContain('$.a.b');
      }
    }

    try {
      assertJsonSafe([1, [2, Infinity]]);
      expect.fail('Should have thrown JsonSafetyError');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonSafetyError);
      if (err instanceof JsonSafetyError) {
        expect(err.path).toBe('$[1][1]');
        expect(err.message).toContain('$[1][1]');
      }
    }
  });
});
