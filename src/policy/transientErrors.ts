/**
 * Transient Error Detection
 *
 * Classifies provider errors as transient (retryable) vs permanent.
 * Uses duck-typing on error shapes to avoid direct SDK dependencies.
 *
 * Ported from courtpuzzle/functions/src/providers/demandExtractionProvider.ts.
 */

/**
 * Tests whether an error represents a transient provider condition that
 * justifies retry (rate limits, resource exhaustion, temporary unavailability).
 *
 * Uses duck-typing on error shapes to stay vendor-agnostic:
 * - Numeric status codes (429, 503)
 * - String status codes ('RESOURCE_EXHAUSTED', 'UNAVAILABLE')
 * - Embedded JSON in error messages containing these codes
 *
 * @param error - Unknown error value from an SDK or API call
 * @returns true if the error is transient/retryable, false otherwise
 */
export function isTransientProviderError(error: unknown): boolean {
  const status = (error as { status?: number | string })?.status;
  if (status === 429 || status === 'RESOURCE_EXHAUSTED') return true;
  if (status === 503 || status === 'UNAVAILABLE') return true;
  const message = (error as Error)?.message ?? '';
  if (/"code"\s*:\s*(429|503)/.test(message)) return true;
  if (/"status"\s*:\s*"(RESOURCE_EXHAUSTED|UNAVAILABLE)"/.test(message)) return true;
  return false;
}
