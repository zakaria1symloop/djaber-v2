// SEO basics of the public site (PUB-01 "SEO"): `<title>`, meta description, canonical URL, `hreflang` alternates for
// fr / ar / en (+ x-default = fr), Open Graph. Pure helpers, used by `generateMetadata` of the (public) pages,
// `app/sitemap.ts` and `app/robots.ts`.
import type { AppLocale } from '@djaber/shared';
import type { Metadata } from 'next';

export const SITE_LOCALES: readonly AppLocale[] = ['fr', 'ar', 'en'];
// full-test 15/11 PUBLIC-01: the live site had no PUBLIC_WEB_URL, so canonical / hreflang / og:url / sitemap / robots said
// http://localhost:3010 — on Vercel the production domain (system variable) is used when PUBLIC_WEB_URL is not set
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
export const SITE_URL = (process.env.PUBLIC_WEB_URL || (vercelHost ? `https://${vercelHost}` : 'http://localhost:3010')).replace(/\/+$/, '');
export const SITE_NAME = 'Djaber.ai';

/** Indexable public paths (without locale prefix) listed in the sitemap. */
export const PUBLIC_PATHS = ['', '/features', '/pricing', '/help-center', '/status', '/account/deletion', '/legal/terms', '/legal/privacy', '/legal/cookies', '/legal/content_rules', '/legal/account_deletion', '/legal/data-deletion'] as const;

/** `{ fr: '/fr/pricing', ar: '/ar/pricing', en: '/en/pricing', 'x-default': '/fr/pricing' }` */
export const languageAlternates = (path: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const l of SITE_LOCALES) out[l] = `/${l}${path}`;
  out['x-default'] = `/fr${path}`;
  return out;
};

/** The default Open Graph picture of a locale (1200 × 630, `app/[locale]/opengraph-image.tsx`). */
export const ogImage = (locale: AppLocale) => ({ url: `/${locale}/opengraph-image`, width: 1200, height: 630, alt: SITE_NAME });

/** "Tarifs · Djaber.ai" — a page title, the description, canonical + hreflang; `noindex` for previews and 404s. */
export function pageMetadata(o: { locale: AppLocale; path: string; title: string; description: string; noindex?: boolean }): Metadata {
  // journey J12-10.3: a title that already names the brand (the landing « Djaber.ai — votre vendeur IA… ») is not
  // suffixed a second time
  const title = o.title.includes(SITE_NAME) ? o.title : `${o.title} · ${SITE_NAME}`;
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description: o.description,
    alternates: { canonical: `/${o.locale}${o.path}`, languages: languageAlternates(o.path) },
    // journey J12r-2: a page's own `openGraph` replaces the layout's, so the default picture (`app/[locale]/opengraph-image`)
    // is named here too — the landing, pricing, status, help and legal links shared on Facebook / WhatsApp show it
    openGraph: { title, description: o.description, siteName: SITE_NAME, locale: o.locale === 'ar' ? 'ar_DZ' : o.locale === 'en' ? 'en_US' : 'fr_DZ', type: 'website', url: `/${o.locale}${o.path}`, images: [ogImage(o.locale)] },
    twitter: { card: 'summary_large_image', title, description: o.description, images: [ogImage(o.locale).url] },
    robots: o.noindex ? { index: false, follow: false } : { index: true, follow: true },
  };
}

/** First sentence-ish of a Markdown body for a meta description (≤ 160 chars, no Markdown marks). */
export const describe = (body: string | null | undefined, max = 160): string => {
  const text = (body ?? '')
    .replace(/^#{1,6} .*$/gm, ' ')
    .replace(/^\s*[-*] /gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
};
