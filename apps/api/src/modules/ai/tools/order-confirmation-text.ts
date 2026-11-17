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

// --- the recap (journey retest R1-6 / R1-7, 17/11) ---------------------------------------------------------------------------
type Recap = { items: Line[]; deliveryFee: number; total: number; clientName: string; clientPhone: string; secondPhone: string | null; wilaya: string; communeName: string | null; address: string | null; isStopdesk: boolean; replaces: string | null; /** journey retest R2-7 */ wilayaAr?: string | null; communeAr?: string | null };
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/**
 * The recap a `create_order` of this turn returned for the customer to confirm (`CONFIRMATION_REQUIRED` of a first recap,
 * `recapToShow`), the latest one; null when there is none or an order was placed this turn.
 */
export const pendingRecap = (calls: { name: string; result: unknown }[]): Recap | null => {
  if (placedOrder(calls)) return null;
  for (const c of [...calls].reverse()) {
    if (c.name !== 'create_order') continue;
    const r = c.result as { error?: { code?: unknown }; recap?: Record<string, unknown>; recapToShow?: unknown } | null;
    if (r?.error?.code !== 'CONFIRMATION_REQUIRED' || r.recapToShow !== true || !r.recap || !Array.isArray(r.recap.items)) continue;
    const p = r.recap;
    return {
      items: p.items as Line[],
      deliveryFee: Number(p.deliveryFee ?? 0) || 0,
      total: Number(p.total ?? 0) || 0,
      clientName: s(p.clientName),
      clientPhone: s(p.clientPhone),
      secondPhone: s(p.secondPhone) || null,
      wilaya: s(p.wilaya),
      communeName: s(p.communeName) || null,
      address: s(p.address) || null,
      isStopdesk: p.isStopdesk === true,
      replaces: s(p.replaces) || null,
      wilayaAr: s(p.wilayaAr) || null,
      communeAr: s(p.communeAr) || null,
    };
  }
  return null;
};

const R: Record<Loc, { comma: string; head: string; home: (place: string) => string; stop: (place: string) => string; free: string; total: (v: string) => string; name: string; phone: string; phone2: string; address: string; replaces: (n: string) => string; ask: string; cur: string; sep: string }> = {
  fr: { comma: ', ', head: 'Voici le récapitulatif de votre commande :', home: (p) => `Livraison à domicile${p ? ` (${p})` : ''}`, stop: (p) => `Livraison en stop-desk${p ? ` (${p})` : ''}`, free: 'gratuite', total: (v) => `Total : ${v}, à payer à la livraison.`, name: 'Nom', phone: 'Téléphone', phone2: 'Deuxième téléphone', address: 'Adresse', replaces: (n) => `Elle remplacera la commande ${n}.`, ask: 'Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer.', cur: 'DA', sep: ' : ' },
  ar: { comma: '، ', head: 'هذا ملخص الطلبية:', home: (p) => `التوصيل للدار${p ? ` (${p})` : ''}`, stop: (p) => `التوصيل لنقطة الاستلام${p ? ` (${p})` : ''}`, free: 'مجاني', total: (v) => `المجموع: ${v}، الدفع عند الاستلام.`, name: 'الاسم', phone: 'الهاتف', phone2: 'الهاتف الثاني', address: 'العنوان', replaces: (n) => `هذي الطلبية تعوض الطلبية ${n}.`, ask: 'جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو.', cur: 'دج', sep: ': ' },
  arabizi: { comma: ', ', head: 'Hada récap ta3 la commande:', home: (p) => `Tawsil l dar${p ? ` (${p})` : ''}`, stop: (p) => `Tawsil l stop-desk${p ? ` (${p})` : ''}`, free: 'batel', total: (v) => `Total: ${v}, tkhalles ki tewsel.`, name: 'Smitek', phone: 'Numéro', phone2: 'Numéro lokhra', address: 'Adresse', replaces: (n) => `Hadi t3awed la commande ${n}.`, ask: 'Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou.', cur: 'DA', sep: ': ' },
  en: { comma: ', ', head: 'Here is your order summary:', home: (p) => `Home delivery${p ? ` (${p})` : ''}`, stop: (p) => `Stop-desk delivery${p ? ` (${p})` : ''}`, free: 'free', total: (v) => `Total: ${v}, cash on delivery.`, name: 'Name', phone: 'Phone', phone2: 'Second phone', address: 'Address', replaces: (n) => `It will replace order ${n}.`, ask: 'Reply « yes » to confirm the order, or tell me what to change.', cur: 'DA', sep: ': ' },
};
const folded = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** « Cité 20 Août, villa 3 » + « Boufarik » + « Blida »: the commune / wilaya are added when the address does not name them. */
const placeOf = (comma: string, base: string | null, ...more: (string | null | undefined)[][]) => {
  const parts = base ? [base] : [];
  // each place comes with its other spellings (Latin / Arabic): added once, in the first spelling given, when none is written yet
  for (const names of more) {
    const [m] = names.filter((x): x is string => !!x);
    if (m && !parts.some((p) => names.some((n) => !!n && folded(p).includes(folded(n))))) parts.push(m);
  }
  return parts.join(comma);
};
const itemLine = (i: Line, amount: (n: number) => string) => {
  const qty = Number(i.quantity ?? 1) || 1;
  const unit = Number(i.unitPrice ?? 0) || 0;
  const name = [s(i.name), s(i.variant) ? `(${s(i.variant)})` : ''].filter(Boolean).join(' ');
  return `- ${qty} × ${name}${unit ? ` : ${amount(unit * qty)}` : ''}`;
};

/**
 * journey retest R1-6 / R1-7: the recap the customer confirms, written by the server from the `CONFIRMATION_REQUIRED`
 * result in their language — every item with the catalogue name as written (never translated), the delivery mode and
 * its fee, the total, the name, the phone(s), the address, the replaced order. Pure.
 */
export const orderRecapText = (recap: Recap, lang: AiLanguage | string | undefined): string => {
  const loc = locOf(lang);
  const t = R[loc];
  const amount = (n: number) => `${money(n)} ${t.cur}`;
  // journey retest R2-7: an Arabic recap names the wilaya (and a commune of the list) in Arabic script, with « ، »
  const wilaya = loc === 'ar' ? [recap.wilayaAr, recap.wilaya] : [recap.wilaya, recap.wilayaAr];
  const commune = loc === 'ar' ? [recap.communeAr, recap.communeName] : [recap.communeName, recap.communeAr];
  const place = recap.isStopdesk ? (wilaya.find(Boolean) ?? '') : placeOf(t.comma, null, commune, wilaya);
  const fee = recap.deliveryFee > 0 ? amount(recap.deliveryFee) : t.free;
  return [
    t.head,
    ...recap.items.map((i) => itemLine(i, amount)),
    `- ${recap.isStopdesk ? t.stop(place) : t.home(place)}${t.sep}${fee}`,
    t.total(amount(recap.total)),
    ...(recap.clientName ? [`${t.name}${t.sep}${recap.clientName}`] : []),
    ...(recap.clientPhone ? [`${t.phone}${t.sep}${recap.clientPhone}`] : []),
    ...(recap.secondPhone ? [`${t.phone2}${t.sep}${recap.secondPhone}`] : []),
    ...(!recap.isStopdesk && recap.address ? [`${t.address}${t.sep}${placeOf(t.comma, recap.address, commune, wilaya)}`] : []),
    ...(recap.replaces ? [t.replaces(recap.replaces)] : []),
    t.ask,
  ].join('\n');
};

/** Latin digits, thousands separators dropped: the numbers a text writes. */
const numbersOf = (text: string) => new Set([...text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/(?<=\d)[ .,\u00a0\u202f](?=\d{3}(?!\d))/g, '').matchAll(/\d+/g)].map((m) => m[0]));
const wordsOf = (t: string) => ` ${folded(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
/**
 * The model's reply shows the whole recap as given: every product name as written, the total, the fee, the name and the
 * phone. Otherwise the server's recap is sent instead (« Votre commande de 3 tapis … attend votre confirmation » had no
 * line, no name and no phone; « جلابة رجالي » for « Djellaba homme »).
 */
export const recapComplete = (reply: string, recap: Recap): boolean => {
  const nums = numbersOf(reply);
  const w = wordsOf(reply);
  const has = (x: string) => !x.trim() || w.includes(wordsOf(x));
  return (
    nums.has(String(recap.total)) &&
    (recap.deliveryFee <= 0 || nums.has(String(recap.deliveryFee))) &&
    (!recap.clientPhone || nums.has(recap.clientPhone.replace(/\D/g, ''))) &&
    has(recap.clientName) &&
    recap.items.every((i) => has(s(i.name)))
  );
};

/**
 * What the customer gets when a recap is pending: the model's reply when it already shows the whole recap; else the
 * server's recap, after the model's sentence when that sentence answers something else (no amount, phone or product of
 * the recap in it, at most 2 sentences) — a partial recap of the model is dropped.
 */
export const recapReply = (reply: string, recap: Recap, lang: AiLanguage | string | undefined): { text: string; kept: 'model' | 'prefix' | 'server' } => {
  const full = reply.trim();
  if (full && recapComplete(full, recap)) return { text: full, kept: 'model' };
  const server = orderRecapText(recap, lang);
  // journey retest R2-6: the model's own « Répondez oui pour confirmer » is dropped — the server recap ends with the request
  const all = full.split(/(?<=[.!?؟])\s+|\n+/).filter((x) => x.trim());
  // journey retest R3-4: nor a sentence about the recap itself (« le récapitulatif va vous être envoyé », « Recap ydhher dork »,
  // « I have everything for your order », « بدلنا الطلبية لـ 2 … ») — what is kept is a short lead-in or an answer to another question
  const about = (x: string) => [folded(x), x.toLowerCase()].some((v) => CONFIRM_ASK.test(v) || RECAP_TALK.test(v));
  const kept = all.filter((x) => !about(x));
  const text = kept.join(' ').trim();
  const nums = numbersOf(text);
  const w = wordsOf(text);
  // journey retest R2-6: the address said again before the recap (« j'ai bien noté l'adresse : rue des frères Bouadou n 5 ») is part of it
  const address = recap.isStopdesk ? '' : s(recap.address);
  const partial = nums.has(String(recap.total)) || (!!recap.clientPhone && nums.has(recap.clientPhone.replace(/\D/g, ''))) || recap.items.some((i) => s(i.name) && w.includes(wordsOf(s(i.name)))) || (address.length >= 6 && w.includes(wordsOf(address)));
  if (text && !partial && kept.length <= 2 && text.length <= 280) return { text: `${text}\n\n${server}`, kept: 'prefix' };
  return { text: server, kept: 'server' };
};
/** A request to confirm the order (folded): the server recap already ends with one. */
// journey retest R3-4: also « استني تأكيدك بـ « إيه » », « t7ebb nkamlouh b confirmation ? », « prête à être confirmée »
const CONFIRM_ASK = /r[e]?pond(?:ez|s)?\s+(?:par\s+)?\W{0,3}oui|(?:pour|de)\s+confirmer|confirmez|je\s+confirme\s+(?:la|votre)\s+commande|confirmation|(?:a|à)\s+[eê]tre\s+confirm|attend(?:s|ons)?\s+votre|en\s+attente\s+de\s+votre|repl(?:y|ies)\s+\W{0,3}yes|(?:say|answer)\s+\W{0,3}yes|to\s+confirm|confirm\s+(?:the|your)\s+order|(?:waiting|wait)\s+for\s+your|ktebli\s+\W{0,3}(?:ih|iyeh|oui)|goulli\s+\W{0,3}(?:ih|iyeh)|bach\s+n?confirm|n?confirmi|nestanna|جاوبني|باش\s+نأكد|باش\s+نكد|لتأكيد|للتأكيد|أكد\s+لي|تأكيد|نستنى|استنى|استني|نستنا/u;
/**
 * journey retest R3-4: a sentence about the recap or the order being ready — the recap that follows says it all. Words of
 * the recap (récap, summary, ملخص), its sending (« va vous être envoyé », « ydhher »), « I have everything », « commande prête »,
 * and a change described (« بدلنا الطلبية », « j'ai modifié la commande », « I've updated your order »).
 */
const RECAP_TALK = /r[eé]?cap|r[ée]sum[ée]|summary|ملخص|voici\s+(?:votre|la)\s+commande|here(?:'s|\s+is)\s+(?:your|the)\s+order|va\s+vous\s+[eê]tre\s+envoy|vous\s+sera\s+envoy|ydh+er|yban|(?:i|we)\s+(?:have|got)\s+everything|(?:j['’]ai|on\s+a|nous\s+avons)\s+(?:bien\s+)?tout|all\s+set|(?:commande|order)\s+(?:est\s+)?(?:pr[eê]te|ready)|(?:modifi|mis\s+a\s+jour|mise\s+a\s+jour|updated|changed|bdelna|beddelna|beddelt|bedelt)\S*\s+(?:\S+\s+)?(?:la\s+|votre\s+|your\s+|the\s+)?(?:commande|order)|(?:بدلنا|بدلت|بدّلنا|عدلنا|عدلت)\s+(?:لك\s+)?(?:الطلبية|الطلب|الكوموند)/u;

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
