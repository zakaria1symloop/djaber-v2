// M10 (api-a) — ADM-06 AI providers / models / routes / pricing, ADM-07 presets (publish ⇒ merchant "mise à jour disponible"),
// ADM-08 CMS, ADM-09 audit log + signed export (AT-AUD-01), ADM-17 viewers, ADM-01 overview + platform totals.
import { createHash, randomUUID } from 'node:crypto';
import { rawPrisma as db } from '@djaber/db';
import { CryptoService } from '../../src/core/crypto/crypto.service';
import { StorageService } from '../../src/core/storage/storage.service';
import { AgentService } from '../../src/modules/agents/agent.service';
import { AdminOverviewService } from '../../src/modules/admin-core/overview.service';
import { CmsAdminService } from '../../src/modules/admin-core/cms.service';
import { asOwner, asPlatform } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { forbidNetwork } from '../support/m3';
import { drainAll } from '../support/m10-ops';
import { pub } from '../support/m11';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  app = await createTestApp();
  net = forbidNetwork();
});
// global rows created here (presets, CMS entries) are removed so other suites keep their seed counts (same test database)
const createdPresets: string[] = [];
const createdCms: string[] = [];
afterAll(async () => {
  await db.agent.updateMany({ where: { preset: { key: { in: createdPresets } } }, data: { presetId: null } });
  await db.agentPreset.deleteMany({ where: { key: { in: createdPresets } } });
  await db.cmsEntry.deleteMany({ where: { key: { in: createdCms } } });
  net.restore();
  await app.close();
});

const REASON = 'Mise à jour validée en comité produit';
const lastAudit = (action: string, entityId: string) => db.auditLog.findFirst({ where: { action, entityId }, orderBy: { at: 'desc' } });

describe('ADM-06 AI providers, models, routes, pricing', () => {
  it('providers: key sealed (never returned, hint only), test states (ok / rejected / unreachable / no key), primary switch; support 403', async () => {
    const sa = await asPlatform(app);
    const list = (await sa.get('/admin/ai-providers').expect(200)).body.data;
    expect(list.map((p: any) => p.key)).toEqual(expect.arrayContaining(['openai', 'anthropic']));
    expect(JSON.stringify(list)).not.toMatch(/apiKey"/);
    expect((await (await asPlatform(app, 'support')).patch('/admin/ai-providers/openai', { isActive: true }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await sa.patch('/admin/ai-providers/nope', { isActive: true }).expect(404);
    await sa.patch('/admin/ai-providers/openai', { apiKey: 'short' }).expect(422);
    const secret = `sk-test-${randomUUID()}`;
    const p = (await sa.patch('/admin/ai-providers/openai', { apiKey: secret }).expect(200)).body.data;
    expect(p).toMatchObject({ key: 'openai', keySource: 'stored', keyHint: `sk-…${secret.slice(-4)}` });
    expect(JSON.stringify(p)).not.toContain(secret);
    const row = await db.aiProvider.findUniqueOrThrow({ where: { key: 'openai' } });
    expect(Buffer.from(row.apiKey!).toString('utf8')).not.toContain(secret);
    expect(app.app.get(CryptoService).decrypt(Buffer.from(row.apiKey!).toString('utf8'))).toBe(secret);
    const audit = await lastAudit('ai_provider.key_update', row.id);
    expect(JSON.stringify(audit)).not.toContain(secret);
    expect((await sa.post('/admin/ai-providers/openai/test', {}).expect(200)).body.data).toMatchObject({ ok: true, latencyMs: expect.any(Number) });
    expect((await db.aiProvider.findUniqueOrThrow({ where: { key: 'openai' } })).lastTestOk).toBe(true);
    expect((await sa.post('/admin/ai-providers/openai/test', { apiKey: 'sk-reject-123456' }).expect(401)).body.error).toMatchObject({ code: 'AI_PROVIDER_KEY_REJECTED', params: { provider: 'OpenAI' } });
    expect((await sa.post('/admin/ai-providers/openai/test', { apiKey: 'sk-unreachable-1234' }).expect(503)).body.error.code).toBe('AI_PROVIDER_UNREACHABLE');
    await db.aiProvider.update({ where: { key: 'google' }, data: { apiKey: null } });
    const saved = process.env.GOOGLE_AI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    const g = await sa.post('/admin/ai-providers/google/test', {});
    if (saved !== undefined) process.env.GOOGLE_AI_API_KEY = saved;
    if (!saved) expect(g.body.error.code).toBe('AI_PROVIDER_NO_KEY');
    // remove the stored key again (env bootstrap)
    await sa.patch('/admin/ai-providers/openai', { apiKey: null }).expect(200);
  });

  it('models CRUD + routes (validation, forced failover ⇒ merchant badge failover; deactivated primary ⇒ fallback used), pricing calculator + new version', async () => {
    const sa = await asPlatform(app);
    const models = (await sa.get('/admin/ai-models').expect(200)).body.data;
    expect(models.length).toBeGreaterThan(0);
    await sa.post('/admin/ai-models', { providerKey: 'openai', modelId: 'm', displayName: 'M', capabilities: [], inputPricePerM: 1, outputPricePerM: 1 }).expect(422);
    const mid = `gpt-test-${randomUUID().slice(0, 4)}`;
    const m = (await sa.post('/admin/ai-models', { providerKey: 'openai', modelId: mid, displayName: 'GPT test', capabilities: ['text'], inputPricePerM: 0.15, outputPricePerM: 0.6 }).expect(201)).body.data;
    expect(m).toMatchObject({ modelId: mid, providerKey: 'openai', usedBy: [] });
    expect((await sa.post('/admin/ai-models', { providerKey: 'openai', modelId: mid, displayName: 'dup', capabilities: ['text'], inputPricePerM: 1, outputPricePerM: 1 }).expect(409)).body.error.code).toBe('CONFLICT');
    const routes = (await sa.get('/admin/ai-routes').expect(200)).body.data;
    const text = routes.find((r: any) => r.capability === 'text');
    expect(text).toMatchObject({ state: expect.any(String), credits: expect.any(Number) });
    await sa.put('/admin/ai-routes/nope', { primaryModelId: m.id, creditCost: 1 }).expect(404);
    const vision = models.find((x: any) => x.capabilities.includes('vision') && !x.capabilities.includes('text'));
    if (vision) await sa.put('/admin/ai-routes/text', { primaryModelId: vision.id, creditCost: 1 }).expect(422);
    await sa.put('/admin/ai-routes/text', { primaryModelId: text.primary.modelId, creditCost: 1, failoverActive: true }).expect(422); // no fallback
    const put = (await sa.put('/admin/ai-routes/text', { primaryModelId: text.primary.modelId, fallbackModelId: m.id, creditCost: text.credits, failoverActive: true, reason: REASON }).expect(200)).body.data;
    expect(put).toMatchObject({ state: 'failover', fallback: { modelId: m.id } });
    expect(put.failoverSince).not.toBeNull();
    const owner = await asOwner(app);
    const badge = (await owner.get('/ai/routes').expect(200)).body.data.find((b: any) => b.capability === 'text');
    expect(badge).toMatchObject({ failover: true, model: { id: m.id } });
    await sa.delete(`/admin/ai-models/${m.id}`).expect(409); // routed
    // deactivate the primary ⇒ routing serves the fallback
    await sa.put('/admin/ai-routes/text', { primaryModelId: text.primary.modelId, fallbackModelId: m.id, creditCost: text.credits, failoverActive: false }).expect(200);
    const { RoutingService } = await import('../../src/modules/ai/routing.service');
    await sa.patch(`/admin/ai-models/${text.primary.modelId}`, { isActive: false }).expect(200);
    expect((await app.app.get(RoutingService).route('text')).primary.id).toBe(m.id);
    await sa.patch(`/admin/ai-models/${m.id}`, { isActive: false }).expect(200);
    await expect(app.app.get(RoutingService).route('text')).rejects.toMatchObject({ code: 'AGENT_MODEL_UNAVAILABLE' });
    // restore
    await sa.patch(`/admin/ai-models/${text.primary.modelId}`, { isActive: true }).expect(200);
    await sa.put('/admin/ai-routes/text', { primaryModelId: text.primary.modelId, fallbackModelId: text.fallback?.modelId ?? null, creditCost: text.credits, failoverActive: false }).expect(200);
    await sa.delete(`/admin/ai-models/${m.id}`).expect(204);
    expect(await lastAudit('ai_route.update', 'text')).toBeTruthy();

    const pricing = (await sa.get('/admin/ai-pricing').expect(200)).body.data;
    expect(pricing.simulation.rows.map((r: any) => r.capability)).toEqual(['text', 'vision', 'transcription']);
    const sim = (await sa.post('/admin/ai-pricing/simulate', { usdToDzd: 240, creditPriceDzd: 0.5, avgTokensPerMessage: 1850, targetMarginPct: 65 }).expect(200)).body.data;
    expect(sim.rows[0]).toMatchObject({ capability: 'text', unit: 'message', credits: expect.any(Number), belowTarget: expect.any(Boolean) });
    expect(sim.creditPriceForTargetDzd).toBeGreaterThan(0);
    await sa.post('/admin/ai-pricing/simulate', { usdToDzd: -1, creditPriceDzd: 0.5, avgTokensPerMessage: 1850, targetMarginPct: 65 }).expect(422);
    const body = { usdToDzd: 240, creditPriceDzd: 0.8, avgTokensPerMessage: 1850, targetMarginPct: 65, costs: { text: 2, image: 5, voice: 3, order: 0 } };
    await sa.post('/admin/ai-pricing/versions', body).expect(422);
    expect((await sa.post('/admin/ai-pricing/versions', { ...body, reason: 'court' }).expect(422)).body.error.code).toBe('ADMIN_REASON_REQUIRED');
    const v = (await sa.post('/admin/ai-pricing/versions', { ...body, effectiveAt: '2030-11-01', reason: REASON }).expect(201)).body.data;
    expect(v).toMatchObject({ costs: { text: 2 }, current: false });
    expect((await lastAudit('pricing.version', v.id))!.reason).toBe(REASON);
    await db.creditPricing.delete({ where: { id: v.id } });
  });
});

describe('ADM-07 presets', () => {
  it('create ⇒ draft v1, locale completeness, publish (PRESET_LOCALE_INCOMPLETE without FR), published immutable, new version ⇒ merchant agent shows the update + sched-preset-updates notification; archive / delete rules', async () => {
    const sa = await asPlatform(app);
    const key = `preset-${randomUUID().slice(0, 6)}`;
    createdPresets.push(key, `${key}-tmp`);
    await sa.post('/admin/agent-presets', { key: 'Bad Key', name: { fr: 'X' } }).expect(422);
    const p = (await sa.post('/admin/agent-presets', { key, name: { fr: 'Vendeur test', ar: 'بائع', en: 'Test seller' }, tagline: { fr: 'Transforme les conversations' }, badge: 'recommended' }).expect(201)).body.data;
    expect(p).toMatchObject({ key, status: 'draft', currentVersion: 0, draftVersion: 1, versions: [{ version: 1, status: 'draft', missingLocales: ['fr', 'ar', 'en'] }] });
    expect((await sa.post('/admin/agent-presets', { key, name: { fr: 'dup' } }).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await sa.post(`/admin/agent-presets/${p.id}/versions/1/publish`, {}).expect(422)).body.error).toMatchObject({ code: 'PRESET_LOCALE_INCOMPLETE', params: { locales: 'fr' } });
    await sa.patch(`/admin/agent-presets/${p.id}/versions/1`, { locales: { fr: { systemPrompt: 'Tu es le vendeur de {{shop_name}}. Prix depuis {{catalog}}.' }, ar: { systemPrompt: 'أنت بائع {{shop_name}}' } }, config: { tone: 'friendly', temperature: 0.5 } }).expect(200);
    const tested = (await sa.post(`/admin/agent-presets/${p.id}/versions/1/test`, {}).expect(200)).body.data;
    expect(tested.testResults.checks.find((c: any) => c.key === 'locales')).toMatchObject({ ok: true, params: { missing: 'en' } });
    expect(tested.missingLocales).toEqual(['en']);
    await sa.patch(`/admin/agent-presets/${p.id}/versions/1`, { locales: { fr: { systemPrompt: 'Bonjour {{unknown_var}}' } } }).expect(200);
    expect((await sa.post(`/admin/agent-presets/${p.id}/versions/1/test`, {}).expect(200)).body.data.testResults.checks.find((c: any) => c.key === 'variables')).toMatchObject({ ok: false, params: { unknown: 'unknown_var' } });
    await sa.post(`/admin/agent-presets/${p.id}/versions/1/publish`, {}).expect(422);
    await sa.patch(`/admin/agent-presets/${p.id}/versions/1`, { locales: { fr: { systemPrompt: 'Tu es le vendeur de {{shop_name}}.' } } }).expect(200);
    const pub = (await sa.post(`/admin/agent-presets/${p.id}/versions/1/publish`, {}).expect(200)).body.data;
    expect(pub).toMatchObject({ status: 'published', currentVersion: 1, draftVersion: null });
    expect((await sa.patch(`/admin/agent-presets/${p.id}/versions/1`, { changelog: 'x' }).expect(409)).body.error.code).toBe('PRESET_PUBLISHED_IMMUTABLE');
    expect((await sa.delete(`/admin/agent-presets/${p.id}`).expect(409)).body.error.code).toBe('PRESET_PUBLISHED_IMMUTABLE');
    expect((await (await asPlatform(app, 'moderator')).post(`/admin/agent-presets/${p.id}/versions`, {}).expect(403)).body.error.code).toBe('FORBIDDEN');

    // merchant agent on v1
    const owner = await asOwner(app);
    const agent = (await owner.post('/agents', { presetKey: key }).expect(201)).body.data;
    expect(agent.preset).toMatchObject({ key, version: 1, updateAvailable: null });
    await db.agent.update({ where: { id: agent.id }, data: { status: 'active' } });
    const v2 = (await sa.post(`/admin/agent-presets/${p.id}/versions`, { changelog: '+ règle délais' }).expect(201)).body.data;
    expect(v2).toMatchObject({ version: 2, status: 'draft' });
    expect((await sa.post(`/admin/agent-presets/${p.id}/versions`, {}).expect(409)).body.error.code).toBe('CONFLICT');
    await sa.patch(`/admin/agent-presets/${p.id}/versions/2`, { locales: { fr: { systemPrompt: 'Tu es le vendeur de {{shop_name}}. Ne promets jamais de délai.' } } }).expect(200);
    await sa.post(`/admin/agent-presets/${p.id}/versions/2/publish`, {}).expect(200);
    const after = (await owner.get(`/agents/${agent.id}`).expect(200)).body.data;
    expect(after.preset).toMatchObject({ version: 1, updateAvailable: 2 });
    expect(await app.app.get(AgentService).announcePresetUpdates()).toBeGreaterThanOrEqual(1);
    await drainAll(app, ['notification']);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'agent_preset_update_available' } })).toBe(1);
    expect((await owner.post(`/agents/${agent.id}/apply-preset-update`, { presetVersion: 2 }).expect(200)).body.data.preset).toMatchObject({ version: 2 });
    const detail = (await sa.get(`/admin/agent-presets/${p.id}`).expect(200)).body.data;
    expect(detail.versions.map((v: any) => [v.version, v.status])).toEqual([[2, 'published'], [1, 'archived']]);
    expect(detail.agents).toBe(1);
    // archive ⇒ hidden from merchants, existing agents intact
    expect((await sa.post(`/admin/agent-presets/${p.id}/archive`, {}).expect(200)).body.data.status).toBe('archived');
    expect((await owner.get('/agents/presets').expect(200)).body.data.map((x: any) => x.key)).not.toContain(key);
    expect((await sa.post(`/admin/agent-presets/${p.id}/archive`, {}).expect(409)).body.error.code).toBe('PRESET_ARCHIVED');
    expect((await sa.patch(`/admin/agent-presets/${p.id}`, { sortOrder: 2 }).expect(409)).body.error.code).toBe('PRESET_ARCHIVED');
    await sa.post(`/admin/agent-presets/${p.id}/restore`, {}).expect(200);
    await sa.post(`/admin/agent-presets/${p.id}/explode`, {}).expect(404);
    expect(await lastAudit('preset.publish', p.id)).toBeTruthy();
    // a never-published preset can be deleted
    const tmp = (await sa.post('/admin/agent-presets', { key: `${key}-tmp`, name: { fr: 'Tmp' } }).expect(201)).body.data;
    await sa.delete(`/admin/agent-presets/${tmp.id}`).expect(204);
  });
});

describe('ADM-08 CMS — announcements reach the merchant app and the public site (tester report 2026-10-21 UX-005)', () => {
  it('banner for the targeted workspaces (dismissible, per user), public site for « web » + everyone, notification opens it; other targets stay out', async () => {
    const sa = await asPlatform(app);
    const owner = await asOwner(app);
    const make = async (target: Record<string, unknown>, channels: string[]) => {
      const key = `ux005-${randomUUID().slice(0, 8)}`;
      createdCms.push(key);
      const e = (await sa.post('/admin/cms', { key, type: 'announcement', target, channels, link: '/billing', locales: { fr: { title: `Annonce ${key}`, body: 'Nouvelle grille\nDétails…' } } }).expect(201)).body.data;
      await sa.post(`/admin/cms/${e.id}/publish`, { fallbackToFr: true }).expect(200);
      return e.id as string;
    };
    const forAll = await make({ scope: 'all' }, ['banner', 'web', 'in_app']);
    const elsewhere = await make({ workspaceIds: [randomUUID()] }, ['banner', 'in_app']);
    const notWeb = await make({ scope: 'all' }, ['in_app']);

    const mine = (await owner.get('/announcements').expect(200)).body.data.map((a: any) => a.id);
    expect(mine).toContain(forAll);
    expect(mine).not.toContain(elsewhere);
    expect(mine).not.toContain(notWeb); // no banner channel
    const one = (await owner.get(`/announcements/${forAll}?lang=en`).expect(200)).body.data;
    expect(one).toMatchObject({ title: expect.stringContaining('Annonce'), link: '/billing', state: 'live', locale: 'fr', fallback: true, dismissed: false });
    await owner.get(`/announcements/${elsewhere}`).expect(404);

    // the publication notification of the owner opens the announcement
    await drainAll(app, ['notification']);
    const n = (await owner.get('/notifications').expect(200)).body.data.find((x: any) => x.type === 'platform_announcement' && x.deepLink?.web?.includes(forAll));
    expect(n?.deepLink.web).toBe(`/notifications?announcement=${forAll}`);

    await owner.post(`/announcements/${forAll}/dismiss`).expect(204);
    await owner.post(`/announcements/${forAll}/dismiss`).expect(204);
    expect((await owner.get('/announcements').expect(200)).body.data.map((a: any) => a.id)).not.toContain(forAll);
    expect((await owner.get(`/announcements/${forAll}`).expect(200)).body.data.dismissed).toBe(true);

    const site = (await pub(app).get('/api/v1/cms/announcements?lang=fr').expect(200)).body.data.map((a: any) => a.id);
    expect(site).toContain(forAll);
    expect(site).not.toContain(elsewhere);

    // withdrawn ⇒ out of the banner and the site; the notification still opens it with the reason
    await sa.post(`/admin/cms/${forAll}/unpublish`, {}).expect(200);
    expect((await pub(app).get('/api/v1/cms/announcements').expect(200)).body.data.map((a: any) => a.id)).not.toContain(forAll);
    expect((await owner.get(`/announcements/${forAll}`).expect(200)).body.data.state).toBe('withdrawn');
  });
});

describe('ADM-08 CMS', () => {
  it('create (slug rules), locales, publish blocked CMS_LOCALE_MISSING unless fallback, versions, schedule ⇒ sched-cms-publish, unpublish, preview link, AI translation job; counts per type', async () => {
    const sa = await asPlatform(app);
    expect((await sa.post('/admin/cms', { key: 'Bad slug!', type: 'announcement' }).expect(422)).body.error.code).toBe('CMS_SLUG_INVALID');
    const key = `credits-2026-${randomUUID().slice(0, 4)}`;
    createdCms.push(key);
    const e = (await sa.post('/admin/cms', { key, type: 'announcement', target: { scope: 'all' }, channels: ['banner', 'email'], locales: { fr: { title: 'Nouvelle grille', body: 'À partir du 1er novembre…' } } }).expect(201)).body.data;
    expect(e.locales.map((l: any) => [l.locale, l.status])).toEqual([['fr', 'draft'], ['ar', 'missing'], ['en', 'missing']]);
    expect((await sa.post('/admin/cms', { key, type: 'help' }).expect(409)).body.error.code).toBe('CMS_SLUG_TAKEN');
    expect((await sa.post(`/admin/cms/${e.id}/publish`, {}).expect(422)).body.error).toMatchObject({ code: 'CMS_LOCALE_MISSING', params: { locales: 'ar, en' } });
    await sa.put(`/admin/cms/${e.id}/locales/ar`, { title: 'شبكة جديدة', body: 'ابتداءً من 1 نوفمبر' }).expect(200);
    await sa.put(`/admin/cms/${e.id}/locales/xx`, { title: 'x', body: 'y' }).expect(404);
    const owner = await asOwner(app);
    const pub = (await sa.post(`/admin/cms/${e.id}/publish`, { fallbackToFr: true }).expect(200)).body.data;
    expect(pub).toMatchObject({ status: 'published', currentVersion: 1 });
    expect(pub.locales.find((l: any) => l.locale === 'en')).toMatchObject({ status: 'missing', fallbackToFr: true });
    await drainAll(app, ['notification']);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'platform_announcement' } })).toBe(1);
    expect((await sa.get(`/admin/cms/${e.id}/versions`).expect(200)).body.data[0]).toMatchObject({ version: 1 });
    expect((await sa.post(`/admin/cms/${e.id}/unpublish`, {}).expect(200)).body.data.status).toBe('draft');
    await sa.post(`/admin/cms/${e.id}/schedule`, { startsAt: new Date(Date.now() - 1000).toISOString() }).expect(422);
    const sch = (await sa.post(`/admin/cms/${e.id}/schedule`, { startsAt: new Date(Date.now() + 3600_000).toISOString() }).expect(200)).body.data;
    expect(sch.status).toBe('scheduled');
    expect(await app.app.get(CmsAdminService).publishDue(new Date(Date.now() + 2 * 3600_000))).toBe(1);
    expect((await sa.get(`/admin/cms/${e.id}`).expect(200)).body.data).toMatchObject({ status: 'published', currentVersion: 2 });
    const link = (await sa.get(`/admin/cms/${e.id}/preview-link`).expect(200)).body.data;
    expect(link.url).toContain(`?preview=`);
    const job = (await sa.post(`/admin/cms/${e.id}/translate`, { to: ['en'] }).expect(202)).body.data;
    await drainAll(app, ['job']);
    expect((await sa.get(`/admin/jobs/${job.jobId}`).expect(200)).body.data).toMatchObject({ status: 'done', result: { locales: ['en'] } });
    const en = (await sa.get(`/admin/cms/${e.id}`).expect(200)).body.data.locales.find((l: any) => l.locale === 'en');
    expect(en).toMatchObject({ status: 'draft', title: expect.stringContaining('Nouvelle grille') });
    const list = (await sa.get('/admin/cms?type=announcement&missingLocale=en&pageSize=100').expect(200)).body;
    expect(list.meta.counts.announcement).toBeGreaterThanOrEqual(1);
    expect(list.data.map((x: any) => x.id)).not.toContain(e.id);
    expect((await (await asPlatform(app, 'moderator')).patch(`/admin/cms/${e.id}`, { sortOrder: 1 }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await sa.get(`/admin/cms/${randomUUID()}`).expect(404);
    expect(await lastAudit('cms.publish', e.id)).toBeTruthy();
  });
});

describe('ADM-09 audit · ADM-17 viewers · ADM-01 overview', () => {
  it('AT-AUD-01 viewer opens a conversation ⇒ viewer.open with reason, phone masked; unmask support 403, super admin ⇒ unmasked + viewer.unmask; audit export CSV signed (SHA-256 header matches) and itself logged', async () => {
    const owner = await asOwner(app);
    const ch = await db.channel.create({ data: { workspaceId: owner.workspaceId, platform: 'facebook', externalId: `v${Date.now()}`, name: 'Page', status: 'active', connectedById: owner.userId } });
    const client = await db.client.create({ data: { workspaceId: owner.workspaceId, name: 'Mehdi Hadj', phone: '0661987654' } });
    const conv = await db.conversation.create({ data: { workspaceId: owner.workspaceId, channelId: ch.id, externalSenderId: `s${Date.now()}`, clientId: client.id, status: 'active', lastMessageAt: new Date(), lastMessagePreview: 'mon numéro 0661987654' } });
    await db.message.create({ data: { workspaceId: owner.workspaceId, conversationId: conv.id, direction: 'in', type: 'text', author: 'customer', text: 'Appelez-moi au 0661987654', sentAt: new Date() } });
    const support = await asPlatform(app, 'support');
    const rows = (await support.get(`/admin/conversations?workspaceId=${owner.workspaceId}`).expect(200)).body.data;
    expect(rows[0]).toMatchObject({ id: conv.id, customer: { name: 'Mehdi H.', phone: '06•• •• •• 54' } });
    expect(rows[0].lastMessagePreview).not.toContain('0661987654');
    await support.get(`/admin/conversations/${conv.id}`).expect(422);
    expect((await support.get(`/admin/conversations/${conv.id}?reason=court`).expect(422)).body.error.code).toBe('ADMIN_REASON_REQUIRED');
    const reason = 'Signalement #88 : vérifier la réponse IA';
    const opened = (await support.get(`/admin/conversations/${conv.id}?reason=${encodeURIComponent(reason)}`).expect(200)).body.data;
    expect(opened.masked).toBe(true);
    expect(opened.messages[0].text).not.toContain('0661987654');
    expect((await lastAudit('viewer.open', conv.id))).toMatchObject({ reason, actorId: support.userId, workspaceId: owner.workspaceId });
    expect((await support.post(`/admin/conversations/${conv.id}/unmask`, { reason }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const sa = await asPlatform(app);
    const un = (await sa.post(`/admin/conversations/${conv.id}/unmask`, { reason }).expect(200)).body.data;
    expect(un).toMatchObject({ masked: false, customer: { name: 'Mehdi Hadj', phone: '0661987654' } });
    expect(un.messages[0].text).toContain('0661987654');
    expect(await lastAudit('viewer.unmask', conv.id)).toMatchObject({ reason, actorId: sa.userId });
    await sa.get(`/admin/conversations/${randomUUID()}?reason=${encodeURIComponent(reason)}`).expect(404);
    // products viewer
    const prod = await db.product.create({ data: { workspaceId: owner.workspaceId, sku: `V-${randomUUID().slice(0, 6)}`, name: 'Parfum Oud', price: 4500, moderationStatus: 'approved' } });
    expect((await support.get(`/admin/products?workspaceId=${owner.workspaceId}`).expect(200)).body.data[0]).toMatchObject({ id: prod.id, moderationStatus: 'approved', aiStatus: 'proposed' });
    expect((await support.get(`/admin/products/${prod.id}`).expect(200)).body.data).toMatchObject({ id: prod.id, variants: [], images: [] });
    expect(await lastAudit('viewer.open', prod.id)).toBeTruthy();

    // audit list filters + detail
    const audit = (await sa.get(`/admin/audit-logs?workspaceId=${owner.workspaceId}&action=viewer.open`).expect(200)).body.data;
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit[0]).toMatchObject({ action: 'viewer.open', target: { workspace: { id: owner.workspaceId } }, actor: { type: 'admin' } });
    expect((await sa.get(`/admin/audit-logs/${audit[0].id}`).expect(200)).body.data.id).toBe(audit[0].id);
    await sa.get(`/admin/audit-logs?impersonation=nope`).expect(422);
    expect((await sa.get('/admin/audit-logs?impersonation=only&pageSize=100').expect(200)).body.data.every((r: any) => r.context.impersonationSessionId)).toBe(true);
    // export (super_admin + finance); support 403
    expect((await support.post('/admin/audit-logs/export', { format: 'csv_signed', from: '2026-01-01', to: '2030-12-31' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const fin = await asPlatform(app, 'finance');
    const job = (await fin.post('/admin/audit-logs/export', { format: 'csv_signed', from: '2026-01-01', to: '2030-12-31', workspaceId: owner.workspaceId }).expect(202)).body.data;
    expect(await lastAudit('audit.export', job.jobId)).toMatchObject({ actorId: fin.userId });
    await drainAll(app, ['job']);
    const done = (await fin.get(`/admin/jobs/${job.jobId}`).expect(200)).body.data;
    expect(done).toMatchObject({ status: 'done', result: { format: 'csv_signed', rows: expect.any(Number) } });
    const up = await db.job.findUniqueOrThrow({ where: { id: job.jobId }, include: { resultUpload: true } });
    const file = await app.app.get(StorageService).get(up.resultUpload!.storageKey);
    const text = file.body.toString('utf8');
    const [first, ...rest] = text.split('\n');
    const hash = createHash('sha256').update(rest.join('\n')).digest('hex');
    expect(first).toBe(`# sha256=${hash}`);
    expect(done.result.sha256).toBe(hash);
    expect(rest.join('\n')).toContain('viewer.open');
  });

  it('ADM-01 overview KPIs + series + platform totals rollup (sched-daily-stats step) + alerts (forced failover ⇒ ai_error_rate)', async () => {
    const sa = await asPlatform(app, 'read');
    const n = await app.app.get(AdminOverviewService).rollupPlatform();
    expect(n).toBe(8);
    expect(await db.platformDailyStat.count()).toBeGreaterThanOrEqual(8);
    const o = (await sa.get('/admin/analytics?period=7d').expect(200)).body.data;
    expect(o.series).toHaveLength(7);
    expect(o.kpis.workspaces.active).toBeGreaterThan(0);
    expect(o.kpis.mrr).toMatchObject({ amount: expect.any(Number), byPlan: expect.any(Array) });
    expect(o.series[6].signups).toBeGreaterThan(0); // today, live (test users)
    await sa.get('/admin/analytics?period=1y').expect(422);
    const route = await db.aiRoute.findUniqueOrThrow({ where: { capability: 'text' } });
    if (route.fallbackModelId) {
      await db.aiRoute.update({ where: { id: route.id }, data: { failoverActive: true, failoverSince: new Date() } });
      const alerts = (await sa.get('/admin/alerts').expect(200)).body.data;
      expect(alerts[0]).toMatchObject({ code: 'ai_error_rate', severity: 'critical', link: '/admin/ai' });
      await db.aiRoute.update({ where: { id: route.id }, data: { failoverActive: false, failoverSince: null } });
    }
    // overview alert links open screens that read them: moderation "urgent" tab (MOD_SPEC tabs), not `?priority=`
    const ws = await db.workspace.findFirstOrThrow({ select: { id: true } });
    const late = await db.moderationItem.create({ data: { workspaceId: ws.id, type: 'agent_prompt', snapshot: {}, slaDueAt: new Date(Date.now() - 3_600_000) } });
    const withSla = (await sa.get('/admin/alerts').expect(200)).body.data;
    expect(withSla).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'moderation_sla', link: '/admin/moderation?tab=urgent' })]));
    await db.moderationItem.delete({ where: { id: late.id } });
  });
});
