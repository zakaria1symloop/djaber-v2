'use client';
// Super admin notifications (owner request 09/11 « des notifications pour l'admin, pour tout, en temps réel »): the bell of
// the admin top bar with its unread count, the side panel (all / unread, families, « Tout marquer comme lu », more), a toast
// and a chime for every new one, live through WS `admin.notification` / `admin.notification.read` on `user:<id>`.
import { adminNotificationFamily, type AdminNotificationEvent, type AdminNotificationView } from '@djaber/shared';
import { Button, cn, IconButton, SideSheet, Switch, toast } from '@djaber/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api, apiRaw } from '@/lib/api';
import { useLocaleCode, useT } from '@/lib/i18n';
import { relativeTime } from '@/lib/time';
import { useWsEvent } from '@/lib/ws';
import { playChime, SOUND_MIN_GAP_MS } from '../inbox/sound';

type Family = ReturnType<typeof adminNotificationFamily>;
const FAMILIES: Family[] = ['shops', 'billing', 'moderation', 'safety', 'support', 'alerts'];
const PAGE = 20;
const SOUND_KEY = 'djaber.admin.notifications.sound';
const keys = { all: ['admin', 'notifications'] as const, unread: ['admin', 'notifications', 'unread'] as const, list: (unread: boolean) => ['admin', 'notifications', 'list', unread] as const };

const adminNotifApi = {
  list: async (cursor: string | null, unread: boolean) => {
    const r = await apiRaw<AdminNotificationView[]>('/admin/notifications', { query: { limit: PAGE, ...(cursor ? { cursor } : {}), ...(unread ? { unread: true } : {}) } });
    const meta = (r.meta ?? {}) as { nextCursor?: string | null };
    return { rows: r.data, nextCursor: meta.nextCursor ?? null };
  },
  unreadCount: async () => (await api<{ count: number }>('/admin/notifications/unread-count')).count,
  read: (id: string) => api<{ unreadCount: number }>(`/admin/notifications/${id}/read`, { method: 'POST', body: {} }),
  readAll: () => api<{ unreadCount: number }>('/admin/notifications/read-all', { method: 'POST', body: {} }),
};

/** The chime, per browser (on by default; the switch in the panel turns it off). */
const soundOn = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
};

export function AdminNotificationBell() {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [family, setFamily] = useState<Family | null>(null);
  const [sound, setSound] = useState(true);
  useEffect(() => setSound(soundOn()), []);
  const lastRing = useRef(0);

  const count = useQuery({ queryKey: keys.unread, queryFn: adminNotifApi.unreadCount, refetchInterval: 5 * 60_000 });
  const list = useInfiniteQuery({
    queryKey: keys.list(unreadOnly),
    queryFn: ({ pageParam }) => adminNotifApi.list(pageParam, unreadOnly),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: open,
  });
  const rows = (list.data?.pages ?? []).flatMap((p) => p.rows).filter((r) => !family || adminNotificationFamily(r.kind) === family);

  const open_ = (n: AdminNotificationView) => {
    if (!n.readAt) void adminNotifApi.read(n.id).then((r) => qc.setQueryData(keys.unread, r.unreadCount));
    setOpen(false);
    router.push(n.link);
  };

  // live: count, list, toast with « Voir », chime (at most once every 1.5 s)
  useWsEvent<AdminNotificationEvent>('admin.notification', (e) => {
    if (!e?.notification) return;
    if (typeof e.unreadCount === 'number') qc.setQueryData(keys.unread, e.unreadCount);
    void qc.invalidateQueries({ queryKey: ['admin', 'notifications', 'list'] });
    const n = e.notification;
    toast({ tone: 'info', message: n.body ? `${n.title} — ${n.body}` : n.title, durationMs: 8000, action: { label: t('action.open'), onClick: () => open_(n) } });
    const now = Date.now();
    if (soundOn() && now - lastRing.current >= SOUND_MIN_GAP_MS) {
      lastRing.current = now;
      playChime();
    }
  });
  useWsEvent<{ unreadCount?: number }>('admin.notification.read', (e) => {
    if (typeof e?.unreadCount === 'number') qc.setQueryData(keys.unread, e.unreadCount);
    void qc.invalidateQueries({ queryKey: ['admin', 'notifications', 'list'] });
  });

  const readAll = useMutation({
    mutationFn: adminNotifApi.readAll,
    onSuccess: () => {
      qc.setQueryData(keys.unread, 0);
      void qc.invalidateQueries({ queryKey: ['admin', 'notifications', 'list'] });
    },
  });

  const unread = count.data ?? 0;
  return (
    <>
      <span className="relative inline-flex">
        <IconButton variant="ghost" size="sm" label={t('adminNotif.bell')} onClick={() => setOpen(true)} data-testid="admin-notif-bell">
          <Bell className="size-4" aria-hidden />
        </IconButton>
        {unread > 0 ? (
          <span className="pointer-events-none absolute -end-1 -top-1 min-w-4 rounded-full bg-accent-alert px-1 text-center text-[10px] font-semibold leading-4 text-white" data-testid="admin-notif-count">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </span>
      <SideSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('adminNotif.bell')}
        subtitle={unread ? t('adminNotif.unread', { count: unread }) : undefined}
        width={440}
        closeLabel={t('action.close')}
        headerAction={
          <Button variant="ghost" size="sm" disabled={!unread} loading={readAll.isPending} onClick={() => readAll.mutate()} data-testid="admin-notif-read-all">
            {t('adminNotif.readAll')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3" data-testid="admin-notif-panel">
          <div className="flex flex-wrap items-center gap-1.5">
            {[false, true].map((u) => (
              <button key={String(u)} type="button" onClick={() => setUnreadOnly(u)} className={chip(unreadOnly === u)}>
                {t(u ? 'adminNotif.onlyUnread' : 'adminNotif.all')}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-line-hairline" aria-hidden />
            {FAMILIES.map((f) => (
              <button key={f} type="button" onClick={() => setFamily(family === f ? null : f)} className={chip(family === f)}>
                {t(`adminNotif.family.${f}`)}
              </button>
            ))}
            <label className="ms-auto inline-flex items-center gap-1.5 ts-label-meta text-text-secondary">
              {t('adminNotif.sound')}
              <Switch
                checked={sound}
                onCheckedChange={(v) => {
                  setSound(v);
                  try {
                    localStorage.setItem(SOUND_KEY, v ? 'on' : 'off');
                  } catch {
                    /* private mode: the default stays */
                  }
                }}
                label={t('adminNotif.sound')}
              />
            </label>
          </div>
          {list.isPending ? (
            <p className="text-[13px] text-text-muted">{t('common.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-text-muted">{t('adminNotif.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line-hairline rounded-card border border-line-edge">
              {rows.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => open_(n)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-start hover:bg-ink-raised" data-testid="admin-notif-row">
                    <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent-inbound')} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[14px]', !n.readAt && 'font-semibold')} dir="auto">
                        {n.title}
                      </span>
                      {n.body ? (
                        <span className="block text-[13px] text-text-secondary" dir="auto">
                          {n.body}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block ts-label-meta text-text-muted">
                        {t(`adminNotif.family.${adminNotificationFamily(n.kind)}`)} · {relativeTime(n.createdAt, locale)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.hasNextPage ? (
            <Button variant="secondary" size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {t('adminNotif.more')}
            </Button>
          ) : null}
        </div>
      </SideSheet>
    </>
  );
}

const chip = (on: boolean) => (on ? 'rounded-full border border-white bg-white px-2.5 py-1 text-[12px] text-black' : 'rounded-full border border-line-hairline px-2.5 py-1 text-[12px] text-text-secondary hover:text-text-primary');
