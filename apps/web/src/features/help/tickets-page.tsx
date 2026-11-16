'use client';
// `/help/tickets` — "Mes demandes" (HELP-04; rows as in the HELP frame card, full list page per 02-next-route-map §3.4).
// `GET /support/tickets?status&scope&page` — Operators see their own tickets; Admin+ (`support.read_all`) may show every
// ticket of the workspace (`scope=workspace`). Filters, scope and page in the URL.
// States: skeleton · list · [E] no ticket (CTA) · [FE] status filter · error (Réessayer) · offline banner from the shell.
import { ActiveFilters, EmptyState, FilterChips, FilterDropdown, SegmentedControl, buttonClass, type ActiveFilter } from '@djaber/ui';
import { MessageSquare } from 'lucide-react';
import { useMemo } from 'react';
import { AppPage } from '@/components/app-page';
import { ListFilteredEmpty, ListLoading, QueryError } from '@/components/global-states';
import { ListPagination } from '@/features/catalog/ui';
import { Link } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterList, filterText, type ApiQuery, type ListSpec } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { useTickets } from './api';
import { TICKET_STATUSES, TicketRows } from './shared';

export const TICKETS_SPEC: ListSpec = { filters: { status: 'list', scope: 'text' }, sorts: ['lastMessageAt'], defaultSort: '-lastMessageAt' };

export function TicketsPage() {
  const t = useT();
  const locale = useLocaleCode();
  const { can } = useSession();
  const list = useListState(TICKETS_SPEC);
  const s = list.state;
  // full-test 15/11 HELP-11: an unknown status of an old / hand-edited link is dropped (« STATUT : BOGUS » + a 422)
  const statuses = filterList(s, 'status').filter((v) => (TICKET_STATUSES as readonly string[]).includes(v));
  const all = can('support.read_all');
  const scope = all && filterText(s, 'scope') === 'workspace' ? 'workspace' : 'mine';
  const query = useMemo<ApiQuery>(() => {
    const q: ApiQuery = { page: s.page, pageSize: s.pageSize, scope };
    if (statuses.length) q.status = statuses;
    return q;
  }, [s.page, s.pageSize, scope, statuses]);
  const q = useTickets(query);
  const rows = q.data?.rows ?? [];
  const statusOptions = TICKET_STATUSES.map((v) => ({ value: v, label: t(`enum.Ticket.status.${v}`) }));
  const chips: ActiveFilter[] = statuses.length
    ? [{ key: 'status', label: `${t('help.tickets.filter.status')} : ${statuses.map((v) => statusOptions.find((o) => o.value === v)?.label ?? v).join(', ')}`, onRemove: () => list.setFilter('status', null) }]
    : [];

  return (
    <AppPage
      title={t('help.tickets.title')}
      permission="support.write"
      back={{ href: '/help', label: t('nav.help') }}
      actions={
        <Link href="/help/contact" className={buttonClass({ variant: 'primary' })} data-testid="new-ticket">
          {t('help.tickets.new')}
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {all ? (
          <SegmentedControl
            label={t('help.tickets.scope')}
            value={scope}
            onChange={(v) => list.setFilter('scope', v === 'workspace' ? 'workspace' : null)}
            options={[
              { value: 'mine', label: t('help.tickets.scope.mine') },
              { value: 'workspace', label: t('help.tickets.scope.workspace') },
            ]}
          />
        ) : null}
        <FilterDropdown label={t('help.tickets.filter.status')} count={statuses.length || undefined}>
          <FilterChips multiple label={t('help.tickets.filter.status')} options={statusOptions} value={statuses} onChange={(next) => list.setFilter('status', next.length ? next : null)} />
        </FilterDropdown>
      </div>
      <ActiveFilters items={chips} label={t('action.filters')} clearLabel={t('action.clearAll')} onClear={list.clear} removeLabel={(label) => `${t('action.remove')} ${label}`} />
      <div data-testid="tickets-list">
        {q.isPending ? (
          <ListLoading rows={4} columns={2} />
        ) : q.isError ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          statuses.length ? (
            <ListFilteredEmpty entity={t('help.tickets.entity')} filters={chips.map((c) => c.label).join(' · ')} onClear={list.clear} />
          ) : (
            <EmptyState icon={<MessageSquare className="size-5" />} title={t('help.tickets.empty.title')} description={t('help.tickets.empty.description')} action={{ label: t('help.tickets.new'), href: `/${locale}/help/contact` }} />
          )
        ) : (
          <>
            <TicketRows rows={rows} />
            <ListPagination page={s.page} pageSize={s.pageSize} total={q.data?.total ?? rows.length} onChange={(p) => list.set(p)} />
          </>
        )}
      </div>
    </AppPage>
  );
}
