// What links agents to pages (06 §8.7):
//   PUT /channels/:id/agent, PUT /channels/:id/icebreaker                 (AGT-05 move dialog, CHN-07)
//   POST /agents/generate → job `agent-generation` → …/apply            (AGT-03 "Générer depuis ma page")
//   POST /agents/:id/faq/extract → job `faq-extract`                    (AGV-02 step 2)
//   POST|GET /channels/:id/analysis → job `page-analysis`, …/import     (CHN-08, FL-15)
// The three jobs are free and share 3 runs / day / workspace (`ANALYSIS_RATE_LIMITED`). Generation and FAQ extraction
// read the conversations already stored by the history sync of M3 (no Meta call); page analysis reads the page posts
// through the Meta port. Every AI call goes through the AI port.
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ANALYSIS_RUNS_PER_DAY, ApplyGenerationSchema, type AgentDto, type AgentGenerationResult, type AnalysisDto, type AnalysisImportInput, type AnalysisImportResult, type AnalysisItem, type SetChannelAgentInput } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Channel, type Tx } from '@djaber/db';
import { AppException, conflict, notFound } from '../../core/errors/app.exception';
import { addWarning } from '../../core/http/envelope.interceptor';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { RedisService } from '../../core/redis/redis.provider';
import { algiersDay } from '../../core/time/algiers';
import { AI_GATEWAY, AiProviderError, withInput, type AiGateway, type AiPart } from '../ai/provider/ai.gateway';
import { RoutingService } from '../ai/routing.service';
import { parseJsonObject } from '../ai/structured-output';
import { fold } from '../ai/tools/wilaya-aliases';
import { I18nService } from '../../core/i18n/i18n.service';
import { CategoryService } from '../catalog/category.service';
import { ProductImageService } from '../catalog/product-image.service';
import { ProductService } from '../catalog/product.service';
import { ChannelService } from '../channels/channel.service';
import { ChannelEvents, ChannelTokens } from '../channels/channel.util';
import { JobService } from '../jobs/job.service';
import { MetaError } from '../meta/meta-errors';
import { META_GATEWAY, type MetaGateway } from '../meta/meta.gateway';
import { agentTextKey } from './agent.presenter';
import { AgentService } from './agent.service';
import { KnowledgeService } from './knowledge.service';

const POSTS_MAX = 100;
const GENERATION_CONVERSATIONS = 25;
const GENERATION_MESSAGES = 1000;
/** ~20 k tokens per model call (04-ai-pipeline §14). */
const CHUNK_CHARS = 60_000;
/** either permission reads the page's own posts (`/<pageId>/posts`); V1 read them with `pages_read_engagement` alone */
const READ_SCOPES = ['pages_read_user_content', 'pages_read_engagement'];
type ApplyGenerationInput = z.infer<typeof ApplyGenerationSchema>;

const GenerationSchema = z.object({
  summary: z.string().default(''),
  languages: z.array(z.object({ code: z.string(), pct: z.number() })).default([]),
  topQuestions: z.array(z.object({ question: z.string(), count: z.number() })).default([]),
  tone: z.string().default('friendly'),
  proposedInstructions: z.string().default(''),
  proposedFaq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  proposedPolicies: z.object({ delivery: z.string().optional(), payment: z.string().optional(), returns: z.string().optional(), hours: z.string().optional() }).default({}),
});
const FaqSchema = z.object({ faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]) });
const PostSchema = z.object({ isProduct: z.boolean().default(false), kind: z.enum(['physical', 'service', 'digital']).catch('physical').default('physical'), name: z.string().default(''), description: z.string().nullable().default(null), price: z.number().nullable().default(null), category: z.string().nullable().default(null) });
type Conv = { messages: { from: 'customer' | 'page'; text: string }[] };

const GENERATION_PROMPT = 'You analyse past conversations between a shop page and its customers. Reply as JSON { "summary": string, "languages": [{ "code": string, "pct": number }], "topQuestions": [{ "question": string, "count": number }], "tone": string, "proposedInstructions": string, "proposedFaq": [{ "q": string, "a": string }], "proposedPolicies": { "delivery"?: string, "payment"?: string, "returns"?: string, "hours"?: string } }. Only use facts stated by the page in the conversations; never invent a price or a policy.';
const FAQ_PROMPT = 'From these conversations between a shop page and its customers, extract the frequent customer questions that the page answered. Reply as JSON { "faq": [{ "q": string, "a": string }] } with the answer the page gave. Never invent an answer.';
const POST_PROMPT =
  'This is a post of a shop page (caption + picture). Is it something offered for sale? Reply as JSON { "isProduct": boolean, "kind": "physical"|"service"|"digital", "name": string, "description": string|null, "price": number|null, "category": string|null }. kind: "physical" = an item shipped from a stock; "service" = work done for the customer (repair, course, design, booking, beauty…); "digital" = delivered online (subscription, account, code, file, template). The price is in Algerian dinars and must be written in the caption; otherwise null.';

/**
 * A1: two names of one product (« Robe kabyle brodée » / « robe kabyle - brodée main »): the same folded name, one name
 * containing every word of the other (2 words at least), or 3 words of 4 in common.
 */
export const sameProductName = (a: string, b: string): boolean => {
  const fa = fold(a);
  const fb = fold(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const words = (s: string) => new Set(s.split(/[^a-z0-9\u0600-\u06ff]+/).filter((w) => w.length >= 2));
  const wa = words(fa);
  const wb = words(fb);
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  const common = [...small].filter((w) => large.has(w)).length;
  if (small.size >= 2 && common === small.size) return true;
  return common / new Set([...wa, ...wb]).size >= 0.75;
};

/** The generation result with the merchant's review applied (`POST /agents/generate/:jobId/apply { override }`). */
export const applyOverride = (r: AgentGenerationResult, o: ApplyGenerationInput['override']): AgentGenerationResult => {
  if (!o) return r;
  return {
    ...r,
    ...(o.instructions !== undefined ? { proposedInstructions: o.instructions } : {}),
    ...(o.faq !== undefined ? { proposedFaq: o.faq.map((f) => ({ q: f.q.trim(), a: f.a.trim() })) } : {}),
    ...(o.policies !== undefined ? { proposedPolicies: o.policies as AgentGenerationResult['proposedPolicies'] } : {}),
  };
};

@Injectable()
export class PageService implements OnModuleInit {
  private readonly log = new Logger(PageService.name);
  constructor(
    private readonly registry: ProcessorRegistry,
    private readonly redis: RedisService,
    private readonly jobs: JobService,
    private readonly routing: RoutingService,
    private readonly tokens: ChannelTokens,
    private readonly channelEvents: ChannelEvents,
    private readonly channels: ChannelService,
    private readonly agents: AgentService,
    private readonly knowledge: KnowledgeService,
    private readonly products: ProductService,
    private readonly images: ProductImageService,
    private readonly categoriesSvc: CategoryService,
    private readonly i18n: I18nService,
    @Inject(AI_GATEWAY) private readonly ai: AiGateway,
    @Inject(META_GATEWAY) private readonly meta: MetaGateway,
  ) {}

  onModuleInit() {
    this.registry.register('jobs', 'agent-generation', (d: { jobId: string }) => this.runGeneration(d.jobId), { concurrency: 2 });
    this.registry.register('jobs', 'faq-extract', (d: { jobId: string }) => this.runFaqExtract(d.jobId), { concurrency: 2 });
    this.registry.register('jobs', 'page-analysis', (d: { jobId: string }) => this.runAnalysis(d.jobId), { concurrency: 2 });
  }

  // --- shared -------------------------------------------------------------------------------------------------------------------
  private rateKey = (workspaceId: string) => `rl:analysis:${workspaceId}:${algiersDay()}`;
  /** 3 runs / day / workspace across page analysis, agent generation, FAQ extraction and create-from-photo. */
  private async takeRun(workspaceId: string) {
    const key = this.rateKey(workspaceId);
    const used = await this.redis.client.incr(key);
    if (used === 1) await this.redis.client.expire(key, 26 * 3600);
    if (used > ANALYSIS_RUNS_PER_DAY) {
      await this.redis.client.decr(key);
      throw new AppException('ANALYSIS_RATE_LIMITED');
    }
  }
  private async runsLeft(workspaceId: string) {
    return Math.max(0, ANALYSIS_RUNS_PER_DAY - Number((await this.redis.client.get(this.rateKey(workspaceId))) ?? 0));
  }

  private async channelOrNotFound(id: string, db: Tx | typeof prisma = prisma) {
    const c = await db.channel.findFirst({ where: { id, status: { not: 'disconnected' } }, include: { parent: true, agentChannels: { include: { agent: { select: { id: true, name: true, status: true, deletedAt: true } } } } } });
    if (!c) throw notFound();
    return c;
  }

  private async ask<S extends z.ZodTypeAny>(capability: 'text' | 'vision', purpose: 'agent_generation' | 'faq_extract' | 'page_post', system: string, content: string | AiPart[], schema: S, maxTokens = 1500): Promise<z.output<S>> {
    try {
      const r = await this.routing.call(capability, (m, timeoutMs) => this.ai.generate({ model: m.ref, purpose, system, messages: [{ role: 'user', content }], temperature: 0.2, maxTokens, timeoutMs: Math.max(timeoutMs, 30_000) }));
      const parsed = parseJsonObject(r.value.text, schema);
      if (!parsed.ok) throw new AppException('AI_PROVIDER_ERROR');
      return parsed.value;
    } catch (e) {
      if (e instanceof AiProviderError) throw new AppException('AI_PROVIDER_ERROR');
      throw e;
    }
  }

  // --- channel ↔ agent (AGT-05) ----------------------------------------------------------------------------------------------------
  /** `PUT /channels/:id/agent { agentId | null, move? }`. */
  async setChannelAgent(channelId: string, input: SetChannelAgentInput, req: { warnings?: unknown[] }) {
    const channel = await this.channelOrNotFound(channelId);
    const current = channel.agentChannels[0]?.agent ?? null;
    if (input.agentId === (current?.id ?? null)) return this.channels.get(channelId);
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      if (input.agentId) {
        const agent = await tx.agent.findFirst({ where: { id: input.agentId, deletedAt: null }, select: { id: true } });
        if (!agent) throw notFound();
        if (current && !input.move) throw new AppException('AGENT_PAGE_ALREADY_ASSIGNED', { agentName: current.name }, {}, { agent: { id: current.id, name: current.name } });
        await tx.agentChannel.deleteMany({ where: { channelId } });
        await tx.agentChannel.create({ data: { agentId: agent.id, channelId } });
      } else await tx.agentChannel.deleteMany({ where: { channelId } });
      await this.channelEvents.changed(tx, channel, { kind: input.agentId ? 'agent_attached' : 'agent_detached', actorId: TenantContext.get().userId ?? null });
    });
    // threads being answered keep their turn; the new agent takes over from the next customer message
    const open = await prisma.conversation.count({ where: { channelId, status: 'active', deletedAt: null, lastCustomerMessageAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (current && open > 0) addWarning(req as never, 'AGENT_CHANNEL_SWITCH_NEXT_THREAD', { count: open });
    return this.channels.get(channelId);
  }

  /** `PUT /channels/:id/icebreaker { text }` — stored on the channel (empty = none). */
  async setIcebreaker(channelId: string, text: string) {
    const channel = await this.channelOrNotFound(channelId);
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const updated = await tx.channel.update({ where: { id: channel.id }, data: { icebreaker: text.trim() || null } });
      await this.channelEvents.changed(tx, updated);
    });
    return this.channels.get(channelId);
  }

  // --- generate from page (AGT-03) ---------------------------------------------------------------------------------------------------
  private async conversationsOf(channelId: string, days: number): Promise<{ list: Conv[]; messages: number }> {
    const since = new Date(Date.now() - days * 86_400_000);
    const convs = await prisma.conversation.findMany({ where: { channelId, deletedAt: null, lastMessageAt: { gte: since } }, orderBy: { lastMessageAt: 'desc' }, take: GENERATION_CONVERSATIONS, select: { id: true } });
    const list: Conv[] = [];
    let total = 0;
    for (const c of convs) {
      if (total >= GENERATION_MESSAGES) break;
      const rows = await prisma.message.findMany({ where: { conversationId: c.id, type: { not: 'system' }, createdAt: { gte: since }, text: { not: null } }, orderBy: [{ sentAt: 'asc' }, { id: 'asc' }], take: Math.min(60, GENERATION_MESSAGES - total), select: { direction: true, author: true, text: true } });
      const messages = rows.filter((m) => m.text?.trim() && m.author !== 'system').map((m) => ({ from: m.direction === 'in' ? ('customer' as const) : ('page' as const), text: m.text!.trim().slice(0, 600) }));
      if (!messages.length) continue;
      total += messages.length;
      list.push({ messages });
    }
    return { list, messages: total };
  }
  private chunks(list: Conv[]): Conv[][] {
    const out: Conv[][] = [];
    let cur: Conv[] = [];
    let size = 0;
    for (const c of list) {
      const n = c.messages.reduce((s, m) => s + m.text.length + 12, 0);
      if (cur.length && size + n > CHUNK_CHARS) {
        out.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(c);
      size += n;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  /** `POST /agents/generate { channelId, days? }` → 202 { jobId } (free; 3 / day / workspace, 1 / page / 24 h). */
  async startGeneration(channelId: string, days = 30) {
    const t = TenantContext.get();
    const channel = await this.channelOrNotFound(channelId);
    const pageKey = `rl:generation:${channel.id}`;
    if (!(await this.redis.client.set(pageKey, '1', 'EX', 86_400, 'NX'))) throw new AppException('ANALYSIS_RATE_LIMITED');
    try {
      await this.takeRun(t.workspaceId);
    } catch (e) {
      await this.redis.client.del(pageKey);
      throw e;
    }
    const job = await this.jobs.create({ kind: 'generation', name: 'agent-generation', payload: { channelId, days } });
    return { jobId: job.id };
  }

  async runGeneration(jobId: string) {
    await this.jobs.run(jobId, async (job) => {
      const { channelId, days } = job.payload as { channelId: string; days: number };
      const channel = await this.channelOrNotFound(channelId);
      const { list, messages } = await this.conversationsOf(channelId, days ?? 30);
      const parts = this.chunks(list);
      const results: z.output<typeof GenerationSchema>[] = [];
      for (const [i, part] of parts.entries()) {
        results.push(await this.ask('text', 'agent_generation', GENERATION_PROMPT, withInput('Analyse these conversations.', { conversations: part }), GenerationSchema, 2000));
        await this.jobs.progress(jobId, ((i + 1) / parts.length) * 100);
      }
      // merge the batches: questions and languages are added up, texts are concatenated
      const questions = new Map<string, { question: string; count: number }>();
      const langs = new Map<string, number>();
      const faq = new Map<string, { q: string; a: string }>();
      for (const r of results) {
        for (const q of r.topQuestions) {
          const k = fold(q.question);
          questions.set(k, { question: q.question, count: (questions.get(k)?.count ?? 0) + q.count });
        }
        for (const l of r.languages) langs.set(l.code, (langs.get(l.code) ?? 0) + l.pct / results.length);
        for (const f of r.proposedFaq) if (f.q.trim() && f.a.trim()) faq.set(fold(f.q), { q: f.q.slice(0, 300), a: f.a.slice(0, 2000) });
      }
      const linked = channel.agentChannels[0]?.agent;
      const result: AgentGenerationResult = {
        channelId,
        conversations: list.length,
        messages,
        summary: results.map((r) => r.summary).filter(Boolean).join(' ').slice(0, 2000),
        languages: [...langs.entries()].map(([code, pct]) => ({ code, pct: Math.round(pct) })).sort((a, b) => b.pct - a.pct),
        topQuestions: [...questions.values()].sort((a, b) => b.count - a.count).slice(0, 10),
        tone: results[0]?.tone ?? 'friendly',
        proposedInstructions: results.map((r) => r.proposedInstructions).filter(Boolean).join('\n').slice(0, 8000),
        proposedFaq: [...faq.values()].slice(0, 20),
        proposedPolicies: Object.assign({}, ...results.map((r) => r.proposedPolicies)),
        linkedAgent: linked && !linked.deletedAt ? { id: linked.id, name: linked.name, status: linked.status } : null,
      };
      return { result };
    });
  }

  /**
   * `POST /agents/generate/:jobId/apply { agentId?, confirm? }` — without `agentId` a NEW agent is created (preset
   * Vendeur Pro + the proposals); with it, the agent already linked to that page is updated after an explicit
   * confirmation (new version). No other agent is ever touched (V1 overwrote the single agent). `override` (M11) = the
   * merchant's edited review: `instructions`, `faq` (the rows kept / edited; `[]` = none) and `policies` replace the proposal.
   */
  async applyGeneration(jobId: string, input: ApplyGenerationInput, locale: string): Promise<AgentDto> {
    const job = await this.jobs.byIdOrNotFound(jobId);
    if (job.kind !== 'generation') throw notFound();
    if (job.status !== 'done' || !job.result) throw conflict({ reason: 'JOB_NOT_DONE', status: job.status });
    // M11: the review edited by the merchant replaces the matching proposals (an absent field keeps the proposal)
    const r = applyOverride(job.result as unknown as AgentGenerationResult, input.override);
    const channel = await this.channelOrNotFound(r.channelId);
    const policies = Object.fromEntries(Object.entries(r.proposedPolicies ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).slice(0, 500)]));
    if (input.agentId) {
      const linked = channel.agentChannels[0]?.agent;
      // only the agent linked to the analysed page may be updated from its analysis
      if (!linked || linked.id !== input.agentId || linked.deletedAt) throw notFound();
      const current = await this.agents.get(input.agentId, locale);
      if (!input.confirm) throw conflict({ confirmRequired: true, agent: { id: current.id, name: current.name } });
      const merged = [current.customInstructions.trim(), r.proposedInstructions.trim()].filter(Boolean).join('\n').slice(0, 10_000);
      const updated = await this.agents.update(input.agentId, { version: current.version, customInstructions: merged, wizard: { policies: { ...(current.wizard?.policies ?? {}), ...policies } }, note: `generation:${jobId}` }, locale);
      await this.addGeneratedFaq(updated.id, r);
      return this.agents.get(updated.id, locale);
    }
    const draft = await this.agents.create({ presetKey: 'vendeur-pro', name: this.i18n.t(locale, agentTextKey('generatedName'), { page: channel.name }).slice(0, 100), wizard: { policies } }, locale);
    const withText = await this.agents.update(draft.id, { version: draft.version, customInstructions: [draft.customInstructions.trim(), r.proposedInstructions.trim()].filter(Boolean).join('\n').slice(0, 10_000), ...(channel.agentChannels.length ? {} : { channelIds: [channel.id] }), note: `generation:${jobId}` }, locale);
    await this.addGeneratedFaq(withText.id, r);
    return this.agents.get(withText.id, locale);
  }

  private async addGeneratedFaq(agentId: string, r: AgentGenerationResult) {
    const existing = new Set((await prisma.agentFaq.findMany({ where: { agentId }, select: { question: true } })).map((f) => fold(f.question)));
    const fresh = (r.proposedFaq ?? []).filter((f) => !existing.has(fold(f.q))).map((f) => ({ question: f.q, answer: f.a }));
    if (!fresh.length) return;
    const workspaceId = TenantContext.workspaceId();
    // the FAQ limits win over the proposals: what does not fit is left out
    await prisma.$transaction((db) => this.knowledge.addFaqs(db as Tx, agentId, workspaceId, fresh, 'page_extraction')).catch((e) => {
      if (!(e instanceof AppException && e.code === 'AGENT_FAQ_LIMIT')) throw e;
    });
  }

  // --- FAQ extraction (AGV-02 step 2) ---------------------------------------------------------------------------------------------------
  async startFaqExtract(agentId: string, channelId: string) {
    const t = TenantContext.get();
    const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true } });
    if (!agent) throw notFound();
    await this.channelOrNotFound(channelId);
    await this.takeRun(t.workspaceId);
    const job = await this.jobs.create({ kind: 'faq_extraction', name: 'faq-extract', payload: { agentId, channelId } });
    return { jobId: job.id };
  }

  async runFaqExtract(jobId: string) {
    await this.jobs.run(jobId, async (job) => {
      const { agentId, channelId } = job.payload as { agentId: string; channelId: string };
      const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null } });
      if (!agent) throw notFound();
      const { list } = await this.conversationsOf(channelId, 90);
      const found = new Map<string, { question: string; answer: string }>();
      const parts = this.chunks(list);
      for (const [i, part] of parts.entries()) {
        const r = await this.ask('text', 'faq_extract', FAQ_PROMPT, withInput('Extract the FAQ.', { conversations: part }), FaqSchema);
        for (const f of r.faq) if (f.q.trim() && f.a.trim()) found.set(fold(f.q), { question: f.q.slice(0, 300), answer: f.a.slice(0, 2000) });
        await this.jobs.progress(jobId, ((i + 1) / parts.length) * 100);
      }
      const existing = new Set((await prisma.agentFaq.findMany({ where: { agentId }, select: { question: true } })).map((f) => fold(f.question)));
      const fresh = [...found.entries()].filter(([k]) => !existing.has(k)).map(([, v]) => v);
      let created = 0;
      // one by one: the entries that fit the limits are kept
      for (const f of fresh) {
        try {
          await prisma.$transaction((db) => this.knowledge.addFaqs(db as Tx, agentId, agent.workspaceId, [f], 'page_extraction'));
          created++;
        } catch (e) {
          if (e instanceof AppException && e.code === 'AGENT_FAQ_LIMIT') break;
          throw e;
        }
      }
      return { result: { agentId, channelId, conversations: list.length, found: found.size, created, skipped: found.size - created } };
    });
  }

  // --- page analysis (CHN-08, FL-15) -----------------------------------------------------------------------------------------------------
  private hasReadScope(c: Channel & { parent: Channel | null }) {
    const scopes = new Set([...(c.grantedScopes ?? []), ...(c.parent?.grantedScopes ?? [])]);
    const readsPosts = READ_SCOPES.some((s) => scopes.has(s));
    return c.platform === 'instagram' ? scopes.has('instagram_basic') || scopes.has('instagram_business_basic') || readsPosts : readsPosts;
  }
  private latestAnalysis(channelId: string) {
    return prisma.job.findFirst({ where: { workspaceId: TenantContext.workspaceId(), kind: 'analysis', payload: { path: ['channelId'], equals: channelId } }, orderBy: { createdAt: 'desc' } });
  }

  /** `POST /channels/:id/analysis` → 202 { jobId }; `403 PAGE_ANALYSIS_PERMISSION_REQUIRED` without the read permission. */
  async startAnalysis(channelId: string) {
    const t = TenantContext.get();
    const channel = await this.channelOrNotFound(channelId);
    if (!this.hasReadScope(channel)) throw new AppException('PAGE_ANALYSIS_PERMISSION_REQUIRED');
    const running = await this.latestAnalysis(channelId);
    if (running && (running.status === 'queued' || running.status === 'running')) return { jobId: running.id };
    await this.takeRun(t.workspaceId);
    const job = await this.jobs.create({ kind: 'analysis', name: 'page-analysis', payload: { channelId } });
    return { jobId: job.id };
  }

  async analysis(channelId: string): Promise<AnalysisDto> {
    const channel = await this.channelOrNotFound(channelId);
    const job = await this.latestAnalysis(channelId);
    const runsLeftToday = await this.runsLeft(channel.workspaceId);
    const r = (job?.result ?? {}) as { items?: AnalysisItem[]; postsTotal?: number; postsDone?: number };
    const state: AnalysisDto['state'] = !this.hasReadScope(channel) ? 'permission_required' : !job ? 'none' : job.status === 'queued' || job.status === 'running' ? 'running' : job.status === 'done' || job.status === 'partial' ? 'done' : 'failed';
    let error: string | null = null;
    if (job?.error) {
      try {
        error = (JSON.parse(job.error) as { code?: string }).code ?? 'INTERNAL';
      } catch {
        error = 'INTERNAL';
      }
    }
    return { state, jobId: job?.id ?? null, progress: job?.progress ?? 0, postsTotal: r.postsTotal ?? 0, postsDone: r.postsDone ?? 0, items: r.items ?? [], startedAt: job?.createdAt.toISOString() ?? null, finishedAt: job && state !== 'running' ? job.updatedAt.toISOString() : null, runsLeftToday, error };
  }

  /** `jobs / page-analysis` — resumable: the cursor and the items found so far are kept in `Job.result`. */
  async runAnalysis(jobId: string) {
    await this.jobs.run(jobId, async (job) => {
      const { channelId } = job.payload as { channelId: string };
      const channel = await this.channelOrNotFound(channelId);
      const auth = this.tokens.auth(channel, channel.parent?.externalId);
      if (!auth) throw new AppException('PAGE_SYNC_TOKEN_EXPIRED');
      const saved = (job.result ?? {}) as { cursor?: string | null; items?: AnalysisItem[]; postsDone?: number };
      const items: AnalysisItem[] = saved.items ?? [];
      const byName = new Map(items.map((i) => [fold(i.name), i.key]));
      let cursor: string | null = saved.cursor ?? null;
      let done = saved.postsDone ?? 0;
      try {
        do {
          const pageOfPosts = await this.meta.posts(auth, { limit: Math.min(POSTS_MAX - done, 100), after: cursor });
          for (const post of pageOfPosts.posts) {
            done++;
            if (!post.imageUrl) continue; // FL-15: only posts with a picture are candidates
            const image = await this.meta.download(post.imageUrl).catch(() => null);
            const parts: AiPart[] = [...(image ? [{ type: 'image' as const, image: image.body, mime: image.mime }] : []), { type: 'text', text: withInput('Analyse this post.', { caption: post.text }) }];
            const p = await this.ask('vision', 'page_post', POST_PROMPT, parts, PostSchema, 400);
            if (!p.isProduct || !p.name.trim()) continue;
            const key = fold(p.name);
            // the same product posted twice appears once
            if (byName.has(key)) continue;
            byName.set(key, post.id);
            items.push({ key: post.id, postId: post.id, name: p.name.trim().slice(0, 255), description: p.description?.trim().slice(0, 5000) || null, price: p.price && p.price > 0 ? Math.round(p.price) : null, category: p.category?.trim() || null, imageUrl: post.imageUrl, duplicateOf: null, ...(p.kind !== 'physical' ? { isService: true } : {}) });
          }
          cursor = pageOfPosts.nextCursor;
          await prisma.job.updateMany({ where: { id: jobId }, data: { result: { channelId, cursor, items, postsDone: done, postsTotal: cursor ? Math.max(done + 1, POSTS_MAX) : done } as unknown as Prisma.InputJsonValue } });
          await this.jobs.progress(jobId, cursor ? Math.min(95, (done / POSTS_MAX) * 100) : 100);
          if (await this.jobs.isCancelled(jobId)) return;
        } while (cursor && done < POSTS_MAX);
      } catch (e) {
        if (e instanceof MetaError) {
          this.log.warn({ channelId, kind: e.kind }, 'page analysis stopped');
          // partial results are kept ("retry remaining")
          if (e.needsReconnect) throw new AppException('PAGE_SYNC_TOKEN_EXPIRED');
          if (items.length) return { result: { channelId, cursor, items, postsDone: done, postsTotal: done }, status: 'partial' as const };
        }
        throw e;
      }
      // products the catalogue already has are flagged, not hidden: a post imported before (A1, tester report 2026-10-20:
      // a page analysed again created its products again), else the same or a very close name
      const existing = await prisma.product.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
      const imported = await this.importedPosts(channelId);
      const live = new Set(existing.map((p) => p.id));
      for (const i of items) i.duplicateOf = (imported.get(i.postId) && live.has(imported.get(i.postId)!) ? imported.get(i.postId)! : null) ?? existing.find((p) => sameProductName(p.name, i.name))?.id ?? null;
      return { result: { channelId, cursor: null, items, postsDone: done, postsTotal: done } };
    });
  }

  /**
   * `POST /channels/:id/analysis/import { items[] }` — each reviewed row becomes a product through the shared product
   * rules (SKU `FB-<n>`, moderation per D36, `maxProducts`); the post picture is re-hosted as its first image.
   */
  /** Post id → product id of every post imported from this page's analyses (kept on the analysis jobs, A1). */
  private async importedPosts(channelId: string): Promise<Map<string, string>> {
    const jobs = await prisma.job.findMany({ where: { workspaceId: TenantContext.workspaceId(), kind: 'analysis', payload: { path: ['channelId'], equals: channelId } }, select: { result: true } });
    const out = new Map<string, string>();
    for (const j of jobs) for (const [post, product] of Object.entries(((j.result ?? {}) as { imported?: Record<string, string> }).imported ?? {})) out.set(post, product);
    return out;
  }

  async importAnalysis(channelId: string, input: AnalysisImportInput): Promise<AnalysisImportResult> {
    await this.channelOrNotFound(channelId);
    const out: AnalysisImportResult = { created: [], failed: [] };
    // A1: never a second product for a post already imported, nor for a name the catalogue already has
    const live = await prisma.product.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
    const liveIds = new Set(live.map((p) => p.id));
    const imported = await this.importedPosts(channelId);
    const added: Record<string, string> = {};
    const categories = await prisma.category.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
    const last = await prisma.$queryRaw<{ n: number | null }[]>`SELECT max(substring("sku" from '^FB-([0-9]+)$')::int) AS n FROM "Product" WHERE "workspaceId" = ${TenantContext.workspaceId()}::uuid AND "sku" ~ '^FB-[0-9]+$'`;
    let seq = (last[0]?.n ?? 0) + 1;
    for (const [index, item] of input.items.entries()) {
      const fromPost = item.postId ? imported.get(item.postId) : undefined;
      const twin = (fromPost && liveIds.has(fromPost) ? live.find((p) => p.id === fromPost) : undefined) ?? live.find((p) => sameProductName(p.name, item.name));
      if (twin) {
        out.failed.push({ index, code: 'ANALYSIS_PRODUCT_EXISTS', message: this.i18n.t(TenantContext.get().locale, 'error.ANALYSIS_PRODUCT_EXISTS', { name: twin.name }) });
        continue;
      }
      // unknown category names are created ("catégories créées si nouvelles" of the CHN-08 review footer)
      let categoryId = item.category ? (categories.find((c) => fold(c.name) === fold(item.category!))?.id ?? null) : null;
      if (item.category && !categoryId) {
        const created = await this.categoriesSvc.create({ name: item.category.slice(0, 100) } as never).catch(() => null);
        if (created) {
          categories.push({ id: created.id, name: created.name });
          categoryId = created.id;
        }
      }
      try {
        let product;
        for (let attempt = 0; ; attempt++) {
          try {
            // A2: a service / digital offer has no stock
            product = (await this.products.create({ name: item.name, description: item.description ?? undefined, price: item.price, ...(item.isService ? { trackStock: false, stock: null } : { stock: item.quantity }), sku: `FB-${String(seq).padStart(4, '0')}`, categoryId: categoryId ?? undefined } as never, 'import')).data;
            seq++;
            break;
          } catch (e) {
            if (e instanceof AppException && e.code === 'PRODUCT_SKU_ALREADY_EXISTS' && attempt < 20) {
              seq++;
              continue;
            }
            throw e;
          }
        }
        if (item.imageUrl) {
          // best effort: a picture that cannot be fetched or does not meet the image rules leaves the product without one
          const img = await this.meta.download(item.imageUrl).catch(() => null);
          if (img) await this.images.upload(product.id, { buffer: img.body, mimetype: img.mime, size: img.body.length, originalname: 'post.jpg' }).catch(() => undefined);
        }
        out.created.push({ key: item.name, productId: product.id, sku: product.sku });
        live.push({ id: product.id, name: product.name });
        liveIds.add(product.id);
        if (item.postId) added[item.postId] = product.id;
      } catch (e) {
        if (!(e instanceof AppException)) throw e;
        out.failed.push({ index, code: e.code, message: this.i18n.t(TenantContext.get().locale, `error.${e.code}`, e.params) });
      }
    }
    // the imported posts are remembered on the page's last analysis (the next analysis flags them, A1)
    if (Object.keys(added).length) {
      const last = await this.latestAnalysis(channelId);
      if (last) {
        const r = (last.result ?? {}) as Record<string, unknown> & { imported?: Record<string, string> };
        await prisma.job.updateMany({ where: { id: last.id }, data: { result: { ...r, imported: { ...(r.imported ?? {}), ...added } } as Prisma.InputJsonValue } });
      }
    }
    return out;
  }
}
