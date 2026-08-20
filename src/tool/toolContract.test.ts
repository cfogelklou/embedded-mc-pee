/**
 * Behavior tests for {@link validateToolArgs} — the MCP
 * "validate args before execute" duty's pure check.
 *
 * Assertions target structure (ok, path) — never message prose.
 */

import { describe, expect, it } from 'vitest';
import type { JsonSchemaObject, ToolContract } from './toolContract';
import { validateToolArgs } from './toolContract';

/** Builds a minimal tool contract around an input schema. */
function toolWith(schema: JsonSchemaObject): ToolContract {
  return { name: 'test_tool', inputSchema: schema };
}

/**
 * Casts an off-vocabulary schema literal (unknown keywords, missing `type`,
 * unrecognized type names) to {@link JsonSchemaObject} across an `unknown`
 * boundary — the validator must tolerate runtime shapes beyond the declared type.
 */
function schemaFrom(schema: unknown): JsonSchemaObject {
  return schema as JsonSchemaObject;
}

/** Asserts the result is ok:false and collects the violation paths. */
function violationPathsOf(result: ReturnType<typeof validateToolArgs>): string[] {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    return result.violations.map((violation) => violation.path);
  }
  throw new Error('unreachable: result.ok was asserted false');
}

describe('validateToolArgs: required properties', () => {
  const tool = toolWith({
    type: 'object',
    required: ['name', 'count'],
    properties: {
      name: { type: 'string' },
      count: { type: 'number' }
    }
  });

  it('accepts when all required properties are present', () => {
    const result = validateToolArgs(tool, { name: 'lane', count: 2 });
    expect(result).toEqual({ ok: true });
  });

  it('reports each missing required property at its own path', () => {
    const paths = violationPathsOf(validateToolArgs(tool, {}));
    expect(paths).toContain('$.name');
    expect(paths).toContain('$.count');
    expect(paths).toHaveLength(2);
  });

  it('reports only the missing property when one of two is present', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { count: 2 }));
    expect(paths).toEqual(['$.name']);
  });
});

describe('validateToolArgs: declared types', () => {
  const tool = toolWith({
    type: 'object',
    properties: {
      s: { type: 'string' },
      n: { type: 'number' },
      i: { type: 'integer' },
      b: { type: 'boolean' },
      o: { type: 'object' },
      a: { type: 'array' },
      z: { type: 'null' }
    }
  });

  it('accepts values matching every declared type', () => {
    const result = validateToolArgs(tool, {
      s: 'x',
      n: 1.5,
      i: 1,
      b: false,
      o: {},
      a: [],
      z: null
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a number where a string is declared', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { s: 42 }));
    expect(paths).toEqual(['$.s']);
  });

  it('rejects a string where a number is declared', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { n: '3' }));
    expect(paths).toEqual(['$.n']);
  });

  it('rejects a number where a boolean is declared (truthy numbers are not booleans)', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { b: 1 }));
    expect(paths).toEqual(['$.b']);
  });

  it('rejects null where an object is declared', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { o: null }));
    expect(paths).toEqual(['$.o']);
  });

  it('rejects an object where an array is declared', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { a: {} }));
    expect(paths).toEqual(['$.a']);
  });

  it('rejects a string where null is declared', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { z: 'null' }));
    expect(paths).toEqual(['$.z']);
  });

  it('accumulates violations across properties in one pass', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { s: 1, b: 2 }));
    expect(paths).toContain('$.s');
    expect(paths).toContain('$.b');
  });
});

describe('validateToolArgs: integer vs number', () => {
  const tool = toolWith({
    type: 'object',
    properties: { i: { type: 'integer' }, n: { type: 'number' } }
  });

  it('accepts an integer value for an integer type', () => {
    expect(validateToolArgs(tool, { i: 1 })).toEqual({ ok: true });
  });

  it('rejects a fractional value for an integer type', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { i: 1.5 }));
    expect(paths).toEqual(['$.i']);
  });

  it('accepts a fractional value for a number type', () => {
    expect(validateToolArgs(tool, { n: 1.5 })).toEqual({ ok: true });
  });
});

describe('validateToolArgs: enum', () => {
  const tool = toolWith({
    type: 'object',
    properties: { color: { type: 'string', enum: ['red', 'green'] } }
  });

  it('accepts a listed enum value', () => {
    expect(validateToolArgs(tool, { color: 'red' })).toEqual({ ok: true });
  });

  it('rejects a value outside the enum', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { color: 'blue' }));
    expect(paths).toEqual(['$.color']);
  });
});

describe('validateToolArgs: nested objects', () => {
  const tool = toolWith({
    type: 'object',
    properties: {
      address: {
        type: 'object',
        required: ['city'],
        properties: { city: { type: 'string' } }
      }
    }
  });

  it('accepts a conforming nested object', () => {
    expect(validateToolArgs(tool, { address: { city: 'Stockholm' } })).toEqual({ ok: true });
  });

  it('reports a missing nested required property at its nested path', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { address: {} }));
    expect(paths).toEqual(['$.address.city']);
  });

  it('reports a nested type mismatch at its nested path', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { address: { city: 4 } }));
    expect(paths).toEqual(['$.address.city']);
  });

  it('reports a non-object value for a nested object schema', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { address: 'x' }));
    expect(paths).toEqual(['$.address']);
  });
});

describe('validateToolArgs: array items', () => {
  const tool = toolWith({
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'string' } }
    }
  });

  it('accepts an array whose items all match the items schema', () => {
    expect(validateToolArgs(tool, { tags: ['a', 'b'] })).toEqual({ ok: true });
  });

  it('reports each offending item at its index path', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { tags: ['a', 1, 2] }));
    expect(paths).toEqual(['$.tags[1]', '$.tags[2]']);
  });

  it('rejects a non-array value for an array schema', () => {
    const paths = violationPathsOf(validateToolArgs(tool, { tags: 'a' }));
    expect(paths).toEqual(['$.tags']);
  });

  it('accepts any items when no items schema is declared', () => {
    const noItemsTool = toolWith({
      type: 'object',
      properties: { tags: { type: 'array' } }
    });
    expect(validateToolArgs(noItemsTool, { tags: [1, 'x', null] })).toEqual({ ok: true });
  });
});

describe('validateToolArgs: unknown keywords are ignored', () => {
  it('ignores minLength/pattern/minimum/additionalProperties-style keywords', () => {
    const tool = toolWith(schemaFrom({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 10, pattern: '^[a-z]+$', format: 'email' },
        age: { type: 'number', minimum: 100, maximum: 0, multipleOf: 7 },
        extra: { type: 'string', 'x-vendor-extension': { nested: true } }
      },
      'x-root-extension': 'ignored',
      additionalProperties: false
    }));
    const result = validateToolArgs(tool, {
      name: 'A', // violates minLength and pattern — both ignored
      age: 3, // violates minimum/maximum/multipleOf — all ignored
      extra: 'fine'
    });
    expect(result).toEqual({ ok: true });
  });

  it('ignores an unrecognized type name rather than failing', () => {
    const tool = toolWith(schemaFrom({
      type: 'object',
      properties: { magic: { type: 'superstring' } }
    }));
    expect(validateToolArgs(tool, { magic: 42 })).toEqual({ ok: true });
  });
});

describe('validateToolArgs: root argument shape', () => {
  it('rejects a string argument at the root path', () => {
    const tool = toolWith({ type: 'object' });
    const paths = violationPathsOf(validateToolArgs(tool, 'hello'));
    expect(paths).toEqual(['$']);
  });

  it('rejects a null argument at the root path', () => {
    const tool = toolWith({ type: 'object' });
    const paths = violationPathsOf(validateToolArgs(tool, null));
    expect(paths).toEqual(['$']);
  });

  it('rejects an array argument at the root path', () => {
    const tool = toolWith({ type: 'object' });
    const paths = violationPathsOf(validateToolArgs(tool, [1, 2]));
    expect(paths).toEqual(['$']);
  });

  it('honors a schema that explicitly declares a non-object root type', () => {
    const tool = toolWith(schemaFrom({ type: 'string' }));
    expect(validateToolArgs(tool, 'plain')).toEqual({ ok: true });
    const paths = violationPathsOf(validateToolArgs(tool, 3));
    expect(paths).toEqual(['$']);
  });
});

describe('validateToolArgs: permissive schemas', () => {
  it('accepts any object when the schema declares no properties or required', () => {
    const tool = toolWith({ type: 'object' });
    expect(validateToolArgs(tool, {})).toEqual({ ok: true });
    expect(validateToolArgs(tool, { anything: [1, { x: null }] })).toEqual({ ok: true });
  });

  it('accepts properties not listed in the schema (additionalProperties ignored)', () => {
    const tool = toolWith({
      type: 'object',
      properties: { known: { type: 'string' } }
    });
    expect(validateToolArgs(tool, { known: 'x', unknown: 123 })).toEqual({ ok: true });
  });

  it('accepts an empty properties map and untyped declared properties', () => {
    const tool = toolWith({ type: 'object', properties: {} });
    expect(validateToolArgs(tool, { a: 1 })).toEqual({ ok: true });
  });

  it('accepts an object when the root schema omits the type keyword', () => {
    const tool = toolWith(schemaFrom({ properties: { a: { type: 'string' } } }));
    expect(validateToolArgs(tool, { a: 'x' })).toEqual({ ok: true });
    const paths = violationPathsOf(validateToolArgs(tool, { a: 1 }));
    expect(paths).toEqual(['$.a']);
  });

  it('does not mutate the arguments or the tool', () => {
    const args = { name: 'lane', extra: true };
    const tool = toolWith({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } }
    });
    const argsSnapshot = JSON.stringify(args);
    const toolSnapshot = JSON.stringify(tool);
    validateToolArgs(tool, args);
    expect(JSON.stringify(args)).toBe(argsSnapshot);
    expect(JSON.stringify(tool)).toBe(toolSnapshot);
  });
});
