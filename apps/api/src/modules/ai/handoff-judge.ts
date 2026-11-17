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

/** Set by the server (tool results, counters, safety): the model's word is not needed. */
const SERVER_REASONS = new Set(['order_limits', 'risky_client', 'blocked_word', 'orders_unavailable', 'outside_window', 'ai_error', 'abuse_guard', 'credits_exhausted', 'quota_exceeded']);
/** Rule ids of the prompt and older names the model may still write. */
const ALIASES: Record<string, string> = { human_request: 'customer_request', human: 'customer_request', anger: 'angry', over_limits: 'order_limits', order_limit: 'order_limits', off_topic: 'off_catalogue', '3_unclear': 'unclear_streak' };

export type HandoffRefusal = 'greeting' | 'no_evidence' | 'evidence_not_in_message' | 'no_shop_rule' | 'keyword_absent' | 'not_unclear' | 'reason_mismatch';
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
};

export function judgeHandoff(i: HandoffInput): HandoffVerdict {
  const reason = handoffReason(i.reason);
  if (SERVER_REASONS.has(reason)) return { ok: true, reason };
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
  if (!reasonFits(reason, evidence, text)) return { ok: false, reason, why: 'reason_mismatch' };
  return { ok: true, reason };
}

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
  if (reason === 'off_catalogue' || reason === 'complaint') {
    if (ABOUT_ASSISTANT.test(e) && !ASKS_TEAM.test(noName(e))) return false;
    if (reason === 'off_catalogue' && PRICE_CLAIM.test(e) && !TEAM_ONLY_REQUEST.test(m)) return false;
  }
  return true;
}

/**
 * journey retest R3-3 (17/11): the `handoff_to_human` reasons this agent's rules allow right now — `other` only with « Shop
 * rules », `keyword` only with keywords, `unclear_streak` only on the 3rd unclear message, no built-in rule the shop turned
 * off. 4 calls `{ reason: "other" }` on an order / name / phone message of two shops without shop rules were refused
 * (`no_shop_rule`) after a model round each; the tool is no longer offered with that reason (none left ⇒ no tool).
 */
export function allowedHandoffReasons(agent: { humanHandoffRules?: string | null; handoffKeywords?: readonly string[] | null; handoffRules?: unknown }, unclearStreak = 0): string[] {
  const off = new Set((Array.isArray(agent.handoffRules) ? (agent.handoffRules as { kind?: unknown; enabled?: unknown }[]) : []).filter((r) => r && r.enabled === false && typeof r.kind === 'string').map((r) => handoffReason(r.kind as string)));
  return HANDOFF_REASONS.filter((r) => {
    if (r === 'other') return !!(agent.humanHandoffRules ?? '').trim();
    if (r === 'keyword') return (agent.handoffKeywords ?? []).some((k) => k.trim());
    if (r === 'unclear_streak') return unclearStreak >= UNCLEAR_STREAK_HANDOFF - 1 && !off.has(r);
    return SERVER_REASONS.has(r) || !off.has(r);
  });
}

/** What the model is told when its handoff is refused: it answers the customer in the same turn. */
export const HANDOFF_REFUSED_MARK = 'HANDOFF REFUSED BY THE PLATFORM';
export function handoffRefusedInstruction(why: HandoffRefusal): string {
  const cause: Record<HandoffRefusal, string> = {
    greeting: 'the customer only greets you: this is a (new) conversation, welcome them and help',
    no_evidence: 'no words of the customer in their current message ask for it',
    evidence_not_in_message: "the words you gave as evidence are not in the customer's current message (earlier messages are already handled)",
    no_shop_rule: 'no handoff rule applies (reason "other" is only for a « Shop rules » item)',
    keyword_absent: 'no handoff keyword is in the current message',
    not_unclear: 'this is not the 3rd unclear message in a row',
    reason_mismatch:
      "the customer's words do not match that rule: a discount, a price or free delivery « the owner / the team said » is answered with the catalogue price and the delivery fee (politely, no handoff); a question about you (your name, are you a robot) is answered: you are the shop's virtual assistant; customer_request needs words asking for a person",
  };
  return `${HANDOFF_REFUSED_MARK}: ${cause[why]}. Keep the conversation and answer the customer's current message now, in their language (status OK; UNKNOWN when you have no answer — say you will check with the team and call add_faq_candidate; UNCLEAR when you did not understand). Hand off only when the customer's current message itself matches a rule, quoting their words in "evidence". Answer with the JSON object only.`;
}

/** A message that starts by giving the customer's name. */
const NAME_INTRO = /^(?:je\s+m['’]?\s*appelle|moi\s+c['’]?est|mon\s+nom\s+(?:est|c['’]?est)|my\s+name\s+is|smiti|esmi|ismi|asmi|اسمي|إسمي|سميتي)\s+\p{L}/iu;
/** Words that can ask for the team in a short message (« un humain svp », « rembourse », « arnaque »…). */
const TEAM_WORDS = /human|humain|conseill|responsable|personne|parler|appel|rappel|rembours|refund|arnaq|plainte|voleur|scam|manager|agent|bnadem|nhder|nehder|انسان|مسؤول|شخص|نهدر|سارق|نصاب|ترجع|فلوس|flous/;
/**
 * full-test 15/11 AI-CHAT-07 (proposal 9): a message that is only an order field — a phone number, or, while an order is
 * being taken, a short answer with no question and no word asking for the team (« Sétif », « Bab Ezzouar », « Karim
 * Haddad », « cité 20 août villa 3 »). The `handoff_to_human` tool is then not offered: every such handoff was refused
 * by the judge and cost a model round of 5–10 s. A real request still goes through `status = HANDOFF` (judged).
 */
export function fieldOnlyMessage(text: string | undefined, ordering: boolean): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 120) return false;
  if (/^[\s+()\d.\-/٠-٩]{9,20}$/.test(t)) return true;
  if (/[?؟]/.test(t) || TEAM_WORDS.test(foldText(t))) return false;
  // journey retest R1-5: a bare yes (« oui », « ih », « yes », « ايه », « oui c'est bon ») never asks for the team — handoff
  // was asked on « oui », « yes », « ih » after a recap or an order
  if (words(t).length <= 4 && confirmation(t) === 'yes') return true;
  // journey retest R2-4: « اسمي سمير بن علي », « smiti Walid Bouzid », « je m'appelle Karim » — the customer's name, ordering or
  // not (handoff_to_human { reason: unclear_streak } was asked on it)
  if (words(t).length <= 6 && NAME_INTRO.test(t)) return true;
  if (!ordering || /!/.test(t)) return false;
  return words(t).length <= 6;
}
