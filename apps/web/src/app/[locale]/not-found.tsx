'use client';
// Unknown URL of the locale (catch-all). A signed-in member gets the app 404 (back to Home); a visitor gets the public 404
// inside the public header / footer (full-test 15/11 PUBLIC-05: « appartient à un autre espace » and a « Retour à
// l'accueil » that bounced to /login).
import { Page404 } from '@/components/global-states';
import { PublicFooter } from '@/components/public-footer';
import { PublicHeader } from '@/components/public-header';
import { PublicNotFound } from '@/features/public/shared';
import { useLocaleCode } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function NotFound() {
  const locale = useLocaleCode();
  const { status } = useSession();
  if (status === 'authenticated') return <Page404 homeHref={`/${locale}/home`} />;
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main" className="flex flex-1 flex-col">
        <PublicNotFound />
      </main>
      <PublicFooter />
    </div>
  );
}
