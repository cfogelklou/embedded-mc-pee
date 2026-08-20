/**
 * Debug & Assertion Utilities
 *
 * Zero-overhead, runtime-toggleable debug logging and defensive invariant
 * assertions shared across environments.
 *
 * Platform-agnostic: The library never touches `window`, `localStorage`,
 * `process`, or any environment globals. Debug mode starts DISABLED by
 * default. The host application enables it by calling `setDebug(true)` after
 * reading its own environment/config (e.g. Firebase Functions reads env vars;
 * a browser PWA reads localStorage).
 *
 * Ported from courtpuzzle/src/common/debug.ts.
 */

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

// Debug mode starts DISABLED by default. The host enables it via setDebug(true).
let _isDebug: boolean = false;

/**
 * Returns whether debug logging is currently active.
 */
export function isDebug(): boolean {
  return _isDebug;
}

/**
 * Severity level of a debug emit. Maps 1:1 to the `dbg` method that
 * produced it: `log` → 'log', `warn` → 'warn', `error` → 'error'
 * (`logObj` emits at 'log').
 */
export type DebugLevel = 'log' | 'warn' | 'error';

/**
 * Caller-installable output sink for debug output.
 *
 * Every `dbg.*` emit (when debug is enabled) is routed to the installed
 * sink with a severity level and a fully rendered, single-line message
 * (timestamp included). Hosts that provide their own logging library
 * (e.g. `logger` from `firebase-functions`) install a sink once at
 * startup to route library debug output there instead of raw console.
 */
export type DebugSink = (level: DebugLevel, message: string) => void;

/**
 * Default console-backed sink. Delegates each level to the matching
 * `console` method. Exported so hosts can build chaining/wrapping sinks
 * that fall back to the default behavior.
 */
export const DEFAULT_DEBUG_SINK: DebugSink = (level: DebugLevel, message: string): void => {
  // eslint-disable-next-line no-console
  console[level](message);
};

/**
 * Installed sink. Module-level state: sink installation is global for the
 * process (one library instance per bundle); hosts should install once at
 * startup, not per call site.
 */
let _sink: DebugSink = DEFAULT_DEBUG_SINK;

/**
 * Installs a caller-provided debug output sink, replacing the default
 * console-backed sink. Pass `null` to restore the default.
 *
 * This is host wiring, not untrusted input: a non-function argument is a
 * programmer error and always throws (regardless of debug mode — the
 * built-in `assert` only throws when debug is enabled, which is not a
 * strong enough guarantee for a broken host bootstrap).
 *
 * @param sink - Sink function to install, or `null` to restore
 *   {@link DEFAULT_DEBUG_SINK}.
 * @throws AssertionError if `sink` is neither a function nor `null`.
 */
export function setDebugSink(sink: DebugSink | null): void {
  if (typeof sink !== 'function' && sink !== null) {
    throw new AssertionError(
      `setDebugSink expects a sink function or null, received ${typeof sink}`
    );
  }
  _sink = sink === null ? DEFAULT_DEBUG_SINK : sink;
}

/**
 * Returns the currently installed debug sink (the default console-backed
 * sink when none has been installed). Useful for tests and for hosts that
 * wrap or chain sinks.
 */
export function getDebugSink(): DebugSink {
  return _sink;
}

/**
 * Dynamically toggles debug logging at runtime.
 *
 * The host application is responsible for persisting debug state if desired
 * (e.g. to localStorage in a browser PWA, or to env config in backend).
 * This library only maintains in-memory state for the current process.
 */
export function setDebug(enabled: boolean): void {
  _isDebug = enabled;
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
 * Renders a single value for sink output. Strings pass through verbatim;
 * other values are JSON-serialized with a `String()` fallback for values
 * JSON cannot represent (circular refs, undefined, functions).
 */
function renderValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    const json: string | undefined = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/**
 * Renders one debug line: timestamp followed by space-separated parts.
 */
function formatLine(ts: string, parts: readonly unknown[]): string {
  const rendered: string[] = [];
  for (const part of parts) {
    rendered.push(renderValue(part));
  }
  return `${ts} ${rendered.join(' ')}`;
}

/**
 * Structured debug logger.
 *
 * Produces zero output and skips internal string formatting unless debug
 * mode is active. Every emit goes through the installed
 * {@link DebugSink} (default: console) with the matching severity level.
 */
export const dbg: Readonly<DebugLogger> = {
  log(message?: unknown, ...optionalParams: unknown[]): void {
    if (_isDebug) {
      const resolved = resolveMessage(message);
      _sink('log', formatLine(getTimestamp(), [resolved, ...optionalParams]));
    }
  },

  warn(message?: unknown, ...optionalParams: unknown[]): void {
    if (_isDebug) {
      const resolved = resolveMessage(message);
      _sink('warn', formatLine(getTimestamp(), [resolved, ...optionalParams]));
    }
  },

  error(message?: unknown, ...optionalParams: unknown[]): void {
    if (_isDebug) {
      const resolved = resolveMessage(message);
      _sink('error', formatLine(getTimestamp(), [resolved, ...optionalParams]));
    }
  },

  logObj(label: string, obj: unknown): void {
    if (_isDebug) {
      const ts = getTimestamp();
      let rendered: string;
      try {
        const json: string | undefined = JSON.stringify(obj, null, 2);
        rendered = json === undefined ? String(obj) : json;
      } catch {
        // Documented best-effort fallback: circular or non-serializable objects
        rendered = String(obj);
      }
      _sink('log', `${ts} ${label} ${rendered}`);
    }
  }
};
