// 04-ai-pipeline §4.3 — the reply guard (weak-points audit 12/11, pattern 1; owner go-ahead 14/11).
//
// About fifty « never / always » sentences of the prompt were held by the model alone: the server checked the JSON shape,
// ≤ 5 cards and (since 12/11) handoffs, nothing of the reply TEXT. This module checks the text before it is stored or
// sent, against what the server knows this turn (the facts):
//   unknown_amount   an amount written as money that is no catalogue price, tool price / fee / total, shop-text amount,
//                    price × quantity (1–50), sum of such lines (+ a delivery fee) or sum of the other amounts of the reply
//   technical_leak   UUID, tool name, CODE_IN_CAPS, output-contract key, raw JSON, prompt marker
//   stock_count      how many units are in stock / left (STOCK_PRIVATE), except the number a tool gave
//   repeat_greeting  a greeting / self-introduction at the start of a reply when the AI already answered this visit
//   self_name        a personal name other than the moderated agent name (none approved ⇒ no personal name at all)
//   language_switch  full-test 15/11 AI-CHAT-04: a clear switch away from the customer's language (arabizi → French…)
//   moroccan_darija  Moroccan words (« chno », « dyal », « walakin ») in an arabizi / Arabic-script reply
//   script_mix       a Latin letter glued inside an Arabic word (« وnعاونك »): fixed by the server, no model turn
//   false_confession full-test 15/11 AI-CHAT-02: « coordonnées inventées », « commande enregistrée par erreur », « la
//                    commande n'existe pas » while an order of this conversation was placed
//   fee_missing      journey 16/11 J03-2: quote_delivery answered this turn but the reply gives none of its fees (« Merci
//                    3la sbr ! … » to « ch7al tawsil l setif ? »): one corrective turn, then the server adds the fee itself
//   contradicts_customer journey retest R2-3: « rani nestanna numéro ta3ek » right after the number, « ما فهمتش الولاية » after
//                    a phone — a field said not understood / awaited while the customer's message just gave it (or gave
//                    another field and nothing else): one corrective turn, then the sentence is dropped
// Pure: no I/O. Conservative by design — a false positive costs one corrective model turn and, at worst, a dropped sentence.
import { formatMoney } from '@djaber/shared';
import { GUARD_MARK } from './ai.constants';
import { detectLanguage, fixMoroccan, languageSwitched, moroccanIn, replyLanguage, SCRIPT_GLUE, withoutArabicValues, wrongDarijaIn, type AiLanguage } from './language';
import type { CatalogueProduct } from './catalogue.service';
import type { PromptContext } from './prompt/prompt.types';
import { TOOL_ALIASES, TOOL_DEFS } from './tools/tool-registry';
import { phonesIn } from './tools/order-confirmation';
import { fold as foldPlace, WILAYA_ALIASES } from './tools/wilaya-aliases';

export type GuardRule = 'unknown_amount' | 'technical_leak' | 'stock_count' | 'repeat_greeting' | 'self_name' | 'language_switch' | 'moroccan_darija' | 'script_mix' | 'false_confession' | 'fee_missing' | 'contradicts_customer';
/** Rules the server fixes itself: no corrective model turn for them alone. */
export const AUTO_FIX_RULES: readonly GuardRule[] = ['script_mix'];
export type LeakKind = 'uuid' | 'tool' | 'code' | 'key' | 'json' | 'marker';
/** `sentence` = index in `splitSentences(reply)`; `value` = the amount / count (never message text) */
export type GuardViolation = { rule: GuardRule; sentence: number; value?: number; kind?: LeakKind };
/** What is kept on `AiRun.meta.guard` (no message text). */
export type GuardOutcome = {
  violations: { rule: GuardRule; value?: number; kind?: LeakKind }[];
  /** the corrective model turn was asked */
  retried: boolean;
  /** violations of the answer finally checked (after the corrective turn) */
  remaining: { rule: GuardRule; value?: number; kind?: LeakKind }[];
  /** rewritten: the corrective answer passed · stripped: sentences / greeting removed · safe_sentence: nothing usable was left · kept: only a greeting / name remained, the reply was sent as is */
  action: 'rewritten' | 'stripped' | 'safe_sentence' | 'kept';
};

export type GuardFacts = {
  lang: AiLanguage;
  /** journey 16/11 J04-2: the language of the customer's current message read alone, when it has a clue (none ⇒ undefined) */
  messageLang?: AiLanguage;
  /** unit prices (catalogue products without variants, variants, ALSO lines, tool prices) — multiplied by a quantity 1–50 */
  prices: number[];
  /** amounts allowed as written (prices, tool numbers, shop-text numbers, free-delivery thresholds, discounts, the customer's amounts) */
  amounts: number[];
  /** delivery fees that may be added to a subtotal */
  fees: number[];
  /** free-delivery thresholds (« il vous manque X DA ») */
  thresholds: number[];
  /** unit counts a tool gave (ORDER_INSUFFICIENT_STOCK `available`…): the only counts the reply may state */
  stockCounts: number[];
  /** SKUs, order / tracking numbers, product and variant names (folded): never a technical code */
  tokens: string[];
  /** the moderated agent name (displayName, else name); null ⇒ the AI has no personal name */
  agentName: string | null;
  shopName: string;
  /** the AI (or the team) already answered in this conversation */
  answeredBefore: boolean;
  /** this message opens a new visit (NEW_VISIT) or the first one after the team gave the thread back (RESUMED) */
  freshStart: boolean;
  /** the customer's current message starts with a greeting: greeting back is fine */
  customerGreets: boolean;
  /** « name — price DA » lines for the corrective instruction */
  priceList: string[];
  /** numbers of the orders a tool placed in this conversation (this turn or earlier turns) */
  ordersPlaced?: string[];
  /** journey 16/11 J03-2: the successful quote_delivery answers of THIS turn (not set on a handoff answer) */
  quotes?: QuoteFact[];
  /** journey retest R2-3: the customer's words of the message(s) being answered */
  customerText?: string;
  /** journey retest R2-3: the order fields the answer reports as given (its `customer`) — compared with `customerText` */
  customerFields?: Partial<Record<OrderField, string>>;
};
export type OrderField = 'name' | 'phone' | 'wilaya' | 'commune' | 'address';
/** What a successful quote_delivery answered: the reply must give one of its fees (or say it is free). */
export type QuoteFact = { wilaya: string; isStopdesk: boolean; fee: number; free: boolean; stopdeskFee: number | null };

// --- text helpers -------------------------------------------------------------------------------------------------------------
/** Lower case, Latin accents and Arabic vowel marks removed, hamza / tā' marbūṭa folded, Arabic-Indic digits → Latin. */
export const foldGuard = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u0655\u0670\u0640]/g, '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/\u066c/g, ',')
    .replace(/\u066b/g, '.')
    .replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
    .replace(/[\u2019`\u00b4\u02bc]/g, "'")
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
/** Same length as the input (positions map 1:1): for the greeting strip. */
const lightFold = (s: string) => s.toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[’`´ʼ]/g, "'");

/** Sentences with their trailing punctuation and spaces: `splitSentences(t).join('') === t`. « 4.500 DA » is not split. */
export const splitSentences = (text: string): string[] => {
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?؟…]+(?=\s|$)\s*|\n+/g)) {
    const end = m.index! + m[0].length;
    if (end > start) out.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
};

const B = String.raw`(?<![\p{L}\p{N}_])`;
const E = String.raw`(?![\p{L}\p{N}_])`;

// --- money ----------------------------------------------------------------------------------------------------------------------
const CURRENCY = String.raw`(?:dzd|da|dinars?|دج|د\.ج|د ج|دينارا?|دنانير)`;
const MONEY = new RegExp(String.raw`(?<![\p{L}\p{N}.,])(\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s?-?\s*${CURRENCY}(?![\p{L}])`, 'gu');
/** Amounts written as money in a (folded) text: « 4500da », « 4 500 DA », « 4.500 DA », « ٤٥٠٠ دج », « 4500 dinars ». */
export const moneyAmounts = (folded: string): number[] =>
  [...folded.matchAll(MONEY)].map((m) => Number(m[1]!.replace(/[ .,]/g, '')) + (m[2] ? Number(m[2]) / 10 ** m[2].length : 0));
/** Every number of a text (digits, any grouping), for shop texts and the customer's words. */
const numbersIn = (folded: string): number[] => [...folded.matchAll(/(?<![\p{N}])(\d{1,3}(?:[ .,]\d{3})+|\d+)(?![\p{N}])/gu)].map((m) => Number(m[1]!.replace(/[ .,]/g, ''))).filter((n) => Number.isFinite(n));

const QTY_MAX = 50;
type Compiled = { amounts: Set<number>; lines: Set<number>; lineList: number[]; fees: number[]; thresholds: number[] };
const cache = new WeakMap<GuardFacts, Compiled>();
const compile = (f: GuardFacts): Compiled => {
  const hit = cache.get(f);
  if (hit) return hit;
  const prices = [...new Set(f.prices.filter((p) => p > 0 && Number.isInteger(p)))];
  const lines = new Set<number>();
  for (const p of prices) for (let q = 1; q <= QTY_MAX; q++) lines.add(p * q);
  const c = { amounts: new Set(f.amounts), lines, lineList: [...lines], fees: [...new Set([0, ...f.fees.filter((x) => x > 0)])].slice(0, 80), thresholds: [...new Set(f.thresholds.filter((x) => x > 0))] };
  cache.set(f, c);
  return c;
};

/** Does some subset (≥ 2 values, or ≥ 1 value + a fee) of `others` sum to `a`? (≤ 12 values) */
const subsetSum = (a: number, others: number[], fees: number[]): boolean => {
  const vals = others.filter((v) => v > 0 && v < a).slice(0, 12);
  const n = vals.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) {
      sum += vals[i]!;
      count++;
    }
    if (count >= 2 && sum === a) return true;
    if (fees.some((fee) => fee > 0 && sum + fee === a)) return true;
  }
  return false;
};

/** The reply speaks of free delivery: « il vous manque X DA » against the threshold is then plausible. */
const FREE_WORDS = /gratuit|offert|free|مجان|batel|bla\s*mk?ass/u;

export const amountAllowed = (a: number, facts: GuardFacts, others: number[] = [], o: { freeDelivery?: boolean } = {}): boolean => {
  if (a === 0) return true;
  const c = compile(facts);
  if (c.amounts.has(a) || c.lines.has(a)) return true;
  for (const fee of c.fees) if (fee && a > fee && c.lines.has(a - fee)) return true;
  // « il vous manque 1 500 DA pour la livraison gratuite » (only when the reply speaks of it: it would allow too much)
  if (o.freeDelivery) for (const t of c.thresholds) if (t > a && (c.lines.has(t - a) || c.amounts.has(t - a))) return true;
  // two order lines (+ a fee) not written separately
  for (const s of c.lineList) {
    if (s >= a) continue;
    for (const fee of c.fees) if (a - s - fee > 0 && c.lines.has(a - s - fee)) return true;
  }
  // a total of the amounts written in the same reply (recap lines + fee)
  return subsetSum(a, others, c.fees);
};

// --- technical leaks ------------------------------------------------------------------------------------------------------------
const TOOL_NAMES = [...Object.keys(TOOL_DEFS), ...Object.keys(TOOL_ALIASES)];
const TOOL_RE = new RegExp(`${B}(?:${TOOL_NAMES.join('|')})${E}`, 'u');
const UUID_RE = /(?<![\p{L}\p{N}])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\p{L}\p{N}])/iu;
const CODE_RE = /(?<![\p{L}\p{N}_-])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?![\p{L}\p{N}_-])/gu;
/** Output-contract and tool-result keys (camelCase: never a word of a customer reply). */
const CONTRACT_KEYS = ['productCards', 'productPhotos', 'statusDetail', 'handoffWords', 'recommendedId', 'sourceId', 'customerConfirmed', 'replacesOrder', 'wilayaId', 'communeId', 'productId', 'variantId', 'orderId', 'isStopdesk', 'stopdeskId', 'stopdeskFee', 'deliveryFee', 'freeFrom', 'trackingUrl', 'trackingNumber', 'duplicateOf', 'beyondStock', 'availableAllVariants', 'availableQuantity', 'otherVariants', 'availableVariants', 'suggestInsight', 'clientPhone', 'clientName', 'secondPhone', 'hasVariants', 'unitPrice', 'orderNumber', 'lastEvent', 'paymentOptions'];
const KEY_RE = new RegExp(`${B}(?:${CONTRACT_KEYS.join('|')})${E}`, 'u');
const JSON_RE = /\{\s*"[A-Za-z_]+"\s*:|"(?:reply|status|intent|confidence|language|evidence|productCards)"\s*:/;
const MARKER_RE = /\[(?:ID|VID):|(?<![\p{L}])VID:|\[tool (?:call|result)|\bIMAGE RESULT\b|\[NEW VISIT|\[BACK TO YOU|\[human:|\bstatus\s*=\s*[A-Z]{3,}|\bstatusDetail\b/u;

export const leakIn = (sentence: string, tokens: Set<string> = new Set()): LeakKind | null => {
  // a link (the tracking page `/s/<token>`) is sent as it is
  const s = sentence.replace(/https?:\/\/\S+/g, ' ');
  if (UUID_RE.test(s)) return 'uuid';
  if (TOOL_RE.test(s)) return 'tool';
  if (KEY_RE.test(s)) return 'key';
  if (JSON_RE.test(s)) return 'json';
  if (MARKER_RE.test(s)) return 'marker';
  for (const m of s.matchAll(CODE_RE)) if (!tokens.has(foldGuard(m[0])) && ![...tokens].some((t) => t.includes(foldGuard(m[0])))) return 'code';
  return null;
};

// --- stock counts ---------------------------------------------------------------------------------------------------------------
const N = String.raw`(\d{1,4})(?![\p{N}])`;
const UNIT = String.raw`(?:pieces?|pcs|unites?|exemplaires?|paires?|units?|pairs?|قطع|قطعه|حبات|حبه|وحدات|وحده|7abat|habat|7aba|haba|7bat)`;
const ONLY_FR = String.raw`(?:plus\s+)?(?:que\s+|seulement\s+|encore\s+|juste\s+|uniquement\s+)?`;
/** A word right after the number that makes it no stock count (time, variety, money, percentage). */
const NOT_STOCK = new RegExp(
  String.raw`^\s*(?:%|h${E}|j${E}|min${E}|jours?|heures?|semaines?|mois|minutes?|ans?|days?|hours?|weeks?|months?|years?|tailles?|pointures?|couleurs?|coloris|modeles?|styles?|sizes?|colou?rs?|models?|designs?|wilayas?|${CURRENCY}${E}|ايام|يوم|ساعات|ساعه|اسابيع|اسبوع|شهر|الوان|لون|مقاسات|قياسات|مقاس|احجام|موديلات|ayam|iyam|ayyam|sa3at|sa3a|swaye3|jma3|chhar|couleur|taille)`,
  'u',
);
/** After « we have N » / « عندنا N » / « kayen N »: only a unit, a stock word or the end make it a count. */
const COUNT_TAIL = new RegExp(String.raw`^\s*(?:$|[.!?؟،,;:)…]|${UNIT}${E}|left|in\s+stock|en\s+stock|disponibles?|dispo${E}|برك|فقط|bark|berk|متوفر|باقي|ba9yin)`, 'u');
/** The number right after these words is a size / model, not a count (« taille 38 en stock »). */
const SIZE_BEFORE = /(?<![\p{L}\p{N}])(?:taille|pointure|size|mesure|numero|n°|no|modele|model|ref|reference|la|le|en|مقاس|قياس|المقاس|القياس|نمره|رقم|t)\s*$/u;

const STOCK_WORD = /^\s*(?:left|remaining|available|in\s+stock)(?![\p{L}])/u;
type StockPattern ={ re: RegExp; tail: 'free' | 'not_stock' | 'count' };
const P = (src: string, tail: StockPattern['tail']): StockPattern => ({ re: new RegExp(src, 'gu'), tail });
const STOCK_PATTERNS: StockPattern[] = [
  // fr
  P(String.raw`${B}il\s+(?:ne\s+)?(?:nous\s+)?en\s+reste\s+${ONLY_FR}${N}`, 'not_stock'),
  P(String.raw`${B}il\s+(?:ne\s+)?(?:nous\s+)?reste\s+${ONLY_FR}${N}`, 'count'),
  P(String.raw`${B}(?:nous\s+|on\s+)?en\s+(?:avons|a)\s+${ONLY_FR}${N}`, 'not_stock'),
  P(String.raw`${B}il\s+y\s+en\s+a\s+${ONLY_FR}${N}`, 'not_stock'),
  P(String.raw`${B}${N}\s+${UNIT}\s+(?:sont\s+)?(?:encore\s+|toujours\s+)?(?:disponibles?|dispo|en\s+stock|restante?s?|qui\s+restent|de\s+dispo)${E}`, 'free'),
  P(String.raw`${B}${N}\s+(?:${UNIT}\s+)?en\s+stock${E}`, 'free'),
  P(String.raw`${B}stock\s*(?::|=|de|restant\s*:?|disponible\s*:?)\s*${N}`, 'free'),
  P(String.raw`${B}${N}\s+derniere?s?\s+${UNIT}`, 'free'),
  P(String.raw`${B}quantites?\s+(?:disponibles?|en\s+stock|restantes?)\s*:?\s*${N}`, 'free'),
  // en
  P(String.raw`${B}only\s+${N}\s+(?:[a-z]+\s+)?(?:left|remaining|in\s+stock)${E}`, 'not_stock'),
  P(String.raw`${B}${N}\s+(?:[a-z]+\s+)?(?:left\s+in\s+stock|in\s+stock|left|remaining)${E}`, 'not_stock'),
  P(String.raw`${B}we\s+(?:still\s+|only\s+|just\s+)*have\s+(?:only\s+|just\s+|still\s+)?${N}`, 'count'),
  P(String.raw`${B}there\s+(?:are|is)\s+(?:only\s+|just\s+|still\s+)?${N}\s+(?:[a-z]+\s+)?(?:left|remaining|in\s+stock|available)${E}`, 'not_stock'),
  P(String.raw`${B}stock\s*(?::|=|of)\s*${N}`, 'free'),
  // ar / darija (folded)
  P(String.raw`${B}(?:باقي|باقيين|باقيه|بقاو|بقات|بقا|بقي|يبقي|تبقي|متبقي|متبقيه|مازال|مازالو|مازالوا|مازالت|مزال)\s+(?:غير\s+|برك\s+|فقط\s+|حتي\s+|عندنا\s+)?${N}`, 'not_stock'),
  P(String.raw`${B}(?:كاين|كاينين|كاينه|عندنا|متوفر|متوفره|متوفرين|متاح|متاحه|موجود|موجوده|موجودين)\s+(?:غير\s+|برك\s+|فقط\s+|حتي\s+)?${N}`, 'count'),
  P(String.raw`${B}${N}\s+${UNIT}\s+(?:برك\s+|فقط\s+|غير\s+)?(?:باقي|باقيين|باقيه|بقاو|متوفره|متوفرين|متوفر|متاحه|متاحين|موجودين|موجوده|في\s+المخزون|فالستوك|في\s+الستوك|ف\s+الستوك|برك|فقط)`, 'free'),
  P(String.raw`${B}(?:المخزون|الستوك|ستوك)\s*:?\s*${N}`, 'free'),
  P(String.raw`${B}${N}\s+(?:${UNIT}\s+)?(?:في\s+المخزون|فالستوك|في\s+الستوك)`, 'free'),
  // arabizi
  P(String.raw`${B}(?:ba9i|baqi|ba9yin|baqyin|ba9ya|b9aw|bqaw|b9at|bqat|b9a|mazal|mazalou|mazalo|mazalet|mazel|mzal)\s+(?:ghir\s+|gher\s+|bark\s+|berk\s+|ghi\s+)?${N}`, 'not_stock'),
  P(String.raw`${B}(?:kayen|kayn|kaynin|kaynine|3andna|3endna|andna)\s+(?:ghir\s+|gher\s+|bark\s+|berk\s+)?${N}`, 'count'),
  P(String.raw`${B}${N}\s+${UNIT}\s+(?:ba9yin|baqyin|b9aw|bqaw|bark|berk|kaynin|disponibles?|dispo)${E}`, 'free'),
];

/** Unit counts stated in a (folded) sentence. */
export const stockCounts = (folded: string): number[] => {
  const out: number[] = [];
  for (const p of STOCK_PATTERNS) {
    for (const m of folded.matchAll(p.re)) {
      const n = Number(m[1]);
      const at = m.index! + m[0].lastIndexOf(m[1]!);
      const tail = folded.slice(at + m[1]!.length);
      if (SIZE_BEFORE.test(folded.slice(0, at))) continue;
      // « only 2 days left », « the 2 remaining colours »: the word after « left / remaining » counts too
      const after = STOCK_WORD.exec(tail);
      if (p.tail === 'not_stock' && (NOT_STOCK.test(tail) || (after && NOT_STOCK.test(tail.slice(after[0].length))))) continue;
      if (p.tail === 'count' && !COUNT_TAIL.test(tail)) continue;
      if (p.tail === 'count' && NOT_STOCK.test(tail)) continue;
      out.push(n);
    }
  }
  return out;
};

// --- greetings ------------------------------------------------------------------------------------------------------------------
const GREETINGS = [
  're\\s*bonjour', 'bonjour', 'bonsoir', 'salut', 'coucou', 'bienvenue', 'hello', 'hi', 'hey', 'good\\s+(?:morning|afternoon|evening)', 'welcome', 'greetings',
  'و?عليكم\\s+السلام', 'السلام\\s+عليكم', 'سلام\\s+عليكم', 'سلام', 'مرحبا\\s+بيك', 'مرحبتين', 'مرحبا', 'اهلا\\s+و\\s*سهلا', 'اهلا', 'اهلين', 'هلا', 'صباح\\s+الخير', 'مساء\\s+الخير', 'صباح\\s+النور', 'مساء\\s+النور',
  'wa?\\s*(?:3|a)?l[ia]?[iy]?k[ou]u?m\\s+(?:e?s+)?salam', 'salam(?:ou?|u)?\\s+(?:3|a)?l[ia]?[iy]?k[ou]u?m', 'assalam(?:ou|u)?', 'salam', 'slm', 'salem', 'ahlan', 'ahla', 'ahlin', 'marhba', 'marhaba', 'mar7ba', 'sba[7h]\\s*(?:el|l)\\s*khir', 'msa\\s*(?:el|l)\\s*khir',
];
const GREETING_RE = new RegExp(`^(?:${GREETINGS.join('|')})(?=$|[\\s,!.?؟،:;)\\-—👋🙏😊🌸])`, 'u');
const INTRO_RE = /^(?:je suis|moi c'est|ici|i am|i'm|this is|ana|انا|معاك|m3ak)(?=\s)/u;
const ASSISTANT_RE = /assistant|conseill|vendeu|مساعد|البائع|mosa3id|virtual|virtuel/u;
const LEAD = /^[\s\p{P}\p{S}\p{Emoji_Presentation}]*/u;

/** Length (in the original text) of a greeting / self-introduction opening `text`, 0 when none. */
export const greetingAt = (text: string, agentName?: string | null): number => {
  const lead = LEAD.exec(text)?.[0].length ?? 0;
  const t = lightFold(text.slice(lead));
  const g = GREETING_RE.exec(t);
  if (g) return lead + g[0].length;
  if (INTRO_RE.test(t)) {
    const first = splitSentences(text.slice(lead))[0] ?? '';
    const f = foldGuard(first);
    const name = agentName ? foldGuard(agentName).split(/\s+/)[0] : null;
    if (ASSISTANT_RE.test(f) || (name && name.length > 1 && f.includes(name))) return lead + first.length;
  }
  return 0;
};

// --- self name ------------------------------------------------------------------------------------------------------------------
const NAME = String.raw`([\p{L}][\p{L}'-]*)`;
const CAP_NAME = String.raw`(\p{Lu}[\p{L}'-]*)`;
const SELF_NAME_RES: RegExp[] = [
  new RegExp(String.raw`${B}[Jj]e\s+m'?\s*appelle\s+${NAME}`, 'u'),
  new RegExp(String.raw`${B}[Mm]on\s+(?:pr[eé])?nom\s+(?:est|c'est)\s+${NAME}`, 'u'),
  new RegExp(String.raw`${B}[Mm]oi\s*,?\s*c'est\s+${NAME}`, 'u'),
  new RegExp(String.raw`${B}[Jj]e\s+suis\s+${CAP_NAME}`, 'u'),
  new RegExp(String.raw`${B}(?:[Cc]'est|[Ii]ci)\s+${CAP_NAME}\s*,?\s+(?:de|du|d'|from)\s+(?:la\s+|l'\s*)?(?:boutique|magasin|shop|store|[eé]quipe|team)`, 'u'),
  new RegExp(String.raw`${B}[Mm]y\s+name\s+is\s+${NAME}`, 'u'),
  new RegExp(String.raw`${B}(?:I'm|I\s+am|i'm)\s+${CAP_NAME}`, 'u'),
  new RegExp(String.raw`${B}[Tt]his\s+is\s+${CAP_NAME}\s+(?:from|at|of)${E}`, 'u'),
  new RegExp(String.raw`(?:اسمي|إسمي|سميتي|اسمى)\s+(\p{L}+)`, 'u'),
  new RegExp(String.raw`${B}(?:معاك|معاكم|معك)\s+(\p{L}+)\s+(?:من|م)(?=\s)`, 'u'),
  new RegExp(String.raw`${B}(?:أنا|انا)\s+(\p{L}+)\s*[،,]?\s*(?:مساعد|المساعد|مساعدة|المساعدة|البائع|البائعة)`, 'u'),
  new RegExp(String.raw`${B}(?:smiti|esmi|ismi|asmi)\s+${NAME}`, 'iu'),
  new RegExp(String.raw`${B}m3ak(?:om)?\s+${NAME}\s+(?:men|mn|ta3|de)${E}`, 'iu'),
  new RegExp(String.raw`${B}ana\s+${NAME}\s*,?\s*(?:l'?assistant|assistante|mosa3id)`, 'iu'),
];
/** Words after « je suis / I'm / ana… » that are no personal name. */
const NOT_A_NAME = new Set(
  [
    'assistant', 'assistante', "l'assistant", "l'assistante", 'votre', 'ton', 'ta', 'la', 'le', 'un', 'une', 'ici', 'the', 'your', 'a', 'an', 'virtual', 'virtuel', 'virtuelle', 'conseiller', 'conseillere', 'vendeur', 'vendeuse',
    'here', 'sorry', 'happy', 'glad', 'afraid', 'not', 'sure', 'back', 'available', 'desole', 'desolee', 'ravi', 'ravie', 'heureux', 'heureuse', 'content', 'contente', 'disponible', 'en', 'a', 'la', 'robot', 'bot', 'chatbot',
    'ia', 'ai', "l'ia", 'mosa3id', 'مساعد', 'المساعد', 'مساعده', 'المساعده', 'البائع', 'البائعه', 'روبو', 'روبوت', 'هنا', 'the', 'shop', 'store', 'boutique', 'equipe', 'team', 'still', 'just', 'only', 'also', 'always', 'currently',
  ].map((w) => foldGuard(w)),
);

/** The personal names the reply gives the AI that are not the approved one (folded). */
export const selfNames = (sentence: string, facts: Pick<GuardFacts, 'agentName' | 'shopName' | 'tokens'>): string[] => {
  const allowed = new Set([...(facts.agentName ? foldGuard(facts.agentName).split(/[^\p{L}\p{N}']+/u) : []), ...foldGuard(facts.shopName).split(/[^\p{L}\p{N}']+/u)].filter(Boolean));
  const out: string[] = [];
  const text = sentence.replace(/[’`´ʼ]/g, "'");
  const arabic = (s: string) => /[\u0600-\u06ff]/.test(s);
  for (const re of SELF_NAME_RES) {
    const m = re.exec(text);
    if (!m) continue;
    const name = foldGuard(m[1]!).replace(/^l'/, '');
    if (!name || NOT_A_NAME.has(name) || NOT_A_NAME.has(foldGuard(m[1]!)) || allowed.has(name) || facts.tokens.some((t) => t.split(/\s+/).includes(name))) continue;
    // the approved name written in the other script (« Sara » / « سارة ») cannot be compared: not counted
    if (facts.agentName && arabic(facts.agentName) !== arabic(name)) continue;
    out.push(name);
  }
  return out;
};

/** journey 16/11 J03-2: the quote_delivery answers of this turn (`tools` with their canonical names). */
export const quoteFacts = (tools: { name: string; result: unknown }[]): QuoteFact[] =>
  tools.flatMap((t) => {
    const r = t.result as { ok?: unknown; fee?: unknown; free?: unknown; wilayaName?: unknown; isStopdesk?: unknown; stopdeskFee?: unknown; stopdeskAvailable?: unknown } | null;
    if (t.name !== 'quote_delivery' || r?.ok !== true || typeof r.fee !== 'number') return [];
    return [{ wilaya: typeof r.wilayaName === 'string' ? r.wilayaName : '', isStopdesk: r.isStopdesk === true, fee: r.fee, free: r.free === true, stopdeskFee: typeof r.stopdeskFee === 'number' && r.stopdeskAvailable !== false ? r.stopdeskFee : null }];
  });
/** The reply gives a fee of one of the quotes (the number with or without « DA », Arabic digits too) or says the delivery is free. */
export const feeGiven = (reply: string, quotes: QuoteFact[]): boolean => {
  const folded = foldGuard(reply);
  const nums = new Set(numbersIn(folded));
  return quotes.some((q) => [q.isStopdesk ? null : q.fee, q.isStopdesk ? q.fee : q.stopdeskFee].some((f) => f !== null && f > 0 && nums.has(f)) || ((q.free || q.fee === 0) && FREE_WORDS.test(folded)));
};

// --- contradicting the customer (journey retest R2-3) ---------------------------------------------------------------------------
const FIELD_WORDS: Record<OrderField, string> = {
  phone: String.raw`num(?:ero)?|tel(?:ephone)?|phone|number|nemra|ra9m|raqm|رقم|رقمك|الرقم|تليفون|تليفونك|التليفون|الهاتف|هاتفك`,
  wilaya: String.raw`wilaya|ولايه|الولايه|ولايتك`,
  commune: String.raw`commune|baladiya|baladia|بلديه|البلديه|بلديتك`,
  address: String.raw`adresse|l'adresse|ladresse|address|عنوان|عنوانك|العنوان`,
  name: String.raw`nom|name|smitek|smiya|esmek|اسم|اسمك|الاسم`,
};
/** « I did not understand X » (folded text: accents and Arabic marks removed, ى → ي, ة → ه). */
const NOT_UNDERSTOOD = String.raw`n'?ai\s+pas\s+(?:bien\s+|tres\s+bien\s+)?(?:compris|saisi|reconnu)|ne\s+(?:comprends|reconnais)\s+pas|(?:did\s*n'?t|didnt|did\s+not|could\s*n'?t|could\s+not|can'?t|cannot)\s+(?:understand|get|catch|recogni[sz]e)|ma\s*fh[ae]mt(?:ch|ech|ich)|ما\s*فهمتش|ما\s+فهمت|لم\s+افهم|ما\s+عرفتش`;
/** « I am waiting for X ». */
const AWAITING = String.raw`j'?attends?|en\s+attente\s+d|waiting\s+for|n[e]?st[ae]nn?a|نستن[اي]|في\s+انتظار|بانتظار|ننتظر`;
const CLAIM_RES: { kind: 'not_understood' | 'awaiting'; field: OrderField; re: RegExp }[] = (['not_understood', 'awaiting'] as const).flatMap((kind) =>
  (Object.keys(FIELD_WORDS) as OrderField[]).map((field) => ({ kind, field, re: new RegExp(String.raw`(?:${kind === 'not_understood' ? NOT_UNDERSTOOD : AWAITING})[^.!?؟\n]{0,40}?${B}(?:${FIELD_WORDS[field]})${E}`, 'u') })),
);
/** The order fields a sentence says it did not understand / is waiting for. */
export const fieldClaims = (sentence: string): { kind: 'not_understood' | 'awaiting'; field: OrderField }[] => {
  const f = foldGuard(sentence);
  return CLAIM_RES.filter((c) => c.re.test(f)).map(({ kind, field }) => ({ kind, field }));
};
/** The wilaya spellings customers type (letters only: « 06 » is no wilaya inside a phone number). */
const PLACE_ALIASES = Object.keys(WILAYA_ALIASES).filter((a) => /\p{L}/u.test(a));
const placeWords = (t: string) => ` ${foldGuard(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
/** The order fields the customer's message gives: a valid phone, a wilaya name, the answer's own `customer` values written in it. */
export const givenFields = (customerText: string, fields: GuardFacts['customerFields'] = {}): Set<OrderField> => {
  const out = new Set<OrderField>();
  if (phonesIn(customerText).size) out.add('phone');
  const w = placeWords(customerText);
  for (const k of ['name', 'wilaya', 'commune', 'address'] as const) {
    const v = fields[k]?.trim();
    if (v && v.length >= 2 && w.includes(placeWords(v))) out.add(k);
  }
  const padded = ` ${foldPlace(customerText)} `;
  if (PLACE_ALIASES.some((a) => padded.includes(` ${a} `))) out.add('wilaya');
  return out;
};
/** How many words the customer's message has once its phone numbers and the given values are taken out (« 0661234567 » ⇒ 0). */
const restWords = (customerText: string, fields: GuardFacts['customerFields'] = {}) => {
  let w = placeWords(customerText.replace(/\+?\d[\d\s.\-/]{7,}\d/g, ' '));
  for (const v of Object.values(fields)) if (v && v.trim().length >= 2) w = w.replace(placeWords(v), ' ');
  return w.trim().split(/\s+/).filter(Boolean).length;
};

// --- the check --------------------------------------------------------------------------------------------------------------------
export function checkReply(reply: string, facts: GuardFacts): GuardViolation[] {
  if (!reply.trim()) return [];
  const parts = splitSentences(reply);
  const tokens = new Set(facts.tokens);
  const out: GuardViolation[] = [];
  const money = parts.flatMap((s, i) => moneyAmounts(foldGuard(s)).map((value) => ({ value, sentence: i })));
  const freeDelivery = FREE_WORDS.test(foldGuard(reply));
  money.forEach((m, k) => {
    const others = money.filter((_, j) => j !== k).map((x) => x.value);
    if (!amountAllowed(m.value, facts, others, { freeDelivery })) out.push({ rule: 'unknown_amount', sentence: m.sentence, value: m.value });
  });
  const counts = new Set([0, ...facts.stockCounts]);
  parts.forEach((s, i) => {
    const kind = leakIn(s, tokens);
    if (kind) out.push({ rule: 'technical_leak', sentence: i, kind });
    for (const n of new Set(stockCounts(foldGuard(s)))) if (!counts.has(n)) out.push({ rule: 'stock_count', sentence: i, value: n });
    if (selfNames(s, facts).length) out.push({ rule: 'self_name', sentence: i });
  });
  if (facts.answeredBefore && !facts.freshStart && !facts.customerGreets && greetingAt(reply, facts.agentName) > 0) out.push({ rule: 'repeat_greeting', sentence: 0 });
  // full-test 15/11 AI-CHAT-04 (proposal 5): the language rules (13, 14, 16) checked at run time
  // journey 16/11 J04-2: the conversation's language is kept on a message with one clue only (« Price? »): a reply in the
  // language of that message itself is not a switch
  if (languageSwitched(facts.lang, reply) && !(facts.messageLang && facts.messageLang !== facts.lang && !languageSwitched(facts.messageLang, reply))) out.push({ rule: 'language_switch', sentence: 0 });
  // journey 16/11 J04-3: checked whatever the language verdict (« numéro dyal téléphone » in a French-looking arabizi reply),
  // with the wrong darija « ch7al smitek » (« how much » used for « what »)
  const darijaReply = facts.lang === 'arabizi' || facts.lang === 'ar' || facts.lang === 'mixed' || ['arabizi', 'ar'].includes(replyLanguage(reply) ?? '');
  if (darijaReply && (moroccanIn(reply) || wrongDarijaIn(reply))) out.push({ rule: 'moroccan_darija', sentence: 0 });
  if (new RegExp(SCRIPT_GLUE.source, 'u').test(reply)) out.push({ rule: 'script_mix', sentence: 0 });
  // full-test 15/11 AI-CHAT-02 (proposal 3): a placed order is never « invented », « by mistake » or « nonexistent »
  if (facts.ordersPlaced?.length) parts.forEach((s, i) => {
    if (FALSE_CONFESSION.test(foldGuard(s))) out.push({ rule: 'false_confession', sentence: i });
  });
  // journey 16/11 J03-2: the fee the tool returned this turn is the answer — never dropped for a « merci pour ta patience »
  if (facts.quotes?.length && !feeGiven(reply, facts.quotes)) out.push({ rule: 'fee_missing', sentence: 0 });
  // journey retest R2-3: never « not understood » / « waiting for » a field the customer's message just gave — nor « not
  // understood » another field when the message only gave one (« ما فهمتش الولاية » after a phone: no wilaya was asked)
  if (facts.customerText?.trim()) {
    const given = givenFields(facts.customerText, facts.customerFields);
    if (given.size) {
      const onlyFields = restWords(facts.customerText, facts.customerFields) <= 2;
      parts.forEach((s, i) => {
        if (fieldClaims(s).some((c) => given.has(c.field) || (c.kind === 'not_understood' && onlyFields))) out.push({ rule: 'contradicts_customer', sentence: i });
      });
    }
  }
  return out;
}

/** Folded phrases of a false confession about an order the tools did place (fr / en / arabizi / Arabic script). */
const FALSE_CONFESSION = new RegExp(
  [
    String.raw`j'?ai (utilise|mis|ecrit|donne|rempli)[^.]{0,40}invente`, String.raw`(coordonnees|informations|donnees) inventees`, String.raw`(enregistree?|creee?|passee?) par erreur`, String.raw`par erreur de notre (cote|part)`, String.raw`fausses? (coordonnees|informations|donnees)`, String.raw`rempli (ces|les|vos) (informations|coordonnees) moi`,
    String.raw`n'?ai pas (recupere|eu|recu|obtenu) (vos|de vous|tes)`, String.raw`(vous|tu) ne m'?(avez|as) pas (donne|communique)`, String.raw`commande \S+ n'?existe pas`,
    String.raw`rien n'?a (ete|encore ete) (commande|cree|enregistre|valide)`, String.raw`aucune commande n'?a (ete|encore ete) (creee|enregistree|passee)`,
    String.raw`made (it|them|this) up`, String.raw`by mistake`, String.raw`does ?n[o']t exist`, String.raw`nothing (was|has been) ordered`,
    String.raw`bel ?ghalet`, String.raw`b(el|l) ?khata`, 'بالغلط', 'بالخطا', 'اخترعت', 'ما تسجلت', 'لم يتم تسجيل',
  ].join('|'),
  'u',
);

export { GUARD_MARK };

// --- corrective turn ------------------------------------------------------------------------------------------------------------
const uniq = <T>(xs: T[]) => [...new Set(xs)];
/** The instruction of the one corrective model turn: which rule was broken and what is allowed. */
export function guardInstruction(violations: GuardViolation[], facts: GuardFacts): string {
  const rules = uniq(violations.map((v) => v.rule));
  const lines: string[] = [`${GUARD_MARK}: your "reply" breaks the rules below. Rewrite "reply" only — same language, same meaning otherwise, nothing new — and answer with the one JSON object (keep status, productCards and the other fields). No tool can be called now.`];
  if (rules.includes('unknown_amount')) {
    const bad = uniq(violations.filter((v) => v.rule === 'unknown_amount').map((v) => `${v.value} DA`));
    const prices = facts.priceList.slice(0, 40);
    lines.push(
      `- AMOUNTS: ${bad.join(', ')} ${bad.length > 1 ? 'are' : 'is'} not a price, fee or total you were given. Use only the catalogue prices${prices.length ? ` (${prices.join('; ')})` : ''}, the fees and totals returned by the tools (quote_delivery, create_order, lookup_order), or price × quantity. When you do not have the amount, write no amount: say the price is on the product card, or ask which product / variant / wilaya they mean.`,
    );
  }
  if (rules.includes('stock_count')) lines.push('- STOCK_PRIVATE: never say how many units are in stock or left; say only that it is available (or not).');
  if (rules.includes('technical_leak')) lines.push('- NO TECHNICAL TEXT: no internal id, code in capitals, tool name, field name, JSON or bracket note in "reply": plain words for the customer.');
  if (rules.includes('repeat_greeting')) lines.push('- NO NEW GREETING: you already answered this customer in this conversation; do not greet or introduce yourself again — start with the answer.');
  if (rules.includes('self_name')) lines.push(facts.agentName ? `- YOUR NAME is "${facts.agentName}": never give yourself another name.` : "- YOU HAVE NO PERSONAL NAME: never give yourself one; if asked, you are the shop's assistant.");
  if (rules.includes('language_switch')) lines.push(`- LANGUAGE: the customer writes ${LANGUAGE_NAMES[facts.lang] ?? facts.lang}. Rewrite "reply" in that language and script, as they write it (never switch on your own).`);
  if (rules.includes('moroccan_darija'))
    lines.push('- ALGERIAN DARIJA: the shop is Algerian. Replace the Moroccan / Tunisian words (chno, ach, dyal, walakin, daba, issa, nqdar / tanqdar / kanqdar / tandir, bghit / bghiti, chi / chi hadja, ma kaynch / ma kaynach, wakha, mezyan, barcha, tawa, mta3, شنو, ديال, دابا, بغيت, شي حاجة, ملي, فماش, برشا, صيفط / sifet / sift / sift-li) with Algerian ones (wach, ta3 / تاع, bessah / بصح, dork / درك, nqder, t7ebb / تحب, hadja / حاجة, makach / ماكانش, mlih, ki / كي, bezzaf / بزاف, ab3at / ab3atli / ابعث). « chhal / ch7al / شحال » means « how much »: never for « what » or « which » (never « ch7al men wilaya ? ») — « wach smitek ? », « a3tini numéro ta3ek », « wach men wilaya ? », « a3tini l\'adresse (rue, cité…) », « t7ebb nwasslouha l dar wela f stop-desk ? ».');
  if (rules.includes('false_confession'))
    lines.push(`- ORDER PLACED: order ${(facts.ordersPlaced ?? []).join(', ')} was placed with the details the customer gave in this conversation. Never say you invented them, that it was a mistake, that it does not exist or that nothing was ordered; never offer to cancel it unless the customer asks.`);
  if (rules.includes('contradicts_customer')) {
    const given = [...givenFields(facts.customerText ?? '', facts.customerFields)];
    lines.push(`- THE CUSTOMER'S MESSAGE GAVE ${given.join(', ') || 'an order field'}: never say you did not understand it or that you are still waiting for it, nor that you did not understand a field they were not asked for. Thank them in a few words and ask the next missing field (nothing more when every field is known).`);
  }
  if (rules.includes('fee_missing'))
    lines.push(`- DELIVERY FEE: quote_delivery answered ${(facts.quotes ?? []).map(quoteText).join('; ')}. Give that fee in the reply (home and stop-desk when both are known), in the customer's language: it is the answer to their question.`);
  return lines.join('\n');
}

// --- enforcement after the corrective turn --------------------------------------------------------------------------------------
/**
 * Sentences that remain when the corrective answer still breaks a rule (owner decision 14/11, assumptions-log):
 * the customer gets what is left when it still answers, else one neutral sentence of their language that asks what they
 * mean — never a promise that the team will answer (the guard never hands off).
 */
export const SAFE_SENTENCES = {
  price_on_card: { fr: 'Le prix est indiqué sur la fiche du produit ci-dessous.', en: 'The price is shown on the product card below.', ar: 'السعر مكتوب في بطاقة المنتوج لتحت.', arabizi: 'Soum maktoub f la fiche ta3 lproduit lta7t.' },
  available: { fr: 'Oui, ce produit est disponible.', en: 'Yes, this product is available.', ar: 'إيه، المنتوج متوفر.', arabizi: 'Ih, lproduit disponible.' },
  which: {
    fr: 'Pouvez-vous me préciser le produit (taille ou couleur) et, pour la livraison, votre wilaya ?',
    en: 'Could you tell me which product (size or colour) and, for delivery, which wilaya?',
    ar: 'واش من منتوج (المقاس ولا اللون)، ولأي ولاية التوصيل؟',
    arabizi: 'Wach men produit (taille wela couleur), w l ayya wilaya tawsil?',
  },
} as const;
const selfSentence = (loc: 'fr' | 'en' | 'ar' | 'arabizi', name: string | null): string =>
  ({
    fr: name ? `Je suis ${name}, l'assistant virtuel de la boutique.` : "Je suis l'assistant virtuel de la boutique.",
    en: name ? `I'm ${name}, the shop's virtual assistant.` : "I'm the shop's virtual assistant.",
    ar: name ? `أنا ${name}، المساعد الافتراضي تاع المحل.` : 'أنا المساعد الافتراضي تاع المحل.',
    arabizi: name ? `Ana ${name}, l'assistant virtuel ta3 lboutique.` : "Ana l'assistant virtuel ta3 lboutique.",
  })[loc];
const safeLocale = (lang: AiLanguage): 'fr' | 'en' | 'ar' | 'arabizi' => (lang === 'ar' ? 'ar' : lang === 'en' ? 'en' : lang === 'arabizi' ? 'arabizi' : 'fr');

const CONTENT_RULES: GuardRule[] = ['unknown_amount', 'stock_count', 'technical_leak', 'self_name', 'false_confession', 'contradicts_customer'];
/** Rules about the form of the reply: the text is kept when the corrective turn did not fix them (a reply is better than none). */
const STYLE_RULES: GuardRule[] = ['language_switch', 'moroccan_darija', 'script_mix', 'repeat_greeting'];
const quoteText = (q: QuoteFact) => `${q.wilaya || 'this wilaya'}: ${q.isStopdesk ? `stop-desk ${q.fee} DA` : q.free || q.fee === 0 ? 'home delivery free' : `home ${q.fee} DA`}${!q.isStopdesk && q.stopdeskFee !== null ? `, stop-desk ${q.stopdeskFee} DA` : ''}`;
/** journey 16/11 J03-2: the fee sentence the server adds when the corrective turn still gave none (the tool's figures only). */
export const feeSentence = (q: QuoteFact, lang: AiLanguage): string => {
  const loc = safeLocale(lang);
  const w = q.wilaya;
  const home = q.isStopdesk ? null : q.free || q.fee === 0 ? 0 : q.fee;
  const stop = q.isStopdesk ? q.fee : q.stopdeskFee;
  const da = (n: number) => (loc === 'ar' ? formatMoney(n).replace(/DA$/, 'دج') : formatMoney(n));
  const T = {
    fr: { home: (n: number) => (n ? `${da(n)} à domicile` : 'gratuite à domicile'), stop: (n: number) => `${da(n)} en stop-desk`, lead: `Livraison${w ? ` à ${w}` : ''} : ` },
    en: { home: (n: number) => (n ? `${da(n)} to your door` : 'free to your door'), stop: (n: number) => `${da(n)} at a stop-desk`, lead: `Delivery${w ? ` to ${w}` : ''}: ` },
    arabizi: { home: (n: number) => (n ? `${da(n)} l dar` : 'batel l dar'), stop: (n: number) => `${da(n)} f stop-desk`, lead: `Tawsil${w ? ` l ${w}` : ''}: ` },
    ar: { home: (n: number) => (n ? `${da(n)} للدار` : 'مجاني للدار'), stop: (n: number) => `${da(n)} في نقطة الاستلام`, lead: `التوصيل${w ? ` لـ${w}` : ''}: ` },
  }[loc];
  const parts = [...(home !== null ? [T.home(home)] : []), ...(stop !== null ? [T.stop(stop)] : [])];
  return `${T.lead}${parts.join(loc === 'ar' ? '، ' : ', ')}.`;
};
const LANGUAGE_NAMES: Record<string, string> = { ar: 'Arabic script (Algerian darija)', arabizi: 'Latin-script Algerian darija (arabizi)', fr: 'French', en: 'English' };
/**
 * journey retest R2-6: Markdown the model wrote (« **Djellaba homme** », « # », « `x` », « [texte](https://…) », « * item »):
 * Messenger shows it as typed, so it goes out as plain text. A lone « * » (« 2 * 3 ») and a snake_case word stay as written.
 */
export const stripMarkdown = (text: string): string =>
  text
    .replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, '$1')
    .replace(/__(?!\s)([^_\n]+?)(?<!\s)__/g, '$1')
    .replace(/(?<![\p{L}\p{N}*])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![\p{L}\p{N}*])/gu, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^([ \t]*)[*•][ \t]+/gm, '$1- ')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2');
/** « وnعاونك » → « وعاونك ». */
export const fixScriptMix = (text: string): string => text.replace(SCRIPT_GLUE, '');
const wordCount = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/** Words that go with a greeting (« Bonjour Madame, », « Salam khouya ! », « Hello again, »). */
const GREETING_COMPANIONS = new Set(
  [
    'madame', 'monsieur', 'mademoiselle', 'mme', 'mr', 'cher', 'chere', 'client', 'cliente', 'et', 'bienvenue', 'a', 'vous', 'toi', 'nouveau', 'encore', 'tout', 'le', 'monde', 'ma', 'mon', 'soeur', 'frere',
    'again', 'there', 'sir', 'madam', 'dear', 'friend', 'everyone', 'all', 'and', 'welcome', 'back',
    'khouya', 'khoya', 'khti', 'okhti', 'oukhti', 'sahbi', 'sa7bi', 'frero', 'wa', 'w', 'el', 'l', 'khir', 'nour', 'rahmatou', 'allah', 'wabarakatouh', 'bik', 'bikom', 'bikoum', 'marhba',
    'خويا', 'اختي', 'اخي', 'صديقي', 'عليكم', 'السلام', 'و', 'وعليكم', 'الخير', 'النور', 'ورحمه', 'الله', 'وبركاته', 'بيك', 'بيكم', 'مرحبا', 'سهلا',
  ].map((w) => foldGuard(w)),
);
const companionsOnly = (segment: string) => {
  const words = segment.match(/[\p{L}\p{N}']+/gu) ?? [];
  // « Bonjour Sarah ! »: one capitalised word is the customer's name
  return words.length <= 4 && words.every((w, i) => GREETING_COMPANIONS.has(foldGuard(w)) || (i === 0 && words.length === 1 && /^\p{Lu}/u.test(w)));
};

/** Removes the opening greeting (and its companions up to the next comma / full stop: « Bonjour Madame, … »). */
export const stripGreeting = (text: string, agentName?: string | null): string => {
  const g = greetingAt(text, agentName);
  if (!g) return text;
  let rest = text.slice(g);
  const sep = /^[^,!.?؟،:\n]*[,!.?؟،:\n]+/u.exec(rest);
  if (sep && companionsOnly(sep[0])) rest = rest.slice(sep[0].length);
  rest = rest.replace(/^[\s\p{P}]+/u, '');
  return rest ? rest.charAt(0).toLocaleUpperCase() + rest.slice(1) : '';
};

export function enforceReply(reply: string, violations: GuardViolation[], facts: GuardFacts, o: { hasCards: boolean }): { reply: string; action: GuardOutcome['action'] } {
  const parts = splitSentences(reply);
  const drop = new Set(violations.filter((v) => CONTENT_RULES.includes(v.rule)).map((v) => v.sentence));
  let text = parts.filter((_, i) => !drop.has(i)).join('').trim();
  if (violations.some((v) => v.rule === 'repeat_greeting')) text = stripGreeting(text, facts.agentName).trim();
  if (violations.some((v) => v.rule === 'script_mix')) text = fixScriptMix(text);
  // journey retest R1-4: Moroccan words the corrective turn kept are replaced by the Algerian ones
  if (violations.some((v) => v.rule === 'moroccan_darija')) text = fixMoroccan(text);
  // journey 16/11 J03-2: the fee the corrective turn still left out is added from the tool's answer
  const quote = violations.some((v) => v.rule === 'fee_missing') ? facts.quotes?.[0] : undefined;
  if (quote) text = `${feeSentence(quote, facts.lang)}${text ? ` ${text}` : ''}`;
  text = text.replace(/\n{3,}/g, '\n\n');
  // a language / dialect slip the corrective turn did not fix: the reply is sent as it is
  if (wordCount(text) >= 2) return { reply: text, action: text === reply.trim() && violations.every((v) => STYLE_RULES.includes(v.rule)) ? 'kept' : 'stripped' };
  const rules = new Set(violations.map((v) => v.rule));
  const loc = safeLocale(facts.lang);
  if (!rules.has('unknown_amount') && !rules.has('stock_count') && !rules.has('technical_leak')) {
    // the reply only gave the AI another name (« comment tu t'appelles ? »): the right introduction instead
    if (rules.has('self_name')) return { reply: selfSentence(loc, facts.agentName), action: 'safe_sentence' };
    // only a greeting was wrong and nothing else is left: a greeting is better than an odd sentence
    return { reply: reply.trim(), action: 'kept' };
  }
  const key = rules.has('unknown_amount') && o.hasCards ? 'price_on_card' : rules.size === 1 && rules.has('stock_count') ? 'available' : 'which';
  return { reply: SAFE_SENTENCES[key][loc], action: 'safe_sentence' };
}

// --- facts ------------------------------------------------------------------------------------------------------------------------
const PRICE_KEYS = new Set(['price', 'unitPrice', 'oldPrice']);
const FEE_KEYS = new Set(['fee', 'stopdeskFee', 'deliveryFee', 'homeFee']);
const THRESHOLD_KEYS = new Set(['freeFrom', 'freeDeliveryThreshold']);
const COUNT_KEYS = new Set(['available', 'availableAllVariants', 'availableQuantity']);
const TOKEN_KEYS = new Set(['number', 'trackingNumber', 'sku', 'name', 'variant', 'wilayaName', 'courier']);
const ID_KEYS = new Set(['wilayaId', 'communeId', 'count']);

/** Adds the numbers and names of tool results (this turn's or earlier turns') to the facts. */
export function withToolResults(facts: GuardFacts, results: unknown[]): GuardFacts {
  const f: GuardFacts = { ...facts, prices: [...facts.prices], amounts: [...facts.amounts], fees: [...facts.fees], thresholds: [...facts.thresholds], stockCounts: [...facts.stockCounts], tokens: [...facts.tokens], priceList: [...facts.priceList], ordersPlaced: [...(facts.ordersPlaced ?? [])] };
  const walk = (v: unknown, key: string | null, depth: number) => {
    if (depth > 6 || v === null || v === undefined) return;
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (key && ID_KEYS.has(key)) return;
      if (key && COUNT_KEYS.has(key)) {
        f.stockCounts.push(v);
        return;
      }
      f.amounts.push(v);
      if (key && PRICE_KEYS.has(key)) f.prices.push(v);
      if (key && FEE_KEYS.has(key)) f.fees.push(v);
      if (key && THRESHOLD_KEYS.has(key)) f.thresholds.push(v);
      return;
    }
    if (typeof v === 'string') {
      if (key && TOKEN_KEYS.has(key) && v.trim()) f.tokens.push(foldGuard(v.trim()));
      return;
    }
    if (Array.isArray(v)) return v.slice(0, 60).forEach((x) => walk(x, key, depth + 1));
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.name === 'string' && typeof o.price === 'number') f.priceList.push(`${o.name} ${o.price} DA`);
      // a create_order that placed an order (dry run included): its number
      if (depth === 0 && o.ok === true && typeof o.number === 'string' && Array.isArray(o.items)) f.ordersPlaced!.push(o.number);
      for (const [k, x] of Object.entries(o)) walk(x, k, depth + 1);
    }
  };
  for (const r of results) walk(r, null, 0);
  return f;
}

type FactsProduct = Pick<CatalogueProduct, 'name' | 'sku' | 'price' | 'oldPrice' | 'hasVariants' | 'variants' | 'also' | 'description'>;
export type GuardFactsInput = {
  lang: AiLanguage;
  products: FactsProduct[];
  /** texts the shop wrote (policies, FAQ, instructions, card template, system messages): their numbers are allowed */
  shopTexts: string[];
  freeDeliveryThreshold: number | null;
  agentName: string | null;
  shopName: string;
  /** the customer's words of the message(s) being answered */
  customerText: string;
  answeredBefore: boolean;
  freshStart: boolean;
  /** results of the tool calls of earlier turns of the conversation (fees, totals already given) */
  earlierToolResults?: unknown[];
};

export function buildGuardFacts(i: GuardFactsInput): GuardFacts {
  const prices: number[] = [];
  const amounts: number[] = [];
  const tokens: string[] = [];
  const priceList: string[] = [];
  for (const p of i.products) {
    tokens.push(foldGuard(p.sku), foldGuard(p.name));
    if (!p.hasVariants) {
      prices.push(p.price);
      priceList.push(`${p.name} ${p.price} DA`);
      if (p.oldPrice) amounts.push(p.oldPrice, p.oldPrice - p.price);
    }
    for (const v of p.variants) {
      prices.push(v.price);
      tokens.push(foldGuard(v.name));
      if (p.hasVariants) priceList.push(`${p.name} ${v.name} ${v.price} DA`);
    }
    for (const a of p.also) {
      prices.push(a.price);
      tokens.push(foldGuard(a.name));
    }
    // a price the merchant wrote in the description (« prix de gros 3000 DA »)
    if (p.description) amounts.push(...numbersIn(foldGuard(p.description)));
  }
  const shopNumbers = i.shopTexts.flatMap((t) => numbersIn(foldGuard(t))).filter((n) => n >= 10);
  // a code the shop itself wrote (a promo code « ETE_2026 ») may be repeated
  for (const t of i.shopTexts) for (const m of t.matchAll(CODE_RE)) tokens.push(foldGuard(m[0]));
  // the customer's own figures may be repeated (« avec 3000 DA de budget… », « je ne peux pas à 3500 DA »)
  const customerNumbers = numbersIn(foldGuard(i.customerText)).filter((n) => n >= 50);
  const thresholds = i.freeDeliveryThreshold ? [i.freeDeliveryThreshold] : [];
  // journey retest R4-2: a name typed in Arabic script (« سمير بن علي ») is no Arabic message — an Arabic reply to a French customer is a switch
  const messageLang = detectLanguage(withoutArabicValues(i.customerText), undefined, { neutral: 'previous' });
  const base: GuardFacts = {
    lang: i.lang,
    ...(messageLang ? { messageLang } : {}),
    prices,
    amounts: [...prices, ...amounts, ...shopNumbers, ...customerNumbers, ...thresholds],
    fees: shopNumbers,
    thresholds,
    stockCounts: [],
    tokens,
    agentName: i.agentName?.trim() || null,
    shopName: i.shopName,
    answeredBefore: i.answeredBefore,
    freshStart: i.freshStart,
    customerGreets: greetingAt(i.customerText) > 0,
    priceList,
    customerText: i.customerText,
  };
  return i.earlierToolResults?.length ? withToolResults(base, i.earlierToolResults) : base;
}

/** The facts of a turn from its prompt context (reply job and playground build the same ones). */
export function guardFactsOf(p: Omit<PromptContext, 'descriptionMax'>, o: Omit<GuardFactsInput, 'lang' | 'products' | 'shopTexts' | 'freeDeliveryThreshold' | 'agentName' | 'shopName'>): GuardFacts {
  const a = p.agent;
  const shopTexts = [
    ...Object.values(a.policies ?? {}).filter((v): v is string => typeof v === 'string'),
    a.customInstructions,
    a.closingInstructions ?? '',
    a.productCardTemplate ?? '',
    a.humanHandoffRules ?? '',
    ...p.faqs.flatMap((f) => [f.question, f.answer]),
    ...Object.values(p.workspace.systemMessages).flatMap((m) => Object.values(m ?? {})),
  ];
  return buildGuardFacts({
    ...o,
    lang: p.lang,
    products: p.catalogue.products,
    shopTexts,
    freeDeliveryThreshold: p.workspace.freeDeliveryThreshold,
    // the name the prompt gives the AI (identity section): the moderated one, none ⇒ no personal name
    agentName: a.displayName?.trim() || a.name.trim() || null,
    shopName: p.workspace.name,
  });
}
