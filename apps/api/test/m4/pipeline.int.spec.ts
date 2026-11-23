// M4 — FL-01 steps 6–15 end to end: inbound webhook (fake Meta) → gates → batching → `ai-reply` job → AiRun with tool
// replay → reply through the outbox → credits. AT ids from 13-acceptance-tests.md. The AI adapter is the scriptable fake.
import { formatMoney, getMessages } from '@djaber/shared';
import { RedisService } from '../../src/core/redis/redis.provider';
import { ORDER_TOOLS, type OrderTools } from '../../src/modules/ai/tools/order-tools';
import { GUARD_MARK } from '../../src/modules/ai/ai.constants';
import { AiRunService } from '../../src/modules/ai/ai-run.service';
import { CatalogueService } from '../../src/modules/ai/catalogue.service';
import { RoutingService } from '../../src/modules/ai/routing.service';
import { FORMAT_REMINDER } from '../../src/modules/ai/structured-output';
import { ConversationService } from '../../src/modules/messaging/conversation.service';
import { asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct, image, upload, drain } from '../support/m2';
import { connectedPage, delivery, fakeMeta, forbidNetwork, newSender, postWebhook, receive, reply, work, wsOf } from '../support/m3';
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
    expect(out[1]!.text).toContain('Robe satin bordeaux — 4\u00a0500\u00a0DA');
    expect((out[2]!.payload as any).cards.map((c: any) => c.productId)).toEqual([s.robe.id]);
    // welcome, reply, then the card as a generic template with its « Commander » button (PV 09/11)
    expect(sends(sender).map((c) => c.args.message.kind)).toEqual(['text', 'text', 'generic']);
    expect(sends(sender)[2]!.args.message.elements).toEqual([{ title: 'Robe satin bordeaux', subtitle: formatMoney(4500), buttons: [{ title: 'Commander', payload: `ORDER:${s.robe.id}` }] }]);
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

  it('AT-AI-03 malformed output ⇒ one retry with the format reminder; a loose object is read as it is, a prose answer is salvaged; nothing sendable ⇒ no customer message, insight `error`, `needs_human`, nothing charged', async () => {
    const s = await shop();
    // repaired on the second try (an object cut in the middle; a plain sentence is sent as it is since 23/11 — UX-066)
    fakeAi(app).script('reply', { text: '{"reply": "La robe est à 45' }, { reply: 'La robe est à 4500 DA.', intent: 'INFO' });
    const ok = await turn(s, newSender(), { text: 'prix robe ?' });
    expect(ok.outcome).toBe('sent');
    expect(fakeAi(app).callsOf('reply')[1]!.messages.at(-1)).toMatchObject({ role: 'user', content: FORMAT_REMINDER });
    expect(ok.out.find((m) => m.author === 'ai')!.text).toBe('La robe est à 4\u00a0500\u00a0DA.');

    // tester report 26/10: an object right in substance but not to the letter is read as it is (no retry, no handoff)
    await resetAi();
    fakeAi(app).script('reply', { object: { reply: 'La robe est à 4500 DA.', status: 'ok', intent: 'info', confidence: '0.8', productCards: [s.robe.id], note: 'extra key' } });
    const loose = await turn(s, newSender(), { text: 'prix robe ?' });
    expect(loose.outcome).toBe('sent');
    expect(fakeAi(app).callsOf('reply')).toHaveLength(1);
    expect(loose.runs[0]).toMatchObject({ status: 'ok', intent: 'info' });
    expect(Number(loose.runs[0]!.confidence)).toBe(0.8);
    expect(loose.out.find((m) => m.author === 'ai' && m.type === 'text')!.text).toBe('La robe est à 4\u00a0500\u00a0DA.');

    // prose: the first answer is a plain message to the customer ⇒ it is sent
    await resetAi();
    fakeAi(app).script('reply', { text: 'La robe est à 4500 DA, livraison 48 h.' }, { text: 'Désolé, voici la réponse : la robe est à 4500 DA.' });
    const prose = await turn(s, newSender(), { text: 'prix robe ?' });
    expect(prose.outcome).toBe('sent');
    expect(prose.out.find((m) => m.author === 'ai')!.text).toBe('La robe est à 4\u00a0500\u00a0DA, livraison 48 h.');
    // 23/11 (UX-066): a plain message of a turn with no order tool is sent at once — no format retry, one model call
    expect(fakeAi(app).callsOf('reply')).toHaveLength(1);
    expect(prose.conversation).toMatchObject({ status: 'active', aiPaused: false });

    // nothing that can be sent, twice, then nothing in the plain-text step either (journey retest R11-5) ⇒ FL-01 F-6
    await resetAi();
    fakeAi(app).script('reply', { text: '' }, { object: { note: 'no reply field' } }, { text: '' });
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
    expect(await debits(s.owner.workspaceId)).toHaveLength(3); // only the turns that sent a reply were charged
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
    expect(back.out.at(-1)).toMatchObject({ author: 'ai', text: 'La robe est à 4\u00a0500\u00a0DA.' });
  });

  it('R23 (Boutique de Lalla 20/11): a reply saved after the next message arrived is history for that message — no second greeting', async () => {
    const s = await shop();
    const sender = newSender();
    fakeAi(app).script('reply', { reply: 'وعليكم السلام، واش تحب تلقى اليوم؟', intent: 'INFO' });
    expect((await turn(s, sender, { text: 'السلام عليكم' })).outcome).toBe('sent');
    await resetAi();
    // the second message came in while the first reply was being written: the reply is saved after it
    const { conversation } = await receive(app, s.page, sender, { text: 'كيف يمكنني' });
    const second = await db.message.findFirstOrThrow({ where: { conversationId: conversation.id, author: 'customer' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    await db.message.updateMany({ where: { conversationId: conversation.id, author: 'ai' }, data: { createdAt: new Date(second.createdAt.getTime() + 2000) } });
    fakeAi(app).script('reply', { reply: 'وعليكم السلام ورحمة الله، يسعدني مساعدتك.', intent: 'INFO' });
    expect((await answer(app, s.owner.workspaceId, conversation.id))?.outcome).toBe('sent');
    const [call] = fakeAi(app).callsOf('reply');
    expect(JSON.stringify(call!.messages)).toContain('واش تحب تلقى اليوم');
    // the model saw it had answered: the repeated greeting is removed by the guard
    const texts = (await aiMessages(conversation.id)).map((m) => m.text);
    expect(texts).toHaveLength(2);
    expect(texts.filter((t) => t !== 'وعليكم السلام، واش تحب تلقى اليوم؟')).toEqual([expect.not.stringMatching(/^وعليكم السلام/u)]);
  });

  it('tester report 22/10 / full-test 15/11 AI-CHAT-02: in a long thread the format-reminder retry keeps only the last 8 messages (and offers no tool), so the answer still goes out', async () => {
    const s = await shop();
    const sender = newSender();
    for (const text of ['bonjour', 'vous avez des robes ?', 'et des sacs ?', 'en noir ?', 'et en rouge ?', 'merci']) {
      fakeAi(app).script('reply', { reply: `Réponse à « ${text} »`, intent: 'INFO' });
      expect((await turn(s, sender, { text })).outcome).toBe('sent');
      await resetAi();
    }
    // the model answers in a broken shape, then wraps its answer once reminded (a plain sentence is sent as it is since 23/11)
    fakeAi(app).script('reply', { text: '{"reply": "La robe est à 45' }, { reply: 'La robe est à 4500 DA.', intent: 'INFO' });
    const t = await turn(s, sender, { text: 'prix robe ?' });
    expect(t.outcome).toBe('sent');
    const [first, retry] = fakeAi(app).callsOf('reply');
    expect(first!.messages.length).toBeGreaterThan(3); // the thread so far
    expect(first!.messages).toHaveLength(13); // 6 turns + the batch
    expect(retry!.messages).toHaveLength(11); // the last 8 + the batch + its answer + the reminder
    expect(retry!.messages.slice(0, 8)).toEqual(first!.messages.slice(4, 12));
    expect(String((retry!.messages[8] as { content: unknown }).content)).toContain('prix robe ?');
    expect(retry!.messages[9]).toMatchObject({ role: 'assistant', content: '{"reply": "La robe est à 45' });
    expect(retry!.messages[10]).toMatchObject({ role: 'user', content: FORMAT_REMINDER });
    expect(retry!.tools).toBeUndefined();
    expect(t.out.at(-1)).toMatchObject({ author: 'ai', text: 'La robe est à 4\u00a0500\u00a0DA.' });
    expect(t.conversation).toMatchObject({ status: 'active', aiPaused: false });
  });

  it('AT-AI-11 product card template is part of the prompt; the cards are still sent', async () => {
    const s = await shop({ productCardTemplate: '⭐ {name} à {price} DA — {stock} en stock' });
    fakeAi(app).script('reply', { reply: '⭐ Robe satin bordeaux à 4500 DA — disponible en stock', intent: 'SALE', productCards: [s.robe.id, s.sac.id] });
    const t = await turn(s, newSender(), { text: 'la robe ?' });
    expect(fakeAi(app).callsOf('reply')[0]!.system).toContain('When presenting a product use this template: ⭐ {name} à {price} DA — {stock} en stock');
    expect(t.out.find((m) => m.author === 'ai' && m.type === 'text')!.text).toBe('⭐ Robe satin bordeaux à 4\u00a0500\u00a0DA — disponible en stock');
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
      { toolCalls: [{ name: 'search_products', args: { query: 'veste' } }, { name: 'get_product', args: { productId: archived.id } }, { name: 'create_order', args: { clientName: 'Amine Benali', clientPhone: '0555123456', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'Cité des 200 logements, Alger', items: [{ productId: archived.id, quantity: 1 }], customerConfirmed: true } }] },
      { reply: "Cette veste n'est plus disponible.", intent: 'INFO', productCards: [archived.id, inactive.id, s.robe.id] },
    );
    // journey 16/11 J05-9: the phone is in the customer's message (an unknown phone is asked for before the product check);
    // journey retest R2-4: so is the commune (a wilaya the customer never named is asked for first too)
    const t = await turn(s, newSender(), { text: 'je veux la veste, Amine Benali 0555123456, Bab Ezzouar, Cité des 200 logements' });
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
    // journey retest R15-3 (18/11): the stop-desk quote of Oran, quoted this turn, is answered from the first quote (`stopdeskFee`)
    // without running — it is no stored tool call, the model gets the answer
    expect(r).toHaveLength(4);
    const answered = (fakeAi(app).callsOf('reply')[1]!.messages as { role: string; result?: unknown }[]).filter((m) => m.role === 'tool').at(-1);
    expect(answered?.result).toMatchObject({ ok: true, isStopdesk: true, fee: 450, repeated: true });
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
    const base = { clientName: 'Amine Benali', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'Cité des 200 logements, Bt 4, Alger', items: [{ productId: s.robe.id, quantity: 1 }], customerConfirmed: true };
    fakeAi(app).script(
      'reply',
      { toolCalls: [{ name: 'create_order', args: { ...base, clientPhone: '12345' } }] },
      { toolCalls: [{ name: 'create_order', args: { ...base, clientPhone: '0555 12 34 56', customerConfirmed: false } }, { name: 'create_order', args: { ...base, clientPhone: '0555 12 34 56', address: 'court' } }] },
      { toolCalls: [{ name: 'create_order', args: { ...base, clientPhone: '0555 12 34 56' } }] },
      { reply: 'Je transmets votre commande à un conseiller.', status: 'OK', intent: 'SALE' },
    );
    const sender = newSender();
    const details = await turn(s, sender, { text: 'Amine Benali, 0555 12 34 56, Bab Ezzouar, Cité des 200 logements' });
    const r0 = details.runs[0]!.toolCalls.sort((a, b) => a.executedAt!.getTime() - b.executedAt!.getTime()).map((c) => c.result as any);
    expect(r0[0]).toEqual({ ok: false, error: { code: 'VALIDATION', field: 'clientPhone', example: '0555123456' } });
    // (journey re-run J03r-1: the order limit is now a server hand-off that ends the turn — checked on its own conversation below)
    expect(r0.filter((x) => x.error?.field === 'address')).toHaveLength(1);
    // full-test 15/11 AI-CHAT-01: a valid cart is never ordered in the turn that prepares it — the server's recap comes back;
    // journey retest R2-4: once it came back, create_order is not offered again in the turn (the 3rd step's call is not run)
    expect(r0.filter((x) => x.error?.code === 'CONFIRMATION_REQUIRED')).toHaveLength(1);
    expect(r0).toHaveLength(3);
    expect(r0.find((x) => x.error?.code === 'CONFIRMATION_REQUIRED')).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: expect.any(String) }, recap: { subtotal: 4500, deliveryFee: 400, total: 4900, clientPhone: '0555123456', wilaya: expect.any(String), items: [{ name: 'Robe satin bordeaux', quantity: 1, unitPrice: 4500 }] } });
    expect(create).not.toHaveBeenCalled();
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ name: 'create_order', args: { ...base, clientPhone: '0555 12 34 56' } }] }, { reply: 'Commande enregistrée.', status: 'OK', intent: 'SALE' });
    const t = await turn(s, sender, { text: 'نعم' });
    const r = t.runs.at(-1)!.toolCalls.map((c) => c.result as any);
    // the validated request handed to the orders port (bound to the orders module since M5)
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![1]).toMatchObject({ clientPhone: '0555123456', wilayaId: 16, subtotal: 4500, deliveryFee: 400, total: 4900, items: [{ productId: s.robe.id, quantity: 1, unitPrice: 4500, name: 'Robe satin bordeaux' }] });
    expect(create.mock.calls[0]![0]).toMatchObject({ runId: t.runs.at(-1)!.id, conversationId: t.conversationId, agentId: s.agent.id });
    // M5: the orders module creates the order; the thread stays with the AI
    expect(r.at(-1)).toMatchObject({ ok: true, number: 'CMD-1001', total: 4900, duplicateOf: null });
    expect(t.conversation.status).toBe('active');
    expect(t.runs.at(-1)).toMatchObject({ status: 'ok', creditsCharged: 1 });
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(1);
    expect((await debits(s.owner.workspaceId)).map((d) => [d.action, d.credits])).toEqual([['text_reply', -1], ['text_reply', -1]]);
    // limits (journey re-run J03r-1): 4 robes with max 3 ⇒ `order_limit` (which limit, the quantity) and the server's hand-off — no order,
    // no second create_order with a lower quantity, the limit sentence
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ name: 'create_order', args: { ...base, clientPhone: '0555 12 34 56', items: [{ productId: s.robe.id, quantity: 4 }] } }, { name: 'create_order', args: { ...base, clientPhone: '0555 12 34 56', items: [{ productId: s.robe.id, quantity: 3 }] } }] }, { reply: 'Voici le récapitulatif …', intent: 'SALE' });
    const over = await turn(s, newSender(), { text: 'Amine Benali, 0555 12 34 56, Bab Ezzouar, Cité des 200 logements' });
    const ro = over.runs.at(-1)!.toolCalls.map((c) => c.result as any);
    expect(ro).toEqual([{ ok: false, hint: 'order_limit', limit: 'quantity', maxQty: 3, maxAmount: null, quantity: 4, total: 18_400, say: expect.any(String) }]);
    expect(over.conversation.status).toBe('needs_human');
    expect(create).toHaveBeenCalledTimes(1);
    create.mockRestore();
  });

  it('Houssem live 23/11: the customer writes again before answering the recap and the model answers nothing ⇒ the recap goes again, never silence', async () => {
    const s = await shop();
    await feeRule(s.owner.workspaceId, 16, 400, 300);
    const call = { name: 'create_order', args: { clientName: 'Amine Benali', clientPhone: '0555123456', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'Cité des 200 logements, Alger', items: [{ productId: s.robe.id, quantity: 1 }], customerConfirmed: true } };
    const sender = newSender();
    fakeAi(app).script('reply', { toolCalls: [call] }, { reply: 'Voici le récapitulatif :', intent: 'SALE' });
    await turn(s, sender, { text: 'Amine Benali, 0555123456, Bab Ezzouar, Cité des 200 logements' });
    await resetAi();
    // the same details again: create_order holds the order (CONFIRMATION_REQUIRED) and the model writes nothing
    fakeAi(app).script('reply', { toolCalls: [{ ...call, id: 'call_b', args: { ...call.args, customerConfirmed: false } }] }, { reply: '', intent: 'SALE' }, { reply: '', intent: 'SALE' }, { reply: '', intent: 'SALE' });
    const t = await turn(s, sender, { text: 'lancé la commande' });
    const texts = t.out.filter((m) => m.author === 'ai' && m.type === 'text').map((m) => m.text ?? '');
    expect(texts.at(-1)).toContain('Robe satin bordeaux');
  });

  it('Houssem live 23/11: a recap shown earlier is sent again when the customer asks for it after another exchange (it was only described « au-dessus »)', async () => {
    const s = await shop();
    await feeRule(s.owner.workspaceId, 16, 400, 300);
    const call = { name: 'create_order', args: { clientName: 'Amine Benali', clientPhone: '0555123456', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'Cité des 200 logements, Alger', items: [{ productId: s.robe.id, quantity: 1 }], customerConfirmed: true } };
    const sender = newSender();
    fakeAi(app).script('reply', { toolCalls: [call] }, { reply: 'Voici le récapitulatif :', intent: 'SALE' });
    await turn(s, sender, { text: 'Amine Benali, 0555123456, Bab Ezzouar, Cité des 200 logements' });
    await resetAi();
    fakeAi(app).script('reply', { reply: 'Le paiement se fait à la livraison.', intent: 'INFO' });
    await turn(s, sender, { text: 'je paie comment ?' });
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ ...call, id: 'call_c', args: { ...call.args, customerConfirmed: false } }] }, { reply: 'Le voici.', intent: 'SALE' }, { reply: 'Le voici.', intent: 'SALE' });
    const t = await turn(s, sender, { text: 'donne moi le recap avant de passer la commande' });
    const last = t.out.filter((m) => m.author === 'ai' && m.type === 'text').at(-1)?.text ?? '';
    expect(last).toContain('Robe satin bordeaux');
    expect(last).toMatch(/oui/);
  });

  it('AT-AI-05 the job crashes after `create_order` ran, before the send ⇒ the retry replays the stored tool result: the tool runs once, one reply, one debit', async () => {
    const s = await shop();
    await feeRule(s.owner.workspaceId, 16, 400, 300);
    const port = app.app.get<OrderTools>(ORDER_TOOLS);
    const create = jest.spyOn(port, 'createOrder').mockResolvedValue({ ok: true, orderId: 'o-1', number: 'CMD-1042', subtotal: 4500, deliveryFee: 400, total: 4900, items: [], duplicateOf: null, paymentOptions: ['cod'] });
    const call = { name: 'create_order', args: { clientName: 'Amine Benali', clientPhone: '0555123456', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'Cité des 200 logements, Alger', items: [{ productId: s.robe.id, quantity: 1 }], customerConfirmed: true } };
    const sender = newSender();
    // full-test 15/11 AI-CHAT-01: the recap is shown in an earlier turn
    fakeAi(app).script('reply', { toolCalls: [call] }, { reply: 'Récapitulatif … Vous confirmez ?', intent: 'SALE' });
    await turn(s, sender, { text: 'Amine Benali, 0555123456, Bab Ezzouar, Cité des 200 logements' });
    await resetAi();
    const debitsBefore = (await debits(s.owner.workspaceId)).length;
    const { conversation } = await receive(app, s.page, sender, { text: 'oui je confirme' });
    // attempt 1: the tool runs, then the job crashes before the send ⇒ the job throws (BullMQ will retry it)
    // journey retest R19-1 (18/11): a plain yes to the recap shown is placed by the server with no model call — the crash is the run's closing
    const runs = app.app.get(AiRunService);
    const finish = jest.spyOn(runs, 'finish').mockRejectedValueOnce(new Error('crash before the send'));
    fakeAi(app).script('reply', { toolCalls: [{ ...call, id: 'call_a' }] }, { error: 'provider_error' }, { error: 'provider_error' });
    const data = (await replyJob(app, conversation.id))!.data as never;
    await expect(runReply(app, conversation.id, { attempt: 1, attempts: 3 })).rejects.toThrow(/crash before the send/);
    finish.mockRestore();
    expect(create).toHaveBeenCalledTimes(1);
    expect(fakeAi(app).callsOf('reply')).toHaveLength(0);
    const outBefore = (await outMessages(conversation.id)).length;
    expect((await runsOf(conversation.id)).at(-1)).toMatchObject({ status: 'running', attempt: 1 });
    expect((await balanceOf(app, s.owner.workspaceId)).reserved).toBe(1); // the reservation waits for the retry

    // attempt 2: the same yes places the same stored order ⇒ the stored result, no execution, no model call
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ ...call, id: 'call_b' }] }, { reply: 'Votre commande CMD-1042 est enregistrée. Total : 4900 DA.', intent: 'SALE' });
    const second = await runReply(app, conversation.id, { attempt: 2, attempts: 3, data });
    await work(app, [s.owner.workspaceId]);
    expect(second!.outcome).toBe('sent');
    expect(create).toHaveBeenCalledTimes(1);
    expect(fakeAi(app).callsOf('reply')).toHaveLength(0);
    const run = (await runsOf(conversation.id)).at(-1);
    expect(run).toMatchObject({ status: 'ok', attempt: 2, creditsCharged: 1, toolCallCount: 1 });
    expect(run!.toolCalls).toHaveLength(1);
    // full-test 15/11 proposal 4: the customer gets the server's confirmation built from the create_order result
    expect((await aiMessages(conversation.id)).map((m) => m.text).at(-1)).toBe(['Votre commande CMD-1042 est bien enregistrée ✅', 'Livraison : 400 DA', 'Total : 4 900 DA, à payer à la livraison.', 'Délai de livraison : 2 à 5 jours.', 'Merci pour votre confiance !'].join('\n'));
    expect((await outMessages(conversation.id)).length).toBeGreaterThan(outBefore);
    expect(sends(sender).filter((c) => String(c.args.message.text).includes('CMD-1042'))).toHaveLength(1);
    expect(await debits(s.owner.workspaceId)).toHaveLength(debitsBefore + 1);

    // full-test 15/11 proposal 4: the same content in a later turn of this conversation is refused by the server
    // (ORDER_ALREADY_PLACED with the number) — the port is not called again
    create.mockResolvedValue({ ok: true, orderId: 'o-1', number: 'CMD-1042', total: 4900, duplicateOf: 'CMD-1042' });
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [call] }, { reply: 'Votre commande CMD-1042 est déjà enregistrée.', intent: 'SALE' });
    const again = await turn(s, sender, { text: 'oui je confirme' });
    expect(again.runs.at(-1)!.toolCalls[0]!.result).toMatchObject({ ok: false, error: { code: 'ORDER_ALREADY_PLACED', number: 'CMD-1042' } });
    expect(create).toHaveBeenCalledTimes(1);
    // AT-AI-06 (order rule itself: M5) — an existing order returned by the port reaches the model untouched
    // (another conversation: recap in a first turn, the customer's yes in the next one)
    const other = newSender();
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [call] }, { reply: 'Récapitulatif … Vous confirmez ?', intent: 'SALE' });
    await turn(s, other, { text: 'Amine Benali, 0555123456, Bab Ezzouar, Cité des 200 logements' });
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [call] }, { reply: 'Votre commande CMD-1042 est déjà enregistrée.', intent: 'SALE' });
    const dup = await turn(s, other, { text: 'oui je confirme' });
    expect(create).toHaveBeenCalledTimes(2);
    expect((dup.runs.at(-1)!.toolCalls[0]!.result as any).duplicateOf).toBe('CMD-1042');
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
    fakeAi(app).script('reply', { toolCalls: [{ name: 'cancel_order', args: { orderNumber: 'CMD-2001', customerConfirmed: true, reason: 'changed mind' } }] }, { reply: 'Je transmets à un conseiller.', status: 'HANDOFF', statusDetail: 'customer_request', evidence: 'oui annulez la', intent: 'OTHER' });
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
    expect(orders).toEqual([expect.objectContaining({ number: 'CMD-3001', status: 'shipped', deliveryStatus: 'in_transit', courier: 'zrexpress', trackingNumber: 'ZR-778', trackingUrl: expect.stringMatching(new RegExp(`/s/tok-${order.id}$`)), lastEvent: expect.objectContaining({ label: 'Colis au centre de tri Alger' }), total: 4900 })]);
    expect(found.out.at(-1)!.text).toContain('CMD-3001');
  });

  it('PV 28/10 « tracking via le chatbot »: an order taken by phone is found with the customer\'s phone, or with the phone / tracking number they give (without its amount); an invalid phone is re-asked', async () => {
    const s = await shop();
    const ws = s.owner.workspaceId;
    const sender = newSender();
    const first = await turn(s, sender, { text: 'Bonjour' });
    // the customer gave this phone earlier in the chat (A4 context); the shop took an order for it by phone (its own client row)
    await db.conversation.update({ where: { id: first.conversationId }, data: { context: { ...((first.conversation.context as object | null) ?? {}), customer: { phone: '0550 11 12 22' } } } });
    const byPhoneClient = await db.client.create({ data: { workspaceId: ws, name: 'Commande téléphone', phone: '0550111222' } });
    await db.order.create({ data: { workspaceId: ws, number: 'CMD-4001', clientId: byPhoneClient.id, source: 'manual', clientName: 'Commande téléphone', clientPhone: '0550111222', subtotal: 6200, total: 6600, status: 'confirmed' } });
    // another person's parcel (the customer types its phone or its tracking number)
    const other = await db.client.create({ data: { workspaceId: ws, name: 'Sœur', phone: '0660123123' } });
    const o2 = await db.order.create({ data: { workspaceId: ws, number: 'CMD-4002', clientId: other.id, source: 'manual', clientName: 'Sœur', clientPhone: '0660123123', subtotal: 4500, total: 4900, status: 'shipped', deliveryStatus: 'in_transit' } });
    await db.shipment.create({ data: { workspaceId: ws, orderId: o2.id, provider: 'yalidine', status: 'in_transit', trackingNumber: 'YAL-90210', publicTrackingToken: `tok-${o2.id}`, codAmount: 4900 } });
    // a stranger's order is never listed without its phone or tracking number
    const stranger = await db.client.create({ data: { workspaceId: ws, name: 'Inconnu', phone: '0770999999' } });
    await db.order.create({ data: { workspaceId: ws, number: 'CMD-4003', clientId: stranger.id, source: 'manual', clientName: 'Inconnu', clientPhone: '0770999999', subtotal: 1, total: 1 } });

    await resetAi();
    fakeAi(app).script(
      'reply',
      { toolCalls: [{ name: 'lookup_order', args: {} }, { name: 'lookup_order', args: { phone: '0660 12 31 23' } }, { name: 'lookup_order', args: { trackingNumber: 'yal-90210' } }, { name: 'lookup_order', args: { phone: '12345' } }] },
      { reply: 'Voici vos commandes.', status: 'OK', intent: 'TRACKING' },
    );
    const t = await turn(s, sender, { text: 'où en sont mes commandes ?' });
    const calls = t.runs.at(-1)!.toolCalls.sort((a, b) => a.executedAt!.getTime() - b.executedAt!.getTime());
    const [mine, phone, tracking, invalid] = calls.map((c) => c.result as any);
    expect(mine.orders).toEqual([expect.objectContaining({ number: 'CMD-4001', status: 'confirmed', total: 6600 })]);
    const parcel = { number: 'CMD-4002', status: 'shipped', deliveryStatus: 'in_transit', courier: 'yalidine', trackingNumber: 'YAL-90210', trackingUrl: expect.stringMatching(new RegExp(`/s/tok-${o2.id}$`)) };
    expect(phone.orders).toEqual([expect.objectContaining(parcel)]);
    expect(tracking.orders).toEqual([expect.objectContaining(parcel)]);
    // someone else's order: never its amount
    expect(phone.orders[0]).not.toHaveProperty('total');
    expect(tracking.orders[0]).not.toHaveProperty('total');
    expect(JSON.stringify([mine, phone, tracking])).not.toContain('CMD-4003');
    expect(invalid).toEqual({ ok: false, error: { code: 'VALIDATION', field: 'phone', example: '0555123456' } });
    expect(fakeAi(app).callsOf('reply').at(-1)!.system).toContain('Where is my order / tracking: call lookup_order');
  });
});

describe('product cards on Messenger (PV 09/11)', () => {
  it('a card is a generic template with « Commander » and « Plus de photos »; « Plus de photos » sends every approved picture as a gallery; a button tap names its product; buttons in the conversation language', async () => {
    const s = await shop();
    for (const n of ['a', 'b', 'c']) await upload(s.owner, app, `/products/${s.robe.id}/images`, 'file', [{ buffer: await image(800, 800), name: `${n}.jpg`, type: 'image/jpeg' }]).expect(201);
    await s.owner.post(`/products/${s.robe.id}/submit-changes`, {}).expect(200);
    await drain(app, s.owner.workspaceId);
    const sender = newSender();
    fakeAi(app).script('reply', { reply: 'Voici la robe.', status: 'OK', intent: 'SALE', productCards: [s.robe.id] });
    await turn(s, sender, { text: 'la robe satin svp' });
    const card = sends(sender).find((c) => c.args.message.kind === 'generic')!.args.message.elements[0];
    expect(card).toMatchObject({ title: 'Robe satin bordeaux', subtitle: formatMoney(4500), imageUrl: expect.any(String), buttons: [{ title: 'Commander', payload: `ORDER:${s.robe.id}` }, { title: 'Plus de photos', payload: `PHOTOS:${s.robe.id}` }] });

    // the customer taps « Plus de photos »: the message names the product, the 3 pictures go as one carousel
    await resetAi();
    // Houssem L28 (23/11): the model also names the product as a card — it goes once, as its gallery (its first photo went out twice)
    fakeAi(app).script('reply', { reply: 'Voici toutes les photos.', status: 'OK', intent: 'SALE', productCards: [s.robe.id] });
    const tap = (payload: string, title: string) => ({ sender: { id: sender }, recipient: { id: s.page.externalId }, timestamp: Date.now(), postback: { mid: `m_${Math.random().toString(36).slice(2)}`, title, payload } });
    await postWebhook(app, delivery(s.page, [tap(`PHOTOS:${s.robe.id}`, 'Plus de photos')])).expect(200);
    await work(app, [s.owner.workspaceId]);
    const conv = await db.conversation.findFirstOrThrow({ where: { channelId: s.page.id, externalSenderId: sender } });
    const asked = await db.message.findFirstOrThrow({ where: { conversationId: conv.id, type: 'postback' }, orderBy: { createdAt: 'desc' } });
    expect(asked.text).toBe('Plus de photos · Robe satin bordeaux');
    await answer(app, s.owner.workspaceId, conv.id);
    const gallery = (await outMessages(conv.id)).filter((m) => m.type === 'product_cards').at(-1)!;
    expect((await outMessages(conv.id)).filter((m) => m.type === 'product_cards' && m.createdAt >= asked.createdAt)).toHaveLength(1);
    expect(gallery.payload).toMatchObject({ gallery: true, locale: 'fr', cards: [{ photo: { n: 1, total: 3 } }, { photo: { n: 2, total: 3 } }, { photo: { n: 3, total: 3 } }] });
    const carousel = sends(sender).filter((c) => c.args.message.kind === 'generic').at(-1)!.args.message.elements;
    expect(carousel).toHaveLength(3);
    expect(carousel[1]).toMatchObject({ subtitle: `Photo 2/3 · ${formatMoney(4500)}`, buttons: [{ title: 'Commander', payload: `ORDER:${s.robe.id}` }] });
    expect(new Set(carousel.map((e: any) => e.imageUrl)).size).toBe(3);

    // « Commander »: the AI reads which product; in Arabic the buttons are Arabic
    await resetAi();
    await postWebhook(app, delivery(s.page, [tap(`ORDER:${s.robe.id}`, 'Commander')])).expect(200);
    await work(app, [s.owner.workspaceId]);
    expect((await db.message.findFirstOrThrow({ where: { conversationId: conv.id, type: 'postback' }, orderBy: { createdAt: 'desc' } })).text).toBe('Commander · Robe satin bordeaux');
    await answer(app, s.owner.workspaceId, conv.id);
    const arabic = newSender();
    fakeAi(app).script('reply', { reply: 'هذي هي', status: 'OK', intent: 'SALE', productCards: [s.robe.id] });
    await turn(s, arabic, { text: 'بشحال الروب ساتان؟' });
    expect(sends(arabic).find((c) => c.args.message.kind === 'generic')!.args.message.elements[0].buttons.map((b: any) => b.title)).toEqual(['اطلب الآن', 'صور أخرى']);
  });
});

describe('handoff, insights, safety', () => {
  it('AT-AI-10 a refund request ⇒ HANDOFF: reply, workspace `handoff` text once per episode, `needs_human`, insight, notification; after a resume, a new handoff sends it again (tester notes 25/10)', async () => {
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
    // the prompt carries the shop's handoff text: the model does not announce the handoff itself
    expect(fakeAi(app).callsOf('reply')[0]!.system).toContain(`HANDOFF_MESSAGE: "${handoffText}"`);
    // resumed by a member, the customer asks again ⇒ a new episode: handoff again, with the (edited) handoff text again
    await db.workspace.update({ where: { id: s.owner.workspaceId }, data: { systemMessages: { handoff: { fr: 'Un conseiller de la boutique vous répond (texte modifié).' } } } });
    await s.owner.patch(`/conversations/${t.conversationId}`, { aiPaused: false, version: (await db.conversation.findUniqueOrThrow({ where: { id: t.conversationId } })).version }).expect(200);
    const again = await turn(s, sender, { text: 'remboursement svp' });
    expect(again.conversation.status).toBe('needs_human');
    expect(again.out.filter((m) => m.text === handoffText)).toHaveLength(1);
    expect(again.out.filter((m) => m.text === 'Un conseiller de la boutique vous répond (texte modifié).')).toHaveLength(1);
  });

  it('retest 12/11: a thread the AI handed off comes back to the AI — a greeting at once, any message after 30 min of team silence; asked-for handoffs wait the delay, member replies keep it', async () => {
    const s = await shop();
    const sender = newSender();
    fakeAi(app).script('reply', { reply: '', status: 'HANDOFF', statusDetail: 'off_catalogue', evidence: 'prix de gros', intent: 'OTHER' });
    const t = await turn(s, sender, { text: 'vous faites des prix de gros ?' });
    expect(t.conversation).toMatchObject({ status: 'needs_human', aiPaused: true });
    // anything but a greeting right away stays with the team …
    await receive(app, s.page, sender, { text: 'allo ?' });
    expect(await replyJob(app, t.conversationId)).toBeNull();
    // … a greeting is a new conversation: the AI answers it, the thread shows « IA reprise »
    // (in the customer's arabizi: a French answer would be a `language_switch` for the reply guard, full-test 15/11 AI-CHAT-04)
    fakeAi(app).script('reply', { reply: 'Salam! Kifach n9der n3awnek?', intent: 'GREETING' });
    const back = await turn(s, sender, { text: 'Salam alikoum 👋' });
    expect(back.conversation).toMatchObject({ status: 'active', aiPaused: false });
    expect((back.conversation.context as any).handoffReason).toBeNull();
    expect(back.out.at(-1)).toMatchObject({ author: 'ai', text: 'Salam! Kifach n9der n3awnek?' });
    expect(back.out.some((m) => (m.payload as any)?.system?.kind === 'ai_resumed')).toBe(true);
    // the model reads the greeting as a fresh start, not the earlier trouble (RESUMED note on the message it answers)
    expect(String((fakeAi(app).callsOf('reply').at(-1)!.messages.at(-1) as { content?: unknown }).content)).toContain('[BACK TO YOU');
    // a handoff quoting a greeting is refused by the platform: the AI answers and keeps the thread (retest 12/11)
    fakeAi(app).script('reply', { reply: '', status: 'HANDOFF', statusDetail: 'customer_request', evidence: 'salam', intent: 'OTHER' }, { reply: 'Je vous écoute.', intent: 'GREETING' });
    const hello = await turn(s, sender, { text: 'salam' });
    expect(hello.conversation).toMatchObject({ status: 'active', aiPaused: false });
    expect(hello.runs.at(-1)).toMatchObject({ status: 'ok', flags: ['handoff_refused'] });
    expect(hello.out.at(-1)).toMatchObject({ author: 'ai', text: 'Je vous écoute.' });

    // the customer asked for the team: a greeting does not undo it, 30 min without an answer does
    const asked = newSender();
    fakeAi(app).script('reply', { reply: '', status: 'HANDOFF', statusDetail: 'customer_request', evidence: 'parler à un conseiller', intent: 'OTHER' });
    const a = await turn(s, asked, { text: 'je veux parler à un conseiller' });
    await receive(app, s.page, asked, { text: 'bonjour' });
    expect(await replyJob(app, a.conversationId)).toBeNull();
    const ctx = (await db.conversation.findUniqueOrThrow({ where: { id: a.conversationId } })).context as any;
    await db.conversation.update({ where: { id: a.conversationId }, data: { context: { ...ctx, handoffAt: new Date(Date.now() - 31 * 60_000).toISOString() } } });
    fakeAi(app).script('reply', { reply: 'Un conseiller va vous répondre, puis-je vous aider en attendant ?', intent: 'OTHER' });
    expect((await turn(s, asked, { text: 'toujours là ?' })).conversation).toMatchObject({ status: 'active', aiPaused: false });

    // a member answered after the handoff: the thread stays with the team whatever the customer writes
    const kept = newSender();
    fakeAi(app).script('reply', { reply: '', status: 'HANDOFF', statusDetail: 'off_catalogue', evidence: 'prix de gros', intent: 'OTHER' });
    const k = await turn(s, kept, { text: 'prix de gros ?' });
    await reply(s.owner, k.conversationId, { text: 'Je regarde pour vous' }).expect(201);
    await receive(app, s.page, kept, { text: 'salam' });
    expect(await replyJob(app, k.conversationId)).toBeNull();
    expect((await db.conversation.findUniqueOrThrow({ where: { id: k.conversationId } })).status).toBe('needs_human');
  });

  it('UNCLEAR ⇒ insight only; 3 unclear turns in a row ⇒ handoff; UNKNOWN ⇒ reply sent, insight, the AI keeps the conversation (PV 08/11)', async () => {
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
    // PV 08/11: a question without an answer no longer hands the thread over (the AI used to go silent after it)
    expect(unknown.conversation).toMatchObject({ status: 'active', aiPaused: false });
    expect(unknown.out.map((m) => m.author)).toEqual(['system', 'ai']); // welcome + the reply; no handoff text
    expect((await insightsOf(unknown.conversationId)).map((i) => [i.type, i.detail])).toEqual([['unknown_topic', 'off_catalogue']]);
    expect(unknown.runs[0]!.meta).toMatchObject({ handoff: false });
    // the next message of that customer is answered by the AI
    const next = await turn(s, (await db.conversation.findUniqueOrThrow({ where: { id: unknown.conversationId } })).externalSenderId, { text: 'Bonjour, combien la robe satin ?' });
    expect(next.outcome).toBe('sent');
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

  it('04-ai §4.3 reply guard: an invented price ⇒ one corrective turn without tools, the rewrite is sent with the cards; still wrong ⇒ the sentence is dropped; recorded on the run (meta.guard, flags); 1 credit, no handoff', async () => {
    const s = await shop();
    fakeAi(app).script('reply', { reply: 'La robe est à 3900 DA.', intent: 'SALE', productCards: [s.robe.id] }, { reply: 'La robe est à 4500 DA.', intent: 'SALE' });
    const t = await turn(s, newSender(), { text: 'prix robe ?' });
    expect(t.outcome).toBe('sent');
    const calls = fakeAi(app).callsOf('reply');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.tools).toBeUndefined();
    expect(String((calls[1]!.messages.at(-1) as { content?: unknown }).content)).toContain(GUARD_MARK);
    expect(t.out.find((m) => m.author === 'ai' && m.type === 'text')!.text).toBe('La robe est à 4\u00a0500\u00a0DA.');
    expect(t.out.some((m) => m.type === 'product_cards')).toBe(true);
    expect(t.runs[0]!.flags).toContain('guard_rewritten');
    expect((t.runs[0]!.meta as any).guard).toEqual({ violations: [{ rule: 'unknown_amount', value: 3900 }], retried: true, remaining: [], action: 'rewritten' });
    expect(t.conversation).toMatchObject({ status: 'active', aiPaused: false });
    expect(await debits(s.owner.workspaceId)).toHaveLength(1);

    await resetAi();
    fakeAi(app).script('reply', { reply: 'Oui, elle est disponible. Il en reste 2.', intent: 'SALE' }, { reply: 'Oui, elle est disponible. Il en reste 2 pièces.', intent: 'SALE' });
    const kept = await turn(s, newSender(), { text: 'la robe est dispo ?' });
    expect(kept.out.find((m) => m.author === 'ai' && m.type === 'text')!.text).toBe('Oui, elle est disponible. Robe satin bordeaux : 4\u00a0500\u00a0DA.'); // journey retest R18-2 (R19-3: formatMoney): the price of the product named, not told yet
    expect(kept.runs[0]!.flags).toContain('guard_enforced');
    expect((kept.runs[0]!.meta as any).guard).toMatchObject({ retried: true, action: 'stripped', remaining: [{ rule: 'stock_count', value: 2 }] });
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
    // the form's « Enregistrer » sends the new picture to moderation (approved at once here): only then is it shown / compared
    await s.owner.post(`/products/${s.robe.id}/submit-changes`, {}).expect(200);
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

    // a photo no catalogue word describes: still compared with the shop's pictured products (PV 28/10), no match ⇒
    // confirmation question, no price, no card; pass 2 ran ⇒ 5 credits
    await resetAi();
    fakeAi(app).script('vision_describe', { object: { category: 'voiture', colors: [], text: '', description: 'voiture rouge', multipleProducts: false, quality: 'ok' } });
    const unknown = await turn(s, newSender(), photo);
    const question = unknown.out.find((m) => m.author === 'ai')!;
    expect(question.text).toBe('Pouvez-vous me confirmer de quel produit il s\'agit ?');
    expect(question.text).not.toMatch(/\d+\s*DA/);
    expect(unknown.out.some((m) => m.type === 'product_cards')).toBe(false);
    expect(fakeAi(app).callsOf('vision_match')).toHaveLength(1);
    expect(unknown.runs[0]).toMatchObject({ status: 'ok', creditsCharged: 5 });
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

  it('PV 28/10 « l\'agent IA ne reconnaît pas les photos »: an English description with no catalogue word still reaches the product pictures; the multilingual keywords find the product; a photo still downloading is waited for', async () => {
    const s = await shop();
    await upload(s.owner, app, `/products/${s.robe.id}/images`, 'file', [{ buffer: await image(800, 800), name: 'robe.jpg', type: 'image/jpeg' }]).expect(201);
    await s.owner.post(`/products/${s.robe.id}/submit-changes`, {}).expect(200);
    await drain(app, s.owner.workspaceId);
    const photo = { attachments: [{ type: 'image', payload: { url: 'https://fake.meta.local/photo-cliente.jpg' } }] };

    // 1. what the model used to answer: an English sentence, no word of « Robe satin bordeaux » ⇒ the robe is compared anyway
    await resetAi();
    fakeAi(app)
      .script('vision_describe', { object: { category: 'evening gown', colors: ['burgundy'], text: '', description: 'A woman wearing a long burgundy evening gown', multipleProducts: false, quality: 'ok' } })
      .script('vision_match', (req) => ({ object: { productId: s.robe.id, confidence: 0.88, alternatives: [] }, ...(req ? {} : {}) }));
    const english = await turn(s, newSender(), photo);
    expect(fakeAi(app).callsOf('vision_describe')[0]!.system).toContain('"keywords"');
    const match = fakeAi(app).callsOf('vision_match')[0]!;
    expect((match.messages[0] as any).content.filter((p: any) => p.type === 'image')).toHaveLength(2); // the photo + the robe's picture
    expect(JSON.stringify(match.messages[0])).toContain(s.robe.id);
    expect((fakeAi(app).callsOf('reply')[0]!.messages.at(-1) as any).content).toContain(`IMAGE RESULT: {"productId":"${s.robe.id}","confidence":0.88`);
    expect((english.out.find((m) => m.type === 'product_cards')!.payload as any).cards[0].productId).toBe(s.robe.id);

    // 2. the keywords (French / Arabic / English) are what the catalogue is searched with: the robe comes first
    await resetAi();
    const search = jest.spyOn(app.app.get(CatalogueService), 'search');
    fakeAi(app)
      .script('vision_describe', { object: { category: 'dress', colors: ['burgundy'], text: '', description: 'long dress', keywords: ['robe', 'فستان', 'dress', 'satin', 'bordeaux'], multipleProducts: false, quality: 'ok' } })
      .script('vision_match', { object: { productId: s.robe.id, confidence: 0.9, alternatives: [] } });
    await turn(s, newSender(), photo);
    const visionSearch = search.mock.calls.findIndex((c) => /^robe فستان dress satin bordeaux/.test(c[1]));
    expect(visionSearch).toBeGreaterThanOrEqual(0);
    expect(await search.mock.results[visionSearch]!.value).toEqual([expect.objectContaining({ id: s.robe.id })]);
    search.mockRestore();

    // 3. the photo is still being downloaded from Meta when the batching window closes: the reply waits for it
    await resetAi();
    fakeAi(app).script('vision_describe', { object: { category: 'robe', colors: ['bordeaux'], text: '', description: 'robe satin bordeaux', keywords: ['robe', 'satin'], multipleProducts: false, quality: 'ok' } }).script('vision_match', { object: { productId: s.robe.id, confidence: 0.93, alternatives: [] } });
    const sender = newSender();
    const { conversation, message } = await receive(app, s.page, sender, photo);
    const stored = message!.attachments as any[];
    await db.message.update({ where: { id: message!.id }, data: { attachments: stored.map((a) => ({ ...a, pending: true, storageKey: null })) } });
    // (a Prisma query only runs once awaited / then-ed)
    setTimeout(() => void db.message.update({ where: { id: message!.id }, data: { attachments: stored } }).then(() => undefined), 1500);
    const r = await answer(app, s.owner.workspaceId, conversation.id);
    expect(r!.outcome).toBe('sent');
    expect((fakeAi(app).callsOf('reply')[0]!.messages.at(-1) as any).content).toContain(`"productId":"${s.robe.id}"`);
    expect((fakeAi(app).callsOf('reply')[0]!.messages.at(-1) as any).content).not.toContain('IMAGE RESULT: unavailable');
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
    // plan 5000 + a take-back of 4995 (`adjustment` debit): since contre-recette 11/11 M-31 a take-back lowers the month's
    // limit (5) instead of counting as « used »; usage is what the AI consumed, measured against that limit
    expect(b.total).toBe(5);
    await turn(s, newSender(), { text: 'Bonjour, la robe satin ?' });
    // the grant of setCredits emitted a first `credits.updated` (planUsed 0): the latest one is the debit of the turn
    const events = await wsOf(`ws:${s.owner.workspaceId}`, 'credits.updated');
    expect(events.at(-1)!.payload).toMatchObject({ planUsed: 1, planLimit: 5, packBalance: 0, exhausted: false });
    // 80 %: 4 of 5 used ⇒ one `credits_80` notification for the period
    for (let i = 0; i < 3; i++) await turn(s, newSender(), { text: 'Bonjour, la robe satin ?' });
    expect((await balanceOf(app, s.owner.workspaceId)).planUsed).toBe(4);
    expect(await db.notification.count({ where: { workspaceId: s.owner.workspaceId, type: 'credits_80' } })).toBe(1);
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
