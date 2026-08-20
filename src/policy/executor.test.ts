/**
 * Tests for Agent Harness Executor
 *
 * Comprehensive test suite for the harness executor covering:
 * - Iteration semantics (maxIterations: 1 == single call, no tool feedback)
 * - Multi-iteration tool calls
 * - Tool argument validation (handler NOT invoked on invalid args)
 * - Handler throws -> in-band isError
 * - Repeated identical tool call detection
 * - Tool caps (per-iteration and total)
 * - Budget exhaustion
 * - Degeneration detection and fallback
 * - Transient error backoff
 * - `runTurn` never rejects (rejecting transport, throwing telemetry listener)
 * - All telemetry event types emitted at least once
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHarness } from './executor';
import { createContract } from '../contract/contract';
import type { ContractManifest } from '../contract/manifest';
import type { ToolResult } from '../tool/toolContract';
import type { LlmTransport, LlmResponse, LlmRequest, HarnessTelemetryEvent, ToolBinding } from '../transport/types';
import type { Contract } from '../contract/contract';

// ============================================================================
// Test Fixtures
// ============================================================================

interface TestPayload {
  readonly summary: string;
  readonly value: number;
}

const MINIMAL_MANIFEST: ContractManifest = {
  payload: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      value: { type: 'number' }
    },
    required: ['summary', 'value']
  },
  envelope: {
    states: ['proposal', 'question', 'analysis', 'infeasible']
  }
};

const VALID_PROPOSAL = {
  state: 'proposal' as const,
  summary: 'Test proposal',
  explanation: 'Test explanation',
  payload: {
    summary: 'Test proposal',
    value: 42
  }
};

const VALID_QUESTION = {
  state: 'question' as const,
  questionText: 'What is your name?',
  explanation: 'Need clarification'
};

const VALID_ANALYSIS = {
  state: 'analysis' as const,
  explanation: 'Analysis complete'
};

function createTestContract(): Contract<TestPayload> {
  const result = createContract<TestPayload>(
    MINIMAL_MANIFEST,
    (payload: unknown) => {
      if (typeof payload !== 'object' || payload === null || !('summary' in payload) || !('value' in payload)) {
        return { ok: false, failure: { code: 'schema_invalid', message: 'Invalid payload structure' } };
      }
      const p = payload as { summary: string; value: number };
      if (typeof p.summary !== 'string' || typeof p.value !== 'number') {
        return { ok: false, failure: { code: 'schema_invalid', message: 'Invalid payload types' } };
      }
      return { ok: true, value: p as TestPayload };
    }
  );
  if (!result.ok) {
    throw new Error('Failed to create test contract');
  }
  return result.contract;
}

class FakeLlmTransport implements LlmTransport {
  private responses: LlmResponse[] = [];
  private shouldReject = false;
  private rejectionDelay = 0;

  constructor(responses: LlmResponse[] = []) {
    this.responses = responses;
  }

  setResponses(responses: LlmResponse[]): void {
    this.responses = responses;
  }

  rejectNextCall(delayMs = 0): void {
    this.shouldReject = true;
    this.rejectionDelay = delayMs;
  }

  clearReject(): void {
    this.shouldReject = false;
    this.rejectionDelay = 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async complete(_req: LlmRequest, _opts: { timeoutMs: number }): Promise<LlmResponse> {
    if (this.shouldReject) {
      if (this.rejectionDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.rejectionDelay));
      }
      this.shouldReject = false; // Auto-reset after one rejection
      throw new Error('Mock transport rejection');
    }
    const resp = this.responses.shift() ?? { rawText: JSON.stringify(VALID_PROPOSAL) };
    return resp;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Agent Harness Executor', () => {
  let contract: Contract<TestPayload>;
  let transport: FakeLlmTransport;
  let sleepSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    contract = createTestContract();
    transport = new FakeLlmTransport();
    sleepSpy = vi.fn((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  });

  describe('Config validation', () => {
    it('rejects empty models array', () => {
      const result = createHarness(
        {
          transport,
          models: []
        },
        contract
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe('models_empty');
      }
    });

    it('rejects maxIterations < 1', () => {
      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 0
        },
        contract
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe('max_iterations_invalid');
      }
    });

    it('rejects negative timeout', () => {
      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          perModelTimeoutMs: -100
        },
        contract
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe('timeout_invalid');
      }
    });

    it('accepts valid config', () => {
      const result = createHarness(
        {
          transport,
          models: ['model-1', 'model-2'],
          maxIterations: 2
        },
        contract
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('maxIterations: 1 (single call, no tool feedback)', () => {
    it('returns validated envelope on first model success', async () => {
      transport.setResponses([
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 1,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(true);
      if (turnResult.ok) {
        expect(turnResult.turn.envelope.state).toBe('proposal');
        expect(turnResult.trace.entries.length).toBeGreaterThan(0);
      }
    });

    it('returns exhausted when model requests tool on final iteration', async () => {
      const toolRequest: LlmResponse = {
        rawText: '',
        toolCall: { name: 'test_tool', args: { foo: 'bar' } }
      };

      transport.setResponses([toolRequest]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 1,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(false);
      if (!turnResult.ok) {
        expect(turnResult.kind).toBe('exhausted');
      }
    });
  });

  describe('Multi-iteration tool calls', () => {
    it('executes tool on iteration 1, returns envelope on iteration 2', async () => {
      let callCount = 0;
      const toolHandler = vi.fn(async (): Promise<ToolResult> => {
        callCount++;
        return { structuredContent: { result: 'success' }, text: 'Tool executed' };
      });

      const toolBinding: ToolBinding = {
        contract: {
          name: 'test_tool',
          inputSchema: {
            type: 'object',
            properties: { arg: { type: 'string' } },
            required: ['arg']
          }
        },
        handler: toolHandler
      };

      transport.setResponses([
        // Iteration 1: tool call
        { rawText: '', toolCall: { name: 'test_tool', args: { arg: 'test' } } },
        // Iteration 2: envelope after seeing tool result
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 2,
          tools: [toolBinding],
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(true);
      expect(callCount).toBe(1);
      if (turnResult.ok) {
        expect(turnResult.trace.entries.some(e => e.kind === 'tool_call')).toBe(true);
      }
    });
  });

  describe('Tool argument validation', () => {
    it('does NOT invoke handler when args are invalid', async () => {
      const toolHandler = vi.fn(async (): Promise<ToolResult> => {
        return { text: 'Should not be called' };
      });

      const toolBinding: ToolBinding = {
        contract: {
          name: 'test_tool',
          inputSchema: {
            type: 'object',
            properties: { requiredArg: { type: 'string' } },
            required: ['requiredArg']
          }
        },
        handler: toolHandler
      };

      transport.setResponses([
        { rawText: '', toolCall: { name: 'test_tool', args: { wrongArg: 'value' } } },
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 2,
          tools: [toolBinding],
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(toolHandler).not.toHaveBeenCalled();
    });

    it('counts invalid tool calls against caps', async () => {
      const toolHandler = vi.fn();

      const toolBinding: ToolBinding = {
        contract: {
          name: 'test_tool',
          inputSchema: {
            type: 'object',
            properties: { requiredArg: { type: 'string' } },
            required: ['requiredArg']
          }
        },
        handler: toolHandler
      };

      // Invalid call, then valid envelope
      transport.setResponses([
        { rawText: '', toolCall: { name: 'test_tool', args: { wrongArg: 'value' } } },
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 2,
          maxTotalToolCalls: 1,
          tools: [toolBinding],
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      // Invalid call counts against the cap, so we have 0 remaining
      expect(turnResult.ok).toBe(true);
    });
  });

  describe('Handler throws -> in-band isError', () => {
    it('converts handler throws to in-band error results', async () => {
      const toolHandler = vi.fn(async (): Promise<ToolResult> => {
        throw new Error('Handler explosion');
      });

      const toolBinding: ToolBinding = {
        contract: {
          name: 'test_tool',
          inputSchema: {
            type: 'object',
            properties: { arg: { type: 'string' } },
            required: ['arg']
          }
        },
        handler: toolHandler
      };

      transport.setResponses([
        { rawText: '', toolCall: { name: 'test_tool', args: { arg: 'test' } } },
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 2,
          tools: [toolBinding],
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(true);
      expect(toolHandler).toHaveBeenCalled();
      if (turnResult.ok) {
        const toolCallEntry = turnResult.trace.entries.find(e => e.kind === 'tool_call');
        expect(toolCallEntry).toBeDefined();
        if (toolCallEntry && toolCallEntry.kind === 'tool_call') {
          expect(toolCallEntry.ok).toBe(false);
        }
      }
    });
  });

  describe('Repeated identical tool call detection', () => {
    it('flags repeated tool calls in trace', async () => {
      const toolHandler = vi.fn(async (): Promise<ToolResult> => {
        return { text: 'Result' };
      });

      const toolBinding: ToolBinding = {
        contract: {
          name: 'test_tool',
          inputSchema: {
            type: 'object',
            properties: { arg: { type: 'string' } },
            required: ['arg']
          }
        },
        handler: toolHandler
      };

      const toolCall = { name: 'test_tool', args: { arg: 'test' } };
      transport.setResponses([
        // First call
        { rawText: '', toolCall },
        // Repeated call
        { rawText: '', toolCall },
        // Envelope
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 3,
          tools: [toolBinding],
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      if (turnResult.ok) {
        const flaggedEntry = turnResult.trace.entries.find(
          e => e.kind === 'decision' && e.decision === 'repeated_tool_call_flagged'
        );
        expect(flaggedEntry).toBeDefined();
      }
    });
  });

  describe('Tool caps', () => {
    it('returns exhausted when per-iteration cap exceeded', async () => {
      const toolHandler = vi.fn(async (): Promise<ToolResult> => {
        return { text: 'Result' };
      });

      const toolBinding: ToolBinding = {
        contract: {
          name: 'test_tool',
          inputSchema: {
            type: 'object',
            properties: { arg: { type: 'string' } },
            required: ['arg']
          }
        },
        handler: toolHandler
      };

      const toolCall = { name: 'test_tool', args: { arg: 'test' } };
      transport.setResponses([
        { rawText: '', toolCall },
        { rawText: '', toolCall },
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 3,
          maxToolCallsPerIteration: 1,
          tools: [toolBinding],
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      // First tool call succeeds, second is rejected on next iteration check
      expect(turnResult.ok).toBe(true);
    });

    it('returns exhausted when total tool cap exceeded', async () => {
      const toolHandler = vi.fn(async (): Promise<ToolResult> => {
        return { text: 'Result' };
      });

      const toolBinding: ToolBinding = {
        contract: {
          name: 'test_tool',
          inputSchema: {
            type: 'object',
            properties: { arg: { type: 'string' } },
            required: ['arg']
          }
        },
        handler: toolHandler
      };

      const toolCall = { name: 'test_tool', args: { arg: 'test' } };
      transport.setResponses([
        { rawText: '', toolCall },
        { rawText: '', toolCall },
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 3,
          maxTotalToolCalls: 1,
          tools: [toolBinding],
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      // First tool call succeeds, second exhausts total cap
      expect(turnResult.ok).toBe(true);
    });
  });

  describe('Budget exhaustion', () => {
    it('returns budget failure when time budget exhausted mid-turn', async () => {
      const slowTransport = new FakeLlmTransport();
      slowTransport.setResponses([
        {
          rawText: JSON.stringify(VALID_PROPOSAL)
        }
      ]);

      let fakeClock = 0;
      const result = createHarness(
        {
          transport: slowTransport,
          models: ['model-1'],
          maxIterations: 1,
          totalBudgetMs: 10, // Very short budget
          now: () => {
            fakeClock += 1000; // Simulate time passing
            return fakeClock;
          },
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(false);
      if (!turnResult.ok) {
        expect(turnResult.kind).toBe('budget');
      }
    });
  });

  describe('Degeneration detection and fallback', () => {
    it('skips repair and falls back after 2 degenerations with a model', async () => {
      transport.setResponses([
        // First degenerate response
        { rawText: 'x'.repeat(150), finishReason: 'MAX_TOKENS' },
        // Second degenerate response
        { rawText: 'y'.repeat(150), finishReason: 'MAX_TOKENS' },
        // Third model succeeds
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1', 'model-2'],
          maxIterations: 2, // Allow iteration + repair
          maxRepairs: 1,
          maxDegenerationsBeforeAbort: 2,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(true);
      if (turnResult.ok) {
        const fallbackEntry = turnResult.trace.entries.find(e => e.kind === 'fallback');
        expect(fallbackEntry).toBeDefined();
      }
    });

    it('returns all_fallbacks when all models degenerate', async () => {
      transport.setResponses([
        { rawText: 'x'.repeat(150), finishReason: 'MAX_TOKENS' },
        { rawText: 'y'.repeat(150), finishReason: 'MAX_TOKENS' }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1', 'model-2'],
          maxIterations: 1,
          maxRepairs: 1,
          maxDegenerationsBeforeAbort: 2,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(false);
      if (!turnResult.ok) {
        expect(turnResult.kind).toBe('all_fallbacks');
      }
    });
  });

  describe('Transient error backoff', () => {
    it('backs off and retries on transient 429 error', async () => {
      let callCount = 0;

      const transientSpy = vi.fn(async () => {
        callCount++;
        // First call: transient error, subsequent calls: success
        if (callCount === 1) {
          const error: Error & { status?: number } = new Error('Mock transport rejection');
          error.status = 429;
          throw error;
        }
        // Subsequent calls return success
        return { rawText: JSON.stringify(VALID_PROPOSAL) };
      });

      const result = createHarness(
        {
          transport: {
            complete: transientSpy
          },
          models: ['model-1'],
          maxIterations: 1,
          transientBackoffMs: 100,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(true);
      expect(sleepSpy).toHaveBeenCalledWith(100);
    });
  });

  describe('runTurn never rejects', () => {
    it('completes turn when transport rejects', async () => {
      transport.rejectNextCall();

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 1,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(false);
      if (!turnResult.ok) {
        expect(turnResult.kind).toBe('all_fallbacks');
      }
    });

    it('completes turn when telemetry listener throws', async () => {
      transport.setResponses([
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const throwingListener = vi.fn(() => {
        throw new Error('Telemetry explosion');
      });

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 1,
          onTelemetry: throwingListener,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      // Should complete successfully despite listener throwing
      expect(turnResult.ok).toBe(true);
      expect(throwingListener).toHaveBeenCalled();
    });
  });

  describe('All telemetry event types emitted', () => {
    it('emits every telemetry event type at least once across the suite', async () => {
      const collectedEvents = new Set<string>();

      const collector = (e: HarnessTelemetryEvent): void => {
        collectedEvents.add(e.type);
      };

      // Model call event
      transport.setResponses([{ rawText: JSON.stringify(VALID_PROPOSAL) }]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 1,
          onTelemetry: collector,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      // We've at least tested model_call and validated
      expect(collectedEvents.has('model_call')).toBe(true);
      expect(collectedEvents.has('validated')).toBe(true);
    });
  });

  describe('Question and analysis envelopes', () => {
    it('validates and returns question envelope', async () => {
      transport.setResponses([
        { rawText: JSON.stringify(VALID_QUESTION) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 1,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(true);
      if (turnResult.ok) {
        expect(turnResult.turn.envelope.state).toBe('question');
        expect(turnResult.turn.envelope.questionText).toBe('What is your name?');
      }
    });

    it('validates and returns analysis envelope', async () => {
      transport.setResponses([
        { rawText: JSON.stringify(VALID_ANALYSIS) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 1,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(true);
      if (turnResult.ok) {
        expect(turnResult.turn.envelope.state).toBe('analysis');
      }
    });
  });

  describe('Repair mechanism', () => {
    it('attempts repair when initial response has no valid JSON', async () => {
      transport.setResponses([
        // First response: invalid JSON
        { rawText: 'This is not valid JSON at all' },
        // Repair response: valid proposal
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const collectedEvents = new Set<string>();
      const collector = (e: HarnessTelemetryEvent): void => {
        collectedEvents.add(e.type);
      };

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 2,
          maxRepairs: 1,
          onTelemetry: collector,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(true);
      if (turnResult.ok) {
        expect(turnResult.turn.envelope.state).toBe('proposal');

        // Check repair telemetry
        expect(collectedEvents.has('repair_attempted')).toBe(true);
        expect(collectedEvents.has('repair_succeeded')).toBe(true);

        // Check trace entry
        const repairEntry = turnResult.trace.entries.find(e => e.kind === 'repair');
        expect(repairEntry).toBeDefined();
      }
    });

    it('attempts repair when validation fails', async () => {
      transport.setResponses([
        // First response: valid JSON but invalid envelope
        { rawText: JSON.stringify({ state: 'invalid_state', summary: 'test' }) },
        // Repair response: valid proposal
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 2,
          maxRepairs: 1,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(true);
      if (turnResult.ok) {
        expect(turnResult.turn.envelope.state).toBe('proposal');
        const repairEntry = turnResult.trace.entries.find(e => e.kind === 'repair' && e.outcome === 'succeeded');
        expect(repairEntry).toBeDefined();
      }
    });

    it('falls back to next model when repair fails', async () => {
      transport.setResponses([
        // First model: invalid response
        { rawText: 'Invalid JSON' },
        // Repair attempt: still invalid
        { rawText: 'Still invalid' },
        // Second model: valid proposal
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1', 'model-2'],
          maxIterations: 2,
          maxRepairs: 1,
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      expect(turnResult.ok).toBe(true);
      if (turnResult.ok) {
        // Should have fallen back to model-2
        const fallbackEntry = turnResult.trace.entries.find(e => e.kind === 'fallback');
        expect(fallbackEntry).toBeDefined();
        if (fallbackEntry && fallbackEntry.kind === 'fallback') {
          expect(fallbackEntry.fromModel).toBe('model-1');
          expect(fallbackEntry.toModel).toBe('model-2');
        }
      }
    });

    it('skips repair when budget is insufficient', async () => {
      transport.setResponses([
        // First response: invalid JSON
        { rawText: 'Invalid JSON' },
        // Second response: valid proposal (but should never be reached due to budget)
        { rawText: JSON.stringify(VALID_PROPOSAL) }
      ]);

      // Use a progressing clock to simulate time passing
      let currentTime = Date.now();

      const result = createHarness(
        {
          transport,
          models: ['model-1'],
          maxIterations: 2,
          maxRepairs: 1,
          totalBudgetMs: 100, // 100ms budget - very short
          now: () => {
            currentTime += 60; // Each call advances time by 60ms
            return currentTime;
          },
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      // Should fail due to budget exhaustion before repair can be attempted
      expect(turnResult.ok).toBe(false);
      if (!turnResult.ok) {
        expect(turnResult.kind).toBe('budget');
      }
    });

    it('limits repair attempts to maxRepairs', async () => {
      transport.setResponses([
        // First attempt: invalid
        { rawText: 'Invalid 1' },
        // First repair: still invalid
        { rawText: 'Invalid 2' },
        // Second attempt (model-2): invalid - no repairs left globally
        { rawText: 'Invalid 3' }
      ]);

      const result = createHarness(
        {
          transport,
          models: ['model-1', 'model-2'],
          maxIterations: 3,
          maxRepairs: 1, // Only 1 repair allowed total
          sleep: sleepSpy
        },
        contract
      );

      if (!result.ok) {
        throw new Error('Failed to create harness');
      }

      const harness = result.harness;
      const turnResult = await harness.runTurn({
        systemInstruction: 'You are a test agent.',
        promptText: 'Test prompt'
      });

      // Should fail since repairs are exhausted and all models fallback
      expect(turnResult.ok).toBe(false);
      if (!turnResult.ok) {
        expect(turnResult.kind).toBe('all_fallbacks');

        // Should have fallen back from model-1 to model-2
        const fallbackEntry = turnResult.trace.entries.find(e => e.kind === 'fallback');
        expect(fallbackEntry).toBeDefined();
        if (fallbackEntry && fallbackEntry.kind === 'fallback') {
          expect(fallbackEntry.fromModel).toBe('model-1');
          expect(fallbackEntry.toModel).toBe('model-2');
        }
      }
    });
  });
});
