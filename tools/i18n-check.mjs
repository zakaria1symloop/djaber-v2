// `pnpm i18n:check` — fails when:
//  1. fr / ar / en do not have exactly the same keys (deck + app + errors),
//  2. a translation is empty, still marked ⟦TODO⟧, or its {placeholders} differ from the French ones,
//  3. the web app uses a literal key (t('…'), key: '…', labelKey: '…', titleKey: '…') that does not exist.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'packages/shared/src/i18n/messages';
const load = (f) => JSON.parse(readFileSync(f, 'utf8'));
const cat = {};
for (const l of ['fr', 'ar', 'en']) {
  const errors = load(`packages/shared/src/errors/messages.${l}.json`);
  cat[l] = { ...load(`${dir}/deck.${l}.json`), ...load(`${dir}/app.${l}.json`), ...load(`${dir}/admin-core.${l}.json`), ...load(`${dir}/api-agents.${l}.json`), ...load(`${dir}/api-integrations.${l}.json`), ...load(`${dir}/web-integrations.${l}.json`), ...load(`${dir}/web-carryovers.${l}.json`), ...load(`${dir}/web-public.${l}.json`), ...load(`${dir}/web-gaps.${l}.json`) };
  for (const [code, text] of Object.entries(errors)) cat[l][`error.${code}`] = text;
}
const problems = [];
// the set of placeholder names (a language with more plural forms repeats them: Arabic two / few / many)
// (a plural branch « one {impression} » is text, not a placeholder)
const ph = (s) => [...new Set([...String(s).matchAll(/(?<!(?:zero|one|two|few|many|other|=\d+)\s*)\{(\w+)[,}]/g)].map((m) => m[1]))].sort().join(',');
for (const key of Object.keys(cat.fr)) {
  for (const l of ['ar', 'en']) {
    const v = cat[l][key];
    if (v === undefined) problems.push(`missing ${l}: ${key}`);
    else if (!String(v).trim() || String(v).includes('⟦TODO⟧')) problems.push(`untranslated ${l}: ${key}`);
    else if (ph(v) !== ph(cat.fr[key])) problems.push(`placeholders differ ${l}: ${key}`);
  }
}
for (const l of ['ar', 'en']) for (const key of Object.keys(cat[l])) if (!(key in cat.fr)) problems.push(`extra ${l}: ${key}`);

const walk = (d, out = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'node_modules' && f !== '.next') walk(p, out);
    } else if (/\.(tsx?|mts)$/.test(f) && !/\.spec\.tsx?$/.test(f)) out.push(p); // tests use made-up keys
  }
  return out;
};
const used = new Map();
const RE = [/\bt\(\s*'([^'$]+)'/g, /\bt\(\s*"([^"$]+)"/g, /\b(?:key|labelKey|titleKey|descriptionKey|hintKey|emptyKey)\s*:\s*'([a-z][\w]*\.[\w.]+)'/g];
for (const root of ['apps/web/src', 'packages/ui/src']) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    for (const re of RE) for (const m of src.matchAll(re)) if (!used.has(m[1])) used.set(m[1], file);
  }
}
for (const [key, file] of used) if (!(key in cat.fr)) problems.push(`unknown key used in ${file}: ${key}`);

if (problems.length) {
  console.error(problems.slice(0, 80).join('\n'));
  console.error(`\n${problems.length} i18n problem(s)`);
  process.exit(1);
}
console.log(`i18n ok — ${Object.keys(cat.fr).length} keys × 3 locales, ${used.size} literal keys used by the web app`);
