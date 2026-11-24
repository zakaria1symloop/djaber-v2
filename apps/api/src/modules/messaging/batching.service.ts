// MSG-05 / 04 §5 "Batching" — the hook the AI pipeline of M4 consumes. Customer messages of one conversation that arrive
// inside the agent's response window are answered together: one delayed `ai-reply / reply` job per conversation
// (job id `ai:<conversationId>`), whose delay is pushed back by every new message.
// A message that arrives while the job of its conversation is already running opens the next batch: it gets a follow-up
// job (`ai:<conversationId>:next`) so it is never left unanswered. Without an `ai-reply / reply` processor nothing is scheduled.
import { Injectable } from '@nestjs/common';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { jobId, QueueService } from '../../core/queue/queue.service';
import { RedisService } from '../../core/redis/redis.provider';

/** D33 abuse guard thresholds. */
export const BURST_PER_MINUTE = 20;
export const FLOOD_PER_10_MIN = 50;
export const BURST_WINDOW_SEC = 10;
/** After a message arrives the agent still waits this long for a second one sent right behind it. */
export const MIN_WINDOW_MS = 1000;
/**
 * The agent's « délai de réponse » runs from the moment the CUSTOMER sent the message, not from the moment Djaber received it
 * (client list L4 / L27, Houssem live 24/11: Facebook takes 1.5–2 s to deliver a message, and the 3 s were counted on top — replies
 * at 8–11 s). The time already spent in transit is taken off the wait, down to `MIN_WINDOW_MS`.
 */
export const replyWaitMs = (delaySec: number, sentAt: Date | null | undefined, now: number): number => {
  const full = delaySec * 1000;
  if (!sentAt) return full;
  const inTransit = Math.max(0, now - sentAt.getTime());
  return Math.max(Math.min(full, MIN_WINDOW_MS), full - inTransit);
};
export type AiReplyJob = { workspaceId: string; conversationId: string; batchKey: string; scheduledFor: string };

@Injectable()
export class BatchingService {
  constructor(
    private readonly registry: ProcessorRegistry,
    private readonly queue: QueueService,
    private readonly redis: RedisService,
  ) {}

  /** True once an `ai-reply / reply` processor exists (M4). */
  get enabled() {
    return this.registry.handlers.get('ai-reply')?.has('reply') === true;
  }

  /** Counts one inbound message (Redis `abuse:<conversationId>:1m|10m`). */
  async count(conversationId: string): Promise<{ burst: boolean; flood: boolean }> {
    const c = this.redis.client;
    const [m1, m10] = await Promise.all([c.incr(`abuse:${conversationId}:1m`), c.incr(`abuse:${conversationId}:10m`)]);
    if (m1 === 1) await c.expire(`abuse:${conversationId}:1m`, 60);
    if (m10 === 1) await c.expire(`abuse:${conversationId}:10m`, 600);
    return { burst: m1 >= BURST_PER_MINUTE, flood: m10 >= FLOOD_PER_10_MIN };
  }

  /**
   * Schedules (or pushes back) the reply job of a conversation. `batchKey` = id of the first message of the batch: the
   * AI run of M4 is idempotent on it. Returns false while the AI pipeline is not there.
   */
  async schedule(p: { workspaceId: string; conversationId: string; messageId: string; delaySec: number; burst?: boolean; /** when the customer sent it (text messages: the wait runs from then) */ sentAt?: Date | null }): Promise<boolean> {
    if (!this.enabled) return false;
    const delaySec = p.burst ? Math.max(BURST_WINDOW_SEC, Math.min(60, p.delaySec)) : Math.min(60, Math.max(0, p.delaySec));
    const waitMs = p.burst ? delaySec * 1000 : replyWaitMs(delaySec, p.sentAt, Date.now());
    const key = `batch:${p.conversationId}`;
    await this.redis.client.set(key, p.messageId, 'EX', 120, 'NX');
    const batchKey = (await this.redis.client.get(key)) ?? p.messageId;
    const data: AiReplyJob = { workspaceId: p.workspaceId, conversationId: p.conversationId, batchKey, scheduledFor: new Date(Date.now() + waitMs).toISOString() };
    const running = await this.queue.queue('ai-reply').getJob(jobId(`ai:${p.conversationId}`));
    const active = running ? (await running.getState()) === 'active' : false;
    await this.queue.replaceDelayed('ai-reply', 'reply', data, active ? `ai:${p.conversationId}:next` : `ai:${p.conversationId}`, waitMs, { attempts: 3, backoff: { type: 'fixed', delay: 10_000 } });
    return true;
  }

  /** Called by the reply processor when it starts a batch. */
  async close(conversationId: string) {
    await this.redis.client.del(`batch:${conversationId}`);
  }
}
