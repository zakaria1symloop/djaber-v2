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

/** Case / diacritic-insensitive comparison form (Latin + Arabic marks, tatweel). */
export const foldText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ًͯ-ْـ]/g, '')
    .toLowerCase();
const containsAny = (hay: string, needles: readonly string[]) => needles.find((n) => n.trim().length > 1 && hay.includes(foldText(n).trim())) ?? null;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word hit (a letter or digit next to it ends the match): « drug » in « drug test », not in « drugstore ». */
const containsWord = (hay: string, needles: readonly string[]) =>
  needles.find((n) => {
    const w = foldText(n).trim();
    return w.length > 1 && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(w)}(?:$|[^\\p{L}\\p{N}])`, 'u').test(hay);
  }) ?? null;

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
      manualReviewAll: (policy?.value as { manualReviewAll?: boolean } | null)?.manualReviewAll === true,
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
