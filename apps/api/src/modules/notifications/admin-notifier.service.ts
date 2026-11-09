// Super admin notifications (owner request 09/11 « des notifications pour l'admin, pour tout, en temps réel »): every
// platform event a member of the Djaber team has to see or act on — a new shop, a payment, a product to review, an
// appeal, a report, a support ticket, a platform alert — becomes one `Notification(type = platform_admin)` per platform
// user allowed to act on it (no workspace; the event in `data.kind`, its link in `data.link`). Written in the caller's
// transaction, pushed live through the outbox (WS `admin.notification` on `user:<id>` — a distinct event, so a member's
// own notification count in the merchant app is never touched).
import { Injectable } from '@nestjs/common';
import { formatMessage, getMessages, isAppLocale, PLATFORM_PERMISSIONS, type AdminNotificationKind, type AdminNotificationView, type AppLocale, type PlatformPermission } from '@djaber/shared';
import { prisma, TenantContext, type Notification, type Tx } from '@djaber/db';
import { OutboxService } from '../../core/outbox/outbox.service';

type Ids = { workspaceId?: string | null; userId?: string; itemId?: string; appealId?: string; reportId?: string; ticketId?: string };
type Kind = { area: PlatformPermission; link: (ids: Ids, params: Record<string, string | number>) => string };
const ws = (ids: Ids) => (ids.workspaceId ? `/admin/workspaces?sheet=${ids.workspaceId}` : '/admin/workspaces');

/** Who is told (the platform roles holding `area`) and where the notification opens. */
export const ADMIN_NOTIFICATION_KINDS: Record<AdminNotificationKind, Kind> = {
  workspace_created: { area: 'admin.workspaces.impersonate', link: ws },
  workspace_deletion: { area: 'admin.workspaces.impersonate', link: ws },
  account_deletion: { area: 'admin.workspaces.impersonate', link: (i) => (i.userId ? `/admin/users?sheet=${i.userId}` : '/admin/users') },
  payment_received: { area: 'admin.billing.write', link: (_i, p) => `/admin/subscriptions?tab=${p.what === 'pack' ? 'packs' : 'invoices'}` },
  payment_failed: { area: 'admin.billing.write', link: () => '/admin/subscriptions?tab=invoices' },
  payment_mismatch: { area: 'admin.billing.write', link: () => '/admin/subscriptions?tab=invoices' },
  subscription_dunning: { area: 'admin.billing.write', link: () => '/admin/subscriptions?tab=invoices' },
  moderation_pending: { area: 'admin.moderation.write', link: (i) => (i.itemId ? `/admin/moderation?sheet=${i.itemId}` : '/admin/moderation') },
  moderation_pending_many: { area: 'admin.moderation.write', link: () => '/admin/moderation' },
  moderation_appeal: { area: 'admin.moderation.write', link: (i) => `/admin/moderation?tab=appeals${i.appealId ? `&sheet=${i.appealId}` : ''}` },
  report_opened: { area: 'admin.safety.write', link: (i) => (i.reportId ? `/admin/reports?sheet=${i.reportId}` : '/admin/reports') },
  ticket_opened: { area: 'admin.support.write', link: (i) => (i.ticketId ? `/admin/support?sheet=${i.ticketId}` : '/admin/support') },
  ticket_reply: { area: 'admin.support.write', link: (i) => (i.ticketId ? `/admin/support?sheet=${i.ticketId}` : '/admin/support') },
  alert_ai_errors: { area: 'admin.health.write', link: () => '/admin/ai' },
  alert_ai_key: { area: 'admin.health.write', link: () => '/admin/ai' },
  alert_sla: { area: 'admin.moderation.write', link: (_i, p) => (p.area === 'support' ? '/admin/support' : '/admin/moderation?tab=urgent') },
  alert_trust_watch: { area: 'admin.moderation.write', link: ws },
  alert_ai_reports: { area: 'admin.safety.write', link: () => '/admin/reports' },
  alert_incident: { area: 'admin.health.write', link: () => '/admin/health' },
};

/** Parameters shown with a label of their own (`adminNotif.label.<param>.<value>`), e.g. what was paid. */
const LABELLED = new Set(['what', 'area', 'reason', 'severity']);

/** Title and body of an admin notification in a language (a missing parameter renders empty, never `{name}`). */
export const renderAdminNotification = (kind: string, params: Record<string, unknown>, locale: AppLocale) => {
  const m = getMessages(locale);
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || typeof v === 'object') continue;
    values[k] = LABELLED.has(k) ? (m[`adminNotif.label.${k}.${String(v)}`] ?? String(v)) : String(v);
  }
  const text = (suffix: 'title' | 'body') => formatMessage(m[`adminNotif.${kind}.${suffix}`] ?? m[`notification.platform.admin.${suffix}`] ?? '', values).replace(/\{\w+\}/g, '').trim();
  return { title: text('title'), body: text('body') };
};

/** The view of one row in the reader's language. */
export const adminNotificationView = (r: Pick<Notification, 'id' | 'data' | 'readAt' | 'createdAt'>, locale: AppLocale): AdminNotificationView => {
  const data = (r.data ?? {}) as Record<string, unknown>;
  const kind = String(data.kind ?? '');
  return { id: r.id, kind: kind as AdminNotificationKind, ...renderAdminNotification(kind, data, locale), link: typeof data.link === 'string' ? data.link : '/admin', readAt: r.readAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() };
};

/** The rows of the platform notifications (never a merchant's). */
export const ADMIN_SCOPE = { type: 'platform_admin' as const, workspaceId: null };

@Injectable()
export class AdminNotifier {
  constructor(private readonly outbox: OutboxService) {}

  /**
   * Inside the caller's transaction (or on `prisma`): at most one notification per `key`. `params` are the texts' values
   * (shop name, amount, product…), `ids` what the link opens. Returns how many platform users were told.
   */
  async notify(db: Tx | typeof prisma, n: { kind: AdminNotificationKind; key: string; params?: Record<string, string | number>; ids?: Ids; area?: PlatformPermission }): Promise<number> {
    const def = ADMIN_NOTIFICATION_KINDS[n.kind];
    const params = n.params ?? {};
    return TenantContext.runSystem(async () => {
      const tx = db as Tx;
      if (await tx.notification.findFirst({ where: { ...ADMIN_SCOPE, data: { path: ['key'], equals: n.key } }, select: { id: true } })) return 0;
      const roles = PLATFORM_PERMISSIONS[n.area ?? def.area] as readonly string[];
      const admins = await tx.user.findMany({ where: { platformRole: { in: roles as never[] }, status: 'active', deletedAt: null }, select: { id: true, locale: true } });
      if (!admins.length) return 0;
      const ids = Object.fromEntries(Object.entries(n.ids ?? {}).filter(([, v]) => !!v)) as Ids;
      const data = { ...params, ...ids, kind: n.kind, key: n.key, link: def.link(ids, params) };
      const rows = await tx.notification.createManyAndReturn({
        data: admins.map((a) => ({ workspaceId: null, userId: a.id, type: 'platform_admin' as const, title: { key: `adminNotif.${n.kind}.title` }, body: { key: `adminNotif.${n.kind}.body`, params }, data })),
      });
      const unread = await tx.notification.groupBy({ by: ['userId'], where: { ...ADMIN_SCOPE, userId: { in: admins.map((a) => a.id) }, readAt: null }, _count: { _all: true } });
      const count = new Map(unread.map((u) => [u.userId, u._count._all]));
      for (const r of rows) {
        const admin = admins.find((a) => a.id === r.userId);
        const locale: AppLocale = isAppLocale(admin?.locale) ? admin!.locale : 'fr';
        await this.outbox.ws(tx, `user:${r.userId}`, 'admin.notification', { notification: adminNotificationView(r, locale), unreadCount: count.get(r.userId) ?? 1 }, `admin.notification:${n.key}:${r.userId}`);
      }
      return rows.length;
    });
  }
}
