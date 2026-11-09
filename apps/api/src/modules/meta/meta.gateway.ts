// 05-integrations §1 — the single port to Meta (Messenger + Instagram). Two adapters: `fake` (default; the only one
// allowed on a developer machine and in tests) and `graph` (real Graph API). Nothing else in the code base talks to Meta.
export const META_GATEWAY = Symbol('META_GATEWAY');

export type MetaPlatform = 'facebook' | 'instagram';
/** Token + platform of the channel a call is made for. Instagram Business Login tokens use graph.instagram.com. */
export type MetaChannelAuth = { platform: MetaPlatform; externalId: string; token: string; viaPage?: boolean; /** id of the page a linked Instagram account belongs to (page-level endpoints) */ pageId?: string };

export type MetaPage = {
  id: string;
  name: string;
  accessToken: string | null;
  tasks: string[];
  pictureUrl: string | null;
  followersCount: number | null;
};
export type MetaInstagramAccount = { id: string; name: string | null; username: string | null; pictureUrl: string | null; followersCount?: number | null };
export type MetaUserToken = { accessToken: string; expiresInSec: number | null; scopes: string[] };
export type MetaInstagramToken = { accessToken: string; expiresInSec: number | null; userId: string | null };

export type MetaMessagingType = 'RESPONSE' | 'MESSAGE_TAG';
export type MetaTag = 'HUMAN_AGENT' | 'POST_PURCHASE_UPDATE';
export type MetaOutgoing =
  | { kind: 'text'; text: string }
  | { kind: 'attachment'; type: 'image' | 'audio' | 'video' | 'file'; url: string }
  /** MSG-07 product cards: generic template, one element per product / picture, postback buttons (PV 09/11) */
  | { kind: 'generic'; elements: { title: string; subtitle?: string; imageUrl?: string; buttons: { title: string; payload: string }[] }[] };
export type MetaSendInput = { recipientId: string; message: MetaOutgoing; messagingType: MetaMessagingType; tag?: MetaTag };
export type MetaSendResult = { messageId: string; recipientId: string | null };

export type MetaProfile = { name: string | null; avatarUrl: string | null };
export type MetaHistoryMessage = {
  id: string;
  fromId: string;
  text: string | null;
  createdAt: string;
  attachments: { type: string; url: string | null; mime: string | null; name: string | null }[];
};
export type MetaHistoryConversation = { id: string; updatedAt: string; participantId: string; participantName: string | null; messages: MetaHistoryMessage[] };
export type MetaPageInfo = { name: string | null; avatarUrl: string | null; followersCount: number | null };
export type MetaInsight = { key: string; value: number | null };
export type MetaTokenDebug = { isValid: boolean; expiresAt: Date | null; scopes: string[] };
export type MetaDownload = { body: Buffer; mime: string };
/** A page post / Instagram media read by the page analysis (CHN-08, FL-15). */
export type MetaPost = { id: string; text: string | null; imageUrl: string | null; createdAt: string };
export type MetaPostsPage = { posts: MetaPost[]; nextCursor: string | null };

export interface MetaGateway {
  readonly driver: 'fake' | 'graph';

  // --- OAuth (05 §1.5) ----------------------------------------------------------------------------------------------
  /** URL opened in the popup. `hint` is an opaque value only the fake adapter uses (deterministic fake pages). */
  facebookDialogUrl(p: { state: string; redirectUri: string; scopes: string[]; hint?: string }): string;
  instagramDialogUrl(p: { state: string; redirectUri: string; scopes: string[]; hint?: string }): string;
  /** code → short-lived user token → long-lived user token. */
  exchangeFacebookCode(code: string, redirectUri: string): Promise<MetaUserToken>;
  /** `/me/accounts`, paginated, capped at 200 pages. */
  listPages(userToken: string): Promise<MetaPage[]>;
  /** Instagram business account linked to a page, or null. */
  linkedInstagram(pageId: string, pageToken: string): Promise<MetaInstagramAccount | null>;
  /** Instagram Business Login: code → short-lived → long-lived (60 d) token. */
  exchangeInstagramCode(code: string, redirectUri: string): Promise<MetaInstagramToken>;
  instagramProfile(token: string): Promise<MetaInstagramAccount>;
  refreshInstagramToken(token: string): Promise<MetaInstagramToken>;
  debugToken(token: string): Promise<MetaTokenDebug>;

  // --- page subscription --------------------------------------------------------------------------------------------
  subscribePage(auth: MetaChannelAuth): Promise<void>;
  unsubscribePage(auth: MetaChannelAuth): Promise<void>;

  // --- messaging (05 §1.4) -------------------------------------------------------------------------------------------
  send(auth: MetaChannelAuth, input: MetaSendInput): Promise<MetaSendResult>;
  senderAction(auth: MetaChannelAuth, recipientId: string, action: 'typing_on' | 'typing_off' | 'mark_seen'): Promise<void>;
  userProfile(auth: MetaChannelAuth, senderId: string): Promise<MetaProfile | null>;

  // --- page data (05 §1.6) -------------------------------------------------------------------------------------------
  conversations(auth: MetaChannelAuth, opts: { conversations: number; messages: number }): Promise<MetaHistoryConversation[]>;
  pageInfo(auth: MetaChannelAuth): Promise<MetaPageInfo>;
  insights(auth: MetaChannelAuth): Promise<MetaInsight[]>;
  /** Posts of the page (`/<pageId>/posts`) or media of the Instagram account, newest first; needs `pages_read_engagement` or `pages_read_user_content`. */
  posts(auth: MetaChannelAuth, opts: { limit: number; after?: string | null }): Promise<MetaPostsPage>;

  /** Downloads an inbound attachment from Meta's CDN (only called by the `media` job). */
  download(url: string): Promise<MetaDownload>;
}

export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_messaging',
  'pages_read_engagement',
  'pages_read_user_content',
  'instagram_basic',
  'instagram_manage_messages',
] as const;
export const INSTAGRAM_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'] as const;
/** Webhook fields a page is subscribed to (05 §1.5). */
export const PAGE_SUBSCRIBED_FIELDS = ['messages', 'messaging_postbacks', 'messaging_optins', 'message_reads'] as const;
