// Queue card rules (frame "QUEUE — File d'attente — items"): the label line of a needs-human card is derived from
// `Conversation.handoffReason`. Pure functions.

import { handoffReasonOf, type HandoffReasonKind, type HandoffReasonView } from '@djaber/shared';

// UX-059: the mapping lives in @djaber/shared (handoff.ts) so the notification texts of the API say the same words.
export type QueueReasonKind = HandoffReasonKind;
export type QueueReason = HandoffReasonView;

/**
 * `handoffReason` is free text set by the server: a known code (`human_request`, `credits_exhausted`…), a prefixed
 * rule (`rule:remboursement`, `keyword:avocat`) or the rule label itself. Anything unknown is a transfer with its text;
 * an unmapped code (`some_new_reason`) is never shown as such.
 */
export const queueReason = (handoffReason: string | null | undefined): QueueReason => handoffReasonOf(handoffReason);

/** `Amina Belkacem` → `Amina B.` (cards of the queue and of the inbox list). */
export const shortName = (name: string | null | undefined): string => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
};
