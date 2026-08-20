/**
 * Debug & Assertion Utilities
 *
 * Zero-overhead, runtime-toggleable debug logging and defensive invariant
 * assertions shared across environments.
 *
 * Ported from courtpuzzle/src/common/debug.ts.
 */

// Type declarations for browser globals (this library targets Node but supports browser environments)
declare const window: {
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
} | undefined;

/**
 * Custom Error class for assertion failures.
 * Captures stack trace for debugging in development/test environments.
 */
export class AssertionError extends Error {
  constructor(message: string) {
    super(`[AssertionError] ${message}`);
    this.name = 'AssertionError';
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AssertionError);
    }
  }
}

/**
 * Type-safe interface for the structured debug logger.
 */
export interface DebugLogger {
  readonly log: (message?: unknown, ...optionalParams: unknown[]) => void;
  readonly warn: (message?: unknown, ...optionalParams: unknown[]) => void;
  readonly error: (message?: unknown, ...optionalParams: unknown[]) => void;
  readonly logObj: (label: string, obj: unknown) => void;
}

// Cross-runtime environment detection for initial debug state
function detectInitialDebugState(): boolean {
  const g = typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : {};

  // Browser check via window.localStorage
  if (typeof window !== 'undefined') {
    try {
      const storage = window.localStorage;
      if (storage && storage.getItem('DEBUG') === 'true') {
        return true;
      }
    } catch {
      // Documented best-effort fallback: localStorage may be restricted in sandbox/iframe
    }
  }

  // Node.js / Cloud Functions environment check via global process
  const proc = g.process as { env?: Record<string, string | undefined> } | undefined;
  if (proc && proc.env) {
    const debugEnv = proc.env.DEBUG;
    if (debugEnv === 'true' || debugEnv === '1') {
      return true;
    }
    const nodeEnv = proc.env.NODE_ENV;
    if (nodeEnv === 'development' || nodeEnv === 'test') {
      return true;
    }
  }

  return false;
}

let _isDebug: boolean = detectInitialDebugState();

/**
 * Returns whether debug logging is currently active.
 */
export function isDebug(): boolean {
  return _isDebug;
}

/**
 * Dynamically toggles debug logging at runtime.
 */
export function setDebug(enabled: boolean): void {
  _isDebug = enabled;
  if (typeof window !== 'undefined') {
    try {
      if (enabled) {
        window.localStorage?.setItem('DEBUG', 'true');
      } else {
        window.localStorage?.removeItem('DEBUG');
      }
    } catch {
      // Documented best-effort fallback: localStorage may be disabled
    }
  }
}

/**
 * Defensive assertion function for invariant enforcement.
 *
 * Throws an AssertionError if condition is falsy. In development/test mode,
 * this catches logic errors immediately. In production, it ensures
 * corrupted or invalid internal states never proceed silently.
 *
 * Note: Use assert for internal invariant violations and impossible states.
 * Untrusted external inputs (API payloads, user forms, LLM output) must
 * use typed schema validators and return structured error responses.
 *
 * @param condition - The expression that must evaluate to truthy
 * @param message - Descriptive failure message or factory function
 * @throws AssertionError if condition is falsy
 */
export function assert(condition: unknown, message?: string | (() => string)): asserts condition {
  if (!condition) {
    const msg = typeof message === 'function' ? message() : message || 'Assertion failed';
    const err = new AssertionError(msg);
    if (!_isDebug) {
      console.error(err);
    } else {
      throw err;
    }
  }
}

/**
 * Formats a local timestamp string: [HH:MM:SS.mmm]
 */
function getTimestamp(): string {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  return `[${hours}:${minutes}:${seconds}.${ms}]`;
}

function resolveMessage(message: unknown): unknown {
  return typeof message === 'function' ? (message as () => unknown)() : message;
}

/**
 * Structured debug logger.
 *
 * Produces zero console output and skips internal string formatting unless debug mode is active.
 */
export const dbg: Readonly<DebugLogger> = {
  log(message?: unknown, ...optionalParams: unknown[]): void {
    if (_isDebug) {
      const ts = getTimestamp();
      const resolved = resolveMessage(message);
      if (optionalParams.length > 0) {
        // eslint-disable-next-line no-console
        console.log(ts, resolved, ...optionalParams);
      } else {
        // eslint-disable-next-line no-console
        console.log(ts, resolved);
      }
    }
  },

  warn(message?: unknown, ...optionalParams: unknown[]): void {
    if (_isDebug) {
      const ts = getTimestamp();
      const resolved = resolveMessage(message);
      if (optionalParams.length > 0) {
        console.warn(ts, resolved, ...optionalParams);
      } else {
        console.warn(ts, resolved);
      }
    }
  },

  error(message?: unknown, ...optionalParams: unknown[]): void {
    if (_isDebug) {
      const ts = getTimestamp();
      const resolved = resolveMessage(message);
      if (optionalParams.length > 0) {
        console.error(ts, resolved, ...optionalParams);
      } else {
        console.error(ts, resolved);
      }
    }
  },

  logObj(label: string, obj: unknown): void {
    if (_isDebug) {
      const ts = getTimestamp();
      try {
        // eslint-disable-next-line no-console
        console.log(ts, label, JSON.stringify(obj, null, 2));
      } catch {
        // eslint-disable-next-line no-console
        console.log(ts, label, obj);
      }
    }
  }
};
