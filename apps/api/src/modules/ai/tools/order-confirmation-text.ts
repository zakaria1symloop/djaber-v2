// Full-test 15/11 (AI improvement proposal 4): the customer's order confirmation is written by the server from the
// `create_order` result — number, items, delivery fee, total, delay, cash on delivery — in the customer's language, so
// the model can no longer confirm with wrong figures, « correct » itself (« commande enregistrée par erreur »,
// « coordonnées inventées ») or deny the order it just placed (AI-CHAT-02). Pure.
import type { AiLanguage } from '../language';

type Line = { name?: unknown; variant?: unknown; quantity?: unknown; unitPrice?: unknown };
type Placed = { number: string; items: Line[]; deliveryFee: number; total: number; duplicate: boolean; replaced: string | null; beyondStock: boolean; eta: string };

/** « 12500 » → « 12 500 » (CLAUDE.md rule 11: Latin digits, space as thousands separator). */
export const money = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** The last `create_order` of the turn that placed an order (a dry run's TEST-n included), else null. */
export const placedOrder = (calls: { name: string; result: unknown }[]): Placed | null => {
  for (const c of [...calls].reverse()) {
    if (c.name !== 'create_order') continue;
    const r = c.result as Record<string, unknown> | null;
    if (!r || r.ok !== true || typeof r.number !== 'string' || !Array.isArray(r.items)) continue;
    const replaced = r.replaced && typeof r.replaced === 'object' ? (r.replaced as { number?: unknown }).number : r.replaced;
    const eta = typeof r.etaDays === 'string' && /^\d+\s*[–-]\s*\d+$/.test(r.etaDays) ? r.etaDays : '2–5';
    return {
      number: r.number,
      items: r.items as Line[],
      deliveryFee: Number(r.deliveryFee ?? 0) || 0,
      total: Number(r.total ?? 0) || 0,
      duplicate: !!r.duplicateOf,
      replaced: typeof replaced === 'string' && replaced ? replaced : null,
      beyondStock: Array.isArray(r.beyondStock) && r.beyondStock.length > 0,
      eta,
    };
  }
  return null;
};

type Loc = 'fr' | 'ar' | 'arabizi' | 'en';
const T: Record<Loc, { head: (n: string) => string; again: (n: string) => string; fee: (v: string) => string; free: string; total: (v: string) => string; eta: (a: string, b: string) => string; beyond: string; replaced: (n: string) => string; thanks: string; cur: string }> = {
  fr: {
    head: (n) => `Votre commande ${n} est bien enregistrée ✅`,
    again: (n) => `Votre commande ${n} est déjà enregistrée ✅`,
    fee: (v) => `Livraison : ${v}`,
    free: 'Livraison : gratuite',
    total: (v) => `Total : ${v}, à payer à la livraison.`,
    eta: (a, b) => `Délai de livraison : ${a} à ${b} jours.`,
    beyond: 'Une partie de la commande peut prendre un peu plus de temps à être livrée.',
    replaced: (n) => `Elle remplace la commande ${n}, qui est annulée.`,
    thanks: 'Merci pour votre confiance !',
    cur: 'DA',
  },
  ar: {
    head: (n) => `تم تسجيل طلبيتك ${n} ✅`,
    again: (n) => `طلبيتك ${n} مسجلة من قبل ✅`,
    fee: (v) => `التوصيل: ${v}`,
    free: 'التوصيل: مجاني',
    total: (v) => `المجموع: ${v}، الدفع عند الاستلام.`,
    eta: (a, b) => `مدة التوصيل: من ${a} إلى ${b} أيام.`,
    beyond: 'جزء من الطلبية يمكن يتعطل شوية في التوصيل.',
    replaced: (n) => `هذي الطلبية تعوض الطلبية ${n}، اللي تلغات.`,
    thanks: 'شكرا على ثقتك!',
    cur: 'دج',
  },
  arabizi: {
    head: (n) => `Commande ta3ek ${n} tsajlet ✅`,
    again: (n) => `Commande ta3ek ${n} déjà msajla ✅`,
    fee: (v) => `Livraison: ${v}`,
    free: 'Livraison: batel',
    total: (v) => `Total: ${v}, tkhalles ki tewsel.`,
    eta: (a, b) => `Tawsil f ${a} l ${b} ayam.`,
    beyond: 'Juz2 men la commande ymken yt3atel chwiya f tawsil.',
    replaced: (n) => `Hadi t3awed la commande ${n}, lli tlghat.`,
    thanks: 'Saha, merci 3la thiqa ta3ek!',
    cur: 'DA',
  },
  en: {
    head: (n) => `Your order ${n} is confirmed ✅`,
    again: (n) => `Your order ${n} is already registered ✅`,
    fee: (v) => `Delivery: ${v}`,
    free: 'Delivery: free',
    total: (v) => `Total: ${v}, cash on delivery.`,
    eta: (a, b) => `Delivery in ${a} to ${b} days.`,
    beyond: 'Part of the order may take a little longer to be delivered.',
    replaced: (n) => `It replaces order ${n}, which is cancelled.`,
    thanks: 'Thank you for your trust!',
    cur: 'DA',
  },
};
const locOf = (lang: AiLanguage | string | undefined): Loc => (lang === 'ar' ? 'ar' : lang === 'arabizi' ? 'arabizi' : lang === 'en' ? 'en' : 'fr');

/** The confirmation of the order placed this turn, in the customer's language; null when no order was placed. */
export const orderConfirmationText = (calls: { name: string; result: unknown }[], lang: AiLanguage | string | undefined): string | null => {
  const o = placedOrder(calls);
  if (!o) return null;
  const t = T[locOf(lang)];
  const amount = (n: number) => `${money(n)} ${t.cur}`;
  const items = o.items.map((i) => {
    const qty = Number(i.quantity ?? 1) || 1;
    const unit = Number(i.unitPrice ?? 0) || 0;
    const name = [typeof i.name === 'string' ? i.name : '', typeof i.variant === 'string' && i.variant ? `(${i.variant})` : ''].filter(Boolean).join(' ');
    return `- ${qty} × ${name}${unit ? ` : ${amount(unit * qty)}` : ''}`;
  });
  const [a, b] = o.eta.split(/\s*[–-]\s*/);
  return [
    o.duplicate ? t.again(o.number) : t.head(o.number),
    ...items,
    o.deliveryFee > 0 ? t.fee(amount(o.deliveryFee)) : t.free,
    t.total(amount(o.total)),
    t.eta(a ?? '2', b ?? '5'),
    ...(o.beyondStock ? [t.beyond] : []),
    ...(o.replaced ? [t.replaced(o.replaced)] : []),
    t.thanks,
  ].join('\n');
};
