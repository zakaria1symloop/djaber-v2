'use client';
// OnboardingLayout (02-next-route-map §1): logo, FR · AR · EN, "Passer la configuration", "Déconnexion", guard (owner session, resume rule).
import { Banner, Button, ConfirmDialog, Spinner, toast } from '@djaber/ui';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LocaleSwitch } from '@/components/auth/auth-card';
import { PageSessionExpired, QueryError } from '@/components/global-states';
import { Logo } from '@/components/shell/sidebar';
import { useOnboardingStep } from '@/features/workspace/api';
import { usePathname, useRouter } from '@/i18n/navigation';
import { errorMessage } from '@/lib/forms';
import { decideOnboarding, loginHref, ONBOARDING_SKIPPED, ONBOARDING_STEPS } from '@/lib/guards';

const RESUME_KEY = 'djaber.onboardingResumeShown';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export function OnboardingFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const locale = useLocaleCode();
  const s = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { step = '' } = useParams<{ step?: string }>();
  const skip = useOnboardingStep();
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // full-test 15/11 ONBOARDING-11: « reprise (banner at next login) » — the first tunnel page of a browser session that
  // resumes a saved step says so once
  const [resumed, setResumed] = useState<number | null>(null);
  const savedStep = s.workspace?.onboardingStep ?? 0;
  const loaded = !!s.workspace;
  useEffect(() => {
    if (!loaded) return;
    // the step seen first in this browser session decides (a step reached in the same session is not a « reprise »)
    try {
      if (window.sessionStorage.getItem(RESUME_KEY)) return;
      window.sessionStorage.setItem(RESUME_KEY, '1');
    } catch {
      return;
    }
    if (savedStep >= 2 && savedStep <= 5) setResumed(savedStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first load of the workspace only
  }, [loaded]);

  const decision = decideOnboarding({
    status: s.status,
    pathname,
    search: search ? `?${search}` : '',
    membershipCount: s.me?.memberships.length ?? 0,
    role: s.role,
    workspace: s.workspace,
    workspaceLoading: s.workspaceLoading,
    deletionScheduled: !!s.me?.deletionScheduledAt,
    slug: step,
  });
  const to = decision.kind === 'redirect' ? decision.to : null;
  useEffect(() => {
    if (to) router.replace(to);
  }, [to, router]);

  if (decision.kind === 'state') {
    if (decision.state === 'session-expired') return <PageSessionExpired path={pathname} loginHref={`/${locale}${loginHref(pathname)}`} />;
    return (
      <div className="mx-auto max-w-lg p-6">
        <QueryError error={s.bootError ?? s.workspaceError} onRetry={() => void s.refetchMe()} />
      </div>
    );
  }
  if (decision.kind !== 'render') {
    if (s.workspaceError && !s.workspace) {
      return (
        <div className="mx-auto max-w-lg p-6">
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

  const signOut = async () => {
    setSigningOut(true);
    try {
      await s.logout();
      router.replace('/login');
    } finally {
      setSigningOut(false);
    }
  };
  const onSkip = async () => {
    setConfirmSkip(false);
    try {
      await skip.mutateAsync(ONBOARDING_SKIPPED);
      router.replace('/home');
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex min-h-20 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
        <Logo />
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {/* journey 16/11 J01-4: the language can change and the merchant can sign out without leaving the setup first
              (a shared computer); the URL keeps the step */}
          <LocaleSwitch />
          {/* full-test 15/11 ONBOARDING-10: one click no longer ends the setup — it is confirmed, and says where to resume */}
          <Button variant="ghost" onClick={() => setConfirmSkip(true)} loading={skip.isPending && skip.variables === ONBOARDING_SKIPPED} data-testid="onboarding-skip">
            {t('onboarding.skip')}
          </Button>
          <Button variant="ghost" onClick={() => void signOut()} loading={signingOut} data-testid="onboarding-logout">
            {t('userMenu.logout')}
          </Button>
        </div>
        <ConfirmDialog
          open={confirmSkip}
          onOpenChange={setConfirmSkip}
          title={t('onboarding.skipConfirm.title')}
          description={t('onboarding.skipConfirm.description')}
          confirmLabel={t('onboarding.skip')}
          cancelLabel={t('onboarding.skipConfirm.stay')}
          closeLabel={t('action.close')}
          onConfirm={() => void onSkip()}
        />
      </header>
      <main id="main" className="flex flex-1 flex-col justify-center px-4 pb-20 pt-4">
        {resumed ? (
          <div className="mx-auto mb-4 w-full max-w-[680px]" data-testid="onboarding-resume">
            <Banner tone="info" onDismiss={() => setResumed(null)} dismissLabel={t('action.close')}>
              {t('onboarding.resume.banner', { step: resumed, total: ONBOARDING_STEPS.length })}
            </Banner>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
