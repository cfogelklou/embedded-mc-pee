/**
 * LLM JSON Extraction Tests
 *
 * Ported from courtpuzzle/functions/src/__tests__/copilotProvider.test.ts
 * (Copilot JSON Extraction describe block).
 */
import { describe, it, expect } from 'vitest';
import { extractJson, diagnosticSnippet, DEFAULT_MAX_RAW_OUTPUT_CHARS } from './extract';

describe('extractJson', () => {
  it('extracts a clean bare JSON object', () => {
    const raw = JSON.stringify({
      state: 'proposal',
      title: 'Add tentative availability',
      explanation: 'Creating new availability supply'
    });

    const result = extractJson(raw);
    expect(result.ok).toBe(true);
    expect(result.parsed).toMatchObject({ state: 'proposal' });
  });

  it('extracts JSON from a single markdown json code fence', () => {
    const jsonStr = JSON.stringify({
      state: 'question',
      questionText: 'Which venue do you mean?',
      explanation: 'I need more information'
    });
    const raw = `\`\`\`json\n${jsonStr}\n\`\`\``;

    const result = extractJson(raw);
    expect(result.ok).toBe(true);
    expect(result.parsed).toMatchObject({
      state: 'question',
      questionText: 'Which venue do you mean?'
    });
  });

  it('extracts JSON from a single markdown code fence without language tag', () => {
    const jsonStr = JSON.stringify({
      state: 'analysis',
      explanation: 'Currently 2 slots are available.',
      analysisDetails: {
        summaryText: '2 slots available this week'
      }
    });
    const raw = `\`\`\`\n${jsonStr}\n\`\`\``;

    const result = extractJson(raw);
    expect(result.ok).toBe(true);
    expect(result.parsed).toMatchObject({ state: 'analysis' });
  });

  it('rejects output with trailing prose after bare JSON', () => {
    const raw = '{"state":"proposal"}\nHere is some additional explanation for you!';
    const result = extractJson(raw);
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('malformed_json');
  });

  it('rejects output with leading prose before bare JSON', () => {
    const raw = 'Sure, here is the proposal:\n{"state":"proposal"}';
    const result = extractJson(raw);
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('malformed_json');
  });

  it('rejects output with trailing prose after closing code fence', () => {
    const raw = '```json\n{"state":"question"}\n```\nHope this helps!';
    const result = extractJson(raw);
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('malformed_json');
  });

  it('rejects output with multiple markdown code fences', () => {
    const raw = '```json\n{"state":"proposal"}\n```\n```json\n{"state":"infeasible"}\n```';
    const result = extractJson(raw);
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('malformed_json');
  });

  it('rejects truncated / unbalanced JSON', () => {
    const raw = '{"state":"proposal","teams":[';
    const result = extractJson(raw);
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('malformed_json');
  });

  it('rejects output exceeding DEFAULT_MAX_RAW_OUTPUT_CHARS', () => {
    const largeProse = 'x'.repeat(DEFAULT_MAX_RAW_OUTPUT_CHARS + 10);
    const result = extractJson(largeProse);
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('oversized_output');
    expect(result.failure?.safeMessage).toContain('exceeds maximum raw character limit');
  });

  it('rejects non-object JSON values like arrays or primitives', () => {
    expect(extractJson('[1, 2, 3]').ok).toBe(false);
    expect(extractJson('12345').ok).toBe(false);
    expect(extractJson('"hello"').ok).toBe(false);
    expect(extractJson('').ok).toBe(false);
  });

  it('rejects empty string', () => {
    const result = extractJson('');
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe('malformed_json');
    expect(result.failure?.safeMessage).toContain('empty');
  });

  it('rejects non-string input', () => {
    expect(extractJson(null as unknown as string).ok).toBe(false);
    expect(extractJson(undefined as unknown as string).ok).toBe(false);
    expect(extractJson(123 as unknown as string).ok).toBe(false);
  });

  describe('Options parameter', () => {
    it('uses default limit when options omitted', () => {
      const validJson = '{"state":"proposal"}';
      const result = extractJson(validJson);
      expect(result.ok).toBe(true);
    });

    it('enforces custom smaller limit via maxRawOutputChars option', () => {
      const customLimit = 100;
      const largeJson = '{"state":"proposal","data":"' + 'x'.repeat(customLimit + 10) + '"}';
      const result = extractJson(largeJson, { maxRawOutputChars: customLimit });
      expect(result.ok).toBe(false);
      expect(result.failure?.code).toBe('oversized_output');
      expect(result.failure?.safeMessage).toContain(`${customLimit}`);
    });

    it('allows larger limit via maxRawOutputChars option', () => {
      const customLimit = DEFAULT_MAX_RAW_OUTPUT_CHARS + 1000;
      const largeJson = '{"state":"proposal","data":"' + 'x'.repeat(DEFAULT_MAX_RAW_OUTPUT_CHARS + 500) + '"}';
      const result = extractJson(largeJson, { maxRawOutputChars: customLimit });
      expect(result.ok).toBe(true);
    });

    it('rejects non-finite maxRawOutputChars option with config_error', () => {
      const result = extractJson('{"state":"proposal"}', { maxRawOutputChars: NaN });
      expect(result.ok).toBe(false);
      expect(result.failure?.code).toBe('config_error');
      expect(result.failure?.safeMessage).toContain('must be a finite number');
    });

    it('rejects infinite maxRawOutputChars option with config_error', () => {
      const result = extractJson('{"state":"proposal"}', { maxRawOutputChars: Infinity });
      expect(result.ok).toBe(false);
      expect(result.failure?.code).toBe('config_error');
      expect(result.failure?.safeMessage).toContain('must be a finite number');
    });

    it('rejects non-positive maxRawOutputChars option with config_error', () => {
      const result = extractJson('{"state":"proposal"}', { maxRawOutputChars: 0 });
      expect(result.ok).toBe(false);
      expect(result.failure?.code).toBe('config_error');
      expect(result.failure?.safeMessage).toContain('must be positive');
    });

    it('rejects negative maxRawOutputChars option with config_error', () => {
      const result = extractJson('{"state":"proposal"}', { maxRawOutputChars: -100 });
      expect(result.ok).toBe(false);
      expect(result.failure?.code).toBe('config_error');
      expect(result.failure?.safeMessage).toContain('must be positive');
    });

    it('includes effective limit in oversized error message', () => {
      const customLimit = 50;
      const tooLarge = '{"data":"' + 'x'.repeat(customLimit + 10) + '"}';
      const result = extractJson(tooLarge, { maxRawOutputChars: customLimit });
      expect(result.ok).toBe(false);
      expect(result.failure?.safeMessage).toMatch(new RegExp(`\\(.* > ${customLimit}\\)`));
    });
  });
});

describe('diagnosticSnippet', () => {
  it('returns full text for short inputs', () => {
    const short = 'abc';
    expect(diagnosticSnippet(short)).toBe('abc');
  });

  it('returns head+tail snippet for long inputs', () => {
    const long = 'a'.repeat(500);
    const snippet = diagnosticSnippet(long);
    expect(snippet).toContain('…[snip');
    expect(snippet).toContain('chars]…');
    expect(snippet.length).toBeLessThan(long.length);
  });

  it('does not include middle section in snippet', () => {
    const long = 'start'.padStart(500, 'x') + 'middle' + 'end'.padEnd(500, 'y');
    const snippet = diagnosticSnippet(long);
    expect(snippet).not.toContain('middle');
  });

  it('uses default snippetChars when omitted', () => {
    const long = 'a'.repeat(500);
    const snippet = diagnosticSnippet(long);
    expect(snippet.length).toBeLessThan(long.length);
    // Should use DEFAULT_DIAGNOSTIC_SNIPPET_CHARS (200) per side
    expect(snippet).toContain('…[snip');
  });

  it('uses custom snippetChars when provided', () => {
    const customChars = 50;
    const long = 'a'.repeat(500);
    const snippet = diagnosticSnippet(long, customChars);
    expect(snippet.length).toBeLessThan(long.length);
    // Custom limit should produce different snippet than default
    const defaultSnippet = diagnosticSnippet(long);
    expect(snippet).not.toBe(defaultSnippet);
  });

  it('handles snippetChars of zero', () => {
    const result = diagnosticSnippet('hello', 0);
    // With zero snippet chars, we get ellipsis + tail (the full string since it's short)
    expect(result).toBe(' …[snip 5 chars]… hello');
  });
});
