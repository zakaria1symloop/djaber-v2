// Helpers of the M4 suites: the scriptable fake AI adapter, agents linked to fake pages, the `ai-reply` job run
// synchronously (the delayed BullMQ job is read from the queue, removed and handed to its processor), credits.
// Nothing here (nor anywhere in the tests) talks to an AI provider: `AI_DRIVER=fake` (test/setup/env.cjs) + a `fetch` guard.
import { rawPrisma as db, TenantContext, type Agent } from '@djaber/db';
import { jobId, QueueService } from '../../src/core/queue/queue.service';
import { RedisService } from '../../src/core/redis/redis.provider';
import { TenantResolver } from '../../src/core/tenancy/tenant.resolver';
import { ReplyProcessor, type ReplyOutcome } from '../../src/modules/ai/reply.processor';
import { AI_GATEWAY } from '../../src/modules/ai/provider/ai.gateway';
import { FakeAiGateway } from '../../src/modules/ai/provider/fake-ai.gateway';
import { CreditService, type Balance } from '../../src/modules/credits/credit.service';
import type { AiReplyJob } from '../../src/modules/messaging/batching.service';
import type { TestApp } from './app';
import { work } from './m3';

export const fakeAi = (app: TestApp): FakeAiGateway => {
  const gateway = app.app.get(AI_GATEWAY);
  if (!(gateway instanceof FakeAiGateway)) throw new Error('tests must run with the fake AI adapter');
  return gateway;
};

export const textRoute = () => db.aiRoute.findUniqueOrThrow({ where: { capability: 'text' }, include: { primaryModel: true, fallbackModel: true } });

/** An active agent (model of the text route) linked to the given channels. */
export const linkedAgent = async (workspaceId: string, channelIds: string[], over: Partial<Agent> = {}): Promise<Agent> => {
  const route = await textRoute();
  const agent = await db.agent.create({ data: { workspaceId, name: 'Vendeur', approvedName: 'Vendeur', nameStatus: 'approved', modelId: route.primaryModelId, status: 'active', isActive: true, responseDelaySec: 3, ...(over as object) } });
  for (const channelId of channelIds) await db.agentChannel.create({ data: { agentId: agent.id, channelId } });
  return agent;
};

/** The delayed `ai-reply / reply` job of a conversation (null when none is scheduled). */
export const replyJob = async (app: TestApp, conversationId: string, suffix = '') => {
  const job = await app.app.get(QueueService).queue('ai-reply').getJob(jobId(`ai:${conversationId}${suffix}`));
  if (!job) return null;
  const state = await job.getState();
  return state === 'delayed' || state === 'waiting' ? job : null;
};

/**
 * Runs the scheduled reply job of a conversation as the worker would (and removes it from the queue).
 * `attempt` / `attempts` simulate BullMQ's retry bookkeeping; `keep` leaves the job data for a second run.
 */
export const runReply = async (app: TestApp, conversationId: string, o: { attempt?: number; attempts?: number; data?: AiReplyJob } = {}): Promise<{ outcome: ReplyOutcome; data: AiReplyJob } | null> => {
  const job = o.data ? null : await replyJob(app, conversationId);
  const data = o.data ?? (job?.data as AiReplyJob | undefined);
  if (!data) return null;
  if (job) await job.remove();
  const outcome = await TenantContext.runSystem(() => app.app.get(ReplyProcessor).process(data, { attemptsMade: (o.attempt ?? 1) - 1, opts: { attempts: o.attempts ?? 1 } } as never));
  return { outcome, data };
};

/** Inbound processed → reply job run → outbox drained (the fake Meta adapter "sends"). */
export const answer = async (app: TestApp, workspaceId: string, conversationId: string, o: Parameters<typeof runReply>[2] = {}) => {
  const r = await runReply(app, conversationId, o);
  await work(app, [workspaceId]);
  return r;
};

export const inTenant = async <T>(app: TestApp, workspaceId: string, fn: () => Promise<T>): Promise<T> => {
  const tenant = await app.app.get(TenantResolver).forWorker(workspaceId);
  return TenantContext.run(tenant, fn);
};
export const balanceOf = (app: TestApp, workspaceId: string): Promise<Balance> => inTenant(app, workspaceId, () => app.app.get(CreditService).balance(workspaceId));

/** Leaves the workspace with exactly `credits` plan credits for the current period. */
export const setCredits = async (app: TestApp, workspaceId: string, credits: number) => {
  const b = await balanceOf(app, workspaceId);
  await inTenant(app, workspaceId, () => app.app.get(CreditService).grant(workspaceId, credits - b.total, { key: `test:${workspaceId}:${Date.now()}:${Math.random()}`, reason: 'test' }));
};

export const ledger = (workspaceId: string) => db.creditLedger.findMany({ where: { workspaceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
export const outMessages = (conversationId: string) => db.message.findMany({ where: { conversationId, direction: 'out' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
export const aiMessages = (conversationId: string) => db.message.findMany({ where: { conversationId, author: 'ai' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
export const runsOf = (conversationId: string) => db.aiRun.findMany({ where: { conversationId }, orderBy: { startedAt: 'asc' }, include: { toolCalls: true } });
export const feeRule = (workspaceId: string, wilayaId: number, homePrice = 600, stopdeskPrice = 400, over: Record<string, unknown> = {}) =>
  db.deliveryFeeRule.create({ data: { workspaceId, wilayaId, homePrice, stopdeskPrice, ...over } });

export { db };

/**
 * Plan limits of a workspace for the next minutes, without creating a plan row: the cached workspace context
 * (TenantResolver, Redis) is rewritten with the given limits.
 */
export const withLimits = async (app: TestApp, workspaceId: string, limits: Record<string, number>) => {
  const redis = app.app.get(RedisService);
  await redis.client.del(TenantResolver.ctxKey(workspaceId));
  const ctx = await app.app.get(TenantResolver).workspaceCtx(workspaceId);
  await redis.setJson(TenantResolver.ctxKey(workspaceId), { ...ctx, limits: { ...ctx!.limits, ...limits } }, 900);
};

/** The M4 suites leave thousands of WS / notification rows nobody relays: closed here so later suites that run the real relay start clean. */
export const closeOutbox = () => db.outbox.updateMany({ where: { processedAt: null }, data: { processedAt: new Date() } });
