/**
 * Behavior tests for {@link createContract}: manifest validation (typed
 * failures, never throws), derived artifacts, and the payload unknown-field
 * policy wrapper.
 */

import { describe, expect, it } from 'vitest';
import type { EnvelopePayloadValidator, PayloadResult } from '../envelope/envelope';
import { createContract } from './contract';
import type { ContractManifest } from './manifest';
import { renderPromptContract } from './derive';

/** Minimal valid manifest used as the base for mutations. */
const baseManifest: ContractManifest = {
  envelope: {
    states: ['proposal', 'question'],
    conditionalFields: [
      { field: 'questionText', requiredForStates: ['question'] }
    ]
  },
  payload: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      count: { type: 'integer' }
    },
    required: ['name']
  }
};

/** Test payload shape: whatever record passes the host validator. */
interface TestPayload {
  readonly [key: string]: unknown;
}

/** Host validator used in tests: accepts any plain object. */
const acceptObjects: EnvelopePayloadValidator<TestPayload> = (
  payload: unknown
): PayloadResult<TestPayload> => {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return { ok: true, value: payload as TestPayload };
  }
  return {
    ok: false,
    failure: { code: 'schema_invalid', message: 'Payload must be an object.' }
  };
};

/** Extracts the failure codes from a createContract result for assertions. */
function failureCodesOf(result: ReturnType<typeof createContract<TestPayload>>): string[] {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    return result.failures.map((failure) => failure.code);
  }
  return [];
}

describe('createContract — ok path', () => {
  it('creates a contract from a valid manifest', () => {
    const result = createContract(baseManifest, acceptObjects);
    expect(result.ok).toBe(true);
  });

  it('derives the tool schema from the manifest at creation', () => {
    const result = createContract(baseManifest, acceptObjects);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const properties = result.contract.toolSchema.properties;
      expect(properties).toBeDefined();
      if (properties !== undefined) {
        expect(properties.state).toBeDefined();
        expect(properties.payload).toEqual(baseManifest.payload);
      }
    }
  });

  it('memoizes the rendered prompt contract', () => {
    const result = createContract(baseManifest, acceptObjects);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const first = result.contract.renderPromptContract();
      const second = result.contract.renderPromptContract();
      expect(second).toBe(first);
      expect(first).toBe(renderPromptContract(baseManifest));
    }
  });

  it('stores a canonicalized manifest (envelope state default materialized)', () => {
    const result = createContract(
      { envelope: {}, payload: baseManifest.payload },
      acceptObjects
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.manifest.envelope.states).toEqual([
        'proposal',
        'question',
        'analysis',
        'infeasible'
      ]);
    }
  });
});

describe('createContract — invalid manifests return typed failures', () => {
  it('rejects a non-object payload schema', () => {
    const result = createContract(
      { envelope: {}, payload: { type: 'string' } as unknown as ContractManifest['payload'] },
      acceptObjects
    );
    expect(failureCodesOf(result)).toContain('payload_not_object_schema');
  });

  it('rejects an empty states array', () => {
    const result = createContract(
      { ...baseManifest, envelope: { states: [] } },
      acceptObjects
    );
    expect(failureCodesOf(result)).toContain('states_empty');
  });

  it('rejects an unknown state string', () => {
    const result = createContract(
      {
        ...baseManifest,
        envelope: { states: ['proposal', 'bogus' as unknown as 'question'] }
      },
      acceptObjects
    );
    expect(failureCodesOf(result)).toContain('state_not_envelope_state');
  });

  it('rejects duplicate states', () => {
    const result = createContract(
      { ...baseManifest, envelope: { states: ['proposal', 'proposal'] } },
      acceptObjects
    );
    expect(failureCodesOf(result)).toContain('duplicate_state');
  });

  it('rejects duplicate conditional field names', () => {
    const result = createContract(
      {
        ...baseManifest,
        envelope: {
          conditionalFields: [
            { field: 'questionText', requiredForStates: ['question'] },
            { field: 'questionText', requiredForStates: ['question'] }
          ]
        }
      },
      acceptObjects
    );
    expect(failureCodesOf(result)).toContain('duplicate_conditional_field');
  });

  it('collects multiple failures instead of throwing on the first', () => {
    const result = createContract(
      {
        envelope: { states: [] },
        payload: { type: 'number' } as unknown as ContractManifest['payload']
      },
      acceptObjects
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('createContract — payload unknown-field policy', () => {
  it('rejects unknown top-level payload keys by default', () => {
    let hostValidatorCalled = false;
    const trackingValidator: EnvelopePayloadValidator<TestPayload> = (
      payload: unknown
    ): PayloadResult<TestPayload> => {
      hostValidatorCalled = true;
      return acceptObjects(payload);
    };
    const result = createContract(baseManifest, trackingValidator);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payloadResult = result.contract.validateHostPayload({
        name: 'x',
        mystery: true
      });
      expect(payloadResult.ok).toBe(false);
      if (!payloadResult.ok) {
        expect(payloadResult.failure.code).toBe('schema_invalid');
        expect(payloadResult.failure.fieldPath).toBe('$.mystery');
      }
      expect(hostValidatorCalled).toBe(false);
    }
  });

  it('ignores unknown keys when the policy is ignore', () => {
    const result = createContract(baseManifest, acceptObjects, {
      payloadUnknownFieldPolicy: 'ignore'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payloadResult = result.contract.validateHostPayload({
        name: 'x',
        mystery: true
      });
      expect(payloadResult.ok).toBe(true);
    }
  });

  it('skips the unknown-key check when the payload schema declares no properties', () => {
    const result = createContract(
      { envelope: {}, payload: { type: 'object' } },
      acceptObjects
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.validateHostPayload({ anything: 1 }).ok).toBe(true);
    }
  });

  it('rejects payload keys that only exist on Object.prototype (own-property check)', () => {
    const result = createContract(baseManifest, acceptObjects);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payloadResult = result.contract.validateHostPayload({
        name: 'x',
        constructor: 'injected'
      });
      expect(payloadResult.ok).toBe(false);
      if (!payloadResult.ok) {
        expect(payloadResult.failure.code).toBe('schema_invalid');
        expect(payloadResult.failure.fieldPath).toBe('$.constructor');
      }
    }
  });

  it('delegates to the host validator for declared keys', () => {
    const result = createContract(baseManifest, acceptObjects);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payloadResult = result.contract.validateHostPayload({ name: 'x', count: 3 });
      expect(payloadResult.ok).toBe(true);
    }
  });
});
