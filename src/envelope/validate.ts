/**
 * Envelope validation logic.
 *
 * Provides deterministic validation for agent envelopes with JSON-safety checks,
 * state enum validation, conditional field presence, and payload validation.
 */

import type {
  AgentEnvelope,
  AgentTurn,
  EnvelopePayloadValidator,
  EnvelopeState,
  TurnResult,
  ValidationFailure
} from './envelope';

import { ENVELOPE_STATES } from './envelope';

// ============================================================================
// JSON-Safety Checks (Local Implementation)
// ============================================================================

/**
 * Asserts that a value is JSON-safe (can be serialized without data loss).
 *
 * JSON-safe values are: null, undefined, finite numbers, strings, booleans,
 * arrays of JSON-safe values, and plain objects with JSON-safe values.
 *
 * Rejects: NaN, Infinity, -Infinity, functions, symbols, BigInt, circular refs.
 *
 * @param value - Value to check
 * @param path - JSON path for error reporting (default: '$')
 * @param visited - WeakSet for circular reference detection
 * @throws Error if value is not JSON-safe
 */
function assertJsonSafe(
  value: unknown,
  path: string = '$',
  visited: WeakSet<object> = new WeakSet()
): void {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite number ${value} at path "${path}"`);
    }
    return;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error(`Unsupported type ${typeof value} at path "${path}"`);
  }

  if (typeof value === 'object') {
    if (visited.has(value)) {
      throw new Error(`Circular reference detected at path "${path}"`);
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        assertJsonSafe(value[i], `${path}[${i}]`, visited);
      }
      return;
    }

    // Plain object - check all properties
    for (const [key, val] of Object.entries(value)) {
      assertJsonSafe(val, `${path}.${key}`, visited);
    }
    return;
  }

  throw new Error(`Unrecognized value at path "${path}"`);
}

// ============================================================================
// Validation Constants
// ============================================================================

/**
 * Valid envelope state values for runtime checks.
 */
const VALID_STATES: readonly EnvelopeState[] = ENVELOPE_STATES;

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validates agent envelope output deterministically.
 *
 * Validation steps:
 * 1. Input must be a plain object (not null, not array)
 * 2. All values must be JSON-safe (no NaN, Infinity, circular refs, etc.)
 * 3. State field must be present and match valid enum values
 * 4. Conditional fields required per state:
 *    - state === 'question': questionText required
 *    - state === 'analysis' | 'infeasible': explanation required
 * 5. Payload presence:
 *    - state === 'proposal': payload required (payload_missing if absent)
 *    - state !== 'proposal': payload forbidden (payload_unexpected if present)
 * 6. When payload present, run payloadValidator and propagate any failure
 *
 * @param parsed - Unknown parsed value to validate
 * @param payloadValidator - Host-provided payload validator for domain-specific checks
 * @returns Validated turn or structured validation failure
 *
 * @template P - Payload type (only present when state === 'proposal')
 */
export function validateEnvelopeOutput<P>(
  parsed: unknown,
  payloadValidator: EnvelopePayloadValidator<P>
): TurnResult<P> {
  // Step 1: Input must be a plain object
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const failure: ValidationFailure = {
      code: 'malformed_json',
      message: 'Model output must be a valid JSON object.',
      fieldPath: '$'
    };
    return { ok: false, failure };
  }

  // Step 2: JSON-safety check (recursive finite number and structure check)
  try {
    assertJsonSafe(parsed);
  } catch (err) {
    // Extract the path from the error message if available
    let fieldPath = '$';
    if (err instanceof Error) {
      // Error message format: "Non-finite number X at path "Y" or "Circular reference detected at path "Y""
      const pathMatch = err.message.match(/at path "([^"]+)"/);
      if (pathMatch && pathMatch[1]) {
        fieldPath = pathMatch[1];
      }
    }

    const failure: ValidationFailure = {
      code: 'non_finite_value',
      message: err instanceof Error ? err.message : 'Non-finite numeric value encountered.',
      fieldPath
    };
    return { ok: false, failure };
  }

  const raw = parsed as Record<string, unknown>;

  // Step 3: Validate state field (required)
  const state = typeof raw.state === 'string' ? raw.state : null;
  if (!state || !VALID_STATES.includes(state as EnvelopeState)) {
    const failure: ValidationFailure = {
      code: 'invalid_enum',
      message: `Invalid state "${String(raw.state)}". Must be one of: ${VALID_STATES.join(', ')}.`,
      fieldPath: '$.state'
    };
    return { ok: false, failure };
  }

  const validatedState = state as EnvelopeState;

  // Step 4: Validate conditional fields per state
  if (validatedState === 'question' && typeof raw.questionText !== 'string') {
    const failure: ValidationFailure = {
      code: 'missing_required_field',
      message: 'questionText is required when state is "question".',
      fieldPath: '$.questionText'
    };
    return { ok: false, failure };
  }

  if ((validatedState === 'analysis' || validatedState === 'infeasible') &&
      typeof raw.explanation !== 'string') {
    const failure: ValidationFailure = {
      code: 'missing_required_field',
      message: 'explanation is required when state is "analysis" or "infeasible".',
      fieldPath: '$.explanation'
    };
    return { ok: false, failure };
  }

  // Step 5: Validate payload presence per state
  const hasPayload = 'payload' in raw && raw.payload !== undefined && raw.payload !== null;

  if (validatedState === 'proposal') {
    if (!hasPayload) {
      const failure: ValidationFailure = {
        code: 'payload_missing',
        message: 'payload is required when state is "proposal".',
        fieldPath: '$.payload'
      };
      return { ok: false, failure };
    }
  } else {
    // For non-proposal states, payload must be absent
    if (hasPayload) {
      const failure: ValidationFailure = {
        code: 'payload_unexpected',
        message: 'payload must only be present when state is "proposal".',
        fieldPath: '$.payload'
      };
      return { ok: false, failure };
    }
  }

  // Step 6: Validate payload with host-provided validator (if present)
  let validatedPayload: P | undefined;
  if (hasPayload && validatedState === 'proposal') {
    const payloadResult = payloadValidator(raw.payload);
    if (!payloadResult.ok) {
      // Propagate payload validation failure
      return { ok: false, failure: payloadResult.failure };
    }
    validatedPayload = payloadResult.value;
  }

  // Build validated envelope
  const envelope: AgentEnvelope = {
    state: validatedState,
    questionText: typeof raw.questionText === 'string' ? raw.questionText : undefined,
    explanation: typeof raw.explanation === 'string' ? raw.explanation : undefined
  };

  // Build validated turn
  const turn: AgentTurn<P> = {
    envelope,
    payload: validatedPayload
  };

  return { ok: true, value: turn };
}
