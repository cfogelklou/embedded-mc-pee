# embedded-mc-pee AI Instructions

Single source of truth for AI-agent instructions. This is an open-source TypeScript library for embedding tool-calling LLM intelligence into backends — MCP-shaped contract, direct SDK transport, deterministic validation, record/replay.

## Commands

- **Development**: `npm run dev` (examples only; library has no dev server)
- **Unit Tests**: `npm test` (`vitest run`)
- **Build**: `npm run build` (`tsup`)
- **Lint**: `npm run lint`
- **Typecheck**: `npm run typecheck` (`tsc --noEmit`)
- **Examples tests**: `npm run test:examples` (live Gemini, requires GEMINI_API_KEY)

## Communication

– If you cannot verify something directly, say:
  – “I cannot verify this.”

– Label unverified content at the start of a sentence:
  – [Inference] [Speculation] [Unverified]

– Ask for clarification if information is missing. Do not guess or fill gaps.

– If any part is unverified, label the entire response.

– Do not paraphrase or reinterpret my input unless I request it.
– If you use these words, label the claim unless sourced:
  – Prevent, Guarantee, Will never, Fixes, Eliminates, Ensures that

– For LLM-behavior claims (including yourself), include:
  – [Inference] or [Unverified], with a note that it’s based on observed patterns

## Non-negotiable rules

1. **Fix all `tsc` and lint errors before finishing a task** — including pre-existing ones. Mechanical cleanup may be delegated to a cheaper subagent.

2. **Types are contracts**: Every exported function declares parameter **and** return types explicitly. No inferred returns on exported symbols. Shared shapes (envelope types, tool schemas, validation contracts) live in one place and are imported everywhere. Never duplicate type definitions across files. **No inline `import('...')` type references** — all imports are declared at the top of the file (`import type { X } from ...`); mid-code lazy imports hide dependencies and are banned (enforced by eslint `no-restricted-syntax` on `TSImportType`).

3. **No magic strings crossing boundaries**: Any literal in more than one file, or that library and host must agree on, is a named export. Single-use display text may stay inline.

4. **Explicit signatures**: Pre-declare parameter and return types on all exports. Hooks and helpers return pre-declared interfaces.

5. **Assertions & logging**: Use `assert(condition, message)` for internal invariants. Untrusted external input (LLM output, API payloads) uses typed validators and structured errors. Zero raw `console.log` in production code; use centralized debug logger from `src/debug/` (zero overhead when disabled).

6. **Type safety**: No `any` / `as any`; prefer `unknown` + type guards. Use `Record<Union, ...>` never loose `Record<string, ...>` when a union exists. Exhaustive switches — `assertNever(x)` in `default`. No silent catch: `catch (err: unknown)`, narrow, then rethrow or return a typed error.

7. **Tests**: Behavior-focused, deterministic, no live network calls in unit tests. Import the same constants as the source. Never test UI copy or exact formatting.

8. **Record discovered debt**: Stale code, fork debris, compromised implementations go into `docs/tech-debt-db.md` (or verified already recorded) before finishing.

9. **No AI attribution**: No AI attribution in commits, PRs, changelogs, or any repo content.

10. **Strict scope discipline**: Do exactly what was requested. Plan / record debt / document means exactly that — never speculatively modify code without explicit instruction.

## Expanded reference

See [docs/guidelines-typescript.md](docs/guidelines-typescript.md) for complete TypeScript coding guidelines.

## Architecture

See [docs/architecture.md](docs/architecture.md) for module map, data flow, and determinism principles.


