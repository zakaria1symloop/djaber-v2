'use client';
// List pane of the inbox — Figma "INB — Inbox — thread with handoff" (list), "INB — Inbox — filter sheet +
// conversation menu", "DLG — Inbox & queue" (sélecteur de canal). Channel switcher, search, status tabs with server
// counts (`GET /conversations/counts`), "Filtres (n)" panel, cursor-paginated rows (50, infinite) with their
// `Actions` menu. Every piece of state lives in the URL (`?tab&channel&q&ai&unread&assignee&…`).
import { ActionsMenu, ActiveFilters, Avatar, Button, Checkbox, cn, ConversationItem, FilterChips, FilterGroup, FilterPanel, Menu, MenuItem, MenuLabel, MonoTag, SearchInput, Skeleton } from '@djaber/ui';
import { Check, ChevronDown, ListChecks, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ListEmpty, ListFilteredEmpty, QueryError } from '@/components/global-states';
import { useAgent } from '@/features/agents/api';
import { useChannels } from '@/features/channels/api';
import { useMembers } from '@/features/workspace/api';
import { Link, useRouter } from '@/i18n/navigation';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useWsStatus } from '@/lib/ws';
import { relativeTime } from '@/lib/time';
import { useConversationCounts, useConversations } from './api';
import { InboxBulkBar } from './bulk';
import type { ConversationListItem } from './contracts';
import { countPanelFilters, DEFAULT_FILTERS, inboxApiQuery, INBOX_SORTS, INBOX_TABS, isFiltered, previewTypeKey, resetPanelFilters, tabCount, type InboxFilters, type InboxSort, type InboxTab } from './logic';
import { ChannelBadge, PlatformIcon, shortAge, shortUserName, useLocale, useNow, userName } from './ui';
import { useTyping } from './typing';
import type { ConversationActions } from './use-conversation-actions';

const INTENTS = ['sale', 'info', 'tracking', 'complaint', 'greeting'] as const;
const CLIENT_FLAGS = ['risk', 'placeholder', 'vip'] as const;
const LANGUAGES = ['ar', 'fr', 'en'] as const;

export function ConversationList({
  filters,
  setFilters,
  selectedId,
  hrefOf,
  actions,
}: {
  filters: InboxFilters;
  setFilters: (next: InboxFilters) => void;
  selectedId: string | null;
  hrefOf: (id: string) => string;
  actions: ConversationActions;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const now = useNow();
  const { can } = useSession();
  const live = useWsStatus();
  const channels = useChannels();
  const counts = useConversationCounts(filters.channel);
  const q = useConversations(inboxApiQuery(filters));
  const [panel, setPanel] = useState(false);
  // multi-select (no selection below 768: the bar is not drawn on phones — 12 §19 "390: no multi-select")
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const stopSelecting = () => {
    setSelecting(false);
    setSelected([]);
  };
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  const pages = channels.data?.rows ?? [];
  const current = pages.find((c) => c.id === filters.channel) ?? null;
  const set = (patch: Partial<InboxFilters>) => setFilters({ ...filters, ...patch });
  const activeFilters = countPanelFilters(filters);
  const blockedCount = counts.data?.blocked ?? 0;
  const tabs = INBOX_TABS.filter((tab) => tab !== 'blocked' || blockedCount > 0 || filters.tab === 'blocked');
  // `?agentId=` (M11): the name of the agent on the chip (the id when the member cannot read agents)
  const agent = useAgent(filters.agent && can('agents.read') ? filters.agent : null);
  const agentName = agent.data?.name ?? (agent.isPending && filters.agent && can('agents.read') ? '…' : '—');

  /* ---------- infinite list: the sentinel at the bottom loads the next 50 ---------- */
  const sentinel = useRef<HTMLLIElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, rows.length]);

  /* ---------- ↑ / ↓ walk the conversations when the focus is not in a field ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox], [role=log], audio, video')) return;
      if (!rows.length) return;
      const i = rows.findIndex((r) => r.id === selectedId);
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (!next || next.id === selectedId) return;
      e.preventDefault();
      router.replace(hrefOf(next.id));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, selectedId, router, hrefOf]);

  const tags = (row: ConversationListItem) => (
    <>
      {row.blocked ? <MonoTag tone="danger">{t('enum.Client.blocked')}</MonoTag> : null}
      {row.status === 'needs_human' ? <MonoTag tone="warning">{t('enum.Conversation.status.needs_human')}</MonoTag> : null}
      {row.aiPaused ? <MonoTag>{t('enum.Conversation.aiPaused')}</MonoTag> : null}
      {row.status === 'resolved' ? <MonoTag>{t('inbox.tag.resolved')}</MonoTag> : null}
      {row.status === 'archived' ? <MonoTag>{t('inbox.tag.archived')}</MonoTag> : null}
      {row.client?.riskLevel === 'high' ? <MonoTag tone="danger">{t('enum.Client.riskLevel.high')}</MonoTag> : null}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="conversation-list">
      <div className="flex flex-col gap-3 px-4 pb-3 pt-5">
        <div className="flex items-center justify-between gap-2">
          <span className="ts-label-section text-text-muted">{t('inbox.eyebrow')}</span>
          {live === 'reconnecting' ? (
            <span role="status" className="inline-flex h-5 items-center gap-1.5 rounded-full border border-accent-starred/40 px-2 ts-label-meta text-accent-starred" data-testid="inbox-reconnecting">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent-starred" />
              {t('state.ws.reconnecting')}
            </span>
          ) : null}
        </div>
        <Menu
          align="start"
          trigger={
            <button type="button" className="flex w-fit max-w-full items-center gap-2 rounded-[4px] text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-inbound" data-testid="channel-switcher" aria-label={t('inbox.switcher.label')}>
              <span className="ts-display-s truncate text-[17px]" dir="auto">
                {current?.name ?? t('inbox.switcher.all')}
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-text-secondary" aria-hidden />
            </button>
          }
        >
          <MenuLabel>{t('inbox.switcher.label')}</MenuLabel>
          <MenuItem onSelect={() => set({ channel: null })} data-channel="all">
            <span className="min-w-0 flex-1">
              <span className="block">{t('inbox.switcher.all')}</span>
              <span className="block ts-label-micro text-text-muted">{t('inbox.switcher.pages', { count: pages.length })}</span>
            </span>
            {!filters.channel ? <Check className="size-3.5 text-accent-money" aria-hidden /> : null}
          </MenuItem>
          {pages.map((p) => (
            <MenuItem key={p.id} onSelect={() => set({ channel: p.id })} data-channel={p.id}>
              <PlatformIcon platform={p.platform} className="text-text-secondary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate" dir="auto">
                  {p.name}
                </span>
                <span className={cn('block ts-label-micro', p.status === 'needs_reconnect' ? 'text-accent-alert' : p.status === 'active' ? 'text-text-muted' : 'text-accent-starred')}>
                  {t('inbox.switcher.row', { count: p.counts.conversations, status: t(`enum.Channel.status.${p.status}`) })}
                </span>
              </span>
              {filters.channel === p.id ? <Check className="size-3.5 text-accent-money" aria-hidden /> : null}
            </MenuItem>
          ))}
        </Menu>
        {current ? (
          <p className="-mt-2 ts-label-micro text-text-muted">
            {[t(`inbox.platform.${current.platform}`), current.health.lastInboundAt ? t('inbox.lastInbound', { ago: relativeTime(current.health.lastInboundAt, locale, now) }) : null].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <SearchInput value={filters.q} onChange={(v) => set({ q: v })} placeholder={t('inbox.search.placeholder')} label={t('action.search')} clearLabel={t('action.clearFilters')} />
          <Button aria-label={t('action.filtersCount', { count: activeFilters })} title={t('action.filters')} onClick={() => setPanel(true)} className={cn('shrink-0 !px-3', activeFilters > 0 && 'border-line-lit')} data-testid="inbox-filters">
            <SlidersHorizontal className="size-4" aria-hidden />
            {activeFilters > 0 ? <span className="ts-label-meta tabular-nums">{activeFilters}</span> : null}
          </Button>
          <Button aria-label={t('inbox.bulk.toggle')} title={t('inbox.bulk.toggle')} aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))} className={cn('shrink-0 !px-3 max-md:hidden', selecting && 'border-line-lit bg-ink-raised')} data-testid="inbox-select">
            <ListChecks className="size-4" aria-hidden />
          </Button>
        </div>
        <div role="tablist" aria-label={t('inbox.tabs.label')} className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => {
            const n = tabCount(counts.data, tab);
            const active = filters.tab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                data-tab={tab}
                onClick={() => set({ tab })}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-card border px-3 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-inbound',
                  active ? 'border-white bg-white font-medium text-black' : 'border-line-edge text-text-secondary hover:border-line-lit hover:text-text-primary',
                )}
              >
                {t(`inbox.tab.${tab}`)}
                {n !== null ? (
                  <span className={cn('tabular-nums', active ? 'text-black/70' : 'text-text-muted')}>{n}</span>
                ) : counts.isPending ? (
                  // room for the count while it loads: the chips keep their width and the list under them does not jump
                  <span aria-hidden className="invisible tabular-nums">
                    0
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {filters.agent ? (
          <div data-testid="inbox-agent-filter">
            <ActiveFilters
              items={[{ key: 'agent', label: `${t('carry.inbox.filter.agent')} : ${agentName}`, onRemove: () => set({ agent: null }) }]}
              label={t('action.filters')}
              clearLabel={t('action.clearAll')}
              removeLabel={(l) => t('agents.filter.remove', { label: l })}
            />
          </div>
        ) : null}
      </div>

      {selecting && selected.length > 0 ? (
        <InboxBulkBar ids={selected} names={Object.fromEntries(rows.map((r) => [r.id, r.client?.name || t('inbox.client.unknown')]))} visibleIds={rows.map((r) => r.id)} onSelect={setSelected} onClear={() => setSelected([])} />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel" aria-label={t(`inbox.tab.${filters.tab}`)}>
        {q.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="flex flex-col">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="size-9" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : q.isError ? (
          <div className="p-4">
            <QueryError error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            {channels.isSuccess && pages.length === 0 ? (
              <ListEmpty
                title={t('inbox.empty.noChannel.title')}
                description={t('inbox.empty.noChannel.description')}
                action={can('channels.manage') ? { label: t('inbox.empty.noChannel.cta'), onClick: () => router.push('/channels') } : undefined}
              />
            ) : isFiltered(filters) ? (
              // full-test 15/11 CHANNELS-INBOX-11: the message quotes the term itself (« « zzzzqa » » was quoted twice)
              <ListFilteredEmpty entity={t('inbox.entity')} filters={filters.q.trim()} onClear={() => setFilters(resetPanelFilters(filters))} />
            ) : (
              <ListEmpty title={t(`inbox.empty.${filters.tab}.title`)} description={t(`inbox.empty.${filters.tab}.description`)} />
            )}
          </div>
        ) : (
          <ul aria-label={t('inbox.list.label')} className="flex flex-col">
            {rows.map((row) => (
              <li key={row.id} data-row={row.id} data-unread={row.unreadCount > 0 || undefined} className="group relative">
                <ConversationItem
                  name={row.client?.name || t('inbox.client.unknown')}
                  avatarUrl={row.client?.avatarUrl}
                  time={shortAge(row.lastMessageAt, t, locale, now)}
                  preview={<RowPreview id={row.id} text={row.lastMessagePreview ? (previewTypeKey(row.lastMessagePreview) ? t(previewTypeKey(row.lastMessagePreview)!) : row.lastMessagePreview) : t('inbox.preview.media')} />}
                  outbound={row.lastMessageDirection === 'out'}
                  unread={row.unreadCount}
                  unreadLabel={t('inbox.unread', { count: row.unreadCount })}
                  tags={tags(row)}
                  meta={
                    <>
                      {filters.channel ? null : <ChannelBadge channel={row.channel} />}
                      {row.assignee ? (
                        <span title={t('inbox.assignedTo', { name: userName(row.assignee) })}>
                          <Avatar name={userName(row.assignee)} src={row.assignee.avatarUrl} size={16} />
                          <span className="sr-only">{t('inbox.assignedTo', { name: shortUserName(row.assignee) })}</span>
                        </span>
                      ) : null}
                    </>
                  }
                  active={row.id === selectedId}
                  leading={
                    selecting ? (
                      <Checkbox checked={selected.includes(row.id)} onChange={() => toggle(row.id)} aria-label={t('inbox.bulk.selectRow', { name: row.client?.name ?? '' })} data-select={row.id} className="max-md:hidden" />
                    ) : undefined
                  }
                  renderLink={(p) => (
                    <Link href={hrefOf(row.id)} className={cn(p.className, 'pe-10')} aria-current={p['aria-current']} scroll={false}>
                      {p.children}
                    </Link>
                  )}
                />
                <div className="absolute end-2 top-2 opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
                  <ActionsMenu iconOnly variant="ghost" label={t('inbox.row.actions', { name: row.client?.name ?? '' })} actions={actions.menu(row)} heading={[row.client?.name, row.aiPaused ? t('enum.Conversation.aiPaused') : null, row.unreadCount > 0 ? t('inbox.meta.unread') : null].filter(Boolean).join(' · ')} />
                </div>
              </li>
            ))}
            {hasNextPage ? (
              <li ref={sentinel} className="flex items-start gap-3 px-4 py-3" role="status" aria-label={t('state.list.loadMore', { count: 50 })}>
                <Skeleton className="size-9" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <InboxFilterPanel open={panel} onClose={() => setPanel(false)} filters={filters} setFilters={setFilters} total={rows.length} more={!!hasNextPage} />
    </div>
  );
}

/** Row preview; "IA répond…" replaces it while the AI reply job of that conversation runs (M11, `conversation.typing`). */
function RowPreview({ id, text }: { id: string; text: string }) {
  const t = useT();
  const typing = useTyping(id);
  if (typing.ai) {
    return (
      <span className="text-accent-inbound" data-typing="ai">
        {t('carry.inbox.typing.ai')}
      </span>
    );
  }
  return <>{text}</>;
}

/** "Filtres" side panel (model: Conversation). Filters apply live; the footer button closes the panel. */
function InboxFilterPanel({ open, onClose, filters, setFilters, total, more }: { open: boolean; onClose: () => void; filters: InboxFilters; setFilters: (f: InboxFilters) => void; total: number; more: boolean }) {
  const t = useT();
  const { me } = useSession();
  const members = useMembers(open);
  const set = (patch: Partial<InboxFilters>) => setFilters({ ...filters, ...patch });
  const one = <T extends string>(v: string[]): T | null => (v[0] as T | undefined) ?? null;
  const active = countPanelFilters(filters);
  const assignees = [
    { value: 'me', label: t('inbox.filters.assignee.me') },
    ...(members.data ?? []).filter((m) => m.user.id !== me?.id).map((m) => ({ value: m.user.id, label: shortUserName(m.user) })),
    { value: 'none', label: t('inbox.filters.assignee.none') },
  ];
  return (
    <FilterPanel
      open={open}
      onClose={onClose}
      title={t('action.filters')}
      summary={t('inbox.filters.summary', { active, count: total, more: more ? '+' : '' })}
      resetLabel={t('inbox.filters.reset')}
      onReset={() => setFilters({ ...DEFAULT_FILTERS, channel: filters.channel })}
      applyLabel={t('inbox.filters.apply', { count: total, more: more ? '+' : '' })}
      closeLabel={t('action.close')}
    >
      <FilterGroup label={t('inbox.filters.status')}>
        <FilterChips label={t('inbox.filters.status')} options={INBOX_TABS.filter((x) => x !== 'all').map((x) => ({ value: x, label: t(`inbox.tab.${x}`) }))} value={filters.tab === 'all' ? [] : [filters.tab]} onChange={(v) => set({ tab: one<InboxTab>(v) ?? 'all' })} allLabel={t('inbox.tab.all')} />
      </FilterGroup>
      <FilterGroup label={t('inbox.filters.ai')}>
        <FilterChips label={t('inbox.filters.ai')} options={(['active', 'paused', 'no_agent'] as const).map((x) => ({ value: x, label: t(`inbox.filters.ai.${x}`) }))} value={filters.ai ? [filters.ai] : []} onChange={(v) => set({ ai: one<NonNullable<InboxFilters['ai']>>(v) })} />
      </FilterGroup>
      <FilterGroup label={t('inbox.filters.read')}>
        <FilterChips label={t('inbox.filters.read')} options={[{ value: 'unread', label: t('inbox.filters.read.unread') }]} value={filters.unread ? ['unread'] : []} onChange={(v) => set({ unread: v.length > 0 })} />
      </FilterGroup>
      <FilterGroup label={t('inbox.filters.assignee')}>
        <FilterChips label={t('inbox.filters.assignee')} options={assignees} value={filters.assignee ? [filters.assignee] : []} onChange={(v) => set({ assignee: v[0] ?? null })} />
      </FilterGroup>
      <FilterGroup label={t('inbox.filters.order')}>
        <FilterChips label={t('inbox.filters.order')} options={(['with', 'cart', 'abandoned', 'without'] as const).map((x) => ({ value: x, label: t(`inbox.filters.order.${x}`) }))} value={filters.order ? [filters.order] : []} onChange={(v) => set({ order: one<NonNullable<InboxFilters['order']>>(v) })} />
      </FilterGroup>
      <FilterGroup label={t('inbox.filters.intent')}>
        <FilterChips multiple label={t('inbox.filters.intent')} options={INTENTS.map((x) => ({ value: x, label: t(`inbox.filters.intent.${x}`) }))} value={filters.intent} onChange={(v) => set({ intent: v })} />
      </FilterGroup>
      <FilterGroup label={t('inbox.filters.client')}>
        <FilterChips multiple label={t('inbox.filters.client')} options={CLIENT_FLAGS.map((x) => ({ value: x, label: t(`inbox.filters.client.${x}`) }))} value={filters.client} onChange={(v) => set({ client: v })} />
      </FilterGroup>
      <FilterGroup label={t('inbox.filters.language')}>
        <FilterChips multiple label={t('inbox.filters.language')} options={LANGUAGES.map((x) => ({ value: x, label: t(`inbox.filters.language.${x}`) }))} value={filters.language} onChange={(v) => set({ language: v })} />
      </FilterGroup>
      <FilterGroup label={t('inbox.filters.lastMessage')}>
        <FilterChips label={t('inbox.filters.lastMessage')} options={(['lt24h', 'gt24h', '7d'] as const).map((x) => ({ value: x, label: t(`inbox.filters.lastMessage.${x}`) }))} value={filters.lastMessage ? [filters.lastMessage] : []} onChange={(v) => set({ lastMessage: one<NonNullable<InboxFilters['lastMessage']>>(v) })} />
      </FilterGroup>
      <FilterGroup label={t('inbox.filters.sort')}>
        <FilterChips label={t('inbox.filters.sort')} options={INBOX_SORTS.map((x) => ({ value: x, label: t(`inbox.filters.sort.${x}`) }))} value={[filters.sort]} onChange={(v) => set({ sort: one<InboxSort>(v) ?? 'lastMessageAt' })} />
      </FilterGroup>
    </FilterPanel>
  );
}
