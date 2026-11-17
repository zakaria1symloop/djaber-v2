// /status — public status page (Figma "PUB — Public status page (status.djaber.ai)"). No layout group, no session.
// Journey J12-8: the page is in the sitemap, so its server HTML has its own title, description, canonical and hreflang
// (it was a client page with the default « Djaber.ai » head until the browser script ran).
import type { Metadata } from 'next';
import { PublicStatusPage } from '@/features/status/status-page';
import { pageLocale, serverT } from '@/lib/public-fetch';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const t = serverT(locale);
  return pageMetadata({ locale, path: '/status', title: t('status.title'), description: t('public.meta.status.description') });
}

export default function Page() {
  return <PublicStatusPage />;
}
