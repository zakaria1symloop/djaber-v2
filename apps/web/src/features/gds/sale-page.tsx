'use client';
// /sales/[id] — Figma "CAT-11 / GDS-06b — … Purchase & sale detail" (Vente #VTE-0089 — détail; 12 §21 "Sale detail"):
// pills PARTIELLE · RESTE n, CLIENT ↗ · phone, ARTICLES, PAIEMENTS, MOUVEMENTS ↗, VENDEUR; header actions from the
// server descriptors (Encaisser le reste, Ticket PDF, Lier à un client, Annuler ≤ 7 j); no edit after validation
// (`SALE_IMMUTABLE`: cancel + redo).
import { formatDateTime, formatMoney, formatNumber, formatPhoneDz, type AppLocale } from '@djaber/shared';
import { ActionsMenu, Banner, Card, DetailRows, Ltr, SectionLabel, Skeleton } from '@djaber/ui';
import { ArrowUpRight } from 'lucide-react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { withoutYear } from '@/features/catalog/stock/logic';
import { useOffline } from '@/features/orders/offline';
import { Link, useRouter } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { useBack } from '@/lib/back';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSale } from './api';
import { ActionButton } from './purchase-dialogs';
import { useSaleActions } from './sale-dialogs';
import { AdvancedOnly, PaymentPill, SaleStatusPill, shortName, useDayLabel } from './ui';

export function SalePage({ id }: { id: string }) {
  const t = useT();
  return (
    <AdvancedOnly title={t('sales.title')}>
      <SaleDetail id={id} />
    </AdvancedOnly>
  );
}

function SaleDetail({ id }: { id: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const q = useSale(id);
  const offline = useOffline();
  const actions = useSaleActions({ onDeleted: () => router.push('/sales'), onEditDraft: (x) => router.push(`/sales/new?draft=${x}`) });
  const day = useDayLabel();
  const back = useBack({ href: '/sales', label: t('sales.title') });
  const s = q.data;
  if (q.isPending)
    return (
      <AppPage title={t('sales.title')} back={back} permission="gds.read">
        <Skeleton className="h-80" />
      </AppPage>
    );
  if (q.isError || !s)
    return (
      <AppPage title={t('sales.title')} back={back} permission="gds.read">
        <QueryError error={q.error} onRetry={() => q.refetch()} backHref={back.href} />
      </AppPage>
    );
  // offline: the actions this document offers are greyed with the offline reason (absent ones stay absent)
  const off = <A extends { present: boolean }>(a: A) => (offline && a.present ? { ...a, enabled: false, reason: t('banner.offline') } : a);
  const collect = actionState(s.actions, 'collect', t);
  const link = actionState(s.actions, 'link_client', t);
  const units = s.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <AppPage
      title={t('sales.page.title', { number: s.number })}
      back={back}
      permission="gds.read"
      badges={
        <span className="flex items-center gap-1.5" data-testid="sale-pills">
          {s.status === 'completed' ? <PaymentPill status={s.paymentStatus} kind="sale" remaining={s.remaining} /> : <SaleStatusPill status={s.status} paymentStatus={s.paymentStatus} />}
        </span>
      }
      actions={
        <>
          <ActionButton action={off(collect)} label={t('sales.action.collect')} onClick={() => actions.open({ kind: 'collect', id: s.id, number: s.number })} variant="primary" testId="sale-collect" />
          <ActionButton action={off(link)} label={t('sales.action.linkClient')} onClick={() => actions.open({ kind: 'link', id: s.id, number: s.number })} testId="sale-link" />
          <ActionsMenu label={t('action.actions')} heading={`#${s.number}`} actions={actions.menu(s)} size="md" />
        </>
      }
    >
      {s.status === 'cancelled' ? (
        <Banner tone="neutral">
          {t('sales.page.cancelledBanner', { date: s.cancelledAt ? day(s.cancelledAt.slice(0, 10)) : '—', reason: s.cancelReason ?? '—', stock: s.stockRestored ? t('sales.page.stockRestored') : t('sales.page.stockKept') })}
        </Banner>
      ) : null}
      {s.status === 'draft' ? <Banner tone="info">{t('sales.page.draftBanner')}</Banner> : null}
      <Card className="p-5" data-testid="sale-detail">
        <DetailRows
          rows={[
            {
              key: 'client',
              label: t('common.client'),
              value: s.client ? (
                <span>
                  <Link href={`/clients?sheet=${s.client.id}`} className="inline-flex items-center gap-1 hover:underline">
                    {s.client.name}
                    <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
                  </Link>
                  {s.client.phone ? <Ltr>{` · ${formatPhoneDz(s.client.phone)}`}</Ltr> : null}
                </span>
              ) : (
                <span className="text-text-secondary">{[s.customerName ?? t('sales.walkIn'), s.customerPhone ? formatPhoneDz(s.customerPhone) : null].filter(Boolean).join(' · ')}</span>
              ),
            },
            { key: 'items', label: t('common.items'), value: [s.items.map((i) => `${i.productName}${i.variantName ? ` ${i.variantName}` : ''} ×${i.quantity}`).join(' · '), s.discount ? `${t('common.discount').toLowerCase()} ${formatMoney(s.discount)}` : null].filter(Boolean).join(' · ') },
            {
              key: 'payments',
              label: t('sales.page.payments'),
              value: (
                <Ltr>
                  {[...s.payments.map((p) => `${formatMoney(p.amount)} ${t(`orders.payment.method.${p.method}`).toLowerCase()} (${withoutYear(formatDateTime(p.paidAt, locale))})`), s.remaining > 0 ? t('sales.page.remaining', { amount: formatMoney(s.remaining) }) : null]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </Ltr>
              ),
            },
            {
              key: 'movements',
              label: t('purchases.page.movements'),
              value:
                s.status === 'completed' || (s.status === 'cancelled' && s.stockRestored !== null) ? (
                  <Link href={`/movements?refType=sale&refId=${s.id}`} className="inline-flex items-center gap-1 hover:underline" data-testid="sale-movements">
                    {t('sales.page.movementsLine', { count: s.items.length })}
                    <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
                  </Link>
                ) : (
                  <span className="text-text-muted">{t('purchases.page.noMovement')}</span>
                ),
            },
            { key: 'seller', label: t('sales.col.seller'), value: `${shortName(s.seller) ?? '—'} · ${t('sales.page.counter')}` },
            ...(s.notes ? [{ key: 'notes', label: t('common.note'), value: <span className="whitespace-pre-wrap">{s.notes}</span> }] : []),
          ]}
        />
      </Card>

      <section className="flex flex-col gap-2">
        <SectionLabel>{t('purchases.page.lines')}</SectionLabel>
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]" data-testid="sale-items">
            <thead>
              <tr className="ts-label-micro text-text-muted">
                <th className="px-4 py-2 text-start font-normal">{t('purchases.col.productVariant')}</th>
                <th className="px-4 py-2 text-end font-normal">{t('common.quantity')}</th>
                <th className="px-4 py-2 text-end font-normal">{t('common.price')}</th>
                <th className="px-4 py-2 text-end font-normal">{t('common.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hairline">
              {s.items.map((i) => (
                <tr key={i.id} data-line={i.product.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/products/${i.product.id}`} className="hover:underline">
                      {i.productName}
                      {i.variantName ? <span className="text-text-secondary"> · {i.variantName}</span> : null}
                    </Link>
                    {i.catalogPrice !== null && i.catalogPrice !== i.unitPrice ? <div className="ts-label-micro text-accent-starred">{t('sales.form.priceEdited', { from: formatNumber(i.catalogPrice), to: formatNumber(i.unitPrice) })}</div> : null}
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Ltr className="tabular-nums">{formatNumber(i.quantity)}</Ltr>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Ltr className="tabular-nums">{formatMoney(i.unitPrice)}</Ltr>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Ltr className="tabular-nums">{formatMoney(i.total)}</Ltr>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line-edge text-text-secondary">
              <tr>
                <td colSpan={3} className="px-4 py-1.5 text-end">{t('common.subtotal')}</td>
                <td className="px-4 py-1.5 text-end"><Ltr className="tabular-nums">{formatMoney(s.subtotal)}</Ltr></td>
              </tr>
              {s.discount ? (
                <tr>
                  <td colSpan={3} className="px-4 py-1.5 text-end">{t('common.discount')}</td>
                  <td className="px-4 py-1.5 text-end"><Ltr className="tabular-nums">{`−${formatMoney(s.discount)}`}</Ltr></td>
                </tr>
              ) : null}
              <tr className="font-semibold text-text-primary">
                <td colSpan={3} className="px-4 py-2 text-end">{t('common.total')} · <Ltr>{t('gds.units', { count: units })}</Ltr></td>
                <td className="px-4 py-2 text-end"><Ltr className="tabular-nums">{formatMoney(s.total)}</Ltr></td>
              </tr>
            </tfoot>
          </table>
        </Card>
      </section>
      <p className="ts-label-micro !normal-case text-text-muted">{t('sales.page.footnote', { date: day(s.cancellableUntil.slice(0, 10)) })}</p>
      {actions.element}
    </AppPage>
  );
}
