/**
 * LLM JSON Extraction Utilities
 *
 * Robust extraction of JSON from LLM outputs that may contain markdown code fences
 * or trailing prose. Rejects malformed, oversized, or non-object outputs.
 *
 * Ported from courtpuzzle/functions/src/providers/copilotProvider.ts with
 * domain-specific imports stripped and renamed (extractCopilotJson → extractJson).
 */

/**
 * Recommended default maximum allowed raw character count for model output.
 * Callers can override via `ExtractJsonOptions.maxRawOutputChars`.
 */
export const DEFAULT_MAX_RAW_OUTPUT_CHARS = 200_000;

/**
 * Recommended default character count per side for diagnostic snippets.
 * Callers can override via `snippetChars` parameter.
 */
export const DEFAULT_DIAGNOSTIC_SNIPPET_CHARS = 200;

/**
 * Configuration options for {@link extractJson}.
 */
export interface ExtractJsonOptions {
  /**
   * Maximum allowed raw character count for model output.
   * Must be a positive finite number. Defaults to `DEFAULT_MAX_RAW_OUTPUT_CHARS`.
   */
  readonly maxRawOutputChars?: number;
}

/** Result shape for JSON extraction */
export interface JsonExtractionResult {
  ok: boolean;
  rawJsonString?: string;
  parsed?: unknown;
  failure?: {
    code: 'malformed_json' | 'oversized_output' | 'schema_invalid' | 'config_error';
    safeMessage: string;
  };
}

/**
 * Bounded head+tail snippet of a failed raw model output, for log-based
 * diagnosis of repetition loops and truncation without echoing user text.
 *
 * @param rawText - The raw model output text
 * @param snippetChars - Character count per side for the snippet (default: DEFAULT_DIAGNOSTIC_SNIPPET_CHARS)
 * @returns Head-only or head+tail snippet string
 */
export function diagnosticSnippet(rawText: string, snippetChars: number = DEFAULT_DIAGNOSTIC_SNIPPET_CHARS): string {
  const head = rawText.slice(0, snippetChars);
  if (rawText.length <= snippetChars * 2) {
    return head;
  }
  return `${head} …[snip ${rawText.length - snippetChars * 2} chars]… ${rawText.slice(-snippetChars)}`;
}

/**
 * Extracts a bare JSON object or single fenced JSON code block.
 * Rejects trailing prose, multiple blocks, truncated fragments, or oversized outputs.
 *
 * @param rawText - The raw model output text to extract JSON from
 * @param options - Optional configuration for extraction behavior
 * @returns Extraction result with parsed JSON or failure details
 */
export function extractJson(rawText: string, options?: ExtractJsonOptions): JsonExtractionResult {
  // Resolve effective limit from options or default
  const maxRawOutputChars = options?.maxRawOutputChars ?? DEFAULT_MAX_RAW_OUTPUT_CHARS;

  // Validate config option if provided
  if (options?.maxRawOutputChars !== undefined) {
    if (typeof options.maxRawOutputChars !== 'number' || !Number.isFinite(options.maxRawOutputChars)) {
      return {
        ok: false,
        failure: {
          code: 'config_error',
          safeMessage: `Invalid maxRawOutputChars option: must be a finite number, got ${options.maxRawOutputChars}`
        }
      };
    }
    if (options.maxRawOutputChars <= 0) {
      return {
        ok: false,
        failure: {
          code: 'config_error',
          safeMessage: `Invalid maxRawOutputChars option: must be positive, got ${options.maxRawOutputChars}`
        }
      };
    }
  }

  if (typeof rawText !== 'string') {
    return {
      ok: false,
      failure: {
        code: 'malformed_json',
        safeMessage: 'Model output must be a string.'
      }
    };
  }

  // 1. Enforce bounded raw character limit
  if (rawText.length > maxRawOutputChars) {
    return {
      ok: false,
      failure: {
        code: 'oversized_output',
        safeMessage: `Model output exceeds maximum raw character limit (${rawText.length} > ${maxRawOutputChars}).`
      }
    };
  }

  const trimmed = rawText.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      failure: {
        code: 'malformed_json',
        safeMessage: 'Model output is empty.'
      }
    };
  }

  let jsonToParse = trimmed;

  // 2. Check for markdown code fence
  if (trimmed.startsWith('```')) {
    // Must match a single fenced block that starts and ends the trimmed text
    const fenceRegex = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?\s*```$/i;
    const match = trimmed.match(fenceRegex);
    if (!match) {
      return {
        ok: false,
        failure: {
          code: 'malformed_json',
          safeMessage: 'Model output contains invalid markdown code fences or trailing text.'
        }
      };
    }
    const inner = match[1].trim();
    if (inner.includes('```')) {
      return {
        ok: false,
        failure: {
          code: 'malformed_json',
          safeMessage: 'Model output contains multiple code blocks.'
        }
      };
    }
    jsonToParse = inner;
  }

  // 3. Strict object boundary check (must start with { and end with })
  if (!jsonToParse.startsWith('{') || !jsonToParse.endsWith('}')) {
    return {
      ok: false,
      failure: {
        code: 'malformed_json',
        safeMessage: 'Model output must be a single JSON object without leading or trailing prose.'
      }
    };
  }

  // 4. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonToParse);
  } catch {
    return {
      ok: false,
      failure: {
        code: 'malformed_json',
        safeMessage: 'Model output could not be parsed as valid JSON.'
      }
    };
  }

  // 5. Structure check
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      failure: {
        code: 'schema_invalid',
        safeMessage: 'Model output parsed to a non-object JSON value.'
      }
    };
  }

  return {
    ok: true,
    rawJsonString: jsonToParse,
    parsed
  };
}
