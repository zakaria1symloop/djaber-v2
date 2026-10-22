'use client';
// Platform announcements in the merchant app (06 §8.1, route map §2 layout hooks; tester report 2026-10-21 UX-005):
// - `useAnnouncementBanners()` — `GET /announcements` on mount: one banner id `announcement` (info, dismissible, below every
//   other banner) per live announcement; « Fermer » = `POST /announcements/:id/dismiss`; « En savoir plus » opens its link;
// - `AnnouncementDialog` — the notification `platform.announcement` opens `/notifications?announcement=<id>`: the full text,
//   or why it is not shown any more (ended / withdrawn / not started).
import type { AnnouncementView, AppLocale } from '@djaber/shared';
import { formatDateTime } from '@djaber/shared';
import { Button, Dialog, FormAlert, Skeleton } from '@djaber/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShellBanner } from '@/components/shell/banner-stack';
import { QueryError } from '@/components/global-states';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { announcementLink } from './links';

export const announcementKeys = {
  list: (ws: string | null) => [ws, 'announcements'] as const,
  one: (ws: string | null, id: string) => [ws, 'announcements', id] as const,
};

function useOpenLink() {
  const router = useRouter();
  return (link: string | null) => {
    const l = announcementLink(link);
    if (!l) return;
    if (l.external) window.open(l.href, '_blank', 'noopener,noreferrer');
    else router.push(l.href);
  };
}

export function useAnnouncementBanners(): ShellBanner[] {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const open = useOpenLink();
  const q = useQuery({ queryKey: announcementKeys.list(ws), queryFn: () => api<AnnouncementView[]>('/announcements'), enabled: !!ws, staleTime: 5 * 60_000, retry: false });
  const dismiss = (id: string) => {
    qc.setQueryData<AnnouncementView[]>(announcementKeys.list(ws), (old) => old?.filter((a) => a.id !== id));
    // a failed dismissal only brings the banner back on the next load
    void api(`/announcements/${id}/dismiss`, { method: 'POST' }).catch(() => undefined);
  };
  return (q.data ?? []).map((a) => ({
    id: 'announcement' as const,
    tone: 'info' as const,
    content: (
      <span data-testid="announcement-banner" data-id={a.id}>
        <strong className="font-medium">{a.title}</strong>
        {a.body ? <span className="text-text-secondary"> — {a.body.split('\n')[0]!.slice(0, 200)}</span> : null}
      </span>
    ),
    action: announcementLink(a.link) ? { label: t('announcements.more'), onClick: () => open(a.link) } : undefined,
    onDismiss: () => dismiss(a.id),
  }));
}

export function AnnouncementDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const ws = useWorkspaceId();
  const open = useOpenLink();
  const q = useQuery({ queryKey: announcementKeys.one(ws, id ?? ''), queryFn: () => api<AnnouncementView>(`/announcements/${id}`), enabled: !!ws && !!id, retry: false });
  const a = q.data;
  const link = announcementLink(a?.link);
  return (
    <Dialog
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={a?.title ?? t('announcements.title')}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.close')}
          </Button>
          {a && link && a.state === 'live' ? (
            <Button variant="primary" onClick={() => open(a.link)}>
              {t('announcements.more')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="announcement-dialog" data-state={a?.state}>
        {q.isPending && id ? (
          <Skeleton className="h-24 w-full" />
        ) : q.isError ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : a ? (
          <>
            {a.state !== 'live' ? <FormAlert tone="warning">{t(`announcements.state.${a.state}`)}</FormAlert> : null}
            <p className="ts-label-meta text-text-muted">
              {t('announcements.published', { date: formatDateTime(a.publishedAt, locale) })}
              {a.endsAt ? ` · ${t('announcements.until', { date: formatDateTime(a.endsAt, locale) })}` : ''}
            </p>
            <p className="whitespace-pre-line text-[14px] leading-relaxed text-text-primary">{a.body}</p>
            {a.fallback ? <p className="ts-label-micro !normal-case text-text-muted">{t('announcements.fallback')}</p> : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
