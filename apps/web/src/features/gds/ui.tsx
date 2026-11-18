'use client';
// Small pieces shared by the GDS operations screens: status / payment / cash pills (REF — Component sheet), the period
// dropdown of the lists ("Période : 30 j ⌄"), the advanced-mode gate (simple mode keeps these pages out of the
// sidebar, a direct link explains it) and the KPI skeleton row.
import { formatDate, formatMoney, type AppLocale } from '@djaber/shared';
import { buttonClass, EmptyState, FilterChips, FilterDateRange, FilterDropdown, KpiTileSkeleton, Ltr, StatusPill } from '@djaber/ui';
import { Boxes } from 'lucide-react';
import type { ReactNode } from 'react';
import { AppPage } from '@/components/app-page';
import { withoutYear } from '@/features/catalog/stock/logic';
import { Link } from '@/i18n/navigation';
import { iso, rangeArrow } from '@/lib/format-message';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterText } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import type { ListController } from '@/lib/use-list-state';
import { GDS_PERIOD_KEYS, type CashCategory, type GdsPaymentStatus, type GdsPeriodKey, type PurchaseStatus, type SaleStatus } from './contracts';
import { unitsLabel } from './logic';

const PILL = '!rounded-[4px]';

export function PurchaseStatusPill({ status, units }: { status: PurchaseStatus; units?: { ordered: number; received: number } }) {
  const t = useT();
  return (
    <StatusPill enumKey="Purchase.status" value={status} className={PILL}>
      {t(`enum.Purchase.status.${status}`)}
      {status === 'partial' && units ? <Ltr>{` ${unitsLabel(units)}`}</Ltr> : null}
    </StatusPill>
  );
}
export function PaymentPill({ status, kind = 'purchase', remaining }: { status: GdsPaymentStatus; kind?: 'purchase' | 'sale'; remaining?: number }) {
  const t = useT();
  return (
    <StatusPill enumKey="Gds.paymentStatus" value={status} className={PILL}>
      {t(`enum.${kind === 'sale' ? 'Sale' : 'Purchase'}.paymentStatus.${status}`)}
      {remaining && remaining > 0 && status !== 'paid' ? ` · ${t('gds.remainingShort', { amount: iso(formatMoney(remaining)) })}` : null}
    </StatusPill>
  );
}
export function SaleStatusPill({ status, paymentStatus }: { status: SaleStatus; paymentStatus: GdsPaymentStatus }) {
  const t = useT();
  if (status === 'completed') return <PaymentPill status={paymentStatus} kind="sale" />;
  return (
    <StatusPill enumKey="Sale.status" value={status} className={PILL}>
      {t(`enum.Sale.status.${status}`)}
    </StatusPill>
  );
}
export function CashCategoryPill({ category }: { category: CashCategory }) {
  const t = useT();
  return (
    <StatusPill enumKey="Cash.category" value={category} className={PILL}>
      {t(`enum.Cash.category.${category}`)}
    </StatusPill>
  );
}

/** `05 oct.` (Africa/Algiers day `YYYY-MM-DD`). */
export const useDayLabel = () => {
  const locale = useLocaleCode() as AppLocale;
  return (day: string) => withoutYear(formatDate(`${day}T12:00:00Z`, locale));
};

/**
 * "Période : 30 j ⌄" — the API `period` key (today · 7 d · 30 d · this month · last month · 90 d · year) or a custom
 * `from` / `to`; `defaultKey` is what the server applies when nothing is set (stats default 30 d).
 */
export function PeriodDropdown({ list, defaultKey, keys = GDS_PERIOD_KEYS, align }: { list: ListController; defaultKey?: GdsPeriodKey; keys?: readonly GdsPeriodKey[]; align?: 'start' | 'end' }) {
  const t = useT();
  const day = useDayLabel();
  const s = list.state;
  const period = filterText(s, 'period') as GdsPeriodKey | '';
  const from = filterText(s, 'from');
  const to = filterText(s, 'to');
  const custom = !!(from || to);
  const label = custom ? `${from ? day(from) : '…'} ${rangeArrow(t.locale)} ${to ? day(to) : '…'}` : period ? t(`gds.period.${period}`) : defaultKey ? t(`gds.period.${defaultKey}`) : null;
  return (
    <FilterDropdown label={label ? t('common.period', { label }) : t('gds.period.label')} align={align}>
      <div className="flex flex-col gap-3" data-testid="period-dropdown">
        <FilterChips
          label={t('gds.period.label')}
          options={keys.map((k) => ({ value: k, label: t(`gds.period.${k}`) }))}
          value={!custom && period ? [period] : !custom && defaultKey ? [defaultKey] : []}
          onChange={(v) => list.setFilters({ period: v[0] && v[0] !== defaultKey ? v[0] : null, from: null, to: null })}
        />
        <FilterDateRange from={from} to={to} onChange={(r) => list.setFilters({ from: r.from || null, to: r.to || null, period: null })} labels={{ from: t('common.from'), to: t('common.to'), presets: t('gds.period.custom'), invalid: t('error.INVALID_DATE_RANGE') }} />
      </div>
    </FilterDropdown>
  );
}

/** Simple stock mode: suppliers / purchases / sales / cash / inventories are advanced-mode screens (D12, LST-05). */
export function AdvancedOnly({ title, children }: { title: string; children: ReactNode }) {
  const t = useT();
  const { workspace } = useSession();
  if (workspace && workspace.stockMode !== 'advanced') {
    return (
      <AppPage wide title={title}>
        <EmptyState icon={<Boxes className="size-5" />} title={t('gds.simple.title')} description={t('gds.simple.description')} />
        <div className="flex justify-center">
          <Link href="/settings/stock-mode" className={buttonClass({ variant: 'primary' })} data-testid="gds-stock-mode">
            {t('movements.simple.cta')}
          </Link>
        </div>
      </AppPage>
    );
  }
  return <>{children}</>;
}

/** Four KPI tiles while the stats load (`KpiTileSkeleton`: same line boxes as `KpiTile` in every script). */
export function KpiSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <KpiTileSkeleton key={i} className={className} />
      ))}
    </>
  );
}

/** Person name of a `UserRef` ("Nadia F."). */
/** « Karim P. », isolated: inside an Arabic line its full stop stays after the initial (« .Karim P » — STOCK-07 / SALES-CASH-23). */
export const shortName = (u: { firstName: string; lastName: string } | null | undefined): string | null => (u ? iso(`${u.firstName} ${u.lastName ? `${u.lastName[0]}.` : ''}`.trim()) : null);
