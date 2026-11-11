'use client';
// /orders/[id]/print — "Bon de commande A5 (ORD-09)" of Figma "DLV-06 / ORD-09 — Labels viewer (…) + order print
// preview A5": HTML slip printed with `@page { size: A5 }` (two copies on one A4 with "2 par page"), options with /
// without prices and the slip language; the server PDF (`GET /orders/:id/print` → signed URL) is the secondary action.
import { formatDateTime, formatMoney, formatPhoneDz, getMessages, isRtl, type AppLocale } from '@djaber/shared';
import { A5OrderSlip, Button, Card, Checkbox, Field, FormAlert, Select, Skeleton, toast, type A5SlipProps } from '@djaber/ui';
import { Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { formatMessage, useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl } from '@/lib/jobs';
import { useSession } from '@/lib/session';
import { ordersApi, useOrder } from '../api';
import type { Order } from '../contracts';
import { refusal } from '../dialogs/common';

type Lang = AppLocale;

type Shop = { name: string; logoUrl?: string | null; phone?: string | null; address?: string | null };

/**
 * UX-049 (10/11): wilaya, commune (left out when it only repeats the wilaya's name), then « Point relais : <name> » or
 * « Domicile : <address> » — each written once.
 */
export function slipAddress(a: Order['address'], tr: (key: string, params?: Record<string, string | number>) => string): string {
  if (!a) return '—';
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  const commune = a.communeText && fold(a.communeText) !== fold(a.wilayaName) ? a.communeText : null;
  const where = a.isStopdesk ? tr('orders.print.relay', { name: a.stopdeskName ?? '—' }) : a.address ? tr('orders.print.homeAt', { address: a.address }) : tr('orders.print.home');
  return [a.wilayaName, commune, where].filter(Boolean).join(' · ');
}

/** Slip content in the chosen language (labels from the catalogue of that language, numbers always Latin). */
export function slipProps(o: Order, shop: string | Shop, lang: Lang, withPrices: boolean): A5SlipProps {
  const m = getMessages(lang);
  const tr = (key: string, params?: Record<string, string | number>) => formatMessage(lang, m, key, params);
  const s: Shop = typeof shop === 'string' ? { name: shop } : shop;
  const address = slipAddress(o.address, tr);
  const phone = [formatPhoneDz(o.clientPhone), o.clientPhone2 ? formatPhoneDz(o.clientPhone2) : null].filter(Boolean).join(' / ');
  const tracking = o.shipments[0]?.publicTrackingUrl;
  return {
    shop: s.name,
    shopLogoUrl: s.logoUrl ?? null,
    shopPhone: s.phone ? formatPhoneDz(s.phone) : null,
    shopAddress: s.address ?? null,
    heading: tr('orders.print.heading', { number: o.number, date: formatDateTime(o.orderedAt, lang) }),
    client: tr('orders.print.client', { name: o.clientName, phone }),
    address,
    lines: o.items.map((i) => ({ key: i.id, label: `${i.productName}${i.variantName ? ` · ${i.variantName}` : ''} ×${i.quantity}`, amount: withPrices ? formatMoney(i.total) : undefined })),
    extra: withPrices
      ? [
          ...(o.discount ? [{ key: 'discount', label: tr('common.discount'), amount: `− ${formatMoney(o.discount)}` }] : []),
          { key: 'delivery', label: tr('orders.print.delivery'), amount: formatMoney(o.deliveryFee) },
          ...(o.amountPaid ? [{ key: 'paid', label: tr('common.paid'), amount: `− ${formatMoney(o.amountPaid)}` }] : []),
        ]
      : [],
    total: withPrices ? { label: tr('orders.print.total'), amount: formatMoney(o.remaining) } : undefined,
    footer: [tr(o.paymentMethod === 'cash' ? 'orders.print.cod' : 'orders.print.paidBy', { method: tr(`orders.payment.methodLong.${o.paymentMethod}`) }), tracking ? tr('orders.print.thanksTracking', { url: tracking.replace(/^https?:\/\//, '') }) : tr('orders.print.thanks'), ...(o.notes ? [o.notes] : [])],
    dir: isRtl(lang) ? 'rtl' : 'ltr',
    lang,
  };
}

export function OrderPrintPage({ id }: { id: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { workspace } = useSession();
  const q = useOrder(id);
  const [withPrices, setWithPrices] = useState(true);
  const [twoPerPage, setTwoPerPage] = useState(false);
  const [lang, setLang] = useState<Lang>(locale);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const shop = useMemo<Shop>(() => ({ name: workspace?.name ?? '', logoUrl: workspace?.logoUrl, phone: workspace?.phone, address: workspace?.address }), [workspace?.name, workspace?.logoUrl, workspace?.phone, workspace?.address]);
  const props = useMemo(() => (q.data ? slipProps(q.data, shop, lang, withPrices) : null), [q.data, shop, lang, withPrices]);

  const pdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const { url } = await ordersApi.printUrl(id, { withPrices, twoPerPage, lang });
      downloadUrl(url);
    } catch (e) {
      setPdfError(refusal(e, t));
      toast({ tone: 'danger', message: refusal(e, t) });
    } finally {
      setPdfBusy(false);
    }
  };

  const title = q.data ? t('orders.print.title1', { number: q.data.number }) : t('orders.print.pageTitle');
  return (
    <AppPage permission="orders.read" back={{ href: `/orders/${id}`, label: q.data ? `#${q.data.number}` : t('nav.orders') }} title={title} description={t('orders.print.description')}>
      <style>{`@media print {
  @page { size: ${twoPerPage ? 'A4 portrait' : 'A5 portrait'}; margin: 0; }
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 0; background: #fff; }
  .print-area .a5-slip { width: 148mm; min-height: ${twoPerPage ? '148mm' : '210mm'}; box-shadow: none; border: 0; }
}`}</style>
      {q.isPending ? (
        <Skeleton className="h-[520px] w-full max-w-[420px]" />
      ) : q.isError || !q.data || !props ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} backHref={`/${locale}/orders`} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="print-area flex flex-col items-center gap-4 rounded-card border border-line-edge bg-ink-raised p-6" data-testid="print-preview">
            <A5OrderSlip {...props} className="w-full max-w-[420px] shadow-xl" />
            {twoPerPage ? <A5OrderSlip {...props} className="w-full max-w-[420px] shadow-xl" /> : null}
          </div>
          <Card className="flex h-fit flex-col gap-4 p-4">
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={withPrices} onChange={(e) => setWithPrices(e.target.checked)} />
              {t('orders.print.withPrices')}
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={twoPerPage} onChange={(e) => setTwoPerPage(e.target.checked)} />
              {t('orders.print.twoPerPage')}
            </label>
            <Field label={t('orders.print.lang')} htmlFor="slip-lang">
              <Select id="slip-lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                <option value="fr">Français</option>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Button variant="primary" onClick={() => window.print()} data-testid="print-now">
              <Printer className="size-4" aria-hidden />
              {t('action.print')}
            </Button>
            <Button onClick={() => void pdf()} loading={pdfBusy} data-testid="print-pdf">
              {t('orders.print.pdf')}
            </Button>
            {pdfError ? <FormAlert>{pdfError}</FormAlert> : null}
            <p className="ts-label-micro !normal-case text-text-muted">{t('orders.print.options')}</p>
          </Card>
        </div>
      )}
    </AppPage>
  );
}
