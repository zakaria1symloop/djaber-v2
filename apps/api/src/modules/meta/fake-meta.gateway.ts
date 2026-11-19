// Fake Meta adapter (META_DRIVER=fake, the default): deterministic, in-memory, never opens a socket.
// - OAuth: the "dialog" URL points straight back at our own callback with a fake code, so the connect flow can be
//   exercised end to end in the browser without Meta.
// - Every call is recorded in `calls` (tests assert on them); `failNext(op, error)` scripts a failure.
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { MetaError } from './meta-errors';
import type {
  MetaChannelAuth,
  MetaDownload,
  MetaGateway,
  MetaHistoryConversation,
  MetaInsight,
  MetaInstagramAccount,
  MetaInstagramToken,
  MetaPage,
  MetaPageInfo,
  MetaPageScopedId,
  MetaPost,
  MetaPostsPage,
  MetaProfile,
  MetaSendInput,
  MetaSendResult,
  MetaTokenDebug,
  MetaUserToken,
} from './meta.gateway';

export type FakeCall = { op: string; args: Record<string, unknown> };
export const FAKE_MEDIA_HOST = 'https://fake.meta.local';
const digits = (seed: string, n: number) => BigInt(`0x${createHash('sha256').update(seed).digest('hex').slice(0, 15)}`).toString().padStart(n, '0').slice(0, n);

export class FakeMetaGateway implements MetaGateway {
  readonly driver = 'fake' as const;
  readonly calls: FakeCall[] = [];
  private readonly failures = new Map<string, Error[]>();
  private readonly pagesBySeed = new Map<string, MetaPage[]>();
  private readonly igByPage = new Map<string, MetaInstagramAccount | null>();
  private readonly igBySeed = new Map<string, MetaInstagramAccount>();
  private readonly history = new Map<string, MetaHistoryConversation[]>();
  private readonly profiles = new Map<string, MetaProfile | null>();
  private readonly postsByPage = new Map<string, MetaPost[]>();
  private readonly pageIdsByAsid = new Map<string, MetaPageScopedId[]>();
  readonly invalidTokens = new Set<string>();

  // --- scripting (tests) ----------------------------------------------------------------------------------------------
  /** The next call of `op` rejects with `error` (FIFO when called several times). */
  failNext(op: string, error: Error) {
    const q = this.failures.get(op) ?? [];
    q.push(error);
    this.failures.set(op, q);
  }
  /** Pages returned by `listPages` for the fake code `fake.<seed>`. */
  setPages(seed: string, pages: MetaPage[]) {
    this.pagesBySeed.set(seed, pages);
  }
  setLinkedInstagram(pageId: string, account: MetaInstagramAccount | null) {
    this.igByPage.set(pageId, account);
  }
  setInstagramAccount(seed: string, account: MetaInstagramAccount) {
    this.igBySeed.set(seed, account);
  }
  setHistory(externalId: string, conversations: MetaHistoryConversation[]) {
    this.history.set(externalId, conversations);
  }
  setProfile(senderId: string, profile: MetaProfile | null) {
    this.profiles.set(senderId, profile);
  }
  setPosts(externalId: string, posts: MetaPost[]) {
    this.postsByPage.set(externalId, posts);
  }
  /** Page-scoped ids returned by `idsForPages` for an app-scoped user id (MSG-08). Unknown ids answer `[]`. */
  setIdsForPages(appScopedUserId: string, ids: MetaPageScopedId[]) {
    this.pageIdsByAsid.set(appScopedUserId, ids);
  }
  callsOf(op: string) {
    return this.calls.filter((c) => c.op === op);
  }
  reset() {
    this.calls.length = 0;
    this.failures.clear();
    this.pagesBySeed.clear();
    this.igByPage.clear();
    this.igBySeed.clear();
    this.history.clear();
    this.profiles.clear();
    this.postsByPage.clear();
    this.pageIdsByAsid.clear();
    this.invalidTokens.clear();
  }

  private record(op: string, args: Record<string, unknown>) {
    this.calls.push({ op, args });
    if (this.calls.length > 2000) this.calls.splice(0, this.calls.length - 2000);
    const next = this.failures.get(op)?.shift();
    if (next) throw next;
  }
  private static seedOf(codeOrToken: string) {
    const i = codeOrToken.indexOf('.');
    return i >= 0 ? codeOrToken.slice(i + 1) : codeOrToken;
  }
  /** Deterministic default pages of a seed: two pages, the first one with a linked Instagram account. */
  static defaultPages(seed: string): MetaPage[] {
    return [1, 2].map((n) => {
      const id = `9${digits(`${seed}:page:${n}`, 14)}`;
      return { id, name: `Boutique Démo ${n}`, accessToken: `fake-page-token.${id}`, tasks: ['MANAGE', 'MESSAGING', 'MODERATE'], pictureUrl: `${FAKE_MEDIA_HOST}/avatar/${id}.png`, followersCount: 1200 * n };
    });
  }
  static defaultInstagram(seedOrPageId: string): MetaInstagramAccount {
    const id = `17${digits(`${seedOrPageId}:ig`, 15)}`;
    return { id, name: 'Boutique Démo', username: `boutique.demo.${id.slice(-4)}`, pictureUrl: `${FAKE_MEDIA_HOST}/avatar/${id}.png`, followersCount: 860 };
  }

  // --- OAuth ----------------------------------------------------------------------------------------------------------
  facebookDialogUrl(p: { state: string; redirectUri: string; scopes: string[]; hint?: string }) {
    return `${p.redirectUri}?code=${encodeURIComponent(`fake.${p.hint ?? 'default'}`)}&state=${encodeURIComponent(p.state)}`;
  }
  instagramDialogUrl(p: { state: string; redirectUri: string; scopes: string[]; hint?: string }) {
    return `${p.redirectUri}?code=${encodeURIComponent(`fake.${p.hint ?? 'default'}`)}&state=${encodeURIComponent(p.state)}`;
  }
  async exchangeFacebookCode(code: string, redirectUri: string): Promise<MetaUserToken> {
    this.record('exchangeFacebookCode', { code, redirectUri });
    return { accessToken: `fake-user-token.${FakeMetaGateway.seedOf(code)}`, expiresInSec: 60 * 86400, scopes: [] };
  }
  async listPages(userToken: string): Promise<MetaPage[]> {
    this.record('listPages', {});
    const seed = FakeMetaGateway.seedOf(userToken);
    const scripted = this.pagesBySeed.get(seed);
    if (scripted) return scripted;
    // default pages: the first one has a linked Instagram account, the second has none
    const pages = FakeMetaGateway.defaultPages(seed);
    if (!this.igByPage.has(pages[0]!.id)) this.igByPage.set(pages[0]!.id, FakeMetaGateway.defaultInstagram(pages[0]!.id));
    return pages;
  }
  async linkedInstagram(pageId: string): Promise<MetaInstagramAccount | null> {
    this.record('linkedInstagram', { pageId });
    return this.igByPage.get(pageId) ?? null;
  }
  async exchangeInstagramCode(code: string, redirectUri: string): Promise<MetaInstagramToken> {
    this.record('exchangeInstagramCode', { code, redirectUri });
    const seed = FakeMetaGateway.seedOf(code);
    return { accessToken: `fake-ig-token.${seed}`, expiresInSec: 60 * 86400, userId: (this.igBySeed.get(seed) ?? FakeMetaGateway.defaultInstagram(seed)).id };
  }
  async instagramProfile(token: string): Promise<MetaInstagramAccount> {
    this.record('instagramProfile', {});
    const seed = FakeMetaGateway.seedOf(token);
    return this.igBySeed.get(seed) ?? FakeMetaGateway.defaultInstagram(seed);
  }
  async refreshInstagramToken(token: string): Promise<MetaInstagramToken> {
    this.record('refreshInstagramToken', {});
    if (this.invalidTokens.has(token)) throw new MetaError('token', 'Error validating access token', 190, 463, 400);
    return { accessToken: token.endsWith('.refreshed') ? token : `${token}.refreshed`, expiresInSec: 60 * 86400, userId: null };
  }
  async debugToken(token: string): Promise<MetaTokenDebug> {
    this.record('debugToken', {});
    return { isValid: !this.invalidTokens.has(token), expiresAt: null, scopes: [] };
  }

  // --- subscription -----------------------------------------------------------------------------------------------------
  /** No-op that only records the call: nothing is ever registered at Meta from this adapter. */
  async subscribePage(auth: MetaChannelAuth) {
    this.record('subscribePage', { platform: auth.platform, externalId: auth.externalId });
  }
  async unsubscribePage(auth: MetaChannelAuth) {
    this.record('unsubscribePage', { platform: auth.platform, externalId: auth.externalId });
  }

  // --- messaging --------------------------------------------------------------------------------------------------------
  async send(auth: MetaChannelAuth, input: MetaSendInput): Promise<MetaSendResult> {
    this.record('send', { platform: auth.platform, externalId: auth.externalId, ...input });
    if (this.invalidTokens.has(auth.token)) throw new MetaError('token', 'Error validating access token', 190, 460, 400);
    return { messageId: `m_fake_${randomUUID().replace(/-/g, '')}`, recipientId: input.recipientId };
  }
  async senderAction(auth: MetaChannelAuth, recipientId: string, action: 'typing_on' | 'typing_off' | 'mark_seen') {
    this.record('senderAction', { externalId: auth.externalId, recipientId, action });
  }
  async userProfile(_auth: MetaChannelAuth, senderId: string): Promise<MetaProfile | null> {
    this.record('userProfile', { senderId });
    if (this.profiles.has(senderId)) return this.profiles.get(senderId) ?? null;
    return { name: `Client ${senderId.slice(-4)}`, avatarUrl: null };
  }

  // --- page data --------------------------------------------------------------------------------------------------------
  async conversations(auth: MetaChannelAuth, opts: { conversations: number; messages: number }): Promise<MetaHistoryConversation[]> {
    this.record('conversations', { externalId: auth.externalId, ...opts });
    const scripted = this.history.get(auth.externalId);
    if (scripted) return scripted.slice(0, opts.conversations).map((c) => ({ ...c, messages: c.messages.slice(0, opts.messages) }));
    const now = Date.now();
    return [1, 2].map((n) => {
      const participantId = `7${digits(`${auth.externalId}:hist:${n}`, 15)}`;
      return {
        id: `t_fake_${auth.externalId}_${n}`,
        updatedAt: new Date(now - n * 3600_000).toISOString(),
        participantId,
        participantName: `Client historique ${n}`,
        messages: [
          { id: `m_hist_${auth.externalId}_${n}_1`, fromId: participantId, text: 'Salam, c\'est combien ?', createdAt: new Date(now - n * 3600_000 - 120_000).toISOString(), attachments: [] },
          { id: `m_hist_${auth.externalId}_${n}_2`, fromId: auth.externalId, text: 'Bonjour, 2 500 DA, livraison 58 wilayas.', createdAt: new Date(now - n * 3600_000 - 60_000).toISOString(), attachments: [] },
          { id: `m_hist_${auth.externalId}_${n}_3`, fromId: participantId, text: 'D\'accord merci', createdAt: new Date(now - n * 3600_000).toISOString(), attachments: [] },
        ],
      };
    });
  }
  async pageInfo(auth: MetaChannelAuth): Promise<MetaPageInfo> {
    this.record('pageInfo', { externalId: auth.externalId });
    return { name: null, avatarUrl: `${FAKE_MEDIA_HOST}/avatar/${auth.externalId}.png`, followersCount: 1234 };
  }
  async insights(auth: MetaChannelAuth): Promise<MetaInsight[]> {
    this.record('insights', { externalId: auth.externalId });
    return [
      { key: 'page_messages_total_messaging_connections', value: 42 },
      { key: 'page_fans', value: 1234 },
    ];
  }

  /** Scripted posts, else four deterministic posts: three products (one twice) and a greeting; pages of two. */
  async posts(auth: MetaChannelAuth, opts: { limit: number; after?: string | null }): Promise<MetaPostsPage> {
    this.record('posts', { externalId: auth.externalId, ...opts });
    const now = Date.now();
    const all: MetaPost[] = this.postsByPage.get(auth.externalId) ?? [
      { id: `${auth.externalId}_p1`, text: 'Robe satin bordeaux - 4500 DA. Tailles S à XL, livraison 58 wilayas', imageUrl: `${FAKE_MEDIA_HOST}/posts/${auth.externalId}_p1.jpg`, createdAt: new Date(now - 86_400_000).toISOString() },
      { id: `${auth.externalId}_p2`, text: 'Sac à main cuir noir - 6200 DA', imageUrl: `${FAKE_MEDIA_HOST}/posts/${auth.externalId}_p2.jpg`, createdAt: new Date(now - 2 * 86_400_000).toISOString() },
      { id: `${auth.externalId}_p3`, text: 'Bonne fête à toutes nos clientes !', imageUrl: null, createdAt: new Date(now - 3 * 86_400_000).toISOString() },
      { id: `${auth.externalId}_p4`, text: 'Robe satin bordeaux - 4500 DA', imageUrl: `${FAKE_MEDIA_HOST}/posts/${auth.externalId}_p4.jpg`, createdAt: new Date(now - 4 * 86_400_000).toISOString() },
      { id: `${auth.externalId}_p5`, text: 'Ensemble sport gris', imageUrl: `${FAKE_MEDIA_HOST}/posts/${auth.externalId}_p5.jpg`, createdAt: new Date(now - 5 * 86_400_000).toISOString() },
    ];
    const start = opts.after ? Number(opts.after) || 0 : 0;
    const size = Math.min(opts.limit, 2);
    const posts = all.slice(start, start + size);
    return { posts, nextCursor: start + size < all.length ? String(start + size) : null };
  }

  async idsForPages(appScopedUserId: string): Promise<MetaPageScopedId[]> {
    this.record('idsForPages', { appScopedUserId });
    return [...(this.pageIdsByAsid.get(appScopedUserId) ?? [])];
  }

  /** Media "download": a generated picture / tiny payload for fake URLs; any other host is refused (no network here). */
  async download(url: string): Promise<MetaDownload> {
    this.record('download', { url });
    if (!url.startsWith(`${FAKE_MEDIA_HOST}/`)) throw new MetaError('network', 'fake adapter: external media is never fetched');
    if (/\.(mp3|m4a|ogg|aac)(\?|$)/.test(url)) return { body: Buffer.from('fake-audio'), mime: 'audio/mpeg' };
    if (/\.(mp4|mov)(\?|$)/.test(url)) return { body: Buffer.from('fake-video'), mime: 'video/mp4' };
    if (/\.pdf(\?|$)/.test(url)) return { body: Buffer.from('%PDF-1.4 fake'), mime: 'application/pdf' };
    const body = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 46, g: 125, b: 90 } } }).jpeg().toBuffer();
    return { body, mime: 'image/jpeg' };
  }
}
