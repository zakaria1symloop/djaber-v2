'use client';
// /admin/support — Figma "ADM-12 — Platform admin — support tickets" (974:39817), D38 HELP-05: KPIs (open / over SLA,
// median first response, solved at first exchange, satisfaction, top subjects), tabs Ouverts / Assignés à moi / En
// attente du client / Résolus / Tous, filters in the URL, rows with SLA pills (DÉPASSÉ DE n / n RESTANTES / EN ATTENTE
// CLIENT), one Actions ⌄ per row from the server `actions`, ticket detail under the list (`?sheet=<id>`).
// Reads `admin.support.read` (every platform role); replies / actions `admin.support.write` (super_admin, support).
import { TicketCategoryValues, TicketChannelValues, TicketPriorityValues, type AdminTicketDto, type CannedReplyDto } from '@djaber/shared';
import { ActionsMenu, Button, buttonClass, ConfirmDialog, DataTable, EmptyState, Ltr, OpsKpiStrip, OpsKpiTile, Pill, PillTabs, SlaPill, toast, type Column, type Tone } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { AdminFilterBar, AdminListBody, type AdminFilter } from '@/features/admin/list-kit';
import { usePlatform } from '@/features/admin/platform';
import { Link, useRouter } from '@/i18n/navigation';
import { toMenuActions } from '@/lib/actions';
import { withAdminReasons } from '@/features/admin/reasons';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import type { ApiQuery, ListSpec } from '@/lib/list-state';
import { relativeTime } from '@/lib/time';
import { useListState } from '@/lib/use-list-state';
import { useWsEvent } from '@/lib/ws';
import { opsApi, opsKeys, useCannedReplies, useSupportStats, useTickets } from './api';
import { useDuration, userName, useWrite } from './common';
import { isTicketTab, ticketSla, ticketTabQuery, TICKET_TABS, type TicketTab } from './logic';
import { CannedDialog, NewTicketDialog } from './support-dialogs';
import { TicketDetail } from './ticket-detail';

const SPEC: ListSpec = {
  filters: { category: 'list', planSlug: 'list', channel: 'list', priority: 'list', assigneeId: 'text', slaBreached: 'bool' },
  sorts: ['sla'],
  defaultSort: 'sla',
  tabs: TICKET_TABS,
};
const PRIORITY_TONE: Record<AdminTicketDto['priority'], Tone> = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' };
const PLANS = ['free', 'starter', 'pro'] as const;

export function SupportPage() {
  const t = useT();
  const locale = useLocaleCode();
  const qc = useQueryClient();
  const router = useRouter();
  const list = useListState(SPEC);
  const s = list.state;
  const tab: TicketTab = isTicketTab(s.tab) ? s.tab : 'open';
  const write = useWrite('admin.support.write');
  const stats = useSupportStats();
  const duration = useDuration();
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmResolve, setConfirmResolve] = useState<AdminTicketDto | null>(null);
  const { userId } = usePlatform();
  // the ticket opens under the list (Figma ADM-12): bring it into view by scrolling the content area only
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = detailRef.current;
    const main = el?.closest('main');
    if (!el || !main) return;
    const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 16;
    if (top > main.scrollTop + main.clientHeight * 0.5 || top < main.scrollTop) main.scrollTo({ top, behavior: 'smooth' });
  }, [s.sheet]);

  // the API takes no sort (urgency order: SLA breached first, then due soonest)
  const query = useMemo<ApiQuery>(() => {
    const { sort: _sort, ...rest } = list.apiQuery(ticketTabQuery(tab));
    return rest;
  }, [list, tab]);
  const tickets = useTickets(query);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: opsKeys.ticketsRoot }), qc.invalidateQueries({ queryKey: opsKeys.supportStats })]);
  useWsEvent('tickets.queue', () => void refresh());
  useWsEvent<{ id: string }>('ticket.updated', (p) => {
    void qc.invalidateQueries({ queryKey: opsKeys.ticket(p.id) });
    void refresh();
  });

  const quick: AdminFilter[] = [
    { kind: 'multi', key: 'category', label: t('adminSupport.filter.category'), options: TicketCategoryValues.map((v) => ({ value: v, label: t(`adminSupport.category.${v}`) })) },
    { kind: 'multi', key: 'planSlug', label: t('adminSupport.filter.plan'), options: PLANS.map((v) => ({ value: v, label: t(`adminSupport.plan.${v}`) })) },
    { kind: 'multi', key: 'channel', label: t('adminSupport.filter.channel'), options: TicketChannelValues.map((v) => ({ value: v, label: t(`adminSupport.channel.${v}`) })) },
    { kind: 'multi', key: 'priority', label: t('adminSupport.filter.priority'), options: TicketPriorityValues.map((v) => ({ value: v, label: t(`adminSupport.priority.${v}`) })) },
    { kind: 'single', key: 'assigneeId', label: t('adminSupport.filter.assignee'), options: [{ value: 'me', label: t('adminSupport.filter.assignee.me') }, { value: 'none', label: t('adminSupport.filter.assignee.none') }] },
    // overview alert "tickets hors SLA" (`?slaBreached=true`, AdminTicketsQuery)
    { kind: 'toggle', key: 'slaBreached', label: t('adminSupport.filter.slaBreached') },
  ];

  const act = async (fn: () => Promise<AdminTicketDto>, okKey: string, number: string) => {
    setBusy(true);
    try {
      const r = await fn();
      qc.setQueryData(opsKeys.ticket(r.id), r);
      toast({ tone: 'success', message: t(okKey, { number }) });
      await refresh();
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setBusy(false);
      setConfirmResolve(null);
    }
  };
  const rowActions = (r: AdminTicketDto) => (
    <ActionsMenu
      label={t('action.actions')}
      heading={`#${r.number}`}
      actions={withAdminReasons(toMenuActions(
        r.actions,
        {
          reply: { label: t('adminSupport.action.reply'), onSelect: () => list.openSheet(r.id), hidden: !write.allowed },
          assign: r.assignee?.id === userId ? { label: t('adminSupport.action.unassign'), onSelect: () => void act(() => opsApi.assign(r.id, null), 'adminSupport.toast.unassigned', r.number), hidden: !write.allowed } : { label: t('adminSupport.action.assignMe'), onSelect: () => userId && void act(() => opsApi.assign(r.id, userId), 'adminSupport.toast.assigned', r.number), hidden: !write.allowed },
          resolve: { label: t('adminSupport.action.resolve'), onSelect: () => setConfirmResolve(r), hidden: !write.allowed },
          reopen: { label: t('adminSupport.action.reopen'), onSelect: () => void act(() => opsApi.ticketAction(r.id, 'reopen'), 'adminSupport.toast.reopened', r.number), hidden: !write.allowed },
          wait_customer: { label: t('adminSupport.action.waitCustomer'), onSelect: () => void act(() => opsApi.ticketAction(r.id, 'wait-customer'), 'adminSupport.toast.waiting', r.number), hidden: !write.allowed },
          open: { label: t('adminSupport.action.open'), onSelect: () => router.push(`/admin/support/${r.id}`), local: true, separated: true },
          open_workspace: { label: t('adminSupport.context.openWorkspace'), onSelect: () => r.workspace && router.push(`/admin/workspaces?sheet=${r.workspace.id}`), local: !!r.workspace },
        },
        t,
      ), r.actions, t).map((a) => (write.offline && a.key !== 'open' && a.key !== 'open_workspace' ? { ...a, onSelect: undefined, disabledReason: t('banner.offline') } : a))}
    />
  );

  const slaCell = (r: AdminTicketDto) => {
    const v = ticketSla(r);
    if (v.kind === 'done') return <span className="text-text-muted">—</span>;
    if (v.kind === 'waiting') return <SlaPill kind="waiting">{t('adminSupport.sla.waiting')}</SlaPill>;
    return <SlaPill kind={v.kind}>{t(v.kind === 'breached' ? 'adminSupport.sla.breached' : 'adminSupport.sla.remaining', { duration: duration(v.minutes) })}</SlaPill>;
  };
  const columns: Column<AdminTicketDto>[] = [
    { key: 'number', header: t('adminSupport.col.number'), cell: (r) => `#${r.number}`, ltr: true, hideable: false },
    {
      key: 'workspace',
      header: t('adminSupport.col.workspace'),
      cell: (r) => (
        <span className="block max-w-56" title={r.workspace ? `${r.workspace.name} · ${r.workspace.plan} — ${userName(r.user)} · ${r.user.email}` : undefined}>
          <span className="block truncate">{r.workspace ? `${r.workspace.name} · ${r.workspace.plan}` : '—'}</span>
          <span className="block truncate ts-label-micro !normal-case text-text-muted">
            {userName(r.user)} · <Ltr>{r.user.email}</Ltr>
          </span>
        </span>
      ),
    },
    {
      key: 'subject',
      header: t('adminSupport.col.subject'),
      // the subject takes the width left by the other columns (max-w-0 + w-full on the cell) and truncates inside it,
      // so the SLA pill is no longer pushed under the sticky Actions column at 1440 (M11 layout pass)
      className: 'w-full max-w-0',
      cell: (r) => (
        <span className="block min-w-40" title={r.subject}>
          <span className="block truncate">{r.subject}</span>
          <span className="block truncate ts-label-micro !normal-case text-text-muted">
            {[relativeTime(r.createdAt, locale), r.messages.length ? t('adminSupport.messages', { count: r.messages.length }) : null, r.status === 'pending_customer' ? t('adminSupport.sla.waiting').toLowerCase() : null].filter(Boolean).join(' · ')}
          </span>
        </span>
      ),
      hideable: false,
    },
    { key: 'category', header: t('adminSupport.col.category'), cell: (r) => t(`adminSupport.category.${r.category}`), hideBelow: 'lg' },
    { key: 'priority', header: t('adminSupport.col.priority'), cell: (r) => <Pill className="whitespace-nowrap" tone={PRIORITY_TONE[r.priority]}>{t(`adminSupport.priority.${r.priority}`)}</Pill> },
    { key: 'channel', header: t('adminSupport.col.channel'), cell: (r) => <span className="whitespace-nowrap">{[t(`adminSupport.channel.${r.channel}`), r.channel === 'mobile' ? r.user.platform || null : null].filter(Boolean).join(' · ')}</span>, hideBelow: 'xl' },
    { key: 'sla', header: t('adminSupport.col.sla'), cell: slaCell },
  ];

  const st = stats.data;
  const tabs = TICKET_TABS.map((k) => ({ key: k, label: t(`adminSupport.tab.${k}`), count: st ? { open: st.tabs.open, mine: st.tabs.mine, pending: st.tabs.pendingCustomer, resolved: null, all: null }[k] : null }));
  const topSubjects = st?.topCategories.slice(0, 2).map((c) => `${t(`adminSupport.category.${c.category}`)} ${c.count}`).join(' · ');

  return (
    <AdminPage
      permission="admin.support.read"
      title={t('nav.admin.support')}
      description={t('adminSupport.description')}
      actions={
        <>
          <Link href="/admin/support/canned-replies" className={buttonClass({ variant: 'ghost' })}>
            {t('adminSupport.canned.title')}
          </Link>
          {write.allowed ? (
            <Button variant="primary" onClick={() => setCreate(true)} disabledReason={write.disabledReason} data-testid="ticket-new">
              {t('adminSupport.new.button')}
            </Button>
          ) : null}
        </>
      }
    >
      {stats.isError && !st ? null : (
        <OpsKpiStrip label={t('adminSupport.kpi.label')}>
          <OpsKpiTile data-testid="kpi-open" context={st ? t('adminSupport.kpi.open.context', { count: st.overSla }) : '…'} value={st ? st.open : '—'} unit={t('adminSupport.kpi.open.unit')} tone={st && st.overSla ? 'danger' : undefined} />
          <OpsKpiTile context={t('adminSupport.kpi.firstResponse.context')} value={st && st.medianFirstResponseMin !== null ? duration(st.medianFirstResponseMin) : '—'} unit={t('adminSupport.kpi.firstResponse.unit')} />
          <OpsKpiTile context={t('adminSupport.kpi.firstExchange.context')} value={st ? `${st.solvedFirstExchangePct} %` : '—'} unit={t('adminSupport.kpi.firstExchange.unit')} />
          <OpsKpiTile context={t('adminSupport.kpi.satisfaction.context')} value={st && st.satisfactionAvg !== null ? `${(Math.round(st.satisfactionAvg * 10) / 10).toLocaleString('fr-FR')} / 5` : '—'} unit={t('adminSupport.kpi.satisfaction.unit')} />
          <OpsKpiTile context={topSubjects || '—'} value={t('adminSupport.kpi.top')} />
        </OpsKpiStrip>
      )}
      <PillTabs tabs={tabs} value={tab} onChange={(k) => list.set({ tab: k === 'open' ? null : k, page: 1, sheet: null })} label={t('adminSupport.tab.label')} />
      <AdminFilterBar list={list} search={t('adminSupport.search')} quick={quick} count={tickets.data ? t('adminSupport.count', { count: tickets.data.total }) : undefined} />
      <AdminListBody<AdminTicketDto>
        filters={quick}
        query={tickets}
        list={{ ...list, filtered: list.activeCount > 0 || s.q.trim().length >= 2 }}
        columns={columns}
        rowKey={(r) => r.id}
        label={t('nav.admin.support')}
        entity={t('adminSupport.entity')}
        empty={{ title: t(`adminSupport.empty.${tab}`) }}
        rowActions={rowActions}
        onRowClick={(r) => list.openSheet(r.id)}
        testId="tickets"
        card={(r) => (
          <button type="button" onClick={() => list.openSheet(r.id)} className="flex w-full flex-col gap-1 px-3 py-3 text-start">
            <span className="flex items-center justify-between gap-2">
              <Ltr className="ts-label-meta text-text-muted">#{r.number}</Ltr>
              {slaCell(r)}
            </span>
            <span className="truncate text-[14px]">{r.subject}</span>
            <span className="truncate ts-label-micro !normal-case text-text-muted">{r.workspace?.name ?? '—'}</span>
          </button>
        )}
      />
      {s.sheet ? (
        <div ref={detailRef} className="scroll-mt-4">
          <TicketDetail id={s.sheet} />
        </div>
      ) : null}
      <NewTicketDialog open={create} onClose={() => setCreate(false)} onCreated={(r) => list.openSheet(r.id)} />
      <ConfirmDialog
        open={!!confirmResolve}
        onOpenChange={(o) => !o && setConfirmResolve(null)}
        title={t('adminSupport.resolve.title', { number: confirmResolve?.number ?? '' })}
        description={t('adminSupport.resolve.description')}
        confirmLabel={t('adminSupport.action.resolve')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        loading={busy}
        onConfirm={() => confirmResolve && void act(() => opsApi.ticketAction(confirmResolve.id, 'resolve'), 'adminSupport.toast.resolved', confirmResolve.number)}
      />
    </AdminPage>
  );
}

/** /admin/support/[id] — direct load of one ticket (full page). */
export function SupportTicketPage({ id }: { id: string }) {
  const t = useT();
  return (
    <AdminPage permission="admin.support.read" title={t('nav.admin.support')} fill>
      <Link href="/admin/support" className="inline-flex w-fit items-center gap-1.5 ts-label-meta uppercase text-text-muted hover:text-text-primary">
        <ArrowLeft className="size-3 rtl:-scale-x-100" aria-hidden />
        {t('adminSupport.back')}
      </Link>
      <TicketDetail id={id} backHref="/admin/support" fill />
    </AdminPage>
  );
}

/** /admin/support/canned-replies — `CannedReply` CRUD (HELP-05 seeded shortcuts, editable here). */
export function CannedRepliesPage() {
  const t = useT();
  const qc = useQueryClient();
  const write = useWrite('admin.support.write');
  const q = useCannedReplies();
  const [dialog, setDialog] = useState<{ reply: CannedReplyDto | null } | null>(null);
  const [remove, setRemove] = useState<CannedReplyDto | null>(null);
  const [busy, setBusy] = useState(false);
  const doRemove = async () => {
    if (!remove) return;
    setBusy(true);
    try {
      await opsApi.deleteCanned(remove.id);
      toast({ tone: 'success', message: t('adminSupport.canned.deleted', { key: remove.key }) });
      setRemove(null);
      await qc.invalidateQueries({ queryKey: opsKeys.canned });
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const columns: Column<CannedReplyDto>[] = [
    { key: 'key', header: t('adminSupport.canned.col.key'), cell: (r) => <span className="font-mono text-[13px]">{r.key}</span>, ltr: true, hideable: false },
    { key: 'title', header: t('adminSupport.canned.col.title'), cell: (r) => r.title, hideable: false },
    { key: 'category', header: t('adminSupport.col.category'), cell: (r) => (r.category ? t(`adminSupport.category.${r.category}`) : '—'), hideBelow: 'lg' },
    { key: 'locales', header: t('adminSupport.canned.col.locales'), cell: (r) => ['fr', 'ar', 'en'].filter((l) => !!r.body[l as 'fr']).join(' · ').toUpperCase(), hideBelow: 'lg' },
  ];
  return (
    <AdminPage
      permission="admin.support.read"
      title={t('adminSupport.canned.title')}
      description={t('adminSupport.canned.description')}
      actions={
        write.allowed ? (
          <Button variant="primary" onClick={() => setDialog({ reply: null })} disabledReason={write.disabledReason} data-testid="canned-new">
            {t('adminSupport.canned.new')}
          </Button>
        ) : null
      }
    >
      <Link href="/admin/support" className="inline-flex w-fit items-center gap-1.5 ts-label-meta uppercase text-text-muted hover:text-text-primary">
        <ArrowLeft className="size-3 rtl:-scale-x-100" aria-hidden />
        {t('adminSupport.back')}
      </Link>
      {q.isPending ? (
        <EmptyState title={t('common.loading')} />
      ) : !q.data ? (
        <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title={t('adminSupport.canned.empty')} action={write.allowed ? { label: t('adminSupport.canned.new'), onClick: () => setDialog({ reply: null }) } : undefined} />
      ) : (
        <DataTable
          label={t('adminSupport.canned.title')}
          columns={columns}
          rows={q.data}
          rowKey={(r) => r.id}
          actionsLabel={t('action.actions')}
          rowActions={
            write.allowed
              ? (r) => (
                  <ActionsMenu
                    label={t('action.actions')}
                    heading={r.key}
                    actions={[
                      { key: 'edit', label: t('action.edit'), onSelect: write.offline ? undefined : () => setDialog({ reply: r }), disabledReason: write.disabledReason },
                      { key: 'delete', label: t('action.delete'), destructive: true, onSelect: write.offline ? undefined : () => setRemove(r), disabledReason: write.disabledReason },
                    ]}
                  />
                )
              : undefined
          }
        />
      )}
      <CannedDialog open={!!dialog} reply={dialog?.reply ?? null} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title={t('adminSupport.canned.delete.title', { key: remove?.key ?? '' })}
        description={t('adminSupport.canned.delete.description')}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        loading={busy}
        onConfirm={() => void doRemove()}
      />
    </AdminPage>
  );
}
