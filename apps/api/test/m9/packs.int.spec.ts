// M9 — credit packs (web Chargily checkout, store IAP with sandbox-shaped receipts, store refunds), pack consumption
// after the plan credits, promo codes, admin credit grants, calculator, ledger export. AT-PCK-01…04, AT-PRM-01…03,
// AT-BIL-07 (API side), AT-ERR-04 / AT-ERR-05 codes.
import request from 'supertest';
import { CreditService } from '../../src/modules/credits/credit.service';
import { fakeAppStoreNotification, fakeAppStoreTransaction, fakeGoogleOrderId, fakeGooglePubSub, FAKE_PUBSUB_TOKEN } from '../../src/modules/billing/iap/fake-stores';
import { asAdmin, asOperator, asOwner, asPlatform, createUser } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually, mailsTo } from '../support/m1';
import { forbidNetwork } from '../support/m3';
import { balanceOf, inTenant, setCredits } from '../support/m4';
import { aiRun, DAY, db, idem, makePaid, makeTrial, payFake, planId, runPayments, runReconcileCron } from '../support/m9';

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
const iap = (actor: Owner, body: Record<string, unknown>) => actor.post('/credits/packs/iap/validate', body).set(idem()).set('X-App-Platform', 'android');
const googleBuy = (actor: Owner, token: string, productId = 'djaber.credits.pack-500') => iap(actor, { platform: 'google_play', productId, transactionId: fakeGoogleOrderId(token), purchaseToken: token });
const postStore = (path: 'google-play' | 'app-store', body: unknown, token?: string) =>
  request(app.http()).post(`/api/v1/webhooks/store/${path}${token ? `?token=${token}` : ''}`).set('Content-Type', 'application/json').send(JSON.stringify(body));

describe('credit packs (PCK-01 / PCK-02)', () => {
  it('GET /credit-packs (public, web vs store lists); web checkout ⇒ paid ⇒ pack credits (bucket pack), Invoice credit_pack, credits.pack_purchased, return page kind pack; Operator 403', async () => {
    const web = (await request(app.http()).get('/api/v1/credit-packs').expect(200)).body.data;
    expect(web.map((p: any) => [p.slug, p.credits, p.priceWebDzd])).toEqual([['pack-500', 500, 450], ['pack-2000', 2000, 1500], ['pack-6000', 6000, 3900]]);
    expect(web[0].pricePerCreditDzd).toBe(0.9);
    const gp = (await request(app.http()).get('/api/v1/credit-packs?platform=google_play').expect(200)).body.data;
    expect(gp[0].googleProductId).toBe('djaber.credits.pack-500');
    const owner = await asOwner(app);
    await (await asOperator(app, owner.workspaceId)).post('/credits/packs/checkout', { packId: web[0].id }).set(idem()).expect(403);
    await owner.post('/credits/packs/checkout', { packId: web[0].id }).expect(400);
    const r = (await owner.post('/credits/packs/checkout', { packId: web[1].id }).set(idem()).expect(200)).body.data;
    expect(r.checkoutUrl).toContain('/dev-payments/');
    await payFake(app, r.checkoutUrl, 'paid', { workspaceId: owner.workspaceId });
    const ret = (await owner.get(`/billing/checkout/return?ref=${r.ref}`).expect(200)).body.data;
    expect(ret).toMatchObject({ status: 'success', kind: 'pack', credits: 2000, invoiceNumber: expect.stringMatching(/^F-/) });
    const credits = (await owner.get('/credits').expect(200)).body.data;
    expect(credits.packs.remaining).toBe(2000);
    expect(credits.total).toBe(credits.plan.remaining + 2000);
    const row = await db.creditLedger.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, action: 'pack_purchase' } });
    expect(row).toMatchObject({ bucket: 'pack', kind: 'credit', credits: 2000, periodStart: null, idempotencyKey: `pack:${r.purchaseId}` });
    expect(await db.invoice.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, kind: 'credit_pack' } })).toMatchObject({ amount: 1500, status: 'paid', creditPackPurchaseId: r.purchaseId });
    expect((await owner.get('/credits/packs/purchases').expect(200)).body.data[0]).toMatchObject({ channel: 'web', status: 'credited', pack: { slug: 'pack-2000' } });
    expect(await db.outbox.count({ where: { workspaceId: owner.workspaceId, topic: 'notification', key: `credits_pack_purchased:${r.purchaseId}` } })).toBe(1);
    // a failed pack checkout leaves the purchase failed, no credits
    const f = (await owner.post('/credits/packs/checkout', { packId: web[0].id }).set(idem()).expect(200)).body.data;
    await payFake(app, f.checkoutUrl, 'failed');
    expect((await db.creditPackPurchase.findUniqueOrThrow({ where: { id: f.purchaseId } })).status).toBe('failed');
  });

  it('AT-PCK-01 Google Play: valid receipt ⇒ +500 once, Invoice(credit_pack, google_play, net 30 %); same receipt ⇒ 409 IAP_RECEIPT_ALREADY_USED; tampered ⇒ 422; web-only product ⇒ 404; store down ⇒ 503 then polled', async () => {
    const owner = await asOwner(app);
    const ok = (await googleBuy(owner, 'gp-token-1').expect(200)).body.data;
    expect(ok).toMatchObject({ status: 'credited', creditsAdded: 500, balance: { packs: { remaining: 500 } } });
    const purchase = await db.creditPackPurchase.findUniqueOrThrow({ where: { id: ok.purchaseId } });
    expect(purchase).toMatchObject({ channel: 'google_play', status: 'credited', storeTransactionId: fakeGoogleOrderId('gp-token-1'), storeOrderId: fakeGoogleOrderId('gp-token-1') });
    expect(await db.invoice.findFirstOrThrow({ where: { creditPackPurchaseId: ok.purchaseId } })).toMatchObject({ kind: 'credit_pack', method: 'google_play', amount: 315, status: 'paid' });
    expect((await googleBuy(owner, 'gp-token-1').expect(409)).body.error.code).toBe('IAP_RECEIPT_ALREADY_USED');
    expect((await googleBuy(await asOwner(app), 'gp-token-1').expect(409)).body.error.code).toBe('IAP_RECEIPT_ALREADY_USED');
    expect((await googleBuy(owner, 'invalid-token').expect(422)).body.error.code).toBe('IAP_RECEIPT_INVALID');
    expect((await googleBuy(owner, 'tok-x', 'djaber.credits.unknown').expect(404)).body.error.code).toBe('IAP_PRODUCT_UNKNOWN');
    await db.creditPack.update({ where: { slug: 'pack-6000' }, data: { visibleMobile: false } });
    expect((await googleBuy(owner, 'tok-y', 'djaber.credits.pack-6000').expect(404)).body.error.code).toBe('IAP_PRODUCT_UNKNOWN');
    await db.creditPack.update({ where: { slug: 'pack-6000' }, data: { visibleMobile: true } });
    expect((await iap(owner, { platform: 'google_play', productId: 'djaber.credits.pack-500', transactionId: 'x' }).expect(422)).body.error.fields).toEqual({ purchaseToken: 'validation.required' });
    await owner.post('/credits/packs/iap/validate', { platform: 'google_play', productId: 'djaber.credits.pack-500', transactionId: 'x', purchaseToken: 'y' }).expect(400);
    // store unavailable: 503, purchase kept pending, retried by the job and by the reconcile poll
    const down = await googleBuy(owner, 'unavailable-token').expect(503);
    expect(down.body.error.code).toBe('IAP_STORE_UNAVAILABLE');
    const pending = await db.creditPackPurchase.findUniqueOrThrow({ where: { storeTransactionId: fakeGoogleOrderId('unavailable-token') } });
    expect(pending.status).toBe('pending');
    expect(await db.outbox.count({ where: { topic: 'job', key: `iap:${pending.id}` } })).toBe(1);
    // the store is back (the receipt now validates): the poll credits it once
    await db.creditPackPurchase.update({ where: { id: pending.id }, data: { receipt: { productId: 'djaber.credits.pack-500', transactionId: pending.storeTransactionId, purchaseToken: 'back-token' } } });
    await runReconcileCron(app);
    expect((await db.creditPackPurchase.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('credited');
    expect((await balanceOf(app, owner.workspaceId)).pack).toBe(1000);
    // pending purchase at the store (deferred payment)
    expect((await googleBuy(owner, 'pending-token').expect(200)).body.data).toMatchObject({ status: 'pending', creditsAdded: 0 });
  });

  it('AT-PCK-01 App Store: a signed transaction (fake StoreKit receipt) ⇒ credited; tampered / other bundle / other transaction ⇒ 422', async () => {
    const owner = await asOwner(app);
    const receipt = await fakeAppStoreTransaction({ transactionId: '2000000900000001', productId: 'djaber.credits.pack-2000' });
    const ok = (await iap(owner, { platform: 'app_store', productId: 'djaber.credits.pack-2000', transactionId: '2000000900000001', receipt }).expect(200)).body.data;
    expect(ok).toMatchObject({ status: 'credited', creditsAdded: 2000 });
    expect(await db.invoice.findFirstOrThrow({ where: { creditPackPurchaseId: ok.purchaseId } })).toMatchObject({ method: 'app_store', amount: 1050 });
    expect((await iap(owner, { platform: 'app_store', productId: 'djaber.credits.pack-2000', transactionId: '2000000900000002', receipt }).expect(422)).body.error.code).toBe('IAP_RECEIPT_INVALID');
    const other = await fakeAppStoreTransaction({ transactionId: '2000000900000003', productId: 'djaber.credits.pack-2000', bundleId: 'com.someone.else' });
    expect((await iap(owner, { platform: 'app_store', productId: 'djaber.credits.pack-2000', transactionId: '2000000900000003', receipt: other }).expect(422)).body.error.code).toBe('IAP_RECEIPT_INVALID');
    expect((await iap(owner, { platform: 'app_store', productId: 'djaber.credits.pack-2000', transactionId: '2000000900000004', receipt: `${receipt.slice(0, -4)}AAAA` }).expect(422)).body.error.code).toBe('IAP_RECEIPT_INVALID');
    // the invalid purchase stays invalid (no credit on a retry with the same id)
    expect((await iap(owner, { platform: 'app_store', productId: 'djaber.credits.pack-2000', transactionId: '2000000900000002', receipt }).expect(422)).body.error.code).toBe('IAP_RECEIPT_INVALID');
  });

  it('AT-PCK-02 plan credits exhausted + a pack ⇒ the AI keeps answering from the pack; exhausted only when both are 0; pack credits survive the period rollover', async () => {
    const owner = await asOwner(app);
    const credits = app.app.get(CreditService);
    await setCredits(app, owner.workspaceId, 0);
    await googleBuy(owner, 'pck02-token').expect(200);
    const b = await balanceOf(app, owner.workspaceId);
    expect(b).toMatchObject({ plan: 0, pack: 500, total: 500, exhausted: false });
    const run = { id: (await aiRun(owner.workspaceId)).id, workspaceId: owner.workspaceId };
    expect(await inTenant(app, owner.workspaceId, () => credits.reserve(run, 5))).toBe(true);
    expect((await db.creditLedger.findFirstOrThrow({ where: { idempotencyKey: `run:${run.id}:reserve` } })).bucket).toBe('pack');
    await inTenant(app, owner.workspaceId, () => credits.settle(run, 'image_recognition'));
    expect((await balanceOf(app, owner.workspaceId)).pack).toBe(495);
    expect((await owner.get('/credits').expect(200)).body.data).toMatchObject({ plan: { remaining: 0 }, packs: { remaining: 495 }, exhausted: false });
    // next month: a new plan period opens, the pack part is untouched
    const sub = await db.subscription.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, status: 'active' } });
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: new Date(sub.currentPeriodStart.getTime() - 32 * DAY) } });
    const next = await balanceOf(app, owner.workspaceId);
    expect(next.pack).toBe(495);
    expect(next.plan).toBe(5000);
  });

  it('AT-PCK-03 store refund (RTDN + App Store notification) ⇒ store_refund −credits, negative balance, credits.negative, AI blocked; admin grant ⇒ resumes; bad token / signature ⇒ 401; replay ignored', async () => {
    const owner = await asOwner(app);
    await setCredits(app, owner.workspaceId, 0);
    const bought = (await googleBuy(owner, 'refund-token').expect(200)).body.data;
    // spend 120 of the pack, then the refund removes 500 ⇒ −120
    await inTenant(app, owner.workspaceId, () => app.app.get(CreditService).grant(owner.workspaceId, -120, { key: `spend:${owner.workspaceId}`, reason: 'test', bucket: 'pack' }));
    const body = fakeGooglePubSub({ messageId: `m-${bought.purchaseId}`, voided: { purchaseToken: 'refund-token', orderId: fakeGoogleOrderId('refund-token') } });
    expect((await postStore('google-play', body).expect(401)).body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect((await postStore('google-play', body, 'wrong-token').expect(401)).body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect((await postStore('google-play', body, FAKE_PUBSUB_TOKEN).expect(200)).body).toEqual({ received: 1 });
    expect((await postStore('google-play', body, FAKE_PUBSUB_TOKEN).expect(200)).body).toEqual({ received: 0 }); // replay
    await runPayments(app, [owner.workspaceId]);
    expect(await db.creditLedger.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, action: 'store_refund' } })).toMatchObject({ bucket: 'pack', kind: 'debit', credits: -500, idempotencyKey: `pack:${bought.purchaseId}:refund` });
    expect((await db.creditPackPurchase.findUniqueOrThrow({ where: { id: bought.purchaseId } })).status).toBe('refunded');
    expect((await db.invoice.findFirstOrThrow({ where: { creditPackPurchaseId: bought.purchaseId } })).status).toBe('refunded');
    const c = (await owner.get('/credits').expect(200)).body.data;
    expect(c).toMatchObject({ negative: true, total: -120, exhausted: true });
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'credits_negative' } })).toBeGreaterThan(0);
    const run = { id: (await aiRun(owner.workspaceId)).id, workspaceId: owner.workspaceId };
    expect(await inTenant(app, owner.workspaceId, () => app.app.get(CreditService).reserve(run, 1))).toBe(false);
    // regularised by an admin grant (+200 ⇒ 80)
    const finance = await asPlatform(app, 'finance');
    expect((await finance.post(`/admin/workspaces/${owner.workspaceId}/credits`, { credits: 200, reason: 'Geste commercial après remboursement' }).expect(200)).body.data.balance).toMatchObject({ total: 80, negative: false });
    expect(await inTenant(app, owner.workspaceId, () => app.app.get(CreditService).reserve(run, 1))).toBe(true);
    // App Store REFUND notification on an App Store purchase
    const receipt = await fakeAppStoreTransaction({ transactionId: '2000000955', productId: 'djaber.credits.pack-500' });
    const p2 = (await iap(owner, { platform: 'app_store', productId: 'djaber.credits.pack-500', transactionId: '2000000955', receipt }).expect(200)).body.data;
    const notif = await fakeAppStoreNotification({ type: 'REFUND', transactionId: '2000000955', productId: 'djaber.credits.pack-500' });
    expect((await postStore('app-store', { signedPayload: notif.signedPayload.slice(0, -2) + 'xx' }).expect(401)).body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    await postStore('app-store', notif).expect(200);
    await runPayments(app, [owner.workspaceId]);
    expect((await db.creditPackPurchase.findUniqueOrThrow({ where: { id: p2.purchaseId } })).status).toBe('refunded');
  });

  it('AT-PCK-04 / AT-BIL-07 calculator: 1 200 conversations × 4 messages, 15 % photo, 8 % voice ⇒ 5 988 credits ⇒ Pro + 1 pack; per-plan coverage', async () => {
    const owner = await asOwner(app);
    const r = (await owner.get('/credits/calculator?conversations=1200&msgsPerConv=4&photoPct=15&voicePct=8').expect(200)).body.data;
    expect(r).toMatchObject({ credits: 5988, textTurns: 4800, imageTurns: 180, voiceTurns: 96 });
    expect(r.suggestion).toMatchObject({ planSlug: 'pro', packs: [{ slug: 'pack-2000', quantity: 1 }] });
    expect(r.plans.map((p: any) => [p.slug, p.missingCredits])).toEqual([['free', 5888], ['starter', 4488], ['pro', 988]]);
    expect((await owner.get('/credits/calculator?conversations=100&msgsPerConv=4').expect(200)).body.data.suggestion).toMatchObject({ planSlug: 'starter', packs: [] });
    expect((await owner.get('/credits/calculator?conversations=20&msgsPerConv=4').expect(200)).body.data.suggestion).toMatchObject({ planSlug: 'free', packs: [], totalMonthlyDzd: 0 });
  });
});

describe('promo codes (PRM-01 / PRM-02)', () => {
  it('AT-PRM-01 matrix: unknown / inactive ⇒ PROMO_INVALID; window ⇒ PROMO_EXPIRED; max uses ⇒ PROMO_LIMIT_REACHED; reused ⇒ PROMO_ALREADY_USED; plan ⇒ PROMO_PLAN_MISMATCH; second discount ⇒ PROMO_NOT_STACKABLE; credits code ⇒ ledger grant at once', async () => {
    const admin = await createUser({ platformRole: 'super_admin' });
    const mk = (over: Record<string, unknown>) => db.promoCode.create({ data: { code: `C${Math.random().toString(36).slice(2, 10).toUpperCase()}`, kind: 'percent_discount', value: 20, createdById: admin.id, ...over } as never });
    const owner = await asOwner(app);
    await makeTrial(app, owner.workspaceId);
    const pro = await planId('pro');
    const v = (code: string, planId?: string) => owner.post('/billing/promo/validate', { code, ...(planId ? { planId } : {}) });
    expect((await v('NOPE').expect(422)).body.error.code).toBe('PROMO_INVALID');
    expect((await v((await mk({ isActive: false })).code).expect(422)).body.error.code).toBe('PROMO_INVALID');
    expect((await v((await mk({ validTo: new Date(Date.now() - DAY) })).code).expect(410)).body.error.code).toBe('PROMO_EXPIRED');
    const used = await mk({ maxUses: 1 });
    const someone = await asOwner(app);
    await db.promoRedemption.create({ data: { promoCodeId: used.id, workspaceId: someone.workspaceId, userId: someone.userId } });
    expect((await v(used.code).expect(410)).body.error.code).toBe('PROMO_LIMIT_REACHED');
    const starterOnly = await mk({ planSlugs: ['starter'] });
    expect((await v(starterOnly.code, pro).expect(422)).body.error).toMatchObject({ code: 'PROMO_PLAN_MISMATCH', params: { plans: 'starter' } });
    const twenty = await mk({ value: 20, planSlugs: ['pro'] });
    expect((await v(twenty.code.toLowerCase(), pro).expect(200)).body.data).toMatchObject({ code: twenty.code, kind: 'percent_discount', value: 20, referral: false });
    // applied at checkout: 4 900 − 20 % = 3 920
    const r = (await owner.post('/billing/checkout', { planId: pro, cycle: 'monthly', promoCode: twenty.code }).set(idem()).expect(200)).body.data;
    expect(r.preview).toMatchObject({ amountNow: 3920, amountBeforePromo: 4900, promo: { code: twenty.code, value: 20 } });
    await payFake(app, r.checkoutUrl, 'paid');
    expect(await db.promoRedemption.count({ where: { promoCodeId: twenty.code ? twenty.id : '', workspaceId: owner.workspaceId } })).toBe(1);
    expect((await db.subscription.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, status: 'active' } })).discountPct).toBe(20);
    expect((await v(twenty.code, pro).expect(409)).body.error.code).toBe('PROMO_ALREADY_USED');
    expect((await v((await mk({ kind: 'fixed_discount', value: 500 })).code, pro).expect(409)).body.error.code).toBe('PROMO_NOT_STACKABLE');
    // credits code: granted at once (plan bucket), recorded, single use
    const cr = await mk({ kind: 'credits', value: 250 });
    const red = (await owner.post('/billing/promo/redeem', { code: cr.code }).expect(200)).body.data;
    expect(red).toMatchObject({ kind: 'credits', creditsAdded: 250 });
    const entry = await db.creditLedger.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, reason: `promo:${cr.code}` } });
    expect(entry).toMatchObject({ action: 'grant', kind: 'credit', bucket: 'plan', credits: 250 });
    expect((await db.promoRedemption.findFirstOrThrow({ where: { promoCodeId: cr.id } })).ledgerEntryId).toBe(entry.id);
    expect((await owner.post('/billing/promo/redeem', { code: cr.code }).expect(409)).body.error.code).toBe('PROMO_ALREADY_USED');
    // trial extension on a trial; a discount code cannot be "redeemed" outside a plan change
    const trialOwner = await asOwner(app);
    await makeTrial(app, trialOwner.workspaceId);
    expect((await trialOwner.post('/billing/promo/redeem', { code: (await mk({ planSlugs: ['pro'] })).code }).expect(422)).body.error.code).toBe('PROMO_PLAN_MISMATCH');
    const before = (await db.subscription.findFirstOrThrow({ where: { workspaceId: trialOwner.workspaceId, status: 'trial' } })).trialEndsAt!;
    const ext = (await trialOwner.post('/billing/promo/redeem', { code: (await mk({ kind: 'trial_extension', value: 7 })).code }).expect(200)).body.data;
    expect(new Date(ext.trialEndsAt).getTime() - before.getTime()).toBe(7 * DAY);
    // roles: Admin may validate / redeem (billing.write), Operator may not
    await (await asAdmin(app, owner.workspaceId)).post('/billing/promo/validate', { code: 'NOPE' }).expect(422);
    await (await asOperator(app, owner.workspaceId)).post('/billing/promo/validate', { code: 'NOPE' }).expect(403);
  });

  it('AT-PRM-02 PARRAIN-xyz: the referee redeems, nothing credited; its first paid invoice ⇒ +300 to both sides, once', async () => {
    const sponsor = await asOwner(app);
    const admin = await createUser({ platformRole: 'super_admin' });
    const code = await db.promoCode.create({ data: { code: `PARRAIN-${Date.now()}`, kind: 'credits', value: 300, target: 'new_workspaces', targetWorkspaceId: sponsor.workspaceId, createdById: admin.id } });
    const referee = await asOwner(app);
    await makeTrial(app, referee.workspaceId);
    expect((await sponsor.post('/billing/promo/redeem', { code: code.code }).expect(422)).body.error.code).toBe('PROMO_INVALID');
    expect((await referee.post('/billing/promo/redeem', { code: code.code }).expect(200)).body.data).toMatchObject({ referral: true, creditsAdded: 0 });
    expect(await db.creditLedger.count({ where: { reason: { startsWith: 'referral:' }, workspaceId: { in: [referee.workspaceId, sponsor.workspaceId] } } })).toBe(0);
    const r = (await referee.post('/billing/checkout', { planId: await planId('starter'), cycle: 'monthly' }).set(idem()).expect(200)).body.data;
    await payFake(app, r.checkoutUrl, 'paid');
    expect(await db.creditLedger.count({ where: { workspaceId: referee.workspaceId, reason: `referral:${code.code}`, credits: 300 } })).toBe(1);
    expect(await db.creditLedger.count({ where: { workspaceId: sponsor.workspaceId, reason: `referral:${code.code}`, credits: 300 } })).toBe(1);
    // a second paid invoice pays nothing more
    const r2 = (await referee.post('/billing/checkout', { planId: await planId('starter'), cycle: 'monthly' }).set(idem()).expect(200)).body.data;
    await payFake(app, r2.checkoutUrl, 'paid');
    expect(await db.creditLedger.count({ where: { reason: `referral:${code.code}` } })).toBe(2);
  });
});

describe('admin credit grants (PRM-03) & ledger export', () => {
  it('AT-PRM-03 support grants 1 200 ⇒ ADMIN_CREDIT_GRANT_LIMIT {1000}; ≤ 1 000 ok; finance ⇒ ok, Owner e-mail, audit credits.grant with the reason; read roles 403; unknown workspace 404', async () => {
    const owner = await asOwner(app);
    const support = await asPlatform(app, 'support');
    const finance = await asPlatform(app, 'finance');
    const reader = await asPlatform(app, 'read');
    const body = { credits: 1200, reason: 'Incident fournisseur IA du 12/10', type: 'incident' };
    const limit = await support.post(`/admin/workspaces/${owner.workspaceId}/credits`, body).expect(403);
    expect(limit.body.error).toMatchObject({ code: 'ADMIN_CREDIT_GRANT_LIMIT', params: { max: 1000 } });
    await support.post(`/admin/workspaces/${owner.workspaceId}/credits`, { ...body, credits: 1000 }).expect(200);
    await reader.post(`/admin/workspaces/${owner.workspaceId}/credits`, body).expect(403);
    await owner.post(`/admin/workspaces/${owner.workspaceId}/credits`, body).expect(403);
    expect((await finance.post(`/admin/workspaces/${owner.workspaceId}/credits`, { ...body, reason: 'court' }).expect(422)).body.error.code).toBe('ADMIN_REASON_REQUIRED');
    const ok = (await finance.post(`/admin/workspaces/${owner.workspaceId}/credits`, body).expect(200)).body.data;
    expect(ok.balance.total).toBe(5000 + 1000 + 1200);
    expect(await db.creditLedger.findUniqueOrThrow({ where: { id: ok.ledgerEntryId } })).toMatchObject({ action: 'grant', kind: 'credit', bucket: 'plan', credits: 1200, grantedById: expect.any(String) });
    expect(await eventually(() => db.auditLog.count({ where: { action: 'credits.grant', entityId: owner.workspaceId, reason: body.reason } }))).toBe(2);
    const ownerEmail = (await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).email;
    expect((await mailsTo(app, ownerEmail, 'billing/credits-granted')).length).toBe(2);
    await finance.post('/admin/workspaces/00000000-0000-4000-8000-000000000000/credits', body).expect(404);
    // tester report 22/10 UX-021: the Owner also gets an in-app notification (the e-mail stays its own flow)
    expect(await db.outbox.count({ where: { workspaceId: owner.workspaceId, topic: 'notification', key: `credits_granted:${ok.ledgerEntryId}` } })).toBe(1);
  });

  it('tester report 22/10 UX-019: finance / super admin remove plan credits granted by mistake (adjustment debit, at most what is left, audited); support and read roles 403', async () => {
    const owner = await asOwner(app);
    const finance = await asPlatform(app, 'finance');
    const support = await asPlatform(app, 'support');
    const reader = await asPlatform(app, 'read');
    const before = (await finance.post(`/admin/workspaces/${owner.workspaceId}/credits`, { credits: 100000, reason: 'Geste commercial (erreur de saisie)' }).expect(200)).body.data.balance.total;
    const body = { credits: 99000, reason: 'Erreur de saisie : 100 000 au lieu de 1 000' };
    await support.post(`/admin/workspaces/${owner.workspaceId}/credits/remove`, body).expect(403);
    await reader.post(`/admin/workspaces/${owner.workspaceId}/credits/remove`, body).expect(403);
    await owner.post(`/admin/workspaces/${owner.workspaceId}/credits/remove`, body).expect(403);
    expect((await finance.post(`/admin/workspaces/${owner.workspaceId}/credits/remove`, { ...body, reason: 'court' }).expect(422)).body.error.code).toBe('ADMIN_REASON_REQUIRED');
    const tooMuch = (await finance.post(`/admin/workspaces/${owner.workspaceId}/credits/remove`, { ...body, credits: before + 1 }).expect(422)).body.error;
    expect(tooMuch).toMatchObject({ code: 'VALIDATION_ERROR', fields: { credits: 'validation.range' }, details: { max: before } });
    const ok = (await finance.post(`/admin/workspaces/${owner.workspaceId}/credits/remove`, body).expect(200)).body.data;
    expect(ok.balance.total).toBe(before - 99000);
    expect(await db.creditLedger.findUniqueOrThrow({ where: { id: ok.ledgerEntryId } })).toMatchObject({ action: 'adjustment', kind: 'debit', bucket: 'plan', credits: -99000, grantedById: expect.any(String) });
    expect(await eventually(() => db.auditLog.count({ where: { action: 'credits.remove', entityId: owner.workspaceId, reason: body.reason } }))).toBe(1);
    // tester log 26/10 UX-040: the Owner is told — e-mail with the reason and the link to the credits history, in-app notification
    const ownerEmail = (await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).email;
    expect((await mailsTo(app, ownerEmail, 'billing/credits-removed')).length).toBe(1);
    expect(await db.outbox.findFirst({ where: { workspaceId: owner.workspaceId, topic: 'notification', key: `credits_removed:${ok.ledgerEntryId}` } })).toMatchObject({ payload: expect.objectContaining({ type: 'credits_removed' }) });
    await finance.post('/admin/workspaces/00000000-0000-4000-8000-000000000000/credits/remove', body).expect(404);
    // the row action is offered to finance, refused (FORBIDDEN) to support
    const row = (r: any) => r.body.data.find((w: any) => w.id === owner.workspaceId).actions.find((x: any) => x.key === 'remove_credits');
    expect(row(await finance.get('/admin/workspaces?pageSize=100').expect(200))).toMatchObject({ enabled: true });
    expect(row(await support.get('/admin/workspaces?pageSize=100').expect(200))).toMatchObject({ enabled: false, reasonCode: 'FORBIDDEN' });
  });

  it('GET /credits/ledger/export ⇒ 202 job; the CSV lists credits and debits (Admin+, Operator 403)', async () => {
    const owner = await asOwner(app);
    await makePaid(app, owner.workspaceId, 'pro');
    await googleBuy(owner, 'export-token').expect(200);
    await (await asOperator(app, owner.workspaceId)).get('/credits/ledger/export').expect(403);
    const { jobId } = (await owner.get('/credits/ledger/export?format=csv&bucket=pack').expect(202)).body.data;
    await runPayments(app, [owner.workspaceId]);
    const job = (await owner.get(`/jobs/${jobId}`).expect(200)).body.data;
    expect(job).toMatchObject({ status: 'done', kind: 'export' });
    const file = await request(app.http()).get(new URL(job.resultUrl, 'http://x').pathname + new URL(job.resultUrl, 'http://x').search).buffer(true);
    expect(file.status).toBe(200);
    const csv = String(file.text ?? file.body);
    expect(csv).toContain('pack');
    expect(csv.split('\n').length).toBeGreaterThanOrEqual(2);
  });
});
