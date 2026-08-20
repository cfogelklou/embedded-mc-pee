# MCP Contract Mapping

How `embedded-mc-pee`'s tool contract (`src/tool/toolContract.ts`) maps to the
Model Context Protocol specification, revision **2025-06-18** (Tools page).
Source of truth for the MCP shapes: the `mcp-contracts` skill
(`courtpuzzle/.claude/skills/mcp-contracts/SKILL.md`); keep the two documents
consistent.

**What we mirror:** the *data contracts* — `Tool`, `CallToolResult`,
`ToolAnnotations` — so tool definitions and results are shaped exactly like
MCP's, and any host or model familiar with MCP tool calling reads them
natively.

**What we do not run:** the MCP protocol. This library embeds tool contracts
into direct LLM SDK calls (the host registers `ToolContract`s in code; the
harness renders them into the request and invokes `ToolHandler`s in-process).
No JSON-RPC, no server/client roles, no wire format — hence the scoped-out
list at the bottom.

---

## Field-by-field mapping

### MCP `Tool` ↔ `ToolContract<I, R>`

| MCP `Tool` (2025-06-18) | `ToolContract<I, R>` | Notes |
|---|---|---|
| `name: string` (required, unique) | `name: string` | Required. MCP: caller-visible tool identifier. |
| `title?: string` | `title?: string` | Added in the 2025-06-18 revision; human-readable display title. |
| `description?: string` | `description?: string` | MCP: "can be used by the model itself" — the harness sends it to the model. |
| `inputSchema: object` (required) | `inputSchema: JsonSchemaObject` (required) | MCP: a JSON Schema object describing the arguments. Locally typed as a minimal structural `JsonSchemaObject`; validated by the pragmatic subset below, not by a full JSON Schema validator. |
| `outputSchema?: object` | `outputSchema?: JsonSchemaObject` | Added 2025-06-18. When declared, the handler's `structuredContent` MUST conform (harness duty, below). |
| `annotations?: ToolAnnotations` | `annotations?: ToolAnnotations` | Advisory metadata — mapped 1:1, see next table. Never enforced. |
| `_meta?: object` | *(scoped out)* | `_meta` is a protocol extensibility bag for MCP peers; an in-process library has no peer to negotiate extensions with. Hosts attach their own fields outside the contract if needed. |

### MCP `ToolAnnotations` ↔ `ToolAnnotations`

1:1 mapping; all fields advisory (MCP: "hints for hosts and humans, not
enforced by the protocol"). Defaults below are the MCP/JSON Schema boolean
defaults a *consumer* must apply when the field is omitted — this library
carries the values through and attaches no semantics to them.

| MCP field | Library field | Default when omitted (MCP) |
|---|---|---|
| `title?: string` | `title?: string` | — |
| `readOnlyHint?: boolean` | `readOnlyHint?: boolean` | `false` |
| `destructiveHint?: boolean` | `destructiveHint?: boolean` | `true` |
| `idempotentHint?: boolean` | `idempotentHint?: boolean` | `false` |
| `openWorldHint?: boolean` | `openWorldHint?: boolean` | `true` |

### MCP `CallToolResult` ↔ `ToolResult<R>`

| MCP `CallToolResult` (2025-06-18) | `ToolResult<R>` | Notes |
|---|---|---|
| `content?: ContentBlock[]` | *(flattened)* → `text?: string` | See "The content[] → text decision" below. |
| `structuredContent?: object` | `structuredContent?: R` | Primary machine-readable channel. MUST conform to `outputSchema` when the tool declares one (MCP structured-content rule). MCP also says `structuredContent` should be reproducible from `content`; we treat `structuredContent` as primary and `text` as the flattened human channel. |
| `isError?: boolean` | `isError?: boolean` | `true` = tool execution failed; **in-band** feedback to the model, never a turn abort (see duties). |

Also mapped, in the same module:

| MCP concept | Library concept |
|---|---|
| Tool handler (server-side execution of `tools/call`) | `ToolHandler<I, R> = (input: I) => Promise<ToolResult<R>> \| ToolResult<R>` |
| `tools/list` | Not applicable — the host registers `ToolContract`s directly; there is no registry protocol. |
| `tools/call` | `ToolHandler` invocation by the harness executor (`AgentHarness.runTurn`, WP-F). |

## The `content[]` → `text` decision

MCP results carry a `content` array of typed blocks (`TextContent`,
`ImageContent`, `AudioContent`, `EmbeddedResource`). This library flattens it
to a single optional `text: string`:

- Tool results here are programmatic values produced in-process, not
  user-generated media. The machine-readable channel is `structuredContent`;
  the human/model-facing channel is one string. Multi-block content arrays,
  images, audio, and embedded resources have no in-process producer in this
  library's scope.
- A flat `text` field keeps `ToolResult` JSON-safe and trivially serializable
  for record/replay, traces, and host logging — no block-type discrimination
  at every read site.
- Hosts needing rich content can put it in `structuredContent` (typed by
  `outputSchema`) — the MCP back-compat spirit (`structuredContent`
  reproducible from `content`) is preserved by construction: `text` may
  carry the rendered form.

## Harness duties (implemented in the executor, WP-F)

The pure `validateToolArgs(tool, args)` in this module is the shared check
behind duty 1. All duties mirror the MCP error-handling convention: protocol
errors (bad arguments) and execution errors (tool failed) both become in-band
feedback, never exceptions.

1. **Validate args before execute.** The harness validates the model's
   tool-call arguments against the tool's `inputSchema` *before* invoking the
   handler (MCP: the server MUST validate before execution). Invalid → the
   handler is **NOT invoked**; the harness synthesizes a `ToolResult` with
   `isError: true` and the validation message, and feeds it back so the model
   can self-correct on the next iteration. The call **counts against tool
   caps** (it consumed a tool-call slot).
2. **Validate `structuredContent` against `outputSchema`** when the tool
   declares one; mismatch → `isError: true` result with a message (MCP
   structured-content rule).
3. **Handler throw → caught + narrowed → in-band error.** The executor
   catches (`catch (err: unknown)`, narrowed to a message) and converts to an
   `isError: true` `ToolResult`. No tool-handler exception ever propagates
   past the turn boundary.
4. **`isError` is feedback, not failure.** `isError: true` means the tool was
   invoked and failed; the result is still returned to the model as input for
   the next iteration. It never aborts the turn by itself — only the
   harness's own caps/budgets/degeneration guards do that.

### What `validateToolArgs` checks (pragmatic JSON Schema subset)

- Root: `args` must be a non-null, non-array object at path `'$'` (tool
  arguments are objects in MCP), unless the schema explicitly declares
  another root `type`.
- `required` — each listed property must be present (own-property check);
  missing → violation at `$.<name>`.
- Declared `type` per property: `string`, `number` (finite), `integer`,
  `boolean`, `object`, `array`, `null`. Mismatch → violation at the value's
  path.
- `enum` — the value must be `===`-equal to one of the listed values.
- `items` — applied to every array element (`$.<name>[<index>]` paths).
- Nested `object` schemas validated recursively.

**Unknown keywords are ignored** (`pattern`, `minLength`, `minimum`,
`additionalProperties`, `oneOf`, array/string-form `type`, vendor extensions,
…). This is deliberately NOT full JSON Schema validation; hosts needing the
full dialect can run their own validator before binding a tool. Validation
is pure: never throws, never mutates inputs.

## Scoped out (and why)

One line each; all share the same root reason — **this library embeds tool
contracts into direct SDK calls; there is no protocol.**

- **JSON-RPC** — MCP's wire format; in-process calls are plain function invocations.
- **stdio / HTTP transports** — transport is the host's SDK; the library is transport-agnostic behind `LlmTransport`.
- **Sessions / initialization** — no client–server lifecycle exists in an embedded library.
- **Sampling** (server-requesting-model-completions) — the harness owns the single model loop; tools are deterministic code, not nested model calls.
- **Notifications / callbacks** (e.g. `notifications/tools/list_changed`) — no registry to keep in sync; tools are registered in code per run.
- **`content[]` block arrays** (text/resource/image/audio/link) — flattened to `text`; see the decision above.
- **`_meta`** — protocol extensibility bag; no peer to negotiate with.
- **Elicitation** — no interactive end-user to elicit from inside a backend turn; ambiguity becomes a `question` envelope instead.
- **Roots** — filesystem-scope concept; the harness receives full state in the prompt, not a workspace.
- **Completion** (argument autocompletion) — no interactive client to serve completions to.
- **Logging** (`notifications/message`) — the library logs through its own `dbg` channel, not a protocol stream.
- **Progress** (progress notifications for long-running calls) — an async `ToolHandler` may take time, but there is no notification channel; hosts observe completion via the returned promise and trace.
