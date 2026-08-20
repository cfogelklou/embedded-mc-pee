import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for example tests.
 *
 * Examples require live Gemini calls and are excluded from the default test suite.
 * They run ONLY when explicitly invoked via `npm run test:examples` with GEMINI_API_KEY set.
 */
export default defineConfig({
  test: {
    include: ['examples/**/*.test.ts'],
    exclude: ['node_modules'],
    environment: 'node',
    passWithNoTests: false,
    // Examples test live Gemini behavior - no coverage collection
    coverage: { enabled: false },
    // Longer timeout for network calls
    testTimeout: 60_000,
  },
});
