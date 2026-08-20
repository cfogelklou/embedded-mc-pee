/**
 * Contract creation — validates a {@link ContractManifest} and derives the
 * belt-and-suspenders artifacts (tool schema + prompt contract text) from it.
 *
 * Per ADR-0001, one declarative manifest is the SSOT; both the JSON Schema and
 * the prompt text are DERIVED from it so they can never drift. Invalid
 * manifests produce a typed failure list — never a throw.
 */

import type {
  EnvelopePayloadValidator,
  PayloadResult,
  ValidationFailure
} from '../envelope/envelope';
import { ENVELOPE_STATES } from '../envelope/envelope';
import type { JsonSchemaObject } from '../tool/toolContract';
import { canonicalizeManifest, deriveToolSchema, renderPromptContract } from './derive';
import type { ContractManifest } from './manifest';

// ============================================================================
// Types
// ============================================================================

/**
 * A validated, self-contained agent output contract.
 *
 * `toolSchema` and `renderPromptContract()` are DERIVED from `manifest` at
 * creation (the prompt text is memoized) — they cannot drift from the manifest.
 *
 * @template P - Host payload type produced by `validateHostPayload`
 */
export interface Contract<P> {
  /** The canonicalized source manifest (SSOT). */
  readonly manifest: ContractManifest;
  /** JSON Schema for the full envelope-with-payload output — derived at creation. */
  readonly toolSchema: JsonSchemaObject;
  /** Renders the prompt contract markdown — derived and memoized at first call. */
  readonly renderPromptContract: () => string;
  /** Host payload validator (wrapping the host function + unknown-field policy). */
  readonly validateHostPayload: EnvelopePayloadValidator<P>;
}

/**
 * Options controlling contract creation.
 */
export interface CreateContractOptions {
  /**
   * Policy for unknown top-level payload keys when the payload schema declares
   * `properties`: `'reject'` (default) fails validation with a `schema_invalid`
   * failure; `'ignore'` skips the check and lets the host validator decide.
   */
  readonly payloadUnknownFieldPolicy?: 'reject' | 'ignore';
}

/**
 * Machine-readable codes for manifest validation failures.
 */
export type ManifestFailureCode =
  | 'manifest_not_object'
  | 'payload_not_object_schema'
  | 'states_not_array'
  | 'states_empty'
  | 'state_not_envelope_state'
  | 'duplicate_state'
  | 'duplicate_conditional_field'
  | 'conditional_field_states_empty'
  | 'conditional_field_state_not_envelope_state'
  | 'metadata_value_not_string';

/**
 * One structured manifest validation failure.
 */
export interface ManifestFailure {
  /** Machine-readable failure code. */
  readonly code: ManifestFailureCode;
  /** Human-readable failure message. */
  readonly message: string;
  /** Manifest-relative path of the invalid part, e.g. `envelope.states[1]`. */
  readonly fieldPath: string;
}

/**
 * Result of {@link createContract}: typed success or a failure list — never a throw.
 *
 * @template P - Host payload type
 */
export type CreateContractResult<P> =
  | { readonly ok: true; readonly contract: Contract<P> }
  | { readonly ok: false; readonly failures: readonly ManifestFailure[] };

// ============================================================================
// Manifest validation
// ============================================================================

/**
 * Returns `value` if it is a plain (non-null, non-array) object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a manifest's structure: payload must be an object schema; envelope
 * states (when declared) must be a non-empty, duplicate-free subset of
 * {@link ENVELOPE_STATES}; conditional fields must have unique names and valid
 * state lists; metadata values must be strings.
 *
 * @param manifest - Candidate manifest (untrusted boundary input)
 * @returns All failures found (empty array = valid)
 */
function validateManifest(manifest: unknown): readonly ManifestFailure[] {
  const failures: ManifestFailure[] = [];

  if (!isPlainObject(manifest)) {
    return [
      {
        code: 'manifest_not_object',
        message: 'Contract manifest must be a JSON object.',
        fieldPath: '$'
      }
    ];
  }
  const envelope = manifest.envelope;
  const envelopeSpec = isPlainObject(envelope) ? envelope : {};

  // Payload must be an object schema.
  const payload = manifest.payload;
  const payloadType: unknown = isPlainObject(payload) ? payload.type : undefined;
  if (payloadType !== 'object') {
    failures.push({
      code: 'payload_not_object_schema',
      message: 'Manifest payload must be a JSON Schema object schema (type: "object").',
      fieldPath: '$.payload'
    });
  }

  // Envelope states: optional, but if present a non-empty duplicate-free subset.
  const states: unknown = envelopeSpec.states;
  if (states !== undefined && !Array.isArray(states)) {
    failures.push({
      code: 'states_not_array',
      message: 'Envelope states must be an array when declared.',
      fieldPath: '$.envelope.states'
    });
  } else if (Array.isArray(states)) {
    if (states.length === 0) {
      failures.push({
        code: 'states_empty',
        message: 'Envelope states must be a non-empty array when declared.',
        fieldPath: '$.envelope.states'
      });
    }
    const seen = new Set<string>();
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index] as string;
      if (
        typeof state !== 'string' ||
        !(ENVELOPE_STATES as readonly string[]).includes(state)
      ) {
        failures.push({
          code: 'state_not_envelope_state',
          message: `Unknown envelope state "${String(state)}". Must be one of: ${ENVELOPE_STATES.join(', ')}.`,
          fieldPath: `$.envelope.states[${index}]`
        });
      }
      if (typeof state === 'string') {
        if (seen.has(state)) {
          failures.push({
            code: 'duplicate_state',
            message: `Duplicate envelope state "${state}".`,
            fieldPath: `$.envelope.states[${index}]`
          });
        }
        seen.add(state);
      }
    }
  }

  // Conditional fields: unique names, valid non-empty state lists.
  const conditionalFields: unknown = envelopeSpec.conditionalFields;
  if (conditionalFields !== undefined) {
    if (Array.isArray(conditionalFields)) {
      const seenFields = new Set<string>();
      for (let index = 0; index < conditionalFields.length; index += 1) {
        const entry = conditionalFields[index];
        if (!isPlainObject(entry)) {
          continue;
        }
        const field: unknown = entry.field;
        if (typeof field === 'string') {
          if (seenFields.has(field)) {
            failures.push({
              code: 'duplicate_conditional_field',
              message: `Duplicate conditional field "${field}".`,
              fieldPath: `$.envelope.conditionalFields[${index}].field`
            });
          }
          seenFields.add(field);
        }
        const requiredForStates: unknown = entry.requiredForStates;
        if (!Array.isArray(requiredForStates) || requiredForStates.length === 0) {
          failures.push({
            code: 'conditional_field_states_empty',
            message: `Conditional field "${String(field)}" must declare a non-empty requiredForStates array.`,
            fieldPath: `$.envelope.conditionalFields[${index}].requiredForStates`
          });
        } else {
          for (let stateIndex = 0; stateIndex < requiredForStates.length; stateIndex += 1) {
            const state = requiredForStates[stateIndex];
            if (
              typeof state !== 'string' ||
              !(ENVELOPE_STATES as readonly string[]).includes(state)
            ) {
              failures.push({
                code: 'conditional_field_state_not_envelope_state',
                message: `Unknown envelope state "${String(state)}" in requiredForStates. Must be one of: ${ENVELOPE_STATES.join(', ')}.`,
                fieldPath: `$.envelope.conditionalFields[${index}].requiredForStates[${stateIndex}]`
              });
            }
          }
        }
      }
    }
  }

  // Metadata: string values only (typed at compile time; checked for JS callers).
  const metadata: unknown = manifest.metadata;
  if (isPlainObject(metadata)) {
    for (const key of Object.keys(metadata)) {
      if (typeof metadata[key] !== 'string') {
        failures.push({
          code: 'metadata_value_not_string',
          message: `Metadata value for "${key}" must be a string.`,
          fieldPath: `$.metadata.${key}`
        });
      }
    }
  }

  return failures;
}

// ============================================================================
// Payload validator wrapping (unknown-field policy)
// ============================================================================

/**
 * Builds the contract's payload validator: applies the unknown-field policy
 * for object payloads, then delegates to the host validator.
 *
 * @param payloadSchema - Canonicalized host payload schema
 * @param hostValidator - Host-provided payload validator
 * @param policy - `'reject'`: unknown top-level payload keys fail; `'ignore'`: skip the check
 * @returns The wrapped {@link EnvelopePayloadValidator}
 */
function wrapPayloadValidator<P>(
  payloadSchema: JsonSchemaObject,
  hostValidator: EnvelopePayloadValidator<P>,
  policy: 'reject' | 'ignore'
): EnvelopePayloadValidator<P> {
  return (payload: unknown): PayloadResult<P> => {
    if (policy === 'reject' && isPlainObject(payload)) {
      const declaredProperties = payloadSchema.properties;
      if (declaredProperties !== undefined) {
        for (const key of Object.keys(payload)) {
          if (!Object.prototype.hasOwnProperty.call(declaredProperties, key)) {
            const failure: ValidationFailure = {
              code: 'schema_invalid',
              message: `Unknown payload field "${key}". Allowed fields: ${Object.keys(declaredProperties).join(', ')}.`,
              fieldPath: `$.${key}`
            };
            return { ok: false, failure };
          }
        }
      }
    }
    return hostValidator(payload);
  };
}

// ============================================================================
// createContract
// ============================================================================

/**
 * Validates a manifest and creates a {@link Contract} from it.
 *
 * On success the manifest is canonicalized (recursively sorted keys, envelope
 * state default materialized) and both derived artifacts are produced from
 * that canonical form: `toolSchema` eagerly, the prompt contract text lazily
 * (memoized after the first render). On any validation failure the full
 * failure list is returned — this function never throws for invalid manifests.
 *
 * @template P - Host payload type produced by `validateHostPayload`
 * @param manifest - Candidate manifest (untrusted boundary input)
 * @param validateHostPayload - Host payload validator to wrap
 * @param options - Optional creation options (unknown-field policy, default `'reject'`)
 * @returns `{ ok: true, contract }` or `{ ok: false, failures }`
 */
export function createContract<P>(
  manifest: ContractManifest,
  validateHostPayload: EnvelopePayloadValidator<P>,
  options?: CreateContractOptions
): CreateContractResult<P> {
  const failures = validateManifest(manifest);
  if (failures.length > 0) {
    return { ok: false, failures };
  }

  const canonical = canonicalizeManifest(manifest);
  const policy: 'reject' | 'ignore' = options?.payloadUnknownFieldPolicy ?? 'reject';
  const toolSchema = deriveToolSchema(canonical);

  let memoizedPrompt: string | undefined;
  const renderMemoized = (): string => {
    if (memoizedPrompt === undefined) {
      memoizedPrompt = renderPromptContract(canonical);
    }
    return memoizedPrompt;
  };

  const contract: Contract<P> = {
    manifest: canonical,
    toolSchema,
    renderPromptContract: renderMemoized,
    validateHostPayload: wrapPayloadValidator(canonical.payload, validateHostPayload, policy)
  };
  return { ok: true, contract };
}
