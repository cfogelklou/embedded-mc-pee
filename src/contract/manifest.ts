/**
 * Contract manifest — the single source of truth for an agent output contract.
 *
 * Per ADR-0001 (belt-and-suspenders), BOTH the tool-schema JSON Schema and the
 * prompt-rendered contract text are DERIVED from one declarative manifest, so
 * they can never drift. The harness never sends a response schema to the model;
 * the prompt text carries the contract.
 */

import type { EnvelopeState } from '../envelope/envelope';
import type { JsonSchemaObject } from '../tool/toolContract';

/**
 * Envelope conditional field names known to the generic envelope.
 *
 * Hosts may declare additional (extended) conditional fields; the two names
 * here are the ones the envelope validator itself understands.
 */
export const KNOWN_ENVELOPE_CONDITIONAL_FIELDS = ['questionText', 'explanation'] as const;

/**
 * One state-conditional envelope field rule.
 *
 * Declares that `field` must be present whenever the envelope state is one of
 * `requiredForStates`. `field` is `'questionText'` / `'explanation'` for the
 * generic envelope fields, or any host-extended field name.
 */
export interface EnvelopeConditionalField {
  /** Envelope field name ('questionText' | 'explanation' | host-extended). */
  readonly field: string;
  /** States for which this field is required. */
  readonly requiredForStates: readonly EnvelopeState[];
  /** Optional human-readable explanation rendered into the prompt contract. */
  readonly description?: string;
}

/**
 * Specification of the generic envelope part of a contract.
 */
export interface EnvelopeFieldSpec {
  /** Allowed envelope states; omitted means all four {@link EnvelopeState} values. */
  readonly states?: readonly EnvelopeState[];
  /** State-conditional field rules (questionText/explanation or host-extended). */
  readonly conditionalFields?: readonly EnvelopeConditionalField[];
}

/**
 * Declarative contract manifest — the SSOT both derived artifacts come from.
 *
 * Validated by `createContract` (src/contract/contract.ts) before use; the
 * derivation functions in src/contract/derive.ts assume a valid manifest.
 */
export interface ContractManifest {
  /** Generic envelope field specification. */
  readonly envelope: EnvelopeFieldSpec;
  /** Host payload JSON Schema (must be an object schema). */
  readonly payload: JsonSchemaObject;
  /** Optional host metadata (string values only); carried, never enforced. */
  readonly metadata?: Readonly<Record<string, string>>;
}
