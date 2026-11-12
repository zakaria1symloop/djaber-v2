// QA — translated texts with {values} rendered by t(key) without values (run from the repo root: node tools/qa/scan-placeholders.mjs).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const msgs = {};
for (const f of readdirSync('packages/shared/src/i18n/messages').filter((f) => f.endsWith('.fr.json'))) Object.assign(msgs, JSON.parse(readFileSync(join('packages/shared/src/i18n/messages', f), 'utf8')));
const withParams = Object.fromEntries(Object.entries(msgs).filter(([, v]) => typeof v === 'string' && /\{[a-zA-Z_]+\}/.test(v)));
const files = [];
const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) { if (!/node_modules|\.next|e2e/.test(p)) walk(p); } else if (/\.(tsx?|ts)$/.test(e) && !/\.(spec|test|stories)\./.test(e)) files.push(p); } };
walk('apps/web/src');
const hits = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*['"`]([\w.-]+)['"`]\s*\)/g)) if (withParams[m[1]]) hits.push(`${f}:${src.slice(0, m.index).split('\n').length}  ${m[1]}  →  ${withParams[m[1]].slice(0, 80)}`);
}
console.log(`${Object.keys(withParams).length} messages need values; ${hits.length} calls give none:`);
console.log(hits.join('\n'));
