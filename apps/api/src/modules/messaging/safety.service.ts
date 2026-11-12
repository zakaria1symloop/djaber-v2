// 03 §24 SAFE / 04 §13 / D37 — merchant side of trust & safety: block / unblock a customer, report to Djaber, workspace
// auto-rule settings and blocked words. The admin handling of reports and the platform blacklist arrive with M10.
import { Injectable } from '@nestjs/common';
import {
  completeSafetyRules,
  normalizePhoneDz,
  REPORTS_PER_DAY_MAX,
  type CreateBlockInput,
  type CreateReportInput,
  type CustomerBlockView,
  type SafetyBlocksQuery,
  type SafetyReportView,
  type SafetyRules,
} from '@djaber/shared';
import { prisma, Prisma, TenantContext, type BlockReason, type Conversation, type CustomerBlock, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { MailOutbox } from '../../core/mail/mail.outbox';
import { OutboxService } from '../../core/outbox/outbox.service';
import { algiersDay, algiersDayStart } from '../../core/time/algiers';
import { containsWord, foldText } from '../catalog/moderation-prescreen.service';
import { conversationHead, userRef } from './messaging.presenter';
import { AdminNotifier } from '../notifications/admin-notifier.service';

const senderKey = (channelId: string, externalSenderId: string) => `${channelId}:${externalSenderId}`;
const maskPhone = (p: string | null | undefined) => (p && p.length >= 6 ? `${p.slice(0, 2)}•• •• •• ${p.slice(-2)}` : p ? '••' : null);

/** Active blocks of the workspace, indexed the three ways a block applies (04 §13: client, sender identity, phone). */
export class BlockIndex {
  readonly clientIds = new Set<string>();
  readonly senders = new Set<string>();
  readonly phones = new Set<string>();
  constructor(readonly rows: CustomerBlock[]) {
    for (const b of rows) {
      if (b.clientId) this.clientIds.add(b.clientId);
      if (b.channelId && b.externalSenderId) this.senders.add(senderKey(b.channelId, b.externalSenderId));
      if (b.phone) this.phones.add(b.phone);
    }
  }
  get empty() {
    return this.rows.length === 0;
  }
  has(c: Pick<Conversation, 'clientId' | 'channelId' | 'externalSenderId'>, phone?: string | null) {
    return (!!c.clientId && this.clientIds.has(c.clientId)) || this.senders.has(senderKey(c.channelId, c.externalSenderId)) || (!!phone && this.phones.has(phone));
  }
  blockOf(c: Pick<Conversation, 'clientId' | 'channelId' | 'externalSenderId'>, phone?: string | null) {
    return this.rows.find((b) => (!!c.clientId && b.clientId === c.clientId) || (b.channelId === c.channelId && b.externalSenderId === c.externalSenderId) || (!!phone && b.phone === phone)) ?? null;
  }
  /** Prisma filter matching the blocked conversations (null when nothing is blocked). */
  where(): Prisma.ConversationWhereInput | null {
    if (this.empty) return null;
    const or: Prisma.ConversationWhereInput[] = [];
    if (this.clientIds.size) or.push({ clientId: { in: [...this.clientIds] } });
    if (this.phones.size) or.push({ client: { phone: { in: [...this.phones] } } });
    for (const b of this.rows) if (b.channelId && b.externalSenderId) or.push({ channelId: b.channelId, externalSenderId: b.externalSenderId });
    return or.length ? { OR: or } : null;
  }
}

@Injectable()
export class SafetyService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly mail: MailOutbox,
    private readonly admins: AdminNotifier,
  ) {}

  /**
   * Active blocks of the workspace + the phones of the platform blacklist (SAFE-07: a blacklisted number cannot order in
   * any workspace, also as a client created after the blacklisting — such clients get a synthetic `platform` row).
   */
  async index(db: Tx | typeof prisma = prisma): Promise<BlockIndex> {
    const rows = await db.customerBlock.findMany({ where: { unblockedAt: null } });
    const platform = await TenantContext.runSystem(() => db.platformBlacklist.findMany({ where: { revokedAt: null }, select: { id: true, phone: true, reason: true, reportId: true, createdAt: true } }));
    if (!platform.length) return new BlockIndex(rows);
    // clients of this workspace holding a blacklisted phone that no block row covers yet (keyed on the client, so that the
    // conversation filters never compare a NULL phone)
    const covered = new Set(rows.filter((b) => b.phone).map((b) => b.phone));
    const byPhone = new Map(platform.filter((p) => !covered.has(p.phone)).map((p) => [p.phone, p]));
    const clients = byPhone.size ? await db.client.findMany({ where: { phone: { in: [...byPhone.keys()] }, deletedAt: null }, select: { id: true, phone: true, workspaceId: true } }) : [];
    const synthetic: CustomerBlock[] = clients
      .filter((c) => !rows.some((b) => b.clientId === c.id))
      .map((c) => {
        const p = byPhone.get(c.phone!)!;
        return { id: p.id, workspaceId: c.workspaceId, clientId: c.id, phone: null, channelId: null, externalSenderId: null, reason: 'fraud', note: p.reason, source: 'platform', reportId: p.reportId, blockedById: null, blockedAt: p.createdAt, unblockedById: null, unblockedAt: null };
      });
    return new BlockIndex([...rows, ...synthetic]);
  }

  // --- blocks -----------------------------------------------------------------------------------------------------------
  private async presentBlocks(rows: Prisma.CustomerBlockGetPayload<{ include: { client: true; blockedBy: typeof userRef; report: { select: { status: true } } } }>[]): Promise<CustomerBlockView[]> {
    return rows.map((b) => ({
      id: b.id,
      client: b.client ? { id: b.client.id, name: b.client.name, phone: b.client.phone, riskLevel: b.client.riskLevel, isPlaceholder: b.client.isPlaceholder, blocked: true, orderCount: b.client.orderCount, avatarUrl: null } : null,
      phone: b.phone,
      reason: b.reason,
      note: b.note,
      source: b.source,
      blockedBy: b.blockedBy,
      blockedAt: b.blockedAt.toISOString(),
      reportStatus: b.report?.status ?? null,
      unblockable: b.source !== 'platform',
    }));
  }

  async listBlocks(q: SafetyBlocksQuery): Promise<Page<CustomerBlockView>> {
    const where: Prisma.CustomerBlockWhereInput = { unblockedAt: null };
    if (q.source) where.source = q.source;
    if (q.q) where.OR = [{ phone: { contains: q.q } }, { client: { name: { contains: q.q, mode: 'insensitive' } } }, { client: { phone: { contains: q.q } } }];
    const [rows, total] = await Promise.all([
      prisma.customerBlock.findMany({ where, include: { client: true, blockedBy: userRef, report: { select: { status: true } } }, orderBy: [{ blockedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }),
      prisma.customerBlock.count({ where }),
    ]);
    return page(await this.presentBlocks(rows), total, q);
  }

  private async emitConversations(tx: Tx, where: Prisma.ConversationWhereInput, blocked: boolean) {
    const rows = await tx.conversation.findMany({ where: { AND: [where, { deletedAt: null }] }, take: 50 });
    for (const c of rows) await this.outbox.ws(tx, `ws:${c.workspaceId}`, 'conversation.updated', { id: c.id, conversation: conversationHead(c, blocked) });
  }

  /** Creates the block unless the customer is already blocked (then the existing row is returned). */
  private async createBlock(
    tx: Tx,
    target: { clientId: string | null; phone: string | null; channelId?: string | null; externalSenderId?: string | null },
    o: { reason?: BlockReason | null; note?: string | null; reportId?: string | null },
  ): Promise<CustomerBlock> {
    const t = TenantContext.get();
    const or: Prisma.CustomerBlockWhereInput[] = [];
    if (target.clientId) or.push({ clientId: target.clientId });
    if (target.phone) or.push({ phone: target.phone });
    if (target.channelId && target.externalSenderId) or.push({ channelId: target.channelId, externalSenderId: target.externalSenderId });
    const existing = await tx.customerBlock.findFirst({ where: { unblockedAt: null, OR: or } });
    if (existing) return existing;
    const block = await tx.customerBlock.create({
      data: {
        workspaceId: t.workspaceId,
        clientId: target.clientId,
        phone: target.phone,
        channelId: target.channelId ?? null,
        externalSenderId: target.externalSenderId ?? null,
        reason: o.reason ?? null,
        note: o.note ?? null,
        source: 'manual',
        reportId: o.reportId ?? null,
        blockedById: t.userId ?? null,
      },
    });
    const convWhere: Prisma.ConversationWhereInput[] = [];
    if (target.clientId) convWhere.push({ clientId: target.clientId });
    if (target.phone) convWhere.push({ client: { phone: target.phone } });
    if (target.channelId && target.externalSenderId) convWhere.push({ channelId: target.channelId, externalSenderId: target.externalSenderId });
    await this.emitConversations(tx, { OR: convWhere }, true);
    // outbound webhook `customer.blocked` (api-contract §6): produced now, delivered by the integrations module (M11)
    await this.outbox.enqueue(tx, { topic: 'webhook', key: `customer.blocked:${block.id}`, workspaceId: t.workspaceId, payload: { event: 'customer.blocked', data: { blockId: block.id, clientId: target.clientId, phone: target.phone } } });
    return block;
  }

  private async auditBlock(action: 'customer.block' | 'customer.unblock', b: CustomerBlock) {
    const t = TenantContext.get();
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action, entity: 'CustomerBlock', entityId: b.id, after: { clientId: b.clientId, reason: b.reason, source: b.source } });
  }

  /** `POST /safety/blocks { clientId | phone, reason?, note? }`. */
  async block(input: CreateBlockInput): Promise<CustomerBlockView> {
    let clientId: string | null = null;
    let phone: string | null = input.phone ? normalizePhoneDz(input.phone) : null;
    if (input.clientId) {
      const client = await prisma.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
      if (!client) throw notFound();
      clientId = client.id;
      phone = client.phone;
    } else if (phone) {
      clientId = (await prisma.client.findFirst({ where: { phone, deletedAt: null } }))?.id ?? null;
    }
    const block = await prisma.$transaction((tx) => this.createBlock(tx as Tx, { clientId, phone }, { reason: input.reason, note: input.note }));
    await this.auditBlock('customer.block', block);
    return this.blockView(block.id);
  }

  /** `POST /conversations/:id/block` — keyed on the client, its phone and the sender identity of the thread. */
  async blockConversation(conversationId: string, o: { reason: BlockReason; note?: string | null; reportId?: string | null }, tx?: Tx): Promise<CustomerBlock> {
    const run = async (db: Tx) => {
      const c = await db.conversation.findFirst({ where: { id: conversationId, deletedAt: null }, include: { client: true } });
      if (!c) throw notFound();
      return this.createBlock(db, { clientId: c.clientId, phone: c.client?.phone ?? null, channelId: c.channelId, externalSenderId: c.externalSenderId }, o);
    };
    const block = tx ? await run(tx) : await prisma.$transaction((db) => run(db as Tx));
    await this.auditBlock('customer.block', block);
    return block;
  }

  private async lift(tx: Tx, blocks: CustomerBlock[]) {
    const t = TenantContext.get();
    for (const b of blocks) {
      if (b.source === 'platform') throw new AppException('CUSTOMER_BLOCKED_BY_PLATFORM');
      await tx.customerBlock.update({ where: { id: b.id }, data: { unblockedAt: new Date(), unblockedById: t.userId ?? null } });
      const where: Prisma.ConversationWhereInput[] = [];
      if (b.clientId) where.push({ clientId: b.clientId });
      if (b.phone) where.push({ client: { phone: b.phone } });
      if (b.channelId && b.externalSenderId) where.push({ channelId: b.channelId, externalSenderId: b.externalSenderId });
      if (where.length) await this.emitConversations(tx, { OR: where }, false);
    }
  }

  /** `DELETE /safety/blocks/:id` (Admin+). Platform rows are lifted by a moderator only. */
  async unblock(id: string) {
    const b = await prisma.customerBlock.findFirst({ where: { id, unblockedAt: null } });
    if (!b) throw notFound();
    await prisma.$transaction((tx) => this.lift(tx as Tx, [b]));
    await this.auditBlock('customer.unblock', b);
    return { id };
  }

  /** `POST /conversations/:id/unblock` — lifts every active block that applies to the thread. */
  async unblockConversation(conversationId: string) {
    const c = await prisma.conversation.findFirst({ where: { id: conversationId, deletedAt: null }, include: { client: true } });
    if (!c) throw notFound();
    const index = await this.index();
    const blocks = index.rows.filter((b) => (!!c.clientId && b.clientId === c.clientId) || (b.channelId === c.channelId && b.externalSenderId === c.externalSenderId) || (!!c.client?.phone && b.phone === c.client.phone));
    if (!blocks.length) return { id: conversationId, blocked: false };
    await prisma.$transaction((tx) => this.lift(tx as Tx, blocks));
    for (const b of blocks) await this.auditBlock('customer.unblock', b);
    return { id: conversationId, blocked: false };
  }

  async blockView(id: string): Promise<CustomerBlockView> {
    const row = await prisma.customerBlock.findFirst({ where: { id }, include: { client: true, blockedBy: userRef, report: { select: { status: true } } } });
    if (!row) throw notFound();
    return (await this.presentBlocks([row]))[0]!;
  }

  // --- reports to Djaber --------------------------------------------------------------------------------------------------
  private presentReport(r: Prisma.ReportGetPayload<{ include: { reporter: typeof userRef } }>): SafetyReportView {
    return {
      id: r.id,
      type: r.type,
      reason: r.reason,
      details: r.details,
      status: r.status,
      decision: r.decision,
      conversationId: r.conversationId,
      clientId: r.clientId,
      messageId: r.messageId,
      productId: r.productId,
      reporter: r.reporter,
      blockRequested: r.blockRequested,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    };
  }

  /** `POST /safety/reports` (Operator+): acknowledged at once, decided by a moderator (M10). */
  async report(input: CreateReportInput): Promise<SafetyReportView> {
    const t = TenantContext.get();
    const workspaceId = t.workspaceId;
    // every target must belong to this workspace (404 otherwise: nothing leaks)
    const [conversation, message, client, product] = await Promise.all([
      input.conversationId ? prisma.conversation.findFirst({ where: { id: input.conversationId, deletedAt: null }, include: { client: true } }) : null,
      input.messageId ? prisma.message.findFirst({ where: { id: input.messageId } }) : null,
      input.clientId ? prisma.client.findFirst({ where: { id: input.clientId, deletedAt: null } }) : null,
      input.productId ? prisma.product.findFirst({ where: { id: input.productId } }) : null,
    ]);
    if ((input.conversationId && !conversation) || (input.messageId && !message) || (input.clientId && !client) || (input.productId && !product)) throw notFound();
    const conversationId = conversation?.id ?? message?.conversationId ?? null;
    const clientId = client?.id ?? conversation?.clientId ?? null;

    const target: Prisma.ReportWhereInput = input.type === 'ai_message' ? { messageId: message!.id } : input.type === 'product' ? { productId: product!.id } : input.type === 'conversation' ? { conversationId } : clientId ? { clientId } : { conversationId };
    const open = await prisma.report.findFirst({ where: { workspaceId, reporterUserId: t.userId, type: input.type, status: { in: ['open', 'reviewing'] }, ...target } });
    if (open) throw new AppException('ABUSE_REPORT_ALREADY_OPEN');
    const today = await prisma.report.count({ where: { workspaceId, reporterKind: 'merchant_user', createdAt: { gte: algiersDayStart(algiersDay()) } } });
    if (today >= REPORTS_PER_DAY_MAX) throw new AppException('ABUSE_REPORT_RATE_LIMITED');

    // evidence: up to 10 messages around the reported one, customer phone masked (04 §13)
    let excerpt: Prisma.InputJsonValue | undefined;
    if (conversationId) {
      const pivot = message?.sentAt ?? new Date();
      const [before, after] = await Promise.all([
        prisma.message.findMany({ where: { conversationId, sentAt: { lte: pivot } }, orderBy: { sentAt: 'desc' }, take: 6 }),
        prisma.message.findMany({ where: { conversationId, sentAt: { gt: pivot } }, orderBy: { sentAt: 'asc' }, take: 4 }),
      ]);
      const phone = conversation?.client?.phone ?? client?.phone ?? null;
      excerpt = {
        customerPhone: maskPhone(phone),
        messages: [...before.reverse(), ...after].map((m) => ({ id: m.id, author: m.author, direction: m.direction, type: m.type, text: phone && m.text ? m.text.split(phone).join(maskPhone(phone) ?? '') : m.text, sentAt: m.sentAt.toISOString(), reported: m.id === message?.id })),
      };
    }
    const created = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const r = await tx.report.create({
        data: {
          workspaceId,
          type: input.type,
          reporterKind: 'merchant_user',
          reporterUserId: t.userId ?? null,
          conversationId,
          clientId,
          messageId: message?.id ?? null,
          aiRunId: message?.aiRunId ?? null,
          productId: product?.id ?? null,
          reason: input.reason,
          details: input.details ?? null,
          excerpt,
          blockRequested: input.blockAlso === true,
        },
        include: { reporter: userRef },
      });
      if (input.blockAlso && conversationId) {
        const c = await tx.conversation.findFirst({ where: { id: conversationId }, include: { client: true } });
        if (c) await this.createBlock(tx, { clientId: c.clientId, phone: c.client?.phone ?? null, channelId: c.channelId, externalSenderId: c.externalSenderId }, { reason: input.reason === 'inappropriate_content' ? 'inappropriate' : input.reason === 'ai_incorrect' ? 'other' : (input.reason as BlockReason), reportId: r.id });
      } else if (input.blockAlso && clientId) {
        await this.createBlock(tx, { clientId, phone: client?.phone ?? null }, { reason: 'other', reportId: r.id });
      }
      // 04 §13: acknowledged at once (toast + e-mail); the admin queue counter moves (ADM-11)
      const reporter = t.userId ? await tx.user.findUnique({ where: { id: t.userId }, select: { email: true, locale: true } }) : null;
      if (reporter) await this.mail.send({ to: reporter.email, template: 'reports/acknowledged', locale: reporter.locale, key: `reports-ack:${r.id}`, workspaceId }, tx);
      const open = await TenantContext.runSystem(() => tx.report.count({ where: { status: { in: ['open', 'reviewing'] } } }));
      await this.outbox.ws(tx, 'admin:platform', 'reports.queue', { open }, `reports.queue:${r.id}`);
      // owner request 09/11: the Djaber team is told of every report
      const shop = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
      await this.admins.notify(tx, { kind: 'report_opened', key: `report_opened:${r.id}`, params: { reason: r.reason, from: shop?.name ?? '—' }, ids: { workspaceId, reportId: r.id } });
      return r;
    });
    await this.audit.write({ workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'report.create', entity: 'Report', entityId: created.id, after: { type: created.type, reason: created.reason, blockRequested: created.blockRequested } });
    return this.presentReport(created);
  }

  async listReports(q: { scope: 'mine' | 'workspace'; page: number; pageSize: number }): Promise<Page<SafetyReportView>> {
    const t = TenantContext.get();
    const where: Prisma.ReportWhereInput = { workspaceId: t.workspaceId, reporterKind: 'merchant_user', ...(q.scope === 'mine' ? { reporterUserId: t.userId } : {}) };
    const [rows, total] = await Promise.all([
      prisma.report.findMany({ where, include: { reporter: userRef }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }),
      prisma.report.count({ where }),
    ]);
    return page(rows.map((r) => this.presentReport(r)), total, q);
  }

  async getReport(id: string): Promise<SafetyReportView> {
    const r = await prisma.report.findFirst({ where: { id, workspaceId: TenantContext.workspaceId(), reporterKind: 'merchant_user' }, include: { reporter: userRef } });
    if (!r) throw notFound();
    return this.presentReport(r);
  }

  // --- workspace settings (D37) -------------------------------------------------------------------------------------------
  private async workspace() {
    const ws = await prisma.workspace.findFirst({ where: { id: TenantContext.workspaceId(), deletedAt: null }, select: { id: true, safetyRules: true, blockedWords: true } });
    if (!ws) throw notFound();
    return ws;
  }
  async getRules(): Promise<SafetyRules> {
    const ws = await this.workspace();
    return SafetyService.rulesOf(ws.safetyRules);
  }
  /** The stored JSON completed with the defaults: the auto-block rule is on only when `autoBlockEnabled` is true. */
  static rulesOf(stored: unknown): SafetyRules {
    return completeSafetyRules(stored);
  }
  async setRules(rules: SafetyRules): Promise<SafetyRules> {
    const ws = await this.workspace();
    await prisma.workspace.update({ where: { id: ws.id }, data: { safetyRules: rules } });
    const t = TenantContext.get();
    await this.audit.write({ workspaceId: ws.id, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'safety.rules', entity: 'Workspace', entityId: ws.id, before: SafetyService.rulesOf(ws.safetyRules), after: rules });
    return rules;
  }
  async getBlockedWords() {
    return { words: (await this.workspace()).blockedWords };
  }
  async setBlockedWords(words: string[]) {
    const ws = await this.workspace();
    const clean = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))];
    await prisma.workspace.update({ where: { id: ws.id }, data: { blockedWords: clean } });
    const t = TenantContext.get();
    await this.audit.write({ workspaceId: ws.id, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'safety.blocked_words', entity: 'Workspace', entityId: ws.id, after: { count: clean.length } });
    return { words: clean };
  }
}

/**
 * 04 §13: case / diacritic-insensitive match of the workspace and platform word lists (Arabic + Latin), as whole words —
 * the matching of the moderation lists (`containsWord`: a letter or digit next to it ends the match; common endings and
 * Arabic particles count). Retest 12/11 (Badro: « the bot blocked after the phone number, again after the address »): a
 * listed word found inside another one (« con » in « confirmez », « nique » in « technique ») no longer discards the AI
 * reply nor flags the customer's message.
 */
export const containsBlockedWord = (text: string | null | undefined, words: readonly string[]): boolean => !!text && words.length > 0 && containsWord(foldText(text), words) !== null;
