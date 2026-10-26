// Pure rules of the inbox UI (04 §5 statuses, §23 messaging window; 12 §23 banner priority and composer states).
// No React here: everything is unit-tested in logic.spec.ts.
import { formatMoney, TIMEZONE } from '@djaber/shared';
import type { Conversation, ConversationCounts, ConversationListItem, ConversationPatch, Message, ServerComposerState, WsMessageUpdated } from './contracts';

export const WINDOW_MS = 24 * 3600 * 1000;
export const REPLY_MAX = 2000;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/* ---------- 24 h window ---------- */
type WindowInput = { within24h: boolean; lastCustomerMessageAt?: string | null };
/** Inside the window when the last customer message is younger than 24 h; the server flag is used when the instant is unknown. */
export const isWithinWindow = (c: WindowInput, now = Date.now()): boolean => {
  if (c.lastCustomerMessageAt) {
    const t = Date.parse(c.lastCustomerMessageAt);
    if (!Number.isNaN(t)) return now - t < WINDOW_MS;
  }
  return c.within24h;
};

/* ---------- composer ---------- */
export type ComposerState =
  /** `tagged`: outside the 24 h window on Messenger, the reply leaves with the HUMAN_AGENT tag (allowed by the server for 7 days) */
  | { mode: 'ready'; tagged?: boolean }
  /** READ_ONLY_MEMBER: the composer is not rendered, the shell banner explains */
  | { mode: 'hidden'; reason: 'readOnly'; code: 'READ_ONLY_MEMBER' }
  | { mode: 'disabled'; reason: 'channelInactive'; code: 'REPLY_CHANNEL_INACTIVE'; reconnect: boolean }
  | { mode: 'disabled'; reason: 'blocked'; code: 'CUSTOMER_BLOCKED' }
  /** `template`: Messenger accepts a template message with the HUMAN_AGENT tag — unless the server says the tag cannot be
   * used (app not approved for « Human Agent » / beyond 7 days: `composer.humanAgentTag = false`); Instagram accepts nothing */
  | { mode: 'disabled'; reason: 'outsideWindow'; code: 'REPLY_OUTSIDE_WINDOW'; template: boolean };

type ComposerInput = WindowInput & Pick<Conversation, 'channel' | 'blocked'> & { composer?: Pick<ServerComposerState, 'canSend' | 'reasonCode' | 'humanAgentTag'> | null };
/**
 * The rule is evaluated here so that the composer follows the clock (a window that closes while the thread is open)
 * and live events; a refusal computed by the server (`composer.reasonCode`) is honoured when the local rule sees none.
 */
export const composerState = (c: ComposerInput, o: { readOnly: boolean; now?: number }): ComposerState => {
  if (o.readOnly) return { mode: 'hidden', reason: 'readOnly', code: 'READ_ONLY_MEMBER' };
  const inactive: ComposerState = { mode: 'disabled', reason: 'channelInactive', code: 'REPLY_CHANNEL_INACTIVE', reconnect: c.channel.status === 'needs_reconnect' };
  const outside: ComposerState = { mode: 'disabled', reason: 'outsideWindow', code: 'REPLY_OUTSIDE_WINDOW', template: c.channel.platform === 'facebook' && c.composer?.humanAgentTag !== false };
  if (c.channel.status !== 'active') return inactive;
  if (c.blocked) return { mode: 'disabled', reason: 'blocked', code: 'CUSTOMER_BLOCKED' };
  if (!isWithinWindow(c, o.now)) {
    // MSG-06: a human may still answer on Messenger with the HUMAN_AGENT tag while the server allows it; never on Instagram
    return c.channel.platform === 'facebook' && c.composer?.canSend && c.composer.humanAgentTag ? { mode: 'ready', tagged: true } : outside;
  }
  if (c.composer && !c.composer.canSend) {
    if (c.composer.reasonCode === 'READ_ONLY_MEMBER') return { mode: 'hidden', reason: 'readOnly', code: 'READ_ONLY_MEMBER' };
    if (c.composer.reasonCode === 'REPLY_CHANNEL_INACTIVE') return inactive;
    if (c.composer.reasonCode === 'CUSTOMER_BLOCKED') return { mode: 'disabled', reason: 'blocked', code: 'CUSTOMER_BLOCKED' };
    if (c.composer.reasonCode === 'REPLY_OUTSIDE_WINDOW') return outside;
  }
  return { mode: 'ready' };
};

export type DraftCheck = { ok: boolean; tooLong: boolean; empty: boolean; length: number };
export const checkDraft = (text: string, hasImage: boolean): DraftCheck => {
  const length = text.length;
  const empty = text.trim().length === 0 && !hasImage;
  const tooLong = length > REPLY_MAX;
  return { ok: !empty && !tooLong, tooLong, empty, length };
};

/** Inline error code of an image picked in the composer (INB-03: one image ≤ 5 MB), or null when it can be sent. */
export const imageError = (file: { size: number; type: string }): 'IMAGE_TOO_LARGE' | 'IMAGE_TYPE_INVALID' | null =>
  !IMAGE_TYPES.includes(file.type) ? 'IMAGE_TYPE_INVALID' : file.size > IMAGE_MAX_BYTES ? 'IMAGE_TOO_LARGE' : null;

/* ---------- conversation banner: one at a time, by priority (12 §23) ---------- */
export type ThreadBannerKind = 'aiPaused' | 'needsHuman' | 'reconnect' | 'credits' | 'pausedByPlan' | 'aiUnavailable' | 'blocked' | 'outsideWindow';
type BannerInput = WindowInput & Pick<Conversation, 'status' | 'aiPaused' | 'aiPausedBy' | 'channel' | 'blocked' | 'creditsExhausted' | 'aiUnavailable'>;
export const threadBanner = (c: BannerInput, o: { now?: number; channelPausedByPlan?: boolean } = {}): ThreadBannerKind | null => {
  // paused by a member (manual pause, or a human reply with auto-pause): the handoff pause is the "À TRAITER" banner
  if (c.aiPaused && (c.status !== 'needs_human' || c.aiPausedBy)) return 'aiPaused';
  // the API sets `creditsExhausted` / `aiUnavailable` only on a handoff (status needs_human): they are the cause of that
  // handoff and replace the generic À TRAITER banner (GLOBAL "Credits exhausted — thread state": À TRAITER + IA EN PAUSE
  // pills with the "IA arrêtée : crédits épuisés" banner)
  if (c.status === 'needs_human') return c.creditsExhausted ? 'credits' : c.aiUnavailable ? 'aiUnavailable' : 'needsHuman';
  if (c.channel.status === 'needs_reconnect') return 'reconnect';
  if (c.creditsExhausted) return 'credits';
  if (c.channel.status === 'paused' && o.channelPausedByPlan !== false) return 'pausedByPlan';
  if (c.aiUnavailable) return 'aiUnavailable';
  if (c.blocked) return 'blocked';
  if (!isWithinWindow(c, o.now)) return 'outsideWindow';
  return null;
};

/* ---------- thread: order, day separators, grouping ---------- */
export const compareMessages = (a: Pick<Message, 'sentAt' | 'id'>, b: Pick<Message, 'sentAt' | 'id'>): number =>
  a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** `2026-10-11` — the calendar day in Africa/Algiers (a message of 23:30 UTC belongs to the next day). */
export const dayKey = (iso: string | number | Date): string => dayFmt.format(new Date(iso));

export type ThreadItem = { kind: 'day'; key: string; day: string } | { kind: 'message'; key: string; message: Message; /** same author as the previous bubble, within 5 min: the meta line is shown once, under the last one */ grouped: boolean };

const sameAuthor = (a: Message, b: Message) => a.author === b.author && a.authorUser?.id === b.authorUser?.id && a.agent?.id === b.agent?.id;
export const GROUP_GAP_MS = 5 * 60_000;

/** Messages in chronological order with one separator per calendar day; duplicates (same id) are dropped. */
export const buildThread = (messages: readonly Message[]): ThreadItem[] => {
  const seen = new Set<string>();
  const sorted = [...messages].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).sort(compareMessages);
  const out: ThreadItem[] = [];
  let day = '';
  let prev: Message | null = null;
  for (const m of sorted) {
    const d = dayKey(m.sentAt);
    if (d !== day) {
      out.push({ kind: 'day', key: `day:${d}`, day: d });
      day = d;
      prev = null;
    }
    const grouped = !!prev && m.type !== 'system' && prev.type !== 'system' && sameAuthor(prev, m) && Date.parse(m.sentAt) - Date.parse(prev.sentAt) < GROUP_GAP_MS;
    out.push({ kind: 'message', key: m.id, message: m, grouped });
    prev = m;
  }
  return out;
};

/** Label of a day separator: today / yesterday keys, otherwise the day itself (formatted by the caller). */
export const dayLabelKind = (day: string, now = Date.now()): 'today' | 'yesterday' | 'date' =>
  day === dayKey(now) ? 'today' : day === dayKey(now - 86_400_000) ? 'yesterday' : 'date';

/* ---------- optimistic send + reconciliation ---------- */
export const TMP_PREFIX = 'tmp:';
export const isOptimistic = (m: Pick<Message, 'id'>) => m.id.startsWith(TMP_PREFIX);
export const optimisticId = (key: string) => `${TMP_PREFIX}${key}`;

export const optimisticMessage = (o: { key: string; conversationId: string; text: string | null; imageUrl?: string | null; author: Message['authorUser']; now?: number }): Message => ({
  id: optimisticId(o.key),
  conversationId: o.conversationId,
  direction: 'out',
  type: o.imageUrl ? 'image' : 'text',
  author: 'human',
  authorUser: o.author,
  agent: null,
  text: o.text,
  attachments: o.imageUrl ? [{ type: 'image', url: o.imageUrl, mime: 'image/*', size: 0 }] : [],
  transcript: null,
  transcriptStatus: null,
  payload: null,
  sentAt: new Date(o.now ?? Date.now()).toISOString(),
  deliveryStatus: 'pending',
  error: null,
  aiRunId: null,
  customerReaction: null,
  containsBlockedWord: false,
  flags: [],
});

/** The HTTP answer of a send: the optimistic bubble becomes the stored message (or disappears when WS already delivered it). */
export const reconcileSent = (list: readonly Message[], key: string, server: Message): Message[] => {
  const tmp = optimisticId(key);
  const known = list.some((m) => m.id === server.id);
  const out: Message[] = [];
  for (const m of list) {
    if (m.id === tmp) {
      if (!known) out.push(server);
    } else out.push(m.id === server.id ? { ...m, ...server } : m);
  }
  if (!known && !list.some((m) => m.id === tmp)) out.push(server);
  return out;
};

/** A failed send keeps its bubble, marked failed with the server reason: "Réessayer" re-sends with the same key. */
export const markSendFailed = (list: readonly Message[], key: string, error: string): Message[] =>
  list.map((m) => (m.id === optimisticId(key) ? { ...m, deliveryStatus: 'failed' as const, error } : m));

export const dropOptimistic = (list: readonly Message[], key: string): Message[] => list.filter((m) => m.id !== optimisticId(key));

/**
 * WS `message.created`: upsert by id. When this tab still shows the optimistic copy of the same reply (the event came
 * before the HTTP answer), the copy is replaced instead of being shown twice.
 */
export const mergeIncoming = (list: readonly Message[], incoming: Message, meId?: string | null): Message[] => {
  if (list.some((m) => m.id === incoming.id)) return list.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m));
  if (incoming.direction === 'out' && incoming.author === 'human' && (!meId || incoming.authorUser?.id === meId)) {
    const i = list.findIndex((m) => isOptimistic(m) && m.deliveryStatus === 'pending' && (m.text ?? '') === (incoming.text ?? '') && m.attachments.length === incoming.attachments.length);
    if (i >= 0) return list.map((m, idx) => (idx === i ? incoming : m));
  }
  return [...list, incoming];
};

/** WS `message.updated { messageId, deliveryStatus, error?, transcript?, attachments? }`. */
export const applyMessageUpdate = (list: readonly Message[], u: WsMessageUpdated): Message[] =>
  list.map((m) =>
    m.id !== u.messageId
      ? m
      : {
          ...m,
          deliveryStatus: u.deliveryStatus ?? m.deliveryStatus,
          error: u.error === undefined ? m.error : u.error,
          transcript: u.transcript === undefined ? m.transcript : u.transcript,
          transcriptStatus: u.transcriptStatus ?? (u.transcript ? 'done' : m.transcriptStatus),
          attachments: u.attachments ?? m.attachments,
          customerReaction: u.customerReaction === undefined ? m.customerReaction : u.customerReaction,
        },
  );

/* ---------- list rows ---------- */
/** WS patch of a conversation onto a cached row / detail: only the fields the event carries. */
export const patchConversation = <T extends ConversationListItem>(row: T, p: ConversationPatch): T => {
  if (row.id !== p.id) return row;
  const next = { ...row };
  if (p.status !== undefined) next.status = p.status;
  if (p.aiPaused !== undefined) next.aiPaused = p.aiPaused;
  if (p.unreadCount !== undefined) next.unreadCount = p.unreadCount;
  if (p.lastMessageAt) next.lastMessageAt = p.lastMessageAt;
  if (p.lastMessagePreview !== null && p.lastMessagePreview !== undefined) next.lastMessagePreview = p.lastMessagePreview;
  if (p.blocked !== undefined) next.blocked = p.blocked;
  if (p.assigneeId === null) next.assignee = null;
  // an older event (out of order) never lowers the version used by the next versioned PATCH
  if (p.version !== undefined && p.version > next.version) next.version = p.version;
  return next;
};

/** Preview line of a row after a new message (text, or the type when the message has no text). */
export const previewOf = (m: Pick<Message, 'text' | 'type'>): string | null => (m.text?.trim() ? m.text.trim().replace(/\s+/g, ' ').slice(0, 140) : null);

const PREVIEW_TYPES = ['image', 'audio', 'video', 'file', 'location', 'sticker', 'postback', 'product_cards', 'system'] as const;
/**
 * The API stores `[<type>]` as the preview of a message without text (`[image]`, `[product_cards]`…): the i18n key of
 * its label, or null when the preview is real text.
 */
export const previewTypeKey = (preview: string | null | undefined): `inbox.preview.${(typeof PREVIEW_TYPES)[number]}` | null => {
  const m = /^\[([a-z_]+)\]$/.exec(preview?.trim() ?? '');
  const type = m?.[1] as (typeof PREVIEW_TYPES)[number] | undefined;
  return type && PREVIEW_TYPES.includes(type) ? `inbox.preview.${type}` : null;
};

/** Newest first; rows without a date go last. */
export const sortByLastMessage = <T extends Pick<ConversationListItem, 'lastMessageAt' | 'id'>>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') || b.id.localeCompare(a.id));

/* ---------- tabs & filters ↔ URL ---------- */
export const INBOX_TABS = ['all', 'active', 'needs_human', 'resolved', 'archived', 'blocked'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];
export const INBOX_SORTS = ['lastMessageAt', 'oldestWaiting', 'unreadFirst'] as const;
export type InboxSort = (typeof INBOX_SORTS)[number];

export type InboxFilters = {
  tab: InboxTab;
  /** one page of the channel switcher (all channels when null) */
  channel: string | null;
  q: string;
  ai: 'active' | 'paused' | 'no_agent' | null;
  unread: boolean;
  assignee: string | null; // 'me' | 'none' | userId
  order: 'with' | 'cart' | 'abandoned' | 'without' | null;
  intent: string[];
  client: string[];
  language: string[];
  lastMessage: 'lt24h' | 'gt24h' | '7d' | null;
  sort: InboxSort;
  /** M11: conversations of one agent (Actions ⌄ › Conversations of an agent, ?agentId=): an active chip, not a panel field */
  agent: string | null;
};
export const DEFAULT_FILTERS: InboxFilters = { tab: 'all', channel: null, q: '', ai: null, unread: false, assignee: null, order: null, intent: [], client: [], language: [], lastMessage: null, sort: 'lastMessageAt', agent: null };

const INTENTS = ['sale', 'info', 'tracking', 'complaint', 'greeting', 'other'];
const CLIENT_FLAGS = ['risk', 'placeholder', 'vip'];
const pick = <T extends string>(raw: string | null, allowed: readonly T[]): T | null => (raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null);
const pickList = (raw: string | null, allowed?: readonly string[]) => [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter((s) => s && (!allowed || allowed.includes(s))))];

type Params = { get(name: string): string | null };
/** Unknown or malformed values fall back to the defaults: a shared link never breaks the page. */
export const parseInboxParams = (p: Params): InboxFilters => ({
  tab: pick(p.get('tab'), INBOX_TABS) ?? 'all',
  channel: p.get('channel')?.trim() || null,
  q: p.get('q') ?? '',
  ai: pick(p.get('ai'), ['active', 'paused', 'no_agent'] as const),
  unread: p.get('unread') === '1',
  assignee: p.get('assignee')?.trim() || null,
  order: pick(p.get('order'), ['with', 'cart', 'abandoned', 'without'] as const),
  intent: pickList(p.get('intent'), INTENTS),
  client: pickList(p.get('client'), CLIENT_FLAGS),
  language: pickList(p.get('language')),
  lastMessage: pick(p.get('lastMessage'), ['lt24h', 'gt24h', '7d'] as const),
  sort: pick(p.get('sort'), INBOX_SORTS) ?? 'lastMessageAt',
  agent: p.get('agentId')?.trim() || null,
});

/** Canonical query string (defaults omitted, stable order): the same view always has the same URL. */
export const inboxQueryString = (f: InboxFilters): string => {
  const p = new URLSearchParams();
  if (f.tab !== 'all') p.set('tab', f.tab);
  if (f.channel) p.set('channel', f.channel);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.ai) p.set('ai', f.ai);
  if (f.unread) p.set('unread', '1');
  if (f.assignee) p.set('assignee', f.assignee);
  if (f.order) p.set('order', f.order);
  if (f.intent.length) p.set('intent', f.intent.join(','));
  if (f.client.length) p.set('client', f.client.join(','));
  if (f.language.length) p.set('language', f.language.join(','));
  if (f.lastMessage) p.set('lastMessage', f.lastMessage);
  if (f.sort !== 'lastMessageAt') p.set('sort', f.sort);
  if (f.agent) p.set('agentId', f.agent);
  return p.toString();
};

export type InboxApiQuery = Record<string, string | number | boolean | string[] | undefined>;
/** `GET /conversations` parameters (api-contract §4 `InboxQuery`); the tab is the status filter, "Bloqués" is `blocked=1`. */
export const inboxApiQuery = (f: InboxFilters, limit = 50): InboxApiQuery => ({
  channelIds: f.channel ? [f.channel] : undefined,
  status: f.tab === 'all' || f.tab === 'blocked' ? undefined : f.tab,
  blocked: f.tab === 'blocked' ? true : undefined,
  q: f.q.trim().length >= 2 ? f.q.trim() : undefined,
  ai: f.ai ?? undefined,
  unread: f.unread || undefined,
  assigneeId: f.assignee ?? undefined,
  order: f.order ?? undefined,
  intent: f.intent.length ? f.intent : undefined,
  client: f.client.length ? f.client : undefined,
  language: f.language.length ? f.language : undefined,
  lastMessage: f.lastMessage ?? undefined,
  sort: f.sort === 'lastMessageAt' ? undefined : f.sort,
  agentId: f.agent ?? undefined,
  limit,
});

/** Filters of the panel that narrow the list (tab, channel and search are shown elsewhere). */
export const countPanelFilters = (f: InboxFilters): number =>
  (f.ai ? 1 : 0) + (f.unread ? 1 : 0) + (f.assignee ? 1 : 0) + (f.order ? 1 : 0) + f.intent.length + f.client.length + f.language.length + (f.lastMessage ? 1 : 0) + (f.sort !== 'lastMessageAt' ? 1 : 0);
export const isFiltered = (f: InboxFilters): boolean => f.q.trim().length >= 2 || !!f.agent || countPanelFilters(f) - (f.sort !== 'lastMessageAt' ? 1 : 0) > 0;
export const resetPanelFilters = (f: InboxFilters): InboxFilters => ({ ...DEFAULT_FILTERS, tab: f.tab, channel: f.channel });

export const tabCount = (counts: ConversationCounts | undefined, tab: InboxTab): number | null => (counts ? (counts[tab] ?? 0) : null);

/** Does a row still belong to the visible tab after a live change? (resolved elsewhere ⇒ leaves "Actifs") */
export const matchesTab = (row: Pick<ConversationListItem, 'status' | 'blocked'>, tab: InboxTab): boolean =>
  tab === 'blocked' ? row.blocked : !row.blocked && (tab === 'all' || row.status === tab);

/* ---------- quick replies: the `/` popover of the composer ---------- */
export type QuickReplyLike = { id: string; title: string; body: string; shortcut: string | null };
/** `/liv` typed at the very start of the draft opens the popover with that query; null otherwise. */
export const slashQuery = (draft: string): string | null => {
  const m = /^\/([^\s/]*)$/.exec(draft);
  return m ? m[1]!.toLowerCase() : null;
};
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const filterQuickReplies = <T extends QuickReplyLike>(replies: readonly T[], query: string): T[] => {
  const q = fold(query.replace(/^\//, ''));
  if (!q) return [...replies];
  const starts = replies.filter((r) => (r.shortcut ? fold(r.shortcut.replace(/^\//, '')).startsWith(q) : false));
  const rest = replies.filter((r) => !starts.includes(r) && (fold(r.title).includes(q) || fold(r.body).includes(q)));
  return [...starts, ...rest];
};
/**
 * The variables of a quick reply (INB-03): `{prénom}` (customer's first name), `{boutique}` (shop name), `{total}` (total of
 * the customer's last order, `12 500 DA`). Tester notes 25/10: only `{prénom}` was filled. A value that is not known is
 * left out — a raw `{total}` never reaches the customer.
 */
export const fillQuickReply = (body: string, o: { firstName?: string | null; shop?: string | null; total?: number | null }): string =>
  body
    .replace(/\{(prénom|prenom|firstName)\}/gi, o.firstName?.trim() || '')
    .replace(/\{(boutique|shop)\}/gi, o.shop?.trim() || '')
    .replace(/\{total\}/gi, typeof o.total === 'number' ? formatMoney(o.total) : '')
    .replace(/ {2,}/g, ' ');

export const firstNameOf = (name: string | null | undefined): string => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** `HH:mm` in Africa/Algiers, Latin digits. */
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
export const clockOf = (iso: string): string => timeFmt.format(new Date(iso));

/** `{ value: '240', unit: 'kb' }` / `{ value: '1,2', unit: 'mb' }` — the unit label is an i18n key (`inbox.size.kb`). */
export const fileSize = (bytes: number, locale: string): { value: string; unit: 'kb' | 'mb' } => {
  if (bytes >= 1024 * 1024) return { value: (bytes / 1024 / 1024).toFixed(1).replace('.', locale === 'en' ? '.' : ','), unit: 'mb' };
  return { value: String(Math.max(1, Math.round(bytes / 1024))), unit: 'kb' };
};
/** `0:40` */
export const durationOf = (sec: number | null | undefined): string => {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
