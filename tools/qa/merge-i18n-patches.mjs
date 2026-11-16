// Merges the i18n patches written by the fix agents (.local/qa/fix/*-i18n*.json:
// { file: 'app' | 'deck' | 'admin-core' | 'web-public' | … | 'errors', fr: {key: text}, ar: {…}, en: {…} }) into
// packages/shared/src/i18n/messages/<file>.<locale>.json (errors ⇒ packages/shared/src/errors/messages.<locale>.json).
// Existing keys are replaced, new ones added; a file whose keys were sorted stays sorted; the indentation is kept.
// Run from the repo root: node tools/qa/merge-i18n-patches.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('.local/qa/fix');
const target = (family, l) => (family === 'errors' ? resolve(`packages/shared/src/errors/messages.${l}.json`) : resolve(`packages/shared/src/i18n/messages/${family}.${l}.json`));
const patches = readdirSync(dir).filter((f) => /-i18n.*\.json$/.test(f));
const byFile = new Map();
for (const f of patches) {
  const j = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
  for (const l of ['fr', 'ar', 'en']) {
    for (const [k, v] of Object.entries(j[l] ?? {})) {
      const t = target(j.file, l);
      const m = byFile.get(t) ?? new Map();
      if (m.has(k) && m.get(k).v !== v) console.warn(`conflict ${k} (${l}): ${m.get(k).from} vs ${f} — ${f} wins`);
      m.set(k, { v, from: f });
      byFile.set(t, m);
    }
  }
}
for (const [t, m] of byFile) {
  const raw = readFileSync(t, 'utf8');
  const indent = /^\{\r?\n( +)"/.exec(raw)?.[1].length ?? 2;
  const obj = JSON.parse(raw);
  const keys = Object.keys(obj);
  const sorted = keys.every((k, i) => i === 0 || keys[i - 1].localeCompare(k) <= 0);
  let added = 0;
  for (const [k, { v }] of m) {
    if (!(k in obj)) added++;
    obj[k] = v;
  }
  const out = sorted ? Object.fromEntries(Object.keys(obj).sort((a, b) => a.localeCompare(b)).map((k) => [k, obj[k]])) : obj;
  writeFileSync(t, `${JSON.stringify(out, null, indent)}\n`);
  console.log(`${t.replace(resolve('.'), '.')}: ${m.size} keys (${added} new)${sorted ? ', sorted' : ''}`);
}
