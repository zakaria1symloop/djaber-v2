// Contract tests of the M9 external adapters — no network, no real key, no real money:
//   ChargilyGateway (05-integrations §4.2): request shapes, status mapping, webhook HMAC on the raw body, the safety guard
//     (PAYMENT_DRIVER=chargily refused in development / test), the simulated Chargily API used in dev / tests.
//   Store validators (05-integrations §5): Google Play Developer API with a recorded sandbox purchase, App Store signed
//     transactions verified through an x5c chain (a test CA generated with openssl, pinned like Apple Root CA - G3),
//     the fake stores, the guard (IAP_DRIVER=stores refused in development / test).
// The private keys under test/fixtures/stores are throw-away test keys (they sign nothing outside this file).
import { readFileSync } from 'node:fs';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { resolve } from 'node:path';
import { CompactSign, SignJWT } from 'jose';
import { prorata, REFERRAL_CREDITS } from '@djaber/shared';
import { addCycle, addMonths } from './billing.util';
import { ChargilyGateway, chargilySignature, type PayRequest, type PayResponse } from './gateway/chargily.gateway';
import { FakeChargilyBackend } from './gateway/fake-chargily';
import { createPaymentGateway } from './gateway/gateway.provider';
import { PaymentProviderError } from './gateway/payment-gateway';
import { verifyAppleJws } from './iap/apple-jws';
import { fakeAppStoreNotification, fakeAppStoreTransaction, fakeGoogleOrderId, fakeGooglePubSub, FakeStoreValidators, FAKE_PUBSUB_TOKEN } from './iap/fake-stores';
import { LiveStoreValidators } from './iap/live-stores';
import { StoreUnavailableError } from './iap/store-validators';
import { createStoreValidators } from './iap/stores.provider';
import { PromoService } from './promo.service';

const FIX = resolve(__dirname, '../../../test/fixtures/stores');
const pem = (f: string) => readFileSync(resolve(FIX, f), 'utf8');
const der = (f: string) => new X509Certificate(pem(f)).raw.toString('base64');
const rootFp = new X509Certificate(pem('root.pem')).fingerprint256;

/** In-memory stand-in for the ioredis calls of the simulated Chargily backend. */
const memoryRedis = () => {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => (m.set(k, v), 'OK') } as never;
};
const recording = (answers: PayResponse[]) => {
  const seen: PayRequest[] = [];
  return { seen, transport: async (req: PayRequest) => (seen.push(req), answers.shift() ?? { status: 500, json: null }) };
};

describe('ChargilyGateway (05 §4.2)', () => {
  const o = { apiBase: 'https://pay.chargily.net/test/api/v2', secret: 'test_sk_abc', webhookUrl: 'https://api.djaber.ai/api/v1/webhooks/chargily' };

  it('createCheckout posts the Chargily v2 body (dzd, urls, webhook, metadata with our ref) with the bearer secret', async () => {
    const r = recording([{ status: 200, json: { id: '01hj5n7cqpaf0mt2d0xx85tgz8', checkout_url: 'https://pay.chargily.net/test/checkouts/01hj5n7cqpaf0mt2d0xx85tgz8/pay', status: 'pending', amount: 4900 } }]);
    const gw = new ChargilyGateway('chargily', r.transport, o);
    const c = await gw.createCheckout({ amount: 4900, currency: 'DZD', orderRef: 'ref-1', description: 'Djaber — Pro (monthly)', returnUrl: 'https://app/fr/settings/billing/return?ref=ref-1', failUrl: 'https://app/fr/settings/billing/return?ref=ref-1', metadata: { workspaceId: 'ws', kind: 'subscription', targetId: 'p' }, expiresInMin: 15, locale: 'fr' });
    expect(c.checkoutId).toBe('01hj5n7cqpaf0mt2d0xx85tgz8');
    expect(c.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(r.seen[0]).toMatchObject({ method: 'POST', url: `${o.apiBase}/checkouts`, headers: { Authorization: 'Bearer test_sk_abc' }, body: { amount: 4900, currency: 'dzd', success_url: expect.stringContaining('ref=ref-1'), failure_url: expect.any(String), webhook_endpoint: o.webhookUrl, locale: 'fr', metadata: { workspaceId: 'ws', kind: 'subscription', targetId: 'p', ref: 'ref-1' } } });
  });

  it('verify maps paid / processing / canceled / expired; 5xx and 429 are retryable, 4xx are rejections', async () => {
    const r = recording([
      { status: 200, json: { id: 'a', status: 'paid', amount: 4900, payment_method: 'edahabia' } },
      { status: 200, json: { id: 'b', status: 'processing', amount: 4900 } },
      { status: 200, json: { id: 'c', status: 'canceled', amount: 4900 } },
      { status: 200, json: { id: 'd', status: 'expired', amount: 4900 } },
      { status: 503, json: null },
      { status: 401, json: { message: 'Unauthenticated.' } },
    ]);
    const gw = new ChargilyGateway('chargily', r.transport, o);
    expect(await gw.verify('a')).toMatchObject({ status: 'paid', amount: 4900, method: 'edahabia' });
    expect((await gw.verify('b')).status).toBe('pending');
    expect((await gw.verify('c')).status).toBe('failed');
    expect((await gw.verify('d')).status).toBe('expired');
    await expect(gw.verify('e')).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(gw.verify('f')).rejects.toBeInstanceOf(PaymentProviderError);
    expect(r.seen[0]).toMatchObject({ method: 'GET', url: `${o.apiBase}/checkouts/a` });
  });

  it('parseWebhook: HMAC-SHA256 of the raw body in `signature`; unsigned, tampered or foreign-key bodies are refused', () => {
    const gw = new ChargilyGateway('chargily', async () => ({ status: 200, json: {} }), o);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'checkout.paid', data: { id: 'co_1', amount: 1900, status: 'paid', payment_method: 'cib', metadata: { workspaceId: 'w', kind: 'pack', targetId: 't' } } }));
    expect(gw.parseWebhook({ signature: chargilySignature('test_sk_abc', body) }, body)).toMatchObject({ eventId: 'evt_1', checkoutId: 'co_1', status: 'paid', amount: 1900, method: 'cib', metadata: { kind: 'pack' } });
    expect(gw.parseWebhook({}, body)).toBeNull();
    expect(gw.parseWebhook({ signature: chargilySignature('other', body) }, body)).toBeNull();
    const tampered = Buffer.from(body.toString().replace('1900', '19'));
    expect(gw.parseWebhook({ signature: chargilySignature('test_sk_abc', body) }, tampered)).toBeNull();
    const failed = Buffer.from(JSON.stringify({ id: 'evt_2', type: 'checkout.failed', data: { id: 'co_2', amount: 1900, status: 'failed' } }));
    expect(gw.parseWebhook({ signature: chargilySignature('test_sk_abc', failed) }, failed)?.status).toBe('failed');
  });

  it('SAFETY: the live driver refuses to start in development / test unless PAYMENT_ALLOW_LIVE=true; the default is the simulated Chargily', () => {
    const base = { CHARGILY_SECRET: 'x', CHARGILY_API_KEY: undefined, CHARGILY_MODE: 'test' as const, PUBLIC_API_URL: 'http://localhost:4010' };
    expect(() => createPaymentGateway({ ...base, NODE_ENV: 'development', PAYMENT_DRIVER: 'chargily', PAYMENT_ALLOW_LIVE: false }, memoryRedis())).toThrow(/refused in development/);
    expect(() => createPaymentGateway({ ...base, NODE_ENV: 'test', PAYMENT_DRIVER: 'chargily', PAYMENT_ALLOW_LIVE: false }, memoryRedis())).toThrow(/refused/);
    const fake = createPaymentGateway({ ...base, NODE_ENV: 'test', PAYMENT_DRIVER: 'fake', PAYMENT_ALLOW_LIVE: false }, memoryRedis());
    expect(fake.gateway).toBeInstanceOf(ChargilyGateway);
    expect(fake.gateway.driver).toBe('fake');
    expect(fake.gateway.provider).toBe('chargily');
    // tester report 22/10 UX-029: the staging test site keeps the simulated checkout; production refuses it (a dead end)
    expect(createPaymentGateway({ ...base, NODE_ENV: 'staging', PAYMENT_DRIVER: 'fake', PAYMENT_ALLOW_LIVE: false }, memoryRedis()).gateway.driver).toBe('fake');
    expect(() => createPaymentGateway({ ...base, NODE_ENV: 'production', PAYMENT_DRIVER: 'fake', PAYMENT_ALLOW_LIVE: false }, memoryRedis())).toThrow(/refused in production/);
    // staging / production may use it (test mode unless CHARGILY_MODE=live), never with a network call here
    const live = createPaymentGateway({ ...base, NODE_ENV: 'staging', PAYMENT_DRIVER: 'chargily', PAYMENT_ALLOW_LIVE: false }, memoryRedis(), async () => ({ status: 200, json: {} }));
    expect(live.gateway.driver).toBe('chargily');
    expect(live.fake).toBeNull();
  });

  it('the simulated Chargily API: same request shapes, checkout page URL, decisions produce correctly signed webhooks, an untouched checkout expires after 15 min', async () => {
    const backend = new FakeChargilyBackend(memoryRedis(), { pageBase: 'http://api.test/api/v1/dev-payments', secret: 'sim' });
    const gw = new ChargilyGateway('fake', backend.transport, { apiBase: 'fake://chargily/api/v2', secret: 'sim', webhookUrl: 'http://api.test/api/v1/webhooks/chargily' });
    await expect(gw.createCheckout({ amount: 20, currency: 'DZD', orderRef: 'r', description: 'd', returnUrl: 'u', failUrl: 'u', metadata: {}, expiresInMin: 15, locale: 'fr' })).rejects.toMatchObject({ kind: 'rejected' });
    const c = await gw.createCheckout({ amount: 1900, currency: 'DZD', orderRef: 'r1', description: 'Starter', returnUrl: 'http://web/fr/settings/billing/return?ref=r1', failUrl: 'http://web/fr/settings/billing/return?ref=r1', metadata: { workspaceId: 'w' }, expiresInMin: 15, locale: 'fr' });
    expect(c.url).toBe(`http://api.test/api/v1/dev-payments/${c.checkoutId}`);
    expect((await gw.verify(c.checkoutId)).status).toBe('pending');
    const pending = await backend.decide(c.checkoutId, 'pending');
    expect(pending?.webhook).toBeNull();
    const paid = await backend.decide(c.checkoutId, 'paid');
    const ev = gw.parseWebhook({ signature: paid!.webhook!.signature }, paid!.webhook!.rawBody);
    expect(ev).toMatchObject({ checkoutId: c.checkoutId, status: 'paid', amount: 1900, metadata: { workspaceId: 'w', ref: 'r1' } });
    expect(paid!.redirectUrl).toBe('http://web/fr/settings/billing/return?ref=r1');
    expect((await gw.verify(c.checkoutId)).status).toBe('paid');
    const old = await gw.createCheckout({ amount: 450, currency: 'DZD', orderRef: 'r2', description: 'pack', returnUrl: 'u', failUrl: 'f', metadata: {}, expiresInMin: 15, locale: 'fr' });
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
    expect((await gw.verify(old.checkoutId)).status).toBe('expired');
    nowSpy.mockRestore();
    expect((await backend.decide(old.checkoutId, 'failed', 'insufficient_funds'))!.redirectUrl).toBe('f');
  });
});

describe('store validators (05 §5)', () => {
  const env = { GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'iap@djaber-test.iam.gserviceaccount.com', private_key: pem('google-sa.test-key.pem'), token_uri: 'https://oauth2.googleapis.com/token' }), GOOGLE_PLAY_PACKAGE_NAME: 'ai.djaber.app', GOOGLE_PLAY_PUBSUB_TOKEN: 'pubsub-secret', APPLE_IAP_KEY_ID: 'KEY123', APPLE_IAP_ISSUER_ID: 'issuer-uuid', APPLE_IAP_PRIVATE_KEY: pem('leaf.pkcs8.pem'), APPLE_IAP_BUNDLE_ID: 'ai.djaber.app', APPLE_IAP_ENV: 'sandbox' as const, APPLE_ROOT_CA_SHA256: rootFp };
  const sandboxPurchase = JSON.parse(readFileSync(resolve(FIX, 'google-purchase.sandbox.json'), 'utf8'));
  /** A StoreKit-shaped signed transaction, signed by the test leaf with the x5c chain in its header. */
  const signApple = (payload: Record<string, unknown>, x5c = [der('leaf.pem'), der('intermediate.pem'), der('root.pem')]) =>
    new CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader({ alg: 'ES256', x5c }).sign(createPrivateKey(pem('leaf.pkcs8.pem')));

  it('Google Play: service-account token, then the recorded sandbox purchase ⇒ valid; consume after the credit; pending / cancelled / foreign token', async () => {
    const r = recording([
      { status: 200, json: { access_token: 'ya29.test', expires_in: 3599, token_type: 'Bearer' } },
      { status: 200, json: sandboxPurchase },
      { status: 204, json: null },
      { status: 200, json: { ...sandboxPurchase, purchaseState: 2 } },
      { status: 200, json: { ...sandboxPurchase, consumptionState: 1 } },
      { status: 410, json: { error: { code: 410, message: 'The purchase token is no longer valid.' } } },
      { status: 503, json: null },
    ]);
    const v = new LiveStoreValidators(env, r.transport);
    const receipt = { productId: 'djaber.credits.pack-500', transactionId: 'GPA.3378-2296-1532-17841', purchaseToken: 'opaque-token-from-play-billing' };
    expect(await v.validate('google_play', receipt)).toMatchObject({ state: 'valid', orderId: 'GPA.3378-2296-1532-17841', environment: 'Sandbox' });
    expect(r.seen[0]).toMatchObject({ method: 'POST', url: 'https://oauth2.googleapis.com/token', body: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: expect.stringMatching(/^ey/) } });
    expect(r.seen[1]).toMatchObject({ method: 'GET', url: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/ai.djaber.app/purchases/products/djaber.credits.pack-500/tokens/opaque-token-from-play-billing', headers: { Authorization: 'Bearer ya29.test' } });
    await v.acknowledge('google_play', receipt);
    expect(r.seen[2]).toMatchObject({ method: 'POST', url: expect.stringMatching(/:consume$/) });
    expect((await v.validate('google_play', receipt)).state).toBe('pending');
    expect((await v.validate('google_play', receipt)).state).toBe('invalid');
    expect((await v.validate('google_play', receipt)).state).toBe('invalid');
    await expect(v.validate('google_play', receipt)).rejects.toBeInstanceOf(StoreUnavailableError);
    expect(r.seen.filter((x) => x.url.includes('oauth2')).length).toBe(1); // token cached
  });

  it('App Store: the signed transaction is trusted only through a valid x5c chain to the pinned root; product, bundle, id, revocation checked', async () => {
    const tx = { transactionId: '2000000812345678', originalTransactionId: '2000000812345678', productId: 'djaber.credits.pack-500', bundleId: 'ai.djaber.app', environment: 'Sandbox', type: 'Consumable', signedDate: Date.now() };
    const good = await signApple(tx);
    expect(await verifyAppleJws(good, rootFp)).toMatchObject({ transactionId: '2000000812345678' });
    // wrong pinned root, a chain ending in another root, a tampered payload
    expect(await verifyAppleJws(good, '00'.repeat(32))).toBeNull();
    expect(await verifyAppleJws(await signApple(tx, [der('leaf.pem'), der('intermediate.pem'), der('rogue-root.pem')]), rootFp)).toBeNull();
    const [h, , s] = good.split('.');
    expect(await verifyAppleJws(`${h}.${Buffer.from(JSON.stringify({ ...tx, productId: 'djaber.credits.pack-6000' })).toString('base64url')}.${s}`, rootFp)).toBeNull();

    const r = recording([
      { status: 200, json: { signedTransactionInfo: good } },
      { status: 200, json: { signedTransactionInfo: await signApple({ ...tx, revocationDate: Date.now() }) } },
      { status: 404, json: { errorCode: 4040010, errorMessage: 'Transaction id not found.' } },
      { status: 500, json: null },
    ]);
    const v = new LiveStoreValidators(env, r.transport);
    const receipt = { productId: 'djaber.credits.pack-500', transactionId: '2000000812345678', receipt: good };
    expect(await v.validate('app_store', receipt)).toMatchObject({ state: 'valid', transactionId: '2000000812345678', environment: 'Sandbox' });
    expect(r.seen[0]).toMatchObject({ method: 'GET', url: 'https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/2000000812345678', headers: { Authorization: expect.stringMatching(/^Bearer ey/) } });
    expect((await v.validate('app_store', receipt)).state).toBe('invalid');
    expect((await v.validate('app_store', receipt)).state).toBe('invalid');
    await expect(v.validate('app_store', receipt)).rejects.toBeInstanceOf(StoreUnavailableError);
    expect((await v.appleTransaction(good, { ...receipt, productId: 'djaber.credits.pack-2000' })).state).toBe('invalid');
  });

  it('notifications: Google RTDN through Pub/Sub needs the push token; App Store v2 signedPayload must verify (REFUND ⇒ refund)', async () => {
    const v = new LiveStoreValidators(env, async () => ({ status: 500, json: null }));
    const body = Buffer.from(JSON.stringify(fakeGooglePubSub({ messageId: 'm-1', voided: { purchaseToken: 'tok', orderId: 'GPA.1' } })));
    expect(await v.parseNotification('google_play', { headers: {}, query: { token: 'pubsub-secret' }, rawBody: body })).toMatchObject({ kind: 'refund', externalId: 'gp:m-1', orderId: 'GPA.1', purchaseToken: 'tok' });
    expect(await v.parseNotification('google_play', { headers: {}, query: { token: 'wrong' }, rawBody: body })).toBeNull();
    expect(await v.parseNotification('google_play', { headers: {}, query: {}, rawBody: body })).toBeNull();
    const inner = await signApple({ transactionId: '2000000899', originalTransactionId: '2000000899', productId: 'djaber.credits.pack-500', bundleId: 'ai.djaber.app', revocationDate: Date.now() });
    const signedPayload = await signApple({ notificationType: 'REFUND', notificationUUID: 'uuid-1', data: { signedTransactionInfo: inner } });
    expect(await v.parseNotification('app_store', { headers: {}, query: {}, rawBody: Buffer.from(JSON.stringify({ signedPayload })) })).toMatchObject({ kind: 'refund', externalId: 'as:uuid-1', transactionId: '2000000899' });
    const forged = await new SignJWT({ notificationType: 'REFUND' }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('k'));
    expect(await v.parseNotification('app_store', { headers: {}, query: {}, rawBody: Buffer.from(JSON.stringify({ signedPayload: forged })) })).toBeNull();
  });

  it('fake stores (IAP_DRIVER=fake): sandbox-shaped verdicts, fake signed receipts, tampering detected, store-down simulation', async () => {
    const f = new FakeStoreValidators({ bundleId: 'ai.djaber.app' });
    const g = await f.validate('google_play', { productId: 'djaber.credits.pack-500', transactionId: 'x', purchaseToken: 'tok-1' });
    expect(g).toMatchObject({ state: 'valid', orderId: fakeGoogleOrderId('tok-1'), raw: { kind: 'androidpublisher#productPurchase', purchaseState: 0, purchaseType: 0 } });
    expect((await f.validate('google_play', { productId: 'p', transactionId: 'x', purchaseToken: 'invalid-1' })).state).toBe('invalid');
    expect((await f.validate('google_play', { productId: 'p', transactionId: 'x', purchaseToken: 'pending-1' })).state).toBe('pending');
    await expect(f.validate('google_play', { productId: 'p', transactionId: 'x', purchaseToken: 'unavailable-1' })).rejects.toBeInstanceOf(StoreUnavailableError);
    const receipt = await fakeAppStoreTransaction({ transactionId: '2000000001', productId: 'djaber.credits.pack-500' });
    expect((await f.validate('app_store', { productId: 'djaber.credits.pack-500', transactionId: '2000000001', receipt })).state).toBe('valid');
    expect((await f.validate('app_store', { productId: 'djaber.credits.pack-500', transactionId: '2000000002', receipt })).state).toBe('invalid');
    expect((await f.validate('app_store', { productId: 'djaber.credits.pack-500', transactionId: '2000000001', receipt: receipt.slice(0, -3) + 'abc' })).state).toBe('invalid');
    expect((await f.validate('app_store', { productId: 'djaber.credits.pack-500', transactionId: '2000000001', receipt: await fakeAppStoreTransaction({ transactionId: '2000000001', productId: 'djaber.credits.pack-500', bundleId: 'com.other' }) })).state).toBe('invalid');
    const n = await fakeAppStoreNotification({ type: 'REFUND', transactionId: '2000000001', productId: 'djaber.credits.pack-500' });
    expect(await f.parseNotification('app_store', { headers: {}, query: {}, rawBody: Buffer.from(JSON.stringify(n)) })).toMatchObject({ kind: 'refund', transactionId: '2000000001' });
    expect(await f.parseNotification('google_play', { headers: {}, query: { token: FAKE_PUBSUB_TOKEN }, rawBody: Buffer.from(JSON.stringify(fakeGooglePubSub({ messageId: 'x', test: true }))) })).toMatchObject({ kind: 'test' });
  });

  it('SAFETY: IAP_DRIVER=stores is refused in development / test unless IAP_ALLOW_LIVE=true', () => {
    expect(() => createStoreValidators({ ...env, NODE_ENV: 'test', IAP_DRIVER: 'stores', IAP_ALLOW_LIVE: false })).toThrow(/refused/);
    expect(createStoreValidators({ ...env, NODE_ENV: 'development', IAP_DRIVER: 'fake', IAP_ALLOW_LIVE: false }).driver).toBe('fake');
    expect(createStoreValidators({ ...env, NODE_ENV: 'production', IAP_DRIVER: 'stores', IAP_ALLOW_LIVE: false }, async () => ({ status: 500, json: null })).driver).toBe('stores');
  });
});

describe('billing rules', () => {
  it('prorata (03 §37 BIL, AT-DLG-65): (new − current) × days left / period days, rounded; unused value for a cycle change', () => {
    const start = new Date('2026-10-01T10:00:00Z');
    const end = addMonths(start, 1);
    const p = prorata({ price: 4900, currentPrice: 1900, periodStart: start, periodEnd: end, now: new Date('2026-10-11T10:00:00Z') });
    expect(p).toEqual({ totalDays: 31, remainingDays: 21, amount: Math.round((3000 * 21) / 31), unused: Math.round((1900 * 21) / 31) });
    expect(prorata({ price: 1900, currentPrice: 4900, periodStart: start, periodEnd: end, now: start }).amount).toBe(0);
    expect(addCycle(new Date('2026-01-31T00:00:00Z'), 'monthly').toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addCycle(new Date('2026-01-31T00:00:00Z'), 'yearly').toISOString()).toBe('2027-01-31T00:00:00.000Z');
  });

  it('promo amounts: percent, fixed DA, never below 0; referral credits default', () => {
    expect(PromoService.apply({ kind: 'percent_discount', value: 20 }, 4900)).toBe(3920);
    expect(PromoService.apply({ kind: 'fixed_discount', value: 500 }, 1900)).toBe(1400);
    expect(PromoService.apply({ kind: 'fixed_discount', value: 5000 }, 1900)).toBe(0);
    expect(PromoService.apply({ kind: 'credits', value: 300 }, 1900)).toBe(1900);
    expect(PromoService.isReferral('parrain-abc')).toBe(true);
    expect(REFERRAL_CREDITS).toBe(300);
  });
});
