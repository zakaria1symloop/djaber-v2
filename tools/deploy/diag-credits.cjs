// Read-only credit report of one workspace (retest 11/11 M-31 « credits not coherent with the operations »): the figures
// the screens show (top bar, Super Admin) and the ledger movements behind them, to compare before / after each operation.
// Usage, from the repo root on the server (cd /opt/djaber/v2):
//   node ~/diag-credits.cjs <search words…>      e.g. `node ~/diag-credits.cjs h07` or the owner's e-mail
// Search words match (letters and digits only, any case) the workspace name / slug and the owner / member e-mails.
const fs = require('fs');
const path = require('path');

const terms = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
if (!terms.length) {
  console.error('usage (from the repo root): node ~/diag-credits.cjs <search words…>');
  process.exit(1);
}
const root = process.env.APP_DIR || process.cwd();
const envFile = [path.join(root, '.env'), path.join(root, 'apps/api/.env')].find((f) => fs.existsSync(f));
const line = envFile && fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
if (!line) {
  console.error('DATABASE_URL not found in .env — run it from the repo root (cd /opt/djaber/v2)');
  process.exit(1);
}
const url = line.replace(/^\s*DATABASE_URL\s*=\s*/, '').replace(/^["']|["']$/g, '');
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.join(root, 'packages/db')] }));
const db = new PrismaClient({ datasources: { db: { url } } });
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sum = async (where) => (await db.creditLedger.aggregate({ where, _sum: { credits: true } }))._sum.credits ?? 0;
const n = (v) => new Intl.NumberFormat('fr-FR').format(v).replace(/ | /g, ' ');
const t = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '—');

(async () => {
  const all = await db.workspace.findMany({ where: { deletedAt: null }, select: { id: true, name: true, slug: true, owner: { select: { email: true } }, memberships: { select: { user: { select: { email: true } } } } } });
  const hits = all.filter((w) => terms.every((q) => norm([w.name, w.slug, w.owner?.email, ...w.memberships.map((m) => m.user?.email)].join(' ')).includes(q)));
  if (!hits.length) return console.log(`No workspace matches « ${terms.join(' ')} ».`);
  if (hits.length > 1) {
    for (const w of hits) console.log(`${w.name}  (slug ${w.slug}, owner ${w.owner?.email ?? '—'})`);
    return console.log(`\n${hits.length} workspaces match: add a word (e.g. the slug).`);
  }
  const w = hits[0];
  const sub = await db.subscription.findFirst({ where: { workspaceId: w.id, status: { in: ['trial', 'active', 'dunning'] } }, orderBy: { createdAt: 'desc' }, include: { plan: { select: { slug: true, monthlyCredits: true } } } });
  const latest = await db.creditLedger.findFirst({ where: { workspaceId: w.id, bucket: 'plan', kind: 'credit' }, orderBy: { periodStart: 'desc' }, select: { periodStart: true } });
  const ps = latest?.periodStart ?? null;
  const inP = { workspaceId: w.id, bucket: 'plan', periodStart: ps };
  // same rules as the API (retest 11/11): an admin take-back lowers the limit, « used » is what the AI consumed
  const limit = ps ? await sum({ ...inP, OR: [{ kind: 'credit' }, { kind: 'debit', action: 'adjustment' }] }) : 0;
  const used = ps ? -(await sum({ ...inP, kind: 'debit', NOT: { action: 'adjustment' } })) : 0;
  const planLeft = ps ? await sum(inP) : 0;
  const packLeft = await sum({ workspaceId: w.id, bucket: 'pack' });
  const packTotal = Math.max(0, await sum({ workspaceId: w.id, bucket: 'pack', OR: [{ kind: 'credit' }, { action: { in: ['store_refund', 'adjustment'] } }] }), packLeft);
  const unlimited = (sub?.plan.monthlyCredits ?? 0) < 0;
  console.log(`${w.name}  (slug ${w.slug}, owner ${w.owner?.email ?? '—'})`);
  console.log(`plan ${sub?.plan.slug ?? 'free'} (${sub?.status ?? 'no subscription'}), ${unlimited ? 'unlimited' : `${n(sub?.plan.monthlyCredits ?? 0)} credits / month`}, current credit period since ${t(ps)}`);
  console.log(`\n== figures`);
  console.log(`plan this month: used ${n(used)} / limit ${n(limit)}  (left ${n(planLeft)})`);
  console.log(`packs: used ${n(packTotal - Math.max(0, packLeft))} / bought ${n(packTotal)}  (left ${n(packLeft)})`);
  console.log(`total the AI can still use: ${unlimited ? 'unlimited' : n(planLeft + packLeft)}`);
  console.log(`\n== what the screens should show`);
  const packPart = packLeft > 0 ? ` · packs ${n(packTotal - packLeft)} / ${n(packTotal)}` : '';
  console.log(`shop top bar:      ⚡ ${n(used)} / ${unlimited ? '∞ (no pill)' : n(limit)}${packPart}`);
  console.log(`Super Admin list:  ${n(used)} / ${unlimited ? 'illimité' : n(limit)}${packPart}`);
  console.log(`credits page:      plan left ${n(Math.max(0, planLeft))} · packs left ${n(Math.max(0, packLeft))} · used this month ${n(used)}`);

  const rows = await db.creditLedger.findMany({ where: { workspaceId: w.id, kind: { in: ['credit', 'debit'] } }, orderBy: { createdAt: 'desc' }, take: 20, select: { createdAt: true, bucket: true, action: true, kind: true, credits: true, periodStart: true, reason: true } });
  console.log(`\n== last 20 movements (newest first; AI replies, grants, packs, take-backs)`);
  for (const r of rows) console.log(`${t(r.createdAt)}  ${r.bucket.padEnd(4)}  ${r.action.padEnd(18)} ${(r.credits > 0 ? '+' : '') + n(r.credits)}`.padEnd(64) + `${r.bucket === 'plan' && ps && r.periodStart && +r.periodStart !== +ps ? ' (earlier period)' : ''}  ${String(r.reason ?? '').replace(/^admin:/, '').slice(0, 60)}`);
})()
  .catch((e) => {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
