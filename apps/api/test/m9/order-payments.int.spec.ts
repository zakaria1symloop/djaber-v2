// M9 — online payment of an order (PAY-02 / FL-10 / 04 §6) and recorded refunds (PAY-03), customer texts of the payment
// events (M3 carry-over), the AI tool `create_payment_link` (M4 carry-over). No gateway call from a request handler: the
// link's checkout is created by the `payments/order-link-create` job (simulated Chargily).
import { ToolRegistry } from '../../src/modules/ai/tools/tool-registry';
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually } from '../support/m1';
import { connectedPage, forbidNetwork, newSender, receive } from '../support/m3';
import { inTenant } from '../support/m4';
import { newOrder, seedFees } from '../support/m5';
import { checkoutIdOf, db, fakeChargily, payFake, postChargilyWebhook, runPayments, runReconcileCron } from '../support/m9';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  app = await createTestApp();
  net = forbidNetwork();
});
afterAll(async () => {
  net.restore();
  await app.close();
});

type Owner = Awaited<ReturnType<typeof asOwner>>;
/** An owner whose fee grid is seeded (orders need a served wilaya). */
const shop = async () => {
  const owner = await asOwner(app);
  await seedFees(app, owner.workspaceId);
  return owner;
};
const enableOnline = (owner: Owner) => owner.patch('/workspace', { onlinePaymentEnabled: true }).expect(200);
/** An order linked to a Messenger conversation (customer texts go there). */
const orderWithConversation = async (owner: Owner) => {
  const page = await connectedPage(owner, app);
  const { conversation } = await receive(app, page, newSender(), { text: 'Bonjour' });
  const { order } = await newOrder(owner, { conversationId: conversation.id });
  return { order, conversation };
};
const systemTexts = (conversationId: string) => db.message.findMany({ where: { conversationId, direction: 'out' }, orderBy: { createdAt: 'asc' } });

describe('order payment link (PAY-02)', () => {
  it('FEATURE_DISABLED while online payment is off; Operator 403; other workspace 404; link created by the worker, posted to the customer, paid through Chargily ⇒ paid + cash row + payment.received + customer.paymentReceived', async () => {
    const owner = await shop();
    const { order, conversation } = await orderWithConversation(owner);
    expect((await owner.get(`/orders/${order.id}`).expect(200)).body.data.actions.find((a: any) => a.key === 'payment_link')).toMatchObject({ enabled: false, reasonCode: 'FEATURE_DISABLED' });
    expect((await owner.post(`/orders/${order.id}/payment-link`, {}).expect(403)).body.error).toMatchObject({ code: 'FEATURE_DISABLED', params: { feature: 'online_payment' } });
    await enableOnline(owner);
    expect((await (await asOperator(app, owner.workspaceId)).post(`/orders/${order.id}/payment-link`, {}).expect(403)).body.error.code).toBe('FORBIDDEN');
    await (await asOwner(app)).post(`/orders/${order.id}/payment-link`, {}).expect(404);
    const view = (await owner.get(`/orders/${order.id}`).expect(200)).body.data;
    expect(view.actions.find((a: any) => a.key === 'payment_link')).toMatchObject({ enabled: true });
    expect(view.actions.find((a: any) => a.key === 'refund')).toMatchObject({ enabled: false, reasonCode: 'ORDER_NOTHING_TO_REFUND' });

    const created = (await owner.post(`/orders/${order.id}/payment-link`, {}).expect(201)).body.data;
    expect(created).toMatchObject({ orderId: order.id, amount: order.total, status: 'creating', url: null, sentToCustomer: false });
    expect((await owner.get(`/orders/${order.id}`).expect(200)).body.data).toMatchObject({ paymentStatus: 'pending_link', paymentLink: { id: created.id, status: 'creating', url: null } });
    await runPayments(app, [owner.workspaceId]);
    const link = (await owner.get(`/orders/${order.id}/payment-link`).expect(200)).body.data;
    expect(link).toMatchObject({ status: 'pending', url: expect.stringContaining('/dev-payments/'), sentToCustomer: true });
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    const texts = await systemTexts(conversation.id);
    expect(texts.map((m) => (m.payload as any)?.templateKey)).toContain('paymentLink');
    expect(texts.find((m) => (m.payload as any)?.templateKey === 'paymentLink')!.text).toContain(link.url);

    await payFake(app, link.url, 'paid');
    await runPayments(app, [owner.workspaceId]);
    const paid = (await owner.get(`/orders/${order.id}`).expect(200)).body.data;
    expect(paid).toMatchObject({ paymentStatus: 'paid', amountPaid: order.total, paymentLink: { status: 'paid' } });
    expect(paid.payments).toEqual([expect.objectContaining({ amount: order.total, method: 'card', reference: `chargily:${checkoutIdOf(link.url)}` })]);
    expect(await db.cashTransaction.count({ where: { workspaceId: owner.workspaceId, type: 'income', category: 'order', amount: order.total } })).toBe(1);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'payment_received' } })).toBeGreaterThan(0);
    expect((await systemTexts(conversation.id)).map((m) => (m.payload as any)?.templateKey)).toContain('paymentReceived');
    // replayed webhook: nothing more
    const again = await fakeChargily(app).decide(checkoutIdOf(link.url), 'paid');
    await postChargilyWebhook(app, again!.webhook!.rawBody, again!.webhook!.signature).expect(200);
    await runPayments(app, [owner.workspaceId]);
    expect((await owner.get(`/orders/${order.id}`).expect(200)).body.data.payments).toHaveLength(1);
    // nothing left to pay
    expect((await owner.post(`/orders/${order.id}/payment-link`, {}).expect(422)).body.error.code).toBe('ORDER_ALREADY_PAID');
    expect(await eventually(() => db.auditLog.count({ where: { action: 'order.payment_link', entityId: order.id } }))).toBe(1);
  });

  it('a new link expires the previous one; failed ⇒ payment.failed + customer.paymentFailed, back to unpaid; expired by the reconcile job; amount mismatch ⇒ not paid', async () => {
    const owner = await shop();
    await enableOnline(owner);
    const { order, conversation } = await orderWithConversation(owner);
    const first = (await owner.post(`/orders/${order.id}/payment-link`, { send: false }).expect(201)).body.data;
    const second = (await owner.post(`/orders/${order.id}/payment-link`, { send: false }).expect(201)).body.data;
    expect((await db.orderPayment.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('expired');
    await runPayments(app, [owner.workspaceId]);
    const l2 = (await owner.get(`/orders/${order.id}/payment-link`).expect(200)).body.data;
    expect(l2).toMatchObject({ id: second.id, status: 'pending', sentToCustomer: false });
    await payFake(app, l2.url, 'failed');
    await runPayments(app, [owner.workspaceId]);
    expect((await owner.get(`/orders/${order.id}`).expect(200)).body.data).toMatchObject({ paymentStatus: 'unpaid', paymentLink: { status: 'failed' } });
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'payment_failed' } })).toBeGreaterThan(0);
    expect((await systemTexts(conversation.id)).map((m) => (m.payload as any)?.templateKey)).toContain('paymentFailed');
    // expired: past its 15 min, the reconcile job asks the gateway once then expires it
    const third = (await owner.post(`/orders/${order.id}/payment-link`, { send: false }).expect(201)).body.data;
    await runPayments(app, [owner.workspaceId]);
    await db.orderPayment.update({ where: { id: third.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await runReconcileCron(app);
    expect((await db.orderPayment.findUniqueOrThrow({ where: { id: third.id } })).status).toBe('expired');
    expect((await owner.get(`/orders/${order.id}`).expect(200)).body.data.paymentStatus).toBe('unpaid');
    // amount mismatch on a signed event
    const fourth = (await owner.post(`/orders/${order.id}/payment-link`, { send: false }).expect(201)).body.data;
    await runPayments(app, [owner.workspaceId]);
    const l4 = await db.orderPayment.findUniqueOrThrow({ where: { id: fourth.id } });
    const ok = await fakeChargily(app).decide(l4.providerRef!, 'paid');
    await postChargilyWebhook(app, Buffer.from(ok!.webhook!.rawBody.toString().replace(/"amount":\d+/, '"amount":10').replace('"id":"evt_', '"id":"evt_x'))).expect(200);
    await runPayments(app, [owner.workspaceId]);
    expect((await db.orderPayment.findUniqueOrThrow({ where: { id: fourth.id } })).status).toBe('mismatch');
    expect((await owner.get(`/orders/${order.id}`).expect(200)).body.data).toMatchObject({ paymentStatus: 'unpaid', amountPaid: 0 });
  });
});

describe('refunds (PAY-03)', () => {
  it('nothing paid ⇒ ORDER_NOTHING_TO_REFUND (UX-060); > amount paid ⇒ 422 fields.amount; refund ⇒ refunded, negative payment entry + locked refund expense; Operator 403; audited', async () => {
    const owner = await shop();
    const { order } = await newOrder(owner);
    expect((await owner.post(`/orders/${order.id}/refunds`, { amount: 100, reason: 'Client mécontent' }).expect(422)).body.error.code).toBe('ORDER_NOTHING_TO_REFUND');
    await owner.post(`/orders/${order.id}/payments`, { amount: 3000, method: 'cash' }).set('Idempotency-Key', crypto.randomUUID()).expect(200);
    await (await asOperator(app, owner.workspaceId)).post(`/orders/${order.id}/refunds`, { amount: 100, reason: 'x y z' }).expect(403);
    const over = await owner.post(`/orders/${order.id}/refunds`, { amount: 3500, reason: 'Trop rendu' }).expect(422);
    expect(over.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { amount: 'validation.range' } });
    await owner.post(`/orders/${order.id}/refunds`, { amount: 0, reason: 'Zéro' }).expect(422);
    const admin = await asAdmin(app, owner.workspaceId);
    const r = (await admin.post(`/orders/${order.id}/refunds`, { amount: 1000, reason: 'Article abîmé' }).expect(200)).body.data;
    expect(r).toMatchObject({ paymentStatus: 'refunded', amountPaid: 2000 });
    expect(r.payments.map((p: any) => p.amount)).toEqual(expect.arrayContaining([3000, -1000]));
    expect(await db.cashTransaction.count({ where: { workspaceId: owner.workspaceId, type: 'expense', category: 'refund', amount: 1000, isAutomatic: true } })).toBe(1);
    expect(r.actions.find((a: any) => a.key === 'refund')).toMatchObject({ enabled: false, reasonCode: 'ORDER_ALREADY_REFUNDED' });
    expect((await owner.post(`/orders/${order.id}/refunds`, { amount: 100, reason: 'Encore' }).expect(422)).body.error.code).toBe('ORDER_ALREADY_REFUNDED');
    await (await asOwner(app)).post(`/orders/${order.id}/refunds`, { amount: 100, reason: 'Autre espace' }).expect(404);
    expect(await eventually(() => db.auditLog.count({ where: { action: 'order.refund', entityId: order.id } }))).toBe(1);
  });
});

describe('AI tool create_payment_link (04-ai-pipeline §4.2)', () => {
  it('offered only when online payment is on; this customer only; returns a 15-min Chargily link and reuses the open one; dry run simulated', async () => {
    const owner = await shop();
    const { order } = await newOrder(owner);
    const tools = app.app.get(ToolRegistry);
    const names = async () => (await inTenant(app, owner.workspaceId, () => tools.defsFor(owner.workspaceId))).map((d) => d.name);
    expect(await names()).not.toContain('create_payment_link');
    await enableOnline(owner);
    expect(await names()).toContain('create_payment_link');
    const agent = await db.agent.findFirst({ where: { workspaceId: owner.workspaceId } });
    const ctx = (clientId: string | null, dryRun = false) => ({ workspaceId: owner.workspaceId, agent: agent as never, conversationId: null, clientId, channelId: null, runId: '00000000-0000-4000-8000-000000000001', callId: 'c1', dryRun });
    const exec = (args: Record<string, unknown>, clientId: string | null, dryRun = false) => inTenant(app, owner.workspaceId, () => tools.execute('create_payment_link', args, ctx(clientId, dryRun)));
    expect(await exec({ orderId: order.id }, null)).toMatchObject({ ok: false, error: { code: 'ORDER_NOT_FOUND' } });
    expect(await exec({ orderId: order.id }, '00000000-0000-4000-8000-0000000000ff')).toMatchObject({ ok: false, error: { code: 'ORDER_NOT_FOUND' } });
    expect(await exec({ orderId: order.number }, order.client.id, true)).toMatchObject({ ok: true, simulated: true });
    const r = await exec({ orderId: order.number }, order.client.id);
    expect(r).toMatchObject({ ok: true, orderNumber: order.number, url: expect.stringContaining('/dev-payments/'), amount: order.total, minutes: 15 });
    expect(await exec({ orderId: order.id }, order.client.id)).toMatchObject({ ok: true, url: r.url });
    expect((await owner.get(`/orders/${order.id}`).expect(200)).body.data).toMatchObject({ paymentStatus: 'pending_link', paymentLink: { status: 'pending', url: r.url } });
  });
});
