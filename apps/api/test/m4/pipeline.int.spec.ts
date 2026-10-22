// M4 — FL-01 steps 6–15 end to end: inbound webhook (fake Meta) → gates → batching → `ai-reply` job → AiRun with tool
// replay → reply through the outbox → credits. AT ids from 13-acceptance-tests.md. The AI adapter is the scriptable fake.
import { getMessages } from '@djaber/shared';
import { RedisService } from '../../src/core/redis/redis.provider';
import { ORDER_TOOLS, type OrderTools } from '../../src/modules/ai/tools/order-tools';
import { RoutingService } from '../../src/modules/ai/routing.service';
import { ConversationService } from '../../src/modules/messaging/conversation.service';
import { asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct, image, upload, drain } from '../support/m2';
import { connectedPage, fakeMeta, forbidNetwork, newSender, receive, work } from '../support/m3';
import { closeOutbox, withLimits, aiMessages, answer, balanceOf, db, fakeAi, feeRule, inTenant, ledger, linkedAgent, outMessages, replyJob, runReply, runsOf, setCredits, textRoute } from '../support/m4';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
const fr = getMessages('fr');
type Shop = { owner: Actor; page: Awaited<ReturnType<typeof connectedPage>>; agent: Awaited<ReturnType<typeof linkedAgent>>; robe: { id: string; name: string }; sac: { id: string; name: string } };

const shop = async (agentOver: Record<string, unknown> = {}): Promise<Shop> => {
  const owner = await asOwner(app);
  const page = await connectedPage(owner, app);
  const agent = await linkedAgent(owner.workspaceId, [page.id], agentOver as never);
  const robe = await createProduct(owner, { name: 'Robe satin bordeaux', price: 4500, stock: 5, description: 'Robe longue en satin' });
  const sac = await createProduct(owner, { name: 'Sac cuir noir', price: 6200, stock: 3 });
  return { owner, page, agent, robe, sac };
};
const resetAi = async () => {
  fakeAi(app).reset();
  const route = await textRoute();
  const routing = app.app.get(RoutingService);
  await routing.resetBreaker(route.primaryModelId);
  if (route.fallbackModelId) await routing.resetBreaker(route.fallbackModelId);
};
/** A customer message received and answered; returns everything the assertions need. */
const turn = async (s: Shop, sender: string, message: Record<string, unknown>, o: Parameters<typeof answer>[3] = {}) => {
  const { conversation } = await receive(app, s.page, sender, message);
  const r = await answer(app, s.owner.workspaceId, conversation.id, o);
  return { conversationId: conversation.id, outcome: r?.outcome ?? null, out: await outMessages(conversation.id), runs: await runsOf(conversation.id), conversation: await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } }) };
};
const sends = (sender: string) => fakeMeta(app).callsOf('send').filter((c) => c.args.recipientId === sender).map((c) => ({ args: c.args as any }));
const debits = async (workspaceId: string) => (await ledger(workspaceId)).filter((l) => l.kind === 'debit');
const insightsOf = (conversationId: string) => db.agentInsight.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });

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
beforeEach(resetAi);

describe('FL-01 — reply turn', () => {
  it('inbound → debounce → run → tool call → reply + cards sent through fake Meta → 1 credit settled (AT-AI-17: AiRun with tokens, latency, tool calls)', async () => {
    const s = await shop();
    const sender = newSender();
    const { conversation, message } = await receive(app, s.page, sender, { text: 'Bonjour, combien la robe satin ?' });
    const job = await replyJob(app, conversation.id);
    expect(job!.opts.delay).toBe(3000); // agent.responseDelaySec
    expect(job!.data).toMatchObject({ workspaceId: s.owner.workspaceId, conversationId: conversation.id, batchKey: message!.id });
    expect(await aiMessages(conversation.id)).toHaveLength(0); // nothing leaves before the window closes

    const r = await answer(app, s.owner.workspaceId, conversation.id);
    expect(r!.outcome).toBe('sent');
    const out = await outMessages(conversation.id);
    // welcome (first reply of the thread) → AI text → product cards, in that order, all sent by the fake Meta adapter
    expect(out.map((m) => [m.author, m.type, m.deliveryStatus])).toEqual([['system', 'text', 'sent'], ['ai', 'text', 'sent'], ['ai', 'product_cards', 'sent']]);
    expect(out[0]!.text).toBe(fr['customer.welcome']!.replace('{shop}', (await db.workspace.findUniqueOrThrow({ where: { id: s.owner.workspaceId } })).name));
    expect(out[1]!.text).toContain('Robe satin bordeaux — 4500 DA');
    expect((out[2]!.payload as any).cards.map((c: any) => c.productId)).toEqual([s.robe.id]);
    expect(sends(sender).map((c) => c.args.message.kind)).toEqual(['text', 'text', 'text']); // welcome, reply, card caption (the card has no image)
    expect(sends(sender).every((c) => c.args.messagingType === 'RESPONSE' && !c.args.tag)).toBe(true);

    const [run] = await runsOf(conversation.id);
    expect(run).toMatchObject({ kind: 'reply', status: 'ok', intent: 'sale', creditsCharged: 1, toolCallCount: 1, usedFallback: false, agentId: s.agent.id, batchKey: message!.id });
    expect(run!.inputTokens).toBeGreaterThan(0);
    expect(run!.outputTokens).toBeGreaterThan(0);
    expect(run!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(run!.toolCalls).toHaveLength(1);
    expect(run!.toolCalls[0]).toMatchObject({ name: 'search_products' });
    expect(run!.toolCalls[0]!.executedAt).not.toBeNull();
    expect((run!.meta as any).toolNames).toEqual(['search_products']);
    expect((run!.meta as any).costUsd).toBeGreaterThan(0);
    expect(out[1]!.aiRunId).toBe(run!.id);
    // ledger: opening → reserve → un-reserve → debit; Σ = the debit
    expect((await ledger(s.owner.workspaceId)).map((l) => [l.action, l.kind, l.credits])).toEqual([['renewal', 'credit', 5000], ['reserve', 'reserved', -1], ['release', 'release', 1], ['text_reply', 'debit', -1]]);
    expect(await balanceOf(app, s.owner.workspaceId)).toMatchObject({ total: 4999, planUsed: 1, reserved: 0 });
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conv).toMatchObject({ lastAiIntent: 'sale', agentId: s.agent.id, status: 'active' });
    expect((conv.context as any).lastProductIds).toEqual([s.robe.id]);
    expect((await db.agent.findUniqueOrThrow({ where: { id: s.agent.id } })).lastActiveAt).not.toBeNull();
  });

  it('AT-AI-18 typing indicator at the start of the window and again before generation', async () => {
    const s = await shop();
    const sender = newSender();
    const before = fakeMeta(app).callsOf('senderAction').length;
    const { conversation } = await receive(app, s.page, sender, { text: 'Salam' });
    expect(fakeMeta(app).callsOf('senderAction').length - before).toBe(1);
    await answer(app, s.owner.workspaceId, conversation.id);
    const typing = fakeMeta(app).callsOf('senderAction').slice(before);
    expect(typing).toHaveLength(2);
    expect(typing.every((c) => c.args.action === 'typing_on' && c.args.recipientId === sender)).toBe(true);
  });

  it('messages of one window are answered together; a message arriving later opens a new batch', async () => {
    const s = await shop();
    const sender = newSender();
    const first = await receive(app, s.page, sender, { text: 'Bonjour' });
    await receive(app, s.page, sender, { text: 'vous avez la robe satin ?' });
    expect((await replyJob(app, first.conversation.id))!.data.batchKey).toBe(first.message!.id);
    await answer(app, s.owner.workspaceId, first.conversation.id);
    const user = fakeAi(app).callsOf('reply')[0]!.messages.at(-1)!;
    expect(user).toMatchObject({ role: 'user', content: 'Bonjour\nvous avez la robe satin ?' });
    expect(await aiMessages(first.conversation.id)).toHaveLength(2); // one text + one cards message for both customer messages
    const later = await receive(app, s.page, sender, { text: 'et le sac ?' });
    expect((await replyJob(app, first.conversation.id))!.data.batchKey).toBe(later.message!.id);
    await answer(app, s.owner.workspaceId, first.conversation.id);
    // the second turn sees the first one as history, and no second welcome is sent
    const history = fakeAi(app).callsOf('reply').at(-2)!.messages;
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect((await outMessages(first.conversation.id)).filter((m) => m.author === 'system')).toHaveLength(1);
  });

  it('AT-AI-01 the reply follows the customer language and script (Arabic script, arabizi, French, English)', async () => {
    const s = await shop();
    const cases: [string, RegExp, string][] = [
      ['سلام، بشحال الروب ساتان؟', /[؀-ۿ]/, 'ar'],
      ['salam, chhal robe satin ?', /^[^؀-ۿ]+$/, 'arabizi'],
      ['Bonjour, quel est le prix de la robe satin ?', /^[^؀-ۿ]+$/, 'fr'],
      ['Hello, how much is the satin dress?', /^[^؀-ۿ]+$/, 'en'],
    ];
    for (const [text, script, lang] of cases) {
      const t = await turn(s, newSender(), { text });
      const reply = t.out.find((m) => m.author === 'ai' && m.type === 'text')!;
      expect(reply.text).toMatch(script);
      expect((t.conversation.context as any).lastLanguage).toBe(lang);
      // the prompt carries the strict language rule and the detected language
      const system = fakeAi(app).callsOf('reply').at(-1)!.system;
      expect(system).toContain('LANGUAGE (STRICT');
      expect((t.runs[0]!.meta as any).language).toBe(lang);
    }
    // the workspace system texts follow the same language: Arabic script ⇒ `ar`, arabizi ⇒ `fr`
    const ar = await turn(s, newSender(), { text: 'مرحبا' });
    expect(ar.out[0]!.text).toMatch(/[؀-ۿ]/);
  });

  it('AT-AI-02 catalogue of 200 products: the prompt switches to retrieval, `search_products` is called, only real products are cited', async () => {
    const s = await shop();
    await db.product.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ workspaceId: s.owner.workspaceId, sku: `BULK-${i}`, name: `Article divers ${i}`, price: 1000 + i, stock: 4 })) });
    const t = await turn(s, newSender(), { text: 'vous avez une robe satin ?' });
    const call = fakeAi(app).callsOf('reply')[0]!;
    expect(call.system).toContain('CATALOGUE: 202 products. Use search_products before naming any product.');
    expect(call.system).toContain(`[ID:${s.robe.id}]`); // matched by the batch text
    expect(call.system).not.toContain('Article divers 150');
    expect(t.runs[0]!.toolCalls.map((c) => c.name)).toEqual(['search_products']);
    const cards = (t.out.find((m) => m.type === 'product_cards')!.payload as any).cards;
    expect(cards.map((c: any) => c.productId)).toEqual([s.robe.id]);
  });

  it('AT-AI-03 malformed output ⇒ one retry with the format reminder; still malformed ⇒ no customer message, insight `error`, `needs_human`, nothing charged', async () => {
    const s = await shop();
    // repaired on the second try
    fakeAi(app).script('reply', { text: 'Sure! The dress costs 4500.' }, { reply: 'La robe est à 4500 DA.', intent: 'INFO' });
    const ok = await turn(s, newSender(), { text: 'prix robe ?' });
    expect(ok.outcome).toBe('sent');
    expect(fakeAi(app).callsOf('reply')[1]!.messages.at(-1)).toMatchObject({ role: 'user', content: 'Format reminder: respond with the JSON object only.' });
    expect(ok.out.find((m) => m.author === 'ai')!.text).toBe('La robe est à 4500 DA.');

    // malformed twice ⇒ FL-01 F-6
    await resetAi();
    fakeAi(app).script('reply', { text: 'not json' }, { object: { reply: 'missing fields' } });
    const sender = newSender();
    const ko = await turn(s, sender, { text: 'prix robe ?' });
    expect(ko.outcome).toBe('failed');
    expect(ko.out).toHaveLength(0);
    expect(sends(sender)).toHaveLength(0);
    expect(ko.conversation).toMatchObject({ status: 'needs_human', aiPaused: true });
    expect((ko.conversation.context as any).aiUnavailable).toBe('error');
    expect(ko.runs[0]).toMatchObject({ status: 'error', creditsCharged: 0 });
    expect(ko.runs[0]!.error).toContain('malformed_output');
    expect((await insightsOf(ko.conversationId)).map((i) => [i.type, i.detail?.split(':')[0]])).toEqual([['error', 'malformed_output']]);
    expect(await debits(s.owner.workspaceId)).toHaveLength(1); // only the first turn was charged
    expect((await balanceOf(app, s.owner.workspaceId)).reserved).toBe(0);
    // GET /conversations/:id exposes the banner flag
    expect((await s.owner.get(`/conversations/${ko.conversationId}`).expect(200)).body.data).toMatchObject({ aiUnavailable: true, creditsExhausted: false });

    // A3 (tester report 2026-10-20: the bot "stopped answering"): right away the thread stays with the team …
    await resetAi();
    const soon = await turn(s, sender, { text: 'allo ?' });
    expect(soon.conversation).toMatchObject({ status: 'needs_human', aiPaused: true });
    // … two minutes later the next customer message is answered by the AI again (nobody of the team wrote meanwhile)
    const ctx = (await db.conversation.findUniqueOrThrow({ where: { id: ko.conversationId } })).context as any;
    await db.conversation.update({ where: { id: ko.conversationId }, data: { context: { ...ctx, handoffAt: new Date(Date.now() - 3 * 60_000).toISOString() } } });
    fakeAi(app).script('reply', { reply: 'La robe est à 4500 DA.', intent: 'INFO' });
    const back = await turn(s, sender, { text: 'prix robe ?' });
    expect(back.conversation).toMatchObject({ status: 'active', aiPaused: false });
    expect((back.conversation.context as any).aiUnavailable).toBeNull();
    expect(back.out.at(-1)).toMatchObject({ author: 'ai', text: 'La robe est à 4500 DA.' });
  });

  it('AT-AI-11 product card template is part of the prompt; the cards are still sent', async () => {
    const s = await shop({ productCardTemplate: '⭐ {name} à {price} DA — {stock} en stock' });
    fakeAi(app).script('reply', { reply: '⭐ Robe satin bordeaux à 4500 DA — 5 en stock', intent: 'SALE', productCards: [s.robe.id, s.sac.id] });
    const t = await turn(s, newSender(), { text: 'la robe ?' });
    expect(fakeAi(app).callsOf('reply')[0]!.system).toContain('When presenting a product use this template: ⭐ {name} à {price} DA — {stock} en stock');
    expect(t.out.find((m) => m.author === 'ai' && m.type === 'text')!.text).toBe('⭐ Robe satin bordeaux à 4500 DA — 5 en stock');
    expect((t.out.find((m) => m.type === 'product_cards')!.payload as any).cards.map((c: any) => c.name)).toEqual(['Robe satin bordeaux', 'Sac cuir noir']);
  });

  it('AT-AI-13 an archived / inactive / out-of-scope product never reaches the prompt, the search, the cards or an order', async () => {
    const s = await shop();
    const archived = await createProduct(s.owner, { name: 'Veste archivée', price: 9000, stock: 2 });
    const inactive = await createProduct(s.owner, { name: 'Veste inactive', price: 9000, stock: 2 });
    await s.owner.delete(`/products/${archived.id}`).expect(204);
    await db.product.update({ where: { id: inactive.id }, data: { isActive: false } });
    await feeRule(s.owner.workspaceId, 16);
    fakeAi(app).script(
      'reply',
      { toolCalls: [{ name: 'search_products', args: { query: 'veste' } }, { name: 'get_product', args: { productId: archived.id } }, { name: 'create_order', args: { clientName: 'Amine Benali', clientPhone: '0555123456', wilayaId: 16, address: 'Cité des 200 logements, Alger', items: [{ productId: archived.id, quantity: 1 }], customerConfirmed: true } }] },
      { reply: "Cette veste n'est plus disponible.", intent: 'INFO', productCards: [archived.id, inactive.id, s.robe.id] },
    );
    const t = await turn(s, newSender(), { text: 'je veux la veste' });
    const system = fakeAi(app).callsOf('reply')[0]!.system;
    expect(system).not.toContain('Veste archivée');
    expect(system).not.toContain('Veste inactive');
    const results = Object.fromEntries(t.runs[0]!.toolCalls.map((c) => [c.name, c.result as any]));
    expect(results.search_products.products).toEqual([]);
    expect(results.get_product).toEqual({ ok: false, error: { code: 'PRODUCT_NOT_AVAILABLE', productId: archived.id } });
    expect(results.create_order).toEqual({ ok: false, error: { code: 'PRODUCT_NOT_AVAILABLE', productId: archived.id } }); // dropped with a message, never ordered
    expect((t.out.find((m) => m.type === 'product_cards')!.payload as any).cards.map((c: any) => c.productId)).toEqual([s.robe.id]);
    // an agent limited to a selection only sees that selection
    const limited = await shop({ sellAllProducts: false });
    await limited.owner.post('/products/bulk/agent', { ids: [limited.sac.id], agentId: limited.agent.id }).expect(200);
    await turn(limited, newSender(), { text: 'bonjour, la robe satin ?' });
    const scoped = fakeAi(app).callsOf('reply').at(-2)!.system;
    expect(scoped).toContain('Sac cuir noir');
    expect(scoped).not.toContain('Robe satin bordeaux');
  });
});

describe('tools', () => {
  it('quote_delivery reads the merchant grid: home / stop-desk, free threshold, darija spelling, wilaya not served (FL-02 F-2)', async () => {
    const s = await shop();
    await feeRule(s.owner.workspaceId, 31, 700, 450);
    await feeRule(s.owner.workspaceId, 16, 400, 300, { freeAbove: 5000 });
    await feeRule(s.owner.workspaceId, 19, 600, 0, { isActive: false });
    fakeAi(app).script(
      'reply',
      { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'wahran' } }, { name: 'get_shipping_fee', args: { wilayaId: 16, subtotal: 6200 } }, { name: 'quote_delivery', args: { wilayaName: 'Sétif' } }, { name: 'quote_delivery', args: { wilayaName: 'Atlantide' } }, { name: 'quote_delivery', args: { wilayaId: 31, isStopdesk: true } }] },
      { reply: 'Livraison à Oran : 700 DA.', intent: 'INFO' },
    );
    const t = await turn(s, newSender(), { text: 'chhal tawsil l wahran ?' });
    const r = t.runs[0]!.toolCalls.map((c) => c.result as any);
    expect(r[0]).toMatchObject({ ok: true, wilayaId: 31, wilayaName: 'Oran', fee: 700, free: false, stopdeskAvailable: true, stopdeskFee: 450 });
    expect(r[1]).toMatchObject({ ok: true, wilayaId: 16, fee: 0, free: true, freeFrom: 5000 });
    expect(r[2]).toMatchObject({ ok: false, error: { code: 'WILAYA_NOT_SERVED', wilayaId: 19 } });
    expect(r[3]).toEqual({ ok: false, error: { code: 'VALIDATION', field: 'wilayaName', example: 'Alger' } }); // never throws: the model re-asks
    expect(r[4]).toMatchObject({ ok: true, isStopdesk: true, fee: 450 });
    expect(t.runs[0]!.creditsCharged).toBe(1);
  });

  it('loi 26-06: quote_delivery knows the wilayas 59–69 (official name inside a sentence, darija spelling, Arabic, id 69)', async () => {
    const s = await shop();
    await feeRule(s.owner.workspaceId, 68, 650, 400);
    await feeRule(s.owner.workspaceId, 67, 620, 400);
    await feeRule(s.owner.workspaceId, 69, 900, 600);
    await feeRule(s.owner.workspaceId, 26, 600, 400);
    fakeAi(app).script(
      'reply',
      {
        toolCalls: [
          { name: 'quote_delivery', args: { wilayaName: 'livraison à Bou Saâda svp' } },
          { name: 'quote_delivery', args: { wilayaName: 'ksar boukhari' } },
          { name: 'quote_delivery', args: { wilayaName: 'pour Ksar El Boukhari' } },
          { name: 'quote_delivery', args: { wilayaId: 69 } },
          { name: 'quote_delivery', args: { wilayaName: 'بوسعادة' } },
          { name: 'quote_delivery', args: { wilayaName: 'Médéa' } },
        ],
      },
      { reply: 'Livraison à Bou Saâda : 650 DA.', intent: 'INFO' },
    );
    const t = await turn(s, newSender(), { text: 'chhal tawsil l bousaada ?' });
    const r = t.runs[0]!.toolCalls.map((c) => c.result as any);
    expect(r.map((x) => [x.wilayaId, x.fee])).toEqual([[68, 650], [67, 620], [67, 620], [69, 900], [68, 650], [26, 600]]);
    expect(r[0]).toMatchObject({ ok: true, wilayaName: 'Bou Saâda' });
  });

  it('AT-AI-04 order capture up to `create_order`: invalid phone re-asked, phone normalised, fee from the grid, limits, 1 credit for the text and 0 for the order (the order row itself: test/m5/ai-orders)', async () => {
    const s = await shop({ maxQtyPerOrder: 3 });
    await feeRule(s.owner.workspaceId, 16, 400, 300);
    const port = app.app.get<OrderTools>(ORDER_TOOLS);
    const create = jest.spyOn(port, 'createOrder');
    const base = { clientName: 'Amine Benali', wilayaId: 16, address: 'Cité des 200 logements, Bt 4, Alger', items: [{ productId: s.robe.id, quantity: 1 }], customerConfirmed: true };
    fakeAi(app).script(
      'reply',
      { toolCalls: [{ name: 'create_order', args: { ...base, clientPhone: '12345' } }] },
      { toolCalls: [{ name: 'create_order', args: { ...base, clientPhone: '0555 12 34 56', customerConfirmed: false } }, { name: 'create_order', args: { ...base, clientPhone: '0555 12 34 56', items: [{ productId: s.robe.id, quantity: 4 }] } }, { name: 'create_order', args: { ...base, clientPhone: '0555 12 34 56', address: 'court' } }] },
      { toolCalls: [{ name: 'create_order', args: { ...base, clientPhone: '0555 12 34 56' } }] },
      { reply: 'Je transmets votre commande à un conseiller.', status: 'OK', intent: 'SALE' },
    );
    const t = await turn(s, newSender(), { text: 'نعم' });
    const r = t.runs[0]!.toolCalls.sort((a, b) => a.executedAt!.getTime() - b.executedAt!.getTime()).map((c) => c.result as any);
    expect(r[0]).toEqual({ ok: false, error: { code: 'VALIDATION', field: 'clientPhone', example: '0555123456' } });
    expect(r.filter((x) => x.error?.code === 'CONFIRMATION_REQUIRED')).toHaveLength(1);
    expect(r.filter((x) => x.hint === 'order_limit')).toEqual([{ ok: false, hint: 'order_limit', maxQty: 3, maxAmount: 50000 }]);
    expect(r.filter((x) => x.error?.field === 'address')).toHaveLength(1);
    // the validated request handed to the orders port (bound to the orders module since M5)
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![1]).toMatchObject({ clientPhone: '0555123456', wilayaId: 16, subtotal: 4500, deliveryFee: 400, total: 4900, items: [{ productId: s.robe.id, quantity: 1, unitPrice: 4500, name: 'Robe satin bordeaux' }] });
    expect(create.mock.calls[0]![0]).toMatchObject({ runId: t.runs[0]!.id, conversationId: t.conversationId, agentId: s.agent.id });
    // M5: the orders module creates the order; the thread stays with the AI
    expect(r.at(-1)).toMatchObject({ ok: true, number: 'CMD-1001', total: 4900, duplicateOf: null });
    expect(t.conversation.status).toBe('active');
    expect(t.runs[0]).toMatchObject({ status: 'ok', creditsCharged: 1 });
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(1);
    expect((await debits(s.owner.workspaceId)).map((d) => [d.action, d.credits])).toEqual([['text_reply', -1]]);
    create.mockRestore();
  });

  it('AT-AI-05 the job crashes after `create_order` ran, before the send ⇒ the retry replays the stored tool result: the tool runs once, one reply, one debit', async () => {
    const s = await shop();
    await feeRule(s.owner.workspaceId, 16, 400, 300);
    const port = app.app.get<OrderTools>(ORDER_TOOLS);
    const create = jest.spyOn(port, 'createOrder').mockResolvedValue({ ok: true, orderId: 'o-1', number: 'CMD-1042', subtotal: 4500, deliveryFee: 400, total: 4900, items: [], duplicateOf: null, paymentOptions: ['cod'] });
    const call = { name: 'create_order', args: { clientName: 'Amine Benali', clientPhone: '0555123456', wilayaId: 16, address: 'Cité des 200 logements, Alger', items: [{ productId: s.robe.id, quantity: 1 }], customerConfirmed: true } };
    const sender = newSender();
    const { conversation } = await receive(app, s.page, sender, { text: 'oui je confirme' });
    // attempt 1: the tool runs, then both models fail ⇒ the job throws (BullMQ will retry it)
    fakeAi(app).script('reply', { toolCalls: [{ ...call, id: 'call_a' }] }, { error: 'provider_error' }, { error: 'provider_error' });
    const data = (await replyJob(app, conversation.id))!.data as never;
    await expect(runReply(app, conversation.id, { attempt: 1, attempts: 3 })).rejects.toThrow(/ai provider unavailable/);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await outMessages(conversation.id)).toHaveLength(0);
    expect(await runsOf(conversation.id)).toMatchObject([{ status: 'running', attempt: 1 }]);
    expect((await balanceOf(app, s.owner.workspaceId)).reserved).toBe(1); // the reservation waits for the retry

    // attempt 2: re-prompted, the model asks for the same call under another provider id ⇒ stored result, no execution
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ ...call, id: 'call_b' }] }, { reply: 'Votre commande CMD-1042 est enregistrée. Total : 4900 DA.', intent: 'SALE' });
    const second = await runReply(app, conversation.id, { attempt: 2, attempts: 3, data });
    await work(app, [s.owner.workspaceId]);
    expect(second!.outcome).toBe('sent');
    expect(create).toHaveBeenCalledTimes(1);
    const replayed = fakeAi(app).callsOf('reply')[1]!.messages.at(-1) as any;
    expect(replayed).toMatchObject({ role: 'tool', name: 'create_order', result: { ok: true, number: 'CMD-1042' } });
    const [run] = await runsOf(conversation.id);
    expect(run).toMatchObject({ status: 'ok', attempt: 2, creditsCharged: 1, toolCallCount: 1 });
    expect(run!.toolCalls).toHaveLength(1);
    expect((await aiMessages(conversation.id)).map((m) => m.text)).toEqual(['Votre commande CMD-1042 est enregistrée. Total : 4900 DA.']);
    expect(sends(sender).filter((c) => String(c.args.message.text).includes('CMD-1042'))).toHaveLength(1);
    expect(await debits(s.owner.workspaceId)).toHaveLength(1);

    // AT-AI-06 (order rule itself: M5) — an existing order returned by the port reaches the model untouched
    create.mockResolvedValue({ ok: true, orderId: 'o-1', number: 'CMD-1042', total: 4900, duplicateOf: 'CMD-1042' });
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [call] }, { reply: 'Votre commande CMD-1042 est déjà enregistrée.', intent: 'SALE' });
    const again = await turn(s, sender, { text: 'oui je confirme' });
    expect((again.runs.at(-1)!.toolCalls[0]!.result as any).duplicateOf).toBe('CMD-1042');
    create.mockRestore();
  });

  it('a job that runs twice for the same batch sends one reply and debits once (retry idempotency)', async () => {
    const s = await shop();
    const sender = newSender();
    const { conversation } = await receive(app, s.page, sender, { text: 'Bonjour, la robe satin ?' });
    const data = (await replyJob(app, conversation.id))!.data as never;
    expect((await answer(app, s.owner.workspaceId, conversation.id))!.outcome).toBe('sent');
    const sentOnce = sends(sender).length;
    expect((await answer(app, s.owner.workspaceId, conversation.id, { data }))!.outcome).toBe('noop');
    expect((await answer(app, s.owner.workspaceId, conversation.id, { data }))!.outcome).toBe('noop');
    expect(await runsOf(conversation.id)).toHaveLength(1);
    expect(await aiMessages(conversation.id)).toHaveLength(2);
    expect(sends(sender)).toHaveLength(sentOnce);
    expect(await debits(s.owner.workspaceId)).toHaveLength(1);
    expect(fakeAi(app).callsOf('reply')).toHaveLength(2); // the model was not even called again
  });

  it('AT-AI-07 "annuler ma commande": candidates first, cancellation only after confirmation (through the orders port); an order the shop confirmed or shipped ⇒ handoff', async () => {
    const s = await shop();
    const port = app.app.get<OrderTools>(ORDER_TOOLS);
    const cancel = jest.spyOn(port, 'cancelOrder');
    const sender = newSender();
    const first = await turn(s, sender, { text: 'Bonjour' });
    const clientId = first.conversation.clientId!;
    const order = await db.order.create({ data: { workspaceId: s.owner.workspaceId, number: 'CMD-2001', clientId, source: 'ai', clientName: 'Client', clientPhone: '0555123456', subtotal: 4500, total: 4900, status: 'new' } });
    // default brain: "annuler" ⇒ cancel_order without confirmation ⇒ the open order is listed, nothing is cancelled
    const ask = await turn(s, sender, { text: 'je veux annuler ma commande' });
    expect(ask.runs.at(-1)!.toolCalls[0]).toMatchObject({ name: 'cancel_order', result: { ok: true, candidates: [{ number: 'CMD-2001', total: 4900, status: 'new' }] } });
    expect(cancel).not.toHaveBeenCalled();
    expect(ask.out.at(-1)!.text).toContain('CMD-2001');
    // confirmed ⇒ the port cancels THIS order through OrderEffects (M5); the model then hands off as scripted
    fakeAi(app).script('reply', { toolCalls: [{ name: 'cancel_order', args: { orderNumber: 'CMD-2001', customerConfirmed: true, reason: 'changed mind' } }] }, { reply: 'Je transmets à un conseiller.', status: 'HANDOFF', statusDetail: 'customer_request', intent: 'OTHER' });
    const confirm = await turn(s, sender, { text: 'oui annulez la' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]![1]).toMatchObject({ id: order.id, number: 'CMD-2001' });
    expect(confirm.conversation.status).toBe('needs_human');
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(1); // cancel_order never creates an order
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('cancelled');

    // shipped ⇒ not cancellable ⇒ the model hands off
    const other = newSender();
    const hello = await turn(s, other, { text: 'Bonjour' });
    await db.order.create({ data: { workspaceId: s.owner.workspaceId, number: 'CMD-2002', clientId: hello.conversation.clientId!, source: 'ai', clientName: 'Client', clientPhone: '0555123457', subtotal: 1000, total: 1000, status: 'shipped', deliveryStatus: 'sent' } });
    const shipped = await turn(s, other, { text: 'annuler ma commande svp' });
    expect(shipped.runs.at(-1)!.toolCalls[0]!.result).toEqual({ ok: false, error: { code: 'ORDER_NOT_CANCELLABLE' } });
    expect(shipped.conversation.status).toBe('needs_human');
    // A8 (tester report 2026-10-20): an order the shop confirmed is never cancelled by the AI — the team handles it
    const third = newSender();
    const hi = await turn(s, third, { text: 'Bonjour' });
    await db.order.create({ data: { workspaceId: s.owner.workspaceId, number: 'CMD-2003', clientId: hi.conversation.clientId!, source: 'ai', clientName: 'Client', clientPhone: '0555123458', subtotal: 1000, total: 1000, status: 'confirmed' } });
    const confirmed = await turn(s, third, { text: 'annuler ma commande svp' });
    expect(confirmed.runs.at(-1)!.toolCalls[0]!.result).toEqual({ ok: false, error: { code: 'ORDER_CONFIRMED_BY_SELLER', number: 'CMD-2003' }, hint: 'handoff' });
    expect(confirmed.conversation.status).toBe('needs_human');
    expect(cancel).toHaveBeenCalledTimes(1);
    cancel.mockRestore();
  });

  it('tester report 2026-10-20 A4: the details the customer gave are kept on the conversation and given to every next turn as KNOWN CUSTOMER', async () => {
    const s = await shop();
    const sender = newSender();
    fakeAi(app).script('reply', { reply: 'Merci Amina, quelle commune ?', intent: 'SALE', customer: { name: 'Amina Benali', phone: '0555 12 34 56', wilaya: 'Blida' } });
    const first = await turn(s, sender, { text: 'Amina Benali 0555123456 Blida' });
    expect((first.conversation.context as any).customer).toEqual({ name: 'Amina Benali', phone: '0555 12 34 56', wilaya: 'Blida' });
    // a later turn adds the commune; what was given before stays, even without being repeated
    fakeAi(app).script('reply', { reply: 'Noté.', intent: 'SALE', customer: { commune: 'Blida', phone: '' } });
    const second = await turn(s, sender, { text: 'commune Blida' });
    expect((second.conversation.context as any).customer).toEqual({ name: 'Amina Benali', phone: '0555 12 34 56', wilaya: 'Blida', commune: 'Blida' });
    await turn(s, sender, { text: 'je veux commander' });
    const system = fakeAi(app).callsOf('reply').at(-1)!.system;
    expect(system).toContain('KNOWN CUSTOMER (already given — confirm it in the recap, do not ask again): name=Amina Benali · phone=0555 12 34 56 · wilaya=Blida · commune=Blida');
  });

  it('AT-AI-19 "وين الطلبية ديالي؟" ⇒ `lookup_order` lists this client\'s open orders with the courier status; none ⇒ says so', async () => {
    const s = await shop();
    const sender = newSender();
    const none = await turn(s, sender, { text: 'وين الطلبية ديالي؟' });
    expect(none.runs[0]!.toolCalls[0]).toMatchObject({ name: 'lookup_order', result: { orders: [] } });
    expect(none.out.find((m) => m.author === 'ai')!.text).toBe('ما لقيت حتى طلبية مفتوحة باسمك.');
    expect(none.runs[0]!.intent).toBe('tracking');
    const clientId = none.conversation.clientId!;
    const order = await db.order.create({ data: { workspaceId: s.owner.workspaceId, number: 'CMD-3001', clientId, source: 'ai', clientName: 'Client', clientPhone: '0555123456', subtotal: 4500, total: 4900, status: 'shipped', deliveryStatus: 'in_transit' } });
    const shipment = await db.shipment.create({ data: { workspaceId: s.owner.workspaceId, orderId: order.id, provider: 'zrexpress', status: 'in_transit', trackingNumber: 'ZR-778', publicTrackingToken: `tok-${order.id}`, codAmount: 4900 } });
    await db.shipmentEvent.create({ data: { shipmentId: shipment.id, rawStatus: 'En cours de livraison', mappedStatus: 'in_transit', description: 'Colis au centre de tri Alger', at: new Date(), source: 'poll' } });
    // someone else's order is never listed
    const stranger = await db.client.create({ data: { workspaceId: s.owner.workspaceId, name: 'Autre', phone: '0660000000' } });
    await db.order.create({ data: { workspaceId: s.owner.workspaceId, number: 'CMD-3002', clientId: stranger.id, source: 'manual', clientName: 'Autre', clientPhone: '0660000000', subtotal: 1, total: 1 } });
    const found = await turn(s, sender, { text: 'win rahi la commande ?' });
    const orders = (found.runs.at(-1)!.toolCalls[0]!.result as any).orders;
    expect(orders).toEqual([expect.objectContaining({ number: 'CMD-3001', status: 'shipped', deliveryStatus: 'in_transit', courier: 'zrexpress', trackingNumber: 'ZR-778', lastEvent: expect.objectContaining({ label: 'Colis au centre de tri Alger' }), total: 4900 })]);
    expect(found.out.at(-1)!.text).toContain('CMD-3001');
  });
});

describe('handoff, insights, safety', () => {
  it('AT-AI-10 a refund request ⇒ HANDOFF: reply, workspace `handoff` text once, `needs_human`, insight, notification; a second handoff within 24 h sends no second handoff text', async () => {
    const s = await shop({ humanHandoffRules: 'Si le client parle de remboursement, transférer à un humain.' });
    const sender = newSender();
    const t = await turn(s, sender, { text: 'Je veux un remboursement' });
    expect(fakeAi(app).callsOf('reply')[0]!.system).toContain('Si le client parle de remboursement, transférer à un humain.');
    expect(t.runs[0]).toMatchObject({ status: 'handoff', intent: 'complaint', creditsCharged: 1 });
    expect(t.conversation).toMatchObject({ status: 'needs_human', aiPaused: true });
    expect((t.conversation.context as any).handoffReason).toBe('refund');
    const handoffText = fr['customer.handoff']!;
    // welcome, the model's own sentence, then the workspace handoff text
    expect(t.out.map((m) => m.text)).toEqual([expect.any(String), 'Je transmets votre demande à un conseiller.', handoffText]);
    expect((await insightsOf(t.conversationId)).map((i) => [i.type, i.detail, i.customerMessage])).toEqual([['handoff', 'refund', 'Je veux un remboursement']]);
    const notes = await db.notification.findMany({ where: { workspaceId: s.owner.workspaceId, type: { in: ['conversation_handoff', 'agent_insight'] } } });
    expect(notes.map((n) => n.type).sort()).toEqual(['agent_insight', 'conversation_handoff']);
    // while a human holds the thread the AI stays silent
    await receive(app, s.page, sender, { text: 'allo ?' });
    expect(await replyJob(app, t.conversationId)).toBeNull();
    // resumed by a member, the customer asks again ⇒ handoff again, but the handoff text is not repeated within 24 h
    await s.owner.patch(`/conversations/${t.conversationId}`, { aiPaused: false, version: (await db.conversation.findUniqueOrThrow({ where: { id: t.conversationId } })).version }).expect(200);
    const again = await turn(s, sender, { text: 'remboursement svp' });
    expect(again.conversation.status).toBe('needs_human');
    expect(again.out.filter((m) => m.text === handoffText)).toHaveLength(1);
  });

  it('UNCLEAR ⇒ insight only; 3 unclear turns in a row ⇒ handoff; UNKNOWN ⇒ reply sent, thread to the queue without the handoff text', async () => {
    const s = await shop();
    const sender = newSender();
    const one = await turn(s, sender, { text: '??' });
    expect(one.runs[0]!.status).toBe('unclear');
    expect(one.conversation.status).toBe('active');
    expect((one.conversation.context as any).unclearStreak).toBe(1);
    expect((await insightsOf(one.conversationId)).map((i) => i.type)).toEqual(['unclear']);
    await turn(s, sender, { text: '!!' });
    const three = await turn(s, sender, { text: '..' });
    expect(three.runs.at(-1)!.status).toBe('handoff');
    expect((three.conversation.context as any).handoffReason).toBe('unclear_streak');
    expect(fakeAi(app).callsOf('reply').at(-1)!.system).toContain('UNCLEAR_STREAK=2');

    const unknown = await turn(s, newSender(), { text: 'Est-ce que vous vendez des voitures neuves ?' });
    expect(unknown.runs[0]!.status).toBe('unknown');
    expect(unknown.conversation.status).toBe('needs_human');
    expect(unknown.out.map((m) => m.author)).toEqual(['system', 'ai']); // welcome + the reply; no handoff text
    expect((await insightsOf(unknown.conversationId)).map((i) => [i.type, i.detail])).toEqual([['unknown_topic', 'off_catalogue']]);
  });

  it('blocked words (D37): a reply containing one is never sent — handoff text instead, `needs_human`, insight `error`, run flagged, report when the word is platform-wide; inbound matches only flag the message', async () => {
    const s = await shop();
    await db.workspace.update({ where: { id: s.owner.workspaceId }, data: { blockedWords: ['contrefaçon'] } });
    fakeAi(app).script('reply', { reply: 'Oui, c\'est une contrefacon de bonne qualité.', intent: 'INFO' });
    const sender = newSender();
    const t = await turn(s, sender, { text: 'c\'est une contrefaçon ?' });
    expect(t.out.filter((m) => m.author === 'ai')).toHaveLength(0);
    expect(sends(sender).some((c) => String(c.args.message.text).includes('contrefacon'))).toBe(false);
    expect(t.out.map((m) => m.author)).toEqual(['system']); // the workspace handoff text only
    expect(t.conversation.status).toBe('needs_human');
    expect(t.runs[0]).toMatchObject({ status: 'handoff', flags: ['blocked_word'], creditsCharged: 0 });
    expect((await insightsOf(t.conversationId)).map((i) => [i.type, i.detail])).toEqual([['error', 'blocked_word:contrefaçon']]);
    expect((await db.message.findFirstOrThrow({ where: { conversationId: t.conversationId, direction: 'in' } })).containsBlockedWord).toBe(true);
    expect(await db.report.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(0);
    // platform list ⇒ a system report for moderation
    const admin = await db.user.findFirstOrThrow({ where: { platformRole: 'super_admin' } });
    await db.blockedWord.create({ data: { workspaceId: null, word: 'motinterditplateforme', createdById: admin.id } });
    await resetAi();
    fakeAi(app).script('reply', { reply: 'voici un motinterditplateforme', intent: 'INFO' });
    const p = await turn(s, newSender(), { text: 'bonjour' });
    expect(p.runs[0]!.flags).toEqual(['blocked_word']);
    expect(await db.report.findMany({ where: { workspaceId: s.owner.workspaceId } })).toMatchObject([{ type: 'ai_message', reporterKind: 'system', aiRunId: p.runs[0]!.id, details: 'blocked_word:motinterditplateforme' }]);
    await db.blockedWord.deleteMany({ where: { word: 'motinterditplateforme' } });
  });

  it('AT-AI-15 abuse guard (D33): the 50th message in 10 minutes ⇒ handoff, the AI stays silent; 20 in a minute ⇒ 10 s window', async () => {
    const s = await shop();
    const sender = newSender();
    const first = await receive(app, s.page, sender, { text: 'spam 1' });
    const redis = app.app.get(RedisService).client;
    await redis.set(`abuse:${first.conversation.id}:1m`, '19', 'EX', 60);
    await receive(app, s.page, sender, { text: 'spam 20' });
    expect((await replyJob(app, first.conversation.id))!.delay).toBe(10_000);
    await redis.set(`abuse:${first.conversation.id}:10m`, '49', 'EX', 600);
    await receive(app, s.page, sender, { text: 'spam 50' });
    await work(app, [s.owner.workspaceId]);
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: first.conversation.id } });
    expect(conv.status).toBe('needs_human');
    expect((conv.context as any).handoffReason).toBe('abuse_guard');
    // the job scheduled before the flood finds a handed-off thread and does nothing
    expect((await runReply(app, first.conversation.id))!.outcome).toBe('skipped:human');
    await receive(app, s.page, sender, { text: 'spam 51' });
    expect(await replyJob(app, first.conversation.id)).toBeNull();
    expect(await aiMessages(first.conversation.id)).toHaveLength(0);
    expect(fakeAi(app).calls).toHaveLength(0);
  });

  it('a member takes the thread while the model is thinking ⇒ nothing is sent, nothing is charged; outside the 24 h window the AI does not answer', async () => {
    const s = await shop();
    const sender = newSender();
    const { conversation } = await receive(app, s.page, sender, { text: 'Bonjour la robe ?' });
    fakeAi(app).script('reply', () => {
      // the human pauses the AI during the provider call
      void db.conversation.update({ where: { id: conversation.id }, data: { aiPaused: true } }).then(() => undefined);
      return { delayMs: 150, then: { reply: 'trop tard', intent: 'INFO' } };
    });
    expect((await answer(app, s.owner.workspaceId, conversation.id))!.outcome).toBe('aborted');
    expect(await aiMessages(conversation.id)).toHaveLength(0);
    expect(await runsOf(conversation.id)).toMatchObject([{ status: 'error', error: 'aborted', creditsCharged: 0 }]);
    expect(await debits(s.owner.workspaceId)).toHaveLength(0);
    expect((await balanceOf(app, s.owner.workspaceId)).reserved).toBe(0);

    await resetAi();
    const late = newSender();
    const l = await receive(app, s.page, late, { text: 'Bonjour' });
    await db.conversation.update({ where: { id: l.conversation.id }, data: { lastCustomerMessageAt: new Date(Date.now() - 25 * 3600_000) } });
    expect((await answer(app, s.owner.workspaceId, l.conversation.id))!.outcome).toBe('skipped:window');
    expect(fakeAi(app).calls).toHaveLength(0);
    expect(await db.conversation.findUniqueOrThrow({ where: { id: l.conversation.id } })).toMatchObject({ status: 'needs_human' });
    expect((await insightsOf(l.conversation.id)).map((i) => i.detail)).toEqual(['outside_window']);
    expect(await outMessages(l.conversation.id)).toHaveLength(0); // the AI never uses a message tag
  });

  it('out of hours: the workspace `out_of_hours` text goes out before the reply, once per conversation per 24 h; the AI keeps answering', async () => {
    const closedToday = { from: '09:00', to: '09:01', days: [(new Date(Date.now() + 3600_000).getUTCDay() + 3) % 7] };
    const s = await shop({ businessHours: closedToday });
    const sender = newSender();
    const t = await turn(s, sender, { text: 'Bonjour, la robe satin ?' });
    const closedText = fr['customer.out_of_hours']!;
    expect(t.out.map((m) => m.text).slice(0, 3)).toEqual([expect.any(String), closedText, expect.stringContaining('Robe satin bordeaux')]);
    expect(fakeAi(app).callsOf('reply')[0]!.system).toContain('OUT_OF_HOURS: true — keep answering and taking orders');
    const again = await turn(s, sender, { text: 'et le sac ?' });
    expect(again.out.filter((m) => m.text === closedText)).toHaveLength(1);
  });
});

describe('providers, credits', () => {
  it('AT-AI-12 provider 500 ⇒ the fallback model answers; both down ⇒ no customer message, no charge, insight `error`, Owner alerted after 3 failures', async () => {
    const s = await shop();
    const route = await textRoute();
    fakeAi(app).failModel(route.primaryModel.modelId, 'provider_error');
    const ok = await turn(s, newSender(), { text: 'Bonjour, la robe satin ?' });
    expect(ok.outcome).toBe('sent');
    expect(ok.runs[0]).toMatchObject({ status: 'ok', usedFallback: true, modelId: route.fallbackModelId, creditsCharged: 1 });
    // routing wrote the working model back on the agent? no: the agent keeps its model until the breaker opens
    await resetAi();
    fakeAi(app).failModel(route.primaryModel.modelId, 'provider_error').failModel(route.fallbackModel!.modelId, 'timeout');
    const failed = [];
    for (let i = 0; i < 3; i++) failed.push(await turn(s, newSender(), { text: 'Bonjour, la robe satin ?' }));
    for (const f of failed) {
      expect(f.outcome).toBe('failed');
      expect(f.out).toHaveLength(0);
      expect(f.runs[0]).toMatchObject({ status: 'error', creditsCharged: 0 });
      expect(f.conversation.status).toBe('needs_human');
      expect((await insightsOf(f.conversationId)).map((i) => i.type)).toEqual(['error']);
    }
    expect(await debits(s.owner.workspaceId)).toHaveLength(1);
    expect((await ledger(s.owner.workspaceId)).filter((l) => l.idempotencyKey.endsWith(':release'))).toHaveLength(3);
    const alert = await db.notification.findMany({ where: { workspaceId: s.owner.workspaceId, type: 'ai_error' } });
    expect(alert).toHaveLength(1);
    expect(alert[0]!.userId).toBe(s.owner.userId);
    // a rejected key (401) also falls back at once
    await resetAi();
    fakeAi(app).failModel(route.primaryModel.modelId, 'provider_rejected');
    expect((await turn(s, newSender(), { text: 'Bonjour, la robe satin ?' })).runs[0]).toMatchObject({ status: 'ok', usedFallback: true });
  });

  it('a slow model call is cut at the route timeout and retried on the fallback', async () => {
    const s = await shop();
    const route = await db.aiRoute.findUniqueOrThrow({ where: { capability: 'text' } });
    await db.aiRoute.update({ where: { id: route.id }, data: { timeoutSec: 1 } });
    try {
      fakeAi(app).script('reply', { delayMs: 5000, then: { reply: 'jamais', intent: 'INFO' } }, { reply: 'Réponse du modèle de secours', intent: 'INFO' });
      const t = await turn(s, newSender(), { text: 'Bonjour' });
      expect(t.out.find((m) => m.author === 'ai')!.text).toBe('Réponse du modèle de secours');
      expect(t.runs[0]!.usedFallback).toBe(true);
    } finally {
      await db.aiRoute.update({ where: { id: route.id }, data: { timeoutSec: 20 } });
    }
  });

  it('AT-AI-08 / AT-BIL-03 photo of a catalogue product ⇒ 2-pass vision, match ≥ 0.7, card, 5 credits reserved then debited; unknown photo ⇒ confirmation question, no price; provider error ⇒ reservation released', async () => {
    const s = await shop();
    await upload(s.owner, app, `/products/${s.robe.id}/images`, 'file', [{ buffer: await image(800, 800), name: 'robe.jpg', type: 'image/jpeg' }]).expect(201);
    await drain(app, s.owner.workspaceId);
    await resetAi();
    const photo = { attachments: [{ type: 'image', payload: { url: 'https://fake.meta.local/photo-robe.jpg' } }] };
    fakeAi(app)
      .script('vision_describe', { object: { category: 'robe', colors: ['bordeaux'], text: '', description: 'robe satin bordeaux', multipleProducts: false, quality: 'ok' } })
      .script('vision_match', (req) => ({ object: { productId: s.robe.id, confidence: 0.91, alternatives: [] }, ...(req ? {} : {}) }));
    const sender = newSender();
    const { conversation } = await receive(app, s.page, sender, photo);
    const reserved = await (async () => {
      const r = await runReply(app, conversation.id);
      await work(app, [s.owner.workspaceId]);
      return r;
    })();
    expect(reserved!.outcome).toBe('sent');
    const match = fakeAi(app).callsOf('vision_match')[0]!;
    expect((match.messages[0] as any).content.filter((p: any) => p.type === 'image')).toHaveLength(2); // the customer photo + the candidate's primary image
    const user = fakeAi(app).callsOf('reply')[0]!.messages.at(-1) as any;
    expect(user.content).toContain(`IMAGE RESULT: {"productId":"${s.robe.id}","confidence":0.91,"name":"Robe satin bordeaux"}`);
    const out = await outMessages(conversation.id);
    expect((out.find((m) => m.type === 'product_cards')!.payload as any).cards[0].productId).toBe(s.robe.id);
    expect((await runsOf(conversation.id))[0]).toMatchObject({ status: 'ok', creditsCharged: 5 });
    expect((await ledger(s.owner.workspaceId)).filter((l) => l.aiRunId).map((l) => [l.action, l.kind, l.credits])).toEqual([['reserve', 'reserved', -5], ['release', 'release', 5], ['image_recognition', 'debit', -5]]);

    // a photo that matches nothing: pass 2 never runs ⇒ the turn costs a text reply, and no price is stated
    await resetAi();
    fakeAi(app).script('vision_describe', { object: { category: 'voiture', colors: [], text: '', description: 'voiture rouge', multipleProducts: false, quality: 'ok' } });
    const unknown = await turn(s, newSender(), photo);
    const question = unknown.out.find((m) => m.author === 'ai')!;
    expect(question.text).toBe('Pouvez-vous me confirmer de quel produit il s\'agit ?');
    expect(question.text).not.toMatch(/\d+\s*DA/);
    expect(unknown.out.some((m) => m.type === 'product_cards')).toBe(false);
    expect(unknown.runs[0]).toMatchObject({ status: 'ok', creditsCharged: 1 });
    // low confidence ⇒ confirmation question too, but pass 2 ran: 5 credits
    await resetAi();
    fakeAi(app).script('vision_describe', { object: { description: 'robe satin', quality: 'ok', multipleProducts: false } }).script('vision_match', { object: { productId: s.robe.id, confidence: 0.4, alternatives: [] } });
    const unsure = await turn(s, newSender(), photo);
    expect(unsure.out.find((m) => m.author === 'ai')!.text).toBe('Pouvez-vous me confirmer de quel produit il s\'agit ?');
    expect(unsure.runs[0]!.creditsCharged).toBe(5);
    // blurry ⇒ ask for another photo
    await resetAi();
    fakeAi(app).script('vision_describe', { object: { description: '', quality: 'blurry', multipleProducts: false } });
    expect((await turn(s, newSender(), photo)).out.find((m) => m.author === 'ai')!.text).toBe('La photo est floue, pouvez-vous en envoyer une autre ?');

    // AT-BIL-03: provider error (both vision models) ⇒ the 5 reserved credits are released
    await resetAi();
    const before = (await debits(s.owner.workspaceId)).length;
    fakeAi(app).script('vision_describe', { error: 'provider_error' }, { error: 'provider_error' });
    const down = await turn(s, newSender(), photo);
    expect(down.outcome).toBe('failed');
    expect(down.runs[0]).toMatchObject({ status: 'error', creditsCharged: 0 });
    const rows = (await ledger(s.owner.workspaceId)).filter((l) => l.aiRunId === down.runs[0]!.id);
    expect(rows.map((l) => [l.action, l.kind, l.credits, l.idempotencyKey.split(':')[2]])).toEqual([['reserve', 'reserved', -5, 'reserve'], ['release', 'release', 5, 'release']]);
    expect(await debits(s.owner.workspaceId)).toHaveLength(before);
    expect((await balanceOf(app, s.owner.workspaceId)).reserved).toBe(0);
  });

  it('AT-AI-09 voice note ⇒ transcript stored, reply, 3 credits; Groq down ⇒ OpenAI; both down ⇒ `voiceFailed` once, 0 credits', async () => {
    const s = await shop();
    const voice = (n: number) => ({ attachments: [{ type: 'audio', payload: { url: `https://fake.meta.local/voice-${n}.mp3` } }] });
    fakeAi(app).transcript('Bonjour, combien la robe satin ?');
    const sender = newSender();
    const { conversation, message } = await receive(app, s.page, sender, voice(1));
    const stored = await db.message.findUniqueOrThrow({ where: { id: message!.id } });
    expect(stored).toMatchObject({ transcript: 'Bonjour, combien la robe satin ?', transcriptStatus: 'done' });
    expect(fakeAi(app).transcriptions[0]!.model).toMatchObject({ provider: 'groq', modelId: 'whisper-large-v3-turbo' });
    // the reply job was parked for the transcript and is released as soon as it exists
    expect((await replyJob(app, conversation.id))!.delay).toBe(0);
    const r = await answer(app, s.owner.workspaceId, conversation.id);
    expect(r!.outcome).toBe('sent');
    expect((fakeAi(app).callsOf('reply')[0]!.messages.at(-1) as any).content).toBe('[voice note transcript]: Bonjour, combien la robe satin ?');
    expect((await aiMessages(conversation.id))[0]!.text).toContain('Robe satin bordeaux');
    expect((await runsOf(conversation.id))[0]).toMatchObject({ status: 'ok', creditsCharged: 3 });
    expect((await debits(s.owner.workspaceId)).map((d) => [d.action, d.credits])).toEqual([['voice_transcription', -3]]);

    // Groq down ⇒ OpenAI whisper-1 answers
    await resetAi();
    fakeAi(app).failModel('whisper-large-v3-turbo').transcript('je veux le sac');
    const second = await receive(app, s.page, newSender(), voice(2));
    expect((await db.message.findUniqueOrThrow({ where: { id: second.message!.id } })).transcript).toBe('je veux le sac');
    expect(fakeAi(app).transcriptions.map((t) => t.model.modelId)).toEqual(['whisper-large-v3-turbo', 'whisper-1']);

    // both down ⇒ F-5
    await resetAi();
    fakeAi(app).failModel('whisper-large-v3-turbo').failModel('whisper-1');
    const other = newSender();
    const failed = await receive(app, s.page, other, voice(3));
    await work(app, [s.owner.workspaceId]);
    expect((await db.message.findUniqueOrThrow({ where: { id: failed.message!.id } })).transcriptStatus).toBe('failed');
    expect((await outMessages(failed.conversation.id)).map((m) => m.text)).toEqual([fr['customer.voiceFailed']]);
    expect((await runReply(app, failed.conversation.id))!.outcome).toBe('empty');
    expect(await runsOf(failed.conversation.id)).toHaveLength(0);
    await receive(app, s.page, other, voice(4));
    await work(app, [s.owner.workspaceId]);
    expect(await outMessages(failed.conversation.id)).toHaveLength(1); // once per conversation per 24 h
    expect(await debits(s.owner.workspaceId)).toHaveLength(1);
  });

  it('AT-AGT-06 image recognition off ⇒ the image is dropped and the text answered, image alone ⇒ unsupported-media text; voice off ⇒ unsupported-media text', async () => {
    const s = await shop({ imageRecognition: false, voiceTranscription: false });
    const img = { type: 'image', payload: { url: 'https://fake.meta.local/p.jpg' } };
    const withText = await turn(s, newSender(), { text: 'Bonjour, la robe satin ?', attachments: [img] });
    expect(withText.outcome).toBe('sent');
    expect(fakeAi(app).callsOf('vision_describe')).toHaveLength(0);
    expect((fakeAi(app).callsOf('reply')[0]!.messages.at(-1) as any).content).toBe('Bonjour, la robe satin ?');
    expect(fakeAi(app).callsOf('reply')[0]!.system).not.toContain('IMAGES\n');
    expect(withText.runs[0]!.creditsCharged).toBe(1);

    const alone = newSender();
    const a = await receive(app, s.page, alone, { attachments: [img] });
    await work(app, [s.owner.workspaceId]);
    expect(await replyJob(app, a.conversation.id)).toBeNull();
    expect((await outMessages(a.conversation.id)).map((m) => m.text)).toEqual([fr['customer.unsupportedMedia']]);

    const voice = newSender();
    const v = await receive(app, s.page, voice, { attachments: [{ type: 'audio', payload: { url: 'https://fake.meta.local/v.mp3' } }] });
    await work(app, [s.owner.workspaceId]);
    expect(await replyJob(app, v.conversation.id)).toBeNull();
    expect((await outMessages(v.conversation.id)).map((m) => m.text)).toEqual([fr['customer.unsupportedMedia']]);
    expect(fakeAi(app).transcriptions).toHaveLength(0);
    expect((await db.message.findFirstOrThrow({ where: { conversationId: v.conversation.id, direction: 'in' } })).transcriptStatus).toBeNull();
  });

  it('AT-AI-14 credits at 1, text + image (turn cost 5) ⇒ no run, `unavailable` text once, `needs_human`, Owner notified; the next message the same day is silent', async () => {
    const s = await shop();
    await setCredits(app, s.owner.workspaceId, 1);
    const sender = newSender();
    const msg = { text: 'vous avez ça ?', attachments: [{ type: 'image', payload: { url: 'https://fake.meta.local/p.jpg' } }] };
    const { conversation } = await receive(app, s.page, sender, msg);
    await work(app, [s.owner.workspaceId]);
    expect(await replyJob(app, conversation.id)).toBeNull();
    expect(await runsOf(conversation.id)).toHaveLength(0);
    expect(fakeAi(app).calls).toHaveLength(0);
    expect((await outMessages(conversation.id)).map((m) => [m.author, m.text])).toEqual([['system', fr['customer.unavailable']]]);
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conv).toMatchObject({ status: 'needs_human', aiPaused: true });
    expect((conv.context as any).handoffReason).toBe('credits_exhausted');
    expect((await s.owner.get(`/conversations/${conversation.id}`).expect(200)).body.data).toMatchObject({ creditsExhausted: true, aiUnavailable: false });
    const notes = await db.notification.findMany({ where: { workspaceId: s.owner.workspaceId, type: 'credits_exhausted' } });
    expect(notes.map((n) => n.userId)).toEqual([s.owner.userId]);
    // a text message alone (cost 1) on another thread is still answered, which empties the balance
    const text = await turn(s, newSender(), { text: 'Bonjour, la robe satin ?' });
    expect(text.outcome).toBe('sent');
    expect(await balanceOf(app, s.owner.workspaceId)).toMatchObject({ total: 0, exhausted: true });
    expect((await s.owner.get('/credits').expect(200)).body.data).toMatchObject({ total: 0, exhausted: true, plan: { remaining: 0 } });
    // same customer, same day: silence (the thread is in the queue), no second notification
    await receive(app, s.page, sender, msg);
    await work(app, [s.owner.workspaceId]);
    expect(await outMessages(conversation.id)).toHaveLength(1);
    expect(await db.notification.count({ where: { workspaceId: s.owner.workspaceId, type: 'credits_exhausted' } })).toBe(1);
    // another customer the same day: the fixed text once for that conversation, still one Owner notification
    const third = await receive(app, s.page, newSender(), { text: 'Salam' });
    await work(app, [s.owner.workspaceId]);
    expect((await outMessages(third.conversation.id)).map((m) => m.text)).toEqual([fr['customer.unavailable']]);
    expect(await db.notification.count({ where: { workspaceId: s.owner.workspaceId, type: 'credits_exhausted' } })).toBe(1);
  });

  it('AT-BIL-04 credits: 80 % notification once per period, `credits.updated` on every debit, monthly conversation quota gate (F-4)', async () => {
    const s = await shop();
    await setCredits(app, s.owner.workspaceId, 5);
    const b = await balanceOf(app, s.owner.workspaceId);
    // plan limit 5000 + a negative adjustment: usage is measured against the plan limit
    expect(b.total).toBe(5);
    await turn(s, newSender(), { text: 'Bonjour, la robe satin ?' });
    const events = (await db.outbox.findMany({ where: { topic: 'ws' } })).map((r) => r.payload as any).filter((p) => p.room === `ws:${s.owner.workspaceId}` && p.event === 'credits.updated');
    expect(events.at(-1)!.payload).toMatchObject({ planLimit: 5000, packBalance: 0, exhausted: false });
    // quota: a plan with 1 conversation per month
    const free = await asOwner(app, 'free');
    const page = await connectedPage(free, app);
    await linkedAgent(free.workspaceId, [page.id]);
    await withLimits(app, free.workspaceId, { maxConversationsPerMonth: 1 });
    const one = await receive(app, page, newSender(), { text: 'Bonjour' });
    expect(await replyJob(app, one.conversation.id)).not.toBeNull();
    const two = await receive(app, page, newSender(), { text: 'Bonjour' });
    await work(app, [free.workspaceId]);
    expect(await replyJob(app, two.conversation.id)).toBeNull();
    expect((await outMessages(two.conversation.id)).map((m) => m.text)).toEqual([fr['customer.unavailable']]);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: two.conversation.id } })).status).toBe('needs_human');
    expect(await db.notification.count({ where: { workspaceId: free.workspaceId, type: 'quota_100' } })).toBeGreaterThan(0);
  });

  it('the reaper closes a run stuck for more than 5 minutes and releases its credits', async () => {
    const s = await shop();
    const route = await textRoute();
    const conv = await receive(app, s.page, newSender(), { text: 'Bonjour' });
    const run = await db.aiRun.create({ data: { workspaceId: s.owner.workspaceId, agentId: s.agent.id, conversationId: conv.conversation.id, kind: 'reply', modelId: route.primaryModelId, providerId: route.primaryModel.providerId, batchKey: 'stuck', startedAt: new Date(Date.now() - 6 * 60_000) } });
    const { CreditService } = await import('../../src/modules/credits/credit.service');
    const { AiRunService } = await import('../../src/modules/ai/ai-run.service');
    await inTenant(app, s.owner.workspaceId, () => app.app.get(CreditService).reserve({ id: run.id, workspaceId: s.owner.workspaceId }, 5));
    expect((await balanceOf(app, s.owner.workspaceId)).reserved).toBe(5);
    expect(await app.app.get(AiRunService).reap()).toBeGreaterThanOrEqual(1);
    expect(await db.aiRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'error', error: 'reaped', flags: ['reaped'] });
    expect((await balanceOf(app, s.owner.workspaceId)).reserved).toBe(0);
    expect(await app.app.get(AiRunService).reap()).toBe(0);
  });

  it('pipeline overhead (everything but the provider) stays far below the 5 s p95 budget', async () => {
    const s = await shop();
    await db.product.createMany({ data: Array.from({ length: 40 }, (_, i) => ({ workspaceId: s.owner.workspaceId, sku: `PERF-${i}`, name: `Produit perf ${i}`, price: 1000 + i, stock: 4, description: 'x'.repeat(200) })) });
    const times: number[] = [];
    for (let i = 0; i < 12; i++) {
      const { conversation } = await receive(app, s.page, newSender(), { text: 'Bonjour, combien la robe satin ?' });
      const t0 = Date.now();
      const r = await runReply(app, conversation.id);
      times.push(Date.now() - t0);
      expect(r!.outcome).toBe('sent');
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
    console.log(`[ai-reply overhead] n=${times.length} p50=${times[Math.floor(times.length / 2)]} ms p95=${p95} ms max=${times.at(-1)} ms (fake provider, 2 model steps + 1 tool)`);
    expect(p95).toBeLessThan(1500);
  });

  it('ConversationService.aiUnavailable is idempotent on a thread already in the queue', async () => {
    const s = await shop();
    const { conversation } = await receive(app, s.page, newSender(), { text: 'Bonjour' });
    const svc = app.app.get(ConversationService);
    await inTenant(app, s.owner.workspaceId, () => svc.aiUnavailable(conversation.id, 'credits', { used: 1, limit: 1 }));
    await inTenant(app, s.owner.workspaceId, () => svc.aiUnavailable(conversation.id, 'credits', { used: 1, limit: 1 }));
    expect(await outMessages(conversation.id)).toHaveLength(1);
  });
});
