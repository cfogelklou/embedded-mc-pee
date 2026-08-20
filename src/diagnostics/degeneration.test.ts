/**
 * Degeneration Detection Tests
 *
 * Ported from courtpuzzle/src/common/__tests__/llmOutputDiagnostics.test.ts
 */
import { describe, it, expect } from 'vitest';
import { detectDegeneration } from './degeneration';
import type { DegenerationCheckInput, DegenerationVerdict, DetectDegenerationOptions } from './degeneration';

/**
 * Runs detection and asserts it produced a verdict (not a config failure),
 * so tests of model-output behavior fail loudly on accidental config errors.
 */
function verdictOf(input: DegenerationCheckInput, options?: DetectDegenerationOptions): DegenerationVerdict {
  const result = detectDegeneration(input, options);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Unexpected config failure: ${result.failure.message}`);
  }
  return result.verdict;
}

describe('detectDegeneration', () => {
  it('returns no signatures for clean output', () => {
    const verdict = verdictOf({
      rawText: '{"actionType":"upsert_availability","title":"Add Monday hall time"}',
      finishReason: 'STOP'
    });

    expect(verdict.degenerate).toBe(false);
    expect(verdict.signatures).toEqual([]);
  });

  it('flags max_tokens finish reason', () => {
    const verdict = verdictOf({
      rawText: '{"truncated": ',
      finishReason: 'max_tokens'
    });

    expect(verdict.degenerate).toBe(true);
    expect(verdict.signatures).toEqual(['max_tokens']);
  });

  it('detects single-word repetition loops regardless of finish reason', () => {
    const verdict = verdictOf({
      rawText: `{"title":"Add ${'Slot '.repeat(140)}end"}`,
      finishReason: 'STOP'
    });

    expect(verdict.degenerate).toBe(true);
    expect(verdict.signatures).toEqual(['ngram_repetition']);
  });

  it('detects multi-word phrase repetition loops (6-word period)', () => {
    // Prod variant: self-commentary loop, not a single repeated word.
    const verdict = verdictOf({
      rawText: `{"explanation":"${'Done. Complete. OK. Emit. Valid. Standard. '.repeat(40)}"}`,
      finishReason: 'STOP'
    });

    expect(verdict.degenerate).toBe(true);
    expect(verdict.signatures).toEqual(['ngram_repetition']);
  });

  it('collects both signatures when present together', () => {
    const verdict = verdictOf({
      rawText: `{"title":"${'Done Complete OK Done Complete OK '.repeat(40)}"}`,
      finishReason: 'MAX_TOKENS'
    });

    expect(verdict.degenerate).toBe(true);
    expect(verdict.signatures).toEqual(['max_tokens', 'ngram_repetition']);
  });

  it('does not flag legitimate prose that repeats a short phrase a few times', () => {
    const verdict = verdictOf({
      rawText: 'The team trains Mondays. Mondays work well. Mondays Mondays Mondays are best.',
      finishReason: 'STOP'
    });

    expect(verdict.degenerate).toBe(false);
  });

  it('honours a custom repetition threshold via input', () => {
    const raw = `${'ha '.repeat(10)}`;

    expect(verdictOf({ rawText: raw, maxRepetitionRun: 5 }).degenerate).toBe(true);
    expect(verdictOf({ rawText: raw, maxRepetitionRun: 50 }).degenerate).toBe(false);
  });

  it('handles empty and tiny inputs without false positives', () => {
    expect(verdictOf({ rawText: '' }).degenerate).toBe(false);
    expect(verdictOf({ rawText: 'Slot Slot Slot' }).degenerate).toBe(false);
  });

  it('is case-insensitive for finish reason', () => {
    expect(verdictOf({ rawText: '{}', finishReason: 'MAX_TOKENS' }).signatures).toContain('max_tokens');
    expect(verdictOf({ rawText: '{}', finishReason: 'max_tokens' }).signatures).toContain('max_tokens');
    expect(verdictOf({ rawText: '{}', finishReason: 'Max_Tokens' }).signatures).toContain('max_tokens');
  });

  describe('Options parameter', () => {
    it('uses default thresholds when options omitted and input not provided', () => {
      const verdict = verdictOf({ rawText: '{"ok": true}' });
      expect(verdict.degenerate).toBe(false);
    });

    it('options override input maxRepetitionRun', () => {
      const raw = `${'ha '.repeat(10)}`;
      // Input says 50 (should not trigger), but options say 5 (should trigger)
      const verdict = verdictOf(
        { rawText: raw, maxRepetitionRun: 50 },
        { maxRepetitionRun: 5 }
      );
      expect(verdict.degenerate).toBe(true);
    });

    it('honours custom maxRepetitionRun via options', () => {
      const raw = `${'ha '.repeat(15)}`;
      // 15 repetitions should trigger with threshold of 10
      expect(verdictOf({ rawText: raw }, { maxRepetitionRun: 10 }).degenerate).toBe(true);
      // But not with threshold of 20
      expect(verdictOf({ rawText: raw }, { maxRepetitionRun: 20 }).degenerate).toBe(false);
    });

    it('honours custom maxRepeatPeriodWords via options', () => {
      // Create a pattern with 10-word period
      const raw = `${'a b c d e f g h i j '.repeat(20)}`;
      // Default period (8) won't catch it
      const defaultVerdict = verdictOf({ rawText: raw }, { maxRepetitionRun: 50 });
      expect(defaultVerdict.degenerate).toBe(false);
      // Custom period (10) will catch it
      const customVerdict = verdictOf(
        { rawText: raw },
        { maxRepetitionRun: 50, maxRepeatPeriodWords: 10 }
      );
      expect(customVerdict.degenerate).toBe(true);
    });

    it('rejects non-finite maxRepetitionRun option with a config failure', () => {
      const result = detectDegeneration(
        { rawText: '{}', finishReason: 'STOP' },
        { maxRepetitionRun: NaN }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('config_error');
        expect(result.failure.message).toContain('maxRepetitionRun');
      }
    });

    it('rejects infinite maxRepetitionRun option with a config failure', () => {
      const result = detectDegeneration(
        { rawText: '{}' },
        { maxRepetitionRun: Infinity }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('config_error');
      }
    });

    it('rejects non-positive maxRepetitionRun option with a config failure', () => {
      const result = detectDegeneration(
        { rawText: '{}' },
        { maxRepetitionRun: 0 }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('config_error');
      }
    });

    it('rejects negative maxRepetitionRun option with a config failure', () => {
      const result = detectDegeneration(
        { rawText: '{}' },
        { maxRepetitionRun: -10 }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('config_error');
      }
    });

    it('rejects non-finite maxRepeatPeriodWords option with a config failure', () => {
      const result = detectDegeneration(
        { rawText: '{}' },
        { maxRepeatPeriodWords: NaN }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('config_error');
        expect(result.failure.message).toContain('maxRepeatPeriodWords');
      }
    });

    it('rejects non-positive maxRepeatPeriodWords option with a config failure', () => {
      const result = detectDegeneration(
        { rawText: '{}' },
        { maxRepeatPeriodWords: 0 }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('config_error');
      }
    });

    it('rejects negative maxRepeatPeriodWords option with a config failure', () => {
      const result = detectDegeneration(
        { rawText: '{}' },
        { maxRepeatPeriodWords: -5 }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('config_error');
      }
    });

    it('reports a config failure without any degeneration verdict', () => {
      const result = detectDegeneration(
        { rawText: `${'Slot '.repeat(140)}`, finishReason: 'MAX_TOKENS' },
        { maxRepetitionRun: -1 }
      );
      // Config failure is discriminated from the verdict: there is no
      // degenerate=true answer, even though the raw text is degenerate.
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('config_error');
        expect('verdict' in result).toBe(false);
      }
    });
  });
});
