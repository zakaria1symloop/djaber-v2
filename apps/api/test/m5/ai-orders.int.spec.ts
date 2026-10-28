// M5 — the AI order tools bound to the orders module (carry-over of M4): fake inbound message → AI `create_order` →
// order row + stock + `order.ai_created` + WS; replay, duplicate guard, cancellation, client merge, guards.
// AT-AI-04 / 05 / 06 / 07, AT-CLI-01, AT-ORD-21, AT-ORD-25 (AI side). The AI adapter is the scriptable fake.
import { ORDER_TOOLS, type OrderTools } from '../../src/modules/ai/tools/order-tools';
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
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { items: [{ productId: hijab.id, quantity: 12 }] })] }, { reply: 'Commande enregistrée.', status: 'OK', intent: 'SALE' });
    const t = await turn(s, newSender(), 'oui je confirme');
    expect(lastResult(t.runs)).toMatchObject({ ok: true, subtotal: 60_000 });
    expect(t.conversation.status).toBe('active');
    expect(await db.order.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId }, include: { items: true } })).toMatchObject({ subtotal: 60_000, items: [expect.objectContaining({ quantity: 12 })] });
    // a limit the merchant set is still applied
    await resetAi();
    const capped = await shop({ maxQtyPerOrder: 10 });
    const h2 = await createProduct(capped.owner, { name: 'Hijab soie', price: 1500, stock: 40 });
    fakeAi(app).script('reply', { toolCalls: [createCall(capped, { items: [{ productId: h2.id, quantity: 12 }] })] }, { reply: 'Je transmets.', status: 'HANDOFF', statusDetail: 'order_limits', intent: 'SALE' });
    const refused = await turn(capped, newSender(), 'oui');
    expect(lastResult(refused.runs)).toEqual({ ok: false, hint: 'order_limit', maxQty: 10, maxAmount: null });
    expect(await db.order.count({ where: { workspaceId: capped.owner.workspaceId } })).toBe(0);
  });

  it('AT-AI-04 / AT-CLI-01 recap confirmed ⇒ order `new` source ai, stock held (no movement until confirmed), placeholder merged into the phone owner, notification + WS, 1 credit for the text, 0 for the order', async () => {
    const s = await shop();
    // the phone already belongs to a client of the shop (an earlier manual order)
    const existing = await db.client.create({ data: { workspaceId: s.owner.workspaceId, name: 'Amine B.', phone: '0555123456', source: 'manual' } });
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'Votre commande est enregistrée ✓', intent: 'SALE' });
    const sender = newSender();
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
    // credits: one text reply, nothing for the order
    expect((await ledger(s.owner.workspaceId)).filter((l) => l.kind === 'debit').map((l) => [l.action, l.credits])).toEqual([['text_reply', -1]]);
    expect(t.runs[0]).toMatchObject({ status: 'ok', creditsCharged: 1 });
    expect(t.conversation.status).toBe('active');
  });

  it('AT-AI-05 the job crashes after `create_order`, before the send ⇒ the retry replays the stored result: one order, one send', async () => {
    const s = await shop();
    const sender = newSender();
    const { conversation } = await receive(app, s.page, sender, { text: 'oui je confirme' });
    fakeAi(app).script('reply', { toolCalls: [{ ...createCall(s), id: 'call_a' }] }, { error: 'provider_error' }, { error: 'provider_error' });
    const data = (await replyJob(app, conversation.id))!.data as never;
    await expect(runReply(app, conversation.id, { attempt: 1, attempts: 3 })).rejects.toThrow(/ai provider unavailable/);
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
    const [run] = await runsOf(conversation.id);
    const stored = run!.toolCalls[0]!;
    const again = await (await import('@djaber/db')).TenantContext.runAs(s.owner.workspaceId, () => port.createOrder({ workspaceId: s.owner.workspaceId, agentId: s.agent.id, conversationId: conversation.id, clientId: null, channelId: s.page.id, runId: run!.id, callId: stored.callId }, {} as never));
    expect(again).toMatchObject({ ok: true, number: 'CMD-1001' });
  });

  it('AT-AI-06 the same customer confirms the identical cart twice within 10 min ⇒ the existing order comes back (duplicateOf)', async () => {
    const s = await shop();
    const sender = newSender();
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'OK', intent: 'SALE' });
    await turn(s, sender, 'oui');
    await resetAi();
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'Déjà enregistrée', intent: 'SALE' });
    const t = await turn(s, sender, 'oui je confirme encore');
    expect(lastResult(t.runs)).toMatchObject({ ok: true, number: 'CMD-1001', duplicateOf: 'CMD-1001' });
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(1);
    expect(await held(s)).toBe(1);
  });

  it('AT-AI-07 "annuler ma commande": a new order ⇒ cancelled through OrderEffects (its hold released); a shipped order ⇒ handoff', async () => {
    const s = await shop();
    const sender = newSender();
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
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'OK', intent: 'SALE' });
    const first = await turn(s, sender, 'oui');
    const oldId = lastResult(first.runs).orderId;
    expect(await held(s)).toBe(1);
    // 2 units wanted: possible only because the replaced order's unit is given back
    await resetAi();
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

  it('a blocked customer ⇒ CUSTOMER_BLOCKED, no order, silent handoff (04 §13); risky client with RISKY_CLIENT_POLICY=handoff ⇒ handoff', async () => {
    const s = await shop();
    await s.owner.post('/safety/blocks', { phone: '0555123456', reason: 'fraud' }).expect(201);
    fakeAi(app).script('reply', { toolCalls: [createCall(s)] }, { reply: 'Je transmets à un conseiller.', intent: 'SALE' });
    const t = await turn(s, newSender(), 'oui');
    expect(lastResult(t.runs)).toMatchObject({ ok: false, error: { code: 'CUSTOMER_BLOCKED' } });
    expect(t.conversation.status).toBe('needs_human');
    expect(await db.order.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(0);

    const r = await shop({ riskyClientBehavior: 'handoff' });
    await db.client.create({ data: { workspaceId: r.owner.workspaceId, name: 'Client risqué', phone: '0777000111', riskLevel: 'high', riskSetManually: true } });
    fakeAi(app).script('reply', { toolCalls: [createCall(r, { clientPhone: '0777000111' })] }, { reply: 'Je transmets.', intent: 'SALE' });
    const risky = await turn(r, newSender(), 'oui');
    expect(lastResult(risky.runs)).toEqual({ ok: false, hint: 'risky_client' });
    expect(risky.conversation.status).toBe('needs_human');
    expect(await db.order.count({ where: { workspaceId: r.owner.workspaceId } })).toBe(0);
  });

  it('AT-ORD-25 (AI side) after a "faux numéro" on that phone, create_order asks for the phone confirmation first', async () => {
    const s = await shop();
    const number = phone();
    const c = await db.client.create({ data: { workspaceId: s.owner.workspaceId, name: 'Ancien client', phone: number } });
    await db.order.create({ data: { workspaceId: s.owner.workspaceId, number: 'CMD-500', clientId: c.id, source: 'manual', clientName: c.name, clientPhone: number, subtotal: 1, total: 1, status: 'cancelled', cancelReason: 'fake' } });
    fakeAi(app).script('reply', { toolCalls: [createCall(s, { clientPhone: number })] }, { toolCalls: [createCall(s, { clientPhone: number, phoneConfirmed: true })] }, { reply: 'Commande enregistrée', intent: 'SALE' });
    const t = await turn(s, newSender(), 'oui');
    const results = t.runs[0]!.toolCalls.sort((a, b) => a.executedAt!.getTime() - b.executedAt!.getTime()).map((x) => x.result as any);
    expect(results[0]).toMatchObject({ ok: false, error: { code: 'PHONE_CONFIRMATION_REQUIRED', phone: number } });
    expect(results[1]).toMatchObject({ ok: true, number: 'CMD-1001' });
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
