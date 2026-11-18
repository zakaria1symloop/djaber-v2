// NTF-01 — the notification centre of the current user: list (cursor), unread count from the server, read / read-all.
// Rows belong to a user; inside a workspace the list shows that workspace's rows plus the account-level ones.
import { Injectable } from '@nestjs/common';
import { isAppLocale, NotificationTypeValues, type AppLocale, type NotificationGroup, type NotificationsQuery, type NotificationView } from '@djaber/shared';
import { prisma, TenantContext, type Notification, type NotificationType, type Prisma } from '@djaber/db';
import { notFound } from '../../core/errors/app.exception';
import type { CursorPage } from '../../core/http/pagination';
import { OutboxService } from '../../core/outbox/outbox.service';
import { algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { notificationDeepLink, notificationGroup, renderNotification, typesOfGroup } from './notification.catalog';

const encode = (createdAt: Date, id: string) => Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
const decode = (cursor?: string): [Date, string] | null => {
  if (!cursor) return null;
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
    const d = new Date(at);
    return Number.isNaN(d.getTime()) || typeof id !== 'string' ? null : [d, id];
  } catch {
    return null;
  }
};

@Injectable()
export class NotificationService {
  constructor(private readonly outbox: OutboxService) {}

  private scope(): Prisma.NotificationWhereInput {
    const t = TenantContext.get();
    // J13r-1: a read-only impersonation shows the shop owner's rows of this workspace — never the admin's own platform rows
    // (`workspaceId: null`) nor the owner's account-level ones
    if (t.impersonation) return { userId: t.impersonation.ownerUserId ?? '00000000-0000-0000-0000-000000000000', workspaceId: t.workspaceId };
    return { userId: t.userId!, OR: [{ workspaceId: t.workspaceId }, { workspaceId: null }] };
  }

  present(n: Notification, locale: AppLocale): NotificationView {
    const data = (n.data ?? {}) as Record<string, unknown>;
    const { title, body } = renderNotification(n.type, data, locale);
    return {
      id: n.id,
      type: n.type,
      group: notificationGroup(n.type),
      title,
      body,
      data,
      deepLink: notificationDeepLink(n.type, data),
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    };
  }

  async list(q: NotificationsQuery, locale: string): Promise<CursorPage<NotificationView>> {
    const l: AppLocale = isAppLocale(locale) ? locale : 'fr';
    const types = new Set<string>([...(q.types ?? []), ...(q.type ? [q.type] : []), ...(q.group ? typesOfGroup(q.group, NotificationTypeValues) : [])]);
    const and: Prisma.NotificationWhereInput[] = [this.scope()];
    if (q.types?.length || q.type || q.group) and.push({ type: { in: [...types] as NotificationType[] } });
    if (q.unread !== undefined) and.push({ readAt: q.unread ? null : { not: null } });
    if (q.from) and.push({ createdAt: { gte: algiersDayStart(q.from) } });
    if (q.to) and.push({ createdAt: { lt: algiersDayEnd(q.to) } });
    const c = decode(q.cursor);
    if (c) and.push({ OR: [{ createdAt: { lt: c[0] } }, { createdAt: c[0], id: { lt: c[1] } }] });
    const rows = await prisma.notification.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    const pageRows = rows.slice(0, q.limit);
    const last = pageRows[pageRows.length - 1];
    return { data: pageRows.map((n) => this.present(n, l)), nextCursor: rows.length > q.limit && last ? encode(last.createdAt, last.id) : null };
  }

  async unreadCount(): Promise<number> {
    return prisma.notification.count({ where: { AND: [this.scope(), { readAt: null }] } });
  }

  /** full-test 15/11 HOME-05 (12 §18 « family tabs with counts », AT-ST-04): unread notifications per family. */
  async unreadByGroup(): Promise<Partial<Record<NotificationGroup, number>>> {
    const rows = await prisma.notification.groupBy({ by: ['type'], where: { AND: [this.scope(), { readAt: null }] }, _count: { _all: true } });
    const out: Partial<Record<NotificationGroup, number>> = {};
    for (const r of rows) {
      const g = notificationGroup(r.type);
      out[g] = (out[g] ?? 0) + r._count._all;
    }
    return out;
  }

  async read(id: string) {
    const t = TenantContext.get();
    const row = await prisma.notification.findFirst({ where: { AND: [this.scope(), { id }] } });
    if (!row) throw notFound();
    const unreadCount = await prisma.$transaction(async (tx) => {
      if (!row.readAt) await tx.notification.update({ where: { id }, data: { readAt: new Date() } });
      const count = await tx.notification.count({ where: { AND: [this.scope(), { readAt: null }] } });
      // other tabs / devices of the same user
      await this.outbox.ws(tx, `user:${t.userId}`, 'notification.read', { ids: [id], unreadCount: count }, `notification.read:${id}`);
      return count;
    });
    return { id, readAt: (row.readAt ?? new Date()).toISOString(), unreadCount };
  }

  async readAll() {
    const t = TenantContext.get();
    const updated = await prisma.$transaction(async (tx) => {
      const r = await tx.notification.updateMany({ where: { AND: [this.scope(), { readAt: null }] }, data: { readAt: new Date() } });
      if (r.count) await this.outbox.ws(tx, `user:${t.userId}`, 'notification.read', { ids: 'all', unreadCount: 0 });
      return r.count;
    });
    return { updated, unreadCount: 0 };
  }
}
