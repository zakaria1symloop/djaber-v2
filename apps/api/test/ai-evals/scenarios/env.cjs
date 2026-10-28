// Environment of the live chatbot scenarios (`pnpm --filter @djaber/api test:scenarios`). Same infrastructure as the
// integration tests (embedded Postgres + Redis, fake Meta, fake couriers, fake payments): only the AI is real.
// The provider key comes from the caller's shell or, when absent there, from the git-ignored `.env` of the repository —
// only that variable is read, its value is never printed. Without a key the run stops before anything starts.
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_AI_API_KEY', 'GROQ_API_KEY'];
const fromDotEnv = (name) => {
  const file = resolve(__dirname, '../../../../../.env');
  if (!existsSync(file)) return '';
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.startsWith(`${name}=`))
    .pop();
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
};
const given = Object.fromEntries([...KEYS, 'ANTHROPIC_WORKSPACE_ID'].map((k) => [k, process.env[k] || fromDotEnv(k)]));
require('../../setup/env.cjs');
// SCENARIO_DRIVER=fake: a smoke test of the harness itself with the fake adapter (no key, no simulated customer)
if (process.env.SCENARIO_DRIVER !== 'fake') {
  Object.assign(process.env, given, { AI_DRIVER: 'live', AI_ALLOW_LIVE: 'true' });
  if (!KEYS.some((k) => process.env[k])) throw new Error('[scenarios] no AI provider key in the environment or in .env');
}
