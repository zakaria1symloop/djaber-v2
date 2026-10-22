// M10 ADM-11 — abuse reports, platform blacklist ⇒ CustomerBlock(source=platform), platform blocked words, platform
// auto-rules (`sched-abuse-auto-rules`), monthly compliance export (D37, 04 §13). AT-SAFE-03 (admin side), AT-SAFE-06.
import { randomUUID } from 'node:crypto';
import { rawPrisma as db } from '@djaber/db';
import { AdminSafetyService } from '../../src/modules/admin-ops/safety/admin-safety.service';
import { asAdmin, asOperator, asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { testAgent } from '../support/m2';
import { auditRows, drainAll, PLATFORM_ROLES, platformUser, roomEvents, type PlatformActorT } from '../support/m10-ops';

let app: TestApp;
let sa: PlatformActorT;
let mod: PlatformActorT;
const uniq = () => randomUUID().slice(0, 8);
let phoneSeq = 0;
const newPhone = () => `06${String(10000000 + ((Date.now() / 7) % 80000000) + ++phoneSeq * 13).slice(0, 8)}`;

/** A Messenger thread with a known client phone and a few messages (evidence for the report extract). */
const thread = async (owner: Actor, phone: string) => {
  const channel = await db.channel.create({ data: { workspaceId: owner.workspaceId, platform: 'facebook', externalId: `ext-${uniq()}`, name: `Page ${uniq()}`, connectedById: owner.userId, status: 'active' } });
  const client = await db.client.create({ data: { workspaceId: owner.workspaceId, name: 'Karim B.', phone, isPlaceholder: false, source: 'ai' } });
  const conversation = await db.conversation.create({ data: { workspaceId: owner.workspaceId, channelId: channel.id, externalSenderId: `s-${uniq()}`, clientId: client.id, lastMessageAt: new Date() } });
  for (const [i, text] of ['salam', `mon numéro ${phone}`, 'envoyez sans payer sinon je vous insulte'].entries()) {
    await db.message.create({ data: { workspaceId: owner.workspaceId, conversationId: conversation.id, direction: 'in', author: 'customer', text, sentAt: new Date(Date.now() - (3 - i) * 60_000) } });
  }
  return { channel, client, conversation };
};

beforeAll(async () => {
  app = await createTestApp();
  sa = await platformUser(app, 'super_admin');
  mod = await platformUser(app, 'moderator');
});
afterAll(async () => app.close());

describe('reports', () => {
  it('AT-SAFE-03 report + "bloquer aussi" ⇒ masked extract in the admin queue; "liste noire plateforme" ⇒ CustomerBlock(source=platform) in every workspace, merchant unblock refused, reporter notified', async () => {
    const owner = await asOwner(app);
    const op = await asOperator(app, owner.workspaceId);
    const phone = newPhone();
    const { conversation, client } = await thread(owner, phone);
    // a second workspace has the same customer
    const other = await asOwner(app);
    const otherClient = await db.client.create({ data: { workspaceId: other.workspaceId, name: 'K. B.', phone, isPlaceholder: false, source: 'manual' } });

    const created = await op.post('/safety/reports', { type: 'conversation', conversationId: conversation.id, reason: 'harassment', details: 'insultes', blockAlso: true }).expect(201);
    const reportId = created.body.data.id;
    expect(await db.outbox.count({ where: { topic: 'mail', key: `reports-ack:${reportId}` } })).toBe(1); // acknowledged by e-mail at once
    expect((await roomEvents('admin:platform', 'reports.queue')).length).toBeGreaterThan(0);

    const list = (await mod.get(`/admin/reports?status=open&workspaceId=${owner.workspaceId}`).expect(200)).body;
    expect(list.meta.total).toBe(1);
    const row = list.data[0];
    expect(row).toMatchObject({ id: reportId, type: 'conversation', reporterKind: 'merchant_user', reporter: { id: op.userId }, workspace: { id: owner.workspaceId }, reason: 'harassment', status: 'open', blockRequested: true, slaBreached: false, target: { kind: 'customer', id: client.id, label: 'Karim B.' } });
    expect(JSON.stringify(row)).not.toContain(phone);
    expect(row.excerpt.some((m: { text: string }) => m.text.includes(`${phone.slice(0, 2)}•• •• •• ${phone.slice(-2)}`))).toBe(true);
    expect(row.signals).toEqual(expect.arrayContaining(['blocked_by_workspaces:1', 'block_requested']));

    // decision: platform blacklist
    expect((await mod.post(`/admin/reports/${reportId}/decide`, { decision: 'platform_blacklist', note: 'court', notifyReporter: true }).expect(422)).body.error.code).toBe('ADMIN_REASON_REQUIRED');
    const decided = await mod.post(`/admin/reports/${reportId}/decide`, { decision: 'platform_blacklist', note: 'Harcèlement confirmé sur 2 boutiques', notifyReporter: true }).expect(200);
    expect(decided.body.data).toMatchObject({ status: 'actioned', decision: 'platform_blacklist', decisionNote: 'Harcèlement confirmé sur 2 boutiques' });
    expect(decided.body.data.signals).toContain('platform_blacklisted');
    const platformBlocks = await db.customerBlock.findMany({ where: { phone, source: 'platform', unblockedAt: null } });
    expect(platformBlocks.map((b) => b.workspaceId).sort()).toEqual([owner.workspaceId, other.workspaceId].sort());
    expect(platformBlocks.find((b) => b.workspaceId === other.workspaceId)?.clientId).toBe(otherClient.id);
    const bl = await db.platformBlacklist.findUniqueOrThrow({ where: { phone } });
    expect(bl).toMatchObject({ reportId, workspaceCount: 2, createdById: mod.userId });

    // merchant side: the platform row shows the lock and cannot be lifted
    const otherAdmin = await asAdmin(app, other.workspaceId);
    const blocks = (await otherAdmin.get('/safety/blocks').expect(200)).body.data;
    const prow = blocks.find((b: { source: string }) => b.source === 'platform');
    expect(prow).toMatchObject({ source: 'platform', unblockable: false });
    expect((await otherAdmin.delete(`/safety/blocks/${prow.id}`).expect(403)).body.error.code).toBe('CUSTOMER_BLOCKED_BY_PLATFORM');

    // reporter gets report.resolved; second decision refused
    await drainAll(app, ['notification']);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'report_resolved', userId: op.userId } })).toBe(1);
    expect((await mod.post(`/admin/reports/${reportId}/decide`, { decision: 'dismissed', note: 'Erreur de traitement' }).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await auditRows('report.platform_blacklist', reportId))[0]).toMatchObject({ actorType: 'admin', actorId: mod.userId, reason: 'Harcèlement confirmé sur 2 boutiques' });
    expect((await roomEvents(`ws:${owner.workspaceId}`, 'report.updated')).at(-1)?.payload).toMatchObject({ id: reportId, status: 'actioned' });
  });

  it('a client created after the blacklisting is blocked too (block index), revoke lifts every platform block', async () => {
    const owner = await asOwner(app);
    const phone = newPhone();
    const added = await mod.post('/admin/blacklist', { phone, reason: 'Fraude répétée signalée par Meta' }).expect(201);
    expect(added.body.data).toMatchObject({ phone, workspaceCount: 0, revokedAt: null });
    expect((await mod.post('/admin/blacklist', { phone, reason: 'Fraude répétée signalée par Meta' }).expect(409)).body.error.code).toBe('CONFLICT');
    const c = await owner.post('/clients', { name: 'Nouveau client', phone }).expect(201);
    expect((await owner.get(`/clients/${c.body.data.id}`).expect(200)).body.data).toMatchObject({ blocked: true });
    // a client existing at blacklisting time gets a materialised row
    const phone2 = newPhone();
    await thread(owner, phone2);
    const second = await mod.post('/admin/blacklist', { phone: phone2, reason: 'Fraude répétée signalée par Meta' }).expect(201);
    expect(second.body.data.workspaceCount).toBe(1);
    expect((await mod.delete(`/admin/blacklist/${second.body.data.id}`, { reason: 'x' }).expect(422)).body.error.code).toBe('ADMIN_REASON_REQUIRED');
    const revoked = await mod.delete(`/admin/blacklist/${second.body.data.id}`, { reason: 'Erreur de numéro confirmée' }).expect(200);
    expect(revoked.body.data).toMatchObject({ revokedBy: { id: mod.userId } });
    expect(await db.customerBlock.count({ where: { phone: phone2, source: 'platform', unblockedAt: null } })).toBe(0);
    await mod.delete(`/admin/blacklist/${second.body.data.id}`, { reason: 'Erreur de numéro confirmée' }).expect(409);
    const page1 = (await mod.get('/admin/blacklist?active=true').expect(200)).body;
    expect(page1.data.map((r: { phone: string }) => r.phone)).toContain(phone);
    expect(page1.data.map((r: { phone: string }) => r.phone)).not.toContain(phone2);
    expect(await auditRows('blacklist.revoke', second.body.data.id)).toHaveLength(1);
  });

  it('other decisions, assign, stats, filters, 404, permissions per platform role and merchant users', async () => {
    const owner = await asOwner(app);
    const { conversation } = await thread(owner, newPhone());
    const r = (await owner.post('/safety/reports', { type: 'conversation', conversationId: conversation.id, reason: 'spam' }).expect(201)).body.data;
    const info = await mod.post(`/admin/reports/${r.id}/decide`, { decision: 'more_info', note: 'Merci de préciser les messages', notifyReporter: false }).expect(200);
    expect(info.body.data).toMatchObject({ status: 'reviewing', decision: 'more_info', resolvedAt: null });
    const assigned = await mod.post(`/admin/reports/${r.id}/assign`, { assigneeId: mod.userId }).expect(200);
    expect(assigned.body.data.assignee).toMatchObject({ id: mod.userId });
    expect((await mod.get('/admin/reports?assigneeId=me').expect(200)).body.data.map((x: { id: string }) => x.id)).toContain(r.id);
    await mod.post(`/admin/reports/${r.id}/assign`, { assigneeId: (await platformUser(app, 'finance')).userId }).expect(422);
    const dismissed = await mod.post(`/admin/reports/${r.id}/decide`, { decision: 'dismissed', note: 'Pas de contenu abusif trouvé', notifyReporter: true }).expect(200);
    expect(dismissed.body.data).toMatchObject({ status: 'dismissed' });
    const stats = (await mod.get('/admin/reports/stats').expect(200)).body.data;
    expect(stats).toEqual(expect.objectContaining({ open: expect.any(Number), over24h: expect.any(Number), handled30d: expect.any(Number), tabs: expect.objectContaining({ done: expect.any(Number) }) }));
    expect(stats.handled30d).toBeGreaterThanOrEqual(1);
    await mod.get('/admin/reports?type=nope').expect(422);
    await mod.get('/admin/reports/00000000-0000-7000-8000-000000000000').expect(404);
    await mod.post('/admin/reports/00000000-0000-7000-8000-000000000000/decide', { decision: 'dismissed', note: 'Pas de contenu abusif trouvé' }).expect(404);

    const r2 = (await owner.post('/safety/reports', { type: 'customer', clientId: conversation.clientId, reason: 'fraud' }).expect(201)).body.data;
    for (const role of PLATFORM_ROLES) {
      const u = await platformUser(app, role);
      await u.get('/admin/reports').expect(200);
      await u.get(`/admin/reports/${r2.id}`).expect(200);
      await u.get('/admin/blacklist').expect(200);
      await u.get('/admin/blocked-words').expect(200);
      await u.get('/admin/safety/auto-rules').expect(200);
      const w = await u.post(`/admin/reports/${r2.id}/assign`, { assigneeId: null });
      expect(w.status).toBe(role === 'super_admin' || role === 'moderator' ? 200 : 403);
      if (role !== 'super_admin' && role !== 'moderator') {
        await u.post('/admin/blacklist', { phone: newPhone(), reason: 'Raison suffisante ici' }).expect(403);
        await u.put('/admin/blocked-words', { words: [] }).expect(403);
      }
    }
    for (const m of [owner, await asOperator(app, owner.workspaceId)]) {
      expect((await m.get('/admin/reports').expect(403)).body.error.code).toBe('FORBIDDEN');
      await m.post(`/admin/reports/${r2.id}/decide`, { decision: 'dismissed', note: 'Raison suffisante ici' }).expect(403);
    }
  });
});

describe('blocked words, auto-rules, export', () => {
  it('platform blocked words: replace the list (deduplicated), audited; they flag inbound messages', async () => {
    const put = await mod.put('/admin/blocked-words', { words: [{ word: 'Arnaque' }, { word: 'arnaque' }, { word: 'نصب', locale: 'ar' }], reason: 'Liste initiale' }).expect(200);
    expect(put.body.data.words.map((w: { word: string }) => w.word).sort()).toEqual(['arnaque', 'نصب'].sort());
    expect((await mod.get('/admin/blocked-words').expect(200)).body.data.words).toHaveLength(2);
    await mod.put('/admin/blocked-words', { words: [{ word: 'x'.repeat(61) }] }).expect(422);
    expect((await auditRows('safety.platform_blocked_words'))[0]).toMatchObject({ actorId: mod.userId, after: { count: 2 } });
    expect((await mod.get('/admin/reports/stats').expect(200)).body.data.blockedWords).toBe(2);
  });

  it('UX-014 the « clients bloqués par les marchands · 7 j » tile counts the blocks still in force and lists them (they are not reports)', async () => {
    const o = await asOwner(app);
    const phone = newPhone();
    const c = await db.client.create({ data: { workspaceId: o.workspaceId, name: 'Client UX014', phone, isPlaceholder: false, source: 'manual' } });
    const before = (await mod.get('/admin/reports/stats').expect(200)).body.data;
    const block = (await o.post('/safety/blocks', { clientId: c.id, reason: 'spam' }).expect(201)).body.data;
    const after = (await mod.get('/admin/reports/stats').expect(200)).body.data;
    expect(after.merchantBlocks7d).toBe(before.merchantBlocks7d + 1);
    expect(after.tabs.todo).toBe(before.tabs.todo); // no report behind it
    const rows = (await mod.get('/admin/reports/blocks').expect(200)).body.data;
    const row = rows.find((r: any) => r.id === block.id);
    expect(row).toMatchObject({ workspace: { id: o.workspaceId }, client: { id: c.id }, reason: 'spam', source: 'manual' });
    expect(row.phone).not.toBe(phone); // masked
    await o.delete(`/safety/blocks/${block.id}`).expect(200);
    expect((await mod.get('/admin/reports/stats').expect(200)).body.data.merchantBlocks7d).toBe(before.merchantBlocks7d);
    expect((await mod.get('/admin/reports/blocks').expect(200)).body.data.map((r: any) => r.id)).not.toContain(block.id);
  });

  it('AT-SAFE-06 phone blocked by 3 workspaces in 7 d ⇒ system report proposing the blacklist; 3 end-customer reports of a merchant ⇒ "revue de l\'espace"; 5 AI-message reports on one agent ⇒ platform alert; idempotent', async () => {
    const phone = newPhone();
    for (let i = 0; i < 3; i++) {
      const o = await asOwner(app);
      const c = await db.client.create({ data: { workspaceId: o.workspaceId, name: `Client ${i}`, phone, isPlaceholder: false, source: 'manual' } });
      await o.post('/safety/blocks', { clientId: c.id, reason: 'fraud' }).expect(201);
    }
    const target = await asOwner(app);
    await db.report.createMany({ data: Array.from({ length: 3 }, (_, i) => ({ type: 'merchant' as const, reporterKind: 'end_customer' as const, reporterEmail: `c${i}@test.dz`, targetWorkspaceId: target.workspaceId, reason: 'fraud' as const })) });
    const agentWs = await asOwner(app);
    const channel = await db.channel.create({ data: { workspaceId: agentWs.workspaceId, platform: 'facebook', externalId: `ext-${uniq()}`, name: 'P', connectedById: agentWs.userId, status: 'active' } });
    const conv = await db.conversation.create({ data: { workspaceId: agentWs.workspaceId, channelId: channel.id, externalSenderId: `s-${uniq()}` } });
    const agent = await testAgent(agentWs.workspaceId);
    const model = await db.aiModel.findUniqueOrThrow({ where: { id: agent.modelId! } });
    for (let i = 0; i < 5; i++) {
      const run = await db.aiRun.create({ data: { workspaceId: agentWs.workspaceId, agentId: agent.id, conversationId: conv.id, kind: 'reply', status: 'ok', modelId: model.id, providerId: model.providerId } as never });
      await db.report.create({ data: { workspaceId: agentWs.workspaceId, type: 'ai_message', reporterKind: 'merchant_user', aiRunId: run.id, reason: 'ai_incorrect' } });
    }

    const out = await app.app.get(AdminSafetyService).autoRules();
    // other suites of the run share the database: at least this test's hits
    expect(out.customerReports).toBeGreaterThanOrEqual(1);
    expect(out.merchantReports).toBeGreaterThanOrEqual(1);
    expect(out.alerts).toBeGreaterThanOrEqual(1);
    const sys = await db.report.findMany({ where: { reporterKind: 'system' }, orderBy: { createdAt: 'asc' } });
    expect(sys.find((r) => r.type === 'customer' && (r.excerpt as { phone?: string } | null)?.phone === phone)).toMatchObject({ severity: 'high', status: 'open', excerpt: expect.objectContaining({ phone, workspaces: 3 }) });
    expect(sys.find((r) => r.type === 'merchant' && r.targetWorkspaceId === target.workspaceId)).toMatchObject({ targetWorkspaceId: target.workspaceId, severity: 'high' });
    expect((await roomEvents('admin:platform', 'platform.alert')).some((e) => e.payload.kind === 'ai_reports' && e.payload.payload.agentId === agent.id)).toBe(true);
    // second run: nothing new
    expect(await app.app.get(AdminSafetyService).autoRules()).toEqual({ customerReports: 0, merchantReports: 0, alerts: 0 });
    const rules = (await mod.get('/admin/safety/auto-rules').expect(200)).body.data;
    expect(rules.map((r: { key: string }) => r.key)).toEqual(['phone_blocked_by_workspaces', 'merchant_reported_by_customers', 'ai_messages_reported']);
    expect(rules[0]).toMatchObject({ threshold: 3, windowDays: 7, lastRunAt: expect.any(String) });
    expect(rules[0].hits30d).toBeGreaterThanOrEqual(1);
    // the system report is decided like any other (blacklist proposal)
    const proposal = (await mod.get('/admin/reports?reporterKind=system&type=customer').expect(200)).body.data.find((r: { target: { meta?: { phone?: string } } }) => r.target.meta?.phone === `${phone.slice(0, 2)}•• •• •• ${phone.slice(-2)}`);
    expect(proposal.actions.find((a: { key: string }) => a.key === 'platform_blacklist')).toMatchObject({ enabled: true });
    await mod.post(`/admin/reports/${proposal.id}/decide`, { decision: 'platform_blacklist', note: 'Bloqué par 3 boutiques en une semaine' }).expect(200);
    expect(await db.customerBlock.count({ where: { phone, source: 'platform' } })).toBe(3);
  });

  it('monthly compliance export: 202 job, CSV counts by type / decision, status with signed URL; moderator / super_admin only', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const req = await mod.get(`/admin/safety/export?month=${month}`).expect(202);
    const jobId = req.body.data.jobId;
    expect((await mod.get(`/admin/safety/export/${jobId}`).expect(200)).body.data.status).toBe('queued');
    expect(await drainAll(app, ['job'])).toContain('safety-export');
    const done = (await mod.get(`/admin/safety/export/${jobId}`).expect(200)).body.data;
    expect(done).toMatchObject({ status: 'done', month, resultUrl: expect.any(String) });
    expect(done.rows).toBeGreaterThan(0);
    await mod.get('/admin/safety/export?month=2026-13').expect(422);
    await (await platformUser(app, 'support')).get(`/admin/safety/export?month=${month}`).expect(403);
    await sa.get('/admin/safety/export/00000000-0000-7000-8000-000000000000').expect(404);
  });
});
