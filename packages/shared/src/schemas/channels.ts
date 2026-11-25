// Channels (03 §3 CHN-01…12, api-contract §3.3, 06 "Channels" + §8.7 + §10 "Pages connectées").
// One source for the API (nestjs-zod DTOs) and the web. Field names = contract names. Messages = i18n keys.
import { z } from 'zod';
import { ChannelEventKindValues, ChannelPlatformValues, ChannelStatusValues } from '../enums';
import type { ActionDescriptor } from './common';

// --- limits (spec values) ---------------------------------------------------------------------------------------------
/** CHN-09: history sync imports at most 25 conversations × 25 messages. */
export const HISTORY_SYNC_MAX_CONVERSATIONS = 25;
export const HISTORY_SYNC_MAX_MESSAGES = 25;
/** api-contract §1.9: channel info sync 1 / 10 min / channel. */
export const CHANNEL_INFO_SYNC_COOLDOWN_S = 600;
/** OAuth `state` lifetime (CHN-01). */
export const OAUTH_STATE_TTL_S = 600;
/** `window.postMessage` type sent by the OAuth callback page to its opener (05-integrations §1.5). */
export const CONNECT_MESSAGE_TYPE = 'djaber:connect';

const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
/** Comma list or repeated param → array (api-contract §1.6 "multi-value"). */
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));
const flag = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');

// --- inputs -----------------------------------------------------------------------------------------------------------
/** `GET /channels` (06 §10 "Pages connectées"). */
export const ChannelsQuerySchema = z
  .object({
    platform: z.enum(ChannelPlatformValues).optional(),
    status: csv(z.enum(ChannelStatusValues)).optional(),
    agentId: id.optional(),
    noAgent: flag.optional(),
    pausedBy: z.enum(['manual', 'plan', 'moderation']).optional(),
    q: z.string().trim().max(120).optional(),
    sort: z.enum(['name', '-name', 'lastSeenAt', '-lastSeenAt', 'createdAt', '-createdAt']).optional(),
  })
  .strict();
export type ChannelsQuery = z.infer<typeof ChannelsQuerySchema>;

/**
 * `PATCH /channels/:id` — `paused` = manual pause, `active` = resume. At the plan limit the resume is refused with
 * `403 PLAN_LIMIT { resource: 'pages', limit, current }` unless `swapWithChannelId` names an active channel to pause in
 * the same transaction [FIG DLG "Réactiver et échanger"].
 */
export const UpdateChannelSchema = z.object({ status: z.enum(['active', 'paused']), swapWithChannelId: id.optional() }).strict();
export type UpdateChannelInput = z.infer<typeof UpdateChannelSchema>;
/** `POST /channels/:id/enable` (same swap rule as the resume). */
export const EnableChannelSchema = z.object({ swapWithChannelId: id.optional() }).strict();
/** `POST /channels/:id/sync` [FIG DLG "Synchroniser l'historique"]. */
export const SyncHistorySchema = z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)], { errorMap: () => ({ message: 'validation.invalid' }) }).default(30) }).strict();
export type SyncHistoryInput = z.infer<typeof SyncHistorySchema>;
/** `GET /channels/:id/messages?direction&from&to&cursor`. */
export const ChannelMessagesQuerySchema = z
  .object({
    direction: z.enum(['in', 'out']).optional(),
    from: day.optional(),
    to: day.optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();
export type ChannelMessagesQuery = z.infer<typeof ChannelMessagesQuerySchema>;
/** `GET /channels/:id/events?kind&from&to`. */
export const ChannelEventsQuerySchema = z
  .object({ kind: csv(z.enum(ChannelEventKindValues)).optional(), from: day.optional(), to: day.optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(50) })
  .strict();
export type ChannelEventsQuery = z.infer<typeof ChannelEventsQuerySchema>;

// --- read models (api-contract §3.3) ------------------------------------------------------------------------------------
export type ChannelPlatformName = 'facebook' | 'instagram';
export type ChannelStatusName = 'active' | 'paused' | 'pending_review' | 'needs_reconnect' | 'disabled' | 'disconnected';
export type ChannelRefView = { id: string; platform: ChannelPlatformName; name: string; avatarUrl: string | null; status: ChannelStatusName };
export type ChannelAgentRef = { id: string; name: string; status: 'draft' | 'active' | 'paused' };
export type ChannelUserRef = { id: string; firstName: string; lastName: string; avatarUrl: string | null };
export type ChannelCounts = { conversations: number; active: number; needsHuman: number; unread: number; messages7d: number; inbound7d: number; productsInScope: number };
export type ChannelHealth = {
  webhookSubscribed: boolean;
  tokenValid: boolean;
  tokenCheckedAt: string | null;
  tokenExpiresAt: string | null;
  permissions: Record<string, 'granted' | 'pending' | 'missing'>;
  lastInboundAt: string | null;
  lastSyncAt: string | null;
};
export type ChannelView = {
  id: string;
  platform: ChannelPlatformName;
  externalId: string;
  name: string;
  avatarUrl: string | null;
  followersCount: number | null;
  status: ChannelStatusName;
  pausedReason: 'manual' | 'plan' | 'moderation' | null;
  parentChannelId: string | null;
  agent: ChannelAgentRef | null;
  icebreaker: string | null;
  counts: ChannelCounts;
  health: ChannelHealth;
  connectedAt: string;
  connectedBy: ChannelUserRef;
  actions: ActionDescriptor[];
};
/** `GET /channels` → `{ data: ChannelView[], meta: { planLimit } }`. */
export type ChannelsListMeta = { planLimit: { limit: number; current: number } };
/** `GET /channels/connect/{facebook|instagram}`, `POST /channels/:id/reconnect` → the URL to open in the popup. */
export type ConnectUrlView = { url: string; expiresAt: string };

/** Per-page outcome of a connect (CHN-01, FL-05). `code` = a key of the error catalogue (11 §3) when not plainly connected. */
export type ConnectReportPageStatus = 'connected' | 'skipped' | 'warning' | 'pending_review';
export type ConnectReportCode =
  | 'PAGE_ACCESS_TOKEN_MISSING'
  | 'PAGE_MESSAGING_PERMISSION_MISSING'
  | 'PAGE_ALREADY_CONNECTED_ELSEWHERE'
  | 'PAGE_WEBHOOK_SUBSCRIBE_FAILED'
  | 'PAGE_INSTAGRAM_PENDING_APPROVAL'
  | 'PLAN_LIMIT'
  /** D63: the plan was lowered below the pages already connected (kept, none can be added) */
  | 'PLAN_LIMIT_GRANDFATHERED';
export type ConnectReportPage = {
  externalId: string;
  name: string;
  platform: ChannelPlatformName;
  avatarUrl: string | null;
  status: ConnectReportPageStatus;
  code: ConnectReportCode | null;
  channelId: string | null;
  /** true when the page was already connected to this workspace (token refreshed, no duplicate — FL-05 F-6) */
  reconnected: boolean;
  /**
   * client 25/11 (« la 3ème page ne se connecte pas »): with `PAGE_ALREADY_CONNECTED_ELSEWHERE`, the name of the shop that holds
   * the page — only when the person connecting is a member of that shop too (never the name of someone else's shop).
   */
  otherWorkspaceName?: string | null;
};
export type ConnectReport = {
  id: string;
  platform: ChannelPlatformName;
  /** `error` = nothing was stored (`OAUTH_CANCELLED`, `OAUTH_STATE_INVALID`, `AUTH_EMAIL_UNVERIFIED`, `META_UNAVAILABLE`, …) */
  outcome: 'ok' | 'error';
  error: { code: string; message: string } | null;
  pages: ConnectReportPage[];
  planLimit: { limit: number; current: number };
};
/** Payload of the `postMessage` sent to `window.opener` by the callback page. */
export type ConnectPostMessage = { type: typeof CONNECT_MESSAGE_TYPE; report: ConnectReport };

/** `GET /channels/:id/insights` (422 `INBOX_INSIGHTS_UNAVAILABLE` when Meta gives nothing). */
export type ChannelInsightsView = { fetchedAt: string; period: 'day'; metrics: { key: string; value: number | null }[] };
/** `GET /channels/:id/summary` — counts, linked agent, last sync (CHN-07). */
export type ChannelSummaryView = {
  counts: ChannelCounts;
  agent: (ChannelAgentRef & { productsInScope: number }) | null;
  health: ChannelHealth;
  children: ChannelRefView[];
  lastHistorySyncJobId: string | null;
  /** CHN-07 tile "Commandes IA (30 j)": orders created by the AI on this channel over the last 30 days (M5) */
  aiOrders30d: number;
  /** CHN-07 tile "Résolution IA" (M8): conversations of the page without a handoff ÷ conversations, last 30 days (pct, one decimal; null without conversations) */
  aiResolutionPct30d: number | null;
};
export type ChannelEventView = {
  id: string;
  kind: (typeof ChannelEventKindValues)[number];
  description: string | null;
  actorType: string;
  actor: ChannelUserRef | null;
  at: string;
};
/** `GET /channels/app-review-status` (CHN-11) and `GET /channels/:id/approval-status`. */
export type AppReviewStatusView = {
  /** true when every scope needed for Messenger + Instagram messaging is approved */
  approved: boolean;
  instagramApproved: boolean;
  humanAgentApproved: boolean;
  permissions: { scope: string; feature: string; status: 'not_requested' | 'in_review' | 'approved' | 'rejected'; submittedAt: string | null; decidedAt: string | null }[];
};
export type ChannelApprovalStatusView = { channelId: string; status: ChannelStatusName; pending: boolean; code: 'PAGE_INSTAGRAM_PENDING_APPROVAL' | null };
/** Result payload of the `history-sync` job (`GET /jobs/:id` → `result`). */
export type HistorySyncResult = { conversations: number; messagesImported: number; messagesSkipped: number };
