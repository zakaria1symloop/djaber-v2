// Takes back the bought PACK credits of one workspace, keeping its plan credits (owner request 11/11/2026, test shop).
// The admin screen « Retirer des crédits » only removes plan credits (bought packs belong to the merchant), so this is a
// server-side tool: one `CreditLedger(bucket=pack, kind=debit, action=adjustment)` row of minus the pack balance + an
// audit row. The purchases / invoices stay as they are.
// Usage, from the repo root on the server (cd /opt/djaber/v2):
//   node ~/remove-pack-credits.cjs <search words…>          shows the matching workspace(s) and what would be removed
//   node ~/remove-pack-credits.cjs <search words…> --yes    removes it (exactly one workspace must match)
// The search words are matched (letters and digits only, any case) against the workspace name / slug and the e-mail of
// its owner and members — every word must match, e.g. `usertest1000 testshoph07`.
const fs = require('fs');
const path = require('path');

const YES = process.argv.includes('--yes');
const terms = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
if (!terms.length) {
  console.error('usage (from the repo root): node ~/remove-pack-credits.cjs <search words…> [--yes]');
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

async function figures(wsId) {
  const latest = await db.creditLedger.findFirst({ where: { workspaceId: wsId, bucket: 'plan', kind: 'credit' }, orderBy: { periodStart: 'desc' }, select: { periodStart: true } });
  const period = latest?.periodStart ?? null;
  const plan = period ? await sum({ workspaceId: wsId, bucket: 'plan', periodStart: period }) : 0;
  const planLimit = period ? await sum({ workspaceId: wsId, bucket: 'plan', periodStart: period, kind: 'credit' }) : 0;
  const pack = await sum({ workspaceId: wsId, bucket: 'pack' });
  const packsBought = await db.creditPackPurchase.count({ where: { workspaceId: wsId, status: 'credited' } }).catch(() => null);
  return { plan, planLimit, pack, packsBought };
}

(async () => {
  const all = await db.workspace.findMany({ where: { deletedAt: null }, select: { id: true, name: true, slug: true, owner: { select: { email: true } }, memberships: { select: { user: { select: { email: true } } } } } });
  const hits = all.filter((w) => {
    const hay = norm([w.name, w.slug, w.owner?.email, ...w.memberships.map((m) => m.user?.email)].join(' '));
    return terms.every((t) => hay.includes(t));
  });
  if (!hits.length) {
    console.log(`No workspace matches « ${terms.join(' ')} ». Try fewer words (e.g. only the e-mail or only the shop name).`);
    return;
  }
  for (const w of hits) {
    const f = await figures(w.id);
    console.log(`${w.name}  (slug ${w.slug}, owner ${w.owner?.email ?? '—'})`);
    console.log(`  plan credits left this month: ${f.plan} / ${f.planLimit}   pack credits left: ${f.pack}${f.packsBought === null ? '' : `   packs bought: ${f.packsBought}`}`);
  }
  if (hits.length > 1) {
    console.log(`\n${hits.length} workspaces match: add a word so only one is left (nothing changed).`);
    return;
  }
  const w = hits[0];
  const f = await figures(w.id);
  if (f.pack <= 0) {
    console.log('\nNo pack credit left on this workspace: nothing to remove.');
    return;
  }
  if (!YES) {
    console.log(`\nWould remove ${f.pack} pack credits (plan credits unchanged). Run again with --yes to do it.`);
    return;
  }
  await db.$transaction(async (tx) => {
    const row = await tx.creditLedger.create({
      data: { workspaceId: w.id, periodStart: null, bucket: 'pack', action: 'adjustment', kind: 'debit', credits: -f.pack, balanceAfter: Math.max(0, f.plan), reason: 'admin:remove:pack credits removed by server script (owner request 11/11, test shop)', idempotencyKey: `script-remove-pack:${w.id}:${Date.now()}` },
    });
    await tx.auditLog.create({ data: { workspaceId: w.id, actorType: 'system', action: 'credits.remove', entity: 'Workspace', entityId: w.id, after: { credits: -f.pack, bucket: 'pack', ledgerEntryId: row.id, via: 'tools/deploy/remove-pack-credits.cjs' }, reason: 'owner request 11/11: pack credits of a test shop removed, plan credits kept' } });
  });
  const after = await figures(w.id);
  console.log(`\nDONE: ${f.pack} pack credits removed. Now: plan ${after.plan} / ${after.planLimit}, packs ${after.pack}. The shop sees it at its next page load.`);
})()
  .catch((e) => {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
