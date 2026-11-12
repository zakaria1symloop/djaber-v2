'use client';
// Bulk send (DLV-05 bulk, Figma "MECH — Delivery filters + row menu + bulk send results" right column, FL-08):
// one courier for n orders (`POST /shipments/bulk` → 202 job, `result` = BulkSendResult), orders that cannot be sent
// listed with their reason before sending, then the per-order results: Créée + tracking (OK) / error code + mapped
// field (ÉCHEC, "Corriger et renvoyer") / ignored `DELIVERY_ORDER_ALREADY_SENT` / queued `COURIER_UNAVAILABLE`, with
// "Imprimer n bordereaux" and "Réessayer les échecs (n)".
import { formatNumber } from '@djaber/shared';
import { ActionsMenu, Button, Dialog, FormAlert, Pill, ProgressBar, RadioCards, Skeleton } from '@djaber/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { refusal, useOnOpen } from '@/features/orders/dialogs/common';
import { useOrderActions } from '@/features/orders/use-order-actions';
import { useRouter } from '@/i18n/navigation';
import { isJobRunning, useJob } from '@/lib/jobs';
import { rowErrorText } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { uuid } from '@/lib/uuid';
import { deliveryApi, useCouriers, useDeliveryRefresh } from './api';
import type { BulkSendResult } from './contracts';
import { PrintLabelsDialog } from './labels';
import { bulkRowState, courierErrorField } from './logic';

/** One order of the selection: `blocked` = the reason the server descriptor gives for `send_courier` (greyed). */
export type SendTarget = { id: string; number: string; label: string; blocked?: string | null };

export function BulkSendDialog({ open, orders, onClose, onFinished }: { open: boolean; orders: SendTarget[]; onClose: () => void; onFinished?: () => void }) {
  const t = useT();
  const couriers = useCouriers(open);
  const active = useMemo(() => (couriers.data ?? []).filter((c) => c.isActive), [couriers.data]);
  const [courierId, setCourierId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const key = useRef(uuid());
  useOnOpen(open, () => {
    setCourierId('');
    setError(null);
    setJobId(null);
    key.current = uuid();
  });
  useEffect(() => {
    if (open && !courierId && active.length) setCourierId((active.find((c) => c.isDefault) ?? active[0])!.id);
  }, [open, courierId, active]);
  const valid = orders.filter((o) => !o.blocked);
  const invalid = orders.filter((o) => o.blocked);
  const courier = active.find((c) => c.id === courierId) ?? null;

  const send = async (ids: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await deliveryApi.sendBulk({ orderIds: ids, courierAccountId: courierId || null }, key.current);
      key.current = uuid();
      setJobId(r.jobId);
    } catch (e) {
      setError(refusal(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open={open && !jobId}
        onOpenChange={(o) => !o && !busy && onClose()}
        title={t('send.bulk.title', { count: orders.length })}
        description={t('send.bulk.description')}
        closeLabel={t('action.close')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void send(valid.map((o) => o.id))} loading={busy} disabled={!valid.length || !courierId} data-testid="bulk-send-submit">
              {t('send.bulk.submit', { count: valid.length, courier: courier?.displayName ?? '' })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4" data-testid="bulk-send-dialog">
          {couriers.isPending ? (
            <Skeleton className="h-14 w-full" />
          ) : active.length ? (
            <RadioCards label={t('common.courier')} columns={2} value={courierId} onChange={setCourierId} options={active.map((c) => ({ value: c.id, label: c.isDefault ? `${c.displayName} · ${t('couriers.default').toUpperCase()}` : c.displayName, description: t(`couriers.provider.${c.provider}`) }))} />
          ) : (
            <FormAlert tone="info">{t('error.DELIVERY_NO_COURIER')}</FormAlert>
          )}
          <p className="text-[13px] text-text-secondary">{t('send.bulk.valid', { count: valid.length })}</p>
          {invalid.length ? (
            <div className="flex flex-col gap-1.5" data-testid="bulk-send-invalid">
              <p className="ts-label-micro text-accent-starred">{t('send.bulk.invalid', { count: invalid.length })}</p>
              <ul className="max-h-40 divide-y divide-line-hairline overflow-y-auto rounded-card border border-line-edge">
                {invalid.map((o) => (
                  <li key={o.id} className="px-3 py-2 text-[13px]">
                    <span className="block truncate">{o.label}</span>
                    <span className="block ts-label-micro !normal-case text-accent-starred">{o.blocked}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <FormAlert>{error}</FormAlert> : null}
        </div>
      </Dialog>
      <BulkSendResults
        jobId={jobId}
        open={open && !!jobId}
        title={t('send.bulk.resultTitle', { courier: courier?.displayName ?? '', count: valid.length })}
        names={Object.fromEntries(orders.map((o) => [o.id, o.label]))}
        courierName={courier?.displayName ?? null}
        onRetry={(ids) => (setJobId(null), void send(ids))}
        onClose={() => {
          onFinished?.();
          onClose();
        }}
      />
    </>
  );
}


export function BulkSendResults({ jobId, open, title, names, courierName, onRetry, onClose }: { jobId: string | null; open: boolean; title: string; names: Record<string, string>; courierName: string | null; onRetry: (ids: string[]) => void; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const refresh = useDeliveryRefresh();
  const orders = useOrderActions();
  const q = useJob<BulkSendResult>(open ? jobId : null);
  const job = q.data;
  const running = !job || isJobRunning(job);
  const result = job?.result ?? null;
  const rows = result?.results ?? [];
  const failed = rows.filter((r) => bulkRowState(r) === 'failed');
  const created = rows.filter((r) => r.ok && r.data?.trackingNumber);
  const [print, setPrint] = useState(false);
  useEffect(() => {
    if (job && !isJobRunning(job)) void refresh();
  }, [job, refresh]);
  return (
    <>
      <Dialog
        open={open && !print}
        onOpenChange={(o) => !o && onClose()}
        title={title}
        description={t('send.bulk.resultDescription')}
        closeLabel={t('action.close')}
        size="lg"
        footer={
          <>
            {created.length ? (
              <Button onClick={() => setPrint(true)} data-testid="bulk-send-labels">
                {t('send.bulk.printLabels', { count: created.length })}
              </Button>
            ) : null}
            {failed.length ? (
              <Button onClick={() => onRetry(failed.map((f) => f.id))} data-testid="bulk-send-retry">
                {t('orders.bulk.result.retry', { count: failed.length })}
              </Button>
            ) : null}
            <Button variant="primary" onClick={onClose}>
              {t('action.close')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3" data-testid="bulk-send-results" data-state={running ? 'running' : 'done'}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-medium">{courierName ? t('send.bulk.to', { courier: courierName, count: rows.length || (job?.total ?? 0) }) : null}</span>
            {result ? (
              <span data-testid="bulk-send-summary">
                <Pill tone={failed.length ? 'warning' : 'success'} className="!rounded-[4px]">
                  {t('send.bulk.summary', { ok: result.ok, failed: result.failed })}
                </Pill>
              </span>
            ) : null}
          </div>
          <ProgressBar value={running ? (job?.progress ?? 0) : 100} label={t('send.bulk.progress')} />
          {running && !rows.length ? (
            <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-line-hairline overflow-y-auto rounded-card border border-line-edge">
              {rows.map((r) => {
                const st = bulkRowState(r);
                const field = courierErrorField(r.error?.fields ? Object.keys(r.error.fields)[0] : (r.error?.params?.field as string | undefined));
                return (
                  <li key={r.id} className="flex items-start gap-3 px-3 py-2.5" data-result={st}>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{names[r.id] ?? (r.orderNumber ? `#${r.orderNumber}` : r.id)}</span>
                      <span className={`block ts-label-micro !normal-case ${st === 'ok' ? 'text-accent-money' : st === 'failed' ? 'text-accent-alert' : 'text-accent-starred'}`}>
                        {st === 'ok'
                          ? [t('send.bulk.created'), r.data?.trackingNumber].filter(Boolean).join(' · ')
                          : st === 'queued'
                            ? t('send.bulk.queued')
                            : `${[rowErrorText(t, r.error), field ? t(`send.field.${field}`) : null].filter(Boolean).join(' · ')}${st === 'ignored' ? ` (${t('send.bulk.ignored')})` : ''}`}
                      </span>
                    </div>
                    {st === 'failed' || st === 'ignored' ? (
                      <ActionsMenu
                        label={t('action.actions')}
                        heading={names[r.id] ?? r.id}
                        actions={[
                          ...(st === 'failed' ? [{ key: 'fix', label: t('parcel.menu.fixResend'), primary: true, onSelect: () => orders.openOn('send', r.id, { error: r.error ? { code: r.error.code, field: field, message: r.error.message } : null }) }] : []),
                          { key: 'open', label: t('parcel.menu.openOrder'), onSelect: () => router.push(`/orders/${r.id}`) },
                        ]}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {job?.status === 'failed' ? <FormAlert>{job.error ? job.error.message : t('state.list.error.title')}</FormAlert> : null}
          {q.isError ? <FormAlert>{refusal(q.error, t)}</FormAlert> : null}
          {result && result.queued > 0 ? <p className="ts-label-micro !normal-case text-text-muted">{t('send.bulk.queuedNote', { count: formatNumber(result.queued) })}</p> : null}
        </div>
      </Dialog>
      <PrintLabelsDialog open={open && print} orders={created.map((r) => ({ id: r.id, label: names[r.id] ?? r.id, sent: true }))} courier={courierName} onClose={() => setPrint(false)} />
      {orders.element}
    </>
  );
}
