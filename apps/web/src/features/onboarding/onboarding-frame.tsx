'use client';
// OnboardingLayout (02-next-route-map §1): logo, "Passer la configuration", guard (owner session, resume rule).
import { Button, Spinner, toast } from '@djaber/ui';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { PageSessionExpired, QueryError } from '@/components/global-states';
import { Logo } from '@/components/shell/sidebar';
import { useOnboardingStep } from '@/features/workspace/api';
import { usePathname, useRouter } from '@/i18n/navigation';
import { errorMessage } from '@/lib/forms';
import { decideOnboarding, loginHref, ONBOARDING_SKIPPED } from '@/lib/guards';
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

  const onSkip = async () => {
    try {
      await skip.mutateAsync(ONBOARDING_SKIPPED);
      router.replace('/home');
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-20 shrink-0 items-center justify-between px-4 sm:px-8">
        <Logo />
        <Button variant="ghost" onClick={onSkip} loading={skip.isPending && skip.variables === ONBOARDING_SKIPPED}>
          {t('onboarding.skip')}
        </Button>
      </header>
      <main id="main" className="flex flex-1 flex-col justify-center px-4 pb-20 pt-4">
        {children}
      </main>
    </div>
  );
}
