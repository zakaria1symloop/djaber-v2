// 02 §5 "Expiry / downgrade — single rule" + FL-09 F-4: when the plan that applies changes, the resources above its limits
// are paused (newest first) and those that fit again are restored (oldest first). Nothing is deleted:
//   pages   (top-level channels holding a slot: active | pending_review | needs_reconnect) beyond maxPages ⇒ `paused` +
//           `pausedReason=plan`; their linked Instagram accounts follow them; notification `channel.paused_by_plan`
//   agents  (`active` | manually `paused`) beyond maxAgents ⇒ the extra active ones `paused` + `pausedReason=plan`
//   members (owner first, then oldest) beyond maxMembers ⇒ `readOnly=true`
//   products stay visible; creation is blocked by the existing limit checks.
// Always inside the caller's transaction (the tenant context of the workspace); WS events and notifications go to the outbox.
import { Injectable } from '@nestjs/common';
import type { AgentUpdatedEvent, PausedResourceView, PlanUsageView } from '@djaber/shared';
import type { Plan, Tx } from '@djaber/db';
import { OutboxService } from '../../core/outbox/outbox.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { CONSUMPTION_ACTIONS } from '../credits/consumption';

const SLOT = ['active', 'pending_review', 'needs_reconnect'] as const;
type Limits = Pick<Plan, 'maxPages' | 'maxAgents' | 'maxMembers'>;
const keep = (limit: number, n: number) => (limit < 0 ? n : Math.max(0, limit));

@Injectable()
export class LimitService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationProducer,
  ) {}

  /** What `apply(plan)` would pause now (the "Changer de plan" dialog lists it before a downgrade). */
  async preview(tx: Tx, plan: Limits): Promise<PausedResourceView[]> {
    const out: PausedResourceView[] = [];
    const pages = await tx.channel.findMany({ where: { parentChannelId: null, status: { in: [...SLOT] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, name: true } });
    for (const c of pages.slice(keep(plan.maxPages, pages.length))) out.push({ type: 'channel', id: c.id, name: c.name });
    const agents = await tx.agent.findMany({ where: { deletedAt: null, status: { in: ['active', 'paused'] }, OR: [{ pausedReason: null }, { pausedReason: { not: 'plan' } }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, name: true, status: true } });
    for (const a of agents.slice(keep(plan.maxAgents, agents.length)).filter((a) => a.status === 'active')) out.push({ type: 'agent', id: a.id, name: a.name });
    const members = await this.membersInOrder(tx);
    for (const m of members.slice(keep(plan.maxMembers, members.length)).filter((m) => !m.readOnly)) out.push({ type: 'member', id: m.id, name: m.name });
    return out;
  }

  private async membersInOrder(tx: Tx) {
    const rows = await tx.membership.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { user: { select: { firstName: true, lastName: true, email: true } } } });
    // the Owner always keeps full access
    rows.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0));
    return rows.map((m) => ({ id: m.id, userId: m.userId, role: m.role, readOnly: m.readOnly, name: `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email }));
  }

  /** Resources currently paused / read-only because of the plan. */
  async paused(tx: Tx): Promise<PausedResourceView[]> {
    const [channels, agents, members] = await Promise.all([
      tx.channel.findMany({ where: { status: 'paused', pausedReason: 'plan', parentChannelId: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
      tx.agent.findMany({ where: { deletedAt: null, status: 'paused', pausedReason: 'plan' }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
      tx.membership.findMany({ where: { readOnly: true }, orderBy: { createdAt: 'asc' }, include: { user: { select: { firstName: true, lastName: true, email: true } } } }),
    ]);
    return [
      ...channels.map((c) => ({ type: 'channel' as const, id: c.id, name: c.name })),
      ...agents.map((a) => ({ type: 'agent' as const, id: a.id, name: a.name })),
      ...members.map((m) => ({ type: 'member' as const, id: m.id, name: `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email })),
    ];
  }

  /** PlanUsage counted from rows (never stored). */
  async usage(tx: Tx, periodStart: Date): Promise<PlanUsageView> {
    const [pages, agents, products, conversationsThisMonth, members, debits] = await Promise.all([
      tx.channel.count({ where: { parentChannelId: null, status: { in: [...SLOT] } } }),
      tx.agent.count({ where: { status: { in: ['active', 'paused'] }, deletedAt: null, OR: [{ pausedReason: null }, { pausedReason: { not: 'plan' } }] } }),
      tx.product.count({ where: { deletedAt: null } }),
      tx.conversation.count({ where: { lastCustomerMessageAt: { gte: periodStart } } }),
      tx.membership.count({ where: { readOnly: false } }),
      tx.creditLedger.aggregate({ where: { kind: 'debit', action: { in: CONSUMPTION_ACTIONS }, bucket: 'plan', periodStart }, _sum: { credits: true } }),
    ]);
    return { pages, agents, products, conversationsThisMonth, members, creditsUsed: Math.abs(debits._sum.credits ?? 0) };
  }

  /**
   * Applies the limits of `plan`: pauses what is above them (newest first), restores what fits (oldest first).
   * `key` makes the notifications of this change unique (subscription id). Returns what changed.
   */
  async apply(tx: Tx, workspaceId: string, plan: Limits, key: string): Promise<{ paused: PausedResourceView[]; restored: PausedResourceView[] }> {
    const paused: PausedResourceView[] = [];
    const restored: PausedResourceView[] = [];

    // --- pages -------------------------------------------------------------------------------------------------------------
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId} || ':pages-limit', 0))`;
    const live = await tx.channel.findMany({ where: { parentChannelId: null, status: { in: [...SLOT] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const fitPages = keep(plan.maxPages, live.length);
    for (const c of live.slice(fitPages)) {
      await this.setChannel(tx, c.id, workspaceId, { status: 'paused', pausedReason: 'plan' }, 'paused');
      await tx.channel.updateMany({ where: { parentChannelId: c.id, status: { in: [...SLOT] } }, data: { status: 'paused', pausedReason: 'plan' } });
      paused.push({ type: 'channel', id: c.id, name: c.name });
      await this.notifications.emit(tx, { type: 'channel_paused_by_plan', workspaceId, target: { owner: true }, key: `channel_paused_by_plan:${c.id}:${key}`, data: { channelId: c.id, page: c.name } });
    }
    if (plan.maxPages < 0 || live.length < plan.maxPages) {
      let free = plan.maxPages < 0 ? Number.POSITIVE_INFINITY : plan.maxPages - live.length;
      const waiting = await tx.channel.findMany({ where: { parentChannelId: null, status: 'paused', pausedReason: 'plan' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      for (const c of waiting) {
        if (free <= 0) break;
        await this.setChannel(tx, c.id, workspaceId, { status: 'active', pausedReason: null }, 'resumed');
        await tx.channel.updateMany({ where: { parentChannelId: c.id, status: 'paused', pausedReason: 'plan' }, data: { status: 'active', pausedReason: null } });
        restored.push({ type: 'channel', id: c.id, name: c.name });
        free--;
      }
    }

    // --- agents ------------------------------------------------------------------------------------------------------------
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId} || ':agents-limit', 0))`;
    const counted = await tx.agent.findMany({ where: { deletedAt: null, status: { in: ['active', 'paused'] }, OR: [{ pausedReason: null }, { pausedReason: { not: 'plan' } }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const fitAgents = keep(plan.maxAgents, counted.length);
    for (const a of counted.slice(fitAgents).filter((x) => x.status === 'active')) {
      const row = await tx.agent.update({ where: { id: a.id }, data: { status: 'paused', pausedReason: 'plan', version: { increment: 1 } } });
      await this.emitAgent(tx, row);
      paused.push({ type: 'agent', id: a.id, name: a.name });
    }
    const countedAfter = await tx.agent.count({ where: { deletedAt: null, status: { in: ['active', 'paused'] }, OR: [{ pausedReason: null }, { pausedReason: { not: 'plan' } }] } });
    if (plan.maxAgents < 0 || countedAfter < plan.maxAgents) {
      let free = plan.maxAgents < 0 ? Number.POSITIVE_INFINITY : plan.maxAgents - countedAfter;
      const waiting = await tx.agent.findMany({ where: { deletedAt: null, status: 'paused', pausedReason: 'plan' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      for (const a of waiting) {
        if (free <= 0) break;
        const row = await tx.agent.update({ where: { id: a.id }, data: { status: 'active', pausedReason: null, version: { increment: 1 } } });
        await this.emitAgent(tx, row);
        restored.push({ type: 'agent', id: a.id, name: a.name });
        free--;
      }
    }

    // --- members -----------------------------------------------------------------------------------------------------------
    const members = await this.membersInOrder(tx);
    const fitMembers = keep(plan.maxMembers, members.length);
    for (const [i, m] of members.entries()) {
      const shouldRead = i >= fitMembers;
      if (shouldRead === m.readOnly) continue;
      await tx.membership.update({ where: { id: m.id }, data: { readOnly: shouldRead } });
      await this.outbox.ws(tx, `ws:${workspaceId}`, 'member.updated', { id: m.id, membership: { userId: m.userId, role: m.role, readOnly: shouldRead } }, `member.updated:${m.id}:${key}:${shouldRead}`);
      (shouldRead ? paused : restored).push({ type: 'member', id: m.id, name: m.name });
    }
    return { paused, restored };
  }

  private async setChannel(tx: Tx, id: string, workspaceId: string, data: { status: 'paused' | 'active'; pausedReason: 'plan' | null }, kind: 'paused' | 'resumed') {
    const c = await tx.channel.update({ where: { id }, data });
    const link = await tx.agentChannel.findUnique({ where: { channelId: id }, select: { agentId: true } });
    await this.outbox.ws(tx, `ws:${workspaceId}`, 'channel.updated', { id, channel: { id, status: c.status, pausedReason: c.pausedReason, agentId: link?.agentId ?? null, lastSeenAt: c.lastSeenAt?.toISOString() ?? null } }, `channel.updated:${id}:plan:${kind}:${Date.now()}`);
  }

  private async emitAgent(tx: Tx, a: { id: string; workspaceId: string; status: 'draft' | 'active' | 'paused'; pausedReason: 'manual' | 'plan' | 'moderation' | null; version: number }) {
    const pendingInsights = await tx.agentInsight.count({ where: { agentId: a.id, status: 'pending' } });
    const payload: AgentUpdatedEvent = { id: a.id, agent: { id: a.id, status: a.status, pausedReason: a.pausedReason === 'moderation' ? 'manual' : a.pausedReason, pendingInsights, version: a.version } };
    await this.outbox.ws(tx, `ws:${a.workspaceId}`, 'agent.updated', payload as unknown as Record<string, unknown>, `agent.updated:${a.id}:${a.version}`);
  }
}
