/**
 * Guess Number Example Test
 *
 * Tool-loop test: model guesses 1-100 with checkGuess tool feedback.
 * Validates tool protocol, iteration budget, and trace recording.
 */

import { describe, beforeAll, it, expect } from 'vitest';
import { createHarness, createContract, validateToolArgs, dbg, type ToolContract, type ToolBinding, type ToolResult } from 'embedded-mc-pee';
import { createGeminiTransport, type GeminiTransportResult } from 'embedded-mc-pee/gemini';
import type { ContractManifest, ValidationFailureCode, AgentTurn, CreateContractResult, CreateHarnessResult } from 'embedded-mc-pee';

// ============================================================================
// Types
// ============================================================================

interface CheckGuessInput {
  guess: number;
}

interface CheckGuessOutput {
  result: 'higher' | 'lower' | 'correct';
}

interface GuessNumberPayload {
  secretNumber: number;
  attempts: number;
}

// ============================================================================
// Tool Contract
// ============================================================================

const checkGuessTool: ToolContract<CheckGuessInput, CheckGuessOutput> = {
  name: 'checkGuess',
  title: 'Check a guess against the secret number',
  description: 'Tests your guess against the secret number (1-100). Returns "higher" if the secret is greater, "lower" if smaller, or "correct" if you found it.',
  inputSchema: {
    type: 'object',
    properties: {
      guess: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: 'Your guess (integer 1-100)'
      }
    },
    required: ['guess']
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: {
        type: 'string',
        enum: ['higher', 'lower', 'correct'],
        description: 'Feedback on your guess'
      }
    },
    required: ['result']
  }
};

// ============================================================================
// Manifest
// ============================================================================

const guessNumberManifest: ContractManifest = {
  payload: {
    type: 'object',
    properties: {
      secretNumber: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: 'The secret number you correctly guessed'
      },
      attempts: {
        type: 'number',
        minimum: 1,
        description: 'Number of guesses it took to find the secret'
      }
    },
    required: ['secretNumber', 'attempts']
  },
  envelope: {
    states: ['proposal']
  }
};

// ============================================================================
// Payload Validator
// ============================================================================

function validateGuessNumberPayload(payload: unknown):
  | { ok: true; value: GuessNumberPayload }
  | { ok: false; failure: { code: ValidationFailureCode; message: string; fieldPath?: string } }
{
  if (typeof payload !== 'object' || payload === null) {
    return {
      ok: false,
      failure: { code: 'schema_invalid', message: 'Payload must be an object', fieldPath: '$.payload' }
    };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.secretNumber !== 'number') {
    return {
      ok: false,
      failure: {
        code: 'missing_required_field',
        message: 'secretNumber must be a number',
        fieldPath: '$.payload.secretNumber'
      }
    };
  } else if (p.secretNumber < 1 || p.secretNumber > 100 || !Number.isInteger(p.secretNumber)) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid',
        message: 'secretNumber must be an integer 1-100',
        fieldPath: '$.payload.secretNumber'
      }
    };
  }

  if (typeof p.attempts !== 'number') {
    return {
      ok: false,
      failure: {
        code: 'missing_required_field',
        message: 'attempts must be a number',
        fieldPath: '$.payload.attempts'
      }
    };
  } else if (p.attempts < 1 || !Number.isInteger(p.attempts)) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid',
        message: 'attempts must be a positive integer',
        fieldPath: '$.payload.attempts'
      }
    };
  }

  return {
    ok: true,
    value: {
      secretNumber: p.secretNumber as number,
      attempts: p.attempts as number
    }
  };
}

// ============================================================================
// Game State
// ============================================================================

class GuessGame {
  public readonly secretNumber: number;
  public attempts = 0;
  public guessHistory: number[] = [];

  constructor() {
    // Deterministic secret for reproducible tests
    this.secretNumber = 42;
  }

  checkGuess(guess: number): ToolResult<CheckGuessOutput> {
    this.attempts++;
    this.guessHistory.push(guess);

    if (guess === this.secretNumber) {
      return {
        text: `Correct! The number was ${this.secretNumber}.`,
        structuredContent: { result: 'correct' as const }
      };
    } else if (guess < this.secretNumber) {
      return {
        text: `Higher! Try a number greater than ${guess}.`,
        structuredContent: { result: 'higher' as const }
      };
    } else {
      return {
        text: `Lower! Try a number less than ${guess}.`,
        structuredContent: { result: 'lower' as const }
      };
    }
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('guess-number example', () => {
  let transportResult: GeminiTransportResult | null = null;
  let contractResult: CreateContractResult<GuessNumberPayload> | null = null;
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

    const contractRes = createContract<GuessNumberPayload>(guessNumberManifest, validateGuessNumberPayload);
    contractResult = contractRes;
    if (!contractRes.ok) {
      throw new Error(`Contract creation failed: ${JSON.stringify(contractRes.failures)}`);
    }
  });

  it('should guess the secret number within iteration budget', () => {
    if (!hasKey || !transportResult || !contractResult) {
      return;
    }

    if (!transportResult.ok || !contractResult.ok) {
      throw new Error('Setup failed');
    }

    const game = new GuessGame();
    const toolBindings: ToolBinding[] = [
      {
        contract: checkGuessTool,
        handler: async (args: unknown): Promise<ToolResult<CheckGuessOutput>> => {
          const input = args as CheckGuessInput;
          // Validate tool args before executing (MCP duty)
          const validation = validateToolArgs(checkGuessTool, input);
          if (!validation.ok) {
            return {
              isError: true,
              text: `Invalid tool args: ${JSON.stringify(validation.violations)}`
            };
          }
          return game.checkGuess(input.guess);
        }
      }
    ];

    const harnessResult: CreateHarnessResult<GuessNumberPayload> = createHarness({
      transport: transportResult.transport,
      models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'],
      maxIterations: 10,  // Binary search: log2(100) ≈ 7 guesses + 1 final envelope turn
      perModelTimeoutMs: 10_000,
      totalBudgetMs: 60_000,
      tools: toolBindings,
    }, contractResult.contract);

    if (!harnessResult.ok) {
      throw new Error(`Harness creation failed: ${JSON.stringify(harnessResult.failures)}`);
    }

    const systemInstruction = 'You are a precise number guesser using binary search. Keep calling checkGuess until you get "correct" response, then return the envelope.';
    const promptText = `I'm thinking of a number between 1 and 100. Guess it using the checkGuess tool!

Available tools:
- checkGuess(guess): returns "higher" if the secret is greater, "lower" if smaller, or "correct" if you found it.

CRITICAL INSTRUCTIONS:
1. Start with guess 50
2. If "higher": guess the midpoint of (current guess + 1) to 100
3. If "lower": guess the midpoint of 1 to (current guess - 1)
4. Keep calling checkGuess until you get "correct"
5. ONLY when checkGuess returns "correct", immediately return the JSON envelope

Binary search example:
- Guess 50 → "lower" → next guess 25 (midpoint of 1-49)
- Guess 25 → "higher" → next guess 37 (midpoint of 26-49)
- Continue until "correct"

Return this JSON when you find the correct number:
{
  "state": "proposal",
  "payload": {
    "secretNumber": <the number that returned "correct">,
    "attempts": <total guesses you made>
  }
}

DO NOT stop guessing until checkGuess returns "correct".`;

    return harnessResult.harness.runTurn({
      systemInstruction,
      promptText,
    }).then(result => {
      dbg.logObj('Guess number - guess history', game.guessHistory);
      dbg.log('Guess number - attempts:', game.attempts);
      if (!result.ok) {
        dbg.log('Guess number - Harness result failure kind:', result.kind);
        dbg.log('Guess number - Turn envelope state:', result.turn.envelope.state);
      }
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.turn.envelope.state).toBe('proposal');
      expect(result.turn.payload).toBeDefined();

      const turn = result.turn as AgentTurn<GuessNumberPayload>;

      // Verify correct answer
      expect(turn.payload?.secretNumber).toBe(42);

      // Verify reasonable attempt count (binary search: ≤7, worst-case linear: could be 100)
      expect(turn.payload?.attempts).toBeGreaterThanOrEqual(1);
      expect(turn.payload?.attempts).toBeLessThanOrEqual(100);

      // Verify tool protocol was followed (at least one call made)
      expect(result.trace.entries.length).toBeGreaterThan(0);

      // Verify trace contains tool calls
      const toolCalls = result.trace.entries.filter(entry => entry.kind === 'tool_call');
      expect(toolCalls.length).toBeGreaterThan(0);

      // Verify tool calls were for our tool
      toolCalls.forEach(entry => {
        if (entry.kind === 'tool_call') {
          expect(entry.name).toBe('checkGuess');
        }
      });
    });
  });
});
