// M8 — Analytics (ANA-02, 04 §4, §8, 11 §7, 12 §24): overview + 8 tabs, period rules, comparison, named money figures
// identical to the home and the reports (AT-ORD-10), DailyStat rollup (recomputed, never incremented) + live today,
// roles / tenancy, and the M8 carry-overs (channel "Résolution IA", insights counts, home handled cards).
import { ANALYTICS_TABS } from '@djaber/shared';
import { asAdmin, asOperator, asOwner, anonymous } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { orderBody, postOrder, status } from '../support/m5';
import { advancedShop, product, sale } from '../support/m7';
import { DailyStatsService } from '../../src/modules/analytics/daily-stats.service';
import { METRICS_VERSION } from '../../src/modules/analytics/day-metrics';
import { addDays } from '../../src/modules/analytics/range';
import { agent, aiRun, at, channel, conversation, creditDebit, daysAgo, db, message, order, shipment, todayAlgiers } from '../support/m8';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const get = async (actor: { get: (u: string) => any }, url: string, code = 200) => (await actor.get(url).expect(code)).body;

describe('AT-ORD-10 named figures — identical in home, analytics and reports', () => {
  it('sale 1000 + delivered order 2000 + pending order 500 ⇒ Revenue 3000, Pipeline 500, AI revenue only AI orders', async () => {
    const owner = await advancedShop(app, { fees: true });
    const p = await product(owner, { price: 1000, stock: 50 });
    await sale(owner, { items: [{ productId: p.id, quantity: 1 }], amountPaid: 1000 });
    const delivered = await postOrder(owner, orderBody(p.id, { items: [{ productId: p.id, quantity: 2, unitPrice: 800 }] })).expect(201);
    await owner.patch(`/orders/${delivered.body.data.id}`, { version: delivered.body.data.version, deliveryFee: 400 }).expect(200);
    const d = (await owner.get(`/orders/${delivered.body.data.id}`).expect(200)).body.data;
    await status(owner, d, 'delivered').expect(200);
    const pending = await postOrder(owner, orderBody(p.id, { items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] })).expect(201);
    expect(pending.body.data.total).toBe(500);

    const home = (await get(owner, '/dashboard/home')).data;
    const overview = (await get(owner, '/analytics/overview?period=30d')).data;
    const orders = (await get(owner, '/analytics/orders?period=30d')).data;
    const report = (await get(owner, '/reports/sales_by_period?period=30d')).data;
    for (const v of [home.kpis.revenue30d.value, overview.kpis.revenue.value, orders.kpis.revenue.value, report.totals.revenue, report.kpis.find((k: any) => k.key === 'revenue').value]) expect(v).toBe(3000);
    for (const v of [home.kpis.pipeline, overview.kpis.pipeline.value, orders.kpis.pipeline.value]) expect(v).toBe(500);
    for (const v of [home.kpis.aiRevenue30d.value, overview.kpis.aiRevenue.value, orders.kpis.aiRevenue.value]) expect(v).toBe(0);
    expect(overview.kpis.revenue).toMatchObject({ figure: 'revenue', unit: 'money', hint: { salesCount: 1, deliveredOrders: 1, salesRevenue: 1000, ordersRevenue: 2000 } });
    expect(overview.kpis.netRevenue).toMatchObject({ value: 2600, figure: 'net_revenue' });
    expect(overview.kpis.pipeline).toEqual({ value: 500, unit: 'money', figure: 'pipeline' });
    expect(overview.kpis.cashCollected.value).toBe(home.kpis.cashCollected30d);
    // UX-052 (10/11): the 1 000 DA paid on the counter sale is « encaissé » too
    expect(overview.kpis.cashCollected.hint).toMatchObject({ sales: 1000 });
    expect(home.kpis.cashCollected30d).toBe(1000 + overview.kpis.cashCollected.hint.orders);
    expect(report.totals.netRevenue).toBe(2600);

    // the delivered order turns out to be an AI order ⇒ AI revenue = 2000 everywhere
    await db.order.update({ where: { id: d.id }, data: { source: 'ai' } });
    const home2 = (await get(owner, '/dashboard/home')).data;
    const overview2 = (await get(owner, '/analytics/overview?period=30d')).data;
    expect(home2.kpis.aiRevenue30d.value).toBe(2000);
    expect(overview2.kpis.aiRevenue.value).toBe(2000);
    expect(overview2.kpis.revenue.value).toBe(3000);
  });
});

describe('period rules (AT-ANA-02, 11 §7)', () => {
  it('733 days ⇒ REPORT_RANGE_TOO_LONG; 732 accepted; custom without dates ⇒ REPORT_CUSTOM_RANGE_REQUIRED; end before start ⇒ INVALID_DATE_RANGE; unknown key ⇒ 422; unknown tab ⇒ 404', async () => {
    const owner = await asOwner(app);
    const to = todayAlgiers();
    expect((await get(owner, `/analytics/overview?from=${addDays(to, -732)}&to=${to}`, 422)).error.code).toBe('REPORT_RANGE_TOO_LONG');
    const ok = (await get(owner, `/analytics/orders?from=${addDays(to, -731)}&to=${to}`)).data;
    expect(ok.range).toMatchObject({ period: 'custom', days: 732, to, compare: 'previous', timezone: 'Africa/Algiers' });
    expect((await get(owner, '/analytics/overview?period=custom', 422)).error.code).toBe('REPORT_CUSTOM_RANGE_REQUIRED');
    expect((await get(owner, `/analytics/overview?from=${to}`, 422)).error.code).toBe('REPORT_CUSTOM_RANGE_REQUIRED');
    const inv = (await get(owner, `/analytics/overview?from=${to}&to=${addDays(to, -3)}`, 422)).error;
    expect(inv).toMatchObject({ code: 'INVALID_DATE_RANGE', fields: { to: 'validation.date' } });
    expect((await get(owner, '/analytics/overview?foo=1', 422)).error.code).toBe('VALIDATION_ERROR');
    expect((await get(owner, '/analytics/overview?period=week', 422)).error.code).toBe('VALIDATION_ERROR');
    expect((await get(owner, '/analytics/sales', 404)).error.code).toBe('NOT_FOUND');
  });

  it('presets resolve to Africa/Algiers days; previous = same length before; compare=none hides every delta', async () => {
    const owner = await asOwner(app);
    const today = todayAlgiers();
    const r7 = (await get(owner, '/analytics/overview?period=7d')).data.range;
    expect(r7).toMatchObject({ from: addDays(today, -6), to: today, days: 7, previous: { from: addDays(today, -13), to: addDays(today, -7) }, includesToday: true });
    const lm = (await get(owner, '/analytics/overview?period=last_month')).data.range;
    expect(lm.from.slice(8)).toBe('01');
    expect(lm.includesToday).toBe(false);
    const def = (await get(owner, '/analytics/overview')).data.range;
    expect(def).toMatchObject({ period: '30d', days: 30 });
    const none = (await get(owner, '/analytics/orders?compare=none')).data;
    expect(none.range.previous).toBeNull();
    expect(none.kpis.orders).not.toHaveProperty('previous');
    expect(none.kpis.orders).not.toHaveProperty('deltaPct');
    expect(none.kpis.confirmationRate).not.toHaveProperty('deltaPts');
    expect(none.series.points[0].previous).toBeNull();
  });
});

describe('tabs, roles, tenancy', () => {
  it('every tab answers for owner / admin / operator (analytics.read), 401 without a session; empty workspace ⇒ empty + hasChannels false', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const op = await asOperator(app, owner.workspaceId);
    for (const tab of ANALYTICS_TABS) {
      const body = (await get(owner, `/analytics/${tab}?period=7d`)).data;
      expect(body).toMatchObject({ empty: true, hasChannels: false, range: { days: 7 } });
      expect(Object.keys(body.kpis).length).toBeGreaterThan(0);
      if (body.series) expect(body.series.points).toHaveLength(7);
      await admin.get(`/analytics/${tab}`).expect(200);
      await op.get(`/analytics/${tab}`).expect(200);
      await anonymous(app).get(`/analytics/${tab}`).expect(401);
    }
  });

  it('channelId filter: figures of that page only; a page of another workspace ⇒ 404', async () => {
    const owner = await asOwner(app);
    const a = await channel(owner.workspaceId, owner.userId);
    const b = await channel(owner.workspaceId, owner.userId);
    const today = todayAlgiers();
    await order(owner.workspaceId, { total: 3000, status: 'delivered', source: 'ai', orderedAt: at(today, 0), deliveredAt: new Date(), channelId: a.id });
    await order(owner.workspaceId, { total: 7000, status: 'delivered', source: 'ai', orderedAt: at(today, 0), deliveredAt: new Date(), channelId: b.id });
    const all = (await get(owner, '/analytics/orders?period=today')).data;
    expect(all.kpis.revenue.value).toBe(10000);
    const onlyA = (await get(owner, `/analytics/orders?period=today&channelId=${a.id}`)).data;
    expect(onlyA.kpis.revenue.value).toBe(3000);
    expect(onlyA.range).toMatchObject({ channelId: a.id, source: { rollupDays: 0 } });
    expect(onlyA.kpis.pipeline.value).toBe(0);
    const other = await asOwner(app);
    await other.get(`/analytics/orders?channelId=${a.id}`).expect(404);
    // tenancy: the other workspace sees nothing of these orders
    expect((await get(other, '/analytics/orders?period=today')).data.kpis.revenue.value).toBe(0);
  });
});

describe('DailyStat rollup (sched-daily-stats) + live today', () => {
  it('past days come from the rollup, today is live, figures are identical before and after; a rerun overwrites (never increments)', async () => {
    const owner = await asOwner(app);
    const ws = owner.workspaceId;
    const ch = await channel(ws, owner.userId);
    const d3 = daysAgo(3);
    const d1 = daysAgo(1);
    await order(ws, { total: 5000, status: 'delivered', orderedAt: at(d3), confirmedAt: at(d3, 11), shippedAt: at(d3, 12), deliveredAt: at(d1), channelId: ch.id, wilayaId: 16, deliveryFee: 500 });
    await order(ws, { total: 2500, status: 'cancelled', orderedAt: at(d3), cancelledAt: at(d3, 15), cancelReason: 'fake', wilayaId: 16 });
    await order(ws, { total: 1200, status: 'new', orderedAt: at(todayAlgiers(), 0) });
    const conv = await conversation(ws, ch.id, at(d3));
    await message(ws, conv.id, at(d3), { direction: 'in', author: 'customer' });
    await message(ws, conv.id, at(d3, 11), { direction: 'out', author: 'ai' });

    const before = (await get(owner, '/analytics/orders?period=7d')).data;
    expect(before.range.source).toEqual({ rollupDays: 0, liveDays: 7 });
    expect(before.kpis).toMatchObject({ orders: { value: 3 }, delivered: { value: 1 }, revenue: { value: 5000 }, netRevenue: { value: 4500 } });
    expect(before.kpis.cancelledPct.value).toBe(33.3);
    expect(before.kpis.cancelledPct.hint).toMatchObject({ cancelled: 1, wrongNumberPct: 33.3 });
    expect(before.cancelReasons).toEqual([{ reason: 'fake', count: 1, pct: 100 }]);
    expect(before.wilayas[0]).toMatchObject({ wilayaId: 16, code: '16', orders: 2, delivered: 1, deliveredPct: 50 });

    const stats = app.app.get(DailyStatsService);
    const first = await stats.rollupWorkspace(ws, d1);
    expect(first.written).toBeGreaterThanOrEqual(3);
    const rows = await db.dailyStat.findMany({ where: { workspaceId: ws } });
    expect(rows.find((r) => r.day.toISOString().slice(0, 10) === d3)?.metrics).toMatchObject({ v: METRICS_VERSION, orders: { created: 2, cancelled: 1 }, conv: { created: 1 } });
    const after = (await get(owner, '/analytics/orders?period=7d')).data;
    // d3 … d1 come from the rollup (the backfill starts at the first activity); the days before it and today are live
    expect(after.range.source).toEqual({ rollupDays: 3, liveDays: 4 });
    expect(after.kpis).toEqual(before.kpis);
    expect(after.series).toEqual(before.series);

    // rerun ⇒ same rows, same values (overwrite); a change in the data is picked up by the next run
    await stats.rollupWorkspace(ws, d1);
    expect(await db.dailyStat.count({ where: { workspaceId: ws } })).toBe(rows.length);
    expect((await get(owner, '/analytics/orders?period=7d')).data.kpis).toEqual(before.kpis);
    await db.order.updateMany({ where: { workspaceId: ws, status: 'cancelled' }, data: { status: 'new', cancelledAt: null, cancelReason: null } });
    await stats.rollupWorkspace(ws, d1);
    const changed = (await get(owner, '/analytics/orders?period=7d')).data;
    expect(changed.kpis.cancelledPct.value).toBe(0);
    expect(changed.kpis.orders.value).toBe(3);

    // the cron schedules one deterministic job per workspace (yesterday)
    const scheduled = await stats.scheduleAll();
    expect(scheduled.day).toBe(d1);
  });

  it('comparison: previous period figures and deltas (pct for counts, pts for rates)', async () => {
    const owner = await asOwner(app);
    const ws = owner.workspaceId;
    for (let i = 0; i < 2; i++) await order(ws, { total: 1000, status: 'delivered', orderedAt: at(daysAgo(10)), confirmedAt: at(daysAgo(10)), deliveredAt: at(daysAgo(10)) });
    for (let i = 0; i < 3; i++) await order(ws, { total: 1000, status: 'confirmed', orderedAt: at(daysAgo(2)), confirmedAt: at(daysAgo(2)) });
    const v = (await get(owner, '/analytics/orders?period=7d')).data;
    expect(v.kpis.orders).toMatchObject({ value: 3, previous: 2, deltaPct: 50 });
    expect(v.kpis.confirmationRate).toMatchObject({ value: 100, previous: 100, deltaPts: 0 });
    expect(v.kpis.revenue).toMatchObject({ value: 0, previous: 2000, deltaPct: -100 });
    const point = v.series.points.find((p: any) => p.day === daysAgo(2));
    expect(point.values.manual).toBe(3);
    expect(point.previousDay).toBe(daysAgo(9));
  });
});

describe('tab contents', () => {
  it('conversations + responses + consumption: AI handled %, response times, languages, peak hours, reactions, credits by type, cost = tokens × model prices', async () => {
    const owner = await asOwner(app);
    const ws = owner.workspaceId;
    const ch = await channel(ws, owner.userId);
    const ag = await agent(ws);
    const day = daysAgo(1);
    const c1 = await conversation(ws, ch.id, at(day, 19), { agentId: ag.id });
    const c2 = await conversation(ws, ch.id, at(day, 20), { agentId: ag.id });
    await message(ws, c1.id, at(day, 19), { direction: 'in' });
    await message(ws, c1.id, at(day, 19), { direction: 'out', author: 'ai', customerReaction: 'like' });
    await message(ws, c2.id, at(day, 20), { direction: 'in' });
    await message(ws, c2.id, new Date(at(day, 20).getTime() + 4 * 60_000), { direction: 'out', author: 'human', authorUserId: owner.userId });
    await aiRun(ws, at(day, 19), { conversationId: c1.id, agentId: ag.id, inputTokens: 1_000_000, outputTokens: 0, latencyMs: 1500, language: 'darija', intent: 'sale' });
    await aiRun(ws, at(day, 20), { conversationId: c2.id, agentId: ag.id, status: 'handoff', latencyMs: 2500, language: 'fr' });
    await creditDebit(ws, at(day, 19), 1, 'text_reply', { agentId: ag.id });
    await creditDebit(ws, at(day, 20), 5, 'image_recognition', { agentId: ag.id });
    const model = await db.aiModel.findFirstOrThrow({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });

    const conv = (await get(owner, '/analytics/conversations?period=7d')).data;
    expect(conv.kpis.conversations.value).toBe(2);
    expect(conv.kpis.aiHandledPct).toMatchObject({ value: 50, hint: { handoffs: 1 } });
    expect(conv.kpis.aiResponseTime.value).toBe(2);
    expect(conv.kpis.humanResponseTime.value).toBe(5);
    expect(conv.languages.map((l: any) => l.language).sort()).toEqual(['darija', 'fr']);
    expect(conv.peakHours).toEqual({ from: 18, to: 21 });
    expect(conv.byChannel).toEqual([expect.objectContaining({ channelId: ch.id, conversations: 2, aiPct: 50, handoffs: 1 })]);

    const resp = (await get(owner, '/analytics/responses?period=7d')).data;
    expect(resp.kpis.aiReplies).toMatchObject({ value: 1, hint: { text: 1, image: 1, voice: 0 } });
    expect(resp.kpis.reactions).toMatchObject({ value: 1, hint: { likes: 1, dislikes: 0, score: 5 } });
    expect(resp.byStatus).toEqual(expect.arrayContaining([{ status: 'handoff', runs: 1 }, { status: 'ok', runs: 1 }]));

    const cons = (await get(owner, '/analytics/consumption?period=7d')).data;
    expect(cons.kpis.creditsUsed.value).toBe(6);
    expect(cons.kpis.costUsd.value).toBeCloseTo(Number(model.inputPricePerM), 3);
    expect(cons.byType).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', volume: 1, credits: 1, unitCost: 1 }), expect.objectContaining({ type: 'image', volume: 1, credits: 5, unitCost: 5 })]));
    expect(cons.byModel[0]).toMatchObject({ modelId: model.id, runs: 2, inputTokens: 1_000_000 });
    expect(cons.projection).toMatchObject({ packsPath: '/settings/credits' });

    const agents = (await get(owner, '/analytics/agents?period=7d')).data;
    expect(agents.agents[0]).toMatchObject({ agentId: ag.id, conversations: 2, autonomyPct: 50, credits: 6 });
    expect(agents.kpis.activeAgents.value).toBe(1);
  });

  it('products + delivery + channels: top products, couriers table with delivered % / avg days / COD, open failures, followers', async () => {
    const owner = await advancedShop(app);
    const ws = owner.workspaceId;
    const ch = await channel(ws, owner.userId, 'facebook', { followersCount: 1200 });
    const p = await product(owner, { name: 'Parfum Oud', price: 4000, costPrice: 1000, stock: 10 });
    const day = daysAgo(2);
    const o1 = await order(ws, { total: 4000, status: 'delivered', orderedAt: at(day), shippedAt: at(day), deliveredAt: at(day, 15), productId: p.id, productName: p.name, costPrice: 1000, channelId: ch.id });
    const o2 = await order(ws, { total: 4000, status: 'shipped', orderedAt: at(day), shippedAt: at(day), productId: p.id, productName: p.name, costPrice: 1000 });
    await shipment(ws, o1.id, { status: 'delivered', createdAt: at(day), lastEventAt: new Date(at(day).getTime() + 2 * 86_400_000), codAmount: 4000, courierCost: 400, deliveryAttempts: 1 });
    await shipment(ws, o2.id, { status: 'failed', createdAt: at(day), lastEventAt: at(day, 18), courierCost: 400 });

    const prod = (await get(owner, '/analytics/products?period=7d')).data;
    expect(prod.products[0]).toMatchObject({ productId: p.id, name: 'Parfum Oud', sold: 1, revenue: 4000 });
    expect(prod.kpis.topProduct).toMatchObject({ value: 4000, hint: { productId: p.id, name: 'Parfum Oud' } });
    expect(prod.kpis.avgMarginPct.value).toBe(75);

    const dlv = (await get(owner, '/analytics/delivery?period=7d')).data;
    expect(dlv.kpis.shipped.value).toBe(2);
    expect(dlv.kpis.avgDays.value).toBe(2);
    expect(dlv.kpis.firstAttemptPct.value).toBe(100);
    expect(dlv.kpis.openFailures.value).toBe(1);
    expect(dlv.kpis.courierFees).toMatchObject({ value: 800 });
    expect(dlv.couriers[0]).toMatchObject({ provider: 'manual', name: 'Livraison propre', parcels: 2, delivered: 1, deliveredPct: 50, failed: 1, avgDays: 2, codCollected: 4000 });

    const chs = (await get(owner, '/analytics/channels?period=7d')).data;
    expect(chs.kpis.followers.value).toBe(1200);
    expect(chs.kpis.activePages.value).toBe(1);
    expect(chs.hasChannels).toBe(true);
  });
});

describe('M8 carry-overs', () => {
  it('channel summary "Résolution IA" (30 d); insights list meta.counts; home handled cards greyed 24 h "fait par …"', async () => {
    const owner = await asOwner(app);
    const ws = owner.workspaceId;
    const ch = await channel(ws, owner.userId);
    const ag = await agent(ws);
    const c1 = await conversation(ws, ch.id, new Date());
    const c2 = await conversation(ws, ch.id, new Date());
    await conversation(ws, ch.id, new Date());
    await aiRun(ws, new Date(), { conversationId: c1.id, status: 'handoff' });
    const summary = (await get(owner, `/channels/${ch.id}/summary`)).data;
    expect(summary.aiResolutionPct30d).toBe(66.7);

    await db.agentInsight.create({ data: { workspaceId: ws, agentId: ag.id, conversationId: c1.id, type: 'unknown_topic', customerMessage: 'prix ?', status: 'pending' } });
    const done = await db.agentInsight.create({ data: { workspaceId: ws, agentId: ag.id, conversationId: c2.id, type: 'unclear', customerMessage: 'hein', status: 'resolved', resolvedAt: new Date(), resolvedById: owner.userId } });
    const list = await get(owner, '/agent-insights?status=pending');
    expect(list.meta.counts).toEqual({ pending: 1, resolved: 1, dismissed: 0 });
    expect(list.data).toHaveLength(1);

    const home = (await get(owner, '/dashboard/home')).data;
    const handled = home.queue.items.find((i: any) => i.key === `insight:${done.id}:handled`);
    expect(handled).toMatchObject({ kind: 'insight', handled: { by: { id: owner.userId, name: 'Test User' } } });
    expect(home.queue.counts.insight).toBe(1);
  });
});
