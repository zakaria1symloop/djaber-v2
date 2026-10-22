'use client';
// /notifications — Figma "NTF-01 — Notifications — list" + "ANA-01b — Home & Notifications — states catalogue"
// (type multi-filter, empty "Vous êtes à jour ✓", skeleton 5 rows). Family chips, "Non lues" toggle and the type
// selection live in the URL; the unread count is the server count; rows are kept fresh by WS (features/notifications/shell).
import type { NotificationGroup, NotificationView } from '@djaber/shared';
import { Button, buttonClass, Card, cn, EmptyState, FilterCheckList, FilterDropdown, NotificationListSkeleton, NotificationRow, StatusPill, toast } from '@djaber/ui';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { CheckCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { AppPage } from '@/components/app-page';
import { AnnouncementDialog } from '@/features/announcements/announcements';
import { ListFilteredEmpty, QueryError } from '@/components/global-states';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { notificationKeys, notificationsApi, NOTIFICATIONS_PAGE, type NotificationPage } from './api';
import { FAMILY_CHIPS, filterApiQuery, filterQueryString, groupOfType, isFiltered, isNotificationType, notificationHref, parseFilter, typeSlug, typesOfGroup, withGroup, type NotificationFilter } from './logic';
import { useUnreadCount } from './shell';

const chip = (on: boolean) =>
  cn('h-8 shrink-0 whitespace-nowrap rounded-card border px-3 text-[13px] transition-colors', on ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary');

export function NotificationsView() {
  const t = useT();
  const locale = useLocaleCode();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = useMemo(() => parseFilter(params), [params]);
  const query = useMemo(() => filterApiQuery(filter), [filter]);
  const unread = useUnreadCount();

  const setFilter = useCallback(
    (next: NotificationFilter) => {
      const qs = filterQueryString(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const list = useInfiniteQuery({
    queryKey: notificationKeys.list(ws, query),
    queryFn: ({ pageParam }) => notificationsApi.list({ ...query, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore && last.nextCursor ? last.nextCursor : undefined),
    enabled: !!ws,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.rows) ?? [], [list.data]);

  const patchRead = (ids: string[] | 'all') => {
    const now = new Date().toISOString();
    qc.setQueriesData<InfiniteData<NotificationPage>>({ queryKey: notificationKeys.lists(ws) }, (old) =>
      old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, rows: pg.rows.map((n) => (n.readAt || (ids !== 'all' && !ids.includes(n.id)) ? n : { ...n, readAt: now })) })) } : old,
    );
  };
  const readOne = useMutation({ mutationFn: notificationsApi.read });
  const readAll = useMutation({ mutationFn: notificationsApi.readAll });

  const markRead = (n: NotificationView) => {
    if (n.readAt) return;
    patchRead([n.id]);
    qc.setQueryData<number>(notificationKeys.unread(ws), (c) => Math.max(0, (c ?? 1) - 1));
    // the server count comes back with WS `notification.read`; a failure restores it on the next refetch
    readOne.mutate(n.id, {
      onSuccess: (r) => {
        const count = (r as { unreadCount?: unknown } | null)?.unreadCount;
        if (typeof count === 'number') qc.setQueryData(notificationKeys.unread(ws), count);
      },
      onError: () => void qc.invalidateQueries({ queryKey: notificationKeys.all(ws) }),
    });
  };
  const onReadAll = async () => {
    try {
      await readAll.mutateAsync();
      patchRead('all');
      qc.setQueryData(notificationKeys.unread(ws), 0);
      void qc.invalidateQueries({ queryKey: notificationKeys.lists(ws) });
      toast(t('notifications.allRead'));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };

  const typeOptions = useMemo(
    () => typesOfGroup(filter.group).map((type) => ({ value: type as string, label: typeSlug(type) })),
    [filter.group],
  );
  const activeLabels = [
    filter.group ? t(FAMILY_CHIPS.find((c) => c.group === filter.group)?.labelKey ?? `notifications.family.${filter.group}`) : null,
    filter.unread ? t('notifications.unreadOnly') : null,
    ...filter.types.map(typeSlug),
  ].filter(Boolean);
  // `platform.announcement` deep link: `?announcement=<id>` opens the announcement (UX-005)
  const announcementId = params.get('announcement');
  const closeAnnouncement = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('announcement');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <AppPage
      wide
      permission="notifications.own"
      title={t('nav.notifications')}
      description={<span data-testid="unread-count">{t('notification.unreadServer', { count: unread })}</span>}
      actions={
        <>
          <Link href="/settings/notifications" className={buttonClass()} data-testid="notification-preferences-link">
            {t('notifications.preferences')}
          </Link>
          <FilterDropdown label={t('notifications.filter.types')} count={filter.types.length || undefined} align="end">
            <FilterCheckList
              options={typeOptions}
              value={filter.types}
              onChange={(next) => setFilter({ ...filter, types: next.filter(isNotificationType) })}
              searchPlaceholder={t('notifications.filter.typeSearch')}
              emptyLabel={t('state.list.filteredEmpty.title')}
              maxHeight={260}
            />
          </FilterDropdown>
          <Button variant="primary" onClick={() => void onReadAll()} loading={readAll.isPending} disabled={unread === 0} data-testid="read-all">
            {t('action.markAllRead')}
          </Button>
        </>
      }
    >
      <div role="group" aria-label={t('notifications.filter.label')} data-testid="notification-chips" className="-mx-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1 pb-1">
        <button type="button" aria-pressed={!filter.group} data-chip="all" onClick={() => setFilter(withGroup(filter, null))} className={chip(!filter.group && !filter.unread)}>
          {t('notification.filter.all')}
        </button>
        <button type="button" aria-pressed={filter.unread} data-chip="unread" onClick={() => setFilter({ ...filter, unread: !filter.unread })} className={chip(filter.unread)}>
          <bdi>{t('notification.filter.unread', { count: unread })}</bdi>
        </button>
        {FAMILY_CHIPS.map((c) => (
          <button key={c.group} type="button" aria-pressed={filter.group === c.group} data-chip={c.group} onClick={() => setFilter(withGroup(filter, filter.group === c.group ? null : c.group))} className={chip(filter.group === c.group)}>
            {t(c.labelKey)}
          </button>
        ))}
      </div>

      {list.isPending ? (
        <Card>
          <NotificationListSkeleton label={t('common.loading')} />
        </Card>
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 && isFiltered(filter) ? (
        <ListFilteredEmpty entity={t('notifications.entity')} filters={activeLabels.join(' · ')} onClear={() => setFilter({ group: null, unread: false, types: [] })} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<CheckCheck className="size-5 text-accent-money" />} title={t('notifications.empty.title')} description={t('notifications.empty.description')} />
      ) : (
        <Card className="overflow-hidden">
          <ul aria-label={t('nav.notifications')} data-testid="notifications">
            {rows.map((n) => (
              <Row key={n.id} n={n} locale={locale} onOpen={() => markRead(n)} />
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="flex justify-center border-t border-line-hairline p-2">
              <Button variant="ghost" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage} data-testid="load-more">
                {t('action.loadMore', { count: NOTIFICATIONS_PAGE })}
              </Button>
            </div>
          ) : null}
        </Card>
      )}
      <AnnouncementDialog id={announcementId} onClose={closeAnnouncement} />
    </AppPage>
  );
}

function Row({ n, locale, onOpen }: { n: NotificationView; locale: string; onOpen: () => void }) {
  const t = useT();
  const group: NotificationGroup = n.group ?? groupOfType(n.type) ?? 'platform';
  const href = n.deepLink?.web ? notificationHref(n.deepLink.web) : null;
  return (
    <NotificationRow
      unread={!n.readAt}
      unreadLabel={t('notifications.unread')}
      data-id={n.id}
      pill={
        <StatusPill enumKey="Notification.group" value={group} className="!rounded-[4px]">
          {t(`notifications.family.${group}`)}
        </StatusPill>
      }
      title={n.title}
      body={n.body}
      slug={typeSlug(n.type)}
      age={relativeTime(n.createdAt, locale)}
      action={
        href ? (
          <Link href={href} onClick={onOpen} data-testid="notification-open" className="inline-flex h-8 items-center rounded-card px-2 text-[13px] text-text-secondary hover:bg-ink-raised hover:text-text-primary">
            {t('action.openArrow')}
          </Link>
        ) : !n.readAt ? (
          <Button variant="ghost" size="sm" onClick={onOpen}>
            {t('notifications.markRead')}
          </Button>
        ) : null
      }
    />
  );
}
