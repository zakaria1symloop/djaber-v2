// What a parcel status does (04 §1.5, §22, 03-events §5.1, 05-integrations §2.6), in the caller's transaction: the
// ShipmentEvent, the parcel row, the order's `deliveryStatus` (never backwards), the order transitions through
// `OrderWorkflowService.transition` (`delivered` ⇒ COD rule via OrderEffects), the team notifications
// (`shipment.*`), the customer transactional texts (MSG-06: shipped / out for delivery / delivered / failed) and the WS
// `shipment.updated` event. Used by the tracking sync, the courier webhook, the send processor and the manual marks.
import { Injectable, Optional } from '@nestjs/common';
import { SHIPMENT_TRACKED_STATUSES, type FailureReasonCode, type ShipmentStatusName } from '@djaber/shared';
import { TenantContext, type NotificationType, type Prisma, type Shipment, type ShipmentEventSource, type Tx } from '@djaber/db';
import { I18nService } from '../../core/i18n/i18n.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { OutboxService } from '../../core/outbox/outbox.service';
import type { Actor } from '../orders/order-effects.service';
import { OrderService } from '../orders/order.service';
import { OrderWorkflowService, type LockedOrder } from '../orders/order-workflow.service';
import { PROVIDER_NAMES, type CourierProvider } from './adapters/courier-adapter';
import { SHIPMENT_INCLUDE, shipmentUpdatedPayload, type ShipmentRow } from './shipment.presenter';
import { attemptsAfter, decideStatus, isKnownCourierEvent, nextSyncAt, orderDeliveryStatusAfter } from './tracking-rules';

export type CourierUpdate = {
  rawStatus: string;
  mapped: ShipmentStatusName | null;
  failureReason?: FailureReasonCode | null;
  at?: string | Date | null;
  location?: string | null;
  description?: string | null;
  source: ShipmentEventSource;
  actor?: Actor;
  /** manual marks: the status applies whatever the courier order says */
  force?: boolean;
  /** no customer text (merchant unticked "Prévenir le client") */
  notifyCustomer?: boolean;
};

const TERMINAL_SYNC: ShipmentStatusName[] = ['delivered', 'returned', 'cancelled', 'stale'];

@Injectable()
export class ShipmentEffects {
  constructor(
    readonly orders: OrderService,
    readonly workflow: OrderWorkflowService,
    private readonly outbox: OutboxService,
    private readonly i18n: I18nService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /** Row lock of a parcel (after its order: orders are always locked first — one lock order everywhere). */
  async lockShipment(tx: Tx, id: string): Promise<Shipment> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Shipment" WHERE "id" = ${id}::uuid AND "workspaceId" = ${TenantContext.workspaceId()}::uuid FOR UPDATE`;
    if (!rows.length) throw new Error(`shipment ${id} not found`);
    return tx.shipment.findUniqueOrThrow({ where: { id } });
  }

  async emit(tx: Tx, s: Shipment, event?: ShipmentRow['events'][number] | null) {
    await this.outbox.ws(tx, `ws:${s.workspaceId}`, 'shipment.updated', shipmentUpdatedPayload(s, event), `shipment.updated:${s.id}:${s.status}:${s.updatedAt.getTime()}:${event ? event.at.getTime() : 0}`);
  }

  courierName(s: Pick<Shipment, 'provider'> & { courierAccount?: { displayName: string } | null }) {
    return s.courierAccount?.displayName ?? PROVIDER_NAMES[s.provider as CourierProvider] ?? s.provider;
  }

  reasonLabel(reason: string | null | undefined, locale = 'fr') {
    if (!reason) return '';
    if (reason === 'courier_unavailable') return this.i18n.t(locale, 'error.COURIER_UNAVAILABLE');
    const label = this.i18n.t(locale, `enum.Shipment.failureReason.${reason}`);
    return label.charAt(0) + label.slice(1).toLowerCase();
  }

  /** Team notification of a parcel event (03-events §5.1); one per (type, shipment, status-change stamp). */
  async notify(tx: Tx, type: NotificationType, s: Shipment & { courierAccount?: { displayName: string } | null }, o: { id: string; number: string; workspaceId: string }, extra: Record<string, unknown> = {}, exceptUserId: string | null = null) {
    const data: Record<string, unknown> = { orderId: o.id, shipmentId: s.id, number: o.number, ...extra };
    if (type === 'shipment_created') Object.assign(data, { trackingNumber: s.trackingNumber, tracking: s.trackingNumber ?? '—' });
    // `reason` = the code (FailureReason or `courier_unavailable`); the notification renders it localized
    if (type === 'shipment_failed') Object.assign(data, { failureReason: s.failureReason, courier: this.courierName(s), reason: (extra.reason as string | undefined) ?? s.failureReason ?? 'other' });
    if (type === 'shipment_returned') Object.assign(data, { failureReason: s.failureReason });
    await this.orders.effects.notify(tx, type, { workspaceId: o.workspaceId, key: `${type}:${s.id}:${s.deliveryAttempts}:${(extra.stamp as string | undefined) ?? s.status}`, data, exceptUserId });
  }

  /** Customer transactional text on the order's conversation (MSG-06 rules in OutboundSendService). */
  customerText(tx: Tx, o: Pick<LockedOrder, 'conversationId'>, key: 'orderShipped' | 'orderOutForDelivery' | 'orderDelivered' | 'orderFailed', params: Record<string, string | number>) {
    return this.orders.effects.customerText(tx, o, key, params);
  }

  /** Order `deliveryStatus` follows the parcel (never backwards) — with its history row and WS event. */
  async followDeliveryStatus(tx: Tx, o: LockedOrder, status: ShipmentStatusName, actor: Actor) {
    const next = orderDeliveryStatusAfter(o.deliveryStatus, status);
    if (!next) return o;
    const updated = await tx.order.update({ where: { id: o.id }, data: { deliveryStatus: next as never, version: { increment: 1 } } });
    await tx.orderStatusHistory.create({ data: { orderId: o.id, field: 'deliveryStatus', from: o.deliveryStatus, to: next, actorType: actor.type, actorId: actor.id } });
    await this.orders.effects.emitUpdated(tx, updated, ['deliveryStatus']);
    await this.orders.effects.sheets(tx, updated);
    return this.orders.lock(tx, o.id);
  }

  /**
   * Applies a courier (or manual) status to a parcel. Unknown raw ⇒ event stored, status unchanged; same status ⇒ only
   * the sync stamps (and a new event when the courier reports something new); a change ⇒ status, attempts, failure
   * reason and the order side. Returns whether the parcel status changed.
   */
  async apply(tx: Tx, shipmentId: string, u: CourierUpdate): Promise<{ changed: boolean; shipment: Shipment }> {
    const head = await tx.shipment.findFirst({ where: { id: shipmentId }, select: { orderId: true } });
    if (!head) throw new Error(`shipment ${shipmentId} not found`);
    let o = await this.orders.lock(tx, head.orderId);
    const s = await this.lockShipment(tx, shipmentId);
    const now = new Date();
    const at = u.at ? new Date(u.at) : now;
    const courierSource = u.source === 'poll' || u.source === 'webhook';
    // UX-056 remark: a courier report is a new line only when the timeline does not hold it yet (every event, not the newest)
    const known = courierSource ? await tx.shipmentEvent.findMany({ where: { shipmentId }, select: { rawStatus: true, mappedStatus: true, at: true } }) : [];
    const isNewEvent = !courierSource || !isKnownCourierEvent(known, { rawStatus: u.rawStatus, mapped: u.mapped, at: u.at ? at : null }, s.rawStatus);
    const decision = u.force ? { change: !!u.mapped && s.status !== u.mapped, reason: 'forward' as const } : decideStatus(s.status, u.mapped);
    // M6 carry-over: raw courier statuses without a mapping are stored as events with `mappedStatus = null` and counted
    if (courierSource && !u.mapped) this.metrics?.courierUnknown(s.provider, u.rawStatus);
    const repeatFailure = !decision.change && s.status === 'failed' && u.mapped === 'failed' && isNewEvent && courierSource;

    let event: ShipmentRow['events'][number] | null = null;
    if (isNewEvent || decision.change) {
      const e = await tx.shipmentEvent.create({
        data: { shipmentId, rawStatus: u.rawStatus, mappedStatus: u.mapped, description: u.description ?? null, location: u.location ?? null, at, source: u.source, actorId: u.actor?.type === 'user' ? u.actor.id : null },
        include: { actor: SHIPMENT_INCLUDE.events.include.actor },
      });
      event = e as unknown as ShipmentRow['events'][number];
    }

    const data: Prisma.ShipmentUncheckedUpdateInput = {};
    if (courierSource) {
      data.rawStatus = u.rawStatus;
      data.lastSyncedAt = now;
      data.lastError = null;
    }
    if (event && (!s.lastEventAt || at > s.lastEventAt)) data.lastEventAt = at;
    const next = decision.change ? u.mapped! : s.status;
    if (decision.change) {
      data.status = next;
      data.deliveryAttempts = attemptsAfter(s.status, next, s.deliveryAttempts);
      if (next === 'failed') data.failureReason = u.failureReason ?? 'other';
      if (next === 'cancelled') data.cancelledAt = now;
    } else if (repeatFailure) {
      data.deliveryAttempts = s.deliveryAttempts + 1;
      if (u.failureReason) data.failureReason = u.failureReason;
    }
    if (courierSource || decision.change) data.nextSyncAt = (SHIPMENT_TRACKED_STATUSES as readonly string[]).includes(next) && !TERMINAL_SYNC.includes(next) ? nextSyncAt(s.createdAt, now) : null;
    const updated = Object.keys(data).length ? await tx.shipment.update({ where: { id: shipmentId }, data, include: { courierAccount: { select: { displayName: true } } } }) : { ...s, courierAccount: null };

    if (decision.change || repeatFailure) {
      const actor: Actor = u.actor ?? { type: 'courier', id: null };
      const exceptUserId = actor.type === 'user' ? actor.id : null;
      const notifyCustomer = u.notifyCustomer !== false;
      o = await this.followDeliveryStatus(tx, o, next, actor);
      const stamp = `${next}:${updated.deliveryAttempts}`;
      switch (next) {
        case 'out_for_delivery':
          await this.notify(tx, 'shipment_out_for_delivery', updated, o, { stamp }, exceptUserId);
          if (notifyCustomer) await this.customerText(tx, o, 'orderOutForDelivery', { number: o.number });
          break;
        case 'delivered':
          if (['shipped', 'confirmed', 'preparing'].includes(o.status)) {
            await this.workflow.transition(tx, o, 'delivered', { actor, system: true, shipmentHandled: true, shipmentNotice: false, notifyCustomer, effectiveAt: at <= now && now.getTime() - at.getTime() < 7 * 86_400_000 ? at : null });
          }
          await this.notify(tx, 'shipment_delivered', updated, o, { stamp }, exceptUserId);
          break;
        case 'failed':
          await this.notify(tx, 'shipment_failed', updated, o, { stamp }, exceptUserId);
          if (notifyCustomer) await this.customerText(tx, o, 'orderFailed', { number: o.number, reason: this.reasonLabel(updated.failureReason).toLowerCase() });
          break;
        case 'returned':
          await this.notify(tx, 'shipment_returned', updated, o, { stamp }, exceptUserId);
          break;
        default:
          break;
      }
    }
    await this.emit(tx, updated as Shipment, event);
    return { changed: decision.change, shipment: updated as Shipment };
  }
}
