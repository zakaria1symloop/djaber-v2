'use client';
// Google Sheets card (GSH-01…08, Figma "SET — Settings — Integrations" block "Google Sheets" + its 4 state notes, DLG
// "Google Sheets — choisir la feuille"). States: not connected · connecting (redirect to Google) · pick sheet (Picker /
// URL / create) · active (last sync, rows) · error token revoked · error sheet missing · Google verification pending ·
// backfill job (progress) · plan without `google_sheets`. Every button follows the server `actions` (disabled reasons).
import { formatNumber, type SheetsIntegrationDto } from '@djaber/shared';
import { Banner, Button, ConfirmDialog, ConnectionNote, FormAlert, Pill, ProgressBar, toast, type Tone } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { usePathname as useRawPathname, useRouter as useRawRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { useChannels } from '@/features/channels/api';
import { actionState } from '@/lib/actions';
import { isJobRunning, useJob } from '@/lib/jobs';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { integrationKeys, integrationsApi, useSheets, useSheetsStatus } from './api';
import { CardSkeleton, IntegrationCard, PlanGate } from './common';
import { SheetsDialog, type SheetsDialogMode } from './sheets-dialog';

const SHEETS_RETURN = '/settings/integrations/sheets';

export function SheetsTab() {
  const t = useT();
  const locale = useLocaleCode();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const q = useSheets();
  const params = useSearchParams();
  const rawPath = useRawPathname();
  const rawRouter = useRawRouter();
  const s = q.data;
  const status = useSheetsStatus(!!s && (s.state === 'active' || s.state === 'error'));
  const [dialog, setDialog] = useState<SheetsDialogMode | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const openAfterConnect = useRef(false);
  const backfill = useJob(s?.backfill && isJobRunning({ status: s.backfill.status as 'running' }) ? s.backfill.jobId : null);
  const disconnect = useMutation({ mutationFn: integrationsApi.sheetsDisconnect });

  // return from Google (`?sheets=connected` / `?sheets=error&code=`): toast or inline error, then a clean URL
  useEffect(() => {
    const r = params.get('sheets');
    if (!r) return;
    if (r === 'connected') {
      toast({ tone: 'success', message: t('settings.integrations.sheets.toast.connected') });
      openAfterConnect.current = true;
    } else {
      const code = params.get('code') ?? 'INTERNAL';
      setReturnError(code);
    }
    rawRouter.replace(rawPath, { scroll: false });
    void qc.invalidateQueries({ queryKey: integrationKeys.sheets(ws) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on arrival
  }, []);
  // just connected and no sheet yet: open the sheet choice at once (Figma "Après OAuth Google")
  useEffect(() => {
    if (openAfterConnect.current && s?.state === 'pick_sheet') {
      openAfterConnect.current = false;
      setDialog('choose');
    }
  }, [s?.state]);
  // the backfill ended: refresh the card (rows synced, actions)
  const backfillDone = backfill.data && !isJobRunning(backfill.data);
  useEffect(() => {
    if (!backfillDone) return;
    void qc.invalidateQueries({ queryKey: integrationKeys.sheets(ws) });
    if (backfill.data?.status === 'done' || backfill.data?.status === 'partial') toast({ tone: 'success', message: t('settings.integrations.sheets.backfill.done') });
    else toast({ tone: 'danger', message: t('settings.integrations.sheets.backfill.failed') });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per finished job
  }, [backfillDone]);

  if (q.isPending) return <CardSkeleton rows={5} label={t('settings.integrations.sheets.title')} />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  const data = s!;
  // the light poll carries the freshest health; the full view the rest
  const live = status.data && status.data.state === data.state ? status.data : null;
  const lastSyncAt = live?.lastSyncAt ?? data.lastSyncAt;
  const rowsSynced = live?.rowsSynced ?? data.rowsSynced;
  const lastError = live ? live.lastError : data.lastError;
  const a = (key: string) => actionState(data.actions, key, t);

  const connect = async () => {
    setConnecting(true);
    setReturnError(null);
    try {
      const { url } = await integrationsApi.sheetsConnect(`/${locale}${SHEETS_RETURN}`);
      window.location.assign(url);
    } catch (e) {
      setConnecting(false);
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };

  const pill: { tone: Tone; text: string } =
    data.state === 'active'
      ? { tone: 'success', text: lastSyncAt ? t('settings.integrations.sheets.pill.synced', { ago: relativeTime(lastSyncAt, locale) }) : t('settings.integrations.sheets.pill.connected') }
      : data.state === 'pick_sheet'
        ? { tone: 'warning', text: t('settings.integrations.sheets.pill.pickSheet') }
        : data.state === 'error'
          ? { tone: 'danger', text: t('settings.integrations.sheets.pill.error') }
          : { tone: 'neutral', text: t('settings.integrations.sheets.pill.notConnected') };

  const connectA = a('connect');
  const changeA = a('change_sheet');
  const filtersA = a('edit_filters');
  const backfillA = a('backfill');
  const disconnectA = a('disconnect');
  const reconnectA = a('reconnect');
  const running = backfill.data && isJobRunning(backfill.data) ? backfill.data : null;

  return (
    <>
      <IntegrationCard
        testId="sheets-card"
        state={data.state}
        title={t('settings.integrations.sheets.title')}
        description={t('settings.integrations.sheets.description')}
        status={
          <span data-testid="sheets-pill">
            <Pill tone={pill.tone} dot>
              {pill.text}
            </Pill>
          </span>
        }
      >
        {!data.featureEnabled ? <PlanGate feature="google_sheets" /> : null}
        {returnError ? (
          <Banner tone="danger" onDismiss={() => setReturnError(null)} dismissLabel={t('action.close')}>
            <span data-testid="sheets-return-error">
              {t('settings.integrations.sheets.returnError')} {t.has(`error.${returnError}`) ? t(`error.${returnError}`) : ''} ({returnError})
            </span>
          </Banner>
        ) : null}
        {data.verificationPending && data.state !== 'not_connected' ? (
          <ConnectionNote tone="warning" label={t('settings.integrations.sheets.verification.label')}>
            {t('settings.integrations.sheets.verification.text')}
          </ConnectionNote>
        ) : null}
        {data.state === 'error' && lastError ? (
          <span data-testid="sheets-error" data-code={lastError.code}>
            <ConnectionNote
              tone="danger"
              label={lastError.code === 'SHEETS_TOKEN_REVOKED' ? t('settings.integrations.sheets.error.revoked.label') : lastError.code === 'SHEETS_SPREADSHEET_NOT_FOUND' ? t('settings.integrations.sheets.error.missing.label') : t('settings.integrations.sheets.error.other.label')}
              action={
                lastError.code === 'SHEETS_TOKEN_REVOKED' && reconnectA.present ? (
                  <Button size="sm" variant="primary" onClick={() => void connect()} loading={connecting} disabledReason={reconnectA.reason} data-testid="sheets-reconnect">
                    {t('settings.integrations.sheets.reconnect')}
                  </Button>
                ) : changeA.present ? (
                  <Button size="sm" variant="primary" onClick={() => setDialog('choose')} disabledReason={changeA.reason} data-testid="sheets-pick-other">
                    {t('settings.integrations.sheets.pickOther')}
                  </Button>
                ) : undefined
              }
            >
              {lastError.code === 'SHEETS_TOKEN_REVOKED' ? t('settings.integrations.sheets.error.revoked.text') : lastError.code === 'SHEETS_SPREADSHEET_NOT_FOUND' ? t('settings.integrations.sheets.error.missing.text') : lastError.message}
            </ConnectionNote>
          </span>
        ) : null}

        {data.state === 'not_connected' ? (
          <ConnectionNote label={t('settings.integrations.sheets.notConnected.label')}>{t('settings.integrations.sheets.notConnected.text')}</ConnectionNote>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-[minmax(9rem,auto)_minmax(0,1fr)]" data-testid="sheets-details">
            <Row label={t('settings.integrations.sheets.row.account')}>
              <bdi dir="ltr">{data.googleEmail ?? '—'}</bdi>
            </Row>
            <Row label={t('settings.integrations.sheets.row.sheet')}>
              {data.spreadsheetUrl ? (
                <a href={data.spreadsheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-accent-inbound hover:underline" data-testid="sheets-link" title={data.spreadsheetTitle ?? undefined}>
                  <span className="truncate" dir="auto">
                    {data.spreadsheetTitle}
                  </span>
                  <ExternalLink className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
                  <span className="shrink-0 text-text-muted">{t('settings.integrations.sheets.tabNote', { tab: data.sheetName })}</span>
                </a>
              ) : (
                <span className="text-text-muted">{t('settings.integrations.sheets.noSheet')}</span>
              )}
            </Row>
            <Row label={t('settings.integrations.sheets.row.filters')}>
              <FiltersSummary filters={data.filters} />
            </Row>
            <Row label={t('settings.integrations.sheets.row.columns')}>
              <span className="text-text-secondary" dir="auto">
                {data.columns.join(', ')}
              </span>
            </Row>
            <Row label={t('settings.integrations.sheets.row.rows')}>
              <span data-testid="sheets-rows" className="tabular-nums">
                {t('settings.integrations.sheets.rows', { count: formatNumber(rowsSynced) })}
                {live && live.pendingRows > 0 ? <span className="text-text-muted"> · {t('settings.integrations.sheets.pending', { count: formatNumber(live.pendingRows) })}</span> : null}
              </span>
            </Row>
            <Row label={t('settings.integrations.sheets.row.lastError')}>
              <span className={lastError ? 'text-accent-alert' : 'text-text-secondary'}>{lastError ? lastError.message : t('settings.integrations.sheets.noError')}</span>
            </Row>
          </dl>
        )}

        {running || (data.backfill && isJobRunning({ status: data.backfill.status as 'running' })) ? (
          <div className="flex flex-col gap-1.5" data-testid="sheets-backfill-progress">
            <span className="ts-label-micro uppercase text-accent-inbound">{t('settings.integrations.sheets.backfill.running', { progress: running?.progress ?? data.backfill?.progress ?? 0 })}</span>
            <ProgressBar value={running?.progress ?? data.backfill?.progress ?? 0} label={t('settings.integrations.sheets.backfill.title')} />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {data.state === 'not_connected' && connectA.present ? (
            <Button variant="primary" onClick={() => void connect()} loading={connecting} disabledReason={connectA.reason} data-testid="sheets-connect">
              {connecting ? t('settings.integrations.sheets.connecting') : t('settings.integrations.sheets.connect')}
            </Button>
          ) : null}
          {data.state !== 'not_connected' && changeA.present && !(data.state === 'error' && lastError?.code === 'SHEETS_SPREADSHEET_NOT_FOUND') ? (
            <Button variant={data.state === 'pick_sheet' ? 'primary' : 'secondary'} onClick={() => setDialog('choose')} disabledReason={changeA.reason} data-testid="sheets-choose">
              {data.state === 'pick_sheet' ? t('settings.integrations.sheets.choose') : t('settings.integrations.sheets.change')}
            </Button>
          ) : null}
          {data.spreadsheetId && backfillA.present ? (
            <Button onClick={() => setDialog('backfill')} disabledReason={backfillA.reason} data-testid="sheets-backfill">
              {t('settings.integrations.sheets.backfill.open')}
            </Button>
          ) : null}
          {data.spreadsheetId && filtersA.present ? (
            <Button variant="ghost" onClick={() => setDialog('filters')} disabledReason={filtersA.reason} data-testid="sheets-filters">
              {t('settings.integrations.sheets.editFilters')}
            </Button>
          ) : null}
          {data.state !== 'not_connected' && disconnectA.present ? (
            <Button className="border-accent-alert/60 text-accent-alert hover:border-accent-alert" onClick={() => (setDisconnectError(null), setConfirmDisconnect(true))} disabledReason={disconnectA.reason} data-testid="sheets-disconnect">
              {t('action.disconnect')}
            </Button>
          ) : null}
        </div>
      </IntegrationCard>

      <SheetsDialog mode={dialog} data={data} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={(o) => !o && setConfirmDisconnect(false)}
        title={t('settings.integrations.sheets.disconnect.title')}
        description={t('settings.integrations.sheets.disconnect.text')}
        confirmLabel={t('action.disconnect')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        loading={disconnect.isPending}
        onConfirm={async () => {
          setDisconnectError(null);
          try {
            const next = await disconnect.mutateAsync();
            qc.setQueryData(integrationKeys.sheets(ws), next);
            setConfirmDisconnect(false);
            toast(t('settings.integrations.sheets.toast.disconnected'));
          } catch (e) {
            setDisconnectError(errorMessage(e, t));
          }
        }}
      >
        {disconnectError ? <FormAlert>{disconnectError}</FormAlert> : null}
      </ConfirmDialog>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="ts-label-micro self-center uppercase text-text-muted">{label}</dt>
      <dd className="min-w-0 text-[13px]">{children}</dd>
    </>
  );
}

/** "Toutes les pages · sources IA + manuel" */
function FiltersSummary({ filters }: { filters: SheetsIntegrationDto['filters'] }) {
  const t = useT();
  const channels = useChannels(filters.channelIds.length > 0);
  const names = filters.channelIds.map((id) => channels.data?.rows.find((c) => c.id === id)?.name ?? '…');
  const pages = filters.channelIds.length ? names.join(', ') : t('settings.integrations.sheets.filters.allPages');
  const sources = filters.sources.length ? t('settings.integrations.sheets.filters.sources', { list: filters.sources.map((s) => t(`settings.integrations.sheets.source.${s}`)).join(' + ') }) : t('settings.integrations.sheets.filters.allSources');
  return (
    <span className="text-text-secondary" data-testid="sheets-filters-summary" dir="auto">
      {pages} · {sources}
    </span>
  );
}
