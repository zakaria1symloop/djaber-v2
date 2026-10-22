// M4 — playground dry run (AGT-07), shared test link, the 8 scenarios; generate-from-page (AGT-03), FAQ extraction,
// page analysis and import (CHN-08, FL-15); create-from-photo through the AI port with its credits (CAT-07); credits reads.
import request from 'supertest';
import { RedisService } from '../../src/core/redis/redis.provider';
import { algiersDay } from '../../src/core/time/algiers';
import { CreditService } from '../../src/modules/credits/credit.service';
import { HistorySyncService } from '../../src/modules/messaging/history-sync.service';
import { anonymous, asOperator, asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct, image, jobOf, upload } from '../support/m2';
import { connectedPage, fakeMeta, forbidNetwork, work } from '../support/m3';
import { closeOutbox, balanceOf, db, fakeAi, feeRule, inTenant, ledger, linkedAgent, setCredits } from '../support/m4';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
const test = (actor: Actor, agentId: string, body: Record<string, unknown>) => actor.post(`/agents/${agentId}/test`, body);
const say = (text: string) => ({ messages: [{ role: 'user', text }] });
const resetRuns = (workspaceId: string) => app.app.get(RedisService).client.del(`rl:analysis:${workspaceId}:${algiersDay()}`);

beforeAll(async () => {
  app = await createTestApp();
  net = forbidNetwork();
});
afterAll(async () => {
  expect(net.spy).not.toHaveBeenCalled();
  net.restore();
  await closeOutbox();
  await app.close();
});
beforeEach(() => fakeAi(app).reset());

describe('playground (AGT-07)', () => {
  it('AT-AI-17 / AT-AI-16 a playground turn is a real turn on the real catalogue: AiRun kind `test`, tool calls, cards, prompt preview — 0 credits, nothing sent, no conversation', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const agent = await linkedAgent(owner.workspaceId, [page.id]);
    const robe = await createProduct(owner, { name: 'Robe satin bordeaux', price: 4500, stock: 5 });
    const sent = fakeMeta(app).callsOf('send').length;
    const turn = (await test(owner, agent.id, { sessionId: 's-1', ...say('Bonjour, combien la robe satin ?') }).expect(200)).body.data;
    expect(turn).toMatchObject({ sessionId: 's-1', status: 'OK', intent: 'sale', model: 'GPT-4o mini', modelDetail: { id: 'gpt-4o-mini', temperature: 0.6, maxTokens: 1200 }, creditsInProd: 1, language: 'fr', statusDetail: null });
    expect(turn.reply).toContain('Robe satin bordeaux — 4500 DA');
    expect(turn.toolCalls).toEqual([{ name: 'search_products', args: { query: expect.any(String), limit: 5 }, result: { products: [expect.objectContaining({ id: robe.id, price: 4500 })] }, simulated: false }]);
    expect(turn.cards).toEqual([{ productId: robe.id, name: 'Robe satin bordeaux', price: 4500, imageUrl: null, variantLabel: null }]); // real product data
    expect(turn.tokens.input).toBeGreaterThan(0);
    expect(turn.promptSections.map((s: any) => s.key)).toEqual(['identity', 'catalogue', 'delivery', 'order_rules', 'image_rule', 'cross_sell', 'card_template', 'handoff', 'language', 'output_contract']);
    expect(turn.promptPreview[0]).toContain('You are "Vendeur"');
    expect(turn.systemMessages.map((m: any) => m.key)).toEqual(['welcome']);
    const run = await db.aiRun.findUniqueOrThrow({ where: { id: turn.turnId }, include: { toolCalls: true } });
    expect(run).toMatchObject({ kind: 'test', status: 'ok', conversationId: null, agentId: agent.id, creditsCharged: 0, batchKey: 's-1', toolCallCount: 1 });
    expect(run.toolCalls).toHaveLength(1);
    // nothing left the platform and nothing was charged
    expect(fakeMeta(app).callsOf('send').length).toBe(sent);
    expect(await db.conversation.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    expect((await ledger(owner.workspaceId)).filter((l) => l.aiRunId)).toHaveLength(0);
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).lastActiveAt).toBeNull();
    // a second turn of the same session carries the history
    const next = (await test(owner, agent.id, { sessionId: 's-1', messages: [{ role: 'user', text: 'Bonjour, combien la robe satin ?' }, { role: 'assistant', text: turn.reply }, { role: 'user', text: 'Je veux un remboursement' }] }).expect(200)).body.data;
    expect(next).toMatchObject({ status: 'HANDOFF', statusDetail: 'refund' });
    expect(next.systemMessages.map((m: any) => m.key)).toEqual(['handoff']);
    expect(fakeAi(app).callsOf('reply').at(-1)!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(await db.agentInsight.count({ where: { agentId: agent.id } })).toBe(0); // a test never feeds the insights queue
    // validation
    await test(owner, agent.id, { messages: [] }).expect(422);
    await test(owner, agent.id, { messages: [{ role: 'assistant', text: 'x' }] }).expect(422);
    await test(owner, agent.id, { messages: [{ role: 'user', text: 'x'.repeat(2001) }] }).expect(422);
  });

  it('AT-AI-16 dry-run order: everything is validated, `TEST-…` number, never persisted, 0 credits; the 61st turn in an hour ⇒ PLAYGROUND_RATE_LIMITED', async () => {
    const owner = await asOwner(app);
    const agent = await linkedAgent(owner.workspaceId, []);
    const robe = await createProduct(owner, { name: 'Robe satin bordeaux', price: 4500, stock: 5 });
    await feeRule(owner.workspaceId, 16, 400, 300);
    const stock = (await db.product.findUniqueOrThrow({ where: { id: robe.id } })).stock;
    const args = { clientName: 'Amine Benali', clientPhone: '0555 12 34 56', wilayaId: 16, address: 'Cité des 200 logements, Alger', items: [{ productId: robe.id, quantity: 2 }], customerConfirmed: true };
    fakeAi(app).script('reply', { toolCalls: [{ name: 'create_order', args }, { name: 'create_order', args: { ...args, clientPhone: '123' } }, { name: 'add_faq_candidate', args: { question: 'Livrez-vous le vendredi ?' } }] }, { reply: 'Commande test enregistrée.', intent: 'SALE' });
    const turn = (await test(owner, agent.id, say('oui je confirme')).expect(200)).body.data;
    expect(turn.toolCalls[0]).toMatchObject({ name: 'create_order', simulated: true, result: { ok: true, simulated: true, orderId: null, subtotal: 9000, deliveryFee: 400, total: 9400, items: [{ name: 'Robe satin bordeaux', quantity: 2, unitPrice: 4500 }], paymentOptions: ['cod'] } });
    expect(turn.toolCalls[0].result.number).toMatch(/^TEST-\d{4}$/);
    expect(turn.toolCalls[1]).toMatchObject({ simulated: false, result: { ok: false, error: { code: 'VALIDATION', field: 'clientPhone' } } });
    expect(turn.toolCalls[2]).toMatchObject({ result: { ok: true, simulated: true } });
    expect(turn.status).toBe('OK'); // a simulated order does not hand the test over to a human
    expect(await db.order.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: robe.id } })).stock).toBe(stock);
    expect(await db.agentFaq.count({ where: { agentId: agent.id } })).toBe(0);
    expect((await balanceOf(app, owner.workspaceId)).planUsed).toBe(0);

    // 60 turns / hour / workspace
    await app.app.get(RedisService).client.set(`rl:playground:${owner.workspaceId}`, '59', 'EX', 3600);
    await test(owner, agent.id, say('Bonjour')).expect(200); // the 60th
    const limited = await test(owner, agent.id, say('Bonjour')).expect(429);
    expect(limited.body.error.code).toBe('PLAYGROUND_RATE_LIMITED');
    expect((await balanceOf(app, owner.workspaceId)).planUsed).toBe(0);
    // provider down ⇒ 503 AI_PROVIDER_ERROR, the run is closed as an error
    await app.app.get(RedisService).client.del(`rl:playground:${owner.workspaceId}`);
    fakeAi(app).reset();
    fakeAi(app).script('reply', { error: 'provider_error' }, { error: 'timeout' });
    expect((await test(owner, agent.id, { sessionId: 'down', ...say('Bonjour') }).expect(503)).body.error.code).toBe('AI_PROVIDER_ERROR');
    expect(await db.aiRun.findFirstOrThrow({ where: { batchKey: 'down' } })).toMatchObject({ kind: 'test', status: 'error', creditsCharged: 0 });
  });

  it('playground with attachments: a photo goes through the 2-pass vision (would cost 5), flag for evals, export of the session', async () => {
    const owner = await asOwner(app);
    const agent = await linkedAgent(owner.workspaceId, []);
    const robe = await createProduct(owner, { name: 'Robe satin bordeaux', price: 4500, stock: 5 });
    const photo = (await upload(owner, app, '/uploads', 'file', [{ buffer: await image(700, 700), name: 'photo.jpg', type: 'image/jpeg' }], { kind: 'reply' }).expect(201)).body.data;
    fakeAi(app).script('vision_describe', { object: { description: 'robe satin', quality: 'ok', multipleProducts: false } }).script('vision_match', { object: { productId: robe.id, confidence: 0.88, alternatives: [] } });
    const turn = (await test(owner, agent.id, { sessionId: 'photo', messages: [{ role: 'user', text: 'vous avez ça ?', imageUploadId: photo.id }] }).expect(200)).body.data;
    expect(turn.creditsInProd).toBe(5);
    expect(turn.cards.map((c: any) => c.productId)).toEqual([robe.id]);
    expect((fakeAi(app).callsOf('reply')[0]!.messages.at(-1) as any).content).toContain('IMAGE RESULT: {"productId"');
    expect((await balanceOf(app, owner.workspaceId)).planUsed).toBe(0);

    const flagged = (await owner.post(`/agents/${agent.id}/test/flag`, { turnId: turn.turnId, note: 'mauvais produit' }).expect(200)).body.data;
    expect(flagged).toEqual({ turnId: turn.turnId, flagged: true });
    await owner.post(`/agents/${agent.id}/test/flag`, { turnId: agent.id }).expect(404);
    const exported = (await owner.get(`/agents/${agent.id}/test/export?sessionId=photo`).expect(200)).body.data;
    expect(exported).toMatchObject({ sessionId: 'photo', agent: { id: agent.id } });
    expect(exported.turns).toHaveLength(1);
    expect(exported.turns[0]).toMatchObject({ turnId: turn.turnId, reply: turn.reply, expect: { status: 'OK', intent: 'sale', language: 'fr', toolCalls: [] }, flagged: { note: 'mauvais produit', by: owner.userId } });
  });

  it('the 8 scenarios of the wizard\'s step 5 run as a job and report pass / fail per scenario; they are free', async () => {
    const owner = await asOwner(app);
    const agent = await linkedAgent(owner.workspaceId, []);
    await createProduct(owner, { name: 'Robe satin bordeaux', price: 4500, stock: 5 });
    expect((await owner.get(`/agents/${agent.id}/test-scenarios`).expect(200)).body.data.every((s: any) => s.status === null)).toBe(true);
    const { jobId } = (await owner.post(`/agents/${agent.id}/test-scenarios`).expect(202)).body.data;
    expect(await work(app, [owner.workspaceId])).toContain('agent-test-scenarios');
    const job = await jobOf(owner, jobId);
    expect(job).toMatchObject({ kind: 'agent_test_scenarios', status: 'done', progress: 100 });
    expect(job.result.total).toBe(8);
    const results = (await owner.get(`/agents/${agent.id}/test-scenarios`).expect(200)).body.data;
    expect(results.map((r: any) => r.scenarioKey)).toEqual(['darija_price', 'arabizi_delivery', 'photo', 'voice', 'off_catalog', 'anger', 'qty_limit', 'refund']);
    expect(Object.fromEntries(results.map((r: any) => [r.scenarioKey, r.status]))).toEqual({ darija_price: 'pass', arabizi_delivery: 'pass', photo: 'pass', voice: 'pass', off_catalog: 'pass', anger: 'pass', qty_limit: 'pass', refund: 'pass' });
    expect(await db.aiRun.count({ where: { agentId: agent.id, kind: 'test_scenario' } })).toBe(8);
    expect(await db.agentTestRun.count({ where: { agentId: agent.id, aiRunId: { not: null } } })).toBe(8);
    expect((await balanceOf(app, owner.workspaceId)).planUsed).toBe(0);
    // an agent that answers in the wrong script fails the language check
    fakeAi(app).script('reply', { reply: 'Bonjour, voici le prix.', intent: 'INFO' });
    await owner.post(`/agents/${agent.id}/test-scenarios`).expect(202);
    await work(app, [owner.workspaceId]);
    expect((await owner.get(`/agents/${agent.id}/test-scenarios`).expect(200)).body.data[0]).toMatchObject({ scenarioKey: 'darija_price', status: 'fail', summary: 'failed: language_respected' });
  });

  it('shared test link: public page for 24 h, only the reply and the cards are exposed, 60 turns / h per link, expired ⇒ 410 AGENT_TEST_LINK_EXPIRED', async () => {
    const owner = await asOwner(app);
    const agent = await linkedAgent(owner.workspaceId, [], { displayName: 'Lina' } as never);
    await createProduct(owner, { name: 'Robe satin bordeaux', price: 4500, stock: 5 });
    await owner.post(`/agents/${agent.id}/test-links`, { expiresInHours: 48 }).expect(422);
    const link = (await owner.post(`/agents/${agent.id}/test-links`, {}).expect(201)).body.data;
    const token = link.url.split('/agent-test/')[1];
    expect(Date.parse(link.expiresAt) - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect(await db.agentTestLink.count({ where: { tokenHash: token } })).toBe(0); // only the hash is stored
    const visitor = anonymous(app);
    expect((await visitor.get(`/agent-test/${token}`).expect(200)).body.data).toEqual({ agentName: 'Lina', avatarUrl: null, expiresAt: link.expiresAt });
    const reply = (await visitor.post(`/agent-test/${token}/messages`, { text: 'Bonjour, combien la robe satin ?' }).expect(200)).body.data;
    expect(Object.keys(reply).sort()).toEqual(['cards', 'reply']);
    expect(reply.reply).toContain('4500 DA');
    expect(reply.cards).toHaveLength(1);
    expect(await db.aiRun.count({ where: { agentId: agent.id, kind: 'test' } })).toBe(1);
    expect((await db.agentTestLink.findFirstOrThrow({ where: { agentId: agent.id } })).usedCount).toBe(1);
    await visitor.post(`/agent-test/${token}/messages`, { text: '' }).expect(422);
    await visitor.get('/agent-test/unknown-token-000000000000').expect(404);
    const row = await db.agentTestLink.findFirstOrThrow({ where: { agentId: agent.id } });
    await app.app.get(RedisService).client.set(`rl:playground:link:${row.id}`, '60', 'EX', 3600);
    expect((await visitor.post(`/agent-test/${token}/messages`, { text: 'Bonjour' }).expect(429)).body.error.code).toBe('PLAYGROUND_RATE_LIMITED');
    await db.agentTestLink.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await visitor.get(`/agent-test/${token}`).expect(410)).body.error.code).toBe('AGENT_TEST_LINK_EXPIRED');
    expect((await visitor.post(`/agent-test/${token}/messages`, { text: 'Bonjour' }).expect(410)).body.error.code).toBe('AGENT_TEST_LINK_EXPIRED');
  });
});

describe('generate from page, FAQ extraction, page analysis', () => {
  /** A page with its history synced by the M3 job (fake Meta: two short conversations). */
  const synced = async (owner: Actor) => {
    const page = await connectedPage(owner, app);
    fakeMeta(app).setHistory(page.externalId, [1, 2, 3].map((n) => ({
      id: `t_${page.externalId}_${n}`,
      updatedAt: new Date().toISOString(),
      participantId: `99${page.externalId.slice(-8)}${n}`,
      participantName: `Client ${n}`,
      messages: [
        { id: `m_${page.externalId}_${n}_1`, fromId: `99${page.externalId.slice(-8)}${n}`, text: 'Vous livrez à Oran ?', createdAt: new Date(Date.now() - 3 * 60_000).toISOString(), attachments: [] },
        { id: `m_${page.externalId}_${n}_2`, fromId: page.externalId, text: 'Oui, livraison à Oran en 3 jours pour 600 DA.', createdAt: new Date(Date.now() - 2 * 60_000).toISOString(), attachments: [] },
        { id: `m_${page.externalId}_${n}_3`, fromId: `99${page.externalId.slice(-8)}${n}`, text: n === 1 ? 'chhal la robe ?' : 'merci', createdAt: new Date(Date.now() - 60_000).toISOString(), attachments: [] },
      ],
    })));
    const { jobId } = (await owner.post(`/channels/${page.id}/sync`, { days: 30 }).expect(202)).body.data;
    await work(app, [owner.workspaceId]);
    expect((await jobOf(owner, jobId)).status).toBe('done');
    void HistorySyncService;
    return page;
  };

  it('AT-AGT-03 generate from page ⇒ job with a proposal; "apply to a new agent" creates one; updating the linked agent asks for a confirmation; other agents are untouched; 1 / page / 24 h', async () => {
    const owner = await asOwner(app);
    const page = await synced(owner);
    const other = await linkedAgent(owner.workspaceId, [], { name: 'Autre agent', customInstructions: 'Ne pas toucher.' } as never);
    const { jobId } = (await owner.post('/agents/generate', { channelId: page.id }).expect(202)).body.data;
    expect((await owner.post(`/agents/generate/${jobId}/apply`, {}).expect(409)).body.error.details).toMatchObject({ reason: 'JOB_NOT_DONE' });
    expect(await work(app, [owner.workspaceId])).toContain('agent-generation');
    const job = await jobOf(owner, jobId);
    expect(job).toMatchObject({ kind: 'generation', status: 'done' });
    expect(job.result).toMatchObject({ channelId: page.id, conversations: 3, messages: 9, linkedAgent: null, tone: 'friendly' });
    expect(job.result.topQuestions[0]).toEqual({ question: 'Vous livrez à Oran ?', count: 3 });
    expect(job.result.proposedFaq).toEqual([{ q: 'Vous livrez à Oran ?', a: 'Oui, livraison à Oran en 3 jours pour 600 DA.' }]);
    expect(job.result.languages.map((l: any) => l.code)).toEqual(expect.arrayContaining(['fr', 'arabizi']));
    // the conversations reached the model through the AI port, never through Meta again
    expect(fakeAi(app).callsOf('agent_generation')).toHaveLength(1);

    // apply to a NEW agent: preset Vendeur Pro + the proposals, linked to the page (which had no agent)
    const created = (await owner.post(`/agents/generate/${jobId}/apply`, {}).expect(200)).body.data;
    expect(created).toMatchObject({ status: 'draft', preset: { key: 'vendeur-pro' }, channels: [{ id: page.id }] });
    expect(created.customInstructions).toContain('Vous livrez à Oran ?');
    expect(created.wizard.faqCount).toBe(1);
    expect((await owner.get(`/agents/${created.id}/faq`).expect(200)).body.data[0]).toMatchObject({ question: 'Vous livrez à Oran ?', source: 'page_extraction' });
    expect((await owner.get(`/agents/${created.id}/versions`).expect(200)).body.data.some((v: any) => v.note === `generation:${jobId}`)).toBe(true);

    // update the agent linked to the page: confirmation required, then a new version; an agent that is not linked ⇒ 404
    const before = (await owner.get(`/agents/${created.id}`).expect(200)).body.data;
    const ask = await owner.post(`/agents/generate/${jobId}/apply`, { agentId: created.id }).expect(409);
    expect(ask.body.error.details).toMatchObject({ confirmRequired: true, agent: { id: created.id } });
    expect((await owner.get(`/agents/${created.id}`).expect(200)).body.data.version).toBe(before.version);
    const updated = (await owner.post(`/agents/generate/${jobId}/apply`, { agentId: created.id, confirm: true }).expect(200)).body.data;
    expect(updated.currentVersion).toBeGreaterThan(before.currentVersion);
    await owner.post(`/agents/generate/${jobId}/apply`, { agentId: other.id, confirm: true }).expect(404);
    expect(await db.agent.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ name: 'Autre agent', customInstructions: 'Ne pas toucher.', version: other.version });
    // the same page cannot be analysed twice in 24 h
    expect((await owner.post('/agents/generate', { channelId: page.id }).expect(429)).body.error.code).toBe('ANALYSIS_RATE_LIMITED');
    await owner.post(`/agents/generate/${'00000000-0000-7000-8000-000000000000'}/apply`, {}).expect(404);
  });

  it('FAQ extraction from the page conversations ⇒ entries "EXTRAIT DE LA PAGE", free, counted in the 3 runs / day', async () => {
    const owner = await asOwner(app);
    const page = await synced(owner);
    const agent = await linkedAgent(owner.workspaceId, [page.id]);
    const { jobId } = (await owner.post(`/agents/${agent.id}/faq/extract`, { channelId: page.id }).expect(202)).body.data;
    expect(await work(app, [owner.workspaceId])).toContain('faq-extract');
    expect((await jobOf(owner, jobId)).result).toMatchObject({ found: 1, created: 1, conversations: 3 });
    expect((await owner.get(`/agents/${agent.id}/faq`).expect(200)).body.data).toMatchObject([{ question: 'Vous livrez à Oran ?', answer: 'Oui, livraison à Oran en 3 jours pour 600 DA.', source: 'page_extraction', isActive: true }]);
    // running it again adds nothing
    await owner.post(`/agents/${agent.id}/faq/extract`, { channelId: page.id }).expect(202);
    await work(app, [owner.workspaceId]);
    expect(await db.agentFaq.count({ where: { agentId: agent.id } })).toBe(1);
    await owner.post(`/agents/${agent.id}/faq/extract`, { channelId: page.id }).expect(202);
    expect((await owner.post(`/agents/${agent.id}/faq/extract`, { channelId: page.id }).expect(429)).body.error.code).toBe('ANALYSIS_RATE_LIMITED');
    expect((await balanceOf(app, owner.workspaceId)).planUsed).toBe(0);
  });

  it('AT-CHN-10 page analysis: no `pages_read_user_content` ⇒ permission state; with it ⇒ job with progress, review grid, import validation (price > 0, qty > 0), products with `FB-` SKUs; 4th run of the day ⇒ rate-limited', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    await db.channel.update({ where: { id: page.id }, data: { grantedScopes: ['pages_show_list', 'pages_messaging'] } });
    expect((await owner.get(`/channels/${page.id}/analysis`).expect(200)).body.data).toMatchObject({ state: 'permission_required', jobId: null, items: [], runsLeftToday: 3 });
    expect((await owner.post(`/channels/${page.id}/analysis`).expect(403)).body.error.code).toBe('PAGE_ANALYSIS_PERMISSION_REQUIRED');
    await db.channel.update({ where: { id: page.id }, data: { grantedScopes: ['pages_show_list', 'pages_messaging', 'pages_read_engagement'] } });
    expect((await owner.get(`/channels/${page.id}/analysis`).expect(200)).body.data.state).toBe('none'); // the V1 permission set reads the page's posts too
    await db.channel.update({ where: { id: page.id }, data: { grantedScopes: ['pages_show_list', 'pages_messaging', 'pages_read_user_content'] } });
    expect((await owner.get(`/channels/${page.id}/analysis`).expect(200)).body.data.state).toBe('none');

    const existing = await createProduct(owner, { name: 'Sac à main cuir noir', price: 6000 });
    const { jobId } = (await owner.post(`/channels/${page.id}/analysis`).expect(202)).body.data;
    expect((await owner.get(`/channels/${page.id}/analysis`).expect(200)).body.data).toMatchObject({ state: 'running', jobId });
    expect((await owner.post(`/channels/${page.id}/analysis`).expect(202)).body.data.jobId).toBe(jobId); // one analysis at a time, not counted twice
    expect(await work(app, [owner.workspaceId])).toContain('page-analysis');
    const done = (await owner.get(`/channels/${page.id}/analysis`).expect(200)).body.data;
    expect(done).toMatchObject({ state: 'done', progress: 100, postsTotal: 5, postsDone: 5, runsLeftToday: 2, error: null });
    // 5 posts: a product twice (kept once), one already in the catalogue (flagged), a greeting (skipped), a product without price
    expect(done.items.map((i: any) => [i.name, i.price, i.duplicateOf])).toEqual([['Robe satin bordeaux', 4500, null], ['Sac à main cuir noir', 6200, existing.id], ['Ensemble sport gris', null, null]]);
    expect(done.items[0]).toMatchObject({ imageUrl: expect.stringContaining('fake.meta.local/posts/'), postId: `${page.externalId}_p1` });
    expect(fakeMeta(app).callsOf('posts').filter((c) => c.args.externalId === page.externalId).map((c) => c.args.after ?? null)).toEqual([null, '2', '4']); // paginated with the cursor
    expect(fakeAi(app).callsOf('page_post')).toHaveLength(4);
    expect((await balanceOf(app, owner.workspaceId)).planUsed).toBe(0); // free

    // review grid ⇒ import: the price and the quantity are required and > 0
    const bad = await owner.post(`/channels/${page.id}/analysis/import`, { items: [{ name: 'Ensemble sport gris', price: 0, quantity: 3 }, { name: 'Robe satin bordeaux', price: 4500, quantity: 0 }, { name: '', price: 100, quantity: 1 }] }).expect(422);
    expect(bad.body.error.fields).toMatchObject({ 'items.0.price': 'validation.price', 'items.1.quantity': 'validation.quantity', 'items.2.name': 'validation.required' });
    await owner.post(`/channels/${page.id}/analysis/import`, { items: [] }).expect(422);
    expect(await db.product.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
    const imported = (await owner.post(`/channels/${page.id}/analysis/import`, { items: [{ name: 'Robe satin bordeaux', description: 'Tailles S à XL', price: 4500, quantity: 4, imageUrl: done.items[0].imageUrl }, { name: 'Ensemble sport gris', price: 3900, quantity: 2, category: 'Inconnue' }] }).expect(200)).body.data;
    expect(imported.failed).toEqual([]);
    expect(imported.created.map((c: any) => c.sku)).toEqual(['FB-0001', 'FB-0002']);
    const robe = await db.product.findUniqueOrThrow({ where: { id: imported.created[0].productId }, include: { images: true } });
    expect(robe).toMatchObject({ name: 'Robe satin bordeaux', price: 4500, stock: 4, sku: 'FB-0001', description: 'Tailles S à XL', isActive: true });
    expect(robe.images).toHaveLength(1); // the post picture, re-hosted
    expect(await db.stockMovement.count({ where: { productId: robe.id } })).toBe(1);
    // a second import continues the numbering
    expect((await owner.post(`/channels/${page.id}/analysis/import`, { items: [{ name: 'Foulard soie', price: 1500, quantity: 1 }] }).expect(200)).body.data.created[0].sku).toBe('FB-0003');
    // tester report 2026-10-20 A1: the same post / a very close name is never created twice (an analysis run again)
    const twice = (await owner.post(`/channels/${page.id}/analysis/import`, { items: [{ name: 'Robe satin bordeaux', price: 4500, quantity: 1, postId: done.items[0].postId }, { name: 'robe SATIN bordeaux femme', price: 4500, quantity: 1 }] }).expect(200)).body.data;
    expect(twice.created).toEqual([]);
    expect(twice.failed.map((f: any) => [f.index, f.code])).toEqual([[0, 'ANALYSIS_PRODUCT_EXISTS'], [1, 'ANALYSIS_PRODUCT_EXISTS']]);
    // A2: a service / digital offer is created without stock
    const service = (await owner.post(`/channels/${page.id}/analysis/import`, { items: [{ name: 'Retouche de robe', price: 800, quantity: 1, isService: true, postId: 'svc-post' }] }).expect(200)).body.data;
    expect(await db.product.findUniqueOrThrow({ where: { id: service.created[0].productId } })).toMatchObject({ trackStock: false, stock: null });
    // the imported post is remembered on the analysis: importing it again under another name is refused too
    expect((await owner.post(`/channels/${page.id}/analysis/import`, { items: [{ name: 'Atelier couture', price: 900, quantity: 1, postId: 'svc-post' }] }).expect(200)).body.data.failed[0].code).toBe('ANALYSIS_PRODUCT_EXISTS');
    // an operator reads the analysis but cannot start or import
    const operator = await asOperator(app, owner.workspaceId);
    await operator.get(`/channels/${page.id}/analysis`).expect(200);

    // 3 runs per day per workspace
    await owner.post(`/channels/${page.id}/analysis`).expect(202);
    await work(app, [owner.workspaceId]);
    await owner.post(`/channels/${page.id}/analysis`).expect(202);
    await work(app, [owner.workspaceId]);
    expect((await owner.post(`/channels/${page.id}/analysis`).expect(429)).body.error.code).toBe('ANALYSIS_RATE_LIMITED');
    expect((await owner.get(`/channels/${page.id}/analysis`).expect(200)).body.data.runsLeftToday).toBe(0);
    // a revoked token ends the job with its error code, keeping what was found
    await resetRuns(owner.workspaceId);
    const { MetaError } = await import('../../src/modules/meta/meta-errors');
    fakeMeta(app).failNext('posts', new MetaError('token', 'expired', 190));
    await owner.post(`/channels/${page.id}/analysis`).expect(202);
    await work(app, [owner.workspaceId]);
    expect((await owner.get(`/channels/${page.id}/analysis`).expect(200)).body.data).toMatchObject({ state: 'failed', error: 'PAGE_SYNC_TOKEN_EXPIRED' });
  });
});

describe('create from photo and credits reads', () => {
  it('CAT-07 `POST /products/ai-fill` goes through the AI port: 5 credits debited on success (AiRun kind `vision`), released on failure, 402 INSUFFICIENT_CREDITS without balance', async () => {
    const owner = await asOwner(app);
    const photo = { buffer: await image(800, 800), name: 'robe-satin-bordeaux.jpg', type: 'image/jpeg' };
    const fill = () => upload(owner, app, '/products/ai-fill', 'photos', [photo]);
    const ok = (await fill().expect(200)).body.data;
    expect(ok).toMatchObject({ name: 'Robe satin bordeaux', filled: expect.arrayContaining(['name', 'description']) });
    expect(fakeAi(app).callsOf('product_vision')).toHaveLength(1);
    const run = await db.aiRun.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, kind: 'vision' } });
    expect(run).toMatchObject({ status: 'ok', creditsCharged: 5 });
    expect((await ledger(owner.workspaceId)).filter((l) => l.aiRunId === run.id).map((l) => [l.action, l.credits])).toEqual([['reserve', -5], ['release', 5], ['image_recognition', -5]]);
    // provider failure ⇒ 503, nothing charged, the daily allowance is not consumed
    fakeAi(app).script('product_vision', { error: 'provider_error' }, { error: 'provider_error' });
    expect((await fill().expect(503)).body.error.code).toBe('IMAGE_ANALYSIS_UNAVAILABLE');
    fakeAi(app).script('product_vision', { text: 'not json at all' });
    expect((await fill().expect(422)).body.error.code).toBe('IMAGE_ANALYSIS_FAILED');
    expect((await balanceOf(app, owner.workspaceId))).toMatchObject({ planUsed: 5, reserved: 0 });
    // no credits ⇒ 402
    await setCredits(app, owner.workspaceId, 4);
    expect((await fill().expect(402)).body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(fakeAi(app).callsOf('product_vision')).toHaveLength(4); // 1 success + 2 models down + 1 unusable answer; none for the 402
  });

  it('GET /credits (header pill), ledger with filters, calculator, period opening, WS `credits.updated`; grants are idempotent', async () => {
    const owner = await asOwner(app);
    const c0 = (await owner.get('/credits').expect(200)).body.data;
    expect(c0).toMatchObject({ plan: { used: 0, limit: 5000, remaining: 5000 }, packs: { remaining: 0 }, total: 5000, reserved: 0, negative: false, exhausted: false, burnRatePerDay: 0, exhaustedEta: null, pricePerCreditDzd: 0.9 });
    expect(Date.parse(c0.plan.periodEnd) - Date.parse(c0.plan.periodStart)).toBeGreaterThan(27 * 86_400_000);
    const credits = app.app.get(CreditService);
    const grant = () => inTenant(app, owner.workspaceId, () => credits.grant(owner.workspaceId, 250, { key: `promo:${owner.workspaceId}`, reason: 'promo' }));
    await grant();
    await grant(); // same key ⇒ one row
    expect((await owner.get('/credits').expect(200)).body.data).toMatchObject({ plan: { limit: 5250, remaining: 5250 }, total: 5250 });
    const rows = (await owner.get('/credits/ledger').expect(200)).body;
    expect(rows.data.map((r: any) => [r.action, r.kind, r.credits, r.balanceAfter, r.bucket])).toEqual([['grant', 'credit', 250, 5250, 'plan'], ['renewal', 'credit', 5000, 5000, 'plan']]);
    expect((await owner.get('/credits/ledger?action=grant').expect(200)).body.meta.total).toBe(1);
    expect((await owner.get('/credits/ledger?bucket=pack').expect(200)).body.meta.total).toBe(0);
    expect((await owner.get('/credits/ledger?from=2020-01-01&to=2020-01-02').expect(200)).body.meta.total).toBe(0);
    await owner.get('/credits/ledger?action=nope').expect(422);
    const events = (await db.outbox.findMany({ where: { topic: 'ws' } })).map((r) => r.payload as any).filter((p) => p.room === `ws:${owner.workspaceId}` && p.event === 'credits.updated');
    expect(events.at(-1)!.payload).toEqual({ planUsed: 0, planLimit: 5250, packBalance: 0, exhausted: false });
    // M9 (AT-PCK-04 formula): every message pays the text credit, photo / voice conversations add their cost
    expect((await owner.get('/credits/calculator?conversations=100&photoPct=10&voicePct=5&msgsPerConv=6').expect(200)).body.data).toMatchObject({ conversations: 100, textTurns: 600, imageTurns: 10, voiceTurns: 5, credits: 600 + 50 + 15, estimatedCostDzd: 599 });
    await owner.get('/credits/calculator').expect(422);
    // the scheduler opens the period of the workspaces that have none yet, and only once
    await credits.openPeriods();
    expect(await credits.openPeriods()).toBe(0);
    // a trial workspace keeps its sign-up grant as the allowance of its first period (no renewal on top)
    const res = await request(app.http()).post('/api/v1/auth/register').send({ firstName: 'Amine', lastName: 'Benali', email: `trial-${Date.now()}@test.local`, password: 'Motdepasse-2026' }).expect(201);
    const trialWs = res.body.data.user.ownedWorkspaceId;
    const trial = await inTenant(app, trialWs, () => credits.balance(trialWs));
    expect(trial).toMatchObject({ planLimit: 300, total: 300, planUsed: 0 });
    expect((await ledger(trialWs)).map((l) => l.action)).toEqual(['grant']);
  });
});
