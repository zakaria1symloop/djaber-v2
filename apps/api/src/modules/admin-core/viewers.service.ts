// ADM-17 read-only viewers (conversations, products — PII masked, every open audited `viewer.open`, unmask super_admin
// only `viewer.unmask`) and D21-bis read-only impersonation sessions (30 min, super_admin + support).
import { Injectable } from '@nestjs/common';
import {
  IMPERSONATION_MINUTES,
  type AdminImpersonateInput,
  type AdminViewerConversationDto,
  type AdminViewerConversationRowDto,
  type AdminViewerMessageDto,
  type AdminViewerProductDto,
  type AdminViewerProductRowDto,
  type ImpersonationSessionDto,
  type ImpersonationStartDto,
} from '@djaber/shared';
import { Prisma, prisma } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { TokenService } from '../../core/auth/token.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { OutboxService } from '../../core/outbox/outbox.service';
import { DAY, assertUuid, iso, maskName, maskPhone, maskText, requireReason, userRef, userSelect, type AdminActor } from './admin.util';

@Injectable()
export class AdminViewersService {
  constructor(
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly outbox: OutboxService,
  ) {}

  private async log(actor: AdminActor, workspaceId: string | null, action: string, entity: string, entityId: string | null, after: unknown, reason: string | null, impersonationSessionId: string | null = null) {
    await this.audit.write({ workspaceId, actorType: 'admin', actorId: actor.userId, actorRole: actor.platformRole, action, entity, entityId, after, reason, ip: actor.ip, userAgent: actor.userAgent, impersonationSessionId });
  }

  // --- conversations -------------------------------------------------------------------------------------------------------
  private convRow(c: Prisma.ConversationGetPayload<{ include: { workspace: { select: { id: true; name: true } }; channel: { select: { id: true; name: true; platform: true } }; client: { select: { name: true; phone: true } } } }>, unmasked: boolean): AdminViewerConversationRowDto {
    return {
      id: c.id,
      workspace: c.workspace,
      channel: c.channel,
      customer: { name: unmasked ? c.client?.name ?? '—' : maskName(c.client?.name), phone: unmasked ? c.client?.phone ?? null : maskPhone(c.client?.phone) },
      status: c.status,
      lastMessageAt: iso(c.lastMessageAt),
      lastMessagePreview: unmasked ? c.lastMessagePreview : maskText(c.lastMessagePreview),
    };
  }
  private readonly convInclude = { workspace: { select: { id: true, name: true } }, channel: { select: { id: true, name: true, platform: true } }, client: { select: { name: true, phone: true } } } as const;

  async conversations(q: { page: number; pageSize: number; workspaceId: string; q?: string }): Promise<Page<AdminViewerConversationRowDto>> {
    const where: Prisma.ConversationWhereInput = { workspaceId: q.workspaceId, deletedAt: null, ...(q.q ? { OR: [{ lastMessagePreview: { contains: q.q, mode: 'insensitive' } }, { client: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}) };
    const [total, rows] = await Promise.all([prisma.conversation.count({ where }), prisma.conversation.findMany({ where, include: this.convInclude, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }], ...toSkipTake(q) })]);
    return page(rows.map((c) => this.convRow(c, false)), total, q);
  }

  private async conversationDto(id: string, unmasked: boolean): Promise<AdminViewerConversationDto & { workspaceId: string }> {
    assertUuid(id);
    const c = await prisma.conversation.findFirst({ where: { id, deletedAt: null }, include: { ...this.convInclude, agent: { select: { id: true, name: true } } } });
    if (!c) throw notFound();
    const msgs = await prisma.message.findMany({ where: { conversationId: id }, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 200, include: { authorUser: { select: { firstName: true, lastName: true } } } });
    const messages: AdminViewerMessageDto[] = msgs.reverse().map((m) => {
      const author = m.author;
      const atts = Array.isArray(m.attachments) ? (m.attachments as { type?: string; url?: string }[]) : [];
      return {
        id: m.id,
        at: m.sentAt.toISOString(),
        direction: m.direction,
        author,
        authorLabel: author === 'customer' ? (unmasked ? c.client?.name ?? 'Client' : maskName(c.client?.name)) : author === 'ai' ? c.agent?.name ?? 'IA' : author === 'system' ? 'Système' : m.authorUser ? `${m.authorUser.firstName} ${m.authorUser.lastName[0] ?? ''}.` : 'Équipe',
        type: m.type,
        text: unmasked ? m.text ?? m.transcript : maskText(m.text ?? m.transcript),
        attachments: atts.map((a) => ({ type: a.type ?? 'file', url: unmasked ? a.url ?? null : null })),
      };
    });
    return { ...this.convRow(c, unmasked), agent: c.agent, masked: !unmasked, messages, workspaceId: c.workspaceId };
  }

  /** `GET /admin/conversations/:id?reason=` — audited `viewer.open` with the reason. */
  async openConversation(id: string, reasonIn: string, actor: AdminActor): Promise<AdminViewerConversationDto> {
    const reason = requireReason(reasonIn);
    const { workspaceId, ...dto } = await this.conversationDto(id, false);
    await this.log(actor, workspaceId, 'viewer.open', 'Conversation', id, { masked: true }, reason);
    return dto;
  }

  /** `POST /admin/conversations/:id/unmask { reason }` (super_admin) — audited `viewer.unmask`. */
  async unmaskConversation(id: string, reasonIn: string, actor: AdminActor): Promise<AdminViewerConversationDto> {
    const reason = requireReason(reasonIn);
    const { workspaceId, ...dto } = await this.conversationDto(id, true);
    await this.log(actor, workspaceId, 'viewer.unmask', 'Conversation', id, { masked: false }, reason);
    return dto;
  }

  // --- products ------------------------------------------------------------------------------------------------------------
  private productRow(p: Prisma.ProductGetPayload<{ include: { workspace: { select: { id: true; name: true } }; images: true } }>): AdminViewerProductRowDto {
    const img = p.images.find((i) => i.isPrimary) ?? p.images[0];
    const aiStatus = !p.isActive || p.moderationStatus === 'rejected' ? 'excluded' : p.moderationStatus === 'pending' && p.approvedSnapshot ? 'stale' : 'proposed';
    return { id: p.id, name: p.name, sku: p.sku, price: p.price, stock: p.stock ?? 0, status: p.deletedAt ? 'archived' : p.isActive ? 'active' : 'inactive', moderationStatus: p.moderationStatus, aiStatus, imageUrl: img?.url ?? null, workspace: p.workspace };
  }

  async products(q: { page: number; pageSize: number; workspaceId: string; moderationStatus?: string[]; q?: string }): Promise<Page<AdminViewerProductRowDto>> {
    const where: Prisma.ProductWhereInput = { workspaceId: q.workspaceId, deletedAt: null, ...(q.moderationStatus?.length ? { moderationStatus: { in: q.moderationStatus as never } } : {}), ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { sku: { contains: q.q, mode: 'insensitive' } }] } : {}) };
    const [total, rows] = await Promise.all([prisma.product.count({ where }), prisma.product.findMany({ where, include: { workspace: { select: { id: true, name: true } }, images: { orderBy: { sortOrder: 'asc' } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) })]);
    return page(rows.map((p) => this.productRow(p)), total, q);
  }

  /** `GET /admin/products/:id` — audited `viewer.open` (reason optional for products). */
  async openProduct(id: string, reason: string | undefined, actor: AdminActor): Promise<AdminViewerProductDto> {
    assertUuid(id);
    const p = await prisma.product.findFirst({ where: { id }, include: { workspace: { select: { id: true, name: true } }, images: { orderBy: { sortOrder: 'asc' } }, category: { select: { name: true } }, variants: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }, moderationItems: { orderBy: { submittedAt: 'desc' }, take: 20 } } });
    if (!p) throw notFound();
    await this.log(actor, p.workspaceId, 'viewer.open', 'Product', id, { masked: true }, reason?.trim() || null);
    return {
      ...this.productRow(p),
      description: p.description,
      category: p.category?.name ?? null,
      images: p.images.map((i) => ({ url: i.url, flag: i.moderationFlag })),
      variants: p.variants.map((v) => ({ id: v.id, name: v.name, sku: v.sku, price: v.price, stock: v.stock })),
      moderationHistory: p.moderationItems.map((m) => ({ at: (m.decidedAt ?? m.submittedAt).toISOString(), status: m.status, decision: m.decision, note: m.merchantMessage })),
    };
  }

  // --- impersonation (D21-bis) ---------------------------------------------------------------------------------------------
  private sessionDto(s: Prisma.ImpersonationSessionGetPayload<{ include: { admin: { select: typeof userSelect }; workspace: { select: { id: true; name: true } } } }>): ImpersonationSessionDto {
    return { id: s.id, admin: userRef(s.admin)!, workspace: s.workspace, reason: s.reason, ticketId: s.ticketId, startedAt: s.startedAt.toISOString(), expiresAt: s.expiresAt.toISOString(), endedAt: iso(s.endedAt), actionsCount: s.actionsCount, active: !s.endedAt && s.expiresAt > new Date() };
  }

  async sessions(q: { page: number; pageSize: number; adminUserId?: string; workspaceId?: string; from?: string; to?: string; active?: boolean }): Promise<Page<ImpersonationSessionDto>> {
    const where: Prisma.ImpersonationSessionWhereInput = {
      ...(q.adminUserId ? { adminUserId: q.adminUserId } : {}),
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
      ...(q.from || q.to ? { startedAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+01:00`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00+01:00`).getTime() + DAY) } : {}) } } : {}),
      ...(q.active === true ? { endedAt: null, expiresAt: { gt: new Date() } } : q.active === false ? { OR: [{ endedAt: { not: null } }, { expiresAt: { lte: new Date() } }] } : {}),
    };
    const include = { admin: { select: userSelect }, workspace: { select: { id: true, name: true } } } as const;
    const [total, rows] = await Promise.all([prisma.impersonationSession.count({ where }), prisma.impersonationSession.findMany({ where, include, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) })]);
    return page(rows.map((s) => this.sessionDto(s)), total, q);
  }

  /**
   * PFS-07 / 04 §15 `impersonationMinutes` of the platform setting `limits` (5–240, default 30). Tester report 22/10 UX-023:
   * the session and its token used the fixed default whatever the setting said.
   */
  private async minutes(): Promise<number> {
    const row = await prisma.platformSetting.findUnique({ where: { key: 'limits' } });
    const m = (row?.value as { impersonationMinutes?: unknown } | null)?.impersonationMinutes;
    return typeof m === 'number' && Number.isInteger(m) && m >= 5 && m <= 240 ? m : IMPERSONATION_MINUTES;
  }

  /** `POST /admin/impersonation/sessions` → `{ sessionId, token, expiresAt }` (read-only, `impersonationMinutes`; no e-mail to the Owner). */
  async start(input: AdminImpersonateInput, actor: AdminActor): Promise<ImpersonationStartDto> {
    const reason = requireReason(input.reason);
    const ws = await prisma.workspace.findFirst({ where: { id: input.workspaceId, deletedAt: null }, select: { id: true, name: true } });
    if (!ws) throw notFound();
    if (input.ticketId && !(await prisma.supportTicket.findUnique({ where: { id: input.ticketId }, select: { id: true } }))) throw new AppException('VALIDATION_ERROR', {}, { ticketId: 'validation.id' });
    const startedAt = new Date();
    const minutes = await this.minutes();
    const expiresAt = new Date(startedAt.getTime() + minutes * 60_000);
    // one open session per admin: a new one ends the previous
    await prisma.impersonationSession.updateMany({ where: { adminUserId: actor.userId, endedAt: null, expiresAt: { gt: startedAt } }, data: { endedAt: startedAt } });
    const s = await prisma.$transaction(async (db) => {
      const row = await db.impersonationSession.create({ data: { adminUserId: actor.userId, workspaceId: ws.id, reason, ticketId: input.ticketId ?? null, startedAt, expiresAt } });
      await this.outbox.ws(db as never, 'admin:platform', 'impersonation.started', { sessionId: row.id }, `impersonation.started:${row.id}`);
      await this.outbox.ws(db as never, `ws:${ws.id}`, 'impersonation.started', { sessionId: row.id }, `impersonation.started:ws:${row.id}`);
      return row;
    });
    const { token } = await this.tokens.signAccess({ sub: actor.userId, wid: ws.id, role: 'admin', pr: actor.platformRole, imp: s.id }, minutes * 60);
    await this.log(actor, ws.id, 'impersonation.start', 'ImpersonationSession', s.id, { expiresAt: expiresAt.toISOString(), ticketId: input.ticketId ?? null, readOnly: true }, reason, s.id);
    return { sessionId: s.id, token, expiresAt: expiresAt.toISOString(), workspace: ws };
  }

  /** `DELETE /admin/impersonation/sessions/:id` — ends the session (own sessions; super_admin may end any). */
  async stop(id: string, actor: AdminActor): Promise<ImpersonationSessionDto> {
    assertUuid(id);
    const s = await prisma.impersonationSession.findUnique({ where: { id } });
    if (!s || (s.adminUserId !== actor.userId && actor.platformRole !== 'super_admin')) throw notFound();
    const now = new Date();
    const endedAt = s.endedAt ?? (s.expiresAt < now ? s.expiresAt : now);
    const row = await prisma.$transaction(async (db) => {
      const r = await db.impersonationSession.update({ where: { id }, data: { endedAt }, include: { admin: { select: userSelect }, workspace: { select: { id: true, name: true } } } });
      await this.outbox.ws(db as never, 'admin:platform', 'impersonation.ended', { sessionId: id }, `impersonation.ended:${id}`);
      await this.outbox.ws(db as never, `ws:${s.workspaceId}`, 'impersonation.ended', { sessionId: id }, `impersonation.ended:ws:${id}`);
      return r;
    });
    if (!s.endedAt) await this.log(actor, s.workspaceId, 'impersonation.stop', 'ImpersonationSession', id, { durationSec: Math.round((endedAt.getTime() - s.startedAt.getTime()) / 1000), actionsCount: s.actionsCount }, null, id);
    return this.sessionDto(row);
  }
}
