/**
 * Transient Error Detection Tests
 *
 * Ported from courtpuzzle/functions/src/__tests__/demandIngestion.test.ts
 * (transient error test cases).
 */
import { describe, it, expect } from 'vitest';
import { isTransientProviderError } from './transientErrors';

describe('isTransientProviderError', () => {
  it('correctly identifies transient provider errors', () => {
    expect(isTransientProviderError({ status: 429 })).toBe(true);
    expect(isTransientProviderError({ status: 503 })).toBe(true);
    expect(isTransientProviderError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(true);
    expect(isTransientProviderError(new Error('invalid argument'))).toBe(false);
  });

  it('recognizes RESOURCE_EXHAUSTED string status', () => {
    expect(isTransientProviderError({ status: 'RESOURCE_EXHAUSTED' })).toBe(true);
  });

  it('recognizes UNAVAILABLE string status', () => {
    expect(isTransientProviderError({ status: 'UNAVAILABLE' })).toBe(true);
  });

  it('extracts error codes from JSON in error messages', () => {
    const errorMsg = '{"code":429,"message":"Rate limit exceeded"}';
    expect(isTransientProviderError(new Error(errorMsg))).toBe(true);

    const errorMsg503 = '{"code":503,"status":"UNAVAILABLE"}';
    expect(isTransientProviderError(new Error(errorMsg503))).toBe(true);
  });

  it('rejects non-transient error codes', () => {
    expect(isTransientProviderError({ status: 400 })).toBe(false);
    expect(isTransientProviderError({ status: 401 })).toBe(false);
    expect(isTransientProviderError({ status: 403 })).toBe(false);
    expect(isTransientProviderError({ status: 404 })).toBe(false);
    expect(isTransientProviderError({ status: 500 })).toBe(false);
  });

  it('handles null/undefined error input gracefully', () => {
    expect(isTransientProviderError(null)).toBe(false);
    expect(isTransientProviderError(undefined)).toBe(false);
  });

  it('handles errors without status or message', () => {
    expect(isTransientProviderError({})).toBe(false);
    expect(isTransientProviderError(new Error())).toBe(false);
  });
});
