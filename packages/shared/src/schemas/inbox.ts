// Inbox, messages, trust & safety (merchant side) and the notification centre
// (03 §4 MSG, §5 INB, §15 NTF, §24 SAFE; api-contract §3.3, §3.11, §3.12; 06 "Conversations", §8.3, §8.8, §10 "Boîte").
// One source for the API (nestjs-zod DTOs) and the web. Field names = contract names. Messages = i18n keys.
import { z } from 'zod';
import { AiIntentValues, BlockReasonValues, BlockSourceValues, ConversationStatusValues, NotificationTypeValues, ReportReasonValues } from '../enums';
import type { ChannelRefView } from './channels';
import type { ActionDescriptor } from './common';

// --- limits (spec values) ---------------------------------------------------------------------------------------------
export const REPLY_MAX_CHARS = 2000; // INB-03, REPLY_TOO_LONG
export const REPLY_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // INB-03
export const NOTE_MAX_CHARS = 2000;
export const PRODUCT_CARDS_MAX = 5; // MSG-07
export const MESSAGING_WINDOW_HOURS = 24; // MSG-06
/** Messenger `HUMAN_AGENT` tag: usable up to 7 days after the last customer message (Meta policy). */
export const HUMAN_AGENT_WINDOW_DAYS = 7;
export const CONVERSATION_RESTORE_DAYS = 30; // 06 §8.8
export const INBOX_BULK_MAX_IDS = 100;
export const BLOCKED_WORDS_MAX = 200;
/** 04 §13: more than 20 reports / day / workspace ⇒ 429 ABUSE_REPORT_RATE_LIMITED. */
export const REPORTS_PER_DAY_MAX = 20;
export const TEMPLATE_KEYS = ['orderShipped', 'orderOutForDelivery', 'orderDelivered', 'orderFailed', 'reminderScheduled'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));
const flag = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');
const cursor = { cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(50) };

// --- conversations: list & counts (06 §10 "Boîte") ------------------------------------------------------------------------
export const InboxQuerySchema = z
  .object({
    /** one channel (channel switcher) — alias of `channelIds` with a single value */
    channelId: id.optional(),
    channelIds: csv(id).optional(),
    status: z.enum(ConversationStatusValues).optional(),
    ai: z.enum(['active', 'paused', 'no_agent']).optional(),
    agentId: csv(id).optional(),
    unread: flag.optional(),
    assigneeId: z.union([z.literal('me'), z.literal('none'), id]).optional(),
    order: z.enum(['with', 'cart', 'abandoned', 'without']).optional(),
    intent: csv(z.enum(AiIntentValues)).optional(),
    client: csv(z.enum(['risk', 'placeholder', 'vip'])).optional(),
    language: csv(z.enum(['fr', 'ar', 'en'])).optional(),
    lastMessage: z.enum(['lt24h', 'gt24h', '7d', 'custom']).optional(),
    from: day.optional(),
    to: day.optional(),
    /** tab "Bloqués": blocked customers are hidden from every other tab (04 §13) */
    blocked: flag.optional(),
    q: z.string().trim().min(2, 'validation.length').max(120, 'validation.length').optional(),
    sort: z.enum(['lastMessageAt', 'oldestWaiting', 'unreadFirst']).default('lastMessageAt'),
    ...cursor,
  })
  .strict();
export type InboxQuery = z.infer<typeof InboxQuerySchema>;
export const ConversationCountsQuerySchema = z.object({ channelId: id.optional(), channelIds: csv(id).optional() }).strict();
export type ConversationCounts = { all: number; active: number; needs_human: number; resolved: number; archived: number; unread: number; blocked: number };

// --- conversations: mutations -------------------------------------------------------------------------------------------
/**
 * `PATCH /conversations/:id` (api-contract §1.8: `version` required, stale ⇒ 409 CONFLICT with `details.current`).
 * `status`: resolve / reopen (`active`) / archive / flag for a human; `aiPaused`: pause / resume the AI; `assigneeId`: member or null.
 */
export const UpdateConversationSchema = z
  .object({
    status: z.enum(ConversationStatusValues).optional(),
    aiPaused: z.boolean().optional(),
    assigneeId: id.nullable().optional(),
    version: z.number({ required_error: 'validation.required', invalid_type_error: 'validation.invalid' }).int().min(1),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.aiPaused !== undefined || v.assigneeId !== undefined, { message: 'validation.required', path: ['status'] });
export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>;

/**
 * `POST /conversations/:id/messages` (Idempotency-Key required). Exactly one way of composing:
 * free text and/or an uploaded image (`POST /uploads { kind: reply }`), a quick reply, or a template message.
 * The text length is checked by the service so that the answer is `422 REPLY_TOO_LONG` (11 §3).
 */
export const SendMessageSchema = z
  .object({
    text: z.string().optional(),
    uploadId: id.optional(),
    quickReplyId: id.optional(),
    templateKey: z.enum(TEMPLATE_KEYS).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasText = !!v.text && v.text.trim().length > 0;
    const modes = [hasText || !!v.uploadId, !!v.quickReplyId, !!v.templateKey].filter(Boolean).length;
    if (modes === 0) ctx.addIssue({ code: 'custom', path: ['text'], message: 'validation.required' });
    if (modes > 1) ctx.addIssue({ code: 'custom', path: [v.templateKey ? 'templateKey' : 'quickReplyId'], message: 'validation.invalid' });
  });
export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export const MessagesQuerySchema = z.object({ ...cursor }).strict();
export type MessagesQuery = z.infer<typeof MessagesQuerySchema>;

export const CreateNoteSchema = z.object({ body: z.string({ required_error: 'validation.required' }).trim().min(1, 'validation.required').max(NOTE_MAX_CHARS, 'validation.length') }).strict();
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;

/** `POST /conversations/:id/block` [FIG DLG "Bloquer le client"]. */
export const BlockConversationSchema = z
  .object({ reason: z.enum(BlockReasonValues, { errorMap: () => ({ message: 'validation.required' }) }), note: z.string().trim().max(500, 'validation.length').optional() })
  .strict();
export type BlockConversationInput = z.infer<typeof BlockConversationSchema>;

const ids = z.array(id, { required_error: 'validation.required' }).min(1, 'validation.required').max(INBOX_BULK_MAX_IDS, 'validation.length');
/** `POST /conversations/bulk/{resolve|archive|resume-ai}`. */
export const BulkConversationsSchema = z.object({ ids }).strict();
/** `POST /conversations/bulk/assign` — `assigneeId: null` unassigns. */
export const BulkAssignConversationsSchema = z.object({ ids, assigneeId: id.nullable() }).strict();
/** `POST /conversations/bulk/block`. */
export const BulkBlockConversationsSchema = z
  .object({ ids, reason: z.enum(BlockReasonValues).default('other'), note: z.string().trim().max(500, 'validation.length').optional() })
  .strict();
export const INBOX_BULK_ACTIONS = ['resolve', 'archive', 'assign', 'resume-ai', 'block'] as const;
export type InboxBulkAction = (typeof INBOX_BULK_ACTIONS)[number];

// --- trust & safety, merchant side (06 §8.3) ------------------------------------------------------------------------------
export const SafetyBlocksQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    source: z.enum(BlockSourceValues).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().refine((n) => n === 25 || n === 50 || n === 100, 'validation.range').default(25),
  })
  .strict();
export type SafetyBlocksQuery = z.infer<typeof SafetyBlocksQuerySchema>;
/** `POST /safety/blocks { clientId | phone, reason, note? }`. */
export const CreateBlockSchema = z
  .object({
    clientId: id.optional(),
    phone: z.string().trim().min(1).max(20).optional(),
    reason: z.enum(BlockReasonValues).optional(),
    note: z.string().trim().max(500, 'validation.length').optional(),
  })
  .strict()
  .refine((v) => !!v.clientId !== !!v.phone, { message: 'validation.required', path: ['clientId'] });
export type CreateBlockInput = z.infer<typeof CreateBlockSchema>;
/** `POST /safety/reports` (api-contract §3.11 `CreateReportDto`). */
export const CreateReportSchema = z
  .object({
    type: z.enum(['conversation', 'customer', 'ai_message', 'product']),
    conversationId: id.optional(),
    clientId: id.optional(),
    messageId: id.optional(),
    productId: id.optional(),
    reason: z.enum(ReportReasonValues, { errorMap: () => ({ message: 'validation.required' }) }),
    details: z.string().trim().max(2000, 'validation.length').optional(),
    blockAlso: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const need = { conversation: 'conversationId', customer: 'clientId', ai_message: 'messageId', product: 'productId' } as const;
    const key = need[v.type];
    // a customer can also be reported from its conversation (placeholder without a client card)
    if (!v[key] && !(v.type === 'customer' && v.conversationId)) ctx.addIssue({ code: 'custom', path: [key], message: 'validation.required' });
  });
export type CreateReportInput = z.infer<typeof CreateReportSchema>;
/** `POST /messages/:id/report` — shortcut of `POST /safety/reports { type: ai_message, messageId }`. */
export const ReportMessageSchema = z
  .object({ reason: z.enum(ReportReasonValues).default('ai_incorrect'), details: z.string().trim().max(2000, 'validation.length').optional() })
  .strict();
export const SafetyReportsQuerySchema = z
  .object({ scope: z.enum(['mine', 'workspace']).default('mine'), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().refine((n) => n === 25 || n === 50 || n === 100, 'validation.range').default(25) })
  .strict();
/**
 * `GET|PUT /safety/rules` (04 §13 auto-rules). `autoBlockEnabled` switches the auto-block rule (OFF by default);
 * `autoBlockAfterUncollected` is its threshold (≥ 1 unclaimed parcels, default 3) and is kept while the rule is off.
 * `riskAfterReturns = 0` turns the risk rule off.
 */
export const SafetyRulesSchema = z
  .object({
    riskAfterReturns: z.number({ invalid_type_error: 'validation.range' }).int().min(0, 'validation.range').max(50, 'validation.range'),
    autoBlockEnabled: z.boolean({ required_error: 'validation.required', invalid_type_error: 'validation.invalid' }),
    autoBlockAfterUncollected: z.number({ required_error: 'validation.required', invalid_type_error: 'validation.range' }).int().min(1, 'validation.range').max(50, 'validation.range'),
    handoffOnRisk: z.boolean(),
  })
  .strict();
export type SafetyRules = z.infer<typeof SafetyRulesSchema>;
/** Values of a workspace that never saved its rules (04 §13): the auto-block rule is off. */
export const DEFAULT_SAFETY_RULES: SafetyRules = { riskAfterReturns: 2, autoBlockEnabled: false, autoBlockAfterUncollected: 3, handoffOnRisk: true };
/**
 * The stored `Workspace.safetyRules` JSON completed with the defaults. The auto-block rule is on only when
 * `autoBlockEnabled` is true; a threshold below 1 (0 meant "off" before the flag existed) falls back to the default.
 */
export const completeSafetyRules = (stored: unknown): SafetyRules => {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<SafetyRules>;
  const int = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
  return {
    riskAfterReturns: int(s.riskAfterReturns, 0) ? s.riskAfterReturns : DEFAULT_SAFETY_RULES.riskAfterReturns,
    autoBlockEnabled: s.autoBlockEnabled === true,
    autoBlockAfterUncollected: int(s.autoBlockAfterUncollected, 1) ? s.autoBlockAfterUncollected : DEFAULT_SAFETY_RULES.autoBlockAfterUncollected,
    handoffOnRisk: typeof s.handoffOnRisk === 'boolean' ? s.handoffOnRisk : DEFAULT_SAFETY_RULES.handoffOnRisk,
  };
};
/** Threshold of the auto-block rule when it is switched on, else null: evaluators apply the rule only for a number. */
export const autoBlockThreshold = (rules: Partial<SafetyRules> | null | undefined): number | null =>
  rules?.autoBlockEnabled === true ? Math.max(1, Number(rules.autoBlockAfterUncollected ?? DEFAULT_SAFETY_RULES.autoBlockAfterUncollected)) : null;
export const BlockedWordsSchema = z
  .object({ words: z.array(z.string().trim().min(1, 'validation.required').max(60, 'validation.length')).max(BLOCKED_WORDS_MAX, 'validation.length') })
  .strict();

// --- notifications (06 §10 "Notifications") -------------------------------------------------------------------------------
export const NotificationsQuerySchema = z
  .object({
    types: csv(z.enum(NotificationTypeValues)).optional(),
    /** single-type alias used by the filter chips (`?type=`) */
    type: z.enum(NotificationTypeValues).optional(),
    group: z.string().optional(),
    unread: flag.optional(),
    from: day.optional(),
    to: day.optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type NotificationsQuery = z.infer<typeof NotificationsQuerySchema>;
export const NOTIFICATION_GROUPS = ['orders', 'queue', 'ai', 'stock', 'parcels', 'payments', 'pages', 'credits_plan', 'members', 'integrations', 'jobs', 'moderation', 'safety', 'support', 'platform'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];
export type NotificationView = {
  id: string;
  type: (typeof NotificationTypeValues)[number];
  group: NotificationGroup;
  title: string;
  body: string;
  data: Record<string, unknown>;
  deepLink: { web: string; mobile: string };
  readAt: string | null;
  createdAt: string;
};
/** WS `notification.created` (room `user:<id>`). */
export type NotificationCreatedEvent = { notification: NotificationView; unreadCount: number };
/** WS `notification.read`. */
export type NotificationReadEvent = { ids: string[] | 'all'; unreadCount: number };

// --- notification channels & preferences (03 §15 matrix, NTF-02, api-contract §3.12) ------------------------------------
type NotificationTypeName = (typeof NotificationTypeValues)[number];
/** `always` = ● (sent whatever the preference), `pref` = per `NotificationPreference` (default on), `never` = —. */
export type NotificationChannelMode = 'always' | 'pref' | 'never';
export type NotificationChannels = { inApp: boolean; email: NotificationChannelMode; push: NotificationChannelMode };
const ch = (inApp: boolean, email: NotificationChannelMode, push: NotificationChannelMode): NotificationChannels => ({ inApp, email, push });
const A = 'always' as const;
const P = 'pref' as const;
const N = 'never' as const;
/**
 * 03 §15 / 03-events §5.1 — the channels of every `NotificationType` (one row per enum value; the compiler refuses a
 * missing one). E-mail-only types (`account.verify_reminder`, `workspace.deleted`, `account.deletion_confirmed`) are sent
 * by their own e-mail flows; `member.invited` e-mails the invitee (InvitationService), never the team.
 */
export const NOTIFICATION_CHANNELS: Record<NotificationTypeName, NotificationChannels> = {
  order_ai_created: ch(true, P, A),
  conversation_handoff: ch(true, P, A),
  conversation_needs_human_message: ch(true, N, A),
  conversation_handoff_unattended: ch(true, N, A),
  agent_insight: ch(true, N, N),
  ai_error: ch(true, A, A),
  stock_low: ch(true, P, N),
  stock_out: ch(true, P, N),
  shipment_created: ch(true, N, N),
  shipment_out_for_delivery: ch(true, N, N),
  shipment_delivered: ch(true, N, N),
  shipment_failed: ch(true, A, A),
  shipment_returned: ch(true, A, A),
  payment_received: ch(true, A, N),
  payment_failed: ch(true, A, N),
  channel_needs_reconnect: ch(true, A, A),
  channel_paused_by_plan: ch(true, A, N),
  credits_80: ch(true, A, A),
  credits_exhausted: ch(true, A, A),
  quota_80: ch(true, A, N),
  quota_100: ch(true, A, N),
  subscription_expiring: ch(true, A, A),
  subscription_expired: ch(true, A, A),
  member_invited: ch(true, N, N),
  member_joined: ch(true, N, N),
  account_verify_reminder: ch(false, A, N),
  workspace_deleted: ch(false, A, N),
  sheets_error: ch(true, A, N),
  webhook_disabled: ch(true, A, N),
  job_finished: ch(true, N, N),
  order_callback_due: ch(true, N, A),
  order_status_changed: ch(true, N, N),
  order_assigned: ch(true, N, A),
  conversation_assigned: ch(true, N, A),
  channel_approved: ch(true, A, N),
  product_approved: ch(true, N, N),
  product_rejected: ch(true, A, A),
  product_changes_requested: ch(true, A, N),
  moderation_appeal_result: ch(true, A, N),
  report_resolved: ch(true, A, N),
  customer_auto_blocked: ch(true, N, N),
  support_reply: ch(true, A, N),
  credits_pack_purchased: ch(true, A, N),
  credits_negative: ch(true, A, A),
  invoice_unpaid: ch(true, A, A),
  workspace_suspended: ch(true, A, A),
  workspace_reactivated: ch(true, A, A),
  workspace_deletion_scheduled: ch(true, A, N),
  account_deletion_confirmed: ch(false, A, N),
  member_role_changed: ch(true, A, N),
  agent_preset_update_available: ch(true, N, N),
  app_update_required: ch(false, N, A),
  app_update_recommended: ch(false, N, A),
  legal_reacceptance_required: ch(true, A, N),
  platform_announcement: ch(true, P, P),
  job_failed: ch(true, N, N),
};
/** Whether a channel fires for a type given the member's stored preference (absent row ⇒ default on). */
export const notificationChannelOn = (mode: NotificationChannelMode, preference: boolean | undefined) => mode === 'always' || (mode === 'pref' && preference !== false);

/** api-contract §3.12 `NotificationPreferenceDto` + the modes of the 03 §15 matrix (which cells the table may toggle). */
export type NotificationPreferenceView = {
  type: NotificationTypeName;
  group: NotificationGroup;
  inApp: boolean;
  email: boolean;
  push: boolean;
  sound: boolean;
  emailMode: NotificationChannelMode;
  pushMode: NotificationChannelMode;
};
/** `PUT /notification-preferences` — only the listed types change; `always` / `never` cells are ignored server-side. */
export const UpdateNotificationPreferencesSchema = z
  .object({
    preferences: z
      .array(z.object({ type: z.enum(NotificationTypeValues), email: z.boolean().optional(), push: z.boolean().optional(), sound: z.boolean().optional() }).strict())
      .min(1, 'validation.required')
      .max(NotificationTypeValues.length, 'validation.length'),
  })
  .strict();
export type UpdateNotificationPreferencesInput = z.infer<typeof UpdateNotificationPreferencesSchema>;

// --- read models (api-contract §3.3) ------------------------------------------------------------------------------------
export type InboxUserRef = { id: string; firstName: string; lastName: string; avatarUrl: string | null };
export type InboxAgentRef = { id: string; name: string; status: 'draft' | 'active' | 'paused' };
export type InboxClientRef = {
  id: string;
  name: string;
  phone: string | null;
  riskLevel: 'normal' | 'high';
  isPlaceholder: boolean;
  blocked: boolean;
  orderCount: number;
  avatarUrl: string | null;
};
export type ConversationStatusName = 'active' | 'needs_human' | 'resolved' | 'archived';
export type ConversationListItemView = {
  id: string;
  channel: ChannelRefView;
  client: InboxClientRef;
  status: ConversationStatusName;
  aiPaused: boolean;
  agent: InboxAgentRef | null;
  /** an agent is linked to the page of the conversation (pause / resume the AI need one: `CONVERSATION_NO_AGENT`) */
  pageHasAgent: boolean;
  assignee: InboxUserRef | null;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageDirection: 'in' | 'out';
  lastCustomerMessageAt: string | null;
  within24h: boolean;
  lastAiIntent: (typeof AiIntentValues)[number] | null;
  language: string | null;
  handoffReason: string | null;
  blocked: boolean;
  cart: { items: number; recapShownAt: string | null; orderId: string | null } | null;
  version: number;
};
/** Why the composer is (un)usable — computed by the server from the channel status and the 24 h window (04 §23). */
export type ComposerState = {
  canSend: boolean;
  /** `REPLY_CHANNEL_INACTIVE` | `REPLY_OUTSIDE_WINDOW` | `CUSTOMER_BLOCKED` | `READ_ONLY_MEMBER` | null */
  reasonCode: string | null;
  /** status of the channel when `reasonCode = REPLY_CHANNEL_INACTIVE` (drives the "Reconnecter" link) */
  channelStatus: string;
  within24h: boolean;
  /** true when the reply will leave with the Messenger `HUMAN_AGENT` tag (outside 24 h, Facebook) */
  humanAgentTag: boolean;
  windowEndsAt: string | null;
};
export type ConversationOrderRef = { id: string; number: string; status: string; total: number; orderedAt: string };
export type ConversationClientPanel = {
  client: (InboxClientRef & { tags: string[]; notes: string | null; totalSpent: number; lastOrderAt: string | null; mergedIntoId: string | null; defaultAddress: { wilayaId: number; communeText: string | null; address: string | null } | null }) | null;
  identity: { displayName: string | null; avatarUrl: string | null; externalSenderId: string };
  orders: ConversationOrderRef[];
  block: { id: string; reason: string | null; source: 'manual' | 'auto_rule' | 'platform'; blockedAt: string; unblockable: boolean } | null;
};
export type ConversationView = ConversationListItemView & {
  firstInboundAt: string | null;
  createdAt: string;
  deletedAt: string | null;
  notesCount: number;
  /** member who paused the AI (banner "IA en pause — mise en pause par …"); null when paused by the system or not paused */
  aiPausedBy: InboxUserRef | null;
  /** FL-01 F-4: the AI stopped on this thread because the credits / the conversation quota ran out (GLOBAL — Credits exhausted — thread state) */
  creditsExhausted?: boolean;
  /** FL-01 F-6: the AI could not answer (provider error); banner "IA indisponible" */
  aiUnavailable?: boolean;
  blockedAt: string | null;
  blockedBy: InboxUserRef | null;
  /** `platform` blocks cannot be lifted by the merchant (CUSTOMER_BLOCKED_BY_PLATFORM) */
  blockSource: 'manual' | 'auto_rule' | 'platform' | null;
  /** client this placeholder was merged into */
  mergedInto: { id: string; name: string } | null;
  composer: ComposerState;
  clientPanel: ConversationClientPanel;
  actions: ActionDescriptor[];
};
export type MessageTypeName = 'text' | 'image' | 'audio' | 'video' | 'file' | 'location' | 'sticker' | 'postback' | 'product_cards' | 'system';
export type MessageAttachmentView = {
  type: string;
  url: string;
  mime: string;
  size: number;
  name?: string;
  caption?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  lat?: number;
  lng?: number;
  /** true while the media is still on Meta's CDN (the `media` job has not stored it yet) */
  pending?: boolean;
  /** set when the download failed for good: the thread shows "média indisponible" */
  error?: string;
};
/** `price` … `priceMax`: the price range of a product with variants (lowest / highest active variant). */
export type MessageCardView = { productId: string; name: string; price: number; priceMax?: number; imageUrl: string | null; variants?: string };
export type MessagePayloadView = {
  cards?: MessageCardView[];
  postback?: string;
  quickReply?: string;
  quickReplies?: string[];
  /** shared position (`type = location`) */
  location?: { lat: number; lng: number; label?: string | null };
  /** Instagram story reply / mention */
  story?: { kind: 'reply' | 'mention'; url: string | null };
  /** message type Meta could not deliver to us (`is_unsupported`, template, …) */
  unsupported?: boolean;
  /** thread event, never sent to the customer (`type = system`) */
  system?: { kind: string; params: Record<string, unknown> };
  /** template message sent from the composer */
  templateKey?: string;
  /** Messenger tag the message left with, when any */
  tag?: 'HUMAN_AGENT' | 'POST_PURCHASE_UPDATE';
  /** true for messages imported by the history sync or echoed from the Page inbox */
  external?: boolean;
} | null;
export type MessageView = {
  id: string;
  conversationId: string;
  direction: 'in' | 'out';
  type: MessageTypeName;
  author: 'customer' | 'ai' | 'human' | 'system';
  authorUser: InboxUserRef | null;
  agent: InboxAgentRef | null;
  text: string | null;
  attachments: MessageAttachmentView[];
  transcript: string | null;
  transcriptStatus: 'pending' | 'done' | 'failed' | 'too_long' | null;
  payload: MessagePayloadView;
  sentAt: string;
  deliveryStatus: 'pending' | 'sent' | 'failed' | 'skipped_window';
  /** error-catalogue code (`REPLY_OUTSIDE_WINDOW`, `PAGE_TOKEN_EXPIRED`, `META_UNAVAILABLE`, …) or null */
  error: string | null;
  aiRunId: string | null;
  customerReaction: 'like' | 'dislike' | null;
  containsBlockedWord: boolean;
  /** thread markers: `blocked_word` (04 §13) */
  flags: string[];
};
export type ConversationNoteView = { id: string; body: string; author: InboxUserRef; createdAt: string };
/** Small conversation head carried by WS `message.created` and `conversation.updated` (03-events §2). */
export type ConversationHead = {
  id: string;
  status: ConversationStatusName;
  aiPaused: boolean;
  assigneeId: string | null;
  unreadCount: number;
  clientId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  version: number;
  blocked: boolean;
};
export type MessageCreatedEvent = { conversationId: string; message: MessageView; conversation: ConversationHead };
export type MessageUpdatedEvent = { conversationId: string; messageId: string; deliveryStatus: MessageView['deliveryStatus']; error?: string | null; transcript?: string | null; attachments?: MessageAttachmentView[]; customerReaction?: 'like' | 'dislike' | null };
export type ConversationUpdatedEvent = { conversation: ConversationHead };
export type ConversationDeletedEvent = { id: string };

// --- safety read models (api-contract §3.11) ------------------------------------------------------------------------------
export type CustomerBlockView = {
  id: string;
  client: InboxClientRef | null;
  phone: string | null;
  reason: (typeof BlockReasonValues)[number] | null;
  note: string | null;
  source: 'manual' | 'auto_rule' | 'platform';
  blockedBy: InboxUserRef | null;
  blockedAt: string;
  reportStatus: 'open' | 'reviewing' | 'actioned' | 'dismissed' | null;
  unblockable: boolean;
};
export type SafetyReportView = {
  id: string;
  type: 'conversation' | 'customer' | 'merchant' | 'ai_message' | 'product';
  reason: (typeof ReportReasonValues)[number];
  details: string | null;
  status: 'open' | 'reviewing' | 'actioned' | 'dismissed';
  decision: string | null;
  conversationId: string | null;
  clientId: string | null;
  messageId: string | null;
  productId: string | null;
  reporter: InboxUserRef | null;
  blockRequested: boolean;
  createdAt: string;
  resolvedAt: string | null;
};
/** `GET /data-deletion/:code` (public, MSG-08). */
export type DataDeletionStatusView = { code: string; status: 'pending' | 'done' | 'not_found'; requestedAt: string | null; completedAt: string | null };

/** 04 §23 — is a reply still possible in the standard window? Shared by the server presenter and the web banner. */
export const isWithin24h = (lastCustomerMessageAt: string | Date | null | undefined, now: Date = new Date()): boolean => {
  if (!lastCustomerMessageAt) return false;
  const t = typeof lastCustomerMessageAt === 'string' ? Date.parse(lastCustomerMessageAt) : lastCustomerMessageAt.getTime();
  return Number.isFinite(t) && now.getTime() - t < MESSAGING_WINDOW_HOURS * 3600_000;
};
