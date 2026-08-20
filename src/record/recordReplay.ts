/**
 * Record/Replay Transport Implementation
 *
 * Recording and replay transport decorators for deterministic testing.
 * Captures real model turns for replay without network access.
 *
 * @module record/recordReplay
 */

import type { LlmTransport, LlmRequest, LlmResponse } from '../transport/types';
import { inputHashOf, DEFAULT_REPLAY_RECORDING_VERSION } from './hash';

// ============================================================================
// Types
// ============================================================================

/**
 * Recording entry mapping request hash to request/response pair.
 */
export type RecordingEntries = Readonly<
  Record<string, { readonly request: LlmRequest; readonly response: LlmResponse }>
>;

/**
 * Callback invoked when a new recording is added.
 *
 * @param hash - Request hash (key for the entry)
 * @param request - Recorded request
 * @param response - Recorded response
 */
export type OnRecordCallback = (
  hash: string,
  request: LlmRequest,
  response: LlmResponse
) => void;

/**
 * Options for replay miss behavior.
 */
export type ReplayMissOptions = 'strict' | 'passthrough';

/**
 * Error thrown when a replay lookup misses in strict mode.
 */
export interface ReplayMissError {
  readonly kind: 'REPLAY_MISS';
  readonly hash: string;
  readonly requestSnippet: string;
  readonly message: string;
}

/**
 * Recording file schema.
 *
 * Versioned to detect incompatible format changes. Old versions must be
 * rejected, not silently migrated.
 */
export interface RecordingFile {
  readonly recordingVersion: number;
  readonly entries: Record<string, { readonly request: LlmRequest; readonly response: LlmResponse }>;
}

/**
 * Typed failure from recording serialization.
 */
export type RecordingParseFailure = {
  readonly ok: false;
  readonly failure: {
    readonly kind:
      | 'INVALID_JSON'
      | 'WRONG_VERSION'
      | 'UNKNOWN_KEY'
      | 'MISSING_VERSION'
      | 'MISSING_ENTRIES';
    readonly reason: string;
    readonly observedVersion?: number;
  };
};

/**
 * Typed failure from recording serialization.
 */
export type RecordingSerializeResult =
  | { readonly ok: true; readonly value: string }
  | RecordingParseFailure;

// ============================================================================
// Recording Transport
// ============================================================================

/**
 * Decorator transport that records successful responses from an inner transport.
 *
 * Wraps any LlmTransport and records request/response pairs keyed by input hash.
 * Only successful responses are recorded; rejections from the inner transport
 * are re-thrown unchanged.
 *
 * Recording sink is in-memory (map) with optional callback for persistence.
 * File I/O is the host's responsibility.
 */
export class RecordingTransport implements LlmTransport {
  private readonly inner: LlmTransport;
  private readonly entries: Map<string, { request: LlmRequest; response: LlmResponse }>;
  private readonly onRecord?: OnRecordCallback;

  /**
   * Creates a new RecordingTransport.
   *
   * @param inner - Underlying transport to wrap (records its responses)
   * @param entries - In-memory recording map (mutated on each successful call)
   * @param onRecord - Optional callback for persistence (e.g., write to file)
   */
  constructor(
    inner: LlmTransport,
    entries: Map<string, { request: LlmRequest; response: LlmResponse }>,
    onRecord?: OnRecordCallback
  ) {
    this.inner = inner;
    this.entries = entries;
    this.onRecord = onRecord;
  }

  /**
   * Forwards request to inner transport, records successful response, returns it.
   *
   * Rejections from inner transport are NOT recorded and re-thrown unchanged.
   *
   * @param req - Request to send
   * @param opts - Execution options
   * @returns Response from inner transport (after recording)
   * @throws Error if inner transport rejects
   */
  async complete(req: LlmRequest, opts: { timeoutMs: number }): Promise<LlmResponse> {
    const response = await this.inner.complete(req, opts);

    const hashResult = await inputHashOf(req);
    if (!hashResult.ok) {
      throw new Error(`Failed to hash request for recording: ${hashResult.failure.reason}`);
    }

    const hash = hashResult.value;
    const entry = { request: req, response };
    this.entries.set(hash, entry);

    if (this.onRecord) {
      this.onRecord(hash, req, response);
    }

    return response;
  }
}

// ============================================================================
// Replay Transport
// ============================================================================

/**
 * Transport that replays previously recorded responses.
 *
 * Looks up requests by input hash and returns the stored raw LlmResponse.
 * The harness pipeline (normalization → validation → policy) runs identically.
 *
 * Miss behavior configurable: strict mode rejects with ReplayMissError,
 * passthrough mode forwards to optional inner transport.
 */
export class ReplayTransport implements LlmTransport {
  private readonly entries: RecordingEntries;
  private readonly options: { readonly missMode: ReplayMissOptions };
  private readonly inner?: LlmTransport;

  /**
   * Creates a new ReplayTransport.
   *
   * @param entries - Recorded entries map (hash → request/response)
   * @param options - Configuration options
   * @param inner - Optional inner transport for passthrough mode
   */
  constructor(
    entries: RecordingEntries,
    options: { readonly missMode?: ReplayMissOptions } = {},
    inner?: LlmTransport
  ) {
    this.entries = entries;
    this.options = { missMode: options.missMode ?? 'strict' };
    this.inner = inner;
  }

  /**
   * Looks up request by hash and returns stored response.
   *
   * Hit: returns the raw LlmResponse (harness pipeline reruns).
   * Miss in strict mode: rejects with ReplayMissError.
   * Miss in passthrough mode: forwards to inner transport (must be provided).
   *
   * @param req - Request to replay
   * @param opts - Execution options
   * @returns Replayed response or inner transport response
   * @throws ReplayMissError in strict mode on miss
   * @throws Error if passthrough mode without inner transport
   */
  async complete(req: LlmRequest, opts: { timeoutMs: number }): Promise<LlmResponse> {
    const hashResult = await inputHashOf(req);
    if (!hashResult.ok) {
      throw new Error(`Failed to hash request for replay: ${hashResult.failure.reason}`);
    }

    const hash = hashResult.value;
    const entry = this.entries[hash];

    if (entry !== undefined) {
      return entry.response;
    }

    // Miss handling
    if (this.options.missMode === 'strict') {
      const snippet = req.promptText.slice(0, 100);
      const error: ReplayMissError = {
        kind: 'REPLAY_MISS',
        hash,
        requestSnippet: snippet,
        message: `Replay miss for request hash ${hash}. Request snippet: "${snippet}"`
      };
      throw error as unknown as Error; // Throw as Error for compatibility
    }

    // Passthrough mode
    if (!this.inner) {
      throw new Error('Passthrough mode requires inner transport');
    }
    return this.inner.complete(req, opts);
  }
}

// ============================================================================
// Recording Serialization
// ============================================================================

/**
 * Serializes recording entries to JSON string for file storage.
 *
 * The recording schema includes a version field for format compatibility.
 * Hosts should write atomically (tmp file + rename) but this library handles
 * only serialization.
 *
 * @param entries - Recording entries map
 * @returns JSON string or typed failure
 */
export function serializeRecording(
  entries: RecordingEntries
): RecordingSerializeResult {
  const recording: RecordingFile = {
    recordingVersion: DEFAULT_REPLAY_RECORDING_VERSION,
    entries: entries as Record<string, { readonly request: LlmRequest; readonly response: LlmResponse }>
  };

  try {
    return { ok: true, value: JSON.stringify(recording, null, 2) };
  } catch (err: unknown) {
    return {
      ok: false,
      failure: {
        kind: 'INVALID_JSON',
        reason: `JSON.stringify failed: ${err instanceof Error ? err.message : String(err)}`
      }
    };
  }
}

/**
 * Parses a recording JSON string into entries map.
 *
 * Strict validation: wrong/old recordingVersion, unknown top-level keys,
 * missing required fields, or corrupt JSON all return typed failures.
 *
 * Atomic-write pattern (host responsibility):
 * ```typescript
 * const tmpPath = `${path}.tmp`;
 * await fs.writeFile(tmpPath, serialized, 'utf8');
 * await fs.rename(tmpPath, path); // atomic
 * ```
 *
 * @param text - Recording JSON text
 * @returns Parsed entries or typed failure
 */
export function parseRecording(
  text: string
): { readonly ok: true; readonly entries: RecordingEntries } | RecordingParseFailure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err: unknown) {
    return {
      ok: false,
      failure: {
        kind: 'INVALID_JSON',
        reason: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`
      }
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      failure: { kind: 'INVALID_JSON', reason: 'Root must be an object' }
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Check for unknown top-level keys
  const allowedKeys = new Set(['recordingVersion', 'entries']);
  const unknownKeys = Object.keys(obj).filter((k) => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      failure: {
        kind: 'UNKNOWN_KEY',
        reason: `Unknown top-level keys: ${unknownKeys.join(', ')}`
      }
    };
  }

  // Validate recordingVersion presence and type
  if (obj.recordingVersion === undefined) {
    return {
      ok: false,
      failure: { kind: 'MISSING_VERSION', reason: 'Missing recordingVersion' }
    };
  }

  if (typeof obj.recordingVersion !== 'number') {
    return {
      ok: false,
      failure: {
        kind: 'INVALID_JSON',
        reason: `recordingVersion must be a number, got ${typeof obj.recordingVersion}`
      }
    };
  }

  // Reject old/wrong versions
  if (obj.recordingVersion !== DEFAULT_REPLAY_RECORDING_VERSION) {
    return {
      ok: false,
      failure: {
        kind: 'WRONG_VERSION',
        reason: `Unsupported recording version ${obj.recordingVersion} (expected ${DEFAULT_REPLAY_RECORDING_VERSION})`,
        observedVersion: obj.recordingVersion
      }
    };
  }

  // Validate entries presence and type
  if (obj.entries === undefined) {
    return {
      ok: false,
      failure: { kind: 'MISSING_ENTRIES', reason: 'Missing entries' }
    };
  }

  if (typeof obj.entries !== 'object' || obj.entries === null || Array.isArray(obj.entries)) {
    return {
      ok: false,
      failure: {
        kind: 'INVALID_JSON',
        reason: `entries must be an object, got ${typeof obj.entries}`
      }
    };
  }

  return {
    ok: true,
    entries: obj.entries as RecordingEntries
  };
}
