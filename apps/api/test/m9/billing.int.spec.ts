// M9 — plans, subscription, checkout through the (simulated) Chargily gateway, return page, webhooks, cancel / downgrade,
// invoices, billing info (BIL-01…06, FL-09, FL-28, 02 §5, 03 §37 BIL). AT-BIL-01, AT-BIL-06, AT-BIL-12, AT-DLG-65, AT-MOB-05.
import request from 'supertest';
import { prorata } from '@djaber/shared';
import { PAYMENT_GATEWAY } from '../../src/modules/billing/gateway/payment-gateway';
import { ChargilyGateway } from '../../src/modules/billing/gateway/chargily.gateway';
import { anonymous, asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually } from '../support/m1';
import { forbidNetwork } from '../support/m3';
import { channels, checkoutIdOf, currentSubOf, db, fakeChargily, idem, makePaid, makeTrial, payFake, planId, postChargilyWebhook, runPayments } from '../support/m9';

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

const checkout = (actor: Awaited<ReturnType<typeof asOwner>>, body: Record<string, unknown>) => actor.post('/billing/checkout', body).set(idem());

describe('plans & subscription (BIL-01)', () => {
  it('GET /plans is public (3 seed plans, limits, yearly saving); GET /billing/subscription for Owner / Admin, 403 for an Operator', async () => {
    const plans = (await anonymous(app).get('/plans').expect(200)).body.data;
    expect(plans.map((p: any) => p.slug)).toEqual(['free', 'starter', 'pro']);
    expect(plans.find((p: any) => p.slug === 'pro')).toMatchObject({ priceMonthly: 4900, priceYearly: 49000, yearlyDiscountPct: 17, trialDays: 14, isFeatured: true, limits: { maxPages: 5, monthlyCredits: 5000, maxProducts: -1, features: expect.arrayContaining(['scheduled_reports']) } });
    const owner = await asOwner(app);
    await makeTrial(app, owner.workspaceId);
    const sub = (await owner.get('/billing/subscription').expect(200)).body.data;
    expect(sub).toMatchObject({ status: 'trial', billingCycle: 'none', provider: 'none', plan: { slug: 'pro', current: true }, cancelAtPeriodEnd: false, dunningStage: null, nextPlan: null, unpaidInvoice: null, expiredFrom: null, pausedResources: [], usage: { pages: 0, agents: 0, members: 1 } });
    expect(sub.actions).toEqual(expect.arrayContaining([{ key: 'cancel', enabled: false, reasonCode: 'PLAN_IS_FREE' }, { key: 'change_plan', enabled: true }]));
    await (await asAdmin(app, owner.workspaceId)).get('/billing/subscription').expect(200);
    expect((await (await asOperator(app, owner.workspaceId)).get('/billing/subscription').expect(403)).body.error.code).toBe('FORBIDDEN');
  });

  it('AT-DLG-65 preview: new period from a trial, upgrade with the prorata formula, renewal, cycle change, downgrade listing what pauses; PLAN_NOT_FOUND / PLAN_IS_FREE / promo errors', async () => {
    const owner = await asOwner(app);
    const [free, starter, pro] = [await planId('free'), await planId('starter'), await planId('pro')];
    await makeTrial(app, owner.workspaceId);
    expect((await owner.post('/billing/preview', { planId: starter, cycle: 'monthly' }).expect(200)).body.data).toMatchObject({ mode: 'new_period', amountNow: 1900, prorataDays: null, nextAmount: 1900, creditsNow: 1500, targetPlan: { slug: 'starter', cycle: 'monthly' }, promo: null });
    expect((await owner.post('/billing/preview', { planId: free, cycle: 'monthly' }).expect(422)).body.error.code).toBe('PLAN_IS_FREE');
    expect((await owner.post('/billing/preview', { planId: '00000000-0000-4000-8000-000000000000', cycle: 'monthly' }).expect(404)).body.error.code).toBe('PLAN_NOT_FOUND');
    expect((await owner.post('/billing/preview', { planId: starter, cycle: 'weekly' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    const sub = await makePaid(app, owner.workspaceId, 'starter', 'monthly');
    const up = (await owner.post('/billing/preview', { planId: pro, cycle: 'monthly' }).expect(200)).body.data;
    const p = prorata({ price: 4900, currentPrice: 1900, periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, now: new Date() });
    expect(up).toMatchObject({ mode: 'upgrade', amountNow: p.amount, prorataDays: p.remainingDays, nextAmount: 4900, nextAt: sub.currentPeriodEnd.toISOString(), creditsNow: 3500 });
    expect((await owner.post('/billing/preview', { planId: starter, cycle: 'monthly' }).expect(200)).body.data).toMatchObject({ mode: 'renewal', amountNow: 1900, creditsNow: 0 });
    expect((await owner.post('/billing/preview', { planId: pro, cycle: 'yearly' }).expect(200)).body.data).toMatchObject({ mode: 'new_period', amountNow: 49000 - p.unused, prorataDays: p.remainingDays, creditsNow: 5000 });

    await makePaid(app, owner.workspaceId, 'pro', 'monthly');
    await channels(owner.workspaceId, 3);
    const down = (await owner.post('/billing/preview', { planId: starter, cycle: 'monthly' }).expect(200)).body.data;
    expect(down).toMatchObject({ mode: 'downgrade', amountNow: 0, nextAmount: 1900, pausedResources: [{ type: 'channel', name: 'Page 3' }] });
    expect((await owner.post('/billing/preview', { planId: free, cycle: 'monthly' }).expect(200)).body.data).toMatchObject({ mode: 'downgrade', pausedResources: expect.arrayContaining([{ type: 'channel', name: 'Page 2' }, { type: 'channel', name: 'Page 3' }]) });
    expect((await owner.post('/billing/preview', { planId: pro, cycle: 'yearly', promoCode: 'NOPE-123' }).expect(422)).body.error.code).toBe('PROMO_INVALID');
  });
});

describe('checkout → Chargily → activation (BIL-02, FL-28)', () => {
  it('AT-BIL-01 unsigned webhook ⇒ 401; signed twice ⇒ one activation; return replay ⇒ no-op; PaymentGateway = ChargilyGateway (provider chargily); Idempotency-Key required and replayed', async () => {
    expect(app.app.get(PAYMENT_GATEWAY)).toBeInstanceOf(ChargilyGateway);
    expect(app.app.get(PAYMENT_GATEWAY).provider).toBe('chargily');
    const owner = await asOwner(app);
    await makeTrial(app, owner.workspaceId);
    const pro = await planId('pro');
    expect((await owner.post('/billing/checkout', { planId: pro, cycle: 'monthly' }).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    const key = idem();
    const first = await owner.post('/billing/checkout', { planId: pro, cycle: 'monthly' }).set(key).expect(200);
    const { checkoutUrl, ref, preview } = first.body.data;
    expect(checkoutUrl).toMatch(/\/api\/v1\/dev-payments\/01fake/);
    expect(preview).toMatchObject({ mode: 'new_period', amountNow: 4900 });
    const replay = await owner.post('/billing/checkout', { planId: pro, cycle: 'monthly' }).set(key).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.data.ref).toBe(ref);
    expect((await owner.get(`/billing/checkout/return?ref=${ref}`).expect(200)).body.data).toMatchObject({ status: 'verifying', kind: 'subscription', planName: 'Pro' });

    const decided = await fakeChargily(app).decide(checkoutIdOf(checkoutUrl), 'paid');
    expect((await postChargilyWebhook(app, decided!.webhook!.rawBody, null).expect(401)).body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect((await postChargilyWebhook(app, decided!.webhook!.rawBody, 'deadbeef').expect(401)).body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    await postChargilyWebhook(app, decided!.webhook!.rawBody, decided!.webhook!.signature).expect(200);
    await postChargilyWebhook(app, decided!.webhook!.rawBody, decided!.webhook!.signature).expect(200); // replayed: ignored
    expect(await db.inboundEvent.count({ where: { externalId: { startsWith: 'chargily:' }, payload: { path: ['checkoutId'], equals: checkoutIdOf(checkoutUrl) } } })).toBe(1);
    await runPayments(app);
    const ret = (await owner.get(`/billing/checkout/return?ref=${ref}`).expect(200)).body.data;
    expect(ret).toMatchObject({ status: 'success', kind: 'subscription', invoiceNumber: expect.stringMatching(/^F-\d{4}-\d{5}$/), planName: 'Pro', failureReason: null });
    await owner.get(`/billing/checkout/return?ref=${checkoutIdOf(checkoutUrl)}`).expect(200); // the Chargily id works too
    const subs = await db.subscription.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { createdAt: 'asc' } });
    expect(subs.map((s) => [s.status, s.cancelReason])).toEqual([['cancelled', 'replaced'], ['active', null]]);
    expect(subs[1]).toMatchObject({ billingCycle: 'monthly', provider: 'chargily', appliedPrice: 4900 });
    const invoices = (await owner.get('/billing/invoices').expect(200)).body;
    expect(invoices.meta.total).toBe(1);
    expect(invoices.data[0]).toMatchObject({ kind: 'subscription', status: 'paid', amount: 4900, remaining: 0, method: expect.stringMatching(/cib|edahabia/), pdfUrl: `/api/v1/billing/invoices/${invoices.data[0].id}/pdf` });
    // a later poll or reconcile never activates twice
    await owner.get(`/billing/checkout/return?ref=${ref}`).expect(200);
    expect(await db.invoice.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
    // the new period opened with the plan's monthly credits
    expect((await owner.get('/credits').expect(200)).body.data.plan).toMatchObject({ limit: 5000, used: 0 });
    expect((await owner.get('/billing/subscription').expect(200)).body.data).toMatchObject({ status: 'active', billingCycle: 'monthly', provider: 'chargily' });
    // unknown / other workspace ref ⇒ 404
    const other = await asOwner(app);
    await other.get(`/billing/checkout/return?ref=${ref}`).expect(404);
  });

  it('AT-BIL-12 pending past the window then a late webhook ⇒ success; failed ⇒ PAYMENT_FAILED reason; expired; amount mismatch ⇒ not activated + admin alert', async () => {
    const owner = await asOwner(app);
    await makeTrial(app, owner.workspaceId);
    const starter = await planId('starter');
    const a = (await checkout(owner, { planId: starter, cycle: 'monthly' }).expect(200)).body.data;
    await payFake(app, a.checkoutUrl, 'pending');
    expect((await owner.get(`/billing/checkout/return?ref=${a.ref}`).expect(200)).body.data.status).toBe('verifying');
    await db.billingPayment.update({ where: { id: a.ref }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    expect((await owner.get(`/billing/checkout/return?ref=${a.ref}`).expect(200)).body.data.status).toBe('pending');
    await payFake(app, a.checkoutUrl, 'paid');
    expect((await owner.get(`/billing/checkout/return?ref=${a.ref}`).expect(200)).body.data).toMatchObject({ status: 'success', planName: 'Starter' });

    const b = (await checkout(owner, { planId: await planId('pro'), cycle: 'monthly' }).expect(200)).body.data;
    await fakeChargily(app).decide(checkoutIdOf(b.checkoutUrl), 'failed', 'insufficient_funds');
    // no webhook delivered: the poll asks the gateway (one verify per poll) and settles it
    expect((await owner.get(`/billing/checkout/return?ref=${b.ref}`).expect(200)).body.data).toMatchObject({ status: 'failed', failureReason: 'insufficient_funds' });
    const c = (await checkout(owner, { planId: await planId('pro'), cycle: 'monthly' }).expect(200)).body.data;
    await payFake(app, c.checkoutUrl, 'expired');
    expect((await owner.get(`/billing/checkout/return?ref=${c.ref}`).expect(200)).body.data.status).toBe('expired');
    expect((await currentSubOf(owner.workspaceId)).plan.slug).toBe('starter');

    // amount mismatch: a correctly signed "paid" event for another amount
    const d = (await checkout(owner, { planId: await planId('pro'), cycle: 'yearly' }).expect(200)).body.data;
    const ok = await fakeChargily(app).decide(checkoutIdOf(d.checkoutUrl), 'paid');
    const forged = Buffer.from(ok!.webhook!.rawBody.toString('utf8').replace(/"amount":\d+/, '"amount":100').replace(/"id":"evt_/, '"id":"evt_forged_'));
    await postChargilyWebhook(app, forged).expect(200);
    await runPayments(app);
    const row = await db.billingPayment.findUniqueOrThrow({ where: { id: d.ref } });
    expect(row.status).toBe('pending');
    expect((row.raw as any).flagged).toMatchObject({ reason: 'PAYMENT_AMOUNT_MISMATCH', amount: 100 });
    expect((await owner.get(`/billing/checkout/return?ref=${d.ref}`).expect(200)).body.data.status).toBe('pending');
    expect((await currentSubOf(owner.workspaceId)).plan.slug).toBe('starter');
    expect(await eventually(() => db.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'payment.amount_mismatch' } }))).toBe(1);
  });

  it('upgrade mid-period: prorata paid, same period end, credits difference added now; renewal extends the period by one cycle', async () => {
    const owner = await asOwner(app);
    const sub = await makePaid(app, owner.workspaceId, 'starter', 'monthly');
    const r = (await checkout(owner, { planId: await planId('pro'), cycle: 'monthly' }).expect(200)).body.data;
    expect(r.preview.mode).toBe('upgrade');
    await payFake(app, r.checkoutUrl, 'paid');
    const after = await currentSubOf(owner.workspaceId);
    expect(after).toMatchObject({ id: sub.id, planId: await planId('pro'), appliedPrice: 4900 });
    expect(after.currentPeriodEnd.toISOString()).toBe(sub.currentPeriodEnd.toISOString());
    expect(await db.creditLedger.count({ where: { workspaceId: owner.workspaceId, action: 'grant', credits: 3500, reason: 'upgrade:pro' } })).toBe(1);
    const inv = await db.invoice.findFirstOrThrow({ where: { workspaceId: owner.workspaceId }, orderBy: { createdAt: 'desc' } });
    expect(inv).toMatchObject({ amount: r.preview.amountNow, status: 'paid' });
    // renewal of the same plan + cycle: the end moves one month
    const ren = (await checkout(owner, { planId: await planId('pro'), cycle: 'monthly' }).expect(200)).body.data;
    expect(ren.preview.mode).toBe('renewal');
    await payFake(app, ren.checkoutUrl, 'paid');
    const renewed = await currentSubOf(owner.workspaceId);
    expect(renewed.currentPeriodEnd.getTime()).toBeGreaterThan(sub.currentPeriodEnd.getTime() + 27 * 86_400_000);
    expect(renewed.currentPeriodStart.toISOString()).toBe(sub.currentPeriodStart.toISOString());
  });

  it('UX-011 a discount code paid with a renewal is a redemption (admin count, single use, discount periods run from it)', async () => {
    const owner = await asOwner(app);
    const sub = await makePaid(app, owner.workspaceId, 'starter', 'monthly');
    const admin = await db.user.findFirstOrThrow({ where: { platformRole: 'super_admin' } });
    const promo = await db.promoCode.create({ data: { code: `RENEW-${Date.now()}`, kind: 'percent_discount', value: 20, periods: 2, createdById: admin.id } });
    const ren = (await checkout(owner, { planId: await planId('starter'), cycle: 'monthly', promoCode: promo.code }).expect(200)).body.data;
    expect(ren.preview.mode).toBe('renewal');
    await payFake(app, ren.checkoutUrl, 'paid');
    const r = await db.promoRedemption.findFirstOrThrow({ where: { promoCodeId: promo.id, workspaceId: owner.workspaceId } });
    expect(await currentSubOf(owner.workspaceId)).toMatchObject({ id: sub.id, promoRedemptionId: r.id, discountPct: 20 });
    expect((await owner.post('/billing/promo/validate', { code: promo.code }).expect(422)).body.error.code).toBe('PROMO_ALREADY_USED');
  });

  it('AT-MOB-05 subscriptions are web-only: checkout / preview / cancel from the app ⇒ 403; a subscription promo from mobile ⇒ PROMO_MOBILE_SUBSCRIPTION_FORBIDDEN; credit codes accepted', async () => {
    const owner = await asOwner(app);
    const pro = await planId('pro');
    for (const p of ['android', 'ios']) {
      expect((await checkout(owner, { planId: pro, cycle: 'monthly' }).set('X-App-Platform', p).expect(403)).body.error.code).toBe('FORBIDDEN');
      await owner.post('/billing/preview', { planId: pro, cycle: 'monthly' }).set('X-App-Platform', p).expect(403);
      await owner.post('/billing/cancel', {}).set('X-App-Platform', p).expect(403);
    }
    const admin = await db.user.findFirstOrThrow({ where: { platformRole: 'super_admin' } });
    const discount = await db.promoCode.create({ data: { code: `MOB-${Date.now()}`, kind: 'percent_discount', value: 10, createdById: admin.id } });
    const credits = await db.promoCode.create({ data: { code: `MOBCR-${Date.now()}`, kind: 'credits', value: 50, createdById: admin.id } });
    expect((await owner.post('/billing/promo/validate', { code: discount.code }).set('X-App-Platform', 'android').expect(422)).body.error.code).toBe('PROMO_MOBILE_SUBSCRIPTION_FORBIDDEN');
    expect((await owner.post('/billing/promo/redeem', { code: credits.code }).set('X-App-Platform', 'android').expect(200)).body.data).toMatchObject({ kind: 'credits', creditsAdded: 50 });
  });
});

describe('cancel / downgrade / permissions (BIL-05)', () => {
  it('AT-BIL-06 cancel at period end sets cancelledAt, access continues; undo; a cheaper plan is booked (nextPlan) and voids nothing; roles', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const sub = await makePaid(app, owner.workspaceId, 'pro', 'monthly');
    expect((await admin.post('/billing/cancel', {}).expect(403)).body.error.code).toBe('FORBIDDEN');
    await admin.post('/billing/checkout', { planId: await planId('starter'), cycle: 'monthly' }).set(idem()).expect(403);
    await operator.get('/billing/invoices').expect(403);
    await operator.post('/billing/promo/validate', { code: 'X' }).expect(403);
    const c = (await owner.post('/billing/cancel', { reason: 'trop cher' }).expect(200)).body.data;
    expect(c).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: sub.currentPeriodEnd.toISOString() });
    const row = await currentSubOf(owner.workspaceId);
    expect(row.cancelledAt).not.toBeNull();
    expect(row.cancelReason).toBe('trop cher');
    expect((await owner.post('/billing/cancel', {}).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await owner.post('/billing/cancel/undo').expect(200)).body.data.cancelAtPeriodEnd).toBe(false);
    expect((await owner.delete('/billing/cancel').expect(409)).body.error.code).toBe('CONFLICT');
    // downgrade to starter: nothing to pay, booked for the period end
    const d = (await owner.post('/billing/checkout', { planId: await planId('starter'), cycle: 'monthly' }).set(idem()).expect(200)).body.data;
    expect(d).toMatchObject({ checkoutUrl: null, ref: null, preview: { mode: 'downgrade', effectiveAt: sub.currentPeriodEnd.toISOString() } });
    expect((await owner.get('/billing/subscription').expect(200)).body.data).toMatchObject({ plan: { slug: 'pro' }, nextPlan: { slug: 'starter', cycle: 'monthly', at: sub.currentPeriodEnd.toISOString() } });
    expect((await owner.delete('/billing/cancel').expect(200)).body.data.nextPlan).toBeNull();
    // downgrade to free = cancel at period end
    await owner.post('/billing/checkout', { planId: await planId('free'), cycle: 'monthly' }).set(idem()).expect(200);
    expect((await owner.get('/billing/subscription').expect(200)).body.data.cancelAtPeriodEnd).toBe(true);
    expect(await eventually(() => db.auditLog.count({ where: { workspaceId: owner.workspaceId, action: { in: ['subscription.cancel', 'subscription.cancel_undone', 'subscription.downgrade_booked'] } } }))).toBeGreaterThanOrEqual(4);
  });

  it('invoices: list filters, PDF, pay ⇒ 409 unless unpaid; cross-workspace 404; billing info GET (Admin) / PUT (Owner only); payments list', async () => {
    const owner = await asOwner(app);
    await makeTrial(app, owner.workspaceId);
    const r = (await checkout(owner, { planId: await planId('starter'), cycle: 'yearly' }).expect(200)).body.data;
    await payFake(app, r.checkoutUrl, 'paid');
    const inv = (await owner.get('/billing/invoices?status=paid').expect(200)).body.data[0];
    expect(inv).toMatchObject({ amount: 19000, label: expect.stringContaining('Starter') });
    expect((await owner.get('/billing/invoices?status=unpaid').expect(200)).body.data).toEqual([]);
    const pdf = await request(app.http()).get(`/api/v1${inv.pdfUrl.replace('/api/v1', '')}`).set(owner.headers).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await owner.post(`/billing/invoices/${inv.id}/pay`).expect(409)).body.error.code).toBe('CONFLICT');
    const other = await asOwner(app);
    await other.get(`/billing/invoices/${inv.id}/pdf`).expect(404);
    await other.post(`/billing/invoices/${inv.id}/pay`).expect(404);
    const admin = await asAdmin(app, owner.workspaceId);
    expect((await admin.get('/billing/info').expect(200)).body.data).toEqual({ companyName: null, nif: null, address: null });
    await admin.put('/billing/info', { companyName: 'SARL Test' }).expect(403);
    expect((await owner.put('/billing/info', { companyName: 'SARL Boutique', nif: '000016001234567', address: 'Alger' }).expect(200)).body.data).toEqual({ companyName: 'SARL Boutique', nif: '000016001234567', address: 'Alger' });
    await owner.put('/billing/info', { companyName: 'x'.repeat(161) }).expect(422);
    const pays = (await owner.get('/billing/payments').expect(200)).body.data;
    expect(pays[0]).toMatchObject({ status: 'paid', provider: 'chargily', kind: 'subscription', invoiceId: inv.id });
  });
});
