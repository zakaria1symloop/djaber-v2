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
/**
 * Small words that are never search words (journey 16/11 J12-6: « mot de passe » matched every guide holding « de »):
 * articles, prepositions, pronouns and question words — fr / en / ar (folded).
 */
const STOP_WORDS = new Set([
  ...'le la les l un une des de du d au aux a et ou en dans par pour sur avec sans ce cet cette ces se sa son ses mon ma mes ton ta tes je tu il elle on nous vous ils elles me te y ne pas plus que qui quoi dont est sont etre faire comment pourquoi quand quel quelle quels quelles ou est-ce'.split(' '),
  ...'the a an of to in on at by for with and or is are be do does how what why when which my your i it'.split(' '),
  ...'في من على الى إلى عن مع و او أو كيف ماذا لماذا متى هل ما ان أن هذا هذه'.split(' ').map((w) => foldText(w)),
]);
/** The words of a search (2+ letters, or any word with a digit: « 2FA »), small words left out unless they are all there is. */
export const searchWords = (q: string): string[] => {
  const words = [...new Set(foldText(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 || /\d/.test(w)))];
  const meaningful = words.filter((w) => !STOP_WORDS.has(w));
  return meaningful.length ? meaningful : words;
};
const ARABIC = /[\u0600-\u06ff]/;
/**
 * A search word is found at the start of a word of the text (« credit » finds « crédits », « passe » does not find
 * « dépasser »); an Arabic word anywhere in a word (its article / prefixes: « طلب » finds « الطلبات »).
 */
const hasWord = (words: string[], hay: string, w: string) => (ARABIC.test(w) ? hay.includes(w) : words.some((x) => x.startsWith(w)));
/**
 * full-test 15/11 HELP-01: the search matches word by word without accents — every word first (« connecter Instagram »
 * finds « Connecter une page Facebook ou Instagram »); when no guide has them all, the guides holding most of them (more
 * than half the words, journey J12-6 — one common word alone no longer brings every guide).
 */
export function rankSearch<T>(items: T[], text: (x: T) => string, q: string): T[] {
  const words = searchWords(q);
  if (!words.length) return items;
  const scored = items.map((x) => {
    const hay = foldText(text(x));
    const hayWords = hay.split(/[^\p{L}\p{N}]+/u);
    return { x, n: words.filter((w) => hasWord(hayWords, hay, w)).length };
  });
  const all = scored.filter((s) => s.n === words.length);
  if (all.length) return all.map((s) => s.x);
  const min = Math.floor(words.length / 2) + 1;
  return scored.filter((s) => s.n > 0 && s.n >= min && s.n < words.length).sort((a, b) => b.n - a.n).map((s) => s.x);
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
