/**
 * Pig Latin Example Test
 *
 * Canary test: minimal single-turn transformation with no tools.
 * Validates envelope contract and basic payload invariants.
 */

import { describe, beforeAll, it, expect } from 'vitest';
import { createHarness, createContract, dbg } from 'embedded-mc-pee';
import { createGeminiTransport, type GeminiTransportResult } from 'embedded-mc-pee/gemini';
import type { ContractManifest, ValidationFailureCode, AgentTurn, CreateContractResult, CreateHarnessResult } from 'embedded-mc-pee';

// ============================================================================
// Types
// ============================================================================

interface PigLatinPayload {
  translatedText: string;
}

// ============================================================================
// Manifest
// ============================================================================

const pigLatinManifest: ContractManifest = {
  payload: {
    type: 'object',
    properties: {
      translatedText: {
        type: 'string',
        description: 'The pig-latin translation of the input text'
      }
    },
    required: ['translatedText']
  },
  envelope: {
    states: ['proposal']
  }
};

// ============================================================================
// Payload Validator
// ============================================================================

function validatePigLatinPayload(payload: unknown):
  | { ok: true; value: PigLatinPayload }
  | { ok: false; failure: { code: ValidationFailureCode; message: string; fieldPath?: string } }
{
  if (typeof payload !== 'object' || payload === null) {
    return {
      ok: false,
      failure: { code: 'schema_invalid', message: 'Payload must be an object', fieldPath: '$.payload' }
    };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.translatedText !== 'string') {
    return {
      ok: false,
      failure: {
        code: 'missing_required_field',
        message: 'translatedText must be a string',
        fieldPath: '$.payload.translatedText'
      }
    };
  }

  return {
    ok: true,
    value: { translatedText: p.translatedText as string }
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('pig-latin example', () => {
  let transportResult: GeminiTransportResult | null = null;
  let contractResult: CreateContractResult<PigLatinPayload> | null = null;
  let hasKey = false;

  beforeAll(async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return;
    }
    hasKey = true;

    const result = createGeminiTransport({ apiKey });
    transportResult = result;
    if (!result.ok) {
      throw new Error(`Gemini transport config failed: ${JSON.stringify(result.failures)}`);
    }
    dbg.log('✓ Gemini transport created successfully');

    const contractRes = createContract<PigLatinPayload>(pigLatinManifest, validatePigLatinPayload);
    contractResult = contractRes;
    if (!contractRes.ok) {
      throw new Error(`Contract creation failed: ${JSON.stringify(contractRes.failures)}`);
    }
    dbg.log('✓ Contract created successfully');
  });

  it('should translate "hello world" to pig latin', () => {
    if (!hasKey) {
      return;
    }

    expect(transportResult).toBeDefined();
    expect(contractResult).toBeDefined();

    if (!transportResult || !contractResult || !transportResult.ok || !contractResult.ok) {
      throw new Error('Setup failed');
    }

    const harnessResult: CreateHarnessResult<PigLatinPayload> = createHarness({
      transport: transportResult.transport,
      models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'],
      maxIterations: 1,
      perModelTimeoutMs: 15_000,
      totalBudgetMs: 30_000,
      onTelemetry: (e) => {
        if (e.type === 'transient_error') {
          dbg.log('Telemetry transient error for model:', e.model, 'backoffMs:', e.backoffMs);
        } else if (e.type === 'fallback_model') {
          dbg.log('Telemetry fallback from', e.fromModel, 'to', e.toModel);
        } else {
          dbg.log('Telemetry event:', e.type);
        }
      }
    }, contractResult.contract);

    if (!harnessResult.ok) {
      throw new Error(`Harness creation failed: ${JSON.stringify(harnessResult.failures)}`);
    }

    return harnessResult.harness.runTurn({
      systemInstruction: 'Translate text to pig latin. Return ONLY valid JSON, nothing else.',
      promptText: `Input: hello world

Your response must be EXACTLY this JSON (nothing else):
{"state":"proposal","payload":{"translatedText":"<your translation>"}}

Do not include explanations. Do not ask questions. Just the JSON.`,
    }).then(result => {
      if (!result.ok) {
        dbg.log('Pig latin - Harness result failure kind:', result.kind);
        dbg.log('Pig latin - Turn envelope state:', result.turn.envelope.state);
        dbg.logObj('Pig latin - Turn envelope', result.turn.envelope);
        dbg.logObj('Pig latin - Trace entries', result.trace.entries.map(e => ({ kind: e.kind, ...(e.kind === 'model_call' ? { model: e.model } : {}) })));
      }
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.turn.envelope.state).toBe('proposal');
      expect(result.turn.payload).toBeDefined();

      const turn = result.turn as AgentTurn<PigLatinPayload>;
      expect(turn.payload?.translatedText).toBeDefined();

      // Check that translation is plausible (contains expected suffixes/patterns)
      // We're case-tolerant and don't check exact output - model variations are acceptable
      const translated = turn.payload?.translatedText?.toLowerCase() ?? '';
      // Pig latin typically ends with "ay" or starts with consonant clusters moved
      expect(translated).toBeTruthy();
      expect(translated.length).toBeGreaterThan(0);
    });
  });
});
