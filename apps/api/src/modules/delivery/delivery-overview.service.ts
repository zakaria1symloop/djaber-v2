// DLV-08 / MECH Delivery / 06 §10 "Livraison & suivi" — `GET /shipments` (one row per order, joined with its LATEST
// parcel: the filters apply to that parcel; `not_sent` = a confirmed / preparing order without an active parcel) and
// `GET /delivery/overview` (KPI tiles, tab counts, the first failures and "Sans mouvement" rows, per-courier figures —
// also the data source of Analytics › Livraison, DLV-11). Raw SQL with the workspace filter written explicitly.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DELIVERY_TABS, SHIPMENT_STALE_AFTER_DAYS, type ActionDescriptor, type DeliveryOverviewView, type DeliveryRowView, type DeliveryTab, type ShipmentsQuery } from '@djaber/shared';
import { Prisma, prisma, TenantContext, type Shipment } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import { page, type Page } from '../../core/http/pagination';
import { algiersDay, algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { can } from '../../core/rbac/permission-matrix';
import { checkTransition } from '../orders/order-rules';
import { clientRefOf, stateOf } from '../orders/order.presenter';
import { SafetyService } from '../messaging/safety.service';
import { ExportService } from '../jobs/export.service';
import { PROVIDER_NAMES, type CourierProvider } from './adapters/courier-adapter';
import { isNoMovement, isReturnPending, parseShipmentError, shipmentActions, errorCodeOf } from './shipment.presenter';

const DAY = 86_400_000;
const ACTIVE = Prisma.sql`('pending','sent','picked_up','in_transit','out_for_delivery','delivered')`;
const LATEST = Prisma.sql`LEFT JOIN LATERAL (SELECT x.* FROM "Shipment" x WHERE x."orderId" = o."id" ORDER BY x."createdAt" DESC, x."id" DESC LIMIT 1) s ON true`;
const NOT_SENT = Prisma.sql`(o."status" IN ('confirmed','preparing') AND NOT EXISTS (SELECT 1 FROM "Shipment" y WHERE y."orderId" = o."id" AND y."status" IN ${ACTIVE}))`;
const lastEvent = Prisma.sql`COALESCE(s."lastEventAt", s."createdAt")`;
const SORTS: Record<string, Prisma.Sql> = {
  lastSyncedAt: Prisma.sql`s."lastSyncedAt"`,
  createdAt: Prisma.sql`COALESCE(s."createdAt", o."confirmedAt", o."orderedAt")`,
  orderNumber: Prisma.sql`o."number"`,
};
const list = <T>(values: readonly T[], cast: string) => Prisma.join(values.map((v) => Prisma.sql`${v}::${Prisma.raw(cast)}`));

@Injectable()
export class DeliveryOverviewService implements OnModuleInit {
  constructor(
    private readonly safety: SafetyService,
    private readonly exports: ExportService,
  ) {}

  onModuleInit() {
    // M8 (M6 carry-over, MECH "Exporter CSV"): `GET /delivery/export` → the generic export job
    this.exports.registerSource('shipments', (filters, ctx) => this.exportTable(filters as Partial<ShipmentsQuery>, ctx.locale));
  }

  /** Every row of the `/delivery` list for the filters (latest parcel per order), ≤ 50 000 rows. */
  private async exportTable(q: Partial<ShipmentsQuery>, locale: 'fr' | 'ar' | 'en') {
    const pairs = await prisma.$queryRaw<{ id: string; sid: string | null }[]>`SELECT o."id", s."id" AS sid FROM "Order" o ${LATEST} WHERE ${this.where(q)} ORDER BY ${this.orderBy(q.sort)} LIMIT 50000`;
    const rows = await this.rows(pairs, locale);
    const h = EXPORT_HEADERS[locale] ?? EXPORT_HEADERS.fr;
    type R = DeliveryRowView;
    return {
      sheetName: h.sheet,
      fileName: `livraisons-${algiersDay()}`,
      rows,
      columns: [
        { header: h.order, value: (r: R) => r.orderNumber },
        { header: h.client, value: (r: R) => r.client.name },
        { header: h.phone, value: (r: R) => r.client.phone ?? '' },
        { header: h.wilaya, value: (r: R) => r.wilaya?.name ?? '' },
        { header: h.commune, value: (r: R) => r.communeName ?? '' },
        { header: h.stopdesk, value: (r: R) => (r.isStopdesk ? 1 : 0) },
        { header: h.courier, value: (r: R) => r.shipment?.courierAccount?.displayName ?? (r.shipment ? PROVIDER_NAMES[r.shipment.provider as CourierProvider] ?? r.shipment.provider : '') },
        { header: h.tracking, value: (r: R) => r.shipment?.trackingNumber ?? '' },
        { header: h.status, value: (r: R) => r.shipment?.status ?? 'not_sent' },
        { header: h.attempts, value: (r: R) => r.shipment?.deliveryAttempts ?? 0 },
        { header: h.failure, value: (r: R) => r.shipment?.failureReason ?? '' },
        { header: h.cod, value: (r: R) => r.shipment?.codAmount ?? r.remaining },
        { header: h.total, value: (r: R) => r.total },
        { header: h.sentAt, value: (r: R) => (r.shipment?.createdAt ? algiersDay(new Date(r.shipment.createdAt)) : '') },
        { header: h.lastEventAt, value: (r: R) => (r.shipment?.lastEventAt ? algiersDay(new Date(r.shipment.lastEventAt)) : '') },
      ],
    };
  }

  private where(q: Partial<ShipmentsQuery>, now = new Date()): Prisma.Sql {
    const ws = TenantContext.workspaceId();
    const and: Prisma.Sql[] = [Prisma.sql`o."workspaceId" = ${ws}::uuid`, Prisma.sql`(s."id" IS NOT NULL OR o."status" IN ('confirmed','preparing'))`];
    if (q.shipmentStatus?.length) {
      const statuses = q.shipmentStatus.filter((x) => x !== 'not_sent');
      const or: Prisma.Sql[] = [];
      if (q.shipmentStatus.includes('not_sent')) or.push(NOT_SENT);
      if (statuses.length) or.push(Prisma.sql`s."status" IN (${list(statuses, '"ShipmentStatus"')})`);
      and.push(Prisma.sql`(${Prisma.join(or, ' OR ')})`);
    }
    if (q.provider?.length) and.push(Prisma.sql`s."provider" IN (${list(q.provider, '"ShipmentProvider"')})`);
    if (q.courierAccountId?.length) and.push(Prisma.sql`s."courierAccountId" IN (${list(q.courierAccountId, 'uuid')})`);
    if (q.deliveryType) and.push(Prisma.sql`o."isStopdesk" = ${q.deliveryType === 'stopdesk'}`);
    if (q.wilayaId?.length) and.push(Prisma.sql`o."wilayaId" IN (${Prisma.join(q.wilayaId)})`);
    if (q.communeId?.length) and.push(Prisma.sql`o."communeId" IN (${Prisma.join(q.communeId)})`);
    if (q.orderStatus?.length) and.push(Prisma.sql`o."status" IN (${list(q.orderStatus, '"OrderStatus"')})`);
    if (q.lastEvent === 'lt24h') and.push(Prisma.sql`s."id" IS NOT NULL AND ${lastEvent} >= ${new Date(now.getTime() - DAY)}`);
    if (q.lastEvent === '2_5d') and.push(Prisma.sql`s."id" IS NOT NULL AND ${lastEvent} < ${new Date(now.getTime() - 2 * DAY)} AND ${lastEvent} >= ${new Date(now.getTime() - 5 * DAY)}`);
    if (q.lastEvent === 'gt5d_stale') and.push(Prisma.sql`s."status" IN ('sent','picked_up','in_transit') AND ${lastEvent} < ${new Date(now.getTime() - SHIPMENT_STALE_AFTER_DAYS * DAY)}`);
    if (q.failureReason?.length) and.push(Prisma.sql`s."failureReason" IN (${list(q.failureReason, '"FailureReason"')})`);
    if (q.lastError?.length) and.push(Prisma.sql`split_part(s."lastError", '|', 1) IN (${Prisma.join(q.lastError)})`);
    if (q.from) and.push(Prisma.sql`COALESCE(s."createdAt", o."confirmedAt", o."orderedAt") >= ${algiersDayStart(q.from)}`);
    if (q.to) and.push(Prisma.sql`COALESCE(s."createdAt", o."confirmedAt", o."orderedAt") < ${algiersDayEnd(q.to)}`);
    if (q.ids?.length) and.push(Prisma.sql`o."id" IN (${list(q.ids, 'uuid')})`);
    if (q.q && q.q.trim().length >= 2) {
      const like = `%${q.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const digits = q.q.replace(/\D/g, '');
      and.push(Prisma.sql`(o."number" ILIKE ${like} OR s."trackingNumber" ILIKE ${like} OR o."clientName" ILIKE ${like}${digits.length >= 4 ? Prisma.sql` OR o."clientPhone" LIKE ${`%${digits}%`}` : Prisma.empty})`);
    }
    return Prisma.join(and, ' AND ');
  }

  private orderBy(sort?: string): Prisma.Sql {
    const s = sort ?? '-createdAt';
    const key = s.replace(/^-/, '');
    const col = SORTS[key];
    if (!col) throw new AppException('BAD_REQUEST');
    return Prisma.sql`${col} ${Prisma.raw(s.startsWith('-') ? 'DESC' : 'ASC')} NULLS LAST, o."id" DESC`;
  }

  /** `GET /shipments` (api-contract §4 ShipmentsQuery). */
  async list(q: ShipmentsQuery, locale: string): Promise<Page<DeliveryRowView>> {
    const where = this.where(q);
    const order = this.orderBy(q.sort);
    const offset = (q.page - 1) * q.pageSize;
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<{ id: string; sid: string | null }[]>`SELECT o."id", s."id" AS sid FROM "Order" o ${LATEST} WHERE ${where} ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${offset}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Order" o ${LATEST} WHERE ${where}`,
    ]);
    return page(await this.rows(rows, locale), Number(count[0]?.n ?? 0), q);
  }

  /** Rows of the list / overview for (order id, latest shipment id) pairs, in the given order. */
  async rows(pairs: { id: string; sid: string | null }[], locale: string): Promise<DeliveryRowView[]> {
    if (!pairs.length) return [];
    const [orders, shipments, couriers, index] = await Promise.all([
      prisma.order.findMany({
        where: { id: { in: pairs.map((p) => p.id) } },
        include: { client: { select: { id: true, name: true, phone: true, riskLevel: true, isPlaceholder: true, orderCount: true } }, wilaya: { select: { id: true, nameFr: true, nameAr: true } }, commune: { select: { nameFr: true, nameAr: true } }, shipments: { where: { status: { in: ['pending', 'sent', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'] } }, select: { id: true, provider: true, status: true } } },
      }),
      prisma.shipment.findMany({ where: { id: { in: pairs.map((p) => p.sid).filter((x): x is string => !!x) } }, include: { courierAccount: { select: { id: true, displayName: true, baseUrl: true } } } }),
      prisma.courierAccount.count({ where: { isActive: true } }),
      this.safety.index(),
    ]);
    const byOrder = new Map(orders.map((o) => [o.id, o]));
    const byShip = new Map(shipments.map((s) => [s.id, s]));
    const role = TenantContext.get().role;
    const now = Date.now();
    const out: DeliveryRowView[] = [];
    for (const p of pairs) {
      const o = byOrder.get(p.id);
      if (!o) continue;
      const s = p.sid ? byShip.get(p.sid) : undefined;
      const active = o.shipments[0] ?? null;
      const state = stateOf(o, active);
      const sendable = ['confirmed', 'preparing'].includes(o.status) && !active;
      const orderActs: ActionDescriptor[] = [];
      const push = (key: string, permitted: boolean, reasonCode: string | null, primary = false) => orderActs.push({ key, enabled: permitted && !reasonCode, ...(!permitted ? { reasonCode: 'FORBIDDEN' } : reasonCode ? { reasonCode } : {}), ...(primary ? { primary: true } : {}) });
      push('send_courier', can(role, 'delivery.send'), active && active.status !== 'delivered' ? 'DELIVERY_ORDER_ALREADY_SENT' : o.status === 'new' ? 'DELIVERY_ORDER_NOT_CONFIRMED' : !sendable ? 'ORDER_INVALID_TRANSITION' : couriers ? null : 'DELIVERY_NO_COURIER', sendable && couriers > 0);
      push('ship_manual', can(role, 'orders.write'), checkTransition(state, 'shipped', { role })?.code ?? null);
      const shipActs = s ? shipmentActions(s, o, { now }) : [];
      if (!s) {
        push('open_order', can(role, 'orders.read'), null);
        push('call_client', can(role, 'orders.write'), null);
      }
      const all = [...orderActs, ...shipActs];
      const first = all.find((a) => a.primary && a.enabled);
      const actions = first ? [first, ...all.filter((a) => a !== first).map(({ primary: _p, ...a }) => a)] : all.map(({ primary: _p, ...a }) => a);
      out.push({
        id: o.id,
        orderId: o.id,
        orderNumber: o.number,
        orderStatus: o.status,
        orderVersion: o.version,
        client: clientRefOf({ ...o.client, name: o.clientName || o.client.name }, index.has({ clientId: o.clientId, channelId: '', externalSenderId: '' }, o.client.phone ?? o.clientPhone)),
        total: o.total,
        remaining: Math.max(0, o.total - o.amountPaid),
        wilaya: o.wilaya ? { id: o.wilaya.id, name: locale === 'ar' ? o.wilaya.nameAr : o.wilaya.nameFr } : null,
        communeName: o.communeText ?? (o.commune ? (locale === 'ar' ? o.commune.nameAr : o.commune.nameFr) : null),
        isStopdesk: o.isStopdesk,
        confirmedAt: o.confirmedAt?.toISOString() ?? null,
        labelPrintedAt: o.labelPrintedAt?.toISOString() ?? null,
        shipment: s ? this.head(s, o.status, now) : null,
        actions,
      });
    }
    return out;
  }

  private head(s: Shipment & { courierAccount: { id: string; displayName: string } | null }, orderStatus: string, now: number): DeliveryRowView['shipment'] {
    return {
      id: s.id,
      provider: s.provider,
      courierAccount: s.courierAccount ? { id: s.courierAccount.id, displayName: s.courierAccount.displayName } : null,
      status: s.status,
      trackingNumber: s.trackingNumber,
      failureReason: s.failureReason,
      deliveryAttempts: s.deliveryAttempts,
      lastError: errorCodeOf(s.lastError),
      error: parseShipmentError(s.lastError),
      codAmount: s.codAmount,
      courierCost: s.courierCost,
      lastEventAt: (s.lastEventAt ?? s.createdAt).toISOString(),
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      noMovement: isNoMovement(s, now),
      returnPending: isReturnPending(s, orderStatus),
      createdAt: s.createdAt.toISOString(),
    };
  }

  /** `GET /delivery/overview` (the only overview endpoint, 06 §2). */
  async overview(locale: string): Promise<DeliveryOverviewView> {
    const ws = TenantContext.workspaceId();
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY);
    const today = algiersDayStart(algiersDay(now));
    const stale5 = new Date(now.getTime() - SHIPMENT_STALE_AFTER_DAYS * DAY);
    const base = this.where({}, now);
    const [tabs] = await prisma.$queryRaw<Record<string, bigint>[]>`
      SELECT
        count(*) FILTER (WHERE s."status" = 'failed') AS failed,
        count(*) FILTER (WHERE s."status" IN ('sent','picked_up','in_transit') AND ${lastEvent} < ${stale5}) AS no_movement,
        count(*) FILTER (WHERE ${NOT_SENT}) AS to_send,
        count(*) FILTER (WHERE s."status" IN ('pending','sent','picked_up','in_transit','out_for_delivery')) AS in_transit,
        count(*) FILTER (WHERE s."status" = 'returned') AS returns,
        count(*) AS "all",
        count(*) FILTER (WHERE s."status" IN ('pending','sent')) AS pending_pickup,
        count(*) FILTER (WHERE s."status" IN ('picked_up','in_transit','out_for_delivery')) AS moving,
        count(*) FILTER (WHERE s."status" = 'failed' AND s."trackingNumber" IS NOT NULL AND s."updatedAt" >= ${today}) AS failed_today
      FROM "Order" o ${LATEST} WHERE ${base}`;
    const [closed] = await prisma.$queryRaw<{ delivered: bigint; returned: bigint; avg_days: number | null }[]>`
      SELECT count(*) FILTER (WHERE "status" = 'delivered') AS delivered,
             count(*) FILTER (WHERE "status" = 'returned') AS returned,
             avg(EXTRACT(EPOCH FROM (COALESCE("lastEventAt", "updatedAt") - "createdAt")) / 86400.0) FILTER (WHERE "status" = 'delivered') AS avg_days
      FROM "Shipment" WHERE "workspaceId" = ${ws}::uuid AND "status" IN ('delivered','returned') AND COALESCE("lastEventAt", "updatedAt") >= ${since30}`;
    const byCourier = await prisma.$queryRaw<{ provider: string; account: string | null; name: string | null; sent: bigint; delivered: bigint; failed: bigint; returned: bigint; avg_days: number | null; cod: bigint | null }[]>`
      SELECT s."provider", s."courierAccountId" AS account, a."displayName" AS name,
             count(*) FILTER (WHERE s."trackingNumber" IS NOT NULL OR s."provider" = 'manual') AS sent,
             count(*) FILTER (WHERE s."status" = 'delivered') AS delivered,
             count(*) FILTER (WHERE s."status" = 'failed') AS failed,
             count(*) FILTER (WHERE s."status" = 'returned') AS returned,
             avg(EXTRACT(EPOCH FROM (COALESCE(s."lastEventAt", s."updatedAt") - s."createdAt")) / 86400.0) FILTER (WHERE s."status" = 'delivered') AS avg_days,
             sum(s."codAmount") FILTER (WHERE s."status" = 'delivered') AS cod
      FROM "Shipment" s LEFT JOIN "CourierAccount" a ON a."id" = s."courierAccountId"
      WHERE s."workspaceId" = ${ws}::uuid AND s."createdAt" >= ${since30} AND s."status" <> 'cancelled'
      GROUP BY s."provider", s."courierAccountId", a."displayName" ORDER BY sent DESC`;
    const [failures, stale, couriers, def] = await Promise.all([
      prisma.$queryRaw<{ id: string; sid: string | null }[]>`SELECT o."id", s."id" AS sid FROM "Order" o ${LATEST} WHERE ${this.where(DELIVERY_TABS.failed as Partial<ShipmentsQuery>, now)} ORDER BY s."updatedAt" DESC NULLS LAST, o."id" DESC LIMIT 20`,
      prisma.$queryRaw<{ id: string; sid: string | null }[]>`SELECT o."id", s."id" AS sid FROM "Order" o ${LATEST} WHERE ${this.where(DELIVERY_TABS.no_movement as Partial<ShipmentsQuery>, now)} ORDER BY ${lastEvent} ASC, o."id" DESC LIMIT 20`,
      prisma.courierAccount.count({ where: { isActive: true } }),
      prisma.workspace.findUniqueOrThrow({ where: { id: ws }, select: { defaultCourierAccountId: true } }),
    ]);
    const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
    const delivered30d = n(closed?.delivered);
    const returned30d = n(closed?.returned);
    const closedTotal = delivered30d + returned30d;
    const round1 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
    const tabCounts = { failed: n(tabs?.failed), no_movement: n(tabs?.no_movement), to_send: n(tabs?.to_send), in_transit: n(tabs?.in_transit), returns: n(tabs?.returns), all: n(tabs?.all) } satisfies Record<DeliveryTab, number>;
    return {
      kpis: {
        toSend: tabCounts.to_send,
        pendingPickup: n(tabs?.pending_pickup),
        inTransit: n(tabs?.moving),
        staleOver5d: tabCounts.no_movement,
        failedToday: n(tabs?.failed_today),
        delivered30d,
        deliveredPct30d: closedTotal ? Math.round((delivered30d / closedTotal) * 100) : 0,
        returned30d,
        returnedPct30d: closedTotal ? Math.round((returned30d / closedTotal) * 100) : 0,
        avgDays: round1(closed?.avg_days),
        byCourier: byCourier.map((r) => ({ provider: r.provider as DeliveryOverviewView['kpis']['byCourier'][number]['provider'], courierAccountId: r.account, displayName: r.name ?? PROVIDER_NAMES[r.provider as CourierProvider] ?? r.provider, sent: n(r.sent), delivered: n(r.delivered), failed: n(r.failed), returned: n(r.returned), avgDays: round1(r.avg_days), codCollected: n(r.cod) })),
      },
      tabs: tabCounts,
      failures: await this.rows(failures, locale),
      stale: await this.rows(stale, locale),
      couriers: { active: couriers, defaultId: def.defaultCourierAccountId },
    };
  }
}

const EXPORT_HEADERS = {
  fr: { sheet: 'Livraisons', order: 'Commande', client: 'Client', phone: 'Téléphone', wilaya: 'Wilaya', commune: 'Commune', stopdesk: 'Point relais', courier: 'Transporteur', tracking: 'Suivi', status: 'Statut colis', attempts: 'Tentatives', failure: 'Motif d’échec', cod: 'Montant à encaisser', total: 'Total', sentAt: 'Envoyé le', lastEventAt: 'Dernier événement' },
  en: { sheet: 'Deliveries', order: 'Order', client: 'Client', phone: 'Phone', wilaya: 'Wilaya', commune: 'Commune', stopdesk: 'Stop-desk', courier: 'Courier', tracking: 'Tracking', status: 'Parcel status', attempts: 'Attempts', failure: 'Failure reason', cod: 'Cash to collect', total: 'Total', sentAt: 'Sent on', lastEventAt: 'Last event' },
  ar: { sheet: 'التوصيلات', order: 'الطلب', client: 'العميل', phone: 'الهاتف', wilaya: 'الولاية', commune: 'البلدية', stopdesk: 'نقطة الاستلام', courier: 'الناقل', tracking: 'التتبع', status: 'حالة الطرد', attempts: 'المحاولات', failure: 'سبب الفشل', cod: 'المبلغ المستحق', total: 'المجموع', sentAt: 'أُرسل في', lastEventAt: 'آخر حدث' },
} as const;
