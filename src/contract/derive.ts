/**
 * Deterministic derivation of the two agent-facing artifacts from a
 * {@link ContractManifest}: the tool-schema JSON Schema and the
 * prompt-rendered contract text.
 *
 * Both functions are pure: the same manifest always yields byte-identical
 * output, independent of object key insertion order (schemas are canonicalized
 * with recursively sorted keys before rendering). This stability is what
 * record/replay hashing relies on.
 */

import { ENVELOPE_STATES } from '../envelope/envelope';
import type { EnvelopeState } from '../envelope/envelope';
import { KNOWN_ENVELOPE_CONDITIONAL_FIELDS } from './manifest';
import type { ContractManifest, EnvelopeFieldSpec } from './manifest';
import type { JsonSchema, JsonSchemaObject } from '../tool/toolContract';

// ============================================================================
// Canonicalization (insertion-order independence)
// ============================================================================

/**
 * Returns `value` if it is a plain (non-null, non-array) object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-copies a JSON value with every nested object's keys sorted
 * alphabetically. Arrays keep element order (order is semantic for `enum`,
 * `required`, and `states`); only object key insertion order is normalized.
 *
 * @param value - JSON-safe value to canonicalize
 * @returns A new value with canonically ordered keys throughout
 */
function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  if (isPlainObject(value)) {
    const sortedKeys = Object.keys(value).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalizeValue(value[key]);
    }
    return result;
  }
  return value;
}

/**
 * Canonical envelope spec: {@link EnvelopeFieldSpec} with the `states` default
 * (all four states) materialized as a required field.
 */
export interface CanonicalEnvelopeFieldSpec extends EnvelopeFieldSpec {
  /** Allowed states — always present in canonical form. */
  readonly states: readonly EnvelopeState[];
}

/**
 * Canonical manifest form: {@link ContractManifest} with the envelope `states`
 * default materialized.
 */
export interface CanonicalManifest extends ContractManifest {
  /** Envelope spec with materialized states. */
  readonly envelope: CanonicalEnvelopeFieldSpec;
}

/**
 * Produces the canonical form of a manifest: a deep copy with recursively
 * sorted object keys and the envelope `states` default (all four states)
 * materialized. Derivation and rendering operate exclusively on this form,
 * making them independent of the host's key insertion order.
 *
 * @param manifest - Manifest assumed structurally valid (validated by createContract)
 * @returns A canonicalized copy of the manifest
 */
export function canonicalizeManifest(manifest: ContractManifest): CanonicalManifest {
  const states: readonly EnvelopeState[] = Array.isArray(manifest.envelope.states)
    ? manifest.envelope.states.slice()
    : ENVELOPE_STATES.slice();
  const conditionalFields = manifest.envelope.conditionalFields
    ?.slice()
    .sort((left, right) => (left.field < right.field ? -1 : left.field > right.field ? 1 : 0))
    .map((field) => ({
      field: field.field,
      requiredForStates: field.requiredForStates.slice(),
      description: field.description
    }));
  const canonicalEnvelope: CanonicalEnvelopeFieldSpec = {
    states,
    ...(conditionalFields !== undefined ? { conditionalFields } : {})
  };
  return {
    envelope: canonicalEnvelope,
    payload: canonicalizeValue(manifest.payload) as JsonSchemaObject,
    ...(manifest.metadata !== undefined
      ? { metadata: canonicalizeValue(manifest.metadata) as Readonly<Record<string, string>> }
      : {})
  };
}

// ============================================================================
// Tool schema derivation
// ============================================================================

/**
 * Derives the JSON Schema describing the model's full envelope-with-payload
 * final answer shape from a manifest.
 *
 * Structure: `state` (string enum of the manifest's states), one property per
 * declared conditional field, and `payload` (the host payload schema) present
 * iff `'proposal'` is an allowed state. Conditional requirements are stated in
 * each property's `description` — the pragmatic JSON Schema subset used by the
 * harness has no `if`/`then`, and the prompt contract carries the exact rules.
 *
 * Pure and deterministic: canonicalized manifest in, stable schema out.
 *
 * @param manifest - Manifest (assumed valid; see createContract)
 * @returns A JSON Schema object for the complete model output
 */
export function deriveToolSchema(manifest: ContractManifest): JsonSchemaObject {
  const canonical = canonicalizeManifest(manifest);
  const states = canonical.envelope.states;
  const conditionalFields = canonical.envelope.conditionalFields ?? [];

  const properties: Record<string, JsonSchema> = {
    state: {
      type: 'string',
      enum: states.slice(),
      description: `Response state. One of: ${states.map((s) => `'${s}'`).join(', ')}.`
    }
  };

  for (const conditionalField of conditionalFields) {
    const known = (KNOWN_ENVELOPE_CONDITIONAL_FIELDS as readonly string[]).includes(
      conditionalField.field
    );
    const schema: Record<string, unknown> = {
      description:
        conditionalField.description ??
        `Required when state is ${conditionalField.requiredForStates.map((s) => `'${s}'`).join(' or ')}.`
    };
    if (known) {
      schema.type = 'string';
    }
    properties[conditionalField.field] = schema as JsonSchema;
  }

  const required: string[] = ['state'];
  if (states.indexOf('proposal') >= 0) {
    properties.payload = canonical.payload;
    required.push('payload');
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
    description: 'Agent response envelope. Conditional field rules are stated per property.'
  };
}

// ============================================================================
// Prompt contract rendering
// ============================================================================

/**
 * Renders a schema node's type as a compact human-readable phrase, e.g.
 * `string`, `array of object`, or `any`.
 */
function describeType(schema: JsonSchema): string {
  const declaredType: unknown = schema.type;
  if (declaredType === 'array') {
    const items = schema.items;
    return items === undefined ? 'array' : `array of ${describeType(items)}`;
  }
  return typeof declaredType === 'string' ? declaredType : 'any';
}

/**
 * Appends enum membership to a type phrase when the schema declares `enum`.
 */
function describeEnum(schema: JsonSchema, typePhrase: string): string {
  const allowedValues = schema.enum;
  if (allowedValues === undefined || allowedValues.length === 0) {
    return typePhrase;
  }
  const rendered = allowedValues.map((value) => `'${String(value)}'`).join(' | ');
  return `${typePhrase} (one of: ${rendered})`;
}

/**
 * True when the schema node is an object schema carrying named properties.
 */
function isObjectSchema(schema: JsonSchema): boolean {
  return schema.type === 'object' && schema.properties !== undefined;
}

/**
 * True when the schema node is an array schema with an item schema.
 */
function isArraySchema(schema: JsonSchema): boolean {
  return schema.type === 'array' && schema.items !== undefined;
}

/**
 * Renders one schema node's properties (and array item properties) as
 * markdown bullet lines, recursing with deeper indentation.
 *
 * @param schema - Object schema whose `properties` are rendered
 * @param indent - Current indentation prefix (two spaces per level)
 * @param lines - Output line accumulator
 */
function renderPropertyLines(
  schema: JsonSchema,
  indent: string,
  lines: string[]
): void {
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  for (const name of Object.keys(properties)) {
    const propertySchema = properties[name];
    if (propertySchema === undefined) {
      continue;
    }
    const isRequired = required.indexOf(name) >= 0;
    const typePhrase = describeEnum(propertySchema, describeType(propertySchema));
    const description: unknown = propertySchema.description;
    const descriptionSuffix =
      typeof description === 'string' && description.length > 0 ? `: ${description}` : '';
    lines.push(
      `${indent}- \`${name}\` (${typePhrase}${isRequired ? ', required' : ''})${descriptionSuffix}`
    );
    if (isObjectSchema(propertySchema)) {
      renderPropertyLines(propertySchema, `${indent}  `, lines);
    } else if (isArraySchema(propertySchema)) {
      const items = propertySchema.items;
      if (items !== undefined && isObjectSchema(items)) {
        renderPropertyLines(items, `${indent}  `, lines);
      }
    }
  }
}

/**
 * Renders the manifest's exact contract as markdown for the model prompt.
 *
 * The output states the envelope rules in prose (state enum, conditional field
 * requirements, payload-iff-proposal) and renders the host payload schema as
 * readable nested markdown (property name, type, required marker,
 * description). Pure and deterministic: the same manifest yields a
 * byte-identical string, independent of key insertion order — this stability
 * is what record/replay hashes.
 *
 * @param manifest - Manifest (assumed valid; see createContract)
 * @returns The markdown contract text to embed in the prompt
 */
export function renderPromptContract(manifest: ContractManifest): string {
  const canonical = canonicalizeManifest(manifest);
  const states = canonical.envelope.states;
  const conditionalFields = canonical.envelope.conditionalFields ?? [];

  const lines: string[] = [
    '# Response Contract',
    '',
    'Your final answer must be a single JSON object with this exact shape.',
    '',
    '## Envelope fields',
    '',
    `- \`state\` (string, required): One of: ${states.map((s) => `'${s}'`).join(', ')}.`,
    `- \`payload\` (object): ${
      states.indexOf('proposal') >= 0
        ? 'Required when `state` is `proposal`. Must be absent for every other state.'
        : 'Must be absent — this contract does not use the `proposal` state.'
    }`
  ];

  for (const conditionalField of conditionalFields) {
    const known = (KNOWN_ENVELOPE_CONDITIONAL_FIELDS as readonly string[]).includes(
      conditionalField.field
    );
    const typePhrase = known ? 'string' : 'value';
    const stateList = conditionalField.requiredForStates.map((s) => `\`${s}\``).join(' or ');
    const descriptionSuffix =
      conditionalField.description !== undefined ? ` ${conditionalField.description}` : '';
    lines.push(
      `- \`${conditionalField.field}\` (${typePhrase}): Required when \`state\` is ${stateList}.${descriptionSuffix}`
    );
  }

  lines.push('', '## Payload (when `state` is `proposal`)', '');
  renderPropertyLines(canonical.payload, '', lines);

  return `${lines.join('\n')}\n`;
}
