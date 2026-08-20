# embedded-mc-pee Architecture

Library architecture: module map, data flow, determinism principles, and separation of concerns.

## Module map (target architecture)

```
src/
├── index.ts                    # Version constant, main exports (WP-A placeholder)
├── gemini/
│   └── index.ts               # Gemini transport (WP-A placeholder, WP-B)
├── json/                      # JSON-safety utilities
│   ├── assertJsonSafe.ts
│   └── isJsonSafe.ts
├── envelope/                  # Envelope state machine types
│   └── types.ts               # 'proposal' | 'question' | 'analysis' | 'infeasible'
├── tool/                      # Tool declaration and execution
│   ├── types.ts               # ToolManifest, ToolDefinition
│   └── executor.ts            # Tool execution loop
├── contract/                  # Contract assembly
│   ├── createContract.ts      # Contract factory
│   └── types.ts               # Contract interface
├── transport/                 # LLM provider abstraction
│   ├── types.ts               # Transport interface, Request/Response
│   └── recordReplay.ts        # Decorator for capture/replay
├── validation/                # Deterministic validation
│   ├── validator.ts           # Envelope validation from manifest
│   └── diagnostics.ts         # Degeneration detection, snippets
├── policy/                    # Policy and guardrails
│   ├── maxIterations.ts       # Tool loop iteration cap
│   └── types.ts               # Policy configuration
└── debug/                     # Debug logging
    ├── index.ts               # dbg logger export
    └── logger.ts              # Zero-overhead conditional logging
```

## Data flow

```
Host application
       │
       ▼
createContract(manifest)
       │
       ▼
createHarness({ contract, transport, policy })
       │
       ▼
runTurn({ systemInstruction, userMessage, initialState? })
       │
       ├─→ Prompt assembly (system instruction + contract in prompt + tools)
       │
       ├─→ Transport layer (LLM call via SDK)
       │        │
       │        ├─→ Record/replay decorator (capture)
       │        │
       │        └─→ Provider (Gemini, others)
       │
       ├─→ Normalization (raw text → JSON extraction)
       │
       ├─→ Degeneration detection (repetition loops)
       │
       ├─→ Validation (manifest-based envelope validation)
       │
       └─→ Envelope out (typed proposal/question/analysis/infeasible)
```

### Determinism principles

1. **Validation as sole shape enforcement** — runtime validator is the only contract enforcement; prompt and validator share the manifest SSOT so they cannot drift (ADR-0001).

2. **Injected clock/ids** — for record/replay and deterministic tests, the library accepts injected sources of time and randomness. Production defaults to `Date.now()` and `crypto.randomUUID()`.

3. **Canonical hashing** — when hashing for deduplication or caching, use stable JSON serialization (`JSON.stringify` with sorted keys) before hashing.

4. **Proposal-only mutation** — the library never writes directly to storage. It produces typed envelopes; the host application decides whether and how to apply proposals.

5. **Tool loop with iteration cap** — the agentic loop executes tools with a configurable `maxIterations` default (default 1 for single-turn proposals). Each iteration: execute tools → feed results back → request next model turn → repeat until `maxIterations` or terminal state.

## Module responsibilities

### Core (no runtime dependencies)

- **json/** — JSON-safety assertions and type guards. Recursively validates values are finite, non-circular, and JSON-serializable.
- **envelope/** — Typed discriminated union for the four envelope kinds. Closed union; `assertNever` guard on unknown kinds.
- **tool/** — Tool declaration schema and execution loop. Manifest maps tool names to input/output schemas and handler functions.
- **contract/** — Contract assembly from manifest. Renders the prompt-rendered JSON contract from the same manifest as the validator (ADR-0001).
- **validation/** — Deterministic envelope validator. Checks required fields, enum values, finite numbers, referential integrity.
- **policy/** — Guardrails: maxIterations, timeout budgets, size limits.
- **debug/** — Zero-overhead conditional logging. Enabled via `DEBUG=true` environment variable.

### Transport (peer dependencies)

- **transport/** — Abstraction over LLM providers. Interface for `send(request)` returning normalized `Response`.
- **transport/recordReplay** — Decorator capturing live LLM calls to fixtures for deterministic replay.
- **gemini/** (subpath export) — Concrete transport for `@google/genai`. Uses SDK directly (not MCP protocol).

### Host application responsibilities

- Provide prompts, system instructions, and domain state
- Define tools and their handlers
- Decide whether to apply proposals
- Handle persistence and transactions
- Provide user-facing rendering

## Work package map

- **WP-A** (this package): Scaffold library, placeholders, docs, CI/CD
- **WP-B**: Gemini transport implementation
- **WP-C**: Contract assembly, prompt rendering, validation
- **WP-D**: Tool loop, policy enforcement, record/replay
- **WP-X**: Examples, live tests

## Extension points

1. **Transports** — implement the `Transport` interface for any LLM provider (OpenAI, Anthropic, etc.). No MCP protocol required; direct SDK calls.
2. **Tools** — host apps define tool handlers; library provides execution loop and iteration cap.
3. **Validation rules** — manifest declares required fields, enum constraints, referential integrity rules; library enforces.
4. **Policy modules** — inject custom policies for rate limiting, cost caps, content filtering, etc.

## Non-goals

- NOT an MCP server or client — no JSON-RPC, no stdio/HTTP transports
- NOT a standalone agent — requires host app to define tools and prompts
- NOT a database layer — no persistence; host app owns storage
- NOT a UI library — no rendering; host app owns user interaction
