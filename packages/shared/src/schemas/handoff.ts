// Why a conversation went to the team, in words (UX-059, retest 12/11): `Conversation.context.handoffReason`, the
// `conversation.handoff` notification and the handoff insights carry a code (`customer_request`, `unclear_streak`,
// `blocked_word:<word>`, `rule:<label>`…). Web (queue, inbox, insights), API (notification texts) and mobile read it
// through this one mapping: the label is `inbox.handoff.reason.<kind>` (sentence) / `queue.reason.<kind>` (card label).

export type HandoffReasonKind =
  | 'transfer'
  | 'human_request'
  | 'refund'
  | 'complaint'
  | 'angry'
  | 'unclear'
  | 'off_catalogue'
  | 'order_limits'
  | 'keyword'
  | 'credits'
  | 'ai_error'
  | 'risk'
  | 'blocked_word'
  | 'abuse'
  | 'manual'
  | 'window'
  | 'orders_unavailable';
export type HandoffReasonView = { kind: HandoffReasonKind; /** rule / keyword / word that triggered the handoff, shown after the label */ detail: string | null };

const KINDS: Record<string, HandoffReasonKind> = {
  human_request: 'human_request',
  customer_request: 'human_request',
  asked_human: 'human_request',
  human: 'human_request',
  // HANDOFF_REASONS of the AI pipeline (agents.ts) and the wizard rule kinds
  refund: 'refund',
  complaint: 'complaint',
  angry: 'angry',
  anger: 'angry',
  unclear_streak: 'unclear',
  '3_unclear': 'unclear',
  unclear: 'unclear',
  off_catalogue: 'off_catalogue',
  off_topic: 'off_catalogue',
  order_limits: 'order_limits',
  over_limits: 'order_limits',
  order_limit: 'order_limits',
  keyword: 'keyword',
  other: 'transfer',
  transfer: 'transfer',
  credits_exhausted: 'credits',
  credits: 'credits',
  quota_exhausted: 'credits',
  quota_exceeded: 'credits',
  ai_error: 'ai_error',
  provider_error: 'ai_error',
  error: 'ai_error',
  send_failed: 'ai_error',
  risky_client: 'risk',
  risk: 'risk',
  blocked_word: 'blocked_word',
  abuse: 'abuse',
  abuse_guard: 'abuse',
  manual: 'manual',
  // create_order / cancel_order refused (the tools answer ORDERS_UNAVAILABLE and hand over)
  orders_unavailable: 'orders_unavailable',
  // an AI reply could not leave outside the 24 h window (MSG-06): a human must answer
  outside_window: 'window',
  reply_outside_window: 'window',
  window: 'window',
};

/** A code nobody mapped (`some_new_reason`, `SOME_CODE`): never shown as such — the label says "handed over" alone. */
const CODE_LIKE = /^(?:[a-z0-9]+(?:_[a-z0-9]+)+|[A-Z0-9]+(?:_[A-Z0-9]+)+)$/;

/**
 * `handoffReason` is free text set by the server: a known code (`human_request`, `credits_exhausted`…), a prefixed rule
 * (`rule:remboursement`, `keyword:avocat`), a withheld AI reply (`blocked_word:<word>`) or the rule label itself.
 * Anything unknown is a transfer with its text — except an unmapped code, which gets no detail.
 */
export const handoffReasonOf = (handoffReason: string | null | undefined): HandoffReasonView => {
  const raw = (handoffReason ?? '').trim();
  if (!raw) return { kind: 'transfer', detail: null };
  const known = KINDS[raw.toLowerCase()];
  if (known) return { kind: known, detail: null };
  const blocked = /^blocked_word\s*[:=]\s*(.+)$/i.exec(raw);
  if (blocked) return { kind: 'blocked_word', detail: blocked[1]!.trim() || null };
  const m = /^(rule|keyword|règle|regle|handoff)\s*[:=]\s*(.+)$/i.exec(raw);
  if (m) {
    const detail = m[2]!.trim().replace(/^[«"']\s*|\s*[»"']$/g, '');
    const kind = KINDS[detail.toLowerCase()];
    return { kind: kind ?? 'transfer', detail: kind || CODE_LIKE.test(detail) ? null : detail || null };
  }
  return { kind: 'transfer', detail: CODE_LIKE.test(raw) ? null : raw };
};
