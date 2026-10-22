// ADM-04 plans editor (versions, impact, archive, migrate, delete — D63), ADM-05 subscriptions & invoices & manual payments
// list, ADM-15 credit packs & promo codes (D40, D57). `mark-paid` and credit grants are the M9 `AdminBillingService`.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  ActionDescriptor,
  AdminCreatePackInput,
  AdminCreatePlanInput,
  AdminCreatePromoInput,
  AdminCreateSubscriptionInput,
  AdminDiscountInput,
  AdminInvoiceRowDto,
  AdminInvoicesQuery,
  AdminMigratePlanInput,
  AdminPackPurchaseRowDto,
  AdminPacksKpis,
  AdminPatchSubscriptionInput,
  AdminPaymentRowDto,
  AdminSubscriptionKpis,
  AdminSubscriptionRowDto,
  AdminSubscriptionsQuery,
  AdminUpdatePackInput,
  AdminUpdatePlanInput,
  AdminUpdatePromoInput,
  CreditPackAdminDto,
  CreditPricingDto,
  PlanAdminDto,
  PlanImpactDto,
  PlanUpdateResultDto,
  PlanVersionDto,
  PromoCodeDto,
  PromoRedemptionRowDto,
} from '@djaber/shared';
import { Prisma, prisma, TenantContext, type CreditPack, type Plan, type PromoCode, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { canPlatform } from '../../core/rbac/permission-matrix';
import { StorageService } from '../../core/storage/storage.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { CURRENT_STATUSES, addCycle, isPaid, lockBilling, priceOf } from '../billing/billing.util';
import { InvoiceService } from '../billing/invoice.service';
import { LimitService } from '../billing/limit.service';
import { PackService } from '../billing/pack.service';
import { PlanService } from '../billing/plan.service';
import { SubscriptionService } from '../billing/subscription.service';
import { CreditService } from '../credits/credit.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { DAY, assertUuid, fromLocalized, adminLocale, iso, pickLocal, requireReason, toLocalized, userRef, userSelect, type AdminActor } from './admin.util';

const LIMIT_KEYS = ['maxPages', 'maxAgents', 'maxProducts', 'maxConversationsPerMonth', 'maxMembers', 'maxApiKeys', 'maxWebhooks', 'monthlyCredits'] as const;
const PLAN_SNAPSHOT_KEYS = ['name', 'description', 'priceMonthly', 'priceYearly', 'trialDays', ...LIMIT_KEYS, 'syncHistoryDays', 'features', 'isVisible', 'isFeatured', 'sortOrder'] as const;
/** D63: a price change applies at the next renewal, with an information e-mail 30 days before. */
const PRICE_NOTICE_DAYS = 30;

@Injectable()
export class AdminBillingCatalogService {
  constructor(
    private readonly audit: AuditService,
    private readonly tenants: TenantResolver,
    private readonly plans: PlanService,
    private readonly packs: PackService,
    private readonly invoices: InvoiceService,
    private readonly subs: SubscriptionService,
    private readonly limits: LimitService,
    private readonly credits: CreditService,
    private readonly notifications: NotificationProducer,
    private readonly storage: StorageService,
  ) {}

  private async log(actor: AdminActor, action: string, entity: string, entityId: string | null, before: unknown, after: unknown, reason: string | null, workspaceId: string | null = null) {
    await this.audit.write({ workspaceId, actorType: 'admin', actorId: actor.userId, actorRole: actor.platformRole, action, entity, entityId, before, after, reason, ip: actor.ip, userAgent: actor.userAgent });
  }
  private can(actor: AdminActor) {
    return canPlatform(actor.platformRole, 'admin.billing.write');
  }
  private act(actor: AdminActor, key: string, ok = true, reasonCode = 'CONFLICT'): ActionDescriptor {
    const perm = this.can(actor);
    return perm && ok ? { key, enabled: true } : { key, enabled: false, reasonCode: perm ? reasonCode : 'FORBIDDEN' };
  }

  // =========================================================================================================================
  // plans
  // =========================================================================================================================
  private async subscriberCounts(): Promise<Map<string, number>> {
    const rows = await prisma.subscription.groupBy({ by: ['planId'], where: { status: { in: [...CURRENT_STATUSES] } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.planId, r._count._all]));
  }

  private planDto(p: Plan, subscribers: number, actor: AdminActor): PlanAdminDto {
    return {
      ...this.plans.toDto(p, adminLocale()),
      nameI18n: fromLocalized(p.name),
      descriptionI18n: fromLocalized(p.description),
      version: p.version,
      isActive: p.isActive,
      isVisible: p.isVisible,
      archivedAt: iso(p.archivedAt),
      subscribers,
      maxApiKeys: p.maxApiKeys,
      maxWebhooks: p.maxWebhooks,
      syncHistoryDays: p.syncHistoryDays,
      features: p.features,
      sortOrder: p.sortOrder,
      actions: [
        this.act(actor, 'edit', !p.archivedAt, 'PRESET_ARCHIVED'),
        this.act(actor, 'duplicate'),
        p.archivedAt ? this.act(actor, 'restore') : this.act(actor, 'archive', p.slug !== 'free', 'CONFLICT'),
        this.act(actor, 'migrate', subscribers > 0, 'CONFLICT'),
        this.act(actor, 'delete', subscribers === 0 && p.slug !== 'free', subscribers > 0 ? 'PLAN_IN_USE' : 'CONFLICT'),
      ],
    };
  }

  async listPlans(actor: AdminActor): Promise<PlanAdminDto[]> {
    const [rows, counts] = await Promise.all([prisma.plan.findMany({ orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { sortOrder: 'asc' }, { priceMonthly: 'asc' }] }), this.subscriberCounts()]);
    return rows.map((p) => this.planDto(p, counts.get(p.id) ?? 0, actor));
  }

  private async planOr404(id: string) {
    assertUuid(id);
    const p = await prisma.plan.findUnique({ where: { id } });
    if (!p) throw new AppException('PLAN_NOT_FOUND');
    return p;
  }

  async getPlan(id: string, actor: AdminActor) {
    const p = await this.planOr404(id);
    return this.planDto(p, (await this.subscriberCounts()).get(p.id) ?? 0, actor);
  }

  private snapshot(p: Plan) {
    return Object.fromEntries(PLAN_SNAPSHOT_KEYS.map((k) => [k, (p as Record<string, unknown>)[k]]));
  }

  async createPlan(input: AdminCreatePlanInput, actor: AdminActor) {
    if (!LIMIT_KEYS.some((k) => ((input as Record<string, unknown>)[k] as number | undefined) !== undefined && ((input as Record<string, unknown>)[k] as number) !== 0)) {
      throw new AppException('VALIDATION_ERROR', {}, { maxPages: 'validation.range' });
    }
    if (await prisma.plan.findUnique({ where: { slug: input.slug } })) throw new AppException('PLAN_SLUG_TAKEN', {}, { slug: 'validation.taken' });
    const p = await prisma.$transaction(async (db) => {
      const row = await db.plan.create({
        data: {
          slug: input.slug,
          name: toLocalized(input.name)!,
          description: toLocalized(input.description) ?? { fr: '', ar: '', en: '' },
          priceMonthly: input.priceMonthly,
          priceYearly: input.priceYearly,
          trialDays: input.trialDays ?? 14,
          maxPages: input.maxPages,
          maxAgents: input.maxAgents,
          maxProducts: input.maxProducts,
          maxConversationsPerMonth: input.maxConversationsPerMonth,
          maxMembers: input.maxMembers,
          maxApiKeys: input.maxApiKeys ?? 0,
          maxWebhooks: input.maxWebhooks ?? 0,
          syncHistoryDays: input.syncHistoryDays ?? 30,
          monthlyCredits: input.monthlyCredits,
          features: input.features ?? [],
          isVisible: input.isVisible ?? true,
          isFeatured: input.isFeatured ?? false,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await db.planVersion.create({ data: { planId: row.id, version: 1, snapshot: this.snapshot(row) as Prisma.InputJsonValue, changedById: actor.userId } });
      return row;
    });
    await this.log(actor, 'plan.create', 'Plan', p.id, null, this.snapshot(p), input.reason?.trim() || null);
    return this.planDto(p, 0, actor);
  }

  /** Impact of an edit (D63): subscribers, workspaces over a lowered limit (grandfathered), price notice date. */
  private async impact(p: Plan, next: Record<string, unknown>): Promise<PlanImpactDto> {
    const subs = await prisma.subscription.findMany({ where: { planId: p.id, status: { in: [...CURRENT_STATUSES] } }, select: { workspaceId: true } });
    const ids = subs.map((s) => s.workspaceId);
    const overLimit: PlanImpactDto['overLimit'] = [];
    const lowered = (k: (typeof LIMIT_KEYS)[number]) => {
      const n = next[k] as number | undefined;
      const cur = p[k];
      return n !== undefined && n >= 0 && (cur < 0 || n < cur) ? n : null;
    };
    if (ids.length) {
      const counters: [string, (typeof LIMIT_KEYS)[number], () => Promise<{ workspaceId: string; n: number }[]>][] = [
        ['pages', 'maxPages', async () => (await prisma.channel.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, status: { notIn: ['disconnected'] }, parentChannelId: null }, _count: { _all: true } })).map((r) => ({ workspaceId: r.workspaceId, n: r._count._all }))],
        ['agents', 'maxAgents', async () => (await prisma.agent.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, status: { in: ['active', 'paused'] }, deletedAt: null }, _count: { _all: true } })).map((r) => ({ workspaceId: r.workspaceId, n: r._count._all }))],
        ['products', 'maxProducts', async () => (await prisma.product.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, deletedAt: null }, _count: { _all: true } })).map((r) => ({ workspaceId: r.workspaceId, n: r._count._all }))],
        ['members', 'maxMembers', async () => (await prisma.membership.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids } }, _count: { _all: true } })).map((r) => ({ workspaceId: r.workspaceId, n: r._count._all }))],
      ];
      for (const [limit, key, count] of counters) {
        const n = lowered(key);
        if (n === null) continue;
        const over = (await count()).filter((r) => r.n > n).length;
        if (over) overLimit.push({ limit, count: over });
      }
    }
    const priceChanged = (next.priceMonthly !== undefined && next.priceMonthly !== p.priceMonthly) || (next.priceYearly !== undefined && next.priceYearly !== p.priceYearly);
    const priceChangeAt = priceChanged ? new Date(Date.now() + PRICE_NOTICE_DAYS * DAY) : null;
    return { subscribers: ids.length, overLimit, priceChangeAt: iso(priceChangeAt), emailDueBy: priceChanged ? new Date().toISOString() : null };
  }

  /** `PATCH /admin/plans/:id` (D63): version n+1; existing subscribers keep their price until renewal (+ notice e-mail 30 d before). */
  async updatePlan(id: string, input: AdminUpdatePlanInput, actor: AdminActor): Promise<PlanUpdateResultDto> {
    const p = await this.planOr404(id);
    if (p.archivedAt && !input.dryRun) throw new AppException('CONFLICT', {}, {}, { reason: 'ARCHIVED' });
    const { dryRun, reason, ...fields } = input;
    const next: Record<string, unknown> = { ...fields };
    if (fields.name) next.name = toLocalized(fields.name);
    if (fields.description) next.description = toLocalized(fields.description);
    const merged = { ...p, ...next } as Plan;
    if (!LIMIT_KEYS.some((k) => merged[k] !== 0)) throw new AppException('VALIDATION_ERROR', {}, { maxPages: 'validation.range' });
    const impact = await this.impact(p, next);
    if (dryRun) return { plan: null, impact };
    const updated = await prisma.$transaction(async (db) => {
      const row = await db.plan.update({ where: { id }, data: { ...(next as Prisma.PlanUpdateInput), version: { increment: 1 } } });
      await db.planVersion.create({ data: { planId: id, version: row.version, snapshot: this.snapshot(row) as Prisma.InputJsonValue, changedById: actor.userId, impactCount: impact.subscribers } });
      // D63: price change ⇒ information to every subscriber now (applies at their next renewal, ≥ 30 days)
      if (impact.priceChangeAt) {
        const subs = await db.subscription.findMany({ where: { planId: id, status: { in: ['active', 'dunning'] }, billingCycle: { not: 'none' } }, select: { workspaceId: true } });
        for (const s of subs) {
          await TenantContext.runAs(s.workspaceId, () =>
            this.notifications.emit(db as Tx, { type: 'subscription_expiring', workspaceId: s.workspaceId, target: { owner: true }, key: `plan_price_notice:${id}:${row.version}:${s.workspaceId}`, data: { periodEnd: impact.priceChangeAt, planSlug: row.slug, priceChange: true } }).catch(() => undefined),
          );
        }
      }
      return row;
    });
    for (const s of await prisma.subscription.findMany({ where: { planId: id, status: { in: [...CURRENT_STATUSES] } }, select: { workspaceId: true } })) await this.tenants.invalidate(s.workspaceId);
    const before = this.snapshot(p);
    const after = this.snapshot(updated);
    const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    await this.log(actor, 'plan.update', 'Plan', id, { version: p.version, ...Object.fromEntries(changed.map((k) => [k, before[k]])) }, { version: updated.version, ...Object.fromEntries(changed.map((k) => [k, after[k]])), impact: impact.subscribers }, reason?.trim() || null);
    return { plan: this.planDto(updated, impact.subscribers, actor), impact };
  }

  async planVersions(id: string): Promise<PlanVersionDto[]> {
    await this.planOr404(id);
    const rows = await prisma.planVersion.findMany({ where: { planId: id }, include: { changedBy: { select: userSelect } }, orderBy: { version: 'desc' } });
    return rows.map((v) => ({ version: v.version, snapshot: v.snapshot as Record<string, unknown>, changedBy: userRef(v.changedBy), impactCount: v.impactCount, createdAt: v.createdAt.toISOString() }));
  }

  async archivePlan(id: string, archive: boolean, reason: string | undefined, actor: AdminActor) {
    const p = await this.planOr404(id);
    if (archive && p.slug === 'free') throw new AppException('CONFLICT', {}, {}, { reason: 'FREE_PLAN' });
    if (archive === !!p.archivedAt) throw new AppException('CONFLICT', {}, {}, { archivedAt: iso(p.archivedAt) });
    const row = await prisma.plan.update({ where: { id }, data: archive ? { archivedAt: new Date(), isVisible: false } : { archivedAt: null } });
    await this.log(actor, archive ? 'plan.archive' : 'plan.restore', 'Plan', id, { archivedAt: iso(p.archivedAt) }, { archivedAt: iso(row.archivedAt) }, reason?.trim() || null);
    return this.planDto(row, (await this.subscriberCounts()).get(id) ?? 0, actor);
  }

  async deletePlan(id: string, actor: AdminActor) {
    const p = await this.planOr404(id);
    if (p.slug === 'free') throw new AppException('CONFLICT', {}, {}, { reason: 'FREE_PLAN' });
    const count = await prisma.subscription.count({ where: { planId: id } });
    const live = await prisma.subscription.count({ where: { planId: id, status: { in: [...CURRENT_STATUSES] } } });
    if (live) throw new AppException('PLAN_IN_USE', { count: live });
    if (count) {
      // history keeps the plan row: archived instead of deleted (subscriptions reference it)
      await prisma.plan.update({ where: { id }, data: { archivedAt: p.archivedAt ?? new Date(), isVisible: false, isActive: false } });
    } else {
      await prisma.plan.delete({ where: { id } });
    }
    await this.log(actor, 'plan.delete', 'Plan', id, this.snapshot(p), { deleted: !count, archived: !!count }, null);
  }

  /** `POST /admin/plans/:id/migrate { toPlanId, when }` — `next_period` books the change for each renewal, `now` switches at once. */
  async migratePlan(id: string, input: AdminMigratePlanInput, actor: AdminActor) {
    const reason = requireReason(input.reason);
    const from = await this.planOr404(id);
    const to = await this.planOr404(input.toPlanId);
    if (to.id === from.id || to.archivedAt) throw new AppException('VALIDATION_ERROR', {}, { toPlanId: 'validation.invalid' });
    const subs = await prisma.subscription.findMany({ where: { planId: id, status: { in: [...CURRENT_STATUSES] } } });
    let migrated = 0;
    for (const s of subs) {
      const tenant = await this.tenants.forWorker(s.workspaceId);
      await TenantContext.run(tenant, () =>
        prisma.$transaction(async (db) => {
          const tx = db as Tx;
          await lockBilling(tx, s.workspaceId);
          if (input.when === 'next_period' && isPaid(s)) {
            const row = await tx.subscription.update({ where: { id: s.id }, data: { nextPlanId: to.id, nextBillingCycle: s.billingCycle } });
            await this.subs.syncUpcoming(tx, row);
          } else {
            await tx.subscription.update({ where: { id: s.id }, data: { planId: to.id, planVersion: to.version, ...(isPaid(s) ? { appliedPrice: priceOf(to, s.billingCycle) } : {}) } });
            await this.limits.apply(tx, s.workspaceId, to, `plan-migrate:${s.id}:${to.id}`);
          }
          await this.subs.emitWorkspace(tx, s.workspaceId);
        }),
      );
      await this.tenants.invalidate(s.workspaceId);
      migrated++;
    }
    await this.log(actor, 'plan.migrate', 'Plan', id, { planSlug: from.slug, subscribers: subs.length }, { toPlanSlug: to.slug, when: input.when, migrated }, reason);
    return { migrated };
  }

  // =========================================================================================================================
  // subscriptions & invoices
  // =========================================================================================================================
  private async subRows(rows: Prisma.SubscriptionGetPayload<{ include: { plan: true; workspace: { select: { id: true; name: true } } } }>[], actor: AdminActor): Promise<AdminSubscriptionRowDto[]> {
    if (!rows.length) return [];
    const ws = rows.map((r) => r.workspaceId);
    const [unpaid, payments] = await Promise.all([
      prisma.invoice.findMany({ where: { workspaceId: { in: ws }, status: 'unpaid' }, orderBy: { createdAt: 'desc' } }),
      prisma.billingPayment.findMany({ where: { workspaceId: { in: ws }, status: 'paid' }, orderBy: { paidAt: 'desc' } }),
    ]);
    const out: AdminSubscriptionRowDto[] = [];
    for (const s of rows) {
      const inv = unpaid.find((i) => i.workspaceId === s.workspaceId);
      const pay = payments.find((p) => p.workspaceId === s.workspaceId);
      const remaining = inv ? await this.invoices.remaining(prisma as unknown as Tx, inv) : 0;
      const raw = (pay?.raw ?? {}) as { manual?: { method?: string }; data?: { payment_method?: string; card_last4?: string } };
      const method = pay ? raw.manual?.method ?? pay.provider : null;
      const live = (CURRENT_STATUSES as readonly string[]).includes(s.status);
      out.push({
        id: s.id,
        workspace: s.workspace,
        plan: { id: s.plan.id, slug: s.plan.slug, name: pickLocal(s.plan.name) },
        status: s.status,
        dunningStage: s.dunningStage,
        cycle: s.billingCycle,
        provider: s.provider,
        appliedPrice: s.appliedPrice,
        discountPct: s.discountPct,
        currentPeriodStart: s.currentPeriodStart.toISOString(),
        currentPeriodEnd: s.currentPeriodEnd.toISOString(),
        trialEndsAt: iso(s.trialEndsAt),
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        lastPayment: pay ? { method, label: raw.data?.card_last4 ? `${method?.toUpperCase()} ••${raw.data.card_last4}` : null, at: iso(pay.paidAt) } : null,
        unpaidInvoice: inv ? { id: inv.id, number: inv.number, amount: inv.amount, remaining, dueAt: iso(inv.dueAt) } : null,
        actions: [
          { key: 'invoices', enabled: true, primary: !inv },
          { ...this.act(actor, 'mark_paid', !!inv), primary: !!inv },
          this.act(actor, 'resend_dunning', s.status === 'dunning' && !!inv),
          this.act(actor, 'extend', live),
          this.act(actor, 'change_plan', live),
          this.act(actor, 'discount', live && isPaid(s)),
          this.act(actor, 'cancel', live && isPaid(s) && !s.cancelAtPeriodEnd),
          this.act(actor, 'cancel_now', live && s.plan.slug !== 'free'),
        ],
      });
    }
    return out;
  }
  private readonly subInclude = { plan: true, workspace: { select: { id: true, name: true } } } as const;

  async subscriptions(q: AdminSubscriptionsQuery, actor: AdminActor) {
    const and: Prisma.SubscriptionWhereInput[] = [];
    // one row per workspace: its current subscription, or its last one when none is current
    and.push({ OR: [{ status: { in: [...CURRENT_STATUSES] } }, { status: { in: ['expired', 'cancelled'] }, workspace: { subscriptions: { none: { status: { in: [...CURRENT_STATUSES] }, NOT: { plan: { slug: 'free' } } } } } }] });
    if (q.status?.length) and.push({ status: { in: q.status as never } });
    else and.push({ NOT: { plan: { slug: 'free' } } });
    if (q.planSlug?.length) and.push({ plan: { slug: { in: q.planSlug } } });
    if (q.cycle?.length) and.push({ billingCycle: { in: q.cycle as never } });
    if (q.method?.length) and.push({ OR: q.method.map((m) => (m.startsWith('manual') ? { provider: 'manual' as const } : { provider: m as never })) });
    if (q.renewal === 'lt7d') and.push({ currentPeriodEnd: { gte: new Date(), lt: new Date(Date.now() + 7 * DAY) } });
    if (q.renewal === 'overdue') and.push({ currentPeriodEnd: { lt: new Date() }, status: { in: ['active', 'dunning'] } });
    if (q.q) and.push({ OR: [{ workspace: { name: { contains: q.q, mode: 'insensitive' } } }, { workspace: { owner: { email: { contains: q.q, mode: 'insensitive' } } } }, { invoices: { some: { number: { contains: q.q, mode: 'insensitive' } } } }] });
    const where: Prisma.SubscriptionWhereInput = { AND: and };
    const [total, rows] = await Promise.all([prisma.subscription.count({ where }), prisma.subscription.findMany({ where, include: this.subInclude, orderBy: [{ currentPeriodEnd: 'asc' }, { id: 'desc' }], ...toSkipTake(q) })]);
    return { ...page(await this.subRows(rows, actor), total, q), meta: { kpis: await this.subscriptionKpis() } };
  }

  async subscriptionKpis(): Promise<AdminSubscriptionKpis> {
    const now = Date.now();
    const paid = await prisma.subscription.findMany({ where: { status: { in: ['active', 'dunning'] }, billingCycle: { not: 'none' } }, select: { appliedPrice: true, billingCycle: true, currentPeriodEnd: true, status: true, dunningStage: true } });
    const mrr = paid.reduce((n, s) => n + (s.billingCycle === 'yearly' ? Math.round(s.appliedPrice / 12) : s.appliedPrice), 0);
    const prev = await prisma.platformDailyStat.findFirst({ where: { day: { lte: new Date(now - 30 * DAY) } }, orderBy: { day: 'desc' } }).catch(() => null);
    const prevMrr = (prev?.metrics as { mrr?: number } | null)?.mrr;
    const r7 = paid.filter((s) => s.status === 'active' && s.currentPeriodEnd.getTime() >= now && s.currentPeriodEnd.getTime() < now + 7 * DAY);
    const dunning = paid.filter((s) => s.status === 'dunning');
    const monthStart = new Date(new Date(now + 3600_000).toISOString().slice(0, 7) + '-01T00:00:00+01:00');
    const [trialsEnded, trialsConverted, manualToConfirm, subsCount, invCount, manualCount, packCount] = await Promise.all([
      prisma.subscription.count({ where: { trialEndsAt: { gte: monthStart, lt: new Date(now) } } }),
      prisma.subscription.count({ where: { trialEndsAt: { gte: monthStart, lt: new Date(now) }, workspace: { subscriptions: { some: { billingCycle: { not: 'none' }, createdAt: { gte: monthStart } } } } } }),
      prisma.invoice.count({ where: { status: 'unpaid', payments: { some: { provider: 'manual', status: 'paid' } } } }),
      prisma.subscription.count({ where: { status: { in: [...CURRENT_STATUSES] }, NOT: { plan: { slug: 'free' } } } }),
      prisma.invoice.count(),
      prisma.billingPayment.count({ where: { provider: 'manual' } }),
      prisma.creditPackPurchase.count(),
    ]);
    return {
      mrr,
      mrrDeltaPct: prevMrr ? Math.round(((mrr - prevMrr) / prevMrr) * 100) : null,
      renewals7d: { count: r7.length, amount: r7.reduce((n, s) => n + s.appliedPrice, 0) },
      dunning: { count: dunning.length, expiringTomorrow: dunning.filter((s) => s.currentPeriodEnd.getTime() + 7 * DAY < now + DAY).length },
      trialConversionPct: trialsEnded ? Math.round((trialsConverted / trialsEnded) * 100) : null,
      trialsConverted,
      manualToConfirm,
      counts: { subscriptions: subsCount, invoices: invCount, manualPayments: manualCount, packPurchases: packCount },
    };
  }

  async subscriptionOfWorkspace(workspaceId: string, actor: AdminActor) {
    assertUuid(workspaceId);
    if (!(await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null }, select: { id: true } }))) throw notFound();
    const s = await prisma.subscription.findFirst({ where: { workspaceId, status: { in: [...CURRENT_STATUSES] } }, include: this.subInclude, orderBy: { createdAt: 'desc' } });
    return s ? (await this.subRows([s], actor))[0]! : null;
  }

  private async subOr404(id: string) {
    assertUuid(id);
    const s = await prisma.subscription.findUnique({ where: { id }, include: this.subInclude });
    if (!s) throw notFound();
    return s;
  }
  private async subRow(id: string, actor: AdminActor) {
    return (await this.subRows([await this.subOr404(id)], actor))[0]!;
  }

  /** `POST /admin/subscriptions` — a paid subscription set by hand (provider manual); `SUBSCRIPTION_ALREADY_ACTIVE` when one runs. */
  async createSubscription(input: AdminCreateSubscriptionInput, actor: AdminActor) {
    const reason = requireReason(input.reason);
    if (!(await prisma.workspace.findFirst({ where: { id: input.workspaceId, deletedAt: null } }))) throw notFound();
    const plan = await this.planOr404(input.planId);
    if (plan.archivedAt) throw new AppException('PLAN_NOT_FOUND');
    const tenant = await this.tenants.forWorker(input.workspaceId);
    const start = new Date(input.startsAt.length === 10 ? `${input.startsAt}T00:00:00+01:00` : input.startsAt);
    const sub = await TenantContext.run({ ...tenant, userId: actor.userId }, () =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await lockBilling(tx, input.workspaceId);
        const cur = await tx.subscription.findFirst({ where: { workspaceId: input.workspaceId, status: { in: [...CURRENT_STATUSES] } }, include: { plan: true } });
        if (cur && (isPaid(cur) || cur.status === 'dunning')) throw new AppException('SUBSCRIPTION_ALREADY_ACTIVE', {}, {}, { subscriptionId: cur.id });
        if (cur) await tx.subscription.update({ where: { id: cur.id }, data: { status: cur.status === 'trial' ? 'expired' : 'cancelled', cancelledAt: new Date(), cancelReason: 'admin_subscription' } });
        const row = await tx.subscription.create({ data: { workspaceId: input.workspaceId, planId: plan.id, planVersion: plan.version, status: 'active', billingCycle: input.cycle, provider: input.provider, appliedPrice: input.appliedPrice ?? priceOf(plan, input.cycle), currentPeriodStart: start, currentPeriodEnd: addCycle(start, input.cycle) } });
        await this.limits.apply(tx, input.workspaceId, plan, `admin-sub:${row.id}`);
        await this.credits.ensurePeriod(tx, input.workspaceId, plan.monthlyCredits, new Date());
        await this.subs.emitWorkspace(tx, input.workspaceId);
        return row;
      }),
    );
    await this.tenants.invalidate(input.workspaceId);
    await this.log(actor, 'subscription.create', 'Subscription', sub.id, null, { planSlug: plan.slug, cycle: input.cycle, appliedPrice: sub.appliedPrice, provider: input.provider, startsAt: start.toISOString() }, reason, input.workspaceId);
    return this.subRow(sub.id, actor);
  }

  async patchSubscription(id: string, input: AdminPatchSubscriptionInput, actor: AdminActor) {
    const reason = requireReason(input.reason);
    const s = await this.subOr404(id);
    if (!(CURRENT_STATUSES as readonly string[]).includes(s.status)) throw new AppException('CONFLICT', {}, {}, { status: s.status });
    const data: Prisma.SubscriptionUpdateInput = {};
    if (input.extendDays) {
      const end = new Date(s.currentPeriodEnd.getTime() + input.extendDays * DAY);
      data.currentPeriodEnd = end;
      if (s.status === 'trial') data.trialEndsAt = end;
    }
    if (input.appliedPrice !== undefined) data.appliedPrice = input.appliedPrice;
    if (input.cycle && isPaid(s)) data.nextBillingCycle = input.cycle;
    await TenantContext.runAs(s.workspaceId, () =>
      prisma.$transaction(async (db) => {
        const row = await db.subscription.update({ where: { id }, data });
        await this.subs.syncUpcoming(db as Tx, row);
        await this.subs.emitWorkspace(db as Tx, s.workspaceId);
      }),
    );
    await this.tenants.invalidate(s.workspaceId);
    await this.log(actor, 'subscription.update', 'Subscription', id, { currentPeriodEnd: s.currentPeriodEnd.toISOString(), appliedPrice: s.appliedPrice, cycle: s.billingCycle }, { ...input, reason: undefined }, reason, s.workspaceId);
    return this.subRow(id, actor);
  }

  async subscriptionAction(id: string, kind: 'cancel' | 'cancel-now' | 'resend-dunning', reasonIn: string, actor: AdminActor) {
    const reason = requireReason(reasonIn);
    const s = await this.subOr404(id);
    const live = (CURRENT_STATUSES as readonly string[]).includes(s.status);
    const tenant = await this.tenants.forWorker(s.workspaceId);
    await TenantContext.run({ ...tenant, userId: actor.userId }, () =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await lockBilling(tx, s.workspaceId);
        if (kind === 'cancel') {
          if (!live || !isPaid(s) || s.cancelAtPeriodEnd) throw new AppException('CONFLICT', {}, {}, { status: s.status, cancelAtPeriodEnd: s.cancelAtPeriodEnd });
          const row = await tx.subscription.update({ where: { id }, data: { cancelAtPeriodEnd: true, cancelledAt: new Date(), cancelReason: 'admin', nextPlanId: null, nextBillingCycle: null } });
          await this.subs.syncUpcoming(tx, row);
        } else if (kind === 'cancel-now') {
          // 02 §5: the workspace goes to the free plan at once (never read-only, never suspended)
          if (!live || s.plan.slug === 'free') throw new AppException('CONFLICT', {}, {}, { status: s.status });
          await tx.invoice.updateMany({ where: { subscriptionId: id, status: 'upcoming' }, data: { status: 'void' } });
          await this.subs.expire(tx, s, 'cancelled');
          await tx.subscription.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'admin_now' } });
        } else {
          const inv = await tx.invoice.findFirst({ where: { workspaceId: s.workspaceId, status: 'unpaid' }, orderBy: { createdAt: 'desc' } });
          if (s.status !== 'dunning' || !inv) throw new AppException('CONFLICT', {}, {}, { status: s.status });
          const remaining = await this.invoices.remaining(tx, inv);
          await this.notifications.emit(tx, { type: 'invoice_unpaid', workspaceId: s.workspaceId, target: { owner: true }, key: `invoice_unpaid:${inv.id}:resend:${Date.now()}`, data: { invoiceId: inv.id, number: inv.number, amount: remaining, dueAt: s.currentPeriodEnd.toISOString(), stage: s.dunningStage ?? 'd0' } });
        }
        await this.subs.emitWorkspace(tx, s.workspaceId);
      }),
    );
    await this.tenants.invalidate(s.workspaceId);
    await this.log(actor, `subscription.${kind.replace('-', '_')}`, 'Subscription', id, { status: s.status, cancelAtPeriodEnd: s.cancelAtPeriodEnd }, { kind }, reason, s.workspaceId);
    return this.subRow(id, actor);
  }

  /** "Accorder une remise": a workspace-targeted discount code redeemed on the subscription (applies to the next n invoices). */
  async discount(id: string, input: AdminDiscountInput, actor: AdminActor) {
    const reason = requireReason(input.reason);
    const s = await this.subOr404(id);
    if (!(CURRENT_STATUSES as readonly string[]).includes(s.status) || !isPaid(s)) throw new AppException('CONFLICT', {}, {}, { status: s.status });
    const code = (input.promoCode?.trim().toUpperCase() || `ADM-${randomUUID().slice(0, 8).toUpperCase()}`).slice(0, 40);
    if (await prisma.promoCode.findUnique({ where: { code } })) throw new AppException('CONFLICT', {}, { promoCode: 'validation.taken' });
    await TenantContext.runAs(s.workspaceId, () =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const promo = await tx.promoCode.create({ data: { code, kind: input.kind === 'percent' ? 'percent_discount' : 'fixed_discount', value: input.value, periods: input.periods, target: 'workspace', targetWorkspaceId: s.workspaceId, maxUses: 1, createdById: actor.userId, notes: reason } });
        const red = await tx.promoRedemption.create({ data: { promoCodeId: promo.id, workspaceId: s.workspaceId, userId: actor.userId } });
        const row = await tx.subscription.update({ where: { id }, data: { promoRedemptionId: red.id, discountPct: input.kind === 'percent' ? input.value : null } });
        await this.subs.syncUpcoming(tx, row);
      }),
    );
    await this.log(actor, 'subscription.discount', 'Subscription', id, { discountPct: s.discountPct }, { kind: input.kind, value: input.value, periods: input.periods, code }, reason, s.workspaceId);
    return this.subRow(id, actor);
  }

  async invoicesList(q: AdminInvoicesQuery, actor: AdminActor): Promise<Page<AdminInvoiceRowDto>> {
    const where: Prisma.InvoiceWhereInput = {
      ...(q.status?.length ? { status: { in: q.status as never } } : {}),
      ...(q.kind?.length ? { kind: { in: q.kind as never } } : {}),
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+01:00`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00+01:00`).getTime() + DAY) } : {}) } } : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { workspace: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [total, rows] = await Promise.all([prisma.invoice.count({ where }), prisma.invoice.findMany({ where, include: { workspace: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) })]);
    const out: AdminInvoiceRowDto[] = [];
    for (const inv of rows) {
      const dto = await TenantContext.runAs(inv.workspaceId, () => this.invoices.toDto(inv, 'fr'));
      out.push({ ...dto, workspace: inv.workspace, actions: [{ key: 'pdf', enabled: true }, { ...this.act(actor, 'mark_paid', inv.status === 'unpaid' || inv.status === 'upcoming'), primary: inv.status === 'unpaid' }] });
    }
    return page(out, total, q);
  }

  async payments(q: { page: number; pageSize: number; provider?: string[]; status?: string[]; from?: string; to?: string; q?: string }): Promise<Page<AdminPaymentRowDto>> {
    const where: Prisma.BillingPaymentWhereInput = {
      provider: { in: (q.provider?.length ? q.provider : ['manual']) as never },
      ...(q.status?.length ? { status: { in: q.status as never } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+01:00`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00+01:00`).getTime() + DAY) } : {}) } } : {}),
      ...(q.q ? { OR: [{ reference: { contains: q.q, mode: 'insensitive' } }, { workspace: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.billingPayment.count({ where }),
      prisma.billingPayment.findMany({ where, include: { workspace: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true } }, recordedBy: { select: userSelect }, proof: { select: { storageKey: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }),
    ]);
    const out: AdminPaymentRowDto[] = [];
    for (const p of rows) {
      out.push({
        id: p.id,
        workspace: p.workspace,
        invoice: p.invoice,
        amount: p.amount,
        status: p.status,
        provider: p.provider,
        method: (p.raw as { manual?: { method?: string } } | null)?.manual?.method ?? null,
        reference: p.reference,
        proofUrl: p.proof ? this.storage.signedUrl(p.proof.storageKey, 24 * 3600) : null,
        recordedBy: userRef(p.recordedBy),
        paidAt: iso(p.paidAt),
        createdAt: p.createdAt.toISOString(),
      });
    }
    return page(out, total, q);
  }

  // =========================================================================================================================
  // credit packs & promo codes & pricing history (ADM-15)
  // =========================================================================================================================
  private packDto(p: CreditPack, sales30d: number, purchases: number): CreditPackAdminDto {
    // a pack that was ever bought keeps its history (CreditPackPurchase ON DELETE RESTRICT): deactivate it instead
    const actions = [{ key: 'edit', enabled: true }, purchases > 0 ? { key: 'delete', enabled: false, reasonCode: 'CREDIT_PACK_HAS_PURCHASES' } : { key: 'delete', enabled: true }];
    return { ...this.packs.toDto(p, 'fr'), nameI18n: fromLocalized(p.name), storeTier: p.storeTier, isActive: p.isActive, visibleWeb: p.visibleWeb, visibleMobile: p.visibleMobile, sales30d, sortOrder: p.sortOrder, purchases, actions };
  }

  async packsList() {
    const since = new Date(Date.now() - 30 * DAY);
    const [rows, sales, all] = await Promise.all([
      prisma.creditPack.findMany({ orderBy: [{ sortOrder: 'asc' }, { credits: 'asc' }] }),
      prisma.creditPackPurchase.groupBy({ by: ['creditPackId'], where: { status: 'credited', createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.creditPackPurchase.groupBy({ by: ['creditPackId'], _count: { _all: true } }),
    ]);
    const data = rows.map((p) => this.packDto(p, sales.find((s) => s.creditPackId === p.id)?._count._all ?? 0, all.find((s) => s.creditPackId === p.id)?._count._all ?? 0));
    return { ...page(data, data.length, { page: 1, pageSize: Math.max(1, data.length) }), meta: { kpis: await this.packKpis() } };
  }

  private async packKpis(): Promise<AdminPacksKpis> {
    const since = new Date(Date.now() - 30 * DAY);
    const [byChannel, net, active, expiring, granted, buyers, totalWs] = await Promise.all([
      prisma.creditPackPurchase.groupBy({ by: ['channel'], where: { status: 'credited', createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.invoice.aggregate({ where: { kind: 'credit_pack', status: 'paid', paidAt: { gte: since } }, _sum: { amount: true } }),
      prisma.promoCode.count({ where: { isActive: true, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] } }),
      prisma.promoCode.count({ where: { isActive: true, validTo: { gt: new Date(), lt: new Date(Date.now() + 7 * DAY) } } }),
      prisma.creditLedger.aggregate({ where: { action: 'grant', kind: 'credit', grantedById: { not: null }, createdAt: { gte: since } }, _sum: { credits: true } }),
      prisma.creditPackPurchase.groupBy({ by: ['workspaceId'], where: { status: 'credited', createdAt: { gte: since } } }),
      prisma.workspace.count({ where: { deletedAt: null } }),
    ]);
    const web = byChannel.find((c) => c.channel === 'web')?._count._all ?? 0;
    const total = byChannel.reduce((n, c) => n + c._count._all, 0);
    return { packsSold30d: { total, web, mobile: total - web }, netDzd30d: net._sum.amount ?? 0, activeCodes: active, codesExpiringThisWeek: expiring, creditsGranted30d: granted._sum.credits ?? 0, buyingWorkspacesPct: totalWs ? Math.round((buyers.length / totalWs) * 100) : 0 };
  }

  async createPack(input: AdminCreatePackInput, actor: AdminActor) {
    if (await prisma.creditPack.findUnique({ where: { slug: input.slug } })) throw new AppException('CONFLICT', {}, { slug: 'validation.taken' });
    const { reason, name, ...rest } = input;
    try {
      const p = await prisma.creditPack.create({ data: { ...rest, name: toLocalized(name)! } });
      await this.log(actor, 'credit_pack.create', 'CreditPack', p.id, null, { ...rest, name }, reason?.trim() || null);
      return this.packDto(p, 0, 0);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppException('CONFLICT', {}, { googleProductId: 'validation.taken' });
      throw e;
    }
  }

  async updatePack(id: string, input: AdminUpdatePackInput, actor: AdminActor) {
    assertUuid(id);
    const p = await prisma.creditPack.findUnique({ where: { id } });
    if (!p) throw notFound();
    const { reason, name, ...rest } = input;
    try {
      const row = await prisma.creditPack.update({ where: { id }, data: { ...rest, ...(name ? { name: toLocalized(name) } : {}) } });
      await this.log(actor, 'credit_pack.update', 'CreditPack', id, Object.fromEntries(Object.keys(input).map((k) => [k, (p as Record<string, unknown>)[k]])), input, reason?.trim() || null);
      return this.packDto(row, 0, await prisma.creditPackPurchase.count({ where: { creditPackId: id } }));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppException('CONFLICT', {}, { googleProductId: 'validation.taken' });
      throw e;
    }
  }

  /** `DELETE /admin/credit-packs/:id` (UX-010) — only a pack never bought (any purchase row keeps it: 409 CREDIT_PACK_HAS_PURCHASES {count}). */
  async deletePack(id: string, actor: AdminActor) {
    assertUuid(id);
    const p = await prisma.creditPack.findUnique({ where: { id } });
    if (!p) throw notFound();
    const count = await prisma.creditPackPurchase.count({ where: { creditPackId: id } });
    if (count > 0) throw new AppException('CREDIT_PACK_HAS_PURCHASES', { count });
    try {
      await prisma.creditPack.delete({ where: { id } });
    } catch (e) {
      // a purchase started meanwhile (FK restrict)
      if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2003' || e.code === 'P2014')) throw new AppException('CREDIT_PACK_HAS_PURCHASES', { count: 1 });
      throw e;
    }
    await this.log(actor, 'credit_pack.delete', 'CreditPack', id, { slug: p.slug, name: p.name, credits: p.credits, priceWebDzd: p.priceWebDzd }, null, null);
  }

  async packPurchases(q: { page: number; pageSize: number; channel?: string[]; status?: string[]; from?: string; to?: string; q?: string }): Promise<Page<AdminPackPurchaseRowDto>> {
    const where: Prisma.CreditPackPurchaseWhereInput = {
      ...(q.channel?.length ? { channel: { in: q.channel as never } } : {}),
      ...(q.status?.length ? { status: { in: q.status as never } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+01:00`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00+01:00`).getTime() + DAY) } : {}) } } : {}),
      ...(q.q ? { workspace: { name: { contains: q.q, mode: 'insensitive' } } } : {}),
    };
    const [total, rows] = await Promise.all([prisma.creditPackPurchase.count({ where }), prisma.creditPackPurchase.findMany({ where, include: { workspace: { select: { id: true, name: true } }, pack: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) })]);
    return page(rows.map((r) => ({ id: r.id, workspace: r.workspace, pack: { id: r.pack.id, slug: r.pack.slug, name: pickLocal(r.pack.name), credits: r.pack.credits }, channel: r.channel, status: r.status, amount: r.amount, storeTransactionId: r.storeTransactionId, createdAt: r.createdAt.toISOString(), creditedAt: iso(r.creditedAt), refundedAt: iso(r.refundedAt) })), total, q);
  }

  async pricingVersions(): Promise<CreditPricingDto[]> {
    const rows = await prisma.creditPricing.findMany({ include: { createdBy: { select: userSelect } }, orderBy: { version: 'desc' } });
    const current = rows.find((r) => r.effectiveAt <= new Date());
    return rows.map((r) => AdminBillingCatalogService.pricingDto(r, r.id === current?.id));
  }

  static pricingDto(r: Prisma.CreditPricingGetPayload<{ include: { createdBy: { select: typeof userSelect } } }>, current: boolean): CreditPricingDto {
    const c = (r.costs ?? {}) as Record<string, number>;
    return { id: r.id, version: r.version, usdToDzd: Number(r.usdToDzd), creditPriceDzd: Number(r.creditPriceDzd), costs: { text: c.text ?? 1, image: c.image ?? 5, voice: c.voice ?? 3, order: c.order ?? 0 }, avgTokensPerMessage: r.avgTokensPerMessage, targetMarginPct: r.targetMarginPct, effectiveAt: r.effectiveAt.toISOString(), createdBy: userRef(r.createdBy), announcementCmsEntryId: r.announcementCmsEntryId, createdAt: r.createdAt.toISOString(), current };
  }

  private promoState(p: PromoCode, uses: number): PromoCodeDto['state'] {
    if (!p.isActive) return 'inactive';
    if (p.validTo && p.validTo < new Date()) return 'expired';
    if (p.maxUses !== null && uses >= p.maxUses) return 'used';
    return 'active';
  }

  private async promoDtos(rows: Prisma.PromoCodeGetPayload<{ include: { createdBy: { select: typeof userSelect }; targetWorkspace: { select: { id: true; name: true } }; _count: { select: { redemptions: true } } } }>[]): Promise<PromoCodeDto[]> {
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      kind: p.kind,
      value: p.value,
      periods: p.periods,
      planSlugs: p.planSlugs,
      target: p.target,
      targetWorkspaceId: p.targetWorkspaceId,
      targetWorkspace: p.targetWorkspace,
      maxUses: p.maxUses,
      perWorkspaceLimit: p.perWorkspaceLimit,
      validFrom: iso(p.validFrom),
      validTo: iso(p.validTo),
      isActive: p.isActive,
      uses: p._count.redemptions,
      createdBy: p.code.startsWith('PARRAIN-') ? 'system' : userRef(p.createdBy) ?? 'system',
      notes: p.notes,
      state: this.promoState(p, p._count.redemptions),
      createdAt: p.createdAt.toISOString(),
    }));
  }
  private readonly promoInclude = { createdBy: { select: userSelect }, targetWorkspace: { select: { id: true, name: true } }, _count: { select: { redemptions: true } } } as const;

  async promos(q: { page: number; pageSize: number; state?: string[]; kind?: string[]; q?: string }): Promise<Page<PromoCodeDto>> {
    const where: Prisma.PromoCodeWhereInput = { ...(q.kind?.length ? { kind: { in: q.kind as never } } : {}), ...(q.q ? { code: { contains: q.q.toUpperCase() } } : {}) };
    const rows = await prisma.promoCode.findMany({ where, include: this.promoInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    let dtos = await this.promoDtos(rows);
    if (q.state?.length) dtos = dtos.filter((d) => q.state!.includes(d.state));
    return page(dtos.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), dtos.length, q);
  }

  private date(v: string | null | undefined, end = false) {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return v.length === 10 ? new Date(`${v}T${end ? '23:59:59' : '00:00:00'}+01:00`) : new Date(v);
  }

  async createPromo(input: AdminCreatePromoInput, actor: AdminActor) {
    if (await prisma.promoCode.findUnique({ where: { code: input.code } })) throw new AppException('CONFLICT', {}, { code: 'validation.taken' });
    if (input.targetWorkspaceId && !(await prisma.workspace.findUnique({ where: { id: input.targetWorkspaceId } }))) throw new AppException('VALIDATION_ERROR', {}, { targetWorkspaceId: 'validation.id' });
    const from = this.date(input.validFrom);
    const to = this.date(input.validTo, true);
    if (from && to && to <= from) throw new AppException('VALIDATION_ERROR', {}, { validTo: 'validation.range' });
    const p = await prisma.promoCode.create({ data: { code: input.code, kind: input.kind, value: input.value, periods: input.periods ?? null, planSlugs: input.planSlugs, target: input.target, targetWorkspaceId: input.target === 'workspace' ? input.targetWorkspaceId ?? null : null, maxUses: input.maxUses ?? null, perWorkspaceLimit: input.perWorkspaceLimit, validFrom: from ?? null, validTo: to ?? null, createdById: actor.userId, notes: input.notes ?? null }, include: this.promoInclude });
    await this.log(actor, 'promo_code.create', 'PromoCode', p.id, null, input, null);
    return (await this.promoDtos([p]))[0]!;
  }

  async updatePromo(id: string, input: AdminUpdatePromoInput, actor: AdminActor) {
    assertUuid(id);
    const p = await prisma.promoCode.findUnique({ where: { id }, include: this.promoInclude });
    if (!p) throw notFound();
    if ((input.value !== undefined || input.periods !== undefined) && p._count.redemptions > 0) throw new AppException('CONFLICT', {}, { value: 'validation.invalid' }, { reason: 'USED' });
    const row = await prisma.promoCode.update({
      where: { id },
      data: {
        ...(input.maxUses !== undefined ? { maxUses: input.maxUses } : {}),
        ...(input.validFrom !== undefined ? { validFrom: this.date(input.validFrom) } : {}),
        ...(input.validTo !== undefined ? { validTo: this.date(input.validTo, true) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.planSlugs ? { planSlugs: input.planSlugs } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.periods !== undefined ? { periods: input.periods } : {}),
      },
      include: this.promoInclude,
    });
    await this.log(actor, 'promo_code.update', 'PromoCode', id, Object.fromEntries(Object.keys(input).map((k) => [k, (p as Record<string, unknown>)[k]])), input, null);
    return (await this.promoDtos([row]))[0]!;
  }

  async deactivatePromo(id: string, actor: AdminActor) {
    return this.updatePromo(id, { isActive: false } as AdminUpdatePromoInput, actor);
  }

  async redemptions(id: string, q: { page: number; pageSize: number }): Promise<Page<PromoRedemptionRowDto>> {
    assertUuid(id);
    if (!(await prisma.promoCode.findUnique({ where: { id } }))) throw notFound();
    const where = { promoCodeId: id };
    const [total, rows] = await Promise.all([prisma.promoRedemption.count({ where }), prisma.promoRedemption.findMany({ where, include: { workspace: { select: { id: true, name: true } }, user: { select: userSelect } }, orderBy: [{ redeemedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) })]);
    return page(rows.map((r) => ({ id: r.id, workspace: r.workspace, user: userRef(r.user)!, redeemedAt: r.redeemedAt.toISOString() })), total, q);
  }
}
