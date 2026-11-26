// Owner decision 26/11 (« i want to let ai learn from human intervention ») — the job `jobs / learn-from-reply`.
// A team member answered a conversation the AI had handed off (`ConversationService.queueLearning`): 10 minutes later the
// exchange is read once by the text model, which proposes the GENERAL question and the GENERAL answer — or nothing when the
// exchange is about that customer only. The proposal is stored as an FAQ SUGGESTION (`source = human_reply`, inactive): the
// agent uses it only after the shop approved it in Agent › Connaissances. No credit is charged to the shop and no `AiRun` is
// written (a platform call, like the repair of a voice note). Safe to run twice: the hand-off is marked on the conversation
// (`context.learnedHandoffAt`) in the transaction that stores the suggestion.
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { prisma, TenantContext, type Tx } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { AI_GATEWAY, AiProviderError, withInput, type AiGateway } from '../ai/provider/ai.gateway';
import { RoutingService } from '../ai/routing.service';
import { LEARN_JOB, LEARN_QUEUE, type LearnJob } from '../messaging/learning-trigger';
import { contextOf } from '../messaging/messaging.presenter';
import { exchangeOf, LEARN_CUSTOMER_BEFORE, LEARN_SYSTEM, parseLearnAnswer, sameQuestion, type LearnMessage } from './learning';

/**
 * `learned` a suggestion was stored · `duplicate` the agent already had the question (its `askedCount` was bumped) ·
 * `declined` the model (or the parser) found nothing general to learn · `nothing` no customer question or no team text ·
 * `already` this hand-off was read before · `no_agent` the page has no agent any more · `unavailable` no model answered ·
 * `noop` the conversation is gone.
 */
export type LearnOutcome = 'learned' | 'duplicate' | 'declined' | 'nothing' | 'already' | 'no_agent' | 'unavailable' | 'noop';

const select = { author: true, text: true, transcript: true, createdAt: true } as const;
const toLearnMessage = (m: { author: string; text: string | null; transcript: string | null; createdAt: Date }): LearnMessage => ({ author: m.author === 'human' ? 'human' : 'customer', text: m.text?.trim() || m.transcript?.trim() || null, at: m.createdAt });

@Injectable()
export class LearningService implements OnModuleInit {
  private readonly log = new Logger(LearningService.name);
  constructor(
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    private readonly routing: RoutingService,
    @Inject(AI_GATEWAY) private readonly ai: AiGateway,
  ) {}

  onModuleInit() {
    this.registry.register(LEARN_QUEUE, LEARN_JOB, (d: LearnJob) => this.run(d), { concurrency: 2 });
  }

  async run(d: LearnJob): Promise<LearnOutcome> {
    const tenant = await this.tenants.forWorker(d.workspaceId);
    return TenantContext.run(tenant, () => this.learn(d));
  }

  /** The hand-off is read: never a second time (kept across « Reprendre l'IA », which only clears the hand-off marks). */
  private async mark(db: Tx | typeof prisma, conversationId: string, workspaceId: string, handoffAt: string) {
    await db.$executeRaw`
      UPDATE "Conversation" SET "context" = jsonb_set(coalesce("context", '{}'::jsonb), '{learnedHandoffAt}', to_jsonb(${handoffAt}::text), true)
      WHERE "id" = ${conversationId}::uuid AND "workspaceId" = ${workspaceId}::uuid`;
  }

  private async learn(d: LearnJob): Promise<LearnOutcome> {
    const at = new Date(d.handoffAt);
    if (Number.isNaN(at.getTime())) return 'noop';
    const conv = await prisma.conversation.findFirst({ where: { id: d.conversationId, deletedAt: null }, include: { client: { select: { name: true } } } });
    if (!conv) return 'noop';
    const ctx = contextOf(conv);
    if (ctx.learnedHandoffAt === d.handoffAt) return 'already';
    const link = await prisma.agentChannel.findUnique({ where: { channelId: conv.channelId }, include: { agent: { select: { id: true, deletedAt: true } } } });
    const agent = link?.agent;
    if (!agent || agent.deletedAt) return 'no_agent';

    const said = { OR: [{ text: { not: null } }, { transcript: { not: null } }] };
    const [before, after] = await Promise.all([
      prisma.message.findMany({ where: { conversationId: conv.id, author: 'customer', createdAt: { lte: at }, ...said }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LEARN_CUSTOMER_BEFORE, select }),
      prisma.message.findMany({ where: { conversationId: conv.id, author: { in: ['customer', 'human'] }, type: { not: 'system' }, createdAt: { gt: at }, ...said }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 200, select }),
    ]);
    const exchange = exchangeOf(before.map(toLearnMessage), after.map(toLearnMessage));
    if (!exchange) {
      await this.mark(prisma, conv.id, conv.workspaceId, d.handoffAt);
      return 'nothing';
    }

    let raw: string;
    try {
      const r = await this.routing.call('text', (m, timeoutMs) =>
        this.ai.generate({ model: m.ref, purpose: 'faq_learn', system: LEARN_SYSTEM, messages: [{ role: 'user', content: withInput('The exchange, oldest message first (`customer` = the customer, `team` = the member of the shop who answered):', { messages: exchange }) }], temperature: 0.2, maxTokens: 500, timeoutMs }),
      );
      raw = r.value.text;
    } catch (e) {
      // learning is opportunistic: a provider that does not answer (the breaker already counts it) never fails the job, and the
      // hand-off stays unread — nothing is stored on a guess
      if (e instanceof AiProviderError || (e instanceof AppException && e.code === 'AGENT_MODEL_UNAVAILABLE')) {
        this.log.warn({ conversationId: conv.id, err: String(e) }, 'learn-from-reply: no model answered');
        return 'unavailable';
      }
      throw e;
    }
    const answer = parseLearnAnswer(raw, { names: [conv.client?.name, ctx.displayName, ctx.customer?.name] });

    return prisma.$transaction(async (db): Promise<LearnOutcome> => {
      const tx = db as Tx;
      // two runs of the same job: the second one waits here, then sees the mark
      await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conv.id}::uuid FOR UPDATE`;
      const fresh = await tx.conversation.findFirst({ where: { id: conv.id }, select: { context: true } });
      if (!fresh || contextOf(fresh).learnedHandoffAt === d.handoffAt) return 'already';
      await this.mark(tx, conv.id, conv.workspaceId, d.handoffAt);
      if (!answer.learn) return 'declined';
      // a question the agent already has (any source, used or waiting) is not proposed again: one more customer asked it
      const same = sameQuestion(await tx.agentFaq.findMany({ where: { agentId: agent.id }, select: { id: true, question: true, answer: true, source: true, isActive: true, askedCount: true } }), answer.question);
      // tester 26/11 14:34: the AI recorded the question it could not answer (`add_faq_candidate`, no answer) in the same turn as the
      // hand-off — the team's answer fills that open question (it becomes the suggestion to approve) instead of being lost
      if (same && same.source === 'ai_suggested' && !same.isActive && !same.answer.trim()) {
        await tx.agentFaq.update({ where: { id: same.id }, data: { answer: answer.answer, source: 'human_reply', sourceConversationId: conv.id, askedCount: (same.askedCount ?? 0) + 1 } });
        return 'learned';
      }
      if (same) {
        await tx.agentFaq.update({ where: { id: same.id }, data: { askedCount: (same.askedCount ?? 0) + 1 } });
        return 'duplicate';
      }
      await tx.agentFaq.create({ data: { workspaceId: conv.workspaceId, agentId: agent.id, question: answer.question, answer: answer.answer, source: 'human_reply', isActive: false, askedCount: 1, sortOrder: 1000, sourceConversationId: conv.id } });
      return 'learned';
    });
  }
}
