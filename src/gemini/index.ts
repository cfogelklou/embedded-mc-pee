/**
 * Gemini Transport Public Surface
 *
 * Re-exports the public API of the Gemini LLM transport implementation.
 * This module provides a factory function that creates an {@link LlmTransport}
 * backed by the Google Gemini API via the `@google/genai` SDK.
 *
 * Usage:
 * ```ts
 * import { createGeminiTransport } from 'embedded-mc-pee/gemini';
 *
 * const result = createGeminiTransport({ apiKey: 'your-key' });
 * if (result.ok) {
 *   const transport = result.transport;
 *   // Use transport with the harness
 * } else {
 *   dbg.error('Config errors:', result.failures);
 * }
 * ```
 *
 * @module
 */

// Factory and options
export {
  createGeminiTransport,
  type GeminiTransportOptions,
  type GeminiTransportResult,
  GeminiTransportConfigError
} from './geminiTransport';

// Schema mapper
export { functionDeclarationOf } from './schemaToFunctionDeclaration';

// Constants
export { DEFAULT_GEMINI_TIMEOUT_MS } from './geminiTransport';

// Types
export type { LlmTransport, LlmRequest, LlmResponse } from '../transport/types';
export type { ToolContract } from '../tool/toolContract';
