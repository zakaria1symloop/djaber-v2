'use client';
// Plan cards of the public pricing page and the landing (Figma "PUB — Pricing page (plans · FAQ · CTA)", PUB-02):
// plans from `GET /plans` (the API lists `Plan.isActive && visibleOnPricing` only — "Agence" is a private offer),
// price per cycle, "Populaire" = `isFeatured` (lit border), feature lines, CTA → sign-up with the 14-day trial (D60).
import { formatNumber } from '@djaber/shared';
import { buttonClass, PlanCard } from '@djaber/ui';
import type { Cycle } from '@/features/billing/logic';
import { Link } from '@/i18n/navigation';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { cardPrice, isFree, planIntentHref, planLines, signupHref, type PublicPlan } from './logic';

export function PricingCards({ plans, cycle }: { plans: PublicPlan[]; cycle: Cycle }) {
  const t = useT();
  const signedIn = useSession().status === 'authenticated';
  if (!plans.length) return <p className="text-center text-[13px] text-text-muted">{t('public.pricing.empty')}</p>;
  return (
    <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="pricing-cards" data-cycle={cycle}>
      {plans.map((p) => {
        const free = isFree(p);
        return (
          <PlanCard
            key={p.id}
            data-testid="pricing-plan"
            data-plan={p.slug}
            data-featured={p.isFeatured ? 'true' : undefined}
            current={p.isFeatured}
            name={p.name}
            badge={p.isFeatured ? t('public.pricing.badge.featured') : undefined}
            price={formatNumber(cardPrice(p, cycle))}
            unit={free || cycle === 'monthly' ? t('public.pricing.unit.monthly') : t('public.pricing.unit.yearly')}
            description={p.description || undefined}
            features={planLines(p, t, formatNumber)}
            note={!free && cycle === 'yearly' ? t('public.pricing.billedYearly', { amount: formatNumber(p.priceYearly) }) : undefined}
            action={
              signedIn ? (
                // full-test 15/11 PUBLIC-13: a signed-in member goes to Plan & facturation with this plan (route map /pricing)
                <Link href={planIntentHref({ plan: p.slug, cycle })} className={buttonClass({ variant: 'primary', className: 'w-full' })} data-testid={`pricing-cta-${p.slug}`}>
                  {t('public.pricing.cta.member')}
                </Link>
              ) : (
                <Link href={signupHref(p, cycle)} className={buttonClass({ variant: 'primary', className: 'w-full' })} data-testid={`pricing-cta-${p.slug}`}>
                  {free || p.trialDays <= 0 ? t('public.pricing.cta.free') : t('public.pricing.cta.trial', { days: p.trialDays })}
                </Link>
              )
            }
          />
        );
      })}
    </div>
  );
}
