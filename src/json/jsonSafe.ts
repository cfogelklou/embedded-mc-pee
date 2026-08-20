/**
 * JSON Safety Utilities
 *
 * Provides recursive validation that values are JSON-serializable.
 * Rejects NaN, Infinity, -Infinity, functions, symbols, bigints, and circular references.
 *
 */

/**
 * Structured error type for JSON safety violations.
 *
 * Thrown by {@link assertJsonSafe} when a value cannot be JSON-serialized without data loss.
 */
export class JsonSafetyError extends Error {
  /**
   * JSON path to the unsafe value (e.g. '$.payload.foo[2]').
   */
  public readonly path: string;

  /**
   * Machine-readable kind of violation (snake_case).
   */
  public readonly kind: string;

  /**
   * Creates a new JSON safety error.
   *
   * @param message - Human-readable error message
   * @param path - JSON path to the unsafe value
   * @param kind - Machine-readable violation kind
   */
  constructor(message: string, path: string, kind: string) {
    super(message);
    this.name = 'JsonSafetyError';
    this.path = path;
    this.kind = kind;
  }
}

/**
 * Asserts that a value is JSON-safe (serializable without data loss).
 * Throws a JsonSafetyError with a descriptive path if the value violates JSON safety.
 *
 * @param value - The value to validate
 * @param path - Current path in the object structure (for error messages)
 * @param visited - WeakSet tracking visited objects to detect circular references
 * @throws JsonSafetyError if the value contains non-finite numbers, functions, symbols, bigints, or circular references
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
      throw new JsonSafetyError(
        `JSON safety violation at path "${path}": non-finite number ${value}`,
        path,
        'non_finite_number'
      );
    }
    return;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new JsonSafetyError(
      `JSON safety violation at path "${path}": unsupported type ${typeof value}`,
      path,
      typeof value
    );
  }
  if (typeof value === 'object') {
    if (visited.has(value)) {
      throw new JsonSafetyError(
        `JSON safety violation at path "${path}": circular reference detected`,
        path,
        'circular_reference'
      );
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
  throw new JsonSafetyError(
    `JSON safety violation at path "${path}": unrecognized value`,
    path,
    'unrecognized_value'
  );
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
