import { Suspense, type ReactNode } from 'react';
import { AdminShell } from '@/components/shell/admin-shell';
import { FullMessages } from '@/lib/server-messages';

// (admin) — AdminShell (02-next-route-map §2.3): requires a session and User.platformRole.
export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <FullMessages locale={locale}>
      <Suspense>
        <AdminShell>{children}</AdminShell>
      </Suspense>
    </FullMessages>
  );
}
