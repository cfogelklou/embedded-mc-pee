/**
 * Tests for envelope types.
 *
 * Behavior-focused tests for type contracts, state discrimination,
 * and conditional field requirements.
 */

import { describe, it, expect } from 'vitest';
import type {
  AgentEnvelope,
  AgentTurn,
  EnvelopeState,
  ValidationFailure,
  PayloadResult,
  TurnResult
} from './envelope';

describe('Envelope Types', () => {
  describe('EnvelopeState', () => {
    it('should accept all valid state values', () => {
      const validStates: EnvelopeState[] = ['proposal', 'question', 'analysis', 'infeasible'];

      validStates.forEach(state => {
        const envelope: AgentEnvelope = { state };
        expect(envelope.state).toBe(state);
      });
    });

    it('should reject invalid state values at type level', () => {
      // @ts-expect-error - invalid state should fail type check
      const invalid: AgentEnvelope = { state: 'invalid' };
      expect(invalid).toBeDefined();
    });
  });

  describe('AgentEnvelope', () => {
    it('should create minimal envelope with only state', () => {
      const envelope: AgentEnvelope = { state: 'proposal' };
      expect(envelope.state).toBe('proposal');
      expect(envelope.questionText).toBeUndefined();
      expect(envelope.explanation).toBeUndefined();
    });

    it('should create envelope with all fields', () => {
      const envelope: AgentEnvelope = {
        state: 'analysis',
        explanation: 'Test explanation',
        questionText: 'Test question'
      };

      expect(envelope.state).toBe('analysis');
      expect(envelope.explanation).toBe('Test explanation');
      expect(envelope.questionText).toBe('Test question');
    });

    it('should allow both questionText and explanation to be set', () => {
      const envelope: AgentEnvelope = {
        state: 'analysis',
        explanation: 'Analysis explanation',
        questionText: 'Optional question'
      };

      expect(envelope.questionText).toBe('Optional question');
      expect(envelope.explanation).toBe('Analysis explanation');
    });
  });

  describe('AgentTurn', () => {
    it('should create turn without payload for non-proposal states', () => {
      const turn: AgentTurn<string> = {
        envelope: { state: 'question', questionText: 'What?' }
      };

      expect(turn.envelope.state).toBe('question');
      expect(turn.payload).toBeUndefined();
    });

    it('should create turn with payload for proposal state', () => {
      interface TestPayload {
        data: string;
      }

      const turn: AgentTurn<TestPayload> = {
        envelope: { state: 'proposal' },
        payload: { data: 'test' }
      };

      expect(turn.envelope.state).toBe('proposal');
      expect(turn.payload).toEqual({ data: 'test' });
    });

    it('should allow optional payload even for proposal state', () => {
      const turn: AgentTurn<string> = {
        envelope: { state: 'proposal' }
      };

      expect(turn.envelope.state).toBe('proposal');
      expect(turn.payload).toBeUndefined();
    });
  });

  describe('ValidationFailure', () => {
    it('should create minimal validation failure', () => {
      const failure: ValidationFailure = {
        code: 'malformed_json',
        message: 'Test message'
      };

      expect(failure.code).toBe('malformed_json');
      expect(failure.message).toBe('Test message');
      expect(failure.fieldPath).toBeUndefined();
    });

    it('should create validation failure with field path', () => {
      const failure: ValidationFailure = {
        code: 'non_finite_value',
        message: 'Non-finite value',
        fieldPath: '$.payload.field'
      };

      expect(failure.code).toBe('non_finite_value');
      expect(failure.fieldPath).toBe('$.payload.field');
    });

    it('should accept all valid failure codes', () => {
      const codes: ValidationFailure['code'][] = [
        'malformed_json',
        'schema_invalid',
        'non_finite_value',
        'missing_required_field',
        'invalid_enum',
        'payload_missing',
        'payload_unexpected'
      ];

      codes.forEach(code => {
        const failure: ValidationFailure = {
          code,
          message: 'Test'
        };
        expect(failure.code).toBe(code);
      });
    });
  });

  describe('PayloadResult', () => {
    it('should represent successful validation', () => {
      const result: PayloadResult<string> = {
        ok: true,
        value: 'test payload'
      };

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('test payload');
      }
    });

    it('should represent validation failure', () => {
      const result: PayloadResult<string> = {
        ok: false,
        failure: {
          code: 'schema_invalid',
          message: 'Invalid schema'
        }
      };

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('schema_invalid');
      }
    });
  });

  describe('TurnResult', () => {
    it('should represent successful turn validation', () => {
      const envelope: AgentEnvelope = { state: 'proposal' };
      const result: TurnResult<string> = {
        ok: true,
        value: {
          envelope,
          payload: 'test'
        }
      };

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.envelope).toEqual(envelope);
        expect(result.value.payload).toBe('test');
      }
    });

    it('should represent turn validation failure', () => {
      const result: TurnResult<string> = {
        ok: false,
        failure: {
          code: 'invalid_enum',
          message: 'Invalid state'
        }
      };

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('invalid_enum');
      }
    });
  });
});
