// M7 — recommendations: stock cards (GDS-10: generate job, rate limit, reconcile / expire, apply / dismiss / snooze / mute,
// simple-mode subset), cross-sell rules (REC-01 manual rules, REC-02 "Analyse" removes stale pairs — D18, REC-03
// impressions from the AI reply and conversions from an order of the same conversation, reversed on cancel).
import { asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct, drain, jobOf } from '../support/m2';
import { connectedPage, forbidNetwork, newSender, receive } from '../support/m3';
import { answer, closeOutbox, fakeAi, linkedAgent } from '../support/m4';
import { orderBody, postOrder, seedFees, status } from '../support/m5';
import { advancedShop, db, product, sale } from '../support/m7';

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

describe('stock recommendations (GDS-10)', () => {
  it('generate ⇒ job; AT-GDS-15 twice in 10 min ⇒ RECO_RATE_LIMITED; cards (restock / price / dead stock); stale cards expire; apply / dismiss / snooze / mute', async () => {
    const owner = await advancedShop(app);
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { targetMarginPct: 35 } });
    const oud = await product(owner, { name: 'Parfum Oud', price: 4000, costPrice: 1500, stock: 6 });
    const sac = await product(owner, { name: 'Sac cuir camel', price: 41000, costPrice: 29000, stock: 1 });
    const montre = await product(owner, { name: 'Montre Classic', price: 6000, costPrice: 3000, stock: 9 });
    await db.product.update({ where: { id: montre.id }, data: { createdAt: new Date(Date.now() - 200 * 86_400_000) } });
    // 30 units of Oud sold in the last days ⇒ 1 / day ⇒ 6 days of stock < 7 days default lead time
    await db.product.update({ where: { id: oud.id }, data: { stock: 36 } });
    await sale(owner, { items: [{ productId: oud.id, quantity: 30 }], amountPaid: 120000 });
    const gen = await owner.post('/stock-recommendations/generate').expect(202);
    const second = await owner.post('/stock-recommendations/generate').expect(429);
    expect(second.body.error).toMatchObject({ code: 'RECO_RATE_LIMITED', params: { retryAfter: expect.any(Number) } });
    await drain(app, owner.workspaceId, ['job']);
    expect(await jobOf(owner, gen.body.data.jobId)).toMatchObject({ status: 'done', kind: 'recommendations', result: { kind: 'stock', created: 3 } });
    const cards = (await owner.get('/stock-recommendations').expect(200)).body.data;
    expect(cards.map((c: any) => [c.type, c.product.name])).toEqual([
      ['restock', 'Parfum Oud'],
      ['promote', 'Montre Classic'],
      ['price', 'Sac cuir camel'],
    ]);
    const restock = cards[0];
    expect(restock).toMatchObject({ priority: 'high', rule: 'restock_lead_time', ruleLabel: 'STOCK / VITESSE < DÉLAI FOURNISSEUR', suggestedAction: { kind: 'create_purchase', label: 'Commander 30 u', params: { productId: oud.id, quantity: 30 } }, estimatedValue: 45000 });
    expect(restock.body).toContain('rupture dans ~6 jours');
    expect(cards[2].suggestedAction).toMatchObject({ kind: 'update_price', params: { from: 41000, price: 44600 } });
    const stats = (await owner.get('/stock-recommendations/stats').expect(200)).body.data;
    expect(stats).toMatchObject({ active: 3, highPriority: 1, restock: { count: 1, estimatedValue: 45000 }, promote: { count: 1 }, lastRun: { jobId: gen.body.data.jobId, status: 'done' } });
    expect(stats.regenerateAvailableIn).toBeGreaterThan(0);

    const applied = await owner.post(`/stock-recommendations/${restock.id}/apply`, { refType: 'purchase' }).expect(200);
    expect(applied.body.data).toMatchObject({ status: 'applied', applied: { refType: 'purchase' } });
    const snoozed = await owner.post(`/stock-recommendations/${cards[1].id}/snooze`, {}).expect(200);
    expect(snoozed.body.data.status).toBe('snoozed');
    await owner.post('/stock-recommendations/mute', { productId: sac.id, type: 'price' }).expect(204);
    expect((await owner.get('/stock-recommendations').expect(200)).body.data).toHaveLength(0);
    expect((await owner.get('/stock-recommendations/history?status=applied,dismissed').expect(200)).body.meta.total).toBe(2);

    // the margin is fixed: the next run expires nothing muted, keeps the snoozed card, creates nothing for the applied one
    await owner.patch(`/products/${sac.id}`, { price: 50000, version: (await db.product.findUniqueOrThrow({ where: { id: sac.id } })).version }).expect(200);
    await owner.delete(`/stock-recommendations/mute?productId=${sac.id}&type=price`).expect(204);
    await app.app.get((await import('../../src/core/redis/redis.provider')).RedisService).client.del(`reco:stock:${owner.workspaceId}`);
    await owner.post('/stock-recommendations/generate').expect(202);
    await drain(app, owner.workspaceId, ['job']);
    expect(await db.stockRecommendation.count({ where: { workspaceId: owner.workspaceId, status: 'snoozed' } })).toBe(1);
    expect(await db.stockRecommendation.count({ where: { workspaceId: owner.workspaceId, ruleKey: 'margin_below_target', status: 'active' } })).toBe(0);
    // snooze over ⇒ back in the list; a card that no longer fires expires (D18)
    await db.stockRecommendation.updateMany({ where: { workspaceId: owner.workspaceId, status: 'snoozed' }, data: { snoozedUntil: new Date(Date.now() - 1000) } });
    expect((await owner.get('/stock-recommendations').expect(200)).body.data.map((c: any) => c.type)).toEqual(['promote']);
    await sale(owner, { items: [{ productId: montre.id, quantity: 1 }], amountPaid: 6000 });
    await app.app.get((await import('../../src/core/redis/redis.provider')).RedisService).client.del(`reco:stock:${owner.workspaceId}`);
    const third = await owner.post('/stock-recommendations/generate').expect(202);
    await drain(app, owner.workspaceId, ['job']);
    expect((await jobOf(owner, third.body.data.jobId)).result).toMatchObject({ expired: 1 });
    expect((await owner.get('/stock-recommendations').expect(200)).body.data).toHaveLength(0);
  });

  it('simple mode shows only restock / stockout / agent cards; operators read but cannot act', async () => {
    const owner = await asOwner(app);
    const sac = await createProduct(owner, { name: 'Sac', price: 41000, costPrice: 29000, stock: 1 });
    await db.stockRecommendation.create({ data: { workspaceId: owner.workspaceId, type: 'price', priority: 'medium', productId: sac.id, ruleKey: 'margin_below_target', title: { fr: 'Sac' }, body: { fr: 'x' }, suggestedAction: { kind: 'update_price', params: { price: 44600 } } } });
    expect((await owner.get('/stock-recommendations').expect(200)).body.data).toHaveLength(0);
    const op = await asOperator(app, owner.workspaceId);
    await op.get('/stock-recommendations/stats').expect(200);
    await op.post('/stock-recommendations/generate').expect(403);
    const other = await asOwner(app);
    const reco = await db.stockRecommendation.findFirstOrThrow({ where: { workspaceId: owner.workspaceId } });
    await other.post(`/stock-recommendations/${reco.id}/dismiss`).expect(404);
  });
});

describe('cross-sell rules (REC-01…03)', () => {
  it('REC-01 manual rule CRUD (pair unique, same product refused); REC-02 "Analyse" creates co-purchase pairs and removes stale ones, keeps manual rules (D18)', async () => {
    const owner = await advancedShop(app, { fees: true });
    const robe = await product(owner, { name: 'Robe', price: 4000, stock: 50 });
    const sac = await product(owner, { name: 'Sac', price: 3000, stock: 50 });
    const gants = await product(owner, { name: 'Gants', price: 900, stock: 50 });
    const rule = await owner.post('/recommendations', { productId: robe.id, recommendedId: gants.id, type: 'cross_sell', score: 80, reason: 'Assortis' }).expect(201);
    expect(rule.body.data).toMatchObject({ source: 'manual', score: 80, reason: 'Assortis', impressions: 0, conversions: 0, conversionRatePct: null });
    // journeys 16/11 J11-5: the duplicate says what it is and hands the existing rule to the dialog
    const dup = (await owner.post('/recommendations', { productId: robe.id, recommendedId: gants.id }).expect(409)).body.error;
    expect(dup).toMatchObject({ code: 'RECOMMENDATION_ALREADY_EXISTS', params: { product: 'Robe', recommended: 'Gants' }, details: { recommendation: { id: rule.body.data.id } } });
    expect((await owner.post('/recommendations', { productId: robe.id, recommendedId: gants.id, score: -1 }).expect(422)).body.error.fields).toMatchObject({ score: 'validation.range' });
    expect((await owner.post('/recommendations', { productId: robe.id, recommendedId: robe.id }).expect(422)).body.error.fields).toEqual({ recommendedId: 'validation.invalid' });
    for (let i = 0; i < 2; i++) await postOrder(owner, orderBody(robe.id, { items: [{ productId: robe.id, quantity: 1 }, { productId: sac.id, quantity: 1 }] })).expect(201);
    const job = await owner.post('/recommendations/generate').expect(202);
    expect((await owner.post('/recommendations/generate').expect(429)).body.error.code).toBe('RECO_RATE_LIMITED');
    await drain(app, owner.workspaceId, ['job']);
    expect((await jobOf(owner, job.body.data.jobId)).result).toMatchObject({ kind: 'cross_sell', created: 2, removed: 0 });
    const list = (await owner.get('/recommendations?source=rules').expect(200)).body.data;
    expect(list.map((r: any) => [r.product.name, r.recommended.name, r.score, r.reason]).sort()).toEqual([
      ['Robe', 'Sac', 60, 'Achetés ensemble 2 fois'],
      ['Sac', 'Robe', 60, 'Achetés ensemble 2 fois'],
    ]);
    // the pairs no longer fire (orders cancelled) ⇒ removed by the next run; the manual rule stays
    for (const o of await db.order.findMany({ where: { workspaceId: owner.workspaceId } })) await db.order.update({ where: { id: o.id }, data: { status: 'cancelled' } });
    await app.app.get((await import('../../src/core/redis/redis.provider')).RedisService).client.del(`reco:xsell:${owner.workspaceId}`);
    const again = await owner.post('/recommendations/generate').expect(202);
    await drain(app, owner.workspaceId, ['job']);
    expect((await jobOf(owner, again.body.data.jobId)).result).toMatchObject({ removed: 2 });
    expect((await owner.get('/recommendations').expect(200)).body.data.map((r: any) => r.id)).toEqual([rule.body.data.id]);
    const off = await owner.patch(`/recommendations/${rule.body.data.id}`, { isActive: false }).expect(200);
    expect(off.body.data.actions.map((a: any) => a.key)).toEqual(['edit', 'activate', 'delete']);
    const stats = (await owner.get('/recommendations/stats').expect(200)).body.data;
    expect(stats).toMatchObject({ rules: 1, active: 0, manual: 1, generated: 0 });
    const op = await asOperator(app, owner.workspaceId);
    await op.get('/recommendations').expect(200);
    await op.post('/recommendations', { productId: robe.id, recommendedId: sac.id }).expect(403);
    const other = await asOwner(app);
    await other.patch(`/recommendations/${rule.body.data.id}`, { score: 1 }).expect(404);
    await other.delete(`/recommendations/${rule.body.data.id}`).expect(404);
    await owner.delete(`/recommendations/${rule.body.data.id}`).expect(204);
  });

  it('REC-03 impression when the AI shows the suggestion; conversion when the product is ordered in the same conversation within 7 days; reversed on cancel', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const page = await connectedPage(owner, app);
    await linkedAgent(owner.workspaceId, [page.id]);
    const robe = await createProduct(owner, { name: 'Robe satin', price: 4500, stock: 10 });
    const sac = await createProduct(owner, { name: 'Sac assorti', price: 3000, stock: 10 });
    const rule = (await owner.post('/recommendations', { productId: robe.id, recommendedId: sac.id }).expect(201)).body.data;
    fakeAi(app).reset();
    fakeAi(app).script('reply', { reply: 'La robe est à 4500 DA. Le sac assorti va très bien avec !', intent: 'SALE', productCards: [robe.id], recommendations: [{ sourceId: robe.id, recommendedId: sac.id }, { sourceId: robe.id, recommendedId: 'not-a-product' }] });
    const sender = newSender();
    const { conversation } = await receive(app, page, sender, { text: 'Bonjour, la robe satin ?' });
    await answer(app, owner.workspaceId, conversation.id);
    expect(await db.recommendationEvent.count({ where: { recommendationId: rule.id, kind: 'impression', conversationId: conversation.id } })).toBe(1);
    expect((await db.recommendation.findUniqueOrThrow({ where: { id: rule.id } })).impressions).toBe(1);
    const o = await postOrder(owner, orderBody(robe.id, { conversationId: conversation.id, items: [{ productId: robe.id, quantity: 1 }, { productId: sac.id, quantity: 1 }] })).expect(201);
    let r = await db.recommendation.findUniqueOrThrow({ where: { id: rule.id } });
    expect(r).toMatchObject({ conversions: 1, revenue: 3000 });
    // an order elsewhere (no conversation) never converts
    await postOrder(owner, orderBody(sac.id, { items: [{ productId: sac.id, quantity: 1 }] })).expect(201);
    expect((await db.recommendation.findUniqueOrThrow({ where: { id: rule.id } })).conversions).toBe(1);
    await status(owner, o.body.data, 'cancelled', { reason: 'changed_mind' }).expect(200);
    r = await db.recommendation.findUniqueOrThrow({ where: { id: rule.id } });
    expect(r).toMatchObject({ impressions: 1, conversions: 0, revenue: 0 });
    // an impression older than 7 days does not convert
    await db.recommendationEvent.updateMany({ where: { recommendationId: rule.id }, data: { at: new Date(Date.now() - 8 * 86_400_000) } });
    await postOrder(owner, orderBody(sac.id, { conversationId: conversation.id, items: [{ productId: sac.id, quantity: 1 }] })).expect(201);
    expect((await db.recommendation.findUniqueOrThrow({ where: { id: rule.id } })).conversions).toBe(0);
    expect((await owner.get('/recommendations/stats').expect(200)).body.data).toMatchObject({ impressions30d: 1, conversions30d: 0, revenue30d: 0 });
  });
});
