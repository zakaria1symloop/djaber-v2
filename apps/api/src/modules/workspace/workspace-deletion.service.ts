// FL-14 / 04 §16 / D31 — danger zone: `DELETE /workspace` schedules the deletion (status `deletion_scheduled`,
// `deletionScheduledAt = now + 30 d`), `POST /workspace/deletion/cancel` restores it, `sched-workspace-purge` purges at the date.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { prisma, TenantContext, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import { MailOutbox } from '../../core/mail/mail.outbox';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { ReauthService } from '../auth/reauth.service';
import type { ClientInfo } from '../auth/session.service';
import { AdminNotifier } from '../notifications/admin-notifier.service';
import { NotificationProducer } from '../notifications/notification.producer';

const DAY = 86_400_000;

@Injectable()
export class WorkspaceDeletionService implements OnModuleInit {
  private readonly log = new Logger(WorkspaceDeletionService.name);
  constructor(
    private readonly reauth: ReauthService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly mail: MailOutbox,
    private readonly tenants: TenantResolver,
    private readonly config: ConfigService,
    private readonly admins: AdminNotifier,
    private readonly registry: ProcessorRegistry,
    private readonly queue: QueueOutbox,
    private readonly notifications: NotificationProducer,
  ) {}

  onModuleInit() {
    // 03-events-and-jobs §4 `sched-workspace-purge` (01:00 Africa/Algiers)
    this.registry.cron('sched-workspace-purge', '0 1 * * *', () => this.purgeDue());
  }

  private async graceDays() {
    const s = await prisma.platformSetting.findUnique({ where: { key: 'limits' } });
    const d = (s?.value as { deletionGraceDays?: number } | null)?.deletionGraceDays;
    return Number.isInteger(d) && d! > 0 ? d! : 30;
  }

  /** `DELETE /workspace { password, confirmName }` (Owner) */
  async schedule(input: { password: string; confirmName: string }, client: ClientInfo) {
    const t = TenantContext.get();
    const ws = await prisma.workspace.findFirst({ where: { id: t.workspaceId, deletedAt: null } });
    if (!ws) throw notFound();
    if (input.confirmName.trim().toLowerCase() !== ws.name.trim().toLowerCase()) throw validationError({ confirmName: 'validation.invalid' });
    const owner = await this.reauth.assertPassword(t.userId!, input.password, 'AUTH_CURRENT_PASSWORD_INCORRECT');
    // 04 §14 "Debt guards" / AT-BIL-11: an unpaid invoice blocks the deletion until it is paid
    const unpaid = await prisma.invoice.findMany({ where: { status: 'unpaid' }, select: { id: true, amount: true } });
    if (unpaid.length) {
      const paid = await prisma.billingPayment.aggregate({ where: { invoiceId: { in: unpaid.map((i) => i.id) }, status: 'paid' }, _sum: { amount: true } });
      throw new AppException('WORKSPACE_HAS_DEBT', { amount: unpaid.reduce((n, i) => n + i.amount, 0) - (paid._sum.amount ?? 0) });
    }
    const at = new Date(Date.now() + (await this.graceDays()) * DAY);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.workspace.update({ where: { id: ws.id }, data: { status: 'deletion_scheduled', deletionScheduledAt: at } });
      // owner request 09/11: the Djaber team is told
      await this.admins.notify(tx as Tx, { kind: 'workspace_deletion', key: `workspace_deletion:${ws.id}:${at.toISOString().slice(0, 10)}`, params: { workspace: row.name, date: at.toISOString().slice(0, 10) }, ids: { workspaceId: ws.id } });
      // M1 carry-over (04 §16): the subscription is cancelled — no renewal / dunning during the grace period; undone by "cancel"
      await tx.subscription.updateMany({ where: { status: { in: ['active', 'dunning'] }, billingCycle: { not: 'none' }, cancelAtPeriodEnd: false }, data: { cancelAtPeriodEnd: true, cancelledAt: new Date(), cancelReason: 'workspace_deletion' } });
      await tx.invoice.updateMany({ where: { status: 'upcoming' }, data: { status: 'void' } });
      // channels are disconnected at once: nothing is received or answered any more (AI stops with them).
      // The pages are unsubscribed at Meta by the `channel-unsubscribe` job (Meta port), which then wipes the token.
      const connected = await tx.channel.findMany({ where: { status: { not: 'disconnected' } }, select: { id: true } });
      await tx.channel.updateMany({ where: { status: { not: 'disconnected' } }, data: { status: 'disconnected', pausedReason: null, webhookSubscribed: false } });
      await tx.agentChannel.deleteMany({ where: { channelId: { in: connected.map((c) => c.id) } } });
      for (const c of connected) {
        await this.queue.add(tx, 'jobs', 'channel-unsubscribe', { channelId: c.id, workspaceId: ws.id }, `chn-unsub:${c.id}:${at.getTime()}`, { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } });
      }
      await this.mail.send(
        {
          to: owner.email,
          template: 'workspace/deletion-scheduled',
          locale: owner.locale,
          params: { workspaceName: ws.name, at: at.toISOString(), url: `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}/settings/danger` },
          key: `ws-deletion-scheduled:${ws.id}:${at.getTime()}`,
          workspaceId: ws.id,
        },
        tx,
      );
      await this.outbox.ws(tx, `ws:${ws.id}`, 'workspace.updated', { id: ws.id, workspace: { status: row.status, stockMode: row.stockMode, locale: row.locale } });
      // 03-events §5.1 `workspace.deletion_scheduled`: in-app, to the Owner
      await this.notifications.emit(tx, {
        type: 'workspace_deletion_scheduled',
        workspaceId: ws.id,
        target: { owner: true },
        key: `workspace_deletion_scheduled:${ws.id}:${at.getTime()}`,
        data: { at: at.toISOString(), date: at.toISOString().slice(0, 10) },
      });
      return row;
    });
    await this.tenants.invalidate(ws.id);
    await this.audit.write({
      workspaceId: ws.id,
      actorType: 'user',
      actorId: t.userId,
      actorRole: t.role,
      action: 'workspace.deletion_scheduled',
      entity: 'Workspace',
      entityId: ws.id,
      before: { status: ws.status },
      after: { status: updated.status, deletionScheduledAt: at.toISOString() },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { id: ws.id, status: updated.status, deletionScheduledAt: at.toISOString() };
  }

  /** `POST /workspace/deletion/cancel` (Owner) — channels stay `disconnected` (reconnect needed). */
  async cancel(client: ClientInfo) {
    const t = TenantContext.get();
    const ws = await prisma.workspace.findFirst({ where: { id: t.workspaceId, deletedAt: null } });
    if (!ws) throw notFound();
    if (ws.status !== 'deletion_scheduled') throw conflict({ status: ws.status });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.workspace.update({ where: { id: ws.id }, data: { status: 'active', deletionScheduledAt: null } });
      await tx.subscription.updateMany({ where: { status: { in: ['active', 'dunning'] }, cancelReason: 'workspace_deletion' }, data: { cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null } });
      await this.outbox.ws(tx, `ws:${ws.id}`, 'workspace.updated', { id: ws.id, workspace: { status: row.status, stockMode: row.stockMode, locale: row.locale } });
      return row;
    });
    await this.tenants.invalidate(ws.id);
    await this.audit.write({
      workspaceId: ws.id,
      actorType: 'user',
      actorId: t.userId,
      actorRole: t.role,
      action: 'workspace.deletion_cancelled',
      entity: 'Workspace',
      entityId: ws.id,
      before: { status: ws.status, deletionScheduledAt: ws.deletionScheduledAt?.toISOString() ?? null },
      after: { status: updated.status },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { id: ws.id, status: updated.status, deletionScheduledAt: null };
  }

  /**
   * Scheduled purge (D31): one transaction per workspace; the rows of the workspace go with it (FK cascade).
   * Safe to run twice: a purged workspace no longer matches. Returns the number of purged workspaces.
   */
  async purgeDue(now = new Date()): Promise<number> {
    return TenantContext.runSystem(async () => {
      const due = await prisma.workspace.findMany({
        where: { status: 'deletion_scheduled', deletionScheduledAt: { lte: now } },
        select: { id: true, name: true },
      });
      let purged = 0;
      for (const ws of due) {
        try {
          // safety net: a page whose token is still stored was not unsubscribed yet (job lost or failed) — do it now,
          // through the Meta port, before the rows disappear
          const unsubscribe = this.registry.handlers.get('jobs')?.get('channel-unsubscribe');
          if (unsubscribe) {
            const left = await prisma.channel.findMany({ where: { workspaceId: ws.id, accessToken: { not: null } }, select: { id: true } });
            for (const c of left) await unsubscribe({ channelId: c.id, workspaceId: ws.id }, { attemptsMade: 0 } as never).catch((e) => this.log.warn({ channelId: c.id, err: String(e) }, 'unsubscribe at purge failed'));
          }
          await prisma.$transaction(async (tx) => {
            const owner = await tx.user.findFirst({ where: { ownedWorkspaceId: ws.id } });
            await tx.user.updateMany({ where: { ownedWorkspaceId: ws.id }, data: { ownedWorkspaceId: null } });
            await tx.user.updateMany({ where: { lastWorkspaceId: ws.id }, data: { lastWorkspaceId: null } });
            await tx.workspace.delete({ where: { id: ws.id } });
            if (owner && owner.status !== 'blocked' && !owner.deletedAt) {
              await this.mail.send(
                { to: owner.email, template: 'workspace/deleted', locale: owner.locale, params: { workspaceName: ws.name }, key: `ws-deleted:${ws.id}` },
                tx,
              );
            }
          });
          await this.tenants.invalidate(ws.id);
          await this.audit.write({ actorType: 'system', action: 'workspace.purged', entity: 'Workspace', entityId: ws.id, before: { name: ws.name } });
          purged++;
        } catch (e) {
          this.log.error({ workspaceId: ws.id, err: String(e) }, 'workspace purge failed');
        }
      }
      return purged;
    });
  }
}
