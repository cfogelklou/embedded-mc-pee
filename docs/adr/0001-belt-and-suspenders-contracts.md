# ADR 0001: Belt-and-Suspenders Contracts (Schema-in-Prompt over responseSchema)

- **Status**: Accepted
- **Date**: 2026-08-20

## Context

Gemini 3.x Flash models with `responseSchema` constrained decoding intermittently enter token-repetition loops that run to `MAX_TOKENS`, producing unparseable output. The risk grows with schema size — a ~70-property operations object triggered degeneration loops across gemini-3.5/3.6/3.7-flash. Evidence and diagnostic playbook: [gemini-debugging.md](../gemini-debugging.md). Upstream reports: [Google AI forum](https://discuss.ai.google.dev/t/structured-output-repetition-loop-inside-a-json-number-literal-runs-to-max-tokens-flash-vertex/175138), [google-gemini/cookbook#449](https://github.com/google-gemini/cookbook/issues/449).

## Decision

LLM calls with non-trivial output shapes send the JSON contract **in the prompt** (generated from the same single-source-of-truth manifest as the runtime validator), keep only `responseMimeType: 'application/json'`, and never set `responseSchema`. An error-level lint rule enforces the ban with an `eslint-disable-next-line` escape hatch for small, proven-stable schemas. Runtime degeneration detection short-circuits the model fallback chain after detecting repetition signatures.

## Consequences

- We lose constrained-decoding guarantees; runtime validation becomes the sole shape enforcement.
- Prompt contract and validator share the manifest SSOT, so they cannot drift.
- Small stable schemas (e.g., a single-field output) may still use `responseSchema` via the lint escape hatch.
- Degeneration detection adds guardrails against runaway loops; library surfaces structured errors rather than malformed JSON.

## Considered Options

- **Keep `responseSchema`, raise token ceiling** — rejected: loops are model-side; more tokens just make the garbage longer.
- **Slim the schema** — rejected: triggered `RECITATION` blocks in probes.
- **JSON-repair libraries** — rejected: repairing degenerate text yields plausible-shaped garbage; the deterministic validation boundary requires refusing to guess.

## Related

- [gemini-debugging.md](../gemini-debugging.md) — full evidence matrix and probing methodology
- [architecture.md](../architecture.md) § Transport layer — schema-in-prompt in the data flow
