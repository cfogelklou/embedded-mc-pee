/**
 * Generic typed envelope for tool-calling LLM responses.
 *
 * Provides a structured envelope for LLM outputs with state-based conditional fields,
 * JSON-safety guarantees, and deterministic validation. This is the core contract between
 * LLM providers and host applications.
 */

// ============================================================================
// State Discriminators
// ============================================================================

/**
 * Response state discriminators for the agent envelope.
 * Each state determines which conditional fields are required.
 */
export type EnvelopeState = 'proposal' | 'question' | 'analysis' | 'infeasible';

/**
 * Valid envelope state values.
 */
export const ENVELOPE_STATES = ['proposal', 'question', 'analysis', 'infeasible'] as const;

// ============================================================================
// Envelope Types
// ============================================================================

/**
 * Generic agent response envelope.
 *
 * Minimal envelope with state-based conditional fields only.
 *
 * Conditional field requirements (enforced by validation):
 * - state === 'question': questionText is required
 * - state === 'analysis' | 'infeasible': explanation is required
 * - state === 'proposal': payload is required (via AgentTurn)
 *
 * @template P - Payload type (only present when state === 'proposal')
 */
export interface AgentEnvelope {
  /** Response state discriminator */
  state: EnvelopeState;

  /** Required when state === 'question': the question to ask the user */
  questionText?: string;

  /** Required when state === 'analysis' | 'infeasible': explanation text */
  explanation?: string;
}

/**
 * Complete agent turn with envelope and optional payload.
 *
 * Payload is present if and only if state === 'proposal'.
 * This invariant is enforced by validation.
 *
 * @template P - Payload type (constrained by state === 'proposal')
 */
export interface AgentTurn<P> {
  /** The response envelope */
  envelope: AgentEnvelope;

  /** Optional payload (only present when state === 'proposal') */
  payload?: P;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Validation failure codes for envelope validation.
 */
export type ValidationFailureCode =
  | 'malformed_json'
  | 'schema_invalid'
  | 'non_finite_value'
  | 'missing_required_field'
  | 'invalid_enum'
  | 'payload_missing'
  | 'payload_unexpected'
  | 'envelope_state_invalid';

/**
 * Structured validation failure with context.
 */
export interface ValidationFailure {
  /** Machine-readable failure code */
  code: ValidationFailureCode;

  /** Human-readable failure message */
  message: string;

  /** Optional JSON path to the problematic field */
  fieldPath?: string;
}

/**
 * Result type for payload validation.
 *
 * @template P - Validated payload type
 */
export type PayloadResult<P> =
  | { ok: true; value: P }
  | { ok: false; failure: ValidationFailure };

/**
 * Result type for complete turn validation.
 *
 * @template P - Payload type
 */
export type TurnResult<P> =
  | { ok: true; value: AgentTurn<P> }
  | { ok: false; failure: ValidationFailure };

/**
 * Payload validator function type.
 *
 * Host applications provide this function to validate domain-specific payloads.
 * The validator checks structural integrity and domain rules for the payload.
 *
 * @template P - Validated payload type
 * @param payload - Unknown payload to validate
 * @returns Validation result with typed payload or failure
 */
export type EnvelopePayloadValidator<P> = (payload: unknown) => PayloadResult<P>;
