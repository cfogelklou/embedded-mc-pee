/**
 * Behavior tests for the deterministic manifest derivations:
 * {@link deriveToolSchema} and {@link renderPromptContract}.
 *
 * Assertions target structure and stability — never prose formatting beyond
 * what the contract semantics guarantee (state names, property names,
 * required markers).
 */

import { describe, expect, it } from 'vitest';
import type { EnvelopeState } from '../envelope/envelope';
import { ENVELOPE_STATES } from '../envelope/envelope';
import { deriveToolSchema, renderPromptContract } from './derive';
import type { ContractManifest } from './manifest';
import type { JsonSchema, JsonSchemaObject } from '../tool/toolContract';

/** Narrows a derived tool schema's properties map (always present by construction). */
function propertiesOf(
  schema: JsonSchemaObject
): { readonly [propertyName: string]: JsonSchema | undefined } {
  if (schema.properties === undefined) {
    throw new Error('derived tool schema must declare properties');
  }
  return schema.properties;
}

/** A representative valid manifest used across derive tests. */
const sampleManifest: ContractManifest = {
  envelope: {
    states: ENVELOPE_STATES.slice(),
    conditionalFields: [
      {
        field: 'questionText',
        requiredForStates: ['question'],
        description: 'The question to ask the user.'
      },
      { field: 'explanation', requiredForStates: ['analysis', 'infeasible'] }
    ]
  },
  payload: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'update'],
        description: 'Action to perform.'
      },
      venue: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          capacity: { type: 'integer' }
        },
        required: ['id']
      },
      tags: { type: 'array', items: { type: 'string' } }
    },
    required: ['action']
  },
  metadata: { version: '1' }
};

/** The same manifest content with every object's keys inserted in a different order. */
const reorderedManifest: ContractManifest = {
  metadata: { version: '1' },
  payload: {
    required: ['action'],
    properties: {
      tags: { items: { type: 'string' }, type: 'array' },
      venue: {
        required: ['id'],
        properties: { capacity: { type: 'integer' }, id: { type: 'string' } },
        type: 'object'
      },
      action: {
        description: 'Action to perform.',
        enum: ['create', 'update'],
        type: 'string'
      }
    },
    type: 'object'
  },
  envelope: {
    conditionalFields: [
      { requiredForStates: ['analysis', 'infeasible'], field: 'explanation' },
      {
        description: 'The question to ask the user.',
        requiredForStates: ['question'],
        field: 'questionText'
      }
    ],
    states: ENVELOPE_STATES.slice()
  }
};

describe('deriveToolSchema', () => {
  it('derives the state enum from the manifest states', () => {
    const schema = deriveToolSchema(sampleManifest);
    expect(schema.type).toBe('object');
    const stateSchema = propertiesOf(schema).state;
    expect(stateSchema).toBeDefined();
    expect(stateSchema?.enum).toEqual([
      'proposal',
      'question',
      'analysis',
      'infeasible'
    ]);
  });

  it('defaults to all four states when none are declared', () => {
    const manifest: ContractManifest = {
      envelope: {},
      payload: { type: 'object', properties: { a: { type: 'string' } } }
    };
    const schema = deriveToolSchema(manifest);
    expect(propertiesOf(schema).state?.enum).toEqual([...ENVELOPE_STATES]);
  });

  it('declares conditional fields as envelope properties', () => {
    const properties = propertiesOf(deriveToolSchema(sampleManifest));
    expect(properties.questionText).toBeDefined();
    expect(properties.explanation).toBeDefined();
  });

  it('requires payload iff proposal is an allowed state', () => {
    const withProposal = deriveToolSchema(sampleManifest);
    expect(withProposal.required).toContain('state');
    expect(withProposal.required).toContain('payload');
    expect(propertiesOf(withProposal).payload).toEqual(sampleManifest.payload);

    const statesWithoutProposal: readonly EnvelopeState[] = ['question', 'analysis'];
    const withoutProposal = deriveToolSchema({
      envelope: { states: statesWithoutProposal },
      payload: sampleManifest.payload
    });
    expect(withoutProposal.required).toEqual(['state']);
    expect(propertiesOf(withoutProposal).payload).toBeUndefined();
  });

  it('is deterministic: two calls deep-equal', () => {
    expect(deriveToolSchema(sampleManifest)).toEqual(deriveToolSchema(sampleManifest));
  });

  it('is insertion-order independent', () => {
    expect(JSON.stringify(deriveToolSchema(reorderedManifest))).toBe(
      JSON.stringify(deriveToolSchema(sampleManifest))
    );
  });
});

describe('renderPromptContract', () => {
  const rendered: string = renderPromptContract(sampleManifest);

  it('names all four envelope states', () => {
    for (const state of ENVELOPE_STATES) {
      expect(rendered).toContain(state);
    }
  });

  it('renders payload property names at every nesting level', () => {
    expect(rendered).toContain('`action`');
    expect(rendered).toContain('`venue`');
    expect(rendered).toContain('`id`');
    expect(rendered).toContain('`capacity`');
    expect(rendered).toContain('`tags`');
  });

  it('marks required properties', () => {
    expect(rendered).toContain('`action` (string (one of: \'create\' | \'update\'), required)');
    expect(rendered).toContain('`id` (string, required)');
  });

  it('renders descriptions', () => {
    expect(rendered).toContain('Action to perform.');
  });

  it('is deterministic: two calls are byte-identical', () => {
    expect(renderPromptContract(sampleManifest)).toBe(rendered);
  });

  it('is insertion-order independent', () => {
    expect(renderPromptContract(reorderedManifest)).toBe(rendered);
  });

  it('renders a stable snapshot', () => {
    expect(rendered).toMatchInlineSnapshot(`
      "# Response Contract

      Your final answer must be a single JSON object with this exact shape.

      ## Envelope fields

      - \`state\` (string, required): One of: 'proposal', 'question', 'analysis', 'infeasible'.
      - \`payload\` (object): Required when \`state\` is \`proposal\`. Must be absent for every other state.
      - \`explanation\` (string): Required when \`state\` is \`analysis\` or \`infeasible\`.
      - \`questionText\` (string): Required when \`state\` is \`question\`. The question to ask the user.

      ## Payload (when \`state\` is \`proposal\`)

      - \`action\` (string (one of: 'create' | 'update'), required): Action to perform.
      - \`tags\` (array of string)
      - \`venue\` (object)
        - \`capacity\` (integer)
        - \`id\` (string, required)
      "
    `);
  });
});
