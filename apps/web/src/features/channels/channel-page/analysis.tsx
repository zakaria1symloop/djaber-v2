'use client';
// /channels/[id]/analysis — Figma "CHN-08 — Channel page — analysis review (import)" (FL-15): the AI reads the last
// publications of the page and proposes products; nothing is created before the merchant validates.
// States: idle · PERMISSION REQUISE (+ Reconnecter) · EN COURS (job progress) · AUCUN PRODUIT · TERMINÉ (review grid
// with NOUVEAU / EXISTE DÉJÀ / PRIX MANQUANT, validation price > 0 and stock > 0) · importing · done counts ·
// partial failure (retry the remaining) · ÉCHEC · rate-limited (3 analyses / day, free).
import { formatNumber } from '@djaber/shared';
import type { AnalysisDto, AnalysisItem } from '@djaber/shared';
import { Button, Card, Checkbox, cn, FormAlert, Input, Ltr, MiniField, MoneyInput, MonoChip, NumberInput, Pill, ProgressBar, Skeleton, toast, type Tone } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { useCategories } from '@/features/catalog/api';
import { flattenCategories } from '@/features/catalog/contracts';
import { reasonText } from '@/lib/actions';
import { ApiError } from '@/lib/api';
import { errorMessage, fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { isJobFinished, useJob } from '@/lib/jobs';
import { useSession, useWorkspaceId } from '@/lib/session';
import {
  allSelected,
  analysisViewState,
  buildImport,
  deselectDuplicates,
  durationSeconds,
  importOutcome,
  initialEdits,
  invalidSelected,
  patchRow,
  planRoom,
  rowIssues,
  rowStatus,
  selectAll,
  selectedDuplicates,
  selectedKeys,
  summaryCounts,
  type Edits,
  type ImportOutcome,
  type RowEdit,
  type RowStatus,
} from '../analysis-logic';
import { channelKeys, channelsApi, useChannelAnalysis } from '../api';
import { useChannelPage } from './channel-shell';

const codeOf = (e: unknown): string | null => (e instanceof ApiError ? e.code : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * "EXISTE DÉJÀ : …": the API puts the id of the matching product in `duplicateOf` (matched on the folded name), so the
 * row shows its own name — the same as the existing product's — instead of the id; a name sent there is shown as is.
 */
const existingName = (item: Pick<AnalysisItem, 'name' | 'duplicateOf'>) => (item.duplicateOf && !UUID.test(item.duplicateOf) ? item.duplicateOf : item.name);
const STATUS_TONE: Record<RowStatus, Tone> = { new: 'success', exists: 'warning', price_missing: 'danger' };

export function ChannelAnalysis() {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { channel: c, actions, connect } = useChannelPage();
  const manage = actions.manage;
  const q = useChannelAnalysis(c.id, manage);
  const dto = q.data ?? null;
  const [startCode, setStartCode] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // the job behind a running analysis: WS `job.updated` keeps it fresh; its end refreshes the analysis
  const job = useJob(dto?.state === 'running' ? dto.jobId : null);
  const finished = isJobFinished(job.data);
  useEffect(() => {
    if (finished) void qc.invalidateQueries({ queryKey: channelKeys.analysis(ws, c.id) });
  }, [finished, qc, ws, c.id]);

  const state = analysisViewState(dto, startCode ?? codeOf(q.error));
  const runsLeft = dto?.runsLeftToday ?? null;
  const rateLimited = startCode === 'ANALYSIS_RATE_LIMITED' || runsLeft === 0;

  const start = async () => {
    setStarting(true);
    setStartError(null);
    setStartCode(null);
    try {
      await channelsApi.startAnalysis(c.id);
      await q.refetch();
    } catch (e) {
      const code = codeOf(e);
      if (code === 'PAGE_ANALYSIS_PERMISSION_REQUIRED' || code === 'ANALYSIS_RATE_LIMITED') setStartCode(code);
      if (code === 'ANALYSIS_RATE_LIMITED') toast({ tone: 'danger', message: `${errorMessage(e, t)} (ANALYSIS_RATE_LIMITED)` });
      else if (code !== 'PAGE_ANALYSIS_PERMISSION_REQUIRED') setStartError(errorMessage(e, t));
    } finally {
      setStarting(false);
    }
  };
  const runReason = c.status !== 'active' ? reasonText(t, 'REPLY_CHANNEL_INACTIVE') : rateLimited ? reasonText(t, 'ANALYSIS_RATE_LIMITED') : undefined;

  if (!manage) {
    return (
      <Card className="px-6 py-10 text-center text-[13px] text-text-secondary" data-testid="analysis-forbidden">
        {t('channels.analysis.forbidden')}
      </Card>
    );
  }
  if (q.isPending) {
    return (
      <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-4">
        <Skeleton className="h-14" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      </div>
    );
  }
  if (q.isError && state !== 'permission') return <QueryError error={q.error} onRetry={() => q.refetch()} />;

  const lead = <p className="text-[13px] text-text-secondary">{t('channels.analysis.lead')}</p>;
  const runButton = (label: string, variant: 'primary' | 'secondary' | 'ghost' = 'primary') => (
    <Button variant={variant} onClick={start} loading={starting} disabledReason={runReason} data-testid="analysis-run">
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="channel-analysis" data-state={state}>
      {lead}
      {startError ? <FormAlert>{startError}</FormAlert> : null}

      {state === 'idle' ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center" data-testid="analysis-idle">
          <h2 className="ts-title">{t('channels.analysis.idle.title')}</h2>
          <p className="max-w-lg text-[13px] text-text-secondary">{t('channels.analysis.idle.description')}</p>
          {runButton(t('channels.analysis.run'))}
          <p className="ts-label-meta text-text-muted">{t('channels.analysis.free')}</p>
        </Card>
      ) : null}

      {state === 'permission' ? (
        <StateCard
          testId="analysis-permission"
          tone="danger"
          label={t('channels.analysis.permission.label')}
          action={
            <Button variant="primary" onClick={() => void connect.reconnect(c)} data-testid="analysis-reconnect">
              {t('action.reconnect')}
            </Button>
          }
        >
          {t('channels.analysis.permission.description')} <Ltr>(PAGE_ANALYSIS_PERMISSION_REQUIRED)</Ltr>
        </StateCard>
      ) : null}

      {state === 'running' && dto ? (
        <Card className="flex flex-col gap-3 p-4" data-testid="analysis-running">
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <Pill tone="info" className="!rounded-[4px]">
              {t('channels.analysis.running.label')}
            </Pill>
            <span className="min-w-0 flex-1">
              <Ltr>{t('channels.analysis.running.progress', { done: formatNumber(dto.postsDone), total: formatNumber(dto.postsTotal) })}</Ltr>
            </span>
          </div>
          <ProgressBar value={dto.postsTotal > 0 ? (dto.postsDone * 100) / dto.postsTotal : (job.data?.progress ?? dto.progress ?? null)} label={t('channels.analysis.running.label')} />
          <p className="ts-label-meta text-text-muted">{t('channels.analysis.running.note')}</p>
        </Card>
      ) : null}

      {state === 'failed' ? (
        <StateCard testId="analysis-failed" tone="danger" label={t('enum.Job.status.failed')} action={runButton(t('action.retry'), 'secondary')}>
          {dto?.error || t('channels.analysis.failed.description')}
        </StateCard>
      ) : null}

      {state === 'empty' && dto ? (
        <StateCard testId="analysis-empty" tone="neutral" label={t('channels.analysis.empty.label')} action={runButton(t('channels.analysis.rerun', { count: runsLeft ?? 0 }), 'secondary')}>
          {t('channels.analysis.empty.description')}
        </StateCard>
      ) : null}

      {state === 'done' && dto ? <Review key={dto.jobId ?? 'analysis'} channelId={c.id} dto={dto} rerun={runButton(t('channels.analysis.rerun', { count: runsLeft ?? 0 }), 'ghost')} /> : null}
    </div>
  );
}

function StateCard({ testId, tone, label, children, action }: { testId: string; tone: Tone; label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card data-testid={testId} role={tone === 'danger' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-3 px-4 py-3.5 text-[13px]">
      <Pill tone={tone} className="!rounded-[4px]">
        {label}
      </Pill>
      <span className="min-w-0 flex-1 text-text-secondary">{children}</span>
      {action}
    </Card>
  );
}

/** TERMINÉ: summary line, selection bar, grid of editable cards, sticky import footer. */
function Review({ channelId, dto, rerun }: { channelId: string; dto: AnalysisDto; rerun: React.ReactNode }) {
  const t = useT();
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { workspace } = useSession();
  const items = dto.items;
  const [edits, setEdits] = useState<Edits>(() => initialEdits(items));
  const [outcome, setOutcome] = useState<ImportOutcome>({ created: {}, failed: {} });
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = useCategories();
  const categoryNames = useMemo(() => [...new Set(flattenCategories(categories.data ?? []).map((x) => x.category.name))], [categories.data]);
  const listId = useId();

  const imported = useMemo(() => new Set(Object.keys(outcome.created)), [outcome.created]);
  const counts = summaryCounts(dto);
  const seconds = durationSeconds(dto.startedAt, dto.finishedAt);
  const selected = selectedKeys(items, edits, imported);
  const invalid = invalidSelected(items, edits, imported);
  const everything = allSelected(items, edits, imported);
  const duplicatesSelected = selectedDuplicates(items, edits);
  const remaining = items.length - imported.size;
  const createdCount = imported.size;
  const failedCount = Object.keys(outcome.failed).length;
  const room = planRoom(workspace?.plan?.usage.products, workspace?.plan?.limits.maxProducts, selected.length);

  const set = (key: string, patch: Partial<RowEdit>) => setEdits((e) => patchRow(e, key, patch));

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (!selected.length || invalid.length) return;
    const { keys, body } = buildImport(items, edits, imported);
    setPending(true);
    try {
      const result = await channelsApi.importAnalysis(channelId, body);
      const out = importOutcome(keys, result);
      setOutcome((prev) => ({ created: { ...prev.created, ...out.created }, failed: out.failed }));
      // imported rows are locked; the failed ones stay selected for "Réessayer"
      setEdits((e) => {
        let next = e;
        for (const k of Object.keys(out.created)) next = patchRow(next, k, { selected: false });
        return next;
      });
      setTouched(false);
      const ok = Object.keys(out.created).length;
      const ko = Object.keys(out.failed).length;
      toast({ tone: ko ? 'warning' : 'success', message: ko ? t('channels.analysis.import.partial', { created: ok, failed: ko }) : t('channels.analysis.import.done', { count: ok }) });
      void qc.invalidateQueries({ queryKey: [ws, 'products'] });
      void qc.invalidateQueries({ queryKey: [ws, 'workspace'] });
      void qc.invalidateQueries({ queryKey: [ws, 'categories'] });
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'PLAN_LIMIT' ? `${errorMessage(e, t)} (PLAN_LIMIT)` : errorMessage(e, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3.5 text-[13px]" data-testid="analysis-summary">
        <Pill tone="success" className="!rounded-[4px]">
          {t('channels.analysis.done.label')}
        </Pill>
        <span className="min-w-0 flex-1">
          {t('channels.analysis.done.summary', { posts: counts.posts, detected: counts.detected, duplicates: counts.duplicates })}
          {seconds !== null ? ` · ${t('channels.analysis.done.duration', { seconds })}` : ''}
        </span>
        {rerun}
      </Card>

      {createdCount || failedCount ? (
        <FormAlert tone={failedCount ? 'warning' : 'success'}>
          <span data-testid="analysis-import-result">
            {failedCount ? t('channels.analysis.import.partial', { created: createdCount, failed: failedCount }) : t('channels.analysis.import.done', { count: createdCount })}
            {failedCount ? ` ${t('channels.analysis.import.retryHint')}` : ''}
          </span>
        </FormAlert>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex min-w-0 flex-1 basis-64 cursor-pointer items-center gap-2.5 text-[13px] text-text-secondary">
          <Checkbox checked={everything} disabled={pending || remaining === 0} onChange={(e) => setEdits((x) => selectAll(items, x, imported, e.target.checked))} aria-label={t('channels.analysis.selectAll')} />
          <span data-testid="analysis-selection">
            <Ltr>{t('channels.analysis.selection', { selected: selected.length, total: remaining })}</Ltr> · {t('channels.analysis.selection.note')}
          </span>
        </label>
        <Button size="sm" variant="ghost" disabled={pending || everything || remaining === 0} onClick={() => setEdits((x) => selectAll(items, x, imported, true))} data-testid="analysis-select-all">
          {t('channels.analysis.selectAll')}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending || duplicatesSelected === 0} onClick={() => setEdits((x) => deselectDuplicates(items, x))} data-testid="analysis-deselect-duplicates">
          {t('channels.analysis.deselectDuplicates')}
        </Button>
      </div>

      <datalist id={listId}>
        {categoryNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <ul aria-label={t('channels.analysis.grid')} className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="analysis-grid">
        {items.map((item) => (
          <ItemCard
            key={item.key}
            item={item}
            edit={edits[item.key]!}
            created={outcome.created[item.key]}
            failure={outcome.failed[item.key]}
            showIssues={touched}
            disabled={pending}
            listId={listId}
            isNewCategory={(name) => !!name.trim() && !categoryNames.some((n) => n.toLowerCase() === name.trim().toLowerCase())}
            onChange={(patch) => set(item.key, patch)}
          />
        ))}
      </ul>

      {error ? <FormAlert>{error}</FormAlert> : null}
      {touched && invalid.length ? (
        <FormAlert>
          <span data-testid="analysis-invalid">{t('channels.analysis.invalid', { count: invalid.length })}</span>
        </FormAlert>
      ) : null}

      <footer data-testid="analysis-footer" className="sticky -bottom-6 z-10 -mx-4 -mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-hairline bg-ink-base/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <p className="min-w-0 flex-1 basis-64 ts-label-meta uppercase text-text-muted">
          {t('channels.analysis.footer.note')}
          {room ? (
            <>
              {' · '}
              <span className={room.ok ? undefined : 'text-accent-alert'} data-testid="analysis-plan-room" data-ok={room.ok}>
                <Ltr>{t('channels.analysis.footer.plan', { current: formatNumber(room.current), adding: room.adding, limit: formatNumber(room.limit) })}</Ltr> {room.ok ? '✓' : '✕'}
              </span>
            </>
          ) : null}
        </p>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setEdits((e) => {
              const fresh = initialEdits(items);
              for (const k of imported) if (fresh[k]) fresh[k] = { ...(e[k] ?? fresh[k]!), selected: false };
              return fresh;
            });
            setTouched(false);
            setError(null);
          }}
          data-testid="analysis-reset"
        >
          {t('action.cancel')}
        </Button>
        <Button variant="primary" onClick={submit} loading={pending} disabledReason={selected.length ? undefined : t('channels.analysis.import.none')} data-testid="analysis-import">
          {failedCount ? t('channels.analysis.import.retry', { count: selected.length }) : t('channels.analysis.import.submit', { count: selected.length })}
        </Button>
      </footer>
    </>
  );
}

function ItemCard({
  item,
  edit,
  created,
  failure,
  showIssues,
  disabled,
  listId,
  isNewCategory,
  onChange,
}: {
  item: AnalysisItem;
  edit: RowEdit;
  created?: { productId: string; sku: string };
  failure?: { code: string; message: string };
  showIssues: boolean;
  disabled: boolean;
  listId: string;
  isNewCategory: (name: string) => boolean;
  onChange: (patch: Partial<RowEdit>) => void;
}) {
  const t = useT();
  const id = useId();
  const status = rowStatus(item, edit);
  const locked = !!created || disabled;
  // a missing price is shown at once on a selected row (PRIX MANQUANT); the other fields after a first attempt
  const issues = edit.selected && !created ? rowIssues(edit) : {};
  const priceIssue = issues.price && (showIssues || status === 'price_missing') ? issues.price : undefined;
  return (
    <li
      data-testid="analysis-item"
      data-key={item.key}
      data-status={created ? 'imported' : status}
      data-selected={edit.selected || undefined}
      className={cn('flex min-w-0 flex-col gap-3 rounded-card border bg-ink-surface p-3', created ? 'border-line-edge opacity-70' : edit.selected ? 'border-signal-live/70' : 'border-line-edge', !edit.selected && !created && item.duplicateOf && 'opacity-60')}
    >
      <div className="flex items-start gap-3">
        <Checkbox className="mt-1" checked={edit.selected} disabled={locked} onChange={(e) => onChange({ selected: e.target.checked })} aria-label={t('channels.analysis.item.select', { name: edit.name || item.name })} />
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" loading="lazy" className="size-14 shrink-0 rounded-[6px] object-cover" />
        ) : (
          <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-[6px] bg-ink-raised text-text-muted">
            <ImageOff className="size-4" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
          <span className="ts-label-micro text-text-muted">{t('channels.analysis.item.post')}</span>
          {created ? (
            <MonoChip tone="success">
              {t('channels.analysis.item.imported')} · <bdi dir="ltr">{created.sku}</bdi>
            </MonoChip>
          ) : (
            <Pill tone={STATUS_TONE[status]} className="max-w-full !rounded-[4px]">
              <span className="truncate">{status === 'exists' ? t('channels.analysis.item.exists', { name: existingName(item) }) : t(`channels.analysis.item.${status}`)}</span>
            </Pill>
          )}
        </div>
      </div>
      <MiniField label={t('channels.analysis.field.name')} htmlFor={`${id}-name`} error={showIssues ? fieldError(t, issues.name, { max: 255 }) : undefined}>
        <Input id={`${id}-name`} dir="auto" className="!h-9 text-[13px]" value={edit.name} disabled={locked} aria-invalid={(showIssues && !!issues.name) || undefined} onChange={(e) => onChange({ name: e.target.value })} />
      </MiniField>
      <div className="grid grid-cols-2 gap-2">
        <MiniField label={t('channels.analysis.field.price')} htmlFor={`${id}-price`} error={fieldError(t, priceIssue)}>
          <MoneyInput id={`${id}-price`} className="!h-9 text-[13px]" value={edit.price} disabled={locked} aria-invalid={!!priceIssue || undefined} onValueChange={(v) => onChange({ price: v })} />
        </MiniField>
        <MiniField label={t('channels.analysis.field.stock')} htmlFor={`${id}-qty`} error={showIssues ? fieldError(t, issues.quantity) : undefined}>
          {/* A2: a service / digital offer has no stock — it can be switched back to a product with stock */}
          {edit.isService ? (
            <button type="button" id={`${id}-qty`} className="h-9 w-full rounded-[6px] border border-line-edge px-2 text-start text-[13px] text-text-secondary hover:text-text-primary" disabled={locked} onClick={() => onChange({ isService: false })} title={t('channels.analysis.service.toProduct')}>
              {t('channels.analysis.service.label')}
            </button>
          ) : (
            <NumberInput id={`${id}-qty`} className="!h-9 text-[13px]" maxDigits={6} value={edit.quantity} disabled={locked} aria-invalid={(showIssues && !!issues.quantity) || undefined} onValueChange={(v) => onChange({ quantity: v })} />
          )}
        </MiniField>
      </div>
      <MiniField label={isNewCategory(edit.category) ? t('channels.analysis.field.categoryNew') : t('channels.analysis.field.category')} htmlFor={`${id}-cat`}>
        <Input id={`${id}-cat`} dir="auto" list={listId} maxLength={120} className="!h-9 text-[13px]" value={edit.category} disabled={locked} placeholder={t('channels.analysis.field.categoryPlaceholder')} onChange={(e) => onChange({ category: e.target.value })} />
      </MiniField>
      {failure ? (
        <p role="alert" className="text-[12px] text-accent-alert" data-testid="analysis-item-error">
          {failure.message && failure.message !== failure.code ? failure.message : t('channels.analysis.item.failed')} <Ltr>({failure.code})</Ltr>
        </p>
      ) : null}
    </li>
  );
}
