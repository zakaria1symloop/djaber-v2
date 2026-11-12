'use client';
// Form banner of the Djaber validation (D36) — Figma "MOD — Merchant side — product moderation states" (FORMULAIRE
// PRODUIT): pending "Soumis le … · validation en cours", rejected (reason + fields concerned + Resoumettre /
// Contester), appealed "Contestation en cours". The appeal dialog itself lives on the product page.
import { formatDateTime } from '@djaber/shared';
import { Banner, Button, buttonClass } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { catalogApi, useCatalogRefresh } from '../api';
import type { Product } from '../contracts';
import { rejectedFieldSet, type RejectedField } from './model';

export function ModerationBanner({ product, dirty, canWrite }: { product: Product; dirty: boolean; canWrite: boolean }) {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const refresh = useCatalogRefresh();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const resubmit = useMutation({ mutationFn: () => catalogApi.resubmit(product.id) });
  const status = product.moderation?.status ?? product.moderationDetail?.status;
  const detail = product.moderationDetail;
  if (!status || status === 'not_required' || status === 'approved') return null;

  const submittedAt = detail?.submittedAt ? formatDateTime(detail.submittedAt, locale) : null;
  if (status === 'pending') {
    return (
      <Banner tone="info">
        <span data-testid="moderation-banner" data-status="pending">
          {submittedAt ? t('products.form.moderation.pending', { date: submittedAt }) : t('products.form.moderation.pendingNoDate')}
        </span>
      </Banner>
    );
  }
  if (status === 'appealed') {
    return (
      <Banner tone="violet">
        <span data-testid="moderation-banner" data-status="appealed">
          {t('products.form.moderation.appealed')}
        </span>
      </Banner>
    );
  }
  if (status !== 'rejected') return null;

  const fields = [...rejectedFieldSet(detail?.rejectedFields)];
  const fieldLabel = (f: RejectedField) => t(`products.form.moderation.field.${f}`);
  const appealable = detail?.appeal?.status === 'available';
  const onResubmit = async () => {
    setError(null);
    try {
      await resubmit.mutateAsync();
      setSent(true);
      await refresh({ productId: product.id });
    } catch (e) {
      setError(errorMessage(e, t));
      // MODERATION_NOT_REJECTED: the decision changed meanwhile — show the current status
      if (e instanceof ApiError && e.code === 'MODERATION_NOT_REJECTED') void refresh({ productId: product.id });
    }
  };
  return (
    <Banner tone="danger">
      <div className="flex flex-wrap items-center gap-3" data-testid="moderation-banner" data-status="rejected">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{t('products.form.moderation.rejected')}</div>
          {detail?.merchantMessage ? <p className="mt-1 text-text-secondary">{detail.merchantMessage}</p> : null}
          {fields.length ? <p className="mt-1 ts-label-meta text-text-muted">{t('products.form.moderation.fields', { fields: fields.map(fieldLabel).join(', ') })}</p> : null}
          {error ? (
            <p role="alert" className="mt-1 text-accent-alert">
              {error}
            </p>
          ) : null}
        </div>
        {canWrite ? (
          <>
            {appealable ? (
              <Link href={`/products/${product.id}?appeal=1`} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                {t('products.form.moderation.appeal')}
              </Link>
            ) : null}
            <Button size="sm" onClick={onResubmit} loading={resubmit.isPending} disabled={sent} disabledReason={dirty ? t('products.form.moderation.saveFirst') : undefined} data-testid="moderation-resubmit">
              {t('products.form.moderation.resubmit')}
            </Button>
          </>
        ) : null}
      </div>
    </Banner>
  );
}
