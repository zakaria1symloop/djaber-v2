// Real Graph API adapter (META_DRIVER=graph) — 05-integrations §1. NEVER instantiated on a developer machine or in
// tests (see meta.module.ts); its contract tests stub `fetch` (graph-meta.gateway.spec.ts). 10 s timeout per call,
// tokens and secrets are never logged.
import { classifyMetaError, MetaError, networkError, type MetaErrorBody } from './meta-errors';
import {
  PAGE_SUBSCRIBED_FIELDS,
  type MetaChannelAuth,
  type MetaDownload,
  type MetaGateway,
  type MetaHistoryConversation,
  type MetaInsight,
  type MetaInstagramAccount,
  type MetaInstagramToken,
  type MetaOutgoing,
  type MetaPage,
  type MetaPageInfo,
  type MetaPostsPage,
  type MetaProfile,
  type MetaSendInput,
  type MetaSendResult,
  type MetaTokenDebug,
  type MetaUserToken,
} from './meta.gateway';

export type GraphOptions = {
  appId: string;
  appSecret: string;
  instagramAppId: string;
  instagramAppSecret: string;
  version: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const FB_GRAPH = 'https://graph.facebook.com';
const IG_GRAPH = 'https://graph.instagram.com';
const MAX_PAGES = 200;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
/** Hosts Meta serves inbound attachments from; anything else is refused (SSRF guard). */
const MEDIA_HOSTS = /(^|\.)(fbcdn\.net|fbsbx\.com|cdninstagram\.com|facebook\.com|instagram\.com)$/i;

type Json = Record<string, any>;

export class GraphMetaGateway implements MetaGateway {
  readonly driver = 'graph' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  constructor(private readonly o: GraphOptions) {
    this.fetchImpl = o.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = o.timeoutMs ?? 10_000;
  }

  private fb(path: string) {
    return `${FB_GRAPH}/${this.o.version}${path}`;
  }
  private ig(path: string) {
    return `${IG_GRAPH}/${this.o.version}${path}`;
  }
  /** Linked Instagram accounts are driven with the page token on graph.facebook.com; Business Login tokens on graph.instagram.com. */
  private usesInstagramHost(auth: MetaChannelAuth) {
    return auth.platform === 'instagram' && !auth.viaPage;
  }

  private async call(url: string, init: RequestInit = {}): Promise<Json> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw networkError(e);
    }
    let body: Json = {};
    try {
      body = (await res.json()) as Json;
    } catch {
      if (!res.ok) throw classifyMetaError(undefined, res.status);
    }
    if (!res.ok || body.error) throw classifyMetaError(body.error as MetaErrorBody | undefined, res.status);
    return body;
  }
  private get(url: string, params: Record<string, string>, bearer?: string) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return this.call(u.toString(), { method: 'GET', headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined });
  }
  private postJson(url: string, params: Record<string, string>, body: unknown, bearer?: string) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return this.call(u.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
  }

  // --- OAuth ----------------------------------------------------------------------------------------------------------
  facebookDialogUrl(p: { state: string; redirectUri: string; scopes: string[] }) {
    const u = new URL(`https://www.facebook.com/${this.o.version}/dialog/oauth`);
    u.searchParams.set('client_id', this.o.appId);
    u.searchParams.set('redirect_uri', p.redirectUri);
    u.searchParams.set('state', p.state);
    u.searchParams.set('scope', p.scopes.join(','));
    u.searchParams.set('response_type', 'code');
    return u.toString();
  }
  instagramDialogUrl(p: { state: string; redirectUri: string; scopes: string[] }) {
    const u = new URL('https://www.instagram.com/oauth/authorize');
    u.searchParams.set('client_id', this.o.instagramAppId);
    u.searchParams.set('redirect_uri', p.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', p.scopes.join(','));
    u.searchParams.set('state', p.state);
    return u.toString();
  }
  async exchangeFacebookCode(code: string, redirectUri: string): Promise<MetaUserToken> {
    const short = await this.get(this.fb('/oauth/access_token'), { client_id: this.o.appId, client_secret: this.o.appSecret, redirect_uri: redirectUri, code });
    const long = await this.get(this.fb('/oauth/access_token'), {
      grant_type: 'fb_exchange_token',
      client_id: this.o.appId,
      client_secret: this.o.appSecret,
      fb_exchange_token: String(short.access_token),
    });
    return { accessToken: String(long.access_token), expiresInSec: typeof long.expires_in === 'number' ? long.expires_in : null, scopes: [] };
  }
  async listPages(userToken: string): Promise<MetaPage[]> {
    const pages: MetaPage[] = [];
    let body = await this.get(this.fb('/me/accounts'), { fields: 'id,name,access_token,tasks,picture{url}', limit: '100', access_token: userToken });
    for (;;) {
      for (const p of (body.data ?? []) as Json[]) {
        pages.push({
          id: String(p.id),
          name: String(p.name ?? p.id),
          accessToken: typeof p.access_token === 'string' && p.access_token ? p.access_token : null,
          tasks: Array.isArray(p.tasks) ? p.tasks.map(String) : [],
          pictureUrl: p.picture?.data?.url ?? null,
          followersCount: typeof p.followers_count === 'number' ? p.followers_count : null,
        });
        if (pages.length >= MAX_PAGES) return pages;
      }
      const next = body.paging?.next as string | undefined;
      // only follow a cursor that stays on the Graph host
      if (!next || !next.startsWith(`${FB_GRAPH}/`)) return pages;
      body = await this.call(next, { method: 'GET' });
    }
  }
  async linkedInstagram(pageId: string, pageToken: string): Promise<MetaInstagramAccount | null> {
    const body = await this.get(this.fb(`/${pageId}`), { fields: 'instagram_business_account{id,name,username,profile_picture_url}', access_token: pageToken });
    const a = body.instagram_business_account as Json | undefined;
    if (!a?.id) return null;
    return { id: String(a.id), name: a.name ?? null, username: a.username ?? null, pictureUrl: a.profile_picture_url ?? null };
  }
  async exchangeInstagramCode(code: string, redirectUri: string): Promise<MetaInstagramToken> {
    const form = new URLSearchParams({
      client_id: this.o.instagramAppId,
      client_secret: this.o.instagramAppSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    });
    const raw = await this.call('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    // both response shapes exist: `{ access_token, user_id }` and `{ data: [{ access_token, user_id }] }`
    const short = (Array.isArray(raw.data) ? raw.data[0] : raw) as Json;
    const long = await this.get(`${IG_GRAPH}/access_token`, { grant_type: 'ig_exchange_token', client_secret: this.o.instagramAppSecret, access_token: String(short.access_token) });
    return {
      accessToken: String(long.access_token),
      expiresInSec: typeof long.expires_in === 'number' ? long.expires_in : null,
      userId: short.user_id !== undefined ? String(short.user_id) : null,
    };
  }
  async instagramProfile(token: string): Promise<MetaInstagramAccount> {
    const b = await this.get(this.ig('/me'), { fields: 'user_id,username,name,profile_picture_url', access_token: token });
    return { id: String(b.user_id ?? b.id), name: b.name ?? null, username: b.username ?? null, pictureUrl: b.profile_picture_url ?? null };
  }
  async refreshInstagramToken(token: string): Promise<MetaInstagramToken> {
    const b = await this.get(`${IG_GRAPH}/refresh_access_token`, { grant_type: 'ig_refresh_token', access_token: token });
    return { accessToken: String(b.access_token), expiresInSec: typeof b.expires_in === 'number' ? b.expires_in : null, userId: null };
  }
  async debugToken(token: string): Promise<MetaTokenDebug> {
    const b = await this.get(this.fb('/debug_token'), { input_token: token, access_token: `${this.o.appId}|${this.o.appSecret}` });
    const d = (b.data ?? {}) as Json;
    return {
      isValid: d.is_valid === true,
      expiresAt: typeof d.expires_at === 'number' && d.expires_at > 0 ? new Date(d.expires_at * 1000) : null,
      scopes: Array.isArray(d.scopes) ? d.scopes.map(String) : [],
    };
  }

  // --- subscription -----------------------------------------------------------------------------------------------------
  async subscribePage(auth: MetaChannelAuth) {
    if (auth.platform === 'instagram' && auth.viaPage) return; // the linked account inherits the page subscription
    if (this.usesInstagramHost(auth)) {
      await this.postJson(this.ig('/me/subscribed_apps'), { subscribed_fields: 'messages' }, {}, auth.token);
      return;
    }
    await this.postJson(this.fb(`/${auth.externalId}/subscribed_apps`), { subscribed_fields: PAGE_SUBSCRIBED_FIELDS.join(','), access_token: auth.token }, {});
  }
  async unsubscribePage(auth: MetaChannelAuth) {
    if (auth.platform === 'instagram' && auth.viaPage) return;
    if (this.usesInstagramHost(auth)) {
      await this.call(this.ig('/me/subscribed_apps'), { method: 'DELETE', headers: { Authorization: `Bearer ${auth.token}` } });
      return;
    }
    const u = new URL(this.fb(`/${auth.externalId}/subscribed_apps`));
    u.searchParams.set('access_token', auth.token);
    await this.call(u.toString(), { method: 'DELETE' });
  }

  // --- messaging --------------------------------------------------------------------------------------------------------
  private static messageBody(m: MetaOutgoing): Json {
    if (m.kind === 'text') return { text: m.text };
    if (m.kind === 'attachment') return { attachment: { type: m.type, payload: { url: m.url, is_reusable: true } } };
    return {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: m.elements.map((e) => ({
            title: e.title,
            ...(e.subtitle ? { subtitle: e.subtitle } : {}),
            ...(e.imageUrl ? { image_url: e.imageUrl } : {}),
            buttons: e.buttons.map((b) => ({ type: 'postback', title: b.title, payload: b.payload })),
          })),
        },
      },
    };
  }
  private post(auth: MetaChannelAuth, body: Json) {
    return this.usesInstagramHost(auth)
      ? this.postJson(this.ig('/me/messages'), {}, body, auth.token)
      : this.postJson(this.fb('/me/messages'), { access_token: auth.token }, body);
  }
  async send(auth: MetaChannelAuth, input: MetaSendInput): Promise<MetaSendResult> {
    const body: Json = { recipient: { id: input.recipientId }, messaging_type: input.messagingType, message: GraphMetaGateway.messageBody(input.message) };
    // Instagram has no message tags (04 §23): the caller never asks for one there
    if (input.messagingType === 'MESSAGE_TAG') {
      if (!input.tag || auth.platform === 'instagram') throw new MetaError('window', 'message tags are not available on this channel', 10, 2018278);
      body.tag = input.tag;
    }
    const res = await this.post(auth, body);
    return { messageId: String(res.message_id ?? ''), recipientId: res.recipient_id !== undefined ? String(res.recipient_id) : null };
  }
  async senderAction(auth: MetaChannelAuth, recipientId: string, action: 'typing_on' | 'typing_off' | 'mark_seen') {
    await this.post(auth, { recipient: { id: recipientId }, sender_action: action });
  }
  async userProfile(auth: MetaChannelAuth, senderId: string): Promise<MetaProfile | null> {
    if (auth.platform === 'instagram') {
      const b = this.usesInstagramHost(auth)
        ? await this.get(this.ig(`/${senderId}`), { fields: 'name,username,profile_pic' }, auth.token)
        : await this.get(this.fb(`/${senderId}`), { fields: 'name,username,profile_pic', access_token: auth.token });
      return { name: b.name ?? b.username ?? null, avatarUrl: b.profile_pic ?? null };
    }
    const b = await this.get(this.fb(`/${senderId}`), { fields: 'first_name,last_name,profile_pic', access_token: auth.token });
    const name = [b.first_name, b.last_name].filter(Boolean).join(' ').trim();
    return { name: name || null, avatarUrl: b.profile_pic ?? null };
  }

  // --- page data --------------------------------------------------------------------------------------------------------
  async conversations(auth: MetaChannelAuth, opts: { conversations: number; messages: number }): Promise<MetaHistoryConversation[]> {
    const params: Record<string, string> = {
      fields: `id,updated_time,participants,messages.limit(${opts.messages}){id,from,to,message,attachments,created_time}`,
      limit: String(opts.conversations),
    };
    if (auth.platform === 'instagram') params.platform = 'instagram';
    const b = this.usesInstagramHost(auth)
      ? await this.get(this.ig('/me/conversations'), params, auth.token)
      : await this.get(this.fb(`/${auth.pageId ?? auth.externalId}/conversations`), { ...params, access_token: auth.token });
    return ((b.data ?? []) as Json[]).slice(0, opts.conversations).map((c) => {
      const participants = ((c.participants?.data ?? []) as Json[]).filter((p) => String(p.id) !== auth.externalId);
      const other = participants[0] ?? {};
      return {
        id: String(c.id),
        updatedAt: String(c.updated_time ?? ''),
        participantId: String(other.id ?? ''),
        participantName: other.name ?? other.username ?? null,
        messages: ((c.messages?.data ?? []) as Json[]).slice(0, opts.messages).map((m) => ({
          id: String(m.id),
          fromId: String(m.from?.id ?? ''),
          text: typeof m.message === 'string' && m.message ? m.message : null,
          createdAt: String(m.created_time ?? ''),
          attachments: ((m.attachments?.data ?? []) as Json[]).map((a) => ({
            type: a.image_data ? 'image' : a.video_data ? 'video' : String(a.mime_type ?? '').startsWith('audio/') ? 'audio' : 'file',
            url: a.image_data?.url ?? a.video_data?.url ?? a.file_url ?? null,
            mime: a.mime_type ?? null,
            name: a.name ?? null,
          })),
        })),
      };
    });
  }
  /** CHN-08: `/<pageId>/posts` (Facebook) or `/<igId>/media` (Instagram), one page per call (cursor = `paging.cursors.after`). */
  async posts(auth: MetaChannelAuth, opts: { limit: number; after?: string | null }): Promise<MetaPostsPage> {
    const limit = String(Math.min(100, Math.max(1, opts.limit)));
    const after: Record<string, string> = opts.after ? { after: opts.after } : {};
    if (auth.platform === 'instagram') {
      const params = { fields: 'id,caption,media_url,media_type,thumbnail_url,timestamp', limit, ...after };
      const b = this.usesInstagramHost(auth) ? await this.get(this.ig('/me/media'), params, auth.token) : await this.get(this.fb(`/${auth.externalId}/media`), { ...params, access_token: auth.token });
      return {
        posts: ((b.data ?? []) as Json[]).map((m) => ({ id: String(m.id), text: typeof m.caption === 'string' && m.caption ? m.caption : null, imageUrl: (m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url) ?? null, createdAt: String(m.timestamp ?? '') })),
        nextCursor: b.paging?.next ? (b.paging?.cursors?.after ?? null) : null,
      };
    }
    const b = await this.get(this.fb(`/${auth.externalId}/posts`), { fields: 'id,message,full_picture,created_time', limit, ...after, access_token: auth.token });
    return {
      posts: ((b.data ?? []) as Json[]).map((p) => ({ id: String(p.id), text: typeof p.message === 'string' && p.message ? p.message : null, imageUrl: p.full_picture ?? null, createdAt: String(p.created_time ?? '') })),
      nextCursor: b.paging?.next ? (b.paging?.cursors?.after ?? null) : null,
    };
  }
  async pageInfo(auth: MetaChannelAuth): Promise<MetaPageInfo> {
    if (auth.platform === 'instagram') {
      const fields = 'name,username,profile_picture_url,followers_count';
      const b = this.usesInstagramHost(auth)
        ? await this.get(this.ig('/me'), { fields }, auth.token)
        : await this.get(this.fb(`/${auth.externalId}`), { fields, access_token: auth.token });
      return { name: b.name ?? b.username ?? null, avatarUrl: b.profile_picture_url ?? null, followersCount: typeof b.followers_count === 'number' ? b.followers_count : null };
    }
    const b = await this.get(this.fb(`/${auth.externalId}`), { fields: 'name,picture{url},followers_count', access_token: auth.token });
    return { name: b.name ?? null, avatarUrl: b.picture?.data?.url ?? null, followersCount: typeof b.followers_count === 'number' ? b.followers_count : null };
  }
  async insights(auth: MetaChannelAuth): Promise<MetaInsight[]> {
    const b = await this.get(this.fb(`/${auth.externalId}/insights`), { metric: 'page_messages_total_messaging_connections,page_fans', period: 'day', access_token: auth.token });
    return ((b.data ?? []) as Json[]).map((m) => {
      const values = (m.values ?? []) as Json[];
      const last = values[values.length - 1]?.value;
      return { key: String(m.name), value: typeof last === 'number' ? last : null };
    });
  }

  async download(url: string): Promise<MetaDownload> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new MetaError('invalid_attachment', 'invalid media url');
    }
    if (u.protocol !== 'https:' || !MEDIA_HOSTS.test(u.hostname)) throw new MetaError('invalid_attachment', 'media host not allowed');
    let res: Response;
    try {
      res = await this.fetchImpl(u.toString(), { method: 'GET', signal: AbortSignal.timeout(this.timeoutMs * 3) });
    } catch (e) {
      throw networkError(e);
    }
    if (!res.ok) throw classifyMetaError(undefined, res.status);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_MEDIA_BYTES) throw new MetaError('invalid_attachment', 'media too large');
    return { body, mime: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim() };
  }
}
