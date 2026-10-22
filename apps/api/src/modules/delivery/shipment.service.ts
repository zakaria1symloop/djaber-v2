// DLV-05 / DLV-10 / 04 §22 / FL-08 / FL-25 — parcels: send single (202, queued `courier.create-parcel`) and bulk (job
// `bulk-send`), the create-parcel processor with its retry schedule, read models, and every parcel action (cancel,
// retry, retry-delivery, change courier, mark failed / delivered / returned, manual "Actualiser"). HTTP handlers never
// call a courier: they write the Shipment row + an outbox job in one transaction (CLAUDE.md rule 4).
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { courierWilayaId, TRACKING_SYNC_COOLDOWN_S, type BulkSendInput, type BulkSendResult, type BulkSendRowResult, type CancelShipmentInput, type CreateShipmentInput, type MarkDeliveredInput, type MarkFailedInput, type MarkReturnedInput, type ShipmentView } from '@djaber/shared';
import { prisma, TenantContext, type Job, type Prisma, type Shipment, type Tx } from '@djaber/db';
import { ConfigService } from '../../core/config/config.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { runBulk, type BulkCtx } from '../../core/http/bulk';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { RedisService } from '../../core/redis/redis.provider';
import { JobService } from '../jobs/job.service';
import type { Actor } from '../orders/order-effects.service';
import type { LockedOrder } from '../orders/order-workflow.service';
import { addressOf, clientRefOf, hasDeliveryAddress } from '../orders/order.presenter';
import { CourierAdapters } from './adapters/courier-registry';
import { COURIER_ERROR_CODE, isCourierError, type CreateShipmentInput as AdapterInput } from './adapters/courier-adapter';
import { CourierAccountService } from './courier-account.service';
import { CourierLimiter } from './courier-limiter';
import { ShipmentEffects } from './shipment-effects.service';
import { courierFieldErrors, encodeShipmentError, errorCodeOf, isSendFailure, parseShipmentError, presentShipment, SHIPMENT_INCLUDE, type ShipmentRow } from './shipment.presenter';
import { CREATE_MAX_ATTEMPTS, CREATE_RETRY_DELAYS_MS, nextSyncAt } from './tracking-rules';

const SEND_STATUSES = ['confirmed', 'preparing'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clientSelect = { select: { id: true, name: true, phone: true, riskLevel: true, isPlaceholder: true, orderCount: true } } as const;
export const SHIPMENT_ORDER_SELECT = {
  id: true,
  number: true,
  status: true,
  version: true,
  workspaceId: true,
  clientId: true,
  clientName: true,
  clientPhone: true,
  wilayaId: true,
  communeId: true,
  communeText: true,
  address: true,
  isStopdesk: true,
  stopdeskId: true,
  total: true,
  amountPaid: true,
  deliveryStatus: true,
  wilaya: { select: { nameFr: true, nameAr: true } },
  commune: { select: { nameFr: true, nameAr: true } },
  client: clientSelect,
} satisfies Prisma.OrderSelect;
type CreateParcelData = { shipmentId: string; workspaceId: string };

@Injectable()
export class ShipmentService implements OnModuleInit {
  private readonly log = new Logger(ShipmentService.name);
  constructor(
    private readonly fx: ShipmentEffects,
    private readonly accounts: CourierAccountService,
    private readonly adapters: CourierAdapters,
    private readonly limiter: CourierLimiter,
    private readonly queueOutbox: QueueOutbox,
    private readonly registry: ProcessorRegistry,
    private readonly jobs: JobService,
    private readonly redis: RedisService,
    private readonly i18n: I18nService,
    private readonly config: ConfigService,
  ) {}

  private get orders() {
    return this.fx.orders;
  }
  private get workflow() {
    return this.fx.workflow;
  }

  onModuleInit() {
    this.registry.register('courier', 'create-parcel', (data: CreateParcelData) => this.createParcel(data), { concurrency: 4 });
    this.registry.register('courier', 'cancel-parcel', (data: { shipmentId: string; workspaceId: string; then: 'confirmed' | 'cancelled'; reason?: string | null; note?: string | null; userId?: string | null }) => this.cancelParcel(data), { concurrency: 4 });
    this.registry.register('courier', 'retry-delivery', (data: { shipmentId: string; workspaceId: string; userId?: string | null }) => this.retryDeliveryJob(data), { concurrency: 4 });
    this.registry.register('jobs', 'bulk-send', (data: { jobId: string }) => this.bulkSendJob(data.jobId), { concurrency: 1 });
    this.registry.register('courier', 'auto-send', (data: { orderId: string; workspaceId: string; userId?: string | null }) => this.autoSend(data), { concurrency: 2 });
  }

  /**
   * DLV-05 / D9 `Workspace.autoSendToCourier`: the confirmed order is sent to the default courier with its own address.
   * A refusal (no courier, address incomplete, already sent) leaves the order confirmed — the team sends it by hand.
   */
  async autoSend(data: { orderId: string; workspaceId: string; userId?: string | null }) {
    await TenantContext.runAs(data.workspaceId, async () => {
      let shipmentId: string;
      try {
        shipmentId = await this.orders.inTx((tx) => this.createPending(tx, data.orderId, {}, { type: 'system', id: null }, { queue: false }));
      } catch (e) {
        if (e instanceof AppException) {
          this.log.log({ orderId: data.orderId, code: e.code }, 'auto-send skipped');
          return;
        }
        throw e;
      }
      await this.attempt(shipmentId);
    });
  }

  /** Capabilities of the parcel's courier account (per provider, per platform for ZR Express). */
  private async capsOf(db: Tx, s: Pick<Shipment, 'provider' | 'courierAccountId'>) {
    const a = s.courierAccountId ? await db.courierAccount.findFirst({ where: { id: s.courierAccountId }, select: { baseUrl: true } }) : null;
    return this.adapters.get(s.provider, a?.baseUrl).capabilities;
  }

  // --- reads ----------------------------------------------------------------------------------------------------------------
  async syncAvailableAt(id: string): Promise<string | null> {
    const ttl = await this.redis.client.ttl(`trk:manual:${id}`);
    return ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null;
  }

  async view(id: string, locale: string = TenantContext.get().locale): Promise<ShipmentView> {
    const s = await prisma.shipment.findFirst({ where: { id }, include: { ...SHIPMENT_INCLUDE, order: { select: SHIPMENT_ORDER_SELECT } } });
    if (!s) throw notFound();
    const index = await this.orders.safety.index();
    const blocked = index.has({ clientId: s.order.clientId, channelId: '', externalSenderId: '' }, s.order.client.phone ?? s.order.clientPhone);
    const client = clientRefOf({ ...s.order.client, name: s.order.clientName || s.order.client.name }, blocked);
    const account = s.courierAccountId ? await prisma.courierAccount.findFirst({ where: { id: s.courierAccountId } }) : null;
    let portalUrl: string | null = null;
    if (account && s.trackingNumber) {
      const adapter = this.adapters.get(s.provider, account.baseUrl);
      try {
        portalUrl = adapter.portalUrl?.(this.accounts.open(account), s.trackingNumber) ?? null;
      } catch {
        portalUrl = null;
      }
    }
    return presentShipment(s as unknown as ShipmentRow, s.order, client, addressOf(s.order, locale), { publicWebUrl: this.config.get('PUBLIC_WEB_URL'), syncAvailableAt: await this.syncAvailableAt(id), portalUrl });
  }

  // --- send (DLV-05) ----------------------------------------------------------------------------------------------------------
  /** Guards of 05-integrations §2.6 on a row-locked order. */
  private checkSendable(o: LockedOrder) {
    const active = this.orders.activeShipment(o);
    if (active) throw new AppException('DELIVERY_ORDER_ALREADY_SENT');
    if (o.status === 'new') throw new AppException('DELIVERY_ORDER_NOT_CONFIRMED');
    if (o.status === 'cancelled' || o.status === 'returned') throw new AppException('ORDER_TERMINAL');
    if (!SEND_STATUSES.includes(o.status)) throw new AppException('ORDER_INVALID_TRANSITION', { from: o.status, to: 'shipped' });
  }

  private sameAddress(o: LockedOrder, i: CreateShipmentInput) {
    return o.wilayaId === i.wilayaId && (o.communeId ?? null) === (i.communeId ?? null) && (o.communeText ?? null) === (i.communeId ? (o.communeText ?? null) : (i.communeText ?? null)) && (o.address ?? null) === (i.address ?? null) && o.isStopdesk === i.isStopdesk && (o.stopdeskId ?? null) === (i.stopdeskId ?? null);
  }

  /** Cached courier rate for the order's wilaya (informational courier cost, D15). */
  private async courierCost(tx: Tx, courierAccountId: string, wilayaId: number | null, stopdesk: boolean) {
    if (!wilayaId) return null;
    const r = await tx.courierRateCache.findFirst({ where: { courierAccountId, wilayaId } });
    return r ? (stopdesk ? r.stopdeskPrice : r.homePrice) : null;
  }

  /**
   * Creates the `pending` parcel of a row-locked order and its `create-parcel` job (same transaction). The address of
   * the dialog is written to the order first when it differs. Returns the shipment id.
   */
  async createPending(tx: Tx, orderId: string, input: Partial<CreateShipmentInput> & { courierAccountId?: string | null }, actor: Actor, o2: { queue: boolean } = { queue: true }): Promise<string> {
    let o = await this.orders.lock(tx, orderId);
    this.checkSendable(o);
    const account = await this.accounts.resolveForSend(input.courierAccountId, tx);
    if (input.wilayaId !== undefined && input.isStopdesk !== undefined && !this.sameAddress(o, input as CreateShipmentInput)) {
      await this.workflow.applyAddress(tx, o, { wilayaId: input.wilayaId, communeId: input.communeId ?? null, communeText: input.communeText ?? null, isStopdesk: input.isStopdesk, stopdeskId: input.stopdeskId ?? null, address: input.address ?? null }, actor);
      o = await this.orders.lock(tx, orderId);
    }
    if (!hasDeliveryAddress(o)) throw new AppException('ORDER_ADDRESS_REQUIRED');
    const caps = this.adapters.get(account.provider, account.baseUrl).capabilities;
    if (o.isStopdesk && caps.stopdesks && !o.stopdeskId) throw new AppException('VALIDATION_ERROR', {}, { stopdeskId: 'validation.required' });
    const codAmount = input.codAmount ?? Math.max(0, o.total - o.amountPaid);
    if (codAmount > o.total) throw new AppException('VALIDATION_ERROR', {}, { codAmount: 'validation.range' });
    const now = new Date();
    const cost = await this.courierCost(tx, account.id, o.wilayaId, o.isStopdesk);
    const s = await tx.shipment.create({
      data: {
        workspaceId: o.workspaceId,
        orderId,
        provider: account.provider,
        courierAccountId: account.id,
        status: 'pending',
        publicTrackingToken: randomBytes(12).toString('base64url'),
        codAmount,
        weightKg: input.weightKg ?? null,
        contentSummary: input.contentSummary ?? null,
        stopdeskId: o.isStopdesk ? o.stopdeskId : null,
        courierCost: cost,
        lastEventAt: now,
      },
    });
    const updated = await tx.order.update({ where: { id: orderId }, data: { deliveryStatus: 'pending', ...(cost !== null ? { courierCost: cost } : {}), version: { increment: 1 } } });
    await tx.orderStatusHistory.create({ data: { orderId, field: 'deliveryStatus', from: o.deliveryStatus, to: 'pending', actorType: actor.type, actorId: actor.id, reason: account.displayName } });
    await this.orders.effects.emitUpdated(tx, updated, ['deliveryStatus']);
    await this.fx.emit(tx, s);
    if (o2.queue) await this.enqueueCreate(tx, s, 1);
    return s.id;
  }

  private enqueueCreate(tx: Tx, s: Pick<Shipment, 'id' | 'workspaceId'>, attempt: number, delayMs = 0, suffix = '') {
    return this.queueOutbox.add(tx, 'courier', 'create-parcel', { shipmentId: s.id, workspaceId: s.workspaceId }, `parcel:${s.id}${attempt > 1 || suffix ? `:a${attempt}${suffix}` : ''}`, { attempts: 1, ...(delayMs ? { delay: delayMs } : {}) });
  }

  /** `POST /orders/:id/shipments` → 202 `ShipmentView` (pending). */
  async send(orderId: string, input: CreateShipmentInput, locale: string) {
    const actor = this.orders.actor();
    const id = await this.orders.inTx((tx) => this.createPending(tx, orderId, input, actor), locale);
    return this.view(id, locale);
  }

  /** `POST /shipments/bulk` → 202 `{ jobId }` (Job `bulk_send`, name `bulk-send`). */
  async requestBulk(input: BulkSendInput) {
    const job = await this.jobs.create({ kind: 'bulk_send', name: 'bulk-send', payload: { orderIds: [...new Set(input.orderIds)], courierAccountId: input.courierAccountId ?? null, weightKg: input.weightKg ?? null }, total: input.orderIds.length });
    return { jobId: job.id };
  }

  private rowError(e: unknown, locale: string): BulkSendRowResult['error'] {
    if (e instanceof AppException) return { code: e.code, message: this.i18n.t(locale, `error.${e.code}`, e.params), params: e.params, ...(Object.keys(e.fields).length ? { fields: e.fields } : {}) };
    throw e;
  }

  async bulkSendJob(jobId: string) {
    await this.jobs.run(jobId, async (job: Job) => {
      const p = (job.payload ?? {}) as { orderIds?: string[]; courierAccountId?: string | null; weightKg?: number | null };
      const ids = p.orderIds ?? [];
      const locale = TenantContext.get().locale;
      const actor: Actor = { type: 'user', id: job.createdById };
      const results: BulkSendRowResult[] = [];
      let i = 0;
      for (const orderId of ids) {
        if (await this.jobs.isCancelled(jobId)) break;
        const head = await prisma.order.findFirst({ where: { id: orderId }, select: { number: true } });
        try {
          if (!head) throw notFound();
          const shipmentId = await this.orders.inTx((tx) => this.createPending(tx, orderId, { courierAccountId: p.courierAccountId, ...(p.weightKg ? { weightKg: p.weightKg } : {}) }, actor, { queue: false }));
          await this.attempt(shipmentId);
          const s = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
          if (s.status === 'failed') {
            const err = parseShipmentError(s.lastError) ?? { code: 'COURIER_VALIDATION', field: null, message: null };
            const params: Record<string, string | number> = err.code === 'COURIER_VALIDATION' ? { field: err.field ?? 'other', message: err.message ?? '' } : {};
            const fields = courierFieldErrors(err.field);
            results.push({ id: orderId, ok: false, orderNumber: head.number, data: { shipmentId, status: s.status, trackingNumber: s.trackingNumber }, error: { code: err.code, message: this.i18n.t(locale, `error.${err.code}`, params), params, ...(fields ? { fields } : {}) } });
          } else {
            results.push({ id: orderId, ok: true, orderNumber: head.number, data: { shipmentId, status: s.status, trackingNumber: s.trackingNumber } });
          }
        } catch (e) {
          results.push({ id: orderId, ok: false, orderNumber: head?.number ?? null, error: this.rowError(e, locale) });
        }
        await this.jobs.progress(jobId, (++i / Math.max(1, ids.length)) * 100);
      }
      const result: BulkSendResult = { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, queued: results.filter((r) => r.ok && r.data?.status === 'pending').length };
      return { result, status: result.failed ? 'partial' : 'done' };
    });
  }

  // --- the courier call (`courier.create-parcel`, 03-events §3) --------------------------------------------------------------
  async createParcel(data: CreateParcelData) {
    await TenantContext.runAs(data.workspaceId, () => this.attempt(data.shipmentId));
  }

  /** Data the adapter needs (05-integrations §2.1 `CreateShipmentInput`): the ORDER's address, never the sender default. */
  private async adapterInput(s: Shipment): Promise<AdapterInput> {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId }, include: { items: { orderBy: { id: 'asc' } }, wilaya: true, commune: true } });
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: s.workspaceId }, select: { name: true, phone: true, address: true, senderWilayaId: true } });
    const account = s.courierAccountId ? await prisma.courierAccount.findFirst({ where: { id: s.courierAccountId } }) : null;
    // couriers know the 58 historical wilaya codes: a wilaya of loi 26-06 (59–69) is sent as its parent (the commune
    // name stays the real one); see `courierWilayaId` and the assumptions log (fix/wilayas-69)
    const senderWilayaId = courierWilayaId(account?.senderWilayaId ?? ws.senderWilayaId ?? 16);
    const toWilayaId = o.wilayaId ? courierWilayaId(o.wilayaId) : 0;
    const [senderWilaya, toWilaya] = await Promise.all([
      prisma.wilaya.findUnique({ where: { id: senderWilayaId } }),
      toWilayaId && toWilayaId !== o.wilayaId ? prisma.wilaya.findUnique({ where: { id: toWilayaId } }) : Promise.resolve(o.wilaya),
    ]);
    const map = o.communeId && s.provider !== 'manual' ? await prisma.courierCommuneMap.findUnique({ where: { provider_communeId: { provider: s.provider as 'zrexpress', communeId: o.communeId } } }) : null;
    const communeName = o.commune?.nameFr ?? o.communeText ?? '';
    // the order keeps the stop-desk row picked in Djaber (`CourierStopdesk.id`); the courier wants its own desk id
    const desk = s.stopdeskId && UUID_RE.test(s.stopdeskId) ? await prisma.courierStopdesk.findUnique({ where: { id: s.stopdeskId }, select: { provider: true, externalId: true } }) : null;
    const summary = s.contentSummary ?? o.items.map((i) => `${i.productName}${i.variantName ? ` ${i.variantName}` : ''} ×${i.quantity}`).join(', ');
    return {
      shipmentId: s.id,
      orderNumber: o.number,
      recipient: { name: o.clientName, phone: o.clientPhone, phone2: o.clientPhone2 },
      wilayaId: toWilayaId,
      wilayaName: toWilaya?.nameFr ?? '',
      communeName,
      communeCode: map?.externalCode ?? null,
      address: o.address ?? (o.isStopdesk ? `Stop-desk ${s.stopdeskId ?? ''} ${communeName}`.trim() : ''),
      isStopdesk: o.isStopdesk,
      stopdeskId: desk && desk.provider === s.provider ? desk.externalId : s.stopdeskId,
      codAmount: s.codAmount,
      weightGrams: s.weightKg === null ? null : Math.round(Number(s.weightKg) * 1000),
      productSummary: summary.slice(0, 250),
      note: o.notes?.slice(0, 200) ?? null,
      declaredValue: o.subtotal,
      sender: { name: account?.senderName ?? ws.name, phone: account?.senderPhone ?? ws.phone ?? '', wilayaId: senderWilayaId, wilayaName: senderWilaya?.nameFr ?? '', address: account?.senderAddress ?? ws.address ?? '' },
    };
  }

  /**
   * One attempt of the parcel creation. Idempotent: the Shipment row is the lock (only a `pending` parcel without a
   * tracking number is sent). Validation ⇒ `failed` (no retry, order unchanged); 401 ⇒ `failed` + account flagged;
   * unavailable ⇒ queued retry (60 s, 5 min, 30 min, 2 h, 2 h, 2 h), then `failed` + `shipment.failed` (`courier_unavailable`).
   */
  async attempt(shipmentId: string): Promise<'sent' | 'failed' | 'queued' | 'skipped'> {
    const claimed = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Shipment" WHERE "id" = ${shipmentId}::uuid AND "workspaceId" = ${TenantContext.workspaceId()}::uuid FOR UPDATE`;
      if (!rows.length) return null;
      const s = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
      if (s.status !== 'pending' || s.trackingNumber) return null;
      return tx.shipment.update({ where: { id: shipmentId }, data: { attempts: { increment: 1 } } });
    });
    if (!claimed) return 'skipped';
    const account = claimed.courierAccountId ? await prisma.courierAccount.findFirst({ where: { id: claimed.courierAccountId } }) : null;
    if (!account) return this.sendFailed(claimed, encodeShipmentError('DELIVERY_NO_COURIER'));
    const adapter = this.adapters.get(claimed.provider, account.baseUrl);
    let result;
    try {
      const input = await this.adapterInput(claimed);
      await this.limiter.take(account.id, 'send');
      result = await adapter.createShipment(this.accounts.open(account), input);
    } catch (e) {
      if (!isCourierError(e)) throw e;
      if (e.kind === 'unavailable') return this.retryLater(claimed);
      if (e.kind === 'auth') {
        await prisma.$transaction((db) => this.accounts.flagCredentials(db as Tx, account.id));
        return this.sendFailed(claimed, encodeShipmentError('COURIER_CREDENTIALS_INVALID', null, e.message));
      }
      return this.sendFailed(claimed, encodeShipmentError(COURIER_ERROR_CODE[e.kind], e.kind === 'validation' ? e.field : null, e.message));
    }
    return this.sendSucceeded(claimed.id, result, account.displayName);
  }

  private async retryLater(s: Shipment): Promise<'queued' | 'failed'> {
    if (s.attempts >= CREATE_MAX_ATTEMPTS) {
      await this.sendFailed(s, encodeShipmentError('COURIER_UNAVAILABLE'), { notifyUnavailable: true });
      return 'failed';
    }
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const u = await tx.shipment.update({ where: { id: s.id }, data: { lastError: encodeShipmentError('COURIER_UNAVAILABLE') } });
      await this.enqueueCreate(tx, s, s.attempts + 1, CREATE_RETRY_DELAYS_MS[s.attempts - 1] ?? CREATE_RETRY_DELAYS_MS[CREATE_RETRY_DELAYS_MS.length - 1]);
      await this.fx.emit(tx, u);
    });
    return 'queued';
  }

  /** The parcel was not created: `failed` (status), order back to "not sent" (it stays confirmed / preparing). */
  private async sendFailed(s: Shipment, lastError: string, o: { notifyUnavailable?: boolean } = {}): Promise<'failed'> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const order = await this.orders.lock(tx, s.orderId);
      const cur = await this.fx.lockShipment(tx, s.id);
      if (cur.status !== 'pending') return;
      const u = await tx.shipment.update({ where: { id: s.id }, data: { status: 'failed', lastError, nextSyncAt: null }, include: { courierAccount: { select: { displayName: true } } } });
      if (order.deliveryStatus === 'pending') {
        const updated = await tx.order.update({ where: { id: order.id }, data: { deliveryStatus: 'not_sent', version: { increment: 1 } } });
        await tx.orderStatusHistory.create({ data: { orderId: order.id, field: 'deliveryStatus', from: 'pending', to: 'not_sent', actorType: 'courier', reason: errorCodeOf(lastError) } });
        await this.orders.effects.emitUpdated(tx, updated, ['deliveryStatus']);
      }
      // 03-events §3: final unavailability ⇒ `shipment.failed` with `reason='courier_unavailable'` (no customer text)
      if (o.notifyUnavailable) await this.fx.notify(tx, 'shipment_failed', u, order, { reason: 'courier_unavailable', stamp: 'courier_unavailable' });
      await this.fx.emit(tx, u);
    });
    return 'failed';
  }

  private async sendSucceeded(shipmentId: string, r: { trackingNumber: string; externalId?: string | null; rawStatus?: string | null }, courierName: string): Promise<'sent' | 'skipped'> {
    let outcome: 'sent' | 'skipped' = 'sent';
    await prisma.$transaction(
      async (db) => {
        const tx = db as Tx;
        const head = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { orderId: true } });
        let o = await this.orders.lock(tx, head.orderId);
        const s = await this.fx.lockShipment(tx, shipmentId);
        if (s.status !== 'pending') {
          // cancelled while the courier was called: withdraw the parcel that now exists at the courier
          await tx.shipment.update({ where: { id: shipmentId }, data: { trackingNumber: r.trackingNumber, externalId: r.externalId ?? null } });
          await this.queueOutbox.add(tx, 'courier', 'cancel-parcel', { shipmentId, workspaceId: s.workspaceId, then: 'confirmed', withdrawOnly: true }, `cancel:${shipmentId}`, { attempts: 3, backoff: { type: 'fixed', delay: 60_000 } });
          outcome = 'skipped';
          return;
        }
        const now = new Date();
        const u = await tx.shipment.update({
          where: { id: shipmentId },
          data: { status: 'sent', trackingNumber: r.trackingNumber, externalId: r.externalId ?? null, rawStatus: r.rawStatus ?? null, lastError: null, lastEventAt: now, lastSyncedAt: now, nextSyncAt: s.provider === 'manual' ? null : nextSyncAt(s.createdAt, now) },
          include: { courierAccount: { select: { displayName: true } } },
        });
        const e = await tx.shipmentEvent.create({ data: { shipmentId, rawStatus: r.rawStatus ?? 'sent', mappedStatus: 'sent', at: now, source: 'system' }, include: { actor: SHIPMENT_INCLUDE.events.include.actor } });
        if (SEND_STATUSES.includes(o.status)) {
          await this.workflow.transition(tx, o, 'shipped', { actor: { type: 'courier', id: null }, system: true, shipmentHandled: true, shipmentNotice: false, notifyCustomer: false, trackingNumber: r.trackingNumber });
          o = await this.orders.lock(tx, o.id);
        } else {
          o = await this.fx.followDeliveryStatus(tx, o, 'sent', { type: 'courier', id: null });
        }
        await this.fx.notify(tx, 'shipment_created', u, o, { stamp: 'created' });
        await this.fx.customerText(tx, o, 'orderShipped', { number: o.number, tracking: r.trackingNumber, courier: courierName });
        if ((await this.capsOf(tx, s)).label) await this.queueOutbox.add(tx, 'courier', 'fetch-label', { shipmentId, workspaceId: s.workspaceId }, `label:${shipmentId}`, { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } });
        await this.fx.emit(tx, u, e as unknown as ShipmentRow['events'][number]);
      },
      { timeout: 20_000 },
    );
    return outcome;
  }

  // --- parcel actions (06 §8.5, 04 §22) -----------------------------------------------------------------------------------
  private async headOf(id: string) {
    const s = await prisma.shipment.findFirst({ where: { id }, select: { id: true, orderId: true } });
    if (!s) throw notFound();
    return s;
  }

  /** `POST /shipments/:id/retry` — a parcel whose creation failed (or is waiting for a retry) is sent again now. */
  async retry(id: string, locale: string) {
    const head = await this.headOf(id);
    await this.orders.inTx(async (tx) => {
      const o = await this.orders.lock(tx, head.orderId);
      const s = await this.fx.lockShipment(tx, id);
      if (s.status === 'pending' && errorCodeOf(s.lastError) === 'COURIER_UNAVAILABLE') {
        await this.enqueueCreate(tx, s, s.attempts + 1, 0, `m${Date.now()}`);
        return;
      }
      if (!isSendFailure(s)) throw new AppException('CONFLICT');
      if (['cancelled', 'returned'].includes(o.status)) throw new AppException('ORDER_TERMINAL');
      if (this.orders.activeShipment(o)) throw new AppException('DELIVERY_ORDER_ALREADY_SENT');
      if (!SEND_STATUSES.includes(o.status)) throw new AppException('ORDER_INVALID_TRANSITION', { from: o.status, to: 'shipped' });
      const account = await this.accounts.resolveForSend(s.courierAccountId, tx);
      const u = await tx.shipment.update({ where: { id }, data: { status: 'pending', attempts: 0, lastError: null, courierAccountId: account.id, lastEventAt: new Date() } });
      const updated = await tx.order.update({ where: { id: o.id }, data: { deliveryStatus: 'pending', version: { increment: 1 } } });
      await this.orders.effects.emitUpdated(tx, updated, ['deliveryStatus']);
      await this.fx.emit(tx, u);
      await this.enqueueCreate(tx, u, 1, 0, `r${Date.now()}`);
    }, locale);
    return this.view(id, locale);
  }

  /** `POST /shipments/:id/change-courier` — failed send / queued parcel / manual parcel: a new parcel with the other courier. */
  async changeCourier(id: string, courierAccountId: string, locale: string) {
    const head = await this.headOf(id);
    const actor = this.orders.actor();
    const newId = await this.orders.inTx(async (tx) => {
      let o = await this.orders.lock(tx, head.orderId);
      const s = await this.fx.lockShipment(tx, id);
      if (['cancelled', 'returned'].includes(o.status)) throw new AppException('ORDER_TERMINAL');
      const queued = s.status === 'pending';
      const manualSent = s.provider === 'manual' && s.status === 'sent';
      if (!isSendFailure(s) && !queued && !manualSent) throw new AppException('COURIER_CANCEL_NOT_ALLOWED');
      if (queued || manualSent) {
        await tx.shipment.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), nextSyncAt: null } });
        await tx.shipmentEvent.create({ data: { shipmentId: id, rawStatus: 'cancelled', mappedStatus: 'cancelled', at: new Date(), source: 'manual', actorId: actor.type === 'user' ? actor.id : null, description: 'change_courier' } });
        o = await this.orders.lock(tx, o.id);
        if (o.status === 'shipped') await this.workflow.transition(tx, o, 'confirmed', { actor, shipmentHandled: true, shipmentNotice: false, notifyCustomer: false });
        else if (o.deliveryStatus !== 'not_sent') await tx.order.update({ where: { id: o.id }, data: { deliveryStatus: 'not_sent' } });
      }
      return this.createPending(tx, o.id, { courierAccountId }, actor);
    }, locale);
    return this.view(newId, locale);
  }

  /**
   * `POST /shipments/:id/cancel { then }` — `pending | sent` only, and the provider must offer cancel (else 409
   * COURIER_CANCEL_NOT_ALLOWED: use "Retournée" at reception). Not yet created / manual ⇒ immediate; at a courier ⇒ job.
   */
  async cancel(id: string, input: CancelShipmentInput, locale: string): Promise<{ view: ShipmentView; queued: boolean }> {
    const head = await this.headOf(id);
    const actor = this.orders.actor();
    let queued = false;
    await this.orders.inTx(async (tx) => {
      const o = await this.orders.lock(tx, head.orderId);
      const s = await this.fx.lockShipment(tx, id);
      if (!['pending', 'sent'].includes(s.status)) throw new AppException('COURIER_CANCEL_NOT_ALLOWED');
      const atCourier = s.status === 'sent' && s.provider !== 'manual' && !!s.trackingNumber;
      if (atCourier && !(await this.capsOf(tx, s)).cancel) throw new AppException('COURIER_CANCEL_NOT_ALLOWED');
      if (input.then === 'cancelled' && !input.reason) throw new AppException('VALIDATION_ERROR', {}, { reason: 'validation.required' });
      if (atCourier) {
        await this.queueOutbox.add(tx, 'courier', 'cancel-parcel', { shipmentId: id, workspaceId: s.workspaceId, then: input.then, reason: input.reason ?? null, note: input.note ?? null, userId: actor.id }, `cancel:${id}`, { attempts: 3, backoff: { type: 'fixed', delay: 60_000 } });
        queued = true;
        return;
      }
      await this.cancelLocally(tx, o, s, { then: input.then, reason: input.reason ?? null, note: input.note ?? null }, actor, 'manual');
    }, locale);
    return { view: await this.view(id, locale), queued };
  }

  /** Parcel cancelled (not created yet, manual, or confirmed by the courier): order back to `confirmed` or cancelled. */
  private async cancelLocally(tx: Tx, o: LockedOrder, s: Shipment, opt: { then: 'confirmed' | 'cancelled'; reason: string | null; note: string | null }, actor: Actor, source: 'manual' | 'system', rawStatus = 'cancelled') {
    const now = new Date();
    const u = await tx.shipment.update({ where: { id: s.id }, data: { status: 'cancelled', cancelledAt: now, nextSyncAt: null, lastEventAt: now } });
    const e = await tx.shipmentEvent.create({ data: { shipmentId: s.id, rawStatus, mappedStatus: 'cancelled', at: now, source, actorId: actor.type === 'user' ? actor.id : null, description: opt.note }, include: { actor: SHIPMENT_INCLUDE.events.include.actor } });
    let order = await this.orders.lock(tx, o.id);
    if (order.status === 'shipped') {
      await this.workflow.transition(tx, order, 'confirmed', { actor, system: true, shipmentHandled: true, shipmentNotice: false, notifyCustomer: false });
    } else if (order.deliveryStatus !== 'not_sent' && SEND_STATUSES.includes(order.status)) {
      const updated = await tx.order.update({ where: { id: order.id }, data: { deliveryStatus: 'not_sent', version: { increment: 1 } } });
      await tx.orderStatusHistory.create({ data: { orderId: order.id, field: 'deliveryStatus', from: order.deliveryStatus, to: 'not_sent', actorType: actor.type, actorId: actor.id, reason: 'parcel_cancelled' } });
      await this.orders.effects.emitUpdated(tx, updated, ['deliveryStatus']);
    }
    if (opt.then === 'cancelled') {
      order = await this.orders.lock(tx, o.id);
      if (!['cancelled', 'returned'].includes(order.status)) await this.workflow.transition(tx, order, 'cancelled', { actor, system: true, reason: opt.reason ?? 'other', note: opt.note });
    }
    await this.fx.emit(tx, u, e as unknown as ShipmentRow['events'][number]);
  }

  /** `courier.cancel-parcel` (3 attempts / 60 s): the courier withdraws the parcel, then the order side. */
  async cancelParcel(data: { shipmentId: string; workspaceId: string; then: 'confirmed' | 'cancelled'; reason?: string | null; note?: string | null; userId?: string | null; withdrawOnly?: boolean }) {
    await TenantContext.runAs(data.workspaceId, async () => {
      const s = await prisma.shipment.findFirst({ where: { id: data.shipmentId } });
      if (!s || !s.trackingNumber || !s.courierAccountId) return;
      if (!data.withdrawOnly && s.status !== 'sent') return;
      const account = await prisma.courierAccount.findFirst({ where: { id: s.courierAccountId } });
      if (!account) return;
      const adapter = this.adapters.get(s.provider, account.baseUrl);
      if (!adapter.cancel) return;
      let raw: string | null | undefined = null;
      try {
        await this.limiter.take(account.id, 'other');
        raw = (await adapter.cancel(this.accounts.open(account), s.trackingNumber)).rawStatus;
      } catch (e) {
        if (!isCourierError(e) || e.kind === 'unavailable') throw e; // BullMQ retries (3 / 60 s)
        await prisma.$transaction(async (db) => {
          const tx = db as Tx;
          const u = await tx.shipment.update({ where: { id: s.id }, data: { lastError: encodeShipmentError(e.kind === 'not_found' ? 'TRACKING_NOT_FOUND' : 'COURIER_CANCEL_NOT_ALLOWED', null, e.message) } });
          await this.fx.emit(tx, u);
        });
        return;
      }
      if (data.withdrawOnly) return;
      const actor: Actor = { type: data.userId ? 'user' : 'system', id: data.userId ?? null };
      await prisma.$transaction(
        async (db) => {
          const tx = db as Tx;
          const o = await this.orders.lock(tx, s.orderId);
          const cur = await this.fx.lockShipment(tx, s.id);
          if (cur.status !== 'sent') return;
          await this.cancelLocally(tx, o, cur, { then: data.then, reason: data.reason ?? null, note: data.note ?? null }, actor, 'system', raw ?? 'cancelled');
        },
        { timeout: 20_000 },
      );
    });
  }

  /** `POST /shipments/:id/retry-delivery` — re-attempt at the courier (attempt +1); unsupported ⇒ 409 COURIER_CANCEL_NOT_ALLOWED. */
  async retryDelivery(id: string, note: string | null | undefined, locale: string) {
    const head = await this.headOf(id);
    const actor = this.orders.actor();
    await this.orders.inTx(async (tx) => {
      await this.orders.lock(tx, head.orderId);
      const s = await this.fx.lockShipment(tx, id);
      if (s.status !== 'failed' || isSendFailure(s)) throw new AppException('CONFLICT');
      if (!(await this.capsOf(tx, s)).retry || !s.trackingNumber) throw new AppException('COURIER_CANCEL_NOT_ALLOWED');
      await this.queueOutbox.add(tx, 'courier', 'retry-delivery', { shipmentId: id, workspaceId: s.workspaceId, userId: actor.id, note: note ?? null }, `retry:${id}:${s.deliveryAttempts}`, { attempts: 3, backoff: { type: 'fixed', delay: 60_000 } });
    }, locale);
    return this.view(id, locale);
  }

  async retryDeliveryJob(data: { shipmentId: string; workspaceId: string; userId?: string | null; note?: string | null }) {
    await TenantContext.runAs(data.workspaceId, async () => {
      const s = await prisma.shipment.findFirst({ where: { id: data.shipmentId } });
      if (!s || s.status !== 'failed' || !s.trackingNumber || !s.courierAccountId) return;
      const account = await prisma.courierAccount.findFirst({ where: { id: s.courierAccountId } });
      if (!account) return;
      const adapter = this.adapters.get(s.provider, account.baseUrl);
      if (!adapter.retryDelivery) return;
      await this.limiter.take(account.id, 'other');
      const r = await adapter.retryDelivery(this.accounts.open(account), s.trackingNumber);
      if (!r.ok) {
        await prisma.$transaction(async (db) => {
          const u = await (db as Tx).shipment.update({ where: { id: s.id }, data: { lastError: encodeShipmentError('COURIER_CANCEL_NOT_ALLOWED') } });
          await this.fx.emit(db as Tx, u);
        });
        return;
      }
      await prisma.$transaction((db) => this.fx.apply(db as Tx, s.id, { rawStatus: 'retry_requested', mapped: 'out_for_delivery', source: 'manual', description: data.note ?? null, actor: { type: data.userId ? 'user' : 'system', id: data.userId ?? null }, force: true, notifyCustomer: true }), { timeout: 20_000 });
    });
  }

  /** `POST /shipments/:id/mark-failed { reason, note? }` — parcel `failed`, order stays `shipped` (409 CONFLICT when closed). */
  async markFailed(id: string, input: MarkFailedInput, locale: string) {
    await this.headOf(id);
    const actor = this.orders.actor();
    await this.orders.inTx(async (tx) => {
      const s = await tx.shipment.findUniqueOrThrow({ where: { id } });
      if (!['sent', 'picked_up', 'in_transit', 'out_for_delivery'].includes(s.status)) throw new AppException('CONFLICT');
      await this.fx.apply(tx, id, { rawStatus: 'failed', mapped: 'failed', failureReason: input.reason, description: input.note ?? null, source: 'manual', actor, force: true });
    }, locale);
    return this.view(id, locale);
  }

  /** `POST /shipments/:id/mark-delivered` — manual delivery (COD rule through the order status machine). */
  async markDelivered(id: string, input: MarkDeliveredInput, locale: string) {
    const head = await this.headOf(id);
    const actor = this.orders.actor();
    await this.orders.inTx(async (tx) => {
      let o = await this.orders.lock(tx, head.orderId);
      const s = await this.fx.lockShipment(tx, id);
      if (o.status === 'delivered' || !['sent', 'picked_up', 'in_transit', 'out_for_delivery', 'failed'].includes(s.status) || isSendFailure(s)) throw new AppException('CONFLICT');
      const at = input.deliveredAt ? new Date(input.deliveredAt) : new Date();
      const u = await tx.shipment.update({ where: { id }, data: { status: 'delivered', lastEventAt: at, nextSyncAt: null } });
      const e = await tx.shipmentEvent.create({ data: { shipmentId: id, rawStatus: 'delivered', mappedStatus: 'delivered', at, source: 'manual', actorId: actor.type === 'user' ? actor.id : null, description: input.reason ?? null }, include: { actor: SHIPMENT_INCLUDE.events.include.actor } });
      o = await this.orders.lock(tx, o.id);
      await this.workflow.transition(tx, o, 'delivered', { actor, amountCollected: input.amountCollected, note: input.reason, effectiveAt: input.deliveredAt ? at : null, notifyCustomer: input.notifyCustomer, shipmentHandled: true });
      await this.fx.emit(tx, u, e as unknown as ShipmentRow['events'][number]);
    }, locale);
    return this.view(id, locale);
  }

  /**
   * `POST /shipments/:id/mark-returned` — "return received" (04 §1.5): order `returned` (stock back unless
   * `restoreStock=false`, return fee as an expense). After a courier-reported return the confirmation is part of the
   * courier flow (no Admin+ check on `delivered → returned`, 04 §1.2 "and courier sync").
   */
  async markReturned(id: string, input: MarkReturnedInput, locale: string) {
    const head = await this.headOf(id);
    const actor = this.orders.actor();
    await this.orders.inTx(async (tx) => {
      let o = await this.orders.lock(tx, head.orderId);
      const s = await this.fx.lockShipment(tx, id);
      if (o.status === 'returned' || o.status === 'cancelled') throw new AppException('ORDER_TERMINAL');
      const courierReturn = s.status === 'returned';
      if (!courierReturn && !['sent', 'picked_up', 'in_transit', 'out_for_delivery', 'failed', 'delivered'].includes(s.status)) throw new AppException('CONFLICT');
      if (isSendFailure(s)) throw new AppException('CONFLICT');
      const reason = input.reason ?? s.failureReason ?? null;
      const now = new Date();
      const u = await tx.shipment.update({ where: { id }, data: { status: 'returned', failureReason: reason, nextSyncAt: null, lastEventAt: now } });
      const e = await tx.shipmentEvent.create({ data: { shipmentId: id, rawStatus: 'return_received', mappedStatus: 'returned', at: now, source: 'manual', actorId: actor.type === 'user' ? actor.id : null, description: input.note ?? null }, include: { actor: SHIPMENT_INCLUDE.events.include.actor } });
      o = await this.orders.lock(tx, o.id);
      await this.workflow.transition(tx, o, 'returned', { actor, system: courierReturn, reason, note: input.note, restoreStock: input.restoreStock, returnFee: input.returnFee, shipmentHandled: true });
      await this.fx.emit(tx, u, e as unknown as ShipmentRow['events'][number]);
    }, locale);
    return this.view(id, locale);
  }

  /** "Actualiser" (04 §22): 1 per 5 min per shipment (`429 TRACKING_SYNC_RATE_LIMITED {retryAfter}`), then a queued sync. */
  async requestSync(id: string, locale: string) {
    const s = await prisma.shipment.findFirst({ where: { id } });
    if (!s) throw notFound();
    if (s.provider === 'manual' || !s.trackingNumber || !s.courierAccountId) throw new AppException('TRACKING_NOT_FOUND');
    const ok = await this.redis.client.set(`trk:manual:${id}`, '1', 'EX', TRACKING_SYNC_COOLDOWN_S, 'NX');
    if (!ok) {
      const ttl = await this.redis.client.ttl(`trk:manual:${id}`);
      throw new AppException('TRACKING_SYNC_RATE_LIMITED', { retryAfter: ttl > 0 ? ttl : TRACKING_SYNC_COOLDOWN_S });
    }
    await prisma.$transaction((db) => this.queueOutbox.add(db as Tx, 'courier', 'track-batch', { courierAccountId: s.courierAccountId, shipmentIds: [id], workspaceId: s.workspaceId, manual: true }, `track:${s.courierAccountId}:manual:${id}:${Date.now()}`, { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } }));
    return this.view(id, locale);
  }

  /** `POST /shipments/bulk/ship-manual { ids }` — "Livraison propre" for several orders (per-row results). */
  bulkShipManual(ids: string[], ctx: BulkCtx) {
    const actor = this.orders.actor();
    return runBulk(this.i18n, ids, ctx, async (id, tx) => {
      const o = await this.orders.lock(tx!, id);
      const updated = await this.workflow.transition(tx!, o, 'shipped', { actor });
      return { status: updated.status, version: updated.version };
    });
  }
}
