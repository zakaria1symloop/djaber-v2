// HELP-01 / D46 — help center articles = published `CmsEntry(type=help)` (same content as the public help pages, M11).
// Locale = `lang` or `Accept-Language`, FR fallback when the requested locale is not published (`fallback: true`).
// `context` = page key of the "?" panel, matched against `CmsEntry.target.pages[]`.
import { Injectable } from '@nestjs/common';
import { prisma, TenantContext, type Prisma } from '@djaber/db';
import type { HelpArticleDto, HelpArticlesQuery } from '@djaber/shared';
import { notFound } from '../../../core/errors/app.exception';

const include = { locales: true } as const satisfies Prisma.CmsEntryInclude;
type Row = Prisma.CmsEntryGetPayload<{ include: typeof include }>;

const strip = (md: string) =>
  md
    .replace(/[#*_`>[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Lower case, no accents (« crédits » = « credits »), no Arabic short vowels / tatweel. */
export const foldText = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .toLocaleLowerCase();
/** The words of a search (2+ letters, or any word with a digit: « 2FA »). */
export const searchWords = (q: string): string[] => [...new Set(foldText(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 || /\d/.test(w)))];
/**
 * full-test 15/11 HELP-01: the search matches word by word without accents — every word first (« connecter Instagram »
 * finds « Connecter une page Facebook ou Instagram »); when no guide has them all, the guides with the most words.
 */
export function rankSearch<T>(items: T[], text: (x: T) => string, q: string): T[] {
  const words = searchWords(q);
  if (!words.length) return items;
  const scored = items.map((x) => {
    const hay = foldText(text(x));
    return { x, n: words.filter((w) => hay.includes(w)).length };
  });
  const all = scored.filter((s) => s.n === words.length);
  if (all.length) return all.map((s) => s.x);
  return scored.filter((s) => s.n > 0).sort((a, b) => b.n - a.n).map((s) => s.x);
}

@Injectable()
export class HelpService {
  private present(e: Row, requested: string, withBody: boolean): HelpArticleDto | null {
    const published = e.locales.filter((l) => l.status === 'published');
    const loc = published.find((l) => l.locale === requested) ?? published.find((l) => l.locale === 'fr');
    if (!loc) return null;
    const target = (e.target ?? {}) as { pages?: unknown };
    const plain = strip(loc.body);
    return {
      key: e.key,
      category: e.category,
      locale: loc.locale,
      requestedLocale: requested,
      fallback: loc.locale !== requested,
      title: loc.title,
      excerpt: plain.length > 200 ? `${plain.slice(0, 197).trimEnd()}…` : plain,
      ...(withBody ? { body: loc.body } : {}),
      version: e.currentVersion,
      publishedAt: e.updatedAt.toISOString(),
      contexts: Array.isArray(target.pages) ? target.pages.filter((p): p is string => typeof p === 'string') : [],
    };
  }

  private where(now: Date): Prisma.CmsEntryWhereInput {
    return { type: 'help', status: 'published', AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] };
  }

  async list(q: HelpArticlesQuery, locale: string): Promise<HelpArticleDto[]> {
    const requested = q.lang ?? locale;
    const rows = await TenantContext.runSystem(() =>
      prisma.cmsEntry.findMany({ where: { ...this.where(new Date()), ...(q.category ? { category: q.category } : {}) }, include, orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] }),
    );
    const found = rows
      .map((r) => this.present(r, requested, true))
      .filter((a): a is HelpArticleDto => !!a)
      .filter((a) => !q.context || a.contexts.includes(q.context));
    return (q.q?.trim() ? rankSearch(found, (a) => `${a.title} ${a.body ?? ''}`, q.q) : found).map(({ body: _b, ...a }) => a);
  }

  async get(key: string, lang: string | undefined, locale: string): Promise<HelpArticleDto> {
    const row = await TenantContext.runSystem(() => prisma.cmsEntry.findFirst({ where: { key, ...this.where(new Date()) }, include }));
    const a = row ? this.present(row, lang ?? locale, true) : null;
    if (!a) throw notFound();
    return a;
  }
}
