/**
 * Tests for envelope validation logic.
 *
 * Comprehensive tests for all validation branches, error conditions,
 * and successful paths through validateEnvelopeOutput.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateEnvelopeOutput } from './validate';
import type { EnvelopeState, PayloadResult } from './envelope';

describe('validateEnvelopeOutput', () => {
  // Reset mocks before each test to avoid pollution
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Mock payload validator factories
  const createMockSuccessValidator = (returnValue: string = 'valid-payload'): ReturnType<typeof vi.fn> => vi.fn((): PayloadResult<string> => ({
    ok: true,
    value: returnValue
  }));

  const createMockFailureValidator = (): ReturnType<typeof vi.fn> => vi.fn((): PayloadResult<string> => ({
    ok: false,
    failure: {
      code: 'schema_invalid',
      message: 'Invalid payload structure',
      fieldPath: '$.payload.field'
    }
  }));

  describe('Malformed Input Detection', () => {
    it('should reject null input', () => {
      const result = validateEnvelopeOutput(null, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('malformed_json');
        expect(result.failure.fieldPath).toBe('$');
      }
    });

    it('should reject array input', () => {
      const result = validateEnvelopeOutput([], createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('malformed_json');
      }
    });

    it('should reject string input', () => {
      const result = validateEnvelopeOutput('string', createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('malformed_json');
      }
    });

    it('should reject number input', () => {
      const result = validateEnvelopeOutput(42, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('malformed_json');
      }
    });

    it('should reject boolean input', () => {
      const result = validateEnvelopeOutput(true, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('malformed_json');
      }
    });
  });

  describe('JSON-Safety Validation', () => {
    it('should reject NaN values', () => {
      const input = {
        state: 'proposal',
        payload: 'test',
        value: NaN
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('non_finite_value');
        expect(result.failure.message).toContain('NaN');
      }
    });

    it('should reject Infinity values', () => {
      const input = {
        state: 'proposal',
        payload: 'test',
        value: Infinity
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('non_finite_value');
        expect(result.failure.message).toContain('Infinity');
      }
    });

    it('should reject -Infinity values', () => {
      const input = {
        state: 'proposal',
        payload: 'test',
        value: -Infinity
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('non_finite_value');
        expect(result.failure.message).toContain('-Infinity');
      }
    });

    it('should reject nested non-finite values', () => {
      const input = {
        state: 'proposal',
        payload: 'test',
        nested: {
          deep: {
            value: NaN
          }
        }
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('non_finite_value');
        expect(result.failure.fieldPath).toBe('$.nested.deep.value');
      }
    });

    it('should accept finite numbers', () => {
      const input = {
        state: 'proposal',
        payload: 'test',
        integer: 42,
        float: 3.14,
        negative: -123,
        zero: 0
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(true);
    });
  });

  describe('State Enum Validation', () => {
    it('should accept all valid state values', () => {
      // Test each state individually with required conditional fields
      const testState = (state: EnvelopeState): void => {
        const input = state === 'proposal'
          ? { state, payload: 'test' }
          : state === 'question'
          ? { state, questionText: 'Question?' }
          : { state, explanation: 'Explanation' };

        // Create validator that echoes the input payload
        const echoValidator = vi.fn((payload: unknown): PayloadResult<string> => ({
          ok: true,
          value: payload as string
        }));

        const result = validateEnvelopeOutput(input, echoValidator);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.envelope.state).toBe(state);
        }
      };

      // Test each state
      testState('proposal');
      testState('question');
      testState('analysis');
      testState('infeasible');
    });

    it('should reject invalid state string', () => {
      const input = { state: 'invalid' };
      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('invalid_enum');
        expect(result.failure.fieldPath).toBe('$.state');
        expect(result.failure.message).toContain('invalid');
      }
    });

    it('should reject missing state field', () => {
      const input = {};
      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('invalid_enum');
        expect(result.failure.fieldPath).toBe('$.state');
      }
    });

    it('should reject non-string state value', () => {
      const input = { state: 123 };
      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('invalid_enum');
      }
    });
  });

  describe('Conditional Field Requirements', () => {
    describe('Question state', () => {
      it('should require questionText for question state', () => {
        const input = { state: 'question' };
        const result = validateEnvelopeOutput(input, createMockSuccessValidator());

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('missing_required_field');
          expect(result.failure.fieldPath).toBe('$.questionText');
          expect(result.failure.message).toContain('questionText');
          expect(result.failure.message).toContain('question');
        }
      });

      it('should accept question state with questionText', () => {
        const input = { state: 'question', questionText: 'What is your name?' };
        const result = validateEnvelopeOutput(input, createMockSuccessValidator());

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.envelope.questionText).toBe('What is your name?');
        }
      });

      it('should accept question state with optional fields', () => {
        const input = {
          state: 'question',
          questionText: 'Question?',
          explanation: 'Optional explanation'
        };
        const result = validateEnvelopeOutput(input, createMockSuccessValidator());

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.envelope.questionText).toBe('Question?');
          expect(result.value.envelope.explanation).toBe('Optional explanation');
        }
      });
    });

    describe('Analysis state', () => {
      it('should require explanation for analysis state', () => {
        const input = { state: 'analysis' };
        const result = validateEnvelopeOutput(input, createMockSuccessValidator());

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('missing_required_field');
          expect(result.failure.fieldPath).toBe('$.explanation');
          expect(result.failure.message).toContain('explanation');
          expect(result.failure.message).toContain('analysis');
        }
      });

      it('should accept analysis state with explanation', () => {
        const input = {
          state: 'analysis',
          explanation: 'Analysis details here'
        };
        const result = validateEnvelopeOutput(input, createMockSuccessValidator());

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.envelope.explanation).toBe('Analysis details here');
        }
      });
    });

    describe('Infeasible state', () => {
      it('should require explanation for infeasible state', () => {
        const input = { state: 'infeasible' };
        const result = validateEnvelopeOutput(input, createMockSuccessValidator());

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe('missing_required_field');
          expect(result.failure.fieldPath).toBe('$.explanation');
          expect(result.failure.message).toContain('explanation');
          expect(result.failure.message).toContain('infeasible');
        }
      });

      it('should accept infeasible state with explanation', () => {
        const input = {
          state: 'infeasible',
          explanation: 'Cannot be done'
        };
        const result = validateEnvelopeOutput(input, createMockSuccessValidator());

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.envelope.explanation).toBe('Cannot be done');
        }
      });
    });

    describe('Proposal state', () => {
      it('should accept proposal state without conditional text fields', () => {
        const input = {
          state: 'proposal',
          payload: 'test'
        };
        const result = validateEnvelopeOutput(input, createMockSuccessValidator());

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.envelope.state).toBe('proposal');
          expect(result.value.envelope.questionText).toBeUndefined();
          expect(result.value.envelope.explanation).toBeUndefined();
        }
      });

      it('should accept proposal state with optional fields', () => {
        const input = {
          state: 'proposal',
          payload: 'test',
          explanation: 'Optional explanation is allowed'
        };
        const result = validateEnvelopeOutput(input, createMockSuccessValidator());

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.envelope.explanation).toBe('Optional explanation is allowed');
        }
      });
    });
  });

  describe('Payload Presence Validation', () => {
    it('should require payload for proposal state', () => {
      const input = { state: 'proposal' };
      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('payload_missing');
        expect(result.failure.fieldPath).toBe('$.payload');
        expect(result.failure.message).toContain('payload');
        expect(result.failure.message).toContain('proposal');
      }
    });

    it('should reject payload for question state', () => {
      const input = {
        state: 'question',
        questionText: 'What?',
        payload: 'unexpected'
      };
      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('payload_unexpected');
        expect(result.failure.fieldPath).toBe('$.payload');
        expect(result.failure.message).toContain('payload');
        expect(result.failure.message).toContain('proposal');
      }
    });

    it('should reject payload for analysis state', () => {
      const input = {
        state: 'analysis',
        explanation: 'Analysis',
        payload: 'unexpected'
      };
      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('payload_unexpected');
      }
    });

    it('should reject payload for infeasible state', () => {
      const input = {
        state: 'infeasible',
        explanation: 'Not possible',
        payload: 'unexpected'
      };
      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('payload_unexpected');
      }
    });

    it('should accept null as missing payload', () => {
      const input = {
        state: 'proposal',
        payload: null
      };
      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('payload_missing');
      }
    });

    it('should accept undefined as missing payload', () => {
      const input = {
        state: 'proposal',
        payload: undefined
      };
      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('payload_missing');
      }
    });
  });

  describe('Payload Validator Integration', () => {
    it('should call payloadValidator when payload present', () => {
      const input = {
        state: 'proposal',
        payload: 'test-payload'
      };

      const mockValidator = createMockSuccessValidator();
      validateEnvelopeOutput(input, mockValidator);

      expect(mockValidator).toHaveBeenCalledWith('test-payload');
    });

    it('should propagate successful payload validation', () => {
      const input = {
        state: 'proposal',
        payload: 'valid-payload'
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.payload).toBe('valid-payload');
      }
    });

    it('should propagate failed payload validation', () => {
      const input = {
        state: 'proposal',
        payload: 'invalid-payload'
      };

      const result = validateEnvelopeOutput(input, createMockFailureValidator());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('schema_invalid');
        expect(result.failure.message).toBe('Invalid payload structure');
        expect(result.failure.fieldPath).toBe('$.payload.field');
      }
    });

    it('should not call payloadValidator for non-proposal states', () => {
      const input = {
        state: 'question',
        questionText: 'What?'
      };

      validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(createMockSuccessValidator()).not.toHaveBeenCalled();
    });
  });

  describe('Envelope Construction', () => {
    it('should build valid envelope for question state', () => {
      const input = {
        state: 'question',
        questionText: 'What is your name?'
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.envelope.state).toBe('question');
        expect(result.value.envelope.questionText).toBe('What is your name?');
        expect(result.value.payload).toBeUndefined();
      }
    });

    it('should build valid envelope for analysis state', () => {
      const input = {
        state: 'analysis',
        explanation: 'Analysis complete'
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.envelope.state).toBe('analysis');
        expect(result.value.envelope.explanation).toBe('Analysis complete');
      }
    });

    it('should build valid envelope for infeasible state', () => {
      const input = {
        state: 'infeasible',
        explanation: 'Cannot complete'
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.envelope.state).toBe('infeasible');
        expect(result.value.envelope.explanation).toBe('Cannot complete');
      }
    });

    it('should build valid turn for proposal state', () => {
      const input = {
        state: 'proposal',
        payload: 'proposal-data'
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator('proposal-data'));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.envelope.state).toBe('proposal');
        expect(result.value.payload).toBe('proposal-data');
      }
    });

    it('should omit payload key for non-proposal states', () => {
      // Test each non-proposal state
      const nonProposalStates: Array<EnvelopeState> = ['question', 'analysis', 'infeasible'];

      for (const state of nonProposalStates) {
        const input = state === 'question'
          ? { state, questionText: 'Test question?' }
          : { state, explanation: 'Test explanation' };

        const result = validateEnvelopeOutput(input, createMockSuccessValidator());

        expect(result.ok).toBe(true);
        if (result.ok) {
          // Payload key should not exist at all for non-proposal states
          expect('payload' in result.value).toBe(false);
          expect(Object.keys(result.value)).not.toContain('payload');
          expect(result.value.payload).toBeUndefined();
        }
      }
    });

    it('should include payload key only for proposal state', () => {
      const input = {
        state: 'proposal' as const,
        payload: 'test-payload'
      };

      const result = validateEnvelopeOutput(input, createMockSuccessValidator('test-payload'));

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Payload key should exist for proposal state
        expect('payload' in result.value).toBe(true);
        expect(Object.keys(result.value)).toContain('payload');
        expect(result.value.payload).toBe('test-payload');
      }
    });
  });
});
