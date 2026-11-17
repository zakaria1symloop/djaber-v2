// Default Open Graph picture of every page (journey J12-10.3: a link shared on Facebook / WhatsApp had no picture —
// `twitter:card=summary` without `og:image`). Brand name + the landing tagline; the Arabic pages use the French tagline
// (the built-in font of `next/og` has no Arabic glyphs). Design tokens: ink base, text primary / secondary, accent money.
import { ImageResponse } from 'next/og';
import { pageLocale, serverT } from '@/lib/public-fetch';
import { SITE_NAME } from '@/lib/seo';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = SITE_NAME;

export default async function OpenGraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = pageLocale((await params).locale);
  const t = serverT(locale === 'ar' ? 'fr' : locale);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '80px', background: '#000000', color: '#ffffff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '14px', background: '#34d399' }} />
          <div style={{ fontSize: 88, fontWeight: 700 }}>{SITE_NAME}</div>
        </div>
        <div style={{ marginTop: '36px', fontSize: 40, color: '#a3a3a3', maxWidth: '1000px', lineHeight: 1.3 }}>{t('public.meta.landing.description')}</div>
      </div>
    ),
    size,
  );
}
