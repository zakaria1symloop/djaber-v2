// 03-events-and-jobs §4 — the daily subscription jobs (Africa/Algiers):
//   `sched-subscription-expiry` (00:15): the 02 §5 single rule for trials at `trialEndsAt` and paid plans cancelled at
//      `currentPeriodEnd` (+ their J−7 `subscription.expiring` reminder, 03 §15), free subscriptions roll their 12 months.
//   `sched-dunning` (00:30), R-J, paid subscriptions with `cancelAtPeriodEnd=false`, idempotent per (subscription, stage):
//      J−7  renewal Invoice(upcoming) + `dunningStage=d_minus_7` + `subscription.expiring`
//      J0   invoice `unpaid`, `status=dunning`, `d0`, `invoice.unpaid` (link to "Payer maintenant"); paid limits kept
//      J+3  `d_plus_3`, `invoice.unpaid` again
//      J+7  `expired`, 02 §5 rule (free plan, pauses), `subscription.expired`; the invoice stays unpaid
//   Never touches `Workspace.status`, never suspends. Each subscription runs in its own transaction and tenant.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { formatMoney } from '@djaber/shared';
import { prisma, TenantContext, type Subscription, type Tx } from '@djaber/db';
import { ConfigService } from '../../core/config/config.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { algiersDay } from '../../core/time/algiers';
import { AdminNotifier } from '../notifications/admin-notifier.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { addMonths, DAY_MS, lockBilling } from './billing.util';
import { InvoiceService } from './invoice.service';
import { SubscriptionService } from './subscription.service';

@Injectable()
export class DunningService implements OnModuleInit {
  private readonly log = new Logger(DunningService.name);
  constructor(
    private readonly subs: SubscriptionService,
    private readonly invoices: InvoiceService,
    private readonly notifications: NotificationProducer,
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    private readonly config: ConfigService,
    private readonly admins: AdminNotifier,
  ) {}

  onModuleInit() {
    this.registry.cron('sched-subscription-expiry', '15 0 * * *', () => this.runExpiry());
    this.registry.cron('sched-dunning', '30 0 * * *', () => this.runDunning());
  }

  /** One subscription, re-read under the workspace billing lock, in its own transaction and tenant. */
  private async each(sub: Pick<Subscription, 'id' | 'workspaceId'>, fn: (tx: Tx, s: Subscription) => Promise<boolean>): Promise<boolean> {
    const tenant = await this.tenants.forWorker(sub.workspaceId).catch(() => null);
    if (!tenant) return false;
    try {
      const changed = await TenantContext.run(tenant, () =>
        prisma.$transaction(
          async (db) => {
            const tx = db as Tx;
            await lockBilling(tx, sub.workspaceId);
            const s = await tx.subscription.findFirst({ where: { id: sub.id } });
            return s ? fn(tx, s) : false;
          },
          { timeout: 30_000 },
        ),
      );
      if (changed) await this.tenants.invalidate(sub.workspaceId);
      return changed;
    } catch (e) {
      this.log.error({ subscriptionId: sub.id, err: String(e) }, 'subscription job failed for one subscription');
      return false;
    }
  }

  private payUrl(invoiceId: string) {
    return `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}/settings/billing?pay=${invoiceId}`;
  }

  /** `sched-subscription-expiry`. Returns the number of subscriptions changed. */
  async runExpiry(now = new Date()) {
    const in7 = new Date(now.getTime() + 7 * DAY_MS);
    const rows = await TenantContext.runSystem(() =>
      prisma.subscription.findMany({
        where: {
          OR: [
            { status: 'trial', trialEndsAt: { lte: in7 } },
            { status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: { lte: in7 } },
            { status: 'active', provider: 'none', billingCycle: 'none', currentPeriodEnd: { lte: now } },
          ],
          workspace: { deletedAt: null },
        },
        select: { id: true, workspaceId: true },
      }),
    );
    let n = 0;
    for (const r of rows) {
      const changed = await this.each(r, async (tx, s) => {
        if (s.status === 'trial' && s.trialEndsAt) {
          if (s.trialEndsAt <= now) {
            await this.subs.expire(tx, s, 'trial', now);
            return true;
          }
          await this.expiring(tx, s, `trial:${s.trialEndsAt.toISOString()}`, s.trialEndsAt, null);
          return false;
        }
        if (s.status === 'active' && s.cancelAtPeriodEnd) {
          if (s.currentPeriodEnd <= now) {
            await this.subs.expire(tx, s, 'cancelled', now);
            return true;
          }
          await this.expiring(tx, s, `cancel:${s.currentPeriodEnd.toISOString()}`, s.currentPeriodEnd, null);
          return false;
        }
        if (s.status === 'active' && s.provider === 'none' && s.billingCycle === 'none' && s.currentPeriodEnd <= now) {
          // free plan = 12 consecutive monthly periods, renewed on the same day of month (02 §6)
          await tx.subscription.update({ where: { id: s.id }, data: { currentPeriodStart: s.currentPeriodEnd, currentPeriodEnd: addMonths(s.currentPeriodEnd, 12) } });
          return true;
        }
        return false;
      });
      if (changed) n++;
    }
    return n;
  }

  private async expiring(tx: Tx, s: Subscription, keySuffix: string, at: Date, invoiceId: string | null) {
    await this.notifications.emit(tx, { type: 'subscription_expiring', workspaceId: s.workspaceId, target: { owner: true }, key: `subscription_expiring:${s.id}:${keySuffix}`, data: { periodEnd: at.toISOString(), date: algiersDay(at), invoiceId } });
  }

  /** `sched-dunning`. Returns the number of stage changes. */
  async runDunning(now = new Date()) {
    const in7 = new Date(now.getTime() + 7 * DAY_MS);
    const rows = await TenantContext.runSystem(() =>
      prisma.subscription.findMany({ where: { status: { in: ['active', 'dunning'] }, billingCycle: { not: 'none' }, provider: { not: 'none' }, cancelAtPeriodEnd: false, currentPeriodEnd: { lte: in7 }, workspace: { deletedAt: null } }, select: { id: true, workspaceId: true } }),
    );
    let n = 0;
    for (const r of rows) if (await this.each(r, (tx, s) => this.step(tx, s, now))) n++;
    return n;
  }

  /** Moves one paid subscription to the stage its dates call for (may cross several stages after a missed run). */
  async step(tx: Tx, s: Subscription, now: Date): Promise<boolean> {
    if (s.cancelAtPeriodEnd || s.billingCycle === 'none' || s.provider === 'none' || (s.status !== 'active' && s.status !== 'dunning')) return false;
    const end = s.currentPeriodEnd.getTime();
    const t = now.getTime();
    if (t < end - 7 * DAY_MS) return false;
    let changed = false;
    let inv = await tx.invoice.findFirst({ where: { subscriptionId: s.id, kind: 'subscription', status: { in: ['upcoming', 'unpaid'] } }, orderBy: { createdAt: 'desc' } });
    // J−7
    if (!s.dunningStage) {
      if (!inv) {
        const terms = await this.subs.renewalTerms(tx, s);
        inv = await this.invoices.create(tx, { workspaceId: s.workspaceId, kind: 'subscription', status: 'upcoming', amount: terms.amount, lines: terms.lines, subscriptionId: s.id, dueAt: s.currentPeriodEnd, dunningStage: 'd_minus_7' });
      }
      s = await tx.subscription.update({ where: { id: s.id }, data: { dunningStage: 'd_minus_7' } });
      await this.expiring(tx, s, `d_minus_7:${s.currentPeriodEnd.toISOString()}`, s.currentPeriodEnd, inv.id);
      changed = true;
    }
    if (!inv) return changed;
    // J0
    if (t >= end && s.dunningStage === 'd_minus_7') {
      inv = await tx.invoice.update({ where: { id: inv.id }, data: { status: 'unpaid', dunningStage: 'd0' } });
      s = await tx.subscription.update({ where: { id: s.id }, data: { status: 'dunning', dunningStage: 'd0' } });
      await this.unpaid(tx, s, inv.id, inv.number, inv.amount, 'd0');
      // owner request 09/11: the Djaber team is told of a renewal left unpaid
      const shop = await tx.workspace.findUnique({ where: { id: s.workspaceId }, select: { name: true } });
      await this.admins.notify(tx, { kind: 'subscription_dunning', key: `subscription_dunning:${inv.id}`, params: { workspace: shop?.name ?? '—', amount: formatMoney(inv.amount), number: inv.number }, ids: { workspaceId: s.workspaceId } });
      changed = true;
    }
    // J+3
    if (t >= end + 3 * DAY_MS && s.dunningStage === 'd0') {
      inv = await tx.invoice.update({ where: { id: inv.id }, data: { dunningStage: 'd_plus_3' } });
      s = await tx.subscription.update({ where: { id: s.id }, data: { dunningStage: 'd_plus_3' } });
      await this.unpaid(tx, s, inv.id, inv.number, inv.amount, 'd_plus_3');
      changed = true;
    }
    // J+7 — the invoice stays unpaid (payable later: renewal from it)
    if (t >= end + 7 * DAY_MS && (s.dunningStage === 'd0' || s.dunningStage === 'd_plus_3')) {
      await tx.invoice.update({ where: { id: inv.id }, data: { dunningStage: 'expired' } });
      await this.subs.expire(tx, s, 'dunning', now);
      return true;
    }
    if (changed) await this.subs.emitWorkspace(tx, s.workspaceId);
    return changed;
  }

  private async unpaid(tx: Tx, s: Subscription, invoiceId: string, number: string, amount: number, stage: 'd0' | 'd_plus_3') {
    await this.notifications.emit(tx, { type: 'invoice_unpaid', workspaceId: s.workspaceId, target: { owner: true }, key: `invoice_unpaid:${invoiceId}:${stage}`, data: { invoiceId, number, amount, dueAt: s.currentPeriodEnd.toISOString(), checkoutUrl: this.payUrl(invoiceId), stage } });
  }
}
