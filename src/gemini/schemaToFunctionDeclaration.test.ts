/**
 * Behavior tests for {@link functionDeclarationOf} — the mapping from
 * {@link ToolContract} to Gemini {@link FunctionDeclaration}.
 *
 * Tests verify structural correctness of the mapping (name, description,
 * parameters). The test uses a stubbed SDK type to avoid runtime dependencies.
 */

import { describe, expect, it } from 'vitest';
import type { ToolContract } from '../tool/toolContract';
import { functionDeclarationOf } from './schemaToFunctionDeclaration';

describe('functionDeclarationOf', () => {
  it('maps a minimal tool contract (name only)', () => {
    const tool: ToolContract = {
      name: 'test_tool',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    };

    const declaration = functionDeclarationOf(tool);

    expect(declaration).toEqual({
      name: 'test_tool',
      parameters: {
        type: 'object',
        properties: {}
      }
    });
  });

  it('includes description when present', () => {
    const tool: ToolContract = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    };

    const declaration = functionDeclarationOf(tool);

    expect(declaration).toEqual({
      name: 'test_tool',
      description: 'A test tool',
      parameters: {
        type: 'object',
        properties: {}
      }
    });
  });

  it('omits description when absent', () => {
    const tool: ToolContract = {
      name: 'test_tool',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    };

    const declaration = functionDeclarationOf(tool);

    expect(declaration.description).toBeUndefined();
  });

  it('maps complex input schema with properties and required', () => {
    const tool: ToolContract = {
      name: 'search_venues',
      description: 'Search for available venues',
      inputSchema: {
        type: 'object',
        properties: {
          weekday: {
            type: 'integer',
            minimum: 1,
            maximum: 7
          },
          startTime: {
            type: 'string'
          }
        },
        required: ['weekday', 'startTime']
      }
    };

    const declaration = functionDeclarationOf(tool);

    expect(declaration.name).toBe('search_venues');
    expect(declaration.description).toBe('Search for available venues');
    expect(declaration.parameters).toEqual({
      type: 'object',
      properties: {
        weekday: {
          type: 'integer',
          minimum: 1,
          maximum: 7
        },
        startTime: {
          type: 'string'
        }
      },
      required: ['weekday', 'startTime']
    });
  });

  it('carries unknown JSON Schema keywords through index signature', () => {
    const tool: ToolContract = {
      name: 'custom_tool',
      inputSchema: {
        type: 'object',
        properties: {
          count: {
            type: 'number',
            customKeyword: 'some-value',
            anotherUnknown: ['array', 'of', 'values']
          }
        },
        unknownTopLevel: 'carried-through'
      }
    };

    const declaration = functionDeclarationOf(tool);

    // Unknown keywords are preserved in the index signature
    expect(declaration.parameters).toMatchObject({
      type: 'object',
      properties: {
        count: {
          type: 'number',
          customKeyword: 'some-value',
          anotherUnknown: ['array', 'of', 'values']
        }
      }
    });
    expect((declaration.parameters as Record<string, unknown>).unknownTopLevel).toBe(
      'carried-through'
    );
  });

  it('maps nested object schemas correctly', () => {
    const tool: ToolContract = {
      name: 'nested_tool',
      inputSchema: {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: {
              enabled: {
                type: 'boolean'
              },
              threshold: {
                type: 'number'
              }
            },
            required: ['enabled']
          }
        }
      }
    };

    const declaration = functionDeclarationOf(tool);

    expect(declaration.parameters).toEqual({
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            enabled: {
              type: 'boolean'
            },
            threshold: {
              type: 'number'
            }
          },
          required: ['enabled']
        }
      }
    });
  });

  it('maps array schemas with items correctly', () => {
    const tool: ToolContract = {
      name: 'array_tool',
      inputSchema: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        }
      }
    };

    const declaration = functionDeclarationOf(tool);

    expect(declaration.parameters).toEqual({
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: {
            type: 'string'
          }
        }
      }
    });
  });

  it('maps enum schemas correctly', () => {
    const tool: ToolContract = {
      name: 'enum_tool',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'inactive', 'pending']
          }
        }
      }
    };

    const declaration = functionDeclarationOf(tool);

    expect(declaration.parameters).toEqual({
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'inactive', 'pending']
        }
      }
    });
  });
});
