/**
 * embedded-mc-pee — MCP-shaped harness for embedding tool-calling LLM
 * intelligence into backends.
 *
 * This library lets a backend host an LLM agent the way a coding-agent harness
 * (Claude Code / MCP) hosts a model: full state and mandate in, a tools
 * contract out, and a typed envelope back. It uses direct SDK calls (not the
 * MCP wire protocol) and enforces JSON-safety at every boundary.
 *
 * ## Core data flow
 *
 * 1. The host renders the **complete current state snapshot** into the prompt
 *    (no server-side pre-filtering or pre-selection).
 * 2. The model takes a turn.
 * 3. Raw output is passed through {@link extractJson} and
 *    {@link validateEnvelopeOutput}, producing a typed
 *    {@link AgentTurn} whose envelope state is one of
 *    `'proposal' | 'question' | 'analysis' | 'infeasible'`.
 * 4. A `payload` is present **if and only if** `state === 'proposal'` — the
 *    validator enforces this invariant in both directions.
 *
 * ## Deterministic-validation philosophy
 *
 * LLMs propose; deterministic code validates and applies. The model never
 * mutates state directly — it emits structured proposals inside the envelope,
 * and host-supplied validators (plus the checks in this library: JSON
 * extraction, JSON-safety, state/conditional-field rules, degeneration
 * detection) decide whether a proposal is feasible. Ambiguity becomes a
 * `question`, impossibility becomes `infeasible` with an honest explanation —
 * never a silent fallback.
 *
 * Library limits (raw-output size, degeneration thresholds) are
 * `DEFAULT_*` recommended defaults; callers override them via options.
 *
 * Record/replay of model turns is planned but not yet exported.
 *
 * @packageDocumentation
 */

/**
 * Library version.
 *
 * Semver-major bumps indicate breaking API changes. Semver-minor/patch bumps are for new features and bug fixes.
 */
export const LIBRARY_VERSION = '0.1.0' as const;

/**
 * JSON safety & extraction.
 *
 * The parsing boundary between raw model text and structured data. Use this
 * group when you have a raw LLM response string and need either a guarded
 * JSON parse or a recursive JSON-safety check before handing values across a
 * serialization boundary (HTTP callables, Firestore writes, IPC).
 *
 * - `isJsonSafe(value)` — boolean test for JSON-serializability (no NaN,
 *   ±Infinity, functions, symbols, bigints, circular references).
 * - `assertJsonSafe(value)` — same check, throws with the offending JSON path.
 * - `extractJson(rawText, options?)` — strict extraction of a single JSON
 *   object (bare or one fenced block) from model output; rejects trailing
 *   prose, multiple blocks, truncation, and oversized outputs.
 * - `diagnosticSnippet(rawText, snippetChars?)` — bounded head+tail snippet
 *   of a failed output for logging without echoing user text.
 * - `DEFAULT_MAX_RAW_OUTPUT_CHARS`, `DEFAULT_DIAGNOSTIC_SNIPPET_CHARS` —
 *   recommended limits, overridable via `ExtractJsonOptions` / parameter.
 */
export { assertJsonSafe, isJsonSafe } from './json/jsonSafe';

export {
  DEFAULT_MAX_RAW_OUTPUT_CHARS,
  DEFAULT_DIAGNOSTIC_SNIPPET_CHARS,
  diagnosticSnippet,
  extractJson
} from './json/extract';
export type { ExtractJsonOptions, JsonExtractionResult } from './json/extract';

/**
 * Typed response envelope.
 *
 * The core contract between LLM providers and host applications. Use this
 * group to define your domain payload type `P`, build the validator the
 * harness calls on every model turn, and get a typed result you can switch
 * on exhaustively.
 *
 * - `EnvelopeState` — `'proposal' | 'question' | 'analysis' | 'infeasible'`;
 *   `ENVELOPE_STATES` is the runtime list.
 * - `AgentEnvelope` — the state discriminator plus conditional fields
 *   (`questionText` when `question`; `explanation` when `analysis` /
 *   `infeasible`).
 * - `AgentTurn<P>` — envelope plus optional payload; payload exists iff
 *   state is `proposal`.
 * - `EnvelopePayloadValidator<P>` — host-supplied function validating the
 *   domain payload (`unknown` in, `PayloadResult<P>` out).
 * - `validateEnvelopeOutput(parsed, payloadValidator)` — the deterministic
 *   gate: JSON-safety, state enum, conditional fields, payload presence
 *   (required for `proposal`, forbidden otherwise), then payload validation.
 *   Returns `TurnResult<P>`.
 * - `ValidationFailure` / `ValidationFailureCode` — structured failures with
 *   optional `fieldPath`, never thrown.
 */
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

/**
 * Output degeneration detection.
 *
 * Some models (notably Gemini Flash with constrained decoding) fall into
 * token-repetition loops ("Slot Slot Slot…") until the token ceiling,
 * yielding unparseable JSON. Use this group when a turn fails extraction or
 * finishes with `MAX_TOKENS` and you need to distinguish a retryable
 * degeneration from a malformed-but-honest response.
 *
 * - `detectDegeneration(input, options?)` — pure check returning a
 *   `DegenerationVerdict`: `max_tokens` (suggestive) and/or
 *   `ngram_repetition` (conclusive), or `config_error` for bad options.
 * - `DEFAULT_DEGENERATION_WORD_THRESHOLD`,
 *   `DEFAULT_MAX_REPEAT_PERIOD_WORDS` — recommended defaults, overridable.
 */
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

/**
 * Retry policy.
 *
 * Vendor-agnostic classification of provider errors as transient vs
 * permanent, so a retry loop only re-attempts conditions that can succeed.
 *
 * - `isTransientProviderError(error)` — duck-typed check for rate limits and
 *   temporary unavailability (429/503, `RESOURCE_EXHAUSTED`/`UNAVAILABLE`,
 *   including codes embedded in JSON error messages).
 */
export { isTransientProviderError } from './policy/transientErrors';

/**
 * Debug & assertions.
 *
 * Zero-overhead, runtime-toggleable logging plus defensive invariant
 * assertions, shared across Node and browser environments. Use this group
 * instead of raw `console` calls anywhere inside a host application built on
 * this library.
 *
 * - `dbg` — structured logger (`log`/`warn`/`error`/`logObj`); produces no
 *   output and skips formatting unless debug mode is active.
 * - `isDebug()` / `setDebug(enabled)` — read/toggle debug mode; initially
 *   on when `DEBUG=true/1` env var, browser `localStorage.DEBUG`, or
 *   development/test `NODE_ENV`.
 * - `assert(condition, message?)` — internal-invariant assertion; throws
 *   `AssertionError` in debug mode, logs in production. For untrusted
 *   external input (LLM output, API payloads) use the envelope validators
 *   above instead.
 */
export { AssertionError, assert, dbg, isDebug, setDebug } from './debug/debug';
export type { DebugLogger } from './debug/debug';

/**
 * Tool contract (MCP-shaped, spec revision 2025-06-18).
 *
 * Declarative description of a tool the agent may call — the MCP `Tool` /
 * `CallToolResult` data contracts without the MCP wire protocol. Use this
 * group to register in-process tools with the harness: the contract is
 * rendered into the model request, arguments are validated against
 * `inputSchema` BEFORE the handler runs, and results come back as typed
 * `ToolResult`s (`isError` is in-band feedback, never an exception).
 *
 * - `ToolContract<I, R>` — MCP `Tool`: name/title/description/inputSchema/
 *   outputSchema/annotations (advisory, never enforced).
 * - `ToolResult<R>` — MCP `CallToolResult`, with the `content[]` array
 *   flattened to a single `text` channel.
 * - `ToolHandler<I, R>` — in-process handler; a throw is caught by the
 *   harness and converted to an in-band `isError` result.
 * - `validateToolArgs(tool, args)` — the pure pre-execution check (MCP
 *   "args-validate-before-execute" duty); pragmatic JSON-Schema subset,
 *   unknown keywords ignored.
 * - `JsonSchema` / `JsonSchemaObject` — minimal structural JSON Schema types
 *   shared with the contract manifest.
 *
 * Field-by-field MCP mapping: `docs/mcp-contract-mapping.md`.
 */
export {
  JsonSchemaTypeName,
  validateToolArgs
} from './tool/toolContract';
export type {
  JsonSchema,
  JsonSchemaObject,
  ToolAnnotations,
  ToolArgsValidation,
  ToolArgsViolation,
  ToolContract,
  ToolHandler,
  ToolResult
} from './tool/toolContract';

/**
 * Planned exports — NOT YET AVAILABLE. Do not import; these subpaths and
 * symbols are scheduled for later work packages and are listed here to make
 * the roadmap visible from the front door.
 *
 * - Contract manifest — envelope + payload schemas + tool declarations as one
 *   declarative SSOT, deriving both the tool schema and the prompt-rendered
 *   contract (belt and suspenders).
 * - `AgentHarness` executor — the tool-calling loop that drives a transport,
 *   validates each turn against the envelope, and returns the final
 *   `AgentTurn`.
 * - Record/replay transports — capture real model turns and replay them in
 *   tests without network access.
 * - Gemini transport — a concrete provider adapter, published behind the
 *   `./gemini` subpath so the core package stays vendor-free.
 */
