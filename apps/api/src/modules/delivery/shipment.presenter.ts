// api-contract §3.8 `ShipmentDto` + the parcel `Actions ⌄` (04 §22, FL-25): pure functions shared by the order page
// (orders presenter) and the delivery screens. No database access.
import { SHIPMENT_MAX_ATTEMPTS, SHIPMENT_NO_MOVEMENT_STATUSES, SHIPMENT_STALE_AFTER_DAYS, SHIPMENT_TERMINAL_STATUSES, type ActionDescriptor, type AddressView, type ClientRefView, type ShipmentErrorView, type ShipmentEventView, type ShipmentView } from '@djaber/shared';
import { TenantContext, type Shipment } from '@djaber/db';
import { can, type MerchantPermission } from '../../core/rbac/permission-matrix';
import { capabilitiesOf } from './adapters/courier-adapter';

const DAY = 86_400_000;
export const userRefSelect = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } as const;

/** Prisma include of a shipment as the presenter reads it. */
export const SHIPMENT_INCLUDE = {
  courierAccount: { select: { id: true, displayName: true, baseUrl: true } },
  events: { orderBy: [{ at: 'desc' as const }, { createdAt: 'desc' as const }], include: { actor: userRefSelect } },
};

export type ShipmentRow = Shipment & {
  /** `baseUrl` picks the ZR Express platform (capabilities); not sent to the client */
  courierAccount: { id: string; displayName: string; baseUrl?: string } | null;
  events: { at: Date; rawStatus: string; mappedStatus: ShipmentView['status'] | null; description: string | null; location: string | null; source: string; actor: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null }[];
};
export type ShipmentOrderLike = { id: string; number: string; status: string; clientPhone?: string | null };
export type ShipmentPresentCtx = { publicWebUrl?: string; now?: number; syncAvailableAt?: string | null; portalUrl?: string | null };

/** `Shipment.lastError` = `CODE` or `CODE|field|message` (courier validation errors keep the field for the dialog). */
export const encodeShipmentError = (code: string, field?: string | null, message?: string | null) => [code, field ?? '', (message ?? '').replace(/\|/g, '/').slice(0, 400)].join('|').replace(/\|+$/, '');
export const parseShipmentError = (raw: string | null | undefined): ShipmentErrorView | null => {
  if (!raw) return null;
  const [code, field, ...rest] = raw.split('|');
  return { code: code ?? raw, field: field || null, message: rest.join('|') || null };
};
/** Courier field → send-dialog field + validation key (`fields` of the error envelope, AT-DLV-02). */
const COURIER_FIELD_INPUT: Record<string, [string, string]> = {
  commune: ['communeId', 'validation.commune'],
  wilaya: ['wilayaId', 'validation.wilaya'],
  address: ['address', 'validation.address'],
  phone: ['clientPhone', 'validation.phone'],
  stopdesk: ['stopdeskId', 'validation.required'],
  weight: ['weightKg', 'validation.range'],
  cod: ['codAmount', 'validation.price'],
};
export const courierFieldErrors = (field: string | null | undefined): Record<string, string> | null => {
  const m = field ? COURIER_FIELD_INPUT[field] : undefined;
  return m ? { [m[0]]: m[1] } : null;
};
export const errorCodeOf = (raw: string | null | undefined) => parseShipmentError(raw)?.code ?? null;

/** "Sans mouvement" (04 §22). */
export const isNoMovement = (s: Pick<Shipment, 'status' | 'lastEventAt' | 'createdAt'>, now = Date.now()) =>
  (SHIPMENT_NO_MOVEMENT_STATUSES as readonly string[]).includes(s.status) && now - (s.lastEventAt ?? s.createdAt).getTime() > SHIPMENT_STALE_AFTER_DAYS * DAY;

/** The courier reported a return; the order turns `returned` when the merchant confirms reception (04 §1.5). */
export const isReturnPending = (s: Pick<Shipment, 'status'>, orderStatus: string) => s.status === 'returned' && orderStatus !== 'returned';

const allowed = (permission: MerchantPermission) => can(TenantContext.maybe()?.role, permission);
const act = (key: string, permission: MerchantPermission, o: { reasonCode?: string | null; primary?: boolean } = {}): ActionDescriptor => {
  const reasonCode = !allowed(permission) ? 'FORBIDDEN' : (o.reasonCode ?? undefined);
  return { key, enabled: !reasonCode, ...(reasonCode ? { reasonCode } : {}), ...(o.primary ? { primary: true } : {}) };
};

/** Send failure (the courier never created the parcel): retry / change courier. */
export const isSendFailure = (s: Pick<Shipment, 'status' | 'trackingNumber'>) => s.status === 'failed' && !s.trackingNumber;

/**
 * Parcel menu (04 §22): sync · label · retry (failed send) · retry_delivery · change_courier · cancel · mark_failed ·
 * mark_delivered · mark_returned · open_order · call_client. At 3 failed attempts "mark_returned" becomes primary.
 */
export const shipmentActions = (s: Pick<Shipment, 'provider' | 'status' | 'trackingNumber' | 'lastError' | 'deliveryAttempts'> & { courierAccount?: { baseUrl?: string } | null }, order: { status: string }, o: { syncAvailableAt?: string | null; now?: number } = {}): ActionDescriptor[] => {
  const caps = capabilitiesOf(s.provider, s.courierAccount?.baseUrl);
  const courier = s.provider !== 'manual';
  const terminal = (SHIPMENT_TERMINAL_STATUSES as readonly string[]).includes(s.status);
  const sendFailed = isSendFailure(s);
  const created = !!s.trackingNumber && s.status !== 'pending';
  const orderClosed = ['cancelled', 'returned'].includes(order.status);
  const now = o.now ?? Date.now();
  const coolingDown = !!o.syncAvailableAt && new Date(o.syncAvailableAt).getTime() > now;
  const queued = s.status === 'pending' && errorCodeOf(s.lastError) === 'COURIER_UNAVAILABLE';
  const proposeReturn = s.status === 'failed' && !sendFailed && s.deliveryAttempts >= SHIPMENT_MAX_ATTEMPTS;
  const inFlight = ['sent', 'picked_up', 'in_transit', 'out_for_delivery', 'failed'].includes(s.status) && !sendFailed;
  const list: ActionDescriptor[] = [
    act('sync', 'delivery.send', { reasonCode: !courier ? 'TRACKING_NOT_FOUND' : !created ? 'SHIPMENT_NOT_CREATED' : terminal ? 'ORDER_TERMINAL' : coolingDown ? 'TRACKING_SYNC_RATE_LIMITED' : null }),
    act('label', 'delivery.send', { reasonCode: !created || s.status === 'cancelled' ? 'SHIPMENT_NOT_CREATED' : null }),
    act('retry', 'delivery.send', { reasonCode: sendFailed || queued ? (orderClosed ? 'ORDER_TERMINAL' : null) : 'CONFLICT', primary: sendFailed && !orderClosed }),
    act('retry_delivery', 'delivery.send', { reasonCode: s.status !== 'failed' || sendFailed ? 'CONFLICT' : caps.retry ? null : 'COURIER_CANCEL_NOT_ALLOWED', primary: s.status === 'failed' && !sendFailed && caps.retry && !proposeReturn }),
    act('change_courier', 'delivery.send', { reasonCode: orderClosed ? 'ORDER_TERMINAL' : sendFailed || queued || (s.status === 'sent' && !courier) ? null : 'COURIER_CANCEL_NOT_ALLOWED' }),
    act('cancel', 'delivery.send', { reasonCode: !['pending', 'sent'].includes(s.status) ? 'COURIER_CANCEL_NOT_ALLOWED' : s.status === 'sent' && courier && !caps.cancel ? 'COURIER_CANCEL_NOT_ALLOWED' : null }),
    act('mark_failed', 'delivery.send', { reasonCode: ['sent', 'picked_up', 'in_transit', 'out_for_delivery'].includes(s.status) ? null : 'CONFLICT' }),
    act('mark_delivered', 'orders.write', { reasonCode: order.status === 'delivered' || terminal || !inFlight ? 'CONFLICT' : null }),
    act('mark_returned', order.status === 'delivered' && s.status !== 'returned' ? 'orders.money' : 'orders.write', { reasonCode: order.status === 'returned' || order.status === 'cancelled' ? 'ORDER_TERMINAL' : inFlight || s.status === 'returned' || (s.status === 'delivered' && order.status === 'delivered') ? null : 'CONFLICT', primary: proposeReturn || s.status === 'returned' }),
    act('open_order', 'orders.read'),
    act('call_client', 'orders.write'),
  ];
  return [...list.filter((a) => a.primary), ...list.filter((a) => !a.primary)];
};

export const presentShipmentEvent = (e: ShipmentRow['events'][number]): ShipmentEventView => ({
  at: e.at.toISOString(),
  rawStatus: e.rawStatus,
  mappedStatus: e.mappedStatus,
  description: e.description,
  location: e.location,
  source: e.source,
  actor: e.actor,
});

export const presentShipment = (s: ShipmentRow, order: ShipmentOrderLike, client: ClientRefView, address: AddressView | null, ctx: ShipmentPresentCtx): ShipmentView => {
  const now = ctx.now ?? Date.now();
  const caps = capabilitiesOf(s.provider, s.courierAccount?.baseUrl);
  return {
    id: s.id,
    orderId: order.id,
    orderNumber: order.number,
    client,
    provider: s.provider,
    courierAccount: s.courierAccount ? { id: s.courierAccount.id, displayName: s.courierAccount.displayName } : null,
    status: s.status,
    trackingNumber: s.trackingNumber,
    labelUrl: null,
    publicTrackingUrl: `${(ctx.publicWebUrl ?? '').replace(/\/$/, '')}/s/${s.publicTrackingToken}`,
    codAmount: s.codAmount,
    weightKg: s.weightKg === null ? null : Number(s.weightKg),
    contentSummary: s.contentSummary,
    address: address ? { ...address, stopdeskId: s.stopdeskId ?? address.stopdeskId } : { wilayaId: 0, wilayaName: '', communeId: null, communeText: null, address: null, isStopdesk: false, stopdeskId: s.stopdeskId },
    courierCost: s.courierCost,
    failureReason: s.failureReason,
    deliveryAttempts: s.deliveryAttempts,
    lastError: errorCodeOf(s.lastError),
    error: parseShipmentError(s.lastError),
    lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
    syncAvailableAt: ctx.syncAvailableAt ?? null,
    portalUrl: ctx.portalUrl ?? null,
    lastEventAt: (s.lastEventAt ?? s.createdAt).toISOString(),
    noMovement: isNoMovement(s, now),
    returnPending: isReturnPending(s, order.status),
    labelSource: s.labelUrl || (caps.label && s.provider !== 'manual') ? 'courier' : 'djaber',
    events: s.events.map(presentShipmentEvent),
    createdAt: s.createdAt.toISOString(),
    actions: shipmentActions(s, order, { syncAvailableAt: ctx.syncAvailableAt, now }),
  };
};

/** WS `shipment.updated` payload (03-events §2). */
export const shipmentUpdatedPayload = (s: Pick<Shipment, 'id' | 'orderId' | 'status' | 'trackingNumber' | 'failureReason' | 'lastSyncedAt' | 'labelUrl' | 'lastError'>, event?: ShipmentRow['events'][number] | null) => ({
  id: s.id,
  shipment: { id: s.id, orderId: s.orderId, status: s.status, trackingNumber: s.trackingNumber, failureReason: s.failureReason, lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null, labelUrl: null, lastError: errorCodeOf(s.lastError) },
  ...(event ? { event: presentShipmentEvent(event) } : {}),
});
