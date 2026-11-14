// api-contract §3.8 `ShipmentDto` + the parcel `Actions ⌄` (04 §22, FL-25): pure functions shared by the order page
// (orders presenter) and the delivery screens. No database access.
import { failureHandledAs, renderStoredTextIn, sendClosedCode, SHIPMENT_MAX_ATTEMPTS, SHIPMENT_NO_MOVEMENT_STATUSES, SHIPMENT_STALE_AFTER_DAYS, SHIPMENT_TERMINAL_STATUSES, type ActionDescriptor, type ErrorCode, type AddressView, type ClientRefView, type ShipmentErrorView, type ShipmentEventView, type ShipmentView } from '@djaber/shared';
import { TenantContext, type Shipment } from '@djaber/db';
import { viewerLocale } from '../../core/i18n/viewer-locale';
import { can, type MerchantPermission } from '../../core/rbac/permission-matrix';
import { capabilitiesOf } from './adapters/courier-adapter';
import { dedupeTimeline } from './tracking-rules';

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
export type ShipmentPresentCtx = { publicWebUrl?: string; now?: number; syncAvailableAt?: string | null; portalUrl?: string | null; locale?: string };

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
/** The parcel is not in a state where this action exists (12 GLOBAL, UX-060): the item is not offered at all. */
const NOT_OFFERED = 'NOT_OFFERED' as const;
/** A parcel-action refusal: a catalogue code, or « not offered » (the state does not have this action). */
export type ParcelRefusal = ErrorCode | typeof NOT_OFFERED;
const act = (key: string, permission: MerchantPermission, o: { reasonCode?: string | null; reasonParams?: Record<string, string | number>; primary?: boolean } = {}): ActionDescriptor | null => {
  if (o.reasonCode === NOT_OFFERED) return null;
  const reasonCode = !allowed(permission) ? 'FORBIDDEN' : (o.reasonCode ?? undefined);
  const params = reasonCode && reasonCode !== 'FORBIDDEN' ? o.reasonParams : undefined;
  return { key, enabled: !reasonCode, ...(reasonCode ? { reasonCode } : {}), ...(params ? { reasonParams: params } : {}), ...(o.primary ? { primary: true } : {}) };
};

/** Send failure (the courier never created the parcel): retry / change courier. */
export const isSendFailure = (s: Pick<Shipment, 'status' | 'trackingNumber'>) => s.status === 'failed' && !s.trackingNumber;

type ParcelState = Pick<Shipment, 'provider' | 'status' | 'trackingNumber'>;
type Caps = { cancel: boolean; retry: boolean };
/** The courier holds the parcel and it has not left the merchant yet (CRÉÉ). */
const createdAtCourier = (s: ParcelState) => s.status === 'sent' && s.provider !== 'manual' && !!s.trackingNumber;
/** The parcel left the merchant (picked up … failed attempt, or no news for 30 days): only « Retournée » at reception undoes it. */
const pastPickup = (s: ParcelState) => ['picked_up', 'in_transit', 'out_for_delivery', 'stale'].includes(s.status) || (s.status === 'failed' && !isSendFailure(s));

/**
 * 04 §22 « Annuler le colis » — one rule for the menu (`shipmentActions`) and the service (POST /shipments/:id/cancel).
 * null = allowed · `COURIER_CANCEL_UNSUPPORTED` = created at a courier whose API has no cancel (cancel it in the courier's
 * space / by phone) · `COURIER_CANCEL_NOT_ALLOWED` = already picked up (use « Retournée ») · NOT_OFFERED = nothing to
 * cancel (failed send, delivered, returned, cancelled). UX-056 remark (12/11): a CRÉÉ parcel of ZR Express said « Colis
 * déjà ramassé » — the reason now matches the state.
 */
export const cancelRefusal = (s: ParcelState, caps: Caps): ParcelRefusal | null => {
  if (s.status === 'pending' || s.status === 'sent') return createdAtCourier(s) && !caps.cancel ? 'COURIER_CANCEL_UNSUPPORTED' : null;
  return pastPickup(s) ? 'COURIER_CANCEL_NOT_ALLOWED' : NOT_OFFERED;
};

/**
 * « Changer de transporteur » (04 §22): a failed send, a parcel queued at Djaber, or a manual parcel gets a new parcel
 * with the other courier. A parcel created at a courier is cancelled first (`SHIPMENT_CANCEL_FIRST`, or
 * `COURIER_CANCEL_UNSUPPORTED` when that courier's API cannot cancel); after pickup `COURIER_CANCEL_NOT_ALLOWED`; a parcel
 * delivered / returned / cancelled has nothing to change (not offered).
 */
export const changeCourierRefusal = (s: ParcelState, caps: Caps): ParcelRefusal | null => {
  if (isSendFailure(s) || s.status === 'pending' || (s.status === 'sent' && s.provider === 'manual')) return null;
  if (createdAtCourier(s)) return caps.cancel ? 'SHIPMENT_CANCEL_FIRST' : 'COURIER_CANCEL_UNSUPPORTED';
  return pastPickup(s) ? 'COURIER_CANCEL_NOT_ALLOWED' : NOT_OFFERED;
};

/** « Relancer la livraison » (a failed attempt after pickup): the courier's API must offer it (`COURIER_RETRY_UNSUPPORTED`). */
export const retryDeliveryRefusal = (s: ParcelState, caps: Caps): ParcelRefusal | null => {
  if (s.status !== 'failed' || isSendFailure(s)) return NOT_OFFERED;
  return caps.retry && !!s.trackingNumber ? null : 'COURIER_RETRY_UNSUPPORTED';
};
/** The not-offered marker of the rules above (the service answers 409 CONFLICT: the parcel moved on meanwhile). */
export const isNotOfferedRefusal = (code: ParcelRefusal | null): code is typeof NOT_OFFERED => code === NOT_OFFERED;

/**
 * Parcel menu (04 §22): sync · label · retry (failed send) · retry_delivery · change_courier · cancel · mark_failed ·
 * mark_delivered · mark_returned · open_order · call_client. At 3 failed attempts "mark_returned" becomes primary.
 * UX-064: on an order delivered / cancelled / returned the send items (retry, change_courier) are not offered
 * (`DELIVERY_ORDER_<STATUS>` is a not-offered reason, same refusal as the services).
 * UX-060 (retest 12/11): an action the parcel's state does not allow (retry of a parcel that did not fail, mark delivered
 * on a parcel not on its way…) is left out instead of greyed « Changed meanwhile, please reload. »; the wait of « Actualiser »
 * travels as `reasonParams.retryAfter` (seconds) — on the delivery list rows too (UX-056 leftovers, 14/11).
 * UX-056 leftovers (14/11): every greyed reason says why in this state — « Actualiser » of a manual parcel or of a finished
 * one (delivered / returned / cancelled) and « Bordereau » of a cancelled parcel are not offered (nothing to refresh or
 * print) instead of « Suivi introuvable » / « Commande clôturée » / « Pas de colis créé ».
 */
export const shipmentActions = (s: Pick<Shipment, 'provider' | 'status' | 'trackingNumber' | 'lastError' | 'deliveryAttempts'> & { courierAccount?: { baseUrl?: string } | null }, order: { status: string }, o: { syncAvailableAt?: string | null; now?: number } = {}): ActionDescriptor[] => {
  const caps = capabilitiesOf(s.provider, s.courierAccount?.baseUrl);
  const courier = s.provider !== 'manual';
  const terminal = (SHIPMENT_TERMINAL_STATUSES as readonly string[]).includes(s.status);
  const sendFailed = isSendFailure(s);
  const created = !!s.trackingNumber && s.status !== 'pending';
  const closedCode = sendClosedCode(order.status);
  const orderClosed = !!closedCode;
  const now = o.now ?? Date.now();
  const coolingDown = !!o.syncAvailableAt && new Date(o.syncAvailableAt).getTime() > now;
  const retryAfter = coolingDown ? Math.max(1, Math.ceil((new Date(o.syncAvailableAt!).getTime() - now) / 1000)) : 0;
  const queued = s.status === 'pending' && errorCodeOf(s.lastError) === 'COURIER_UNAVAILABLE';
  const proposeReturn = s.status === 'failed' && !sendFailed && s.deliveryAttempts >= SHIPMENT_MAX_ATTEMPTS;
  const inFlight = ['sent', 'picked_up', 'in_transit', 'out_for_delivery', 'failed'].includes(s.status) && !sendFailed;
  // a manual parcel prints Djaber's own slip (label.service): « Bordereau » exists once it is sent, with or without a tracking
  const printable = created || (!courier && !['pending', 'failed'].includes(s.status));
  const list = [
    act('sync', 'delivery.send', { reasonCode: !courier || terminal ? NOT_OFFERED : !created ? 'SHIPMENT_NOT_CREATED' : coolingDown ? 'TRACKING_SYNC_RATE_LIMITED' : null, reasonParams: coolingDown ? { retryAfter } : undefined }),
    act('label', 'delivery.send', { reasonCode: s.status === 'cancelled' ? NOT_OFFERED : printable ? null : 'SHIPMENT_NOT_CREATED' }),
    act('retry', 'delivery.send', { reasonCode: orderClosed ? NOT_OFFERED : sendFailed || queued ? null : NOT_OFFERED, primary: sendFailed && !orderClosed }),
    act('retry_delivery', 'delivery.send', { reasonCode: retryDeliveryRefusal(s, caps), primary: s.status === 'failed' && !sendFailed && caps.retry && !proposeReturn }),
    act('change_courier', 'delivery.send', { reasonCode: orderClosed ? NOT_OFFERED : changeCourierRefusal(s, caps) }),
    act('cancel', 'delivery.send', { reasonCode: cancelRefusal(s, caps) }),
    act('mark_failed', 'delivery.send', { reasonCode: ['sent', 'picked_up', 'in_transit', 'out_for_delivery'].includes(s.status) ? null : NOT_OFFERED }),
    act('mark_delivered', 'orders.write', { reasonCode: order.status === 'delivered' || terminal || !inFlight ? NOT_OFFERED : null }),
    act('mark_returned', order.status === 'delivered' && s.status !== 'returned' ? 'orders.money' : 'orders.write', { reasonCode: order.status === 'returned' || order.status === 'cancelled' ? 'ORDER_TERMINAL' : inFlight || s.status === 'returned' || (s.status === 'delivered' && order.status === 'delivered') ? null : NOT_OFFERED, primary: proposeReturn || s.status === 'returned' }),
    act('open_order', 'orders.read'),
    act('call_client', 'orders.write'),
  ].filter((a): a is ActionDescriptor => !!a);
  return [...list.filter((a) => a.primary), ...list.filter((a) => !a.primary)];
};

/** One timeline line; a description Djaber stored as a key (« changement de transporteur », stale) is read in `locale`. */
export const presentShipmentEvent = (e: ShipmentRow['events'][number], locale?: string): ShipmentEventView => ({
  at: e.at.toISOString(),
  rawStatus: e.rawStatus,
  mappedStatus: e.mappedStatus,
  description: locale ? renderStoredTextIn(e.description, locale) : e.description,
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
    failureHandled: failureHandledAs(s.status, order.status),
    labelSource: s.labelUrl || (caps.label && s.provider !== 'manual') ? 'courier' : 'djaber',
    events: dedupeTimeline(s.events).map((e) => presentShipmentEvent(e, ctx.locale ?? viewerLocale())),
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
