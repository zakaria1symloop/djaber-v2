'use client';
// /admin/workspaces — Figma "ADM-02 — Platform admin — workspaces list + detail sheet" + DLG Platform admin (Suspendre,
// Réactiver, Ajouter des crédits, Libérer la page, Créer un espace pour un client, Programmer la suppression, Prolonger
// l'essai, Changer le plan, Niveau de confiance, Se connecter en tant que). L6 list, filters + sheet in the URL.
import type { AdminWorkspaceRowDto, PlanAdminDto } from '@djaber/shared';
import { ActionsMenu, Button, type Column } from '@djaber/ui';
import { useMemo, useState } from 'react';
import { AdminPage } from '@/features/admin/admin-page';
import { useAdminGet, useAdminList } from '@/features/admin/api';
import { AdminFilterBar, AdminListBody, type AdminFilter } from '@/features/admin/list-kit';
import { usePlatform } from '@/features/admin/platform';
import { fullName, Num, ShortDate, useFormats } from '@/features/admin/ui';
import { useWorkspaceActions } from '@/features/admin/workspaces/actions';
import { CreateWorkspaceDialog } from '@/features/admin/workspaces/dialogs';
import { WorkspaceSheet } from '@/features/admin/workspaces/sheet';
import { WorkspaceStateCell, WorkspaceSubscriptionCell } from '@/features/admin/workspaces/status';
import { WORKSPACES_LIST } from '@/features/admin/specs';
import { useGeoWilayas } from '@/features/delivery/api';
import { wilayaLabel } from '@/features/delivery/geo';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useListState } from '@/lib/use-list-state';

export default function AdminWorkspacesPage() {
  const t = useT();
  const f = useFormats();
  const { can } = usePlatform();
  const list = useListState(WORKSPACES_LIST);
  const s = list.state;
  const query = useAdminList<AdminWorkspaceRowDto>('/admin/workspaces', list.apiQuery());
  const plans = useAdminGet<PlanAdminDto[]>('/admin/plans');
  const wilayas = useGeoWilayas();
  const locale = useLocaleCode();
  const actions = useWorkspaceActions({ openSheet: (id) => list.openSheet(id) });
  const [create, setCreate] = useState(false);
  const rows = query.data?.rows ?? [];
  const sheetIndex = s.sheet ? rows.findIndex((r) => r.id === s.sheet) : -1;

  const quick: AdminFilter[] = useMemo(
    () => [
      { kind: 'multi', key: 'planSlug', label: t('admin.common.plan'), options: (plans.data ?? []).map((p) => ({ value: p.slug, label: p.name })) },
      {
        kind: 'multi',
        key: 'status',
        label: t('admin.common.status'),
        options: (['active', 'suspended', 'deletion_scheduled'] as const).map((v) => ({ value: v, label: t(`enum.Workspace.status.${v}`) })),
      },
      { kind: 'single', key: 'credits', label: t('admin.ws.col.credits'), options: (['lt20', 'exhausted'] as const).map((v) => ({ value: v, label: t(`admin.ws.filter.credits.${v}`) })) },
      { kind: 'date', key: 'created', label: t('admin.ws.filter.created'), from: 'createdFrom', to: 'createdTo' },
      { kind: 'single', key: 'wilayaId', label: t('admin.ws.filter.wilaya'), options: (wilayas.data ?? []).map((w) => ({ value: String(w.id), label: wilayaLabel(w, locale) })) },
    ],
    [t, plans.data, wilayas.data, locale],
  );
  const panel: AdminFilter[] = useMemo(
    () => [
      {
        kind: 'multi',
        key: 'subscriptionStatus',
        label: t('admin.ws.filter.subscription'),
        options: (['trial', 'active', 'dunning', 'expired', 'cancelled'] as const).map((v) => ({ value: v, label: t(`enum.Subscription.status.${v}`) })),
      },
      { kind: 'multi', key: 'trustLevel', label: t('admin.ws.filter.trust'), options: (['new', 'standard', 'trusted', 'watch'] as const).map((v) => ({ value: v, label: t(`enum.Workspace.trustLevel.${v}`) })) },
      { kind: 'single', key: 'inactiveDays', label: t('admin.ws.filter.activity'), options: ['7', '30', '90'].map((v) => ({ value: v, label: t('admin.ws.filter.inactive', { days: v }) })) },
      { kind: 'range', key: 'pages', label: t('admin.ws.col.pages'), min: 'minPages', max: 'maxPages' },
      { kind: 'range', key: 'products', label: t('admin.ws.filter.products'), min: 'minProducts', max: 'maxProducts' },
      { kind: 'range', key: 'revenue', label: t('admin.ws.filter.revenue'), min: 'minRevenue', max: 'maxRevenue', unit: 'DA' },
      { kind: 'toggle', key: 'withPages', label: t('admin.ws.filter.withPages') },
      { kind: 'toggle', key: 'withAgents', label: t('admin.ws.filter.withAgents') },
    ],
    [t],
  );

  const columns: Column<AdminWorkspaceRowDto>[] = [
    { key: 'name', header: t('admin.ws.col.workspace'), sortKey: 'name', hideable: false, className: 'max-w-[220px]', cell: (r) => <span className="block truncate text-[14px] font-medium" title={r.name}>{r.name}</span> },
    {
      key: 'owner',
      header: t('admin.ws.col.owner'),
      className: 'max-w-[220px]',
      cell: (r) => (
        <span className="block min-w-0" title={`${fullName(r.owner)} · ${r.owner.email}`}>
          <span className="block truncate">{fullName(r.owner)}</span>
          <span className="block truncate ts-label-micro text-text-muted" dir="ltr">
            {r.owner.email}
          </span>
        </span>
      ),
    },
    { key: 'plan', header: t('admin.common.plan'), cell: (r) => r.plan.name },
    { key: 'status', header: t('admin.common.status'), cell: (r) => <WorkspaceStateCell ws={r} /> },
    { key: 'subscription', header: t('admin.ws.filter.subscription'), cell: (r) => <WorkspaceSubscriptionCell ws={r} /> },
    {
      key: 'credits',
      header: t('admin.ws.col.creditsMonth'),
      cell: (r) => (
        <span dir="ltr" className={r.credits.exhausted ? 'whitespace-nowrap tabular-nums text-accent-alert' : 'whitespace-nowrap tabular-nums'}>
          {f.num(r.credits.used)} / {f.num(r.credits.limit)}
          {r.credits.exhausted ? ` · ${t('admin.ws.credits.exhausted')}` : ''}
        </span>
      ),
    },
    { key: 'pages', header: t('admin.ws.col.pages'), hideBelow: 'lg', cell: (r) => <span className="whitespace-nowrap">{f.num(r.pages.count)}{r.pages.platforms.length ? ` (${r.pages.platforms.map((p) => (p === 'instagram' ? 'IG' : 'FB')).join(', ')})` : ''}</span> },
    { key: 'orders', header: t('admin.ws.col.orders30'), align: 'end', hideBelow: 'lg', cell: (r) => <Num value={r.orders30d} /> },
    { key: 'created', header: t('admin.ws.col.created'), sortKey: 'createdAt', hideBelow: 'xl', cell: (r) => <ShortDate iso={r.createdAt} /> },
  ];
  const menu = (r: AdminWorkspaceRowDto) => <ActionsMenu label={t('action.actions')} heading={`${r.name} · ${r.plan.name}`} actions={actions.menu(r)} />;

  return (
    <AdminPage
      permission="admin.workspaces.read"
      title={t('nav.admin.workspaces')}
      description={t('admin.ws.description')}
      actions={
        can('admin.workspaces.write') ? (
          <Button variant="primary" onClick={() => setCreate(true)} data-testid="create-workspace">
            {t('admin.ws.create.cta')}
          </Button>
        ) : null
      }
    >
      <AdminFilterBar list={list} search={t('admin.ws.search')} quick={quick} panel={panel} count={query.data ? t('admin.ws.count', { count: query.data.total }) : undefined} />
      <AdminListBody
        testId="ws-list"
        query={query}
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        label={t('nav.admin.workspaces')}
        entity={t('admin.ws.entity')}
        empty={{ title: t('admin.ws.empty.title'), description: t('admin.ws.empty.description'), action: can('admin.workspaces.write') ? { label: t('admin.ws.create.cta'), onClick: () => setCreate(true) } : undefined }}
        rowActions={menu}
        onRowClick={(r) => list.openSheet(r.id)}
        card={(r) => (
          <div className="flex items-center gap-3 px-3 py-3">
            <button type="button" onClick={() => list.openSheet(r.id)} className="min-w-0 flex-1 text-start">
              <span className="block truncate text-[14px] font-medium">{r.name}</span>
              <span className="flex flex-wrap items-center gap-2 ts-label-meta text-text-muted">
                {r.plan.name} {r.status !== 'active' ? <WorkspaceStateCell ws={r} /> : null} <WorkspaceSubscriptionCell ws={r} />
              </span>
            </button>
            {menu(r)}
          </div>
        )}
      />
      <WorkspaceSheet
        id={s.sheet}
        onClose={() => list.openSheet(null)}
        nav={{
          onPrev: sheetIndex > 0 ? () => list.openSheet(rows[sheetIndex - 1]!.id) : undefined,
          onNext: sheetIndex >= 0 && sheetIndex < rows.length - 1 ? () => list.openSheet(rows[sheetIndex + 1]!.id) : undefined,
          position: sheetIndex >= 0 ? `${sheetIndex + 1} / ${rows.length}` : undefined,
        }}
        menu={(ws) => actions.menu(ws, { sheet: true })}
        onAction={(k, ws) => actions.open(k, ws)}
      />
      <CreateWorkspaceDialog open={create} onClose={() => setCreate(false)} onCreated={(ws) => list.openSheet(ws.id)} />
      {actions.dialogs}
    </AdminPage>
  );
}
