/**
 * Behavior tests for {@link lintContract} — payload complexity thresholds at
 * their exact boundaries (default 32/64 properties, 4/6 depth, 128/256
 * leaves) and caller threshold overrides.
 */

import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../tool/toolContract';
import { createContract } from './contract';
import type { Contract } from './contract';
import { lintContract } from './lint';
import type { ContractLintFinding } from './lint';
import type { ContractManifest } from './manifest';

/** Builds a manifest whose payload is a flat object with `count` leaf properties. */
function flatManifest(count: number): ContractManifest {
  const properties: { [name: string]: JsonSchema } = {};
  for (let index = 0; index < count; index += 1) {
    properties[`p${index}`] = { type: 'string' };
  }
  return { envelope: {}, payload: { type: 'object', properties } };
}

/**
 * Builds a manifest whose payload nests `depth` object levels under the root
 * object, giving a total payload depth of `depth + 1` (root = 1).
 */
function nestedManifest(depth: number): ContractManifest {
  let schema: JsonSchema = { type: 'object', properties: { leaf: { type: 'string' } } };
  for (let level = 1; level < depth; level += 1) {
    schema = { type: 'object', properties: { child: schema } };
  }
  return { envelope: {}, payload: { type: 'object', properties: { root: schema } } };
}

/** Finds the single finding for a metric, asserting there is exactly one. */
function findingFor(
  findings: readonly ContractLintFinding[],
  metric: ContractLintFinding['metric']
): ContractLintFinding {
  const matches = findings.filter((finding) => finding.metric === metric);
  expect(matches.length).toBe(1);
  return matches[0];
}

/** Collects the findings for one metric (may be empty). */
function findingsFor(
  findings: readonly ContractLintFinding[],
  metric: ContractLintFinding['metric']
): readonly ContractLintFinding[] {
  return findings.filter((finding) => finding.metric === metric);
}

describe('lintContract — properties threshold', () => {
  it('passes at exactly the warn threshold (32)', () => {
    expect(lintContract(flatManifest(32))).toEqual([]);
  });

  it('warns one over the warn threshold (33)', () => {
    const finding = findingFor(lintContract(flatManifest(33)), 'properties');
    expect(finding.level).toBe('warn');
    expect(finding.value).toBe(33);
    expect(finding.threshold).toBe(32);
  });

  it('warns but does not error at exactly the error threshold (64)', () => {
    const finding = findingFor(lintContract(flatManifest(64)), 'properties');
    expect(finding.level).toBe('warn');
  });

  it('errors one over the error threshold (65)', () => {
    const finding = findingFor(lintContract(flatManifest(65)), 'properties');
    expect(finding.level).toBe('error');
    expect(finding.value).toBe(65);
    expect(finding.threshold).toBe(64);
  });

  it('counts properties across nested objects and array items', () => {
    const manifest: ContractManifest = {
      envelope: {},
      payload: {
        type: 'object',
        properties: {
          outer: {
            type: 'object',
            properties: { a: { type: 'string' }, b: { type: 'string' } }
          },
          list: {
            type: 'array',
            items: {
              type: 'object',
              properties: { c: { type: 'string' }, d: { type: 'string' } }
            }
          }
        }
      }
    };
    const contract: Contract<ContractManifest> = {
      manifest,
      toolSchema: { type: 'object', properties: { payload: manifest.payload } },
      renderPromptContract: () => '',
      validateHostPayload: (payload: unknown) => ({ ok: true, value: payload as ContractManifest })
    };
    // outer + list + a + b + c + d = 6 properties; leaves = a, b, c, d = 4
    expect(
      lintContract(contract, { warnMaxProperties: 4, errorMaxProperties: 5 })
    ).toEqual([
      expect.objectContaining({ metric: 'properties', level: 'error', value: 6, threshold: 5 })
    ]);
    expect(lintContract(contract, { warnMaxLeaves: 3, errorMaxLeaves: 3 })).toEqual([
      expect.objectContaining({ metric: 'leaves', level: 'error', value: 4, threshold: 3 })
    ]);
  });
});

describe('lintContract — depth threshold', () => {
  it('passes at exactly the warn depth (4)', () => {
    expect(findingsFor(lintContract(nestedManifest(3)), 'depth')).toEqual([]);
  });

  it('warns one over the warn depth (5)', () => {
    const finding = findingFor(lintContract(nestedManifest(4)), 'depth');
    expect(finding.level).toBe('warn');
    expect(finding.value).toBe(5);
    expect(finding.threshold).toBe(4);
  });

  it('warns but does not error at exactly the error depth (6)', () => {
    const finding = findingFor(lintContract(nestedManifest(5)), 'depth');
    expect(finding.level).toBe('warn');
  });

  it('errors one over the error depth (7)', () => {
    const finding = findingFor(lintContract(nestedManifest(6)), 'depth');
    expect(finding.level).toBe('error');
    expect(finding.value).toBe(7);
    expect(finding.threshold).toBe(6);
  });
});

describe('lintContract — leaves threshold', () => {
  // Note: a flat payload with N leaves also has N properties, so the leaves
  // assertions filter to the leaves metric only.
  it('passes at exactly the warn threshold (128)', () => {
    expect(findingsFor(lintContract(flatManifest(128)), 'leaves')).toEqual([]);
  });

  it('warns one over the warn threshold (129)', () => {
    const finding = findingFor(lintContract(flatManifest(129)), 'leaves');
    expect(finding.level).toBe('warn');
    expect(finding.value).toBe(129);
    expect(finding.threshold).toBe(128);
  });

  it('warns but does not error at exactly the error threshold (256)', () => {
    const finding = findingFor(lintContract(flatManifest(256)), 'leaves');
    expect(finding.level).toBe('warn');
  });

  it('errors one over the error threshold (257)', () => {
    const finding = findingFor(lintContract(flatManifest(257)), 'leaves');
    expect(finding.level).toBe('error');
    expect(finding.value).toBe(257);
    expect(finding.threshold).toBe(256);
  });
});

describe('lintContract — custom thresholds and input shapes', () => {
  it('honors caller-provided threshold overrides', () => {
    const manifest = flatManifest(3);
    expect(lintContract(manifest, { warnMaxProperties: 2, errorMaxProperties: 3 })).toEqual([
      expect.objectContaining({ metric: 'properties', level: 'warn', value: 3, threshold: 2 })
    ]);
    expect(lintContract(manifest, { warnMaxProperties: 2, errorMaxProperties: 2 })).toEqual([
      expect.objectContaining({ metric: 'properties', level: 'error', value: 3, threshold: 2 })
    ]);
  });

  it('accepts a Contract and its manifest interchangeably', () => {
    const manifest = flatManifest(33);
    const result = createContract(manifest, (payload: unknown) => ({
      ok: true,
      value: payload as ContractManifest
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(lintContract(result.contract)).toEqual(lintContract(manifest));
    }
  });
});
