/**
 * Contract linting — payload schema complexity thresholds.
 *
 * Gemini 3.x Flash degenerates under giant schemas, so hosts gate contract
 * size in CI. Metrics apply to the PAYLOAD schema only (the envelope is fixed
 * and small). Thresholds are caller-configurable per the library tunables
 * convention: exported DEFAULT_* constants are recommended defaults, callers
 * override via {@link LintThresholds}.
 */

import type { JsonSchema } from '../tool/toolContract';
import type { Contract } from './contract';
import type { ContractManifest } from './manifest';

// ============================================================================
// Tunable thresholds (recommended defaults)
// ============================================================================

/** Default warn threshold for total payload properties. */
export const DEFAULT_WARN_MAX_PROPERTIES = 32;
/** Default error threshold for total payload properties. */
export const DEFAULT_ERROR_MAX_PROPERTIES = 64;
/** Default warn threshold for payload schema nesting depth (root = 1). */
export const DEFAULT_WARN_MAX_DEPTH = 4;
/** Default error threshold for payload schema nesting depth (root = 1). */
export const DEFAULT_ERROR_MAX_DEPTH = 6;
/** Default warn threshold for total payload leaf properties. */
export const DEFAULT_WARN_MAX_LEAVES = 128;
/** Default error threshold for total payload leaf properties. */
export const DEFAULT_ERROR_MAX_LEAVES = 256;

/**
 * Caller-configurable lint thresholds. Every field is optional; omitted fields
 * fall back to the exported DEFAULT_* constants.
 */
export interface LintThresholds {
  /** Warn when total properties exceed this. Default {@link DEFAULT_WARN_MAX_PROPERTIES}. */
  readonly warnMaxProperties?: number;
  /** Error when total properties exceed this. Default {@link DEFAULT_ERROR_MAX_PROPERTIES}. */
  readonly errorMaxProperties?: number;
  /** Warn when nesting depth exceeds this. Default {@link DEFAULT_WARN_MAX_DEPTH}. */
  readonly warnMaxDepth?: number;
  /** Error when nesting depth exceeds this. Default {@link DEFAULT_ERROR_MAX_DEPTH}. */
  readonly errorMaxDepth?: number;
  /** Warn when leaf properties exceed this. Default {@link DEFAULT_WARN_MAX_LEAVES}. */
  readonly warnMaxLeaves?: number;
  /** Error when leaf properties exceed this. Default {@link DEFAULT_ERROR_MAX_LEAVES}. */
  readonly errorMaxLeaves?: number;
}

/**
 * One lint finding: a payload schema metric exceeded its threshold.
 */
export interface ContractLintFinding {
  /** Severity: `warn` (over the warn threshold) or `error` (over the error threshold). */
  readonly level: 'warn' | 'error';
  /** Which complexity metric exceeded its threshold. */
  readonly metric: 'properties' | 'depth' | 'leaves';
  /** Observed metric value. */
  readonly value: number;
  /** Threshold that was exceeded. */
  readonly threshold: number;
  /** Human-readable explanation (prose; not a stable API). */
  readonly message: string;
}

// ============================================================================
// Metric computation
// ============================================================================

/**
 * Computed payload schema complexity metrics.
 */
interface PayloadMetrics {
  /** Total properties across the whole payload schema. */
  readonly properties: number;
  /** Maximum nesting depth; the root object schema counts as 1. */
  readonly depth: number;
  /** Total leaf properties (non-object, non-array property schemas). */
  readonly leaves: number;
}

/**
 * True when the schema node is an object schema (declared `object` or carrying
 * named `properties`).
 */
function isObjectSchema(schema: JsonSchema): boolean {
  return schema.type === 'object' || schema.properties !== undefined;
}

/**
 * True when the schema node is an array schema (declared `array` or carrying
 * `items`).
 */
function isArraySchema(schema: JsonSchema): boolean {
  return schema.type === 'array' || schema.items !== undefined;
}

/**
 * Walks a payload schema accumulating the three complexity metrics.
 *
 * Depth: an object level counts 1; nested object/array levels add 1 each; a
 * flat payload schema is depth 1. Leaves: property schemas that are neither
 * object nor array schemas; properties: every entry of every `properties`
 * record, recursively (array item object properties included).
 *
 * @param schema - Payload schema to measure
 * @returns The computed metrics
 */
function computeMetrics(schema: JsonSchema): PayloadMetrics {
  let properties = 0;
  let leaves = 0;

  const walk = (node: JsonSchema): number => {
    if (isObjectSchema(node)) {
      let childDepth = 0;
      const declared = node.properties;
      if (declared !== undefined) {
        for (const name of Object.keys(declared)) {
          properties += 1;
          const child = declared[name];
          if (child === undefined) {
            continue;
          }
          if (isObjectSchema(child) || isArraySchema(child)) {
            childDepth = Math.max(childDepth, walk(child));
          } else {
            leaves += 1;
          }
        }
      }
      return 1 + childDepth;
    }
    if (isArraySchema(node)) {
      const items = node.items;
      return 1 + (items !== undefined ? walk(items) : 0);
    }
    return 0;
  };

  const depth = walk(schema);
  return { properties, depth, leaves };
}

// ============================================================================
// Lint entry point
// ============================================================================

/**
 * Lints a contract (or bare manifest) against payload complexity thresholds.
 *
 * A metric exactly at a threshold PASSES; one over the warn threshold yields a
 * `warn` finding, and one over the error threshold yields a single `error`
 * finding for that metric (error supersedes warn). Counts apply to the payload
 * schema only — the envelope is fixed and small. Host CI calls this in unit
 * tests to keep prompt-carried schemas inside the model's comfort zone.
 *
 * Pure and deterministic: never throws, never mutates its input.
 *
 * @param target - A {@link Contract} or a bare {@link ContractManifest}
 * @param thresholds - Optional threshold overrides (defaults: the DEFAULT_* constants)
 * @returns Findings in metric order (properties, depth, leaves); empty = clean
 */
export function lintContract(
  target: Contract<unknown> | ContractManifest,
  thresholds?: LintThresholds
): readonly ContractLintFinding[] {
  const payloadSchema: JsonSchema = 'manifest' in target ? target.manifest.payload : target.payload;

  const warnMaxProperties = thresholds?.warnMaxProperties ?? DEFAULT_WARN_MAX_PROPERTIES;
  const errorMaxProperties = thresholds?.errorMaxProperties ?? DEFAULT_ERROR_MAX_PROPERTIES;
  const warnMaxDepth = thresholds?.warnMaxDepth ?? DEFAULT_WARN_MAX_DEPTH;
  const errorMaxDepth = thresholds?.errorMaxDepth ?? DEFAULT_ERROR_MAX_DEPTH;
  const warnMaxLeaves = thresholds?.warnMaxLeaves ?? DEFAULT_WARN_MAX_LEAVES;
  const errorMaxLeaves = thresholds?.errorMaxLeaves ?? DEFAULT_ERROR_MAX_LEAVES;

  const metrics = computeMetrics(payloadSchema);
  const findings: ContractLintFinding[] = [];

  if (metrics.properties > errorMaxProperties) {
    findings.push({
      level: 'error',
      metric: 'properties',
      value: metrics.properties,
      threshold: errorMaxProperties,
      message: `Payload schema declares ${metrics.properties} properties (error threshold ${errorMaxProperties}).`
    });
  } else if (metrics.properties > warnMaxProperties) {
    findings.push({
      level: 'warn',
      metric: 'properties',
      value: metrics.properties,
      threshold: warnMaxProperties,
      message: `Payload schema declares ${metrics.properties} properties (warn threshold ${warnMaxProperties}).`
    });
  }

  if (metrics.depth > errorMaxDepth) {
    findings.push({
      level: 'error',
      metric: 'depth',
      value: metrics.depth,
      threshold: errorMaxDepth,
      message: `Payload schema nesting depth is ${metrics.depth} (error threshold ${errorMaxDepth}).`
    });
  } else if (metrics.depth > warnMaxDepth) {
    findings.push({
      level: 'warn',
      metric: 'depth',
      value: metrics.depth,
      threshold: warnMaxDepth,
      message: `Payload schema nesting depth is ${metrics.depth} (warn threshold ${warnMaxDepth}).`
    });
  }

  if (metrics.leaves > errorMaxLeaves) {
    findings.push({
      level: 'error',
      metric: 'leaves',
      value: metrics.leaves,
      threshold: errorMaxLeaves,
      message: `Payload schema has ${metrics.leaves} leaf properties (error threshold ${errorMaxLeaves}).`
    });
  } else if (metrics.leaves > warnMaxLeaves) {
    findings.push({
      level: 'warn',
      metric: 'leaves',
      value: metrics.leaves,
      threshold: warnMaxLeaves,
      message: `Payload schema has ${metrics.leaves} leaf properties (warn threshold ${warnMaxLeaves}).`
    });
  }

  return findings;
}
