# embedded-mc-pee TypeScript Guidelines

The one-sentence version: **think of the type system like C++ headers — one definition of every shape, referenced everywhere, with every function's parameter and return types pre-declared at the signature.**

## 1. Types are contracts

A type in this library is not documentation; it is the contract between the library and the host application. Duplication of a type definition is a bug even when the copies currently agree — they will drift.

## 2. Shared contracts live in one place

Public types used by both the library and host applications are declared once in `src/` and exported via `index.ts`. Never re-declare a type at a call site.

## 3. Explicit signatures — pre-declared types in and out

Every exported function declares its **parameter types and its return type** explicitly. No inferred boundaries.

```typescript
// BAD — untyped param, inferred return
export function computeLanes(venue) { ... }

// GOOD — the signature is the contract
export function computeLanes(venue: Venue): Lane[] { ... }
```

## 4. No magic strings / magic numbers

Define standard values **in one place** (enum / `UPPER_CASE` constant) and refer to them everywhere.

```typescript
// BAD
if (allocation.kind === 'tentative') { ... }

// GOOD
if (allocation.kind === SupplyKind.TENTATIVE) { ... }
```

- **Tests MUST import the same constants as the source.** A hardcoded copy in a test silently keeps testing the old value after the constant changes.
- **Literals that cross a boundary or repeat are named exports.** If a literal appears in more than one file, or both library and host must agree on it — it is a named export. Single-use display text may stay inline.

## 5. Type safety & runtime error prevention

- **No `any`** unless absolutely necessary; prefer `unknown` + type guards.
- **No `as any`** and no type assertions in logic — narrow with type guards, assign the narrowed value to a `const`, use it consistently.
- **No loose Record types**: do not use `Record<string, ...>` when a domain union or enum exists. Use `Record<Union, ...>` so TypeScript enforces exhaustive keys at compile time.
- **Exhaustive switch checks**: `switch` statements over discriminated unions must be exhaustive. If a `default` case is needed, use `assertNever(x)` so newly added union members fail compilation or execution immediately.
- **No silent error swallowing**: catch blocks must never be silently empty. Catch `(err: unknown)`, narrow (`err instanceof Error ? err.message : ...`), and either rethrow, log via debug logger, or return a structured typed error result.
- **For interfaces with 5+ fields, provide a `DEFAULT_<TYPENAME>` constant.**
- **Prefer `switch` over long `if/else` chains for modes/types.**

## 6. Defensive programming & assertions

Use `assert(condition, message)` for internal invariants. Untrusted external data (API requests, LLM output) must be validated with typed schemas returning structured errors rather than throwing unhandled exceptions.

## 7. Standardized debug logging

Zero unstructured `console.log` statements in production code. Use the centralized debug logger from `src/debug/`.

- **Zero overhead when disabled**: produces no console output unless debug mode is active.
- **Runtime enablement**: execute with `DEBUG=true` or `DEBUG=1` in the environment.
- **Structured formatting**: debug messages include timestamps and structured object formatting.

```typescript
import { dbg } from './debug';

dbg.log('Processing request:', requestId);
dbg.logObj('Validation result:', result);
```

## 8. Path aliases — never deep relative paths

- Use `@/` for `src/` imports (configured in tsconfig.json)
- Never use `../../..` chains — they break when files move

## 9. Tests and naming

- **Behavior-focused tests**: test functionality, contracts, and edge cases — not exact formatting.
- **Never test copy strings** — test structure, behaviour, data wiring.
- Naming: types/interfaces `PascalCase`; variables/functions `camelCase`; constants `UPPER_CASE`.
- **No live network calls in unit tests**: use record/replay fixtures for LLM interactions.

## 10. Change protocol: adding a field to a public type

1. Declare it on the interface (one definition).
2. Update validation logic to enforce the new field.
3. Update the `DEFAULT_*` constant if applicable (5+ fields).
4. Update tests to assert the new field round-trips.
5. Update JSDoc if the field has user-visible semantics.

## 11. JSON-safety boundary

Every value written to an envelope or returned by a library function must be recursively JSON-safe: finite numbers only, valid strings, arrays, and plain objects. `NaN`, `Infinity`, `-Infinity`, circular values, and invalid dates are rejected with a field path recorded in diagnostics.
