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

/** Set by the server (tool results, counters, safety): the model's word is not needed. */
const SERVER_REASONS = new Set(['order_limits', 'risky_client', 'blocked_word', 'orders_unavailable', 'outside_window', 'ai_error', 'abuse_guard', 'credits_exhausted', 'quota_exceeded']);
/** Rule ids of the prompt and older names the model may still write. */
const ALIASES: Record<string, string> = { human_request: 'customer_request', human: 'customer_request', anger: 'angry', over_limits: 'order_limits', order_limit: 'order_limits', off_topic: 'off_catalogue', '3_unclear': 'unclear_streak' };

export type HandoffRefusal = 'greeting' | 'no_evidence' | 'evidence_not_in_message' | 'no_shop_rule' | 'keyword_absent' | 'not_unclear';
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
  return { ok: true, reason };
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
  };
  return `${HANDOFF_REFUSED_MARK}: ${cause[why]}. Keep the conversation and answer the customer's current message now, in their language (status OK; UNKNOWN when you have no answer — say you will check with the team and call add_faq_candidate; UNCLEAR when you did not understand). Hand off only when the customer's current message itself matches a rule, quoting their words in "evidence". Answer with the JSON object only.`;
}
