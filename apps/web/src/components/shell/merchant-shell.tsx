'use client';
// MerchantShell (02-next-route-map §2.1): guard, sidebar (stock mode + permission filtering), top bar, banners,
// legal re-acceptance interstitial, language dialog. Frames "ANA-01 — Home — default", "AUTH — States catalogue".
import { formatDate, isMerchantPermission, type AppLocale } from '@djaber/shared';
import { Avatar, Button, Checkbox, Dialog, FormAlert, Menu, MenuItem, MenuLabel, MenuSeparator, Spinner, toast } from '@djaber/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RESEND_COOLDOWN_S } from '@/components/auth/forgot-form';
import { PageSessionExpired, PageSuspended, QueryError } from '@/components/global-states';
import { useAgentEvents } from '@/features/agents/api';
import { authApi } from '@/features/auth/api';
import { useCatalogEvents } from '@/features/catalog/api';
import { useShipmentEvents } from '@/features/delivery/api';
import { useGdsEvents } from '@/features/gds/api';
import { useOrderEvents } from '@/features/orders/api';
import { useChannelBanners, useChannelEvents } from '@/features/channels/shell';
import { CreditsPillLink, useCreditsBanners, useCreditsEvents } from '@/features/credits/shell';
import { useBillingEvents, usePlanBanners } from '@/features/billing/shell';
import { useInboxBadge, useInboxEvents } from '@/features/inbox/api';
import { useWorkspaceCache, workspaceApi } from '@/features/workspace/api';
import { planIntentHref, type PlanIntent } from '@/features/public/logic';
import { clearPlanIntent, readPlanIntent } from '@/lib/plan-intent';
import { useMessageSound } from '@/features/inbox/sound';
import { NotificationBell, useUnreadNotifications } from '@/features/notifications/shell';
import { GlobalSearch } from './global-search';
import { useQueueCount } from '@/features/queue/shell';
import { HelpPanelButton } from '@/features/help/help-panel';
import { MaintenanceGate, useMaintenanceBanner } from '@/features/status/maintenance';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { apiSession } from '@/lib/api';
import type { LegalPending } from '@/lib/contracts';
import { formatClock, retryAfterSeconds, useCooldown } from '@/lib/countdown';
import { errorMessage } from '@/lib/forms';
import { decideApp, loginHref } from '@/lib/guards';
import { ImpersonationBanner, ImpersonationExpired } from '@/features/admin/impersonation';
import { useImpersonation } from '@/lib/impersonation';
import { JobToaster } from '@/lib/jobs';
import { useWsStatus, WsProvider } from '@/lib/ws';
import { useLocaleCode, useT } from '@/lib/i18n';
import { meKey, useSession } from '@/lib/session';
import { AppShell } from './app-shell';
import type { ShellBanner } from './banner-stack';
import { filterNav, FOOTER_NAV, MAIN_NAV, type NavGroup } from './nav';

export const LOCALE_NAMES: Record<AppLocale, string> = { fr: 'Français', ar: 'العربية', en: 'English' };

export function MerchantShell({ children }: { children: ReactNode }) {
  const t = useT();
  const locale = useLocaleCode();
  const s = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  const decision = decideApp({
    status: s.status,
    pathname,
    search: search ? `?${search}` : '',
    membershipCount: s.impersonating ? 1 : (s.me?.memberships.length ?? 0),
    role: s.role,
    workspace: s.workspace,
    workspaceLoading: s.workspaceLoading,
  });
  const to = decision.kind === 'redirect' ? decision.to : null;
  useEffect(() => {
    if (to) router.replace(to);
  }, [to, router]);

  // 409 WORKSPACE_DELETION_SCHEDULED on any mutation ⇒ toast + link to the danger zone (02 §6)
  useEffect(
    () =>
      apiSession.on((e) => {
        if (e === 'deletion-scheduled') toast({ tone: 'danger', message: t('shell.deletionScheduled.toast'), action: { label: t('nav.settings.danger'), onClick: () => router.push('/settings/danger') } });
      }),
    [t, router],
  );

  const banners = useShellBanners();
  const impersonationExpired = useImpersonation().expired;
  const can = s.can;
  const stockMode = s.workspace?.stockMode ?? 'simple';
  const groups = useMemo<NavGroup[]>(() => {
    const allow = (key: string) => isMerchantPermission(key) && can(key);
    return MAIN_NAV.map((g) => ({ ...g, items: filterNav(g.items, { stockMode, can: allow }) }));
  }, [stockMode, can]);

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
  if (decision.kind === 'wait' || decision.kind === 'redirect') {
    if (decision.kind === 'wait' && s.workspaceError && !s.workspace) {
      return (
        <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center p-6">
          <QueryError error={s.workspaceError} onRetry={() => void s.refetchWorkspace()} />
        </div>
      );
    }
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }

  // read-only impersonation whose 30 min window is over (ADMIN_IMPERSONATION_EXPIRED): back to the admin
  if (s.impersonating && impersonationExpired) return <ImpersonationExpired />;
  const suspended = decision.kind === 'state' && decision.state === 'suspended';
  return (
    <WsProvider>
      <LiveShell groups={groups} banners={banners} fixedBar={s.impersonating ? <ImpersonationBanner /> : undefined}>
        {suspended ? (
          <PageSuspended reason={t(`shell.suspendReason.${s.workspace?.suspendReason ?? 'other'}`)} supportHref={`/${locale}/help/contact`} />
        ) : (
          <MaintenanceGate>{children}</MaintenanceGate>
        )}
      </LiveShell>
      <JobToaster />
      <LegalInterstitial />
    </WsProvider>
  );
}

/**
 * The frame fed with live data (mounted inside WsProvider): WS events → TanStack Query cache for every module, and
 * the sidebar badges — `queue` (needs-human conversations + pending insights), `inbox` (unread conversations),
 * `notifications` (server unread count, also shown on the bell).
 */
function LiveShell({ groups, banners, fixedBar, children }: { groups: NavGroup[]; banners: ShellBanner[]; fixedBar?: ReactNode; children: ReactNode }) {
  useCatalogEvents();
  useInboxEvents();
  useChannelEvents();
  useAgentEvents();
  useCreditsEvents();
  useBillingEvents();
  useOrderEvents();
  useShipmentEvents();
  useGdsEvents();
  useMessageSound();
  const counters = { queue: useQueueCount(), inbox: useInboxBadge(), notifications: useUnreadNotifications() };
  return (
    <AppShell groups={groups} footer={FOOTER_NAV} topBar={<TopBar />} banners={banners} counters={counters} fixedBar={fixedBar}>
      {children}
    </AppShell>
  );
}

/* ---------- Banners: channel reconnect / Meta approval, e-mail unverified, read-only member, suspended, deletion scheduled, offline ---------- */
function useShellBanners(): ShellBanner[] {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const s = useSession();
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  // plan picked on the pricing page before sign-up (`/signup?plan=&cycle=`): offered once the shell is reached
  const [planIntent, setPlanIntent] = useState<PlanIntent | null>(null);
  useEffect(() => setPlanIntent(readPlanIntent()), []);
  const dropPlanIntent = () => {
    clearPlanIntent();
    setPlanIntent(null);
  };
  const [cooldown, startCooldown] = useCooldown();
  const resend = useMutation({ mutationFn: authApi.resendVerification });
  const qc = useQueryClient();
  const writeWorkspace = useWorkspaceCache();
  const cancelDeletion = useMutation({ mutationFn: workspaceApi.cancelDeletion });
  // `reconnect` (a page lost its Meta token) and `approvalPending` (Instagram waiting for Meta)
  const channelBanners = useChannelBanners();
  // `credits100` / `credits80` / `negativeCredits` (GET /credits, live through WS `credits.updated`)
  const creditsBanners = useCreditsBanners();
  // `planExpired` / `dunning` / `planExpiring` (GET /billing/subscription for Owner + Admin, GET /workspace otherwise)
  const planBanners = usePlanBanners();

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

  // "Annuler la suppression" right from the banner (same call as Settings › Zone de danger)
  const onCancelDeletion = async () => {
    try {
      const res = await cancelDeletion.mutateAsync();
      writeWorkspace({ status: res.status, deletionScheduledAt: res.deletionScheduledAt });
      void qc.invalidateQueries({ queryKey: meKey });
      toast(t('settings.danger.cancelled'));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };

  const onResend = async () => {
    try {
      await resend.mutateAsync();
      toast(t('auth.verify.resent', { email: s.me?.email ?? '' }));
      startCooldown(RESEND_COOLDOWN_S);
    } catch (e) {
      const wait = retryAfterSeconds(e, RESEND_COOLDOWN_S);
      if (wait > 0) startCooldown(wait);
      else toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };

  // `maintenance` (GET /status every 60 s, or a write refused with 503 MAINTENANCE_MODE)
  const maintenance = useMaintenanceBanner();
  const banners: ShellBanner[] = [...channelBanners, ...creditsBanners, ...planBanners];
  if (s.workspace?.status === 'suspended') banners.push({ id: 'suspended', tone: 'danger', content: t('banner.suspended') });
  if (s.workspace?.status === 'deletion_scheduled') {
    banners.push({
      id: 'deletionScheduled',
      tone: 'danger',
      content: t('shell.deletionScheduled.banner', { date: s.workspace.deletionScheduledAt ? formatDate(s.workspace.deletionScheduledAt, locale) : '—' }),
      action: s.can('workspace.delete') ? { label: t('settings.danger.cancel'), onClick: () => void onCancelDeletion(), disabled: cancelDeletion.isPending } : undefined,
    });
  }
  if (s.me && !s.me.emailVerifiedAt) {
    banners.push({
      id: 'emailUnverified',
      tone: 'info',
      content: t('shell.emailUnverified', { email: s.me.email }),
      action: cooldown > 0 ? { label: t('action.resendIn', { time: formatClock(cooldown) }), disabled: true } : { label: t('action.resend'), onClick: onResend },
    });
  }
  if (s.readOnly) banners.push({ id: 'readOnly', tone: 'warning', content: t('banner.readOnly') });
  if (offline) banners.push({ id: 'offline', tone: 'warning', content: t('banner.offline') });
  if (maintenance) banners.push(maintenance);
  if (planIntent && s.can('billing.plan') && s.workspace?.status === 'active') {
    const intent = planIntent;
    banners.push({
      id: 'planIntent',
      tone: 'info',
      content: t('shell.planIntent.banner'),
      action: {
        label: t('shell.planIntent.action'),
        onClick: () => {
          dropPlanIntent();
          router.push(planIntentHref(intent));
        },
      },
      onDismiss: dropPlanIntent,
    });
  }
  return banners;
}

/* ---------- Top bar ---------- */
function TopBar() {
  const t = useT();
  const s = useSession();
  const ws = useWsStatus();
  return (
    <>
      {s.me && s.me.memberships.length > 1 ? (
        <div className="min-w-0">
          <WorkspaceSwitcher />
        </div>
      ) : null}
      {/* tester report 2026-10-20: one search for pages, orders, clients and products */}
      <div className="me-auto hidden min-w-0 flex-1 md:block">
        <GlobalSearch />
      </div>
      {ws === 'reconnecting' ? (
        <span role="status" data-testid="ws-reconnecting" className="inline-flex h-5 items-center gap-1.5 rounded-full border border-accent-starred/40 px-2 ts-label-meta text-accent-starred">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent-starred" />
          {t('state.ws.reconnecting')}
        </span>
      ) : null}
      <CreditsPillLink />
      <HelpPanelButton />
      <NotificationBell />
      <UserMenu />
    </>
  );
}

function WorkspaceSwitcher() {
  const t = useT();
  const s = useSession();
  if (!s.me) return null;
  return (
    <Menu
      align="start"
      trigger={
        <Button variant="secondary" size="sm" className="max-w-56" aria-label={t('shell.switcher.label')}>
          <Avatar name={s.membership?.name ?? ''} src={s.membership?.logoUrl} size={18} square />
          <span className="truncate">{s.membership?.name}</span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden />
        </Button>
      }
    >
      <MenuLabel>{t('shell.switcher.label')}</MenuLabel>
      {s.me.memberships.map((m) => (
        <MenuItem key={m.workspaceId} onSelect={() => m.workspaceId !== s.workspaceId && s.switchWorkspace(m.workspaceId)} data-current={m.workspaceId === s.workspaceId}>
          <span className="min-w-0 flex-1 truncate">{m.name}</span>
          <span className="ts-label-meta text-text-muted">{t(`enum.Membership.role.${m.role}`)}</span>
          {m.workspaceId === s.workspaceId ? <Check className="size-3.5 text-accent-money" aria-hidden /> : <span className="w-3.5" />}
        </MenuItem>
      ))}
      {s.me.ownedWorkspaceId === null ? (
        <>
          <MenuSeparator />
          <MenuItem asChild>
            <Link href="/workspaces/new">{t('topbar.workspaceSwitcher.create')}</Link>
          </MenuItem>
        </>
      ) : null}
    </Menu>
  );
}

export function UserMenu() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const s = useSession();
  const router = useRouter();
  const [language, setLanguage] = useState(false);
  if (!s.me) return null;
  const name = `${s.me.firstName} ${s.me.lastName}`.trim();
  const out = async (all: boolean) => {
    await (all ? s.logoutAll() : s.logout());
    router.replace('/login');
  };
  return (
    <>
      <Menu
        trigger={
          <button type="button" aria-label={t('shell.userMenu.label', { name })} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-inbound">
            <Avatar name={name} src={s.me.avatarUrl} size={32} />
          </button>
        }
      >
        <div className="px-2.5 py-2">
          <div className="truncate text-[13px] font-medium">{name}</div>
          <div className="truncate text-[12px] text-text-muted" dir="ltr">
            {s.me.email}
          </div>
        </div>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/settings/profile">{t('userMenu.profile')}</Link>
        </MenuItem>
        <MenuItem onSelect={() => setLanguage(true)}>{t('userMenu.language', { language: LOCALE_NAMES[locale] })}</MenuItem>
        {s.me.ownedWorkspaceId === null ? (
          <MenuItem asChild>
            <Link href="/workspaces/new">{t('userMenu.createWorkspace')}</Link>
          </MenuItem>
        ) : null}
        {s.me.platformRole !== 'none' ? (
          <MenuItem asChild>
            <Link href="/admin">{t('userMenu.platform')}</Link>
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem className="text-accent-alert" onSelect={() => void out(false)}>
          {t('userMenu.logout')}
        </MenuItem>
        <MenuItem className="text-accent-alert" onSelect={() => void out(true)}>
          {t('userMenu.logoutAll')}
        </MenuItem>
      </Menu>
      <LanguageDialog open={language} onClose={() => setLanguage(false)} />
    </>
  );
}

/** DLG "Langue & région": applies to web and mobile (User.locale); keeps the current path. */
export function LanguageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const current = useLocaleCode() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const qc = useQueryClient();
  const [value, setValue] = useState<AppLocale>(current);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: (locale: AppLocale) => authApi.updateMe({ locale }) });
  useEffect(() => {
    if (open) {
      setValue(current);
      setError(null);
    }
  }, [open, current]);

  const apply = async () => {
    setError(null);
    try {
      qc.setQueryData(meKey, await save.mutateAsync(value));
      onClose();
      if (value !== current) router.replace(`${pathname}${search ? `?${search}` : ''}`, { locale: value });
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.language.title')}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            {t('action.close')}
          </Button>
          <Button variant="primary" onClick={apply} loading={save.isPending}>
            {t('action.apply')}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label={t('dialog.language.title')} className="flex flex-col gap-1">
        {routing.locales.map((l) => (
          <label key={l} className="flex cursor-pointer items-center gap-3 rounded-card px-2 py-2 text-[14px] hover:bg-ink-raised">
            <input type="radio" name="locale" value={l} checked={value === l} onChange={() => setValue(l)} className="size-4 accent-white" />
            <span lang={l}>{LOCALE_NAMES[l]}</span>
          </label>
        ))}
      </div>
      <p className="ts-label-meta mt-4 text-text-muted">{t('shell.language.note')}</p>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}

/** Blocking "Conditions mises à jour" dialog: the app is unusable until every pending document is accepted. */
export function LegalInterstitial() {
  const t = useT();
  const s = useSession();
  const qc = useQueryClient();
  const key = ['session', 'legal-pending', s.me?.id] as const;
  const pending = useQuery({ queryKey: key, queryFn: authApi.legalPending, enabled: !!s.me, initialData: s.me?.pendingLegal, staleTime: 60_000 });
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = useMutation({ mutationFn: authApi.legalAccept });
  const { refetch } = pending;
  useEffect(
    () =>
      apiSession.on((e) => {
        if (e === 'legal-required') void refetch();
      }),
    [refetch],
  );

  const docs: LegalPending[] = pending.data ?? [];
  if (docs.length === 0) return null;
  const onAccept = async () => {
    setError(null);
    try {
      for (const d of docs) await accept.mutateAsync({ key: d.key, version: d.version });
      setChecked(false);
      qc.setQueryData(key, []);
      void qc.invalidateQueries({ queryKey: meKey });
    } catch (e) {
      setError(errorMessage(e, t));
      void refetch();
    }
  };
  return (
    <Dialog
      open
      onOpenChange={() => undefined}
      title={t('legal.reaccept.title')}
      description={t('legal.reaccept.description')}
      closeLabel={t('userMenu.logout')}
      hideClose
      footer={
        <>
          <Button variant="ghost" onClick={() => void s.logout()} disabled={accept.isPending}>
            {t('userMenu.logout')}
          </Button>
          <Button variant="primary" onClick={onAccept} loading={accept.isPending} disabled={!checked}>
            {t('legal.reaccept.accept')}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-2">
        {docs.map((d) => (
          <li key={d.key} className="flex items-center justify-between gap-3 rounded-card bg-ink-raised px-3 py-2.5 text-[13px]">
            <span>{t(`legal.doc.${d.key}`)}</span>
            <a href={d.url} target="_blank" rel="noreferrer" className="ts-label-meta text-accent-inbound hover:underline">
              {t('legal.reaccept.read', { version: d.version })}
            </a>
          </li>
        ))}
      </ul>
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[13px]">
        <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
        <span>{t('legal.reaccept.checkbox')}</span>
      </label>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}
