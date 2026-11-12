'use client';
// Row dialogs of the movements journal (Figma "GDS-05 — Movements — list + filter panel", 12 §21 "Movements"):
// "Contre-passer" (`POST /stock/movements/:id/reverse { note }` — a new inverse movement, the journal is immutable)
// and "Voir le stock à cette date" (`GET /stock/snapshot?date`, stock at the end of that day in Africa/Algiers).
import { formatDate, formatNumber } from '@djaber/shared';
import { Button, ConfirmDialog, Dialog, Field, FormAlert, Input, Ltr, Pagination, Skeleton, Table, Td, Th, toast, Tr } from '@djaber/ui';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { catalogApi, useCatalogRefresh } from '../api';
import type { StockMovement } from '../contracts';
import { Money, Num } from '../ui';
import { algiersDay, formatSigned, signedQuantity } from './logic';

const nameOf = (m: StockMovement) => (m.variant ? `${m.product.name} · ${m.variant.name}` : m.product.name);

export function ReverseMovementDialog({ movement, onClose }: { movement: StockMovement | null; onClose: () => void }) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reverse = useMutation({ mutationFn: (m: StockMovement) => catalogApi.reverseMovement(m.id, { note: note.trim() || null }) });
  useEffect(() => {
    if (movement) {
      setNote('');
      setError(null);
    }
  }, [movement]);

  const qty = movement ? signedQuantity(movement) : 0;
  const submit = async () => {
    if (!movement) return;
    setError(null);
    try {
      await reverse.mutateAsync(movement);
      await refresh({ productId: movement.product.id });
      toast(t('movements.reverse.done', { name: nameOf(movement) }));
      onClose();
    } catch (e) {
      // stays open with the note; GDS_MOVEMENT_IMMUTABLE when someone reversed it meanwhile
      setError(errorMessage(e, t));
    }
  };
  return (
    <ConfirmDialog
      open={movement !== null}
      onOpenChange={(o) => !o && !reverse.isPending && onClose()}
      title={t('movements.reverse.title')}
      description={movement ? t('movements.reverse.description', { name: nameOf(movement), quantity: formatSigned(qty), inverse: formatSigned(-qty) }) : undefined}
      confirmLabel={t('movements.action.reverse')}
      cancelLabel={t('action.cancel')}
      closeLabel={t('action.close')}
      loading={reverse.isPending}
      onConfirm={submit}
    >
      <div className="flex flex-col gap-3">
        <Field label={t('common.noteOptional')} htmlFor="reverse-note">
          <Input id="reverse-note" value={note} maxLength={255} disabled={reverse.isPending} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </ConfirmDialog>
  );
}

const SNAPSHOT_PAGE = 25;

export function SnapshotDialog({ movement, onClose }: { movement: StockMovement | null; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const ws = useWorkspaceId();
  const [page, setPage] = useState(1);
  const date = movement ? algiersDay(movement.createdAt) : '';
  useEffect(() => setPage(1), [date]);
  const snapshot = useQuery({
    queryKey: [ws, 'stock', 'snapshot', date, page],
    queryFn: () => catalogApi.snapshot({ date, page, pageSize: SNAPSHOT_PAGE }),
    enabled: !!ws && !!movement,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const rows = snapshot.data?.data ?? [];
  const total = snapshot.data?.meta?.total ?? rows.length;
  const totalValue = snapshot.data?.meta?.totalValue;
  const day = movement ? formatDate(movement.createdAt, locale) : '';
  return (
    <Dialog
      open={movement !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t('movements.snapshot.title', { date: day })}
      description={t('movements.snapshot.description')}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('action.close')}
        </Button>
      }
    >
      {snapshot.isPending ? (
        <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : snapshot.isError ? (
        <div className="flex flex-col items-start gap-3">
          <FormAlert>{errorMessage(snapshot.error, t)}</FormAlert>
          <Button onClick={() => snapshot.refetch()}>{t('action.retry')}</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-text-muted">{t('movements.snapshot.empty')}</p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="snapshot">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="ts-label-meta uppercase text-text-muted">{t('movements.snapshot.lines', { count: total })}</span>
            {totalValue !== undefined && totalValue !== null ? (
              <span className="text-[13px]">
                {t('movements.snapshot.totalValue')} <Money value={totalValue} className="font-semibold" />
              </span>
            ) : null}
          </div>
          <div className="rounded-card border border-line-edge">
            <Table aria-label={t('movements.snapshot.title', { date: day })}>
              <thead>
                <tr>
                  <Th scope="col">{t('movements.col.product')}</Th>
                  <Th scope="col">{t('movements.snapshot.sku')}</Th>
                  <Th scope="col" className="!text-end">
                    {t('common.quantity')}
                  </Th>
                  <Th scope="col" className="!text-end">
                    {t('movements.snapshot.cost')}
                  </Th>
                  <Th scope="col" className="!text-end">
                    {t('movements.snapshot.value')}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={`${r.productId}:${r.variantId ?? ''}`}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td>{r.sku ? <Ltr>{r.sku}</Ltr> : <span className="text-text-muted">—</span>}</Td>
                    <Td className="text-end">
                      <Num value={r.quantityAtDate} className={r.quantityAtDate < 0 ? 'text-accent-alert' : undefined} />
                    </Td>
                    <Td className="text-end">
                      <Money value={r.costPriceAtDate} muted />
                    </Td>
                    <Td className="text-end">
                      <Money value={r.valueAtDate} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {total > SNAPSHOT_PAGE ? (
              <Pagination
                page={page}
                pageSize={SNAPSHOT_PAGE}
                total={total}
                onPageChange={setPage}
                labels={{
                  previous: t('action.previousPage'),
                  next: t('action.nextPage'),
                  perPage: (n) => t('common.perPage', { count: n }),
                  range: (from, to, all) => t('common.rangeOf', { from, to, total: formatNumber(all) }),
                }}
              />
            ) : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}
