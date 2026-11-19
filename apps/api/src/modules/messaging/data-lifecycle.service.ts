// MSG-08 / PUB-05 / D28 / 04 §9 — data lifecycle of the messaging module.
//   Meta data-deletion callback  → `DataDeletionRequest(source=callback)` + job `jobs / meta-data-deletion`. The signed_request
//                                   carries an APP-scoped user id, conversations are stored under PAGE-scoped ids: the job
//                                   resolves the first into the second through the Meta port (`ids_for_pages`, worker only,
//                                   never the HTTP handler), then deletes every conversation, message, identity and stored
//                                   media of that person in every workspace and anonymises their customer cards
//   admin request (ADM-16)       → the same job for a request received by e-mail (`source=admin`, phone or sender id)
//   nothing matched              → status `no_data` (the status page says so, never « TERMINÉ »)
//   sched-retention (step)       → messages older than 12 months purged, emptied conversations anonymised, raw inbound events
//                                   older than 7 days dropped (payment events are kept 5 years, 07-non-functional §4), orphan
//                                   placeholder clients removed
// Every step is safe to run twice.
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Job } from 'bullmq';
import { isPhoneDz, normalizePhoneDz, type AdminDataDeletionCreateInput, type AdminDataDeletionRequestDto, type DataDeletionStatusView, type DataDeletionSummary } from '@djaber/shared';
import { Prisma, prisma, TenantContext, type DataDeletionRequest, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { notFound, validationError } from '../../core/errors/app.exception';
import { page, toSkipTake } from '../../core/http/pagination';
import { maskPhone } from '../../core/privacy/mask';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { StorageService } from '../../core/storage/storage.service';
import { requireReason, type AdminActor } from '../admin-core/admin.util';
import { MetaError } from '../meta/meta-errors';
import { META_GATEWAY, type MetaGateway } from '../meta/meta.gateway';
import { attachmentsOf } from './messaging.presenter';

const DAY = 86_400_000;
export const MESSAGE_RETENTION_DAYS = 365; // D28: 12 months
export const INBOUND_EVENT_RETENTION_DAYS = 7;
/** 03 PAY-04 / 07-non-functional §4: payment events (`InboundEvent` of a payment provider) are kept 5 years. */
export const PAYMENT_EVENT_RETENTION_DAYS = 5 * 365;
export const PAYMENT_EVENT_PROVIDERS = ['chargily', 'google_play', 'app_store'] as const;
export const PLACEHOLDER_RETENTION_DAYS = 90;
/** Name left on a customer card (and on its orders) once the person's data is deleted (MSG-08, PUB-05 « sans votre nom »). */
export const ANONYMISED_CLIENT_NAME = 'Client supprimé';
const BATCH = 500;
/** Attempts of the `meta-data-deletion` job (QueueOutbox options below); the last one proceeds without the Graph mapping. */
const DELETION_ATTEMPTS = 5;
const REDACTED = { redacted: true } as const;

type SenderRef = { senderId: string; pageId?: string };
type DeletionResult = DataDeletionSummary & { senderIds: number; identities: number; sales: number; resolution: 'ids_for_pages' | 'none' | 'failed' | null };

/** Conditions matching one sender reference on a row that has `externalSenderId` + a `channel` relation. */
const senderWhere = (refs: SenderRef[]) => refs.map((r) => (r.pageId ? { externalSenderId: r.senderId, channel: { externalId: r.pageId } } : { externalSenderId: r.senderId }));

@Injectable()
export class DataLifecycleService implements OnModuleInit {
  private readonly log = new Logger(DataLifecycleService.name);
  constructor(
    private readonly registry: ProcessorRegistry,
    private readonly queue: QueueOutbox,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(META_GATEWAY) private readonly meta: MetaGateway,
  ) {}

  onModuleInit() {
    this.registry.register('jobs', 'meta-data-deletion', (d: { requestId: string }, job: Job) => this.runDeletion(d.requestId, job?.attemptsMade ?? 0));
    this.registry.extendCron('sched-retention', 'messaging', () => this.purge());
  }

  private async deleteObjects(keys: string[]) {
    for (const key of keys) await this.storage.delete(key).catch((e) => this.log.warn({ err: String(e) }, 'stored media delete failed'));
  }

  // --- Meta data deletion (MSG-08) ----------------------------------------------------------------------------------------
  statusUrl(code: string) {
    return `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}/meta/data-deletion/${code}`;
  }

  private newCode() {
    return randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').toUpperCase();
  }

  private enqueue(tx: Tx, id: string) {
    return this.queue.add(tx, 'jobs', 'meta-data-deletion', { requestId: id }, `datadel:${id}`, { attempts: DELETION_ATTEMPTS, backoff: { type: 'exponential', delay: 30_000 } });
  }

  /** Callback: registers the request and queues the deletion; a repeated callback for the same user returns the pending one. */
  async request(externalUserId: string): Promise<{ url: string; confirmation_code: string }> {
    const row = await TenantContext.runSystem(() =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const pending = await tx.dataDeletionRequest.findFirst({ where: { provider: 'meta', source: 'callback', externalUserId, status: 'pending' } });
        if (pending) return pending;
        const created = await tx.dataDeletionRequest.create({ data: { provider: 'meta', source: 'callback', externalUserId, confirmationCode: this.newCode() } });
        await this.enqueue(tx, created.id);
        return created;
      }),
    );
    return { url: this.statusUrl(row.confirmationCode), confirmation_code: row.confirmationCode };
  }

  /**
   * `POST /admin/data-deletion-requests` (`admin.deletion.write`): a deletion asked by e-mail (privacy policy / data-deletion
   * page). Same job as the callback; the requester gets the code / status URL from the support answer. Repeating the same
   * pending request returns it (no second job).
   */
  async requestByAdmin(input: AdminDataDeletionCreateInput, actor: AdminActor): Promise<AdminDataDeletionRequestDto> {
    const reason = requireReason(input.reason);
    const phone = input.phone ? normalizePhoneDz(input.phone) : null;
    if (phone !== null && !isPhoneDz(phone)) throw validationError({ phone: 'validation.phone' });
    const senderId = input.externalSenderId ?? null;
    if (input.workspaceId && !(await TenantContext.runSystem(() => prisma.workspace.findFirst({ where: { id: input.workspaceId, deletedAt: null }, select: { id: true } })))) throw notFound();
    const { row, created } = await TenantContext.runSystem(() =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const pending = await tx.dataDeletionRequest.findFirst({ where: { source: 'admin', status: 'pending', targetPhone: phone, externalUserId: senderId, workspaceId: input.workspaceId ?? null } });
        if (pending) return { row: pending, created: false };
        const row = await tx.dataDeletionRequest.create({
          data: { provider: 'meta', source: 'admin', externalUserId: senderId, targetPhone: phone, workspaceId: input.workspaceId ?? null, requestedById: actor.userId, reason, confirmationCode: this.newCode() },
        });
        await this.enqueue(tx, row.id);
        return { row, created: true };
      }),
    );
    if (created) {
      await this.audit.write({
        workspaceId: input.workspaceId ?? null,
        actorType: 'admin',
        actorId: actor.userId,
        actorRole: actor.platformRole,
        action: 'data_deletion.requested',
        entity: 'DataDeletionRequest',
        entityId: row.id,
        before: null,
        after: { source: 'admin', target: phone ? maskPhone(phone) : `sender:${senderId}`, workspaceId: input.workspaceId ?? null },
        reason,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }
    return this.toAdminDto(row);
  }

  /** `GET /admin/data-deletion-requests` (`admin.deletion.read`) — callbacks and e-mail requests, newest first. */
  async listAdmin(q: { page: number; pageSize: number; status?: string[]; source?: 'callback' | 'admin' }) {
    const where: Prisma.DataDeletionRequestWhereInput = { ...(q.status?.length ? { status: { in: q.status as never } } : {}), ...(q.source ? { source: q.source } : {}) };
    const [total, rows] = await TenantContext.runSystem(() =>
      Promise.all([prisma.dataDeletionRequest.count({ where }), prisma.dataDeletionRequest.findMany({ where, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) })]),
    );
    return page(
      rows.map((r) => this.toAdminDto(r)),
      total,
      q,
    );
  }

  private toAdminDto(r: DataDeletionRequest): AdminDataDeletionRequestDto {
    const res = (r.result ?? null) as Partial<DeletionResult> | null;
    const pending = r.status === 'pending';
    return {
      id: r.id,
      code: r.confirmationCode,
      statusUrl: this.statusUrl(r.confirmationCode),
      source: r.source === 'admin' ? 'admin' : 'callback',
      status: r.status,
      target: pending ? (r.targetPhone ? maskPhone(r.targetPhone) : r.externalUserId ? `…${r.externalUserId.slice(-4)}` : null) : null,
      workspaceId: r.workspaceId,
      requestedAt: r.requestedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      affectedWorkspaces: r.affectedWorkspaces,
      summary: res ? summaryOf(res) : null,
      resolution: res?.resolution ?? null,
    };
  }

  /** `GET /data-deletion/:code` (public). An unknown code answers `not_found`, never a 404 (the page shows the state). */
  async status(code: string): Promise<DataDeletionStatusView> {
    const row = await TenantContext.runSystem(() => prisma.dataDeletionRequest.findUnique({ where: { confirmationCode: code } }));
    if (!row) return { code, status: 'not_found', requestedAt: null, completedAt: null };
    const res = (row.result ?? null) as Partial<DeletionResult> | null;
    return {
      code: row.confirmationCode,
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      summary: row.status === 'done' && res ? summaryOf(res) : null,
    };
  }

  /** App-scoped id of a callback → the page-scoped ids of the same person (worker side, Meta port). */
  private async resolveSenders(req: DataDeletionRequest, attemptsMade: number): Promise<{ refs: SenderRef[]; resolution: DeletionResult['resolution'] }> {
    const refs: SenderRef[] = req.externalUserId ? [{ senderId: req.externalUserId }] : [];
    if (req.source !== 'callback' || !req.externalUserId) return { refs, resolution: null };
    try {
      const ids = await this.meta.idsForPages(req.externalUserId);
      for (const r of ids) refs.push({ senderId: r.psid, pageId: r.pageId });
      return { refs, resolution: ids.length ? 'ids_for_pages' : 'none' };
    } catch (e) {
      // a transient Meta failure is retried by the job; the last attempt goes on with the ids it has (the status then tells)
      if (e instanceof MetaError && e.retryable && attemptsMade < DELETION_ATTEMPTS - 1) throw e;
      this.log.warn({ requestId: req.id, err: e instanceof MetaError ? `${e.kind}:${e.code ?? ''}` : 'error' }, 'ids_for_pages failed — deletion runs on the stored ids only');
      return { refs, resolution: 'failed' };
    }
  }

  /**
   * Deletes everything held about one person, in every workspace (or the one of an admin request):
   * conversations (messages, notes, insights go with them), identities, stored media; AI tool-call arguments of those
   * conversations redacted; customer blocks detached. A customer card without orders or sales is deleted; a card with
   * orders / sales is anonymised (name « Client supprimé », phones, e-mail, notes, tags, addresses removed, archived) and
   * its orders / sales lose the name, phones and address — amounts, payments, cash rows and invoices stay as they are.
   * Status `done`, or `no_data` when nothing matched.
   */
  async runDeletion(requestId: string, attemptsMade = 0): Promise<number> {
    return TenantContext.runSystem(async () => {
      const req = await prisma.dataDeletionRequest.findUnique({ where: { id: requestId } });
      if (!req || req.status !== 'pending') return 0;
      const { refs, resolution } = await this.resolveSenders(req, attemptsMade);
      const scope = req.workspaceId ? { workspaceId: req.workspaceId } : {};
      const keys: string[] = [];
      const workspaces = new Set<string>();
      const result: DeletionResult = { senderIds: refs.length, conversations: 0, identities: 0, clientsDeleted: 0, clientsAnonymised: 0, orders: 0, sales: 0, workspaces: 0, resolution };
      await prisma.$transaction(
        async (db) => {
          const tx = db as Tx;
          const bySender = senderWhere(refs);
          const phoneClients = req.targetPhone ? await tx.client.findMany({ where: { ...scope, OR: [{ phone: req.targetPhone }, { phone2: req.targetPhone }] }, select: { id: true } }) : [];
          const phoneClientIds = phoneClients.map((c) => c.id);
          const convOr = [...bySender, ...(phoneClientIds.length ? [{ clientId: { in: phoneClientIds } }] : [])];
          const conversations = convOr.length ? await tx.conversation.findMany({ where: { ...scope, OR: convOr }, select: { id: true, workspaceId: true, clientId: true } }) : [];
          const ids = conversations.map((c) => c.id);
          const clientIds = new Set<string>(phoneClientIds);
          for (const c of conversations) {
            workspaces.add(c.workspaceId);
            if (c.clientId) clientIds.add(c.clientId);
          }
          if (ids.length) {
            const withMedia = await tx.message.findMany({ where: { conversationId: { in: ids } }, select: { attachments: true } });
            for (const m of withMedia) for (const a of attachmentsOf(m)) if (a.storageKey) keys.push(a.storageKey);
            // AI runs stay (credits, analytics) but the tool arguments / results of these conversations held the customer's data
            await tx.aiToolCall.updateMany({ where: { aiRun: { conversationId: { in: ids } } }, data: { args: REDACTED, result: REDACTED } });
            // messages, notes, insights and recommendation events go with the conversation (FK cascade); orders keep their rows
            await tx.conversation.deleteMany({ where: { id: { in: ids } } });
          }
          const identityOr = [...bySender, ...(phoneClientIds.length ? [{ clientId: { in: phoneClientIds } }] : [])];
          const identityScope = req.workspaceId ? { client: { workspaceId: req.workspaceId } } : {};
          const identities = identityOr.length ? await tx.clientIdentity.findMany({ where: { ...identityScope, OR: identityOr }, select: { id: true, clientId: true } }) : [];
          if (identities.length) await tx.clientIdentity.deleteMany({ where: { id: { in: identities.map((i) => i.id) } } });
          for (const i of identities) clientIds.add(i.clientId);
          const blocks = bySender.length ? await tx.customerBlock.updateMany({ where: { ...scope, OR: bySender }, data: { externalSenderId: null, channelId: null } }) : { count: 0 };
          for (const clientId of clientIds) {
            const c = await tx.client.findUnique({ where: { id: clientId }, include: { _count: { select: { orders: true, sales: true } } } });
            if (!c) continue;
            workspaces.add(c.workspaceId);
            await tx.customerBlock.updateMany({ where: { clientId }, data: { phone: null, externalSenderId: null, channelId: null, note: null } });
            if (!c._count.orders && !c._count.sales) {
              // 04 §9: a card without orders is deleted (identities and addresses cascade, conversations / reports detached)
              await tx.customerBlock.deleteMany({ where: { clientId } });
              await tx.report.updateMany({ where: { clientId }, data: { clientId: null } });
              await tx.conversation.updateMany({ where: { clientId }, data: { clientId: null } });
              await tx.client.updateMany({ where: { mergedIntoId: clientId }, data: { mergedIntoId: null } });
              await tx.client.delete({ where: { id: clientId } });
              result.clientsDeleted++;
              continue;
            }
            // PUB-05: the orders stay in the merchant's books « sans votre nom » — figures untouched, personal data removed
            await tx.client.update({
              where: { id: clientId },
              data: { name: ANONYMISED_CLIENT_NAME, phone: null, phone2: null, email: null, notes: null, tags: [], deletedAt: c.deletedAt ?? new Date() },
            });
            await tx.clientAddress.deleteMany({ where: { clientId } });
            await tx.clientIdentity.deleteMany({ where: { clientId } });
            await tx.conversation.updateMany({ where: { clientId }, data: { clientId: null } });
            const orders = await tx.order.updateMany({ where: { clientId }, data: { clientName: ANONYMISED_CLIENT_NAME, clientPhone: '', clientPhone2: null, address: null, communeText: null, notes: null } });
            const sales = await tx.sale.updateMany({ where: { clientId }, data: { customerName: null, customerPhone: null } });
            result.orders += orders.count;
            result.sales += sales.count;
            result.clientsAnonymised++;
          }
          result.conversations = ids.length;
          result.identities = identities.length;
          result.workspaces = workspaces.size;
          const matched = ids.length + identities.length + clientIds.size + blocks.count > 0;
          await tx.dataDeletionRequest.update({
            where: { id: req.id },
            // the target of an admin request is not kept once processed
            data: { status: matched ? 'done' : 'no_data', completedAt: new Date(), affectedWorkspaces: workspaces.size, targetPhone: null, result: result as unknown as Prisma.InputJsonValue },
          });
        },
        { timeout: 60_000 },
      );
      await this.deleteObjects(keys);
      this.log.log({ requestId: req.id, source: req.source, ...result }, 'data deletion processed');
      return workspaces.size;
    });
  }

  // --- retention (sched-retention step) -----------------------------------------------------------------------------------
  async purge(now = new Date()): Promise<{ messages: number; conversations: number; inboundEvents: number; paymentEvents: number; placeholders: number }> {
    return TenantContext.runSystem(async () => {
      const cutoff = new Date(now.getTime() - MESSAGE_RETENTION_DAYS * DAY);
      let messages = 0;
      for (;;) {
        const old = await prisma.message.findMany({ where: { sentAt: { lt: cutoff } }, select: { id: true, attachments: true }, take: BATCH });
        if (!old.length) break;
        const keys = old.flatMap((m) => attachmentsOf(m).map((a) => a.storageKey).filter((k): k is string => !!k));
        // reports keep their own masked excerpt; the link to the purged message is dropped
        await prisma.report.updateMany({ where: { messageId: { in: old.map((m) => m.id) } }, data: { messageId: null } });
        const r = await prisma.message.deleteMany({ where: { id: { in: old.map((m) => m.id) } } });
        messages += r.count;
        await this.deleteObjects(keys);
        if (old.length < BATCH) break;
      }
      // the conversation row stays, anonymised, once nothing is left in it (the sender can no longer be matched)
      const empty = await prisma.conversation.findMany({
        where: { lastMessageAt: { lt: cutoff }, messages: { none: {} }, NOT: { externalSenderId: { startsWith: 'anon:' } } },
        select: { id: true, externalSenderId: true, channelId: true },
        take: 5000,
      });
      for (const c of empty) {
        const hash = createHash('sha256').update(`${c.channelId}:${c.externalSenderId}`).digest('hex').slice(0, 40);
        await prisma.conversation.update({ where: { id: c.id }, data: { externalSenderId: `anon:${hash}`, lastMessagePreview: null, context: {} } });
      }
      // raw Meta / courier / Google events: 7 days; payment events (Chargily, stores) are payment logs kept 5 years
      const inbound = await prisma.inboundEvent.deleteMany({ where: { provider: { notIn: [...PAYMENT_EVENT_PROVIDERS] }, receivedAt: { lt: new Date(now.getTime() - INBOUND_EVENT_RETENTION_DAYS * DAY) } } });
      const payments = await prisma.inboundEvent.deleteMany({ where: { provider: { in: [...PAYMENT_EVENT_PROVIDERS] }, receivedAt: { lt: new Date(now.getTime() - PAYMENT_EVENT_RETENTION_DAYS * DAY) } } });
      const stale = await prisma.client.findMany({
        where: { isPlaceholder: true, createdAt: { lt: new Date(now.getTime() - PLACEHOLDER_RETENTION_DAYS * DAY) }, orders: { none: {} }, sales: { none: {} }, conversations: { none: {} }, blocks: { none: {} }, reports: { none: {} }, mergedFrom: { none: {} } },
        select: { id: true },
        take: 5000,
      });
      const placeholders = stale.length ? (await prisma.client.deleteMany({ where: { id: { in: stale.map((c) => c.id) } } })).count : 0;
      return { messages, conversations: empty.length, inboundEvents: inbound.count, paymentEvents: payments.count, placeholders };
    });
  }
}

const summaryOf = (r: Partial<DeletionResult>): DataDeletionSummary => ({
  conversations: r.conversations ?? 0,
  clientsAnonymised: r.clientsAnonymised ?? 0,
  clientsDeleted: r.clientsDeleted ?? 0,
  orders: r.orders ?? 0,
  workspaces: r.workspaces ?? 0,
});
