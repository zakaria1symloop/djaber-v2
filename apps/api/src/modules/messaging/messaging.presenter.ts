// Read models of the inbox (api-contract §3.3): rows → `MessageView`, `ConversationListItemView`, `ConversationHead`.
import { isWithin24h, type ConversationHead, type ConversationListItemView, type InboxAgentRef, type MessageAttachmentView, type MessagePayloadView, type MessageView } from '@djaber/shared';
import type { Conversation, Message, Prisma } from '@djaber/db';
import { channelRef } from '../channels/channel.service';

export const userRef = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } as const;
export const conversationInclude = {
  // the agent linked to the page (one at most): "Mettre l'IA en pause / Reprendre l'IA" need one (`pageHasAgent`)
  channel: { include: { agentChannels: { select: { agentId: true }, take: 1 } } },
  client: true,
  agent: { select: { id: true, name: true, status: true } },
  assignee: userRef,
} as const satisfies Prisma.ConversationInclude;
export type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;
export const messageInclude = { authorUser: userRef } as const satisfies Prisma.MessageInclude;
export type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

/** What the server keeps in `Conversation.context` (free JSON; the AI adds its own keys in M4). */
export type ConversationContext = {
  lastLanguage?: string;
  handoffReason?: string | null;
  handoffAt?: string | null;
  handoffRemindedAt?: string | null;
  handoffMessageSentAt?: string | null;
  aiPausedById?: string | null;
  lastDirection?: 'in' | 'out';
  lastSystemTextAt?: Record<string, string>;
  displayName?: string | null;
  avatarUrl?: string | null;
  cart?: { items?: number; recapShownAt?: string | null; orderId?: string | null } | null;
  // --- AI pipeline (04-ai-pipeline §2) ---
  /** products the AI last showed (≤ 10, most recent first): retrieval context of the next turn */
  lastProductIds?: string[];
  /** 3 unclear turns in a row ⇒ handoff rule */
  unclearStreak?: number;
  /** why the AI does not answer this thread (banner "IA indisponible" / "Crédits épuisés"); cleared when it answers again */
  aiUnavailable?: 'credits' | 'quota' | 'error' | null;
  /** A4: order details the customer gave (reported by the AI turn after turn), shown to the next turns as KNOWN CUSTOMER */
  customer?: { name?: string; phone?: string; phone2?: string; wilaya?: string; commune?: string; address?: string };
};
export const contextOf = (c: Pick<Conversation, 'context'>): ConversationContext => (c.context && typeof c.context === 'object' && !Array.isArray(c.context) ? (c.context as ConversationContext) : {});

/** Attachment as stored in `Message.attachments`: the public view plus where it came from. */
export type StoredAttachment = MessageAttachmentView & { sourceUrl?: string | null; storageKey?: string | null };
export const attachmentsOf = (m: Pick<Message, 'attachments'>): StoredAttachment[] => (Array.isArray(m.attachments) ? (m.attachments as unknown as StoredAttachment[]) : []);

const publicAttachment = ({ sourceUrl: _s, storageKey: _k, ...a }: StoredAttachment): MessageAttachmentView => a;

export const presentMessage = (m: MessageRow, agent: InboxAgentRef | null = null): MessageView => {
  const raw = (m.payload && typeof m.payload === 'object' && !Array.isArray(m.payload) ? m.payload : null) as Record<string, unknown> | null;
  // keys starting with `_` are internal (send bookkeeping)
  const payload = raw ? (Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_'))) as NonNullable<MessagePayloadView>) : null;
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    type: m.type,
    author: m.author,
    authorUser: m.authorUser ?? null,
    agent: m.author === 'ai' ? agent : null,
    text: m.text,
    attachments: attachmentsOf(m).map(publicAttachment),
    transcript: m.transcript,
    transcriptStatus: m.transcriptStatus,
    payload: payload && Object.keys(payload).length ? payload : null,
    sentAt: m.sentAt.toISOString(),
    deliveryStatus: m.deliveryStatus,
    error: m.error,
    aiRunId: m.aiRunId,
    customerReaction: m.customerReaction,
    containsBlockedWord: m.containsBlockedWord,
    flags: m.containsBlockedWord ? ['blocked_word'] : [],
  };
};

export const conversationHead = (c: Pick<Conversation, 'id' | 'status' | 'aiPaused' | 'assigneeId' | 'unreadCount' | 'clientId' | 'lastMessageAt' | 'lastMessagePreview' | 'version'>, blocked = false): ConversationHead => ({
  id: c.id,
  status: c.status,
  aiPaused: c.aiPaused,
  assigneeId: c.assigneeId,
  unreadCount: c.unreadCount,
  clientId: c.clientId,
  lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
  lastMessagePreview: c.lastMessagePreview,
  version: c.version,
  blocked,
});

export const presentConversation = (c: ConversationRow, blocked: boolean, now = new Date()): ConversationListItemView => {
  const ctx = contextOf(c);
  const last6 = c.externalSenderId.slice(-6);
  const cart = ctx.cart && typeof ctx.cart === 'object' ? { items: Number(ctx.cart.items ?? 0), recapShownAt: ctx.cart.recapShownAt ?? null, orderId: ctx.cart.orderId ?? null } : null;
  return {
    id: c.id,
    channel: channelRef(c.channel),
    client: c.client
      ? { id: c.client.id, name: c.client.name, phone: c.client.phone, riskLevel: c.client.riskLevel, isPlaceholder: c.client.isPlaceholder, blocked, orderCount: c.client.orderCount, avatarUrl: ctx.avatarUrl ?? null }
      : { id: '', name: ctx.displayName ?? `${c.channel.platform === 'instagram' ? 'IG' : 'FB'} User ·${last6}`, phone: null, riskLevel: 'normal', isPlaceholder: true, blocked, orderCount: 0, avatarUrl: ctx.avatarUrl ?? null },
    status: c.status,
    aiPaused: c.aiPaused,
    agent: c.agent,
    pageHasAgent: c.channel.agentChannels.length > 0,
    assignee: c.assignee,
    unreadCount: c.unreadCount,
    lastMessageAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
    lastMessagePreview: c.lastMessagePreview ?? '',
    lastMessageDirection: ctx.lastDirection ?? 'in',
    lastCustomerMessageAt: c.lastCustomerMessageAt?.toISOString() ?? null,
    within24h: isWithin24h(c.lastCustomerMessageAt, now),
    lastAiIntent: c.lastAiIntent,
    language: ctx.lastLanguage ?? null,
    handoffReason: c.status === 'needs_human' ? (ctx.handoffReason ?? null) : null,
    blocked,
    cart,
    version: c.version,
  };
};

