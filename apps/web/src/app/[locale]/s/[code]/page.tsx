// /s/[code] — public parcel tracking (QR on the label). No layout group: PublicLayout header only (02 §1).
import type { Metadata } from 'next';
import { PublicTrackingPage } from '@/features/delivery/public/tracking-page';
import { pageLocale, serverT } from '@/lib/public-fetch';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ locale: string; code: string }> };

// journey J12-8: its own title in the server HTML (it was the default « Djaber.ai » head); a tracking page is personal,
// never indexed
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, code } = await params;
  const locale = pageLocale(raw);
  const t = serverT(locale);
  return pageMetadata({ locale, path: `/s/${code}`, title: t('tracking.public.title'), description: t('public.meta.landing.description'), noindex: true });
}

export default async function TrackingPage({ params }: Props) {
  const { code } = await params;
  return <PublicTrackingPage code={decodeURIComponent(code)} />;
}
