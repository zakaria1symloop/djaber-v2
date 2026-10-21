'use client';
// Client detail — Figma "CLI-03 — Clients — list with detail sheet": side sheet over the list (`?sheet=<id>`, ‹ › rows)
// and the same body on the full page `/clients/[id]`. Metrics tiles, merged / placeholder / blocked notices, contact,
// default address, channels, recent orders, counter sales ("DA dépensés" counts them too — tester report 2026-10-19
// UX-003), conversations, "Nouvelle commande pour {prénom}".
import { formatDate, formatMoney, formatNumber, formatPhoneDz, type AppLocale } from '@djaber/shared';
import { ActionsMenu, Banner, Button, buttonClass, MetricTile, SheetSection, SideSheet, Skeleton, StatusPill, TagChips, type MenuAction } from '@djaber/ui';
import { Ltr } from '@djaber/ui';
import type { ReactNode } from 'react';
import { QueryError } from '@/components/global-states';
import { SaleStatusPill } from '@/features/gds/ui';
import { Link } from '@/i18n/navigation';
import { useHere, withBack } from '@/lib/back';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { useClient } from './api';
import type { Client } from './contracts';
import { clientPill, firstName } from './spec';
import { ClientPillView } from './ui';

const monthYear = (iso: string, locale: AppLocale) => {
  const parts = formatDate(iso, locale).split(' ');
  return parts.slice(1, 2).join(' ');
};

export function ClientDetailBody({ client: c }: { client: Client }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { can } = useSession();
  const here = useHere();
  const address = c.addresses.find((a) => a.isDefault) ?? c.addresses[0] ?? null;
  const merged = c.mergedFrom[0];
  const addressText = address
    ? [`${address.wilayaName} (${address.wilayaId})`, address.communeText, address.address, address.isStopdesk ? (address.stopdeskName ?? t('common.stopdesk')) : t('clients.sheet.atHome')].filter(Boolean).join(' · ')
    : null;
  return (
    <div className="flex flex-col gap-5" data-testid="client-detail">
      {clientPill(c) && clientPill(c) !== 'unknown' ? (
        <div className="flex flex-wrap items-center gap-2">
          <ClientPillView client={c} />
          {c.block?.source === 'platform' ? <span className="ts-label-meta text-text-muted">{t('error.CUSTOMER_BLOCKED_BY_PLATFORM')}</span> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <MetricTile label={t('clients.sheet.orders')} value={formatNumber(c.metrics.orders)} data-metric="orders" />
        <MetricTile label={t('clients.sheet.spent')} value={formatNumber(c.metrics.spent)} data-metric="spent" />
        <MetricTile label={t('clients.sheet.returns')} value={`${formatNumber(c.metrics.returnPct)} %`} tone={c.metrics.returns > 0 ? 'warning' : undefined} data-metric="returns" />
      </div>
      {c.metrics.sales > 0 ? (
        <p className="-mt-3 ts-label-meta text-text-muted" data-testid="client-spent-split">
          {t('clients.sheet.spentSplit', { orders: formatMoney(c.metrics.ordersSpent), sales: formatMoney(c.metrics.salesSpent) })}
        </p>
      ) : null}

      {merged ? <Banner tone="info">{t('clients.sheet.merged', { date: formatDate(merged.at, locale), name: merged.name })}</Banner> : null}
      {c.isPlaceholder ? <Banner tone="warning">{t('clients.sheet.placeholder')}</Banner> : null}
      {c.block ? <Banner tone="danger">{t('clients.sheet.blocked', { date: formatDate(c.block.blockedAt, locale) })}</Banner> : null}
      {c.archived ? <Banner tone="neutral">{t('clients.sheet.archived')}</Banner> : null}

      <SheetSection label={t('clients.sheet.contact')}>
        <dl className="flex flex-col gap-3 text-[14px]">
          <div>
            <dt className="ts-label-micro text-text-muted">{t('common.phone')}</dt>
            <dd>{c.phone ? <span><Ltr className="tabular-nums">{formatPhoneDz(c.phone)}</Ltr> {t('clients.sheet.normalised')}</span> : <span className="text-text-muted">{t('clients.noPhone')}</span>}</dd>
            {c.phone2 ? <dd className="ts-label-meta text-text-muted"><Ltr>{formatPhoneDz(c.phone2)}</Ltr></dd> : null}
          </div>
          <div>
            <dt className="ts-label-micro text-text-muted">{t('common.email')}</dt>
            <dd>{c.email ? <Ltr className="break-all">{c.email}</Ltr> : '—'}</dd>
          </div>
          <div>
            <dt className="ts-label-micro text-text-muted">{t('clients.sheet.defaultAddress')}</dt>
            <dd>{addressText ?? <span className="text-text-muted">{t('clients.sheet.noAddress')}</span>}</dd>
          </div>
          <div>
            <dt className="ts-label-micro text-text-muted">{t('clients.sheet.channels')}</dt>
            <dd>{c.channels.length ? c.channels.map((ch) => `${t(`clients.channel.${ch.platform}`)} · ${ch.name}`).join(', ') : '—'}</dd>
          </div>
          {c.tags.length ? (
            <div>
              <dt className="ts-label-micro text-text-muted">{t('common.tags')}</dt>
              <dd className="mt-1">
                <TagChips tags={c.tags} max={8} />
              </dd>
            </div>
          ) : null}
          {c.notes ? (
            <div>
              <dt className="ts-label-micro text-text-muted">{t('clients.dialog.notes')}</dt>
              <dd className="whitespace-pre-wrap text-text-secondary">{c.notes}</dd>
            </div>
          ) : null}
        </dl>
      </SheetSection>

      <SheetSection label={t('clients.sheet.ordersTitle')} note={c.metrics.orders > c.recentOrders.length ? <Link href={`/orders?clientId=${c.id}`} className="hover:text-text-primary">{t('clients.sheet.allOrders', { count: c.metrics.orders })}</Link> : undefined}>
        {c.recentOrders.length ? (
          <ul className="flex flex-col gap-2" data-testid="client-orders">
            {c.recentOrders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center gap-3 text-[14px] hover:text-text-primary">
                  <span className="min-w-0 flex-1 truncate">
                    <Ltr>#{o.number}</Ltr> · {formatDate(o.orderedAt, locale).split(' ').slice(0, 2).join(' ')}
                  </span>
                  <Ltr className="whitespace-nowrap font-medium tabular-nums">{formatMoney(o.total)}</Ltr>
                  <StatusPill enumKey="Order.status" value={o.status} className="!rounded-[4px]">
                    {t(`enum.Order.status.${o.status}`)}
                  </StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ts-label-meta text-text-muted">{t('clients.sheet.noOrders')}</p>
        )}
      </SheetSection>

      {c.recentSales.length ? (
        <SheetSection label={t('clients.sheet.salesTitle')} note={c.metrics.sales > c.recentSales.length && can('gds.read') ? <Link href={`/sales?clientId=${c.id}`} className="hover:text-text-primary">{t('clients.sheet.allSales', { count: c.metrics.sales })}</Link> : undefined}>
          <ul className="flex flex-col gap-2" data-testid="client-sales">
            {c.recentSales.map((x) => {
              const line = (
                <>
                  <span className="min-w-0 flex-1 truncate">
                    <Ltr>#{x.number}</Ltr> · {formatDate(x.soldAt, locale).split(' ').slice(0, 2).join(' ')}
                  </span>
                  <Ltr className={`whitespace-nowrap font-medium tabular-nums ${x.status === 'cancelled' ? 'text-text-muted line-through' : ''}`}>{formatMoney(x.total)}</Ltr>
                  <SaleStatusPill status={x.status} paymentStatus={x.paymentStatus} />
                </>
              );
              return (
                <li key={x.id}>
                  {can('gds.read') ? (
                    <Link href={withBack(`/sales/${x.id}`, here)} className="flex items-center gap-3 text-[14px] hover:text-text-primary">
                      {line}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-3 text-[14px]">{line}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </SheetSection>
      ) : null}

      <SheetSection label={t('clients.sheet.conversations')}>
        {c.conversations.length ? (
          <ul className="flex flex-col gap-2">
            {c.conversations.map((cv) => (
              <li key={cv.id} className="flex items-center gap-3 text-[14px]">
                <span className="min-w-0 flex-1 truncate">
                  {[cv.channel.name, relativeTime(cv.lastMessageAt, locale), t.has(`enum.Conversation.status.${cv.status}`) ? t(`enum.Conversation.status.${cv.status}`).toLowerCase() : null].filter(Boolean).join(' · ')}
                </span>
                <Link href={`/inbox/${cv.id}`} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                  {t('action.open')}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ts-label-meta text-text-muted">{t('clients.sheet.noConversations')}</p>
        )}
      </SheetSection>
    </div>
  );
}

export const clientSubtitle = (t: ReturnType<typeof useT>, c: Client, locale: AppLocale) => [t('clients.sheet.since', { month: monthYear(c.createdAt, locale) }), t('clients.sheet.source', { source: t(`clients.source.${c.source}`) })].join(' · ');

/** Footer CTA "Nouvelle commande pour Amina". */
export function NewOrderCta({ client, canOrder }: { client: Client; canOrder: boolean }) {
  const t = useT();
  if (!canOrder) return null;
  return (
    <Link href={`/orders/new?clientId=${client.id}`} className={buttonClass({ variant: 'primary', className: 'w-full' })} data-testid="client-new-order">
      {t('clients.sheet.newOrder', { name: firstName(client.name) })}
    </Link>
  );
}

export function ClientSheet({
  clientId,
  onClose,
  onPrev,
  onNext,
  position,
  menu,
  onEdit,
  canEdit,
  canOrder,
}: {
  clientId: string | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: string;
  menu: (c: Client) => MenuAction[];
  onEdit: (c: Client) => void;
  canEdit: boolean;
  canOrder: boolean;
}) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const q = useClient(clientId);
  const c = q.data;
  let body: ReactNode;
  if (q.isPending) body = <Skeleton className="h-64" />;
  else if (q.isError) body = <QueryError error={q.error} onRetry={() => q.refetch()} />;
  else body = c ? <ClientDetailBody client={c} /> : null;
  return (
    <SideSheet
      open={!!clientId}
      onClose={onClose}
      title={c?.name ?? t('nav.clients')}
      subtitle={c ? clientSubtitle(t, c, locale) : undefined}
      headerAction={
        c ? (
          <div className="flex items-center gap-1.5">
            {canEdit ? (
              <Button size="sm" onClick={() => onEdit(c)} data-testid="client-edit">
                {c.isPlaceholder ? t('clients.action.complete') : t('action.edit')}
              </Button>
            ) : null}
            <ActionsMenu label={t('action.actions')} heading={`${c.name}${c.phone ? ` · ${formatPhoneDz(c.phone)}` : ''}`} actions={menu(c)} iconOnly />
          </div>
        ) : undefined
      }
      nav={{ onPrev, onNext, position, prevLabel: t('clients.sheet.prev'), nextLabel: t('clients.sheet.next') }}
      footer={c ? <NewOrderCta client={c} canOrder={canOrder} /> : undefined}
      width={440}
      closeLabel={t('action.close')}
    >
      {body}
    </SideSheet>
  );
}
