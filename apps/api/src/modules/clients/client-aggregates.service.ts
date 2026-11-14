// CLI-04 / ORD-12 / 04 §13 — client aggregates and risk, always recomputed from the rows (never incremented), plus the
// workspace auto-block rule (`autoBlockAfterUncollected`, OFF by default). Called by OrderEffects inside the order's
// transaction, by the merge, and nightly by `sched-risk-recompute`.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { autoBlockThreshold, completeSafetyRules, storedText, type SafetyRules } from '@djaber/shared';
import { prisma, TenantContext, type Tx } from '@djaber/db';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { conversationHead } from '../messaging/messaging.presenter';
import { NotificationProducer } from '../notifications/notification.producer';

const DAY = 86_400_000;
export type AggregateOrder = { status: string; total: number; orderedAt: Date; cancelledAt: Date | null; cancelReason: string | null; returnedUncollected: boolean };
export type AggregateSale = { total: number; soldAt: Date };
export type ClientAggregates = { orderCount: number; totalSpent: number; lastOrderAt: Date | null; returnCount: number; cancelCount: number; uncollectedCount: number; deliveredCount: number; autoRisk: 'normal' | 'high' };

/**
 * Pure (unit-tested):
 * - `orderCount` = orders not cancelled + completed counter sales; `totalSpent` = Σ delivered orders + Σ completed sales
 *   (CLI-04 "delivered orders + sales"); `lastOrderAt` = latest of those orders / sales;
 * - risk `high` when ≥ 3 orders cancelled in 30 d (ORD-12), ≥ `riskAfterReturns` returned in 90 d (04 §13), or a
 *   "faux numéro" cancellation in 90 d (04 §21); else `normal`.
 */
export const computeClientAggregates = (orders: AggregateOrder[], sales: AggregateSale[], rules: Pick<SafetyRules, 'riskAfterReturns'>, now: Date = new Date()): ClientAggregates => {
  const live = orders.filter((o) => o.status !== 'cancelled');
  const delivered = orders.filter((o) => o.status === 'delivered');
  const returned = orders.filter((o) => o.status === 'returned');
  const cancelled = orders.filter((o) => o.status === 'cancelled');
  const dates = [...live.map((o) => o.orderedAt.getTime()), ...sales.map((s) => s.soldAt.getTime())];
  const since30 = now.getTime() - 30 * DAY;
  const since90 = now.getTime() - 90 * DAY;
  const cancelled30 = cancelled.filter((o) => (o.cancelledAt ?? o.orderedAt).getTime() >= since30).length;
  const returned90 = returned.filter((o) => o.orderedAt.getTime() >= since90).length;
  const fake90 = cancelled.some((o) => o.cancelReason === 'fake' && (o.cancelledAt ?? o.orderedAt).getTime() >= since90);
  const threshold = Math.max(1, rules.riskAfterReturns ?? 2);
  return {
    orderCount: live.length + sales.length,
    totalSpent: delivered.reduce((n, o) => n + o.total, 0) + sales.reduce((n, s) => n + s.total, 0),
    lastOrderAt: dates.length ? new Date(Math.max(...dates)) : null,
    returnCount: returned.length,
    cancelCount: cancelled.length,
    uncollectedCount: returned.filter((o) => o.returnedUncollected).length,
    deliveredCount: delivered.length,
    autoRisk: cancelled30 >= 3 || returned90 >= threshold || fake90 ? 'high' : 'normal',
  };
};

@Injectable()
export class ClientAggregatesService implements OnModuleInit {
  private readonly log = new Logger(ClientAggregatesService.name);
  constructor(
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationProducer,
    private readonly registry: ProcessorRegistry,
  ) {}

  onModuleInit() {
    // 03-events §4 `sched-risk-recompute` 04:00: risk of every client with orders (rules move with time: 30 d / 90 d windows)
    this.registry.cron('sched-risk-recompute', '0 4 * * *', () => this.recomputeAll());
  }

  private async rules(tx: Tx): Promise<SafetyRules> {
    const ws = await tx.workspace.findUniqueOrThrow({ where: { id: TenantContext.workspaceId() }, select: { safetyRules: true } });
    return completeSafetyRules(ws.safetyRules);
  }

  /** Recomputes and stores the aggregates of one client (and of the client it was merged into). Returns the new values. */
  async recompute(tx: Tx, clientId: string): Promise<ClientAggregates | null> {
    const client = await tx.client.findFirst({ where: { id: clientId }, select: { id: true, name: true, phone: true, riskLevel: true, riskSetManually: true, deletedAt: true } });
    if (!client) return null;
    const [orders, sales, rules] = await Promise.all([
      tx.order.findMany({
        where: { clientId },
        select: { status: true, total: true, orderedAt: true, cancelledAt: true, cancelReason: true, shipments: { where: { status: 'returned' }, select: { failureReason: true } } },
      }),
      tx.sale.findMany({ where: { clientId, status: 'completed' }, select: { total: true, soldAt: true } }),
      this.rules(tx),
    ]);
    const agg = computeClientAggregates(
      orders.map((o) => ({ ...o, returnedUncollected: o.status === 'returned' && o.shipments.some((s) => s.failureReason === 'unreachable' || s.failureReason === 'refused') })),
      sales,
      rules,
    );
    const riskLevel = client.riskSetManually ? client.riskLevel : agg.autoRisk;
    await tx.client.update({
      where: { id: clientId },
      data: { orderCount: agg.orderCount, totalSpent: agg.totalSpent, lastOrderAt: agg.lastOrderAt, returnCount: agg.returnCount, cancelCount: agg.cancelCount, uncollectedCount: agg.uncollectedCount, riskLevel },
    });
    if (!client.deletedAt) await this.autoBlock(tx, { id: client.id, name: client.name, phone: client.phone }, agg.uncollectedCount, rules);
    return agg;
  }

  /**
   * 04 §13 auto-rule: ≥ N unclaimed parcels (returned with `failureReason ∈ unreachable|refused`) ⇒
   * `CustomerBlock(source=auto_rule, reason=uncollected)` + `customer.auto_blocked` to the Owner and Admins.
   * Only when the workspace turned the rule on; a client already blocked (or unblocked by a person) is left alone.
   */
  private async autoBlock(tx: Tx, client: { id: string; name: string; phone: string | null }, uncollected: number, rules: SafetyRules) {
    const threshold = autoBlockThreshold(rules);
    if (threshold === null || uncollected < threshold) return;
    const ws = TenantContext.workspaceId();
    const previous = await tx.customerBlock.findMany({ where: { OR: [{ clientId: client.id }, ...(client.phone ? [{ phone: client.phone }] : [])] }, select: { unblockedAt: true, source: true } });
    // already blocked, or an automatic block a person lifted (their decision stands)
    if (previous.some((b) => !b.unblockedAt || b.source === 'auto_rule')) return;
    const block = await tx.customerBlock.create({ data: { workspaceId: ws, clientId: client.id, phone: client.phone, reason: 'uncollected', source: 'auto_rule', note: storedText('stored.block.uncollected', { count: uncollected }) } });
    const conversations = await tx.conversation.findMany({ where: { clientId: client.id, deletedAt: null }, select: { id: true, status: true, aiPaused: true, assigneeId: true, unreadCount: true, clientId: true, lastMessageAt: true, lastMessagePreview: true, version: true } });
    for (const c of conversations) {
      await this.outbox.ws(tx, `ws:${ws}`, 'conversation.updated', { id: c.id, conversation: conversationHead(c, true) });
    }
    await this.outbox.enqueue(tx, { topic: 'webhook', key: `customer.blocked:${block.id}`, workspaceId: ws, payload: { event: 'customer.blocked', data: { blockId: block.id, clientId: client.id, phone: client.phone, source: 'auto_rule' } } });
    await this.notifications.emit(tx, {
      type: 'customer_auto_blocked',
      workspaceId: ws,
      target: { roles: ['owner', 'admin'] },
      data: { clientId: client.id, blockId: block.id, client: client.name, rule: 'autoBlockAfterUncollected', count: uncollected },
      key: `customer_auto_blocked:${block.id}`,
    });
  }

  /** `sched-risk-recompute`: every client with at least one order, workspace by workspace. */
  async recomputeAll() {
    const workspaces = await TenantContext.runSystem(() => prisma.order.findMany({ distinct: ['workspaceId'], select: { workspaceId: true } }));
    let n = 0;
    for (const { workspaceId } of workspaces) {
      await TenantContext.runAs(workspaceId, async () => {
        const clients = await prisma.client.findMany({ where: { deletedAt: null, orderCount: { gt: 0 } }, select: { id: true } });
        for (const c of clients) {
          try {
            await prisma.$transaction((tx) => this.recompute(tx as Tx, c.id));
            n++;
          } catch (e) {
            this.log.error({ clientId: c.id, err: String(e) }, 'risk recompute failed');
          }
        }
      });
    }
    return n;
  }
}
