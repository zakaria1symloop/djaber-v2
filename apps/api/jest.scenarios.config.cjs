/**
 * Live chatbot scenarios (04-ai-pipeline §15, beside the evals): `pnpm --filter @djaber/api test:scenarios` runs the
 * conversations of `test/ai-evals/scenarios/*.live.ts` through the real reply path with the REAL AI model (key from the
 * shell or the git-ignored .env) — Meta, couriers and payments stay fake. Costs money: never in CI.
 * Transcripts: `.local/ai-scenarios/` (SCENARIO_OUT). Model: EVAL_MODEL (default claude-haiku-4-5).
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/ai-evals/scenarios/**/*.live.ts'],
  transform: { '^.+\.ts$': ['@swc/jest'] },
  moduleNameMapper: { '^@api/(.*)$': '<rootDir>/src/$1' },
  globalSetup: '<rootDir>/test/setup/global-setup.cjs',
  globalTeardown: '<rootDir>/test/setup/global-teardown.cjs',
  setupFiles: ['<rootDir>/test/ai-evals/scenarios/env.cjs'],
  testTimeout: 900000,
  maxWorkers: 3,
};
