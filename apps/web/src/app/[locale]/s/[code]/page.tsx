// /s/[code] — public parcel tracking (QR on the label). No layout group: PublicLayout header only (02 §1).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicTrackingPage } from '@/features/delivery/public/tracking-page';
import { pageLocale, publicGet, serverT } from '@/lib/public-fetch';
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
  const { locale: raw, code } = await params;
  const decoded = decodeURIComponent(code);
  // full-test 15/11 deferred item: an unknown code answered 200 with the « not found » state only drawn by the browser —
  // the server now asks the API first and answers a real 404 (same « not found » state, see not-found.tsx). An unreachable
  // API (status 0) or another error keeps the client page, which shows its error state with « Réessayer ».
  const r = await publicGet<unknown>(`/track/${encodeURIComponent(decoded)}`, { locale: pageLocale(raw), noStore: true });
  if (!r.ok && r.status === 404) notFound();
  return <PublicTrackingPage code={decoded} />;
}
