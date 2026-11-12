'use client';
// DLG "Google Sheets — choisir la feuille" (GSH-02 / GSH-05 / GSH-06): choose the sheet (Google Picker — or the list of
// simulated spreadsheets when the API runs the fake Google —, pasted URL, or create "Djaber · Commandes <boutique>"),
// filters (pages, sources) and an optional history export range. The same dialog edits the filters only, or starts a
// backfill only. Errors inline (SHEETS_SPREADSHEET_NOT_FOUND under the URL), content preserved.
import { OrderSourceValues, SheetsBackfillSchema, SPREADSHEET_URL_RE, type OrderSource, type SheetsFilters, type SheetsIntegrationDto } from '@djaber/shared';
import { Button, Checkbox, CheckChip, Dialog, Field, FormAlert, Input, toast, UrlInput } from '@djaber/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useChannels } from '@/features/channels/api';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { uuid } from '@/lib/uuid';
import { integrationKeys, integrationsApi } from './api';
import { openGooglePicker } from './google-picker';
import { algiersDay } from './logic';

export type SheetsDialogMode = 'choose' | 'filters' | 'backfill';
type Source = 'picker' | 'url' | 'create';

export function SheetsDialog({ mode, data, onClose }: { mode: SheetsDialogMode | null; data: SheetsIntegrationDto; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { workspace } = useSession();
  const open = mode !== null;
  const [source, setSource] = useState<Source>('picker');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SheetsFilters>(data.filters);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(uuid);
  const channels = useChannels(open && mode !== 'backfill');

  // re-seeded at each opening
  useEffect(() => {
    if (!open) return;
    setSource('picker');
    setPicked(null);
    setUrl('');
    setUrlError(null);
    setFilters(data.filters);
    setFiltersError(null);
    setFormError(null);
    setRangeError(null);
    setIdemKey(uuid());
    const today = new Date();
    setFrom(mode === 'backfill' ? algiersDay(new Date(today.getTime() - 30 * 86_400_000)) : '');
    setTo(mode === 'backfill' ? algiersDay(today) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open, mode]);

  // Picker token (and, with the simulated Google, the list of spreadsheets)
  const picker = useQuery({
    queryKey: [ws, 'integrations', 'sheets', 'picker'],
    queryFn: integrationsApi.sheetsPicker,
    enabled: open && mode === 'choose' && source === 'picker',
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const save = useMutation({
    mutationFn: async () => {
      let result: SheetsIntegrationDto | null = null;
      if (mode === 'choose') {
        const body = source === 'picker' ? { spreadsheetId: picked!.id } : source === 'url' ? { spreadsheetUrl: url.trim() } : { createNew: true as const };
        result = await integrationsApi.sheetsPut({ ...body, filters });
      } else if (mode === 'filters') {
        result = await integrationsApi.sheetsPut({ filters });
      }
      if (result) qc.setQueryData(integrationKeys.sheets(ws), result);
      if (from && to) await integrationsApi.sheetsBackfill({ from, to }, idemKey);
      return result;
    },
  });

  const [pagesOpen, setPagesOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  useEffect(() => {
    if (open) {
      setPagesOpen(data.filters.channelIds.length > 0);
      setSourcesOpen(data.filters.sources.length > 0);
    }
  }, [open, data.filters]);

  const pickerFiles = picker.data?.files ?? [];
  const createName = t('settings.integrations.sheets.dialog.createName', { name: workspace?.name ?? '' });

  const validate = (): boolean => {
    let ok = true;
    setUrlError(null);
    setFiltersError(null);
    setRangeError(null);
    if (mode === 'choose') {
      if (source === 'picker' && !picked) {
        setFormError(t('settings.integrations.sheets.dialog.pickRequired'));
        ok = false;
      }
      if (source === 'url' && !SPREADSHEET_URL_RE.test(url.trim())) {
        setUrlError(t('settings.integrations.sheets.dialog.urlInvalid'));
        ok = false;
      }
    }
    if (mode !== 'backfill' && ((pagesOpen && filters.channelIds.length === 0) || (sourcesOpen && filters.sources.length === 0))) {
      setFiltersError(t('settings.integrations.sheets.dialog.filtersRequired'));
      ok = false;
    }
    if (from || to || mode === 'backfill') {
      const r = SheetsBackfillSchema.safeParse({ from, to });
      if (!r.success) {
        setRangeError(t('settings.integrations.sheets.dialog.rangeInvalid'));
        ok = false;
      }
    }
    return ok;
  };

  const submit = async () => {
    setFormError(null);
    if (!validate()) return;
    try {
      const result = await save.mutateAsync();
      if (mode === 'choose') toast({ tone: 'success', message: t('settings.integrations.sheets.toast.sheetChosen', { title: result?.spreadsheetTitle ?? '' }) });
      else if (mode === 'filters') toast(t('toast.saved'));
      if (from && to) toast({ tone: 'info', message: t('settings.integrations.sheets.backfill.started') });
      void qc.invalidateQueries({ queryKey: integrationKeys.sheets(ws) });
      onClose();
    } catch (e) {
      // the sheet may be saved while the backfill was refused: keep the card fresh
      void qc.invalidateQueries({ queryKey: integrationKeys.sheets(ws) });
      if (e instanceof ApiError && e.code === 'SHEETS_SPREADSHEET_NOT_FOUND' && source === 'url') setUrlError(errorMessage(e, t));
      else if (e instanceof ApiError && e.body.fields?.spreadsheetUrl) setUrlError(t('settings.integrations.sheets.dialog.urlInvalid'));
      else if (e instanceof ApiError && (e.body.fields?.to || e.body.fields?.from || e.code === 'REPORT_RANGE_TOO_LONG')) setRangeError(errorMessage(e, t));
      else setFormError(errorMessage(e, t));
    }
  };

  const openPicker = async () => {
    if (!picker.data) return;
    try {
      const file = await openGooglePicker({ accessToken: picker.data.accessToken, developerKey: picker.data.developerKey, appId: picker.data.appId, locale });
      if (file) setPicked(file);
    } catch {
      setFormError(t('settings.integrations.sheets.dialog.pickerFailed'));
    }
  };

  const toggleChannel = (id: string, on: boolean) => setFilters((f) => ({ ...f, channelIds: on ? [...f.channelIds, id] : f.channelIds.filter((x) => x !== id) }));
  const toggleSource = (s: OrderSource, on: boolean) => setFilters((f) => ({ ...f, sources: on ? [...f.sources, s] : f.sources.filter((x) => x !== s) }));
  const busy = save.isPending;
  const title = mode === 'filters' ? t('settings.integrations.sheets.dialog.filtersTitle') : mode === 'backfill' ? t('settings.integrations.sheets.backfill.title') : t('dialog.sheetsPick.title');
  const submitLabel = mode === 'choose' ? t('settings.integrations.sheets.dialog.connect') : mode === 'backfill' ? t('settings.integrations.sheets.backfill.start') : t('action.save');
  const channelRows = useMemo(() => channels.data?.rows ?? [], [channels.data]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={title}
      description={mode === 'choose' ? t('settings.integrations.sheets.dialog.context', { email: data.googleEmail ?? '' }) : mode === 'backfill' ? t('settings.integrations.sheets.backfill.context') : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} data-testid="sheets-submit">
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="sheets-dialog" data-mode={mode ?? undefined} aria-busy={busy}>
        {mode === 'choose' ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">{t('dialog.sheetsPick.title')}</legend>
            <SourceOption checked={source === 'picker'} onSelect={() => setSource('picker')} label={t('settings.integrations.sheets.dialog.picker')} hint={t('settings.integrations.sheets.dialog.pickerHint')} testId="sheets-option-picker">
              {source === 'picker' ? (
                picker.isPending ? (
                  <p className="ts-label-meta text-text-muted">{t('settings.integrations.sheets.dialog.pickerLoading')}</p>
                ) : picker.isError ? (
                  <FormAlert>{errorMessage(picker.error, t)}</FormAlert>
                ) : picker.data?.driver === 'fake' ? (
                  pickerFiles.length ? (
                    <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-card border border-line-edge p-1" aria-label={t('settings.integrations.sheets.dialog.files')} data-testid="sheets-files">
                      {pickerFiles.map((f) => (
                        <li key={f.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] hover:bg-ink-raised" data-testid="sheets-file" data-file={f.id}>
                            <input type="radio" name="sheets-file" className="accent-white" checked={picked?.id === f.id} onChange={() => setPicked(f)} />
                            <span className="truncate" dir="auto" title={f.name}>
                              {f.name}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ts-label-meta text-text-muted" data-testid="sheets-files-empty">
                      {t('settings.integrations.sheets.dialog.filesEmpty')}
                    </p>
                  )
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => void openPicker()}>
                      {t('settings.integrations.sheets.dialog.openPicker')}
                    </Button>
                    {picked ? (
                      <span className="truncate text-[13px]" dir="auto">
                        {picked.name}
                      </span>
                    ) : null}
                  </div>
                )
              ) : null}
            </SourceOption>
            <SourceOption checked={source === 'url'} onSelect={() => setSource('url')} label={t('settings.integrations.sheets.dialog.url')} hint={t('settings.integrations.sheets.dialog.urlHint')} testId="sheets-option-url">
              {source === 'url' ? (
                <Field label={t('settings.integrations.sheets.dialog.urlLabel')} htmlFor="sheets-url" error={urlError ?? undefined}>
                  <UrlInput id="sheets-url" autoComplete="off" placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!urlError} disabled={busy} data-testid="sheets-url" />
                </Field>
              ) : null}
            </SourceOption>
            <SourceOption checked={source === 'create'} onSelect={() => setSource('create')} label={createName} hint={t('settings.integrations.sheets.dialog.createHint')} testId="sheets-option-create" />
          </fieldset>
        ) : null}

        {mode !== 'backfill' ? (
          <section className="flex flex-col gap-2.5" aria-labelledby="sheets-filters-title">
            <h3 id="sheets-filters-title" className="ts-label-micro uppercase text-text-muted">
              {t('settings.integrations.sheets.dialog.filters')}
            </h3>
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox
                checked={!pagesOpen}
                onChange={(e) => {
                  setPagesOpen(!e.target.checked);
                  if (e.target.checked) setFilters((f) => ({ ...f, channelIds: [] }));
                }}
                data-testid="sheets-all-pages"
              />
              {t('settings.integrations.sheets.filters.allPages')}
            </label>
            {pagesOpen ? (
              <div className="flex flex-wrap gap-2 ps-6" data-testid="sheets-pages">
                {channelRows.length ? (
                  channelRows.map((c) => (
                    <CheckChip key={c.id} name={c.id} checked={filters.channelIds.includes(c.id)} onChange={(v) => toggleChannel(c.id, v)}>
                      <span dir="auto">{c.name}</span>
                    </CheckChip>
                  ))
                ) : (
                  <span className="ts-label-meta text-text-muted">{t('settings.integrations.sheets.dialog.noPages')}</span>
                )}
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox
                checked={!sourcesOpen}
                onChange={(e) => {
                  setSourcesOpen(!e.target.checked);
                  if (e.target.checked) setFilters((f) => ({ ...f, sources: [] }));
                }}
                data-testid="sheets-all-sources"
              />
              {t('settings.integrations.sheets.filters.allSourcesLabel')}
            </label>
            {sourcesOpen ? (
              <div className="flex flex-wrap gap-2 ps-6" data-testid="sheets-sources">
                {OrderSourceValues.map((s) => (
                  <CheckChip key={s} name={s} checked={filters.sources.includes(s)} onChange={(v) => toggleSource(s, v)}>
                    {t(`settings.integrations.sheets.source.${s}`)}
                  </CheckChip>
                ))}
              </div>
            ) : null}
            {filtersError ? <p className="text-[12px] text-accent-alert" role="alert">{filtersError}</p> : null}
          </section>
        ) : null}

        {mode !== 'filters' ? (
          <section className="flex flex-col gap-2" aria-label={t('settings.integrations.sheets.backfill.title')}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('settings.integrations.sheets.dialog.from')} htmlFor="sheets-from">
                <Input id="sheets-from" type="date" dir="ltr" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} disabled={busy} data-testid="sheets-from" />
              </Field>
              <Field label={t('settings.integrations.sheets.dialog.to')} htmlFor="sheets-to">
                <Input id="sheets-to" type="date" dir="ltr" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} disabled={busy} data-testid="sheets-to" />
              </Field>
            </div>
            <p className="ts-label-meta text-text-muted">{mode === 'backfill' ? t('settings.integrations.sheets.backfill.hint') : t('settings.integrations.sheets.dialog.rangeHint')}</p>
            {rangeError ? <p className="text-[12px] text-accent-alert" role="alert">{rangeError}</p> : null}
          </section>
        ) : null}

        {formError ? <FormAlert>{formError}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

function SourceOption({ checked, onSelect, label, hint, children, testId }: { checked: boolean; onSelect: () => void; label: string; hint: string; children?: React.ReactNode; testId: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-start gap-2.5" data-testid={testId}>
        <input type="radio" name="sheets-source" className="mt-1 accent-white" checked={checked} onChange={onSelect} />
        <span className="min-w-0">
          <span className="block text-[14px]" dir="auto">
            {label}
          </span>
          <span className="ts-label-meta block text-text-muted [overflow-wrap:anywhere]">{hint}</span>
        </span>
      </label>
      {children ? <div className="ps-6">{children}</div> : null}
    </div>
  );
}
