// Full-test 15/11 AI-CHAT-01 / -03 (Blocker): the order confirmation is a server fact, not a model flag.
//   1. `create_order` with a valid cart that this conversation never saw as a recap ⇒ CONFIRMATION_REQUIRED with the
//      server's recap and a `draft` key (sha256 of the order's content): the AI shows it and waits.
//   2. A later turn (another customer message) calls `create_order` with the same content ⇒ the order is created only when
//      the customer's message of that turn confirms (« oui », « wah », « نعم », « ok »…); « non » / a change ⇒ refused.
//   The same turn can never prepare and confirm (the draft must come from an EARLIER run), a draft is valid 2 hours,
//   `phoneConfirmed` counts only after the tool asked for it, and the phone must be one the customer typed or is known.
import { createHash } from 'node:crypto';
import { normalizePhoneDz } from '@djaber/shared';
import { prisma, type Prisma } from '@djaber/db';
import { fold } from './wilaya-aliases';

export const DRAFT_TTL_MS = 2 * 3_600_000;
export type OrderCallHistory = { result: unknown; at: Date }[];
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

const codeOf = (r: unknown) => (r as { error?: { code?: unknown } } | null)?.error?.code;
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

/** The `create_order` results of the earlier runs (`aiRun` filter: this conversation, or this playground session) of the last 2 hours. */
export const orderHistoryOf = async (aiRun: Prisma.AiRunWhereInput): Promise<OrderCallHistory> =>
  (await prisma.aiToolCall.findMany({ where: { name: 'create_order', executedAt: { gte: new Date(Date.now() - DRAFT_TTL_MS) }, aiRun }, orderBy: { executedAt: 'desc' }, take: 20, select: { result: true, executedAt: true } })).map((c) => ({ result: c.result, at: c.executedAt! }));

/** The customer's message of this turn asks for the cancellation (or confirms the one the AI asked about). */
export const wantsCancel = (text: string): boolean => confirmation(text) === 'yes' || /annul|cancel|batel|btel|ألغ|الغ|بطل|باطل|نلغ/.test(fold(text));
