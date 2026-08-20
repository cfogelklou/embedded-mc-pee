/**
 * embedded-mc-pee — MCP-shaped harness for embedding tool-calling LLM intelligence into backends.
 *
 * This library provides typed envelopes, deterministic validation, and record/replay for agentic
 * LLM workflows. It uses direct SDK calls (not MCP protocol) and enforces JSON-safety at all boundaries.
 *
 * @packageDocumentation
 */

/**
 * Library version.
 *
 * Semver-major bumps indicate breaking API changes. Semver-minor/patch bumps are for new features and bug fixes.
 */
export const LIBRARY_VERSION = '0.1.0' as const;

// Future exports (placeholder for later work packages):
// export { createHarness, createContract } from './harness';
// export type { Contract, Harness, HarnessConfig } from './harness';
