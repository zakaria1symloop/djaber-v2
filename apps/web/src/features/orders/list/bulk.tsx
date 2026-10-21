'use client';
// Orders list — selection bar and its dialogs (Figma "ORD-05 v2" bulk bar, "ORD-05 — Orders — row actions menu + bulk
// results dialog", DLG "Exporter les commandes", "Assigner"). Bulk endpoints answer one result per order (never
// all-or-nothing, AT-ORD-12 / AT-ORD-30): the result dialog lists OK / ERREUR code rows and retries the errors.
import { formatNumber } from '@djaber/shared';
import { BulkBar, Button, Checkbox, Dialog, Field, FormAlert, Pill, Select, toast, type BulkAction } from '@djaber/ui';
import { useMemo, useRef, useState } from 'react';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl, jobFileName, trackJob } from '@/lib/jobs';
import type { ApiQuery } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { uuid } from '@/lib/uuid';
import { ordersApi, useOrdersRefresh } from '../api';
import { CANCEL_REASONS, type BulkResponse, type CancelReason, type OrderListItem, type OrderStatus } from '../contracts';
import { refusal, RadioList, useOnOpen } from '../dialogs/common';
import { AssignDialog } from '../dialogs/order-dialogs';
import { BulkSendDialog } from '@/features/delivery/bulk-send';
import { PrintLabelsDialog } from '@/features/delivery/labels';
import { actionState } from '@/lib/actions';
import { ORDER_ACTION } from '../action-keys';
import { mergeRetry } from '../logic';

type Outcome = { title: string; response: BulkResponse; retry?: (ids: string[]) => Promise<BulkResponse> };

/** Progress toast of an export / print job ("Export des commandes : 40 % (512 lignes)" → "Export terminé · Télécharger"). */
export function useOrdersJob() {
  const t = useT();
  return async (start: () => Promise<{ jobId: string }>, kind: 'export' | 'print') => {
    try {
      const { jobId } = await start();
      const entity = t('orders.export.entity');
      trackJob({
        jobId,
        download: kind === 'export',
        started: t('toast.jobStarted'),
        progress: (job) => (kind === 'export' ? t('toast.export.progress', { entity, pct: job.progress, rows: formatNumber(job.total ?? 0) }) : t('orders.print.progress', { pct: job.progress })),
        done: (job) => ({
          message: kind === 'export' ? t('toast.export.done', { file: t('orders.export.file') }) : t('orders.print.done'),
          action: job.resultUrl ? { label: kind === 'export' ? t('action.download') : t('action.open'), onClick: () => downloadUrl(job.resultUrl!, jobFileName(job)) } : undefined,
        }),
        failed: (job, error) => (job?.error ? `${job.error.message} (${job.error.code})` : refusal(error, t)),
      });
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    }
  };
}

/* ---------- Exporter les commandes: sélection / filtre courant / toutes ---------- */
export function ExportOrdersDialog({ open, onClose, filters, filterLabel, selection, counts }: { open: boolean; onClose: () => void; filters: ApiQuery; filterLabel: string; selection: string[]; counts: { filter: number | null; all: number | null } }) {
  const t = useT();
  const run = useOrdersJob();
  const [scope, setScope] = useState<'selection' | 'filter' | 'all'>('filter');
  const [format, setFormat] = useState<'csv' | 'xlsx' | 'pdf'>('xlsx');
  const [columns, setColumns] = useState<'standard' | 'all'>('standard');
  const [items, setItems] = useState(false);
  const [zr, setZr] = useState(false);
  useOnOpen(open, () => {
    setScope(selection.length ? 'selection' : 'filter');
    setFormat('xlsx');
    setColumns('standard');
    setItems(false);
    setZr(false);
  });
  const submit = () => {
    const q: ApiQuery = scope === 'selection' ? { ids: selection } : scope === 'filter' ? { ...filters } : {};
    q.scope = scope;
    q.format = format;
    q.columns = columns;
    if (items) q.includeItems = true;
    if (zr) q.courierFormat = 'zrexpress';
    onClose();
    void run(() => ordersApi.exportOrders(q), 'export');
  };
  const n = (v: number | null) => (v === null ? '…' : formatNumber(v));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.exportOrders.title')}
      description={t('orders.export.context', { filter: filterLabel, count: n(counts.filter) })}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          <p className="me-auto max-w-[50%] ts-label-micro !normal-case text-text-muted">{t('orders.export.note')}</p>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} data-testid="export-submit">
            {t('action.export')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="export-dialog">
        <RadioList<'selection' | 'filter' | 'all'>
          label={t('orders.export.scope')}
          value={scope}
          onChange={setScope}
          options={[
            ...(selection.length ? [{ value: 'selection' as const, label: t('orders.export.scope.selection', { count: selection.length }) }] : []),
            { value: 'filter' as const, label: t('orders.export.scope.filter', { count: n(counts.filter) }) },
            { value: 'all' as const, label: t('orders.export.scope.all', { count: n(counts.all) }) },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('orders.export.format')} htmlFor="exp-format">
            <Select id="exp-format" value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'xlsx' | 'pdf')}>
              <option value="xlsx">XLSX</option>
              <option value="csv">CSV</option>
              <option value="pdf">{t('orders.export.pdf')}</option>
            </Select>
          </Field>
          <Field label={t('common.columns')} htmlFor="exp-columns">
            <Select id="exp-columns" value={columns} onChange={(e) => setColumns(e.target.value as 'standard' | 'all')}>
              <option value="standard">{t('orders.export.columns.standard')}</option>
              <option value="all">{t('orders.export.columns.all')}</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={items} onChange={(e) => setItems(e.target.checked)} />
          {t('orders.export.items')}
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={zr} onChange={(e) => setZr(e.target.checked)} />
          {t('orders.export.zr')}
        </label>
      </div>
    </Dialog>
  );
}

/* ---------- Imprimer (A5 slips of the selection, one PDF job) ---------- */
export function PrintOrdersDialog({ open, ids, onClose }: { open: boolean; ids: string[]; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const run = useOrdersJob();
  const key = useRef(uuid());
  const [withPrices, setWithPrices] = useState(true);
  const [twoPerPage, setTwoPerPage] = useState(false);
  const [lang, setLang] = useState<'fr' | 'ar' | 'en'>('fr');
  useOnOpen(open, () => {
    key.current = uuid();
    setWithPrices(true);
    setTwoPerPage(false);
    setLang((locale as 'fr' | 'ar' | 'en') ?? 'fr');
  });
  const submit = () => {
    onClose();
    void run(() => ordersApi.bulkPrint({ ids, withPrices, twoPerPage, lang }, key.current), 'print');
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('orders.print.title')}
      description={t('orders.bulk.selected', { count: ids.length })}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} data-testid="print-submit">
            {t('action.printCount', { count: ids.length })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="print-dialog">
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={withPrices} onChange={(e) => setWithPrices(e.target.checked)} />
          {t('orders.print.withPrices')}
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={twoPerPage} onChange={(e) => setTwoPerPage(e.target.checked)} />
          {t('orders.print.twoPerPage')}
        </label>
        <Field label={t('orders.print.lang')} htmlFor="print-lang">
          <Select id="print-lang" value={lang} onChange={(e) => setLang(e.target.value as 'fr' | 'ar' | 'en')}>
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/* ---------- Annuler (bulk): one reason for the selection ---------- */
function BulkCancelDialog({ open, count, onClose, onSubmit }: { open: boolean; count: number; onClose: () => void; onSubmit: (reason: CancelReason) => Promise<string | null> }) {
  const t = useT();
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useOnOpen(open, () => {
    setReason(null);
    setError(null);
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('orders.bulk.cancelTitle', { count })}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.keep')}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!reason}
            data-testid="dialog-submit"
            onClick={async () => {
              setBusy(true);
              setError(await onSubmit(reason!));
              setBusy(false);
            }}
          >
            {t('action.cancelOrder').replace(/^✕\s*/, '')}
          </Button>
        </>
      }
    >
      <RadioList<CancelReason> label={t('common.reasonRequired')} value={reason} onChange={setReason} options={CANCEL_REASONS.map((r) => ({ value: r, label: t(`enum.Order.cancelReason.${r}`) }))} />
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}

export function OrdersBulkBar({
  rows,
  selected,
  total,
  onSelectAllPage,
  onClear,
  onExport,
  offline,
}: {
  rows: OrderListItem[];
  selected: ReadonlySet<string>;
  total: number;
  onSelectAllPage: () => void;
  onClear: () => void;
  onExport: () => void;
  offline: boolean;
}) {
  const t = useT();
  const { can } = useSession();
  const refresh = useOrdersRefresh();
  const [dialog, setDialog] = useState<'assign' | 'print' | 'cancel' | 'send' | 'labels' | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ids = useMemo(() => [...selected], [selected]);
  // labels of every row seen on screen: a cancelled order may leave the tab before the result dialog opens
  const seen = useRef<Record<string, string>>({});
  for (const r of rows) seen.current[r.id] = `#${r.number} · ${r.client.name}`;
  const forbidden = !can('orders.write') ? t('toast.forbidden') : offline ? t('banner.offline') : undefined;

  const finish = async (title: string, response: BulkResponse, retry?: Outcome['retry']) => {
    await refresh();
    if (response.failed === 0) {
      toast(t('orders.bulk.done', { count: response.ok }));
      onClear();
    } else setOutcome({ title, response, retry });
  };
  const status = async (to: OrderStatus, title: string, reason?: string) => {
    setBusy(to);
    const retry = (list: string[]) => ordersApi.bulkStatus({ ids: list, to, reason: reason ?? null }, uuid());
    try {
      await finish(title, await retry(ids), retry);
      return null;
    } catch (e) {
      const msg = refusal(e, t);
      toast({ tone: 'danger', message: msg });
      return msg;
    } finally {
      setBusy(null);
    }
  };
  const chosen = rows.filter((r) => selected.has(r.id));
  const sendTargets = chosen.map((r) => {
    const a = actionState(r.actions, ORDER_ACTION.sendToCourier, t);
    return { id: r.id, number: r.number, label: `#${r.number} · ${r.client.name}`, blocked: a.present && a.enabled ? null : (a.reason ?? `${t('error.DELIVERY_ORDER_NOT_CONFIRMED')} (DELIVERY_ORDER_NOT_CONFIRMED)`) };
  });
  const sendForbidden = !can('delivery.send') ? t('toast.forbidden') : offline ? t('banner.offline') : undefined;
  const actions: BulkAction[] = [
    { key: 'confirm', label: busy === 'confirmed' ? t('common.saving') : t('action.confirm'), onSelect: () => void status('confirmed', t('orders.bulk.title', { action: t('action.confirm'), count: ids.length })), disabledReason: forbidden ?? (busy ? t('common.saving') : undefined) },
    { key: 'prepare', label: t('action.prepare'), onSelect: () => void status('preparing', t('orders.bulk.title', { action: t('action.prepare'), count: ids.length })), disabledReason: forbidden ?? (busy ? t('common.saving') : undefined) },
    { key: 'ship', label: t('orders.bulk.ship'), onSelect: () => void status('shipped', t('orders.bulk.title', { action: t('orders.bulk.ship'), count: ids.length })), disabledReason: forbidden ?? (busy ? t('common.saving') : undefined) },
    { key: 'assign', label: t('action.assign'), onSelect: () => setDialog('assign'), disabledReason: forbidden },
    { key: 'send', label: t('action.sendToCourier'), onSelect: () => setDialog('send'), disabledReason: sendForbidden ?? (sendTargets.length && sendTargets.every((x) => x.blocked) ? t('delivery.bulk.noneSendable') : undefined) },
    { key: 'labels', label: t('action.labels'), onSelect: () => setDialog('labels'), disabledReason: sendForbidden },
    { key: 'print', label: t('action.print'), onSelect: () => setDialog('print'), disabledReason: forbidden },
    ...(can('orders.money') ? [{ key: 'export', label: t('action.export'), onSelect: onExport, disabledReason: offline ? t('banner.offline') : undefined }] : []),
    { key: 'cancel', label: t('action.cancel'), onSelect: () => setDialog('cancel'), destructive: true, disabledReason: forbidden },
  ];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <>
      <BulkBar
        label={t('orders.bulk.label')}
        summary={t('orders.bulk.selected', { count: ids.length })}
        actions={actions}
        note={t('orders.bulk.note')}
        selectAll={allOnPage ? undefined : { label: t('action.selectAll', { count: Math.min(rows.length, total) }), onSelect: onSelectAllPage }}
        deselectLabel={t('action.deselect')}
        onDeselect={onClear}
      />
      <AssignDialog
        open={dialog === 'assign'}
        ids={ids}
        onClose={() => setDialog(null)}
        onDone={async (r) => {
          if (r) await finish(t('orders.bulk.title', { action: t('action.assign'), count: ids.length }), r);
          else await refresh();
        }}
      />
      <PrintOrdersDialog open={dialog === 'print'} ids={ids} onClose={() => setDialog(null)} />
      <BulkSendDialog open={dialog === 'send'} orders={sendTargets} onClose={() => setDialog(null)} onFinished={() => (onClear(), void refresh())} />
      <PrintLabelsDialog
        open={dialog === 'labels'}
        orders={chosen.map((r) => ({ id: r.id, label: `#${r.number} · ${r.client.name}`, sent: !!r.shipment?.trackingNumber && r.shipment.status !== 'cancelled' }))}
        onClose={() => setDialog(null)}
      />
      <BulkCancelDialog
        open={dialog === 'cancel'}
        count={ids.length}
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => {
          const err = await status('cancelled', t('orders.bulk.title', { action: t('action.cancel'), count: ids.length }), reason);
          if (!err) setDialog(null);
          return err;
        }}
      />
      <BulkResultDialog outcome={outcome} names={seen.current} onClose={() => (setOutcome(null), onClear())} onRetried={async (r) => (await refresh(), setOutcome((o) => (o ? { ...o, response: r } : o)))} />
    </>
  );
}

export function BulkResultDialog({ outcome, names, onClose, onRetried }: { outcome: Outcome | null; names: Record<string, string>; onClose: () => void; onRetried: (r: BulkResponse) => Promise<void> }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failed = outcome?.response.results.filter((r) => !r.ok && !r.skipped) ?? [];
  const again = async () => {
    if (!outcome?.retry) return;
    setBusy(true);
    setError(null);
    try {
      await onRetried(mergeRetry(outcome.response, await outcome.retry(failed.map((f) => f.id))));
    } catch (e) {
      setError(refusal(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!outcome}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={outcome?.title ?? ''}
      description={t('orders.bulk.result.description')}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        <>
          {failed.length && outcome?.retry ? (
            <Button onClick={again} loading={busy} data-testid="bulk-retry">
              {t('orders.bulk.result.retry', { count: failed.length })}
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose} disabled={busy}>
            {t('action.close')}
          </Button>
        </>
      }
    >
      <ul className="max-h-80 divide-y divide-line-hairline overflow-y-auto rounded-card border border-line-edge" data-testid="bulk-results">
        {(outcome?.response.results ?? []).map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-3 py-2.5 text-[13px]" data-ok={r.ok}>
            <Pill tone={r.ok ? 'success' : r.skipped ? 'neutral' : 'danger'} className="mt-0.5 !rounded-[4px]">
              {r.ok ? t('orders.bulk.result.ok') : r.skipped ? t('orders.bulk.result.skipped') : t('orders.bulk.result.error')}
            </Pill>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{names[r.id] ?? r.id}</span>
              {r.error ? <span className="block ts-label-micro !normal-case text-accent-alert">{`${r.error.code} — ${r.error.message}`}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}
