/**
 * LLM Output Degeneration Detection
 *
 * Detects token-repetition loops in LLM outputs (particularly Gemini 3.x Flash
 * models using responseSchema with constrained decoding). Outputs degenerate
 * (e.g. "Slot Slot Slot…", "Done. Complete. OK.") until the token ceiling,
 * yielding unparseable JSON.
 *
 * Ported from courtpuzzle/src/common/llmOutputDiagnostics.ts.
 * Pure, typed in/out, zero dependencies, LLM-vendor agnostic.
 */

/** Signals that identify a degenerate model output */
export type DegenerationSignature =
  | 'max_tokens'
  | 'ngram_repetition'
  | 'config_error';

/**
 * Recommended default minimum number of consecutive repeated words before
 * the output counts as degenerate. Far above legitimate structured responses,
 * far below typical runaway loops (thousands).
 */
export const DEFAULT_DEGENERATION_WORD_THRESHOLD = 120;

/**
 * Recommended default longest repeated-phrase period (in words) considered
 * a loop signature.
 */
export const DEFAULT_MAX_REPEAT_PERIOD_WORDS = 8;

/**
 * Configuration options for {@link detectDegeneration}.
 */
export interface DetectDegenerationOptions {
  /**
   * Minimum number of consecutive repeated words before the output counts as
   * degenerate. Defaults to DEFAULT_DEGENERATION_WORD_THRESHOLD (120).
   * Overrides `input.maxRepetitionRun` if both are provided.
   */
  readonly maxRepetitionRun?: number;
  /**
   * Longest repeated-phrase period (in words) to check as a loop signature.
   * Defaults to DEFAULT_MAX_REPEAT_PERIOD_WORDS (8).
   */
  readonly maxRepeatPeriodWords?: number;
}

/** Typed input for {@link detectDegeneration} */
export interface DegenerationCheckInput {
  /** Raw model output text (empty string is allowed) */
  readonly rawText: string;
  /**
   * Provider finish reason as a plain string (e.g. 'MAX_TOKENS', 'STOP',
   * 'RECITATION'). Compared case-insensitively; unknown values are ignored.
   */
  readonly finishReason?: string;
  /**
   * Minimum number of consecutive repeated words before the output counts as
   * degenerate. Defaults to DEFAULT_DEGENERATION_WORD_THRESHOLD (120).
   * Can be overridden via `DetectDegenerationOptions.maxRepetitionRun`.
   */
  readonly maxRepetitionRun?: number;
}

/** Typed verdict from {@link detectDegeneration} */
export interface DegenerationVerdict {
  /** True when at least one degeneration signature is present */
  readonly degenerate: boolean;
  /** Every signature detected, in evaluation order */
  readonly signatures: readonly DegenerationSignature[];
}

/**
 * Detects degenerate LLM output:
 *
 * 1. `max_tokens` — the provider stopped at the token ceiling. Necessary
 *    signal for repetition loops; alone it is suggestive but not conclusive.
 * 2. `ngram_repetition` — some phrase of 1–N words repeats consecutively for
 *    at least `maxRepetitionRun` words in total. Conclusive on its own.
 *
 * @param input - The input parameters for degeneration detection
 * @param options - Optional configuration to override defaults or input parameters
 * @returns Verdict indicating degeneration status and detected signatures
 */
export function detectDegeneration(
  input: DegenerationCheckInput,
  options?: DetectDegenerationOptions
): DegenerationVerdict {
  const signatures: DegenerationSignature[] = [];

  // Validate options if provided
  if (options?.maxRepetitionRun !== undefined) {
    if (typeof options.maxRepetitionRun !== 'number' || !Number.isFinite(options.maxRepetitionRun)) {
      return { degenerate: true, signatures: ['config_error'] };
    }
    if (options.maxRepetitionRun <= 0) {
      return { degenerate: true, signatures: ['config_error'] };
    }
  }

  if (options?.maxRepeatPeriodWords !== undefined) {
    if (typeof options.maxRepeatPeriodWords !== 'number' || !Number.isFinite(options.maxRepeatPeriodWords)) {
      return { degenerate: true, signatures: ['config_error'] };
    }
    if (options.maxRepeatPeriodWords <= 0) {
      return { degenerate: true, signatures: ['config_error'] };
    }
  }

  // Resolve effective parameters (options override input, fallback to defaults)
  const maxRepetitionRun = options?.maxRepetitionRun ?? input.maxRepetitionRun ?? DEFAULT_DEGENERATION_WORD_THRESHOLD;
  const maxRepeatPeriodWords = options?.maxRepeatPeriodWords ?? DEFAULT_MAX_REPEAT_PERIOD_WORDS;

  if (input.finishReason && input.finishReason.toUpperCase() === 'MAX_TOKENS') {
    signatures.push('max_tokens');
  }

  if (hasPhraseRepetition(input.rawText, maxRepetitionRun, maxRepeatPeriodWords)) {
    signatures.push('ngram_repetition');
  }

  return { degenerate: signatures.length > 0, signatures };
}

/**
 * True when a phrase of 1–N words repeats consecutively enough that the
 * total repeated words reach `minRepeatedWords`. Degenerate loops observed
 * in production had both single-word ("Slot Slot Slot…") and multi-word
 * ("Done. Complete. OK.") periods, so the period is detected, not assumed.
 *
 * @param rawText - The raw model output text
 * @param minRepeatedWords - Minimum consecutive repeated words to trigger detection
 * @param maxRepeatPeriodWords - Maximum phrase period (in words) to check
 * @returns true if degenerate repetition is detected
 */
function hasPhraseRepetition(
  rawText: string,
  minRepeatedWords: number,
  maxRepeatPeriodWords: number
): boolean {
  const words = rawText.toLowerCase().split(/\s+/);
  if (words.length < minRepeatedWords) {
    return false;
  }

  for (let period = 1; period <= maxRepeatPeriodWords; period++) {
    let runWords = period;
    for (let i = period; i + period <= words.length; i += period) {
      let matches = true;
      for (let j = 0; j < period; j++) {
        if (words[i + j] !== words[i - period + j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        runWords += period;
        if (runWords >= minRepeatedWords) {
          return true;
        }
      } else {
        runWords = period;
      }
    }
  }
  return false;
}
