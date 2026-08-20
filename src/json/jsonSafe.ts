/**
 * JSON Safety Utilities
 *
 * Provides recursive validation that values are JSON-serializable.
 * Rejects NaN, Infinity, -Infinity, functions, symbols, bigints, and circular references.
 *
 */

/**
 * Asserts that a value is JSON-safe (serializable without data loss).
 * Throws an Error with a descriptive path if the value violates JSON safety.
 *
 * @param value - The value to validate
 * @param path - Current path in the object structure (for error messages)
 * @param visited - WeakSet tracking visited objects to detect circular references
 * @throws Error if the value contains non-finite numbers, functions, symbols, bigints, or circular references
 */
export function assertJsonSafe(
  value: unknown,
  path: string = '$',
  visited: WeakSet<object> = new WeakSet()
): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`JSON safety violation at path "${path}": non-finite number ${value}`);
    }
    return;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error(`JSON safety violation at path "${path}": unsupported type ${typeof value}`);
  }
  if (typeof value === 'object') {
    if (visited.has(value)) {
      throw new Error(`JSON safety violation at path "${path}": circular reference detected`);
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        assertJsonSafe(value[i], `${path}[${i}]`, visited);
      }
      return;
    }
    for (const [key, val] of Object.entries(value)) {
      assertJsonSafe(val, `${path}.${key}`, visited);
    }
    return;
  }
  throw new Error(`JSON safety violation at path "${path}": unrecognized value`);
}

/**
 * Tests whether a value is JSON-safe (serializable without data loss).
 * Returns true if the value passes all JSON safety checks, false otherwise.
 *
 * @param value - The value to test
 * @param visited - WeakSet tracking visited objects to detect circular references
 * @returns true if JSON-safe, false otherwise
 */
export function isJsonSafe(value: unknown, visited: WeakSet<object> = new WeakSet()): boolean {
  try {
    assertJsonSafe(value, '$', visited);
    return true;
  } catch {
    return false;
  }
}
