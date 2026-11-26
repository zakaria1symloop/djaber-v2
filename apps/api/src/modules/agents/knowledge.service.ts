// The parts of an agent the merchant curates over time:
//   FAQ (AGV-02 step 2): ≤ 50 entries / 20 000 characters, sources SAISI · EXTRAIT DE LA PAGE · SUGGÉRÉ PAR L'IA · IMPORT
//   insights queue (AGT-08): list, resolve (instruction / FAQ / product / ignore 30 days), bulk dismiss
import { Injectable } from '@nestjs/common';
import { strFromU8, unzipSync } from 'fflate';
import { AGENT_FAQ_MAX_CHARS, AGENT_FAQ_MAX_ENTRIES, AGENT_INSTRUCTIONS_MAX, type AgentFaqDto, type AgentFaqInput, type AgentInsightDto, type InsightsQuery, type ResolveInsightInput } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type AgentFaq, type FaqSource, type Tx } from '@djaber/db';
import { AppException, notFound, validationError } from '../../core/errors/app.exception';
import { page, toSkipTake, type BulkResult, type Page } from '../../core/http/pagination';
import { I18nService } from '../../core/i18n/i18n.service';
import { algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { InsightService } from '../ai/insight.service';
import { channelRef } from '../channels/channel.service';
import type { UploadedFile } from '../uploads/image-upload.service';
import { compileInstructions, LEARNING_PENDING, merchantInstructions } from './agent.presenter';
import { AgentService } from './agent.service';

const FAQ_FILE_MAX_BYTES = 5 * 1024 * 1024;
const faqDto = (f: AgentFaq): AgentFaqDto => ({ id: f.id, question: f.question, answer: f.answer, source: f.source, askedCount: f.askedCount, sortOrder: f.sortOrder, isActive: f.isActive, sourceConversationId: f.sourceConversationId, createdAt: f.createdAt.toISOString() });
/** Suggestions (the AI's unanswered questions, the entries learnt from the team that wait for a review) sit after the entries, out of their order. */
const NOT_A_SUGGESTION = { source: { not: 'ai_suggested' }, NOT: LEARNING_PENDING } as const satisfies Prisma.AgentFaqWhereInput;

/** "Q: … / A: …" pairs (also "Question:" / "Réponse:" / "س:" / "ج:"), or a question line ending with "?" followed by its answer. */
export const parseFaqText = (text: string): { question: string; answer: string }[] => {
  const out: { question: string; answer: string }[] = [];
  let q: string | null = null;
  let a: string[] = [];
  const flush = () => {
    if (q && a.join(' ').trim()) out.push({ question: q.slice(0, 300), answer: a.join('\n').trim().slice(0, 2000) });
    q = null;
    a = [];
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const qm = /^(?:q|question|س)\s*[:.)-]\s*(.+)$/i.exec(line);
    const am = /^(?:a|r|answer|réponse|reponse|ج)\s*[:.)-]\s*(.+)$/i.exec(line);
    if (qm) {
      flush();
      q = qm[1]!.trim();
    } else if (am && q) a.push(am[1]!.trim());
    else if (/[?؟]$/.test(line) && (!q || a.length)) {
      flush();
      q = line;
    } else if (q) a.push(line);
  }
  flush();
  return out;
};

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (v: string) =>
  v.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (XML_ENTITIES[e.toLowerCase()] ?? '')));

/**
 * M11 (M4 carry-over): the plain text of a Word document (.docx = ZIP + `word/document.xml`), one line per paragraph
 * (`<w:p>`), runs (`<w:t>`) joined, tabs and line breaks kept. Returns null when the file is not a readable DOCX.
 */
export const docxText = (buf: Buffer): string | null => {
  let xml: string;
  try {
    const files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === 'word/document.xml' });
    const doc = files['word/document.xml'];
    if (!doc) return null;
    xml = strFromU8(doc);
  } catch {
    return null;
  }
  const body = xml.replace(/^[\s\S]*?<w:body[^>]*>/, '');
  const lines: string[] = [];
  for (const p of body.split(/<\/w:p>/)) {
    const parts: string[] = [];
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g)) parts.push(m[1] !== undefined ? unescapeXml(m[1]) : m[0].startsWith('<w:tab') ? '\t' : '\n');
    lines.push(parts.join(''));
  }
  return lines.join('\n');
};

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly agents: AgentService,
    private readonly insights: InsightService,
    private readonly i18n: I18nService,
  ) {}

  private async agentOrNotFound(id: string, db: Tx | typeof prisma = prisma) {
    const a = await db.agent.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw notFound();
    return a;
  }

  // --- FAQ ------------------------------------------------------------------------------------------------------------------
  async faqs(agentId: string): Promise<AgentFaqDto[]> {
    await this.agentOrNotFound(agentId);
    const rows = await prisma.agentFaq.findMany({ where: { agentId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(faqDto);
  }

  /** Limits count the entries the agent really uses (suggestions waiting for an answer are not in the prompt). */
  private async assertFaqRoom(tx: Tx, agentId: string, adding: { question: string; answer: string }[], excludeId?: string) {
    const used = await tx.agentFaq.findMany({ where: { agentId, isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { question: true, answer: true } });
    const chars = [...used, ...adding].reduce((n, f) => n + f.question.length + f.answer.length, 0);
    if (used.length + adding.length > AGENT_FAQ_MAX_ENTRIES || chars > AGENT_FAQ_MAX_CHARS) throw new AppException('AGENT_FAQ_LIMIT');
  }

  async addFaqs(tx: Tx, agentId: string, workspaceId: string, items: { question: string; answer: string }[], source: FaqSource) {
    if (!items.length) return [];
    await this.assertFaqRoom(tx, agentId, items);
    const last = await tx.agentFaq.aggregate({ where: { agentId, ...NOT_A_SUGGESTION }, _max: { sortOrder: true } });
    let order = (last._max.sortOrder ?? -1) + 1;
    return tx.agentFaq.createManyAndReturn({ data: items.map((f) => ({ workspaceId, agentId, question: f.question, answer: f.answer, source, sortOrder: order++, isActive: true })) });
  }

  async createFaq(agentId: string, input: AgentFaqInput): Promise<AgentFaqDto> {
    const a = await this.agentOrNotFound(agentId);
    const [row] = await prisma.$transaction((db) => this.addFaqs(db as Tx, agentId, a.workspaceId, [{ question: input.question, answer: input.answer }], 'manual'));
    if (input.isActive === false || input.sortOrder !== undefined) return faqDto(await prisma.agentFaq.update({ where: { id: row!.id }, data: { isActive: input.isActive ?? true, sortOrder: input.sortOrder ?? row!.sortOrder } }));
    return faqDto(row!);
  }

  async updateFaq(agentId: string, faqId: string, input: Partial<AgentFaqInput>): Promise<AgentFaqDto> {
    await this.agentOrNotFound(agentId);
    return prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const f = await tx.agentFaq.findFirst({ where: { id: faqId, agentId } });
      if (!f) throw notFound();
      const next = { question: input.question ?? f.question, answer: input.answer ?? f.answer };
      // answering a suggestion of the AI turns it into an entry the agent uses
      const isActive = input.isActive ?? (f.source === 'ai_suggested' && !f.isActive && !!input.answer ? true : f.isActive);
      if (isActive && !next.answer.trim()) throw validationError({ answer: 'validation.required' });
      if (isActive) await this.assertFaqRoom(tx, agentId, [next], f.id);
      // owner 26/11 — « Approuver » (`{ isActive: true }`, the answer possibly edited) on a suggestion learnt from the team: it
      // becomes an entry like the others, placed after them (the limits above are the existing ones). Editing its texts alone
      // keeps it a suggestion: only the approval makes the agent use it.
      let sortOrder = input.sortOrder ?? f.sortOrder;
      if (isActive && !f.isActive && f.source === 'human_reply' && input.sortOrder === undefined) {
        const last = await tx.agentFaq.aggregate({ where: { agentId, ...NOT_A_SUGGESTION }, _max: { sortOrder: true } });
        sortOrder = (last._max.sortOrder ?? -1) + 1;
      }
      return faqDto(await tx.agentFaq.update({ where: { id: f.id }, data: { ...next, isActive, sortOrder } }));
    });
  }

  async removeFaq(agentId: string, faqId: string): Promise<void> {
    await this.agentOrNotFound(agentId);
    const r = await prisma.agentFaq.deleteMany({ where: { id: faqId, agentId } });
    if (!r.count) throw notFound();
  }

  /** `POST /agents/:id/faq/import` — a text file of question / answer pairs (≤ 5 MB). */
  async importFaq(agentId: string, file: UploadedFile | undefined): Promise<{ created: AgentFaqDto[]; skipped: number }> {
    const a = await this.agentOrNotFound(agentId);
    if (!file) throw validationError({ file: 'validation.required' });
    if (file.size > FAQ_FILE_MAX_BYTES) throw new AppException('UPLOAD_TOO_LARGE', { max: 5 });
    const name = (file.originalname ?? '').toLowerCase();
    // plain text, Markdown, CSV and Word (.docx, M11); PDF stays refused (no PDF text extractor in the dependencies)
    let text: string | null;
    if (file.mimetype === DOCX_MIME || name.endsWith('.docx')) {
      text = docxText(file.buffer);
      if (text === null) throw new AppException('UPLOAD_TYPE_INVALID');
    } else if (file.mimetype.startsWith('text/') || /\.(txt|md|csv)$/.test(name)) text = file.buffer.toString('utf8');
    else throw new AppException('UPLOAD_TYPE_INVALID');
    const pairs = parseFaqText(text);
    if (!pairs.length) throw validationError({ file: 'validation.invalid' });
    // journey 16/11 J03-4: a question twice in the same file (with two answers) is imported once — the first pair wins, the
    // others count as skipped like a question the FAQ already has (case, spaces and end punctuation ignored)
    const key = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[\s?？؟!.:…]+$/u, '');
    const seen = new Set((await prisma.agentFaq.findMany({ where: { agentId }, select: { question: true } })).map((f) => key(f.question)));
    const fresh = pairs.filter((p) => {
      const k = key(p.question);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const rows = await prisma.$transaction((db) => this.addFaqs(db as Tx, agentId, a.workspaceId, fresh, 'file_import'));
    return { created: rows.map(faqDto), skipped: pairs.length - fresh.length };
  }

  // --- insights (AGT-08) --------------------------------------------------------------------------------------------------------
  async listInsights(q: InsightsQuery): Promise<Page<AgentInsightDto> & { meta: { counts: Record<'pending' | 'resolved' | 'dismissed', number> } }> {
    const where: Prisma.AgentInsightWhereInput = {
      ...(q.agentId ? { agentId: q.agentId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.type?.length ? { type: { in: q.type } } : {}),
      ...(q.conversationId ? { conversationId: q.conversationId } : {}),
      ...(q.channelId ? { conversation: { channelId: q.channelId } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: algiersDayStart(q.from) } : {}), ...(q.to ? { lt: algiersDayEnd(q.to) } : {}) } } : {}),
      agent: { deletedAt: null },
    };
    const include = { agent: { select: { id: true, name: true, status: true } }, conversation: { select: { channel: true } } } as const;
    const occurrences = async (rows: { agentId: string; topicKey: string | null }[]) => {
      const keys = [...new Set(rows.map((r) => r.topicKey).filter((k): k is string => !!k))];
      if (!keys.length) return new Map<string, number>();
      const g = await prisma.agentInsight.groupBy({ by: ['agentId', 'topicKey'], where: { ...where, topicKey: { in: keys } }, _count: { _all: true } });
      return new Map(g.map((x) => [`${x.agentId}:${x.topicKey}`, x._count._all]));
    };
    let rows;
    let total: number;
    if (q.groupByTopic) {
      // one row per (agent, topic): the most recent insight of the group, with the size of the group
      const all = await prisma.agentInsight.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, agentId: true, topicKey: true }, take: 5000 });
      const seen = new Set<string>();
      const heads = all.filter((r) => {
        const k = r.topicKey ? `${r.agentId}:${r.topicKey}` : r.id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      total = heads.length;
      const ids = heads.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((h) => h.id);
      const found = await prisma.agentInsight.findMany({ where: { id: { in: ids } }, include });
      rows = ids.map((id) => found.find((f) => f.id === id)!).filter(Boolean);
    } else {
      [rows, total] = await Promise.all([prisma.agentInsight.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }), prisma.agentInsight.count({ where })]);
    }
    const counts = await occurrences(rows);
    // M8 (M4 carry-over): counts of the three status tabs in the same answer (same filters, any status)
    const { status: _status, ...anyStatus } = where;
    const byStatus = await prisma.agentInsight.groupBy({ by: ['status'], where: anyStatus, _count: { _all: true } });
    const tab = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
    const result = page(
      rows.map((r) => ({
        id: r.id,
        agent: r.agent,
        type: r.type,
        customerMessage: r.customerMessage,
        aiResponse: r.aiResponse,
        detail: r.detail,
        conversationId: r.conversationId,
        messageId: r.messageId,
        status: r.status,
        resolution: r.resolution,
        topicKey: r.topicKey,
        occurrences: r.topicKey ? (counts.get(`${r.agentId}:${r.topicKey}`) ?? 1) : 1,
        channel: r.conversation?.channel ? channelRef(r.conversation.channel) : null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      q,
    );
    return { ...result, meta: { counts: { pending: tab('pending'), resolved: tab('resolved'), dismissed: tab('dismissed') } } };
  }

  /**
   * `POST /agent-insights/:id/resolve`:
   *   instruction  appends `- …` to the agent's instructions (new version, source `insight`)
   *   faq          creates an FAQ entry
   *   product      the merchant added / fixed the product: only closes the insight
   *   ignored_30d  dismisses it and mutes its topic for 30 days
   * Every pending insight of the same topic is closed with it.
   */
  async resolveInsight(id: string, input: ResolveInsightInput): Promise<{ id: string; status: 'resolved' | 'dismissed'; closed: number }> {
    const t = TenantContext.get();
    return prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const insight = await tx.agentInsight.findFirst({ where: { id, agent: { deletedAt: null } }, include: { agent: true } });
      if (!insight) throw notFound();
      if (insight.status !== 'pending') throw new AppException('INSIGHT_ALREADY_RESOLVED');
      const agent = insight.agent;
      if (input.action === 'instruction') {
        const own = merchantInstructions(agent.customInstructions);
        const next = `${own.trimEnd()}${own.trim() ? '\n' : ''}- ${input.instruction!}`;
        if (next.length > AGENT_INSTRUCTIONS_MAX) throw validationError({ instruction: 'validation.length' });
        await tx.agent.update({ where: { id: agent.id }, data: { customInstructions: compileInstructions(agent, next), version: { increment: 1 } } });
        await this.agents.recordVersion(tx, agent.id, 'insight', { note: `insight:${insight.id}` });
      } else if (input.action === 'faq') {
        await this.addFaqs(tx, agent.id, agent.workspaceId, [{ question: input.question!, answer: input.answer! }], 'manual');
      }
      const dismissed = input.action === 'ignored_30d';
      const data = { status: dismissed ? ('dismissed' as const) : ('resolved' as const), resolution: input.action, resolvedById: t.userId ?? null, resolvedAt: new Date(), snoozedUntil: dismissed ? new Date(Date.now() + 30 * 86_400_000) : null };
      await tx.agentInsight.update({ where: { id: insight.id }, data });
      const same = insight.topicKey ? await tx.agentInsight.updateMany({ where: { agentId: agent.id, topicKey: insight.topicKey, status: 'pending', id: { not: insight.id } }, data }) : { count: 0 };
      await this.insights.emitAgent(tx, await tx.agent.findUniqueOrThrow({ where: { id: agent.id } }));
      return { id: insight.id, status: data.status, closed: 1 + same.count };
    });
  }

  /** `POST /agent-insights/bulk/dismiss` — per-item results. */
  async dismissInsights(ids: string[], ctx: { locale: string; ref: string }): Promise<{ results: BulkResult[] }> {
    const t = TenantContext.get();
    const results: BulkResult[] = [];
    const fail = (id: string, code: 'NOT_FOUND' | 'INSIGHT_ALREADY_RESOLVED'): BulkResult => ({ id, ok: false, error: { code, message: this.i18n.t(ctx.locale, `error.${code}`), params: {}, ref: ctx.ref } });
    const agents = new Set<string>();
    for (const id of [...new Set(ids)]) {
      const insight = await prisma.agentInsight.findFirst({ where: { id, agent: { deletedAt: null } }, select: { id: true, status: true, agentId: true } });
      if (!insight) results.push(fail(id, 'NOT_FOUND'));
      else if (insight.status !== 'pending') results.push(fail(id, 'INSIGHT_ALREADY_RESOLVED'));
      else {
        await prisma.agentInsight.update({ where: { id }, data: { status: 'dismissed', resolvedById: t.userId ?? null, resolvedAt: new Date() } });
        agents.add(insight.agentId);
        results.push({ id, ok: true });
      }
    }
    for (const agentId of agents) await prisma.$transaction(async (db) => this.insights.emitAgent(db as Tx, await (db as Tx).agent.findUniqueOrThrow({ where: { id: agentId } })));
    return { results };
  }
}
