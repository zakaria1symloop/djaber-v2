// BIL-01 / BIL-05 / BIL-07 / 02 §5 / 04 §14 — one current Subscription per workspace (partial unique on trial|active|dunning).
//   preview / checkout : the "Changer de plan" dialog (mode upgrade | new_period | renewal | downgrade, prorata of 03 §37 BIL)
//   activation         : called by PaymentService once a checkout / manual payment is paid (never twice)
//   cancel / undo      : at period end (`cancelAtPeriodEnd`), a cheaper paid plan is booked as `nextPlanId`
//   expire             : the 02 §5 single rule — paid / trial row `expired` + new free row `active` the same instant,
//                        LimitService pauses what exceeds the free plan; nothing deleted, never a suspension
//   renew              : paying the renewal invoice at any dunning stage ⇒ `active`, new period, pauses lifted
import { Injectable, OnModuleInit } from '@nestjs/common';
import { prorata, type CheckoutPreviewDto, type CheckoutResultDto, type PausedResourceView, type SubscriptionDto, type WorkspaceSubscriptionEvent } from '@djaber/shared';
import { prisma, TenantContext, type BillingCycle, type Invoice, type Plan, type PromoCode, type Subscription, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { AppException } from '../../core/errors/app.exception';
import { OutboxService } from '../../core/outbox/outbox.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { creditPeriod, CreditService } from '../credits/credit.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { addCycle, addMonths, currentSub, isFreePlan, isPaid, iso, lockBilling, priceOf, type SubWithPlan } from './billing.util';
import { InvoiceService, type InvoiceLine } from './invoice.service';
import { LimitService } from './limit.service';
import { PaymentService, type PaidInfo, type PaymentIntent } from './payment.service';
import { PlanService } from './plan.service';
import { PromoService } from './promo.service';

type Mode = CheckoutPreviewDto['mode'];
export type Quote = { mode: Mode; plan: Plan; cycle: 'monthly' | 'yearly'; amountNow: number; amountBeforePromo: number; prorataDays: number | null; nextAmount: number; nextAt: Date; effectiveAt: Date; creditsNow: number; promo: PromoCode | null; paused: PausedResourceView[]; current: SubWithPlan | null };
export type Platform = 'web' | 'mobile';

@Injectable()
export class SubscriptionService implements OnModuleInit {
  constructor(
    private readonly plans: PlanService,
    private readonly limits: LimitService,
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentService,
    private readonly promos: PromoService,
    private readonly credits: CreditService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationProducer,
    private readonly tenants: TenantResolver,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.payments.register('subscription', (tx, intent, paid) => this.activate(tx, intent as Extract<PaymentIntent, { kind: 'subscription' }>, paid));
    this.payments.register('invoice', (tx, intent, paid) => this.payInvoiceIn(tx, (intent as Extract<PaymentIntent, { kind: 'invoice' }>).invoiceId, paid));
  }

  // --- preview -------------------------------------------------------------------------------------------------------------
  /** The quote behind `POST /billing/preview` and `POST /billing/checkout` (pure read). */
  async quote(planId: string, cycle: 'monthly' | 'yearly', promoCode: string | undefined, platform: Platform, now = new Date()): Promise<Quote> {
    const workspaceId = TenantContext.workspaceId();
    const plan = await this.plans.buyable(planId);
    const cur = await currentSub(prisma as unknown as Tx, workspaceId);
    const price = priceOf(plan, cycle);
    const paidActive = isPaid(cur) && cur!.status === 'active';
    const base = { plan, cycle, current: cur, promo: null as PromoCode | null };
    const db = prisma as unknown as Tx;
    let q: Quote;
    if (isFreePlan(plan)) {
      // the free plan is never bought: a running paid plan is cancelled at its end
      if (!paidActive) throw new AppException('PLAN_IS_FREE');
      q = { ...base, mode: 'downgrade', amountNow: 0, amountBeforePromo: 0, prorataDays: null, nextAmount: 0, nextAt: cur!.currentPeriodEnd, effectiveAt: cur!.currentPeriodEnd, creditsNow: 0, paused: await this.limits.preview(db, plan) };
      return q;
    }
    if (!paidActive) {
      // trial / free / expired / dunning: a new period starts today (dunning: same plan + cycle = the renewal)
      const renewal = !!cur && cur.status === 'dunning' && cur.planId === plan.id && cur.billingCycle === cycle;
      q = { ...base, mode: renewal ? 'renewal' : 'new_period', amountNow: price, amountBeforePromo: price, prorataDays: null, nextAmount: price, nextAt: addCycle(now, cycle), effectiveAt: now, creditsNow: plan.monthlyCredits, paused: await this.limits.preview(db, plan) };
    } else {
      const c = cur!;
      const curPlan = c.plan;
      const samePlan = c.planId === plan.id;
      const upward = plan.priceMonthly > curPlan.priceMonthly || (samePlan && c.billingCycle === 'monthly' && cycle === 'yearly') || (!samePlan && plan.priceMonthly === curPlan.priceMonthly);
      const pr = prorata({ price, currentPrice: c.appliedPrice, periodStart: c.currentPeriodStart, periodEnd: c.currentPeriodEnd, now });
      if (samePlan && c.billingCycle === cycle) {
        q = { ...base, mode: 'renewal', amountNow: price, amountBeforePromo: price, prorataDays: null, nextAmount: price, nextAt: addCycle(c.currentPeriodEnd, cycle), effectiveAt: c.currentPeriodEnd, creditsNow: 0, paused: [] };
      } else if (upward && c.billingCycle === cycle) {
        const credits = plan.monthlyCredits < 0 || curPlan.monthlyCredits < 0 ? plan.monthlyCredits : Math.max(0, plan.monthlyCredits - curPlan.monthlyCredits);
        q = { ...base, mode: 'upgrade', amountNow: pr.amount, amountBeforePromo: pr.amount, prorataDays: pr.remainingDays, nextAmount: price, nextAt: c.currentPeriodEnd, effectiveAt: now, creditsNow: credits, paused: await this.limits.preview(db, plan) };
      } else if (upward) {
        const amount = Math.max(0, price - pr.unused);
        q = { ...base, mode: 'new_period', amountNow: amount, amountBeforePromo: amount, prorataDays: pr.remainingDays, nextAmount: price, nextAt: addCycle(now, cycle), effectiveAt: now, creditsNow: plan.monthlyCredits, paused: await this.limits.preview(db, plan) };
      } else {
        q = { ...base, mode: 'downgrade', amountNow: 0, amountBeforePromo: 0, prorataDays: null, nextAmount: price, nextAt: c.currentPeriodEnd, effectiveAt: c.currentPeriodEnd, creditsNow: 0, paused: await this.limits.preview(db, plan) };
      }
    }
    if (promoCode && q.mode !== 'downgrade') {
      const promo = await this.promos.check(promoCode, { workspaceId, plan, platform, purpose: 'checkout' });
      if (promo.kind === 'percent_discount' || promo.kind === 'fixed_discount') {
        q.promo = promo;
        q.amountNow = PromoService.apply(promo, q.amountNow);
        if ((promo.periods ?? 1) > 1 || q.mode === 'upgrade') q.nextAmount = PromoService.apply(promo, q.nextAmount);
      } else throw new AppException('PROMO_PLAN_MISMATCH', { plans: promo.planSlugs.join(', ') || '—' });
    }
    return q;
  }

  toPreview(q: Quote, locale: string): CheckoutPreviewDto {
    return {
      mode: q.mode,
      targetPlan: { id: q.plan.id, slug: q.plan.slug, name: this.plans.name(q.plan, locale), cycle: q.cycle },
      amountNow: q.amountNow,
      prorataDays: q.prorataDays,
      amountBeforePromo: q.amountBeforePromo,
      nextAmount: q.nextAmount,
      nextAt: q.nextAt.toISOString(),
      effectiveAt: q.effectiveAt.toISOString(),
      creditsNow: q.creditsNow,
      pausedResources: q.paused.map((p) => ({ type: p.type, name: p.name })),
      promo: q.promo ? { code: q.promo.code, kind: q.promo.kind, value: q.promo.value, periods: q.promo.periods } : null,
    };
  }

  // --- checkout ------------------------------------------------------------------------------------------------------------
  /** `POST /billing/checkout { planId, cycle, promoCode? }` (Owner, web only — D73). */
  async checkout(input: { planId: string; cycle: 'monthly' | 'yearly'; promoCode?: string }, platform: Platform, locale: 'fr' | 'ar' | 'en'): Promise<CheckoutResultDto> {
    if (platform === 'mobile') throw new AppException('FORBIDDEN');
    const t = TenantContext.get();
    const q = await this.quote(input.planId, input.cycle, input.promoCode, platform);
    const preview = this.toPreview(q, locale);
    if (q.mode === 'downgrade') {
      await this.bookDowngrade(q);
      return { checkoutUrl: null, ref: null, prorata: null, preview };
    }
    const intent: PaymentIntent = { kind: 'subscription', mode: q.mode as Exclude<Mode, 'downgrade'>, planId: q.plan.id, cycle: q.cycle, amount: q.amountNow, amountBeforePromo: q.amountBeforePromo, prorataDays: q.prorataDays, promoId: q.promo?.id ?? null, userId: t.userId ?? null };
    if (q.amountNow < PaymentService.minAmount) {
      // nothing (or less than the gateway minimum) to pay: applied at once, the difference is waived
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await lockBilling(tx, t.workspaceId);
        await this.payments.activateManually(tx, { intent: { ...intent, amount: 0 }, amount: 0, method: null, reference: 'waived' });
      });
      await this.tenants.invalidate(t.workspaceId);
      await this.auditChange('subscription.change', { planId: q.plan.id, cycle: q.cycle, mode: q.mode, amount: 0 });
      return { checkoutUrl: null, ref: null, prorata: q.prorataDays, preview };
    }
    const label = `${this.plans.name(q.plan, locale)} (${q.cycle})`;
    const r = await this.payments.start({ amount: q.amountNow, description: `Djaber — ${label}`, intent, locale, subscriptionId: q.current?.id ?? null });
    return { checkoutUrl: r.checkoutUrl, ref: r.ref, prorata: q.prorataDays, preview };
  }

  private async bookDowngrade(q: Quote) {
    const workspaceId = TenantContext.workspaceId();
    const toFree = isFreePlan(q.plan);
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await lockBilling(tx, workspaceId);
      const cur = await currentSub(tx, workspaceId);
      if (!cur || !isPaid(cur)) throw new AppException('CONFLICT');
      const row = toFree
        ? await tx.subscription.update({ where: { id: cur.id }, data: { cancelAtPeriodEnd: true, cancelledAt: new Date(), cancelReason: 'downgrade:free', nextPlanId: null, nextBillingCycle: null } })
        : await tx.subscription.update({ where: { id: cur.id }, data: { nextPlanId: q.plan.id, nextBillingCycle: q.cycle, cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null } });
      await this.syncUpcoming(tx, row);
      await this.emitWorkspace(tx, workspaceId);
    });
    await this.tenants.invalidate(workspaceId);
    await this.auditChange(toFree ? 'subscription.cancel' : 'subscription.downgrade_booked', { planId: q.plan.id, cycle: q.cycle, effectiveAt: q.effectiveAt.toISOString() });
  }

  /** `POST /billing/cancel { reason? }` — at period end; the free plan applies then (02 §5). */
  async cancel(reason: string | undefined) {
    const workspaceId = TenantContext.workspaceId();
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await lockBilling(tx, workspaceId);
      const cur = await currentSub(tx, workspaceId);
      if (!cur || !isPaid(cur) || cur.status !== 'active' || cur.cancelAtPeriodEnd) throw new AppException('CONFLICT', {}, {}, { status: cur?.status ?? null, cancelAtPeriodEnd: cur?.cancelAtPeriodEnd ?? null });
      const row = await tx.subscription.update({ where: { id: cur.id }, data: { cancelAtPeriodEnd: true, cancelledAt: new Date(), cancelReason: reason?.trim() || 'merchant', nextPlanId: null, nextBillingCycle: null } });
      await this.syncUpcoming(tx, row);
      await this.emitWorkspace(tx, workspaceId);
    });
    await this.tenants.invalidate(workspaceId);
    await this.auditChange('subscription.cancel', { reason: reason ?? null });
  }

  /** `DELETE /billing/cancel` — keeps the plan: clears a cancel at period end and a booked downgrade. */
  async undoCancel() {
    const workspaceId = TenantContext.workspaceId();
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await lockBilling(tx, workspaceId);
      const cur = await currentSub(tx, workspaceId);
      if (!cur || !isPaid(cur) || (!cur.cancelAtPeriodEnd && !cur.nextPlanId)) throw new AppException('CONFLICT');
      const row = await tx.subscription.update({ where: { id: cur.id }, data: { cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null, nextPlanId: null, nextBillingCycle: null } });
      await this.syncUpcoming(tx, row);
      await this.emitWorkspace(tx, workspaceId);
    });
    await this.tenants.invalidate(workspaceId);
    await this.auditChange('subscription.cancel_undone', {});
  }

  private async auditChange(action: string, after: Record<string, unknown>) {
    const t = TenantContext.get();
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId ?? null, actorRole: t.role ?? null, action, entity: 'Subscription', after });
  }

  // --- renewal amounts & the upcoming invoice -----------------------------------------------------------------------------
  /** What the next period of `sub` costs (booked downgrade, running discount code). */
  async renewalTerms(tx: Tx, sub: Subscription & { plan?: Plan }): Promise<{ plan: Plan; cycle: BillingCycle; amount: number; lines: InvoiceLine[] }> {
    const plan = sub.nextPlanId ? ((await this.plans.byId(sub.nextPlanId)) ?? (await this.plans.byId(sub.planId))!) : (sub.plan ?? (await this.plans.byId(sub.planId))!);
    const cycle = sub.nextBillingCycle ?? sub.billingCycle;
    const full = priceOf(plan, cycle);
    const promo = await this.promos.activeDiscount(tx, sub);
    const amount = PromoService.apply(promo, full);
    const lines: InvoiceLine[] = [{ key: 'billingDoc.line.renewal', label: '', params: { plan: this.plans.name(plan, 'fr'), cycle }, amount: full, planId: plan.id, cycle: cycle === 'yearly' ? 'yearly' : 'monthly' }];
    if (promo && amount !== full) lines.push({ key: 'billingDoc.line.promo', label: '', params: { code: promo.code }, amount: amount - full });
    return { plan, cycle, amount, lines };
  }

  /** Keeps the J−7 `upcoming` / `unpaid` renewal invoice in line with a booked change (cancel ⇒ void). */
  async syncUpcoming(tx: Tx, sub: Subscription) {
    const inv = await tx.invoice.findFirst({ where: { subscriptionId: sub.id, kind: 'subscription', status: { in: ['upcoming', 'unpaid'] } }, orderBy: { createdAt: 'desc' } });
    if (!inv) return;
    if (sub.cancelAtPeriodEnd) {
      if (inv.status === 'upcoming') await tx.invoice.update({ where: { id: inv.id }, data: { status: 'void' } });
      return;
    }
    const terms = await this.renewalTerms(tx, sub);
    await tx.invoice.update({ where: { id: inv.id }, data: { amount: terms.amount, lines: terms.lines as never } });
  }

  // --- activation (PaymentService) ----------------------------------------------------------------------------------------
  /** A paid plan change (checkout or waived). Runs inside the activation transaction with the tenant set. */
  async activate(tx: Tx, intent: Extract<PaymentIntent, { kind: 'subscription' }>, paid: PaidInfo, now = new Date()): Promise<{ invoiceId: string | null }> {
    const workspaceId = TenantContext.workspaceId();
    await lockBilling(tx, workspaceId);
    const plan = (await this.plans.byId(intent.planId))!;
    const cur = await currentSub(tx, workspaceId);
    const promo = intent.promoId ? await TenantContext.runSystem(() => prisma.promoCode.findUnique({ where: { id: intent.promoId! } })) : null;
    const lines: InvoiceLine[] = [];
    let sub: Subscription;
    const fullPrice = priceOf(plan, intent.cycle);
    const appliedPrice = PromoService.apply(promo, fullPrice);
    const upgradeOk = intent.mode === 'upgrade' && cur && isPaid(cur) && cur.status === 'active' && cur.billingCycle === intent.cycle;
    const renewalOk = intent.mode === 'renewal' && cur && isPaid(cur) && cur.planId === plan.id && cur.billingCycle === intent.cycle;
    if (upgradeOk) {
      const oldPlan = cur!.plan;
      sub = await tx.subscription.update({ where: { id: cur!.id }, data: { planId: plan.id, planVersion: plan.version, appliedPrice, discountPct: promo?.kind === 'percent_discount' ? promo.value : cur!.discountPct, nextPlanId: null, nextBillingCycle: null, cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null } });
      lines.push({ key: 'billingDoc.line.upgrade', label: '', params: { plan: this.plans.name(plan, 'fr'), days: intent.prorataDays ?? 0 }, amount: intent.amountBeforePromo, planId: plan.id, cycle: intent.cycle });
      // "credits immediate" (03 §37 BIL): the difference of monthly credits joins the current period
      const diff = plan.monthlyCredits >= 0 && oldPlan.monthlyCredits >= 0 ? plan.monthlyCredits - oldPlan.monthlyCredits : 0;
      if (diff > 0) await this.credits.writeIn(tx, workspaceId, { bucket: 'plan', action: 'grant', credits: diff, key: `upgrade:${sub.id}:${plan.id}:${paid.paymentId}`, reason: `upgrade:${plan.slug}` }, { monthlyCredits: plan.monthlyCredits });
      await this.limits.apply(tx, workspaceId, plan, sub.id);
    } else if (renewalOk) {
      const early = cur!.status === 'active' && cur!.currentPeriodEnd > now;
      sub = await tx.subscription.update({
        where: { id: cur!.id },
        data: early
          ? { currentPeriodEnd: addCycle(cur!.currentPeriodEnd, intent.cycle), appliedPrice, nextPlanId: null, nextBillingCycle: null, cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null, dunningStage: null }
          : { status: 'active', currentPeriodStart: now, currentPeriodEnd: addCycle(now, intent.cycle), appliedPrice, nextPlanId: null, nextBillingCycle: null, cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null, dunningStage: null },
      });
      lines.push({ key: 'billingDoc.line.renewal', label: '', params: { plan: this.plans.name(plan, 'fr'), cycle: intent.cycle }, amount: intent.amountBeforePromo, planId: plan.id, cycle: intent.cycle });
      if (!early) await this.credits.ensurePeriod(tx, workspaceId, plan.monthlyCredits, now);
      // a discount code paid with a renewal is used too (tester report 2026-10-21 UX-011: no redemption was written, the
      // admin count stayed 0 and the code could be reused); its periods count from this payment
      if (promo && !cur!.promoRedemptionId) {
        const rid = await this.promos.record(tx, promo, workspaceId, intent.userId ?? (await this.ownerId(tx, workspaceId)));
        sub = await tx.subscription.update({ where: { id: sub.id }, data: { promoRedemptionId: rid, ...(promo.kind === 'percent_discount' ? { discountPct: promo.value } : {}) } });
      }
      // a renewal invoice already issued (J−7 / J0) is the one paid now
      const pending = await tx.invoice.findFirst({ where: { subscriptionId: cur!.id, kind: 'subscription', status: { in: ['upcoming', 'unpaid'] } } });
      if (pending) {
        await tx.invoice.update({ where: { id: pending.id }, data: { status: 'paid', paidAt: paid.paidAt, method: paid.method, amount: paid.amount || pending.amount, dunningStage: null } });
        await this.limits.apply(tx, workspaceId, plan, sub.id);
        await this.afterPaid(tx, workspaceId, sub, plan);
        return { invoiceId: pending.id };
      }
      await this.limits.apply(tx, workspaceId, plan, sub.id);
    } else {
      // new period (from trial / free / expired / a cycle change); the running row ends now
      if (cur) await tx.subscription.update({ where: { id: cur.id }, data: { status: 'cancelled', cancelledAt: now, cancelReason: 'replaced', dunningStage: cur.status === 'dunning' ? cur.dunningStage : null } });
      const redemptionId = promo ? await this.promos.record(tx, promo, workspaceId, intent.userId ?? (await this.ownerId(tx, workspaceId))) : null;
      sub = await tx.subscription.create({
        data: { workspaceId, planId: plan.id, planVersion: plan.version, status: 'active', billingCycle: intent.cycle, provider: paid.provider === 'manual' ? 'manual' : 'chargily', appliedPrice, discountPct: promo?.kind === 'percent_discount' ? promo.value : null, promoRedemptionId: redemptionId, currentPeriodStart: now, currentPeriodEnd: addCycle(now, intent.cycle) },
      });
      lines.push({ key: 'billingDoc.line.plan', label: '', params: { plan: this.plans.name(plan, 'fr'), cycle: intent.cycle }, amount: fullPrice, planId: plan.id, cycle: intent.cycle });
      if (intent.prorataDays && intent.amountBeforePromo < fullPrice) lines.push({ key: 'billingDoc.line.unused', label: '', params: { days: intent.prorataDays }, amount: intent.amountBeforePromo - fullPrice });
      await this.limits.apply(tx, workspaceId, plan, sub.id);
      // the new period opens with the new plan's monthly credits
      await this.credits.ensurePeriod(tx, workspaceId, plan.monthlyCredits, now);
    }
    if (promo && upgradeOk && !cur!.promoRedemptionId) {
      const rid = await this.promos.record(tx, promo, workspaceId, intent.userId ?? (await this.ownerId(tx, workspaceId)));
      await tx.subscription.update({ where: { id: sub.id }, data: { promoRedemptionId: rid } });
    }
    if (promo && intent.amount !== intent.amountBeforePromo) lines.push({ key: 'billingDoc.line.promo', label: '', params: { code: promo.code }, amount: intent.amount - intent.amountBeforePromo });
    const inv = await this.invoices.create(tx, { workspaceId, kind: 'subscription', status: 'paid', amount: paid.amount, lines, subscriptionId: sub.id, method: paid.method, paidAt: paid.paidAt });
    await this.afterPaid(tx, workspaceId, sub, plan);
    return { invoiceId: inv.id };
  }

  private async afterPaid(tx: Tx, workspaceId: string, sub: Subscription, plan: Plan) {
    await this.promos.payReferral(tx, workspaceId);
    await this.emitWorkspace(tx, workspaceId, { ...sub, plan });
  }

  private async ownerId(tx: Tx, workspaceId: string) {
    return (await tx.membership.findFirstOrThrow({ where: { workspaceId, role: 'owner' }, select: { userId: true } })).userId;
  }

  /**
   * Payment of an issued invoice (`POST /billing/invoices/:id/pay`, manual payment for the full remaining amount).
   * Subscription renewal invoice ⇒ the subscription is renewed (booked downgrade applied), at any dunning stage —
   * also after J+7: a new paid period replaces the free subscription. Pauses are lifted at once.
   */
  async payInvoiceIn(tx: Tx, invoiceId: string, paid: PaidInfo, now = new Date()): Promise<{ invoiceId: string | null }> {
    const workspaceId = TenantContext.workspaceId();
    await lockBilling(tx, workspaceId);
    const inv = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId } });
    if (inv.status === 'paid') return { invoiceId: inv.id };
    await tx.invoice.update({ where: { id: inv.id }, data: { status: 'paid', paidAt: paid.paidAt, method: paid.method, dunningStage: null } });
    if (inv.kind === 'subscription' && inv.subscriptionId) await this.renewFromInvoice(tx, workspaceId, inv, now);
    else await this.emitWorkspace(tx, workspaceId);
    return { invoiceId: inv.id };
  }

  private async renewFromInvoice(tx: Tx, workspaceId: string, inv: Invoice, now: Date) {
    const sub = await tx.subscription.findFirstOrThrow({ where: { id: inv.subscriptionId! } });
    const line = ((inv.lines as unknown as InvoiceLine[]) ?? []).find((l) => l.planId);
    const plan = (await this.plans.byId(line?.planId ?? sub.nextPlanId ?? sub.planId))!;
    const cycle: BillingCycle = line?.cycle ?? sub.nextBillingCycle ?? sub.billingCycle;
    let row: Subscription;
    if (sub.status === 'active' || sub.status === 'dunning') {
      const early = sub.status === 'active' && sub.currentPeriodEnd > now;
      const start = early ? sub.currentPeriodStart : now;
      const end = early ? addCycle(sub.currentPeriodEnd, cycle) : addCycle(now, cycle);
      row = await tx.subscription.update({ where: { id: sub.id }, data: { status: 'active', dunningStage: null, planId: plan.id, planVersion: plan.version, billingCycle: cycle, appliedPrice: inv.amount, currentPeriodStart: start, currentPeriodEnd: end, nextPlanId: null, nextBillingCycle: null, cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null } });
    } else {
      // expired at J+7: the free subscription created by the expiry rule ends now, a new paid period starts
      const cur = await currentSub(tx, workspaceId);
      if (cur) await tx.subscription.update({ where: { id: cur.id }, data: { status: 'cancelled', cancelledAt: now, cancelReason: 'replaced' } });
      row = await tx.subscription.create({ data: { workspaceId, planId: plan.id, planVersion: plan.version, status: 'active', billingCycle: cycle, provider: sub.provider === 'none' ? 'chargily' : sub.provider, appliedPrice: inv.amount, currentPeriodStart: now, currentPeriodEnd: addCycle(now, cycle) } });
      await tx.invoice.update({ where: { id: inv.id }, data: { subscriptionId: row.id } });
    }
    await this.limits.apply(tx, workspaceId, plan, row.id);
    await this.credits.ensurePeriod(tx, workspaceId, plan.monthlyCredits, now);
    await this.afterPaid(tx, workspaceId, row, plan);
  }

  // --- the 02 §5 single rule ----------------------------------------------------------------------------------------------
  /**
   * Ends `sub` (trial at `trialEndsAt`, cancelled at period end, dunning at J+7) and starts the free subscription the same
   * instant. Pauses what exceeds the free plan. Inside the caller's transaction, tenant of the workspace set.
   */
  async expire(tx: Tx, sub: Subscription, cause: 'trial' | 'cancelled' | 'dunning', now = new Date()): Promise<Subscription> {
    const workspaceId = sub.workspaceId;
    const free = await this.plans.free();
    await tx.subscription.update({ where: { id: sub.id }, data: { status: 'expired', ...(cause === 'dunning' ? { dunningStage: 'expired' } : {}), nextPlanId: null, nextBillingCycle: null } });
    const row = await tx.subscription.create({ data: { workspaceId, planId: free.id, planVersion: free.version, status: 'active', billingCycle: 'none', provider: 'none', appliedPrice: 0, currentPeriodStart: now, currentPeriodEnd: addMonths(now, 12) } });
    await this.limits.apply(tx, workspaceId, free, row.id);
    await this.credits.ensurePeriod(tx, workspaceId, free.monthlyCredits, now);
    await this.notifications.emit(tx, { type: 'subscription_expired', workspaceId, target: { owner: true }, key: `subscription_expired:${sub.id}`, data: { periodEnd: (sub.trialEndsAt ?? sub.currentPeriodEnd).toISOString(), planSlug: 'free' } });
    await this.emitWorkspace(tx, workspaceId, { ...row, plan: free });
    return row;
  }

  /** WS `workspace.updated` with the subscription block (03-events §2). */
  async emitWorkspace(tx: Tx, workspaceId: string, sub?: SubWithPlan | null) {
    const s = sub ?? (await currentSub(tx, workspaceId));
    const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { status: true, stockMode: true, locale: true } });
    const payload: WorkspaceSubscriptionEvent & { id: string } = {
      id: workspaceId,
      workspace: { status: ws.status, subscription: { planSlug: s?.plan.slug ?? 'free', status: s?.status ?? 'expired', dunningStage: s?.dunningStage ?? null, currentPeriodEnd: (s?.currentPeriodEnd ?? new Date()).toISOString() } },
    };
    await this.outbox.ws(tx, `ws:${workspaceId}`, 'workspace.updated', { ...payload, workspace: { ...payload.workspace, stockMode: ws.stockMode, locale: ws.locale } } as unknown as Record<string, unknown>, `workspace.updated:sub:${s?.id ?? 'none'}:${s?.status ?? ''}:${s?.dunningStage ?? ''}:${s?.planId ?? ''}:${s?.currentPeriodEnd.getTime() ?? 0}:${Date.now()}`);
  }

  // --- read model ----------------------------------------------------------------------------------------------------------
  /** `GET /billing/subscription`. */
  async dto(locale: string): Promise<SubscriptionDto> {
    const workspaceId = TenantContext.workspaceId();
    const db = prisma as unknown as Tx;
    let sub = await currentSub(db, workspaceId);
    if (!sub) {
      // legacy workspace without any current row: the free plan applies (02 §5)
      const free = await this.plans.free();
      const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { createdAt: true } });
      sub = { id: '', workspaceId, planId: free.id, planVersion: free.version, status: 'active', billingCycle: 'none', provider: 'none', appliedPrice: 0, discountPct: null, promoRedemptionId: null, currentPeriodStart: ws.createdAt, currentPeriodEnd: addMonths(ws.createdAt, 12), trialEndsAt: null, cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null, dunningStage: null, nextPlanId: null, nextBillingCycle: null, providerSubscriptionId: null, providerCustomerId: null, createdAt: ws.createdAt, updatedAt: ws.createdAt, plan: free };
    }
    const period = creditPeriod(sub.currentPeriodStart);
    const [usage, paused, unpaid, next, expired] = await Promise.all([
      this.limits.usage(db, period.start),
      this.limits.paused(db),
      prisma.invoice.findFirst({ where: { status: 'unpaid' }, orderBy: { createdAt: 'desc' } }),
      sub.nextPlanId ? this.plans.byId(sub.nextPlanId) : Promise.resolve(null),
      sub.provider === 'none' && sub.billingCycle === 'none' && sub.status === 'active' ? prisma.subscription.findFirst({ where: { status: 'expired' }, orderBy: { updatedAt: 'desc' }, include: { plan: true } }) : Promise.resolve(null),
    ]);
    const paidSub = isPaid(sub);
    const actions: SubscriptionDto['actions'] = [
      { key: 'change_plan', enabled: true },
      { key: 'cancel', enabled: paidSub && sub.status === 'active' && !sub.cancelAtPeriodEnd, ...(paidSub && sub.status === 'active' && !sub.cancelAtPeriodEnd ? {} : { reasonCode: sub.cancelAtPeriodEnd ? 'CONFLICT' : 'PLAN_IS_FREE' }) },
      { key: 'pay_invoice', enabled: !!unpaid, ...(unpaid ? {} : { reasonCode: 'CONFLICT' }) },
      { key: 'buy_pack', enabled: true },
    ];
    return {
      id: sub.id,
      plan: this.plans.toDto(sub.plan, locale, sub.planId),
      status: sub.status,
      billingCycle: sub.billingCycle,
      provider: sub.provider,
      appliedPrice: sub.appliedPrice,
      discountPct: sub.discountPct,
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      dunningStage: sub.dunningStage,
      trialEndsAt: iso(sub.trialEndsAt),
      usage,
      pausedResources: paused,
      nextPlan: next ? { id: next.id, slug: next.slug, name: this.plans.name(next, locale), cycle: (sub.nextBillingCycle === 'yearly' ? 'yearly' : 'monthly') as 'monthly' | 'yearly', at: sub.currentPeriodEnd.toISOString() } : null,
      unpaidInvoice: unpaid ? { id: unpaid.id, number: unpaid.number, amount: unpaid.amount, remaining: await this.invoices.remaining(db, unpaid), dueAt: iso(unpaid.dueAt) } : null,
      expiredFrom: expired && expired.plan.slug !== 'free' ? { planSlug: expired.plan.slug, planName: this.plans.name(expired.plan, locale), at: expired.updatedAt.toISOString() } : null,
      actions,
    };
  }
}
