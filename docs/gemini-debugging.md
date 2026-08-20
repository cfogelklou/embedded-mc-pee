# Gemini Debugging: Structured-Output Degeneration

**Date:** 2026-08-19 (port from courtpuzzle incident) · **Impact:** Model responses entered token-repetition loops producing unparseable output.

## Symptom

Every request failed with malformed JSON. Logs showed:

```
[Provider] JSON extraction failed: { model: 'gemini-3.5-flash', failureClass: 'malformed_json', rawCharCount: 7507 }
[Provider] Repair JSON extraction failed: { failureClass: 'malformed_json' }
[Provider] Request error: { model: 'gemini-3.6-flash', failureClass: 'timeout' }
```

## Probing methodology

Standalone probe scripts (run with `npx tsx`) replicate the exact API call — same system instruction, prompt shape, config — against the live API key. Each hypothesis becomes one config variation:

| Probe | Config | Result |
|---|---|---|
| 1 | Original: `responseSchema` + `maxOutputTokens: 2048` | `STOP`, valid JSON, but semantic drift (operations missing) |
| 2 | + `thinkingLevel: 'low'`, tokens 8192 | **Degeneration**: runaway repetition ("Slot Slot Slot…") until `MAX_TOKENS` |
| 3 | + `thinkingLevel: 'minimal'` | Worse degeneration: word-list loops |
| 4 | `gemini-3.6-flash`, `gemini-3.7-flash` with schema | Same repetition loops, different flavor |
| 5 | **No `responseSchema`** (JSON mime only) | `STOP`, clean, terse, valid JSON — field names drifted |
| 6 | Slimmed `responseSchema` (~12 fields) | `RECITATION` finishReason — response blocked |
| 7 | **No `responseSchema` + explicit JSON contract in prompt** | `STOP`, clean, terse, passed validation ✅ |

Key diagnostic: `usageMetadata.thoughtsTokenCount` counts against `maxOutputTokens`; thinking models burn the ceiling before emitting candidates. `rawCharCount` >> what the schema could produce (7507 chars) is the repetition-loop signature.

## Root cause

1. **Primary:** Gemini 3.x Flash + `responseSchema` constrained decoding intermittently enters token-repetition loops to `MAX_TOKENS`. Upstream issue confirmed.
2. **Aggravator:** `maxOutputTokens: 2048` was shared between thinking tokens and candidates.
3. **Fallback chain masked it:** all models degenerated; timeouts followed.

## Fix (shipped in courtpuzzle, ported to this library)

1. **Schema-in-prompt, not `responseSchema`.** Render the explicit JSON skeleton from the manifest — the same manifest the validator uses. Keep `responseMimeType: 'application/json'`.
2. **`maxOutputTokens: 8192`** — generous ceiling; malformed outputs caught by finishReason + validation.
3. **`thinkingConfig: { thinkingLevel: 'low' }`** — structured extraction needs little reasoning.
4. **Diagnostic logging:** extraction/validation failures log `finishReason` plus bounded raw snippets (`diagnosticSnippet()`, 200 chars each end).
5. **Brevity rules** in system instruction to keep prompts tight.

## Playbook for next time (any Gemini structured-output outage)

1. Read logs first: `malformed_json` + huge `rawCharCount` = repetition loop until proven otherwise.
2. Reproduce with standalone `npx tsx` probe; vary one parameter at a time. Check `finishReason` + `usageMetadata`.
3. First thing to try: **remove `responseSchema`**, put JSON contract in prompt. Keep JSON mime. Validate at runtime.
4. Keep contract generated from the same source as the validator (manifest), not hand-maintained templates.
5. Log bounded raw snippets on failure — you cannot diagnose what you cannot see.

## Related

- [ADR-0001](./adr/0001-belt-and-suspenders-contracts.md) — formal decision
- [architecture.md](./architecture.md) § Transport layer
