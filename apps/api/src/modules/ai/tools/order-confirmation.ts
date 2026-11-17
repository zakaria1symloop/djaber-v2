// Full-test 15/11 AI-CHAT-01 / -03 (Blocker): the order confirmation is a server fact, not a model flag.
//   1. `create_order` with a valid cart that this conversation never saw as a recap ⇒ CONFIRMATION_REQUIRED with the
//      server's recap and a `draft` key (sha256 of the order's content): the AI shows it and waits.
//   2. A later turn (another customer message) calls `create_order` with the same content ⇒ the order is created only when
//      the customer's message of that turn confirms (« oui », « wah », « نعم », « ok »…); « non » / a change ⇒ refused.
//   The same turn can never prepare and confirm (the draft must come from an EARLIER run), a draft is valid 2 hours,
//   `phoneConfirmed` counts only after the tool asked for it, and the phone must be one the customer typed or is known.
//   journey 16/11 J03-10: « the same content » is the same CORE as the latest recap (phone, wilaya, stop-desk, items with
//   variants and quantities, replaced order) — the name / commune / address may be worded otherwise (the order then keeps
//   the recap's wording, what the customer read); a new word of the customer's own message is a change ⇒ a new recap.
import { createHash } from 'node:crypto';
import { normalizePhoneDz } from '@djaber/shared';
import { prisma, type Prisma } from '@djaber/db';
import { fold } from './wilaya-aliases';

export const DRAFT_TTL_MS = 2 * 3_600_000;
/** `create_order` / `cancel_order` results of the earlier runs (`name` absent on old rows: create_order). */
export type OrderCallHistory = { result: unknown; at: Date; name?: string }[];
type DraftContent = { clientName: string; clientPhone: string; secondPhone: string | null; wilayaId: number; communeName: string | null; address: string | null; isStopdesk: boolean; stopdeskId: string | null; items: { productId: string; variantId: string | null; quantity: number }[]; replaces?: { number: string } | null };

const norm = (s: string | null | undefined) => fold(s ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The key of an order's content: what the customer confirms (never the notes, the flags or the prices the server computes). */
export const draftKey = (r: DraftContent): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        norm(r.clientName), r.clientPhone, r.secondPhone ?? '', r.wilayaId, norm(r.communeName), norm(r.address), r.isStopdesk, r.stopdeskId ?? '',
        [...r.items].map((i) => `${i.productId}:${i.variantId ?? ''}:${i.quantity}`).sort(), r.replaces?.number.toLowerCase() ?? '',
      ]),
    )
    .digest('hex')
    .slice(0, 24);

/**
 * journey 16/11 J03-10 (Blocker): the key of an order's CORE — what makes it another order: phone, wilaya, stop-desk, items
 * (variants, quantities) and the replaced order. The name, the second phone, the commune and the address are left out: the
 * model rewrites them between the recap and the confirming call (« Cité 500 logements bloc 12 » → « Cité 500 logements bloc
 * 12, El Eulma, Sétif ») and the customer's « oui » was answered with the same recap again, in a loop.
 */
export const coreKey = (r: Pick<DraftContent, 'clientPhone' | 'wilayaId' | 'isStopdesk' | 'stopdeskId' | 'items' | 'replaces'>): string =>
  createHash('sha256')
    .update(JSON.stringify(['core', r.clientPhone, r.wilayaId, r.isStopdesk, r.isStopdesk ? (r.stopdeskId ?? '') : '', [...r.items].map((i) => `${i.productId}:${i.variantId ?? ''}:${i.quantity}`).sort(), r.replaces?.number.toLowerCase() ?? '']))
    .digest('hex')
    .slice(0, 24);

const codeOf = (r: unknown) => (r as { error?: { code?: unknown } } | null)?.error?.code;
const isCreate = (h: OrderCallHistory[number]) => (h.name ?? 'create_order') === 'create_order';
/** The wording of an order the customer reads in the recap (not part of its core). */
export type RecapWording = { clientName: string; secondPhone: string | null; communeName: string | null; address: string | null };
/** The latest recap an earlier turn of this conversation / session showed (fresh), with its core and its wording. */
export type LatestRecap = { draft: string; core: string | null; wording: (RecapWording & { wilaya: string | null }) | null; at: Date };
export const latestRecap = (history: OrderCallHistory | undefined, now = Date.now()): LatestRecap | null => {
  let best: LatestRecap | null = null;
  for (const h of history ?? []) {
    if (!isCreate(h) || now - h.at.getTime() > DRAFT_TTL_MS || codeOf(h.result) !== 'CONFIRMATION_REQUIRED') continue;
    if (best && best.at.getTime() >= h.at.getTime()) continue;
    const r = h.result as { error: { draft?: unknown; core?: unknown }; recap?: Record<string, unknown> };
    if (typeof r.error.draft !== 'string') continue;
    const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
    const rc = r.recap;
    best = { draft: r.error.draft, core: typeof r.error.core === 'string' ? r.error.core : null, wording: rc && typeof rc.clientName === 'string' ? { clientName: rc.clientName, secondPhone: s(rc.secondPhone), communeName: s(rc.communeName), address: s(rc.address), wilaya: s(rc.wilaya) } : null, at: h.at };
  }
  return best;
};

const tokensOf = (...texts: (string | null | undefined)[]) => new Set(texts.flatMap((t) => norm(t).split(' ')).filter((w) => w.length >= 3 || /\d/.test(w)));
/**
 * journey 16/11 J03-10: the confirming call words the name / commune / address differently from the recap. It is a real
 * change (⇒ a new recap) only when the new words are the customer's own words of THIS message (« oui, mais livrez à la villa
 * 4 »); words taken from the recap itself, the wilaya or earlier messages (« …, El Eulma, Sétif ») are the same order.
 */
export const wordingChangedNow = (recap: RecapWording & { wilaya?: string | null }, call: RecapWording, customerText: string | null | undefined): boolean => {
  const shown = tokensOf(recap.clientName, recap.secondPhone, recap.communeName, recap.address, recap.wilaya);
  const said = tokensOf(customerText);
  return [...tokensOf(call.clientName, call.secondPhone, call.communeName, call.address)].some((w) => !shown.has(w) && said.has(w));
};

/** An earlier turn of this conversation showed this recap (and it is still fresh). */
export const hasDraft = (history: OrderCallHistory | undefined, key: string, now = Date.now()): boolean =>
  !!history?.some((h) => now - h.at.getTime() <= DRAFT_TTL_MS && codeOf(h.result) === 'CONFIRMATION_REQUIRED' && (h.result as { error: { draft?: unknown } }).error.draft === key);
/** An earlier turn asked the customer to re-confirm this phone (04 §21 « faux numéro »). */
export const phoneCheckAsked = (history: OrderCallHistory | undefined, phone: string, now = Date.now()): boolean =>
  !!history?.some((h) => now - h.at.getTime() <= DRAFT_TTL_MS && codeOf(h.result) === 'PHONE_CONFIRMATION_REQUIRED' && (h.result as { error: { phone?: unknown } }).error.phone === phone);

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const latinDigits = (s: string) => s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) - (d >= '۰' ? 0x06f0 : 0x0660)) % 10));
/** The Algerian phone numbers written in a text (spaces, dots, dashes, +213 and Arabic digits allowed). */
export const phonesIn = (text: string): Set<string> => {
  const flat = latinDigits(text).replace(/(?<=\d)[\s.\-/]+(?=\d)/g, '');
  return new Set([...flat.matchAll(/(?:\+213|00213|0)?[5-7]\d{8}/g)].map((m) => normalizePhoneDz(m[0])));
};

/** Values a model writes when it has no name: never a customer's name. */
export const PLACEHOLDER_NAME = /^(client|cliente|customer|test|zboun|zbouna|inconnu|unknown|anonyme|n ?a|x+|nom|name|الزبون|زبون|عميل)$/;
export const isPlaceholderName = (name: string) => PLACEHOLDER_NAME.test(norm(name));

const YES = [
  'oui', 'ouii', 'ouiii', 'ouai', 'ouais', 'wi', 'ok', 'okay', 'oki', 'okey', 'dac', 'daccord', 'd accord', 'confirme', 'confirmer', 'je confirme', 'confirm', 'confirmed', 'valide', 'valider', 'c bon', 'c est bon', 'cbon', 'parfait', 'pas de souci', 'pas de probleme',
  'yes', 'yep', 'yeah', 'yup', 'sure', 'go', 'wah', 'wa', 'waah', 'ih', 'iyeh', 'iyah', 'eyh', 'ey', 'ayeh', 'aywa', 'safi', 'mrigl', 'mriguel', 'mlih', 's7i7', 'sa7', '9bel', 'nconfirmi', 'confirmi', 'n3am', 'na3am', 'tamam', 'bien', 'tres bien', 'nickel', 'top', 'exact', 'exactement', 'c ca', 'c est ca', 'voila',
  'نعم', 'ايه', 'اي', 'واه', 'وه', 'صح', 'صحيح', 'موافق', 'اكد', 'ناكد', 'نوكد', 'تمام', 'مليح', 'صافي', 'اوكي', 'مريقل', 'خلاص',
];
const NO = ['non', 'nn', 'no', 'nope', 'machi', 'mchi', 'mach', 'lala', 'la la', 'attend', 'attends', 'wait', 'change', 'changer', 'modifier', 'modifie', 'bedel', 'beddel', 'annule', 'annuler', 'cancel', 'erreur', 'faux', 'pas encore', 'pas maintenant', 'ماشي', 'لالا', 'بدل', 'لا', 'ألغي', 'الغي', 'انتظر', 'غالط'];
const EMOJI_YES = /[👍👌✅✔☑🙏]/u;
const words = (t: string) => ` ${norm(t)} `;
const has = (w: string, list: string[]) => list.some((x) => w.includes(` ${x} `));

/**
 * Does the customer's message of this turn confirm the recap? `no` wins (a negation, a change, « je ne confirme pas »);
 * then a yes word or 👍; else `unclear` (a question, a new value): the AI asks again, nothing is created.
 */
export const confirmation = (text: string): 'yes' | 'no' | 'unclear' => {
  // « pas de souci » is a yes, not a negation
  const w = words(text).replace(/ pas de (soucis?|problemes?) /g, ' ok ');
  if (has(w, NO) || / (ne|n) (.+ )?pas /.test(w)) return 'no';
  return has(w, YES) || EMOJI_YES.test(text) ? 'yes' : 'unclear';
};

/**
 * journey 16/11 J04-4: the AI's previous message showed this order itself (it wrote a change's recap after
 * check_availability + quote_delivery, without the first `create_order`): the customer's « oui » then confirms it at once —
 * it used to get « pas encore validée » and the same recap again. The message must carry the phone, the server's total,
 * every product name and, for a change, the number of the replaced order.
 */
export const recapShown = (aiText: string | null | undefined, r: { clientPhone: string; total: number; items: { name: string }[]; replaces?: { number: string } | null; address?: string | null; clientName?: string | null }): boolean => {
  if (!aiText?.trim()) return false;
  const text = latinDigits(aiText);
  if (!phonesIn(text).has(r.clientPhone)) return false;
  // « 3 400 DA », « 3.400 », « 10450 DA »: the thousands separators are dropped before the numbers are read
  const amounts = new Set([...text.replace(/(?<=\d)[ .,\u00a0\u202f](?=\d{3}(?!\d))/g, '').matchAll(/\d+/g)].map((m) => Number(m[0])));
  if (!amounts.has(r.total)) return false;
  const shown = ` ${norm(aiText)} `;
  // journey retest R1-6: the recap the platform sends is complete (phone, total, products): « oui mais c'est le Bt 9 »
  // after it must not confirm it — the address (and the name) of the call have to be the ones shown too
  const significant = (s: string) => norm(latinDigits(s)).split(' ').map((w) => fold(w)).filter((w) => w.length >= 3 || /\d/.test(w));
  const shownWords = new Set(significant(aiText));
  if ([r.address, r.clientName].some((v) => v && !significant(v).every((w) => shownWords.has(w)))) return false;
  return r.items.every((i) => shown.includes(` ${norm(i.name)} `)) && (!r.replaces || shown.includes(` ${norm(r.replaces.number)} `));
};

/** The AI's last message(s) before the customer's current one (playground or conversation history, oldest first). */
export const lastAiText = (history: readonly { author: string; text: string }[]): string => {
  const tail: string[] = [];
  for (let i = history.length - 1; i >= 0 && history[i]!.author !== 'customer'; i--) if (history[i]!.author === 'ai') tail.unshift(history[i]!.text);
  return tail.join('\n');
};

/** The `create_order` / `cancel_order` results of the earlier runs (`aiRun` filter: this conversation, or this playground session) of the last 2 hours. */
export const orderHistoryOf = async (aiRun: Prisma.AiRunWhereInput): Promise<OrderCallHistory> =>
  (await prisma.aiToolCall.findMany({ where: { name: { in: ['create_order', 'cancel_order'] }, executedAt: { gte: new Date(Date.now() - DRAFT_TTL_MS) }, aiRun }, orderBy: { executedAt: 'desc' }, take: 30, select: { name: true, result: true, executedAt: true } })).map((c) => ({ name: c.name, result: c.result, at: c.executedAt! }));

type Placed = { ok?: unknown; number?: unknown; draft?: unknown; core?: unknown; simulated?: unknown; total?: unknown; replaced?: unknown };
/** full-test 15/11 proposal 4 (C06: TEST-2998 then TEST-2283 on « oui c'est bon »): the number of the order an earlier turn already placed with this content. */
export const orderedBefore = (history: OrderCallHistory | undefined, key: string, now = Date.now(), core?: string): string | null => {
  // journey 16/11 J03-10: the same core (phone, wilaya, items, replaced order) counts too — a reworded address is not another order
  const hit = history?.find((h) => isCreate(h) && now - h.at.getTime() <= DRAFT_TTL_MS && (h.result as Placed | null)?.ok === true && ((h.result as Placed).draft === key || (!!core && (h.result as Placed).core === core)));
  return hit ? String((hit.result as Placed).number ?? '') || null : null;
};
/** Numbers of the orders the AI placed in this conversation / session (last 2 hours). */
export const placedNumbers = (history: OrderCallHistory | undefined): string[] =>
  (history ?? []).filter((h) => isCreate(h) && (h.result as Placed | null)?.ok === true && typeof (h.result as Placed).number === 'string').map((h) => String((h.result as Placed).number));
/**
 * full-test 15/11 AI-CHAT-16: the playground's own TEST-n orders (dry run), so the merchant can test a change or a
 * cancellation of the order the agent just took — minus those a later simulated cancel or replacement removed.
 */
export const simulatedOrders = (history: OrderCallHistory | undefined): { number: string; total: number; at: Date }[] => {
  const gone = new Set<string>();
  for (const h of history ?? []) {
    const r = h.result as (Placed & { cancelled?: unknown }) | null;
    if (!r?.simulated) continue;
    if (!isCreate(h) && r.ok === true && typeof r.cancelled === 'string') gone.add(r.cancelled.toLowerCase());
    const replaced = r.replaced && typeof r.replaced === 'object' ? (r.replaced as { number?: unknown }).number : null;
    if (isCreate(h) && typeof replaced === 'string') gone.add(replaced.toLowerCase());
  }
  return (history ?? [])
    .filter((h) => isCreate(h) && (h.result as Placed | null)?.ok === true && (h.result as Placed).simulated === true && typeof (h.result as Placed).number === 'string')
    .map((h) => ({ number: String((h.result as Placed).number), total: Number((h.result as Placed).total ?? 0) || 0, at: h.at }))
    .filter((o) => !gone.has(o.number.toLowerCase()));
};

const CANCEL_WORDS = /annul|cancel|batel|btel|ألغ|الغ|بطل|باطل|نلغ/;
/** The customer's own words ask for a cancellation (« annule », « cancel », « batel », « ألغي »). */
export const asksCancel = (text: string): boolean => CANCEL_WORDS.test(fold(text)) || CANCEL_WORDS.test(text.toLowerCase());
/** The customer's message of this turn asks for the cancellation (or confirms the one the AI asked about). */
export const wantsCancel = (text: string): boolean => confirmation(text) === 'yes' || asksCancel(text);

/** full-test 15/11 AI-CHAT-05 (proposal 6): what the customer chose for the order being taken (`context.chosen`). */
export type ChosenItem = { productId: string; variantId: string | null; quantity: number | null };
/**
 * The chosen items after a turn: the model's `cart` when it reported one (an empty list never erases — a name-only
 * message must not lose the product), none once an order was placed this turn.
 */
export const nextChosen = (previous: ChosenItem[] | null | undefined, reported: { items?: { productId?: unknown; variantId?: unknown; quantity?: unknown }[] } | null | undefined, placed: boolean): ChosenItem[] | null => {
  if (placed) return null;
  const items = (reported?.items ?? [])
    .filter((i) => typeof i.productId === 'string' && i.productId.trim())
    .slice(0, 10)
    .map((i) => {
      const q = Math.floor(Number(i.quantity));
      return { productId: String(i.productId).trim(), variantId: typeof i.variantId === 'string' && i.variantId.trim() ? i.variantId.trim() : null, quantity: Number.isFinite(q) && q >= 1 && q <= 10_000 ? q : null };
    });
  return items.length ? items : (previous ?? null);
};
/** Did a `create_order` of this turn place an order? */
export const placedThisTurn = (tools: { name: string; result: unknown }[]): boolean => tools.some((t) => t.name === 'create_order' && (t.result as { ok?: unknown } | null)?.ok === true);
