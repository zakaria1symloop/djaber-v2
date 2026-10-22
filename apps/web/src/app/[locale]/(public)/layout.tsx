import type { ReactNode } from 'react';
import { PublicAnnouncements } from '@/components/public-announcements';
import { PublicFooter } from '@/components/public-footer';
import { PublicHeader } from '@/components/public-header';
import { pageLocale } from '@/lib/public-fetch';

// PublicLayout (02-next-route-map §1, PUB-01): header (logo, Fonctionnalités · Tarifs · Aide · Statut, FR · AR · EN,
// Se connecter, Essai gratuit 14 j), the platform announcements of the « Web public » channel, full-bleed sections inside
// `main`, footer. Server-rendered pages, no session needed.
export default async function PublicLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <PublicAnnouncements locale={pageLocale(locale)} />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
