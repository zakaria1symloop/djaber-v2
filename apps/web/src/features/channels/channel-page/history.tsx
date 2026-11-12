'use client';
// /channels/[id]/history — Figma "CHN-07b — … Historique de la page (Channel events)" + DLG "Synchroniser l'historique":
// events timeline with type and period filters in the URL, and the history sync (7 / 30 / 90 days) as a tracked job.
// `PAGE_SYNC_TOKEN_EXPIRED` ⇒ the token-expired state with "Reconnecter".
import { Banner, Button, Card, Dialog, FilterCheckList, FilterDropdown, FormAlert, Ltr, ProgressBar, SegmentedControl, toast } from '@djaber/ui';
import { formatDateTime, type AppLocale } from '@djaber/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ListEmpty, ListFilteredEmpty, ListLoading, QueryError } from '@/components/global-states';
import { reasonText } from '@/lib/actions';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { isJobRunning, useJob } from '@/lib/jobs';
import { channelsApi, useChannelEventsList, useChannelsRefresh, useChannelSummary } from '../api';
import { CHANNEL_EVENT_KINDS, SYNC_DAYS, type ChannelEventKind, type SyncDays, type SyncResult } from '../contracts';
import { eventsQuery, HISTORY_PERIODS, parseEventKinds, parseHistoryPeriod, type HistoryPeriod } from '../logic';
import { useChannelPage } from './channel-shell';

const isTokenExpired = (code: string | null | undefined) => code === 'PAGE_SYNC_TOKEN_EXPIRED' || code === 'PAGE_TOKEN_EXPIRED';

export function ChannelHistory() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { channel: c, actions, connect } = useChannelPage();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const refresh = useChannelsRefresh();
  const summary = useChannelSummary(c.id);

  const kinds = parseEventKinds(params.get('kind'));
  const period = parseHistoryPeriod(params.get('period'));
  const kindsKey = kinds.join(',');
  const query = useMemo(() => eventsQuery(parseEventKinds(kindsKey), period), [kindsKey, period]);
  const q = useChannelEventsList(c.id, query);
  const write = (patch: { kind?: ChannelEventKind[]; period?: HistoryPeriod }) => {
    const p = new URLSearchParams(params.toString());
    if (patch.kind?.length) p.set('kind', patch.kind.join(','));
    else if (patch.kind) p.delete('kind');
    if (patch.period && patch.period !== '30d') p.set('period', patch.period);
    else if (patch.period) p.delete('period');
    router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  const filtered = kinds.length > 0 || period !== '30d';

  /* ---------- history sync job ---------- */
  const [dialog, setDialog] = useState(false);
  const [started, setStarted] = useState<string | null>(null);
  const jobId = started ?? summary.data?.lastHistorySyncJobId ?? null;
  const job = useJob<SyncResult>(jobId);
  const running = !!jobId && !!job.data && isJobRunning(job.data);
  const jobStatus = job.data?.status;
  const { refetch } = q;
  useEffect(() => {
    // the timeline gains a `history_synced` event when the job ends
    if (started && jobStatus && jobStatus !== 'queued' && jobStatus !== 'running') {
      void refetch();
      void refresh(c.id);
    }
  }, [started, jobStatus, refetch, refresh, c.id]);
  const expired = c.status === 'needs_reconnect' || isTokenExpired(job.data?.error?.code);
  const syncDescriptor = actions.descriptor(c, 'syncHistory');
  const canSync = actions.manage && (!!syncDescriptor || expired);

  const rows = q.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-4">
      {expired ? (
        <Banner tone="danger" action={actions.manage ? { label: t('action.reconnect'), onClick: () => void connect.reconnect(c) } : undefined}>
          <span data-testid="sync-token-expired">
            {t('error.PAGE_SYNC_TOKEN_EXPIRED')}
          </span>
        </Banner>
      ) : null}
      {started && job.data ? (
        <Card className="flex flex-col gap-2.5 p-4" data-testid="sync-job" data-status={job.data.status}>
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span>
              {running
                ? t('channels.sync.running')
                : job.data.status === 'done' || job.data.status === 'partial'
                  ? t('channels.sync.done', { conversations: job.data.result?.conversations ?? 0, messages: job.data.result?.messagesImported ?? 0 })
                  : job.data.error?.message || t('channels.sync.failed')}
            </span>
            <Ltr className="ts-label-meta tabular-nums text-text-muted">{running ? `${Math.round(job.data.progress)} %` : ''}</Ltr>
          </div>
          {running ? <ProgressBar value={job.data.progress || null} label={t('channels.sync.running')} /> : null}
        </Card>
      ) : null}

      <Card className="flex flex-col" data-testid="channel-history">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
          <h2 className="ts-title me-auto">{t('channels.history.title')}</h2>
          {canSync ? (
            <Button
              onClick={() => setDialog(true)}
              loading={running}
              disabledReason={expired ? t('error.PAGE_SYNC_TOKEN_EXPIRED') : syncDescriptor && !syncDescriptor.enabled ? reasonText(t, syncDescriptor.reasonCode) : undefined}
              data-testid="sync-history"
            >
              {t('channels.sync.open')}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <FilterDropdown label={t('channels.history.filter.kind', { value: kinds.length ? String(kinds.length) : t('channels.history.filter.all') })} count={kinds.length || undefined}>
            <FilterCheckList options={CHANNEL_EVENT_KINDS.map((k) => ({ value: k, label: t(`channels.event.${k}`) }))} value={kinds} onChange={(next) => write({ kind: next as ChannelEventKind[] })} maxHeight={260} />
          </FilterDropdown>
          <SegmentedControl label={t('channels.history.filter.period')} value={period} onChange={(p) => write({ period: p })} options={HISTORY_PERIODS.map((p) => ({ value: p, label: t(`channels.history.period.${p}`) }))} />
        </div>
        {q.isPending ? (
          <ListLoading rows={5} columns={3} />
        ) : q.isError ? (
          <div className="p-4">
            <QueryError error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            {filtered ? (
              <ListFilteredEmpty entity={t('channels.history.entity')} filters={[kinds.map((k) => t(`channels.event.${k}`)).join(', '), t(`channels.history.period.${period}`)].filter(Boolean).join(' · ')} onClear={() => router.replace(pathname, { scroll: false })} />
            ) : (
              <ListEmpty title={t('channels.history.empty')} />
            )}
          </div>
        ) : (
          <ol className="divide-y divide-line-hairline px-4 pb-2" data-testid="channel-events">
            {rows.map((e) => (
              <li key={e.id} data-kind={e.kind} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                <Ltr className="ts-label-meta w-32 shrink-0 text-text-muted">{formatDateTime(e.at, locale)}</Ltr>
                <span className="min-w-0 flex-1 text-[13px]">{e.description || t(`channels.event.${e.kind}`)}</span>
                <span className="ts-label-meta text-text-muted">{e.actor ? `${e.actor.firstName} ${e.actor.lastName.slice(0, 1)}.` : t('channels.history.system')}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <SyncDialog
        open={dialog}
        name={c.name}
        onClose={() => setDialog(false)}
        onStarted={(id) => {
          setDialog(false);
          setStarted(id);
          toast({ tone: 'info', message: t('toast.jobStarted') });
        }}
        channelId={c.id}
        onExpired={() => void refresh(c.id)}
      />
    </div>
  );
}

/** DLG "Synchroniser l'historique": 7 / 30 / 90 days (90 = Pro), background job, no AI reply on the history. */
function SyncDialog({ open, name, channelId, onClose, onStarted, onExpired }: { open: boolean; name: string; channelId: string; onClose: () => void; onStarted: (jobId: string) => void; onExpired: () => void }) {
  const t = useT();
  const [days, setDays] = useState<SyncDays>(30);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  useEffect(() => {
    if (open) {
      setDays(30);
      setError(null);
    }
  }, [open]);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const { jobId } = await channelsApi.sync(channelId, days);
      onStarted(jobId);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      setError({ message: errorMessage(e, t), code });
      if (isTokenExpired(code)) onExpired();
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={t('channels.sync.title')}
      description={t('channels.sync.description', { name, days })}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} data-testid="sync-submit">
            {t('channels.sync.submit')}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label={t('channels.sync.title')} className="flex flex-col gap-1">
        {SYNC_DAYS.map((d) => (
          <label key={d} className="flex cursor-pointer items-center gap-3 rounded-card px-2 py-2 text-[13px] hover:bg-ink-raised">
            <input type="radio" name="sync-days" value={d} checked={days === d} onChange={() => setDays(d)} className="size-4 accent-white" disabled={pending} />
            <span>{t(d === 90 ? 'channels.sync.daysPro' : 'channels.sync.days', { days: d })}</span>
          </label>
        ))}
      </div>
      <p className="ts-label-meta mt-4 text-text-muted">{t('channels.sync.note')}</p>
      {error ? (
        <FormAlert className="mt-4">
          {error.message}
        </FormAlert>
      ) : null}
    </Dialog>
  );
}
