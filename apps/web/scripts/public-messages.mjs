// full-test 15/11 PUBLIC-04: the public pages (landing, features, pricing, help centre, legal, account deletion, status,
// tracking /s/[code], meta data-deletion) and the auth pages ship only the catalogue keys their code can show, not the
// merchant app / admin catalogue (≈ 600 KB of RSC payload in every HTML page before this).
//
// This script walks the import graph from the entry files of those routes (plus the locale layout, its providers and the
// locale-level not-found / error pages, which render outside any route group), collects every key the reachable code can
// produce — literal keys, `prefix.` + value concatenations and `prefix.${x}.suffix` templates — and writes the sorted list
// to `src/i18n/public-keys.json`. The locale layout gives that subset to the client; (app) / (admin) / (onboarding) and the
// other non-public routes add the rest of the catalogue in their own layout (`FullMessages`, lib/server-messages.tsx).
//
//   node apps/web/scripts/public-messages.mjs          → writes the list
//   node apps/web/scripts/public-messages.mjs --check  → exits 1 when the list is not up to date (also a unit test:
//                                                         src/i18n/public-keys.spec.ts)
// Runs before `next build` (package.json `prebuild`).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(WEB, '../..');
const SRC = join(WEB, 'src');
const APP = join(SRC, 'app', '[locale]');
const OUT = join(SRC, 'i18n', 'public-keys.json');

/** Route folders / files of `app/[locale]` that render with the public subset only. */
export const PUBLIC_ENTRIES = ['(public)', '(auth)', 's', 'status', 'meta', '[...rest]', 'preview', 'layout.tsx', 'not-found.tsx', 'error.tsx'];
/**
 * Keys a public page can show that no source literal names: API error codes (`error.<CODE>`, shown by forms and
 * error states from the response) and field messages (`validation.*`, the `fields` of a 422) — every one of the catalogue,
 * the server decides which one comes back.
 */
export const ALWAYS_PREFIXES = ['error.', 'validation.'];

const MESSAGES = join(ROOT, 'packages/shared/src/i18n/messages');
const FILES = ['deck', 'app', 'admin-core', 'api-agents', 'api-integrations', 'web-integrations', 'web-carryovers', 'web-public', 'web-gaps'];
export function catalogueKeys() {
  const keys = new Set();
  for (const f of FILES) for (const k of Object.keys(JSON.parse(readFileSync(join(MESSAGES, `${f}.fr.json`), 'utf8')))) keys.add(k);
  for (const code of Object.keys(JSON.parse(readFileSync(join(ROOT, 'packages/shared/src/errors/messages.fr.json'), 'utf8')))) keys.add(`error.${code}`);
  return keys;
}

const walk = (d, out = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts|mjs|js)$/.test(f) && !/\.(spec|test|stories)\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};

const EXT = ['', '.ts', '.tsx', '.mts', '.js', '/index.ts', '/index.tsx'];
const tryFile = (base) => {
  for (const e of EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
};
const PACKAGES = { '@djaber/shared': join(ROOT, 'packages/shared/src'), '@djaber/ui': join(ROOT, 'packages/ui/src') };
const SHARED_SUBPATHS = { messages: 'i18n/messages' };
function resolveImport(spec, from) {
  if (spec.startsWith('@/')) return tryFile(join(SRC, spec.slice(2)));
  if (spec.startsWith('.')) return tryFile(resolve(dirname(from), spec));
  for (const [name, dir] of Object.entries(PACKAGES)) {
    if (spec === name) return tryFile(join(dir, 'index'));
    if (spec.startsWith(`${name}/`)) {
      const sub = spec.slice(name.length + 1);
      return tryFile(join(dir, SHARED_SUBPATHS[sub] ?? sub));
    }
  }
  return null; // node_modules: no catalogue keys
}

// runtime imports only (`import type` / `export type` bring no code, so no text)
const IMPORT_RE = [
  /\bimport\s+(?!type\s)(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?!type\s)(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Every source file a public route can load (entries + their runtime imports, transitively). */
export function reachableFiles() {
  const seen = new Set();
  const queue = [];
  for (const e of PUBLIC_ENTRIES) {
    const p = join(APP, e);
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) queue.push(...walk(p));
    else queue.push(p);
  }
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const re of IMPORT_RE)
      for (const m of src.matchAll(re)) {
        const r = resolveImport(m[1], f);
        if (r && /\.(tsx?|mts|js)$/.test(r) && !seen.has(r)) queue.push(r);
      }
  }
  return [...seen].sort();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYISH = /^[a-z][\w-]*(?:\.[\w-]+)*\.?$/i;
/** The keys a source text can produce (see the header). */
export function keysIn(src, all) {
  const found = new Set();
  const prefixes = new Set();
  const patterns = [];
  // plain strings
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    const s = m[1] ?? m[2];
    if (!s || !KEYISH.test(s)) continue;
    if (all.has(s)) found.add(s);
    // 'error.' + code, `${'orders.status.'}${x}`: a literal ending with a dot is the head of a built key
    if (s.endsWith('.') && s.length > 2) prefixes.add(s);
    // a namespace path ('enum.Order.cancelReason') joined later with `${p}.${part}`: its children
    else if (s.includes('.')) prefixes.add(`${s}.`);
  }
  // template literals: `public.footer.${k}`, `help.category.${c}.description` (nested templates flattened)
  for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const body = m[1];
    if (!body.includes('${')) {
      if (all.has(body)) found.add(body);
      continue;
    }
    const parts = body.split(/\$\{(?:[^{}]|\{[^{}]*\})*\}/);
    if (!/^[a-z][\w-]*\./i.test(parts[0])) continue; // `/help/${slug}`, `${a} ${b}`: not a key
    patterns.push(new RegExp(`^${parts.map(esc).join('.+')}$`));
  }
  for (const k of all) {
    if (found.has(k)) continue;
    for (const p of prefixes) if (k.startsWith(p)) found.add(k);
    if (found.has(k)) continue;
    for (const re of patterns) if (re.test(k)) found.add(k);
  }
  return found;
}

/** The sorted key list of the public subset. */
export function publicKeys() {
  const all = catalogueKeys();
  const keys = new Set();
  for (const f of reachableFiles()) for (const k of keysIn(readFileSync(f, 'utf8'), all)) keys.add(k);
  for (const k of all) if (ALWAYS_PREFIXES.some((p) => k.startsWith(p))) keys.add(k);
  return [...keys].sort();
}

export const serialize = (keys) => `${JSON.stringify(keys, null, 0).replace(/","/g, '",\n"').replace(/^\[/, '[\n').replace(/\]$/, '\n]')}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keys = publicKeys();
  const text = serialize(keys);
  if (process.argv.includes('--files')) {
    for (const f of reachableFiles()) console.log(relative(ROOT, f));
  } else if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current.replace(/\r\n/g, '\n') !== text) {
      console.error(`${relative(ROOT, OUT)} is out of date: run node apps/web/scripts/public-messages.mjs`);
      process.exit(1);
    }
    console.log(`public i18n subset up to date — ${keys.length} keys`);
  } else {
    writeFileSync(OUT, text);
    console.log(`public i18n subset — ${keys.length} of ${catalogueKeys().size} keys → ${relative(ROOT, OUT)}`);
  }
}
