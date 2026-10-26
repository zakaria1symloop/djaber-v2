// Read-only diagnosis of one account on the server: why does the AI not answer its customers?
// Walks every gate of FL-01 (workspace, subscription, credits / quota, channel, agent, conversation handed off / paused,
// manual replies from the page, AI errors, Meta webhooks) for each workspace of the user.
// Prints states, ids, times and error texts only — never a customer name, phone, address or message text.
// Usage, from the repo root on the server (the script may sit outside it):  node ~/diag-user.cjs <email>
const fs = require('fs');
const path = require('path');

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('usage (from the repo root): node ~/diag-user.cjs <email>');
  process.exit(1);
}
const root = process.env.APP_DIR || process.cwd();
const envFile = [path.join(root, '.env'), path.join(root, 'apps/api/.env')].find((f) => fs.existsSync(f));
const line = envFile && fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
if (!line) {
  console.error('DATABASE_URL not found in .env');
  process.exit(1);
}
const url = line.replace(/^\s*DATABASE_URL\s*=\s*/, '').replace(/^["']|["']$/g, '');
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.join(root, 'packages/db')] }));
const db = new PrismaClient({ datasources: { db: { url } } });

const t = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '—');
const cut = (s, n = 300) => (s ? String(s).replace(/\s+/g, ' ').slice(0, n) : '—');
const tally = (rows, key) => Object.entries(rows.reduce((acc, r) => ((acc[key(r)] = (acc[key(r)] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]);
const problems = [];

async function workspace(m) {
  const ws = m.workspace;
  const id = ws.id;
  console.log(`\n################ workspace ${id.slice(-8)}  (role ${m.role}${m.readOnly ? ', read-only' : ''})`);
  console.log({ status: ws.status, suspendReason: ws.suspendReason, deletionScheduledAt: t(ws.deletionScheduledAt), deleted: !!ws.deletedAt, trustLevel: ws.trustLevel, autoPauseOnManualReply: ws.autoPauseOnManualReply });
  if (ws.status !== 'active' || ws.deletedAt) problems.push(`workspace ${id.slice(-8)} is ${ws.deletedAt ? 'deleted' : ws.status} — the AI answers nothing`);

  const subs = await db.subscription.findMany({ where: { workspaceId: id }, orderBy: { createdAt: 'desc' }, take: 3, include: { plan: { select: { slug: true, maxConversationsPerMonth: true } } } });
  console.log('== subscriptions (newest first)');
  for (const s of subs) console.log(`${s.status.padEnd(10)} ${s.plan.slug.padEnd(12)} cycle ${s.billingCycle}  period ${t(s.currentPeriodStart)} → ${t(s.currentPeriodEnd)}  trialEnds ${t(s.trialEndsAt)}  dunning ${s.dunningStage ?? '—'}  conv/month ${s.plan.maxConversationsPerMonth}`);
  const live = subs.find((s) => ['trial', 'active', 'dunning'].includes(s.status));
  if (!live) problems.push(`workspace ${id.slice(-8)}: no trial / active subscription`);
  else if (live.currentPeriodEnd < new Date()) problems.push(`workspace ${id.slice(-8)}: subscription period ended ${t(live.currentPeriodEnd)}`);

  const ledger = await db.creditLedger.findMany({ where: { workspaceId: id }, orderBy: { createdAt: 'desc' }, take: 6, select: { createdAt: true, bucket: true, action: true, kind: true, credits: true, balanceAfter: true, reason: true } });
  console.log('== last credit movements (newest first)');
  for (const l of ledger) console.log(`${t(l.createdAt)}  ${l.bucket.padEnd(5)} ${l.action.padEnd(10)} ${l.kind.padEnd(7)} ${String(l.credits).padStart(6)}  balanceAfter ${l.balanceAfter}  ${cut(l.reason, 60)}`);
  if (ledger[0] && ledger[0].balanceAfter <= 0) problems.push(`workspace ${id.slice(-8)}: credit balance is ${ledger[0].balanceAfter}`);

  const channels = await db.channel.findMany({ where: { workspaceId: id }, include: { agentChannels: { include: { agent: { select: { id: true, name: true, status: true, isActive: true, pausedReason: true, deletedAt: true, businessHours: true, model: { select: { modelId: true, isActive: true } } } } } } } });
  console.log('== channels and their agent');
  if (!channels.length) problems.push(`workspace ${id.slice(-8)}: no Facebook / Instagram page connected`);
  for (const c of channels) {
    const a = c.agentChannels[0]?.agent;
    console.log({ channel: c.id.slice(-8), platform: c.platform, pageId: c.externalId, status: c.status, pausedReason: c.pausedReason, hasToken: !!c.accessToken, tokenExpiresAt: t(c.tokenExpiresAt), webhookSubscribed: c.webhookSubscribed, lastSeenAt: t(c.lastSeenAt), lastTokenCheckAt: t(c.lastTokenCheckAt), scopes: c.grantedScopes.length });
    console.log('   agent', a ? { id: a.id.slice(-8), status: a.status, isActive: a.isActive, pausedReason: a.pausedReason, deleted: !!a.deletedAt, model: a.model?.modelId, modelActive: a.model?.isActive, businessHours: a.businessHours ?? null } : 'NONE linked');
    if (c.status !== 'active') problems.push(`page ${c.externalId} (${c.platform}) is ${c.status}${c.pausedReason ? ` (${c.pausedReason})` : ''}`);
    if (!c.accessToken) problems.push(`page ${c.externalId} (${c.platform}) has no access token`);
    if (!c.webhookSubscribed) problems.push(`page ${c.externalId} (${c.platform}) is not subscribed to the Meta webhook`);
    if (!a) problems.push(`page ${c.externalId} (${c.platform}) has no agent linked`);
    else if (a.status !== 'active' || a.deletedAt) problems.push(`agent on page ${c.externalId} is ${a.deletedAt ? 'deleted' : a.status}${a.pausedReason ? ` (${a.pausedReason})` : ''}`);
    else if (a.model && !a.model.isActive) problems.push(`agent on page ${c.externalId} uses the disabled model ${a.model.modelId}`);
    const events = await db.channelEvent.findMany({ where: { channelId: c.id }, orderBy: { at: 'desc' }, take: 4, select: { at: true, kind: true, description: true } });
    for (const e of events) console.log(`   event ${t(e.at)}  ${e.kind}  ${cut(e.description, 120)}`);
    const hooks = await db.$queryRaw`SELECT count(*)::int AS n, count(*) FILTER (WHERE "error" IS NOT NULL)::int AS errors, count(*) FILTER (WHERE "processedAt" IS NULL)::int AS unprocessed, max("receivedAt") AS last FROM "InboundEvent" WHERE "receivedAt" > now() - interval '72 hours' AND "payload"::text LIKE ${'%' + c.externalId + '%'}`;
    const h = hooks[0];
    console.log(`   Meta webhooks for this page, 72 h: ${h.n} received, ${h.errors} with an error, ${h.unprocessed} not processed, last ${t(h.last)}`);
    if (c.status === 'active' && h.n === 0) problems.push(`page ${c.externalId} (${c.platform}): Meta sent NO webhook in 72 h — messages never reach Djaber`);
    if (h.errors) {
      const errs = await db.$queryRaw`SELECT "receivedAt", "error" FROM "InboundEvent" WHERE "receivedAt" > now() - interval '72 hours' AND "error" IS NOT NULL AND "payload"::text LIKE ${'%' + c.externalId + '%'} ORDER BY "receivedAt" DESC LIMIT 4`;
      for (const e of errs) console.log(`   webhook error ${t(e.receivedAt)}  ${cut(e.error, 200)}`);
    }
  }

  const since = new Date(Date.now() - 72 * 3600 * 1000);
  const convs = await db.conversation.findMany({ where: { workspaceId: id, deletedAt: null, lastCustomerMessageAt: { gte: since } }, orderBy: { lastCustomerMessageAt: 'desc' }, select: { id: true, status: true, aiPaused: true, context: true, lastCustomerMessageAt: true, channelId: true } });
  console.log(`== conversations with a customer message in the last 72 h (${convs.length}), by state`);
  const state = (c) => `${c.status}${c.aiPaused ? ' + AI paused' : ''}${c.context?.handoffReason ? `  reason ${c.context.handoffReason}` : ''}${c.context?.aiUnavailable ? `  banner ${c.context.aiUnavailable}` : ''}${c.context?.aiPausedById ? '  paused by a member' : ''}`;
  for (const [k, n] of tally(convs, state)) console.log(`${String(n).padStart(4)}  ${k}`);
  const blockedOut = convs.filter((c) => c.status === 'needs_human' || c.aiPaused).length;
  if (convs.length && blockedOut === convs.length) problems.push(`workspace ${id.slice(-8)}: ALL ${convs.length} recent conversations are handed to the team or paused — the AI skips them until « Reprendre l'IA »`);

  const recent = convs.slice(-8);
  if (recent.length) console.log('== last conversations (newest customer message first): AI runs after that message');
  for (const c of recent) {
    const runs = await db.aiRun.findMany({ where: { conversationId: c.id, kind: 'reply' }, orderBy: { startedAt: 'desc' }, take: 3, select: { startedAt: true, status: true, error: true, flags: true } });
    const manual = await db.message.count({ where: { conversationId: c.id, author: 'human', createdAt: { gte: since } } });
    console.log(`conv ${c.id}  last customer msg ${t(c.lastCustomerMessageAt)}  ${state(c)}  human msgs 72h ${manual}`);
    for (const r of runs) console.log(`     run ${t(r.startedAt)}  ${r.status.padEnd(8)} ${cut(r.error, 160)} ${r.flags?.length ? `[${r.flags.join(',')}]` : ''}`);
    if (!runs.length) console.log('     no AI run at all');
  }

  const runs = await db.aiRun.findMany({ where: { workspaceId: id, kind: 'reply', startedAt: { gte: since } }, select: { status: true, error: true } });
  console.log(`== AI reply runs, 72 h (${runs.length}), by status / error`);
  for (const [k, n] of tally(runs, (r) => `${r.status}${r.error ? `  ${cut(r.error, 140)}` : ''}`)) console.log(`${String(n).padStart(4)}  ${k}`);

  const failed = await db.message.findMany({ where: { workspaceId: id, direction: 'out', deliveryStatus: 'failed', createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 6, select: { createdAt: true, author: true, type: true, error: true, payload: true } });
  console.log(`== outgoing messages Meta refused, 72 h (${failed.length} shown)`);
  for (const f of failed) {
    const m = f.payload?._sendError;
    console.log(`${t(f.createdAt)}  ${f.author.padEnd(7)} ${f.type.padEnd(14)} ${cut(f.error, 200)}${m ? `  Meta ${m.kind} #${m.code ?? '-'}/${m.subcode ?? '-'} http ${m.http ?? '-'}: ${cut(m.message, 200)}` : ''}`);
  }
  if (failed.length) problems.push(`workspace ${id.slice(-8)}: ${failed.length}+ answers were written but Meta refused to deliver them (see the errors above)`);
}

(async () => {
  const user = await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, status: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true } });
  if (!user) return console.log('no user with this email');
  console.log('== user', { id: user.id.slice(-8), status: user.status, emailVerified: !!user.emailVerifiedAt, createdAt: t(user.createdAt), lastLoginAt: t(user.lastLoginAt) });
  const memberships = await db.membership.findMany({ where: { userId: user.id }, include: { workspace: true } });
  if (!memberships.length) problems.push('the user belongs to no workspace');
  for (const m of memberships) await workspace(m);
  console.log('\n================ likely causes');
  if (!problems.length) console.log('nothing blocking found in the data — send the output and a conversation id from the inbox');
  for (const p of problems) console.log(' • ' + p);
})()
  .catch((e) => console.error('diag failed:', e.message))
  .finally(() => db.$disconnect());
