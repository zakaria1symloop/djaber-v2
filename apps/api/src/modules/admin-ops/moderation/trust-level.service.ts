// R-L / D52 (04 §12 "Trust levels", 03-events §4 `sched-trust-levels`): `new → standard` automatically (≥ 10 approved
// items incl. auto-approved and 0 rejected in 30 d), `any → watch` automatically (≥ 3 counterfeit rejections in 90 d; at 5
// the workspace is proposed for suspension in ADM-01, never suspended automatically), `standard → trusted` and
// `watch → standard` manual only (moderator, reason, audited). Automatic changes are audited with `actorType=system`.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { prisma, type TrustLevel, type Tx } from '@djaber/db';
import { AuditService } from '../../../core/audit/audit.service';
import { notFound } from '../../../core/errors/app.exception';
import { OutboxService } from '../../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../../core/queue/processor.registry';
import { auditAdmin, requireReason, sys, type PlatformActor } from '../admin-ops.util';
import { AdminNotifier } from '../../notifications/admin-notifier.service';

export const PROMOTE_MIN_APPROVED = 10;
export const WATCH_COUNTERFEIT = 3;
export const SUSPENSION_COUNTERFEIT = 5;
const DAY = 86400_000;

@Injectable()
export class TrustLevelService implements OnModuleInit {
  constructor(
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly registry: ProcessorRegistry,
    private readonly admins: AdminNotifier,
  ) {}

  onModuleInit() {
    this.registry.cron('sched-trust-levels', '45 3 * * *', () => this.sweep());
  }

  private counterfeit90d(workspaceId: string) {
    return prisma.moderationItem.count({ where: { workspaceId, decision: 'counterfeit', status: { in: ['rejected', 'appealed', 'appeal_rejected'] }, decidedAt: { gte: new Date(Date.now() - 90 * DAY) } } });
  }

  private async setLevel(tx: Tx | typeof prisma, workspaceId: string, from: TrustLevel, to: TrustLevel, by: PlatformActor | null, reason: string) {
    await tx.workspace.update({ where: { id: workspaceId }, data: { trustLevel: to, ...(by ? { trustSetById: by.userId } : {}) } });
    await this.outbox.ws(tx, `ws:${workspaceId}`, 'workspace.updated', { id: workspaceId, workspace: { trustLevel: to } });
    const entry = { action: 'workspace.trust_level', entity: 'Workspace', entityId: workspaceId, workspaceId, before: { trustLevel: from }, after: { trustLevel: to }, reason };
    if (by) await auditAdmin(this.audit, by, entry);
    else await this.audit.write({ ...entry, actorType: 'system' });
  }

  /** `new → standard` when ≥ 10 approved (incl. auto-approved) and 0 rejected in the last 30 days. */
  async evaluatePromotion(workspaceId: string) {
    return sys(async () => {
      const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { trustLevel: true } });
      if (!ws || ws.trustLevel !== 'new') return null;
      const since = new Date(Date.now() - 30 * DAY);
      const [approved, rejected] = await Promise.all([
        prisma.moderationItem.count({ where: { workspaceId, status: { in: ['approved', 'auto_approved'] }, decidedAt: { gte: since } } }),
        prisma.moderationItem.count({ where: { workspaceId, status: { in: ['rejected', 'appealed', 'appeal_rejected'] }, decidedAt: { gte: since } } }),
      ]);
      if (approved < PROMOTE_MIN_APPROVED || rejected > 0) return null;
      await this.setLevel(prisma, workspaceId, 'new', 'standard', null, `auto: ${approved} approved / 0 rejected in 30 d`);
      return 'standard' as const;
    });
  }

  /** `any → watch` at ≥ 3 counterfeit rejections in 90 days (every item then goes to human review). */
  async evaluateWatch(workspaceId: string) {
    return sys(async () => {
      const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { trustLevel: true } });
      if (!ws || ws.trustLevel === 'watch') return null;
      const n = await this.counterfeit90d(workspaceId);
      if (n < WATCH_COUNTERFEIT) return null;
      await this.setLevel(prisma, workspaceId, ws.trustLevel, 'watch', null, `auto: ${n} counterfeit rejections in 90 d`);
      await this.outbox.ws(prisma, 'admin:platform', 'platform.alert', { kind: 'trust_watch', payload: { workspaceId, counterfeit90d: n } }, `platform.alert:watch:${workspaceId}:${n}`);
      const shop = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
      await this.admins.notify(prisma, { kind: 'alert_trust_watch', key: `alert_trust_watch:${workspaceId}:${n}`, params: { workspace: shop?.name ?? '—', count: n }, ids: { workspaceId } });
      return 'watch' as const;
    });
  }

  /** ADM-01 "Suspension proposée": ≥ 5 counterfeit rejections in 90 days. */
  async suspensionProposed() {
    const rows = await sys(() =>
      prisma.$queryRaw<{ id: string; name: string; n: bigint }[]>`
        SELECT w."id", w."name", count(*) AS n FROM "ModerationItem" m JOIN "Workspace" w ON w."id" = m."workspaceId"
        WHERE m."decision" = 'counterfeit' AND m."status" IN ('rejected','appealed','appeal_rejected') AND m."decidedAt" >= now() - interval '90 days' AND w."status" <> 'suspended'
        GROUP BY w."id", w."name" HAVING count(*) >= ${SUSPENSION_COUNTERFEIT} ORDER BY n DESC LIMIT 50`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, counterfeit90d: Number(r.n) }));
  }

  /** `POST /admin/workspaces/:id/trust-level { trustLevel, reason }` — manual change by a moderator (audited with reason). */
  async change(workspaceId: string, trustLevel: TrustLevel, reason: string | undefined, actor: PlatformActor) {
    const r = requireReason(reason);
    return sys(async () => {
      const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null }, select: { id: true, trustLevel: true } });
      if (!ws) throw notFound();
      if (ws.trustLevel !== trustLevel) await this.setLevel(prisma, workspaceId, ws.trustLevel, trustLevel, actor, r);
      return { id: workspaceId, trustLevel };
    });
  }

  /** `sched-trust-levels` (03:45): promotions of `new` workspaces with recent approvals, watch for counterfeit repeaters. */
  async sweep() {
    return sys(async () => {
      const since30 = new Date(Date.now() - 30 * DAY);
      const candidates = await prisma.moderationItem.groupBy({ by: ['workspaceId'], where: { status: { in: ['approved', 'auto_approved'] }, decidedAt: { gte: since30 }, workspace: { trustLevel: 'new' } }, _count: { _all: true }, having: { workspaceId: { _count: { gte: PROMOTE_MIN_APPROVED } } } });
      let promoted = 0;
      for (const c of candidates) if (await this.evaluatePromotion(c.workspaceId)) promoted++;
      const repeaters = await prisma.moderationItem.groupBy({ by: ['workspaceId'], where: { decision: 'counterfeit', status: { in: ['rejected', 'appealed', 'appeal_rejected'] }, decidedAt: { gte: new Date(Date.now() - 90 * DAY) }, workspace: { trustLevel: { not: 'watch' } } }, _count: { _all: true }, having: { workspaceId: { _count: { gte: WATCH_COUNTERFEIT } } } });
      let watched = 0;
      for (const r of repeaters) if (await this.evaluateWatch(r.workspaceId)) watched++;
      return { promoted, watched };
    });
  }
}
