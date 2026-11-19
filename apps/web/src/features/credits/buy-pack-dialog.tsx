'use client';
// DLG "Acheter un pack" (Figma "BIL-04 / BIL-03 — Credits page", "DLG — Settings & billing", PCK-01 / D40, FL-28):
// `GET /credit-packs` (web packs), `POST /credits/packs/checkout { packId }` (Idempotency-Key, `billing.write`) →
// Chargily checkout → the same return page as plans. Pack credits never expire and are consumed after the plan's.
import { formatNumber } from '@djaber/shared';
import { Button, Dialog, EmptyState, FormAlert, PackCard, Skeleton, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { billingApi, goToCheckout, usePacks } from '@/features/billing/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { uuid } from '@/lib/uuid';
import { pricePerCredit } from './logic';

export function BuyPackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const { can } = useSession();
  const allowed = can('billing.write');
  const q = usePacks(open);
  const packs = useMemo(() => q.data ?? [], [q.data]);
  const [packId, setPackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(uuid);
  const checkout = useMutation({ mutationFn: (id: string) => billingApi.packCheckout(id, key) });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setKey(uuid());
  }, [open]);
  // preselect the featured pack (else the first) once the list arrived
  useEffect(() => {
    if (open && packs.length && !packs.some((p) => p.id === packId)) setPackId((packs.find((p) => p.isFeatured) ?? packs[0])!.id);
  }, [open, packs, packId]);
  const chosen = packs.find((p) => p.id === packId) ?? null;

  const submit = async () => {
    if (!chosen) return;
    setError(null);
    try {
      const r = await checkout.mutateAsync(chosen.id);
      toast({ tone: 'info', message: t('billing.change.redirecting') });
      goToCheckout(r.checkoutUrl);
    } catch (e) {
      setError(errorMessage(e, t));
      setKey(uuid());
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !checkout.isPending && onClose()}
      title={t('action.buyPack')}
      description={t('credits.pack.context')}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={checkout.isPending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={checkout.isPending} disabled={!chosen} disabledReason={allowed ? undefined : t('billing.writeOnly')} data-testid="pack-pay">
            {chosen ? t('credits.pack.pay', { amount: formatNumber(chosen.priceWebDzd) }) : t('action.buyPack')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="buy-pack-dialog">
        {q.isPending ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[104px]" />
            ))}
          </div>
        ) : q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : packs.length === 0 ? (
          <EmptyState icon={<Package className="size-5" />} title={t('credits.pack.empty')} />
        ) : (
          <div role="radiogroup" aria-label={t('action.buyPack')} className="grid gap-2 sm:grid-cols-3">
            {packs.map((p) => (
              <PackCard
                key={p.id}
                data-testid="pack-option"
                data-pack={p.slug}
                name={p.name}
                // seed packs are named after their credits ("2 000 crédits"): the line is not repeated then
                credits={p.name.replace(/\D/g, '') === String(p.credits) ? undefined : t('credits.pack.credits', { count: formatNumber(p.credits), countN: p.credits })}
                price={t('credits.pack.price', { amount: formatNumber(p.priceWebDzd) })}
                perCredit={t('credits.pack.perCredit', { price: pricePerCredit(p.pricePerCreditDzd, locale) })}
                badge={p.isFeatured ? t('billing.plan.badge.featured') : undefined}
                selected={p.id === packId}
                onSelect={() => setPackId(p.id)}
              />
            ))}
          </div>
        )}
        <p className="ts-label-meta text-text-muted">{t('credits.pack.mobile')}</p>
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
