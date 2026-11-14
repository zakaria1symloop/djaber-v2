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
// Pure: no I/O. Conservative by design — a false positive costs one corrective model turn and, at worst, a dropped sentence.
import { GUARD_MARK } from './ai.constants';
import type { AiLanguage } from './language';
import type { CatalogueProduct } from './catalogue.service';
import type { PromptContext } from './prompt/prompt.types';
import { TOOL_ALIASES, TOOL_DEFS } from './tools/tool-registry';

export type GuardRule = 'unknown_amount' | 'technical_leak' | 'stock_count' | 'repeat_greeting' | 'self_name';
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
};

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
const CONTRACT_KEYS = ['productCards', 'productPhotos', 'statusDetail', 'handoffWords', 'recommendedId', 'sourceId', 'customerConfirmed', 'replacesOrder', 'wilayaId', 'communeId', 'productId', 'variantId', 'orderId', 'isStopdesk', 'stopdeskId', 'stopdeskFee', 'deliveryFee', 'freeFrom', 'trackingUrl', 'trackingNumber', 'duplicateOf', 'beyondStock', 'availableAllVariants', 'otherVariants', 'availableVariants', 'suggestInsight', 'clientPhone', 'clientName', 'secondPhone', 'hasVariants', 'unitPrice', 'orderNumber', 'lastEvent', 'paymentOptions'];
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
  return out;
}

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

const CONTENT_RULES: GuardRule[] = ['unknown_amount', 'stock_count', 'technical_leak', 'self_name'];
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
  text = text.replace(/\n{3,}/g, '\n\n');
  if (wordCount(text) >= 2) return { reply: text, action: 'stripped' };
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
const COUNT_KEYS = new Set(['available', 'availableAllVariants']);
const TOKEN_KEYS = new Set(['number', 'trackingNumber', 'sku', 'name', 'variant', 'wilayaName', 'courier']);
const ID_KEYS = new Set(['wilayaId', 'communeId', 'count']);

/** Adds the numbers and names of tool results (this turn's or earlier turns') to the facts. */
export function withToolResults(facts: GuardFacts, results: unknown[]): GuardFacts {
  const f: GuardFacts = { ...facts, prices: [...facts.prices], amounts: [...facts.amounts], fees: [...facts.fees], thresholds: [...facts.thresholds], stockCounts: [...facts.stockCounts], tokens: [...facts.tokens], priceList: [...facts.priceList] };
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
  const base: GuardFacts = {
    lang: i.lang,
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
