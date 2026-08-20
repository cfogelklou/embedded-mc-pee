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
 * - `setDebugSink(sink | null)` / `getDebugSink()` — install a
 *   caller-provided output sink so library debug output routes to the host's
 *   logging library (e.g. Firebase Functions `logger`) instead of raw
 *   console; `null` restores `DEFAULT_DEBUG_SINK`. Process-global; install
 *   once at host startup. Zero overhead when debug is disabled.
 * - `isDebug()` / `setDebug(enabled)` — read/toggle debug mode; initially
 *   on when `DEBUG=true/1` env var, browser `localStorage.DEBUG`, or
 *   development/test `NODE_ENV`.
 * - `assert(condition, message?)` — internal-invariant assertion; throws
 *   `AssertionError` in debug mode, logs in production. For untrusted
 *   external input (LLM output, API payloads) use the envelope validators
 *   above instead.
 */
export {
  AssertionError,
  assert,
  dbg,
  isDebug,
  setDebug,
  DEFAULT_DEBUG_SINK,
  getDebugSink,
  setDebugSink
} from './debug/debug';
export type { DebugLevel, DebugLogger, DebugSink } from './debug/debug';

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
 * Contract manifest — one declarative SSOT, two derived artifacts.
 *
 * Per ADR-0001 (belt and suspenders), the tool schema AND the prompt-rendered
 * contract text are both DERIVED from a single {@link ContractManifest}, so
 * they can never drift — and no giant `responseSchema` is ever sent to the
 * model; the prompt text carries the contract. Use this group to declare your
 * domain payload schema once and hand the resulting {@link Contract} to the
 * harness.
 *
 * - `ContractManifest` / `EnvelopeFieldSpec` / `EnvelopeConditionalField` —
 *   the declarative manifest (envelope state list + conditional field rules +
 *   host payload JSON Schema + optional metadata).
 * - `createContract(manifest, validateHostPayload, options?)` — validates the
 *   manifest (typed failure list, never throws), canonicalizes it (sorted keys
 *   → byte-stable derived artifacts regardless of host key insertion order),
 *   and returns a `Contract` with both derived artifacts plus the wrapped
 *   payload validator (unknown top-level payload keys rejected by default,
 *   `'ignore'` policy available).
 * - `Contract<P>` — the validated, self-contained contract object.
 * - `deriveToolSchema` / `renderPromptContract` / `canonicalizeManifest` — the
 *   pure derivation functions, exported for hosts hashing or diffing manifests.
 * - `lintContract(contract | manifest, thresholds?)` — payload schema
 *   complexity gate (properties/depth/leaves, warn + error tiers) for host CI;
 *   thresholds caller-configurable via `LintThresholds`.
 */
export { KNOWN_ENVELOPE_CONDITIONAL_FIELDS } from './contract/manifest';
export type {
  EnvelopeConditionalField,
  EnvelopeFieldSpec,
  ContractManifest
} from './contract/manifest';
export { canonicalizeManifest, deriveToolSchema, renderPromptContract } from './contract/derive';
export type { CanonicalManifest, CanonicalEnvelopeFieldSpec } from './contract/derive';
export { createContract } from './contract/contract';
export type {
  Contract,
  CreateContractOptions,
  CreateContractResult,
  ManifestFailure,
  ManifestFailureCode
} from './contract/contract';
export {
  DEFAULT_WARN_MAX_PROPERTIES,
  DEFAULT_ERROR_MAX_PROPERTIES,
  DEFAULT_WARN_MAX_DEPTH,
  DEFAULT_ERROR_MAX_DEPTH,
  DEFAULT_WARN_MAX_LEAVES,
  DEFAULT_ERROR_MAX_LEAVES,
  lintContract
} from './contract/lint';
export type { ContractLintFinding, LintThresholds } from './contract/lint';

/**
 * LLM transport contract (vendor-neutral).
 *
 * The harness talks to models ONLY through {@link LlmTransport} — provider
 * SDKs live behind thin adapters (see the planned `./gemini` subpath), so the
 * core package stays dependency-free and every transport is record/replayable.
 * The transport receives BOTH belt-and-suspenders artifacts in every
 * {@link LlmRequest} (`toolDeclarations` + the prompt-rendered contract inside
 * `promptText`) and returns RAW signals ({@link LlmResponse} with `rawText`
 * and optional `toolCall`); the harness — never the transport — applies
 * candidate normalization and precedence.
 *
 * - `LlmTransport.complete(req, {timeoutMs})` — may reject; the harness
 *   catches and classifies transient vs permanent.
 * - `LlmResponse` — raw text + optional tool call + finishReason + usage.
 * - `ToolBinding` — contract + handler pair the harness registers.
 * - `TurnTrace` / `TraceEntry` — full audit trail of a turn (model calls,
 *   tool calls, repairs, fallbacks, decisions), timestamps from injected
 *   clock.
 * - `HarnessTelemetryEvent` — observability stream via
 *   `HarnessOptions.onTelemetry`.
 * - `IterationContext` — per-iteration budget facts passed to
 *   `onIterationContext` for dynamic prompt lines.
 * - `HarnessResult` / `AgentHarness` / `HarnessTurnInput` — the turn-level
 *   API surface.
 */
export type {
  AgentHarness,
  FailureContext,
  HarnessResult,
  HarnessTelemetryEvent,
  HarnessTurnInput,
  IterationContext,
  LlmRequest,
  LlmResponse,
  LlmTransport,
  ToolBinding,
  TraceEntry,
  TurnTrace
} from './transport/types';

/**
 * Harness executor — the policy loop that drives a transport to a validated
 * envelope.
 *
 * `createHarness(options, contract)` builds an {@link AgentHarness} that runs
 * one turn: model fallback chain, iteration + tool budgets, tool-call
 * protocol (args validated BEFORE handler, in-band errors), candidate
 * normalization (tool call wins, ambiguity telemetry), degeneration
 * detection, transient backoff, and one repair retry with an error preamble.
 * `runTurn` NEVER rejects — every terminal condition is a typed
 * {@link HarnessResult} (`ok` turn, or `exhausted` / `budget` /
 * `all_fallbacks` with a safe fallback envelope from the host).
 *
 * All behavioral constants are tunables: exported `DEFAULT_*` recommended
 * defaults, caller overrides via {@link HarnessOptions}. Deterministic in
 * tests via injected `now` / `idFactory` / `sleep`.
 */
export {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_PER_MODEL_TIMEOUT_MS,
  DEFAULT_TOTAL_BUDGET_MS,
  DEFAULT_MAX_REPAIRS,
  DEFAULT_MAX_DEGENERATIONS_BEFORE_ABORT,
  DEFAULT_TRANSIENT_BACKOFF_MS,
  DEFAULT_MAX_TRANSIENT_RETRIES_PER_MODEL,
  DEFAULT_MAX_TOOL_CALLS_PER_ITERATION,
  DEFAULT_MAX_TOTAL_TOOL_CALLS,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_THINKING_LEVEL,
  DEFAULT_MIN_BUDGET_FOR_REPAIR_MS,
  createHarness
} from './policy/executor';
export type {
  ConfigFailure,
  ConfigFailureCode,
  CreateHarnessResult,
  HarnessOptions
} from './policy/executor';

/**
 * Planned exports — NOT YET AVAILABLE. Do not import; these subpaths and
 * symbols are scheduled for later work packages and are listed here to make
 * the roadmap visible from the front door.
 *
 * - Record/replay transports — capture real model turns and replay them in
 *   tests without network access.
 * - Gemini transport — a concrete provider adapter, published behind the
 *   `./gemini` subpath so the core package stays vendor-free.
 */
