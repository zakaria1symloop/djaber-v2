// 03-events-and-jobs §5.1 / 03 §15 — per `NotificationType`: its family (filter chips of NTF-01) and its web deep link
// (the mobile link is `djaber://` + the same path). Titles and bodies are i18n keys rendered in the reader's locale.
import { Logger } from '@nestjs/common';
import { ERROR_MESSAGES, getMessages, type AppLocale, type NotificationGroup } from '@djaber/shared';
import type { NotificationType } from '@djaber/db';

/** `stock_low` → `stock.low`, `conversation_needs_human_message` → `conversation.needs_human_message` (00-build-order §0). */
export const notificationSlug = (type: string) => type.replace('_', '.');

const GROUP_BY_PREFIX: Record<string, NotificationGroup> = {
  order: 'orders',
  conversation: 'queue',
  agent: 'ai',
  ai: 'ai',
  stock: 'stock',
  shipment: 'parcels',
  payment: 'payments',
  channel: 'pages',
  credits: 'credits_plan',
  quota: 'credits_plan',
  subscription: 'credits_plan',
  invoice: 'credits_plan',
  member: 'members',
  sheets: 'integrations',
  webhook: 'integrations',
  job: 'jobs',
  product: 'moderation',
  moderation: 'moderation',
  report: 'safety',
  customer: 'safety',
  support: 'support',
  workspace: 'platform',
  account: 'platform',
  app: 'platform',
  legal: 'platform',
  platform: 'platform',
};
export const notificationGroup = (type: string): NotificationGroup => GROUP_BY_PREFIX[type.split('_')[0]!] ?? 'platform';
export const typesOfGroup = (group: string, all: readonly string[]) => all.filter((t) => notificationGroup(t) === group);

type Data = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
// a job opens the screen that started it, which reads `?job=` and shows its progress / result (`name` = job name of
// 03 §3: `order-import-*` vs `product-import-*`; `channelId` / `agentId` come from the job payload)
const JOB_PATH: Record<string, (d: Data) => string> = {
  import: (d) => (s(d.name).startsWith('order-import') ? `/orders/import?job=${s(d.jobId)}` : `/products/import?job=${s(d.jobId)}`),
  analysis: (d) => (s(d.channelId) ? `/channels/${s(d.channelId)}/analysis` : '/channels'),
  sync_history: (d) => (s(d.channelId) ? `/channels/${s(d.channelId)}/history` : '/channels'),
  bulk_send: (d) => `/delivery?job=${s(d.jobId)}`,
  tracking_refresh: (d) => `/delivery?job=${s(d.jobId)}`,
  labels: (d) => `/delivery?job=${s(d.jobId)}`,
  generation: (d) => `/agents/generate?job=${s(d.jobId)}`,
  faq_extraction: (d) => (s(d.agentId) ? `/agents/${s(d.agentId)}/configuration` : '/agents'),
};
/** Web path of a job (notifications `job_finished` / `job_failed`, Home queue "task" cards). */
export const jobPath = (d: Data) => (JOB_PATH[s(d.kind)] ?? ((x: Data) => `/reports?job=${s(x.jobId)}`))(d);
/** What `jobPath` reads from a job payload (job name, page, agent). */
export const jobRefs = (payload: unknown): { name?: string; channelId?: string; agentId?: string } => {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const out: { name?: string; channelId?: string; agentId?: string } = {};
  for (const k of ['name', 'channelId', 'agentId'] as const) if (typeof p[k] === 'string' && p[k]) out[k] = p[k] as string;
  return out;
};
/** A failed parcel: the delivery list filtered on its order (`ids`, api-contract §4 ShipmentsQuery) with its tracking panel open. */
export const parcelPath = (d: Data) => `/delivery?tab=all&ids=${s(d.orderId)}${s(d.shipmentId) ? `&sheet=${s(d.shipmentId)}` : ''}`;

const PATHS: Partial<Record<NotificationType, (d: Data) => string>> = {
  order_ai_created: (d) => `/orders/${s(d.orderId)}`,
  conversation_handoff: (d) => `/inbox/${s(d.conversationId)}`,
  conversation_needs_human_message: (d) => `/inbox/${s(d.conversationId)}`,
  conversation_handoff_unattended: (d) => `/inbox/${s(d.conversationId)}`,
  conversation_assigned: (d) => `/inbox/${s(d.conversationId)}`,
  agent_insight: (d) => `/agents/${s(d.agentId)}/insights`,
  ai_error: () => '/queue',
  stock_low: () => '/products?lowStock=1',
  stock_out: () => '/products?lowStock=1',
  shipment_created: (d) => `/orders/${s(d.orderId)}#delivery`,
  shipment_out_for_delivery: (d) => `/orders/${s(d.orderId)}#delivery`,
  shipment_delivered: (d) => `/orders/${s(d.orderId)}#delivery`,
  shipment_failed: parcelPath,
  shipment_returned: (d) => `/orders/${s(d.orderId)}#delivery`,
  payment_received: (d) => `/orders/${s(d.orderId)}#payment`,
  payment_failed: (d) => `/orders/${s(d.orderId)}#payment`,
  channel_needs_reconnect: (d) => `/channels/${s(d.channelId)}`,
  channel_approved: (d) => `/channels/${s(d.channelId)}`,
  channel_paused_by_plan: () => '/settings/billing',
  credits_80: () => '/settings/credits',
  credits_exhausted: () => '/settings/credits',
  credits_pack_purchased: () => '/settings/credits',
  credits_granted: () => '/settings/credits',
  credits_removed: () => '/settings/credits',
  subscription_trial_extended: () => '/settings/billing',
  credits_negative: () => '/settings/credits',
  quota_80: () => '/settings/billing',
  quota_100: () => '/settings/billing',
  subscription_expiring: () => '/settings/billing',
  subscription_expired: () => '/settings/billing',
  invoice_unpaid: () => '/settings/billing',
  member_invited: () => '/settings/members',
  member_joined: () => '/settings/members',
  member_role_changed: () => '/settings/members',
  sheets_error: () => '/settings/integrations/sheets',
  webhook_disabled: () => '/settings/integrations/webhooks',
  job_finished: jobPath,
  job_failed: jobPath,
  order_callback_due: (d) => `/orders/${s(d.orderId)}#calls`,
  order_status_changed: (d) => `/orders/${s(d.orderId)}`,
  order_assigned: (d) => `/orders/${s(d.orderId)}`,
  product_approved: (d) => (Array.isArray(d.productIds) && d.productIds.length === 1 ? `/products/${s(d.productIds[0])}` : '/products?moderationStatus=approved'),
  product_rejected: (d) => `/products/${s(d.productId)}`,
  product_changes_requested: (d) => `/products/${s(d.productId)}`,
  moderation_appeal_result: (d) => `/products/${s(d.productId)}`,
  report_resolved: () => '/settings/security',
  customer_auto_blocked: () => '/settings/security',
  support_reply: (d) => `/help/tickets/${s(d.ticketId)}`,
  workspace_suspended: () => '/home',
  workspace_reactivated: () => '/home',
  workspace_deletion_scheduled: () => '/settings/danger',
  agent_preset_update_available: (d) => `/agents/${s(d.agentId)}`,
  legal_reacceptance_required: (d) => `/legal/${s(d.key)}`,
  // the notifications page opens the announcement itself (tester report 2026-10-21 UX-005: `/notifications` alone went nowhere)
  platform_announcement: (d) => (d.cmsEntryId ? `/notifications?announcement=${s(d.cmsEntryId)}` : '/notifications'),
};

export const notificationDeepLink = (type: NotificationType, data: Data) => {
  const web = PATHS[type]?.(data) ?? '/notifications';
  return { web, mobile: `djaber://${web.replace(/^\//, '')}` };
};

/**
 * Text parameters every producer of a type puts in `data` — the placeholders of `notification.<slug>.title|body`
 * (deck.{fr,ar,en}.json). One entry per enum value (the compiler refuses a missing type); the catalogue spec renders
 * every type in every locale with exactly these keys and fails if a `{placeholder}` survives, and `NotificationProducer.emit`
 * checks them at emit time.
 */
export const NOTIFICATION_PARAMS: Record<NotificationType, readonly string[]> = {
  order_ai_created: ['number', 'total', 'agent', 'client', 'channel'],
  conversation_handoff: ['client', 'reason'],
  conversation_needs_human_message: ['client', 'preview'],
  conversation_handoff_unattended: ['minutes'],
  agent_insight: ['agent', 'type'],
  ai_error: ['failures'],
  stock_low: ['product', 'stock', 'min'],
  stock_out: ['product'],
  shipment_created: ['number', 'tracking'],
  shipment_out_for_delivery: ['number'],
  shipment_delivered: ['number'],
  shipment_failed: ['number', 'courier', 'reason'],
  shipment_returned: ['number'],
  payment_received: ['number'],
  payment_failed: ['number'],
  channel_needs_reconnect: ['page'],
  channel_paused_by_plan: ['page'],
  credits_80: ['used', 'limit'],
  credits_exhausted: [],
  quota_80: [],
  quota_100: [],
  subscription_expiring: ['date'],
  subscription_expired: [],
  member_invited: ['email'],
  member_joined: ['name', 'role'],
  account_verify_reminder: [],
  workspace_deleted: ['name'],
  sheets_error: [],
  webhook_disabled: [],
  job_finished: ['label'],
  order_callback_due: ['client', 'number'],
  order_status_changed: ['number', 'from', 'to'],
  order_assigned: ['number'],
  conversation_assigned: ['client'],
  channel_approved: ['page'],
  product_approved: ['count'],
  product_rejected: ['name'],
  product_changes_requested: ['name'],
  moderation_appeal_result: ['decision', 'name'],
  report_resolved: ['decision'],
  customer_auto_blocked: ['client', 'rule'],
  support_reply: ['ticket'],
  credits_pack_purchased: ['credits'],
  credits_granted: ['credits', 'reason'],
  credits_removed: ['credits', 'reason'],
  subscription_trial_extended: ['date'],
  credits_negative: [],
  invoice_unpaid: ['number', 'amount'],
  workspace_suspended: ['reason'],
  workspace_reactivated: [],
  workspace_deletion_scheduled: ['date'],
  account_deletion_confirmed: ['date'],
  member_role_changed: ['role'],
  agent_preset_update_available: ['agent'],
  app_update_required: ['minVersion'],
  app_update_recommended: ['version'],
  legal_reacceptance_required: [],
  platform_announcement: ['title'],
  job_failed: ['label'],
};

/** Template variants of a type: `job.finished.import` when an import job reports its counts. */
export const NOTIFICATION_VARIANTS: Partial<Record<NotificationType, { suffix: string; params: readonly string[]; when: (d: Data) => boolean }[]>> = {
  job_finished: [{ suffix: 'import', params: ['imported', 'skipped'], when: (d) => d.kind === 'import' && d.imported !== undefined && d.skipped !== undefined }],
};

/** Keys older rows used for the same value (rows written before the parameter names were aligned with the templates). */
const ALIASES: Record<string, string> = { product: 'name', min: 'minStock', label: 'name' };
const isText = (v: unknown): v is string | number => typeof v === 'string' || typeof v === 'number';
const valueOf = (data: Data, key: string): string | number | undefined => {
  const v = data[key];
  if (isText(v)) return v;
  const alias = ALIASES[key];
  return alias && isText(data[alias]) ? (data[alias] as string | number) : undefined;
};

/** Declared parameters a producer forgot (checked at emit time). */
export const missingNotificationParams = (type: NotificationType, data: Data): string[] => NOTIFICATION_PARAMS[type].filter((k) => valueOf(data, k) === undefined);

const log = new Logger('NotificationCatalog');
/** Role values are shown with their label, not the enum value. */
const ROLE_PARAMS = new Set(['role', 'from', 'to']);
/** M6: `shipment.failed` carries the reason code (`FailureReason` or `courier_unavailable`, 03-events §5.1): shown localized. */
const FAILURE_FALLBACK: Record<string, string> = { courier_unavailable: 'COURIER_UNAVAILABLE' };
const failureLabel = (value: string | number, messages: Record<string, string>, locale: AppLocale) => {
  const v = String(value);
  const code = FAILURE_FALLBACK[v];
  const label = messages[`enum.Shipment.failureReason.${v}`] ?? (code ? (ERROR_MESSAGES[locale]?.[code] ?? ERROR_MESSAGES.fr[code] ?? v).replace(/[.。]$/, '') : v);
  return label === label.toUpperCase() ? label.charAt(0) + label.slice(1).toLowerCase() : label;
};
const display = (type: string, key: string, value: string | number, messages: Record<string, string>, locale: AppLocale) =>
  type.startsWith('member_') && ROLE_PARAMS.has(key)
    ? (messages[`enum.Membership.role.${value}`] ?? String(value))
    : type === 'shipment_failed' && key === 'reason'
      ? failureLabel(value, messages, locale)
      : String(value);

/**
 * Title / body in the reader's locale. A type without a body key renders an empty body. A placeholder never reaches the
 * reader as `{name}`: a parameter missing at runtime renders as an empty string and is logged with the type.
 */
export const renderNotification = (type: string, data: Data, locale: AppLocale, onMissing: (type: string, param: string) => void = (t, p) => log.warn({ type: t, param: p }, 'notification parameter missing')) => {
  const messages = getMessages(locale);
  const variant = NOTIFICATION_VARIANTS[type as NotificationType]?.find((v) => v.when(data));
  const base = `notification.${notificationSlug(type)}`;
  const one = (suffix: 'title' | 'body') => {
    const template = (variant ? messages[`${base}.${variant.suffix}.${suffix}`] : undefined) ?? messages[`${base}.${suffix}`];
    if (!template) return suffix === 'title' ? notificationSlug(type) : '';
    return template
      .replace(/\{(\w+)[^{}]*\}/g, (_m, key: string) => {
        const v = valueOf(data, key);
        if (v === undefined) {
          onMissing(type, key);
          return '';
        }
        return display(type, key, v, messages, locale);
      })
      .replace(/\s{2,}/g, ' ')
      .trim();
  };
  return { title: one('title'), body: one('body') };
};
