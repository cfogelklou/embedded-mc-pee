/**
 * MCP-shaped tool contract (spec revision 2025-06-18).
 *
 * Mirrors the MCP data contracts for tools — {@link ToolContract} (MCP `Tool`),
 * {@link ToolResult} (MCP `CallToolResult`), and {@link ToolAnnotations} —
 * without running the MCP wire protocol. The host registers tool contracts
 * directly; the harness invokes {@link ToolHandler} functions in-process over
 * a direct SDK transport. Field-by-field mapping:
 * `docs/mcp-contract-mapping.md`.
 *
 * This module is pure TypeScript with zero imports: self-contained types plus
 * a pragmatic JSON-Schema-subset argument validator
 * ({@link validateToolArgs}) shared with the harness executor, which enforces
 * the MCP duty "validate arguments against `inputSchema` BEFORE execution".
 */

// ============================================================================
// JSON Schema subset
// ============================================================================

/**
 * Type names recognized by {@link validateToolArgs}.
 *
 * These are the JSON Schema primitive types the validator knows how to check.
 * Any other `type` value is treated as an unknown keyword and ignored.
 */
export type JsonSchemaTypeName =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

/**
 * Minimal structural type for a JSON Schema (value) node.
 *
 * Permissive by design: unknown schema keywords are carried by the index
 * signature and **ignored** by {@link validateToolArgs}. This type exists so
 * tool contracts are typed at the boundary; it is NOT a full JSON Schema
 * dialect and this module performs NO full JSON Schema validation — only the
 * pragmatic subset documented on {@link validateToolArgs}.
 */
export interface JsonSchema {
  /** Declared JSON primitive type; absent means "any type". */
  readonly type?: JsonSchemaTypeName;
  /** Property sub-schemas, consulted for present properties. */
  readonly properties?: { readonly [propertyName: string]: JsonSchema | undefined };
  /** Property names that must be present. */
  readonly required?: readonly string[];
  /** Item schema applied to every element of an array value. */
  readonly items?: JsonSchema;
  /** Allowed literal values; a value must be one of them (`===`). */
  readonly enum?: readonly unknown[];
  /** Any other JSON Schema keyword — carried, never validated here. */
  readonly [keyword: string]: unknown;
}

/**
 * Minimal structural type for a root JSON Schema describing an object.
 *
 * The shape MCP requires for `Tool.inputSchema` / `Tool.outputSchema`
 * (2025-06-18: "a JSON Schema object"). Permissive: unknown keywords are
 * carried by the inherited index signature and ignored during validation.
 */
export interface JsonSchemaObject extends JsonSchema {
  /** Root schemas for tool input/output describe a JSON object. */
  readonly type: 'object';
}

// ============================================================================
// Tool contract (MCP: Tool)
// ============================================================================

/**
 * Advisory tool metadata — MCP: `Tool.annotations` (2025-06-18).
 *
 * All fields are hints for hosts and humans; neither the harness nor this
 * library enforces them semantically. Defaults per the MCP spec apply when a
 * field is omitted by the client/consumer, matching JSON Schema boolean
 * defaults: `readOnlyHint` false, `destructiveHint` true,
 * `idempotentHint` false, `openWorldHint` true.
 */
export interface ToolAnnotations {
  /** Human-readable display title for the tool. */
  readonly title?: string;
  /** If true, the tool does not modify its environment. MCP default: false. */
  readonly readOnlyHint?: boolean;
  /** If true, the tool may perform destructive updates. MCP default: true. */
  readonly destructiveHint?: boolean;
  /** If true, calling the tool repeatedly with the same arguments has no additional effect. MCP default: false. */
  readonly idempotentHint?: boolean;
  /** If true, the tool may interact with an "open world" of external entities. MCP default: true. */
  readonly openWorldHint?: boolean;
}

/**
 * Declarative description of a tool the agent may call — MCP: `Tool`
 * (2025-06-18). The host registers contracts directly (no `tools/list`);
 * the harness renders them into the model request and validates calls
 * against `inputSchema` before invoking the handler.
 *
 * @template I - Input type the handler receives (validated against `inputSchema`)
 * @template R - Structured output type (validated against `outputSchema` when declared)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- I/R are binding-site type parameters (cf. ToolBinding: ToolHandler<I, R> over ToolContract<I, R>); the contract shape itself is generic-free per the MCP Tool mapping.
export interface ToolContract<I = unknown, R = unknown> {
  /** Tool identifier; required and unique within a harness run. MCP: `Tool.name`. */
  readonly name: string;
  /** Human-readable display title. MCP: `Tool.title` (added 2025-06-18). */
  readonly title?: string;
  /** What the tool does; may be consumed by the model itself. MCP: `Tool.description`. */
  readonly description?: string;
  /** JSON Schema the call arguments must satisfy. MCP: `Tool.inputSchema` (required). */
  readonly inputSchema: JsonSchemaObject;
  /** JSON Schema the handler's `structuredContent` must satisfy. MCP: `Tool.outputSchema` (added 2025-06-18). */
  readonly outputSchema?: JsonSchemaObject;
  /** Advisory metadata, never enforced. MCP: `Tool.annotations`. */
  readonly annotations?: ToolAnnotations;
}

// ============================================================================
// Tool result (MCP: CallToolResult)
// ============================================================================

/**
 * Result of a tool invocation — MCP: `CallToolResult` (2025-06-18).
 *
 * The MCP `content[]` block array is scoped out: the single flattened
 * {@link text} field carries human/model-facing text, and
 * {@link structuredContent} is the primary machine-readable channel (it MUST
 * conform to `outputSchema` when the tool declares one).
 *
 * `isError: true` is in-band feedback — the result is still returned to the
 * model so it can self-correct on the next iteration; it never aborts a turn.
 *
 * @template R - Structured output type
 */
export interface ToolResult<R = unknown> {
  /** Machine-readable output; validated against `outputSchema` when declared. */
  readonly structuredContent?: R;
  /** Flattened `TextContent` — the MCP `content[]` array is scoped out. */
  readonly text?: string;
  /** True = the tool execution failed; in-band signal, not a protocol error. */
  readonly isError?: boolean;
}

/**
 * Handler invoked by the harness after arguments pass `inputSchema`
 * validation. May return synchronously or asynchronously; a thrown error is
 * caught by the harness and converted to an in-band `isError` result — it
 * never propagates past the turn boundary.
 *
 * @template I - Input type (validated against the contract's `inputSchema`)
 * @template R - Structured output type
 */
export type ToolHandler<I = unknown, R = unknown> = (
  input: I
) => Promise<ToolResult<R>> | ToolResult<R>;

// ============================================================================
// Argument validation (shared with the harness executor)
// ============================================================================

/**
 * One validation failure found by {@link validateToolArgs}.
 */
export interface ToolArgsViolation {
  /** JSON-path-style location of the failure, e.g. `'$.foo[0].bar'`. */
  readonly path: string;
  /** Human-readable explanation of the failure (prose; not a stable API). */
  readonly message: string;
}

/**
 * Result of validating tool arguments against a contract's `inputSchema`.
 * Discriminated union: `ok: true` carries no violations; `ok: false` carries
 * at least one.
 */
export type ToolArgsValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly ToolArgsViolation[] };

/**
 * Validates `args` against `tool.inputSchema` — the pure check behind the MCP
 * duty "validate arguments against `inputSchema` BEFORE execution"
 * (Tools, 2025-06-18). Callers must NOT invoke the tool handler when this
 * returns `ok: false`.
 *
 * Pragmatic JSON Schema subset, sufficient for LLM tool arguments:
 * - `required` properties must be present (own property check);
 * - declared `type` per property: `string`, `number`, `integer`, `boolean`,
 *   `object`, `array`, `null` (non-finite numbers fail `number`/`integer`);
 * - `enum` membership (strict `===` against the listed values);
 * - `items` schema applied to every array element;
 * - nested `object` properties validated recursively.
 *
 * Everything else is an **unknown keyword and ignored**: `pattern`,
 * `minLength`, `minimum`, `additionalProperties`, `oneOf`, string-form or
 * array-form `type`, unrecognized `type` names, and any extension keyword.
 * This function performs NO full JSON Schema validation — hosts needing the
 * full dialect can run their own validator before binding the tool.
 *
 * At the root (`'$'`), `args` must be a non-null, non-array object — tool
 * arguments are objects in MCP — unless the schema explicitly declares
 * another root `type`. A schema with no `properties`/`required` accepts any
 * object.
 *
 * Pure: never throws, never mutates `args` or `tool`.
 *
 * @param tool - Contract whose `inputSchema` the arguments are checked against
 * @param args - Candidate arguments (typically the model's tool-call args)
 * @returns `{ ok: true }` or `{ ok: false, violations }` with one entry per failure found
 */
export function validateToolArgs(tool: ToolContract, args: unknown): ToolArgsValidation {
  const violations: ToolArgsViolation[] = [];
  const rootSchema: JsonSchemaObject = tool.inputSchema;
  const rootType: unknown = rootSchema.type;
  if (rootType === undefined || rootType === 'object') {
    // Tool arguments are objects (MCP tools/call arguments); a schema without
    // a `type` keyword still describes an object schema per the MCP Tool shape.
    if (!isRecord(args)) {
      violations.push({ path: '$', message: 'Tool arguments must be an object.' });
      return violations.length === 0 ? { ok: true } : { ok: false, violations };
    }
    validateObjectProperties(rootSchema, args, '$', violations);
  } else {
    // Defensive: a schema that declares a non-object root type is honored
    // as-declared rather than rejected (let-the-caller-decide).
    validateValue(rootSchema, args, '$', violations);
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

// ============================================================================
// Internal helpers (not exported)
// ============================================================================

/**
 * Narrows `value` to a JSON record (non-null, non-array object).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates `value` against one schema node, appending violations.
 * Unknown or absent keywords are ignored (see {@link validateToolArgs}).
 */
function validateValue(
  schema: JsonSchema | undefined,
  value: unknown,
  path: string,
  violations: ToolArgsViolation[]
): void {
  if (schema === undefined) {
    return;
  }
  const allowedValues = schema.enum;
  if (allowedValues !== undefined && !allowedValues.some((candidate) => candidate === value)) {
    violations.push({ path, message: 'Value is not one of the allowed enum values.' });
    return;
  }
  const declaredType: unknown = schema.type;
  if (typeof declaredType !== 'string') {
    return; // absent or non-string `type` keyword: nothing further to check
  }
  switch (declaredType) {
    case 'string':
      if (typeof value !== 'string') {
        violations.push({ path, message: 'Expected a string.' });
      }
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        violations.push({ path, message: 'Expected a number.' });
      }
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        violations.push({ path, message: 'Expected an integer.' });
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') {
        violations.push({ path, message: 'Expected a boolean.' });
      }
      return;
    case 'null':
      if (value !== null) {
        violations.push({ path, message: 'Expected null.' });
      }
      return;
    case 'object':
      if (!isRecord(value)) {
        violations.push({ path, message: 'Expected an object.' });
      } else {
        validateObjectProperties(schema, value, path, violations);
      }
      return;
    case 'array':
      if (!Array.isArray(value)) {
        violations.push({ path, message: 'Expected an array.' });
      } else {
        validateArrayItems(schema, value, path, violations);
      }
      return;
    default:
      // Unrecognized type name — treated as an unknown keyword and ignored.
      return;
  }
}

/**
 * Validates `required` and `properties` keywords of an object node against a
 * record value. `additionalProperties` and unknown keywords are ignored.
 */
function validateObjectProperties(
  schema: JsonSchema,
  record: Record<string, unknown>,
  path: string,
  violations: ToolArgsViolation[]
): void {
  const requiredNames = schema.required;
  if (requiredNames !== undefined) {
    for (const propertyName of requiredNames) {
      if (!Object.prototype.hasOwnProperty.call(record, propertyName)) {
        violations.push({
          path: `${path}.${propertyName}`,
          message: 'Missing required property.'
        });
      }
    }
  }
  const properties = schema.properties;
  if (properties === undefined) {
    return;
  }
  for (const propertyName of Object.keys(properties)) {
    if (!Object.prototype.hasOwnProperty.call(record, propertyName)) {
      continue; // absent properties are only checked via `required`
    }
    validateValue(
      properties[propertyName],
      record[propertyName],
      `${path}.${propertyName}`,
      violations
    );
  }
}

/**
 * Validates the `items` keyword of an array node against every element.
 * Without `items`, any elements are accepted.
 */
function validateArrayItems(
  schema: JsonSchema,
  array: readonly unknown[],
  path: string,
  violations: ToolArgsViolation[]
): void {
  const itemSchema = schema.items;
  if (itemSchema === undefined) {
    return;
  }
  for (let index = 0; index < array.length; index += 1) {
    validateValue(itemSchema, array[index], `${path}[${index}]`, violations);
  }
}
