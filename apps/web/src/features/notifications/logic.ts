// Notification centre rules (03 §15, 03-events §5.1, REF — Deep-link map). Pure functions.
import { NOTIFICATION_GROUPS, NotificationTypeValues, type NotificationGroup, type NotificationType } from '@djaber/shared';

/** Family of every `NotificationType` shown in the app (types that are e-mail / push only have none). */
export const TYPE_GROUP: Partial<Record<NotificationType, NotificationGroup>> = {
  order_ai_created: 'orders',
  order_callback_due: 'orders',
  order_status_changed: 'orders',
  order_assigned: 'orders',
  conversation_handoff: 'queue',
  conversation_needs_human_message: 'queue',
  conversation_handoff_unattended: 'queue',
  conversation_assigned: 'queue',
  agent_insight: 'ai',
  ai_error: 'ai',
  agent_preset_update_available: 'ai',
  stock_low: 'stock',
  stock_out: 'stock',
  shipment_created: 'parcels',
  shipment_out_for_delivery: 'parcels',
  shipment_delivered: 'parcels',
  shipment_failed: 'parcels',
  shipment_returned: 'parcels',
  payment_received: 'payments',
  payment_failed: 'payments',
  channel_needs_reconnect: 'pages',
  channel_paused_by_plan: 'pages',
  channel_approved: 'pages',
  credits_80: 'credits_plan',
  credits_exhausted: 'credits_plan',
  credits_pack_purchased: 'credits_plan',
  credits_granted: 'credits_plan',
  subscription_trial_extended: 'credits_plan',
  credits_negative: 'credits_plan',
  invoice_unpaid: 'credits_plan',
  quota_80: 'credits_plan',
  quota_100: 'credits_plan',
  subscription_expiring: 'credits_plan',
  subscription_expired: 'credits_plan',
  member_invited: 'members',
  member_joined: 'members',
  member_role_changed: 'members',
  sheets_error: 'integrations',
  webhook_disabled: 'integrations',
  job_finished: 'jobs',
  job_failed: 'jobs',
  product_approved: 'moderation',
  product_rejected: 'moderation',
  product_changes_requested: 'moderation',
  moderation_appeal_result: 'moderation',
  report_resolved: 'safety',
  customer_auto_blocked: 'safety',
  support_reply: 'support',
  workspace_suspended: 'platform',
  workspace_reactivated: 'platform',
  workspace_deletion_scheduled: 'platform',
  legal_reacceptance_required: 'platform',
  platform_announcement: 'platform',
};

/** Filter chips of NTF-01, in the order of the frame; the label keys are the `notification.filter.*` deck keys. */
export const FAMILY_CHIPS: readonly { group: NotificationGroup; labelKey: string }[] = [
  { group: 'orders', labelKey: 'notification.filter.aiOrders' },
  { group: 'queue', labelKey: 'notification.filter.needsHuman' },
  { group: 'ai', labelKey: 'notification.filter.aiIssues' },
  { group: 'stock', labelKey: 'notification.filter.stock' },
  { group: 'parcels', labelKey: 'notification.filter.shipments' },
  { group: 'payments', labelKey: 'notification.filter.payments' },
  { group: 'pages', labelKey: 'notification.filter.channels' },
  { group: 'credits_plan', labelKey: 'notification.filter.credits' },
  { group: 'members', labelKey: 'notification.filter.members' },
  { group: 'integrations', labelKey: 'notification.filter.integrations' },
  { group: 'jobs', labelKey: 'notification.filter.jobs' },
];

export const isNotificationType = (v: string): v is NotificationType => (NotificationTypeValues as readonly string[]).includes(v);
export const isNotificationGroup = (v: string): v is NotificationGroup => (NOTIFICATION_GROUPS as readonly string[]).includes(v);

/** In-app types of a family, in enum order (every in-app type when no family is given). */
export const typesOfGroup = (group: NotificationGroup | null): NotificationType[] => NotificationTypeValues.filter((t) => (group ? TYPE_GROUP[t] === group : TYPE_GROUP[t] !== undefined));
export const groupOfType = (type: string): NotificationGroup | null => (isNotificationType(type) ? (TYPE_GROUP[type] ?? null) : null);

/** `order_ai_created` → `order.ai_created` (only the first `_` becomes a dot — 06-i18n-copy-deck §2.10). */
export const typeSlug = (type: string): string => type.replace('_', '.');

/* ---------- filter ↔ URL (`?group=stock&unread=1&types=stock_low,stock_out`) ---------- */
export type NotificationFilter = { group: NotificationGroup | null; unread: boolean; types: NotificationType[] };
export const EMPTY_FILTER: NotificationFilter = { group: null, unread: false, types: [] };

export const parseFilter = (params: { get(name: string): string | null }): NotificationFilter => {
  const rawGroup = params.get('group') ?? '';
  const group = isNotificationGroup(rawGroup) ? rawGroup : null;
  const types = [...new Set((params.get('types') ?? '').split(',').map((s) => s.trim()))].filter(isNotificationType).filter((t) => TYPE_GROUP[t] !== undefined && (!group || TYPE_GROUP[t] === group));
  const unread = params.get('unread') === '1' || params.get('unread') === 'true';
  return { group, unread, types };
};

export const filterQueryString = (f: NotificationFilter): string => {
  const p = new URLSearchParams();
  if (f.group) p.set('group', f.group);
  if (f.unread) p.set('unread', '1');
  if (f.types.length) p.set('types', f.types.join(','));
  return p.toString();
};

export const isFiltered = (f: NotificationFilter) => f.group !== null || f.unread || f.types.length > 0;

/** Query of `GET /notifications`: explicit types win over the family (they are a subset of it). */
export const filterApiQuery = (f: NotificationFilter): { types?: string[]; group?: string; unread?: boolean } => ({
  types: f.types.length ? f.types : undefined,
  group: f.types.length ? undefined : (f.group ?? undefined),
  unread: f.unread || undefined,
});

/** Changing the family drops the type selection of the previous one. */
export const withGroup = (f: NotificationFilter, group: NotificationGroup | null): NotificationFilter => ({ ...f, group, types: [] });
export const toggleType = (f: NotificationFilter, type: NotificationType): NotificationFilter => ({ ...f, types: f.types.includes(type) ? f.types.filter((t) => t !== type) : [...f.types, type] });

/* ---------- deep links ---------- */
/**
 * `deepLink.web` (a route of 02-next-route-map, relative to `/{locale}`) → path for the locale-aware router.
 * Only same-origin absolute paths are followed; anything else (external URL, protocol-relative, `javascript:`,
 * back-slashes, `djaber://`) falls back to the notification list. Query and hash are kept (`/orders/:id#delivery`).
 */
export const notificationHref = (web: string | null | undefined, locale?: string): string => {
  const fallback = '/notifications';
  if (!web || typeof web !== 'string') return fallback;
  const raw = web.trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /\s/.test(raw) || [...raw].some((c) => c.charCodeAt(0) < 32)) return fallback;
  // a target already carrying the locale prefix is reduced to the route itself
  const m = /^\/(fr|ar|en)(?=\/|$|\?|#)/.exec(raw);
  const path = m ? raw.slice(m[0].length) || '/' : raw;
  if (path.startsWith('//')) return fallback;
  return locale ? `/${locale}${path === '/' ? '' : path}` : path;
};
