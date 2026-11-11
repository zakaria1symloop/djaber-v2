// ADM-10 — moderation queue, decisions, appeals, rules, stats (03 §23 MOD-06…10, 04 §12, D36; 06 §8.11).
// Decisions run across workspaces (platform route); each product write is scoped to its workspace by `workspaceId` filters.
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { prisma, Prisma, TenantContext, type ModerationItem, type Tx } from '@djaber/db';
import {
  MODERATION_SAMPLE_PCT,
  type AdminModerationQuery,
  type ModerationAppealDto,
  type ModerationBulkInput,
  type ModerationDecisionInput,
  type ModerationItemDetailDto,
  type ModerationItemDto,
  type ModerationRuleDto,
  type ModerationRuleInput,
  type ModerationStatsDto,
} from '@djaber/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { AppException, notFound, validationError } from '../../../core/errors/app.exception';
import { runBulk, type BulkCtx } from '../../../core/http/bulk';
import { page, toSkipTake, type Page } from '../../../core/http/pagination';
import { I18nService } from '../../../core/i18n/i18n.service';
import { OutboxService } from '../../../core/outbox/outbox.service';
import { periodRange, type PeriodKey } from '../../../core/time/period';
import { ModerationHookService } from '../../catalog/moderation-hook.service';
import { NotificationProducer } from '../../notifications/notification.producer';
import { auditAdmin, iso, sys, sysTx, toUserRef, userRefSelect, type PlatformActor } from '../admin-ops.util';
import { TrustLevelService } from './trust-level.service';
import { AdminNotifier } from '../../notifications/admin-notifier.service';

export type DecisionKind = 'approve' | 'reject' | 'request_changes';
const OPEN: ModerationItem['status'][] = ['pending'];

const include = {
  workspace: { select: { id: true, name: true, trustLevel: true } },
  product: { select: { id: true, name: true, price: true, description: true, category: { select: { name: true } }, images: { orderBy: { sortOrder: 'asc' }, select: { url: true, moderationFlag: true } }, _count: { select: { variants: { where: { deletedAt: null } } } }, approvedSnapshot: true } },
  agent: { select: { id: true, name: true, customInstructions: true } },
  category: { select: { id: true, name: true } },
  assignee: userRefSelect,
  reviewer: userRefSelect,
  appeal: { include: { attachment: { select: { url: true, mime: true } } } },
} as const satisfies Prisma.ModerationItemInclude;
type Row = Prisma.ModerationItemGetPayload<{ include: typeof include }>;

/** 5 % deterministic sample of the auto-approved items (04 §12 "Auto-approuvés (échantillon)"). */
export const isSampled = (id: string) => createHash('sha256').update(`sample:${id}`).digest().readUInt16BE(0) % 100 < MODERATION_SAMPLE_PCT;

@Injectable()
export class ModerationService {
  constructor(
    private readonly hook: ModerationHookService,
    private readonly trust: TrustLevelService,
    private readonly notifications: NotificationProducer,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly i18n: I18nService,
    private readonly admins: AdminNotifier,
  ) {}

  // --- presentation ------------------------------------------------------------------------------------------------------
  private async workspaceFacts(ids: string[]) {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return new Map<string, { plan: string; priorRejections: number; approvedProducts: number }>();
    const [subs, rejected, approved] = await Promise.all([
      prisma.subscription.findMany({ where: { workspaceId: { in: uniq }, status: { in: ['trial', 'active', 'dunning'] } }, include: { plan: { select: { slug: true } } }, orderBy: { createdAt: 'desc' } }),
      prisma.moderationItem.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: uniq }, status: { in: ['rejected', 'appeal_rejected'] } }, _count: { _all: true } }),
      prisma.product.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: uniq }, moderationStatus: 'approved', deletedAt: null }, _count: { _all: true } }),
    ]);
    const out = new Map<string, { plan: string; priorRejections: number; approvedProducts: number }>();
    for (const id of uniq) {
      out.set(id, {
        plan: subs.find((s) => s.workspaceId === id)?.plan.slug ?? 'free',
        priorRejections: rejected.find((r) => r.workspaceId === id)?._count._all ?? 0,
        approvedProducts: approved.find((r) => r.workspaceId === id)?._count._all ?? 0,
      });
    }
    return out;
  }

  private actions(r: Pick<ModerationItem, 'status'>, canWrite: boolean): ModerationItemDto['actions'] {
    const open = r.status === 'pending';
    const reason = !canWrite ? 'FORBIDDEN' : open ? undefined : 'MODERATION_ITEM_ALREADY_DECIDED';
    return [
      { key: 'approve', enabled: canWrite && open, primary: true, shortcut: 'A', ...(reason ? { reasonCode: reason } : {}) },
      { key: 'reject', enabled: canWrite && open, shortcut: 'R', ...(reason ? { reasonCode: reason } : {}) },
      { key: 'request_changes', enabled: canWrite && open, shortcut: 'C', ...(reason ? { reasonCode: reason } : {}) },
      { key: 'assign', enabled: canWrite && open, ...(reason ? { reasonCode: reason } : {}) },
    ];
  }

  private present(r: Row, facts: Map<string, { plan: string; priorRejections: number; approvedProducts: number }>, canWrite: boolean): ModerationItemDto {
    const f = facts.get(r.workspaceId) ?? { plan: 'free', priorRejections: 0, approvedProducts: 0 };
    const snap = (r.snapshot ?? {}) as Record<string, unknown>;
    const now = Date.now();
    const end = r.decidedAt?.getTime() ?? now;
    return {
      id: r.id,
      type: r.type,
      workspace: { id: r.workspace.id, name: r.workspace.name, trustLevel: r.workspace.trustLevel, plan: f.plan, priorRejections: f.priorRejections, approvedProducts: f.approvedProducts },
      product: r.product
        ? {
            id: r.product.id,
            name: typeof snap.title === 'string' ? snap.title : r.product.name,
            price: typeof snap.price === 'number' ? snap.price : r.product.price,
            marketReference: typeof snap.marketReference === 'number' ? snap.marketReference : null,
            category: r.product.category?.name ?? null,
            variants: r.product._count.variants,
            images: r.product.images.map((i) => ({ url: i.url, flag: i.moderationFlag })),
            description: typeof snap.description === 'string' ? snap.description : r.product.description,
          }
        : null,
      agent: r.agent
        ? r.type === 'agent_name'
          ? // owner request 11/11: the names to approve, and the ones customers read today
            { id: r.agent.id, name: typeof snap.name === 'string' ? snap.name : r.agent.name, excerpt: '', displayName: typeof snap.displayName === 'string' ? snap.displayName : null, approvedName: typeof snap.approvedName === 'string' ? snap.approvedName : null, approvedDisplayName: typeof snap.approvedDisplayName === 'string' ? snap.approvedDisplayName : null }
          : { id: r.agent.id, name: r.agent.name, excerpt: (typeof snap.excerpt === 'string' ? snap.excerpt : r.agent.customInstructions).slice(0, 400) }
        : null,
      category: r.category ? { id: r.category.id, name: r.category.name } : null,
      aiScore: r.aiScore === null ? null : Number(r.aiScore),
      aiFlags: Array.isArray(r.aiFlags) ? (r.aiFlags as ModerationItemDto['aiFlags']) : [],
      priority: r.priority,
      waitingMinutes: Math.max(0, Math.round((end - r.submittedAt.getTime()) / 60_000)),
      slaDueAt: r.slaDueAt.toISOString(),
      slaBreached: r.status === 'pending' && r.slaDueAt.getTime() < now,
      status: r.status,
      assignee: toUserRef(r.assignee),
      reviewer: toUserRef(r.reviewer),
      decision: r.decision,
      reasonTemplateKey: r.reasonTemplateKey,
      merchantMessage: r.merchantMessage,
      rejectedFields: r.rejectedFields,
      submittedAt: r.submittedAt.toISOString(),
      decidedAt: iso(r.decidedAt),
      source: r.source,
      sampled: r.status === 'auto_approved' && isSampled(r.id),
      appeal: r.appeal
        ? { id: r.appeal.id, message: r.appeal.message, attachmentUrl: r.appeal.attachment?.url ?? null, attachmentMime: r.appeal.attachment?.mime ?? null, submittedAt: r.appeal.submittedAt.toISOString(), deadlineAt: r.appeal.deadlineAt.toISOString(), decision: r.appeal.decision, decidedAt: iso(r.appeal.decidedAt) }
        : null,
      actions: this.actions(r, canWrite),
    };
  }

  // --- queue ---------------------------------------------------------------------------------------------------------------
  private where(q: AdminModerationQuery, actor: PlatformActor): Prisma.ModerationItemWhereInput {
    const and: Prisma.ModerationItemWhereInput[] = [];
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.priority) and.push({ priority: 'urgent' });
    if (q.type?.length) and.push({ type: { in: q.type } });
    if (q.aiFlag?.length) and.push({ OR: q.aiFlag.map((code) => ({ aiFlags: { array_contains: [{ code }] } })) });
    if (q.scoreMin !== undefined) and.push({ aiScore: { gte: q.scoreMin } });
    if (q.scoreMax !== undefined) and.push({ aiScore: { lte: q.scoreMax } });
    if (q.trustLevel?.length) and.push({ workspace: { trustLevel: { in: q.trustLevel } } });
    if (q.categoryId) and.push({ product: { categoryId: q.categoryId } });
    if (q.workspaceId) and.push({ workspaceId: q.workspaceId });
    if (q.waitingOver !== undefined) and.push({ submittedAt: { lte: new Date(Date.now() - q.waitingOver * 60_000) } });
    if (q.assigneeId === 'me') and.push({ assigneeId: actor.userId });
    else if (q.assigneeId === 'none') and.push({ assigneeId: null });
    else if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    if (q.q) and.push({ OR: [{ product: { name: { contains: q.q, mode: 'insensitive' } } }, { workspace: { name: { contains: q.q, mode: 'insensitive' } } }, { agent: { name: { contains: q.q, mode: 'insensitive' } } }] });
    return and.length ? { AND: and } : {};
  }

  async list(q: AdminModerationQuery, actor: PlatformActor, canWrite: boolean): Promise<Page<ModerationItemDto>> {
    return sys(async () => {
      const where = this.where(q, actor);
      const orderBy: Prisma.ModerationItemOrderByWithRelationInput[] =
        q.sort === 'submittedAt' ? [{ submittedAt: 'asc' }, { id: 'asc' }] : q.sort === '-submittedAt' ? [{ submittedAt: 'desc' }, { id: 'desc' }] : [{ priority: 'desc' }, { slaDueAt: 'asc' }, { submittedAt: 'asc' }, { id: 'asc' }];
      const [rows, total] = await Promise.all([prisma.moderationItem.findMany({ where, include, orderBy, ...toSkipTake(q) }), prisma.moderationItem.count({ where })]);
      const facts = await this.workspaceFacts(rows.map((r) => r.workspaceId));
      return page(rows.map((r) => this.present(r, facts, canWrite)), total, q);
    });
  }

  private async row(id: string) {
    const r = await prisma.moderationItem.findUnique({ where: { id }, include });
    if (!r) throw notFound();
    return r;
  }

  async get(id: string, canWrite: boolean): Promise<ModerationItemDetailDto> {
    return sys(async () => {
      const r = await this.row(id);
      const facts = await this.workspaceFacts([r.workspaceId]);
      const history = r.productId
        ? await prisma.moderationItem.findMany({ where: { productId: r.productId, id: { not: r.id } }, orderBy: { submittedAt: 'desc' }, take: 20, include: { reviewer: userRefSelect } })
        : [];
      return {
        ...this.present(r, facts, canWrite),
        snapshot: (r.snapshot ?? {}) as Record<string, unknown>,
        approvedSnapshot: (r.product?.approvedSnapshot ?? null) as Record<string, unknown> | null,
        history: history.map((h) => ({ id: h.id, status: h.status, decision: h.decision, submittedAt: h.submittedAt.toISOString(), decidedAt: iso(h.decidedAt), reviewer: toUserRef(h.reviewer) })),
      };
    });
  }

  // --- decisions -----------------------------------------------------------------------------------------------------------
  private validate(kind: DecisionKind, input: ModerationDecisionInput) {
    if (kind === 'reject' && (!input.decision || !input.merchantMessage?.trim())) throw new AppException('MODERATION_REASON_REQUIRED', {}, { ...(!input.decision ? { decision: 'validation.required' } : {}), ...(!input.merchantMessage?.trim() ? { merchantMessage: 'validation.required' } : {}) });
    if (kind === 'request_changes' && !input.merchantMessage?.trim()) throw new AppException('MODERATION_REASON_REQUIRED', {}, { merchantMessage: 'validation.required' });
  }

  /** One decision inside its own transaction (row lock: a second moderator gets 409 MODERATION_ITEM_ALREADY_DECIDED). */
  private async decideOne(id: string, kind: DecisionKind, input: ModerationDecisionInput, actor: PlatformActor) {
    this.validate(kind, input);
    const item = await sysTx(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "ModerationItem" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const it = await tx.moderationItem.findUnique({ where: { id } });
      if (!it) throw notFound();
      if (!OPEN.includes(it.status)) throw new AppException('MODERATION_ITEM_ALREADY_DECIDED');
      const status = kind === 'approve' ? 'approved' : kind === 'reject' ? 'rejected' : 'changes_requested';
      const updated = await tx.moderationItem.update({
        where: { id },
        data: {
          status,
          reviewerId: actor.userId,
          decidedAt: new Date(),
          decision: kind === 'reject' ? input.decision : null,
          reasonTemplateKey: input.reasonTemplateKey ?? (kind === 'reject' ? input.decision : null) ?? null,
          merchantMessage: input.merchantMessage?.trim() || null,
          rejectedFields: input.rejectedFields ?? [],
        },
      });
      await TenantContext.runAs(it.workspaceId, () => this.applyEffects(tx, updated, kind));
      await this.hook.emitQueue(tx);
      return updated;
    });
    await auditAdmin(this.audit, actor, { action: `moderation.${kind}`, entity: 'ModerationItem', entityId: id, workspaceId: item.workspaceId, after: { status: item.status, decision: item.decision, rejectedFields: item.rejectedFields }, reason: item.merchantMessage ?? kind });
    // R-L: approval may promote new → standard; a counterfeit rejection may demote to watch
    if (kind === 'approve') await this.trust.evaluatePromotion(item.workspaceId);
    if (kind === 'reject') await this.trust.evaluateWatch(item.workspaceId);
    return item;
  }

  /** Product / agent / category effects of a decision + merchant notifications (04 §12 "Merchant notifications"). */
  private async applyEffects(tx: Tx, item: ModerationItem, kind: DecisionKind) {
    const ws = item.workspaceId;
    if (item.type === 'agent_name' && item.agentId) {
      // owner request 11/11: approved ⇒ the names customers read; refused / changes asked ⇒ the AI keeps the last approved
      // names (or none) and the merchant is told why
      const snap = (item.snapshot ?? {}) as { name?: string; displayName?: string | null };
      const agent = await tx.agent.findFirst({ where: { id: item.agentId, workspaceId: ws }, select: { id: true, name: true, displayName: true } });
      if (!agent) return;
      const shown = (snap.displayName ?? '').trim() || snap.name || agent.name;
      if (kind === 'approve') {
        await tx.agent.update({ where: { id: agent.id }, data: { approvedName: snap.name ?? agent.name, approvedDisplayName: snap.displayName ?? null, nameStatus: 'approved', nameRejectReason: null } });
        await this.notifications.emit(tx, { type: 'agent_name_approved', workspaceId: ws, target: { roles: ['owner', 'admin'] }, key: `agent_name_approved:${item.id}`, data: { agentId: agent.id, name: shown } });
      } else {
        const reason = item.merchantMessage?.trim() || null;
        await tx.agent.update({ where: { id: agent.id }, data: { nameStatus: 'rejected', nameRejectReason: reason } });
        await this.notifications.emit(tx, { type: 'agent_name_rejected', workspaceId: ws, target: { roles: ['owner', 'admin'] }, key: `agent_name_rejected:${item.id}`, data: { agentId: agent.id, name: shown, reason: reason ?? '' } });
      }
      await this.outbox.ws(tx, `ws:${ws}`, 'agent.updated', { id: agent.id, agent: { id: agent.id } });
      return;
    }
    if (item.type === 'agent_prompt' && item.agentId) {
      if (kind === 'reject') {
        await tx.agent.update({ where: { id: item.agentId }, data: { status: 'paused', pausedReason: 'moderation' } });
        await this.outbox.ws(tx, `ws:${ws}`, 'agent.updated', { id: item.agentId, agent: { id: item.agentId, status: 'paused', pausedReason: 'moderation' } });
      }
      return;
    }
    if (!item.productId) return;
    const product = await tx.product.findFirst({ where: { id: item.productId, workspaceId: ws }, select: { id: true, name: true, moderationItemId: true } });
    if (!product) return;
    const current = product.moderationItemId === item.id;
    if (kind === 'approve') {
      // an older item decided after a newer submission does not override the newer content
      if (current) await this.hook.markApproved(tx, item, { notify: true });
      return;
    }
    if (kind === 'reject') {
      if (current) {
        await tx.product.update({ where: { id: product.id }, data: { moderationStatus: 'rejected' } });
        await this.hook.emitProduct(tx, ws, product.id, 'rejected');
      }
      await this.notifications.emit(tx, { type: 'product_rejected', workspaceId: ws, target: { roles: ['owner', 'admin'] }, key: `product_rejected:${item.id}`, data: { productId: product.id, name: product.name, decision: item.decision, rejectedFields: item.rejectedFields } });
      return;
    }
    // changes requested: the previous state stays (last approved snapshot keeps selling, a new product stays hidden)
    if (current) await this.hook.emitProduct(tx, ws, product.id, 'pending');
    await this.notifications.emit(tx, { type: 'product_changes_requested', workspaceId: ws, target: { roles: ['owner', 'admin'] }, key: `product_changes_requested:${item.id}`, data: { productId: product.id, name: product.name } });
  }

  async decide(id: string, kind: DecisionKind, input: ModerationDecisionInput, actor: PlatformActor, canWrite = true) {
    await this.decideOne(id, kind, input, actor);
    return this.get(id, canWrite).then(({ snapshot: _s, approvedSnapshot: _a, history: _h, ...dto }) => dto);
  }

  async bulk(kind: 'approve' | 'reject' | 'assign', input: ModerationBulkInput, actor: PlatformActor, ctx: BulkCtx) {
    if (kind === 'reject') {
      const fields: Record<string, string> = {};
      if (!input.decision) fields.decision = 'validation.required';
      if (!input.reasonTemplateKey) fields.reasonTemplateKey = 'validation.required';
      if (!input.merchantMessage?.trim()) fields.merchantMessage = 'validation.required';
      if (Object.keys(fields).length) throw validationError(fields);
    }
    if (kind === 'assign' && input.assigneeId === undefined) throw validationError({ assigneeId: 'validation.required' });
    return runBulk(
      this.i18n,
      input.ids,
      ctx,
      (id) => (kind === 'assign' ? this.assign(id, input.assigneeId ?? null, actor) : this.decideOne(id, kind, { decision: input.decision, reasonTemplateKey: input.reasonTemplateKey, merchantMessage: input.merchantMessage }, actor).then(() => undefined)),
      { ownTx: true },
    );
  }

  async assign(id: string, assigneeId: string | null, actor: PlatformActor) {
    return sys(async () => {
      const it = await prisma.moderationItem.findUnique({ where: { id } });
      if (!it) throw notFound();
      if (!OPEN.includes(it.status)) throw new AppException('MODERATION_ITEM_ALREADY_DECIDED');
      if (assigneeId) {
        const u = await prisma.user.findFirst({ where: { id: assigneeId, platformRole: { in: ['super_admin', 'moderator'] }, deletedAt: null } });
        if (!u) throw validationError({ assigneeId: 'validation.invalid' });
      }
      await prisma.moderationItem.update({ where: { id }, data: { assigneeId } });
      await auditAdmin(this.audit, actor, { action: 'moderation.assign', entity: 'ModerationItem', entityId: id, workspaceId: it.workspaceId, after: { assigneeId } });
      return { id, assigneeId };
    });
  }

  // --- appeals -------------------------------------------------------------------------------------------------------------
  private appealInclude = {
    item: { select: { id: true, type: true, productId: true, decision: true, merchantMessage: true, decidedAt: true, reviewer: userRefSelect, product: { select: { name: true } } } },
    workspace: { select: { id: true, name: true } },
    submittedBy: userRefSelect,
    reviewer: userRefSelect,
    attachment: { select: { url: true, mime: true } },
  } as const satisfies Prisma.ModerationAppealInclude;

  private presentAppeal(a: Prisma.ModerationAppealGetPayload<{ include: ModerationService['appealInclude'] }>, actor: PlatformActor, canWrite: boolean): ModerationAppealDto {
    const sameReviewer = a.item.reviewer?.id === actor.userId;
    const reasonCode = !canWrite ? 'FORBIDDEN' : a.decision ? 'MODERATION_ITEM_ALREADY_DECIDED' : sameReviewer ? 'FORBIDDEN' : undefined;
    return {
      id: a.id,
      item: { id: a.item.id, type: a.item.type, productId: a.item.productId, productName: a.item.product?.name ?? null, decision: a.item.decision, merchantMessage: a.item.merchantMessage, reviewer: toUserRef(a.item.reviewer), decidedAt: iso(a.item.decidedAt) },
      workspace: a.workspace,
      message: a.message,
      attachmentUrl: a.attachment?.url ?? null,
      attachmentMime: a.attachment?.mime ?? null,
      submittedBy: toUserRef(a.submittedBy)!,
      submittedAt: a.submittedAt.toISOString(),
      deadlineAt: a.deadlineAt.toISOString(),
      overdue: !a.decision && a.deadlineAt.getTime() < Date.now(),
      reviewer: toUserRef(a.reviewer),
      decision: a.decision,
      decisionNote: a.decisionNote,
      decidedAt: iso(a.decidedAt),
      actions: [
        { key: 'uphold', enabled: !reasonCode, ...(reasonCode ? { reasonCode } : {}) },
        { key: 'overturn', enabled: !reasonCode, primary: true, ...(reasonCode ? { reasonCode } : {}) },
      ],
    };
  }

  async appeals(q: { page: number; pageSize: number; status?: 'pending' | 'decided' }, actor: PlatformActor, canWrite: boolean): Promise<Page<ModerationAppealDto>> {
    return sys(async () => {
      const where: Prisma.ModerationAppealWhereInput = q.status === 'pending' ? { decision: null } : q.status === 'decided' ? { decision: { not: null } } : {};
      const [rows, total] = await Promise.all([
        prisma.moderationAppeal.findMany({ where, include: this.appealInclude, orderBy: [{ deadlineAt: 'asc' }, { id: 'asc' }], ...toSkipTake(q) }),
        prisma.moderationAppeal.count({ where }),
      ]);
      return page(rows.map((a) => this.presentAppeal(a, actor, canWrite)), total, q);
    });
  }

  /** 04 §12 "Appeal": decided by a moderator different from the first; final; `moderation.appeal_result`. */
  async decideAppeal(id: string, input: { decision: 'upheld' | 'overturned'; note: string }, actor: PlatformActor) {
    const appeal = await sysTx(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "ModerationAppeal" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const a = await tx.moderationAppeal.findUnique({ where: { id }, include: { item: true } });
      if (!a) throw notFound();
      if (a.decision) throw new AppException('MODERATION_ITEM_ALREADY_DECIDED');
      if (a.item.reviewerId === actor.userId) throw new AppException('FORBIDDEN');
      const now = new Date();
      await tx.moderationAppeal.update({ where: { id }, data: { decision: input.decision, decisionNote: input.note, reviewerId: actor.userId, decidedAt: now } });
      const overturned = input.decision === 'overturned';
      await tx.moderationItem.update({ where: { id: a.moderationItemId }, data: { status: overturned ? 'approved' : 'appeal_rejected' } });
      if (a.item.productId) {
        const product = await tx.product.findFirst({ where: { id: a.item.productId, workspaceId: a.workspaceId }, select: { id: true, name: true, moderationItemId: true } });
        if (product && product.moderationItemId === a.moderationItemId) {
          if (overturned) await TenantContext.runAs(a.workspaceId, () => this.hook.markApproved(tx, a.item, { notify: false }));
          else {
            await tx.product.update({ where: { id: product.id }, data: { moderationStatus: 'rejected' } });
            await this.hook.emitProduct(tx, a.workspaceId, product.id, 'rejected');
          }
        }
        await TenantContext.runAs(a.workspaceId, () =>
          this.notifications.emit(tx, { type: 'moderation_appeal_result', workspaceId: a.workspaceId, target: { roles: ['owner', 'admin'] }, key: `moderation_appeal_result:${a.id}`, data: { productId: a.item.productId, name: product?.name ?? '', decision: input.decision, outcome: input.decision } }),
        );
      }
      await this.hook.emitQueue(tx);
      return a;
    });
    await auditAdmin(this.audit, actor, { action: 'moderation.appeal_decide', entity: 'ModerationAppeal', entityId: id, workspaceId: appeal.workspaceId, after: { decision: input.decision }, reason: input.note });
    const full = await sys(() => prisma.moderationAppeal.findUniqueOrThrow({ where: { id }, include: this.appealInclude }));
    return this.presentAppeal(full, actor, true);
  }

  // --- rules ---------------------------------------------------------------------------------------------------------------
  private presentRule(r: Prisma.ModerationRuleGetPayload<{ include: { createdBy: typeof userRefSelect } }>): ModerationRuleDto {
    return { id: r.id, key: r.key, kind: r.kind, value: r.value, locale: r.locale, categoryId: r.categoryId, referencePrice: r.referencePrice, isActive: r.isActive, createdBy: toUserRef(r.createdBy)!, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
  }
  async rules(kinds?: string[]) {
    return sys(async () => (await prisma.moderationRule.findMany({ where: kinds?.length ? { kind: { in: kinds as never } } : {}, include: { createdBy: userRefSelect }, orderBy: [{ kind: 'asc' }, { key: 'asc' }] })).map((r) => this.presentRule(r)));
  }
  async createRule(input: ModerationRuleInput, actor: PlatformActor) {
    return sys(async () => {
      if (await prisma.moderationRule.findUnique({ where: { key: input.key } })) throw new AppException('CONFLICT', {}, { key: 'validation.taken' });
      const r = await prisma.moderationRule.create({ data: { key: input.key, kind: input.kind, value: input.value, locale: input.locale ?? null, categoryId: input.categoryId ?? null, referencePrice: input.referencePrice ?? null, isActive: input.isActive ?? true, createdById: actor.userId }, include: { createdBy: userRefSelect } });
      await auditAdmin(this.audit, actor, { action: 'moderation.rule_create', entity: 'ModerationRule', entityId: r.id, after: { key: r.key, kind: r.kind, value: r.value } });
      return this.presentRule(r);
    });
  }
  async updateRule(id: string, input: Partial<ModerationRuleInput>, actor: PlatformActor) {
    return sys(async () => {
      const before = await prisma.moderationRule.findUnique({ where: { id } });
      if (!before) throw notFound();
      const r = await prisma.moderationRule.update({ where: { id }, data: { ...(input.kind ? { kind: input.kind } : {}), ...(input.value !== undefined ? { value: input.value } : {}), ...(input.locale !== undefined ? { locale: input.locale } : {}), ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}), ...(input.referencePrice !== undefined ? { referencePrice: input.referencePrice } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) }, include: { createdBy: userRefSelect } });
      await auditAdmin(this.audit, actor, { action: 'moderation.rule_update', entity: 'ModerationRule', entityId: id, before: { value: before.value, isActive: before.isActive }, after: { value: r.value, isActive: r.isActive } });
      return this.presentRule(r);
    });
  }
  async deleteRule(id: string, actor: PlatformActor) {
    return sys(async () => {
      const before = await prisma.moderationRule.findUnique({ where: { id } });
      if (!before) throw notFound();
      await prisma.moderationRule.delete({ where: { id } });
      await auditAdmin(this.audit, actor, { action: 'moderation.rule_delete', entity: 'ModerationRule', entityId: id, before: { key: before.key, kind: before.kind, value: before.value } });
      return { id };
    });
  }

  // --- stats & sample ------------------------------------------------------------------------------------------------------
  async stats(period: string): Promise<ModerationStatsDto> {
    return sys(async () => {
      const r = periodRange({ period: period as PeriodKey });
      const from = r.gte ?? new Date(0);
      const to = r.lt ?? new Date();
      const since7 = new Date(Date.now() - 7 * 86400_000);
      const now = new Date();
      const [pending, overSla, urgent, appealsPending, autoApproved7d, rejected7d, byReason, decided, agentPrompts, delays] = await Promise.all([
        prisma.moderationItem.count({ where: { status: 'pending' } }),
        prisma.moderationItem.count({ where: { status: 'pending', slaDueAt: { lt: now } } }),
        prisma.moderationItem.count({ where: { status: 'pending', priority: 'urgent' } }),
        prisma.moderationAppeal.count({ where: { decision: null } }),
        prisma.moderationItem.count({ where: { status: 'auto_approved', decidedAt: { gte: since7 } } }),
        prisma.moderationItem.count({ where: { status: { in: ['rejected', 'appealed', 'appeal_rejected'] }, decidedAt: { gte: since7 } } }),
        prisma.moderationItem.groupBy({ by: ['decision'], where: { decision: { not: null }, decidedAt: { gte: from, lte: to } }, _count: { _all: true } }),
        prisma.moderationItem.groupBy({ by: ['status'], where: { decidedAt: { gte: from, lte: to }, reviewerId: { not: null } }, _count: { _all: true } }),
        prisma.moderationItem.count({ where: { status: 'pending', type: { in: ['agent_prompt', 'agent_name'] } } }),
        prisma.$queryRaw<{ median: number | null }[]>`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("decidedAt" - "submittedAt")) / 60)::float AS median FROM "ModerationItem" WHERE "reviewerId" IS NOT NULL AND "decidedAt" BETWEEN ${from} AND ${to}`,
      ]);
      const total = decided.reduce((n, g) => n + g._count._all, 0);
      const rejected = decided.filter((g) => g.status !== 'approved' && g.status !== 'changes_requested').reduce((n, g) => n + g._count._all, 0);
      const suspension = await this.trust.suspensionProposed();
      return {
        pending,
        overSla,
        urgent,
        appealsPending,
        autoApproved7d,
        rejected7d,
        rejectedByReason: byReason.map((g) => ({ decision: g.decision!, count: g._count._all })).sort((a, b) => b.count - a.count),
        rejectionRatePct: total ? Math.round((rejected / total) * 100) : 0,
        medianDelayMinutes: delays[0]?.median === null || delays[0]?.median === undefined ? null : Math.round(delays[0].median),
        agentPrompts,
        suspensionProposed: suspension,
      };
    });
  }

  /**
   * « Auto-approuvés »: every auto-approved item of the last 7 days (the KPI tile), newest first — PV 09/11 (« ne s'affichent pas dans le
   * dashboard super admin »): a 5 % sample hid almost every product the pre-screen let through.
   */
  async sample(q: { page: number; pageSize: number }, actor: PlatformActor, canWrite: boolean): Promise<Page<ModerationItemDto>> {
    return sys(async () => {
      const ids = await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "ModerationItem" WHERE "status" = 'auto_approved' AND "decidedAt" >= now() - interval '7 days'
        ORDER BY "decidedAt" DESC, "id" DESC`;
      const slice = ids.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((r) => r.id);
      const rows = slice.length ? await prisma.moderationItem.findMany({ where: { id: { in: slice } }, include }) : [];
      const facts = await this.workspaceFacts(rows.map((r) => r.workspaceId));
      const by = new Map(rows.map((r) => [r.id, r]));
      return page(slice.map((id) => this.present(by.get(id)!, facts, canWrite)).filter(Boolean), ids.length, q);
    });
  }

  /** `GET /admin/moderation/categories` — merchant categories present in the pending queue (ADM-10 "Catégorie ⌄" filter). */
  async pendingCategories() {
    return sys(async () => {
      const rows = await prisma.$queryRaw<{ id: string; name: string; workspaceName: string; pending: bigint }[]>`
        SELECT c."id", c."name", w."name" AS "workspaceName", count(*) AS pending
        FROM "ModerationItem" m JOIN "Product" p ON p."id" = m."productId" JOIN "Category" c ON c."id" = p."categoryId" JOIN "Workspace" w ON w."id" = m."workspaceId"
        WHERE m."status" = 'pending'
        GROUP BY c."id", c."name", w."name" ORDER BY pending DESC, c."name" ASC LIMIT 200`;
      return rows.map((r) => ({ id: r.id, name: r.name, workspaceName: r.workspaceName, pending: Number(r.pending) }));
    });
  }

  /** `sched-moderation-sla` (every 15 min in business hours): pending past `slaDueAt` ⇒ urgent + `platform.alert sla_breach`. */
  async slaSweep() {
    return sys(async () => {
      const now = new Date();
      const late = await prisma.moderationItem.findMany({ where: { status: 'pending', priority: 'normal', slaDueAt: { lt: now } }, select: { id: true } });
      if (!late.length) return { urgent: 0 };
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await tx.moderationItem.updateMany({ where: { id: { in: late.map((l) => l.id) } }, data: { priority: 'urgent' } });
        await this.outbox.ws(tx, 'admin:platform', 'platform.alert', { kind: 'sla_breach', payload: { area: 'moderation', count: late.length } }, `platform.alert:sla:moderation:${now.toISOString().slice(0, 16)}`);
        await this.admins.notify(tx, { kind: 'alert_sla', key: `alert_sla:moderation:${now.toISOString().slice(0, 16)}`, params: { area: 'moderation', count: late.length } });
        await this.hook.emitQueue(tx);
      });
      return { urgent: late.length };
    });
  }
}

