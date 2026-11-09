// D38 / 03 §25 HELP-03…05 — support tickets: merchant side (`/support/tickets*`, `support.write` / `support.read_all`) and
// platform side (ADM-12, `/admin/support/*`). Tickets are platform rows with an optional `workspaceId` (not a tenant model):
// every merchant query filters on the request's workspace explicitly. Side effects (WS, `support.reply`) go through the outbox.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { prisma, Prisma, TenantContext, type SupportTicket, type TicketStatus, type Tx } from '@djaber/db';
import {
  TICKET_AUTO_CLOSE_DAYS,
  TICKET_SLA_HOURS,
  type AdminCreateTicketInput,
  type AdminTicketDto,
  type AdminTicketMessageInput,
  type AdminTicketsQuery,
  type CannedReplyDto,
  type CannedReplyInput,
  type CreateTicketInput,
  type CreateTicketResultDto,
  type SupportStatsDto,
  type SupportTicketDto,
  type TicketMessageView,
  type TicketRateInput,
  type TicketReplyInput,
  type TicketsQuery,
} from '@djaber/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { AppException, forbidden, notFound, validationError } from '../../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../../core/http/pagination';
import { OutboxService } from '../../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../../core/queue/processor.registry';
import { can } from '../../../core/rbac/permission-matrix';
import { periodRange, type PeriodKey } from '../../../core/time/period';
import { moderationSlaDueAt } from '../../catalog/moderation-hook.service';
import { NotificationProducer } from '../../notifications/notification.producer';
import { auditAdmin, iso, pick, sys, sysTx, toUserRef, userRefSelect, type PlatformActor } from '../admin-ops.util';
import { AdminNotifier } from '../../notifications/admin-notifier.service';

/** One business day of 09:00–18:00 = 540 business minutes. */
const BUSINESS_DAY_MIN = 9 * 60;
/**
 * HELP-05: SLA per plan in business hours (Pro 1 h · Starter 4 h · Free 24 h). AT-HELP-04 reads the Free value as
 * "next business day": a value of a full day or more counts as one business day (540 business minutes).
 */
export const slaMinutes = (hours: number) => (hours >= 24 ? BUSINESS_DAY_MIN : hours * 60);
export const ticketSlaDueAt = (from: Date, hours: number) => moderationSlaDueAt(from, slaMinutes(hours));
export const slaHoursOf = (planSlug: string | null | undefined) => TICKET_SLA_HOURS[planSlug ?? 'free'] ?? TICKET_SLA_HOURS.free!;
/** Support owes an answer while the ticket is `open` (new ticket or merchant reply): past `slaDueAt` = breached. */
export const isSlaBreached = (t: Pick<SupportTicket, 'status' | 'slaDueAt'>, now = Date.now()) => t.status === 'open' && t.slaDueAt.getTime() < now;

type Attachment = { uploadId: string; name: string; url: string; size: number; mime?: string };
const ticketInclude = {
  messages: { orderBy: [{ at: 'asc' }, { id: 'asc' }], include: { author: userRefSelect } },
  user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true, lastSeenPlatform: true } },
  assignee: userRefSelect,
  workspace: { select: { id: true, name: true, status: true } },
  incident: { select: { id: true, title: true } },
} as const satisfies Prisma.SupportTicketInclude;
type TicketRow = Prisma.SupportTicketGetPayload<{ include: typeof ticketInclude }>;
type MessageRow = TicketRow['messages'][number];

const contextText = (ctx: Record<string, string>) =>
  Object.entries(ctx)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

@Injectable()
export class SupportTicketService implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationProducer,
    private readonly audit: AuditService,
    private readonly registry: ProcessorRegistry,
    private readonly admins: AdminNotifier,
  ) {}

  onModuleInit() {
    // HELP-05: resolved tickets are closed 30 d after `resolvedAt`
    this.registry.cron('sched-support-close', '20 2 * * *', () => this.autoClose());
    // 03-events §4 `sched-moderation-sla`: "support tickets past slaDueAt ⇒ slaBreached" (computed) + admin counters / alert
    this.registry.extendCron('sched-moderation-sla', 'tickets', () => this.slaSweep());
  }

  // --- shared ------------------------------------------------------------------------------------------------------------
  private async planSlug(db: Tx | typeof prisma, workspaceId: string | null) {
    if (!workspaceId) return 'free';
    const sub = await db.subscription.findFirst({ where: { workspaceId, status: { in: ['trial', 'active', 'dunning'] } }, include: { plan: { select: { slug: true } } }, orderBy: { createdAt: 'desc' } });
    return sub?.plan.slug ?? 'free';
  }

  /** `T-<year>-<seq>` (one sequence per year for the whole platform, serialised by an advisory lock). */
  private async nextNumber(tx: Tx) {
    const year = new Date().getUTCFullYear();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support-ticket:${year}`}, 0))`;
    const prefix = `T-${year}-`;
    const rows = await tx.$queryRaw<{ n: number | null }[]>`SELECT max(substring("number" from ${prefix.length + 1}::int)::int) AS n FROM "SupportTicket" WHERE "number" LIKE ${`${prefix}%`} AND substring("number" from ${prefix.length + 1}::int) ~ '^[0-9]+$'`;
    return `${prefix}${String((rows[0]?.n ?? 0) + 1).padStart(5, '0')}`;
  }

  /** Uploads of kind `ticket_attachment` owned by this workspace (merchant) or this platform user (admin answer). */
  private async attachments(db: Tx | typeof prisma, ids: string[], owner: { workspaceId: string } | { userId: string }): Promise<Attachment[]> {
    if (!ids.length) return [];
    const where: Prisma.UploadWhereInput = { id: { in: ids }, kind: 'ticket_attachment', ...('workspaceId' in owner ? { workspaceId: owner.workspaceId } : { createdById: owner.userId, workspaceId: null }) };
    const rows = await TenantContext.runSystem(() => db.upload.findMany({ where }));
    if (rows.length !== new Set(ids).size) throw validationError({ attachments: 'validation.invalid' });
    return rows.map((u) => ({ uploadId: u.id, name: u.storageKey.split('/').pop() ?? u.id, url: u.url, size: u.size, mime: u.mime }));
  }

  private presentMessage(m: MessageRow, withInternal: boolean): TicketMessageView {
    const atts = Array.isArray(m.attachments) ? (m.attachments as Attachment[]) : [];
    return {
      id: m.id,
      authorKind: m.authorKind,
      author: toUserRef(m.author),
      body: m.body,
      attachments: atts.map((a) => ({ name: a.name, url: a.url, size: a.size })),
      at: m.at.toISOString(),
      ...(withInternal ? { isInternal: m.isInternal, cannedReplyKey: m.cannedReplyKey } : {}),
    };
  }

  private lastPublic(t: TicketRow) {
    return [...t.messages].reverse().find((m) => !m.isInternal) ?? null;
  }

  private async emit(tx: Tx | typeof prisma, t: Pick<SupportTicket, 'id' | 'workspaceId' | 'status'>, lastMessageAt: Date) {
    if (t.workspaceId) await this.outbox.ws(tx, `ws:${t.workspaceId}`, 'ticket.updated', { id: t.id, status: t.status, lastMessageAt: lastMessageAt.toISOString() });
    await this.emitQueue(tx);
  }

  /** Admin room counters (contract §5 `tickets.queue`). */
  async emitQueue(tx: Tx | typeof prisma) {
    const now = new Date();
    const [open, overSla] = await TenantContext.runSystem(() => Promise.all([tx.supportTicket.count({ where: { status: 'open' } }), tx.supportTicket.count({ where: { status: 'open', slaDueAt: { lt: now } } })]));
    await this.outbox.ws(tx, 'admin:platform', 'tickets.queue', { open, overSla, count: open }, `tickets.queue:${now.getTime()}:${Math.random().toString(36).slice(2, 8)}`);
  }

  private async notifyReply(tx: Tx, t: Pick<SupportTicket, 'id' | 'number' | 'workspaceId' | 'userId'>, key: string) {
    if (!t.workspaceId) return;
    await this.notifications.emit(tx, { type: 'support_reply', workspaceId: t.workspaceId, userIds: [t.userId], key: `support_reply:${t.id}:${key}`, data: { ticketId: t.id, ticket: t.number } });
  }

  // --- merchant ----------------------------------------------------------------------------------------------------------
  private presentMerchant(t: TicketRow): SupportTicketDto {
    const pub = t.messages.filter((m) => !m.isInternal);
    const last = pub[pub.length - 1];
    return {
      id: t.id,
      number: t.number,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      channel: t.channel,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      lastMessageAt: (last?.at ?? t.createdAt).toISOString(),
      awaitingMe: t.status !== 'closed' && last?.authorKind === 'support',
      slaDueAt: t.slaDueAt.toISOString(),
      satisfaction: t.satisfaction,
      satisfactionNote: t.satisfactionNote,
      resolvedAt: iso(t.resolvedAt),
      author: toUserRef(t.user)!,
      messages: pub.map((m) => this.presentMessage(m, false)),
      context: (t.context ?? {}) as Record<string, string>,
    };
  }

  /** Merchant visibility: Admin+ see every ticket of the workspace (`support.read_all`), Operators their own (else 404). */
  private async mine(id: string): Promise<TicketRow> {
    const t = TenantContext.get();
    const row = await TenantContext.runSystem(() => prisma.supportTicket.findFirst({ where: { id, workspaceId: t.workspaceId }, include: ticketInclude }));
    if (!row || (!can(t.role, 'support.read_all') && row.userId !== t.userId)) throw notFound();
    return row;
  }

  async create(input: CreateTicketInput, channelHint: 'web' | 'mobile'): Promise<CreateTicketResultDto> {
    const t = TenantContext.get();
    // HELP-03: Operators cannot pick the billing category
    if (input.category === 'billing' && !can(t.role, 'billing.read')) throw forbidden();
    const atts = await this.attachments(prisma, input.attachments, { workspaceId: t.workspaceId });
    const now = new Date();
    const slaHours = slaHoursOf(await this.planSlug(prisma, t.workspaceId));
    const subject = input.subject ?? (input.message.length > 80 ? `${input.message.slice(0, 77).trimEnd()}…` : input.message);
    const ticket = await sysTx(async (tx) => {
      const number = await this.nextNumber(tx);
      const created = await tx.supportTicket.create({
        data: {
          number,
          workspaceId: t.workspaceId,
          userId: t.userId!,
          category: input.category,
          priority: input.priority,
          channel: input.channel ?? channelHint,
          subject,
          context: input.context as Prisma.InputJsonValue,
          slaHours,
          slaDueAt: ticketSlaDueAt(now, slaHours),
        },
      });
      // the auto-context block first (system message), then the merchant's message — never customer messages (HELP-03)
      const ctx = contextText(input.context);
      if (ctx) await tx.supportMessage.create({ data: { ticketId: created.id, authorKind: 'system', body: ctx, at: now } });
      await tx.supportMessage.create({ data: { ticketId: created.id, authorKind: 'user', authorId: t.userId!, body: input.message, attachments: atts as unknown as Prisma.InputJsonValue, at: new Date(now.getTime() + 1) } });
      await this.emit(tx, created, now);
      // owner request 09/11: the support team is told of every new ticket
      const shop = await tx.workspace.findUnique({ where: { id: t.workspaceId }, select: { name: true } });
      await this.admins.notify(tx, { kind: 'ticket_opened', key: `ticket_opened:${created.id}`, params: { workspace: shop?.name ?? '—', number: created.number, subject }, ids: { workspaceId: t.workspaceId, ticketId: created.id } });
      return created;
    });
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'support.ticket_create', entity: 'SupportTicket', entityId: ticket.id, after: { number: ticket.number, category: ticket.category, priority: ticket.priority } });
    return { id: ticket.id, number: ticket.number, slaDueAt: ticket.slaDueAt.toISOString() };
  }

  async list(q: TicketsQuery): Promise<Page<SupportTicketDto>> {
    const t = TenantContext.get();
    if (q.scope === 'workspace' && !can(t.role, 'support.read_all')) throw forbidden();
    const where: Prisma.SupportTicketWhereInput = { workspaceId: t.workspaceId, ...(q.scope === 'mine' ? { userId: t.userId } : {}), ...(q.status?.length ? { status: { in: q.status } } : {}) };
    return TenantContext.runSystem(async () => {
      const [rows, total] = await Promise.all([prisma.supportTicket.findMany({ where, include: ticketInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }), prisma.supportTicket.count({ where })]);
      return page(rows.map((r) => this.presentMerchant(r)), total, q);
    });
  }

  async get(id: string) {
    return this.presentMerchant(await this.mine(id));
  }

  /** Merchant reply ⇒ `open` again and a new SLA for the next answer; closed ⇒ 409 TICKET_CLOSED. */
  async reply(id: string, input: TicketReplyInput) {
    const t = TenantContext.get();
    const row = await this.mine(id);
    if (row.status === 'closed') throw new AppException('TICKET_CLOSED');
    const atts = await this.attachments(prisma, input.attachments, { workspaceId: t.workspaceId });
    const now = new Date();
    await sysTx(async (tx) => {
      await tx.supportMessage.create({ data: { ticketId: id, authorKind: 'user', authorId: t.userId!, body: input.body, attachments: atts as unknown as Prisma.InputJsonValue, at: now } });
      const updated = await tx.supportTicket.update({ where: { id }, data: { status: 'open', resolvedAt: null, slaDueAt: ticketSlaDueAt(now, row.slaHours) } });
      await this.emit(tx, updated, now);
      const shop = await tx.workspace.findUnique({ where: { id: t.workspaceId }, select: { name: true } });
      await this.admins.notify(tx, { kind: 'ticket_reply', key: `ticket_reply:${id}:${now.getTime()}`, params: { workspace: shop?.name ?? '—', number: updated.number, subject: updated.subject }, ids: { workspaceId: t.workspaceId, ticketId: id } });
    });
    return this.get(id);
  }

  /** Satisfaction 1–5 on a resolved ticket ⇒ `closed` at once (HELP-05). */
  async rate(id: string, input: TicketRateInput) {
    const t = TenantContext.get();
    const row = await this.mine(id);
    if (row.status === 'closed') throw new AppException('TICKET_CLOSED');
    if (row.status !== 'resolved') throw new AppException('CONFLICT', {}, {}, { status: row.status });
    const now = new Date();
    await sysTx(async (tx) => {
      const updated = await tx.supportTicket.update({ where: { id }, data: { satisfaction: input.score, satisfactionNote: input.note ?? null, status: 'closed', closedAt: now } });
      await this.emit(tx, updated, now);
    });
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'support.ticket_rate', entity: 'SupportTicket', entityId: id, after: { satisfaction: input.score } });
    return this.get(id);
  }

  async close(id: string) {
    const row = await this.mine(id);
    if (row.status === 'closed') return this.presentMerchant(row);
    const now = new Date();
    await sysTx(async (tx) => {
      const updated = await tx.supportTicket.update({ where: { id }, data: { status: 'closed', closedAt: now } });
      await this.emit(tx, updated, now);
    });
    return this.get(id);
  }

  // --- admin -------------------------------------------------------------------------------------------------------------
  private adminActions(t: Pick<SupportTicket, 'status'>, canWrite: boolean): AdminTicketDto['actions'] {
    const deny = canWrite ? undefined : 'FORBIDDEN';
    const closed = t.status === 'closed';
    const item = (key: string, ok: boolean, reason?: string, extra: Partial<AdminTicketDto['actions'][number]> = {}) => ({ key, enabled: !deny && ok, ...(deny || (!ok && reason) ? { reasonCode: deny ?? reason } : {}), ...extra });
    return [
      item('reply', !closed, 'TICKET_CLOSED', { primary: true }),
      item('wait_customer', t.status === 'open', 'CONFLICT'),
      item('resolve', t.status === 'open' || t.status === 'pending_customer', 'CONFLICT'),
      item('reopen', t.status === 'resolved' || closed, 'CONFLICT'),
      item('assign', !closed, 'TICKET_CLOSED'),
      item('escalate', !closed, 'TICKET_CLOSED'),
      item('link_incident', !closed, 'TICKET_CLOSED'),
    ];
  }

  private async adminFacts(rows: TicketRow[]) {
    const ws = [...new Set(rows.map((r) => r.workspaceId).filter((x): x is string => !!x))];
    const users = [...new Set(rows.map((r) => r.userId))];
    const [subs, members, previous] = await Promise.all([
      ws.length ? prisma.subscription.findMany({ where: { workspaceId: { in: ws }, status: { in: ['trial', 'active', 'dunning'] } }, include: { plan: { select: { slug: true } } }, orderBy: { createdAt: 'desc' } }) : [],
      ws.length ? prisma.membership.findMany({ where: { workspaceId: { in: ws }, userId: { in: users } }, select: { workspaceId: true, userId: true, role: true } }) : [],
      prisma.supportTicket.groupBy({ by: ['userId'], where: { userId: { in: users } }, _count: { _all: true }, _avg: { satisfaction: true } }),
    ]);
    return { subs, members, previous };
  }

  private presentAdmin(t: TicketRow, f: Awaited<ReturnType<SupportTicketService['adminFacts']>>, withMessages: boolean, canWrite: boolean): AdminTicketDto {
    const now = Date.now();
    const last = this.lastPublic(t);
    const prev = f.previous.find((p) => p.userId === t.userId);
    const plan = f.subs.find((s) => s.workspaceId === t.workspaceId)?.plan.slug ?? 'free';
    const role = f.members.find((m) => m.workspaceId === t.workspaceId && m.userId === t.userId)?.role ?? null;
    return {
      id: t.id,
      number: t.number,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      channel: t.channel,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      lastMessageAt: (last?.at ?? t.createdAt).toISOString(),
      awaitingMe: t.status === 'open',
      slaDueAt: t.slaDueAt.toISOString(),
      slaHours: t.slaHours,
      slaRemainingMin: Math.round((t.slaDueAt.getTime() - now) / 60_000),
      slaBreached: isSlaBreached(t, now),
      satisfaction: t.satisfaction,
      satisfactionNote: t.satisfactionNote,
      messages: withMessages ? t.messages.map((m) => this.presentMessage(m, true)) : [],
      context: (t.context ?? {}) as Record<string, string>,
      workspace: t.workspace ? { id: t.workspace.id, name: t.workspace.name, plan, status: t.workspace.status } : null,
      user: { ...toUserRef(t.user)!, email: t.user.email, role, platform: t.user.lastSeenPlatform ?? t.channel },
      assignee: toUserRef(t.assignee),
      firstResponseAt: iso(t.firstResponseAt),
      resolvedAt: iso(t.resolvedAt),
      escalatedAt: iso(t.escalatedAt),
      escalationNote: t.escalationNote,
      incident: t.incident ? { id: t.incident.id, title: pick(t.incident.title, 'fr') } : null,
      previousTickets: { count: Math.max(0, (prev?._count._all ?? 1) - 1), avgSatisfaction: prev?._avg.satisfaction === null || prev?._avg.satisfaction === undefined ? null : Math.round(prev._avg.satisfaction * 10) / 10 },
      internalNotes: t.messages.some((m) => m.isInternal),
      actions: this.adminActions(t, canWrite),
    };
  }

  private async adminWhere(q: AdminTicketsQuery, actor: PlatformActor): Promise<Prisma.SupportTicketWhereInput> {
    const and: Prisma.SupportTicketWhereInput[] = [];
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.category?.length) and.push({ category: { in: q.category } });
    if (q.priority?.length) and.push({ priority: { in: q.priority } });
    if (q.channel?.length) and.push({ channel: { in: q.channel } });
    if (q.workspaceId) and.push({ workspaceId: q.workspaceId });
    if (q.assigneeId === 'me') and.push({ assigneeId: actor.userId });
    else if (q.assigneeId === 'none') and.push({ assigneeId: null });
    else if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    if (q.slaBreached === true) and.push({ status: 'open', slaDueAt: { lt: new Date() } });
    if (q.slaBreached === false) and.push({ NOT: { status: 'open', slaDueAt: { lt: new Date() } } });
    if (q.planSlug?.length) {
      const subs = await prisma.subscription.findMany({ where: { status: { in: ['trial', 'active', 'dunning'] }, plan: { slug: { in: q.planSlug } } }, select: { workspaceId: true } });
      and.push({ workspaceId: { in: [...new Set(subs.map((s) => s.workspaceId))] } });
    }
    if (q.q) and.push({ OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { subject: { contains: q.q, mode: 'insensitive' } }, { workspace: { name: { contains: q.q, mode: 'insensitive' } } }, { user: { email: { contains: q.q, mode: 'insensitive' } } }] });
    return and.length ? { AND: and } : {};
  }

  async adminList(q: AdminTicketsQuery, actor: PlatformActor, canWrite: boolean): Promise<Page<AdminTicketDto>> {
    return sys(async () => {
      const where = await this.adminWhere(q, actor);
      // overdue first: `open` sorts first (enum order) and the earliest SLA leads
      const [rows, total] = await Promise.all([
        prisma.supportTicket.findMany({ where, include: ticketInclude, orderBy: [{ status: 'asc' }, { slaDueAt: 'asc' }, { id: 'desc' }], ...toSkipTake(q) }),
        prisma.supportTicket.count({ where }),
      ]);
      const facts = await this.adminFacts(rows);
      return page(rows.map((r) => this.presentAdmin(r, facts, false, canWrite)), total, q);
    });
  }

  private async adminRow(id: string) {
    const row = await prisma.supportTicket.findUnique({ where: { id }, include: ticketInclude });
    if (!row) throw notFound();
    return row;
  }

  async adminGet(id: string, canWrite: boolean): Promise<AdminTicketDto> {
    return sys(async () => {
      const row = await this.adminRow(id);
      return this.presentAdmin(row, await this.adminFacts([row]), true, canWrite);
    });
  }

  async adminCreate(input: AdminCreateTicketInput, actor: PlatformActor) {
    const id = await sys(async () => {
      const m = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } } });
      if (!m) throw validationError({ userId: 'validation.invalid' });
      const now = new Date();
      const slaHours = slaHoursOf(await this.planSlug(prisma, input.workspaceId));
      return sysTx(async (tx) => {
        const created = await tx.supportTicket.create({
          data: { number: await this.nextNumber(tx), workspaceId: input.workspaceId, userId: input.userId, category: input.category, priority: input.priority, channel: input.channel, subject: input.subject, slaHours, slaDueAt: ticketSlaDueAt(now, slaHours), assigneeId: actor.userId },
        });
        if (input.message) await tx.supportMessage.create({ data: { ticketId: created.id, authorKind: 'user', authorId: input.userId, body: input.message, at: now } });
        await this.emit(tx, created, now);
        return created.id;
      });
    });
    await auditAdmin(this.audit, actor, { action: 'support.ticket_create', entity: 'SupportTicket', entityId: id, workspaceId: input.workspaceId, after: { category: input.category, channel: input.channel } });
    return this.adminGet(id, true);
  }

  /**
   * Support answer. A public answer sets `firstResponseAt` once, notifies the author (`support.reply`) and moves the ticket
   * to `pending_customer` (AT-HELP-03) unless `waitCustomer: false`; internal notes change nothing for the merchant.
   */
  async adminMessage(id: string, input: AdminTicketMessageInput, actor: PlatformActor) {
    const ticket = await sys(async () => {
      const row = await this.adminRow(id);
      if (row.status === 'closed') throw new AppException('TICKET_CLOSED');
      if (input.cannedReplyKey && !(await prisma.cannedReply.findUnique({ where: { key: input.cannedReplyKey } }))) throw validationError({ cannedReplyKey: 'validation.invalid' });
      const atts = await this.attachments(prisma, input.attachments, { userId: actor.userId });
      const now = new Date();
      return sysTx(async (tx) => {
        const msg = await tx.supportMessage.create({ data: { ticketId: id, authorKind: 'support', authorId: actor.userId, body: input.body, isInternal: input.isInternal, cannedReplyKey: input.cannedReplyKey ?? null, attachments: atts as unknown as Prisma.InputJsonValue, at: now } });
        if (input.isInternal) return row;
        const status: TicketStatus = input.waitCustomer === false ? row.status : 'pending_customer';
        const updated = await tx.supportTicket.update({ where: { id }, data: { status, firstResponseAt: row.firstResponseAt ?? now, ...(row.assigneeId ? {} : { assigneeId: actor.userId }) } });
        await this.notifyReply(tx, updated, msg.id);
        await this.emit(tx, updated, now);
        return updated;
      });
    });
    await auditAdmin(this.audit, actor, { action: input.isInternal ? 'support.note' : 'support.reply', entity: 'SupportTicket', entityId: id, workspaceId: ticket.workspaceId, after: { isInternal: input.isInternal, cannedReplyKey: input.cannedReplyKey ?? null } });
    return this.adminGet(id, true);
  }

  private async transition(id: string, actor: PlatformActor, action: string, apply: (row: TicketRow, now: Date) => Prisma.SupportTicketUpdateInput | null, o: { notify?: boolean; reason?: string | null } = {}) {
    const ticket = await sys(async () => {
      const row = await this.adminRow(id);
      const now = new Date();
      const data = apply(row, now);
      if (!data) return row;
      return sysTx(async (tx) => {
        const updated = await tx.supportTicket.update({ where: { id }, data });
        if (o.notify && updated.status !== row.status) await this.notifyReply(tx, updated, `${updated.status}:${now.getTime()}`);
        await this.emit(tx, updated, now);
        return updated;
      });
    });
    await auditAdmin(this.audit, actor, { action: `support.${action}`, entity: 'SupportTicket', entityId: id, workspaceId: ticket.workspaceId, after: { status: ticket.status, assigneeId: ticket.assigneeId, incidentId: ticket.incidentId }, reason: o.reason ?? null });
    return this.adminGet(id, true);
  }

  async assign(id: string, assigneeId: string | null, actor: PlatformActor) {
    if (assigneeId) {
      const u = await sys(() => prisma.user.findFirst({ where: { id: assigneeId, platformRole: { in: ['super_admin', 'support'] }, deletedAt: null } }));
      if (!u) throw validationError({ assigneeId: 'validation.invalid' });
    }
    return this.transition(id, actor, 'assign', (row) => {
      if (row.status === 'closed') throw new AppException('TICKET_CLOSED');
      return { assignee: assigneeId ? { connect: { id: assigneeId } } : { disconnect: true } };
    });
  }

  async resolve(id: string, note: string | undefined, actor: PlatformActor) {
    return this.transition(
      id,
      actor,
      'resolve',
      (row, now) => {
        if (row.status !== 'open' && row.status !== 'pending_customer') throw new AppException('CONFLICT', {}, {}, { status: row.status });
        return { status: 'resolved', resolvedAt: now, firstResponseAt: row.firstResponseAt ?? now };
      },
      { notify: true, reason: note ?? null },
    );
  }

  async reopen(id: string, actor: PlatformActor) {
    return this.transition(id, actor, 'reopen', (row, now) => {
      if (row.status !== 'resolved' && row.status !== 'closed') throw new AppException('CONFLICT', {}, {}, { status: row.status });
      return { status: 'open', resolvedAt: null, closedAt: null, slaDueAt: ticketSlaDueAt(now, row.slaHours) };
    });
  }

  async waitCustomer(id: string, actor: PlatformActor) {
    return this.transition(
      id,
      actor,
      'wait_customer',
      (row, now) => {
        if (row.status !== 'open') throw new AppException('CONFLICT', {}, {}, { status: row.status });
        return { status: 'pending_customer', firstResponseAt: row.firstResponseAt ?? now };
      },
      { notify: true },
    );
  }

  async escalate(id: string, note: string, actor: PlatformActor) {
    return this.transition(
      id,
      actor,
      'escalate',
      (row, now) => {
        if (row.status === 'closed') throw new AppException('TICKET_CLOSED');
        return { escalatedAt: now, escalationNote: note, priority: row.priority === 'low' || row.priority === 'normal' ? 'high' : row.priority };
      },
      { reason: note },
    );
  }

  async linkIncident(id: string, incidentId: string | null, actor: PlatformActor) {
    if (incidentId && !(await sys(() => prisma.incident.findUnique({ where: { id: incidentId } })))) throw validationError({ incidentId: 'validation.invalid' });
    return this.transition(id, actor, 'link_incident', (row) => {
      if (row.status === 'closed') throw new AppException('TICKET_CLOSED');
      return { incident: incidentId ? { connect: { id: incidentId } } : { disconnect: true } };
    });
  }

  async stats(period: string, actor: PlatformActor): Promise<SupportStatsDto> {
    return sys(async () => {
      const r = periodRange({ period: period as PeriodKey });
      const from = r.gte ?? new Date(0);
      const to = r.lt ?? new Date();
      const now = new Date();
      const [open, overSla, mine, pendingCustomer, resolved, all, firstResp, satisfaction, top, solved] = await Promise.all([
        prisma.supportTicket.count({ where: { status: 'open' } }),
        prisma.supportTicket.count({ where: { status: 'open', slaDueAt: { lt: now } } }),
        prisma.supportTicket.count({ where: { assigneeId: actor.userId, status: { in: ['open', 'pending_customer'] } } }),
        prisma.supportTicket.count({ where: { status: 'pending_customer' } }),
        prisma.supportTicket.count({ where: { status: 'resolved' } }),
        prisma.supportTicket.count(),
        prisma.$queryRaw<{ median: number | null }[]>`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 60)::float AS median FROM "SupportTicket" WHERE "firstResponseAt" IS NOT NULL AND "createdAt" >= ${from} AND "createdAt" < ${to}`,
        prisma.supportTicket.aggregate({ where: { satisfaction: { not: null }, createdAt: { gte: from, lt: to } }, _avg: { satisfaction: true } }),
        prisma.supportTicket.groupBy({ by: ['category'], where: { createdAt: { gte: from, lt: to } }, _count: { _all: true } }),
        prisma.$queryRaw<{ total: bigint; first: bigint }[]>`
          SELECT count(*) AS total, count(*) FILTER (WHERE (SELECT count(*) FROM "SupportMessage" m WHERE m."ticketId" = t."id" AND m."authorKind" = 'support' AND m."isInternal" = false) = 1) AS first
          FROM "SupportTicket" t WHERE t."resolvedAt" IS NOT NULL AND t."createdAt" >= ${from} AND t."createdAt" < ${to}`,
      ]);
      const total = Number(solved[0]?.total ?? 0);
      return {
        open,
        overSla,
        medianFirstResponseMin: firstResp[0]?.median === null || firstResp[0]?.median === undefined ? null : Math.round(firstResp[0].median),
        solvedFirstExchangePct: total ? Math.round((Number(solved[0]!.first) / total) * 100) : 0,
        satisfactionAvg: satisfaction._avg.satisfaction === null ? null : Math.round(satisfaction._avg.satisfaction * 10) / 10,
        topCategories: top.map((g) => ({ category: g.category, count: g._count._all })).sort((a, b) => b.count - a.count).slice(0, 5),
        tabs: { open, mine, pendingCustomer, resolved, all },
      };
    });
  }

  // --- canned replies ----------------------------------------------------------------------------------------------------
  private presentCanned(c: Prisma.CannedReplyGetPayload<{ include: { createdBy: typeof userRefSelect } }>): CannedReplyDto {
    return { id: c.id, key: c.key, title: c.title, body: c.body as CannedReplyDto['body'], category: c.category, createdBy: toUserRef(c.createdBy)!, updatedAt: c.updatedAt.toISOString() };
  }
  async cannedList() {
    return sys(async () => (await prisma.cannedReply.findMany({ include: { createdBy: userRefSelect }, orderBy: [{ key: 'asc' }] })).map((c) => this.presentCanned(c)));
  }
  async cannedCreate(input: CannedReplyInput, actor: PlatformActor) {
    const c = await sys(async () => {
      if (await prisma.cannedReply.findUnique({ where: { key: input.key } })) throw new AppException('CONFLICT', {}, { key: 'validation.taken' });
      return prisma.cannedReply.create({ data: { key: input.key, title: input.title, body: input.body, category: input.category ?? null, createdById: actor.userId }, include: { createdBy: userRefSelect } });
    });
    await auditAdmin(this.audit, actor, { action: 'support.canned_create', entity: 'CannedReply', entityId: c.id, after: { key: c.key } });
    return this.presentCanned(c);
  }
  async cannedUpdate(id: string, input: Partial<Omit<CannedReplyInput, 'key'>>, actor: PlatformActor) {
    const c = await sys(async () => {
      if (!(await prisma.cannedReply.findUnique({ where: { id } }))) throw notFound();
      return prisma.cannedReply.update({ where: { id }, data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.body !== undefined ? { body: input.body } : {}), ...(input.category !== undefined ? { category: input.category } : {}) }, include: { createdBy: userRefSelect } });
    });
    await auditAdmin(this.audit, actor, { action: 'support.canned_update', entity: 'CannedReply', entityId: id, after: { key: c.key } });
    return this.presentCanned(c);
  }
  async cannedDelete(id: string, actor: PlatformActor) {
    const c = await sys(async () => {
      const row = await prisma.cannedReply.findUnique({ where: { id } });
      if (!row) throw notFound();
      await prisma.cannedReply.delete({ where: { id } });
      return row;
    });
    await auditAdmin(this.audit, actor, { action: 'support.canned_delete', entity: 'CannedReply', entityId: id, before: { key: c.key } });
    return { id };
  }

  // --- jobs --------------------------------------------------------------------------------------------------------------
  /** `sched-support-close`: resolved tickets closed 30 days after `resolvedAt` (idempotent). */
  async autoClose(now = new Date()) {
    return sys(async () => {
      const limit = new Date(now.getTime() - TICKET_AUTO_CLOSE_DAYS * 86400_000);
      const rows = await prisma.supportTicket.findMany({ where: { status: 'resolved', resolvedAt: { lte: limit } }, select: { id: true, workspaceId: true } });
      if (!rows.length) return { closed: 0 };
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await tx.supportTicket.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: 'resolved' }, data: { status: 'closed', closedAt: now } });
        for (const r of rows.slice(0, 200)) if (r.workspaceId) await this.outbox.ws(tx, `ws:${r.workspaceId}`, 'ticket.updated', { id: r.id, status: 'closed', lastMessageAt: now.toISOString() });
      });
      return { closed: rows.length };
    });
  }

  /** Step of `sched-moderation-sla`: admin counters + one `platform.alert sla_breach` per newly breached 15-min slot. */
  async slaSweep(now = new Date()) {
    return sys(async () => {
      const breached = await prisma.supportTicket.count({ where: { status: 'open', slaDueAt: { lt: now, gte: new Date(now.getTime() - 15 * 60_000) } } });
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        if (breached) {
          await this.outbox.ws(tx, 'admin:platform', 'platform.alert', { kind: 'sla_breach', payload: { area: 'support', count: breached } }, `platform.alert:sla:support:${now.toISOString().slice(0, 16)}`);
          await this.admins.notify(tx, { kind: 'alert_sla', key: `alert_sla:support:${now.toISOString().slice(0, 16)}`, params: { area: 'support', count: breached }, area: 'admin.support.write' });
        }
        await this.emitQueue(tx);
      });
      return { breached };
    });
  }
}
