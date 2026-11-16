'use client';
// `/help` — Figma "HELP — Help & support (merchant) — center, status, contact form, my tickets" (977:40143), 03 HELP-01…04:
// search (`?q=`), 8 categories with guide counts (`?category=`), guide reader (`?article=`), contact card, "Mes demandes"
// (3 latest, Voir tout), "État du service" (GET /status), header pill + "Visite guidée".
// States: skeleton · categories · search results · [FE] no guide matches · guides error (Réessayer) · tickets empty /
// error · status unavailable · offline banner from the shell.
import { HELP_CATEGORIES, type HelpCategory } from '@djaber/shared';
import { Button, Card, EmptyState, FilteredEmptyState, HelpCard, HelpCategoryCard, SearchInput, Skeleton, buttonClass } from '@djaber/ui';
import { BookOpen, MessageSquare } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { Link } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useHelpArticles, useTickets } from './api';
import { useArticleParam } from './article-sheet';
import { ContactForm } from './contact-form';
import { countByCategory } from './logic';
import { OverallStatusPill, ServiceStatusCard, TicketRows } from './shared';

/** URL state of the center: `?q=` search, `?category=` one of the 8 categories. */
function useHelpParams() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = params.get('q') ?? '';
  const raw = params.get('category');
  const category = (HELP_CATEGORIES as readonly string[]).includes(raw ?? '') ? (raw as HelpCategory) : null;
  const set = useCallback(
    (patch: { q?: string; category?: HelpCategory | null }) => {
      const p = new URLSearchParams(params.toString());
      if ('q' in patch) {
        if (patch.q) p.set('q', patch.q);
        else p.delete('q');
      }
      if ('category' in patch) {
        if (patch.category) p.set('category', patch.category);
        else p.delete('category');
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { q, category, set };
}

export function HelpCenterPage() {
  const t = useT();
  const locale = useLocaleCode();
  const { can } = useSession();
  const hp = useHelpParams();
  const article = useArticleParam();
  const all = useHelpArticles({});
  const searching = hp.q.trim().length >= 2 || hp.category !== null;
  const results = useHelpArticles({ q: hp.q.trim().length >= 2 ? hp.q.trim() : undefined, category: hp.category ?? undefined }, { enabled: searching });
  const counts = useMemo(() => countByCategory(all.data ?? []), [all.data]);
  const tickets = useTickets({ page: 1, pageSize: 25, scope: can('support.read_all') ? 'workspace' : 'mine' });
  const latest = (tickets.data?.rows ?? []).slice(0, 3);

  return (
    <AppPage
      wide
      title={t('help.title')}
      description={t('help.description')}
      permission="support.write"
      actions={
        <>
          <OverallStatusPill />
          <Button variant="ghost" onClick={() => hp.set({ category: 'getting_started', q: '' })} data-testid="guided-tour">
            {t('help.tour')}
          </Button>
        </>
      }
    >
      <SearchInput value={hp.q} onChange={(v) => hp.set({ q: v })} placeholder={t('help.search.placeholder')} label={t('help.search.label')} clearLabel={t('list.clearSearch')} className="w-full flex-none" />

      {all.isPending ? (
        <div role="status" aria-label={t('common.loading')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {HELP_CATEGORIES.map((c) => (
            <Skeleton key={c} className="h-[70px]" />
          ))}
        </div>
      ) : all.isError ? (
        <QueryError error={all.error} onRetry={() => void all.refetch()} />
      ) : (
        <section aria-label={t('help.categories')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="help-categories">
          {HELP_CATEGORIES.map((c) => (
            <HelpCategoryCard
              key={c}
              title={t(`help.category.${c}`)}
              description={t(`help.category.${c}.description`)}
              count={t('help.category.count', { count: counts[c] })}
              active={hp.category === c}
              onSelect={() => hp.set({ category: hp.category === c ? null : c })}
            />
          ))}
        </section>
      )}

      {searching ? (
        <Card className="flex flex-col gap-3 p-4" data-testid="help-results">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-medium">{/* full-test 15/11 HELP-13: category + typed words — both are applied, both are named */}
              {hp.category && hp.q.trim().length >= 2 ? t('help.results.titleInCategory', { q: hp.q.trim(), category: t(`help.category.${hp.category}`) }) : hp.category ? t(`help.category.${hp.category}`) : t('help.results.title', { q: hp.q })}</h2>
            <Button size="sm" variant="ghost" onClick={() => hp.set({ q: '', category: null })}>
              {t('action.clearFilters')}
            </Button>
          </div>
          {results.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : results.isError ? (
            <QueryError error={results.error} onRetry={() => void results.refetch()} />
          ) : (results.data ?? []).length === 0 ? (
            hp.q ? (
              <FilteredEmptyState title={t('help.results.empty.title')} description={t('help.results.empty.description', { q: hp.q })} action={{ label: t('help.contact.title'), href: `/${locale}/help/contact` }} />
            ) : (
              <EmptyState icon={<BookOpen className="size-5" />} title={t('help.category.empty')} />
            )
          ) : (
            <ul className="divide-y divide-line-hairline rounded-card border border-line-edge">
              {(results.data ?? []).map((a) => (
                <li key={a.key}>
                  <button type="button" data-testid="help-result" onClick={() => article.open(a.key)} className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-start hover:bg-ink-raised">
                    <span className="text-[14px] text-text-primary">{a.title}</span>
                    {a.excerpt ? <span className="line-clamp-2 ts-label-micro text-text-muted">{a.excerpt}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {/* grid-cols-1 = minmax(0, 1fr): an implicit column grew to the longest ticket subject and pushed the cards off a phone screen */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <HelpCard title={t('help.contact.title')} sub={t('help.contact.sub')} data-testid="help-contact-card">
          <ContactForm compact />
        </HelpCard>
        <HelpCard
          title={t('help.tickets.title')}
          end={
            <Link href="/help/tickets" className={buttonClass({ variant: 'ghost', size: 'sm' })} data-testid="tickets-view-all">
              {t('help.tickets.viewAll')}
            </Link>
          }
          data-testid="help-tickets-card"
        >
          {tickets.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : tickets.isError ? (
            <QueryError error={tickets.error} onRetry={() => void tickets.refetch()} />
          ) : latest.length === 0 ? (
            <EmptyState icon={<MessageSquare className="size-5" />} title={t('help.tickets.empty.title')} description={t('help.tickets.empty.description')} />
          ) : (
            <TicketRows rows={latest} />
          )}
        </HelpCard>
        <ServiceStatusCard statusHref={`/${locale}/status`} />
      </div>
    </AppPage>
  );
}
