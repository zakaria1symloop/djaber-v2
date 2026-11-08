// Read-only review of what the AI really answered, for ONE shop (a test shop): the AI routes of the platform (models,
// whether each provider has a key — never the key), the shop's agent, and its last conversations with the AI runs
// (status, intent, tools, errors). Message texts are printed with phone numbers and e-mail addresses masked: run it on a
// tester's shop, not on a client's.
// Usage, from the repo root on the server:  node ~/ai-review.cjs <owner e-mail> [number of conversations, default 5]
const fs = require('fs');
const path = require('path');

const email = (process.argv[2] ?? '').trim().toLowerCase();
const limit = Math.min(20, Math.max(1, Number(process.argv[3] ?? 5) || 5));
if (!email.includes('@')) {
  console.error('usage (from the repo root): node ~/ai-review.cjs <owner e-mail> [conversations]');
  process.exit(1);
}
const root = process.env.APP_DIR || process.cwd();
const envFile = [path.join(root, '.env'), path.join(root, 'apps/api/.env')].find((f) => fs.existsSync(f));
const env = envFile ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/) : [];
const value = (name) => (env.find((l) => new RegExp(`^\\s*${name}\\s*=`).test(l)) ?? '').replace(new RegExp(`^\\s*${name}\\s*=\\s*`), '').replace(/^["']|["']$/g, '').trim();
const url = value('DATABASE_URL');
if (!url) {
  console.error('DATABASE_URL not found in .env');
  process.exit(1);
}
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.join(root, 'packages/db')] }));
const db = new PrismaClient({ datasources: { db: { url } } });

const t = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(5, 16) : '—');
// phone numbers (0555 12 34 56, +213…, ٠٥٥٥…) and e-mail addresses are masked; texts are cut
const mask = (s, n = 500) =>
  String(s ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
    .replace(/(?:\+|00)?[0-9٠-٩][0-9٠-٩ .-]{7,}[0-9٠-٩]/g, '[tél]')
    .replace(/\s+/g, ' ')
    .slice(0, n);
const ENV_KEYS = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_AI_API_KEY', groq: 'GROQ_API_KEY' };

(async () => {
  console.log('== AI routes (model used for each capability)');
  const routes = await db.aiRoute.findMany({ include: { primaryModel: { include: { provider: true } }, fallbackModel: { include: { provider: true } } } });
  const key = (p) => (p ? `${p.key}${p.isActive ? '' : ' (provider OFF)'} key:${p.apiKey?.length ? 'stored' : value(ENV_KEYS[p.key]) ? (value(ENV_KEYS[p.key]).startsWith('sk-ant-usr') ? 'env (USER key: needs a workspace)' : 'env') : 'NONE'}` : '—');
  for (const r of routes) console.log(`${r.capability.padEnd(14)} primary ${r.primaryModel.modelId}${r.primaryModel.isActive ? '' : ' (OFF)'} [${key(r.primaryModel.provider)}]  ·  fallback ${r.fallbackModel ? `${r.fallbackModel.modelId} [${key(r.fallbackModel.provider)}]` : '—'}  ·  timeout ${r.timeoutSec}s${r.failoverActive ? '  ·  FAILOVER ON' : ''}`);

  const owner = await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { ownedWorkspaceId: true } });
  const ws = owner?.ownedWorkspaceId ? await db.workspace.findFirst({ where: { id: owner.ownedWorkspaceId, deletedAt: null }, select: { id: true, name: true } }) : null;
  if (!ws) return console.log(`\nno shop owned by ${email}`);
  console.log(`\n== shop « ${ws.name} »`);
  const agents = await db.agent.findMany({ where: { workspaceId: ws.id, deletedAt: null }, select: { name: true, status: true, personality: true, maxQtyPerOrder: true, maxAmountPerOrder: true, imageRecognition: true, customInstructions: true, model: { select: { modelId: true } } } });
  for (const a of agents) console.log(`agent « ${a.name} » ${a.status} · ${a.personality} · model ${a.model?.modelId ?? '—'} · photos ${a.imageRecognition ? 'on' : 'off'} · limits ${a.maxQtyPerOrder ?? '∞'} u / ${a.maxAmountPerOrder ?? '∞'} DA · instructions ${a.customInstructions.length} chars`);
  const products = await db.product.count({ where: { workspaceId: ws.id, deletedAt: null, isActive: true } });
  console.log(`active products: ${products}`);

  const since = new Date(Date.now() - 7 * 86_400_000);
  const runs = await db.aiRun.findMany({ where: { workspaceId: ws.id, kind: 'reply', startedAt: { gte: since } }, select: { status: true, error: true } });
  const tally = (rows, k) => Object.entries(rows.reduce((acc, r) => ((acc[k(r)] = (acc[k(r)] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]);
  console.log(`AI replies, last 7 days: ${runs.length} — ${tally(runs, (r) => (r.status === 'error' ? `error:${(r.error ?? '').slice(0, 60)}` : r.status)).map(([s, n]) => `${s} ${n}`).join(' · ')}`);

  const convs = await db.conversation.findMany({ where: { workspaceId: ws.id, deletedAt: null }, orderBy: { lastMessageAt: 'desc' }, take: limit, select: { id: true, status: true, aiPaused: true, context: true } });
  for (const c of convs) {
    console.log(`\n== conversation ${c.id} · ${c.status}${c.aiPaused ? ' · AI paused' : ''}${c.context?.handoffReason ? ` · handoff: ${c.context.handoffReason}` : ''}`);
    const msgs = await db.message.findMany({ where: { conversationId: c.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 40, select: { author: true, type: true, text: true, transcript: true, createdAt: true, aiRunId: true, payload: true, attachments: true } });
    const runIds = [...new Set(msgs.map((m) => m.aiRunId).filter(Boolean))];
    const byRun = new Map((await db.aiRun.findMany({ where: { id: { in: runIds } }, select: { id: true, status: true, intent: true, error: true, latencyMs: true, toolCalls: { select: { name: true } } } })).map((r) => [r.id, r]));
    for (const m of msgs.reverse()) {
      const who = m.author === 'customer' ? 'CLIENT' : m.author === 'ai' ? 'IA    ' : m.author === 'human' ? 'ÉQUIPE' : 'SYSTÈM';
      const media = Array.isArray(m.attachments) && m.attachments.length ? ` [${m.attachments.map((a) => a.type).join(', ')}]` : '';
      const cards = m.type === 'product_cards' ? `[fiches: ${(m.payload?.cards ?? []).map((x) => x.name).join(', ')}]` : '';
      const run = m.aiRunId && m.type !== 'product_cards' ? byRun.get(m.aiRunId) : null;
      const meta = run ? `   ⟨${run.status}/${run.intent ?? '-'}${run.toolCalls.length ? ` · ${run.toolCalls.map((x) => x.name).join('>')}` : ''}${run.error ? ` · ${run.error.slice(0, 60)}` : ''} · ${run.latencyMs ?? '?'} ms⟩` : '';
      console.log(`${t(m.createdAt)} ${who} ${cards || mask(m.text)}${m.transcript ? ` (vocal: ${mask(m.transcript, 200)})` : ''}${media}${meta}`);
    }
  }
})()
  .catch((e) => console.error(e.message))
  .finally(() => db.$disconnect());
