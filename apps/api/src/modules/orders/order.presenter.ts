// api-contract §2, §3.7 — read models of an order (list row, detail, WS summary) and the `Actions ⌄` descriptors
// (D42: current-state items, first = primary, forbidden ones greyed with their code; LST-01 shortcuts).
import { ORDER_READ_ONLY_STATUSES, SHIPMENT_STALE_AFTER_DAYS, type ActionDescriptor, type AddressView, type ClientRefView, type OrderListItemView, type OrderStatusName, type OrderSummary, type OrderUserRef, type OrderView, type SourceBadge } from '@djaber/shared';
import { TenantContext, type Order, type Prisma } from '@djaber/db';
import { can, type MerchantPermission } from '../../core/rbac/permission-matrix';
import { thumbUrlOf } from '../catalog/product-image.util';
import { presentShipment, type ShipmentRow } from '../delivery/shipment.presenter';
import { channelRef } from '../channels/channel.service';
import { allowedTargets, checkTransition, isTerminal, type OrderState } from './order-rules';

const userRef = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } as const;
export const ACTIVE_SHIPMENT = ['pending', 'sent', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'] as const;
const DAY = 86_400_000;

export const ORDER_LIST_INCLUDE = {
  client: { select: { id: true, name: true, phone: true, riskLevel: true, isPlaceholder: true, orderCount: true } },
  channel: { select: { id: true, platform: true, name: true, avatarUrl: true, status: true } },
  agent: { select: { id: true, name: true, status: true } },
  createdBy: userRef,
  assignee: userRef,
  apiKey: { select: { name: true } },
  importJob: { select: { id: true, payload: true, createdAt: true } },
  wilaya: { select: { id: true, nameFr: true, nameAr: true } },
  items: { select: { productName: true, variantName: true, quantity: true }, orderBy: { id: 'asc' } },
  shipments: {
    where: { status: { in: [...ACTIVE_SHIPMENT] } },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, provider: true, trackingNumber: true, status: true, createdAt: true, lastEventAt: true, events: { orderBy: { at: 'desc' }, take: 1, select: { at: true } } },
  },
} satisfies Prisma.OrderInclude;
export type OrderListRow = Prisma.OrderGetPayload<{ include: typeof ORDER_LIST_INCLUDE }>;

export const ORDER_DETAIL_INCLUDE = {
  ...ORDER_LIST_INCLUDE,
  commune: { select: { id: true, nameFr: true, nameAr: true } },
  items: {
    orderBy: { id: 'asc' },
    include: {
      product: { select: { id: true, name: true, sku: true, price: true, hasVariants: true, trackStock: true, stock: true, images: { where: { isPrimary: true }, take: 1, select: { url: true } } } },
      variant: { select: { id: true, stock: true } },
    },
  },
  history: { orderBy: [{ at: 'desc' }, { id: 'desc' }] },
  calls: { orderBy: [{ calledAt: 'desc' }, { id: 'desc' }], include: { user: userRef } },
  orderNotes: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { author: userRef } },
  shipments: {
    orderBy: { createdAt: 'desc' },
    include: { courierAccount: { select: { id: true, displayName: true, baseUrl: true } }, events: { orderBy: { at: 'desc' }, include: { actor: userRef } } },
  },
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
  sheetsRow: { select: { syncedAt: true } },
} satisfies Prisma.OrderInclude;
export type OrderDetailRow = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;

export type PresentCtx = {
  locale: 'fr' | 'ar' | 'en';
  /** client ids / phones under an active block (BlockIndex) */
  blocked: (clientId: string, phone: string | null) => boolean;
  /** a courier account exists (enables "Envoyer au transporteur") */
  hasCourier?: boolean;
  /** M9: `Workspace.onlinePaymentEnabled` (enables "Lien de paiement", PAY-02) */
  onlinePayment?: boolean;
  publicWebUrl?: string;
  /** "Actualiser" cool-down per shipment id (manual sync 1 / 5 min) */
  syncAvailableAt?: (shipmentId: string) => string | null;
};

const wilayaName = (w: { nameFr: string; nameAr: string } | null | undefined, locale: string) => (w ? (locale === 'ar' ? w.nameAr : w.nameFr) : '');

export const clientRefOf = (c: { id: string; name: string; phone: string | null; riskLevel: 'normal' | 'high'; isPlaceholder: boolean; orderCount: number }, blocked: boolean): ClientRefView => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  riskLevel: c.riskLevel,
  isPlaceholder: c.isPlaceholder,
  blocked,
  orderCount: c.orderCount,
});

const sourceOf = (o: OrderListRow): SourceBadge => {
  const b: SourceBadge = { source: o.source };
  if (o.agent) b.agent = o.agent;
  if (o.channel) b.channel = channelRef(o.channel);
  if (o.createdBy) b.user = o.createdBy;
  if (o.apiKey) b.apiKeyName = o.apiKey.name;
  if (o.importJob) {
    const p = (o.importJob.payload ?? {}) as { fileName?: string };
    if (p.fileName) b.importFileName = p.fileName;
    b.importedAt = o.importJob.createdAt.toISOString();
  }
  return b;
};

/** Live state of an order for the status machine (`activeShipment` = the latest parcel not cancelled / failed / returned). */
export const stateOf = (o: Pick<Order, 'status' | 'deliveryStatus' | 'wilayaId' | 'communeId' | 'communeText' | 'address' | 'isStopdesk' | 'stopdeskId'>, activeShipment: { provider: string; status: string } | null | undefined): OrderState => ({
  status: o.status,
  deliveryStatus: o.deliveryStatus,
  shipmentStatus: activeShipment?.status ?? null,
  courierParcel: !!activeShipment && activeShipment.provider !== 'manual' && activeShipment.status !== 'delivered',
  hasAddress: hasDeliveryAddress(o),
});

/** 04 §1.6 confirm fields: wilaya + commune + (address ≥ 10 or a stop-desk). */
export const hasDeliveryAddress = (o: Pick<Order, 'wilayaId' | 'communeId' | 'communeText' | 'address' | 'isStopdesk' | 'stopdeskId'>) =>
  !!o.wilayaId && (!!o.communeId || !!o.communeText?.trim()) && (o.isStopdesk ? true : (o.address ?? '').trim().length >= 10);

const allowed = (permission: MerchantPermission) => can(TenantContext.get().role, permission);
const act = (key: string, permission: MerchantPermission, o: { reasonCode?: string | null; primary?: boolean; shortcut?: string } = {}): ActionDescriptor => {
  const reasonCode = !allowed(permission) ? 'FORBIDDEN' : (o.reasonCode ?? undefined);
  return { key, enabled: !reasonCode, ...(reasonCode ? { reasonCode } : {}), ...(o.primary ? { primary: true } : {}), ...(o.shortcut ? { shortcut: o.shortcut } : {}) };
};

const PRIMARY: Partial<Record<OrderStatusName, string>> = { new: 'confirm', confirmed: 'prepare', preparing: 'ship_manual', shipped: 'deliver' };

/** `actions` of a row / the order page, in menu order (primary first). */
export const orderActions = (o: Pick<Order, 'status' | 'deliveryStatus' | 'paymentStatus' | 'conversationId' | 'wilayaId' | 'communeId' | 'communeText' | 'address' | 'isStopdesk' | 'stopdeskId' | 'total' | 'amountPaid'>, activeShipment: { provider: string; status: string } | null | undefined, ctx: Pick<PresentCtx, 'hasCourier' | 'onlinePayment'>): ActionDescriptor[] => {
  const state = stateOf(o, activeShipment);
  const role = TenantContext.get().role;
  const terminal = isTerminal(o.status);
  const readOnly = (ORDER_READ_ONLY_STATUSES as readonly string[]).includes(o.status);
  const t = (to: OrderStatusName) => checkTransition(state, to, { role })?.code ?? null;
  // with an active courier account the primary of a confirmed / preparing order is "Envoyer au transporteur"
  const courierPrimary = (o.status === 'confirmed' || o.status === 'preparing') && !activeShipment && !!ctx.hasCourier;
  const primaryKey = courierPrimary ? 'send_courier' : PRIMARY[o.status];
  const list: ActionDescriptor[] = [
    act('confirm', 'orders.write', { reasonCode: o.status === 'new' ? t('confirmed') === 'ORDER_ADDRESS_REQUIRED' ? null : t('confirmed') : 'ORDER_INVALID_TRANSITION', primary: primaryKey === 'confirm', shortcut: 'Enter' }),
    act('prepare', 'orders.write', { reasonCode: t('preparing'), primary: primaryKey === 'prepare', shortcut: primaryKey === 'prepare' ? 'Enter' : undefined }),
    // M6: enabled from confirmed / preparing once an active courier account exists (DELIVERY_NO_COURIER otherwise)
    act('send_courier', 'delivery.send', { reasonCode: activeShipment && activeShipment.status !== 'delivered' ? 'DELIVERY_ORDER_ALREADY_SENT' : o.status === 'new' ? 'DELIVERY_ORDER_NOT_CONFIRMED' : !['confirmed', 'preparing'].includes(o.status) ? 'ORDER_INVALID_TRANSITION' : ctx.hasCourier ? null : 'DELIVERY_NO_COURIER', primary: primaryKey === 'send_courier' }),
    act('ship_manual', 'orders.write', { reasonCode: t('shipped'), primary: primaryKey === 'ship_manual', shortcut: primaryKey === 'ship_manual' ? 'Enter' : undefined }),
    act('deliver', 'orders.write', { reasonCode: t('delivered'), primary: primaryKey === 'deliver', shortcut: primaryKey === 'deliver' ? 'Enter' : undefined }),
    act('return', o.status === 'delivered' ? 'orders.money' : 'orders.write', { reasonCode: t('returned') }),
    act('call', 'orders.write', { reasonCode: terminal ? 'ORDER_TERMINAL' : null, shortcut: 'C' }),
    act('callback', 'orders.write', { reasonCode: terminal ? 'ORDER_TERMINAL' : !['new', 'confirmed', 'preparing'].includes(o.status) ? 'ORDER_INVALID_TRANSITION' : null, shortcut: 'R' }),
    act('open_conversation', 'inbox.read', { reasonCode: o.conversationId ? null : 'NOT_FOUND', shortcut: 'M' }),
    act('edit', 'orders.write', { reasonCode: readOnly ? 'ORDER_TERMINAL' : null, shortcut: 'E' }),
    act('edit_address', 'orders.write', { reasonCode: terminal ? 'ORDER_TERMINAL' : state.courierParcel ? 'COURIER_ADDRESS_LOCKED' : null }),
    act('assign', 'orders.write', { shortcut: 'A' }),
    act('record_payment', 'orders.write', { reasonCode: terminal ? 'ORDER_PAYMENT_LOCKED' : o.paymentStatus === 'paid' ? 'ORDER_PAYMENT_LOCKED' : null }),
    act('print', 'orders.read', { shortcut: 'P' }),
    act('change_status', 'orders.write', { reasonCode: allowedTargets(state, role).length ? null : 'ORDER_TERMINAL' }),
    act('cancel', 'orders.write', { reasonCode: t('cancelled'), shortcut: 'Delete' }),
    act('delete', 'orders.money', { reasonCode: o.status === 'delivered' ? 'ORDER_DELETE_DELIVERED' : state.courierParcel ? 'DELIVERY_ORDER_ALREADY_SENT' : null }),
    // M9 (PAY-02 / PAY-03, P2): online payment link and recorded refund
    act('payment_link', 'orders.money', { reasonCode: !ctx.onlinePayment ? 'FEATURE_DISABLED' : terminal || o.total - o.amountPaid <= 0 || o.paymentStatus === 'refunded' ? 'ORDER_PAYMENT_LOCKED' : null }),
    act('refund', 'orders.money', { reasonCode: o.amountPaid <= 0 || o.paymentStatus === 'refunded' ? 'ORDER_PAYMENT_LOCKED' : null }),
  ];
  return [...list.filter((a) => a.primary), ...list.filter((a) => !a.primary)];
};

const shipmentHead = (s: OrderListRow['shipments'][number] | undefined, now: number) => {
  if (!s) return null;
  const last = (s.lastEventAt ?? s.events[0]?.at ?? s.createdAt).getTime();
  const stale = ['sent', 'picked_up', 'in_transit'].includes(s.status) && now - last > SHIPMENT_STALE_AFTER_DAYS * DAY;
  return { provider: s.provider, trackingNumber: s.trackingNumber, status: s.status, stale };
};

export const presentOrderListItem = (o: OrderListRow, ctx: PresentCtx): OrderListItemView => {
  const s = o.shipments[0];
  return {
    id: o.id,
    number: o.number,
    orderedAt: o.orderedAt.toISOString(),
    client: clientRefOf({ ...o.client, name: o.clientName || o.client.name }, ctx.blocked(o.clientId, o.client.phone ?? o.clientPhone)),
    source: sourceOf(o),
    assignee: o.assignee,
    items: o.items.map((i) => ({ name: i.productName, variant: i.variantName, qty: i.quantity })),
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    total: o.total,
    amountPaid: o.amountPaid,
    remaining: Math.max(0, o.total - o.amountPaid),
    status: o.status,
    confirmationStatus: o.confirmationStatus,
    callAttempts: o.callAttempts,
    callbackAt: o.callbackAt?.toISOString() ?? null,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    deliveryStatus: o.deliveryStatus,
    shipment: shipmentHead(s, Date.now()),
    wilaya: o.wilaya ? { id: o.wilaya.id, name: wilayaName(o.wilaya, ctx.locale) } : null,
    isStopdesk: o.isStopdesk,
    riskLevel: o.riskLevel,
    channel: o.channel ? channelRef(o.channel) : null,
    conversationId: o.conversationId,
    labelPrintedAt: o.labelPrintedAt?.toISOString() ?? null,
    version: o.version,
    actions: orderActions(o, s, ctx),
  };
};

export const addressOf = (o: Pick<Order, 'wilayaId' | 'communeId' | 'communeText' | 'address' | 'isStopdesk' | 'stopdeskId'> & { wilaya?: { nameFr: string; nameAr: string } | null; commune?: { nameFr: string; nameAr: string } | null }, locale: string): AddressView | null =>
  o.wilayaId
    ? {
        wilayaId: o.wilayaId,
        wilayaName: wilayaName(o.wilaya, locale),
        communeId: o.communeId,
        communeText: o.communeText ?? (o.commune ? wilayaName(o.commune, locale) : null),
        address: o.address,
        isStopdesk: o.isStopdesk,
        stopdeskId: o.stopdeskId,
        stopdeskName: null,
      }
    : null;

const ACTOR_NAMES: Record<string, string> = { ai: 'IA', system: 'Système', courier: 'Transporteur', api: 'API', api_key: 'API' };

export type DetailExtras = {
  payments: { id: string; amount: number; method: OrderView['paymentMethod']; reference: string | null; note: string | null; paidAt: Date; createdBy: OrderUserRef | null }[];
  actorNames: Map<string, string>;
  feeExplanation: string;
};

export const presentOrder = (o: OrderDetailRow, extras: DetailExtras, ctx: PresentCtx): OrderView => {
  const active = o.shipments.find((s) => (ACTIVE_SHIPMENT as readonly string[]).includes(s.status));
  const listRow = { ...o, items: o.items.map((i) => ({ productName: i.productName, variantName: i.variantName, quantity: i.quantity })), shipments: active ? [{ ...active, events: active.events.slice(0, 1).map((e) => ({ at: e.at })) }] : [] } as unknown as OrderListRow;
  const base = presentOrderListItem(listRow, ctx);
  const { items: _rowItems, ...head } = base;
  const link = o.payments[0];
  return {
    ...head,
    clientName: o.clientName,
    clientPhone: o.clientPhone,
    clientPhone2: o.clientPhone2,
    address: addressOf(o, ctx.locale),
    items: o.items.map((i) => {
      const stock = i.variant ? i.variant.stock : i.product.trackStock ? (i.product.stock ?? 0) : null;
      const open = ['new', 'confirmed', 'preparing'].includes(o.status);
      return {
        id: i.id,
        product: { id: i.product.id, name: i.product.name, sku: i.product.sku, price: i.product.price, primaryImageUrl: i.product.images[0] ? thumbUrlOf(i.product.images[0].url) : null, hasVariants: i.product.hasVariants, trackStock: i.product.trackStock },
        variantId: i.variantId,
        productName: i.productName,
        variantName: i.variantName,
        sku: i.sku,
        unitPrice: i.unitPrice,
        costPrice: i.costPrice,
        quantity: i.quantity,
        discount: i.discount,
        total: i.total,
        // stock is already taken at creation: the warning reads what is left for the other orders
        stockWarning: !open || stock === null ? null : stock < 0 ? 'insufficient' : stock === 0 ? 'last_unit' : null,
      };
    }),
    subtotal: o.subtotal,
    discount: o.discount,
    tax: o.tax,
    deliveryFee: o.deliveryFee,
    courierCost: o.courierCost,
    returnFee: o.returnFee,
    feeExplanation: extras.feeExplanation,
    notes: o.notes,
    cancelReason: o.cancelReason,
    cancelNote: o.cancelNote,
    payments: extras.payments.map((p) => ({ id: p.id, amount: p.amount, method: p.method, reference: p.reference, note: p.note, paidAt: p.paidAt.toISOString(), createdBy: p.createdBy })),
    paymentLink: link ? { id: link.id, url: link.checkoutUrl, status: link.status === 'pending' && !link.checkoutUrl ? 'creating' : link.status, expiresAt: link.expiresAt?.toISOString() ?? null, amount: link.amount } : null,
    calls: o.calls.map((c) => ({ id: c.id, user: c.user, result: c.result, callbackAt: c.callbackAt?.toISOString() ?? null, notes: c.notes, calledAt: c.calledAt.toISOString() })),
    history: o.history.map((h) => ({
      id: h.id,
      at: h.at.toISOString(),
      effectiveAt: h.effectiveAt?.toISOString() ?? null,
      actor: { type: h.actorType, id: h.actorId, name: (h.actorId && extras.actorNames.get(h.actorId)) || ACTOR_NAMES[h.actorType] || '' },
      field: h.field,
      from: h.from,
      to: h.to,
      reason: h.reason,
    })),
    shipments: o.shipments.map((s) => presentShipment(s as unknown as ShipmentRow, o, base.client, addressOf(o, ctx.locale), { publicWebUrl: ctx.publicWebUrl, syncAvailableAt: ctx.syncAvailableAt?.(s.id) ?? null })),
    orderNotes: o.orderNotes.map((n) => ({ id: n.id, author: n.author, body: n.body, createdAt: n.createdAt.toISOString() })),
    sheetsSynced: !!o.sheetsRow,
    agent: o.agent,
    createdBy: o.createdBy,
    confirmedAt: o.confirmedAt?.toISOString() ?? null,
    shippedAt: o.shippedAt?.toISOString() ?? null,
    deliveredAt: o.deliveredAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
};

/** WS `order.created` / `order.updated` payload (03-events §2). */
export const orderSummary = (o: Order): OrderSummary => ({
  id: o.id,
  number: o.number,
  status: o.status,
  confirmationStatus: o.confirmationStatus,
  paymentStatus: o.paymentStatus,
  deliveryStatus: o.deliveryStatus,
  source: o.source,
  clientName: o.clientName,
  clientPhone: o.clientPhone,
  total: o.total,
  amountPaid: o.amountPaid,
  wilayaId: o.wilayaId,
  riskLevel: o.riskLevel,
  assigneeId: o.assigneeId,
  callbackAt: o.callbackAt?.toISOString() ?? null,
  orderedAt: o.orderedAt.toISOString(),
  version: o.version,
});

/** 03-events §6 `OrderPublic` (outbound webhooks, Sheets). */
export const orderPublic = (o: Order & { items: { productId: string; variantId: string | null; productName: string; sku: string | null; quantity: number; unitPrice: number; total: number }[]; commune?: { nameFr: string } | null }) => ({
  id: o.id,
  number: o.number,
  source: o.source,
  status: o.status,
  confirmationStatus: o.confirmationStatus,
  paymentStatus: o.paymentStatus,
  deliveryStatus: o.deliveryStatus,
  client: { id: o.clientId, name: o.clientName, phone: o.clientPhone },
  wilayaId: o.wilayaId,
  communeName: o.communeText ?? o.commune?.nameFr ?? null,
  address: o.address,
  isStopdesk: o.isStopdesk,
  items: o.items.map((i) => ({ productId: i.productId, variantId: i.variantId, name: i.productName, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })),
  subtotal: o.subtotal,
  discount: o.discount,
  deliveryFee: o.deliveryFee,
  total: o.total,
  amountPaid: o.amountPaid,
  orderedAt: o.orderedAt.toISOString(),
});
