// Read-only diagnosis of one conversation on the server: why does the AI not answer it?
// Prints states, ids, times and error texts only — never a customer name, phone, address or message text.
// Usage, from the repo root on the server (the script may sit outside it):  node ~/diag-conversation.cjs <conversationId>
const fs = require('fs');
const path = require('path');

// Without an id: an overview of the last 24 h, all workspaces (why conversations went to the team, AI errors by cause).
const id = process.argv[2];
if (id && !/^[0-9a-f-]{36}$/i.test(id)) {
  console.error('usage (from the repo root): node ~/diag-conversation.cjs [conversationId]');
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
const cut = (s, n = 400) => (s ? String(s).replace(/\s+/g, ' ').slice(0, n) : '—');

const tally = (rows, key) => Object.entries(rows.reduce((acc, r) => ((acc[key(r)] = (acc[key(r)] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]);

async function overview() {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const queued = await db.conversation.findMany({ where: { status: 'needs_human', deletedAt: null, updatedAt: { gte: since } }, select: { id: true, context: true } });
  console.log('== conversations handed to the team in the last 24 h, by reason');
  for (const [reason, n] of tally(queued, (c) => `${c.context?.handoffReason ?? '—'}${c.context?.aiUnavailable ? ` (banner: ${c.context.aiUnavailable})` : ''}`)) console.log(`${String(n).padStart(4)}  ${reason}`);
  const runs = await db.aiRun.findMany({ where: { kind: 'reply', startedAt: { gte: since } }, select: { status: true, error: true, modelId: true, flags: true } });
  const models = await db.aiModel.findMany({ where: { id: { in: [...new Set(runs.map((r) => r.modelId))] } }, select: { id: true, modelId: true } });
  const model = (mid) => models.find((m) => m.id === mid)?.modelId ?? mid;
  console.log(`== AI reply runs in the last 24 h (${runs.length}), by status`);
  for (const [status, n] of tally(runs, (r) => r.status)) console.log(`${String(n).padStart(4)}  ${status}`);
  console.log('== AI errors in the last 24 h, by cause and model');
  for (const [cause, n] of tally(runs.filter((r) => r.status === 'error'), (r) => `${cut(r.error, 120)}  ·  ${model(r.modelId)}`)) console.log(`${String(n).padStart(4)}  ${cause}`);
  const salvaged = runs.filter((r) => (r.flags ?? []).includes('format_salvaged')).length;
  if (salvaged) console.log(`== answers saved from a bad format (sent anyway): ${salvaged}`);
  const insights = await db.agentInsight.findMany({ where: { createdAt: { gte: since }, type: { in: ['handoff', 'unknown_topic', 'error'] } }, select: { type: true, detail: true } });
  console.log('== handoff / unknown / error insights in the last 24 h');
  for (const [k, n] of tally(insights, (i) => `${i.type}  ${cut(i.detail, 80)}`)) console.log(`${String(n).padStart(4)}  ${k}`);
}

(async () => {
  if (!id) return overview();
  const c = await db.conversation.findUnique({ where: { id }, include: { channel: { select: { id: true, platform: true, status: true } } } });
  if (!c) return console.log('conversation not found');
  const ctx = c.context ?? {};
  console.log('== conversation');
  console.log({ status: c.status, aiPaused: c.aiPaused, deleted: !!c.deletedAt, channel: c.channel, lastCustomerMessageAt: t(c.lastCustomerMessageAt), handoffReason: ctx.handoffReason ?? null, handoffAt: ctx.handoffAt ?? null, aiUnavailable: ctx.aiUnavailable ?? null, pausedByMember: !!ctx.aiPausedById });

  const link = await db.agentChannel.findUnique({ where: { channelId: c.channelId }, include: { agent: { select: { id: true, status: true, deletedAt: true, pausedReason: true } } } });
  console.log('== agent', link ? { status: link.agent.status, deleted: !!link.agent.deletedAt, pausedReason: link.agent.pausedReason } : 'no agent linked to the channel');

  const client = c.clientId ? await db.client.findUnique({ where: { id: c.clientId }, select: { phone: true, riskLevel: true } }) : null;
  const blocks = await db.customerBlock.findMany({
    where: { workspaceId: c.workspaceId, unblockedAt: null, OR: [...(c.clientId ? [{ clientId: c.clientId }] : []), { channelId: c.channelId, externalSenderId: c.externalSenderId }, ...(client?.phone ? [{ phone: client.phone }] : [])] },
    select: { reason: true, source: true, blockedAt: true },
  });
  const platform = client?.phone ? await db.platformBlacklist.count({ where: { phone: client.phone, revokedAt: null } }) : 0;
  console.log('== blocks', { workspaceBlocks: blocks.map((b) => `${b.reason}/${b.source} since ${t(b.blockedAt)}`), platformBlacklist: platform, clientRisk: client?.riskLevel ?? null });

  const runs = await db.aiRun.findMany({ where: { conversationId: id }, orderBy: { startedAt: 'desc' }, take: 12 });
  const models = await db.aiModel.findMany({ where: { id: { in: [...new Set(runs.map((r) => r.modelId))] } }, select: { id: true, modelId: true } });
  const model = (mid) => models.find((m) => m.id === mid)?.modelId ?? mid;
  console.log('== last AI runs of this conversation (newest first)');
  for (const r of runs) console.log(`${t(r.startedAt)}  ${r.status.padEnd(8)} attempt ${r.attempt ?? '-'}  ${model(r.modelId)}  ${cut(r.error)}`);

  const msgs = await db.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' }, take: 25, select: { id: true, createdAt: true, direction: true, author: true, type: true, deliveryStatus: true, error: true, payload: true } });
  // how each outgoing message was sent (RESPONSE inside 24 h, MESSAGE_TAG + tag outside) — from its `meta-send` outbox row
  const jobs = await db.outbox.findMany({ where: { topic: 'job', key: { in: msgs.map((m) => `send:${m.id}`) } }, select: { key: true, payload: true } });
  const how = (mid) => { const d = jobs.find((j) => j.key === `send:${mid}`)?.payload?.data; return d ? `${d.messagingType}${d.tag ? ` ${d.tag}` : ''}` : ''; };
  console.log('== last messages (no text), newest first');
  for (const m of msgs) {
    const se = m.payload?._sendError;
    console.log(`${t(m.createdAt)}  ${m.id.slice(-8)}  ${m.direction.padEnd(3)} ${m.author.padEnd(8)} ${m.type.padEnd(14)} ${m.deliveryStatus.padEnd(14)} ${how(m.id).padEnd(24)} ${m.error ? cut(m.error, 120) : ''}${m.payload?.external ? ' (typed in the page inbox)' : ''}${se ? `  Meta #${se.code}/${se.subcode}: ${cut(se.message, 160)}` : ''}`);
  }

  const insights = await db.agentInsight.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' }, take: 6, select: { createdAt: true, type: true, detail: true } });
  console.log('== last insights');
  for (const i of insights) console.log(`${t(i.createdAt)}  ${i.type}  ${cut(i.detail, 200)}`);

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const errs = await db.aiRun.findMany({ where: { status: 'error', startedAt: { gte: since } }, orderBy: { startedAt: 'desc' }, take: 8, select: { startedAt: true, conversationId: true, modelId: true, error: true } });
  const errModels = await db.aiModel.findMany({ where: { id: { in: [...new Set(errs.map((r) => r.modelId))] } }, select: { id: true, modelId: true } });
  console.log('== last AI errors, all workspaces, 24 h');
  for (const r of errs) console.log(`${t(r.startedAt)}  conv ${String(r.conversationId).slice(0, 8)}  ${errModels.find((m) => m.id === r.modelId)?.modelId ?? r.modelId}  ${cut(r.error)}`);
})()
  .catch((e) => console.error('diag failed:', e.message))
  .finally(() => db.$disconnect());
