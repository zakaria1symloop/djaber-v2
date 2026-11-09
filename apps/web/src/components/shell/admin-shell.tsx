'use client';
// AdminShell (02-next-route-map §2.3, frame "ADM-01 — Platform admin — overview"): guard (session + platform role, no
// workspace needed), sidebar with every admin area (badges for the moderation / reports / support queues from the
// WS admin room), header tag "PLATEFORME · {role}", notification bell (owner request 09/11), user menu, offline banner,
// legal re-acceptance interstitial.
import { Spinner } from '@djaber/ui';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PageSessionExpired, QueryError } from '@/components/global-states';
import { AdminForbidden } from '@/features/admin/admin-page';
import { useAdminBadges } from '@/features/admin/badges';
import { AdminNotificationBell } from '@/features/admin/notifications';
import { usePlatform } from '@/features/admin/platform';
import { useMaintenanceBanner } from '@/features/status/maintenance';
import { usePathname, useRouter } from '@/i18n/navigation';
import { apiSession } from '@/lib/api';
import { decideAdmin, loginHref } from '@/lib/guards';
import { JobToaster } from '@/lib/jobs';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useWsStatus, WsProvider } from '@/lib/ws';
import { adminNavGroups, ADMIN_FOOTER_NAV } from './admin-nav';
import { AppShell } from './app-shell';
import type { ShellBanner } from './banner-stack';
import { LegalInterstitial, UserMenu } from './merchant-shell';

export function AdminShell({ children }: { children: ReactNode }) {
  const t = useT();
  const locale = useLocaleCode();
  const s = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const decision = decideAdmin({ status: s.status, pathname, search: search ? `?${search}` : '', platformRole: s.me?.platformRole });
  const to = decision.kind === 'redirect' ? decision.to : null;
  useEffect(() => {
    if (to) router.replace(to);
  }, [to, router]);

  if (decision.kind === 'state' && decision.state === 'session-expired') {
    return <PageSessionExpired path={pathname} loginHref={`/${locale}${loginHref(pathname, search ? `?${search}` : '')}`} />;
  }
  if (decision.kind === 'state' && decision.state === 'error') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center p-6">
        <QueryError error={s.bootError} onRetry={() => void s.refetchMe()} />
      </div>
    );
  }
  if (decision.kind === 'state' && decision.state === 'forbidden') return <AdminForbidden role={null} />;
  if (decision.kind !== 'render') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  return (
    <WsProvider admin>
      <AdminFrame>{children}</AdminFrame>
      <JobToaster />
      <LegalInterstitial />
    </WsProvider>
  );
}

function AdminFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const { role, can } = usePlatform();
  const groups = useMemo(() => adminNavGroups(can), [can]);
  const counters = useAdminBadges();
  const banners = useAdminBanners();
  const ws = useWsStatus();
  return (
    <AppShell
      groups={groups}
      footer={ADMIN_FOOTER_NAV}
      counters={counters}
      homeHref="/admin"
      banners={banners}
      sidebarHeader={
        <div className="ts-label-micro uppercase text-accent-alert" data-testid="admin-role-tag">
          {t('admin.shell.tag', { role: role ? t(`admin.shell.role.${role}`) : '—' })}
        </div>
      }
      topBar={
        <>
          {ws === 'reconnecting' ? (
            <span role="status" className="inline-flex h-5 items-center gap-1.5 rounded-full border border-accent-starred/40 px-2 ts-label-meta text-accent-starred">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent-starred" />
              {t('state.ws.reconnecting')}
            </span>
          ) : null}
          <AdminNotificationBell />
          <UserMenu />
        </>
      }
    >
      {children}
    </AppShell>
  );
}

function useAdminBanners(): ShellBanner[] {
  const t = useT();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const off = apiSession.on((e) => {
      if (e === 'offline') setOffline(true);
      if (e === 'online') setOffline(false);
    });
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      off();
    };
  }, []);
  const maintenance = useMaintenanceBanner();
  const banners: ShellBanner[] = [];
  if (maintenance) banners.push(maintenance);
  if (offline) banners.push({ id: 'offline', tone: 'warning', content: t('banner.offline') });
  return banners;
}
