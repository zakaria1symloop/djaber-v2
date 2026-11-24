// M5 — the AI order tools bound to the orders module (carry-over of M4): fake inbound message → AI `create_order` →
// order row + stock + `order.ai_created` + WS; replay, duplicate guard, cancellation, client merge, guards.
// AT-AI-04 / 05 / 06 / 07, AT-CLI-01, AT-ORD-21, AT-ORD-25 (AI side). The AI adapter is the scriptable fake.
import { ORDER_TOOLS, type OrderTools } from '../../src/modules/ai/tools/order-tools';
import { AiRunService } from '../../src/modules/ai/ai-run.service';
import { RoutingService } from '../../src/modules/ai/routing.service';
import { asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct } from '../support/m2';
import { connectedPage, fakeMeta, forbidNetwork, instagramChild, newSender, receive, work, wsOf } from '../support/m3';
import { answer, closeOutbox, fakeAi, ledger, linkedAgent, outMessages, replyJob, runReply, runsOf, textRoute } from '../support/m4';
import { db, phone, productStock, seedFees } from '../support/m5';

/** Units of the test product held by unconfirmed orders (product page « RÉSERVÉ »). */
const held = async (s: { owner: { get: (u: string) => any }; robe: Record<string, any> }) => (await s.owner.get(`/products/${s.robe.id}`).expect(200)).body.data.stockDetail.reserved as number;
let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
type Shop = { owner: Actor; page: Awaited<ReturnType<typeof connectedPage>>; agent: Awaited<ReturnType<typeof linkedAgent>>; robe: Record<string, any> };

const shop = async (agentOver: Record<string, unknown> = {}): Promise<Shop> => {
  const owner = await asOwner(app);
  await seedFees(app, owner.workspaceId);
  const page = await connectedPage(owner, app);
  const agent = await linkedAgent(owner.workspaceId, [page.id], agentOver as never);
  const robe = await createProduct(owner, { name: 'Robe satin bordeaux', price: 4500, stock: 5 });
  return { owner, page, agent, robe };
};
const resetAi = async () => {
  fakeAi(app).reset();
  const route = await textRoute();
  const routing = app.app.get(RoutingService);
  await routing.resetBreaker(route.primaryModelId);
  if (route.fallbackModelId) await routing.resetBreaker(route.fallbackModelId);
};
const turn = async (s: Shop, sender: string, text: string) => {
  const { conversation } = await receive(app, s.page, sender, { text });
  await answer(app, s.owner.workspaceId, conversation.id);
  return { conversationId: conversation.id, runs: await runsOf(conversation.id), conversation: await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } }), out: await outMessages(conversation.id) };
};
const createCall = (s: Shop, over: Record<string, unknown> = {}) => ({
  name: 'create_order',
  args: { clientName: 'Amine Benali', clientPhone: '0555 12 34 56', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'Cité des 200 logements, Bt 4, Bab Ezzouar', items: [{ productId: s.robe.id, quantity: 1 }], customerConfirmed: true, ...over },
});
const lastResult = (runs: Awaited<ReturnType<typeof runsOf>>) => runs.at(-1)!.toolCalls.sort((a, b) => a.executedAt!.getTime() - b.executedAt!.getTime()).at(-1)!.result as any;
/**
 * Full-test 15/11 AI-CHAT-01: an order needs the server's recap in an EARLIER turn — the customer gives the details
 * (with the phone), create_order answers CONFIRMATION_REQUIRED + recap, the AI shows it; the « oui » comes next.
 */
const recap = async (s: Shop, sender: string, over: Record<string, unknown> = {}) => {
  const call = createCall(s, over);
  fakeAi(app).script('reply', { toolCalls: [call] }, { reply: 'Récapitulatif : Robe satin bordeaux, livraison, total. Vous confirmez ?', intent: 'SALE' });
  const t = await turn(s, sender, `Amine Benali, ${(call.args as { clientPhone: string }).clientPhone}, Bab Ezzouar, Cité des 200 logements`);
  expect(lastResult(t.runs)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: expect.any(String) }, recap: { clientName: 'Amine Benali' } });
  await resetAi();
  return t;
};

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

describe('create_order (04-ai-pipeline §4.2)', () => {
  it('PV 28/10 « l\'agent IA limite les commandes à 10 »: an agent without limits takes 12 units and a 60 000 DA order; a limit that is set still hands off', async () => {
    const s = await shop();
    expect(s.agent).toMatchObject({ maxQtyPerOrder: null, maxAmountPerOrder: null });
    const hijab = await createProduct(s.owner, { name: 'Hijab soie', price: 5000, stock: 40 });
    const buyer = newSender();
    await recap(s, buyer, { items: [{ productId: hijab.id, quantity: 12 }] });
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { items: [{ productId: hijab.id, quantity: 12 }] })] }, { reply: 'Commande enregistrée.', status: 'OK', intent: 'SALE' });
    const t = await turn(s, buyer, 'oui je confirme');
    expect(lastResult(t.runs)).toMatchObject({ ok: true, subtotal: 60_000 });
    expect(t.conversation.status).toBe('active');
    expect(await db.order.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId }, include: { items: true } })).toMatchObject({ subtotal: 60_000, items: [expect.objectContaining({ quantity: 12 })] });
    // a limit the merchant set is still applied
    await resetAi();
    const capped = await shop({ maxQtyPerOrder: 10 });
    const h2 = await createProduct(capped.owner, { name: 'Hijab soie', price: 1500, stock: 40 });
    fakeAi(app).script('reply', { toolCalls: [createCall(capped, { items: [{ productId: h2.id, quantity: 12 }] })] }, { reply: 'Je transmets.', status: 'HANDOFF', statusDetail: 'order_limits', intent: 'SALE' });
    // journey re-run J03r-1: the server hands off on the tool's answer (no second create_order, no model call after it)
    const refused = await turn(capped, newSender(), 'Amine Benali, 0555 12 34 56, Bab Ezzouar, Cité des 200 logements');
    expect(lastResult(refused.runs)).toMatchObject({ ok: false, hint: 'order_limit', limit: 'quantity', maxQty: 10, maxAmount: null, quantity: 12 });
    expect(refused.conversation.status).toBe('needs_human');
    expect(await db.order.count({ where: { workspaceId: capped.owner.workspaceId } })).toBe(0);
    // …and on a message asking more pieces than the maximum, before any model call
    await resetAi();
    const direct = await turn(capped, newSender(), 'Amine Benali, 0555 12 34 56, Bab Ezzouar, Cité des 200 logements, 12 pièces');
    expect(direct.runs.at(-1)!.toolCalls).toHaveLength(0);
    expect(direct.conversation.status).toBe('needs_human');
    expect(await db.order.count({ where: { workspaceId: capped.owner.workspaceId } })).toBe(0);
  });

  it('AT-AI-04 / AT-CLI-01 recap confirmed ⇒ order `new` source ai, stock held (no movement until confirmed), placeholder merged into the phone owner, notification + WS, 1 credit for the text, 0 for the order', async () => {
    const s = await shop();
    // the phone already belongs to a client of the shop (an earlier manual order)
    const existing = await db.client.create({ data: { workspaceId: s.owner.workspaceId, name: 'Amine B.', phone: '0555123456', source: 'manual' } });
    const sender = newSender();
    await recap(s, sender);
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'Votre commande est enregistrée ✓', intent: 'SALE' });
    const t = await turn(s, sender, 'نعم');
    const r = lastResult(t.runs);
    expect(r).toMatchObject({ ok: true, number: 'CMD-1001', subtotal: 4500, deliveryFee: 400, total: 4900, duplicateOf: null, paymentOptions: ['cod'], items: [{ name: 'Robe satin bordeaux', quantity: 1, unitPrice: 4500 }] });
    const order = await db.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { items: true } });
    expect(order).toMatchObject({ status: 'new', source: 'ai', agentId: s.agent.id, channelId: s.page.id, conversationId: t.conversationId, paymentMethod: 'cash', clientPhone: '0555123456', clientId: existing.id, communeText: null });
    expect(order.communeId).not.toBeNull(); // "Bab Ezzouar" matched the seeded commune of wilaya 16
    // a new order holds its unit, the stock moves when the merchant confirms (owner decision 2026-10-21)
    expect(await productStock(s.robe.id)).toBe(5);
    expect(await held(s)).toBe(1);
    // CLI-02: the placeholder of the conversation is merged into the phone owner, the conversation re-linked
    expect(t.conversation.clientId).toBe(existing.id);
    const placeholder = await db.client.findFirstOrThrow({ where: { mergedIntoId: existing.id } });
    expect(placeholder).toMatchObject({ isPlaceholder: true, deletedAt: expect.any(Date) });
    expect(await db.clientIdentity.count({ where: { clientId: existing.id } })).toBe(1);
    expect(await db.client.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ orderCount: 1 });
    // cart closed with the order id, thread event, WS, notification
    expect((t.conversation.context as any).cart).toMatchObject({ orderId: order.id, items: [] });
    expect(t.out.some((m) => m.type === 'system' && (m.payload as any)?.system?.kind === 'order_created')).toBe(true);
    expect((await wsOf(`ws:${s.owner.workspaceId}`, 'order.created')).some((e) => e.payload.order.id === order.id)).toBe(true);
    await work(app, [s.owner.workspaceId]);
    const n = await db.notification.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId, type: 'order_ai_created' } });
    expect(n.data).toMatchObject({ orderId: order.id, number: 'CMD-1001', total: expect.stringContaining('900'), agent: 'Vendeur', client: 'Amine Benali' });
    // credits: one text reply per turn (the recap, the confirmation), nothing for the order
    expect((await ledger(s.owner.workspaceId)).filter((l) => l.kind === 'debit').map((l) => [l.action, l.credits])).toEqual([['text_reply', -1], ['text_reply', -1]]);
    expect(t.runs.at(-1)).toMatchObject({ status: 'ok', creditsCharged: 1 });
    expect(t.conversation.status).toBe('active');
  });

  it('AT-AI-05 the job crashes after `create_order`, before the send ⇒ the retry replays the stored result: one order, one send', async () => {
    const s = await shop();
    const sender = newSender();
    await recap(s, sender);
    const { conversation } = await receive(app, s.page, sender, { text: 'oui je confirme' });
    // journey retest R19-1 (18/11): the plain yes is placed by the server with no model call — the crash is the run's closing, before the send
    const finish = jest.spyOn(app.app.get(AiRunService), 'finish').mockRejectedValueOnce(new Error('crash before the send'));
    fakeAi(app).script('reply', { toolCalls: [{ ...createCall(s), id: 'call_a' }] }, { error: 'provider_error' }, { error: 'provider_error' });
    const data = (await replyJob(app, conversation.id))!.data as never;
    await expect(runReply(app, conversation.id, { attempt: 1, attempts: 3 })).rejects.toThrow(/crash before the send/);
    finish.mockRestore();
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(1);
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ ...createCall(s), id: 'call_b' }] }, { reply: 'Commande CMD-1001 enregistrée.', intent: 'SALE' });
    await runReply(app, conversation.id, { attempt: 2, attempts: 3, data });
    await work(app, [s.owner.workspaceId]);
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(1);
    expect(await held(s)).toBe(1);
    expect(fakeMeta(app).callsOf('send').filter((c) => (c.args as any).recipientId === sender && String((c.args as any).message.text).includes('CMD-1001'))).toHaveLength(1);
    // the port itself is idempotent on runId:callId too (api-contract §1.7)
    const port = app.app.get<OrderTools>(ORDER_TOOLS);
    const run = (await runsOf(conversation.id)).at(-1);
    const stored = run!.toolCalls[0]!;
    const again = await (await import('@djaber/db')).TenantContext.runAs(s.owner.workspaceId, () => port.createOrder({ workspaceId: s.owner.workspaceId, agentId: s.agent.id, conversationId: conversation.id, clientId: null, channelId: s.page.id, runId: run!.id, callId: stored.callId }, {} as never));
    expect(again).toMatchObject({ ok: true, number: 'CMD-1001' });
  });

  it('AT-AI-06 the same customer confirms the identical cart twice within 10 min ⇒ the existing order comes back (duplicateOf)', async () => {
    const s = await shop();
    const sender = newSender();
    await recap(s, sender);
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'OK', intent: 'SALE' });
    await turn(s, sender, 'oui');
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'Déjà enregistrée', intent: 'SALE' });
    const t = await turn(s, sender, 'oui je confirme encore');
    // full-test 15/11 proposal 4: the same content placed by an earlier turn is refused before the port (duplicate guard as a fallback)
    expect(lastResult(t.runs)).toMatchObject({ ok: false, error: { code: 'ORDER_ALREADY_PLACED', number: 'CMD-1001' } });
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(1);
    expect(await held(s)).toBe(1);
  });

  it('journey 16/11 J03-10 (Blocker): « oui » while the confirming call rewords the address (« …, Bab Ezzouar, Alger ») creates the order with the recap’s wording; another wording later is no second order', async () => {
    const s = await shop();
    const sender = newSender();
    await recap(s, sender); // address « Cité des 200 logements, Bt 4, Bab Ezzouar »
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { address: 'Cité des 200 logements, Bt 4, Bab Ezzouar, Alger', clientName: 'Amine BENALI' })] }, { reply: 'Commande enregistrée.', intent: 'SALE' });
    const t = await turn(s, sender, 'oui');
    expect(lastResult(t.runs)).toMatchObject({ ok: true, number: 'CMD-1001', draft: expect.any(String), core: expect.any(String) });
    expect(await db.order.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId } })).toMatchObject({ address: 'Cité des 200 logements, Bt 4', clientName: 'Amine Benali' }); // journey retest R11-4: the commune / wilaya are stored apart (communeName), never at the end of the street
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { address: 'cité 200 logements bt 4' })] }, { reply: 'Déjà enregistrée', intent: 'SALE' });
    const again = await turn(s, sender, 'oui je confirme');
    expect(lastResult(again.runs)).toMatchObject({ ok: false, error: { code: 'ORDER_ALREADY_PLACED', number: 'CMD-1001' } });
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(1);
  });

  it('journey 16/11 J03-10: a new address word in the customer’s own « oui » message, or another quantity, is a change ⇒ a new recap, no order', async () => {
    const s = await shop();
    const sender = newSender();
    await recap(s, sender);
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { address: 'Cité des 200 logements, Bt 9, Bab Ezzouar' })] }, { reply: 'Nouveau récapitulatif.', intent: 'SALE' });
    const moved = await turn(s, sender, 'oui mais c’est le Bt 9');
    expect(lastResult(moved.runs)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' }, recap: { address: 'Cité des 200 logements, Bt 9' } }); // R11-4: « street » — the recap adds « , Bab Ezzouar, Alger »
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { address: 'Cité des 200 logements, Bt 9, Bab Ezzouar', items: [{ productId: s.robe.id, quantity: 2 }] })] }, { reply: 'Nouveau récapitulatif.', intent: 'SALE' });
    const more = await turn(s, sender, 'oui, mais j’en veux 2');
    expect(lastResult(more.runs)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' }, recap: { subtotal: 9000 } });
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(0);
    // journey retest R17-2 (18/11): a plain « oui » to the recap shown places exactly that recap — the model's call with another quantity
    // (nobody asked for 3) runs with the recap's stored order
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { address: 'Cité des 200 logements, Bt 9, Bab Ezzouar', items: [{ productId: s.robe.id, quantity: 3 }] })] }, { reply: 'Commande enregistrée.', intent: 'SALE' });
    const yes = await turn(s, sender, 'oui');
    expect(lastResult(yes.runs)).toMatchObject({ ok: true, subtotal: 9000 });
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(1);
  });

  it('journey retest R4-3 (Critical): « oui » to a product the AI suggested with the customer details ⇒ CONFIRMATION_REQUIRED + the server recap, no order; the « oui » to that recap places it', async () => {
    const s = await shop();
    const sender = newSender();
    // N5 T5: no create_order — the AI proposes the product and repeats the details, the price and the total
    fakeAi(app).script('reply', { reply: 'Voulez-vous plutôt la Robe satin bordeaux, 4900 DA livraison comprise ? J’ai bien noté Amine Benali, 0555123456, Cité des 200 logements, Bt 4, Bab Ezzouar.', intent: 'SALE' });
    await turn(s, sender, 'Bon finalement je le prends. Amine Benali 0555 12 34 56, Alger, Bab Ezzouar, Cité des 200 logements, Bt 4');
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'Votre commande est enregistrée ✓', intent: 'SALE' });
    const t = await turn(s, sender, 'oui');
    expect(lastResult(t.runs)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' }, recapToShow: true, recap: { total: 4900 } });
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(0);
    const sent = t.out.filter((m) => m.author === 'ai' && m.type === 'text').at(-1)!;
    expect(sent.text).toMatch(/^Voici le récapitulatif de votre commande :/);
    expect(sent.text).toContain('Livraison à domicile (Bab Ezzouar, Alger) : 400 DA');
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'OK', intent: 'SALE' });
    const placed = await turn(s, sender, 'oui');
    expect(lastResult(placed.runs)).toMatchObject({ ok: true, number: 'CMD-1001', total: 4900 });
  });

  it('journey retest R4-1: status HANDOFF « order_limits » on a plain order message (no limit reached) is refused — the conversation stays with the AI', async () => {
    const s = await shop({ maxQtyPerOrder: 5 });
    fakeAi(app).script('reply', { reply: 'Je transmets.', status: 'HANDOFF', statusDetail: 'order_limits', evidence: 'Je voudrais la robe satin bordeaux', intent: 'SALE' }, { reply: 'Très bon choix ! Quel est votre nom ?', intent: 'SALE' });
    const t = await turn(s, newSender(), 'Je voudrais la robe satin bordeaux');
    expect(t.conversation.status).toBe('active');
    expect(t.runs.at(-1)!.flags).toContain('handoff_refused');
    expect(t.out.filter((m) => m.author === 'ai' && m.type === 'text').at(-1)!.text).toBe('Très bon choix ! Robe satin bordeaux : 4\u00a0500\u00a0DA. Quel est votre nom ?'); // journey retest R18-2 (R19-3: formatMoney)
  });

  it('journey retest R4-6: two phone numbers in one message ⇒ the main and the second phone, in the recap and the order', async () => {
    const s = await shop();
    const sender = newSender();
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { clientPhone: '0661234568' })] }, { reply: '', intent: 'SALE' });
    const t = await turn(s, sender, 'Bonjour, je veux la robe satin bordeaux. Amine Benali, 0661234568 ou 0770998877, Bab Ezzouar, Cité des 200 logements, Bt 4');
    expect(lastResult(t.runs)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' }, recap: { clientPhone: '0661234568', secondPhone: '0770998877' } });
    expect(t.out.filter((m) => m.author === 'ai' && m.type === 'text').at(-1)!.text).toContain('Deuxième téléphone : 0770998877');
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { clientPhone: '0661234568' })] }, { reply: 'OK', intent: 'SALE' });
    const placed = await turn(s, sender, 'oui');
    expect(lastResult(placed.runs)).toMatchObject({ ok: true });
    expect(await db.order.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId } })).toMatchObject({ clientPhone: '0661234568', clientPhone2: '0770998877' });
  });

  it('AT-AI-07 "annuler ma commande": a new order ⇒ cancelled through OrderEffects (its hold released); a shipped order ⇒ handoff', async () => {
    const s = await shop();
    const sender = newSender();
    await recap(s, sender);
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'OK', intent: 'SALE' });
    const first = await turn(s, sender, 'oui');
    const orderId = lastResult(first.runs).orderId;
    expect(await held(s)).toBe(1);
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ name: 'cancel_order', args: { orderNumber: 'CMD-1001', customerConfirmed: true, reason: 'changed mind' } }] }, { reply: 'Commande annulée.', intent: 'OTHER' });
    const cancel = await turn(s, sender, 'oui annulez la');
    expect(lastResult(cancel.runs)).toEqual({ ok: true, cancelled: { number: 'CMD-1001' } });
    expect(await db.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'cancelled', cancelReason: 'changed_mind' });
    expect(await productStock(s.robe.id)).toBe(5);
    expect(await held(s)).toBe(0);
    const history = await db.orderStatusHistory.findFirstOrThrow({ where: { orderId, to: 'cancelled' } });
    expect(history).toMatchObject({ actorType: 'ai', actorId: s.agent.id });
    expect(cancel.conversation.status).toBe('active');
    // shipped ⇒ not cancellable ⇒ the thread goes to the team
    const other = newSender();
    await resetAi();
    await recap(s, other, { clientPhone: '0666 11 22 33' });
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { clientPhone: '0666 11 22 33' })] }, { reply: 'OK', intent: 'SALE' });
    const second = await turn(s, other, 'oui');
    await db.order.update({ where: { id: lastResult(second.runs).orderId }, data: { status: 'shipped', deliveryStatus: 'sent' } });
    await resetAi();
    const shipped = await turn(s, other, 'annuler ma commande svp');
    expect(lastResult(shipped.runs)).toEqual({ ok: false, error: { code: 'ORDER_NOT_CANCELLABLE' } });
    expect(shipped.conversation.status).toBe('needs_human');
  });

  it('tester report 2026-10-20 A9 / A8: a change replaces a new order (new one created first, then the old one cancelled, its units counted free); a confirmed order is neither cancelled nor replaced by the AI', async () => {
    const s = await shop();
    await db.product.update({ where: { id: s.robe.id }, data: { stock: 2 } });
    const sender = newSender();
    await recap(s, sender);
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'OK', intent: 'SALE' });
    const first = await turn(s, sender, 'oui');
    const oldId = lastResult(first.runs).orderId;
    expect(await held(s)).toBe(1);
    // 2 units wanted: possible only because the replaced order's unit is given back
    await resetAi();
    await recap(s, sender, { items: [{ productId: s.robe.id, quantity: 2 }], replacesOrder: 'CMD-1001' });
    fakeAi(app).script('reply', { toolCalls: [{ ...createCall(s, { items: [{ productId: s.robe.id, quantity: 2 }], replacesOrder: 'CMD-1001' }), id: 'call_replace' }] }, { reply: 'Commande modifiée.', intent: 'SALE' });
    const change = await turn(s, sender, 'oui finalement 2');
    const replaced = lastResult(change.runs);
    expect(replaced).toMatchObject({ ok: true, number: 'CMD-1002', replaced: { number: 'CMD-1001' } });
    expect(await db.order.findUniqueOrThrow({ where: { id: oldId } })).toMatchObject({ status: 'cancelled' });
    expect(await held(s)).toBe(2);
    // the shop confirms CMD-1002: the AI may no longer cancel or replace it — the team handles it
    const newOrder = await db.order.findUniqueOrThrow({ where: { id: replaced.orderId } });
    await s.owner.post(`/orders/${newOrder.id}/status`, { to: 'confirmed', version: newOrder.version }).set({ 'Idempotency-Key': `confirm-${newOrder.id}` }).expect(200);
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ name: 'cancel_order', args: { orderNumber: 'CMD-1002', customerConfirmed: true } }] }, { reply: 'Je transmets.', intent: 'OTHER' });
    const cancel = await turn(s, sender, 'annulez la svp');
    expect(lastResult(cancel.runs)).toEqual({ ok: false, error: { code: 'ORDER_CONFIRMED_BY_SELLER', number: 'CMD-1002' }, hint: 'handoff' });
    expect(await db.order.findUniqueOrThrow({ where: { id: newOrder.id } })).toMatchObject({ status: 'confirmed' });
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ ...createCall(s, { replacesOrder: 'CMD-1002' }), id: 'call_replace_2' }] }, { reply: 'Je transmets.', intent: 'SALE' });
    const again = await turn(s, sender, 'je veux changer');
    expect(lastResult(again.runs)).toMatchObject({ ok: false, error: { code: 'ORDER_CONFIRMED_BY_SELLER' } });
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(2);
  });

  it('Houssem live 23/11 UX-081: after an order with another phone (another client record), the order placed earlier in the same conversation is still the customer’s — found with its content, its address changed with the new street only, and the other one cancellable', async () => {
    const s = await shop();
    const sender = newSender();
    await recap(s, sender);
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'OK', intent: 'SALE' });
    const first = await turn(s, sender, 'oui');
    const firstOrder = lastResult(first.runs);
    expect(firstOrder).toMatchObject({ ok: true, number: 'CMD-1001' });
    // a second order with another phone: the conversation now points to another client record
    await resetAi();
    const other = { clientPhone: '0661 22 33 44', items: [{ productId: s.robe.id, quantity: 2 }] };
    await recap(s, sender, other);
    fakeAi(app).script('reply', { toolCalls: [createCall(s, other)] }, { reply: 'OK', intent: 'SALE' });
    const second = await turn(s, sender, 'oui');
    expect(lastResult(second.runs)).toMatchObject({ ok: true, number: 'CMD-1002' });
    const old = await db.order.findUniqueOrThrow({ where: { id: firstOrder.orderId } });
    expect(second.conversation.clientId).not.toBe(old.clientId);
    // the first order is found by its number, with what it holds and where it goes
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ name: 'lookup_order', args: { orderNumber: 'CMD-1001' } }] }, { reply: 'Votre commande CMD-1001 est bien enregistrée.', intent: 'OTHER' });
    const where = await turn(s, sender, 'où est ma commande CMD-1001 ?');
    expect(lastResult(where.runs).orders).toEqual([expect.objectContaining({ number: 'CMD-1001', status: 'new', changeable: true, items: [expect.objectContaining({ productId: s.robe.id, quantity: 1 })], delivery: expect.objectContaining({ clientPhone: old.clientPhone, wilayaId: 16, isStopdesk: false }) })]);
    // its address changes: the call gives the new street only — the items, the name, the phone and the wilaya are kept from the order
    await resetAi();
    const change = { name: 'create_order', args: { replacesOrder: 'CMD-1001', address: 'Cité 500 logements, bâtiment 2', customerConfirmed: true } };
    fakeAi(app).script('reply', { toolCalls: [change] }, { reply: 'Bien sûr.', intent: 'SALE' });
    const asked = await turn(s, sender, 'je veux changer l’adresse de ma commande CMD-1001 : Cité 500 logements, bâtiment 2');
    expect(lastResult(asked.runs)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' }, recap: { clientName: 'Amine Benali', clientPhone: old.clientPhone, replaces: 'CMD-1001' } });
    expect(asked.out.map((m) => m.text).join('\n')).toContain('500 logements');
    // 24/11: the recap of the replacing order ends the turn — one model call (it took four: a 2nd create_order, a lookup_order, a text)
    expect(fakeAi(app).callsOf('reply')).toHaveLength(1);
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ ...change, id: 'call_addr' }] }, { reply: 'C’est modifié.', intent: 'SALE' });
    const done = await turn(s, sender, 'oui');
    expect(lastResult(done.runs)).toMatchObject({ ok: true, number: 'CMD-1003', replaced: { number: 'CMD-1001' } });
    expect(await db.order.findUniqueOrThrow({ where: { id: firstOrder.orderId } })).toMatchObject({ status: 'cancelled' });
    expect(await db.order.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId, number: 'CMD-1003' }, include: { items: true } })).toMatchObject({ clientPhone: old.clientPhone, clientName: 'Amine Benali', wilayaId: 16, address: expect.stringContaining('500 logements'), items: [expect.objectContaining({ productId: s.robe.id, quantity: 1 })] });
    // the order placed with the other phone is still this conversation's: it can be cancelled
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ name: 'cancel_order', args: { orderNumber: 'CMD-1002', customerConfirmed: true } }] }, { reply: 'C’est annulé.', intent: 'OTHER' });
    const cancel = await turn(s, sender, 'annulez la commande CMD-1002 svp');
    expect(lastResult(cancel.runs)).toMatchObject({ ok: true, cancelled: { number: 'CMD-1002' } });
    expect(await db.order.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId, number: 'CMD-1002' } })).toMatchObject({ status: 'cancelled' });
  });

  it('Houssem live 23/11 UX-082 (client list L51): an order of a service has no delivery — no wilaya, no address, no fee; the recap and the confirmation say neither « livraison » nor « à payer à la livraison »; a service ordered with a delivered product is delivered as usual', async () => {
    const s = await shop();
    const service = await createProduct(s.owner, { name: 'Création de site web', price: 30000, trackStock: false, stock: null });
    const sender = newSender();
    // the call gives the name, the phone and the item only
    const call = { name: 'create_order', args: { clientName: 'Amine Benali', clientPhone: '0555 12 34 56', items: [{ productId: service.id, quantity: 1 }], customerConfirmed: true } };
    fakeAi(app).script('reply', { toolCalls: [call] }, { reply: 'Bien sûr.', intent: 'SALE' });
    const asked = await turn(s, sender, 'je veux commander le service Création de site web. Amine Benali, 0555 12 34 56');
    const first = lastResult(asked.runs);
    expect(first).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' }, recapToShow: true, recap: { noDelivery: true, deliveryFee: 0, total: 30000, clientName: 'Amine Benali' } });
    const recapText = asked.out.map((m) => m.text).join('\n');
    expect(recapText).toContain('1 × Création de site web : 30 000 DA');
    expect(recapText).toContain('Total : 30 000 DA.');
    expect(recapText).not.toMatch(/livraison|adresse/i);
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [{ ...call, id: 'call_service' }] }, { reply: 'OK', intent: 'SALE' });
    const done = await turn(s, sender, 'oui');
    const placed = lastResult(done.runs);
    expect(placed).toMatchObject({ ok: true, number: 'CMD-1001', deliveryFee: 0, total: 30000, noDelivery: true });
    expect(await db.order.findUniqueOrThrow({ where: { id: placed.orderId } })).toMatchObject({ status: 'new', source: 'ai', wilayaId: null, communeId: null, address: null, isStopdesk: false, deliveryFee: 0, total: 30000 });
    // the order page and the list read an AI order without delivery
    expect((await s.owner.get(`/orders/${placed.orderId}`).expect(200)).body.data).toMatchObject({ number: 'CMD-1001', total: 30000 });
    await s.owner.get('/orders').expect(200);
    // Houssem live 24/11 UX-084: it is an order that is not delivered — confirmed and closed without an address, no courier action
    const view = (await s.owner.get(`/orders/${placed.orderId}`).expect(200)).body.data;
    expect(view).toMatchObject({ noDelivery: true, address: null });
    const keys = view.actions.map((a: any) => a.key);
    expect(keys).toContain('confirm');
    expect(keys).not.toContain('send_courier');
    expect(keys).not.toContain('ship_manual');
    const confirmed = (await s.owner.post(`/orders/${placed.orderId}/status`, { to: 'confirmed', version: view.version }).set({ 'Idempotency-Key': `confirm-${placed.orderId}` }).expect(200)).body.data;
    expect(confirmed).toMatchObject({ status: 'confirmed' });
    expect(confirmed.actions.find((a: any) => a.primary)).toMatchObject({ key: 'deliver', enabled: true });
    expect(confirmed.actions.map((a: any) => a.key)).not.toContain('prepare');
    await s.owner.post(`/orders/${placed.orderId}/status`, { to: 'delivered', version: confirmed.version }).set({ 'Idempotency-Key': `deliver-${placed.orderId}` }).expect(200);
    expect(await db.order.findUniqueOrThrow({ where: { id: placed.orderId } })).toMatchObject({ status: 'delivered', noDelivery: true });
    const confirmation = done.out.map((m) => m.text).join('\n');
    expect(confirmation).toContain('CMD-1001');
    expect(confirmation).toContain('Total : 30 000 DA.');
    expect(confirmation).not.toMatch(/livraison/i);
    // the service with a delivered product: the order is delivered — the wilaya and the address are required, the fee is added
    await resetAi();
    const other = newSender();
    const mixed = { name: 'create_order', args: { clientName: 'Amine Benali', clientPhone: '0555 12 34 56', items: [{ productId: service.id, quantity: 1 }, { productId: s.robe.id, quantity: 1 }], customerConfirmed: true } };
    fakeAi(app).script('reply', { toolCalls: [mixed] }, { reply: 'Quelle est votre wilaya ?', intent: 'SALE' });
    const partial = await turn(s, other, 'je veux le service Création de site web et la robe satin bordeaux. Amine Benali, 0555 12 34 56');
    expect(lastResult(partial.runs)).toMatchObject({ ok: false, error: { code: 'VALIDATION', fields: expect.arrayContaining(['wilayaId']) } });
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(1);
  });
  it('a blocked customer ⇒ CUSTOMER_BLOCKED, no order, silent handoff (04 §13); risky client with RISKY_CLIENT_POLICY=handoff ⇒ handoff', async () => {
    const s = await shop();
    await s.owner.post('/safety/blocks', { phone: '0555123456', reason: 'fraud' }).expect(201);
    const blocked = newSender();
    await recap(s, blocked);
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'Je transmets à un conseiller.', intent: 'SALE' });
    const t = await turn(s, blocked, 'oui');
    expect(lastResult(t.runs)).toMatchObject({ ok: false, error: { code: 'CUSTOMER_BLOCKED' } });
    expect(t.conversation.status).toBe('needs_human');
    // journey retest R4-8: the server sentence, in line with the handoff (never « réessayez plus tard », never « bloqué »)
    expect(t.out.filter((m) => m.author === 'ai' && m.type === 'text').at(-1)!.text).toBe('Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper.');
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(0);
    // journey retest R19-1 (18/11): the plain « oui » made no model call — its scripted answers are not left for the next turn
    await resetAi();

    const r = await shop({ riskyClientBehavior: 'handoff' });
    await db.client.create({ data: { workspaceId: r.owner.workspaceId, name: 'Client risqué', phone: '0777000111', riskLevel: 'high', riskSetManually: true } });
    const riskySender = newSender();
    await recap(r, riskySender, { clientPhone: '0777000111' });
    fakeAi(app).script('reply', { toolCalls: [createCall(r, { clientPhone: '0777000111' })] }, { reply: 'Je transmets.', intent: 'SALE' });
    const risky = await turn(r, riskySender, 'oui');
    expect(lastResult(risky.runs)).toEqual({ ok: false, hint: 'risky_client' });
    expect(risky.conversation.status).toBe('needs_human');
    expect(await db.order.count({ where: { workspaceId: r.owner.workspaceId } })).toBe(0);
  });

  it('AT-ORD-25 (AI side) after a "faux numéro" on that phone, create_order asks for the phone confirmation first', async () => {
    const s = await shop();
    const number = phone();
    const c = await db.client.create({ data: { workspaceId: s.owner.workspaceId, name: 'Ancien client', phone: number } });
    await db.order.create({ data: { workspaceId: s.owner.workspaceId, number: 'CMD-500', clientId: c.id, source: 'manual', clientName: c.name, clientPhone: number, subtotal: 1, total: 1, status: 'cancelled', cancelReason: 'fake' } });
    const sender = newSender();
    await recap(s, sender, { clientPhone: number });
    // full-test 15/11 AI-CHAT-03: a phoneConfirmed the tool did not ask for in an earlier turn is not honoured
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { clientPhone: number })] }, { toolCalls: [createCall(s, { clientPhone: number, phoneConfirmed: true })] }, { reply: 'Vous confirmez bien ce numéro ?', intent: 'SALE' });
    const t = await turn(s, sender, 'oui');
    const results = t.runs.at(-1)!.toolCalls.sort((a, b) => a.executedAt!.getTime() - b.executedAt!.getTime()).map((x) => x.result as any);
    expect(results[0]).toMatchObject({ ok: false, error: { code: 'PHONE_CONFIRMATION_REQUIRED', phone: number } });
    expect(results[1]).toMatchObject({ ok: false, error: { code: 'PHONE_CONFIRMATION_REQUIRED', phone: number } });
    // the customer re-confirms the number in the next message ⇒ the order is created
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { clientPhone: number, phoneConfirmed: true })] }, { reply: 'Commande enregistrée', intent: 'SALE' });
    const ok = await turn(s, sender, 'oui c’est bien mon numéro');
    expect(lastResult(ok.runs)).toMatchObject({ ok: true, number: 'CMD-1001' });
  });

  it('AT-ORD-21 Messenger and Instagram AI orders are identical except the channel', async () => {
    const s = await shop();
    const ig = await instagramChild(s.page.id);
    const port = app.app.get<OrderTools>(ORDER_TOOLS);
    const { TenantContext } = await import('@djaber/db');
    const req = (p: string) => ({ clientName: 'Sara K', clientPhone: p, secondPhone: null, wilayaId: 16, communeName: null, address: 'Cité des 200 logements, Bt 4', isStopdesk: false, stopdeskId: null, notes: null, items: [{ productId: s.robe.id, variantId: null, quantity: 1, name: s.robe.name, variant: null, unitPrice: 4500 }], subtotal: 4500, deliveryFee: 400, total: 4900 });
    const ctx = (channelId: string, callId: string) => ({ workspaceId: s.owner.workspaceId, agentId: s.agent.id, conversationId: null, clientId: null, channelId, runId: '00000000-0000-7000-8000-000000000001', callId });
    const fb = await TenantContext.runAs(s.owner.workspaceId, () => port.createOrder(ctx(s.page.id, 'fb'), req(phone())));
    const insta = await TenantContext.runAs(s.owner.workspaceId, () => port.createOrder(ctx(ig!.id, 'ig'), req(phone())));
    const [a, b] = await Promise.all([s.owner.get(`/orders/${(fb as any).orderId}`).expect(200), s.owner.get(`/orders/${(insta as any).orderId}`).expect(200)]);
    const strip = (o: any) => ({ ...o, items: o.items.map((i: any) => ({ ...i, id: '' })), id: '', number: '', orderedAt: '', createdAt: '', updatedAt: '', client: { ...o.client, id: '', phone: '' }, clientPhone: '', channel: null, source: { ...o.source, channel: null }, history: [], actions: o.actions });
    expect(a.body.data.channel).toMatchObject({ platform: 'facebook' });
    expect(b.body.data.channel).toMatchObject({ platform: 'instagram' });
    expect(strip(b.body.data)).toEqual(strip(a.body.data));
  });
});
