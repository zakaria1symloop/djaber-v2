// M11 carry-overs — agents & inbox: pause with the out-of-hours message (AT-AGV-08 / AT-DLG-44), the edited review of a
// page generation (AGT-03 `override`), "Agents qui le vendent" (`GET /agents?productId=`), the inbox `?agentId=` filter,
// FAQ import of a Word document, the agents server texts as i18n keys, the AI typing indicator around a reply.
import { strToU8, zipSync } from 'fflate';
import { WsEmitter } from '../../src/core/ws/ws.emitter';
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct, upload } from '../support/m2';
import { connectedPage, forbidNetwork, newSender, receive } from '../support/m3';
import { answer, closeOutbox, db, fakeAi, linkedAgent } from '../support/m4';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
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

const OUT_OF_HOURS_FR = 'Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l\'ouverture.';

describe('pause (AGV-07)', () => {
  it('AT-AGV-08 / AT-DLG-44 pause with open threads: 409 count without confirm; confirm ⇒ threads À traiter; the checkbox sends `out_of_hours` once per open thread through the outbound path', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const agent = await linkedAgent(owner.workspaceId, [page.id]);
    const threads = [];
    for (let i = 0; i < 3; i++) threads.push((await receive(app, page, newSender(), { text: `Bonjour ${i}` })).conversation);
    // a thread the AI no longer answers is not "open" (human took it) and is left alone
    await db.conversation.update({ where: { id: threads[2]!.id }, data: { aiPaused: true } });
    // the workspace text wins over the default
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { systemMessages: { out_of_hours: { fr: 'Nous sommes fermés, on revient vite.', ar: 'مغلق', en: 'Closed' } } } });

    const refused = await owner.post(`/agents/${agent.id}/pause`, { sendOutOfHours: true }).expect(409);
    expect(refused.body.error).toMatchObject({ code: 'AGENT_PAUSED_WITH_OPEN_THREADS', params: { count: 2 } });
    expect(await db.message.count({ where: { conversationId: { in: threads.map((t) => t.id) }, direction: 'out' } })).toBe(0);

    const paused = (await owner.post(`/agents/${agent.id}/pause`, { confirm: true, sendOutOfHours: true }).expect(200)).body.data;
    expect(paused).toMatchObject({ status: 'paused', pausedReason: 'manual' });
    for (const t of threads.slice(0, 2)) {
      const c = await db.conversation.findUniqueOrThrow({ where: { id: t.id } });
      expect(c).toMatchObject({ status: 'needs_human', aiPaused: true });
      expect(c.context).toMatchObject({ handoffReason: 'manual' });
      const sent = await db.message.findMany({ where: { conversationId: t.id, direction: 'out' } });
      expect(sent.map((m) => [m.author, m.text, m.deliveryStatus, (m.payload as any)?.templateKey])).toEqual([['system', 'Nous sommes fermés, on revient vite.', 'pending', 'out_of_hours']]);
      // never sent directly: a `meta-send` job is queued through the outbox
      const jobs = await db.outbox.findMany({ where: { workspaceId: owner.workspaceId, topic: 'job' } });
      expect(jobs.some((j) => (j.payload as any).name === 'meta-send' && (j.payload as any).data.messageId === sent[0]!.id)).toBe(true);
    }
    expect(await db.conversation.findUniqueOrThrow({ where: { id: threads[2]!.id } })).toMatchObject({ status: 'active' });
    expect(await db.message.count({ where: { conversationId: threads[2]!.id, direction: 'out' } })).toBe(0);
    const updates = (await db.outbox.findMany({ where: { topic: 'ws' } })).map((r) => r.payload as any).filter((p) => p.event === 'conversation.updated' && p.room === `ws:${owner.workspaceId}`);
    expect(updates.map((u) => u.payload.conversation.status)).toEqual(expect.arrayContaining(['needs_human', 'needs_human']));
    // a second pause is a no-op (already paused): no second message
    await owner.post(`/agents/${agent.id}/pause`, { confirm: true, sendOutOfHours: true }).expect(200);
    expect(await db.message.count({ where: { conversationId: threads[0]!.id, direction: 'out' } })).toBe(1);
  });

  it('without the checkbox nothing is sent to the customers; the flag is validated; Operators cannot pause', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const agent = await linkedAgent(owner.workspaceId, [page.id]);
    const { conversation } = await receive(app, page, newSender(), { text: 'Salam' });
    await owner.post(`/agents/${agent.id}/pause`, { confirm: true, sendOutOfHours: 'yes' }).expect(422);
    const op = await asOperator(app, owner.workspaceId);
    await op.post(`/agents/${agent.id}/pause`, { confirm: true, sendOutOfHours: true }).expect(403);
    await (await asAdmin(app, owner.workspaceId)).post(`/agents/${agent.id}/pause`, { confirm: true }).expect(200);
    expect(await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).toMatchObject({ status: 'needs_human' });
    expect(await db.message.count({ where: { conversationId: conversation.id, direction: 'out' } })).toBe(0);
    // another workspace's agent
    await (await asOwner(app)).post(`/agents/${agent.id}/pause`, { confirm: true, sendOutOfHours: true }).expect(404);
  });

  it('the default `out_of_hours` text is used when the workspace has none (customer language)', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const agent = await linkedAgent(owner.workspaceId, [page.id]);
    const { conversation } = await receive(app, page, newSender(), { text: 'Bonjour, c\'est combien ?' });
    await owner.post(`/agents/${agent.id}/pause`, { confirm: true, sendOutOfHours: true }).expect(200);
    const [m] = await db.message.findMany({ where: { conversationId: conversation.id, direction: 'out' } });
    expect(m?.text).toBe(OUT_OF_HOURS_FR);
  });
});

describe('generate from page: edited review (AGT-03 override)', () => {
  const done = async (workspaceId: string, userId: string, channelId: string) =>
    db.job.create({
      data: {
        workspaceId,
        createdById: userId,
        kind: 'generation',
        status: 'done',
        progress: 100,
        payload: { channelId, days: 30 },
        result: { channelId, conversations: 4, messages: 40, summary: 'Boutique de robes', languages: [], topQuestions: [], tone: 'friendly', proposedInstructions: 'PROPOSITION IA', proposedFaq: [{ q: 'Livrez-vous à Oran ?', a: 'Oui.' }, { q: 'Prix ?', a: '2000 DA' }], proposedPolicies: { delivery: 'Proposée' }, linkedAgent: null },
      },
    });

  it('the merchant\'s instructions, FAQ rows and policies are applied instead of the proposal; absent fields keep it; validation 422', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const job = await done(owner.workspaceId, owner.userId, page.id);
    await owner.post(`/agents/generate/${job.id}/apply`, { override: { faq: [{ q: '', a: 'x' }] } }).expect(422);
    await owner.post(`/agents/generate/${job.id}/apply`, { override: { instructions: 'x'.repeat(10_001) } }).expect(422);
    await owner.post(`/agents/generate/${job.id}/apply`, { override: { other: 1 } }).expect(422);
    const created = (await owner.post(`/agents/generate/${job.id}/apply`, { override: { instructions: 'Texte revu par le marchand', faq: [{ q: 'Livrez-vous à Oran ?', a: 'Oui, en 48 h.' }], policies: { delivery: 'Livraison 58 wilayas', payment: 'À la livraison' } } }).expect(200)).body.data;
    expect(created.customInstructions).toContain('Texte revu par le marchand');
    expect(created.customInstructions).not.toContain('PROPOSITION IA');
    expect(created.wizard.policies).toMatchObject({ delivery: 'Livraison 58 wilayas', payment: 'À la livraison' });
    const faqs = await db.agentFaq.findMany({ where: { agentId: created.id } });
    expect(faqs.map((f) => [f.question, f.answer])).toEqual([['Livrez-vous à Oran ?', 'Oui, en 48 h.']]);

    // an update of the linked agent with only `faq: []` keeps the proposed instructions and adds no FAQ
    const updated = (await owner.post(`/agents/generate/${job.id}/apply`, { agentId: created.id, confirm: true, override: { faq: [] } }).expect(200)).body.data;
    expect(updated.customInstructions).toContain('PROPOSITION IA');
    expect(await db.agentFaq.count({ where: { agentId: created.id } })).toBe(1);
    // another workspace cannot apply this job
    await (await asOwner(app)).post(`/agents/generate/${job.id}/apply`, { override: { instructions: 'x' } }).expect(404);
  });
});

describe('"Agents qui le vendent" (GET /agents?productId=)', () => {
  it('catalogue scope read the other way round: all ⇒ every agent, categories ⇒ the product\'s category, selection ⇒ the product; foreign product ⇒ 404', async () => {
    const owner = await asOwner(app);
    const robes = (await owner.post('/categories', { name: 'Robes' }).expect(201)).body.data;
    const sacs = (await owner.post('/categories', { name: 'Sacs' }).expect(201)).body.data;
    const robe = await createProduct(owner, { name: 'Robe satin', categoryId: robes.id });
    const sac = await createProduct(owner, { name: 'Sac cuir', categoryId: sacs.id });
    const free = await createProduct(owner, { name: 'Sans catégorie' });
    await linkedAgent(owner.workspaceId, [], { name: 'Tout' } as never);
    await linkedAgent(owner.workspaceId, [], { name: 'Robes seulement', catalogScope: 'categories', scopeCategoryIds: [robes.id] } as never);
    const pick = await linkedAgent(owner.workspaceId, [], { name: 'Sélection', sellAllProducts: false } as never);
    await db.agentProduct.create({ data: { agentId: pick.id, productId: sac.id } });
    const names = async (productId: string) => ((await owner.get(`/agents?productId=${productId}&sort=name`).expect(200)).body.data as any[]).map((a) => a.name);
    expect(await names(robe.id)).toEqual(['Robes seulement', 'Tout']);
    expect(await names(sac.id)).toEqual(['Sélection', 'Tout']);
    expect(await names(free.id)).toEqual(['Tout']);
    // combined with the other filters; every member may read
    expect(((await (await asOperator(app, owner.workspaceId)).get(`/agents?productId=${robe.id}&q=robes`).expect(200)).body.data as any[]).map((a) => a.name)).toEqual(['Robes seulement']);
    await owner.get('/agents?productId=nope').expect(422);
    const other = await asOwner(app);
    const foreign = await createProduct(other);
    expect((await owner.get(`/agents?productId=${foreign.id}`).expect(404)).body.error.code).toBe('NOT_FOUND');
  });

  it('client list L60 / L69 (Boutique de Lalla 22/11): a product added one by one to a category agent is sold by it; « Utilisé par un agent » reads the real scope', async () => {
    const owner = await asOwner(app);
    const robes = (await owner.post('/categories', { name: 'Robes' }).expect(201)).body.data;
    const sacs = (await owner.post('/categories', { name: 'Sacs' }).expect(201)).body.data;
    const robe = await createProduct(owner, { name: 'Robe lin', categoryId: robes.id });
    const sac = await createProduct(owner, { name: 'Sac paille', categoryId: sacs.id });
    const free = await createProduct(owner, { name: 'Bougie' });
    const cat = await linkedAgent(owner.workspaceId, [], { name: 'Robes', catalogScope: 'categories', scopeCategoryIds: [robes.id] } as never);
    const ids = async (q: string) => ((await owner.get(`/products?${q}&pageSize=50`).expect(200)).body.data as any[]).map((p) => p.name).sort();
    // before: the category agent sells the dress only; the other two are « sans agent »
    expect(await ids(`agentId=${cat.id}`)).toEqual(['Robe lin']);
    expect(await ids('noAgent=1')).toEqual(['Bougie', 'Sac paille']);
    // « Ajouter à un agent » on the bag: it is now sold by the category agent too (it did nothing before)
    expect((await owner.post('/products/bulk/agent', { ids: [sac.id], agentId: cat.id }).expect(200)).body.meta).toMatchObject({ ok: 1, failed: 0 });
    expect(await ids(`agentId=${cat.id}`)).toEqual(['Robe lin', 'Sac paille']);
    expect(await ids('noAgent=1')).toEqual(['Bougie']);
    expect(((await owner.get(`/agents?productId=${sac.id}`).expect(200)).body.data as any[]).map((a) => a.name)).toEqual(['Robes']);
    expect((await owner.get(`/products/${sac.id}`).expect(200)).body.data.agents.map((a: any) => a.name)).toEqual(['Robes']);
    // a whole-catalogue agent sells everything: nothing is « sans agent », and it lists every product
    const all = await linkedAgent(owner.workspaceId, [], { name: 'Tout' } as never);
    expect(await ids(`agentId=${all.id}`)).toEqual(['Bougie', 'Robe lin', 'Sac paille']);
    expect(await ids('noAgent=1')).toEqual([]);
    // Houssem live 24/11 UX-086: a refused product and one waiting for its first review are sold by no agent, even one that sells everything
    await db.product.update({ where: { id: free.id }, data: { moderationStatus: 'rejected' } });
    await db.$executeRaw`UPDATE "Product" SET "moderationStatus" = 'pending', "approvedSnapshot" = NULL WHERE "id" = ${sac.id}::uuid`;
    expect(await ids(`agentId=${all.id}`)).toEqual(['Robe lin']);
    expect(await ids('noAgent=1')).toEqual(['Bougie', 'Sac paille']);
    // client list L71 (Houssem live 24/11): a product whose change waits for the review keeps its approved version on sale — the list
    // says « proposé par l'IA », not « exclu »; one waiting for its first review, or refused, stays « exclu »
    const state = async (id: string) => (await owner.get(`/products/${id}`).expect(200)).body.data.aiState;
    expect(await state(sac.id)).toBe('excluded');
    expect(await state(free.id)).toBe('excluded');
    await db.product.update({ where: { id: robe.id }, data: { moderationStatus: 'pending', approvedSnapshot: { title: 'Robe lin', price: 1000 } } });
    expect(await state(robe.id)).toBe('proposed');
    expect(await ids(`agentId=${all.id}`)).toEqual(['Robe lin']);
    expect(free.id).toBeTruthy();
    expect(robe.id).toBeTruthy();
  });
});

describe('inbox ?agentId= (M5 row)', () => {
  it('conversations answered by the agent, or not answered yet on its pages; other agents\' threads and other workspaces excluded', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const a = await linkedAgent(owner.workspaceId, [page.id], { name: 'A' } as never);
    const b = await linkedAgent(owner.workspaceId, [], { name: 'B' } as never);
    const waiting = (await receive(app, page, newSender(), { text: 'Bonjour' })).conversation;
    const answeredByB = (await receive(app, page, newSender(), { text: 'Salut' })).conversation;
    await db.conversation.update({ where: { id: answeredByB.id }, data: { agentId: b.id } });
    const ids = async (agentId: string) => ((await owner.get(`/conversations?agentId=${agentId}`).expect(200)).body.data as any[]).map((c) => c.id).sort();
    expect(await ids(a.id)).toEqual([waiting.id]);
    expect(await ids(b.id)).toEqual([answeredByB.id]);
    expect(await ids(`${a.id},${b.id}`)).toEqual([waiting.id, answeredByB.id].sort());
    const other = await asOwner(app);
    expect(((await other.get(`/conversations?agentId=${a.id}`).expect(200)).body.data as any[]).length).toBe(0);
  });
});

describe('FAQ import of a Word document (M4 row)', () => {
  const docx = (lines: string[]) =>
    Buffer.from(
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`),
      }),
    );
  it('.docx Q/R pairs are imported (source file_import); a broken .docx and a PDF ⇒ 415 UPLOAD_TYPE_INVALID', async () => {
    const owner = await asOwner(app);
    const agent = await linkedAgent(owner.workspaceId, []);
    const res = await upload(owner, app, `/agents/${agent.id}/faq/import`, 'file', [{ buffer: docx(['Q: Livrez-vous à Oran ?', 'R: Oui, en 48 h.', 'Q: Paiement ?', 'R: À la livraison.']), name: 'faq.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }]).expect(201);
    expect(res.body.data.created.map((f: any) => [f.question, f.answer, f.source])).toEqual([
      ['Livrez-vous à Oran ?', 'Oui, en 48 h.', 'file_import'],
      ['Paiement ?', 'À la livraison.', 'file_import'],
    ]);
    expect((await upload(owner, app, `/agents/${agent.id}/faq/import`, 'file', [{ buffer: Buffer.from('not a zip'), name: 'faq.docx', type: 'application/octet-stream' }]).expect(415)).body.error.code).toBe('UPLOAD_TYPE_INVALID');
    expect((await upload(owner, app, `/agents/${agent.id}/faq/import`, 'file', [{ buffer: Buffer.from('%PDF-1.7'), name: 'faq.pdf', type: 'application/pdf' }]).expect(415)).body.error.code).toBe('UPLOAD_TYPE_INVALID');
  });
});

describe('agents server texts (i18n keys agent.api.*)', () => {
  it('default name, copy suffix and readiness labels in fr / ar / en', async () => {
    const owner = await asOwner(app);
    const a = (await owner.post('/agents', { fromScratch: true }).expect(201)).body.data;
    expect(a.name).toBe('Nouvel agent');
    const ar = (await owner.post('/agents', { fromScratch: true }).set('Accept-Language', 'ar').expect(201)).body.data;
    expect(ar.name).toBe('وكيل جديد');
    expect((await owner.post(`/agents/${a.id}/duplicate`).set('Accept-Language', 'en').expect(201)).body.data.name).toBe('Nouvel agent (copy)');
    const checks = (await owner.get(`/agents/${a.id}/readiness`).expect(200)).body.data.checks;
    expect(checks.find((c: any) => c.key === 'feeGrid').label).toBe('Grille des frais de livraison');
    expect((await owner.get(`/agents/${a.id}/readiness`).set('Accept-Language', 'en').expect(200)).body.data.checks.find((c: any) => c.key === 'channels').label).toBe('Linked pages');
  });
});

describe('AI typing indicator (M4 row "IA répond…")', () => {
  it('conversation.typing { ai: true, active: true } when the reply job starts and { active: false } when it ends', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    await linkedAgent(owner.workspaceId, [page.id]);
    const { conversation } = await receive(app, page, newSender(), { text: 'Bonjour, vous avez des robes ?' });
    const spy = jest.spyOn(app.app.get(WsEmitter), 'emit');
    try {
      await answer(app, owner.workspaceId, conversation.id);
      const typing = spy.mock.calls.filter((c) => c[1] === 'conversation.typing');
      expect(typing.map((c) => [c[0], (c[2] as any).conversationId, (c[2] as any).ai, (c[2] as any).active])).toEqual([
        [`ws:${owner.workspaceId}`, conversation.id, true, true],
        [`ws:${owner.workspaceId}`, conversation.id, true, false],
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});
