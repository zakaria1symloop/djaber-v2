'use client';
// /admin/credits — Figma "ADM-15 — Platform admin — credit packs & promo codes (incl. store in-app purchases)": KPIs,
// packs table (store ids read-only, store price tiers, MASQUÉ MOBILE), rules note, promo codes table (UTILISÉ / EXPIRÉ,
// ✎), new / edit code dialog (like the pack one, UX-006), "Historique des grilles" (CreditPricing versions).
import type { AdminPacksKpis, CreditPackAdminDto, PromoCodeDto } from '@djaber/shared';
import { ActionsMenu, Button, DataTable, EmptyState, FrameNote, ListSkeleton, MonoChip, OpsKpiStrip, OpsKpiTile, OpsPanel, toast, type Column } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useConfirmAction } from '@/components/confirm-action';
import { ListPagination } from '@/features/catalog/ui';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { adminWrite, useAdminInvalidate, useAdminList } from '@/features/admin/api';
import { PackDialog, PricingHistoryDialog, PromoDialog, RedemptionsDialog } from '@/features/admin/credits/parts';
import { usePlatform } from '@/features/admin/platform';
import { PROMO_LIST } from '@/features/admin/specs';
import { AdminPill, Num, shortName, useFormats } from '@/features/admin/ui';
import { errorMessage } from '@/lib/forms';
import { compactAmount } from '@/lib/money';
import { useT } from '@/lib/i18n';
import { useListState } from '@/lib/use-list-state';

export default function AdminCreditsPage() {
  const t = useT();
  const confirm = useConfirmAction();
  const f = useFormats();
  const { can } = usePlatform();
  const write = can('admin.billing.write');
  const list = useListState(PROMO_LIST);
  const packs = useAdminList<CreditPackAdminDto, { kpis?: AdminPacksKpis }>('/admin/credit-packs');
  const promos = useAdminList<PromoCodeDto>('/admin/promo-codes', list.apiQuery());
  const invalidate = useAdminInvalidate();
  const [pack, setPack] = useState<{ pack: CreditPackAdminDto | null } | null>(null);
  const [promo, setPromo] = useState<{ promo: PromoCodeDto | null } | null>(null);
  const [redemptions, setRedemptions] = useState<PromoCodeDto | null>(null);
  const [history, setHistory] = useState(false);
  const deactivate = useMutation({ mutationFn: (id: string) => adminWrite(`/admin/promo-codes/${id}/deactivate`, 'POST', {}) });
  const removePack = useMutation({ mutationFn: (id: string) => adminWrite(`/admin/credit-packs/${id}`, 'DELETE') });
  const k = packs.data?.meta?.kpis;

  const packState = (p: CreditPackAdminDto) =>
    !p.isActive ? (
      <MonoChip>{t('admin.credits.state.inactive')}</MonoChip>
    ) : !p.visibleMobile ? (
      <MonoChip>{t('admin.credits.state.hiddenMobile')}</MonoChip>
    ) : (
      <MonoChip tone="success">{p.isFeatured ? t('admin.credits.state.activePopular') : t('admin.credits.state.active')}</MonoChip>
    );
  const packColumns: Column<CreditPackAdminDto>[] = [
    { key: 'name', header: t('admin.credits.col.pack'), hideable: false, cell: (p) => p.name },
    { key: 'credits', header: t('admin.credits.col.credits'), cell: (p) => <Num value={p.credits} /> },
    { key: 'price', header: t('admin.credits.col.priceWeb'), cell: (p) => <Num value={p.priceWebDzd} /> },
    { key: 'google', header: t('admin.credits.col.google'), hideBelow: 'lg', cell: (p) => <span dir="ltr">{p.googleProductId ?? '—'}</span> },
    { key: 'apple', header: t('admin.credits.col.apple'), hideBelow: 'lg', cell: (p) => <span dir="ltr">{p.appleProductId ?? '—'}</span> },
    { key: 'store', header: t('admin.credits.col.storePrice'), hideBelow: 'xl', cell: (p) => (p.visibleMobile ? `${p.storePriceLabel ?? '—'}${p.storeTier ? ` (${p.storeTier})` : ''}` : t('admin.credits.webOnly')) },
    { key: 'sales', header: t('admin.credits.col.sales'), cell: (p) => <Num value={p.sales30d} /> },
    { key: 'state', header: t('admin.credits.col.state'), cell: packState },
  ];
  // delete: only a pack never bought (server descriptor; once bought ⇒ greyed, deactivate instead — UX-010)
  const packMenu = (p: CreditPackAdminDto) => {
    const del = p.actions?.find((a) => a.key === 'delete');
    return (
      <ActionsMenu
        label={t('action.actions')}
        heading={p.name}
        actions={[
          { key: 'edit', label: t('admin.credits.pack.edit'), onSelect: () => setPack({ pack: p }) },
          ...(del
            ? [
                {
                  key: 'delete',
                  label: t('admin.credits.pack.delete'),
                  destructive: true,
                  separated: true,
                  disabledReason: del.enabled ? undefined : t(`error.${del.reasonCode}`, { count: p.purchases }),
                  onSelect: () =>
                    confirm.ask({
                      title: t('admin.credits.pack.deleteConfirm', { name: p.name }),
                      confirmLabel: t('action.delete'),
                      destructive: true,
                      run: () =>
                        removePack
                          .mutateAsync(p.id)
                          .then(() => {
                            void invalidate('/admin/credit-packs');
                            toast(t('admin.credits.pack.deleted', { name: p.name }));
                          })
                          .catch((e) => toast({ tone: 'danger', message: errorMessage(e, t) })),
                    }),
                },
              ]
            : []),
        ]}
      />
    );
  };
  const effect = (p: PromoCodeDto) => {
    const v = p.kind === 'percent_discount' ? `−${p.value} %` : p.kind === 'fixed_discount' ? `−${f.money(p.value)}` : p.kind === 'credits' ? t('admin.credits.effect.credits', { count: f.num(p.value) }) : t('admin.credits.effect.trial', { days: p.value });
    const per = p.periods ? ` ${t('admin.credits.effect.periods', { count: p.periods })}` : '';
    const plans = p.planSlugs.length ? ` · ${p.planSlugs.join(' & ')}` : '';
    return `${v}${per}${plans}`;
  };
  const promoMenu = (p: PromoCodeDto) => (
    <ActionsMenu
      label={t('action.actions')}
      heading={p.code}
      actions={[
        ...(write ? [{ key: 'edit', label: t('admin.credits.promo.edit'), onSelect: () => setPromo({ promo: p }) }] : []),
        { key: 'redemptions', label: t('admin.credits.promo.redemptions', { count: p.uses }), onSelect: () => setRedemptions(p) },
        ...(write && p.state === 'active'
          ? [
              {
                key: 'deactivate',
                label: t('admin.credits.promo.deactivate'),
                destructive: true,
                separated: true,
                onSelect: () =>
                  confirm.ask({
                    title: t('admin.credits.promo.deactivateConfirm', { code: p.code }),
                    confirmLabel: t('admin.credits.promo.deactivate'),
                    destructive: true,
                    run: () =>
                      deactivate
                        .mutateAsync(p.id)
                        .then(() => {
                          void invalidate('/admin/promo-codes');
                          toast(t('admin.credits.promo.deactivated', { code: p.code }));
                        })
                        .catch((e) => toast({ tone: 'danger', message: errorMessage(e, t) })),
                  }),
              },
            ]
          : []),
      ]}
    />
  );
  const promoColumns: Column<PromoCodeDto>[] = [
    { key: 'code', header: t('admin.credits.col.code'), hideable: false, cell: (p) => <span dir="ltr" className="font-medium">{p.code}</span> },
    { key: 'effect', header: t('admin.credits.col.effect'), cell: effect },
    { key: 'conditions', header: t('admin.credits.col.conditions'), hideBelow: 'lg', cell: (p) => [t(`admin.credits.target.${p.target}`), p.targetWorkspace?.name, t('admin.credits.perWorkspace', { count: p.perWorkspaceLimit })].filter(Boolean).join(' · ') },
    { key: 'validity', header: t('admin.credits.col.validity'), hideBelow: 'lg', cell: (p) => (p.validFrom || p.validTo ? `${f.short(p.validFrom)} → ${f.short(p.validTo)}` : t('admin.credits.permanent')) },
    { key: 'uses', header: t('admin.credits.col.uses'), cell: (p) => <span dir="ltr">{f.num(p.uses)} / {p.maxUses ? f.num(p.maxUses) : t('admin.common.unlimited')}</span> },
    { key: 'by', header: t('admin.credits.col.createdBy'), hideBelow: 'xl', cell: (p) => (typeof p.createdBy === 'string' ? p.createdBy : shortName(p.createdBy)) },
    { key: 'state', header: t('admin.credits.col.state'), cell: (p) => <AdminPill group="Promo.state" value={p.state}>{t(`admin.credits.promoState.${p.state}`)}</AdminPill> },
  ];
  return (
    <AdminPage
      permission="admin.billing.read"
      title={t('admin.credits.title')}
      description={t('admin.credits.description')}
      actions={
        <>
          <Button variant="ghost" onClick={() => setHistory(true)}>
            {t('admin.credits.history.cta')}
          </Button>
          {write ? (
            <>
              <Button variant="primary" onClick={() => setPack({ pack: null })} data-testid="new-pack">
                {t('admin.credits.pack.cta')}
              </Button>
              <Button variant="primary" onClick={() => setPromo({ promo: null })} data-testid="new-promo">
                {t('admin.credits.promo.cta')}
              </Button>
            </>
          ) : null}
        </>
      }
    >
      <OpsKpiStrip label={t('admin.credits.kpis')}>
        <OpsKpiTile context={k ? t('admin.credits.kpi.split', { web: k.packsSold30d.web, mobile: k.packsSold30d.mobile }) : undefined} value={k ? f.num(k.packsSold30d.total) : '—'} unit={t('admin.credits.kpi.sold')} />
        <OpsKpiTile context={t('admin.credits.kpi.netContext')} value={k ? compactAmount(k.netDzd30d, f.locale) : '—'} unit={t('admin.credits.kpi.net')} />
        <OpsKpiTile context={k ? t('admin.credits.kpi.expiring', { count: k.codesExpiringThisWeek }) : undefined} value={k ? f.num(k.activeCodes) : '—'} unit={t('admin.credits.kpi.codes')} />
        <OpsKpiTile context={t('admin.credits.kpi.grantsContext')} value={k ? f.num(k.creditsGranted30d) : '—'} unit={t('admin.credits.kpi.grants')} />
        <OpsKpiTile value={k ? `${k.buyingWorkspacesPct} %` : '—'} unit={t('admin.credits.kpi.buying')} />
      </OpsKpiStrip>
      <OpsPanel title={t('admin.credits.packs.title')} sub={t('admin.credits.packs.sub')} data-testid="packs-panel">
        {packs.isPending ? (
          <ListSkeleton rows={4} columns={6} label={t('common.loading')} />
        ) : packs.isError ? (
          <AdminQueryError error={packs.error} onRetry={() => void packs.refetch()} />
        ) : packs.data.rows.length === 0 ? (
          <EmptyState title={t('admin.credits.packs.empty')} action={write ? { label: t('admin.credits.pack.cta'), onClick: () => setPack({ pack: null }), variant: 'primary' } : undefined} />
        ) : (
          <DataTable<CreditPackAdminDto>
            label={t('admin.credits.packs.title')}
            columns={packColumns}
            rows={packs.data.rows}
            rowKey={(p) => p.id}
            actionsLabel={t('action.actions')}
            rowActions={write ? packMenu : undefined}
          />
        )}
        <FrameNote className="mt-3">{t('admin.credits.packs.rules')}</FrameNote>
      </OpsPanel>
      <OpsPanel title={t('admin.credits.promos.title')} data-testid="promos-panel">
        {promos.isPending ? (
          <ListSkeleton rows={5} columns={6} label={t('common.loading')} />
        ) : promos.isError ? (
          <AdminQueryError error={promos.error} onRetry={() => void promos.refetch()} />
        ) : promos.data.rows.length === 0 ? (
          <EmptyState title={t('admin.credits.promos.empty')} action={write ? { label: t('admin.credits.promo.cta'), onClick: () => setPromo({ promo: null }), variant: 'primary' } : undefined} />
        ) : (
          <DataTable<PromoCodeDto>
            label={t('admin.credits.promos.title')}
            columns={promoColumns}
            rows={promos.data.rows}
            rowKey={(p) => p.id}
            actionsLabel={t('action.actions')}
            rowActions={promoMenu}
            footer={<ListPagination page={list.state.page} pageSize={list.state.pageSize} total={promos.data.total} onChange={(p) => list.set(p)} />}
          />
        )}
        <FrameNote className="mt-3">{t('admin.credits.promos.rules')}</FrameNote>
      </OpsPanel>
      <PackDialog pack={pack?.pack ?? null} open={!!pack} onClose={() => setPack(null)} />
      <PromoDialog promo={promo?.promo ?? null} open={!!promo} onClose={() => setPromo(null)} />
      <RedemptionsDialog promo={redemptions} onClose={() => setRedemptions(null)} />
      <PricingHistoryDialog open={history} onClose={() => setHistory(false)} />
      {confirm.element}
    </AdminPage>
  );
}
