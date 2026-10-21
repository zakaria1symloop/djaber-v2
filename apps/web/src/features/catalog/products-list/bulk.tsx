'use client';
// Products list — selection bar and its dialogs. Figma "CAT-08 — Products — bulk bar + row actions menu" and
// "DLG — GDS (stock) — dialogs catalogue" (Modifier les prix en masse, Changer la catégorie). Bulk endpoints answer one
// result per product (never all-or-nothing): the result dialog lists OK / ERREUR code rows and can retry the errors.
import { BulkPriceSchema, computeBulkPrice, formatNumber, type BulkPriceInput } from '@djaber/shared';
import { BulkBar, Button, Checkbox, Combobox, Dialog, Field, FormAlert, Ltr, NumberInput, Pill, RadioCards, Select, toast, type BulkAction } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgents } from '@/features/agents/api';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { downloadUrl, jobFileName, trackJob } from '@/lib/jobs';
import { useSession } from '@/lib/session';
import { catalogApi, useCatalogRefresh, useCategories } from '../api';
import { flattenCategories, type BulkResponse, type ProductListItem } from '../contracts';
import { addToAgentOutcome } from './spec';
import { ProductLabelsDialog } from '../product-labels-dialog';

export type BulkKind = 'category' | 'minStock' | 'price' | 'agent' | 'archive' | 'labels';
type Outcome = { title: string; response: BulkResponse; retry: (ids: string[]) => Promise<BulkResponse> };

/** Progress toast of a products export job (header "Exporter" and bulk "Exporter"). */
export function useProductsExport() {
  const t = useT();
  return async (start: () => Promise<{ jobId: string }>) => {
    try {
      const { jobId } = await start();
      const entity = t('products.export.entity');
      trackJob({
        jobId,
        download: true,
        started: t('toast.jobStarted'),
        progress: (job) => t('toast.export.progress', { entity, pct: job.progress, rows: formatNumber(job.total ?? 0) }),
        done: (job) => ({
          message: t('toast.export.done', { file: t('products.export.file') }),
          action: job.resultUrl ? { label: t('action.download'), onClick: () => downloadUrl(job.resultUrl!, jobFileName(job)) } : undefined,
        }),
        failed: (job, error) => (job?.error ? `${job.error.message} (${job.error.code})` : errorMessage(error, t)),
      });
    } catch (e) {
      toast({ tone: 'danger', message: e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t) });
    }
  };
}

export function ProductsBulkBar({ rows, selected, total, onSelectAllPage, onClear }: { rows: ProductListItem[]; selected: ReadonlySet<string>; total: number; onSelectAllPage: () => void; onClear: () => void }) {
  const t = useT();
  const { can, workspace } = useSession();
  const refresh = useCatalogRefresh();
  const exportProducts = useProductsExport();
  const [dialog, setDialog] = useState<BulkKind | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const ids = useMemo(() => [...selected], [selected]);
  const picked = rows.filter((r) => selected.has(r.id));
  const withVariants = picked.filter((r) => r.hasVariants).length;
  const forbidden = can('catalog.write') ? undefined : t('toast.forbidden');
  const advanced = workspace?.stockMode === 'advanced';
  // names of every row seen on screen: an archived product leaves the list before the result dialog opens
  const seenNames = useRef<Record<string, string>>({});
  for (const r of rows) seenNames.current[r.id] = r.name;

  const done = async (title: string, response: BulkResponse, retry: Outcome['retry']) => {
    setDialog(null);
    await refresh();
    if (response.failed === 0) {
      toast(t('products.bulk.done', { count: response.ok }));
      onClear();
    } else setOutcome({ title, response, retry });
  };

  const actions: BulkAction[] = [
    { key: 'category', label: t('products.bulk.category'), onSelect: () => setDialog('category'), disabledReason: forbidden },
    { key: 'minStock', label: t('products.bulk.minStock'), onSelect: () => setDialog('minStock'), disabledReason: forbidden },
    { key: 'price', label: t('products.bulk.price'), onSelect: () => setDialog('price'), disabledReason: forbidden },
    ...(can('agents.read') ? [{ key: 'agent', label: t('action.addToAgent'), onSelect: () => setDialog('agent'), disabledReason: forbidden }] : []),
    { key: 'export', label: t('action.export'), onSelect: () => void exportProducts(() => catalogApi.bulkExport(ids)), disabledReason: forbidden },
    { key: 'labels', label: t('products.bulk.labels'), onSelect: () => setDialog('labels'), disabledReason: forbidden },
    { key: 'archive', label: t('action.archive'), onSelect: () => setDialog('archive'), destructive: true, disabledReason: forbidden },
  ];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <>
      <BulkBar
        label={t('products.bulk.label')}
        summary={`${t('products.bulk.selected', { count: ids.length })}${withVariants ? ` · ${t('products.bulk.withVariants', { count: withVariants })}` : ''}`}
        actions={actions}
        note={t('products.bulk.note')}
        selectAll={allOnPage ? undefined : { label: t('action.selectAll', { count: Math.min(rows.length, total) }), onSelect: onSelectAllPage }}
        deselectLabel={t('action.deselect')}
        onDeselect={onClear}
      />
      <BulkCategoryDialog open={dialog === 'category'} ids={ids} onClose={() => setDialog(null)} onDone={done} />
      <BulkMinStockDialog open={dialog === 'minStock'} ids={ids} onClose={() => setDialog(null)} onDone={done} />
      <BulkPriceDialog open={dialog === 'price'} ids={ids} rows={picked} advanced={advanced} onClose={() => setDialog(null)} onDone={done} />
      <BulkAgentDialog open={dialog === 'agent'} ids={ids} onClose={() => setDialog(null)} onDone={done} />
      <BulkArchiveDialog open={dialog === 'archive'} ids={ids} onClose={() => setDialog(null)} onDone={done} />
      <ProductLabelsDialog open={dialog === 'labels'} ids={ids} onClose={() => setDialog(null)} />
      <BulkResultDialog
        outcome={outcome}
        names={seenNames.current}
        onClose={() => {
          setOutcome(null);
          onClear();
        }}
        onRetried={async (response) => {
          await refresh();
          setOutcome((o) => (o ? { ...o, response } : o));
        }}
      />
    </>
  );
}

type DialogProps = { open: boolean; ids: string[]; onClose: () => void; onDone: (title: string, r: BulkResponse, retry: Outcome['retry']) => Promise<void> };
const context = (t: ReturnType<typeof useT>, n: number) => t('products.bulk.selected', { count: n });

function useBulk(run: (ids: string[]) => Promise<BulkResponse>, p: DialogProps, title: string) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: run });
  useEffect(() => {
    if (p.open) setError(null);
  }, [p.open]);
  const submit = async () => {
    setError(null);
    try {
      await p.onDone(title, await m.mutateAsync(p.ids), run);
    } catch (e) {
      setError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
    }
  };
  return { submit, busy: m.isPending, error };
}

function Footer({ onClose, busy, submit, label, danger, disabled }: { onClose: () => void; busy: boolean; submit: () => void; label: string; danger?: boolean; disabled?: boolean }) {
  const t = useT();
  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        {t('action.cancel')}
      </Button>
      <Button variant={danger ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={disabled} data-testid="bulk-submit">
        {label}
      </Button>
    </>
  );
}

/* ---------- Changer la catégorie ---------- */
function BulkCategoryDialog(p: DialogProps) {
  const t = useT();
  const categories = useCategories(p.open);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (p.open) {
      setCategoryId(null);
      setTouched(false);
    }
  }, [p.open]);
  const title = t('dialog.changeCategory.title');
  const b = useBulk((ids) => catalogApi.bulkCategory({ ids, categoryId: categoryId === 'none' ? null : categoryId }), p, title);
  const options = [{ value: 'none', label: t('products.bulk.category.none') }, ...flattenCategories(categories.data ?? []).map((c) => ({ value: c.id, label: c.label }))];
  return (
    <Dialog
      open={p.open}
      onOpenChange={(o) => !o && !b.busy && p.onClose()}
      title={title}
      description={context(t, p.ids.length)}
      closeLabel={t('action.close')}
      size="sm"
      footer={<Footer onClose={p.onClose} busy={b.busy} label={t('products.bulk.category.submit', { count: p.ids.length })} submit={() => (categoryId ? void b.submit() : setTouched(true))} />}
    >
      <Field label={t('products.bulk.category.new')} htmlFor="bulk-category" error={touched && !categoryId ? t('validation.required') : undefined}>
        <Combobox
          id="bulk-category"
          value={categoryId}
          onChange={setCategoryId}
          options={options}
          loading={categories.isPending}
          placeholder={t('products.bulk.category.placeholder')}
          searchPlaceholder={t('products.filter.categorySearch')}
          emptyLabel={t('products.filter.noCategory')}
          disabled={b.busy}
          invalid={touched && !categoryId}
        />
      </Field>
      {b.error ? <FormAlert className="mt-3">{b.error}</FormAlert> : null}
    </Dialog>
  );
}

/* ---------- Seuil de stock min ---------- */
function BulkMinStockDialog(p: DialogProps) {
  const t = useT();
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (p.open) {
      setValue('');
      setTouched(false);
    }
  }, [p.open]);
  const title = t('products.bulk.minStock');
  const b = useBulk((ids) => catalogApi.bulkMinStock({ ids, minStock: Number(value) }), p, title);
  return (
    <Dialog
      open={p.open}
      onOpenChange={(o) => !o && !b.busy && p.onClose()}
      title={title}
      description={context(t, p.ids.length)}
      closeLabel={t('action.close')}
      size="sm"
      footer={<Footer onClose={p.onClose} busy={b.busy} label={t('action.applyCount', { count: p.ids.length })} submit={() => (value === '' ? setTouched(true) : void b.submit())} />}
    >
      <Field label={t('products.bulk.minStock.field')} htmlFor="bulk-min" required hint={t('products.bulk.minStock.hint')} error={touched && value === '' ? t('validation.quantity') : undefined}>
        <NumberInput id="bulk-min" value={value} onValueChange={setValue} maxDigits={7} disabled={b.busy} aria-invalid={touched && value === ''} />
      </Field>
      {b.error ? <FormAlert className="mt-3">{b.error}</FormAlert> : null}
    </Dialog>
  );
}

/* ---------- Modifier les prix en masse ---------- */
function BulkPriceDialog(p: DialogProps & { rows: ProductListItem[]; advanced: boolean }) {
  const t = useT();
  const [op, setOp] = useState<BulkPriceInput['op']>('increase');
  const [value, setValue] = useState('10');
  const [unit, setUnit] = useState<BulkPriceInput['unit']>('percent');
  const [roundUpTens, setRound] = useState(true);
  const [applyToVariants, setVariants] = useState(true);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!p.open) return;
    setOp('increase');
    setValue('10');
    setUnit('percent');
    setRound(true);
    setVariants(true);
    setTouched(false);
  }, [p.open]);
  const effectiveUnit = op === 'set' ? 'dzd' : unit;
  const input = { op, value: value === '' ? Number.NaN : Number(value), unit: effectiveUnit, roundUpTens, applyToVariants };
  const parsed = BulkPriceSchema.safeParse({ ids: p.ids, ...input });
  const title = t('dialog.bulkPrice.title');
  const b = useBulk((ids) => catalogApi.bulkPrice({ ids, ...input }), p, title);
  // local preview with the shared formula (the server applies the same one)
  const preview = parsed.success ? p.rows.map((r) => ({ row: r, next: computeBulkPrice(r.price, input) })) : [];
  const invalidPrices = preview.filter((x) => x.next <= 0).length;
  const belowCost = p.advanced ? preview.filter((x) => x.row.costPrice !== null && x.next > 0 && x.next < x.row.costPrice).length : 0;
  return (
    <Dialog
      open={p.open}
      onOpenChange={(o) => !o && !b.busy && p.onClose()}
      title={title}
      description={context(t, p.ids.length)}
      closeLabel={t('action.close')}
      size="md"
      footer={<Footer onClose={p.onClose} busy={b.busy} label={t('action.applyCount', { count: p.ids.length })} submit={() => (parsed.success ? void b.submit() : setTouched(true))} />}
    >
      <div className="flex flex-col gap-4">
        <RadioCards<BulkPriceInput['op']>
          label={t('products.bulk.price.op')}
          value={op}
          onChange={setOp}
          options={[
            { value: 'increase', label: t('products.bulk.price.increase') },
            { value: 'decrease', label: t('products.bulk.price.decrease') },
            { value: 'set', label: t('products.bulk.price.set') },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('products.bulk.price.value')} htmlFor="bulk-price-value" required error={touched && !parsed.success ? t(effectiveUnit === 'percent' ? 'validation.range' : 'validation.price', { min: 0, max: 1000 }) : undefined}>
            <NumberInput id="bulk-price-value" value={value} onValueChange={setValue} disabled={b.busy} aria-invalid={touched && !parsed.success} />
          </Field>
          <Field label={t('products.bulk.price.unit')} htmlFor="bulk-price-unit">
            <Select id="bulk-price-unit" value={effectiveUnit} disabled={b.busy || op === 'set'} onChange={(e) => setUnit(e.target.value as BulkPriceInput['unit'])}>
              <option value="percent">%</option>
              <option value="dzd">{t('common.currency')}</option>
            </Select>
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
          <Checkbox checked={roundUpTens} disabled={b.busy} onChange={(e) => setRound(e.target.checked)} />
          {t('products.bulk.price.round')}
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
          <Checkbox checked={applyToVariants} disabled={b.busy} onChange={(e) => setVariants(e.target.checked)} />
          {t('products.bulk.price.variants')}
        </label>
        {preview.length ? (
          <div className="rounded-card border border-line-edge bg-ink-raised px-3 py-2.5 ts-label-meta text-accent-starred" data-testid="bulk-price-preview">
            <span>{t('products.bulk.price.preview')} </span>
            {preview.slice(0, 3).map((x, i) => (
              <span key={x.row.id}>
                {i ? ' · ' : ''}
                {x.row.name} <Ltr>{`${formatNumber(x.row.price)} → ${formatNumber(x.next)}`}</Ltr>
              </span>
            ))}
            {preview.length > 3 ? ` · … (${preview.length})` : ''}
            {belowCost ? <span>{` ${t('products.bulk.price.belowCost', { count: belowCost })}`}</span> : null}
            {invalidPrices ? <span className="text-accent-alert">{` ${t('products.bulk.price.invalid', { count: invalidPrices })}`}</span> : null}
          </div>
        ) : null}
        {b.error ? <FormAlert>{b.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Ajouter à un agent (bulk bar and row menu) ---------- */
function BulkAgentDialog(p: DialogProps) {
  const t = useT();
  const agents = useAgents(undefined, p.open);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (p.open) {
      setAgentId(null);
      setTouched(false);
    }
  }, [p.open]);
  const title = t('action.addToAgent');
  const b = useBulk((ids) => catalogApi.bulkAgent({ ids, agentId: agentId! }), p, title);
  const rows = agents.data?.rows ?? [];
  const options = rows.map((a) => ({ value: a.id, label: a.name, hint: t(`enum.Agent.status.${a.status}`) }));
  const picked = rows.find((a) => a.id === agentId);
  const none = agents.isSuccess && rows.length === 0;
  return (
    <Dialog
      open={p.open}
      onOpenChange={(o) => !o && !b.busy && p.onClose()}
      title={title}
      description={context(t, p.ids.length)}
      closeLabel={t('action.close')}
      size="sm"
      footer={<Footer onClose={p.onClose} busy={b.busy} disabled={none} label={t('products.bulk.agent.submit', { count: p.ids.length })} submit={() => (agentId ? void b.submit() : setTouched(true))} />}
    >
      <div data-testid="add-to-agent" className="flex flex-col gap-3">
        {none ? (
          <FormAlert tone="info">
            {t('products.bulk.agent.none')}{' '}
            <Link href="/agents/new" className="normal-case text-accent-inbound underline">
              {t('action.newAgent')}
            </Link>
          </FormAlert>
        ) : (
          <Field label={t('products.bulk.agent.label')} htmlFor="bulk-agent" error={touched && !agentId ? t('validation.required') : undefined} hint={picked?.sellAllProducts ? t('products.bulk.agent.sellsAll', { name: picked.name }) : t('products.bulk.agent.hint')}>
            <Combobox
              id="bulk-agent"
              value={agentId}
              onChange={setAgentId}
              options={options}
              loading={agents.isPending}
              placeholder={t('products.bulk.agent.placeholder')}
              searchPlaceholder={t('products.bulk.agent.search')}
              emptyLabel={t('products.page.agents.none')}
              disabled={b.busy}
              invalid={touched && !agentId}
            />
          </Field>
        )}
        {agents.isError ? <FormAlert>{errorMessage(agents.error, t)}</FormAlert> : null}
        {b.error ? <FormAlert>{b.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/** Row "Actions" menu › "Ajouter à un agent": the same dialog for one product; the outcome is a toast. */
export function AddToAgentDialog({ product, onClose }: { product: Pick<ProductListItem, 'id' | 'name'> | null; onClose: () => void }) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const [last, setLast] = useState(product);
  useEffect(() => {
    if (product) setLast(product);
  }, [product]);
  const target = product ?? last;
  return (
    <BulkAgentDialog
      open={!!product}
      ids={target ? [target.id] : []}
      onClose={onClose}
      onDone={async (_title, response) => {
        onClose();
        await refresh({ productId: target?.id });
        const o = addToAgentOutcome(response);
        if (o.kind === 'done') toast(t('products.toast.addedToAgent', { name: target?.name ?? '' }));
        else if (o.kind === 'failed') toast({ tone: 'danger', message: `${o.message} (${o.code})` });
        else toast({ tone: 'warning', message: t('products.bulk.result.summary', { ok: o.ok, failed: o.failed }) });
      }}
    />
  );
}

/* ---------- Archiver (n) ---------- */
function BulkArchiveDialog(p: DialogProps) {
  const t = useT();
  const [release, setRelease] = useState(false);
  useEffect(() => {
    if (p.open) setRelease(false);
  }, [p.open]);
  const title = t('products.bulk.archive.title', { count: p.ids.length });
  const b = useBulk((ids) => catalogApi.bulkArchive({ ids, releaseStock: release }), p, title);
  return (
    <Dialog
      open={p.open}
      onOpenChange={(o) => !o && !b.busy && p.onClose()}
      title={title}
      description={t('products.delete.archiveHint')}
      closeLabel={t('action.close')}
      size="sm"
      footer={<Footer onClose={p.onClose} busy={b.busy} label={t('action.archive')} submit={() => void b.submit()} />}
    >
      <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
        <Checkbox checked={release} disabled={b.busy} onChange={(e) => setRelease(e.target.checked)} />
        {t('products.bulk.archive.release')}
      </label>
      {b.error ? <FormAlert className="mt-3">{b.error}</FormAlert> : null}
    </Dialog>
  );
}

/* ---------- per-item results ---------- */
function BulkResultDialog({ outcome, names, onClose, onRetried }: { outcome: Outcome | null; names: Record<string, string>; onClose: () => void; onRetried: (r: BulkResponse) => Promise<void> }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const failed = outcome?.response.results.filter((r) => !r.ok) ?? [];
  const retry = useMutation({ mutationFn: (ids: string[]) => outcome!.retry(ids) });
  const again = async () => {
    setError(null);
    try {
      const next = await retry.mutateAsync(failed.map((f) => f.id));
      // rows that succeeded before stay OK; the retried ones take their new result
      const byId = new Map(next.results.map((r) => [r.id, r]));
      const results = outcome!.response.results.map((r) => byId.get(r.id) ?? r);
      await onRetried({ results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, warnings: next.warnings });
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <Dialog
      open={!!outcome}
      onOpenChange={(o) => !o && !retry.isPending && onClose()}
      title={outcome?.title ?? ''}
      description={outcome ? t('products.bulk.result.summary', { ok: outcome.response.ok, failed: outcome.response.failed }) : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          {failed.length ? (
            <Button onClick={again} loading={retry.isPending}>
              {t('products.bulk.result.retry', { count: failed.length })}
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose} disabled={retry.isPending}>
            {t('action.close')}
          </Button>
        </>
      }
    >
      <ul className="max-h-72 divide-y divide-line-hairline overflow-y-auto" data-testid="bulk-results">
        {(outcome?.response.results ?? []).map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2 text-[13px]" data-ok={r.ok}>
            <Pill tone={r.ok ? 'success' : 'danger'} className="!rounded-[4px]">
              {r.ok ? t('products.bulk.result.ok') : t('products.bulk.result.error')}
            </Pill>
            <span className="min-w-0 flex-1 truncate">{names[r.id] ?? r.id}</span>
            {r.error ? <span className="max-w-[55%] text-end ts-label-meta text-accent-alert">{`${r.error.message} (${r.error.code})`}</span> : null}
          </li>
        ))}
      </ul>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}
