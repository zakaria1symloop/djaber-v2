'use client';
// `/legal/[key]` — Figma "PUB — Legal (CMS) · Landing & help · Meta data-deletion status" (left column), PUB-03,
// AT-PUB-02: FR · AR · EN tabs, "Conditions d’utilisation — v4 · 01 sept. 2026", sections, language-missing banner
// (FR fallback), admin preview banner, version history at the bottom with the v(N-1) → vN diff.
import { formatDate, isRtl, type AppLocale, type CmsEntryDto } from '@djaber/shared';
import { cn, VersionDiff } from '@djaber/ui';
import { routing } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { diffHasChanges, LEGAL_FOOTER_KEYS, paragraphDiff } from './logic';
import { CmsBody, FallbackBanner, PreviewBanner, ReadingColumn } from './shared';

/** `?lang=` of a document tab (the interface language keeps its path prefix). */
const tabHref = (key: string, lang: AppLocale, previewToken?: string) => {
  const p = new URLSearchParams({ lang });
  if (previewToken) p.set('preview', previewToken);
  return `/legal/${key}?${p.toString()}`;
};

export function LegalView({ entry, previewToken }: { entry: CmsEntryDto; previewToken?: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const diff = entry.previousBody !== null ? paragraphDiff(entry.previousBody, entry.body) : null;
  const previous = entry.versions.find((v) => v.version < entry.version)?.version ?? entry.version - 1;
  const others = LEGAL_FOOTER_KEYS.filter((k) => k !== entry.key);
  // the document keeps its own language and direction (an Arabic text inside the French interface reads right-to-left)
  const doc = { lang: entry.locale, dir: isRtl(entry.locale) ? ('rtl' as const) : ('ltr' as const) };
  return (
    <ReadingColumn data-testid="legal-page" data-key={entry.key} data-version={entry.version} data-lang={entry.locale}>
      <div role="group" aria-label={t('public.legal.language')} className="flex gap-1.5">
        {routing.locales.map((l) => (
          <Link
            key={l}
            href={tabHref(entry.key, l, previewToken)}
            lang={l}
            aria-current={l === entry.requestedLocale ? 'true' : undefined}
            data-testid={`legal-lang-${l}`}
            className={cn(
              'h-9 rounded-card border px-3.5 py-2 text-[14px] font-medium leading-[18px] transition-colors',
              l === entry.requestedLocale ? 'border-white bg-white text-black' : 'border-line-edge bg-ink-raised text-text-primary hover:border-line-lit',
            )}
          >
            {l.toUpperCase()}
          </Link>
        ))}
      </div>
      {entry.preview ? <PreviewBanner /> : null}
      {entry.fallback ? <FallbackBanner requested={entry.requestedLocale} /> : null}
      <header className="flex flex-col gap-2">
        <h1 className="ts-display-m [overflow-wrap:anywhere]" {...doc}>
          {entry.title}
        </h1>
        <p className="ts-label-meta text-text-muted" data-testid="legal-version">
          {t('public.legal.version', { version: entry.version, date: formatDate(entry.publishedAt, locale) })}
        </p>
      </header>
      <div {...doc}>
        <CmsBody body={entry.body} />
      </div>
      <section className="flex flex-col gap-3 border-t border-line-hairline pt-6" aria-labelledby="legal-history" data-testid="legal-history">
        <h2 id="legal-history" className="text-[15px] font-medium">
          {t('public.legal.history')}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {entry.versions.map((v) => (
            <li key={v.version} className={cn('rounded-[4px] border px-2 py-1 ts-label-meta', v.version === entry.version ? 'border-line-lit text-text-primary' : 'border-line-edge text-text-muted')}>
              {t('public.legal.historyItem', { version: v.version, date: formatDate(v.publishedAt, locale) })}
              {/* full-test 15/11 PUBLIC-16: a real space before « · » (« 14 oct. 2026· en vigueur ») */}
              {v.version === entry.version ? <span className="text-signal-live">{` · ${t('public.legal.current')}`}</span> : null}
            </li>
          ))}
        </ul>
        {diff ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-[13px] text-text-secondary">{t('public.legal.diff', { from: previous, to: entry.version })}</h3>
            {diffHasChanges(diff) ? (
              <div {...doc}>
                <VersionDiff lines={diff} addedLabel={t('public.legal.diff.added')} removedLabel={t('public.legal.diff.removed')} />
              </div>
            ) : (
              <p className="ts-label-meta text-text-muted">{t('public.legal.diff.none')}</p>
            )}
          </div>
        ) : null}
      </section>
      <nav aria-label={t('public.legal.otherDocs')} className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line-hairline pt-4 text-[13px] text-text-secondary">
        {others.map((k) => (
          <Link key={k} href={`/legal/${k}`} className="hover:text-text-primary">
            {t(`public.footer.${k}`)}
          </Link>
        ))}
      </nav>
    </ReadingColumn>
  );
}
