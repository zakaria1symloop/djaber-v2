// M4 — agents (03 §6 AGT-01…09): presets, wizard on a draft, versions, activation and the plan limit, pause / resume,
// duplicate, delete, channel ↔ agent, FAQ, insights queue, metrics, role matrix, tenancy. AT ids from 13-acceptance-tests.md.
import { asAdmin, asOperator, asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { RedisService } from '../../src/core/redis/redis.provider';
import { createProduct } from '../support/m2';
import { connect, connectedPage, forbidNetwork, newSender, receive } from '../support/m3';
import { answer, closeOutbox, db, fakeAi, linkedAgent, textRoute, withLimits } from '../support/m4';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
const draft = async (actor: Actor, body: Record<string, unknown> = { presetKey: 'vendeur-pro' }) => (await actor.post('/agents', body).expect(201)).body.data;
const get = async (actor: Actor, id: string) => (await actor.get(`/agents/${id}`).expect(200)).body.data;
const patch = async (actor: Actor, id: string, body: Record<string, unknown>) => (await actor.patch(`/agents/${id}`, { version: (await get(actor, id)).version, ...body }).expect(200)).body.data;
const pages = async (actor: Actor) => {
  const report = await connect(actor, app);
  return db.channel.findMany({ where: { id: { in: report.pages.filter((p) => p.platform === 'facebook' && p.channelId).map((p) => p.channelId!) } }, orderBy: { createdAt: 'asc' } });
};
/** The `pro` plan with another agent limit, for the actor's workspace. */
const withMaxAgents = async (actor: Actor, maxAgents: number) => {
  await withLimits(app, actor.workspaceId, { maxAgents });
};

beforeAll(async () => {
  app = await createTestApp();
  net = forbidNetwork();
  // a circuit breaker left open by another suite (provider-failure scenarios) would route this suite to the fallback model
  const redis = app.app.get(RedisService).client;
  const keys = await redis.keys('ai:cb:*');
  if (keys.length) await redis.del(...keys);
});
afterAll(async () => {
  expect(net.spy).not.toHaveBeenCalled();
  net.restore();
  await closeOutbox();
  await app.close();
});
beforeEach(() => fakeAi(app).reset());

describe('presets and wizard', () => {
  it('AT-AGT-02 the 4 presets carry the table of AGT-02; a draft created from each one matches it; the model is assigned by the platform', async () => {
    const owner = await asOwner(app);
    const presets = (await owner.get('/agents/presets').expect(200)).body.data;
    const table = Object.fromEntries(presets.map((p: any) => [p.key, [p.personality, p.temperature, p.maxTokens, p.imageRecognition, p.voiceTranscription, p.responseDelaySec]]));
    expect(table).toEqual({
      'vendeur-pro': ['friendly', 0.6, 1200, true, true, 3],
      'service-client': ['professional', 0.4, 1000, true, true, 2],
      'conseiller-produit': ['technical', 0.5, 1400, true, true, 3],
      'reponse-express': ['casual', 0.6, 700, false, true, 1],
    });
    expect(presets.every((p: any) => p.instructions.length > 100 && p.version >= 1 && p.name)).toBe(true);
    const route = await textRoute();
    for (const p of presets) {
      const a = await draft(owner, { presetKey: p.key });
      expect(a).toMatchObject({ status: 'draft', isActive: false, wizardStep: 1, personality: p.personality, temperature: p.temperature, maxTokens: p.maxTokens, imageRecognition: p.imageRecognition, voiceTranscription: p.voiceTranscription, responseDelaySec: p.responseDelaySec, customInstructions: p.instructions, name: p.name, currentVersion: 1 });
      expect(a.preset).toMatchObject({ key: p.key, version: p.version, updateAvailable: null });
      expect(a.model).toEqual({ id: route.primaryModelId, label: route.primaryModel.displayName, provider: 'OpenAI' });
      expect(a.wizard.capabilities).toMatchObject({ imageRecognition: p.imageRecognition, voiceTranscription: p.voiceTranscription, takeOrders: true });
    }
    // Arabic for an Arabic-speaking member; from scratch; an unknown preset
    expect((await owner.get('/agents/presets').set('Accept-Language', 'ar').expect(200)).body.data[0].name).toBe('البائع المحترف');
    const scratch = await draft(owner, { fromScratch: true, name: 'Mon agent' });
    expect(scratch).toMatchObject({ name: 'Mon agent', preset: null, personality: 'friendly', customInstructions: '', temperature: 0.6, maxTokens: 1200 });
    expect(scratch.wizard.orderFields.filter((f: any) => f.locked).map((f: any) => f.key)).toEqual(['product', 'quantity', 'name', 'phone', 'wilaya']);
    await owner.post('/agents', { presetKey: 'nope' }).expect(404);
    await owner.post('/agents', {}).expect(422);
    await owner.post('/agents', { presetKey: 'vendeur-pro', fromScratch: true }).expect(422);
    // the read-only model badge
    expect((await owner.get('/ai/routes').expect(200)).body.data.find((r: any) => r.capability === 'text')).toMatchObject({ model: { label: route.primaryModel.displayName }, failover: false });
  });

  it('wizard steps are partial saves of the draft: validation (name ≤ 100, instructions ≤ 10 000), compiled style block, a version per save, 409 CONFLICT with the current resource', async () => {
    const owner = await asOwner(app);
    const a = await draft(owner);
    await owner.patch(`/agents/${a.id}`, { version: a.version, name: 'x'.repeat(101) }).expect(422);
    await owner.patch(`/agents/${a.id}`, { version: a.version, customInstructions: 'y'.repeat(10_001) }).expect(422);
    await owner.patch(`/agents/${a.id}`, { name: 'sans version' }).expect(422);
    await owner.patch(`/agents/${a.id}`, { version: a.version, modelId: a.model.id }).expect(422); // the merchant never chooses a model
    await owner.patch(`/agents/${a.id}`, { version: a.version, wizard: { defaultLanguage: 'en', languages: ['fr'] } }).expect(422);

    const s1 = await patch(owner, a.id, { step: 1, name: 'Vendeuse Lina', wizard: { displayName: 'Lina', languages: ['darija', 'fr'], defaultLanguage: 'fr', tone: 'warm', formality: 'vous', emojiLevel: 'moderate' } });
    expect(s1).toMatchObject({ name: 'Vendeuse Lina', wizardStep: 1, currentVersion: 2, version: a.version + 1 });
    expect(s1.wizard).toMatchObject({ displayName: 'Lina', languages: ['darija', 'fr'], tone: 'warm', formality: 'vous' });
    // the API shows the merchant's own text; the stored column also carries the generated style block the prompt uses
    expect(s1.customInstructions).toBe(a.customInstructions);
    const stored = (await db.agent.findUniqueOrThrow({ where: { id: a.id } })).customInstructions;
    expect(stored).toContain('[STYLE — generated from the agent settings, do not edit]');
    expect(stored).toContain('- Tone: warm and welcoming.');
    expect(stored).toContain('- Form of address: formal "vous".');
    expect(stored.endsWith(a.customInstructions)).toBe(true);

    const category = (await owner.post('/categories', { name: 'Robes' }).expect(201)).body.data;
    const s2 = await patch(owner, a.id, { step: 2, wizard: { catalogScope: 'categories', scopeCategoryIds: [category.id], outOfStockBehavior: 'say_unavailable', policies: { delivery: 'Livraison 58 wilayas en 2 à 5 jours', payment: 'Paiement à la livraison' } } });
    expect(s2.wizard).toMatchObject({ catalogScope: 'categories', scopeCategoryIds: [category.id], policies: { delivery: 'Livraison 58 wilayas en 2 à 5 jours' } });
    await owner.patch(`/agents/${a.id}`, { version: s2.version, wizard: { scopeCategoryIds: ['00000000-0000-7000-8000-000000000000'] } }).expect(422);
    const s3 = await patch(owner, a.id, {
      step: 3,
      productCardTemplate: '{name} — {price} DA',
      closingInstructions: 'Remercier le client.',
      humanHandoffRules: 'Transférer si le client demande une facture.',
      wizard: { capabilities: { replyText: true, imageRecognition: false, voiceTranscription: true, takeOrders: true, quoteDelivery: true, crossSell: false }, orderFields: [{ key: 'commune', required: false }, { key: 'phone', required: false }], maxQtyPerOrder: 5, maxAmountPerOrder: 30000, riskyClientBehavior: 'handoff', recapMode: 'when_unsure', handoffRules: [{ kind: 'anger', enabled: false }], handoffKeywords: ['facture'], businessHours: { from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] } },
    });
    expect(s3).toMatchObject({ imageRecognition: false, wizardStep: 3 });
    expect(s3.wizard.orderFields.find((f: any) => f.key === 'phone')).toEqual({ key: 'phone', required: true, locked: true }); // locked fields stay required
    expect(s3.wizard.orderFields.find((f: any) => f.key === 'commune')).toMatchObject({ required: false });
    expect(s3.wizard.handoffRules.find((r: any) => r.kind === 'anger').enabled).toBe(false);
    expect(s3.wizard.handoffRules).toHaveLength(9);
    // the two toggles and the capability switches always agree (AGT-06)
    const toggled = await patch(owner, a.id, { imageRecognition: true });
    expect(toggled.wizard.capabilities.imageRecognition).toBe(true);

    // optimistic lock
    const stale = await owner.patch(`/agents/${a.id}`, { version: a.version, name: 'trop tard' }).expect(409);
    expect(stale.body.error).toMatchObject({ code: 'CONFLICT', details: { changedBy: { id: owner.userId }, current: { id: a.id, name: 'Vendeuse Lina', version: toggled.version } } });
    expect(stale.body.error.details.changedAt).toEqual(expect.any(String));

    // one AgentVersion per save, newest first
    const versions = (await owner.get(`/agents/${a.id}/versions`).expect(200)).body.data;
    expect(versions.map((v: any) => v.version)).toEqual([5, 4, 3, 2, 1]);
    expect(versions[0]).toMatchObject({ isCurrent: true, source: 'wizard', createdBy: { id: owner.userId } });
    const ws = (await db.outbox.findMany({ where: { topic: 'ws' } })).map((r) => r.payload as any).filter((p) => p.room === `ws:${owner.workspaceId}`);
    expect(ws.filter((p) => p.event === 'agent.version_created').map((p) => p.payload.version).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(ws.filter((p) => p.event === 'agent.updated').at(-1)!.payload.agent).toMatchObject({ id: a.id, status: 'draft', pendingInsights: 0 });
  });

  it('AGT-03 versions: detail, diff and restore (the restored configuration is a new version)', async () => {
    const owner = await asOwner(app);
    const a = await draft(owner);
    const product = await createProduct(owner);
    await patch(owner, a.id, { name: 'V2', customInstructions: 'Toujours proposer la livraison.', sellAllProducts: false, productIds: [product.id], note: 'instructions' });
    await patch(owner, a.id, { name: 'V3', customInstructions: 'Autre texte', sellAllProducts: true, productIds: [] });
    const v2 = (await owner.get(`/agents/${a.id}/versions/2`).expect(200)).body.data;
    expect(v2).toMatchObject({ version: 2, note: 'instructions', isCurrent: false, snapshot: { name: 'V2', customInstructions: 'Toujours proposer la livraison.', productIds: [product.id] } });
    const diff = (await owner.get(`/agents/${a.id}/versions/2/diff`).expect(200)).body.data;
    expect(diff).toMatchObject({ version: 2, against: 3 });
    expect(diff.changes.map((c: any) => c.field)).toEqual(['customInstructions', 'name', 'productIds', 'sellAllProducts']);
    expect((await owner.get(`/agents/${a.id}/versions/2/diff?against=1`).expect(200)).body.data.changes.find((c: any) => c.field === 'name')).toEqual({ field: 'name', before: 'Vendeur Pro', after: 'V2' });
    const restored = (await owner.post(`/agents/${a.id}/versions/2/restore`).expect(200)).body.data;
    expect(restored).toMatchObject({ name: 'V2', customInstructions: 'Toujours proposer la livraison.', sellAllProducts: false, productIds: [product.id], currentVersion: 4 });
    expect((await owner.get(`/agents/${a.id}/versions`).expect(200)).body.data[0]).toMatchObject({ version: 4, source: 'restore', restoredFromVersion: 2, isCurrent: true });
    expect((await owner.get(`/agents/${a.id}/versions/99`).expect(404)).body.error.code).toBe('AGENT_VERSION_NOT_FOUND');
    expect((await owner.post(`/agents/${a.id}/versions/99/restore`).expect(404)).body.error.code).toBe('AGENT_VERSION_NOT_FOUND');
  });
});

describe('activation, plan limit, pause, delete', () => {
  it('AT-AGT-01 / AT-AGT-draft-limit: drafts never count; activation at the limit ⇒ 403 PLAN_LIMIT { resource: agents }; paused agents still count; deleting one frees a slot', async () => {
    const owner = await asOwner(app);
    await withMaxAgents(owner, 2);
    const [p1, p2] = await pages(owner);
    const a1 = await draft(owner);
    const a2 = await draft(owner);
    // no channel ⇒ AGENT_NO_CHANNEL (and the row action says why)
    expect((await owner.post(`/agents/${a1.id}/activate`, {}).expect(422)).body.error.code).toBe('AGENT_NO_CHANNEL');
    expect(a1.actions.find((x: any) => x.key === 'activate')).toEqual({ key: 'activate', enabled: false, reasonCode: 'AGENT_NO_CHANNEL', primary: true });
    await patch(owner, a1.id, { step: 4, channelIds: [p1!.id] });
    await patch(owner, a2.id, { step: 4, channelIds: [p2!.id] });
    expect((await owner.post(`/agents/${a1.id}/activate`, {}).expect(200)).body.data).toMatchObject({ status: 'active', isActive: true, wizardStep: null });
    await owner.post(`/agents/${a2.id}/activate`, {}).expect(200);
    // 3rd, 4th, 5th drafts are all accepted
    const drafts = [await draft(owner), await draft(owner), await draft(owner)];
    const list = (await owner.get('/agents').expect(200)).body.data;
    expect(list.map((x: any) => x.status).sort()).toEqual(['active', 'active', 'draft', 'draft', 'draft']);
    expect((await owner.get('/workspace').expect(200)).body.data.plan.usage.agents).toBe(2);
    // a third activation needs a page first, then hits the plan
    const [p3] = await pages(await asOwner(app)); // another workspace's page cannot be linked
    await owner.patch(`/agents/${drafts[0].id}`, { version: drafts[0].version, channelIds: [p3!.id] }).expect(422);
    await patch(owner, drafts[0].id, { channelIds: [p2!.id], move: true });
    const limit = await owner.post(`/agents/${drafts[0].id}/activate`, {}).expect(403);
    expect(limit.body.error).toMatchObject({ code: 'PLAN_LIMIT', params: { resource: 'agents', limit: 2, current: 2 } });
    // pausing one active agent does not free a slot (count = active + paused)
    expect((await owner.post(`/agents/${a1.id}/pause`, {}).expect(200)).body.data).toMatchObject({ status: 'paused', pausedReason: 'manual', isActive: false });
    await owner.post(`/agents/${drafts[0].id}/activate`, {}).expect(403);
    expect((await owner.get('/agents?status=paused').expect(200)).body.data.map((x: any) => x.id)).toEqual([a1.id]);
    // paused by the plan is shown as such
    await db.agent.update({ where: { id: a1.id }, data: { pausedReason: 'plan' } });
    expect((await get(owner, a1.id)).pausedReason).toBe('plan');
    // deleting an active / paused agent frees its slot
    await owner.delete(`/agents/${a1.id}`).expect(204);
    expect((await owner.post(`/agents/${drafts[0].id}/activate`, {}).expect(200)).body.data.status).toBe('active');
    // an unverified e-mail cannot activate
    const unverified = await asOwner(app);
    await db.user.update({ where: { id: unverified.userId }, data: { emailVerifiedAt: null } });
    const u = await draft(unverified);
    expect((await unverified.post(`/agents/${u.id}/activate`, {}).expect(403)).body.error.code).toBe('AUTH_EMAIL_UNVERIFIED');
  });

  it('scheduled activation, pause with open threads (409 until confirmed), resume, duplicate, bulk actions', async () => {
    const owner = await asOwner(app);
    const [p1, p2] = await pages(owner);
    const a = await draft(owner);
    await patch(owner, a.id, { channelIds: [p1!.id] });
    const at = new Date(Date.now() + 3600_000).toISOString();
    expect((await owner.post(`/agents/${a.id}/activate`, { at }).expect(200)).body.data).toMatchObject({ status: 'draft', scheduledActivateAt: at });
    // "Annuler la programmation": the draft stays a draft without a date (idempotent), then it is scheduled again
    const v0 = (await get(owner, a.id)).version;
    expect((await owner.delete(`/agents/${a.id}/activate`).expect(200)).body.data).toMatchObject({ status: 'draft', scheduledActivateAt: null, version: v0 + 1 });
    expect((await owner.delete(`/agents/${a.id}/activate`).expect(200)).body.data).toMatchObject({ status: 'draft', scheduledActivateAt: null, version: v0 + 1 });
    const { AgentService } = await import('../../src/modules/agents/agent.service');
    expect(await app.app.get(AgentService).activateScheduled(new Date(Date.now() + 2 * 3600_000))).toBe(0);
    expect((await owner.post(`/agents/${a.id}/activate`, { at }).expect(200)).body.data).toMatchObject({ status: 'draft', scheduledActivateAt: at });
    expect(await app.app.get(AgentService).activateScheduled(new Date(Date.now() + 2 * 3600_000))).toBe(1);
    expect(await get(owner, a.id)).toMatchObject({ status: 'active', scheduledActivateAt: null });
    // an active agent has nothing to unschedule
    expect((await owner.delete(`/agents/${a.id}/activate`).expect(409)).body.error.code).toBe('CONFLICT');

    // a customer is being answered on its page: pausing needs a confirmation
    await receive(app, p1!, newSender(), { text: 'Bonjour' });
    const refused = await owner.post(`/agents/${a.id}/pause`, {}).expect(409);
    expect(refused.body.error).toMatchObject({ code: 'AGENT_PAUSED_WITH_OPEN_THREADS', params: { count: 1 } });
    expect((await owner.post(`/agents/${a.id}/pause`, { confirm: true }).expect(200)).body.data.status).toBe('paused');
    // a paused agent does not answer
    const silent = await receive(app, p1!, newSender(), { text: 'Bonjour' });
    expect(await answer(app, owner.workspaceId, silent.conversation.id)).toBeNull();
    expect((await owner.post(`/agents/${a.id}/resume`).expect(200)).body.data).toMatchObject({ status: 'active', pausedReason: null });

    await owner.post(`/agents/${a.id}/faq`, { question: 'Livrez-vous à Oran ?', answer: 'Oui, en 3 jours.' }).expect(201);
    const copy = (await owner.post(`/agents/${a.id}/duplicate`).expect(201)).body.data;
    expect(copy).toMatchObject({ status: 'draft', name: `${a.name} (copie)`, channels: [], customInstructions: a.customInstructions });
    expect(copy.wizard.faqCount).toBe(1);
    expect(copy.id).not.toBe(a.id);

    const b = await draft(owner);
    await patch(owner, b.id, { channelIds: [p2!.id] });
    const bulk = (await owner.post('/agents/bulk/delete', { ids: [copy.id, b.id, '00000000-0000-7000-8000-000000000000'] }).expect(200)).body;
    expect(bulk.meta).toMatchObject({ ok: 1, failed: 2 });
    expect(bulk.data.results.map((r: any) => [r.ok, r.error?.code ?? null])).toEqual([[true, null], [false, 'AGENT_HAS_CHANNELS'], [false, 'NOT_FOUND']]);
    expect((await owner.post('/agents/bulk/pause', { ids: [a.id], confirm: true }).expect(200)).body.meta).toMatchObject({ ok: 1, failed: 0 });
    expect((await owner.post('/agents/bulk/resume', { ids: [a.id, b.id] }).expect(200)).body.data.results.map((r: any) => r.ok)).toEqual([true, false]);
  });

  it('AT-AGT-04 linking a page that belongs to agent B asks to move it: without `move` ⇒ 409 with B\'s name and nothing changes; with it ⇒ B loses the page', async () => {
    const owner = await asOwner(app);
    const [page] = await pages(owner);
    const b = await linkedAgent(owner.workspaceId, [page!.id], { name: 'Agent B' } as never);
    const a = await draft(owner);
    const refused = await owner.patch(`/agents/${a.id}`, { version: a.version, channelIds: [page!.id] }).expect(409);
    expect(refused.body.error).toMatchObject({ code: 'AGENT_PAGE_ALREADY_ASSIGNED', params: { agentName: 'Agent B' } });
    expect((await get(owner, b.id)).channels.map((c: any) => c.id)).toEqual([page!.id]);
    expect((await get(owner, a.id)).channels).toEqual([]);
    const moved = await patch(owner, a.id, { channelIds: [page!.id], move: true });
    expect(moved.channels.map((c: any) => c.id)).toEqual([page!.id]);
    expect((await get(owner, b.id)).channels).toEqual([]);
    // same rule from the page side: PUT /channels/:id/agent
    const back = await owner.put(`/channels/${page!.id}/agent`, { agentId: b.id }).expect(409);
    expect(back.body.error).toMatchObject({ code: 'AGENT_PAGE_ALREADY_ASSIGNED', params: { agentName: moved.name } });
    expect((await owner.put(`/channels/${page!.id}/agent`, { agentId: b.id, move: true }).expect(200)).body.data.agent).toMatchObject({ id: b.id, name: 'Agent B' });
    expect((await owner.put(`/channels/${page!.id}/agent`, { agentId: null }).expect(200)).body.data.agent).toBeNull();
    expect((await owner.get(`/channels/${page!.id}/events`).expect(200)).body.data.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['agent_attached', 'agent_detached']));
    await owner.put(`/channels/${page!.id}/agent`, { agentId: '00000000-0000-7000-8000-000000000000' }).expect(404);
    // icebreaker
    expect((await owner.put(`/channels/${page!.id}/icebreaker`, { text: 'Bonjour, que cherchez-vous ?' }).expect(200)).body.data.icebreaker).toBe('Bonjour, que cherchez-vous ?');
    expect((await owner.put(`/channels/${page!.id}/icebreaker`, { text: '' }).expect(200)).body.data.icebreaker).toBeNull();
    await owner.put(`/channels/${page!.id}/icebreaker`, { text: 'x'.repeat(301) }).expect(422);
  });

  it('AT-AGT-05 deleting an agent keeps its open needs-human conversations, dismisses its pending insights and unlinks its pages', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const agent = await linkedAgent(owner.workspaceId, [page.id]);
    const sender = newSender();
    const { conversation } = await receive(app, page, sender, { text: 'Je veux un remboursement' });
    await answer(app, owner.workspaceId, conversation.id);
    expect(await db.agentInsight.count({ where: { agentId: agent.id, status: 'pending' } })).toBe(1);
    await owner.delete(`/agents/${agent.id}`).expect(204);
    expect(await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).toMatchObject({ status: 'needs_human', deletedAt: null });
    expect(await db.agentInsight.findMany({ where: { agentId: agent.id } })).toMatchObject([{ status: 'dismissed' }]);
    expect(await db.agentChannel.count({ where: { agentId: agent.id } })).toBe(0);
    expect((await owner.get(`/channels/${page.id}`).expect(200)).body.data.agent).toBeNull();
    await owner.get(`/agents/${agent.id}`).expect(404);
    expect((await owner.get('/agents').expect(200)).body.data).toEqual([]);
    expect((await owner.get('/agent-insights').expect(200)).body.data).toEqual([]);
    // the page no longer has an agent: a new customer message schedules nothing
    const next = await receive(app, page, newSender(), { text: 'Bonjour' });
    expect(await answer(app, owner.workspaceId, next.conversation.id)).toBeNull();
  });
});

describe('knowledge: FAQ and insights', () => {
  it('FAQ: CRUD, 50 entries / 20 000 characters ⇒ AGENT_FAQ_LIMIT, text import, the entries reach the prompt', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const agent = await linkedAgent(owner.workspaceId, [page.id]);
    const f = (await owner.post(`/agents/${agent.id}/faq`, { question: 'Vous livrez à Tamanrasset ?', answer: 'Oui, sous 7 jours.' }).expect(201)).body.data;
    expect(f).toMatchObject({ source: 'manual', isActive: true, sortOrder: 0 });
    expect((await owner.patch(`/agents/${agent.id}/faq/${f.id}`, { answer: 'Oui, sous 5 jours.' }).expect(200)).body.data.answer).toBe('Oui, sous 5 jours.');
    await owner.post(`/agents/${agent.id}/faq`, { question: '', answer: 'x' }).expect(422);
    const { conversation } = await receive(app, page, newSender(), { text: 'Bonjour' });
    await answer(app, owner.workspaceId, conversation.id);
    expect(fakeAi(app).callsOf('reply')[0]!.system).toContain('FAQ\nQ: Vous livrez à Tamanrasset ?\nA: Oui, sous 5 jours.');
    // import of a text file
    const file = Buffer.from('Q: Quels sont vos horaires ?\nR: De 9h à 18h, du samedi au jeudi.\n\nPeut-on payer par CCP ?\nOui, avant expédition.\n\nQ: Vous livrez à Tamanrasset ?\nA: doublon ignoré', 'utf8');
    const { upload } = await import('../support/m2');
    const imported = (await upload(owner, app, `/agents/${agent.id}/faq/import`, 'file', [{ buffer: file, name: 'faq.txt', type: 'text/plain' }]).expect(201)).body.data;
    expect(imported.created.map((x: any) => [x.question, x.source])).toEqual([['Quels sont vos horaires ?', 'file_import'], ['Peut-on payer par CCP ?', 'file_import']]);
    expect(imported.skipped).toBe(1);
    expect((await upload(owner, app, `/agents/${agent.id}/faq/import`, 'file', [{ buffer: Buffer.from('%PDF-1.4'), name: 'faq.pdf', type: 'application/pdf' }]).expect(415)).body.error.code).toBe('UPLOAD_TYPE_INVALID');
    // limits
    await db.agentFaq.createMany({ data: Array.from({ length: 47 }, (_, i) => ({ workspaceId: owner.workspaceId, agentId: agent.id, question: `Q${i} ?`, answer: 'R', sortOrder: 10 + i })) });
    expect((await owner.post(`/agents/${agent.id}/faq`, { question: 'la 51e ?', answer: 'non' }).expect(422)).body.error.code).toBe('AGENT_FAQ_LIMIT');
    await db.agentFaq.deleteMany({ where: { agentId: agent.id, question: { startsWith: 'Q' } } });
    for (let i = 0; i < 9; i++) await owner.post(`/agents/${agent.id}/faq`, { question: `Longue ${i} ?`, answer: 'a'.repeat(2000) }).expect(201);
    expect((await owner.post(`/agents/${agent.id}/faq`, { question: 'trop ?', answer: 'a'.repeat(2000) }).expect(422)).body.error.code).toBe('AGENT_FAQ_LIMIT');
    await owner.delete(`/agents/${agent.id}/faq/${f.id}`).expect(204);
    await owner.delete(`/agents/${agent.id}/faq/${f.id}`).expect(404);
    expect((await owner.get(`/agents/${agent.id}/faq`).expect(200)).body.data).toHaveLength(10); // 1 imported ("Peut-on…") + 9 long ones
  });

  it('AT-AGT-07 insights queue: filters, "add to instructions" appends `- …` (new version), create FAQ, ignore 30 days mutes the topic, already resolved, bulk dismiss', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const page = await connectedPage(owner, app);
    const agent = await linkedAgent(owner.workspaceId, [page.id], { customInstructions: 'Toujours saluer.' } as never);
    const ask = async (text: string) => {
      const { conversation } = await receive(app, page, newSender(), { text });
      await answer(app, owner.workspaceId, conversation.id);
      return conversation.id;
    };
    const c1 = await ask('Est-ce que vous vendez des voitures neuves ?');
    await ask('Est-ce que vous vendez des voitures neuves ?');
    await ask('Je veux un remboursement');
    await ask('??');
    const all = (await owner.get(`/agent-insights?agentId=${agent.id}`).expect(200)).body;
    expect(all.meta.total).toBe(4);
    expect(all.data.map((i: any) => i.type).sort()).toEqual(['handoff', 'unclear', 'unknown_topic', 'unknown_topic']);
    expect(all.data[0]).toMatchObject({ agent: { id: agent.id }, channel: { id: page.id }, status: 'pending' });
    expect((await owner.get('/agents?hasPendingInsights=true').expect(200)).body.data.map((a: any) => [a.id, a.pendingInsights])).toEqual([[agent.id, 4]]);
    expect((await owner.get(`/agent-insights?type=handoff,unclear&status=pending`).expect(200)).body.data).toHaveLength(2);
    expect((await owner.get(`/agent-insights?conversationId=${c1}`).expect(200)).body.data).toHaveLength(1);
    expect((await owner.get(`/agent-insights?channelId=${page.id}&status=resolved`).expect(200)).body.data).toHaveLength(0);
    const grouped = (await owner.get('/agent-insights?groupByTopic=true&type=unknown_topic').expect(200)).body;
    expect(grouped.data).toHaveLength(1);
    expect(grouped.data[0]).toMatchObject({ occurrences: 2, customerMessage: 'Est-ce que vous vendez des voitures neuves ?' });

    // "Ajouter aux instructions" — an operator may do it (insights.manage)
    const unknown = grouped.data[0];
    await operator.post(`/agent-insights/${unknown.id}/resolve`, { action: 'instruction' }).expect(422);
    const resolved = (await operator.post(`/agent-insights/${unknown.id}/resolve`, { action: 'instruction', instruction: 'Nous ne vendons pas de voitures.' }).expect(200)).body.data;
    expect(resolved).toEqual({ id: unknown.id, status: 'resolved', closed: 2 }); // the whole topic is closed
    const after = await get(owner, agent.id);
    expect(after.customInstructions).toBe('Toujours saluer.\n- Nous ne vendons pas de voitures.');
    expect(after.pendingInsights).toBe(2);
    expect((await owner.get(`/agents/${agent.id}/versions`).expect(200)).body.data[0]).toMatchObject({ source: 'insight' });
    expect((await owner.post(`/agent-insights/${unknown.id}/resolve`, { action: 'ignored_30d' }).expect(422)).body.error.code).toBe('INSIGHT_ALREADY_RESOLVED');
    // the next turn of the agent carries the instruction
    await ask('Bonjour');
    expect(fakeAi(app).callsOf('reply').at(-1)!.system).toContain('follow them in every reply, e.g. emoji use, tone, length)\nToujours saluer.\n- Nous ne vendons pas de voitures.');

    // create an FAQ from an insight
    const handoff = (await owner.get('/agent-insights?type=handoff&status=pending').expect(200)).body.data[0];
    await owner.post(`/agent-insights/${handoff.id}/resolve`, { action: 'faq', question: 'Puis-je être remboursé ?', answer: 'Oui sous 7 jours.' }).expect(200);
    expect((await owner.get(`/agents/${agent.id}/faq`).expect(200)).body.data.map((f: any) => f.question)).toEqual(['Puis-je être remboursé ?']);
    // "Ignorer 30 jours": dismissed, and the same topic no longer creates insights
    const unclear = (await owner.get('/agent-insights?type=unclear&status=pending').expect(200)).body.data[0];
    expect((await owner.post(`/agent-insights/${unclear.id}/resolve`, { action: 'ignored_30d' }).expect(200)).body.data.status).toBe('dismissed');
    await ask('??');
    expect((await owner.get('/agent-insights?type=unclear').expect(200)).body.meta.total).toBe(1);
    expect((await owner.get('/agent-insights?status=dismissed').expect(200)).body.data.map((i: any) => i.resolution)).toEqual(['ignored_30d']);
    // bulk dismiss
    await ask('Je veux un remboursement tout de suite');
    const pending = (await owner.get('/agent-insights?status=pending').expect(200)).body.data;
    const bulk = (await owner.post('/agent-insights/bulk/dismiss', { ids: [pending[0].id, unknown.id] }).expect(200)).body;
    expect(bulk.data.results.map((r: any) => [r.ok, r.error?.code ?? null])).toEqual([[true, null], [false, 'INSIGHT_ALREADY_RESOLVED']]);
    expect((await get(owner, agent.id)).pendingInsights).toBe(0);
  });

  it('AT-AGT-08 metrics of a period match the counted conversations, AI messages, handoffs and credits; `lastActiveAt` moves on each run', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const agent = await linkedAgent(owner.workspaceId, [page.id]);
    await createProduct(owner, { name: 'Robe satin bordeaux', price: 4500 });
    expect((await get(owner, agent.id)).lastActiveAt).toBeNull();
    const a = newSender();
    for (const [sender, text] of [[a, 'Bonjour, la robe satin ?'], [a, 'bonsoir'], [newSender(), 'Je veux un remboursement']] as const) {
      const { conversation } = await receive(app, page, sender, { text });
      await answer(app, owner.workspaceId, conversation.id);
    }
    const first = (await get(owner, agent.id)).lastActiveAt;
    expect(first).not.toBeNull();
    const m = (await owner.get(`/agents/${agent.id}/metrics`).expect(200)).body.data;
    expect(m).toMatchObject({ conversations: 2, handledWithoutHuman: 1, handoffs: 1, credits: 3, orders: 0, resolutionRate: 50, satisfaction: null, lastActiveAt: first });
    expect(m.aiMessages).toBe(await db.message.count({ where: { workspaceId: owner.workspaceId, author: 'ai' } }));
    expect(m.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(m.p95LatencyMs).toBeGreaterThanOrEqual(m.avgLatencyMs > 0 ? 1 : 0);
    expect((await get(owner, agent.id)).metrics30d).toMatchObject({ conversations: 2, handledWithoutHuman: 1, credits: 3 });
    // a period before the runs is empty; an inverted period is refused
    expect((await owner.get(`/agents/${agent.id}/metrics?from=2020-01-01&to=2020-01-31`).expect(200)).body.data).toMatchObject({ conversations: 0, credits: 0, aiMessages: 0 });
    await owner.get(`/agents/${agent.id}/metrics?from=2026-02-01&to=2026-01-01`).expect(422);
    // the credits ledger tells the same story, per agent
    const ledger = (await owner.get(`/credits/ledger?agentId=${agent.id}`).expect(200)).body;
    expect(ledger.meta.total).toBe(3);
    expect(ledger.data.every((r: any) => r.action === 'text_reply' && r.credits === -1 && r.agent.id === agent.id && r.aiRunId)).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    const { conversation } = await receive(app, page, newSender(), { text: 'Bonjour' });
    await answer(app, owner.workspaceId, conversation.id);
    expect(Date.parse((await get(owner, agent.id)).lastActiveAt)).toBeGreaterThan(Date.parse(first));
  });

  it('readiness checklist, export, preset update', async () => {
    const owner = await asOwner(app);
    const a = await draft(owner);
    const r0 = (await owner.get(`/agents/${a.id}/readiness`).expect(200)).body.data;
    expect(r0.ready).toBe(false);
    expect(Object.fromEntries(r0.checks.map((c: any) => [c.key, c.ok]))).toEqual({ catalog: false, productsWithoutPhoto: true, feeGrid: false, policies: false, channels: false, emailVerified: true, credits: true, pendingModeration: true });
    expect(r0.checks.find((c: any) => c.key === 'channels')).toMatchObject({ label: 'Pages rattachées', count: 0, link: '/channels', blocking: true });
    // "Voir" of the e-mail row opens the page that shows (and changes) the e-mail: Paramètres › Sécurité
    expect(r0.checks.find((c: any) => c.key === 'emailVerified')).toMatchObject({ link: '/settings/security', blocking: true });
    const page = await connectedPage(owner, app);
    await createProduct(owner);
    await patch(owner, a.id, { channelIds: [page.id], wizard: { policies: { delivery: 'a', payment: 'b', returns: 'c' } } });
    const r1 = (await owner.get(`/agents/${a.id}/readiness`).expect(200)).body.data;
    expect(r1.ready).toBe(true);
    expect(r1.checks.filter((c: any) => !c.ok).map((c: any) => c.key)).toEqual(['productsWithoutPhoto', 'feeGrid']);
    const exported = (await owner.get(`/agents/${a.id}/export`).expect(200)).body.data;
    expect(exported.agent).toMatchObject({ id: a.id, name: a.name });
    expect(exported.agent.metrics30d).toBeUndefined();
    // a newer published preset version is offered, then applied as a new version
    const preset = await db.agentPreset.findUniqueOrThrow({ where: { key: 'vendeur-pro' } });
    const next = preset.currentVersion + 1;
    await db.agentPresetVersion.create({ data: { presetId: preset.id, version: next, status: 'published', publishedAt: new Date(), config: { tone: 'professional', temperature: 0.3, maxTokens: 900 }, locales: {} } });
    await db.agentPreset.update({ where: { id: preset.id }, data: { currentVersion: next } });
    try {
      expect((await get(owner, a.id)).preset.updateAvailable).toBe(next);
      const updated = (await owner.post(`/agents/${a.id}/apply-preset-update`, { presetVersion: next }).expect(200)).body.data;
      expect(updated).toMatchObject({ personality: 'professional', temperature: 0.3, maxTokens: 900, customInstructions: a.customInstructions });
      expect(updated.preset).toMatchObject({ version: next, updateAvailable: null });
      await owner.post(`/agents/${a.id}/apply-preset-update`, { presetVersion: 999 }).expect(404);
    } finally {
      await db.agentPresetVersion.deleteMany({ where: { presetId: preset.id, version: next } });
      await db.agentPreset.update({ where: { id: preset.id }, data: { currentVersion: preset.currentVersion } });
    }
  });
});

describe('roles and tenancy', () => {
  it('role matrix: reads and tests for every member; management for Admin+; insights for every member; unauthenticated ⇒ 401', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const page = await connectedPage(owner, app);
    const a = await draft(owner);
    const id = a.id;
    const reads = ['/agents', '/agents/presets', `/agents/${id}`, `/agents/${id}/readiness`, `/agents/${id}/metrics`, `/agents/${id}/versions`, `/agents/${id}/versions/1`, `/agents/${id}/faq`, `/agents/${id}/test-scenarios`, '/agent-insights', '/ai/routes', '/credits', '/credits/calculator?conversations=100', `/channels/${page.id}/analysis`];
    for (const url of reads) for (const actor of [owner, admin, operator]) await actor.get(url).expect(200);
    // Admin+ only
    const manage: [string, string, Record<string, unknown>?][] = [
      ['post', '/agents', { presetKey: 'vendeur-pro' }],
      ['patch', `/agents/${id}`, { version: 1, name: 'x' }],
      ['delete', `/agents/${id}`],
      ['post', `/agents/${id}/activate`, {}],
      ['delete', `/agents/${id}/activate`],
      ['post', `/agents/${id}/pause`, {}],
      ['post', `/agents/${id}/resume`],
      ['post', `/agents/${id}/duplicate`],
      ['post', `/agents/${id}/versions/1/restore`],
      ['post', `/agents/${id}/apply-preset-update`, { presetVersion: 1 }],
      ['get', `/agents/${id}/export`],
      ['post', `/agents/${id}/faq`, { question: 'q ?', answer: 'a' }],
      ['post', `/agents/${id}/faq/extract`, { channelId: page.id }],
      ['post', `/agents/${id}/test-links`, {}],
      ['post', '/agents/generate', { channelId: page.id }],
      ['post', '/agents/bulk/pause', { ids: [id] }],
      ['post', '/agents/bulk/delete', { ids: [id] }],
      ['put', `/channels/${page.id}/agent`, { agentId: id }],
      ['put', `/channels/${page.id}/icebreaker`, { text: 'x' }],
      ['post', `/channels/${page.id}/analysis`],
      ['post', `/channels/${page.id}/analysis/import`, { items: [{ name: 'x', price: 1, quantity: 1 }] }],
      ['get', '/credits/ledger'],
    ];
    for (const [method, url, body] of manage) {
      const res = await (operator as any)[method](url, body);
      expect([url, res.status, res.body.error?.code]).toEqual([url, 403, 'FORBIDDEN']);
    }
    // an admin manages agents like the owner
    const made = (await admin.post('/agents', { presetKey: 'service-client' }).expect(201)).body.data;
    await admin.patch(`/agents/${made.id}`, { version: made.version, name: 'Par admin' }).expect(200);
    await admin.get('/credits/ledger').expect(200);
    await admin.delete(`/agents/${made.id}`).expect(204);
    // every member may test and handle insights
    await operator.post(`/agents/${id}/test`, { messages: [{ role: 'user', text: 'Bonjour' }] }).expect(200);
    await operator.post(`/agents/${id}/test-scenarios`).expect(202);
    await operator.post('/agent-insights/bulk/dismiss', { ids: [id] }).expect(200);
    const { anonymous } = await import('../support/actors');
    await anonymous(app).get('/agents').expect(401);
    await anonymous(app).get('/credits').expect(401);
    await anonymous(app).post(`/agents/${id}/test`, { messages: [] }).expect(401);
  });

  it('cross-workspace: every agent / insight / page-agent route answers 404 for another workspace\'s ids', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const agent = await linkedAgent(owner.workspaceId, [page.id]);
    const faq = await db.agentFaq.create({ data: { workspaceId: owner.workspaceId, agentId: agent.id, question: 'q ?', answer: 'a' } });
    const { conversation } = await receive(app, page, newSender(), { text: 'Je veux un remboursement' });
    await answer(app, owner.workspaceId, conversation.id);
    const insight = await db.agentInsight.findFirstOrThrow({ where: { agentId: agent.id } });
    const aiMessage = await db.message.findFirstOrThrow({ where: { conversationId: conversation.id, author: 'ai' } });
    const version = (await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).version;

    const stranger = await asOwner(app);
    const theirPage = await connectedPage(stranger, app);
    const id = agent.id;
    const calls: [string, string, Record<string, unknown>?][] = [
      ['get', `/agents/${id}`],
      ['patch', `/agents/${id}`, { version, name: 'volé' }],
      ['delete', `/agents/${id}`],
      ['post', `/agents/${id}/activate`, {}],
      ['delete', `/agents/${id}/activate`],
      ['post', `/agents/${id}/pause`, { confirm: true }],
      ['post', `/agents/${id}/resume`],
      ['post', `/agents/${id}/duplicate`],
      ['get', `/agents/${id}/readiness`],
      ['get', `/agents/${id}/metrics`],
      ['get', `/agents/${id}/export`],
      ['get', `/agents/${id}/versions`],
      ['get', `/agents/${id}/versions/1`],
      ['get', `/agents/${id}/versions/1/diff`],
      ['post', `/agents/${id}/versions/1/restore`],
      ['post', `/agents/${id}/apply-preset-update`, { presetVersion: 1 }],
      ['get', `/agents/${id}/faq`],
      ['post', `/agents/${id}/faq`, { question: 'q ?', answer: 'a' }],
      ['patch', `/agents/${id}/faq/${faq.id}`, { answer: 'b' }],
      ['delete', `/agents/${id}/faq/${faq.id}`],
      ['post', `/agents/${id}/faq/extract`, { channelId: theirPage.id }],
      ['post', `/agents/${id}/test`, { messages: [{ role: 'user', text: 'Bonjour' }] }],
      ['post', `/agents/${id}/test/flag`, { turnId: id }],
      ['get', `/agents/${id}/test/export?sessionId=s`],
      ['post', `/agents/${id}/test-scenarios`],
      ['get', `/agents/${id}/test-scenarios`],
      ['post', `/agents/${id}/test-links`, {}],
      ['post', `/agent-insights/${insight.id}/resolve`, { action: 'ignored_30d' }],
      ['put', `/channels/${page.id}/agent`, { agentId: null }],
      ['put', `/channels/${theirPage.id}/agent`, { agentId: id }],
      ['put', `/channels/${page.id}/icebreaker`, { text: 'x' }],
      ['post', `/channels/${page.id}/analysis`],
      ['get', `/channels/${page.id}/analysis`],
      ['post', `/channels/${page.id}/analysis/import`, { items: [{ name: 'x', price: 1, quantity: 1 }] }],
      ['post', '/agents/generate', { channelId: page.id }],
      ['get', `/messages/${aiMessage.id}/ai-run`],
    ];
    for (const [method, url, body] of calls) {
      const res = await (stranger as any)[method](url, body);
      expect([method, url, res.status]).toEqual([method, url, 404]);
    }
    // lists are scoped; bulk reports the foreign id as not found; nothing changed on the owner's side
    expect((await stranger.get('/agents').expect(200)).body.data).toEqual([]);
    expect((await stranger.get(`/agent-insights?agentId=${id}`).expect(200)).body.data).toEqual([]);
    expect((await stranger.get(`/credits/ledger?agentId=${id}`).expect(200)).body.data).toEqual([]);
    expect((await stranger.post('/agents/bulk/delete', { ids: [id] }).expect(200)).body.data.results[0]).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect((await stranger.post('/agent-insights/bulk/dismiss', { ids: [insight.id] }).expect(200)).body.data.results[0]).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const stolen = await stranger.patch(`/agents/${(await draft(stranger)).id}`, { version: 1, channelIds: [page.id] });
    expect(stolen.status).toBe(422);
    expect(await db.agent.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: 'Vendeur', deletedAt: null, status: 'active' });
    expect(await db.agentChannel.count({ where: { agentId: id, channelId: page.id } })).toBe(1);
    expect((await db.agentInsight.findUniqueOrThrow({ where: { id: insight.id } })).status).toBe('pending');
    // the owner reads the AI turn behind its message
    expect((await owner.get(`/messages/${aiMessage.id}/ai-run`).expect(200)).body.data).toMatchObject({ kind: 'reply', status: 'handoff', credits: 1, model: 'GPT-4o mini', provider: 'OpenAI', usedFallback: false, toolCalls: [] });
    const inbound = await db.message.findFirstOrThrow({ where: { conversationId: conversation.id, direction: 'in' } });
    await owner.get(`/messages/${inbound.id}/ai-run`).expect(404);
  });
});
