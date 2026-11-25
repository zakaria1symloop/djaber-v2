'use client';
// "Copier depuis un transporteur" (DLV-07, DLG II "Grille des frais — actions", Figma DLV-01/03 "Copier les tarifs ZR
// Express →"): choose a courier with live rates, preview the differences (`POST /delivery/fees/copy-from-courier
// { dryRun: true }` — domicile / stop-desk before → after), then apply all rows or the ticked ones. The client still
// pays the grid (D15): copying writes the courier prices INTO the grid, it never links them.
import { formatMoney } from '@djaber/shared';
import { Checkbox, Dialog, FormAlert, Ltr, RadioCards, Skeleton, Table, Td, Th, toast } from '@djaber/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { DialogFooter, refusal, useOnOpen } from '@/features/orders/dialogs/common';
import { useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { deliveryApi, deliveryKeys } from './api';
import type { CourierAccount } from './contracts';

export function CopyRatesDialog({ open, couriers, onClose }: { open: boolean; couriers: CourierAccount[]; onClose: () => void }) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const eligible = useMemo(() => couriers.filter((c) => c.isActive && c.capabilities.rates), [couriers]);
  const [courierId, setCourierId] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useOnOpen(open, () => {
    setCourierId((eligible.find((c) => c.isDefault) ?? eligible[0])?.id ?? '');
    setError(null);
  });
  const diff = useQuery({
    queryKey: [ws, 'delivery', 'copy-diff', courierId],
    queryFn: () => deliveryApi.copyFromCourier({ courierAccountId: courierId, dryRun: true }),
    enabled: open && !!courierId,
    staleTime: 0,
    retry: false,
    // a cold rates cache is filled by the worker: read again until it is there
    refetchInterval: (q) => (q.state.data?.refreshing ? 4_000 : false),
  });
  const changed = useMemo(() => (diff.data?.rows ?? []).filter((r) => r.changed), [diff.data]);
  useEffect(() => setPicked(new Set(changed.map((r) => r.wilayaId))), [changed]);
  const courier = eligible.find((c) => c.id === courierId);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const all = picked.size === changed.length;
      const r = await deliveryApi.copyFromCourier({ courierAccountId: courierId, ...(all ? {} : { wilayaIds: [...picked] }), dryRun: false });
      await qc.invalidateQueries({ queryKey: deliveryKeys.fees(ws) });
      toast(t('fees.copy.done', { count: r.written, courier: courier?.displayName ?? '' }));
      onClose();
    } catch (e) {
      setError(refusal(e, t));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('fees.copy.title')}
      description={t('fees.copy.description')}
      closeLabel={t('action.close')}
      size="lg"
      footer={<DialogFooter onClose={onClose} busy={busy} onSubmit={() => void apply()} label={picked.size === changed.length ? t('fees.copy.applyAll', { count: picked.size }) : t('fees.copy.applySome', { count: picked.size })} disabled={!picked.size || diff.isFetching} note={t('fees.copy.note')} />}
    >
      <div className="flex flex-col gap-4" data-testid="copy-rates-dialog">
        {eligible.length ? (
          <RadioCards label={t('common.courier')} columns={2} value={courierId} onChange={setCourierId} options={eligible.map((c) => ({ value: c.id, label: c.displayName, description: t(`couriers.provider.${c.provider}`) }))} />
        ) : (
          <FormAlert tone="info">{t('fees.copyCourier.unavailable')}</FormAlert>
        )}
        {diff.isPending && courierId ? (
          <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : diff.isError ? (
          <FormAlert>{refusal(diff.error, t)}</FormAlert>
        ) : diff.data?.failed ? (
          <FormAlert>{t('fees.copy.failed', { courier: courier?.displayName ?? '' })}</FormAlert>
        ) : diff.data?.refreshing ? (
          <p role="status" className="ts-label-meta text-text-muted">
            {t('fees.copy.refreshing', { courier: courier?.displayName ?? '' })}
          </p>
        ) : diff.data ? (
          changed.length ? (
            <div className="max-h-80 overflow-y-auto rounded-card border border-line-edge">
              <Table aria-label={t('fees.copy.title')} data-testid="copy-rates-diff">
                <thead>
                  <tr>
                    <Th className="w-10">
                      <Checkbox aria-label={t('list.selectAll')} checked={picked.size === changed.length} onChange={(e) => setPicked(e.target.checked ? new Set(changed.map((r) => r.wilayaId)) : new Set())} />
                    </Th>
                    <Th>{t('common.wilaya')}</Th>
                    <Th>{t('fees.col.home')}</Th>
                    <Th>{t('fees.col.stopdesk')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {changed.map((r) => (
                    <tr key={r.wilayaId} data-wilaya={r.wilayaId}>
                      <Td>
                        <Checkbox aria-label={r.nameFr} checked={picked.has(r.wilayaId)} onChange={() => toggle(r.wilayaId)} />
                      </Td>
                      <Td>{r.nameFr}</Td>
                      {(['homePrice', 'stopdeskPrice'] as const).map((k) => (
                        <Td key={k}>
                          <Ltr className={r.before[k] === r.after[k] ? 'text-text-muted' : undefined}>{r.before[k] === r.after[k] ? formatMoney(r.after[k]) : `${formatMoney(r.before[k])} → ${formatMoney(r.after[k])}`}</Ltr>
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <FormAlert tone="success">{t('fees.copy.same', { courier: courier?.displayName ?? '' })}</FormAlert>
          )
        ) : null}
        {diff.data?.missing.length ? <p className="ts-label-micro !normal-case text-text-muted">{t('fees.copy.missing', { count: diff.data.missing.length })}</p> : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
