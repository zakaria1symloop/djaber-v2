'use client';
// /reports — Figma "ANA-03 — Reports — hub (23 reports) + export jobs" (12 §24): Admin+ only (`reports.read`, an
// Operator gets the 403 page and no sidebar item), groups VENTES & REVENUS · COMMANDES & LIVRAISON · STOCK · ACHATS &
// CAISSE · CLIENTS with their count, ★ favourites (`PATCH /me/prefs { reportFavorites }`, shown first), search (`?q=`,
// [FE] "Aucun rapport…"), simple stock mode = 9 reports, "Exports récents" = `GET /jobs?kind=export` rows EN COURS n %
// (Annuler) / PRÊT · expire dans n j (Télécharger) / ÉCHEC REPORT_EXPORT_FAILED (Réessayer) / ANNULÉ.
import { formatNumber, type ReportHubItem, type ReportKey, type ReportsHubView } from '@djaber/shared';
import { Button, Card, EmptyState, ExportJobRow, FilteredEmptyState, ListCard, ListSkeleton, ReportGroup, ReportRow, SearchInput, toast } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { JobParamBanner } from '@/components/job-param-banner';
import { OfflineBanner, QueryError } from '@/components/global-states';
import { refusal } from '@/features/orders/dialogs/common';
import { useOffline } from '@/features/orders/offline';
import { Link } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl, type JobDto, jobFileName } from '@/lib/jobs';
import { useWorkspaceId } from '@/lib/session';
import { jobView } from './logic';
import { reportsApi, reportsKeys, useExportJobs, useReportsHub } from './api';

export function ReportsHubPage() {
  const t = useT();
  const hub = useReportsHub();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const offline = useOffline();
  const q = params.get('q') ?? '';
  const setQ = (v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v.trim()) p.set('q', v.trim());
    else p.delete('q');
    router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  const toggle = useToggleFavorite();
  const data = hub.data;
  const needle = q.trim().toLowerCase();
  const match = (r: ReportHubItem) => !needle || `${t(`report.${r.key}.title`)} ${t(`report.${r.key}.description`, { days: 60 })}`.toLowerCase().includes(needle);
  const groups = useMemo(() => (data ? data.groups.map((g) => ({ ...g, reports: g.reports.filter((r) => r.visible && match(r)) })).filter((g) => g.reports.length) : []), [data, needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const favorites = useMemo(() => (data ? data.groups.flatMap((g) => g.reports).filter((r) => r.visible && r.favorite && match(r)) : []), [data, needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const row = (r: ReportHubItem) => (
    <ReportRow
      key={r.key}
      data-report={r.key}
      name={t(`report.${r.key}.title`)}
      favorite={r.favorite}
      favoriteLabel={t(r.favorite ? 'reports.favorite.remove' : 'reports.favorite.add')}
      onToggleFavorite={offline || !data ? undefined : () => toggle(data, r.key)}
      badge={r.scheduled ? <span className="ts-label-micro text-text-muted" title={t('reports.scheduled')}>✉</span> : undefined}
      renderLink={(children, className) => (
        <Link href={`/reports/${r.key}`} className={className}>
          {children}
        </Link>
      )}
    />
  );
  return (
    <AppPage
      wide
      title={t('nav.reports')}
      description={data ? t('reports.subtitle', { count: data.visibleCount, max: formatNumber(data.csvImmediateMaxRows) }) : t('reports.subtitleShort')}
      permission="reports.read"
      actions={<SearchInput value={q} onChange={setQ} label={t('action.search')} placeholder={t('reports.search')} clearLabel={t('list.clearSearch')} className="w-full sm:w-72" />}
    >
      {offline ? <OfflineBanner since="—" onRetry={() => void hub.refetch()} /> : null}
      <JobParamBanner />
      {hub.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="reports-skeleton">
          {/* the five groups of the hub at their usual sizes: the "Exports récents" block below does not jump on load */}
          {[7, 2, 5, 7, 2].map((rows, i) => (
            <Card key={i}>
              <ListSkeleton rows={rows} columns={2} label={t('common.loading')} />
            </Card>
          ))}
        </div>
      ) : hub.isError ? (
        <QueryError error={hub.error} onRetry={() => void hub.refetch()} />
      ) : !groups.length ? (
        needle ? (
          <FilteredEmptyState title={t('state.list.filteredEmpty.title')} description={t('reports.filteredEmpty', { q })} action={{ label: t('action.clearFilters'), onClick: () => setQ('') }} />
        ) : (
          <EmptyState icon={<FileText className="size-5" />} title={t('reports.empty')} />
        )
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="reports-groups">
          {favorites.length ? (
            <ReportGroup title={t('reports.favorites')} count={favorites.length} data-group="favorites">
              {favorites.map(row)}
            </ReportGroup>
          ) : null}
          {groups.map((g) => (
            <ReportGroup key={g.key} title={t(`report.group.${g.key}`)} count={g.reports.length} data-group={g.key}>
              {g.reports.map(row)}
            </ReportGroup>
          ))}
        </div>
      )}
      {data?.stockMode === 'simple' ? <p className="ts-label-micro !normal-case text-text-muted" data-testid="reports-simple-note">{t('reports.simpleNote', { count: data.visibleCount })}</p> : null}
      <ExportJobs />
    </AppPage>
  );
}

/** ★ toggle: optimistic on the hub cache, rolled back on error. */
export function useToggleFavorite() {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return async (data: ReportsHubView, key: ReportKey) => {
    const on = !data.favorites.includes(key);
    const favorites = on ? [...data.favorites, key] : data.favorites.filter((k) => k !== key);
    const next: ReportsHubView = { ...data, favorites, groups: data.groups.map((g) => ({ ...g, reports: g.reports.map((r) => (r.key === key ? { ...r, favorite: on } : r)) })) };
    qc.setQueryData(reportsKeys.hub(ws), next);
    try {
      await reportsApi.setFavorites(favorites);
      void qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      qc.setQueryData(reportsKeys.hub(ws), data);
      toast({ tone: 'danger', message: refusal(e, t) });
    }
  };
}

/* ---------- Exports récents ---------- */
export function ExportJobs() {
  const t = useT();
  const locale = useLocaleCode();
  const jobs = useExportJobs();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const offline = useOffline();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (job: JobDto, kind: 'cancel' | 'retry') => {
    setBusy(job.id);
    try {
      if (kind === 'cancel') {
        await reportsApi.cancelJob(job.id);
        toast(t('reports.jobs.cancelled'));
      } else {
        await reportsApi.retryJob(job.id);
        toast(t('reports.jobs.retried'));
      }
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: reportsKeys.exports(ws) });
    }
  };
  const rows = (jobs.data ?? []).slice(0, 10);
  return (
    <section className="flex flex-col gap-2" aria-labelledby="exports-title" data-testid="export-jobs">
      <h2 id="exports-title" className="ts-label-meta uppercase tracking-[0.2em] text-text-muted">
        {t('reports.jobs.title')}
      </h2>
      {jobs.isPending ? (
        <Card>
          <ListSkeleton rows={3} columns={3} label={t('common.loading')} />
        </Card>
      ) : jobs.isError ? (
        <QueryError error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : !rows.length ? (
        <Card className="px-4 py-6 text-center ts-label-meta text-text-muted" data-testid="export-jobs-empty">
          {t('reports.jobs.empty')}
        </Card>
      ) : (
        <ListCard>
          {rows.map((job) => {
            const v = jobView(job, t, locale);
            const action =
              v.state === 'running' ? (
                <Button variant="ghost" onClick={() => void act(job, 'cancel')} loading={busy === job.id} disabledReason={offline ? t('banner.offline') : undefined} data-testid="job-cancel">
                  {t('action.cancel')}
                </Button>
              ) : v.state === 'ready' && job.resultUrl ? (
                <Button variant="ghost" onClick={() => downloadUrl(job.resultUrl!, jobFileName(job))} data-testid="job-download">
                  {t('action.download')}
                </Button>
              ) : v.state === 'failed' ? (
                <Button variant="ghost" onClick={() => void act(job, 'retry')} loading={busy === job.id} disabledReason={offline ? t('banner.offline') : undefined} data-testid="job-retry">
                  {t('action.retry')}
                </Button>
              ) : undefined;
            return <ExportJobRow key={job.id} data-job={job.id} title={v.title} meta={v.meta} state={v.state} pill={v.pill} progress={job.progress} action={action} />;
          })}
        </ListCard>
      )}
    </section>
  );
}
