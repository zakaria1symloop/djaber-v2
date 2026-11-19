import type { ReactNode } from 'react';
import { FullMessages } from '@/lib/server-messages';

// PUBLIC-04: outside the public subset of the locale layout — the client components of this route read the whole catalogue.
export default async function FullCatalogueLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <FullMessages locale={locale}>{children}</FullMessages>;
}
