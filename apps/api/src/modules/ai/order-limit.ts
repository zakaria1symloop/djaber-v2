// Journey re-run J03r-1 (18/11, Major, docs/audit/journeys-2026-11-18/journeys/J03.md): an order above the agent's « Quantité max par
// commande » is handed to the team, never cut to the maximum and recapped. Pure.
//   LIM T1 « Je veux 6 tapis de prière, … » (max 5): `create_order {6}` ⇒ `hint: order_limit`, then a second `create_order {5}` in the same
//   turn ⇒ the server recap « 5 × Tapis de prière » — the hand-off was left to the model, which « fixed » the quantity instead.
//   CQ « Je veux commander 500 pièces de votre premier produit »: no name / phone, so no create_order — the model offered « jusqu'à 5 ».
import { foldBase } from './tools/wilaya-aliases';

/** Words that count pieces (folded: accents dropped, lower case), every script: « 500 pièces », « 6 unités », « 8 حبات », « 7 hbat ». */
const UNIT_WORDS = new Set(
  [
    'piece', 'pieces', 'pce', 'pces', 'pc', 'pcs', 'unite', 'unites', 'article', 'articles', 'exemplaire', 'exemplaires', 'paire', 'paires', 'lot', 'lots', 'boite', 'boites', 'carton', 'cartons',
    'unit', 'units', 'item', 'items', 'pair', 'pairs', 'boxes', 'box',
    'hba', 'hbat', '7ba', '7bat', 'habba', 'habbat', '7abba', '7abbat', 'hbeb', '7beb', 'tasdira', 'qta3', 'kta3',
    'حبه', 'حبات', 'حبتين', 'قطعه', 'قطع', 'وحده', 'وحدات', 'زوج', 'ازواج', 'علبه', 'علب', 'كرطونه',
  ].map((w) => foldBase(w)),
);
/** A word right before the number that makes it no quantity: an address, a size, a code (« n 5 », « bloc 12 », « pointure 41 », « رقم 5 »). */
const NOT_QUANTITY_BEFORE = new Set(
  [
    'n', 'no', 'num', 'numero', 'nr', 'rue', 'bloc', 'bt', 'bat', 'batiment', 'immeuble', 'imm', 'cite', 'villa', 'appartement', 'appt', 'app', 'apt', 'etage', 'porte', 'route', 'lotissement', 'logements', 'logts', 'local',
    'taille', 'pointure', 'size', 't', 'code', 'ref', 'reference', 'wilaya', 'cmd', 'test', 'tel', 'telephone', 'phone', 'km',
    'رقم', 'عماره', 'حي', 'بلوك', 'شقه', 'طابق', 'مقاس', 'نمره', 'ولايه', 'طلبيه', 'الطلبيه',
  ].map((w) => foldBase(w)),
);
/** Words after the number that are skipped before the counted word (« 6 de vos tapis », « 3 x robes »). */
const SKIPPED_AFTER = new Set(['de', 'd', 'des', 'du', 'x', 'fois', 'of', 'the', 'men', 'mn', 'من'].map((w) => foldBase(w)));

/** A number the customer asks for and the words right after it (folded, up to the next punctuation; 3 words at most). */
export type QuantityAsk = { quantity: number; unit: boolean; next: string };

/**
 * The quantities a customer message asks for: a number of 1–6 digits standing alone (never inside a phone, a price written « 12500 », an
 * arabizi word « 7bat », a decimal or a date), not right after an address / size / code word, followed by a word: `unit` when that word
 * counts pieces (« 500 pièces »), else `next` holds the words that may name the product (« tapis de priere ») — the caller checks them
 * against the catalogue. A price (« 12500 DA ») or a measure (« 50 ml ») names no product: the caller's check refuses it.
 */
export function quantitiesAsked(text: string): QuantityAsk[] {
  const f = foldBase(text ?? '');
  const out: QuantityAsk[] = [];
  const re = /(?<![\p{L}\p{N}.,:/#°'-])(\d{1,6})(?:\s*[x×])?(?![\p{L}\p{N}]|[.,:/]\d)/gu;
  for (const m of f.matchAll(re)) {
    const quantity = Number(m[1]);
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    // (only the word right before it, with spaces between: « bloc 12 » — never a word behind a comma, « … 200 logements, 12 pièces »)
    const before = /([\p{L}\p{N}]+)\s*$/u.exec(f.slice(0, m.index))?.[1] ?? '';
    if (NOT_QUANTITY_BEFORE.has(before)) continue;
    const rest = f.slice(m.index + m[0].length).split(/[,;.!?؟،\n:()«»"]/u)[0] ?? '';
    const words: string[] = [];
    for (const w of rest.split(/\s+/u).filter(Boolean)) {
      if (/^\d+$/u.test(w)) break;
      if (!words.length && SKIPPED_AFTER.has(w)) continue;
      words.push(w);
      if (words.length >= 3) break;
    }
    if (!words.length) continue;
    out.push({ quantity, unit: UNIT_WORDS.has(words[0]!), next: words.join(' ') });
  }
  return out;
}

/**
 * The quantity above `max` the message asks for, or null: a counted word (« 500 pièces ») or a word naming a product of the shop
 * (`namesProduct`, the catalogue's own check on the words right after the number). A quantity at or under the limit is never returned.
 */
export async function quantityAbove(text: string | undefined, max: number | null | undefined, namesProduct: (words: string) => boolean | Promise<boolean>): Promise<number | null> {
  if (!text || max === null || max === undefined || !Number.isInteger(max) || max <= 0) return null;
  for (const q of quantitiesAsked(text)) {
    if (q.quantity <= max) continue;
    if (q.unit || (await namesProduct(q.next))) return q.quantity;
  }
  return null;
}

/** The limit a `create_order` answer reports (`hint: 'order_limit'`): the quantity limit or the amount limit, and its value. */
export type OrderLimit = { kind: 'quantity' | 'amount'; value: number };
export const orderLimitOf = (result: unknown): OrderLimit | null => {
  const r = result as { hint?: unknown; limit?: unknown; maxQty?: unknown; maxAmount?: unknown; quantity?: unknown; total?: unknown } | null;
  if (r?.hint !== 'order_limit') return null;
  const maxQty = typeof r.maxQty === 'number' ? r.maxQty : null;
  const maxAmount = typeof r.maxAmount === 'number' ? r.maxAmount : null;
  const kind = r.limit === 'quantity' || r.limit === 'amount' ? r.limit : maxQty !== null && typeof r.quantity === 'number' && r.quantity > maxQty ? 'quantity' : maxAmount !== null ? 'amount' : 'quantity';
  const value = kind === 'quantity' ? maxQty : maxAmount;
  return value === null ? null : { kind, value };
};
