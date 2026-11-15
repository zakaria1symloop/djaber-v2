// Full-site test campaign: rebuilds docs/audit/2026-11-15-full-test-report.md from the area files and status.json, and
// prints the campaign state (one line per area) for the loop. Run from the repo root: node tools/qa/merge-report.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = resolve('docs/audit/full-test-2026-11-15');
const status = JSON.parse(readFileSync(resolve(base, 'status.json'), 'utf8'));
const areasDir = resolve(base, 'areas');
const files = existsSync(areasDir) ? readdirSync(areasDir).filter((f) => f.endsWith('.md')) : [];
const SEV = ['Blocker', 'Major', 'Minor', 'Cosmetic'];
const counts = Object.fromEntries(SEV.map((s) => [s, 0]));
const perArea = {};
const sections = [];
for (const area of Object.keys(status)) {
  const f = `${area}.md`;
  if (!files.includes(f)) continue;
  const text = readFileSync(resolve(areasDir, f), 'utf8');
  const bugs = [...text.matchAll(/^### .+$/gm)].length;
  const sev = Object.fromEntries(SEV.map((s) => [s, [...text.matchAll(new RegExp(`^- Severity:\\s*${s}`, 'gmi'))].length]));
  for (const s of SEV) counts[s] += sev[s];
  perArea[area] = { bugs, sev, done: /^## Coverage/m.test(text) };
  sections.push(text.replace(/^# /m, '## ').replace(/^## (?!Area)/gm, '### ').replace(/^### (?=[A-Z-]+-\d)/gm, '#### '));
}
const total = SEV.reduce((n, s) => n + counts[s], 0);
const topFile = resolve(base, 'top-issues.md');
const top = existsSync(topFile) ? `${readFileSync(topFile, 'utf8').trim()}

` : '';
const progress = Object.entries(status)
  .map(([a, v]) => `| ${a} | ${v.state}${v.startedAt ? ` (since ${v.startedAt.slice(0, 16).replace('T', ' ')} UTC)` : ''} | ${perArea[a]?.bugs ?? 0} | ${perArea[a] ? SEV.map((s) => perArea[a].sev[s]).join(' / ') : '—'} |`)
  .join('\n');
const out = `# Full-site test report — live djaber.vercel.app (campaign from 15/11/2026)

Method and rules: \`docs/audit/full-test-2026-11-15/README.md\`. Each area is tested by an agent with Playwright on the live
site (test shop « Boutique Test Équipe »); this file is rebuilt from \`full-test-2026-11-15/areas/*.md\` by \`tools/qa/merge-report.mjs\`.

${top}## Progress
| area | state | bugs | blocker / major / minor / cosmetic |
|---|---|---|---|
${progress}

## Summary by severity
${total} bugs — ${SEV.map((s) => `${s} ${counts[s]}`).join(' · ')}

${sections.join('\n\n')}
`;
writeFileSync(resolve('docs/audit/2026-11-15-full-test-report.md'), out);
for (const [a, v] of Object.entries(status)) console.log(`${a}\t${v.state}\t${v.startedAt ?? ''}\tfile=${files.includes(`${a}.md`) ? 'yes' : 'no'}\tcoverage=${perArea[a]?.done ? 'yes' : 'no'}\tbugs=${perArea[a]?.bugs ?? 0}`);
console.log(`TOTAL ${total} (${SEV.map((s) => `${s} ${counts[s]}`).join(', ')})`);
