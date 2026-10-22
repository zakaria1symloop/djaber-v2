// ADM-11 — abuse reports, platform blacklist, platform blocked words, platform auto-rules, monthly compliance export
// (03 §24 SAFE-07/08, 04 §13, D37; 06 §8.11; 03-events §4 `sched-abuse-auto-rules`).
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { normalizePhoneDz, type AdminBlockedWordsInput, type AdminReportsQuery, type BlacklistCreateInput, type BlacklistRowDto, type MerchantBlockRowDto, type PlatformBlockedWordDto, type ReportAdminDto, type ReportDecideInput, type ReportStatsDto, type SafetyAutoRuleDto } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Report, type Tx } from '@djaber/db';
import { AuditService } from '../../../core/audit/audit.service';
import { AppException, notFound, validationError } from '../../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../../core/http/pagination';
import { MailOutbox } from '../../../core/mail/mail.outbox';
import { OutboxService } from '../../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../../core/queue/processor.registry';
import { QueueOutbox } from '../../../core/queue/queue.outbox';
import { RedisService } from '../../../core/redis/redis.provider';
import { StorageService } from '../../../core/storage/storage.service';
import { algiersDay, algiersDayEnd, algiersDayStart } from '../../../core/time/algiers';
import { NotificationProducer } from '../../notifications/notification.producer';
import { auditAdmin, iso, maskEmail, maskPhone, requireReason, sys, sysTx, toUserRef, userRefSelect, type PlatformActor } from '../admin-ops.util';

const DAY = 86400_000;
const REPORT_SLA_MS = DAY; // 04 §13: decision < 24 h
export const AUTO_RULES = {
  phone_blocked_by_workspaces: { threshold: 3, windowDays: 7 },
  merchant_reported_by_customers: { threshold: 3, windowDays: 30 },
  ai_messages_reported: { threshold: 5, windowDays: 30 },
} as const;
const FINAL: Report['status'][] = ['actioned', 'dismissed'];

const include = {
  workspace: { select: { id: true, name: true } },
  targetWorkspace: { select: { id: true, name: true } },
  reporter: userRefSelect,
  assignee: userRefSelect,
  client: { select: { id: true, name: true, phone: true, riskLevel: true } },
  conversation: { select: { id: true, client: { select: { id: true, name: true, phone: true } } } },
  product: { select: { id: true, name: true } },
  aiRun: { select: { id: true, agent: { select: { id: true, name: true } } } },
} as const satisfies Prisma.ReportInclude;
type Row = Prisma.ReportGetPayload<{ include: typeof include }>;

/** Blocks made by merchants (manual or their auto rule) in the last 7 days and still in force — tile + list (UX-014). */
const MERCHANT_BLOCKS_7D = (now: number): Prisma.CustomerBlockWhereInput => ({ source: { in: ['manual', 'auto_rule'] }, blockedAt: { gte: new Date(now - 7 * DAY) }, unblockedAt: null });

@Injectable()
export class AdminSafetyService implements OnModuleInit {
  private readonly log = new Logger(AdminSafetyService.name);
  constructor(
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationProducer,
    private readonly mail: MailOutbox,
    private readonly registry: ProcessorRegistry,
    private readonly queue: QueueOutbox,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    this.registry.cron('sched-abuse-auto-rules', '5 * * * *', () => this.autoRules());
    this.registry.register('jobs', 'safety-export', (d: { jobId: string }) => this.runExport(d.jobId), { concurrency: 1 });
  }

  // --- reports -------------------------------------------------------------------------------------------------------------
  private phoneOf(r: Row): string | null {
    return r.client?.phone ?? r.conversation?.client?.phone ?? ((r.excerpt as { phone?: string } | null)?.phone ?? null);
  }

  /** Facts of the "Objet" sub-line (web-b request): messages of the thread, unclaimed parcels of the customer, reporter surface. */
  private async facts(rows: Row[]) {
    const convIds = [...new Set(rows.map((r) => r.conversationId).filter((x): x is string => !!x))];
    const clientIds = [...new Set(rows.map((r) => r.clientId ?? r.conversation?.client?.id).filter((x): x is string => !!x))];
    const reporters = [...new Set(rows.map((r) => r.reporterUserId).filter((x): x is string => !!x))];
    const [msgs, uncollected, users] = await Promise.all([
      convIds.length ? prisma.message.groupBy({ by: ['conversationId'], where: { conversationId: { in: convIds } }, _count: { _all: true } }) : [],
      clientIds.length ? prisma.shipment.groupBy({ by: ['orderId'], where: { order: { clientId: { in: clientIds } }, status: { in: ['failed', 'returned'] }, failureReason: { in: ['unreachable', 'refused'] } } }).then(async (g) => (g.length ? prisma.order.groupBy({ by: ['clientId'], where: { id: { in: g.map((x) => x.orderId) } }, _count: { _all: true } }) : [])) : [],
      reporters.length ? prisma.user.findMany({ where: { id: { in: reporters } }, select: { id: true, lastSeenPlatform: true } }) : [],
    ]);
    return (r: Row): Record<string, string> => {
      const out: Record<string, string> = {};
      const m = msgs.find((x) => x.conversationId === r.conversationId)?._count._all;
      if (m !== undefined) out.messages = String(m);
      const cid = r.clientId ?? r.conversation?.client?.id;
      const u = (uncollected as { clientId: string | null; _count: { _all: number } }[]).find((x) => x.clientId === cid)?._count._all;
      if (cid) out.uncollectedOrders = String(u ?? 0);
      const p = users.find((x) => x.id === r.reporterUserId)?.lastSeenPlatform;
      if (r.reporterKind === 'merchant_user') out.channel = p === 'android' || p === 'ios' ? 'mobile' : 'web';
      return out;
    };
  }

  private target(r: Row): ReportAdminDto['target'] {
    if (r.type === 'merchant') return { kind: 'workspace', id: r.targetWorkspace?.id ?? '', label: r.targetWorkspace?.name ?? '—' };
    if (r.type === 'product' && r.product) return { kind: 'product', id: r.product.id, label: r.product.name, ...(r.workspace ? { meta: { workspace: r.workspace.name } } : {}) };
    if (r.type === 'ai_message') return { kind: 'agent', id: r.aiRun?.agent?.id ?? r.messageId ?? '', label: r.aiRun?.agent?.name ?? '—', meta: { messageId: r.messageId ?? '' } };
    const client = r.client ?? r.conversation?.client ?? null;
    const phone = this.phoneOf(r);
    return { kind: 'customer', id: client?.id ?? r.conversationId ?? '', label: client?.name ?? maskPhone(phone) ?? '—', meta: { phone: maskPhone(phone) ?? '' } };
  }

  private excerpt(r: Row): ReportAdminDto['excerpt'] {
    const e = r.excerpt as { customerPhone?: string | null; messages?: { author?: string; direction?: string; text?: string | null; sentAt?: string; reported?: boolean }[] } | null;
    const phone = this.phoneOf(r);
    return (e?.messages ?? []).map((m) => ({
      author: m.author ?? (m.direction === 'inbound' ? 'customer' : 'shop'),
      text: phone && m.text ? m.text.split(phone).join(maskPhone(phone) ?? '') : (m.text ?? ''),
      at: m.sentAt ?? r.createdAt.toISOString(),
      ...(m.reported ? { reported: true } : {}),
    }));
  }

  private async signals(rows: Row[]) {
    const phones = [...new Set(rows.map((r) => this.phoneOf(r)).filter((p): p is string => !!p))];
    const targets = [...new Set(rows.map((r) => r.targetWorkspaceId).filter((p): p is string => !!p))];
    const since30 = new Date(Date.now() - 30 * DAY);
    const [blocks, blacklisted, merchantReports] = await Promise.all([
      phones.length ? prisma.customerBlock.groupBy({ by: ['phone'], where: { phone: { in: phones }, unblockedAt: null, source: { not: 'platform' } }, _count: { _all: true } }) : [],
      phones.length ? prisma.platformBlacklist.findMany({ where: { phone: { in: phones }, revokedAt: null }, select: { phone: true } }) : [],
      targets.length ? prisma.report.groupBy({ by: ['targetWorkspaceId'], where: { targetWorkspaceId: { in: targets }, createdAt: { gte: since30 } }, _count: { _all: true } }) : [],
    ]);
    return (r: Row) => {
      const out: string[] = [];
      const phone = this.phoneOf(r);
      const b = blocks.find((x) => x.phone === phone)?._count._all ?? 0;
      if (b) out.push(`blocked_by_workspaces:${b}`);
      if (phone && blacklisted.some((x) => x.phone === phone)) out.push('platform_blacklisted');
      if (r.client?.riskLevel === 'high') out.push('risk_high');
      const m = merchantReports.find((x) => x.targetWorkspaceId === r.targetWorkspaceId)?._count._all ?? 0;
      if (m) out.push(`merchant_reports_30d:${m}`);
      if (r.blockRequested) out.push('block_requested');
      return out;
    };
  }

  private present(r: Row, sig: (r: Row) => string[], canWrite: boolean, facts: (r: Row) => Record<string, string> = () => ({})): ReportAdminDto {
    const due = new Date(r.createdAt.getTime() + REPORT_SLA_MS);
    const open = !FINAL.includes(r.status);
    const reason = !canWrite ? 'FORBIDDEN' : open ? undefined : 'CONFLICT';
    return {
      id: r.id,
      type: r.type,
      reporterKind: r.reporterKind,
      reporter: toUserRef(r.reporter),
      reporterEmail: maskEmail(r.reporterEmail),
      workspace: r.workspace,
      target: (() => {
        const t = this.target(r);
        const meta = { ...(t.meta ?? {}), ...facts(r) };
        return Object.keys(meta).length ? { ...t, meta } : t;
      })(),
      reason: r.reason,
      details: r.details,
      excerpt: this.excerpt(r),
      severity: r.severity,
      status: r.status,
      assignee: toUserRef(r.assignee),
      decision: r.decision,
      decisionNote: r.decisionNote,
      blockRequested: r.blockRequested,
      slaDueAt: due.toISOString(),
      slaBreached: open && due.getTime() < Date.now(),
      createdAt: r.createdAt.toISOString(),
      resolvedAt: iso(r.resolvedAt),
      signals: sig(r),
      actions: [
        { key: 'block_confirmed', enabled: !reason && r.type !== 'merchant', ...(reason ? { reasonCode: reason } : {}) },
        { key: 'platform_blacklist', enabled: !reason && !!this.phoneOf(r), primary: true, ...(reason ? { reasonCode: reason } : !this.phoneOf(r) ? { reasonCode: 'VALIDATION_ERROR' } : {}) },
        { key: 'reported_to_meta', enabled: !reason, ...(reason ? { reasonCode: reason } : {}) },
        { key: 'dismissed', enabled: !reason, ...(reason ? { reasonCode: reason } : {}) },
        { key: 'more_info', enabled: !reason, ...(reason ? { reasonCode: reason } : {}) },
        { key: 'assign', enabled: canWrite && open, ...(!canWrite ? { reasonCode: 'FORBIDDEN' } : !open ? { reasonCode: 'CONFLICT' } : {}) },
      ],
    };
  }

  private where(q: AdminReportsQuery, actor: PlatformActor): Prisma.ReportWhereInput {
    const and: Prisma.ReportWhereInput[] = [];
    if (q.type?.length) and.push({ type: { in: q.type } });
    if (q.severity?.length) and.push({ severity: { in: q.severity } });
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.reporterKind?.length) and.push({ reporterKind: { in: q.reporterKind } });
    if (q.workspaceId) and.push({ OR: [{ workspaceId: q.workspaceId }, { targetWorkspaceId: q.workspaceId }] });
    if (q.assigneeId === 'me') and.push({ assigneeId: actor.userId });
    else if (q.assigneeId === 'none') and.push({ assigneeId: null });
    else if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    if (q.from) and.push({ createdAt: { gte: algiersDayStart(q.from) } });
    if (q.to) and.push({ createdAt: { lt: algiersDayEnd(q.to) } });
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      and.push({
        OR: [
          { details: { contains: q.q, mode: 'insensitive' } },
          { workspace: { name: { contains: q.q, mode: 'insensitive' } } },
          { targetWorkspace: { name: { contains: q.q, mode: 'insensitive' } } },
          { client: { name: { contains: q.q, mode: 'insensitive' } } },
          ...(digits.length >= 4 ? [{ client: { phone: { contains: digits } } }] : []),
        ],
      });
    }
    return and.length ? { AND: and } : {};
  }

  async list(q: AdminReportsQuery, actor: PlatformActor, canWrite: boolean): Promise<Page<ReportAdminDto>> {
    return sys(async () => {
      const where = this.where(q, actor);
      const [rows, total] = await Promise.all([
        prisma.report.findMany({ where, include, orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }], ...toSkipTake(q) }),
        prisma.report.count({ where }),
      ]);
      const [sig, facts] = await Promise.all([this.signals(rows), this.facts(rows)]);
      return page(rows.map((r) => this.present(r, sig, canWrite, facts)), total, q);
    });
  }

  async get(id: string, canWrite: boolean): Promise<ReportAdminDto> {
    return sys(async () => {
      const r = await prisma.report.findUnique({ where: { id }, include });
      if (!r) throw notFound();
      return this.present(r, await this.signals([r]), canWrite, await this.facts([r]));
    });
  }

  /** `GET /admin/reports/blocks` — what the « clients bloqués » tile counts (UX-014: the tile pointed at an empty reports tab). */
  async merchantBlocks(): Promise<MerchantBlockRowDto[]> {
    return sys(async () => {
      const rows = await prisma.customerBlock.findMany({
        where: MERCHANT_BLOCKS_7D(Date.now()),
        orderBy: { blockedAt: 'desc' },
        take: 100,
        include: { workspace: { select: { id: true, name: true } }, client: { select: { id: true, name: true } }, blockedBy: userRefSelect },
      });
      return rows.map((b) => ({ id: b.id, workspace: b.workspace, client: b.client, phone: maskPhone(b.phone), reason: b.reason, source: b.source as 'manual' | 'auto_rule', blockedBy: toUserRef(b.blockedBy), blockedAt: b.blockedAt.toISOString() }));
    });
  }

  async stats(): Promise<ReportStatsDto> {
    return sys(async () => {
      const now = Date.now();
      const openWhere: Prisma.ReportWhereInput = { status: { in: ['open', 'reviewing'] } };
      const [open, over24h, handled30d, merchantBlocks7d, merchantsReported, blockedWords, autoFiltered7d, customers, merchants, aiContent, done] = await Promise.all([
        prisma.report.count({ where: openWhere }),
        prisma.report.count({ where: { ...openWhere, createdAt: { lt: new Date(now - REPORT_SLA_MS) } } }),
        prisma.report.count({ where: { status: { in: FINAL }, resolvedAt: { gte: new Date(now - 30 * DAY) } } }),
        prisma.customerBlock.count({ where: MERCHANT_BLOCKS_7D(now) }),
        prisma.report.groupBy({ by: ['targetWorkspaceId'], where: { type: 'merchant', reporterKind: 'end_customer', createdAt: { gte: new Date(now - 30 * DAY) } }, _count: { _all: true } }),
        prisma.blockedWord.count({ where: { workspaceId: null } }),
        prisma.message.count({ where: { containsBlockedWord: true, sentAt: { gte: new Date(now - 7 * DAY) } } }),
        prisma.report.count({ where: { ...openWhere, type: { in: ['customer', 'conversation'] } } }),
        prisma.report.count({ where: { ...openWhere, type: 'merchant' } }),
        prisma.report.count({ where: { ...openWhere, type: 'ai_message' } }),
        prisma.report.count({ where: { status: { in: FINAL } } }),
      ]);
      return { open, over24h, handled30d, merchantBlocks7d, merchantsReported30d: merchantsReported.length, blockedWords, autoFiltered7d, tabs: { todo: open, customers, merchants, aiContent, done } };
    });
  }

  private async emitQueue(tx: Tx | typeof prisma) {
    const open = await TenantContext.runSystem(() => tx.report.count({ where: { status: { in: ['open', 'reviewing'] } } }));
    await this.outbox.ws(tx, 'admin:platform', 'reports.queue', { open }, `reports.queue:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);
  }

  /** A new report (merchant, end customer or system): admin room counter (+ acknowledgement mail for end customers). */
  async announce(tx: Tx | typeof prisma) {
    await this.emitQueue(tx);
  }

  /** `POST /admin/reports/:id/decide { decision, note, notifyReporter }` (04 §13, SAFE-08). */
  async decide(id: string, input: ReportDecideInput, actor: PlatformActor) {
    const note = requireReason(input.note);
    const result = await sysTx(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Report" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const r = await tx.report.findUnique({ where: { id }, include });
      if (!r) throw notFound();
      if (FINAL.includes(r.status)) throw new AppException('CONFLICT', {}, {}, { status: r.status, decision: r.decision });
      const final = input.decision !== 'more_info';
      let blacklistId: string | null = null;
      if (input.decision === 'platform_blacklist') {
        const phone = this.phoneOf(r);
        if (!phone) throw validationError({ decision: 'validation.invalid' });
        blacklistId = (await this.blacklistTx(tx, { phone, reason: note, reportId: r.id }, actor)).id;
      }
      if (input.decision === 'block_confirmed' && r.workspaceId) {
        const clientId = r.clientId ?? r.conversation?.client?.id ?? null;
        const phone = this.phoneOf(r);
        const existing = await tx.customerBlock.findFirst({ where: { workspaceId: r.workspaceId, unblockedAt: null, OR: [...(clientId ? [{ clientId }] : []), ...(phone ? [{ phone }] : [])] } });
        if (!existing && (clientId || phone)) {
          await tx.customerBlock.create({ data: { workspaceId: r.workspaceId, clientId, phone, reason: r.reason === 'inappropriate_content' ? 'inappropriate' : r.reason === 'ai_incorrect' ? 'other' : (r.reason as never), note, source: 'manual', reportId: r.id, blockedById: null } });
        }
      }
      const updated = await tx.report.update({
        where: { id },
        data: {
          status: final ? (input.decision === 'dismissed' ? 'dismissed' : 'actioned') : 'reviewing',
          decision: input.decision,
          decisionNote: note,
          ...(final ? { resolvedById: actor.userId, resolvedAt: new Date() } : {}),
          ...(final && input.notifyReporter ? { reporterNotifiedAt: new Date() } : {}),
        },
      });
      if (final && input.notifyReporter) {
        if (r.reporterKind === 'merchant_user' && r.reporterUserId && r.workspaceId) {
          await TenantContext.runAs(r.workspaceId, () =>
            this.notifications.emit(tx, { type: 'report_resolved', workspaceId: r.workspaceId!, userIds: [r.reporterUserId!], key: `report_resolved:${r.id}`, data: { reportId: r.id, decision: input.decision } }),
          );
        } else if (r.reporterKind === 'end_customer' && r.reporterEmail) {
          await this.mail.send({ to: r.reporterEmail, template: 'reports/resolved', locale: 'fr', params: { decision: input.decision }, key: `reports-resolved:${r.id}` }, tx);
        }
      }
      if (r.workspaceId) await this.outbox.ws(tx, `ws:${r.workspaceId}`, 'report.updated', { id: r.id, status: updated.status });
      await this.emitQueue(tx);
      return { report: updated, blacklistId };
    });
    await auditAdmin(this.audit, actor, { action: `report.${input.decision}`, entity: 'Report', entityId: id, workspaceId: result.report.workspaceId ?? result.report.targetWorkspaceId, after: { status: result.report.status, decision: input.decision, blacklistId: result.blacklistId }, reason: note });
    return this.get(id, true);
  }

  async assign(id: string, assigneeId: string | null, actor: PlatformActor) {
    return sys(async () => {
      const r = await prisma.report.findUnique({ where: { id } });
      if (!r) throw notFound();
      if (FINAL.includes(r.status)) throw new AppException('CONFLICT');
      if (assigneeId && !(await prisma.user.findFirst({ where: { id: assigneeId, platformRole: { in: ['super_admin', 'moderator'] }, deletedAt: null } }))) throw validationError({ assigneeId: 'validation.invalid' });
      await prisma.report.update({ where: { id }, data: { assigneeId, ...(r.status === 'open' && assigneeId ? { status: 'reviewing' } : {}) } });
      await auditAdmin(this.audit, actor, { action: 'report.assign', entity: 'Report', entityId: id, workspaceId: r.workspaceId, after: { assigneeId } });
      return this.get(id, true);
    });
  }

  // --- platform blacklist (SAFE-07) ---------------------------------------------------------------------------------------
  private presentBlacklist(b: Prisma.PlatformBlacklistGetPayload<{ include: { createdBy: typeof userRefSelect; revokedBy: typeof userRefSelect } }>): BlacklistRowDto {
    return { id: b.id, phone: b.phone, reason: b.reason, reportId: b.reportId, workspaceCount: b.workspaceCount, createdBy: toUserRef(b.createdBy)!, createdAt: b.createdAt.toISOString(), revokedBy: toUserRef(b.revokedBy), revokedAt: iso(b.revokedAt) };
  }

  async blacklist(q: { page: number; pageSize: number; q?: string; active?: boolean }): Promise<Page<BlacklistRowDto>> {
    return sys(async () => {
      const where: Prisma.PlatformBlacklistWhereInput = {
        ...(q.active === true ? { revokedAt: null } : q.active === false ? { revokedAt: { not: null } } : {}),
        ...(q.q ? { OR: [{ phone: { contains: q.q.replace(/\s/g, '') } }, { reason: { contains: q.q, mode: 'insensitive' } }] } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.platformBlacklist.findMany({ where, include: { createdBy: userRefSelect, revokedBy: userRefSelect }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }),
        prisma.platformBlacklist.count({ where }),
      ]);
      return page(rows.map((b) => this.presentBlacklist(b)), total, q);
    });
  }

  /**
   * Blacklists a phone: `PlatformBlacklist` row + `CustomerBlock(source=platform)` in every workspace where the phone is a
   * client (or already blocked). New clients with that phone are blocked by `SafetyService.index` (platform phones).
   */
  private async blacklistTx(tx: Tx, input: { phone: string; reason: string; reportId?: string | null }, actor: PlatformActor) {
    const phone = normalizePhoneDz(input.phone);
    const existing = await tx.platformBlacklist.findUnique({ where: { phone } });
    if (existing && !existing.revokedAt) throw new AppException('CONFLICT', {}, { phone: 'validation.taken' });
    const clients = await tx.client.findMany({ where: { phone, deletedAt: null }, select: { id: true, workspaceId: true } });
    const blocked = await tx.customerBlock.findMany({ where: { phone, unblockedAt: null }, select: { workspaceId: true, source: true } });
    const workspaces = [...new Set([...clients.map((c) => c.workspaceId), ...blocked.map((b) => b.workspaceId)])];
    for (const ws of workspaces) {
      if (blocked.some((b) => b.workspaceId === ws && b.source === 'platform')) continue;
      const clientId = clients.find((c) => c.workspaceId === ws)?.id ?? null;
      // an active merchant block of the same customer becomes the platform row (one row, lock pill, not unblockable)
      const existingBlock = await tx.customerBlock.findFirst({ where: { workspaceId: ws, unblockedAt: null, OR: [...(clientId ? [{ clientId }] : []), { phone }] } });
      const block = existingBlock
        ? await tx.customerBlock.update({ where: { id: existingBlock.id }, data: { source: 'platform', phone, reportId: input.reportId ?? existingBlock.reportId, note: input.reason } })
        : await tx.customerBlock.create({ data: { workspaceId: ws, clientId, phone, reason: 'fraud', note: input.reason, source: 'platform', reportId: input.reportId ?? null, blockedById: null } });
      await this.outbox.enqueue(tx, { topic: 'webhook', key: `customer.blocked:${block.id}:platform`, workspaceId: ws, payload: { event: 'customer.blocked', data: { blockId: block.id, clientId, phone, source: 'platform' } } });
      const convs = await tx.conversation.findMany({ where: { workspaceId: ws, deletedAt: null, OR: [...(clientId ? [{ clientId }] : []), { client: { phone } }] }, select: { id: true }, take: 50 });
      for (const c of convs) await this.outbox.ws(tx, `ws:${ws}`, 'conversation.updated', { id: c.id, conversation: { id: c.id, blocked: true } });
    }
    const data = { reason: input.reason, reportId: input.reportId ?? null, workspaceCount: workspaces.length, createdById: actor.userId, revokedAt: null, revokedById: null };
    const row = existing ? await tx.platformBlacklist.update({ where: { id: existing.id }, data }) : await tx.platformBlacklist.create({ data: { phone, ...data } });
    return row;
  }

  async addBlacklist(input: BlacklistCreateInput, actor: PlatformActor) {
    const reason = requireReason(input.reason);
    const row = await sysTx((tx) => this.blacklistTx(tx, { phone: input.phone, reason, reportId: input.reportId ?? null }, actor));
    await auditAdmin(this.audit, actor, { action: 'blacklist.add', entity: 'PlatformBlacklist', entityId: row.id, after: { phone: maskPhone(row.phone), workspaceCount: row.workspaceCount }, reason });
    return sys(async () => this.presentBlacklist(await prisma.platformBlacklist.findUniqueOrThrow({ where: { id: row.id }, include: { createdBy: userRefSelect, revokedBy: userRefSelect } })));
  }

  /** `DELETE /admin/blacklist/:id { reason }` — lifts every platform block of the phone (moderator, logged). */
  async revokeBlacklist(id: string, reasonIn: string | undefined, actor: PlatformActor) {
    const reason = requireReason(reasonIn);
    const row = await sysTx(async (tx) => {
      const b = await tx.platformBlacklist.findUnique({ where: { id } });
      if (!b) throw notFound();
      if (b.revokedAt) throw new AppException('CONFLICT');
      const blocks = await tx.customerBlock.findMany({ where: { phone: b.phone, source: 'platform', unblockedAt: null }, select: { id: true, workspaceId: true, clientId: true } });
      await tx.customerBlock.updateMany({ where: { id: { in: blocks.map((x) => x.id) } }, data: { unblockedAt: new Date(), unblockedById: actor.userId } });
      for (const blk of blocks) {
        const convs = await tx.conversation.findMany({ where: { workspaceId: blk.workspaceId, deletedAt: null, OR: [...(blk.clientId ? [{ clientId: blk.clientId }] : []), { client: { phone: b.phone } }] }, select: { id: true }, take: 50 });
        for (const c of convs) await this.outbox.ws(tx, `ws:${blk.workspaceId}`, 'conversation.updated', { id: c.id, conversation: { id: c.id, blocked: false } });
      }
      return tx.platformBlacklist.update({ where: { id }, data: { revokedAt: new Date(), revokedById: actor.userId } });
    });
    await auditAdmin(this.audit, actor, { action: 'blacklist.revoke', entity: 'PlatformBlacklist', entityId: id, after: { phone: maskPhone(row.phone) }, reason });
    return sys(async () => this.presentBlacklist(await prisma.platformBlacklist.findUniqueOrThrow({ where: { id }, include: { createdBy: userRefSelect, revokedBy: userRefSelect } })));
  }

  // --- platform blocked words (SAFE-06) -----------------------------------------------------------------------------------
  async blockedWords(): Promise<{ words: PlatformBlockedWordDto[] }> {
    return sys(async () => ({
      words: (await prisma.blockedWord.findMany({ where: { workspaceId: null }, orderBy: [{ word: 'asc' }] })).map((w) => ({ id: w.id, word: w.word, locale: w.locale, createdAt: w.createdAt.toISOString() })),
    }));
  }

  async setBlockedWords(input: AdminBlockedWordsInput, actor: PlatformActor) {
    const clean = new Map<string, string | null>();
    for (const w of input.words) {
      const word = w.word.trim().toLowerCase();
      if (word && !clean.has(word)) clean.set(word, w.locale ?? null);
    }
    const before = await sys(() => prisma.blockedWord.count({ where: { workspaceId: null } }));
    await sysTx(async (tx) => {
      await tx.blockedWord.deleteMany({ where: { workspaceId: null, word: { notIn: [...clean.keys()] } } });
      const kept = new Set((await tx.blockedWord.findMany({ where: { workspaceId: null }, select: { word: true } })).map((w) => w.word));
      const add = [...clean.entries()].filter(([w]) => !kept.has(w));
      if (add.length) await tx.blockedWord.createMany({ data: add.map(([word, locale]) => ({ workspaceId: null, word, locale: locale as never, createdById: actor.userId })) });
    });
    await auditAdmin(this.audit, actor, { action: 'safety.platform_blocked_words', entity: 'BlockedWord', before: { count: before }, after: { count: clean.size }, reason: input.reason ?? null });
    return this.blockedWords();
  }

  // --- platform auto-rules (04 §13 "Platform auto-rules") ------------------------------------------------------------------
  async autoRuleStatus(): Promise<SafetyAutoRuleDto[]> {
    const last = await this.redis.client.get('safety:auto-rules:last-run');
    return sys(async () => {
      const since = new Date(Date.now() - 30 * DAY);
      const [customers, merchants] = await Promise.all([
        prisma.report.count({ where: { reporterKind: 'system', type: 'customer', createdAt: { gte: since } } }),
        prisma.report.count({ where: { reporterKind: 'system', type: 'merchant', createdAt: { gte: since } } }),
      ]);
      const ai = Number((await this.redis.client.get('safety:auto-rules:ai-alerts-30d')) ?? 0);
      return [
        { key: 'phone_blocked_by_workspaces', ...AUTO_RULES.phone_blocked_by_workspaces, outcome: 'report_customer_blacklist_proposed', hits30d: customers, lastRunAt: last },
        { key: 'merchant_reported_by_customers', ...AUTO_RULES.merchant_reported_by_customers, outcome: 'report_merchant_review', hits30d: merchants, lastRunAt: last },
        { key: 'ai_messages_reported', ...AUTO_RULES.ai_messages_reported, outcome: 'platform_alert_preset', hits30d: ai, lastRunAt: last },
      ];
    });
  }

  /** `sched-abuse-auto-rules` (hourly). Idempotent: an open system report per phone / workspace, one alert per agent and day. */
  async autoRules() {
    const out = await sys(async () => {
      const r1 = AUTO_RULES.phone_blocked_by_workspaces;
      const phones = await prisma.$queryRaw<{ phone: string; n: bigint; clientId: string | null }[]>`
        SELECT b."phone", count(DISTINCT b."workspaceId") AS n, (array_agg(b."clientId" ORDER BY b."blockedAt" DESC) FILTER (WHERE b."clientId" IS NOT NULL))[1] AS "clientId"
        FROM "CustomerBlock" b
        WHERE b."phone" IS NOT NULL AND b."unblockedAt" IS NULL AND b."source" <> 'platform' AND b."blockedAt" >= now() - make_interval(days => ${r1.windowDays}::int)
          AND NOT EXISTS (SELECT 1 FROM "PlatformBlacklist" pb WHERE pb."phone" = b."phone" AND pb."revokedAt" IS NULL)
        GROUP BY b."phone" HAVING count(DISTINCT b."workspaceId") >= ${r1.threshold}`;
      let customerReports = 0;
      for (const p of phones) {
        const open = await prisma.report.findFirst({ where: { reporterKind: 'system', type: 'customer', status: { in: ['open', 'reviewing'] }, excerpt: { path: ['phone'], equals: p.phone } } });
        if (open) continue;
        await prisma.$transaction(async (db) => {
          const tx = db as Tx;
          await tx.report.create({ data: { type: 'customer', reporterKind: 'system', clientId: p.clientId, reason: 'fraud', severity: 'high', details: `blocked_by_workspaces:${Number(p.n)}:${r1.windowDays}d — blacklist proposed`, excerpt: { phone: p.phone, workspaces: Number(p.n), rule: 'phone_blocked_by_workspaces' } } });
          await this.emitQueue(tx);
        });
        customerReports++;
      }
      const r2 = AUTO_RULES.merchant_reported_by_customers;
      const merchants = await prisma.report.groupBy({ by: ['targetWorkspaceId'], where: { reporterKind: 'end_customer', type: 'merchant', targetWorkspaceId: { not: null }, createdAt: { gte: new Date(Date.now() - r2.windowDays * DAY) } }, _count: { _all: true }, having: { targetWorkspaceId: { _count: { gte: r2.threshold } } } });
      let merchantReports = 0;
      for (const m of merchants) {
        const open = await prisma.report.findFirst({ where: { reporterKind: 'system', type: 'merchant', targetWorkspaceId: m.targetWorkspaceId, status: { in: ['open', 'reviewing'] } } });
        if (open) continue;
        await prisma.$transaction(async (db) => {
          const tx = db as Tx;
          await tx.report.create({ data: { type: 'merchant', reporterKind: 'system', targetWorkspaceId: m.targetWorkspaceId, reason: 'other', severity: 'high', details: `merchant_reported_by_customers:${m._count._all}:${r2.windowDays}d — workspace review`, excerpt: { rule: 'merchant_reported_by_customers', reports: m._count._all } } });
          await this.emitQueue(tx);
        });
        merchantReports++;
      }
      const r3 = AUTO_RULES.ai_messages_reported;
      const agents = await prisma.$queryRaw<{ agentId: string; workspaceId: string; presetId: string | null; n: bigint }[]>`
        SELECT a."id" AS "agentId", a."workspaceId", a."presetId", count(*) AS n FROM "Report" r JOIN "AiRun" ar ON ar."id" = r."aiRunId" JOIN "Agent" a ON a."id" = ar."agentId"
        WHERE r."type" = 'ai_message' AND r."createdAt" >= now() - make_interval(days => ${r3.windowDays}::int)
        GROUP BY a."id", a."workspaceId", a."presetId" HAVING count(*) >= ${r3.threshold}`;
      let alerts = 0;
      for (const a of agents) {
        const key = `platform.alert:ai_reports:${a.agentId}:${algiersDay()}`;
        const exists = await prisma.outbox.findUnique({ where: { topic_key: { topic: 'ws', key: `ws:${key}` } } });
        if (exists) continue;
        await this.outbox.ws(prisma, 'admin:platform', 'platform.alert', { kind: 'ai_reports', payload: { agentId: a.agentId, workspaceId: a.workspaceId, presetId: a.presetId, reports30d: Number(a.n) } }, key);
        alerts++;
      }
      return { customerReports, merchantReports, alerts };
    });
    await this.redis.client.set('safety:auto-rules:last-run', new Date().toISOString());
    if (out.alerts) await this.redis.client.incrby('safety:auto-rules:ai-alerts-30d', out.alerts);
    await this.redis.client.expire('safety:auto-rules:ai-alerts-30d', 30 * 86400);
    return out;
  }

  // --- monthly compliance export (04 §13 "Retention": CSV counts by type / decision) ---------------------------------------
  async requestExport(month: string, actor: PlatformActor) {
    const job = await sysTx(async (tx) => {
      const j = await tx.job.create({ data: { workspaceId: null, kind: 'export', queue: 'jobs', status: 'queued', payload: { kind: 'safety', month }, createdById: actor.userId, expiresAt: new Date(Date.now() + 7 * DAY) } });
      await this.queue.add(tx, 'jobs', 'safety-export', { jobId: j.id, workspaceId: null }, `safety-export:${j.id}`, { attempts: 1 });
      return j;
    });
    await auditAdmin(this.audit, actor, { action: 'safety.export', entity: 'Job', entityId: job.id, after: { month } });
    return { jobId: job.id };
  }

  async runExport(jobId: string) {
    return sys(async () => {
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job || job.status === 'done') return;
      const month = (job.payload as { month: string }).month;
      await prisma.job.update({ where: { id: jobId }, data: { status: 'running' } });
      try {
        const from = algiersDayStart(`${month}-01`);
        const [y, m] = month.split('-').map(Number) as [number, number];
        const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
        const to = algiersDayStart(next);
        const [byType, byDecision, blocks] = await Promise.all([
          prisma.report.groupBy({ by: ['type', 'reporterKind'], where: { createdAt: { gte: from, lt: to } }, _count: { _all: true } }),
          prisma.report.groupBy({ by: ['decision'], where: { resolvedAt: { gte: from, lt: to } }, _count: { _all: true } }),
          prisma.customerBlock.groupBy({ by: ['source'], where: { blockedAt: { gte: from, lt: to } }, _count: { _all: true } }),
        ]);
        const lines = ['section,key,subkey,count'];
        for (const g of byType) lines.push(`reports_by_type,${g.type},${g.reporterKind},${g._count._all}`);
        for (const g of byDecision) lines.push(`reports_by_decision,${g.decision ?? 'pending'},,${g._count._all}`);
        for (const g of blocks) lines.push(`blocks_by_source,${g.source},,${g._count._all}`);
        const key = `platform/exports/safety-${month}-${jobId}.csv`;
        await this.storage.put(key, Buffer.from(`${String.fromCharCode(0xfeff)}${lines.join('\n')}\n`, 'utf8'), 'text/csv');
        await prisma.job.update({ where: { id: jobId }, data: { status: 'done', progress: 100, result: { key, rows: lines.length - 1, month } } });
      } catch (err) {
        this.log.error({ jobId, err: (err as Error).message }, 'safety export failed');
        await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', error: JSON.stringify({ code: 'REPORT_EXPORT_FAILED', params: { ref: jobId } }) } });
      }
    });
  }

  async exportStatus(jobId: string) {
    return sys(async () => {
      const job = await prisma.job.findFirst({ where: { id: jobId, workspaceId: null, kind: 'export' } });
      if (!job || (job.payload as { kind?: string } | null)?.kind !== 'safety') throw notFound();
      const result = job.result as { key?: string; rows?: number; month?: string } | null;
      return { id: job.id, status: job.status, month: (job.payload as { month: string }).month, rows: result?.rows ?? null, resultUrl: result?.key ? this.storage.signedUrl(result.key, 24 * 3600) : null, error: job.error ? JSON.parse(job.error) : null, createdAt: job.createdAt.toISOString() };
    });
  }
}

