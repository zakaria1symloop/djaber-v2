'use client';
// A help guide read inside the app (HELP-01): side sheet over the current page, `?article=<key>` in the URL (shareable,
// Back closes it). `GET /help/articles/:key?lang=` — FR fallback banner when the user's locale is missing (12 §27).
import { formatDate, type AppLocale } from '@djaber/shared';
import { Banner, NotFoundState, SideSheet, Skeleton } from '@djaber/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { QueryError } from '@/components/global-states';
import { ApiError } from '@/lib/api';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useHelpArticle } from './api';
import { articleBlocks } from './logic';

/** `?article=` of the current URL + open / close helpers (push when opening so Back closes the sheet). */
export function useArticleParam() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const key = params.get('article');
  const set = useCallback(
    (next: string | null) => {
      const p = new URLSearchParams(params.toString());
      if (next) p.set('article', next);
      else p.delete('article');
      const qs = p.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (next && !key) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [params, pathname, router, key],
  );
  return { key, open: (k: string) => set(k), close: () => set(null) };
}

export function ArticleSheet() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { key, close } = useArticleParam();
  const q = useHelpArticle(key);
  const a = q.data;
  return (
    <SideSheet open={!!key} onClose={close} title={a?.title ?? (q.isError ? t('help.article.notFound.title') : t('help.article.loading'))} subtitle={a?.publishedAt ? t('help.article.updated', { date: formatDate(a.publishedAt, locale) }) : undefined} closeLabel={t('action.close')} width={460}>
      <div data-testid="help-article" data-key={key ?? ''} className="flex flex-col gap-3">
        {q.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : q.isError && q.error instanceof ApiError && q.error.status === 404 ? (
          // full-test 15/11 HELP-13: guides are shared by every shop — « appartient à un autre espace » made no sense here
          <NotFoundState title={t('help.article.notFound.title')} description={t('help.article.notFound.description')} />
        ) : q.isError ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : a ? (
          <>
            {a.fallback ? <Banner tone="info">{t('help.article.fallback')}</Banner> : null}
            {articleBlocks(a.body ?? a.excerpt).map((b, i) =>
              b.kind === 'h' ? (
                <h3 key={i} className="text-[15px] font-medium text-text-primary">
                  {b.text}
                </h3>
              ) : b.kind === 'ul' ? (
                <ul key={i} className="ms-5 list-disc text-[14px] text-text-secondary">
                  {b.items.map((it, j) => (
                    <li key={j}>{it}</li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="whitespace-pre-wrap text-[14px] leading-relaxed text-text-secondary">
                  {b.text}
                </p>
              ),
            )}
          </>
        ) : null}
      </div>
    </SideSheet>
  );
}
