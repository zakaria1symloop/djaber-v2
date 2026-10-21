// CLI-01…05 + 03 §37 CLI — clients: paginated list with the filters of 06 §10, detail sheet, create / quick edit with the
// normalised-phone uniqueness (409 CLIENT_PHONE_EXISTS), risk flag, tags, merge (CLI-02 rule, irreversible), soft
// delete / archive (CUSTOMER_HAS_ORDERS), export. Aggregates are recomputed by ClientAggregatesService, never here.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, prisma, TenantContext, type Client, type Tx } from '@djaber/db';
import {
  CLIENT_TAGS_SUGGESTIONS_MAX,
  type ClientAddressInput,
  type ClientListItemView,
  type ClientMergePreview,
  type ClientPill,
  type ClientQuality,
  type ClientsQuery,
  type ClientTagCount,
  type ClientView,
  type CreateClientInput,
  type UpdateClientInput,
} from '@djaber/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, type Page } from '../../core/http/pagination';
import { OutboxService } from '../../core/outbox/outbox.service';
import { can } from '../../core/rbac/permission-matrix';
import { algiersDay, algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { channelRef } from '../channels/channel.service';
import { GeoService } from '../delivery/geo.service';
import { ExportService } from '../jobs/export.service';
import { conversationHead, conversationInclude, presentConversation } from '../messaging/messaging.presenter';
import { SafetyService, type BlockIndex } from '../messaging/safety.service';
import { ORDER_LIST_INCLUDE, presentOrderListItem } from '../orders/order.presenter';
import { ClientAggregatesService } from './client-aggregates.service';

const DAY = 86_400_000;
const SORTS = ['lastOrderAt', 'name', 'totalSpent', 'createdAt'] as const;
export const CLIENT_LIST_INCLUDE = {
  identities: { include: { channel: { select: { id: true, platform: true, name: true, avatarUrl: true, status: true } } } },
  _count: { select: { addresses: true, conversations: true } },
} satisfies Prisma.ClientInclude;
type ClientRow = Prisma.ClientGetPayload<{ include: typeof CLIENT_LIST_INCLUDE }>;

const isPhoneConflict = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';
const userAction = (key: string, permission: Parameters<typeof can>[1], reasonCode?: string | null, primary = false) => {
  const allowed = can(TenantContext.get().role, permission);
  const code = !allowed ? 'FORBIDDEN' : (reasonCode ?? undefined);
  return { key, enabled: !code, ...(code ? { reasonCode: code } : {}), ...(primary ? { primary: true } : {}) };
};

@Injectable()
export class ClientService implements OnModuleInit {
  constructor(
    private readonly aggregates: ClientAggregatesService,
    private readonly safety: SafetyService,
    private readonly geo: GeoService,
    private readonly exports: ExportService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.exports.registerSource('clients', (filters, ctx) => this.exportTable(filters as ClientsQuery & { ids?: string[] }, ctx.locale));
  }

  // --- reads ------------------------------------------------------------------------------------------------------------
  private async duplicateIds(): Promise<string[]> {
    const ws = TenantContext.workspaceId();
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT c."id" FROM "Client" c
      WHERE c."workspaceId" = ${ws}::uuid AND c."deletedAt" IS NULL AND NOT c."isPlaceholder"
        AND EXISTS (SELECT 1 FROM "Client" d WHERE d."workspaceId" = c."workspaceId" AND d."deletedAt" IS NULL AND d."id" <> c."id" AND NOT d."isPlaceholder"
                    AND (lower(d."name") = lower(c."name") OR (c."phone2" IS NOT NULL AND d."phone" = c."phone2")))`;
    return rows.map((r) => r.id);
  }

  private async where(q: ClientsQuery, index: BlockIndex): Promise<Prisma.ClientWhereInput> {
    const and: Prisma.ClientWhereInput[] = [{ deletedAt: null }];
    const now = Date.now();
    if (q.source?.length) and.push({ source: { in: q.source } });
    for (const quality of q.quality ?? []) {
      if (quality === 'placeholder') and.push({ isPlaceholder: true });
      if (quality === 'no_phone') and.push({ phone: null });
      if (quality === 'no_address') and.push({ addresses: { none: {} }, orders: { none: { wilayaId: { not: null } } } });
      if (quality === 'duplicates') and.push({ id: { in: await this.duplicateIds() } });
    }
    if (q.tags?.length) and.push({ tags: { hasSome: q.tags } });
    if (q.riskLevel) and.push({ riskLevel: q.riskLevel });
    if (q.channelId?.length) and.push({ identities: { some: { channelId: { in: q.channelId } } } });
    if (q.noConversation) and.push({ conversations: { none: {} } });
    if (q.minOrders !== undefined) and.push({ orderCount: { gte: q.minOrders } });
    if (q.maxOrders !== undefined) and.push({ orderCount: { lte: q.maxOrders } });
    if (q.neverOrdered) and.push({ orderCount: 0 });
    if (q.returned) and.push({ returnCount: { gt: 0 } });
    if (q.minSpent !== undefined) and.push({ totalSpent: { gte: q.minSpent } });
    if (q.maxSpent !== undefined) and.push({ totalSpent: { lte: q.maxSpent } });
    if (q.lastOrder === 'lt30') and.push({ lastOrderAt: { gte: new Date(now - 30 * DAY) } });
    if (q.lastOrder === '30_90') and.push({ lastOrderAt: { lt: new Date(now - 30 * DAY), gte: new Date(now - 90 * DAY) } });
    if (q.lastOrder === 'gt90') and.push({ lastOrderAt: { lt: new Date(now - 90 * DAY) } });
    if (q.lastOrder === 'never') and.push({ lastOrderAt: null });
    if (q.wilayaId?.length) and.push({ OR: [{ addresses: { some: { wilayaId: { in: q.wilayaId } } } }, { orders: { some: { wilayaId: { in: q.wilayaId } } } }] });
    const from = q.createdFrom ?? q.from;
    const to = q.createdTo ?? q.to;
    if (from) and.push({ createdAt: { gte: algiersDayStart(from) } });
    if (to) and.push({ createdAt: { lt: algiersDayEnd(to) } });
    if (q.blocked !== undefined) {
      const blockedOr: Prisma.ClientWhereInput[] = [];
      if (index.clientIds.size) blockedOr.push({ id: { in: [...index.clientIds] } });
      if (index.phones.size) blockedOr.push({ phone: { in: [...index.phones] } });
      if (q.blocked) and.push(blockedOr.length ? { OR: blockedOr } : { id: { in: [] } });
      else if (blockedOr.length) and.push({ NOT: { OR: blockedOr } });
    }
    if (q.q && q.q.trim().length >= 2) {
      const term = q.q.trim();
      const digits = term.replace(/[\s.\-+]/g, '');
      const phoneTerm = /^\d{2,}$/.test(digits) ? (digits.startsWith('213') && digits.length > 9 ? `0${digits.slice(3)}` : digits) : null;
      and.push({ OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }, ...(phoneTerm ? [{ phone: { contains: phoneTerm } }, { phone2: { contains: phoneTerm } }] : [])] });
    }
    return { AND: and };
  }

  private orderBy(sort?: string): Prisma.ClientOrderByWithRelationInput[] {
    const s = sort ?? '-lastOrderAt';
    const field = s.replace(/^-/, '');
    if (!(SORTS as readonly string[]).includes(field)) throw new AppException('BAD_REQUEST');
    const dir = s.startsWith('-') ? 'desc' : 'asc';
    if (field === 'lastOrderAt') return [{ lastOrderAt: { sort: dir, nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }];
    return [{ [field]: dir }, { id: 'desc' }];
  }

  private pill(c: Pick<Client, 'isPlaceholder' | 'riskLevel' | 'orderCount' | 'returnCount'>, blocked: boolean, delivered: number): ClientPill | null {
    if (blocked) return 'blocked';
    if (c.riskLevel === 'high') return 'risk';
    if (c.isPlaceholder) return 'placeholder';
    if (delivered >= 1 && c.returnCount === 0) return 'reliable';
    if (c.orderCount === 0) return 'unknown';
    return null;
  }

  private async listViews(rows: ClientRow[], index: BlockIndex): Promise<ClientListItemView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [delivered, withAddressOrders, dupes] = await Promise.all([
      prisma.order.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, status: 'delivered' }, _count: { _all: true } }),
      prisma.order.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, wilayaId: { not: null } }, _count: { _all: true } }),
      this.duplicateIds(),
    ]);
    const deliveredBy = new Map(delivered.map((d) => [d.clientId, d._count._all]));
    const addressOrders = new Set(withAddressOrders.map((d) => d.clientId));
    const dupeSet = new Set(dupes);
    return rows.map((c) => {
      const blocked = index.has({ clientId: c.id, channelId: '', externalSenderId: '' }, c.phone);
      const quality: ClientQuality[] = [];
      if (c.isPlaceholder) quality.push('placeholder');
      if (!c.phone) quality.push('no_phone');
      if (!c._count.addresses && !addressOrders.has(c.id)) quality.push('no_address');
      if (dupeSet.has(c.id)) quality.push('duplicate');
      const deliveredCount = deliveredBy.get(c.id) ?? 0;
      const channels = new Map(c.identities.map((i) => [i.channel.id, channelRef(i.channel)]));
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        riskLevel: c.riskLevel,
        isPlaceholder: c.isPlaceholder,
        blocked,
        orderCount: c.orderCount,
        phone2: c.phone2,
        source: c.source,
        totalSpent: c.totalSpent,
        lastOrderAt: c.lastOrderAt?.toISOString() ?? null,
        tags: c.tags,
        channels: [...channels.values()],
        quality,
        pill: this.pill(c, blocked, deliveredCount),
        deliveredCount,
        returnCount: c.returnCount,
        cancelCount: c.cancelCount,
        archived: !!c.deletedAt,
        createdAt: c.createdAt.toISOString(),
        actions: this.actions(c, blocked),
      };
    });
  }

  private actions(c: Pick<Client, 'deletedAt' | 'orderCount' | 'riskLevel' | 'phone'>, blocked: boolean) {
    if (c.deletedAt) return [userAction('open', 'clients.read', null, true)];
    return [
      userAction('open', 'clients.read', null, true),
      userAction('edit', 'clients.write'),
      userAction('new_order', 'orders.write'),
      userAction('open_orders', 'orders.read'),
      userAction('open_conversation', 'inbox.read'),
      userAction('tags', 'clients.write'),
      userAction(c.riskLevel === 'high' ? 'unmark_risk' : 'mark_risk', 'clients.write'),
      userAction('merge', 'clients.delete'),
      blocked ? userAction('unblock', 'safety.manage') : userAction('block', 'safety.block', c.phone ? null : null),
      // a client with orders is archived (soft) only after the explicit confirmation of the dialog
      userAction(c.orderCount > 0 ? 'archive' : 'delete', 'clients.delete'),
    ];
  }

  /** `GET /clients/tags?q=` (M11): distinct tags of the live clients of the workspace, most used first (ties: case-insensitive A→Z), ≤ 100. */
  async tags(q?: string): Promise<ClientTagCount[]> {
    const ws = TenantContext.workspaceId();
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await prisma.$queryRaw<{ tag: string; count: number }[]>`
      SELECT t.tag, count(*)::int AS count
      FROM "Client" c CROSS JOIN LATERAL unnest(c."tags") AS t(tag)
      WHERE c."workspaceId" = ${ws}::uuid AND c."deletedAt" IS NULL AND c."mergedIntoId" IS NULL
        ${like ? Prisma.sql`AND t.tag ILIKE ${like}` : Prisma.empty}
      GROUP BY t.tag ORDER BY count(*) DESC, lower(t.tag) ASC, t.tag ASC LIMIT ${CLIENT_TAGS_SUGGESTIONS_MAX}`;
    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }

  async list(q: ClientsQuery): Promise<Page<ClientListItemView>> {
    const index = await this.safety.index();
    const where = await this.where(q, index);
    const [rows, total] = await Promise.all([
      prisma.client.findMany({ where, include: CLIENT_LIST_INCLUDE, orderBy: this.orderBy(q.sort), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.client.count({ where }),
    ]);
    return page(await this.listViews(rows, index), total, q);
  }

  private async row(id: string, includeArchived = true) {
    const c = await prisma.client.findFirst({ where: { id, ...(includeArchived ? {} : { deletedAt: null }) }, include: CLIENT_LIST_INCLUDE });
    if (!c) throw notFound();
    return c;
  }

  async get(id: string, locale: 'fr' | 'ar' | 'en' = 'fr'): Promise<ClientView> {
    const index = await this.safety.index();
    const c = await this.row(id);
    const [item] = await this.listViews([c], index);
    const [addresses, mergedFrom, recent, conversations, counts, block, sales, ordersSum, salesSum] = await Promise.all([
      prisma.clientAddress.findMany({ where: { clientId: id }, include: { wilaya: true, commune: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] }),
      prisma.client.findMany({ where: { mergedIntoId: id }, select: { id: true, name: true, deletedAt: true, updatedAt: true } }),
      prisma.order.findMany({ where: { clientId: id }, include: ORDER_LIST_INCLUDE, orderBy: [{ orderedAt: 'desc' }, { id: 'desc' }], take: 10 }),
      prisma.conversation.findMany({ where: { clientId: id, deletedAt: null }, include: conversationInclude, orderBy: { lastMessageAt: 'desc' }, take: 10 }),
      prisma.order.groupBy({ by: ['status'], where: { clientId: id }, _count: { _all: true } }),
      prisma.customerBlock.findFirst({ where: { unblockedAt: null, OR: [{ clientId: id }, ...(c.phone ? [{ phone: c.phone }] : [])] }, orderBy: { blockedAt: 'desc' } }),
      // counter sales: "DA dépensés" counts them, so the sheet lists them next to the orders (tester report 2026-10-19 UX-003)
      prisma.sale.findMany({ where: { clientId: id, status: { not: 'draft' } }, select: { id: true, number: true, soldAt: true, total: true, status: true, paymentStatus: true }, orderBy: [{ soldAt: 'desc' }, { id: 'desc' }], take: 10 }),
      prisma.order.aggregate({ where: { clientId: id, status: 'delivered' }, _sum: { total: true } }),
      prisma.sale.aggregate({ where: { clientId: id, status: 'completed' }, _sum: { total: true }, _count: { _all: true } }),
    ]);
    const n = (s: string) => counts.find((x) => x.status === s)?._count._all ?? 0;
    const delivered = n('delivered');
    const returns = n('returned');
    const ctx = { locale, blocked: (clientId: string, phone: string | null) => index.has({ clientId, channelId: '', externalSenderId: '' }, phone) };
    const totalOrders = counts.reduce((s, x) => s + x._count._all, 0);
    return {
      ...item!,
      email: c.email,
      notes: c.notes,
      riskSetManually: c.riskSetManually,
      mergedIntoId: c.mergedIntoId,
      addresses: addresses.map((a) => ({
        id: a.id,
        isDefault: a.isDefault,
        wilayaId: a.wilayaId,
        wilayaName: locale === 'ar' ? a.wilaya.nameAr : a.wilaya.nameFr,
        communeId: a.communeId,
        communeText: a.communeText ?? (a.commune ? (locale === 'ar' ? a.commune.nameAr : a.commune.nameFr) : null),
        address: a.address,
        isStopdesk: a.isStopdesk,
        stopdeskId: a.stopdeskId,
      })),
      metrics: { orders: totalOrders, delivered, spent: c.totalSpent, ordersSpent: ordersSum._sum.total ?? 0, sales: salesSum._count._all, salesSpent: salesSum._sum.total ?? 0, returns, returnPct: delivered + returns ? Math.round((returns * 1000) / (delivered + returns)) / 10 : 0, cancels: n('cancelled'), conversations: c._count.conversations, lastOrderAt: c.lastOrderAt?.toISOString() ?? null },
      mergedFrom: mergedFrom.map((m) => ({ id: m.id, name: m.name, at: (m.deletedAt ?? m.updatedAt).toISOString() })),
      recentOrders: recent.map((o) => presentOrderListItem(o, ctx)),
      recentSales: sales.map((s) => ({ id: s.id, number: s.number, soldAt: s.soldAt.toISOString(), total: s.total, status: s.status as 'completed' | 'cancelled', paymentStatus: s.paymentStatus })),
      conversations: conversations.map((cv) => presentConversation(cv, index.has(cv, cv.client?.phone))),
      block: block ? { id: block.id, source: block.source, reason: block.reason, blockedAt: block.blockedAt.toISOString(), unblockable: block.source !== 'platform' } : null,
    };
  }

  /** `GET /clients/:id/metrics`. */
  async metrics(id: string) {
    return (await this.get(id)).metrics;
  }

  // --- writes -------------------------------------------------------------------------------------------------------------
  private phoneTaken(owner: { name: string }) {
    return new AppException('CLIENT_PHONE_EXISTS', { clientName: owner.name }, { phone: 'validation.phone_taken' });
  }

  private async assertPhoneFree(db: Tx | typeof prisma, phone: string, exceptId?: string) {
    const owner = await db.client.findFirst({ where: { phone, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true, name: true } });
    if (owner) throw new AppException('CLIENT_PHONE_EXISTS', { clientName: owner.name }, { phone: 'validation.phone_taken' }, { clientId: owner.id });
  }

  private async writeAddress(tx: Tx, clientId: string, a: ClientAddressInput | null | undefined) {
    if (a === undefined) return;
    await tx.clientAddress.updateMany({ where: { clientId, isDefault: true }, data: { isDefault: false } });
    // null = no default address any more (the old addresses stay in the card's history)
    if (a === null) return;
    await this.geo.checkAddress(a, tx, 'address.communeId');
    await tx.clientAddress.create({ data: { clientId, wilayaId: a.wilayaId, communeId: a.communeId ?? null, communeText: a.communeText ?? null, address: a.address ?? null, isStopdesk: a.isStopdesk ?? false, stopdeskId: a.stopdeskId ?? null, isDefault: true } });
  }

  /** `POST /clients` — 409 CLIENT_PHONE_EXISTS {clientName} (+ `details.clientId` for "Utiliser ce client"). */
  async create(input: CreateClientInput): Promise<ClientView> {
    await this.assertPhoneFree(prisma, input.phone);
    let id: string;
    try {
      id = await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const c = await tx.client.create({ data: { workspaceId: TenantContext.workspaceId(), name: input.name, phone: input.phone, phone2: input.phone2 ?? null, email: input.email ?? null, notes: input.notes ?? null, tags: input.tags ?? [], source: 'manual' } });
        await this.writeAddress(tx, c.id, input.address ?? undefined);
        await this.customerNew(tx, c);
        return c.id;
      });
    } catch (e) {
      if (isPhoneConflict(e)) {
        const owner = await prisma.client.findFirst({ where: { phone: input.phone, deletedAt: null } });
        throw owner ? this.phoneTaken(owner) : e;
      }
      throw e;
    }
    return this.get(id);
  }

  /** Outbound webhook `customer.new` (03-events §6), delivered by the integrations module (M11). */
  async customerNew(tx: Tx, c: Pick<Client, 'id' | 'name' | 'phone' | 'source' | 'createdAt' | 'workspaceId'>) {
    await this.outbox.enqueue(tx, { topic: 'webhook', key: `customer.new:${c.id}`, workspaceId: c.workspaceId, payload: { event: 'customer.new', workspaceId: c.workspaceId, data: { client: { id: c.id, name: c.name, phone: c.phone, source: c.source, createdAt: c.createdAt.toISOString() } } } });
  }

  /** `PATCH /clients/:id` (quick edit). `riskLevel` sets `riskSetManually`; a new phone must be free. */
  async update(id: string, input: UpdateClientInput): Promise<ClientView> {
    const c = await this.row(id, false);
    if (input.phone && input.phone !== c.phone) await this.assertPhoneFree(prisma, input.phone, id);
    try {
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await tx.client.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.phone !== undefined ? { phone: input.phone, isPlaceholder: false } : {}),
            ...(input.phone2 !== undefined ? { phone2: input.phone2 } : {}),
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.tags !== undefined ? { tags: [...new Set(input.tags)] } : {}),
            ...(input.riskLevel !== undefined ? { riskLevel: input.riskLevel, riskSetManually: true } : {}),
          },
        });
        await this.writeAddress(tx, id, input.defaultAddress);
        await this.emitConversations(tx, id);
      });
    } catch (e) {
      if (isPhoneConflict(e) && input.phone) {
        const owner = await prisma.client.findFirst({ where: { phone: input.phone, deletedAt: null, id: { not: id } } });
        throw owner ? this.phoneTaken(owner) : e;
      }
      throw e;
    }
    return this.get(id);
  }

  private async emitConversations(tx: Tx, clientId: string) {
    const rows = await tx.conversation.findMany({ where: { clientId, deletedAt: null }, take: 50 });
    for (const c of rows) await this.outbox.ws(tx, `ws:${c.workspaceId}`, 'conversation.updated', { id: c.id, conversation: conversationHead(c) });
  }

  /** `POST /clients/:id/risk { riskLevel }` [FIG SAFE "Marquer risque"] — manual flag (the nightly rule then leaves it). */
  async setRisk(id: string, riskLevel: 'normal' | 'high'): Promise<ClientView> {
    await this.row(id, false);
    await prisma.$transaction(async (db) => {
      await db.client.update({ where: { id }, data: { riskLevel, riskSetManually: true } });
      await this.emitConversations(db as Tx, id);
    });
    const t = TenantContext.get();
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'client.risk', entity: 'Client', entityId: id, after: { riskLevel } });
    return this.get(id);
  }

  /** `DELETE /clients/:id[?archive=true]` (CLI-05: always soft; with orders only on explicit archive ⇒ else 409 CUSTOMER_HAS_ORDERS {count}). */
  async remove(id: string, archive: boolean, tx?: Tx) {
    const run = async (db: Tx) => {
      const c = await db.client.findFirst({ where: { id, deletedAt: null } });
      if (!c) throw notFound();
      const count = await db.order.count({ where: { clientId: id } });
      if (count > 0 && !archive) throw new AppException('CUSTOMER_HAS_ORDERS', { count });
      await db.client.update({ where: { id }, data: { deletedAt: new Date() } });
      return { id, archived: true, orders: count };
    };
    const r = tx ? await run(tx) : await prisma.$transaction((db) => run(db as Tx));
    const t = TenantContext.get();
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'client.delete', entity: 'Client', entityId: id, after: { orders: r.orders } });
    return r;
  }

  /** `POST /clients/bulk/tags { ids[], add[], remove[] }`. */
  async bulkTags(id: string, add: string[], remove: string[], tx: Tx) {
    const c = await tx.client.findFirst({ where: { id, deletedAt: null }, select: { tags: true } });
    if (!c) throw notFound();
    const tags = [...new Set([...c.tags.filter((x) => !remove.includes(x)), ...add])].slice(0, 20);
    await tx.client.update({ where: { id }, data: { tags } });
    return { tags };
  }

  // --- merge (CLI-02) ---------------------------------------------------------------------------------------------------
  /**
   * Moves everything of `merge` onto `keep` (identities, conversations, orders, counter sales, blocks, reports, addresses,
   * tags, missing contact fields), soft-deletes `merge` with `mergedIntoId`, recomputes `keep`. Inside the caller's tx.
   */
  async mergeInto(tx: Tx, keep: Client, merge: Client) {
    if (keep.id === merge.id) return keep;
    await tx.clientIdentity.updateMany({ where: { clientId: merge.id }, data: { clientId: keep.id } });
    const convs = await tx.conversation.findMany({ where: { clientId: merge.id }, select: { id: true } });
    await tx.conversation.updateMany({ where: { clientId: merge.id }, data: { clientId: keep.id, version: { increment: 1 } } });
    await tx.order.updateMany({ where: { clientId: merge.id }, data: { clientId: keep.id } });
    await tx.sale.updateMany({ where: { clientId: merge.id }, data: { clientId: keep.id } });
    await tx.customerBlock.updateMany({ where: { clientId: merge.id }, data: { clientId: keep.id } });
    await tx.report.updateMany({ where: { clientId: merge.id }, data: { clientId: keep.id } });
    const keepHasDefault = (await tx.clientAddress.count({ where: { clientId: keep.id, isDefault: true } })) > 0;
    await tx.clientAddress.updateMany({ where: { clientId: merge.id }, data: { clientId: keep.id, ...(keepHasDefault ? { isDefault: false } : {}) } });
    await tx.client.update({ where: { id: merge.id }, data: { mergedIntoId: keep.id, deletedAt: new Date(), phone: null } });
    const updated = await tx.client.update({
      where: { id: keep.id },
      data: {
        tags: [...new Set([...keep.tags, ...merge.tags])].slice(0, 20),
        phone2: keep.phone2 ?? (merge.phone && merge.phone !== keep.phone ? merge.phone : merge.phone2),
        email: keep.email ?? merge.email,
        notes: [keep.notes, merge.notes].filter(Boolean).join('\n') || null,
        ...(keep.isPlaceholder && !merge.isPlaceholder ? { name: merge.name } : {}),
      },
    });
    await this.aggregates.recompute(tx, keep.id);
    for (const c of convs) {
      const conv = await tx.conversation.findUniqueOrThrow({ where: { id: c.id } });
      await this.outbox.ws(tx, `ws:${conv.workspaceId}`, 'conversation.updated', { id: conv.id, conversation: conversationHead(conv) });
    }
    return updated;
  }

  private async mergePreview(keep: Client, merge: Client): Promise<ClientMergePreview> {
    const index = await this.safety.index();
    const ref = async (c: Client) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      riskLevel: c.riskLevel,
      isPlaceholder: c.isPlaceholder,
      blocked: index.has({ clientId: c.id, channelId: '', externalSenderId: '' }, c.phone),
      orderCount: c.orderCount,
      conversations: await prisma.conversation.count({ where: { clientId: c.id, deletedAt: null } }),
    });
    return { keep: await ref(keep), merge: await ref(merge) };
  }

  /** `POST /clients/merge { keepId, mergeId, confirm }` — without `confirm` ⇒ 409 CUSTOMER_MERGE_IRREVERSIBLE + preview. */
  async merge(keepId: string, mergeId: string, confirm: boolean): Promise<ClientView> {
    if (keepId === mergeId) throw new AppException('VALIDATION_ERROR', {}, { mergeId: 'validation.invalid' });
    const [keep, merge] = await Promise.all([prisma.client.findFirst({ where: { id: keepId, deletedAt: null } }), prisma.client.findFirst({ where: { id: mergeId, deletedAt: null } })]);
    if (!keep || !merge) throw notFound();
    if (!confirm) throw new AppException('CUSTOMER_MERGE_IRREVERSIBLE', {}, {}, await this.mergePreview(keep, merge));
    await prisma.$transaction((db) => this.mergeInto(db as Tx, keep, merge));
    const t = TenantContext.get();
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'client.merge', entity: 'Client', entityId: keepId, after: { mergedId: mergeId, mergedName: merge.name } });
    return this.get(keepId);
  }

  /**
   * The client of an order (manual, AI, API — CLI-02): an existing id, else the live owner of the normalised phone, else
   * the conversation's placeholder completed with the collected identity, else a new client. A placeholder of the
   * conversation that differs from the phone owner is merged into the owner (identity re-pointed, conversation re-linked).
   */
  async resolveForOrder(tx: Tx, input: { id: string; phone?: string } | { name: string; phone: string; phone2?: string | null; email?: string | null }, o: { source: 'manual' | 'ai' | 'api' | 'import'; conversationClientId?: string | null }): Promise<{ client: Client; created: boolean }> {
    if ('id' in input) {
      const c = await tx.client.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!c) throw new AppException('VALIDATION_ERROR', {}, { 'client.id': 'validation.invalid' });
      if (c.phone) return { client: c, created: false };
      // no order without a phone to call / deliver (tester report 2026-10-20): the order form gives it, the client is completed
      if (!input.phone) throw new AppException('VALIDATION_ERROR', {}, { 'client.phone': 'validation.required' });
      const owner = await tx.client.findFirst({ where: { phone: input.phone, deletedAt: null, id: { not: c.id } }, select: { id: true, name: true } });
      if (owner) throw new AppException('CLIENT_PHONE_EXISTS', { clientName: owner.name }, { 'client.phone': 'validation.phone_taken' }, { clientId: owner.id });
      return { client: await tx.client.update({ where: { id: c.id }, data: { phone: input.phone, isPlaceholder: false } }), created: false };
    }
    const convClient = o.conversationClientId ? await tx.client.findFirst({ where: { id: o.conversationClientId } }) : null;
    const owner = await tx.client.findFirst({ where: { phone: input.phone, deletedAt: null } });
    if (owner) {
      if (convClient && convClient.isPlaceholder && convClient.id !== owner.id && !convClient.deletedAt) {
        const merged = await this.mergeInto(tx, owner, convClient);
        return { client: merged, created: false };
      }
      return { client: owner, created: false };
    }
    if (convClient && convClient.isPlaceholder && !convClient.deletedAt) {
      const c = await tx.client.update({ where: { id: convClient.id }, data: { name: input.name, phone: input.phone, phone2: input.phone2 ?? null, email: input.email ?? null, isPlaceholder: false } });
      return { client: c, created: false };
    }
    const c = await tx.client.create({ data: { workspaceId: TenantContext.workspaceId(), name: input.name, phone: input.phone, phone2: input.phone2 ?? null, email: input.email ?? null, source: o.source } });
    await this.customerNew(tx, c);
    return { client: c, created: true };
  }

  // --- export (06 §7 clients columns) -----------------------------------------------------------------------------------
  private async exportTable(q: ClientsQuery & { ids?: string[] }, locale: 'fr' | 'ar' | 'en') {
    const index = await this.safety.index();
    const where = q.ids?.length ? { id: { in: q.ids }, deletedAt: null } : await this.where({ ...q, page: 1, pageSize: 25 } as ClientsQuery, index);
    const rows = await prisma.client.findMany({ where, orderBy: this.orderBy(q.sort), take: 50_000 });
    const h = HEADERS[locale] ?? HEADERS.fr;
    type R = (typeof rows)[number];
    return {
      sheetName: h.sheet,
      fileName: `clients-${algiersDay()}`,
      rows,
      columns: [
        { header: h.name, value: (r: R) => r.name },
        { header: h.phone, value: (r: R) => r.phone ?? '' },
        { header: h.email, value: (r: R) => r.email ?? '' },
        { header: h.source, value: (r: R) => r.source },
        { header: h.orders, value: (r: R) => r.orderCount },
        { header: h.spent, value: (r: R) => r.totalSpent },
        { header: h.lastOrder, value: (r: R) => (r.lastOrderAt ? algiersDay(r.lastOrderAt) : '') },
        { header: h.tags, value: (r: R) => r.tags.join(', ') },
      ],
    };
  }
}

const HEADERS = {
  fr: { sheet: 'Clients', name: 'Nom', phone: 'Téléphone', email: 'E-mail', source: 'Source', orders: 'Commandes', spent: 'Dépensé (DA)', lastOrder: 'Dernière commande', tags: 'Tags' },
  en: { sheet: 'Clients', name: 'Name', phone: 'Phone', email: 'E-mail', source: 'Source', orders: 'Orders', spent: 'Spent (DA)', lastOrder: 'Last order', tags: 'Tags' },
  ar: { sheet: 'العملاء', name: 'الاسم', phone: 'الهاتف', email: 'البريد الإلكتروني', source: 'المصدر', orders: 'الطلبات', spent: 'المصروف (دج)', lastOrder: 'آخر طلب', tags: 'الوسوم' },
} as const;
