# Resilience and Clarification in the Agent Loop

**Status:** architectural guidance · **Scope:** proposal-only mutation boundary, deterministic validation, multilingual intent

## Outcome

The agent produces one valid, reviewable envelope; asks a precise follow-up question; gives a source-grounded analysis; or explains infeasibility. It must never claim "no changes" when it did not understand the request, silently ignore an operation, or expose a model/JSON error to the caller.

## Non-negotiable contracts

1. **Total response contract.** For every request, return a typed `ready`/`question`/`analysis`/`infeasible` envelope with safe, user-facing text. Expected model/provider/validation failures return structured errors, never raw exceptions.

2. **Proposal-only mutation.** The agent creates proposals only; the host application remains the sole mutation point, under transactional locking, deterministic validation, and audit.

3. **Executable means executable.** A tool may appear in the schema, prompt catalog, or a proposal only if validation and execution both implement it. Unknown or unavailable operations are rejected before any proposal is stored.

4. **Clarify rather than infer.** Missing required fields, ambiguous entity matches, malformed provider output, and no-op output from a tool request all become `question` or `infeasible` with an honest explanation.

5. **JSON-safe boundary.** Every value written to a proposal or returned by a library function must be recursively JSON-safe: finite numbers only, valid strings, arrays, and plain objects. `NaN`, `Infinity`, `-Infinity`, circular values, and invalid dates are rejected with field path recorded in diagnostics.

## The agent's plain-English tool catalog

The implementation creates one typed tool manifest supplying the tool union, model schema descriptions, required-field validation, user-facing proposal summaries, and the system-prompt catalog so they cannot drift. Tools are **proposed operations**, reviewed by a human or deterministic process, not direct database writes.

| Tool | Plain-English meaning | Minimum information / clarification rule |
| --- | --- | --- |
| Example tool names only — host apps define their own | See examples/ for concrete implementations | Ask only for genuinely required missing facts; never invent entities or attributes |

The response-only outcomes are explicit:

- `question`: missing or ambiguous fact. Return one focused question and relevant selectable options.
- `analysis`: answer a question about the supplied snapshot; distinguish "there is no approved proposal yet" from "there is a saved tentative record."
- `infeasible`: request cannot be represented safely or fails deterministic constraints. Explain the reason and realistic next step.

The prompt states that examples are semantic families, not keyword lists: understand the user's language first, map its meaning to the catalog, and preserve names/IDs from the snapshot.

## Implementation principles

1. **Remove fixed parsers.** No regex, keyword lists, taxonomy matchers, or language-specific intent parsers. The LLM interprets; deterministic code validates the typed proposal.
2. **Rewrite system instruction from the manifest/catalog.** Add required fields per tool, non-guessing policy, response-only outcomes, and compact multilingual paraphrase families.
3. **Make provider output recoverable, never deceptively successful.** Parse bare JSON and a single complete fenced JSON object only; reject trailing prose, truncated/balanced fragments, and oversized data. Map provider exhaustion, malformed JSON, schema failure, and empty operations to honest `question` envelopes.
4. **Apply JSON-safety guards.** Before every envelope write or library return, recursively validate finite values; convert invalid numerics to safe `infeasible`/`question` responses and identify corrupted field paths.
5. **Tests use record/replay fixtures.** No live LLM calls for unit tests. Intent corpus covers multilingual paraphrases; the runtime contract, not synonym lists, is the guarantee.

## Parallel implementation playbook

### Current reality

| Concern | SSOT | Important limitation |
| --- | --- | --- |
| Shared contract | `src/contract/` | Manifest exists but provider accepts weakly typed JSON |
| Provider seam | `src/transport/` | Calls `JSON.parse` directly; model fallback can surface malformed output |
| Validation | `src/validation/` | Validator exists but not yet integrated into provider flow |
| JSON-safety | `src/json/` | Utilities exist but not yet applied at all boundaries |

### Fixed product decisions

1. **LLM interprets, code verifies.** There is no fixed language parser, synonym map, or regex fallback.
2. **Examples teach concepts, not allowed words.** The prompt must state that items are illustrations. A user is never required to use specific terminology.
3. **Proposal before mutation.** The agent may propose creating or changing entities. It may not write them during interpretation.
4. **Unknown is safe.** An unfamiliar item is not unsupported merely because unfamiliar. Ask for required information; reserve `infeasible` for real limitations.

### Agent work packets and merge order

| Order / owner | Owns | Must not do |
| --- | --- | --- |
| A — Contract agent | Manifest, runtime validator, static fixtures | Edit provider or execution |
| B — Provider agent | Prompt, bounded extraction/repair, telemetry | Add parser rules or duplicate validator |
| C — Orchestrator agent | Handler, execution, validation integration | Show provider exception text |
| D — Test agent | Fixtures, replay tests, regression corpus | Call live LLM in unit tests |

### Required APIs and responsibility boundaries

**A's validator API** must be consumed by B and C, not copied:

```ts
export interface ValidatedEnvelope { /* closed response union */ }
export interface ValidationFailure {
  code: 'malformed_json' | 'schema_invalid' | 'unsupported_tool' |
        'invalid_value' | 'non_finite_value';
  fieldPath?: string;
  safeMessage: string;
}

export function validateEnvelope(
  value: unknown,
  manifest: ToolManifest
): { ok: true; value: ValidatedEnvelope } |
   { ok: false; failure: ValidationFailure };
```

**B's provider API** returns either a validated output or a typed recoverable failure. It never throws a model-string error.

**C's handler API** maps recoverable failure to `Envelope.kind === 'question'`, persists only fully validated and JSON-safe proposals, and uses the exact same manifest to reject a tool the executor cannot apply.

## Acceptance criteria

- Every response is JSON-safe and has a defined rendering. Provider/model failure has a useful recovery route.
- Every advertised tool is either validated and executed, or rejected before proposal creation. There are no silent no-ops.
- A multilingual intent corpus passes without requiring live model responses.
- Record/replay fixtures cover clean JSON, fenced objects, trailing prose, truncated output, schema-invalid JSON, repair success/failure, and exhaustion.
