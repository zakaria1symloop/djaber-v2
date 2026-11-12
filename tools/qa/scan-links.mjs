// QA — every literal link in the code points to an existing page (run from the repo root: node tools/qa/scan-links.mjs).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
const root = 'apps/web/src/app/[locale]';
const routes = [];
const walk = (d, segs) => { for (const e of readdirSync(d)) { const p = join(d, e); if (!statSync(p).isDirectory()) { if (/^page\.tsx$/.test(e)) routes.push(segs.filter((s) => !/^\(.*\)$/.test(s))); continue; } walk(p, [...segs, e]); } };
walk(root, []);
const match = (path) => { const parts = path.split('/').filter(Boolean); return routes.some((r) => { if (r.some((s) => s.startsWith('[...'))) { const i = r.findIndex((s) => s.startsWith('[...')); return parts.length >= i && r.slice(0, i).every((s, k) => s.startsWith('[') || s === parts[k]); } return r.length === parts.length && r.every((s, k) => s.startsWith('[') || s === parts[k]); }); };
const files = []; const w2 = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(p)) w2(p); } else if (/\.(tsx?|json)$/.test(e) && !/\.(spec|test|stories)\./.test(e)) files.push(p); } };
w2('apps/web/src'); w2('packages/shared/src'); w2('apps/api/src');
const bad = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:href|to|link|url|path|deepLink|route)\s*[:=]\s*[{(]?\s*[`'"]\/(?:\$\{locale\}\/|fr\/|ar\/|en\/)?([a-z][a-z0-9\-/]*)(?:[?#`'"$])/gi)) {
    const path = m[1].replace(/\/$/, '');
    if (/^(api|_next|dev-storage|static|images|icons|fonts|v1)\b/.test(path)) continue;
    globalThis.n=(globalThis.n||0)+1; if (!match(path)) { const k = `/${path}`; bad.set(k, [...(bad.get(k) ?? []), `${f}:${src.slice(0, m.index).split('\n').length}`]); }
  }
}
console.log(`${globalThis.n} links checked, ${routes.length} pages; ${bad.size} linked paths with no page:`);
for (const [k, v] of bad) console.log(k, '  ←', v.slice(0, 3).join(', '), v.length > 3 ? `(+${v.length - 3})` : '');
