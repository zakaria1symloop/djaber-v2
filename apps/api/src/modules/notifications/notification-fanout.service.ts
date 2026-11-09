// NTF-02 / NTF-03 / 03-events §5 steps 3 — per-member preferences and the e-mail / push channels of the fan-out.
// The 03 §15 matrix (`NOTIFICATION_CHANNELS`, packages/shared) decides per type: ● always, `pref` = the member's
// `NotificationPreference` (default on), — never. E-mail: outbox `mail` → `email-send` (template `notification`).
// Push: `outbox / push-send` job per (notification, user) → FCM port, invalid tokens pruned.
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NOTIFICATION_CHANNELS, notificationChannelOn, NotificationTypeValues, type NotificationPreferenceView, type UpdateNotificationPreferencesInput } from '@djaber/shared';
import { prisma, TenantContext, type Notification, type NotificationType, type Tx } from '@djaber/db';
import { ConfigService } from '../../core/config/config.service';
import { notFound } from '../../core/errors/app.exception';
import { MailOutbox } from '../../core/mail/mail.outbox';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { notificationDeepLink, notificationGroup, renderNotification } from './notification.catalog';
import { NotificationProducer, type FanoutRecipient } from './notification.producer';
import { PUSH_GATEWAY, type PushGateway } from './push/push.gateway';

type PushJob = { workspaceId: string | null; userId: string; notificationId: string };

@Injectable()
export class NotificationFanoutService implements OnModuleInit {
  private readonly log = new Logger(NotificationFanoutService.name);
  constructor(
    private readonly producer: NotificationProducer,
    private readonly mail: MailOutbox,
    private readonly queue: QueueOutbox,
    private readonly registry: ProcessorRegistry,
    private readonly config: ConfigService,
    @Inject(PUSH_GATEWAY) private readonly push: PushGateway,
  ) {}

  onModuleInit() {
    this.producer.registerChannel({ name: 'email', deliver: (row, recipient, rendered) => this.email(row, recipient, rendered) });
    this.producer.registerChannel({ name: 'push', deliver: (row, recipient) => this.queuePush(row, recipient) });
    this.registry.register('outbox', 'push-send', (data: PushJob) => this.sendPush(data), { concurrency: 8 });
  }

  // --- preferences ------------------------------------------------------------------------------------------------------
  /** Stored preferences of a member (`membershipId`), keyed by type. */
  private async stored(workspaceId: string, userId: string) {
    const m = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { id: true, preferences: true } });
    return m ? { membershipId: m.id, byType: new Map(m.preferences.map((p) => [p.type, p])) } : null;
  }

  /** Whether `channel` fires for this member and type (matrix + preference). */
  async enabled(workspaceId: string | null, userId: string, type: NotificationType, channel: 'email' | 'push'): Promise<boolean> {
    const mode = NOTIFICATION_CHANNELS[type][channel];
    if (mode !== 'pref') return mode === 'always';
    if (!workspaceId) return true;
    const pref = await prisma.notificationPreference.findFirst({ where: { type, membership: { workspaceId, userId } }, select: { email: true, push: true } });
    return notificationChannelOn(mode, pref?.[channel]);
  }

  /** `GET /notification-preferences` — one row per `NotificationType` (the table groups them by family). */
  async list(): Promise<NotificationPreferenceView[]> {
    const t = TenantContext.get();
    const s = await this.stored(t.workspaceId, t.userId!);
    if (!s) throw notFound();
    // the super admin notifications (platform_admin) are not a member's to tune
    return NotificationTypeValues.filter((type) => type !== 'platform_admin').map((type) => {
      const c = NOTIFICATION_CHANNELS[type];
      const p = s.byType.get(type);
      return {
        type,
        group: notificationGroup(type),
        inApp: c.inApp,
        email: notificationChannelOn(c.email, p?.email),
        push: notificationChannelOn(c.push, p?.push),
        sound: p?.sound ?? false,
        emailMode: c.email,
        pushMode: c.push,
      };
    });
  }

  /** `PUT /notification-preferences` — only `pref` cells change (● / — are fixed by the matrix). */
  async update(input: UpdateNotificationPreferencesInput): Promise<NotificationPreferenceView[]> {
    const t = TenantContext.get();
    const s = await this.stored(t.workspaceId, t.userId!);
    if (!s) throw notFound();
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      for (const p of input.preferences) {
        const c = NOTIFICATION_CHANNELS[p.type];
        const prev = s.byType.get(p.type);
        const email = c.email === 'pref' && p.email !== undefined ? p.email : (prev?.email ?? true);
        const push = c.push === 'pref' && p.push !== undefined ? p.push : (prev?.push ?? true);
        const sound = p.sound ?? prev?.sound ?? false;
        await tx.notificationPreference.upsert({ where: { membershipId_type: { membershipId: s.membershipId, type: p.type } }, create: { membershipId: s.membershipId, type: p.type, email, push, sound }, update: { email, push, sound } });
      }
    });
    return this.list();
  }

  // --- channels ---------------------------------------------------------------------------------------------------------
  private async email(row: Notification, recipient: FanoutRecipient, rendered: { title: string; body: string; path: string }) {
    if (!(await this.enabled(row.workspaceId, recipient.id, row.type, 'email'))) return;
    const url = `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}/${recipient.locale}${rendered.path}`;
    await this.mail.send({ to: recipient.email, template: 'notification', locale: recipient.locale, params: { title: rendered.title, body: rendered.body, url, type: row.type }, key: `nf:${row.id}`, workspaceId: row.workspaceId });
  }

  private async queuePush(row: Notification, recipient: FanoutRecipient) {
    if (!(await this.enabled(row.workspaceId, recipient.id, row.type, 'push'))) return;
    if (!(await prisma.deviceToken.count({ where: { userId: recipient.id } }))) return;
    await this.queue.add(prisma as unknown as Tx, 'outbox', 'push-send', { workspaceId: row.workspaceId, userId: recipient.id, notificationId: row.id }, `push:${row.id}:${recipient.id}`, { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } });
  }

  /** Job `outbox / push-send` (03-events §3): one FCM message per device token; UNREGISTERED / INVALID_ARGUMENT ⇒ token deleted. */
  async sendPush(data: PushJob) {
    return TenantContext.runSystem(async () => {
      const n = await prisma.notification.findUnique({ where: { id: data.notificationId } });
      if (!n) return { sent: 0 };
      const [tokens, unread] = await Promise.all([
        prisma.deviceToken.findMany({ where: { userId: data.userId } }),
        prisma.notification.count({ where: { userId: data.userId, readAt: null, ...(n.workspaceId ? { workspaceId: n.workspaceId } : {}) } }),
      ]);
      const payload = (n.data ?? {}) as Record<string, unknown>;
      let sent = 0;
      let retry = false;
      for (const t of tokens) {
        const locale = t.locale === 'ar' || t.locale === 'en' ? t.locale : 'fr';
        const { title, body } = renderNotification(n.type, payload, locale);
        const r = await this.push.send({
          token: t.token,
          title,
          body,
          badge: unread,
          data: { type: n.type, notificationId: n.id, path: notificationDeepLink(n.type, payload).web, workspaceId: n.workspaceId ?? '', params: JSON.stringify(payload) },
        });
        if (r.ok) sent++;
        else if (r.error === 'UNREGISTERED' || r.error === 'INVALID_ARGUMENT') await prisma.deviceToken.deleteMany({ where: { id: t.id } });
        else retry = true;
      }
      if (retry && !sent) this.log.warn({ notificationId: n.id }, 'push not delivered, retried by the job');
      if (retry && !sent) throw new Error('push provider unavailable');
      return { sent };
    });
  }
}
