/**
 * embedded-mc-pee — MCP-shaped harness for embedding tool-calling LLM intelligence into backends.
 *
 * This library provides typed envelopes, deterministic validation, and record/replay for agentic
 * LLM workflows. It uses direct SDK calls (not MCP protocol) and enforces JSON-safety at all boundaries.
 *
 * @packageDocumentation
 */

/**
 * Library version.
 *
 * Semver-major bumps indicate breaking API changes. Semver-minor/patch bumps are for new features and bug fixes.
 */
export const LIBRARY_VERSION = '0.1.0' as const;

// --- JSON safety & extraction ---------------------------------------------

export { assertJsonSafe, isJsonSafe } from './json/jsonSafe';

export {
  DEFAULT_MAX_RAW_OUTPUT_CHARS,
  DEFAULT_DIAGNOSTIC_SNIPPET_CHARS,
  diagnosticSnippet,
  extractJson
} from './json/extract';
export type { ExtractJsonOptions, JsonExtractionResult } from './json/extract';

// --- Envelope --------------------------------------------------------------

export { ENVELOPE_STATES } from './envelope/envelope';
export type {
  AgentEnvelope,
  AgentTurn,
  EnvelopePayloadValidator,
  EnvelopeState,
  PayloadResult,
  TurnResult,
  ValidationFailure,
  ValidationFailureCode
} from './envelope/envelope';
export { validateEnvelopeOutput } from './envelope/validate';

// --- Diagnostics -----------------------------------------------------------

export {
  DEFAULT_DEGENERATION_WORD_THRESHOLD,
  DEFAULT_MAX_REPEAT_PERIOD_WORDS,
  detectDegeneration
} from './diagnostics/degeneration';
export type {
  DegenerationCheckInput,
  DegenerationSignature,
  DegenerationVerdict,
  DetectDegenerationOptions
} from './diagnostics/degeneration';

// --- Policy ----------------------------------------------------------------

export { isTransientProviderError } from './policy/transientErrors';

// --- Debug -----------------------------------------------------------------

export { AssertionError, assert, dbg, isDebug, setDebug } from './debug/debug';
export type { DebugLogger } from './debug/debug';
