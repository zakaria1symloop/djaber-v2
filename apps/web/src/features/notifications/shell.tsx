'use client';
// Shell side of the notification centre (02-next-route-map §2.1): unread count of the bell and of the sidebar item
// (`GET /notifications/unread-count`, kept fresh by WS `notification.created` / `notification.read`), and the top-bar
// bell. No popover is drawn in Figma (NTF-01, ANA-01b): the bell opens `/notifications`.
import type { NotificationCreatedEvent, NotificationReadEvent, NotificationView } from '@djaber/shared';
import { cn } from '@djaber/ui';
import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRef } from 'react';
import { Bell } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { useWsEvent } from '@/lib/ws';
import { playChime, SOUND_MIN_GAP_MS } from '../inbox/sound';
import { notificationKeys, notificationsApi, type NotificationPage } from './api';
import { usePreferences } from './preferences-api';

/**
 * WS → cache: the unread count comes with both events; a new notification refetches the visible lists (its family and
 * deep link are computed by the server), a read mark patches the cached rows in place. Mount once (shell).
 */
export function useNotificationEvents() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  // tester notes 25/10 (« no sound on low stock »): the SON column of Settings › Notifications was stored and never
  // played — a notification of a type whose sound is on rings the chime (at most once every 1.5 s)
  const prefs = usePreferences();
  const lastRing = useRef(0);
  useWsEvent<Partial<NotificationCreatedEvent>>('notification.created', (p) => {
    const type = p?.notification?.type;
    const now = Date.now();
    if (type && prefs.data?.find((r) => r.type === type)?.sound && now - lastRing.current >= SOUND_MIN_GAP_MS) {
      lastRing.current = now;
      playChime();
    }
    if (typeof p?.unreadCount === 'number') qc.setQueryData(notificationKeys.unread(ws), p.unreadCount);
    else void qc.invalidateQueries({ queryKey: notificationKeys.unread(ws) });
    void qc.invalidateQueries({ queryKey: notificationKeys.lists(ws) });
  });
  // reconnect (M11): `resync { notificationsUnread }` = the count after the notifications missed while offline
  useWsEvent<{ notificationsUnread?: number }>('resync', (p) => {
    if (typeof p?.notificationsUnread !== 'number') return;
    qc.setQueryData(notificationKeys.unread(ws), p.notificationsUnread);
    void qc.invalidateQueries({ queryKey: notificationKeys.lists(ws) });
  });
  useWsEvent<Partial<NotificationReadEvent>>('notification.read', (p) => {
    if (typeof p?.unreadCount === 'number') qc.setQueryData(notificationKeys.unread(ws), p.unreadCount);
    else void qc.invalidateQueries({ queryKey: notificationKeys.unread(ws) });
    const ids = p?.ids;
    if (!ids) return;
    const now = new Date().toISOString();
    const mark = (n: NotificationView): NotificationView => (n.readAt || (ids !== 'all' && !ids.includes(n.id)) ? n : { ...n, readAt: now });
    qc.setQueriesData<InfiniteData<NotificationPage>>({ queryKey: notificationKeys.lists(ws) }, (old) => (old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, rows: pg.rows.map(mark) })) } : old));
  });
}

/** Server unread count of the current user. Also subscribes to the two WS events: call it once, in the shell. */
export function useUnreadNotifications(): number {
  const ws = useWorkspaceId();
  useNotificationEvents();
  const q = useQuery({ queryKey: notificationKeys.unread(ws), queryFn: notificationsApi.unreadCount, enabled: !!ws, staleTime: 60_000 });
  return q.data ?? 0;
}

/** Reads the cached count without subscribing again (the bell, the page header). */
export function useUnreadCount(): number {
  const ws = useWorkspaceId();
  const q = useQuery({ queryKey: notificationKeys.unread(ws), queryFn: notificationsApi.unreadCount, enabled: !!ws, staleTime: 60_000 });
  return q.data ?? 0;
}

/** Top-bar bell: link to `/notifications` with the unread badge. */
export function NotificationBell({ className }: { className?: string }) {
  const t = useT();
  const count = useUnreadCount();
  const label = count > 0 ? `${t('nav.notifications')} — ${t('notification.unreadServer', { count })}` : t('nav.notifications');
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={t('nav.notifications')}
      data-testid="notification-bell"
      className={cn('relative flex size-9 items-center justify-center rounded-card border border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary', className)}
    >
      <Bell className="size-4" aria-hidden />
      {count > 0 ? (
        <span aria-hidden data-testid="notification-bell-count" className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-alert px-1 text-[10px] font-semibold tabular-nums text-black">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
