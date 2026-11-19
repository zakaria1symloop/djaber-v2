'use client';
// Display pieces of the order screens: the pills of Order / Shipment (colours from the `StatusPill` map, labels from
// `enum.*`), the SOURCE cell, the client cell and the risk pill.
import { confirmationShown, formatDate, formatPhoneDz, orderRiskPill, type AppLocale } from '@djaber/shared';
import { Ltr, SourceTag, StatusPill } from '@djaber/ui';
import { useLocaleCode, useT } from '@/lib/i18n';
import type { CallResult, ClientRef, OrderListItem, OrderStatus, PaymentStatus, SourceBadge } from './contracts';
import { confirmationPillParams, courierShort, deliveryPill, shortName, sourceDetail } from './logic';

const PILL = '!rounded-[4px] whitespace-nowrap';

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const t = useT();
  return (
    <StatusPill enumKey="Order.status" value={status} className={PILL}>
      {t(`enum.Order.status.${status}`)}
    </StatusPill>
  );
}

/** journey J05v-3: « — » for a call state that no longer applies (« À APPELER » on a cancelled order — shared `confirmationShown`). */
export function ConfirmationPill({ row }: { row: Pick<OrderListItem, 'status' | 'confirmationStatus' | 'callAttempts' | 'callbackAt'> }) {
  const t = useT();
  if (!confirmationShown(row)) return <span className="text-text-muted">—</span>;
  const { key, params } = confirmationPillParams(row);
  return (
    <StatusPill enumKey="Order.confirmationStatus" value={row.confirmationStatus} className={PILL}>
      {t(key, params)}
    </StatusPill>
  );
}

export function PaymentPill({ status }: { status: PaymentStatus }) {
  const t = useT();
  return (
    <StatusPill enumKey="Order.paymentStatus" value={status} className={PILL}>
      {t(`enum.Order.paymentStatus.${status}`)}
    </StatusPill>
  );
}

export function DeliveryPill({ row }: { row: Pick<OrderListItem, 'deliveryStatus' | 'shipment' | 'status'> }) {
  const t = useT();
  const p = deliveryPill(row);
  const label = t.has(p.labelKey) ? t(p.labelKey) : p.value;
  return (
    <StatusPill enumKey={p.enumKey} value={p.value} className={PILL}>
      {p.provider ? `${label} · ${courierShort(p.provider)}` : label}
    </StatusPill>
  );
}

export function CallResultPill({ result }: { result: CallResult }) {
  const t = useT();
  return (
    <StatusPill enumKey="Order.callResult" value={result} className={PILL}>
      {t(`orders.call.result.${result}`)}
    </StatusPill>
  );
}

/** RISQUE for a high-risk client, FIABLE by the client list's rule (≥ 1 delivered order, no return — journey J09-9), nothing otherwise. */
/** `risk` = the order's snapshot (`Order.riskLevel` at creation); the client's current level wins when it is high (e.g. a later "faux numéro"). */
/** One rule with the orders export (shared `orderRiskPill`, journey J05v-2). */
export function RiskPill({ client, risk }: { client: Pick<ClientRef, 'orderCount' | 'blocked' | 'riskLevel' | 'reliable'>; risk: 'normal' | 'high' }) {
  const t = useT();
  const pill = orderRiskPill({ blocked: client.blocked, orderRisk: risk, clientRisk: client.riskLevel, reliable: !!client.reliable });
  if (pill === 'blocked')
    return (
      <StatusPill enumKey="Client.riskLevel" value="high" className={PILL}>
        {t('enum.Client.blocked')}
      </StatusPill>
    );
  if (pill === 'risk')
    return (
      <StatusPill enumKey="Client.riskLevel" value="high" className={PILL}>
        {t('enum.Client.riskLevel.high')}
      </StatusPill>
    );
  if (pill === 'reliable')
    return (
      <StatusPill enumKey="Client.riskLevel" value="normal" className={PILL}>
        {t('enum.Client.riskLevel.normal')}
      </StatusPill>
    );
  return <span className="text-text-muted">—</span>;
}

export function SourceCell({ source }: { source: SourceBadge }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const detail = sourceDetail(source, {
    member: (u) => shortName(u),
    platform: (p) => t(`orders.source.platform.${p}`),
    date: (iso) => formatDate(iso, locale),
  });
  return <SourceTag source={source.source} label={t(`enum.Order.source.${source.source}`)} detail={detail} />;
}

/** Name + "0555 12 34 56 · 3 cmd" (or "nouveau"); the name opens the client sheet. */
export function ClientCell({ client, onOpen }: { client: ClientRef; onOpen?: () => void }) {
  const t = useT();
  const sub = client.orderCount <= 1 ? t('common.new') : t('common.ordersCount', { count: client.orderCount });
  return (
    <div className="min-w-0">
      {onOpen ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="block max-w-full truncate text-start text-[14px] font-medium hover:underline"
        >
          {client.name}
        </button>
      ) : (
        <span className="block truncate text-[14px] font-medium">{client.name}</span>
      )}
      <div className="ts-label-micro truncate text-text-muted">
        {client.phone ? <Ltr>{formatPhoneDz(client.phone)}</Ltr> : '—'} · {sub}
      </div>
    </div>
  );
}
