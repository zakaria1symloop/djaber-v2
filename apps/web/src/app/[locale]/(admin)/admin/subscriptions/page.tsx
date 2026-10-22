'use client';
// /admin/subscriptions — Figma "ADM-05 — Platform admin — subscriptions & invoices" + DLG "Abonnement — créer / modifier",
// "Enregistrer un paiement manuel". KPIs · tabs Abonnements · Factures · Paiements manuels · Packs de crédits (`?tab=`)
// · filters per tab in the URL · row `Actions ⌄` from the server descriptors.
import type { AdminInvoiceRowDto, AdminPackPurchaseRowDto, AdminPaymentRowDto, AdminSubscriptionKpis, AdminSubscriptionRowDto, PlanAdminDto } from '@djaber/shared';
import { ActionsMenu, Button, OpsKpiStrip, OpsKpiTile, PillTabs, type Column } from '@djaber/ui';
import { useMemo, useState } from 'react';
import { AdminPage } from '@/features/admin/admin-page';
import { useAdminGet, useAdminList } from '@/features/admin/api';
import { AdminFilterBar, AdminListBody, type AdminFilter } from '@/features/admin/list-kit';
import { usePlatform } from '@/features/admin/platform';
import { SUBSCRIPTIONS_LIST } from '@/features/admin/specs';
import { AccountingExportDialog, ManualPaymentDialog, RecordPaymentDialog, SubscriptionActionDialog, SubscriptionDialog, type InvoiceRef, type SubAction } from '@/features/admin/subscriptions/dialogs';
import { AdminPill, Money, ShortDate, useFormats } from '@/features/admin/ui';
import { ChangePlanDialog } from '@/features/admin/workspaces/dialogs';
import { toMenuActions } from '@/lib/actions';
import { compactAmount } from '@/lib/money';
import { useT } from '@/lib/i18n';
import type { ApiQuery } from '@/lib/list-state';
import { useListState } from '@/lib/use-list-state';

type Tab = 'subscriptions' | 'invoices' | 'payments' | 'packs';
const TAB_KEYS: Record<Tab, string[]> = {
  subscriptions: ['planSlug', 'status', 'cycle', 'method', 'renewal'],
  invoices: ['status', 'kind', 'from', 'to'],
  payments: ['status', 'from', 'to'],
  packs: ['channel', 'status', 'from', 'to'],
};
const pick = (q: ApiQuery, keys: string[]): ApiQuery => Object.fromEntries(Object.entries(q).filter(([k]) => ['q', 'page', 'pageSize', 'sort', ...keys].includes(k)));

export default function AdminSubscriptionsPage() {
  const t = useT();
  const f = useFormats();
  const { can } = usePlatform();
  const write = can('admin.billing.write');
  const list = useListState(SUBSCRIPTIONS_LIST);
  const tab = (list.state.tab as Tab | null) ?? 'subscriptions';
  const base = pick(list.apiQuery(), TAB_KEYS[tab]);
  if (tab !== 'subscriptions') delete base.sort;
  const subs = useAdminList<AdminSubscriptionRowDto, { kpis?: AdminSubscriptionKpis }>('/admin/subscriptions', tab === 'subscriptions' ? base : { pageSize: 25 });
  const invoices = useAdminList<AdminInvoiceRowDto>('/admin/invoices', base, { enabled: tab === 'invoices' });
  const payments = useAdminList<AdminPaymentRowDto>('/admin/payments', { provider: 'manual', ...base }, { enabled: tab === 'payments' });
  const packs = useAdminList<AdminPackPurchaseRowDto>('/admin/credit-packs/purchases', base, { enabled: tab === 'packs' });
  const plans = useAdminGet<PlanAdminDto[]>('/admin/plans');
  const kpis = subs.data?.meta?.kpis;
  const [pay, setPay] = useState<InvoiceRef | null>(null);
  const [picking, setPicking] = useState(false);
  const [subDlg, setSubDlg] = useState<{ editing: AdminSubscriptionRowDto | null } | null>(null);
  const [action, setAction] = useState<{ sub: AdminSubscriptionRowDto; action: SubAction } | null>(null);
  const [planFor, setPlanFor] = useState<AdminSubscriptionRowDto | null>(null);
  const [exporting, setExporting] = useState(false);

  const setTab = (k: string) => list.set({ tab: k === 'subscriptions' ? null : k, q: '', filters: Object.fromEntries(Object.keys(SUBSCRIPTIONS_LIST.filters).map((x) => [x, null])) });
  const statusOpts = (['trial', 'active', 'dunning', 'expired', 'cancelled'] as const).map((v) => ({ value: v, label: t(`enum.Subscription.status.${v}`) }));
  const quick: AdminFilter[] = useMemo(() => {
    if (tab === 'subscriptions')
      return [
        { kind: 'multi', key: 'planSlug', label: t('admin.common.plan'), options: (plans.data ?? []).map((p) => ({ value: p.slug, label: p.name })) },
        { kind: 'multi', key: 'status', label: t('admin.subs.filter.state'), options: statusOpts },
        { kind: 'multi', key: 'cycle', label: t('admin.common.cycle'), options: (['monthly', 'yearly'] as const).map((v) => ({ value: v, label: t(`admin.common.cycleOpt.${v}`) })) },
        { kind: 'multi', key: 'method', label: t('admin.subs.filter.method'), options: (['chargily', 'manual'] as const).map((v) => ({ value: v, label: t(`admin.subs.provider.${v}`) })) },
        { kind: 'single', key: 'renewal', label: t('admin.subs.filter.renewal'), options: (['lt7d', 'overdue'] as const).map((v) => ({ value: v, label: t(`admin.subs.renewal.${v}`) })) },
      ];
    if (tab === 'invoices')
      return [
        { kind: 'multi', key: 'status', label: t('admin.common.status'), options: (['upcoming', 'unpaid', 'paid', 'void', 'refunded'] as const).map((v) => ({ value: v, label: t(`enum.Invoice.status.${v}`) })) },
        { kind: 'multi', key: 'kind', label: t('admin.subs.filter.kind'), options: (['subscription', 'credit_pack', 'manual'] as const).map((v) => ({ value: v, label: t(`admin.subs.kind.${v}`) })) },
        { kind: 'date', key: 'period', label: t('admin.subs.filter.period'), from: 'from', to: 'to' },
      ];
    if (tab === 'payments')
      return [
        { kind: 'multi', key: 'status', label: t('admin.common.status'), options: (['pending', 'paid', 'failed', 'refunded'] as const).map((v) => ({ value: v, label: t(`admin.subs.payStatus.${v}`) })) },
        { kind: 'date', key: 'period', label: t('admin.subs.filter.period'), from: 'from', to: 'to' },
      ];
    return [
      { kind: 'multi', key: 'channel', label: t('admin.subs.filter.channel'), options: (['web', 'google_play', 'app_store'] as const).map((v) => ({ value: v, label: t(`admin.subs.channel.${v}`) })) },
      { kind: 'multi', key: 'status', label: t('admin.common.status'), options: (['pending', 'credited', 'refunded', 'failed'] as const).map((v) => ({ value: v, label: t(`admin.subs.purchaseStatus.${v}`) })) },
      { kind: 'date', key: 'period', label: t('admin.subs.filter.period'), from: 'from', to: 'to' },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, t, plans.data]);

  const subPill = (s: AdminSubscriptionRowDto) =>
    s.status === 'dunning' && s.dunningStage ? (
      <AdminPill group="Subscription.dunningStage" value={s.dunningStage}>{t(`enum.Subscription.dunningStage.${s.dunningStage}`)}</AdminPill>
    ) : (
      <AdminPill group="Subscription.status" value={s.status}>{t(`enum.Subscription.status.${s.status}`)}</AdminPill>
    );
  const nextPayment = (s: AdminSubscriptionRowDto) => {
    if (s.status === 'trial') return t('admin.subs.next.trial', { date: f.short(s.trialEndsAt ?? s.currentPeriodEnd) });
    if (s.unpaidInvoice) return t('admin.subs.next.overdue', { date: f.short(s.unpaidInvoice.dueAt), amount: f.money(s.unpaidInvoice.remaining) });
    if (s.status === 'expired' || s.status === 'cancelled') return t('admin.subs.next.ended', { date: f.short(s.currentPeriodEnd) });
    return t('admin.subs.next.due', { date: f.short(s.currentPeriodEnd), amount: f.money(s.appliedPrice) });
  };
  const subMenu = (s: AdminSubscriptionRowDto) => {
    const inv = s.unpaidInvoice;
    return (
      <ActionsMenu
        label={t('action.actions')}
        heading={`${s.workspace.name} · ${s.plan.name}`}
        actions={toMenuActions(
          s.actions,
          {
            invoices: { label: t('admin.subs.action.invoices'), onSelect: () => list.set({ tab: 'invoices', q: s.workspace.name, filters: Object.fromEntries(Object.keys(SUBSCRIPTIONS_LIST.filters).map((x) => [x, null])) }) },
            mark_paid: { label: t('admin.subs.action.mark_paid'), onSelect: () => inv && setPay({ ...inv, workspace: s.workspace }), hidden: !write || !inv },
            resend_dunning: { label: t('admin.subs.action.resend_dunning'), onSelect: () => setAction({ sub: s, action: 'resend_dunning' }), hidden: !write },
            extend: { label: t('admin.subs.action.extend'), onSelect: () => setAction({ sub: s, action: 'extend' }), hidden: !write },
            change_plan: { label: t('admin.subs.action.change_plan'), onSelect: () => setPlanFor(s), hidden: !can('admin.workspaces.write') },
            edit: { label: t('admin.subs.action.edit'), onSelect: () => setSubDlg({ editing: s }), hidden: !write },
            discount: { label: t('admin.subs.action.discount'), onSelect: () => setAction({ sub: s, action: 'discount' }), hidden: !write },
            cancel: { label: t('admin.subs.action.cancel'), onSelect: () => setAction({ sub: s, action: 'cancel' }), destructive: true, hidden: !write, separated: true },
            cancel_now: { label: t('admin.subs.action.cancel_now'), onSelect: () => setAction({ sub: s, action: 'cancel_now' }), destructive: true, hidden: !write },
          },
          t,
        )}
      />
    );
  };
  const subColumns: Column<AdminSubscriptionRowDto>[] = [
    { key: 'ws', header: t('admin.ws.col.workspace'), hideable: false, cell: (s) => <span className="block truncate font-medium">{s.workspace.name}</span> },
    { key: 'plan', header: t('admin.common.plan'), cell: (s) => s.plan.name },
    { key: 'cycle', header: t('admin.common.cycle'), cell: (s) => (s.cycle === 'none' ? '—' : t(`admin.common.cycleOpt.${s.cycle}`)) },
    { key: 'state', header: t('admin.subs.col.state'), cell: subPill },
    { key: 'next', header: t('admin.subs.col.next'), sortKey: 'currentPeriodEnd', cell: (s) => <span dir="auto">{nextPayment(s)}</span> },
    { key: 'method', header: t('admin.subs.col.method'), hideBelow: 'lg', cell: (s) => s.lastPayment?.label ?? (s.provider === 'none' ? '—' : t(`admin.subs.provider.${s.provider}`)) },
  ];
  const invColumns: Column<AdminInvoiceRowDto>[] = [
    { key: 'number', header: t('admin.subs.col.number'), hideable: false, cell: (i) => <span dir="ltr" className="font-mono text-[12px]">{i.number}</span> },
    { key: 'ws', header: t('admin.ws.col.workspace'), cell: (i) => i.workspace.name },
    { key: 'label', header: t('admin.subs.col.label'), hideBelow: 'lg', cell: (i) => i.label },
    { key: 'date', header: t('admin.subs.col.date'), cell: (i) => <ShortDate iso={i.date} /> },
    { key: 'amount', header: t('admin.subs.col.amount'), align: 'end', cell: (i) => <Money value={i.amount} /> },
    { key: 'status', header: t('admin.common.status'), cell: (i) => <AdminPill group="Invoice.status" value={i.status}>{t(`enum.Invoice.status.${i.status}`)}</AdminPill> },
  ];
  const invMenu = (i: AdminInvoiceRowDto) => (
    <ActionsMenu
      label={t('action.actions')}
      heading={i.number}
      actions={toMenuActions(i.actions, { mark_paid: { label: t('admin.subs.action.mark_paid'), onSelect: () => setPay({ id: i.id, number: i.number, amount: i.amount, remaining: i.remaining, workspace: i.workspace }), hidden: !write } }, t)}
    />
  );
  const payColumns: Column<AdminPaymentRowDto>[] = [
    { key: 'ws', header: t('admin.ws.col.workspace'), hideable: false, cell: (p) => p.workspace.name },
    { key: 'invoice', header: t('admin.subs.col.number'), cell: (p) => <span dir="ltr" className="font-mono text-[12px]">{p.invoice?.number ?? '—'}</span> },
    { key: 'method', header: t('admin.subs.col.method'), cell: (p) => (p.method && t.has(`admin.subs.method.${p.method}`) ? t(`admin.subs.method.${p.method}`) : (p.method ?? '—')) },
    { key: 'ref', header: t('admin.subs.pay.reference'), hideBelow: 'lg', cell: (p) => <span dir="ltr">{p.reference ?? '—'}</span> },
    { key: 'amount', header: t('admin.subs.col.amount'), align: 'end', cell: (p) => <Money value={p.amount} /> },
    { key: 'date', header: t('admin.subs.col.date'), cell: (p) => <ShortDate iso={p.paidAt ?? p.createdAt} /> },
    { key: 'by', header: t('admin.subs.col.by'), hideBelow: 'lg', cell: (p) => (p.recordedBy ? `${p.recordedBy.firstName} ${p.recordedBy.lastName}`.trim() : '—') },
    { key: 'proof', header: t('admin.subs.pay.proof'), hideBelow: 'xl', cell: (p) => (p.proofUrl ? <a href={p.proofUrl} target="_blank" rel="noreferrer" className="text-accent-inbound hover:underline">{t('admin.subs.col.proofOpen')}</a> : '—') },
  ];
  // a recorded payment: its invoice (Factures tab, searched by number) and its proof
  const payMenu = (p: AdminPaymentRowDto) => (
    <ActionsMenu
      label={t('action.actions')}
      heading={p.invoice?.number ?? p.workspace.name}
      actions={[
        ...(p.invoice ? [{ key: 'invoice', label: t('admin.subs.pay.openInvoice'), onSelect: () => list.set({ tab: 'invoices', q: p.invoice!.number, filters: Object.fromEntries(Object.keys(SUBSCRIPTIONS_LIST.filters).map((x) => [x, null])) }) }] : []),
        ...(p.proofUrl ? [{ key: 'proof', label: t('admin.subs.col.proofOpen'), onSelect: () => window.open(p.proofUrl!, '_blank', 'noopener,noreferrer') }] : []),
      ]}
    />
  );
  const packColumns: Column<AdminPackPurchaseRowDto>[] = [
    { key: 'ws', header: t('admin.ws.col.workspace'), hideable: false, cell: (p) => p.workspace.name },
    { key: 'pack', header: t('admin.subs.col.pack'), cell: (p) => `${p.pack.name} · ${f.num(p.pack.credits)}` },
    { key: 'channel', header: t('admin.subs.filter.channel'), cell: (p) => (t.has(`admin.subs.channel.${p.channel}`) ? t(`admin.subs.channel.${p.channel}`) : p.channel) },
    { key: 'amount', header: t('admin.subs.col.amount'), align: 'end', cell: (p) => <Money value={p.amount} /> },
    { key: 'status', header: t('admin.common.status'), cell: (p) => (t.has(`admin.subs.purchaseStatus.${p.status}`) ? t(`admin.subs.purchaseStatus.${p.status}`) : p.status) },
    { key: 'date', header: t('admin.subs.col.date'), cell: (p) => <ShortDate iso={p.createdAt} /> },
  ];
  const counts = kpis?.counts;
  const total = tab === 'subscriptions' ? subs.data?.total : tab === 'invoices' ? invoices.data?.total : tab === 'payments' ? payments.data?.total : packs.data?.total;

  return (
    <AdminPage
      permission="admin.billing.read"
      title={t('nav.admin.subscriptions')}
      description={t('admin.subs.description')}
      actions={
        <>
          <Button variant="ghost" onClick={() => setExporting(true)}>
            {t('admin.subs.export.cta')}
          </Button>
          {write ? (
            <Button onClick={() => setSubDlg({ editing: null })} data-testid="new-subscription">
              {t('admin.subs.edit.cta')}
            </Button>
          ) : null}
          {write ? (
            <Button variant="primary" onClick={() => setPicking(true)} data-testid="manual-payment-cta">
              {t('admin.subs.pay.cta')}
            </Button>
          ) : null}
        </>
      }
    >
      <OpsKpiStrip label={t('admin.subs.kpis')}>
        <OpsKpiTile context={typeof kpis?.mrrDeltaPct === "number" ? `${kpis.mrrDeltaPct > 0 ? '+' : ''}${kpis.mrrDeltaPct} %` : undefined} value={kpis ? compactAmount(kpis.mrr, f.locale) : '—'} unit={t('admin.subs.kpi.mrr')} />
        <OpsKpiTile context={kpis ? t('admin.subs.kpi.expected', { amount: f.money(kpis.renewals7d.amount) }) : undefined} value={kpis ? f.num(kpis.renewals7d.count) : '—'} unit={t('admin.subs.kpi.renewals')} />
        <OpsKpiTile context={kpis ? t('admin.subs.kpi.tomorrow', { count: kpis.dunning.expiringTomorrow }) : undefined} value={kpis ? f.num(kpis.dunning.count) : '—'} unit={t('admin.subs.kpi.dunning')} tone={kpis?.dunning.count ? 'warning' : undefined} />
        <OpsKpiTile context={typeof kpis?.trialConversionPct === "number" ? t('admin.subs.kpi.rate', { pct: kpis.trialConversionPct }) : undefined} value={kpis ? f.num(kpis.trialsConverted) : '—'} unit={t('admin.subs.kpi.trials')} />
        <OpsKpiTile context={t('admin.subs.kpi.manualContext')} value={kpis ? f.num(kpis.manualToConfirm) : '—'} unit={t('admin.subs.kpi.manual')} />
      </OpsKpiStrip>
      <PillTabs
        label={t('admin.subs.tabs')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'subscriptions', label: t('admin.subs.tab.subscriptions'), count: counts?.subscriptions },
          { key: 'invoices', label: t('admin.subs.tab.invoices'), count: counts?.invoices },
          { key: 'payments', label: t('admin.subs.tab.payments'), count: counts?.manualPayments },
          { key: 'packs', label: t('admin.subs.tab.packs'), count: counts?.packPurchases },
        ]}
      />
      <AdminFilterBar list={list} search={t('admin.subs.search')} quick={quick} count={total !== undefined ? t(`admin.subs.count.${tab}`, { count: total }) : undefined} />
      {tab === 'subscriptions' ? (
        <AdminListBody testId="subs-list" query={subs} list={list} columns={subColumns} rowKey={(s) => s.id} label={t('admin.subs.tab.subscriptions')} entity={t('admin.subs.entity.subscription')} empty={{ title: t('admin.subs.empty.subscriptions') }} rowActions={subMenu} />
      ) : tab === 'invoices' ? (
        <AdminListBody testId="invoices-list" query={invoices} list={list} columns={invColumns} rowKey={(i) => i.id} label={t('admin.subs.tab.invoices')} entity={t('admin.subs.entity.invoice')} empty={{ title: t('admin.subs.empty.invoices') }} rowActions={invMenu} />
      ) : tab === 'payments' ? (
        <AdminListBody testId="payments-list" query={payments} list={list} columns={payColumns} rowKey={(p) => p.id} label={t('admin.subs.tab.payments')} entity={t('admin.subs.entity.payment')} empty={{ title: t('admin.subs.empty.payments'), description: t('admin.subs.empty.paymentsHint'), action: write ? { label: t('admin.subs.pay.cta'), onClick: () => setPicking(true) } : undefined }} rowActions={payMenu} />
      ) : (
        <AdminListBody testId="packs-list" query={packs} list={list} columns={packColumns} rowKey={(p) => p.id} label={t('admin.subs.tab.packs')} entity={t('admin.subs.entity.purchase')} empty={{ title: t('admin.subs.empty.packs') }} />
      )}
      <RecordPaymentDialog
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(inv) => {
          setPicking(false);
          setPay(inv);
        }}
      />
      <ManualPaymentDialog invoice={pay} open={!!pay} onClose={() => setPay(null)} />
      <SubscriptionDialog
        key={subDlg?.editing?.id ?? 'new'}
        open={!!subDlg}
        editing={subDlg?.editing}
        onClose={() => setSubDlg(null)}
        onEditExisting={(wsId) => {
          const existing = subs.data?.rows.find((s) => s.workspace.id === wsId);
          setSubDlg(existing ? { editing: existing } : null);
          if (!existing) list.set({ q: '' });
        }}
      />
      <SubscriptionActionDialog sub={action?.sub ?? null} action={action?.action ?? null} onClose={() => setAction(null)} />
      <ChangePlanDialog ws={planFor ? { id: planFor.workspace.id, name: planFor.workspace.name, plan: { slug: planFor.plan.slug, name: planFor.plan.name }, credits: { used: 0, limit: 0, exhausted: false }, subscriptionStatus: planFor.status, trustLevel: 'standard' } : null} open={!!planFor} onClose={() => setPlanFor(null)} />
      <AccountingExportDialog open={exporting} onClose={() => setExporting(false)} />
    </AdminPage>
  );
}
