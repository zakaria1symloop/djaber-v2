import { Suspense, type ReactNode } from 'react';
import { OnboardingFrame } from '@/features/onboarding/onboarding-frame';
import { FullMessages } from '@/lib/server-messages';

// OnboardingLayout — frames "ONB-01 — Onboarding — step 1…6".
export default async function OnboardingLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <FullMessages locale={locale}>
      <Suspense>
        <OnboardingFrame>{children}</OnboardingFrame>
      </Suspense>
    </FullMessages>
  );
}
