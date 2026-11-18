// Retest 12/11 (« the bot still transfers to a team member for no reason, even after a hello; once confused in a chat it
// keeps behaving abnormally »): the model's decision to hand a conversation to the team is checked by the server, on
// both ways it can take it — the `handoff_to_human` tool and `status = HANDOFF` in its answer (that second way was never
// checked: the « customer_request · no tool » handoffs of the 11/11 diagnostic).
//
// A reason the model judges (the customer asks for a human, a refund, a complaint, anger, a request only the team can
// handle, a shop rule) must come with `evidence`: the customer's own words, from the message(s) being answered, that
// match the rule. The server finds them in that message — so a greeting, a photo, an earlier message of the thread
// (what the model kept « re-reading » once confused) or a question it cannot answer never hands off. Reasons the server
// establishes itself (a tool result, the unclear streak, a blocked word) are not re-judged.
import { HANDOFF_REASONS } from '@djaber/shared';
import { containsWord, foldText } from '../catalog/moderation-prescreen.service';
import { isGreetingOnly } from '../messaging/greeting';
import { UNCLEAR_STREAK_HANDOFF } from './ai.constants';
import { confirmation } from './tools/order-confirmation';
import { productNamedIn, productWanted, teamOnlyRequest } from './product-named';

/** Set by the server (tool results, counters, safety): the model's word is not needed. */
const SERVER_REASONS = new Set(['order_limits', 'risky_client', 'blocked_word', 'orders_unavailable', 'outside_window', 'ai_error', 'abuse_guard', 'credits_exhausted', 'quota_exceeded']);
/** Rule ids of the prompt and older names the model may still write. */
const ALIASES: Record<string, string> = { human_request: 'customer_request', human: 'customer_request', anger: 'angry', over_limits: 'order_limits', order_limit: 'order_limits', off_topic: 'off_catalogue', '3_unclear': 'unclear_streak' };

export type HandoffRefusal = 'greeting' | 'no_evidence' | 'evidence_not_in_message' | 'no_shop_rule' | 'keyword_absent' | 'not_unclear' | 'reason_mismatch' | 'server_reason' | 'not_sold' | 'in_catalogue';

/**
 * journey retest R4-1 (17/11): the server reasons a tool result of THIS turn established — `create_order` above a limit
 * (`hint: 'order_limit'`), a blocked / risky customer, orders unavailable. Only these let the model write such a reason.
 */
export function establishedReasons(results: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const x of results) {
    const r = x as { hint?: unknown; error?: { code?: unknown } } | null;
    if (r?.hint === 'order_limit') out.add('order_limits');
    if (r?.hint === 'risky_client' || r?.error?.code === 'CUSTOMER_BLOCKED') out.add('risky_client');
    if (r?.error?.code === 'ORDERS_UNAVAILABLE') out.add('orders_unavailable');
  }
  return [...out];
}
export type HandoffVerdict = { ok: true; reason: string } | { ok: false; reason: string; why: HandoffRefusal };

/** The reason as the platform names it (`statusDetail` is free text: an unknown value is `other`). */
export function handoffReason(raw: string | null | undefined): string {
  const r = (raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const known = ALIASES[r] ?? r;
  return SERVER_REASONS.has(known) || known === 'unclear_streak' || (HANDOFF_REASONS as readonly string[]).includes(known) ? known : 'other';
}

const words = (s: string) =>
  foldText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Are these words the customer's? The whole quote inside the message, or — a model often trims or re-spaces a quote — at
 * least 2 of its words (all of them for a one-word quote) and 60 % of them found in the message.
 */
export function quotedFrom(evidence: string, message: string): boolean {
  const q = words(evidence);
  const m = words(message);
  if (!q.length || !m.length) return false;
  if (` ${m.join(' ')} `.includes(` ${q.join(' ')} `)) return true;
  const inMessage = new Set(m);
  const hits = q.filter((w) => inMessage.has(w)).length;
  return q.length === 1 ? hits === 1 : hits >= 2 && hits / q.length >= 0.6;
}

export type HandoffInput = {
  reason: string | null | undefined;
  evidence?: string | null;
  /** the customer's words of the message(s) being answered (text and voice transcripts) */
  customerText: string;
  /** the agent's « Shop rules » (the only use of `other`) */
  shopRules?: string | null;
  /** the agent's handoff keywords */
  keywords?: readonly string[];
  /** unclear turns in a row before this one */
  unclearStreak?: number;
  /** journey retest R4-1: the server reasons this turn's tool results established (`establishedReasons`) */
  established?: readonly string[];
  /**
   * journey retest R13-1: the product of the shop's catalogue the customer's message names, as the server's own catalogue check
   * found it (`productNamedIn` over the agent's scope) — null / absent when none
   */
  soldNamed?: string | null;
};

export function judgeHandoff(i: HandoffInput): HandoffVerdict {
  const reason = handoffReason(i.reason);
  // journey retest R4-1 (17/11): a server reason is a tool outcome, never the model's choice — `handoff_to_human { order_limits,
  // evidence « placeholder » }` was accepted on « Je voudrais le sac à main cuir marron » (1 item, limit 5) and on an address
  if (SERVER_REASONS.has(reason)) return (i.established ?? []).includes(reason) ? { ok: true, reason } : { ok: false, reason, why: 'server_reason' };
  // the prompt asks for it on the 3rd unclear message in a row only
  if (reason === 'unclear_streak') return (i.unclearStreak ?? 0) >= UNCLEAR_STREAK_HANDOFF - 1 ? { ok: true, reason } : { ok: false, reason, why: 'not_unclear' };
  const text = i.customerText.trim();
  if (reason === 'keyword') {
    const keywords = (i.keywords ?? []).map((k) => k.trim()).filter(Boolean);
    return keywords.length && text && containsWord(foldText(text), keywords) ? { ok: true, reason } : { ok: false, reason, why: 'keyword_absent' };
  }
  if (reason === 'other' && !(i.shopRules ?? '').trim()) return { ok: false, reason, why: 'no_shop_rule' };
  if (!text || isGreetingOnly(text)) return { ok: false, reason, why: text ? 'greeting' : 'no_evidence' };
  const evidence = (i.evidence ?? '').trim();
  if (!evidence) return { ok: false, reason, why: 'no_evidence' };
  if (isGreetingOnly(evidence) || !quotedFrom(evidence, text)) return { ok: false, reason, why: 'evidence_not_in_message' };
  // journey retest R11-2 (17/11): « vous avez des lunettes de soleil ? » is a product the shop does not sell — answered (« nous ne
  // vendons pas … » + the catalogue), never a handoff (N7 T1 `off_catalogue` accepted, shop closed, full order details given)
  if (reason === 'off_catalogue' && productAsk(evidence, text)) return { ok: false, reason, why: i.soldNamed && !teamOnlyRequest(text) ? 'in_catalogue' : 'not_sold' };
  // journey retest R13-1 (18/11): « Je voudrais le sac à main cuir marron » (Marron in stock) was handed off as off_catalogue — the
  // judge only knew « vous avez / je cherche … ». A message that names a product the shop sells (the server's catalogue check), or
  // wants / asks for a product in any phrasing (« je voudrais / je veux / nheb / بغيت / I want … »), is answered, never handed off as
  // off_catalogue — unless it asks for what only the team can quote (wholesale, a quote, a custom order, a partnership)
  if (reason === 'off_catalogue' && !teamOnlyRequest(text)) {
    if (i.soldNamed) return { ok: false, reason, why: 'in_catalogue' };
    if (productWanted(evidence) || productWanted(text)) return { ok: false, reason, why: 'not_sold' };
  }
  if (!reasonFits(reason, evidence, text)) return { ok: false, reason, why: 'reason_mismatch' };
  return { ok: true, reason };
}

/**
 * journey retest R11-2: a message (or its quoted words) that asks whether the shop has / sells a product, or asks for one
 * (« vous avez des lunettes de soleil ? », « do you sell … », « 3andkom … ? », « عندكم … ؟ », « je cherche … ») — and asks nothing only
 * the team can quote (wholesale, a custom order, a partnership). Folded text.
 */
const PRODUCT_ASK =
  /(?<![\p{L}])(?:vous\s+avez|avez[- ]vous|vous\s+vendez|vendez[- ]vous|vous\s+faites|faites[- ]vous|est[- ]ce\s+(?:que|qu['’])\s*(?:vous|tu)\s+(?:avez|as|vendez|vends)|il\s+y\s+a|y\s+a[- ]t[- ]il|tu\s+as|t['’]as|as[- ]tu|do\s+you\s+(?:have|sell|carry)|have\s+you\s+got|is\s+there|are\s+there|3and(?:kom|kem|koum|ek)|3ndkom|3endkom|kayen|kayn|kayna|kaynin|tbi3(?:o|ou|ou)|tbi3iw|je\s+cherche|i\s+am\s+looking|looking\s+for|n9alleb|nqalleb|عندكم|عندك|كاين|كاينة|كاينين|تبيعو|تبيعوا)(?![\p{L}])/u;
export const productAsk = (evidence: string, message: string): boolean => {
  const m = foldText(message).replace(/[’‘`]/g, "'");
  if (TEAM_ONLY_REQUEST.test(m)) return false;
  return PRODUCT_ASK.test(foldText(evidence).replace(/[’‘`]/g, "'")) || PRODUCT_ASK.test(m);
};

/** Words that ask for the team (a person, the seller, a call) — fr / en / darija / arabizi / Arabic script, folded. */
const ASKS_TEAM =
  /human|humain|conseill|responsable|personne|quelqu|parler|appel|rappel|telephon|vendeu|proprietaire|gerant|operat|equipe|service client|someone|somebody|person|real|staff|team|representative|talk|speak|call|manager|agent|bnadem|nhder|nehder|nahder|kalem|kelem|klem|3ayet|3eyet|a3yet|انسان|مسؤول|شخص|نهدر|تهدر|نتكلم|تكلم|كلم|اتصل|عيط|موظف|بشر|صاحب المحل|البائع/;
/** A cancellation or a change of an order asked in words. */
const ORDER_CHANGE = /annul|cancel|batel|btel|modifi|chang|bedel|beddel|ألغ|الغ|بطل|بدل/;
/** A refund asked in words. */
const ASKS_REFUND = /rembours|refund|money back|argent|flous|drahm|dra7m|nerja3|nrja3|rja3|retour|retourn|rendre|return|فلوس|دراهم|ترجع|نرجع|رجع|استرجاع|ارجاع/;
/** journey 16/11 J04-5: a discount / price / free delivery « the owner promised » — answered with the catalogue price (identity rule), never a handoff. */
const PRICE_CLAIM = /patron|boss|owner|proprietaire|gerant|le chef|la chef|moul |صاحب|المدير|مول |remise|reduc|rabais|discount|promo|solde|moins cher|gratuit|offert|free delivery|livraison a 0|-\s?\d+\s?%|\d+\s?%|تخفيض|خصم|تخفيظ|بلاش|remiz|takhfid/;
/** …unless the customer asks for what only the team can quote (wholesale, a custom order, a partnership). */
const TEAM_ONLY_REQUEST = /gros|grossiste|revendeu|wholesale|reseller|jumla|jomla|جمله|sur mesure|personnalis|custom|partenariat|partner|collaboration/;
/**
 * journey retest R14-3 (18/11): words of a complaint — a problem with an order or a product, a scam, a delay, disappointment — fr / en /
 * arabizi / Arabic script, folded (`foldText`: accents, Arabic marks and hamza dropped, ة → ه). N9 T1 « ab3athli tswira … le tissu, les
 * tailles ? » got `handoff_to_human { complaint, evidence « unused » }` (refused, 15.7 s).
 */
const COMPLAINT_WORDS = new RegExp(
  [
    String.raw`plainte|reclam|arnaq|escroq|voleu?r|inadmissible|inacceptable|honte|honteu|scandal|decu|deception|mecontent|pas\s+content|pas\s+satisfait|insatisfait|(?<![\p{L}])nule?(?![\p{L}])|mauvaise?\s+qualite|pas\s+conforme|non\s+conforme|abim|cass[ee]|dechir|troue|tache|(?:ne\s+)?(?:marche|fonctionne)\s+pas|defectu|defaut|probleme|souci|retard|jamais\s+(?:recu|arriv)|pas\s+(?:recu|arriv)|toujours\s+pas|rien\s+recu|contrefa|pas\s+(?:le|la)\s+bon|trompe|menti|mensonge`,
    String.raw`complain|scam|fraud|disappoint|unacceptable|terrible|awful|worst|broken|damaged|defective|never\s+(?:arrived|came|received)|not\s+(?:arrived|received)|(?<![\p{L}])fake(?![\p{L}])|poor\s+quality|wrong\s+(?:item|size|product|colou?r)`,
    String.raw`mo?u?chkil|mushkil|machakil|ghalet|ghalta|ghlat|khayeb|khayba|ma\s*3j[ae]?bn?i(?:ch|tch)|ma\s*wsel(?:ch|tch|ni)|ma\s*wsl(?:at)?ch|ma\s*wselt(?:ch|ni)|nass?ab|sarr?ak|serak|kd[ae]b|[7h]chouma|mkass?r|tkasser|m9atta3`,
    String.raw`شكوي|شكوى|نشكي|مشكل|غالط|غلط|خايب|ماعجبنيش|ما\s+عجبنيش|ماوصل|ما\s+وصل|ماوصلتنيش|نصاب|سراق|سارق|كذاب|كذب|حشومه|مكسور|معطل|مزور|تقليد|تاخر|روطار`,
    String.raw`(?:ca\s+fait|depuis|hadi|fatet|fat|هادي|فاتت|فات|عندي)\s+\d+\s*(?:jours?|semaines?|mois|days?|weeks?|ayam|iyam|smana|smanat|يوم|ايام|سمانه|سمانات|اسبوع|اسابيع|شهر)`,
  ].join('|'),
  'u',
);
/** journey retest R14-3: words / marks of anger (insults, « !! », « ?! ») — with the complaint words, what `angry` needs. */
const ANGER_WORDS = /!{2,}|\?!|!\?|merde|putain|connard|idiot|imbecile|foutez|fout(?:re|u)|(?<![\p{L}])wtf(?![\p{L}])|damn|stupid|mahboul|[7h]mar(?![\p{L}])|kelb|حمار|كلب|مهبول|تفو|زبل/u;
/** Words of 4 letters or more all in capitals (« C'EST INADMISSIBLE, VOUS ÊTES OÙ ») — a raised voice (two of them: one may be a brand). */
const SHOUTING = /(?<![\p{L}])\p{Lu}{4,}(?![\p{L}])/gu;
/** journey retest R14-3: the message (or the quoted words) carries a complaint. */
export const complaintIn = (text: string): boolean => COMPLAINT_WORDS.test(foldText(text).replace(/[’‘`]/g, "'"));
/** journey retest R14-3: the message carries anger (or a complaint) — a raised voice, an insult, « !! ». */
export const angerIn = (text: string): boolean => complaintIn(text) || ANGER_WORDS.test(foldText(text)) || (text.replace(/(?<![\p{L}])(?:CMD|TEST|SKU|PRD)-?\S*/gu, '').match(SHOUTING)?.length ?? 0) >= 2;
/**
 * journey retest R14-3: a question about an order already made — where it is, when it arrives, its tracking number (« وين راهي الطلبية
 * تاعي؟ وقتاش توصلني », « où est ma commande ? », « win rahi la commande »). lookup_order answers it: never `off_catalogue`.
 */
const ORDER_STATUS_ASK = /(?<![\p{L}])(?:ou\s+(?:est|en\s+est)\s+(?:ma|mon|la|le)\s+(?:commande|colis)|suivi|tracking|track|statut|status|where\s+is\s+my|win\s+rahi|win\s+raha|wsel(?:et|t)?|وين\s+راهي|وين\s+راه|وين\s+وصلت|وقتاش\s+توصل|رقم\s+(?:ال)?تتبع|نتبعها|نتبعو|كولي|colis)(?![\p{L}])/u;
export const orderStatusAsk = (text: string): boolean => ORDER_STATUS_ASK.test(foldText(text).replace(/[’‘`]/g, "'"));

/** journey 16/11 J04-5: a question about the assistant itself (« are you a robot? », « tu t'appelles comment ? ») — rule 11: answered. */
const WANTS_TO_TALK = /parler|talk|speak|nhder|nehder|nahder|kalem|klem|appel|call|rappel|3ayet|a3yet|نهدر|نتكلم|تكلم|كلم|اتصل|عيط|humain svp|human please|conseiller|responsable/;
const ABOUT_ASSISTANT = /ton nom|votre nom|your name|t'?appel+es|vous appelez|smitek|smiytek|esmek|اسمك|who are you|qui es[ -]tu|qui etes[ -]vous|chkoun nta|شكون نتا|are you (a |an )?(robot|bot|human|real|ai)\b|(t'?es|tu es|vous etes|etes[ -]vous|es[ -]tu) (un |une )?(robot|bot|ia|humain|vrai)\b|nta robot|enta robot|انت روبوت|راك روبوت/;

/**
 * journey 16/11 J04-5: the quoted words must fit the reason, not only be the customer's — « What is your name? are you a
 * robot? » handed off as `customer_request`, « Le patron a dit -50 % » as `off_catalogue`. `customer_request` needs words
 * asking for a person, `refund` words asking for money back; `off_catalogue` and `complaint` are never a claimed discount
 * nor a question about the assistant. `angry` and the shop's own rules (`other`) stay the model's judgement.
 */
export function reasonFits(reason: string, evidence: string, message: string): boolean {
  // curly apostrophes (« t’es », « t’appelles ») read as straight ones
  const e = foldText(evidence).replace(/[’‘`]/g, "'");
  const m = foldText(message).replace(/[’‘`]/g, "'");
  // « tu t'appelles comment ? » is not « appeler » (a call)
  const noName = (x: string) => x.replace(/t'?appel+es|vous appelez/g, ' ');
  const either = (re: RegExp) => re.test(noName(e)) || re.test(noName(m));
  // « are you a real person? » asks about the assistant; « je veux parler à un humain, t'es un robot ? » asks for the team
  // or a cancellation / change the AI cannot make itself (the prompt hands off ORDER_CONFIRMED_BY_SELLER as customer_request)
  if (reason === 'customer_request') return (either(ASKS_TEAM) || either(ORDER_CHANGE)) && !(ABOUT_ASSISTANT.test(m) && !WANTS_TO_TALK.test(noName(m)));
  if (reason === 'refund') return either(ASKS_REFUND);
  // journey retest R14-3 (18/11): a complaint needs the words of one, anger its words or marks — in the message or the quoted words
  if (reason === 'complaint' && !complaintIn(evidence) && !complaintIn(message)) return false;
  if (reason === 'angry' && !angerIn(evidence) && !angerIn(message)) return false;
  if (reason === 'off_catalogue' || reason === 'complaint') {
    if (ABOUT_ASSISTANT.test(e) && !ASKS_TEAM.test(noName(e))) return false;
    if (reason === 'off_catalogue' && PRICE_CLAIM.test(e) && !TEAM_ONLY_REQUEST.test(m)) return false;
  }
  return true;
}

/**
 * journey retest R4-1 (17/11): the reasons the model may write — the rules a customer message can trigger (customer_request,
 * refund, complaint, angry, off_catalogue, keyword, other with « Shop rules », unclear_streak on the 3rd). `order_limits`,
 * `risky_client`, `orders_unavailable` are server outcomes of `create_order`: never offered.
 * journey retest R3-3 (17/11): the `handoff_to_human` reasons this agent's rules allow right now — `other` only with « Shop
 * rules », `keyword` only with keywords, `unclear_streak` only on the 3rd unclear message, no built-in rule the shop turned
 * off. 4 calls `{ reason: "other" }` on an order / name / phone message of two shops without shop rules were refused
 * (`no_shop_rule`) after a model round each; the tool is no longer offered with that reason (none left ⇒ no tool).
 */
export function allowedHandoffReasons(agent: { humanHandoffRules?: string | null; handoffKeywords?: readonly string[] | null; handoffRules?: unknown }, unclearStreak = 0, customerText?: string): string[] {
  const off = new Set((Array.isArray(agent.handoffRules) ? (agent.handoffRules as { kind?: unknown; enabled?: unknown }[]) : []).filter((r) => r && r.enabled === false && typeof r.kind === 'string').map((r) => handoffReason(r.kind as string)));
  return HANDOFF_REASONS.filter((r) => {
    if (r === 'other') return !!(agent.humanHandoffRules ?? '').trim();
    // journey retest R6-5 (17/11): `keyword` only when a keyword is in the customer's message (N3: `handoff_to_human { keyword }`
    // on « khouya twasslou l Constantine ? », refused keyword_absent after a model round) — the judge's own test
    if (r === 'keyword') {
      const keywords = (agent.handoffKeywords ?? []).map((k) => k.trim()).filter(Boolean);
      return !!keywords.length && (customerText === undefined || (!!customerText.trim() && containsWord(foldText(customerText), keywords)));
    }
    if (r === 'unclear_streak') return unclearStreak >= UNCLEAR_STREAK_HANDOFF - 1 && !off.has(r);
    return !SERVER_REASONS.has(r) && !off.has(r);
  });
}

/** What the model is told when its handoff is refused: it answers the customer in the same turn. */
export const HANDOFF_REFUSED_MARK = 'HANDOFF REFUSED BY THE PLATFORM';
export function handoffRefusedInstruction(why: HandoffRefusal, product?: string | null): string {
  const cause: Record<HandoffRefusal, string> = {
    greeting: 'the customer only greets you: this is a (new) conversation, welcome them and help',
    no_evidence: 'no words of the customer in their current message ask for it',
    evidence_not_in_message: "the words you gave as evidence are not in the customer's current message (earlier messages are already handled)",
    no_shop_rule: 'no handoff rule applies (reason "other" is only for a « Shop rules » item)',
    keyword_absent: 'no handoff keyword is in the current message',
    not_unclear: 'this is not the 3rd unclear message in a row',
    reason_mismatch:
      "the customer's words do not match that rule: a discount, a price or free delivery « the owner / the team said » is answered with the catalogue price and the delivery fee (politely, no handoff); a question about you (your name, are you a robot) is answered: you are the shop's virtual assistant; customer_request needs words asking for a person; complaint needs a problem the customer describes (an order not received, a broken or wrong product, a delay), angry an angry message — a question about a product or an order is answered (lookup_order for an order)",
    server_reason: 'that reason is set by the platform from a tool result (create_order above a limit, a blocked customer), never by you — no tool of this turn reported it; an order message is taken as usual (ask the next missing field, or call create_order for the recap)',
    not_sold:
      "a product the shop does not sell is answered by you, never handed off: say plainly that the shop does not sell it (« nous ne vendons pas de … pour le moment »), then offer what the CATALOGUE lists in stock; when the customer also gave their details, take the order as usual once they choose a product (status OK)",
    in_catalogue: `the customer's words name a product the shop sells${product ? ` (« ${product} »)` : ''}: answer it from the CATALOGUE (price, the variants in stock) and take the order as usual — a product of the shop is never a handoff (status OK)`,
  };
  return `${HANDOFF_REFUSED_MARK}: ${cause[why]}. Keep the conversation and answer the customer's current message now, in their language (status OK; UNKNOWN when you have no answer — say you will check with the team and call add_faq_candidate; UNCLEAR when you did not understand). Hand off only when the customer's current message itself matches a rule, quoting their words in "evidence". Answer with the JSON object only.`;
}

/** A message that starts by giving the customer's name. */
const NAME_INTRO = /^(?:je\s+m['’]?\s*appelle|moi\s+c['’]?est|mon\s+nom\s+(?:est|c['’]?est)|my\s+name\s+is|smiti|esmi|ismi|asmi|اسمي|إسمي|سميتي)\s+\p{L}/iu;
/** Words that can ask for the team in a short message (« un humain svp », « rembourse », « arnaque »…). */
const TEAM_WORDS = /human|humain|conseill|responsable|personne|parler|appel|rappel|rembours|refund|arnaq|plainte|voleur|scam|manager|agent|bnadem|nhder|nehder|انسان|مسؤول|شخص|نهدر|سارق|نصاب|ترجع|فلوس|flous/;
/** journey retest R7-4: words of a problem with an order (a complaint), in a message that also gives a phone. */
const PROBLEM_WORDS = /jamais\s+(?:recu|arriv)|pas\s+(?:recu|arriv)|retard|cass[ee]|abim|defect|defectu|probleme|mochkil|wrong|damaged|broken|never\s+(?:arrived|came)|not\s+(?:arrived|received)|ma\s*wsel(?:ch|tch)|ma\s*wsl(?:at)?ch|ماوصل|ما\s+وصل|مكسور|مشكل|غالط/;
/**
 * journey retest R7-4 (17/11): a message that gives the order's details with a valid phone number and asks nothing of the
 * team — no question, no word asking for a person, a refund, a change or a cancellation, no problem with an order
 * (« Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4 »). The
 * `handoff_to_human` tool is not offered then: N5 T2 called it `{ off_catalogue, evidence « none » }` next to the recap,
 * refused after a model round. A real request still goes through `status = HANDOFF` (judged).
 */
export function orderDetailsMessage(text: string | undefined, validPhone: (t: string) => boolean, questionsOk = false): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 300 || (!questionsOk && /[?؟]/.test(t)) || !validPhone(t)) return false;
  const f = foldText(t);
  return !TEAM_WORDS.test(f) && !ASKS_TEAM.test(f) && !ORDER_CHANGE.test(f) && !ASKS_REFUND.test(f) && !PROBLEM_WORDS.test(f);
}

/**
 * journey retest R11-2 / R11-3 (17/11): of the reasons the agent allows (`allowedHandoffReasons`), those THIS message can carry — the
 * judge would refuse the others anyway, after a model round each: `customer_request` needs words asking for a person or a change /
 * cancellation, `refund` words asking for money back; `off_catalogue` is never a question about a product the shop may not sell
 * (`productAsk`); on a message that gives the order's details with a phone and no team / refund / change / problem word (a product
 * question allowed) neither `off_catalogue`, `complaint`, `angry` nor a shop rule (`other`) applies. N7 T1 « vous avez des lunettes de
 * soleil ? Je suis Yacine Mansouri 0555987654, Blida, … » got `off_catalogue` accepted (the R7 rule skipped it for its « ? »). No
 * reason left ⇒ the tool is not offered; `status = HANDOFF` stays judged.
 */
export function messageHandoffReasons(reasons: string[], customerText: string | undefined, validPhone: (t: string) => boolean, catalogueNames?: readonly string[]): string[] {
  if (customerText === undefined) return reasons;
  const t = customerText.trim();
  const f = foldText(t).replace(/[’‘`]/g, "'");
  const details = orderDetailsMessage(t, validPhone, true);
  // journey retest R13-1 (18/11): nor on a message that wants a product (« Je voudrais le sac à main cuir marron ») or names one of the
  // CATALOGUE (its folded names, with the variants) — unless it asks for what only the team can quote
  const team = teamOnlyRequest(t);
  const wantsProduct = !team && (productWanted(t) || (!!catalogueNames?.length && !!productNamedIn(t, catalogueNames.map((name, i) => ({ id: String(i), name })))));
  return reasons.filter((r) => {
    if (r === 'customer_request') return ASKS_TEAM.test(f) || ORDER_CHANGE.test(f);
    if (r === 'refund') return ASKS_REFUND.test(f);
    // journey retest R14-3 (18/11): nor on a question about an order already made (N11 T3 « وين راهي الطلبية تاعي؟ … »: lookup_order answers)
    if (r === 'off_catalogue') return !details && !productAsk(t, t) && !wantsProduct && !orderStatusAsk(t);
    // journey retest R14-3: `complaint` needs words of a complaint, `angry` words / marks of anger (N9 T1 `complaint` probe on a photo
    // request, N11 T3 on a tracking question)
    if (r === 'complaint') return !details && complaintIn(t);
    if (r === 'angry') return !details && angerIn(t);
    if (r === 'other') return !details;
    return true;
  });
}

/** Arabic-script words of a short message that is no name (yes / no, thanks, greetings, order and question words). */
const NOT_A_NAME_AR = /(?<![؀-ۿ])(?:نعم|ايه|إيه|واه|لا|شكرا|صحيت|السلام|عليكم|سلام|مرحبا|اهلا|أهلا|نحب|حاب|نشري|بغيت|حي|شارع|عمارة|ولاية|بلدية|قداش|شحال|واش|وين|كيفاش|تمام|صافي|الطلبية|طلبية|التوصيل|ماشي|بزاف|خويا|اختي|عندكم|كاين|درك|غدوة|اليوم|وقتاش|كاش|علاش|شكون|منين|فاين|قداه|توصل|وصلت|وصل|جات|خرجت|مازال|راهي|راه|هذا|هاذا|هاذي|هادي|انا|أنا|نتا|نتي|ما|مكانش|ماكانش|بصح|برك|زوج|جوج|واحد|حجاب|جلابة|سعر|الثمن)(?![؀-ۿ])/u;
/** Latin words of a short message that is no name (greetings, thanks, yes / no, order words). */
const NOT_A_NAME_LATIN = /^(?:merci|bonjour|bonsoir|salut|salam|slm|cc|ok|okay|oui|non|svp|stp|thanks|thank|hello|hi|yes|no|parfait|super|daccord|d'accord|ih|wah|saha|sahit|bien|tres|livraison|commande|prix|stock)$/i;
/**
 * journey retest R11-3 (17/11): a message that is only a name — one to four Arabic-script words (« نادية قاسي ») or two / three
 * capitalised Latin words (« Nadia Kaci ») and nothing else. N21 T2 `handoff_to_human { unclear_streak, evidence « نادية قاسي » }`.
 */
export function nameOnlyMessage(text: string | undefined): boolean {
  const t = (text ?? '').trim().replace(/[.!،,]+$/u, '');
  if (!t || t.length > 60) return false;
  if (/^[؀-ۿ]+(?:\s+[؀-ۿ]+){0,3}$/u.test(t)) return !NOT_A_NAME_AR.test(t);
  const w = t.split(/\s+/);
  return w.length >= 2 && w.length <= 3 && w.every((x) => /^\p{Lu}[\p{Ll}'’-]+$/u.test(x) && !NOT_A_NAME_LATIN.test(x));
}

/** Small words that go with a place name (« ana f Bab Ezzouar », « wilaya de Sétif », « Alger centre »). */
const PLACE_SMALL_WORDS = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'l', 'a', 'à', 'au', 'en', 'w', 'f', 'fi', 'el', 'al', 'et', 'ana', 'je', 'suis', 'wilaya', 'commune', 'centre', 'ville', 'men', 'mn', 'from', 'in']);
/**
 * journey retest R11-3: a short message that may only name a place (« Sétif, El Eulma », « البليدة، بوفاريك ») — capitalised Latin
 * words (and the small words of a place), or Arabic-script words that are no order / question / greeting word. Only such a message
 * is looked up in the wilaya / commune lists (`placeOnlyMessage`).
 */
export function placeCandidate(text: string | undefined): boolean {
  const t = (text ?? '').trim().replace(/[.!]+$/u, '');
  if (!t || t.length > 80 || /[?؟\d]/.test(t)) return false;
  const w = t.split(/[\s,،]+/u).filter(Boolean);
  if (!w.length || w.length > 6) return false;
  if (w.every((x) => /^[؀-ۿ]+$/u.test(x))) return !NOT_A_NAME_AR.test(t);
  return w.some((x) => /^\p{Lu}/u.test(x)) && w.every((x) => /^\p{Lu}[\p{L}'’-]*$/u.test(x) || PLACE_SMALL_WORDS.has(x.toLowerCase()));
}

/**
 * full-test 15/11 AI-CHAT-07 (proposal 9): a message that is only an order field — a phone number, or, while an order is
 * being taken, a short answer with no question and no word asking for the team (« Sétif », « Bab Ezzouar », « Karim
 * Haddad », « cité 20 août villa 3 »). The `handoff_to_human` tool is then not offered: every such handoff was refused
 * by the judge and cost a model round of 5–10 s. A real request still goes through `status = HANDOFF` (judged).
 */
export function fieldOnlyMessage(text: string | undefined, ordering: boolean): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 120) return false;
  // journey retest R11-3: an 8-digit number is a phone typed short (F8 T3 « 05559876 » got a handoff probe): still a field
  if (/^[\s+()\d.\-/٠-٩]{8,20}$/.test(t)) return true;
  if (/[?؟]/.test(t) || TEAM_WORDS.test(foldText(t))) return false;
  // journey retest R1-5: a bare yes (« oui », « ih », « yes », « ايه », « oui c'est bon ») never asks for the team — handoff
  // was asked on « oui », « yes », « ih » after a recap or an order
  if (words(t).length <= 4 && confirmation(t) === 'yes') return true;
  // journey retest R2-4: « اسمي سمير بن علي », « smiti Walid Bouzid », « je m'appelle Karim » — the customer's name, ordering or
  // not (handoff_to_human { reason: unclear_streak } was asked on it)
  if (words(t).length <= 6 && NAME_INTRO.test(t)) return true;
  // journey retest R11-3: a bare name (« نادية قاسي », « Nadia Kaci »), ordering or not
  if (nameOnlyMessage(t) && !isGreetingOnly(t)) return true;
  if (!ordering || /!/.test(t)) return false;
  // journey retest R11-3: a change, a cancellation, a refund or a problem is never a field (a phone given earlier now means ordering)
  const f = foldText(t);
  if (ORDER_CHANGE.test(f) || ASKS_REFUND.test(f) || PROBLEM_WORDS.test(f)) return false;
  return words(t).length <= 6;
}
