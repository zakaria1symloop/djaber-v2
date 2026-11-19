import { Suspense, type ReactNode } from 'react';
import { MerchantShell } from '@/components/shell/merchant-shell';
import { FullMessages } from '@/lib/server-messages';

// (app) — MerchantShell (02-next-route-map §2.1): requires a session and a workspace.
export default async function AppLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <FullMessages locale={locale}>
      <Suspense>
        <MerchantShell>{children}</MerchantShell>
      </Suspense>
    </FullMessages>
  );
}
