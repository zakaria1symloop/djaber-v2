// Owner decision 26/11 (« let the AI learn from human intervention ») — the trigger side: when a team member answers a
// conversation the AI handed off, ONE job per hand-off reads the exchange 10 minutes later and proposes an FAQ entry to the shop
// (`agents/learning.service.ts`). Pure helpers here; the job is queued by `ConversationService.queueLearning` through the outbox.
import type { Conversation } from '@djaber/db';
import { contextOf } from './messaging.presenter';

/** No queue is named `ai`: background jobs of the AI (page analysis, FAQ extraction, …) run on `jobs` (assumptions-log 2026-11-26). */
export const LEARN_QUEUE = 'jobs' as const;
export const LEARN_JOB = 'learn-from-reply';
/** The team gets the time to finish its answer (several messages) before the exchange is read. */
export const LEARN_DELAY_MS = 10 * 60_000;
export type LearnJob = { workspaceId: string; conversationId: string; handoffAt: string };

/** One job per hand-off, whatever the number of replies (the outbox key and the BullMQ job id). */
export const learnJobId = (conversationId: string, handoffAt: string) => `learn:${conversationId}:${handoffAt}`;

/**
 * The `handoffAt` of a hand-off the AI (or a server rule on its behalf) decided and that is still open, else null:
 * a hand-off by hand or by the pause of the agent (`manual`), a conversation a member only paused, a thread that is not in
 * the queue — the team took those themselves, there is no question the AI could not answer.
 */
export const learnableHandoffAt = (c: Pick<Conversation, 'status' | 'context'>): string | null => {
  if (c.status !== 'needs_human') return null;
  const ctx = contextOf(c);
  if (!ctx.handoffReason || ctx.handoffReason === 'manual') return null;
  if (!ctx.handoffAt || Number.isNaN(Date.parse(ctx.handoffAt))) return null;
  return ctx.handoffAt;
};
