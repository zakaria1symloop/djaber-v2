// 03-events-and-jobs §5 — notification fan-out. Producers call `emit` inside their transaction (outbox, CLAUDE.md rule 4);
// the relay calls `deliver`, which writes one in-app `Notification` row per recipient, emits WS `notification.created`
// to `user:<id>` and then hands each row to the registered fan-out channels (e-mail, push — they plug in with
// `registerChannel`, the in-app row always exists first).
// Throttling (03 §5.1 "Throttle" column) is carried by the deduplication `key`: the producer puts the window in it
// (`stock_low:<productId>:<day>`, `conversation_needs_human_message:<conversationId>:<10-min bucket>`).
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { isAppLocale, type AppLocale } from '@djaber/shared';
import { prisma, TenantContext, type MembershipRole, type Notification, type NotificationType, type Tx } from '@djaber/db';
import { ConfigService } from '../../core/config/config.service';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { WsEmitter } from '../../core/ws/ws.emitter';
import { missingNotificationParams, notificationDeepLink, notificationGroup, notificationSlug, renderNotification } from './notification.catalog';

export { notificationSlug };

export type NotificationTarget = {
  userIds?: string[];
  /** every member holding one of these roles */
  roles?: MembershipRole[];
  owner?: true;
  all?: true;
  /** members never notified about their own action */
  exceptUserId?: string | null;
};
export type NotificationInput = {
  type: NotificationType;
  workspaceId: string;
  /** recipients; omitted (and no `target`) = every member of the workspace */
  userIds?: string[];
  target?: NotificationTarget;
  data: Record<string, unknown>;
  /** deduplication key: the throttle window of 03 §5.1 is part of it (e.g. `stock_low:<productId>:<day>`) */
  key: string;
  /**
   * journey 16/11 J05-15: a grouped notification (« Produits validés aujourd'hui : {count} »). Each event keeps its own `key`;
   * the first one of the `group` makes the rows, the next ones add their `data.productIds` to them and recount `count` (the
   * title said « 1 » after three products were validated the same day — the later events were dropped as duplicates).
   */
  group?: string;
};
/** The product ids of two events of one group, without duplicates (pure — notification.catalog.spec). */
export const mergeGroupIds = (a: unknown, b: unknown): string[] => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].filter((x): x is string => typeof x === 'string'))];
export type FanoutRecipient = { id: string; email: string; locale: AppLocale };
/** A delivery channel beyond the in-app row (e-mail, push): called once per notification row, after it is stored. */
export type NotificationChannel = {
  name: string;
  deliver(row: Notification, recipient: FanoutRecipient, rendered: { title: string; body: string; path: string }): Promise<void>;
};

@Injectable()
export class NotificationProducer implements OnModuleInit {
  private readonly log = new Logger(NotificationProducer.name);
  private readonly channels: NotificationChannel[] = [];
  constructor(
    private readonly outbox: OutboxService,
    private readonly registry: ProcessorRegistry,
    private readonly ws: WsEmitter,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.registry.onOutbox('notification', async (row) => {
      await this.deliver(row.payload as NotificationInput);
    });
    // outbound webhooks are delivered by `WebhookDispatchService` (integrations module, M11); this no-op only covers a
    // process built without that module
    if (!this.registry.outbox.has('webhook')) this.registry.onOutbox('webhook', async () => undefined);
  }

  /** E-mail / push fan-out plug in here (M5 preferences decide per user and type). */
  registerChannel(channel: NotificationChannel) {
    if (!this.channels.some((c) => c.name === channel.name)) this.channels.push(channel);
  }

  /** Inside the caller's transaction: at most one notification per `key`. */
  async emit(tx: Tx, n: NotificationInput) {
    // every placeholder of the type's texts must come with the event (notification.catalog.ts NOTIFICATION_PARAMS)
    const missing = missingNotificationParams(n.type, n.data);
    if (missing.length) {
      if (this.config.isTest) throw new Error(`notification ${n.type}: missing text parameters ${missing.join(', ')}`);
      this.log.warn({ type: n.type, missing }, 'notification emitted without all its text parameters');
    }
    await this.outbox.enqueue(tx, { topic: 'notification', key: n.key, workspaceId: n.workspaceId, payload: n });
  }

  private async recipients(n: NotificationInput): Promise<string[]> {
    const t = n.target ?? {};
    const explicit = n.userIds ?? t.userIds;
    let ids: string[];
    if (explicit) ids = explicit;
    else {
      const roles: MembershipRole[] | undefined = t.owner ? ['owner'] : t.roles;
      const members = await prisma.membership.findMany({ where: { workspaceId: n.workspaceId, ...(roles ? { role: { in: roles } } : {}) }, select: { userId: true } });
      ids = members.map((m) => m.userId);
    }
    return [...new Set(ids)].filter((id) => id && id !== t.exceptUserId);
  }

  /** Outbox handler (worker). Safe to run twice: rows are keyed by the outbox key stored in `data.key`. */
  async deliver(n: NotificationInput) {
    return TenantContext.runSystem(async () => {
      const recipients = await this.recipients(n);
      if (!recipients.length) return 0;
      const slug = notificationSlug(n.type);
      // a grouped event takes a lock on its group: two events of the same day never make two notifications
      const rows = await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        if (n.group) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${n.group}, 0))`;
        const already = await tx.notification.count({ where: { workspaceId: n.workspaceId, type: n.type, data: { path: ['key'], equals: n.key } } });
        if (already) return null;
        if (n.group) {
          const grouped = await tx.notification.findMany({ where: { workspaceId: n.workspaceId, type: n.type, data: { path: ['group'], equals: n.group } } });
          if (grouped.length) {
            // the group's rows are recounted in place (no second push / e-mail); running twice adds nothing
            for (const r of grouped) {
              const prev = (r.data ?? {}) as Record<string, unknown>;
              const productIds = mergeGroupIds(prev.productIds, n.data.productIds);
              const data = { ...prev, ...n.data, productIds: productIds.slice(0, 200), count: productIds.length, key: prev.key, group: n.group };
              const body = { ...((r.body ?? {}) as Record<string, unknown>), params: data };
              await tx.notification.update({ where: { id: r.id }, data: { data: data as object, body: body as object } });
            }
            return null;
          }
        }
        return tx.notification.createManyAndReturn({
          data: recipients.map((userId) => ({
            workspaceId: n.workspaceId,
            userId,
            type: n.type,
            title: { key: `notification.${slug}.title` },
            body: { key: `notification.${slug}.body`, params: n.data } as object,
            data: { ...n.data, key: n.key, ...(n.group ? { group: n.group } : {}) } as object,
          })),
        });
      });
      if (!rows) return 0;
      const users = await prisma.user.findMany({ where: { id: { in: recipients } }, select: { id: true, email: true, locale: true } });
      const byId = new Map(users.map((u) => [u.id, u]));
      const unread = await prisma.notification.groupBy({ by: ['userId'], where: { userId: { in: recipients }, workspaceId: n.workspaceId, readAt: null }, _count: { _all: true } });
      const unreadBy = new Map(unread.map((u) => [u.userId, u._count._all]));
      for (const r of rows) {
        const user = byId.get(r.userId!);
        const locale: AppLocale = isAppLocale(user?.locale) ? user!.locale : 'fr';
        const rendered = renderNotification(r.type, n.data, locale);
        const deepLink = notificationDeepLink(r.type, n.data);
        this.ws.emit(`user:${r.userId}`, 'notification.created', {
          notification: { id: r.id, type: r.type, group: notificationGroup(r.type), title: rendered.title, body: rendered.body, data: r.data, deepLink, readAt: null, createdAt: r.createdAt.toISOString() },
          unreadCount: unreadBy.get(r.userId) ?? 1,
        });
        if (!user) continue;
        for (const channel of this.channels) {
          await channel.deliver(r, { id: user.id, email: user.email, locale }, { ...rendered, path: deepLink.web }).catch((e) => this.log.error({ channel: channel.name, type: r.type, err: String(e) }, 'notification fan-out failed'));
        }
      }
      return rows.length;
    });
  }
}
