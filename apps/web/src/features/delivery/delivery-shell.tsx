'use client';
// DeliveryTabs (02-next-route-map §1 `delivery/layout.tsx`): Vue d'ensemble · Grille des frais · Transporteurs, and the
// header action of the overview (Figma DLV-08 "Envoyer les confirmées (12)": bulk send of the confirmed orders without
// parcel). The couriers tab needs `delivery.manage` (hidden otherwise; the page answers 403 on a direct link).
import { formatNumber } from '@djaber/shared';
import { Button, cn, toast } from '@djaber/ui';
import { useState, type ReactNode } from 'react';
import { AppPage } from '@/components/app-page';
import { refusal } from '@/features/orders/dialogs/common';
import { useOffline } from '@/features/orders/offline';
import { Link, usePathname } from '@/i18n/navigation';
import { actionState, forbiddenReason } from '@/lib/actions';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { SHIPMENT_ACTION } from './action-keys';
import { deliveryApi, useDeliveryOverview } from './api';
import { BulkSendDialog, type SendTarget } from './bulk-send';
import { docRef } from '@/lib/format-message';

type Tab = { key: 'overview' | 'fees' | 'couriers'; href: string; label: string; hidden?: boolean };

/** "Envoyer les confirmées (n)": the "À envoyer" rows (≤ 100) go to the bulk send dialog. */
function SendConfirmed() {
  const t = useT();
  const overview = useDeliveryOverview();
  const [targets, setTargets] = useState<SendTarget[] | null>(null);
  const [busy, setBusy] = useState(false);
  const n = overview.data?.kpis.toSend ?? 0;
  const offline = useOffline();
  const open = async () => {
    setBusy(true);
    try {
      const page = await deliveryApi.shipments({ shipmentStatus: ['not_sent'], pageSize: 100 });
      setTargets(
        page.rows.map((r) => {
          const a = actionState(r.actions, SHIPMENT_ACTION.send, t);
          return { id: r.orderId, number: r.orderNumber, label: `${docRef(t, r.orderNumber)} · ${r.client.name}${r.wilaya ? ` · ${r.wilaya.name}` : ''}`, blocked: a.present && a.enabled ? null : (a.reason ?? forbiddenReason(t)) };
        }),
      );
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="primary" onClick={() => void open()} loading={busy} disabledReason={offline ? t('banner.offline') : overview.data && n === 0 ? t('delivery.sendConfirmed.none') : undefined} data-testid="send-confirmed">
        {t('delivery.sendConfirmed', { count: formatNumber(n) })}
      </Button>
      <BulkSendDialog open={!!targets} orders={targets ?? []} onClose={() => setTargets(null)} />
    </>
  );
}

export function DeliveryShell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const { can } = useSession();
  const tabs: Tab[] = [
    { key: 'overview', href: '/delivery', label: t('nav.delivery.overview') },
    { key: 'fees', href: '/delivery/fees', label: t('nav.delivery.fees') },
    { key: 'couriers', href: '/delivery/couriers', label: t('nav.delivery.couriers'), hidden: !can('delivery.manage') },
  ];
  const current = tabs.find((x) => x.href !== '/delivery' && pathname.startsWith(x.href))?.key ?? 'overview';
  return (
    <AppPage
      wide
      eyebrow={t('nav.delivery')}
      title={t(`delivery.title.${current}`)}
      description={t(`delivery.description.${current}`)}
      permission="delivery.send"
      actions={current === 'overview' && can('delivery.send') ? <SendConfirmed /> : undefined}
    >
      <nav aria-label={t('delivery.tabs')} className="flex flex-wrap gap-1.5">
        {tabs
          .filter((x) => !x.hidden)
          .map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              prefetch
              aria-current={tab.key === current ? 'page' : undefined}
              data-tab={tab.key}
              className={cn(
                'flex h-8 items-center rounded-card border px-3 text-[13px] transition-colors',
                tab.key === current ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary',
              )}
            >
              {tab.label}
            </Link>
          ))}
      </nav>
      {children}
    </AppPage>
  );
}
