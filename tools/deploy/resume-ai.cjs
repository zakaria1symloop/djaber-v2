// Resumes the AI on one conversation from the server — the same change as « Reprendre l'IA » in the inbox
// (status back to active, AI pause and handoff fields cleared), for an owner who cannot click it. Prints states only.
// Usage, from the repo root on the server (the script may sit outside it):  node ~/resume-ai.cjs <conversationId>
const fs = require('fs');
const path = require('path');

const id = process.argv[2];
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
  console.error('usage (from the repo root): node ~/resume-ai.cjs <conversationId>');
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

const show = (c) => ({ status: c.status, aiPaused: c.aiPaused, handoffReason: c.context?.handoffReason ?? null, aiUnavailable: c.context?.aiUnavailable ?? null, pausedByMember: !!c.context?.aiPausedById });

(async () => {
  const c = await db.conversation.findFirst({ where: { id, deletedAt: null } });
  if (!c) return console.log('conversation not found');
  console.log('before', show(c));
  if (c.status !== 'needs_human' && !c.aiPaused) return console.log('the AI is not paused on this conversation — nothing to do');
  const context = { ...(c.context ?? {}), handoffAt: null, handoffReason: null, handoffRemindedAt: null, handoffMessageSentAt: null, aiPausedById: null, aiUnavailable: null };
  const updated = await db.conversation.update({ where: { id: c.id }, data: { status: c.status === 'needs_human' ? 'active' : c.status, aiPaused: false, version: { increment: 1 }, context } });
  console.log('after ', show(updated));
  console.log('done — the AI answers the next customer message (reload the inbox to see the banner gone)');
})()
  .catch((e) => console.error('resume failed:', e.message))
  .finally(() => db.$disconnect());
