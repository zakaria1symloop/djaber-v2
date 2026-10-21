'use client';
// /purchases/[id] — Figma "CAT-11 / GDS-06b — … Purchase & sale detail" (Achat #ACH-0021 — détail; 12 §21 "Purchase
// detail"): pills REÇU · DÛ n, FOURNISSEUR ↗ · invoice, ARTICLES, MONTANTS, MOUVEMENTS ↗, HISTORIQUE, the lines with
// ordered / received / remaining, the payments; header actions from the server descriptors (Réceptionner, Payer le
// solde, Imprimer, Dupliquer, Annuler greyed `PURCHASE_ALREADY_RECEIVED`, Supprimer brouillon seulement).
import { formatDateTime, formatMoney, formatNumber, type AppLocale } from '@djaber/shared';
import { ActionsMenu, Banner, Card, DetailRows, Ltr, SectionLabel, Skeleton } from '@djaber/ui';
import { ArrowUpRight } from 'lucide-react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { useOffline } from '@/features/orders/offline';
import { Link, useRouter } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { useBack } from '@/lib/back';
import { useLocaleCode, useT } from '@/lib/i18n';
import { usePurchase } from './api';
import { ActionButton, usePurchaseActions } from './purchase-dialogs';
import { AdvancedOnly, PaymentPill, PurchaseStatusPill, shortName, useDayLabel } from './ui';

export function PurchasePage({ id }: { id: string }) {
  const t = useT();
  return (
    <AdvancedOnly title={t('nav.purchases')}>
      <PurchaseDetail id={id} />
    </AdvancedOnly>
  );
}

function PurchaseDetail({ id }: { id: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const q = usePurchase(id);
  const offline = useOffline();
  const actions = usePurchaseActions({ onDeleted: () => router.push('/purchases') });
  const day = useDayLabel();
  const back = useBack({ href: '/purchases', label: t('nav.purchases') });
  const p = q.data;
  if (q.isPending)
    return (
      <AppPage title={t('nav.purchases')} back={back} permission="gds.read">
        <Skeleton className="h-80" />
      </AppPage>
    );
  if (q.isError || !p)
    return (
      <AppPage title={t('nav.purchases')} back={back} permission="gds.read">
        <QueryError error={q.error} onRetry={() => q.refetch()} backHref={back.href} />
      </AppPage>
    );
  const receive = actionState(p.actions, 'receive', t);
  const order = actionState(p.actions, 'order', t);
  const pay = actionState(p.actions, 'record_payment', t);
  // offline: the actions this document offers are greyed with the offline reason (absent ones stay absent)
  const off = <A extends { present: boolean }>(a: A) => (offline && a.present ? { ...a, enabled: false, reason: t('banner.offline') } : a);
  const history = [
    t('purchases.page.created', { date: day(p.createdAt.slice(0, 10)) }),
    p.status !== 'draft' && p.status !== 'cancelled' ? t('purchases.page.orderedOn', { date: day(p.purchasedAt.slice(0, 10)) }) : null,
    p.receivedAt ? t('purchases.page.receivedOn', { date: day(p.receivedAt.slice(0, 10)) }) : null,
    ...p.payments.map((x) => t('purchases.page.paidOn', { date: day(x.paidAt.slice(0, 10)), amount: formatMoney(x.amount) })),
    p.cancelledAt ? t('purchases.page.cancelledOn', { date: day(p.cancelledAt.slice(0, 10)) }) : null,
  ].filter(Boolean);
  const pct = p.units.ordered ? Math.round((p.units.received * 100) / p.units.ordered) : 0;
  return (
    <AppPage
      title={t('purchases.page.title', { number: p.number })}
      back={back}
      permission="gds.read"
      badges={
        <span className="flex flex-wrap items-center gap-1.5" data-testid="purchase-pills">
          <PurchaseStatusPill status={p.status} units={p.units} />
          {p.status !== 'draft' && p.status !== 'cancelled' ? <PaymentPill status={p.paymentStatus} remaining={p.remaining} /> : null}
        </span>
      }
      actions={
        <>
          <ActionButton action={off(order)} label={t('purchases.action.order')} onClick={() => actions.menu(p).find((a) => a.key === 'order')?.onSelect?.()} variant="primary" testId="purchase-order" />
          <ActionButton action={off(receive)} label={t('purchases.action.receive')} onClick={() => actions.open({ kind: 'receive', id: p.id, number: p.number })} variant={order.present ? 'secondary' : 'primary'} testId="purchase-receive" />
          {p.remaining > 0 ? <ActionButton action={off(pay)} label={t('purchases.action.paySolde')} onClick={() => actions.open({ kind: 'pay', id: p.id, number: p.number })} testId="purchase-pay" /> : null}
          <ActionsMenu label={t('action.actions')} heading={`#${p.number}`} actions={actions.menu(p)} size="md" />
        </>
      }
    >
      {p.status === 'cancelled' ? <Banner tone="neutral">{t('purchases.page.cancelledBanner', { reason: p.cancelReason ?? '—' })}</Banner> : null}
      {p.late ? <Banner tone="warning">{t('purchases.page.lateBanner', { date: p.expectedAt ? day(p.expectedAt.slice(0, 10)) : '—' })}</Banner> : null}
      <Card className="p-5" data-testid="purchase-detail">
        <DetailRows
          rows={[
            {
              key: 'supplier',
              label: t('purchases.col.supplier'),
              value: p.supplier ? (
                <span>
                  <Link href={`/suppliers?sheet=${p.supplier.id}`} className="inline-flex items-center gap-1 hover:underline">
                    {p.supplier.name}
                    <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
                  </Link>
                  {p.supplierInvoiceRef ? <Ltr>{` · ${p.supplierInvoiceRef}`}</Ltr> : null}
                </span>
              ) : (
                '—'
              ),
            },
            { key: 'items', label: t('purchases.col.items'), value: t('purchases.page.itemsLine', { lines: p.itemCount, units: formatNumber(p.units.ordered), pct, date: p.receivedAt ? day(p.receivedAt.slice(0, 10)) : '—' }) },
            {
              key: 'amounts',
              label: t('purchases.page.amounts'),
              value: <Ltr>{t('purchases.page.amountsLine', { total: formatNumber(p.total), paid: formatNumber(p.amountPaid), method: p.paymentMethod ? t(`orders.payment.method.${p.paymentMethod}`) : '—', remaining: formatNumber(p.remaining) })}</Ltr>,
            },
            {
              key: 'movements',
              label: t('purchases.page.movements'),
              value:
                p.units.received > 0 ? (
                  <Link href={`/movements?refType=purchase&refId=${p.id}`} className="inline-flex items-center gap-1 hover:underline" data-testid="purchase-movements">
                    {t('purchases.page.movementsLine', { count: p.items.filter((i) => i.receivedQty > 0).length })}
                    <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
                  </Link>
                ) : (
                  <span className="text-text-muted">{t('purchases.page.noMovement')}</span>
                ),
            },
            { key: 'history', label: t('purchases.page.history'), value: history.join(' · ') },
            ...(p.notes ? [{ key: 'notes', label: t('common.note'), value: <span className="whitespace-pre-wrap">{p.notes}</span> }] : []),
          ]}
        />
      </Card>

      <section className="flex flex-col gap-2">
        <SectionLabel>{t('purchases.page.lines')}</SectionLabel>
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]" data-testid="purchase-items">
            <thead>
              <tr className="ts-label-micro text-text-muted">
                <th className="px-4 py-2 text-start font-normal">{t('purchases.col.productVariant')}</th>
                <th className="px-4 py-2 text-end font-normal">{t('purchases.receive.ordered')}</th>
                <th className="px-4 py-2 text-end font-normal">{t('purchases.receive.already')}</th>
                <th className="px-4 py-2 text-end font-normal">{t('purchases.col.unitCost')}</th>
                <th className="px-4 py-2 text-end font-normal">{t('purchases.col.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hairline">
              {p.items.map((i) => (
                <tr key={i.id} data-line={i.product.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/products/${i.product.id}`} className="hover:underline">
                      {i.productName}
                      {i.variantName ? <span className="text-text-secondary"> · {i.variantName}</span> : null}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Ltr className="tabular-nums">{formatNumber(i.quantity)}</Ltr>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Ltr className={i.receivedQty >= i.quantity ? 'tabular-nums text-accent-money' : 'tabular-nums'}>{formatNumber(i.receivedQty)}</Ltr>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Ltr className="tabular-nums">{formatMoney(i.unitCost)}</Ltr>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Ltr className="tabular-nums">{formatMoney(i.total)}</Ltr>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line-edge text-text-secondary">
              <tr>
                <td colSpan={4} className="px-4 py-1.5 text-end">{t('common.subtotal')}</td>
                <td className="px-4 py-1.5 text-end"><Ltr className="tabular-nums">{formatMoney(p.subtotal)}</Ltr></td>
              </tr>
              {p.tax ? (
                <tr>
                  <td colSpan={4} className="px-4 py-1.5 text-end">{t('purchases.form.tax')}</td>
                  <td className="px-4 py-1.5 text-end"><Ltr className="tabular-nums">{formatMoney(p.tax)}</Ltr></td>
                </tr>
              ) : null}
              {p.shippingCost ? (
                <tr>
                  <td colSpan={4} className="px-4 py-1.5 text-end">{t('purchases.form.shipping')}</td>
                  <td className="px-4 py-1.5 text-end"><Ltr className="tabular-nums">{formatMoney(p.shippingCost)}</Ltr></td>
                </tr>
              ) : null}
              <tr className="font-semibold text-text-primary">
                <td colSpan={4} className="px-4 py-2 text-end">{t('common.total')}</td>
                <td className="px-4 py-2 text-end"><Ltr className="tabular-nums">{formatMoney(p.total)}</Ltr></td>
              </tr>
            </tfoot>
          </table>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>{t('purchases.page.payments')}</SectionLabel>
        {p.payments.length ? (
          <Card>
            <ul className="divide-y divide-line-hairline" data-testid="purchase-payments">
              {p.payments.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">
                    {[formatDateTime(x.paidAt, locale), t(`orders.payment.method.${x.method}`), x.reference, shortName(x.createdBy)].filter(Boolean).join(' · ')}
                  </span>
                  <Ltr className="font-medium tabular-nums">{formatMoney(x.amount)}</Ltr>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="ts-label-meta text-text-muted">{t('purchases.page.noPayment')}</p>
        )}
      </section>
      <p className="ts-label-micro !normal-case text-text-muted">{t('purchases.page.footnote')}</p>
      {actions.element}
    </AppPage>
  );
}
