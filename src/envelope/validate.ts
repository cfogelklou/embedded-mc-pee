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

// Import from json/jsonSafe: DRY principle per 2026-08-20 architecture review.
// One definition per shared helper.
import { assertJsonSafe, JsonSafetyError } from '../json/jsonSafe';

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
    // Use structured error handling - no prose parsing
    const fieldPath = err instanceof JsonSafetyError ? err.path : '$';
    const message = err instanceof Error ? err.message : 'Non-finite numeric value encountered.';

    const failure: ValidationFailure = {
      code: 'non_finite_value',
      message,
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

  // Build validated turn - payload key omitted for non-proposal states
  const turnBase: AgentTurn<P> = { envelope };
  const turn: AgentTurn<P> = validatedState === 'proposal' && validatedPayload !== undefined
    ? { ...turnBase, payload: validatedPayload }
    : turnBase;

  return { ok: true, value: turn };
}
