// BIL-01 / 02 §5 — the plans catalogue (`GET /plans`, public) and the plan helpers of the billing module.
import { Injectable } from '@nestjs/common';
import type { PlanLimitsView, PlanPublicDto } from '@djaber/shared';
import { prisma, TenantContext, type Plan } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import { I18nService } from '../../core/i18n/i18n.service';

@Injectable()
export class PlanService {
  constructor(private readonly i18n: I18nService) {}

  static limitsOf(plan: Plan): PlanLimitsView {
    return {
      maxPages: plan.maxPages,
      maxAgents: plan.maxAgents,
      maxProducts: plan.maxProducts,
      maxConversationsPerMonth: plan.maxConversationsPerMonth,
      maxMembers: plan.maxMembers,
      maxApiKeys: plan.maxApiKeys,
      maxWebhooks: plan.maxWebhooks,
      monthlyCredits: plan.monthlyCredits,
      features: plan.features,
    };
  }

  name(plan: Pick<Plan, 'name'>, locale: string) {
    return this.i18n.pick(plan.name, locale);
  }

  toDto(plan: Plan, locale: string, currentPlanId?: string | null): PlanPublicDto {
    const full = plan.priceMonthly * 12;
    return {
      id: plan.id,
      slug: plan.slug,
      name: this.i18n.pick(plan.name, locale),
      // a tagline the admin did not translate into the viewer's language is left out, not shown in French (UX-056 leftovers)
      description: this.i18n.pickOwn(plan.description, locale),
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      yearlyDiscountPct: full > 0 ? Math.round(((full - plan.priceYearly) / full) * 100) : 0,
      trialDays: plan.trialDays,
      limits: PlanService.limitsOf(plan),
      isFeatured: plan.isFeatured,
      ...(currentPlanId !== undefined ? { current: plan.id === currentPlanId } : {}),
    };
  }

  /** `GET /plans`: visible, active, not archived (sortOrder). */
  async list(locale: string): Promise<PlanPublicDto[]> {
    const rows = await TenantContext.runSystem(() => prisma.plan.findMany({ where: { isActive: true, isVisible: true, archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }] }));
    return rows.map((p) => this.toDto(p, locale));
  }

  /** A plan that can be bought (404 PLAN_NOT_FOUND otherwise). */
  async buyable(id: string): Promise<Plan> {
    const p = await TenantContext.runSystem(() => prisma.plan.findUnique({ where: { id } }));
    if (!p || !p.isActive || !p.isVisible || p.archivedAt) throw new AppException('PLAN_NOT_FOUND');
    return p;
  }

  free(): Promise<Plan> {
    return TenantContext.runSystem(() => prisma.plan.findUniqueOrThrow({ where: { slug: 'free' } }));
  }

  bySlug(slug: string): Promise<Plan | null> {
    return TenantContext.runSystem(() => prisma.plan.findUnique({ where: { slug } }));
  }

  byId(id: string): Promise<Plan | null> {
    return TenantContext.runSystem(() => prisma.plan.findUnique({ where: { id } }));
  }
}
