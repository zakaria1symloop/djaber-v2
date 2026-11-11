// 04 §12 "Pre-screen" / MOD-02 — the free pre-screen of a moderation item: `aiScore ∈ [0,1]` + `aiFlags[]` + the market
// reference price (category median when available). The scorer is deterministic and local (platform rule lists, keyword
// patterns, price reference, image flags of the vision caption pass): no provider call, no credits — so it may run inside
// the submitting transaction; the `moderation-prescreen` job re-runs it when that inline pass failed (AT-MOD-10).
import { Injectable, Optional } from '@nestjs/common';
import { prisma, TenantContext, type Prisma, type Tx } from '@djaber/db';
import { MODERATION_AUTO_APPROVE_SCORE, type ModerationAiFlagView } from '@djaber/shared';
import { ConfigService } from '../../core/config/config.service';

export type PrescreenInput = {
  workspaceId: string;
  name: string;
  description: string | null;
  price: number;
  categoryId: string | null;
  categoryName: string | null;
  imageCount: number;
  imageFlags: (string | null)[];
  /** PV 22/10 PV1 — the keyword lists also scan the variant names, the search keywords and the image captions / alt texts. */
  variantNames?: string[];
  keywords?: string[];
  imageTexts?: string[];
};
/**
 * `manualReview`: the platform `moderation_policy.manualReviewAll` is on — the item never auto-approves (PV2).
 * `banned`: a word of the platform lists (blocked words, prohibited categories) appears as a whole word — the item is
 * rejected at once, nothing is left for a moderator to decide (tester log 26/10 UX-034).
 */
export type PrescreenResult = { aiScore: number; aiFlags: ModerationAiFlagView[]; marketReference: number | null; sensitive: boolean; manualReview?: boolean; banned?: BannedHit };
export type BannedHit = { code: 'blocked_word' | 'prohibited_category'; word: string; field: string };
export type AutoDecision = { approve: boolean; result: PrescreenResult };

// PV 09/11 « les mots interdits multi langue ar fr en »: accents and Arabic marks go (the hamza forms أ إ آ are plain alef
// after NFD, U+0653–U+0655), ة is ه and ى is ي — « خمرة » / « اسلحة » match the other spellings
export const foldText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ًͯ-ٕـ]/g, '')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
const containsAny = (hay: string, needles: readonly string[]) => needles.find((n) => n.trim().length > 1 && hay.includes(foldText(n).trim())) ?? null;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ARABIC = /[؀-ۿ]/;
// Arabic writes the article, « and », « with », « for »… and the plural / feminine endings onto the word itself
const AR_PREFIX = '(?:وال|فال|بال|كال|لل|ال|و|ف|ب|ك|ل)?';
const AR_SUFFIX = '(?:ات|ين|ون|ان|ه|ي)?';
// recette 09/11 UX-043: the French / English plural and feminine endings, as Arabic has its own (« armes », « drugs »,
// « interdite »). A word already ending in « e » only takes « s » (« arme » → « armes », never « armee » = « armée »).
const latinSuffix = (w: string) => (w.endsWith('e') ? '(?:s)?' : w.endsWith('s') || w.endsWith('x') ? '(?:es)?' : '(?:s|x|e|es)?');
/**
 * Whole-word hit (a letter or digit next to it ends the match): « drug » in « drug test » and « drugs », not in
 * « drugstore »; an Arabic word with its attached article / particles / endings too (« الخمر », « بالخمر », « مخدراتهم »).
 */
export const containsWord = (hay: string, needles: readonly string[]) =>
  needles.find((n) => {
    const w = foldText(n).trim();
    if (w.length <= 1) return false;
    const core = ARABIC.test(w) ? `${AR_PREFIX}${escapeRe(w.replace(/^ال/, ''))}${AR_SUFFIX}` : `${escapeRe(w)}${/\p{L}$/u.test(w) ? latinSuffix(w) : ''}`;
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${core}(?:$|[^\\p{L}\\p{N}])`, 'u').test(hay);
  }) ?? null;

/**
 * recette 09/11 (Badro, « VERY URGENT »): the name customers read — an agent's name / display name — never carries an
 * insult, even when the platform lists hold only scam words. Kept short and unambiguous (fr, en, darija, Arabic);
 * the super admin's lists (Modération › Mots & catégories interdits) are added to it.
 */
export const NAME_INSULTS = [
  // French
  'connard', 'connasse', 'salope', 'salaud', 'pute', 'putain', 'encule', 'enfoire', 'batard', 'merde', 'nique', 'niquer', 'fdp', 'ntm', 'pd', 'abruti', 'debile',
  'bite', 'couille', 'chienne', 'petasse', 'pouffiasse', 'grognasse', 'tapette', 'pede', 'gouine', 'negre', 'bougnoule', 'branleur', 'suceur', 'suceuse',
  'cocu', 'imbecile', 'cretin', 'gogol', 'trou du cul', 'cul', 'porno', 'sexe', 'nazi', 'hitler', 'terroriste',
  // English
  'fuck', 'fucker', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'whore', 'slut', 'motherfucker',
  'dick', 'cock', 'pussy', 'nigger', 'nigga', 'faggot', 'fag', 'wanker', 'twat', 'prick', 'dumbass', 'jackass', 'porn', 'sex', 'terrorist', 'scammer',
  // darija (Latin letters)
  'zebi', 'zbi', 'zebbi', 'qahba', 'kahba', '9a7ba', '9ahba', 'nikmok', 'nik mok', 'nik', 'tabon', 'mnayek', 'manyouk', 'mnyouk', 'hmar', '7mar', 'hmara', 'kelb', 'kelba', 'kalb',
  'zamel', 'zamal', 'khanzir', 'hallouf', '9awad', 'qawad', 'kawad', 'kess', 'ksomk', 'daech', 'daesh',
  // Arabic
  'قحبة', 'زبي', 'نيك', 'نيكمك', 'طبون', 'منايك', 'حمار', 'كلب', 'شرموطة', 'عاهرة', 'لعنة',
  'خنزير', 'حقير', 'وسخ', 'زامل', 'قواد', 'منيوك', 'كس', 'زب', 'عرص', 'شاذ', 'لوطي', 'كلبة', 'حمارة', 'طيز', 'سكس', 'داعش', 'ارهابي',
];

/*
 * Recette 11/11 (Badro: « you can still use some inappropriate names »): disguised spellings are read back before the
 * comparison — digits / symbols used as letters (« c0nnard », « conn@rd », « $alope »), letters spaced or dotted out
 * (« c.o.n.n.a.r.d »), letters repeated (« connnnard »), digits glued to the word (« zebi16 »). Darija numerals 7 / 9 stay
 * letters (« 9a7ba ») and the words of the lists written with digits are compared with the text as typed.
 */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '8': 'b', '@': 'a', $: 's', '€': 'e', '!': 'i', '|': 'i' };
const deLeet = (s: string) => s.replace(/[013458@$€!|]/g, (c) => LEET[c] ?? c);
const SEP = /[^\p{L}\p{N}]+/u;
/** « c . o n n a r d » ⇒ « connard »: runs of one-letter pieces are joined. */
const joinSingles = (s: string) => {
  const out: string[] = [];
  let run = '';
  for (const tok of s.split(SEP).filter(Boolean)) {
    if ([...tok].length === 1) run += tok;
    else {
      if (run) out.push(run);
      run = '';
      out.push(tok);
    }
  }
  if (run) out.push(run);
  return out.join(' ');
};
const squeeze = (s: string) => s.replace(/(\p{L})\1+/gu, '$1');
const stripDigits = (s: string) =>
  s
    .split(/([^\p{L}\p{N}]+)/u)
    .map((tok) => (/\p{L}/u.test(tok) ? tok.replace(/\d+/g, '') : tok))
    .join('');

/**
 * A word of 7 letters or more is caught glued inside another one too (« SuperConnard », « BigBastard »); shorter ones only
 * as words (« nique » must not hit « technique », « salope » not « salopette »). Each reading of the text (as typed,
 * symbols read as letters, spaced letters joined, digits removed — repeated letters squeezed in each) is compared.
 */
export const nameHit = (text: string, needles: readonly string[]) => {
  const raw = foldText(text);
  const plain = [raw, deLeet(raw), joinSingles(deLeet(raw)), stripDigits(raw)];
  const readings = [...new Set([...plain, ...plain.map(squeeze)])];
  const hit = (hay: string, w: string, long: boolean) => (long ? hay.split(SEP).some((tok) => tok.includes(w)) : !!containsWord(hay, [w]));
  return (
    needles.find((n) => {
      const w = foldText(n).trim();
      if (!w) return false;
      const long = w.length >= 7 && !ARABIC.test(w) && !/\s/.test(w);
      // a word written with digits (darija « 9a7ba ») or in Arabic: the text as typed, repeated letters squeezed
      if (ARABIC.test(w) || /\d/.test(w)) return [raw, squeeze(raw)].some((h) => hit(h, w, long) || hit(h, squeeze(w), long));
      return readings.some((h) => hit(h, w, long) || hit(h, squeeze(w), long));
    }) ?? null
  );
};

/** 04 §12: sensitive categories = electronics, health / supplements, children, cosmetics (editable by super admin). */
export const DEFAULT_SENSITIVE_KEYWORDS = [
  'électronique', 'electronics', 'électroménager', 'téléphone', 'smartphone', 'informatique', 'high-tech',
  'santé', 'health', 'complément', 'supplement', 'vitamine', 'parapharmacie',
  'enfant', 'kids', 'bébé', 'baby', 'jouet', 'toys',
  'cosmétique', 'cosmetics', 'maquillage', 'makeup', 'beauté', 'parfum', 'skincare',
  'إلكترونيات', 'الكترونيات', 'هواتف', 'صحة', 'مكملات', 'أطفال', 'اطفال', 'رضع', 'ألعاب', 'تجميل', 'مستحضرات',
];
const COUNTERFEIT_WORDING = ['copie', 'réplique', 'replica', 'first copy', 'master copy', 'high copy', 'qualité aaa', 'aaa+', 'aaa', 'contrefaçon', 'تقليد', 'كوبي', 'نسخة طبق الأصل'];
const HEALTH_CLAIMS = ['guérit', 'guérison', 'miracle', 'perte de poids garantie', 'maigrir vite', 'soigne', 'cure', 'traitement naturel', 'يعالج', 'علاج نهائي', 'شفاء'];
const WARRANTY_WORDS = ['garantie', 'warranty', 'ضمان'];
const ELECTRONICS = ['électronique', 'electronics', 'téléphone', 'smartphone', 'informatique', 'high-tech', 'إلكترونيات', 'الكترونيات', 'هواتف'];

/** Score weights per flag (sum subtracted from 1). A product with nothing but one photo scores 0.95 (auto-approvable). */
const WEIGHTS: Record<string, number> = {
  protected_brand: 0.5,
  prohibited_category: 0.7,
  blocked_word: 0.5,
  counterfeit_wording: 0.5,
  misleading_price: 0.3,
  logo_in_image: 0.3,
  health_claim: 0.3,
  single_image: 0.05,
  missing_warranty: 0.05,
};

type Rules = {
  brands: string[];
  prohibited: string[];
  words: string[];
  sensitive: string[];
  priceRefs: { value: string; price: number; categoryId: string | null }[];
  manualReviewAll?: boolean;
};

@Injectable()
export class ModerationPrescreenService {
  constructor(@Optional() private readonly config?: ConfigService) {}

  /** Platform lists (`ModerationRule` + `BlockedWord` platform rows + `PlatformSetting.sensitive_categories` / `moderation_policy`). */
  async rules(db: Tx | typeof prisma = prisma): Promise<Rules> {
    const [rules, words, setting, policy] = await TenantContext.runSystem(() =>
      Promise.all([
        db.moderationRule.findMany({ where: { isActive: true } }),
        db.blockedWord.findMany({ where: { workspaceId: null }, select: { word: true } }),
        db.platformSetting.findUnique({ where: { key: 'sensitive_categories' } }),
        db.platformSetting.findUnique({ where: { key: 'moderation_policy' } }),
      ]),
    );
    const of = (k: string) => rules.filter((r) => r.kind === k).map((r) => r.value);
    const stored = (setting?.value as { keywords?: string[] } | null)?.keywords;
    return {
      brands: of('protected_brand'),
      prohibited: of('prohibited_category'),
      words: [...of('blocked_word'), ...words.map((w) => w.word)],
      sensitive: [...(stored?.length ? stored : DEFAULT_SENSITIVE_KEYWORDS), ...of('sensitive_category')],
      priceRefs: rules.filter((r) => r.kind === 'price_reference' && r.referencePrice !== null).map((r) => ({ value: r.value, price: r.referencePrice!, categoryId: r.categoryId })),
      // PV 09/11 « les produits sont directement validés sans aucune modération »: every product waits for a super admin
      // unless the platform switched auto-approval on (Paramètres plateforme › Modération)
      manualReviewAll: (policy?.value as { manualReviewAll?: boolean } | null)?.manualReviewAll !== false,
    };
  }

  /** Median price of the approved products of the same category in the workspace (≥ 5 products), else null. */
  private async categoryMedian(db: Tx | typeof prisma, workspaceId: string, categoryId: string | null): Promise<number | null> {
    if (!categoryId) return null;
    const rows = await db.$queryRaw<{ median: number | null; n: bigint }[]>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "price")::float AS median, count(*) AS n
      FROM "Product" WHERE "workspaceId" = ${workspaceId}::uuid AND "categoryId" = ${categoryId}::uuid AND "deletedAt" IS NULL AND "moderationStatus" = 'approved'`;
    const r = rows[0];
    return r && Number(r.n) >= 5 && r.median ? Math.round(r.median) : null;
  }

  isSensitive(categoryName: string | null, rules: Pick<Rules, 'sensitive'>) {
    return !!categoryName && !!containsAny(foldText(categoryName), rules.sensitive);
  }

  /** Pure scoring of one item (rules already loaded). */
  score(p: PrescreenInput, rules: Rules, median: number | null): PrescreenResult {
    const flags: ModerationAiFlagView[] = [];
    const add = (code: string, message: string, field?: string) => {
      if (!flags.some((f) => f.code === code)) flags.push({ code, message, ...(field ? { field } : {}) });
    };
    const name = foldText(p.name);
    const desc = foldText(p.description ?? '');
    const cat = foldText(p.categoryName ?? '');
    // the other customer-facing / matching texts, in the order a hit is attributed to them
    const extra: [string, string][] = [
      ['variants', foldText((p.variantNames ?? []).join(' '))],
      ['keywords', foldText((p.keywords ?? []).join(' '))],
      ['images', foldText((p.imageTexts ?? []).filter(Boolean).join(' '))],
    ];
    const text = [name, desc, ...extra.map(([, t]) => t)].join(' ');
    const where = (needles: readonly string[], match = containsAny) =>
      match(name, needles) ? 'name' : match(desc, needles) ? 'description' : (extra.find(([, t]) => match(t, needles))?.[0] ?? 'description');
    const brand = containsAny(text, rules.brands);
    if (brand) add('protected_brand', brand, where(rules.brands));
    const prohibited = containsAny(`${text} ${cat}`, rules.prohibited);
    if (prohibited) add('prohibited_category', prohibited, containsAny(cat, rules.prohibited) ? 'categoryId' : where(rules.prohibited));
    const word = containsAny(text, rules.words);
    if (word) add('blocked_word', word, where(rules.words));
    const counterfeit = containsAny(text, COUNTERFEIT_WORDING);
    if (counterfeit) add('counterfeit_wording', counterfeit, where(COUNTERFEIT_WORDING));
    const health = containsAny(text, HEALTH_CLAIMS);
    if (health) add('health_claim', health, where(HEALTH_CLAIMS));
    const ref = rules.priceRefs.find((r) => (r.categoryId && r.categoryId === p.categoryId) || containsAny(text, [r.value]));
    const marketReference = ref?.price ?? median;
    if (marketReference && p.price > 0 && p.price < marketReference * 0.5) add('misleading_price', `${Math.round((p.price / marketReference - 1) * 100)} %`, 'price');
    if (p.imageFlags.includes('logo')) add('logo_in_image', 'logo', 'images');
    if (p.imageCount <= 1) add('single_image', String(p.imageCount), 'images');
    if (containsAny(cat, ELECTRONICS) && !containsAny(desc, WARRANTY_WORDS)) add('missing_warranty', 'warranty', 'description');
    const penalty = flags.reduce((s, f) => s + (WEIGHTS[f.code] ?? 0), 0);
    // UX-034: a whole-word hit of the platform lists rejects at once (a hit inside another word only flags, for a human)
    const bannedWord = containsWord(text, rules.words);
    const bannedCategory = bannedWord ? null : containsWord(`${text} ${cat}`, rules.prohibited);
    const banned: BannedHit | undefined = bannedWord
      ? { code: 'blocked_word', word: bannedWord, field: where(rules.words, containsWord) }
      : bannedCategory
        ? { code: 'prohibited_category', word: bannedCategory, field: containsWord(cat, rules.prohibited) ? 'categoryId' : where(rules.prohibited, containsWord) }
        : undefined;
    return {
      aiScore: Math.max(0, Math.round((1 - penalty) * 100) / 100),
      aiFlags: flags,
      marketReference: marketReference ?? null,
      sensitive: this.isSensitive(p.categoryName, rules),
      ...(rules.manualReviewAll ? { manualReview: true } : {}),
      ...(banned ? { banned } : {}),
    };
  }

  /** Loads what the scorer needs for a product and scores it. */
  async prescreenProduct(db: Tx | typeof prisma, productId: string, rules?: Rules): Promise<PrescreenResult> {
    const p = await db.product.findFirst({
      where: { id: productId },
      select: {
        workspaceId: true, name: true, description: true, price: true, categoryId: true, keywords: true,
        category: { select: { name: true } },
        images: { select: { moderationFlag: true, aiCaption: true, altText: true } },
        variants: { where: { deletedAt: null }, select: { name: true } },
      },
    });
    if (!p) throw new Error(`product ${productId} not found`);
    // dev / test hook (never in production): a name containing `prescreen-fail` makes the pre-screen fail (AT-MOD-10 state)
    if (this.config && !this.config.isProd && p.name.toLowerCase().includes('prescreen-fail')) throw new Error('prescreen unavailable (dev hook)');
    const r = rules ?? (await this.rules(db));
    const median = await this.categoryMedian(db, p.workspaceId, p.categoryId);
    return this.score(
      {
        workspaceId: p.workspaceId, name: p.name, description: p.description, price: p.price, categoryId: p.categoryId, categoryName: p.category?.name ?? null,
        imageCount: p.images.length, imageFlags: p.images.map((i) => i.moderationFlag),
        variantNames: p.variants.map((v) => v.name), keywords: p.keywords, imageTexts: p.images.flatMap((i) => [i.aiCaption ?? '', i.altText ?? '']),
      },
      r,
      median,
    );
  }

  /** 04 §12 "Auto-approval": `aiScore ≥ 0.9 ∧ trustLevel ∈ {standard, trusted} ∧ category ∉ sensitive`, never when the platform reviews every product (PV2). */
  static autoApprove(result: Pick<PrescreenResult, 'aiScore' | 'sensitive' | 'manualReview' | 'banned'>, trustLevel: string) {
    return !result.banned && !result.manualReview && result.aiScore >= MODERATION_AUTO_APPROVE_SCORE && (trustLevel === 'standard' || trustLevel === 'trusted') && !result.sensitive;
  }

  /**
   * recette 09/11 (Badro): the banned word of a name customers read (agent name / display name), else null — the platform
   * blocked words and prohibited categories, plus the common insults of {@link NAME_INSULTS}.
   */
  async bannedInName(text: string | null | undefined, rules?: Rules): Promise<string | null> {
    if (!text?.trim()) return null;
    const r = rules ?? (await this.rules());
    return nameHit(text, [...r.words, ...r.prohibited, ...NAME_INSULTS]);
  }

  /** Agent prompts (MOD-08): a platform blocked word or a protected brand in the compiled instructions. */
  async promptFlags(text: string, rules?: Rules): Promise<ModerationAiFlagView[]> {
    const r = rules ?? (await this.rules());
    const hay = foldText(text);
    const flags: ModerationAiFlagView[] = [];
    const word = containsAny(hay, r.words);
    if (word) flags.push({ code: 'blocked_word', message: word, field: 'customInstructions' });
    const brand = containsAny(hay, r.brands);
    if (brand) flags.push({ code: 'protected_brand', message: brand, field: 'customInstructions' });
    return flags;
  }
}

export type PrescreenJson = Prisma.InputJsonValue;
