'use client';
// BIL-01 "CRÉDITS · PÉRIODE DU … AU …": the last consumption rows (time · action · agent · credits), the full ledger
// living on /settings/credits. Reserve / release bookkeeping rows are left out here (they net to zero).
import { formatDateTime, formatNumber, type AppLocale } from '@djaber/shared';
import { cn, Ltr } from '@djaber/ui';
import { ListLoading, QueryError } from '@/components/global-states';
import { useLedger } from '@/features/credits/api';
import { actionLabelKey, creditsTone, grantSource, signedCredits } from '@/features/credits/logic';
import { Link } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';

const QUERY = { page: 1, pageSize: 4, action: ['text_reply', 'image_recognition', 'voice_transcription', 'renewal', 'pack_purchase', 'grant', 'store_refund', 'adjustment'] };

export function RecentLedger() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const q = useLedger(QUERY);
  const rows = q.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-2" data-testid="recent-ledger">
      {q.isPending ? (
        <ListLoading rows={4} columns={4} />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="rounded-card border border-line-edge bg-ink-surface px-4 py-3 text-[13px] text-text-muted">{t('credits.ledger.empty.title')}</p>
      ) : (
        <ul className="divide-y divide-line-hairline overflow-hidden rounded-card border border-line-edge bg-ink-surface">
          {rows.map((r) => {
            // journey 16/11 J01-5: a grant says where it comes from (« Crédits de l'essai Pro », « Code promo X »), only the
            // admin's grant is the « Geste commercial »
            const source = grantSource(r);
            const code = source ? (r.detail.split(':')[1] ?? '') : '';
            const own = `billing.credits.action.${r.action}`;
            const key = t.has(own) ? own : actionLabelKey(r.action);
            const label = source ? t(`credits.reason.${source}`, source === 'promo' || source === 'referral' ? { code } : undefined) : key ? t(key) : r.action;
            return (
              <li key={r.id} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[8rem_1fr_minmax(0,14rem)_5rem]" data-testid="recent-ledger-row">
                <Ltr className="ts-label-micro text-text-muted">{formatDateTime(r.at, locale)}</Ltr>
                <span className="truncate text-[13px]">{label}</span>
                <span className="hidden truncate text-end ts-label-micro text-text-muted sm:block" dir="auto">
                  {r.agent?.name ?? ''}
                </span>
                <Ltr className={cn('text-end text-[14px] font-medium tabular-nums', creditsTone(r.credits) === 'success' && 'text-accent-money')}>{signedCredits(r.credits, formatNumber)}</Ltr>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/settings/credits" className="self-end ts-label-meta text-accent-inbound hover:underline">
        {t('billing.credits.seeAll')}
      </Link>
    </div>
  );
}
