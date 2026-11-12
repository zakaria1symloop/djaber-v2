'use client';
// AnalyticsTabs (02-next-route-map §1 `analytics/layout.tsx`, Figma "ANA-02 — Analytics — overview tab + period picker",
// "ANA-02b"): title + revenue definition, "Rapports détaillés →", the 9 tabs (route map wins over the Figma tab
// names: overview + 8 tabs), the period presets with "Personnalisé ⌄" (empty dates → start chosen → applied, client
// check of the 11 §7 range rules), the range chip "05 SEPT. → 05 OCT. 2026 · COMPARÉ À LA PÉRIODE PRÉCÉDENTE" and the
// comparison switch (période précédente / aucune). Period and tab are URL state; tab links keep the period.
import { ANALYTICS_TABS, type AnalyticsRange, type AnalyticsTab } from '@djaber/shared';
import { buttonClass, cn, DateRangeForm, FilterChips, FilterDropdown, MonoChip, PeriodPresets } from '@djaber/ui';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppPage } from '@/components/app-page';
import { usePathname as useNextPathname, useRouter, useSearchParams } from 'next/navigation';
import { useChannels } from '@/features/channels/api';
import { Link, usePathname } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useChannelFilter, usePeriod } from './api';
import { dayLabel } from './format';
import { ANALYTICS_PRESETS, customRangeError, periodHref, todayAlgiers, type PeriodState } from './period';

/* ---------- the range answered by the open tab (chip of the shell) ---------- */
const RangeCtx = createContext<{ range: AnalyticsRange | null; setRange: (r: AnalyticsRange | null) => void }>({ range: null, setRange: () => undefined });
export const useReportRange = (range: AnalyticsRange | null | undefined) => {
  const { setRange } = useContext(RangeCtx);
  useEffect(() => {
    if (range) setRange(range);
  }, [range, setRange]);
};

export const tabHref = (tab: AnalyticsTab) => (tab === 'overview' ? '/analytics' : `/analytics/${tab}`);

export function AnalyticsShell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const { can } = useSession();
  const { period, setPeriod } = usePeriod();
  const [range, setRange] = useState<AnalyticsRange | null>(null);
  const channelId = useChannelFilter();
  const seg = pathname.split('/')[2] ?? 'overview';
  const current: AnalyticsTab = (ANALYTICS_TABS as readonly string[]).includes(seg) ? (seg as AnalyticsTab) : 'overview';
  return (
    <RangeCtx.Provider value={{ range, setRange }}>
      <AppPage
        wide
        title={t('nav.analytics')}
        description={t('analytics.subtitle')}
        permission="analytics.read"
        actions={
          can('reports.read') ? (
            <Link href="/reports" className={buttonClass({ variant: 'secondary' })} data-testid="analytics-reports">
              {t('analytics.reportsLink')}
            </Link>
          ) : undefined
        }
      >
        <nav aria-label={t('analytics.tabs')} className="flex flex-wrap gap-1.5" data-testid="analytics-tabs">
          {ANALYTICS_TABS.map((tab) => (
            <Link
              key={tab}
              href={periodHref(tabHref(tab), period, channelId ? [['channelId', channelId]] : [])}
              prefetch
              aria-current={tab === current ? 'page' : undefined}
              data-tab={tab}
              className={cn(
                'flex h-8 items-center rounded-card border px-3 text-[13px] transition-colors',
                tab === current ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary',
              )}
            >
              {t(`analytics.tab.${tab}`)}
            </Link>
          ))}
        </nav>
        <PeriodPicker period={period} onChange={setPeriod} range={range} extra={<ChannelFilter value={channelId} />} />
        {children}
      </AppPage>
    </RangeCtx.Provider>
  );
}

/** Presets row + "Personnalisé ⌄" + range chip + comparison. Shared by the analytics tabs and the report pages. */
export function PeriodPicker({ period, onChange, range, showCompare = true, extra }: { period: PeriodState; onChange: (p: PeriodState) => void; range: AnalyticsRange | null; showCompare?: boolean; extra?: ReactNode }) {
  const t = useT();
  const locale = useLocaleCode();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: period.from, to: period.to });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDraft({ from: period.from, to: period.to });
      setError(null);
    }
  }, [open, period.from, period.to]);
  const apply = () => {
    const code = customRangeError(draft.from, draft.to);
    if (code) return setError(t(`analytics.range.${code}`));
    setOpen(false);
    onChange({ ...period, period: 'custom', from: draft.from, to: draft.to });
  };
  const customLabel = period.period === 'custom' && period.from && period.to ? `${dayLabel(period.from, locale)} → ${dayLabel(period.to, locale)}` : t('analytics.period.custom');
  const hint = !draft.from && !draft.to ? t('analytics.range.pickBoth') : draft.from && !draft.to ? t('analytics.range.pickEnd') : !draft.from ? t('analytics.range.pickStart') : null;
  const chip = range ? `${dayLabel(range.from, locale)} → ${dayLabel(range.to, locale, true)}${range.compare === 'previous' ? ` · ${t('analytics.compare.chip')}` : ''}` : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3" data-testid="period-picker">
      <PeriodPresets
        label={t('gds.period.label')}
        value={period.period}
        onChange={(v) => onChange({ ...period, period: v as PeriodState['period'], from: '', to: '' })}
        options={ANALYTICS_PRESETS.map((p) => ({ value: p, label: t(`analytics.period.${p}`) }))}
        custom={{
          value: 'custom',
          label: customLabel,
          open,
          onOpenChange: setOpen,
          content: (
            <DateRangeForm
              from={draft.from}
              to={draft.to}
              max={todayAlgiers()}
              onChange={(d) => {
                setDraft(d);
                setError(null);
              }}
              onApply={apply}
              onCancel={() => setOpen(false)}
              error={error}
              hint={hint}
              labels={{ from: t('common.from'), to: t('common.to'), apply: t('action.apply'), cancel: t('action.cancel') }}
            />
          ),
        }}
      />
      <div className="flex flex-wrap items-center gap-2 md:ms-auto">
        {extra}
        {chip ? (
          <MonoChip className="!h-6" title={range ? t('analytics.timezone') : undefined}>
            <bdi data-testid="range-chip">{chip}</bdi>
          </MonoChip>
        ) : null}
        {showCompare ? (
          <FilterDropdown label={t('analytics.compare.label', { value: t(period.compare ? 'analytics.compare.previous' : 'analytics.compare.none') })} align="end">
            <FilterChips
              label={t('analytics.compare.title')}
              options={[
                { value: 'previous', label: t('analytics.compare.previous') },
                { value: 'none', label: t('analytics.compare.none') },
              ]}
              value={[period.compare ? 'previous' : 'none']}
              onChange={(v) => v[0] && onChange({ ...period, compare: v[0] === 'previous' })}
            />
          </FilterDropdown>
        ) : null}
      </div>
    </div>
  );
}

/** "Page : toutes ⌄" — restricts every figure to one connected page (`channelId`, URL state). */
function ChannelFilter({ value }: { value: string | null }) {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = useNextPathname();
  const channels = useChannels();
  const rows = channels.data?.rows ?? [];
  if (!rows.length && !value) return null;
  const set = (id: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (id) p.set('channelId', id);
    else p.delete('channelId');
    router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  const current = rows.find((c) => c.id === value);
  return (
    <FilterDropdown label={t('analytics.channel.label', { value: value ? (current?.name ?? '…') : t('analytics.channel.all') })} count={value ? 1 : 0} align="end">
      <FilterChips
        label={t('analytics.channel.title')}
        options={[{ value: '', label: t('analytics.channel.all') }, ...rows.map((c) => ({ value: c.id, label: `${c.name} (${c.platform === 'facebook' ? 'FB' : 'IG'})` }))]}
        value={[value ?? '']}
        onChange={(v) => set(v[0] || null)}
      />
      <p className="mt-2 ts-label-micro !normal-case text-text-muted">{t('analytics.channel.note')}</p>
    </FilterDropdown>
  );
}
