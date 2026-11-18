'use client';
// /clients/[id] — direct load of a client (deep links, notifications): the body of the CLI-03 side sheet as a page.
import type { AppLocale } from '@djaber/shared';
import { ActionsMenu, Button, Skeleton } from '@djaber/ui';
import { use, useEffect } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { useClient } from '@/features/clients/api';
import { ClientDetailBody, clientSubtitle, NewOrderCta } from '@/features/clients/client-sheet';
import { ClientPillView } from '@/features/clients/ui';
import { useClientActions } from '@/features/clients/use-client-actions';
import { useRouter } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const { can } = useSession();
  const q = useClient(id);
  const c = q.data;
  const actions = useClientActions({ openSheet: (next) => (next !== id ? router.push(`/clients/${next}`) : void q.refetch()), afterDelete: () => router.push('/clients') });
  const back = { href: '/clients', label: t('nav.clients') };
  // journey J09r-1: the URL of a card merged into another one opens the kept card (its figures moved there)
  const keptId = c?.mergedIntoId ?? null;
  useEffect(() => {
    if (keptId) router.replace(`/clients/${keptId}`);
  }, [keptId, router]);
  const live = c && !c.mergedIntoId ? c : null;
  return (
    <AppPage
      title={c?.name ?? t('nav.clients')}
      back={back}
      permission="clients.read"
      badges={live ? <ClientPillView client={live} /> : undefined}
      description={live ? clientSubtitle(t, live, locale) : undefined}
      actions={
        live ? (
          <>
            {can('clients.write') ? <Button onClick={() => actions.edit(live)}>{live.isPlaceholder ? t('clients.action.complete') : t('action.edit')}</Button> : null}
            <ActionsMenu label={t('action.actions')} actions={actions.menu(live, { sheet: true })} size="md" />
          </>
        ) : undefined
      }
    >
      {q.isPending ? (
        <Skeleton className="h-80" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} backHref={`/${locale}/clients`} />
      ) : c ? (
        <div className="flex w-full flex-col gap-5">
          {/* journey J09r-2: the pill is in the header, next to the name — not a second time above the tiles */}
          <ClientDetailBody client={c} pillInHeader />
          {live ? (
            <div className="max-w-sm">
              <NewOrderCta client={live} canOrder={can('orders.write')} />
            </div>
          ) : null}
        </div>
      ) : null}
      {actions.dialogs}
    </AppPage>
  );
}
