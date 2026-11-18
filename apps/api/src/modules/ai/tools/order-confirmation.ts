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
/**
 * journey retest R8-1 (17/11): the order a server recap stands for, as the server built it (`create_order` arguments): kept in
 * the `CONFIRMATION_REQUIRED` result so that a « oui » to that recap places exactly it, whatever the model's confirming call
 * left out (N5 T3: no commune, no address, `customerConfirmed false` ⇒ « not given yet » and no order).
 */
export type DraftOrder = { clientName: string; clientPhone: string; secondPhone: string | null; wilayaId: number; communeName: string | null; address: string | null; isStopdesk: boolean; stopdeskId: string | null; notes: string | null; items: { productId: string; variantId: string | null; quantity: number }[]; replacesOrder: string | null };
/** The latest recap an earlier turn of this conversation / session showed (fresh), with its core and its wording. */
export type LatestRecap = { draft: string; core: string | null; wording: (RecapWording & { wilaya: string | null }) | null; at: Date; /** journey retest R8-1 */ order: DraftOrder | null; /** journey retest R8-1: every word the recap showed (names, items, place) */ shown: string };
const draftOrderOf = (v: unknown): DraftOrder | null => {
  const o = v as Partial<DraftOrder> | null | undefined;
  if (!o || typeof o.clientName !== 'string' || typeof o.clientPhone !== 'string' || typeof o.wilayaId !== 'number' || !Array.isArray(o.items) || !o.items.length) return null;
  if (!o.items.every((i) => i && typeof i.productId === 'string' && typeof i.quantity === 'number')) return null;
  return o as DraftOrder;
};
export const latestRecap = (history: OrderCallHistory | undefined, now = Date.now()): LatestRecap | null => {
  let best: LatestRecap | null = null;
  for (const h of history ?? []) {
    if (!isCreate(h) || now - h.at.getTime() > DRAFT_TTL_MS || codeOf(h.result) !== 'CONFIRMATION_REQUIRED') continue;
    if (best && best.at.getTime() >= h.at.getTime()) continue;
    const r = h.result as { error: { draft?: unknown; core?: unknown }; recap?: Record<string, unknown>; draftOrder?: unknown };
    if (typeof r.error.draft !== 'string') continue;
    const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
    const rc = r.recap;
    const items = Array.isArray(rc?.items) ? (rc.items as { name?: unknown; variant?: unknown }[]).flatMap((i) => [i?.name, i?.variant]) : [];
    const shown = rc ? [rc.clientName, rc.clientPhone, rc.secondPhone, rc.wilaya, rc.wilayaAr, rc.communeName, rc.communeAr, rc.address, ...items].filter((x): x is string => typeof x === 'string').join(' ') : '';
    best = { draft: r.error.draft, core: typeof r.error.core === 'string' ? r.error.core : null, wording: rc && typeof rc.clientName === 'string' ? { clientName: rc.clientName, secondPhone: s(rc.secondPhone), communeName: s(rc.communeName), address: s(rc.address), wilaya: s(rc.wilaya) } : null, at: h.at, order: draftOrderOf(r.draftOrder), shown };
  }
  return best;
};
/**
 * journey retest R10-2 (17/11): a server recap of an earlier turn is still waiting for the customer's « oui » — the latest fresh
 * recap, with no order placed since. Then a request to confirm points at that recap (N19 T5, N20 T4); without one it confirms nothing.
 */
export const recapPending = (history: OrderCallHistory | undefined, now = Date.now()): boolean => {
  const recap = latestRecap(history, now);
  return !!recap && !(history ?? []).some((h) => isCreate(h) && h.at.getTime() >= recap.at.getTime() && (h.result as { ok?: unknown } | null)?.ok === true);
};
/** Words of a bare confirmation (folded): a « oui » with them adds nothing to the recap. */
const CONFIRM_FILLERS = new Set(
  [
    'est', 'cest', 'bien', 'tout', 'bon', 'bonne', 'tres', 'merci', 'beaucoup', 'svp', 'stp', 'please', 'thanks', 'thank', 'you', 'all', 'good', 'fine', 'right', 'correct', 'exact', 'exactement', 'parfait', 'nickel', 'super', 'allez', 'vas', 'vasy', 'go', 'ahead', 'sur', 'surement', 'evidemment',
    'commande', 'order', 'recap', 'confirme', 'confirmer', 'confirm', 'confirmed', 'valide', 'valider', 'accord', 'daccord', 'the', 'and', 'that', 'this', 'its', 'moi', 'pour', 'vous', 'les', 'des', 'une', 'cela', 'ca', 'comme', 'ainsi', 'oui', 'ouii', 'ouiii', 'ouais', 'yes', 'yeah', 'yep', 'okay', 'oki', 'okey',
    'saha', 'sahit', 'sahitek', 'yaatik', 'ya3tik', 'saha', 'khouya', 'khoya', 'khti', 'sahbi', 'inchallah', 'nchallah', 'allah', 'barak', 'baraka', 'fik', 'mlih', 'mli7', 'wah', 'iyeh', 'ayeh', 'safi', 'hakda', 'haka', 'kima', 'kifkif', 'nconfirmi', 'confirmi', 'tamam', 'ok',
    'نعم', 'ايه', 'واه', 'صحيت', 'صحيتو', 'شكرا', 'بارك', 'الله', 'فيك', 'تمام', 'مليح', 'صافي', 'خويا', 'اختي', 'هكا', 'هكذا', 'كيما', 'موافق', 'اكد', 'ناكد', 'الطلبيه', 'الطلبية', 'الكوموند',
  ].map((w) => norm(w)),
);
/**
 * journey retest R8-1: the customer's message only confirms — a yes word, and no word the recap did not show besides the words
 * of a confirmation (« oui », « oui c'est bon », « ih saha », « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif »).
 * « oui mais livrez à la villa 4 » brings « mais », « livrez », « villa », « 4 »: not a bare yes.
 */
export const bareYes = (text: string, shown: string): boolean => {
  if (confirmation(text) !== 'yes') return false;
  const recap = tokensOf(shown);
  return [...tokensOf(text)].every((w) => recap.has(w) || CONFIRM_FILLERS.has(w) || YES.includes(w));
};

const tokensOf = (...texts: (string | null | undefined)[]) => new Set(texts.flatMap((t) => norm(t).split(' ')).filter((w) => w.length >= 3 || /\d/.test(w)));
/** journey retest R8-1 / R17-2: the `create_order` arguments of the order a server recap stands for (its stored `draftOrder`). */
export const storedOrderArgs = (o: DraftOrder, phoneConfirmed = false): Record<string, unknown> => ({
  clientName: o.clientName,
  clientPhone: o.clientPhone,
  ...(o.secondPhone ? { secondPhone: o.secondPhone } : {}),
  wilayaId: o.wilayaId,
  ...(o.communeName ? { communeName: o.communeName } : {}),
  ...(o.address ? { address: o.address } : {}),
  isStopdesk: o.isStopdesk,
  ...(o.stopdeskId ? { stopdeskId: o.stopdeskId } : {}),
  ...(o.notes ? { notes: o.notes } : {}),
  items: o.items.map((i) => ({ productId: i.productId, ...(i.variantId ? { variantId: i.variantId } : {}), quantity: i.quantity })),
  ...(o.replacesOrder ? { replacesOrder: o.replacesOrder } : {}),
  customerConfirmed: true,
  ...(phoneConfirmed ? { phoneConfirmed: true } : {}),
});
/**
 * journey retest R17-2 (18/11, Major): the customer's message is a plain yes (« oui », « ih », « ايه », « yes », « 👍 », no change, no
 * question) to the server recap that waits — the latest fresh recap of an earlier turn, with its stored order, no order placed since —
 * and the AI's last message was that recap (`recapShownLast`: its request to answer yes). Returns the `create_order` arguments of exactly
 * that recap's order (the server places it, whatever the model does on that turn: N5 T3 « oui » to the substitute's recap got a new
 * confirm question and no order); null otherwise.
 */
export const recapYesArgs = (history: OrderCallHistory | undefined, customerText: string | undefined, recapShownLast: boolean, now = Date.now()): Record<string, unknown> | null => {
  if (!recapShownLast || !customerText?.trim() || /[?؟]/u.test(customerText)) return null;
  const latest = latestRecap(history, now);
  if (!latest?.order || !recapPending(history, now) || !bareYes(customerText, latest.shown)) return null;
  if (orderedBefore(history, latest.draft, now, latest.core ?? undefined)) return null;
  return storedOrderArgs(latest.order, phoneCheckAsked(history, latest.order.clientPhone, now));
};
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
// journey retest R3-3 (17/11): also with a channel or a number after it (« Client Messenger », « Customer 1 », « زبون فيسبوك »)
// and the platform's own labels (« Utilisateur Messenger », « Facebook User »)
export const PLACEHOLDER_NAME =
  /^(?:(?:client|cliente|customer|test|zboun|zbouna|inconnu|unknown|anonyme|n ?a|x+|nom|name|الزبون|زبون|عميل|العميل)(?: (?:messenger|facebook|fb|instagram|insta|ig|whatsapp|test|inconnu|unknown|anonyme|ai|ia|\d+|ماسنجر|فيسبوك|انستغرام))*|(?:utilisateur|user) (?:messenger|facebook|instagram)|(?:messenger|facebook|instagram) (?:user|utilisateur))$/;
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

// journey retest R4-3 (17/11): `recapShown` / `lastAiText` (J04-4 — the AI's previous message counted as the recap when it
// carried the phone, the total and the products) are gone: a product suggestion repeating the customer's details passed, and
// « oui » placed an order no recap had shown. Only a server recap (`CONFIRMATION_REQUIRED` of an earlier run) is confirmed.

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
/** An order number of the shop or of the playground (« CMD-1001 », « TEST-4074 », « commande n° 1042 »). */
const ORDER_REF = /(?<![\p{L}\p{N}])[A-Za-z]{2,8}-\d{3,}(?![\p{N}])|(?:commande|order|طلبية|الطلبية|طلب)\s*(?:n[°o]\.?|num[eé]ro|number|#|رقم)\s*\d{3,}/iu;
/**
 * journey retest R10-3 (17/11): the customer asked to cancel in their last messages (the current one and the two before — a « oui »
 * to « voulez-vous l'annuler ? » follows their own cancel words), or names an order in the current one. Otherwise `cancel_order` is
 * neither offered nor run (N11 T3 `cancel_order {}` on « وين راهي الطلبية تاعي؟ … », a tracking question).
 */
export const cancelAsked = (customerText: string, customerHistory?: string): boolean => {
  const recent = [customerText, ...(customerHistory ?? '').split('\n').filter((l) => l.trim()).slice(-3)];
  return recent.some((t) => asksCancel(t)) || ORDER_REF.test(customerText);
};
/** journey retest R10-3: only the customer's own cancel words (the order reference alone does not make a cancel call runnable). */
export const cancelWordsIn = (customerText: string, customerHistory?: string): boolean =>
  [customerText, ...(customerHistory ?? '').split('\n').filter((l) => l.trim()).slice(-3)].some((t) => asksCancel(t));
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
