/**
 * Gemini Function Declaration Mapper
 *
 * Pure functions that map {@link ToolContract} to the `@google/genai`
 * {@link FunctionDeclaration} shape used by the Gemini SDK. This module performs
 * no runtime validation; it is a structural adapter between the MCP-shaped tool
 * contract and Gemini's function-calling protocol.
 *
 * The transport uses these declarations to tell the model which tools are
 * available. The harness validates tool-call arguments against the same
 * `inputSchema` before invoking handlers (MCP duty: validate before execute).
 */

import type { FunctionDeclaration, Schema } from '@google/genai';
import type { ToolContract } from '../tool/toolContract';

/**
 * Default export for this module.
 */
export const DEFAULT = {};

// ============================================================================
// Schema mapping
// ============================================================================

/**
 * Maps a JSON Schema object to the Gemini {@link Schema} type.
 *
 * This is a narrow structural cast: both types describe JSON Schema objects,
 * and the pragmatic subset the library uses (type, properties, required, items,
 * enum) aligns with Gemini's Schema. Unknown JSON Schema keywords are carried
 * through the index signature and ignored by the SDK.
 *
 * The cast is safe because:
 * 1. Both types are JSON Schema structural representations.
 * 2. The `JsonSchemaObject` type is a permissive structural type that allows
 *    unknown keywords via its index signature.
 * 3. Gemini's Schema type is also permissive and carries unknown keywords.
 *
 * @param jsonSchema - The JSON Schema object to map
 * @returns A Gemini Schema object (structurally equivalent)
 */
function geminiSchemaOf(jsonSchema: Readonly<ToolContract['inputSchema']>): Schema {
  // Cast is safe: both are JSON Schema structural types with permissive index signatures
  return jsonSchema as unknown as Schema;
}

// ============================================================================
// Function declaration mapping
// ============================================================================

/**
 * Maps a {@link ToolContract} to a Gemini {@link FunctionDeclaration}.
 *
 * The resulting declaration includes the tool name, description (when present),
 * and parameters schema. Gemini requires parameters to be declared as an object
 * type with a `properties` field; this is guaranteed by the `ToolContract`
 * type (`inputSchema` extends `JsonSchemaObject` which has `type: 'object'`).
 *
 * This function is pure and performs no runtime validation — it assumes the
 * input contract is well-formed per the MCP Tool shape.
 *
 * @param tool - The tool contract to map
 * @returns A Gemini FunctionDeclaration for use in SDK calls
 */
export function functionDeclarationOf(tool: ToolContract): FunctionDeclaration {
  const declaration: FunctionDeclaration = {
    name: tool.name,
    parameters: geminiSchemaOf(tool.inputSchema)
  };

  // Description is optional in both ToolContract and FunctionDeclaration
  if (tool.description !== undefined) {
    declaration.description = tool.description;
  }

  return declaration;
}
