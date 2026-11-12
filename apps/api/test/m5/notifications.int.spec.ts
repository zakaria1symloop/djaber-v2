// M5 — notification preferences, e-mail / push fan-out (NTF-01…03, 03 §15 matrix) and the Home dashboard (ANA-01).
import { NOTIFICATION_CHANNELS, NotificationTypeValues } from '@djaber/shared';
import { TenantContext, type NotificationType, type Tx } from '@djaber/db';
import { NotificationProducer } from '../../src/modules/notifications/notification.producer';
import { asOperator, asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { mailsTo } from '../support/m1';
import { createProduct, drain } from '../support/m2';
import { connectedPage, forbidNetwork, newSender, receive, work } from '../support/m3';
import { closeOutbox } from '../support/m4';
import { db, fakePush, newOrder, seedFees } from '../support/m5';

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
beforeEach(() => fakePush(app).reset());

const emailOf = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId } })).email;
const device = (actor: Actor, token: string) => actor.post('/me/devices', { token, platform: 'android', appVersion: '2.1.0', locale: 'fr' }).expect(200);
/** One notification of `type` to `actor`, delivered as the relay would (in-app row → e-mail / push channels → push job). */
const fire = async (actor: Actor, type: NotificationType, data: Record<string, unknown>) => {
  const producer = app.app.get(NotificationProducer);
  await TenantContext.runAs(actor.workspaceId, () => db.$transaction((tx) => producer.emit(tx as unknown as Tx, { type, workspaceId: actor.workspaceId, userIds: [actor.userId], data, key: `${type}:${Math.random()}` })));
  await drain(app, actor.workspaceId);
};
const sample = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, k === 'total' ? '4 900 DA' : `<${k}>`]));

describe('preferences (NTF-02)', () => {
  it('one row per NotificationType with the matrix modes; only `pref` cells change', async () => {
    const owner = await asOwner(app);
    const list = await owner.get('/notification-preferences').expect(200);
    expect(list.body.data).toHaveLength(NotificationTypeValues.length);
    expect(list.body.data.find((p: any) => p.type === 'stock_low')).toMatchObject({ group: 'stock', inApp: true, email: true, push: false, emailMode: 'pref', pushMode: 'never' });
    const r = await owner.put('/notification-preferences', { preferences: [{ type: 'stock_low', email: false, sound: true }, { type: 'ai_error', email: false }] }).expect(200);
    expect(r.body.data.find((p: any) => p.type === 'stock_low')).toMatchObject({ email: false, sound: true });
    expect(r.body.data.find((p: any) => p.type === 'ai_error')).toMatchObject({ email: true, emailMode: 'always' }); // ● cannot be turned off
    expect((await owner.put('/notification-preferences', { preferences: [{ type: 'nope', email: false }] }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('fan-out (03 §15 matrix)', () => {
  it('AT-NTF-01 every type fires exactly the channels of its row (preferences at their default)', async () => {
    const owner = await asOwner(app);
    await device(owner, `tok-${owner.userId}`);
    const { NOTIFICATION_PARAMS } = await import('../../src/modules/notifications/notification.catalog');
    const email = await emailOf(owner.userId);
    for (const type of NotificationTypeValues.filter((t) => NOTIFICATION_CHANNELS[t].inApp)) {
      const before = { mails: (await mailsTo(app, email, 'notification')).length, push: fakePush(app).sent.length };
      await fire(owner, type, sample(NOTIFICATION_PARAMS[type]));
      const c = NOTIFICATION_CHANNELS[type];
      expect([type, await db.notification.count({ where: { userId: owner.userId, type } })]).toEqual([type, 1]);
      const mails = (await mailsTo(app, email, 'notification')).length - before.mails;
      expect([type, 'email', mails]).toEqual([type, 'email', c.email === 'never' ? 0 : 1]);
      const push = fakePush(app).sent.length - before.push;
      expect([type, 'push', push]).toEqual([type, 'push', c.push === 'never' ? 0 : 1]);
    }
  });

  it('AT-NTF-04 e-mail off for stock.low ⇒ in-app only; the e-mail carries title, body and the deep link', async () => {
    const owner = await asOwner(app);
    const email = await emailOf(owner.userId);
    await fire(owner, 'stock_low', { product: 'Robe', stock: 2, min: 5, productId: 'p' });
    const [mail] = await mailsTo(app, email, 'notification');
    expect(mail).toMatchObject({ subject: 'Stock faible : Robe (2 restants)', params: expect.objectContaining({ url: expect.stringContaining('/fr/products?lowStock=1'), type: 'stock_low' }) });
    await owner.put('/notification-preferences', { preferences: [{ type: 'stock_low', email: false }] }).expect(200);
    const before = (await mailsTo(app, email, 'notification')).length;
    await fire(owner, 'stock_low', { product: 'Sac', stock: 1, min: 5, productId: 'q' });
    expect((await mailsTo(app, email, 'notification')).length).toBe(before);
    expect(await db.notification.count({ where: { userId: owner.userId, type: 'stock_low' } })).toBe(2);
  });

  it('AT-NTF-05 an invalid FCM token is pruned after the failure; 21st device ⇒ 422 DEVICE_LIMIT; DELETE frees a slot', async () => {
    const owner = await asOwner(app);
    await device(owner, 'good-token-123');
    await device(owner, 'dead-token-456');
    fakePush(app).invalidTokens.add('dead-token-456');
    await fire(owner, 'order_assigned', { orderId: 'o', number: 'CMD-1001' });
    expect(fakePush(app).sent.map((m) => m.token)).toEqual(['good-token-123']);
    expect(fakePush(app).sent[0]).toMatchObject({ data: { type: 'order_assigned', path: '/orders/o', workspaceId: owner.workspaceId } });
    expect(await db.deviceToken.findUnique({ where: { token: 'dead-token-456' } })).toBeNull();
    for (let i = 0; i < 19; i++) await device(owner, `extra-token-${i}-${owner.userId}`);
    expect((await owner.post('/me/devices', { token: 'one-too-many-xyz', platform: 'ios', appVersion: '2.1.0', locale: 'fr' }).expect(422)).body.error).toMatchObject({ code: 'DEVICE_LIMIT', params: { max: 20 } });
    await owner.delete('/me/devices/good-token-123').expect(204);
    await device(owner, 'one-too-many-xyz');
  });

  it('AT-NTF-02 a customer writes 3× in 5 min into a needs-human conversation ⇒ one push', async () => {
    const owner = await asOwner(app);
    await device(owner, `nh-${owner.userId}`);
    const page = await connectedPage(owner, app);
    const sender = newSender();
    const { conversation } = await receive(app, page, sender, { text: 'Bonjour' });
    await db.conversation.update({ where: { id: conversation.id }, data: { status: 'needs_human', aiPaused: true } });
    for (const text of ['allo ?', 'vous êtes là ?', 'svp']) await receive(app, page, sender, { text });
    await work(app, [owner.workspaceId]);
    expect(await db.notification.count({ where: { userId: owner.userId, type: 'conversation_needs_human_message' } })).toBe(1);
    expect(fakePush(app).sent.filter((m) => m.data.type === 'conversation_needs_human_message')).toHaveLength(1);
  });

  it('M1 carry-over: `member.role_changed` now also e-mails the member (03 §15: e-mail ●)', async () => {
    const owner = await asOwner(app);
    const op = await asOperator(app, owner.workspaceId);
    const membership = await db.membership.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, userId: op.userId } });
    await owner.patch(`/workspace/members/${membership.id}`, { role: 'admin' }).expect(200);
    await drain(app, owner.workspaceId);
    const mails = await mailsTo(app, await emailOf(op.userId), 'notification');
    expect(mails[0]?.params).toMatchObject({ type: 'member_role_changed' });
  });
});

describe('Home (ANA-01)', () => {
  it('AT-ANA-01 / AT-ORD-10 KPIs are the named figures; À traiter lists needs-human, failed parcels, low stock, reconnect, callbacks', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const op = await asOperator(app, owner.workspaceId);
    const p = await createProduct(owner, { name: 'Robe', price: 1600, stock: 2, minStock: 1 });
    // sale 1000 + delivered order 2000 + pending order 500 ⇒ Revenue 3000, Pipeline 500
    await db.sale.create({ data: { workspaceId: owner.workspaceId, number: 'VNT-H-1', status: 'completed', subtotal: 1000, total: 1000, amountPaid: 1000, paymentStatus: 'paid', createdById: owner.userId } });
    const delivered = await newOrder(owner, {}, p); // 1600 + 400 = 2000
    await owner.post(`/orders/${delivered.order.id}/deliver`, {}).expect(200);
    const svc = await createProduct(owner, { name: 'Service', price: 100, trackStock: false, stock: null });
    const pending = await newOrder(owner, {}, svc); // 100 + 400 = 500
    await db.order.update({ where: { id: pending.order.id }, data: { confirmationStatus: 'callback', callbackAt: new Date(Date.now() - 60_000) } });
    const failedOrder = await newOrder(owner, { status: 'confirmed' }, svc);
    await db.shipment.create({ data: { workspaceId: owner.workspaceId, orderId: failedOrder.order.id, provider: 'manual', status: 'failed', failureReason: 'unreachable', publicTrackingToken: `f-${failedOrder.order.id}`, codAmount: 1 } });
    await db.order.update({ where: { id: failedOrder.order.id }, data: { status: 'cancelled' } }); // keep the pipeline at 500
    const page = await connectedPage(owner, app);
    const sender = newSender();
    await receive(app, page, sender, { text: 'Bonjour' });
    await receive(app, page, sender, { text: 'la robe est dispo ?' });
    await db.channel.update({ where: { id: page.id }, data: { status: 'needs_reconnect' } });
    const home = await op.get('/dashboard/home').expect(200);
    const h = home.body.data;
    expect(h.kpis.revenue30d.value).toBe(3000);
    expect(h.kpis.pipeline).toBe(500);
    expect(h.kpis.aiRevenue30d.value).toBe(0);
    expect(h.kpis.cashCollected30d).toBe(2000);
    expect(h.kpis.products).toMatchObject({ total: 2, lowStock: 1 });
    expect(h.queue.counts).toMatchObject({ parcel: 1, stock: 1, page: 1, callback: 1 });
    expect(h.queue.items[0].urgency).toBe(0);
    // UX-063: the line under the Revenue tile counts what the amount is made of (1 delivered order + 1 counter sale)
    expect(h.kpis.revenueSources30d).toEqual({ deliveredOrders: 1, sales: 1 });
    // UX-062: the STOCK card is as old as the movement that brought "Robe" to its threshold (2 → 1, min 1), not "now"
    const crossing = await db.stockMovement.findFirstOrThrow({ where: { productId: p.id, quantityBefore: 2, quantityAfter: 1 } });
    expect(h.queue.items.find((i: any) => i.kind === 'stock').since).toBe(crossing.createdAt.toISOString());
    expect(h.banners.map((b: any) => b.kind)).toContain('reconnect');
    expect(h.pages[0]).toMatchObject({ id: page.id, status: 'needs_reconnect', conversations: { total: 1, active: 1 }, messages7d: { inbound: 2 } });
    expect(h.pages[0].messages7d.total).toBeGreaterThanOrEqual(2);
    expect(Date.parse(h.pages[0].connectedAt)).toBeLessThanOrEqual(Date.now());
    expect(h.getStarted).toMatchObject({ checklist: { order: true, product: true }, total: 4 });
    expect(h.quickActions.find((a: any) => a.key === 'add_product')).toMatchObject({ enabled: false, reasonCode: 'FORBIDDEN' });
    // the orders list uses the same figure for its delivered revenue
    expect((await owner.get('/orders/stats').expect(200)).body.data.revenue30d).toBe(2000);
  });
});
