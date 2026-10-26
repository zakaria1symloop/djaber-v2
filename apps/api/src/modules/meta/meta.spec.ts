// Meta port: adapter selection guard, webhook / signed_request signatures, the fake adapter (no network, ever).
import { createHmac } from 'node:crypto';
import { FAKE_MEDIA_HOST, FakeMetaGateway } from './fake-meta.gateway';
import { GraphMetaGateway } from './graph-meta.gateway';
import { classifyMetaError, MetaError, metaErrorCode } from './meta-errors';
import { buildSignedRequest, parseSignedRequest, signWebhookBody, verifyWebhookSignature } from './meta-signature';
import { createMetaGateway } from './meta.module';

const env = (over: Record<string, unknown> = {}) =>
  ({ NODE_ENV: 'development', META_DRIVER: 'fake', META_ALLOW_LIVE: false, META_APP_ID: 'app', META_APP_SECRET: 'secret', INSTAGRAM_APP_ID: 'ig', INSTAGRAM_APP_SECRET: 'igs', META_GRAPH_VERSION: 'v21.0', ...over }) as Parameters<typeof createMetaGateway>[0];

describe('adapter selection (safety guard: the live V1 product uses the same Meta app)', () => {
  it('fake by default, in every environment', () => {
    for (const NODE_ENV of ['development', 'test', 'staging', 'production']) expect(createMetaGateway(env({ NODE_ENV }))).toBeInstanceOf(FakeMetaGateway);
  });

  it('META_DRIVER=graph is refused in development and test unless META_ALLOW_LIVE=true', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() => createMetaGateway(env({ NODE_ENV, META_DRIVER: 'graph' }))).toThrow(/refused in development \/ test/);
      expect(createMetaGateway(env({ NODE_ENV, META_DRIVER: 'graph', META_ALLOW_LIVE: true }))).toBeInstanceOf(GraphMetaGateway);
    }
  });

  it('staging / production start the Graph adapter, and only with the app credentials', () => {
    expect(createMetaGateway(env({ NODE_ENV: 'production', META_DRIVER: 'graph' }))).toBeInstanceOf(GraphMetaGateway);
    expect(createMetaGateway(env({ NODE_ENV: 'staging', META_DRIVER: 'graph' }))).toBeInstanceOf(GraphMetaGateway);
    expect(() => createMetaGateway(env({ NODE_ENV: 'production', META_DRIVER: 'graph', META_APP_SECRET: '' }))).toThrow(/META_APP_ID and META_APP_SECRET/);
  });

  it('the refusal message never contains a secret', () => {
    try {
      createMetaGateway(env({ META_DRIVER: 'graph', META_APP_SECRET: 'super-secret-value' }));
    } catch (e) {
      expect(String(e)).not.toContain('super-secret-value');
    }
  });
});

describe('webhook signature (X-Hub-Signature-256)', () => {
  const secret = 'unit-secret';
  const raw = Buffer.from('{"object":"page","entry":[]}');
  const good = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  it('valid / invalid / missing', () => {
    expect(signWebhookBody(secret, raw)).toBe(good);
    expect(verifyWebhookSignature(secret, raw, good)).toBe(true);
    expect(verifyWebhookSignature(secret, Buffer.from(`${raw.toString()} `), good)).toBe(false); // one byte more
    expect(verifyWebhookSignature('other', raw, good)).toBe(false);
    expect(verifyWebhookSignature(secret, raw, good.replace('sha256=', 'sha1='))).toBe(false);
    expect(verifyWebhookSignature(secret, raw, good.slice(0, -2))).toBe(false);
    expect(verifyWebhookSignature(secret, raw, undefined)).toBe(false);
    expect(verifyWebhookSignature(secret, raw, ['sha256=x'])).toBe(false);
    expect(verifyWebhookSignature(secret, undefined, good)).toBe(false);
    // without a configured secret nothing verifies (never "open by default")
    expect(verifyWebhookSignature(undefined, raw, good)).toBe(false);
    expect(verifyWebhookSignature('', raw, `sha256=${createHmac('sha256', '').update(raw).digest('hex')}`)).toBe(false);
  });
});

describe('data-deletion signed_request', () => {
  const secret = 'unit-secret';
  it('round trip, tampering, wrong secret, wrong algorithm', () => {
    const signed = buildSignedRequest(secret, { user_id: '6789012345678901' });
    expect(parseSignedRequest(secret, signed)).toMatchObject({ user_id: '6789012345678901', algorithm: 'HMAC-SHA256' });
    const [sig, payload] = signed.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '1' })).toString('base64url');
    expect(parseSignedRequest(secret, `${sig}.${forged}`)).toBeNull();
    expect(parseSignedRequest('other', signed)).toBeNull();
    expect(parseSignedRequest(secret, payload)).toBeNull();
    expect(parseSignedRequest(secret, '')).toBeNull();
    expect(parseSignedRequest(secret, undefined)).toBeNull();
    expect(parseSignedRequest(undefined, signed)).toBeNull();
    const plain = Buffer.from(JSON.stringify({ algorithm: 'none', user_id: '1' })).toString('base64url');
    expect(parseSignedRequest(secret, `${createHmac('sha256', secret).update(plain).digest('base64url')}.${plain}`)).toBeNull();
    // Meta's own encoding of the signature may carry padding
    expect(parseSignedRequest(secret, `${sig}=.${payload}`)).toMatchObject({ user_id: '6789012345678901' });
  });
});

describe('error classes → catalogue codes', () => {
  it.each([
    [{ code: 190, error_subcode: 463 }, 'token', 'PAGE_TOKEN_EXPIRED'],
    [{ code: 200 }, 'permission', 'PAGE_TOKEN_EXPIRED'],
    [{ code: 10, error_subcode: 2018108 }, 'permission', 'PAGE_TOKEN_EXPIRED'],
    [{ code: 10, error_subcode: 2018278 }, 'window', 'REPLY_OUTSIDE_WINDOW'],
    [{ code: 100, error_subcode: 2018276, message: 'tag not allowed' }, 'window', 'REPLY_OUTSIDE_WINDOW'], // HUMAN_AGENT refused: app not approved (tester account 26/10)
    [{ code: 17 }, 'rate_limit', 'META_UNAVAILABLE'],
    [{ code: 32 }, 'rate_limit', 'META_UNAVAILABLE'],
    [{ code: 368 }, 'unavailable', 'META_UNAVAILABLE'],
    [{ code: 1 }, 'unavailable', 'META_UNAVAILABLE'],
    [{ code: 551, error_subcode: 1545041 }, 'user_unavailable', 'PROVIDER_UNAVAILABLE'],
    [{ code: 100, error_subcode: 2534015 }, 'invalid_attachment', 'PROVIDER_UNAVAILABLE'],
    [{ code: 10 }, 'unknown', 'PROVIDER_UNAVAILABLE'],
  ])('%j ⇒ %s ⇒ %s', (body, kind, code) => {
    const e = classifyMetaError(body);
    expect(e.kind).toBe(kind);
    expect(metaErrorCode(e)).toBe(code);
  });
});

describe('fake adapter', () => {
  const realFetch = globalThis.fetch;
  const spy = jest.fn(async () => {
    throw new Error('network');
  });
  beforeAll(() => {
    globalThis.fetch = spy as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('runs the whole connect + messaging surface without a single network call', async () => {
    const fake = new FakeMetaGateway();
    const redirectUri = 'http://localhost:4010/api/v1/channels/callback/facebook';
    const dialog = new URL(fake.facebookDialogUrl({ state: 'S', redirectUri, scopes: [], hint: 'abc' }));
    // the "dialog" is our own callback: the browser never leaves the application
    expect(`${dialog.origin}${dialog.pathname}`).toBe(redirectUri);
    expect(Object.fromEntries(dialog.searchParams)).toEqual({ code: 'fake.abc', state: 'S' });
    const user = await fake.exchangeFacebookCode('fake.abc', redirectUri);
    const pages = await fake.listPages(user.accessToken);
    expect(pages).toHaveLength(2);
    expect(await fake.listPages(user.accessToken)).toEqual(pages); // deterministic
    expect((await fake.listPages((await fake.exchangeFacebookCode('fake.other', redirectUri)).accessToken))[0]!.id).not.toBe(pages[0]!.id);
    expect(await fake.linkedInstagram(pages[0]!.id)).toMatchObject({ id: expect.stringMatching(/^17\d+$/) });
    expect(await fake.linkedInstagram(pages[1]!.id)).toBeNull();
    const auth = { platform: 'facebook' as const, externalId: pages[0]!.id, token: pages[0]!.accessToken! };
    await fake.subscribePage(auth);
    await fake.unsubscribePage(auth);
    const sent = await fake.send(auth, { recipientId: '1', message: { kind: 'text', text: 'x' }, messagingType: 'RESPONSE' });
    expect(sent.messageId).toMatch(/^m_fake_/);
    await fake.senderAction(auth, '1', 'typing_on');
    await fake.userProfile(auth, '1234567');
    await fake.conversations(auth, { conversations: 25, messages: 25 });
    await fake.pageInfo(auth);
    await fake.insights(auth);
    await fake.debugToken(auth.token);
    const ig = await fake.exchangeInstagramCode('fake.abc', redirectUri);
    await fake.instagramProfile(ig.accessToken);
    await fake.refreshInstagramToken(ig.accessToken);
    expect((await fake.download(`${FAKE_MEDIA_HOST}/x.jpg`)).mime).toBe('image/jpeg');
    // a real URL is refused, not fetched
    await expect(fake.download('https://scontent.xx.fbcdn.net/v/real.jpg')).rejects.toBeInstanceOf(MetaError);
    expect(fake.callsOf('subscribePage')).toEqual([{ op: 'subscribePage', args: { platform: 'facebook', externalId: pages[0]!.id } }]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('scripted failures are consumed in order', async () => {
    const fake = new FakeMetaGateway();
    const auth = { platform: 'facebook' as const, externalId: '1', token: 't' };
    fake.failNext('send', new MetaError('rate_limit', 'limit', 613));
    await expect(fake.send(auth, { recipientId: '1', message: { kind: 'text', text: 'x' }, messagingType: 'RESPONSE' })).rejects.toMatchObject({ kind: 'rate_limit' });
    await expect(fake.send(auth, { recipientId: '1', message: { kind: 'text', text: 'x' }, messagingType: 'RESPONSE' })).resolves.toBeTruthy();
    fake.invalidTokens.add('t');
    await expect(fake.send(auth, { recipientId: '1', message: { kind: 'text', text: 'x' }, messagingType: 'RESPONSE' })).rejects.toMatchObject({ kind: 'token', code: 190 });
  });
});
