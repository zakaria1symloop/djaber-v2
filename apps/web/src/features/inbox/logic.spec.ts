// Inbox rules: 24 h window → composer state, banner priority, thread grouping / day separators, optimistic
// reconciliation, tab / filter codec, quick replies.
import { formatMoney } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import type { Conversation, Message } from './contracts';
import {
  applyMessageUpdate,
  buildThread,
  checkDraft,
  composerState,
  countPanelFilters,
  dayKey,
  dayLabelKind,
  DEFAULT_FILTERS,
  dropOptimistic,
  fillQuickReply,
  filterQuickReplies,
  imageError,
  inboxApiQuery,
  inboxQueryString,
  isFiltered,
  isWithinWindow,
  markSendFailed,
  matchesTab,
  mergeIncoming,
  optimisticMessage,
  parseInboxParams,
  patchConversation,
  reconcileSent,
  previewTypeKey,
  slashQuery,
  sortByLastMessage,
  threadBanner,
} from './logic';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const conv = (o: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  channel: { id: 'ch1', platform: 'facebook', name: 'Boutique Amel', avatarUrl: null, status: 'active' },
  client: { id: 'cl1', name: 'Amina B.', phone: null, riskLevel: 'normal', isPlaceholder: false, blocked: false, orderCount: 0, avatarUrl: null },
  status: 'active',
  aiPaused: false,
  agent: null,
  pageHasAgent: true,
  assignee: null,
  unreadCount: 0,
  lastMessageAt: ago(1),
  lastMessagePreview: 'salam',
  lastMessageDirection: 'in',
  within24h: true,
  lastAiIntent: null,
  language: null,
  handoffReason: null,
  blocked: false,
  cart: null,
  version: 1,
  lastCustomerMessageAt: ago(1),
  firstInboundAt: null,
  createdAt: ago(48),
  deletedAt: null,
  notesCount: 0,
  aiPausedBy: null,
  blockedAt: null,
  blockedBy: null,
  blockSource: null,
  mergedInto: null,
  composer: { canSend: true, reasonCode: null, channelStatus: 'active', within24h: true, humanAgentTag: false, windowEndsAt: null },
  clientPanel: { client: null, identity: { displayName: null, avatarUrl: null, externalSenderId: 'x' }, orders: [], block: null },
  actions: [],
  ...o,
});
const msg = (o: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  direction: 'in',
  type: 'text',
  author: 'customer',
  authorUser: null,
  agent: null,
  text: 'salam',
  attachments: [],
  transcript: null,
  transcriptStatus: null,
  payload: null,
  sentAt: ago(1),
  deliveryStatus: 'sent',
  error: null,
  aiRunId: null,
  customerReaction: null,
  containsBlockedWord: false,
  flags: [],
  ...o,
});

describe('24 h window', () => {
  it('uses the last customer message instant, to the millisecond', () => {
    expect(isWithinWindow({ within24h: false, lastCustomerMessageAt: ago(23.99) }, NOW)).toBe(true);
    expect(isWithinWindow({ within24h: true, lastCustomerMessageAt: ago(24) }, NOW)).toBe(false);
  });
  it('falls back to the server flag when the instant is unknown', () => {
    expect(isWithinWindow({ within24h: true, lastCustomerMessageAt: null }, NOW)).toBe(true);
    expect(isWithinWindow({ within24h: false }, NOW)).toBe(false);
  });
});

describe('composer state', () => {
  it('is ready inside the window on an active page', () => {
    expect(composerState(conv(), { readOnly: false, now: NOW })).toEqual({ mode: 'ready' });
  });
  it('is hidden for a read-only member, whatever the conversation', () => {
    expect(composerState(conv({ blocked: true }), { readOnly: true, now: NOW })).toEqual({ mode: 'hidden', reason: 'readOnly', code: 'READ_ONLY_MEMBER' });
  });
  it('is disabled with REPLY_CHANNEL_INACTIVE when the page is not active; reconnect is offered for needs_reconnect only', () => {
    for (const status of ['needs_reconnect', 'paused', 'disabled', 'disconnected', 'pending_review'] as const) {
      const s = composerState(conv({ channel: { ...conv().channel, status } }), { readOnly: false, now: NOW });
      expect(s).toMatchObject({ mode: 'disabled', reason: 'channelInactive', code: 'REPLY_CHANNEL_INACTIVE', reconnect: status === 'needs_reconnect' });
    }
  });
  it('is disabled for a blocked customer', () => {
    expect(composerState(conv({ blocked: true }), { readOnly: false, now: NOW })).toMatchObject({ mode: 'disabled', reason: 'blocked' });
  });
  it('outside the window: Messenger offers a template message, Instagram nothing', () => {
    const late = { lastCustomerMessageAt: ago(30), within24h: false };
    expect(composerState(conv({ ...late, composer: undefined }), { readOnly: false, now: NOW })).toEqual({ mode: 'disabled', reason: 'outsideWindow', code: 'REPLY_OUTSIDE_WINDOW', template: true });
    // the server says the HUMAN_AGENT tag cannot be used (app not approved for « Human Agent », tester account 26/10): no template either
    expect(composerState(conv(late), { readOnly: false, now: NOW })).toMatchObject({ reason: 'outsideWindow', template: false });
    expect(composerState(conv({ ...late, channel: { ...conv().channel, platform: 'instagram' } }), { readOnly: false, now: NOW })).toMatchObject({ reason: 'outsideWindow', template: false });
  });
  it('outside the window on Messenger, the reply is allowed with the HUMAN_AGENT tag while the server says so; never on Instagram', () => {
    const late = { lastCustomerMessageAt: ago(30), within24h: false };
    const composer = { canSend: true, reasonCode: null, channelStatus: 'active', within24h: false, humanAgentTag: true, windowEndsAt: null };
    expect(composerState(conv({ ...late, composer }), { readOnly: false, now: NOW })).toEqual({ mode: 'ready', tagged: true });
    expect(composerState(conv({ ...late, composer, channel: { ...conv().channel, platform: 'instagram' } }), { readOnly: false, now: NOW })).toMatchObject({ mode: 'disabled', template: false });
    // the window closed while the thread was open: the stale server flag (inside the window, no tag) is not trusted
    expect(composerState(conv({ ...late, composer: { ...composer, within24h: true, humanAgentTag: false } }), { readOnly: false, now: NOW })).toMatchObject({ mode: 'disabled', reason: 'outsideWindow', template: false });
  });
  it('honours a refusal computed by the server when the local rule sees none', () => {
    const composer = { canSend: false, reasonCode: 'REPLY_OUTSIDE_WINDOW', channelStatus: 'active', within24h: false, humanAgentTag: false, windowEndsAt: null };
    expect(composerState(conv({ composer }), { readOnly: false, now: NOW })).toMatchObject({ reason: 'outsideWindow', template: false });
    expect(composerState(conv({ composer: { ...composer, humanAgentTag: true } }), { readOnly: false, now: NOW })).toMatchObject({ reason: 'outsideWindow', template: true });
    expect(composerState(conv({ composer: { ...composer, reasonCode: 'READ_ONLY_MEMBER' } }), { readOnly: false, now: NOW })).toMatchObject({ mode: 'hidden' });
  });
  it('the inactive page wins over the window and the block', () => {
    const s = composerState(conv({ blocked: true, lastCustomerMessageAt: ago(40), channel: { ...conv().channel, status: 'needs_reconnect' } }), { readOnly: false, now: NOW });
    expect(s).toMatchObject({ reason: 'channelInactive' });
  });
  it('draft: empty, too long (2000), image only', () => {
    expect(checkDraft('  ', false)).toMatchObject({ ok: false, empty: true });
    expect(checkDraft('', true)).toMatchObject({ ok: true, empty: false });
    expect(checkDraft('a'.repeat(2000), false)).toMatchObject({ ok: true, tooLong: false, length: 2000 });
    expect(checkDraft('a'.repeat(2001), false)).toMatchObject({ ok: false, tooLong: true });
  });
  it('image: 5 MB max, jpeg / png / webp / gif only', () => {
    expect(imageError({ size: 4 * 1024 * 1024, type: 'image/jpeg' })).toBeNull();
    expect(imageError({ size: 6 * 1024 * 1024, type: 'image/png' })).toBe('IMAGE_TOO_LARGE');
    expect(imageError({ size: 10, type: 'application/pdf' })).toBe('IMAGE_TYPE_INVALID');
  });
});

describe('conversation banner priority', () => {
  const all = conv({
    aiPaused: true,
    aiPausedBy: { id: 'u1', firstName: 'Nadia', lastName: 'F.', avatarUrl: null },
    status: 'needs_human',
    channel: { ...conv().channel, status: 'needs_reconnect' },
    creditsExhausted: true,
    aiUnavailable: true,
    blocked: true,
    lastCustomerMessageAt: ago(80),
  });
  it('AI paused by a member › needs human › reconnect › credits › paused by plan › AI unavailable › blocked › outside window', () => {
    expect(threadBanner(all, { now: NOW })).toBe('aiPaused');
    // a handoff caused by the credits / by the provider shows its cause instead of the generic À TRAITER banner
    expect(threadBanner({ ...all, aiPausedBy: null }, { now: NOW })).toBe('credits');
    expect(threadBanner({ ...all, aiPausedBy: null, creditsExhausted: false }, { now: NOW })).toBe('aiUnavailable');
    expect(threadBanner({ ...all, aiPausedBy: null, creditsExhausted: false, aiUnavailable: false }, { now: NOW })).toBe('needsHuman');
    expect(threadBanner({ ...all, aiPaused: false, status: 'active' }, { now: NOW })).toBe('reconnect');
    const active = { ...all, aiPaused: false, status: 'active' as const, channel: { ...all.channel, status: 'active' as const } };
    expect(threadBanner(active, { now: NOW })).toBe('credits');
    expect(threadBanner({ ...active, creditsExhausted: false, channel: { ...all.channel, status: 'paused' } }, { now: NOW })).toBe('pausedByPlan');
    expect(threadBanner({ ...active, creditsExhausted: false }, { now: NOW })).toBe('aiUnavailable');
    expect(threadBanner({ ...active, creditsExhausted: false, aiUnavailable: false }, { now: NOW })).toBe('blocked');
    expect(threadBanner({ ...active, creditsExhausted: false, aiUnavailable: false, blocked: false }, { now: NOW })).toBe('outsideWindow');
    expect(threadBanner(conv(), { now: NOW })).toBeNull();
  });
  it('a manual pause on an active conversation shows the pause banner', () => {
    expect(threadBanner(conv({ aiPaused: true }), { now: NOW })).toBe('aiPaused');
  });
});

describe('thread', () => {
  it('sorts by time then id, drops duplicates, and inserts one separator per Algiers day', () => {
    const items = buildThread([
      msg({ id: 'b', sentAt: '2026-10-10T23:30:00.000Z' }), // 00:30 on the 11th in Algiers
      msg({ id: 'a', sentAt: '2026-10-10T21:00:00.000Z' }),
      msg({ id: 'a', sentAt: '2026-10-10T21:00:00.000Z' }),
      msg({ id: 'c', sentAt: '2026-10-11T09:00:00.000Z' }),
    ]);
    expect(items.map((i) => (i.kind === 'day' ? `day ${i.day}` : i.message.id))).toEqual(['day 2026-10-10', 'a', 'day 2026-10-11', 'b', 'c']);
  });
  it('groups consecutive bubbles of the same author within 5 minutes; system events never group', () => {
    const t = (min: number) => new Date(NOW + min * 60_000).toISOString();
    const items = buildThread([
      msg({ id: '1', sentAt: t(0) }),
      msg({ id: '2', sentAt: t(2) }),
      msg({ id: '3', sentAt: t(9) }),
      msg({ id: '4', sentAt: t(10), author: 'ai', direction: 'out' }),
      msg({ id: '5', sentAt: t(11), author: 'system', type: 'system', direction: 'out' }),
      msg({ id: '6', sentAt: t(11.5), author: 'system', type: 'system', direction: 'out' }),
    ]).filter((i) => i.kind === 'message');
    expect(items.map((i) => (i.kind === 'message' ? i.grouped : null))).toEqual([false, true, false, false, false, false]);
  });
  it('humans are grouped per member', () => {
    const u = (id: string) => ({ id, firstName: id, lastName: '', avatarUrl: null });
    const items = buildThread([
      msg({ id: '1', author: 'human', direction: 'out', authorUser: u('nadia'), sentAt: ago(1) }),
      msg({ id: '2', author: 'human', direction: 'out', authorUser: u('sara'), sentAt: new Date(NOW - 3600_000 + 30_000).toISOString() }),
    ]).filter((i) => i.kind === 'message');
    expect(items.map((i) => (i.kind === 'message' ? i.grouped : null))).toEqual([false, false]);
  });
  it('day labels: today, yesterday, date', () => {
    expect(dayKey('2026-10-11T12:00:00.000Z')).toBe('2026-10-11');
    expect(dayLabelKind('2026-10-11', NOW)).toBe('today');
    expect(dayLabelKind('2026-10-10', NOW)).toBe('yesterday');
    expect(dayLabelKind('2026-10-02', NOW)).toBe('date');
  });
});

describe('optimistic send', () => {
  const me = { id: 'me', firstName: 'Nadia', lastName: 'F.', avatarUrl: null };
  const tmp = optimisticMessage({ key: 'k1', conversationId: 'c1', text: 'Bonjour', author: me, now: NOW });
  const stored = msg({ id: 'srv1', direction: 'out', author: 'human', authorUser: me, text: 'Bonjour', deliveryStatus: 'pending', sentAt: new Date(NOW + 50).toISOString() });

  it('the optimistic bubble is a pending human message of this member', () => {
    expect(tmp).toMatchObject({ id: 'tmp:k1', author: 'human', direction: 'out', deliveryStatus: 'pending', authorUser: me });
  });
  it('HTTP answer first: the bubble becomes the stored message, the later WS event changes nothing', () => {
    const a = reconcileSent([msg(), tmp], 'k1', stored);
    expect(a.map((m) => m.id)).toEqual(['m1', 'srv1']);
    expect(mergeIncoming(a, { ...stored, deliveryStatus: 'sent' }, 'me').map((m) => [m.id, m.deliveryStatus])).toEqual([['m1', 'sent'], ['srv1', 'sent']]);
  });
  it('WS event first: it replaces the optimistic bubble, the HTTP answer then finds it and adds nothing', () => {
    const a = mergeIncoming([msg(), tmp], stored, 'me');
    expect(a.map((m) => m.id)).toEqual(['m1', 'srv1']);
    expect(reconcileSent(a, 'k1', stored).map((m) => m.id)).toEqual(['m1', 'srv1']);
  });
  it("a colleague's reply with the same text is not taken for mine", () => {
    const other = { ...stored, id: 'srv2', authorUser: { ...me, id: 'sara' } };
    expect(mergeIncoming([tmp], other, 'me').map((m) => m.id)).toEqual(['tmp:k1', 'srv2']);
  });
  it('a customer message is appended; an event for a known id updates it', () => {
    const a = mergeIncoming([msg()], msg({ id: 'm2' }), 'me');
    expect(a.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(mergeIncoming(a, msg({ id: 'm2', text: 'edit' }), 'me')[1]!.text).toBe('edit');
  });
  it('a refused send keeps the bubble as failed with the reason; retry drops or replaces it', () => {
    const failed = markSendFailed([tmp], 'k1', 'REPLY_OUTSIDE_WINDOW');
    expect(failed[0]).toMatchObject({ deliveryStatus: 'failed', error: 'REPLY_OUTSIDE_WINDOW' });
    expect(dropOptimistic(failed, 'k1')).toEqual([]);
    expect(reconcileSent(failed, 'k1', stored).map((m) => m.id)).toEqual(['srv1']);
  });
  it('message.updated patches delivery status, error, transcript and stored media', () => {
    const list = [msg({ id: 'a', type: 'audio', transcriptStatus: 'pending' }), stored];
    const a = applyMessageUpdate(list, { conversationId: 'c1', messageId: 'srv1', deliveryStatus: 'failed', error: 'META_UNAVAILABLE' });
    expect(a[1]).toMatchObject({ deliveryStatus: 'failed', error: 'META_UNAVAILABLE' });
    const b = applyMessageUpdate(a, { conversationId: 'c1', messageId: 'a', transcript: 'est-ce que la robe existe' });
    expect(b[0]).toMatchObject({ transcript: 'est-ce que la robe existe', transcriptStatus: 'done', deliveryStatus: 'sent' });
  });
});

describe('list rows', () => {
  it('a WS patch only touches the fields it carries', () => {
    const row = conv({ unreadCount: 2, assignee: { id: 'u', firstName: 'S', lastName: 'K', avatarUrl: null } });
    const next = patchConversation(row, { id: 'c1', status: 'resolved', unreadCount: 0, version: 4 });
    expect(patchConversation(next, { id: 'c1', version: 2 }).version).toBe(4);
    expect(next).toMatchObject({ status: 'resolved', unreadCount: 0, version: 4, aiPaused: false });
    expect(next.assignee?.id).toBe('u');
    expect(patchConversation(row, { id: 'c1', assigneeId: null }).assignee).toBeNull();
    expect(patchConversation(row, { id: 'other', status: 'archived' })).toBe(row);
  });
  it('sorts newest first and keeps undated rows last', () => {
    const rows = [conv({ id: 'a', lastMessageAt: ago(5) }), conv({ id: 'b', lastMessageAt: '' }), conv({ id: 'c', lastMessageAt: ago(1) })];
    expect(sortByLastMessage(rows).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
  it('tab membership: blocked rows live under "Bloqués" only', () => {
    expect(matchesTab({ status: 'resolved', blocked: false }, 'active')).toBe(false);
    expect(matchesTab({ status: 'resolved', blocked: false }, 'all')).toBe(true);
    expect(matchesTab({ status: 'active', blocked: true }, 'all')).toBe(false);
    expect(matchesTab({ status: 'active', blocked: true }, 'blocked')).toBe(true);
  });
});

describe('tab / filter codec', () => {
  it('defaults produce an empty query string and parse back', () => {
    expect(inboxQueryString(DEFAULT_FILTERS)).toBe('');
    expect(parseInboxParams(new URLSearchParams(''))).toEqual(DEFAULT_FILTERS);
  });
  it('round-trips every filter', () => {
    const f = { ...DEFAULT_FILTERS, tab: 'needs_human' as const, channel: 'ch1', q: 'amina', ai: 'paused' as const, unread: true, assignee: 'me', order: 'cart' as const, intent: ['sale', 'info'], client: ['risk'], language: ['ar'], lastMessage: 'lt24h' as const, sort: 'oldestWaiting' as const };
    const qs = inboxQueryString(f);
    expect(qs).toBe('tab=needs_human&channel=ch1&q=amina&ai=paused&unread=1&assignee=me&order=cart&intent=sale%2Cinfo&client=risk&language=ar&lastMessage=lt24h&sort=oldestWaiting');
    expect(parseInboxParams(new URLSearchParams(qs))).toEqual(f);
  });
  it('?agentId= (M11): round-trips, reaches the API as agentId and counts as a filtered view', () => {
    const f = parseInboxParams(new URLSearchParams('agentId=a1'));
    expect(f).toEqual({ ...DEFAULT_FILTERS, agent: 'a1' });
    expect(inboxQueryString(f)).toBe('agentId=a1');
    expect(inboxApiQuery(f)).toMatchObject({ agentId: 'a1' });
    expect(isFiltered(f)).toBe(true);
    expect(countPanelFilters(f)).toBe(0);
  });
  it('ignores unknown values instead of failing', () => {
    const f = parseInboxParams(new URLSearchParams('tab=zzz&ai=robot&intent=sale,hack&sort=price&unread=yes'));
    expect(f).toEqual({ ...DEFAULT_FILTERS, intent: ['sale'] });
  });
  it('maps onto the API query: the tab is the status, "Bloqués" is blocked=1, search needs 2 characters', () => {
    expect(inboxApiQuery({ ...DEFAULT_FILTERS, tab: 'resolved', channel: 'ch1', q: 'a' })).toMatchObject({ status: 'resolved', channelIds: ['ch1'], q: undefined, limit: 50 });
    expect(inboxApiQuery({ ...DEFAULT_FILTERS, tab: 'blocked', q: '0555' })).toMatchObject({ status: undefined, blocked: true, q: '0555' });
    expect(inboxApiQuery({ ...DEFAULT_FILTERS, assignee: 'none', unread: true })).toMatchObject({ assigneeId: 'none', unread: true });
  });
  it('counts the panel filters; the sort is not a "filtered" state', () => {
    expect(countPanelFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countPanelFilters({ ...DEFAULT_FILTERS, ai: 'paused', intent: ['sale', 'info'], sort: 'unreadFirst' })).toBe(4);
    expect(isFiltered({ ...DEFAULT_FILTERS, sort: 'unreadFirst' })).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTERS, q: 'am' })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, tab: 'archived', channel: 'x' })).toBe(false);
  });
});

describe('quick replies', () => {
  const replies = [
    { id: '1', title: 'Livraison Sétif', body: 'Livraison 500 DA à domicile', shortcut: '/livr' },
    { id: '2', title: 'Merci pour votre commande', body: 'Merci {prénom} ! Nous vous appelons pour confirmer la livraison.', shortcut: null },
    { id: '3', title: 'Horaires', body: 'Nous sommes disponibles de 9h à 20h', shortcut: '/h' },
  ];
  it('the slash opens the popover only at the start of an otherwise empty draft', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/Liv')).toBe('liv');
    expect(slashQuery('bonjour /liv')).toBeNull();
    expect(slashQuery('/liv raison')).toBeNull();
    expect(slashQuery('')).toBeNull();
  });
  it('shortcut matches come first, then title / text matches, accents ignored', () => {
    expect(filterQuickReplies(replies, '').map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(filterQuickReplies(replies, 'liv').map((r) => r.id)).toEqual(['1', '2']);
    expect(filterQuickReplies(replies, 'setif').map((r) => r.id)).toEqual(['1']);
    expect(filterQuickReplies(replies, 'zzz')).toEqual([]);
  });
  it('fills the first-name variable, or removes it', () => {
    expect(fillQuickReply(replies[1]!.body, { firstName: 'Amina' })).toBe('Merci Amina ! Nous vous appelons pour confirmer la livraison.');
    expect(fillQuickReply('Merci {prénom} !', { firstName: null })).toBe('Merci !');
    // tester notes 25/10: {boutique} and {total} are filled too; an unknown total is left out
    expect(fillQuickReply('Bonjour {prénom}, {boutique} confirme {total}.', { firstName: 'Amina', shop: 'Boutique Yasmine', total: 12500 })).toBe(`Bonjour Amina, Boutique Yasmine confirme ${formatMoney(12500)}.`);
    expect(fillQuickReply('Total : {total} chez {boutique}', { shop: 'Atelier' })).toBe('Total : chez Atelier');
  });
});

describe('preview of a message without text', () => {
  it('maps the `[type]` previews of the API to their label key, keeps real text', () => {
    expect(previewTypeKey('[product_cards]')).toBe('inbox.preview.product_cards');
    expect(previewTypeKey(' [image] ')).toBe('inbox.preview.image');
    expect(previewTypeKey('[unknown_kind]')).toBeNull();
    expect(previewTypeKey('Bonjour [image]')).toBeNull();
    expect(previewTypeKey(null)).toBeNull();
  });
});
