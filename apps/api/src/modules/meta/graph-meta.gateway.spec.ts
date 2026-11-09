// Contract tests of the Graph adapter (05-integrations §1): exact URLs, methods, headers and bodies, with `fetch`
// stubbed and hand-written fixtures (test/fixtures/meta). NO network: the adapter only ever receives the stub, the
// stub refuses any host that is not a Meta API host, and the global `fetch` is replaced by one that fails the test.
import * as fx from '../../../test/fixtures/meta/graph.fixtures';
import { GraphMetaGateway } from './graph-meta.gateway';
import { MetaError } from './meta-errors';
import { FACEBOOK_SCOPES, INSTAGRAM_SCOPES, type MetaChannelAuth } from './meta.gateway';

const ALLOWED_HOSTS = new Set(['graph.facebook.com', 'graph.instagram.com', 'api.instagram.com', 'scontent.xx.fbcdn.net']);
type Call = { method: string; url: string; headers: Record<string, string>; body: string | null };
type Reply = { status?: number; json?: unknown; body?: Buffer; contentType?: string; throws?: Error };

/** A `fetch` that never leaves the process: it replays queued replies and records what it was asked. */
const stubFetch = () => {
  const calls: Call[] = [];
  const queue: Reply[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const host = new URL(url).hostname;
    if (!ALLOWED_HOSTS.has(host)) throw new Error(`TEST FAILURE: unexpected host ${host}`);
    calls.push({ method: init?.method ?? 'GET', url, headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === 'string' ? init.body : null });
    expect(init?.signal).toBeInstanceOf(AbortSignal); // every call carries the timeout
    const r = queue.shift();
    if (!r) throw new Error(`TEST FAILURE: unexpected call ${init?.method ?? 'GET'} ${url}`);
    if (r.throws) throw r.throws;
    if (r.body) return new Response(new Uint8Array(r.body), { status: r.status ?? 200, headers: { 'content-type': r.contentType ?? 'application/octet-stream' } });
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls, reply: (...r: Reply[]) => queue.push(...r), pending: () => queue.length };
};

const APP = { appId: '100000000000001', appSecret: 'fixture-app-secret', instagramAppId: '200000000000002', instagramAppSecret: 'fixture-ig-secret', version: 'v21.0' };
const REDIRECT = 'https://api.djaber.test/api/v1/channels/callback/facebook';
const IG_REDIRECT = 'https://api.djaber.test/api/v1/channels/callback/instagram';
const page: MetaChannelAuth = { platform: 'facebook', externalId: '104455667788990', token: fx.TOKENS.page };
const igViaPage: MetaChannelAuth = { platform: 'instagram', externalId: '17841400000000001', token: fx.TOKENS.page, viaPage: true, pageId: '104455667788990' };
const igLogin: MetaChannelAuth = { platform: 'instagram', externalId: '17841400000000002', token: fx.TOKENS.igLong };
const q = (url: string) => Object.fromEntries(new URL(url).searchParams);
const path = (url: string) => `${new URL(url).origin}${new URL(url).pathname}`;

let net: ReturnType<typeof stubFetch>;
let graph: GraphMetaGateway;
const realFetch = globalThis.fetch;
const globalFetch = jest.fn(async () => {
  throw new Error('TEST FAILURE: the real network was reached');
});
beforeAll(() => {
  globalThis.fetch = globalFetch as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  net = stubFetch();
  graph = new GraphMetaGateway({ ...APP, fetchImpl: net.impl });
});
afterEach(() => {
  expect(net.pending()).toBe(0); // every scripted reply was consumed
  expect(globalFetch).not.toHaveBeenCalled(); // and nothing went around the stub
});

describe('OAuth — Facebook (05 §1.5)', () => {
  it('dialog URL carries client id, redirect, signed state and the scopes', () => {
    const u = new URL(graph.facebookDialogUrl({ state: 'STATE.SIG', redirectUri: REDIRECT, scopes: [...FACEBOOK_SCOPES] }));
    expect(`${u.origin}${u.pathname}`).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: APP.appId,
      redirect_uri: REDIRECT,
      state: 'STATE.SIG',
      scope: 'pages_show_list,pages_manage_metadata,pages_messaging,pages_read_engagement,pages_read_user_content,instagram_basic,instagram_manage_messages',
      response_type: 'code',
    });
    expect(net.calls).toHaveLength(0); // building a URL calls nothing
  });

  it('code → short-lived → long-lived user token', async () => {
    net.reply({ json: fx.oauthShort }, { json: fx.oauthLong });
    const token = await graph.exchangeFacebookCode(fx.TOKENS.code, REDIRECT);
    expect(token).toEqual({ accessToken: fx.TOKENS.longUser, expiresInSec: 5184000, scopes: [] });
    expect(net.calls.map((c) => [c.method, path(c.url)])).toEqual([['GET', 'https://graph.facebook.com/v21.0/oauth/access_token'], ['GET', 'https://graph.facebook.com/v21.0/oauth/access_token']]);
    expect(q(net.calls[0]!.url)).toEqual({ client_id: APP.appId, client_secret: APP.appSecret, redirect_uri: REDIRECT, code: fx.TOKENS.code });
    expect(q(net.calls[1]!.url)).toEqual({ grant_type: 'fb_exchange_token', client_id: APP.appId, client_secret: APP.appSecret, fb_exchange_token: fx.TOKENS.shortUser });
  });

  it('/me/accounts is paginated and capped; pages keep their token, tasks and picture', async () => {
    net.reply({ json: fx.accountsPage1 }, { json: fx.accountsPage2 });
    const pages = await graph.listPages(fx.TOKENS.longUser);
    expect(path(net.calls[0]!.url)).toBe('https://graph.facebook.com/v21.0/me/accounts');
    expect(q(net.calls[0]!.url)).toEqual({ fields: 'id,name,access_token,tasks,picture{url}', limit: '100', access_token: fx.TOKENS.longUser });
    expect(net.calls[1]!.url).toBe(fx.accountsPage1.paging.next); // the cursor URL Meta returned, on the Graph host
    expect(pages).toEqual([
      { id: '104455667788990', name: 'Boutique Yasmine', accessToken: fx.TOKENS.page, tasks: expect.arrayContaining(['MESSAGING']), pictureUrl: 'https://scontent.xx.fbcdn.net/v/p1.jpg', followersCount: null },
      { id: '104455667788991', name: 'Page sans messagerie', accessToken: 'EAAB-page-token-2', tasks: ['ANALYZE'], pictureUrl: 'https://scontent.xx.fbcdn.net/v/p2.jpg', followersCount: null },
      { id: '104455667788992', name: 'Page sans jeton', accessToken: null, tasks: ['MESSAGING'], pictureUrl: null, followersCount: null },
    ]);
  });

  it('a `paging.next` that leaves the Graph host is not followed', async () => {
    net.reply({ json: { ...fx.accountsPage1, paging: { next: 'https://evil.example/steal?access_token=x' } } });
    expect(await graph.listPages(fx.TOKENS.longUser)).toHaveLength(2);
    expect(net.calls).toHaveLength(1);
  });

  it('linked Instagram business account of a page', async () => {
    net.reply({ json: fx.linkedInstagram }, { json: fx.noLinkedInstagram });
    expect(await graph.linkedInstagram('104455667788990', fx.TOKENS.page)).toEqual({ id: '17841400000000001', name: 'Boutique Yasmine', username: 'boutique.yasmine', pictureUrl: 'https://scontent.cdninstagram.com/v/ig.jpg' });
    expect(await graph.linkedInstagram('104455667788990', fx.TOKENS.page)).toBeNull();
    expect(path(net.calls[0]!.url)).toBe('https://graph.facebook.com/v21.0/104455667788990');
    expect(q(net.calls[0]!.url)).toEqual({ fields: 'instagram_business_account{id,name,username,profile_picture_url}', access_token: fx.TOKENS.page });
  });
});

describe('OAuth — Instagram Business Login and tokens', () => {
  it('dialog URL', () => {
    const u = new URL(graph.instagramDialogUrl({ state: 'S', redirectUri: IG_REDIRECT, scopes: [...INSTAGRAM_SCOPES] }));
    expect(`${u.origin}${u.pathname}`).toBe('https://www.instagram.com/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: APP.instagramAppId, redirect_uri: IG_REDIRECT, response_type: 'code', scope: 'instagram_business_basic,instagram_business_manage_messages', state: 'S' });
  });

  it('code → short-lived (form POST) → long-lived token (60 days)', async () => {
    net.reply({ json: fx.igOauthShort }, { json: fx.igOauthLong });
    expect(await graph.exchangeInstagramCode('IG-CODE', IG_REDIRECT)).toEqual({ accessToken: fx.TOKENS.igLong, expiresInSec: 5183944, userId: '17841400000000002' });
    const [short, long] = net.calls;
    expect([short!.method, short!.url]).toEqual(['POST', 'https://api.instagram.com/oauth/access_token']);
    expect(short!.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(short!.body!))).toEqual({ client_id: APP.instagramAppId, client_secret: APP.instagramAppSecret, grant_type: 'authorization_code', redirect_uri: IG_REDIRECT, code: 'IG-CODE' });
    expect([long!.method, path(long!.url)]).toEqual(['GET', 'https://graph.instagram.com/access_token']);
    expect(q(long!.url)).toEqual({ grant_type: 'ig_exchange_token', client_secret: APP.instagramAppSecret, access_token: fx.TOKENS.igShort });
    // the `{ data: [...] }` response shape is accepted too
    net.reply({ json: { data: [fx.igOauthShort] } }, { json: fx.igOauthLong });
    expect((await graph.exchangeInstagramCode('IG-CODE', IG_REDIRECT)).userId).toBe('17841400000000002');
  });

  it('profile, refresh, debug_token', async () => {
    net.reply({ json: fx.igProfile }, { json: fx.igRefresh }, { json: fx.debugTokenValid }, { json: fx.debugTokenInvalid });
    expect(await graph.instagramProfile(fx.TOKENS.igLong)).toEqual({ id: '17841400000000002', name: 'Atelier DZ', username: 'atelier.dz', pictureUrl: 'https://scontent.cdninstagram.com/v/me.jpg' });
    expect(path(net.calls[0]!.url)).toBe('https://graph.instagram.com/v21.0/me');
    expect(q(net.calls[0]!.url)).toEqual({ fields: 'user_id,username,name,profile_picture_url', access_token: fx.TOKENS.igLong });

    expect(await graph.refreshInstagramToken(fx.TOKENS.igLong)).toEqual({ accessToken: fx.TOKENS.igRefreshed, expiresInSec: 5184000, userId: null });
    expect(path(net.calls[1]!.url)).toBe('https://graph.instagram.com/refresh_access_token');
    expect(q(net.calls[1]!.url)).toEqual({ grant_type: 'ig_refresh_token', access_token: fx.TOKENS.igLong });

    expect(await graph.debugToken(fx.TOKENS.page)).toEqual({ isValid: true, expiresAt: null, scopes: ['pages_messaging', 'pages_manage_metadata'] });
    expect(path(net.calls[2]!.url)).toBe('https://graph.facebook.com/v21.0/debug_token');
    expect(q(net.calls[2]!.url)).toEqual({ input_token: fx.TOKENS.page, access_token: `${APP.appId}|${APP.appSecret}` });
    expect((await graph.debugToken(fx.TOKENS.page)).isValid).toBe(false);
  });
});

describe('page subscription', () => {
  it('subscribe / unsubscribe a Facebook page', async () => {
    net.reply({ json: fx.subscribed }, { json: fx.subscribed });
    await graph.subscribePage(page);
    await graph.unsubscribePage(page);
    expect([net.calls[0]!.method, path(net.calls[0]!.url)]).toEqual(['POST', 'https://graph.facebook.com/v21.0/104455667788990/subscribed_apps']);
    expect(q(net.calls[0]!.url)).toEqual({ subscribed_fields: 'messages,messaging_postbacks,messaging_optins,message_reads', access_token: fx.TOKENS.page });
    expect([net.calls[1]!.method, path(net.calls[1]!.url)]).toEqual(['DELETE', 'https://graph.facebook.com/v21.0/104455667788990/subscribed_apps']);
    expect(q(net.calls[1]!.url)).toEqual({ access_token: fx.TOKENS.page });
  });

  it('Instagram Business Login account; a linked account inherits its page (no call)', async () => {
    net.reply({ json: fx.subscribed }, { json: fx.subscribed });
    await graph.subscribePage(igLogin);
    await graph.unsubscribePage(igLogin);
    expect([net.calls[0]!.method, net.calls[0]!.url]).toEqual(['POST', 'https://graph.instagram.com/v21.0/me/subscribed_apps?subscribed_fields=messages']);
    expect(net.calls[0]!.headers.Authorization).toBe(`Bearer ${fx.TOKENS.igLong}`);
    expect([net.calls[1]!.method, net.calls[1]!.url]).toEqual(['DELETE', 'https://graph.instagram.com/v21.0/me/subscribed_apps']);
    await graph.subscribePage(igViaPage);
    await graph.unsubscribePage(igViaPage);
    expect(net.calls).toHaveLength(2);
  });
});

describe('send API (05 §1.4)', () => {
  const recipientId = '6789012345678901';
  const bodyOf = (i: number) => JSON.parse(net.calls[i]!.body!);

  it('Messenger text: POST /me/messages with messaging_type RESPONSE', async () => {
    net.reply({ json: fx.sendOk });
    const res = await graph.send(page, { recipientId, message: { kind: 'text', text: 'Bonjour 👋' }, messagingType: 'RESPONSE' });
    expect(res).toEqual({ messageId: 'm_AbCdEfGhIjKlMnOpQrStUvWxYz', recipientId });
    expect([net.calls[0]!.method, net.calls[0]!.url]).toEqual(['POST', `https://graph.facebook.com/v21.0/me/messages?access_token=${fx.TOKENS.page}`]);
    expect(net.calls[0]!.headers['Content-Type']).toBe('application/json');
    expect(bodyOf(0)).toEqual({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: 'Bonjour 👋' } });
  });

  it('message tags, attachments and the generic template', async () => {
    net.reply({ json: fx.sendOk }, { json: fx.sendOk }, { json: fx.sendOk }, { json: fx.sendOk });
    await graph.send(page, { recipientId, message: { kind: 'text', text: 'Je reviens vers vous' }, messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
    await graph.send(page, { recipientId, message: { kind: 'text', text: 'Votre commande est en route' }, messagingType: 'MESSAGE_TAG', tag: 'POST_PURCHASE_UPDATE' });
    await graph.send(page, { recipientId, message: { kind: 'attachment', type: 'image', url: 'https://cdn.djaber.ai/ws/1/p.webp' }, messagingType: 'RESPONSE' });
    await graph.send(page, { recipientId, message: { kind: 'generic', elements: [{ title: 'Robe', subtitle: '2 500 DA', imageUrl: 'https://cdn.djaber.ai/r.webp', buttons: [{ title: 'Commander', payload: 'ORDER:p1' }, { title: 'Plus de photos', payload: 'PHOTOS:p1' }] }] }, messagingType: 'RESPONSE' });
    expect(bodyOf(0)).toEqual({ recipient: { id: recipientId }, messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT', message: { text: 'Je reviens vers vous' } });
    expect(bodyOf(1)).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'POST_PURCHASE_UPDATE' });
    expect(bodyOf(2)).toEqual({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { attachment: { type: 'image', payload: { url: 'https://cdn.djaber.ai/ws/1/p.webp', is_reusable: true } } } });
    expect(bodyOf(3).message).toEqual({
      attachment: { type: 'template', payload: { template_type: 'generic', elements: [{ title: 'Robe', subtitle: '2 500 DA', image_url: 'https://cdn.djaber.ai/r.webp', buttons: [{ type: 'postback', title: 'Commander', payload: 'ORDER:p1' }, { type: 'postback', title: 'Plus de photos', payload: 'PHOTOS:p1' }] }] } },
    });
  });

  it('Instagram: Business Login tokens use graph.instagram.com with a bearer; linked accounts use the page token; tags are never sent', async () => {
    net.reply({ json: fx.sendOk }, { json: fx.sendOk });
    await graph.send(igLogin, { recipientId, message: { kind: 'text', text: 'Salam' }, messagingType: 'RESPONSE' });
    await graph.send(igViaPage, { recipientId, message: { kind: 'text', text: 'Salam' }, messagingType: 'RESPONSE' });
    expect([net.calls[0]!.method, net.calls[0]!.url]).toEqual(['POST', 'https://graph.instagram.com/v21.0/me/messages']);
    expect(net.calls[0]!.headers.Authorization).toBe(`Bearer ${fx.TOKENS.igLong}`);
    expect(net.calls[1]!.url).toBe(`https://graph.facebook.com/v21.0/me/messages?access_token=${fx.TOKENS.page}`);
    await expect(graph.send(igLogin, { recipientId, message: { kind: 'text', text: 'x' }, messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })).rejects.toMatchObject({ kind: 'window' });
    expect(net.calls).toHaveLength(2); // refused before any call
  });

  it('sender actions and user profiles', async () => {
    net.reply({ json: { recipient_id: recipientId } }, { json: { recipient_id: recipientId } }, { json: fx.profileFb }, { json: fx.profileIg });
    await graph.senderAction(page, recipientId, 'typing_on');
    await graph.senderAction(page, recipientId, 'mark_seen');
    expect(bodyOf(0)).toEqual({ recipient: { id: recipientId }, sender_action: 'typing_on' });
    expect(bodyOf(1)).toEqual({ recipient: { id: recipientId }, sender_action: 'mark_seen' });
    expect(await graph.userProfile(page, recipientId)).toEqual({ name: 'Karim Bensalem', avatarUrl: fx.profileFb.profile_pic });
    expect(path(net.calls[2]!.url)).toBe(`https://graph.facebook.com/v21.0/${recipientId}`);
    expect(q(net.calls[2]!.url)).toEqual({ fields: 'first_name,last_name,profile_pic', access_token: fx.TOKENS.page });
    expect(await graph.userProfile(igLogin, '1122334455667788')).toEqual({ name: 'Sara H.', avatarUrl: fx.profileIg.profile_pic });
    expect(net.calls[3]!.url).toBe('https://graph.instagram.com/v21.0/1122334455667788?fields=name%2Cusername%2Cprofile_pic');
    expect(net.calls[3]!.headers.Authorization).toBe(`Bearer ${fx.TOKENS.igLong}`);
  });
});

describe('history, page info, insights (05 §1.6)', () => {
  it('conversations: ≤ 25 × 25, the customer is the participant that is not the page', async () => {
    net.reply({ json: fx.conversations }, { json: fx.conversations });
    const list = await graph.conversations(page, { conversations: 25, messages: 25 });
    expect(path(net.calls[0]!.url)).toBe('https://graph.facebook.com/v21.0/104455667788990/conversations');
    expect(q(net.calls[0]!.url)).toEqual({ fields: 'id,updated_time,participants,messages.limit(25){id,from,to,message,attachments,created_time}', limit: '25', access_token: fx.TOKENS.page });
    expect(list).toEqual([
      {
        id: 't_10158000000000001',
        updatedAt: '2026-10-10T18:22:10+0000',
        participantId: '6789012345678901',
        participantName: 'Karim Bensalem',
        messages: [
          { id: 'm_hist_2', fromId: '104455667788990', text: '2 500 DA, livraison 58 wilayas', createdAt: '2026-10-10T18:22:10+0000', attachments: [] },
          { id: 'm_hist_1', fromId: '6789012345678901', text: null, createdAt: '2026-10-10T18:20:01+0000', attachments: [{ type: 'image', url: 'https://scontent.xx.fbcdn.net/v/hist.jpg', mime: 'image/jpeg', name: 'photo.jpg' }] },
        ],
      },
    ]);
    // a linked Instagram account is read through its page, with platform=instagram
    await graph.conversations(igViaPage, { conversations: 25, messages: 25 });
    expect(path(net.calls[1]!.url)).toBe('https://graph.facebook.com/v21.0/104455667788990/conversations');
    expect(q(net.calls[1]!.url)).toMatchObject({ platform: 'instagram', limit: '25' });
  });

  it('page info and insights', async () => {
    net.reply({ json: fx.pageInfo }, { json: fx.insights });
    expect(await graph.pageInfo(page)).toEqual({ name: 'Boutique Yasmine', avatarUrl: 'https://scontent.xx.fbcdn.net/v/p1.jpg', followersCount: 15230 });
    expect(q(net.calls[0]!.url)).toEqual({ fields: 'name,picture{url},followers_count', access_token: fx.TOKENS.page });
    expect(await graph.insights(page)).toEqual([{ key: 'page_messages_total_messaging_connections', value: 418 }, { key: 'page_fans', value: 15230 }]);
    expect(path(net.calls[1]!.url)).toBe('https://graph.facebook.com/v21.0/104455667788990/insights');
    expect(q(net.calls[1]!.url)).toEqual({ metric: 'page_messages_total_messaging_connections,page_fans', period: 'day', access_token: fx.TOKENS.page });
  });

  it('media download: Meta CDN hosts only, over https', async () => {
    net.reply({ body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), contentType: 'image/jpeg; charset=binary' });
    const file = await graph.download('https://scontent.xx.fbcdn.net/v/t1/photo.jpg?oh=abc');
    expect(file).toEqual({ body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), mime: 'image/jpeg' });
    for (const url of ['http://scontent.xx.fbcdn.net/v/x.jpg', 'https://169.254.169.254/latest/meta-data', 'https://localhost:4010/health', 'https://evil.example/fbcdn.net/x.jpg', 'notaurl']) {
      await expect(graph.download(url)).rejects.toMatchObject({ kind: 'invalid_attachment' });
    }
    expect(net.calls).toHaveLength(1); // refused URLs never reached fetch
  });
});

describe('error mapping (05 §1.4 table)', () => {
  const recipientId = '6789012345678901';
  const send = () => graph.send(page, { recipientId, message: { kind: 'text', text: 'x' }, messagingType: 'RESPONSE' });
  const rows: [string, Reply, Partial<MetaError> & { retryable: boolean; needsReconnect: boolean }][] = [
    ['190 token invalid', { status: 400, json: fx.errors.token190 }, { kind: 'token', code: 190, subcode: 460, retryable: false, needsReconnect: true }],
    ['OAuthException 102', { status: 400, json: fx.errors.oauth102 }, { kind: 'token', code: 102, retryable: false, needsReconnect: true }],
    ['10 / 2018278 outside window', { status: 400, json: fx.errors.outsideWindow }, { kind: 'window', code: 10, subcode: 2018278, retryable: false, needsReconnect: false }],
    ['10 / 2018065 no messaging permission', { status: 403, json: fx.errors.noMessagingPermission }, { kind: 'permission', retryable: false, needsReconnect: true }],
    ['200 permission denied', { status: 403, json: fx.errors.permission200 }, { kind: 'permission', code: 200, retryable: false, needsReconnect: true }],
    ['613 rate limit', { status: 400, json: fx.errors.rateLimit613 }, { kind: 'rate_limit', code: 613, retryable: true, needsReconnect: false }],
    ['4 rate limit', { status: 400, json: fx.errors.rateLimit4 }, { kind: 'rate_limit', code: 4, retryable: true, needsReconnect: false }],
    ['551 user unavailable', { status: 400, json: fx.errors.userUnavailable }, { kind: 'user_unavailable', retryable: false, needsReconnect: false }],
    ['100 / 2534014 invalid attachment', { status: 400, json: fx.errors.invalidAttachment }, { kind: 'invalid_attachment', retryable: false, needsReconnect: false }],
    ['2 temporary', { status: 500, json: fx.errors.temporary2 }, { kind: 'unavailable', code: 2, retryable: true, needsReconnect: false }],
    ['anything else', { status: 400, json: fx.errors.unknown }, { kind: 'unknown', code: 100, subcode: 33, retryable: true, needsReconnect: false }],
    ['HTTP 502 without a body', { status: 502, body: Buffer.from('<html>Bad gateway</html>'), contentType: 'text/html' }, { kind: 'unavailable', httpStatus: 502, retryable: true, needsReconnect: false }],
    ['network failure', { throws: new TypeError('fetch failed') }, { kind: 'network', retryable: true, needsReconnect: false }],
    ['timeout', { throws: new DOMException('The operation was aborted due to timeout', 'TimeoutError') }, { kind: 'network', retryable: true, needsReconnect: false }],
  ];
  it.each(rows)('%s', async (_name, reply, expected) => {
    net.reply(reply);
    const error = await send().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MetaError);
    expect(error).toMatchObject(expected);
  });

  it('an error body with HTTP 200 is still an error; messages never contain the token', async () => {
    net.reply({ status: 200, json: fx.errors.token190 });
    const error = (await send().catch((e: unknown) => e)) as MetaError;
    expect(error.kind).toBe('token');
    expect(error.message).not.toContain(fx.TOKENS.page);
  });
});
