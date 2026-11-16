// INV-01…03 / 04 §19 (D55) — inventory counts `INV-n`: one open count per workspace, scope all | category (with
// sub-categories) | alerts_only, expected quantities snapshot at start, counting (web / mobile scan) by every member
// with `stock.count`, validation (Admin+) that writes one `StockMovement(type=inventory, reason=inventory,
// refType=inventory)` per line with a real variance (expected + movements since the start), `Product.lastInventoryAt`,
// the variance > 10 % alert (GDS-10), cancel without movement. Untracked and archived products are excluded.
import { Injectable } from '@nestjs/common';
import { INVENTORY_SORTS, inventoryNeedsNote, inventoryVariancePct, type InventoriesQuery, type InventoryLinesInput, type InventoryLineView, type InventoryListItemView, type InventoryScopePreviewView, type InventoryView, type StartInventoryInput, type ValidateInventoryInput } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type InventoryCount, type InventoryScope, type Tx } from '@djaber/db';
import { CounterService } from '../../core/counter/counter.service';
import { AppException, conflict, validationError } from '../../core/errors/app.exception';
import { page, type Page } from '../../core/http/pagination';
import { OutboxService } from '../../core/outbox/outbox.service';
import { action } from '../catalog/catalog.util';
import { StockService } from '../catalog/stock.service';
import { StockRecoService } from '../recommendations/stock-reco.service';
import { dateLabel, GDS_LABELS } from './gds-document.pdf';
import { GdsPrintService } from './gds-print.service';
import { iso, lockRow, sortOf, USER_SELECT, userRef } from './gds.util';

const OPEN = ['draft', 'counting'] as const;
const LIST_INCLUDE = { category: { select: { name: true } }, startedBy: { select: USER_SELECT }, validatedBy: { select: USER_SELECT } } satisfies Prisma.InventoryCountInclude;
type CountRow = Prisma.InventoryCountGetPayload<{ include: typeof LIST_INCLUDE }>;
type ScopeLine = { productId: string; variantId: string | null; expectedQty: number };
const lineKey = (productId: string, variantId: string | null) => `${productId}|${variantId ?? ''}`;

@Injectable()
export class InventoryService {
  constructor(
    private readonly stock: StockService,
    private readonly counter: CounterService,
    private readonly outbox: OutboxService,
    private readonly printer: GdsPrintService,
    private readonly recos: StockRecoService,
  ) {}

  private notFound() {
    return new AppException('INVENTORY_NOT_FOUND');
  }

  // --- scope --------------------------------------------------------------------------------------------------------------
  /** Stock holders of a scope: tracked live products without variants + active live variants (04 §19). */
  private async scopeLines(db: Tx | typeof prisma, scope: InventoryScope, categoryId: string | null): Promise<ScopeLine[]> {
    let categoryIds: string[] | null = null;
    if (scope === 'category') {
      const cat = categoryId ? await db.category.findFirst({ where: { id: categoryId, deletedAt: null }, select: { id: true } }) : null;
      if (!cat) throw validationError({ categoryId: 'validation.invalid' });
      const children = await db.category.findMany({ where: { parentId: cat.id, deletedAt: null }, select: { id: true } });
      categoryIds = [cat.id, ...children.map((c) => c.id)];
    }
    const products = await db.product.findMany({
      where: { deletedAt: null, trackStock: true, ...(categoryIds ? { categoryId: { in: categoryIds } } : {}) },
      select: { id: true, hasVariants: true, stock: true, minStock: true, variants: { where: { deletedAt: null, isActive: true }, select: { id: true, stock: true, minStock: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const lines: ScopeLine[] = [];
    for (const p of products) {
      if (p.hasVariants) {
        for (const v of p.variants) if (scope !== 'alerts_only' || v.stock <= v.minStock) lines.push({ productId: p.id, variantId: v.id, expectedQty: v.stock });
      } else if (scope !== 'alerts_only' || (p.stock ?? 0) <= p.minStock) lines.push({ productId: p.id, variantId: null, expectedQty: p.stock ?? 0 });
    }
    return lines;
  }

  /** `GET /inventories/scope-preview` — sizes shown in the start dialog. */
  async scopePreview(q: { scope: InventoryScope; categoryId?: string }): Promise<InventoryScopePreviewView> {
    const lines = await this.scopeLines(prisma, q.scope, q.categoryId ?? null);
    return { scope: q.scope, categoryId: q.categoryId ?? null, products: new Set(lines.map((l) => l.productId)).size, variants: lines.filter((l) => l.variantId).length, lines: lines.length };
  }

  // --- presenting ---------------------------------------------------------------------------------------------------------
  private actions(c: Pick<InventoryCount, 'status'>) {
    if (c.status === 'draft' || c.status === 'counting') {
      return [
        action('count', 'stock.count', { primary: c.status === 'draft' }),
        action('validate', 'stock.adjust', { primary: c.status === 'counting' }),
        action('sheet', 'stock.adjust'),
        action('cancel', 'stock.adjust'),
      ];
    }
    return [action('open', 'stock.count', { primary: true }), action('sheet', 'stock.adjust')];
  }

  private listItem(c: CountRow, counted: number): InventoryListItemView {
    return {
      id: c.id,
      number: c.number,
      scope: c.scope,
      categoryId: c.categoryId,
      categoryName: c.category?.name ?? null,
      status: c.status,
      blockCounterSales: c.blockCounterSales,
      summary: { lines: c.lineCount, counted, discrepancies: c.discrepancyCount, value: c.discrepancyValue },
      startedBy: userRef(c.startedBy),
      startedAt: c.startedAt.toISOString(),
      validatedBy: userRef(c.validatedBy),
      validatedAt: iso(c.validatedAt),
      actions: this.actions(c),
    };
  }

  async list(q: InventoriesQuery): Promise<Page<InventoryListItemView>> {
    const { field, dir } = sortOf(q.sort, INVENTORY_SORTS, '-startedAt');
    const where: Prisma.InventoryCountWhereInput = q.status?.length ? { status: { in: q.status } } : {};
    const [rows, total] = await Promise.all([
      prisma.inventoryCount.findMany({ where, include: LIST_INCLUDE, orderBy: [{ [field]: dir }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.inventoryCount.count({ where }),
    ]);
    const counted = rows.length ? await prisma.inventoryCountLine.groupBy({ by: ['inventoryCountId'], where: { inventoryCountId: { in: rows.map((r) => r.id) }, countedQty: { not: null } }, _count: { _all: true } }) : [];
    const by = new Map(counted.map((c) => [c.inventoryCountId, c._count._all]));
    return page(rows.map((r) => this.listItem(r, by.get(r.id) ?? 0)), total, q);
  }

  /** Σ movements of each line written after the start (the count's own movements excluded). */
  private async movedSince(db: Tx | typeof prisma, c: Pick<InventoryCount, 'id' | 'startedAt'>, productIds: string[]) {
    if (!productIds.length) return new Map<string, number>();
    const rows = await db.stockMovement.groupBy({
      by: ['productId', 'variantId'],
      where: { productId: { in: productIds }, createdAt: { gte: c.startedAt }, OR: [{ refType: null }, { refType: { not: 'inventory' } }, { refId: null }, { refId: { not: c.id } }] },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [lineKey(r.productId, r.variantId), r._sum.quantity ?? 0]));
  }

  async get(id: string): Promise<InventoryView> {
    const c = await prisma.inventoryCount.findFirst({ where: { id }, include: LIST_INCLUDE });
    if (!c) throw this.notFound();
    const lines = await prisma.inventoryCountLine.findMany({
      where: { inventoryCountId: id },
      include: { product: { select: { name: true, sku: true, costPrice: true } }, variant: { select: { name: true, sku: true, costPrice: true } } },
      orderBy: [{ product: { name: 'asc' } }, { id: 'asc' }],
    });
    const open = (OPEN as readonly string[]).includes(c.status);
    const moved = open ? await this.movedSince(prisma, c, [...new Set(lines.map((l) => l.productId))]) : new Map<string, number>();
    const views: InventoryLineView[] = lines.map((l) => {
      const current = open ? l.expectedQty + (moved.get(lineKey(l.productId, l.variantId)) ?? 0) : l.expectedQty;
      const difference = open ? (l.countedQty === null ? 0 : l.countedQty - current) : l.difference;
      const pct = open ? (l.countedQty === null ? 0 : inventoryVariancePct(current, l.countedQty)) : l.differencePct;
      return {
        productId: l.productId,
        variantId: l.variantId,
        name: l.product.name,
        variantName: l.variant?.name ?? null,
        sku: l.variant?.sku ?? l.product.sku,
        expectedQty: l.expectedQty,
        currentExpectedQty: current,
        countedQty: l.countedQty,
        difference,
        differencePct: pct,
        noteRequired: l.countedQty !== null && inventoryNeedsNote(current, l.countedQty),
        note: l.note,
        costPrice: l.variant?.costPrice ?? l.product.costPrice ?? null,
        movementId: l.movementId,
      };
    });
    return { ...this.listItem(c, lines.filter((l) => l.countedQty !== null).length), note: c.note, lines: views };
  }

  private async emit(tx: Tx, id: string) {
    const [total, counted] = await Promise.all([tx.inventoryCountLine.count({ where: { inventoryCountId: id } }), tx.inventoryCountLine.count({ where: { inventoryCountId: id, countedQty: { not: null } } })]);
    await this.outbox.ws(tx, `ws:${TenantContext.workspaceId()}`, 'inventory.updated', { id, progress: total ? Math.round((counted * 100) / total) : 100 }, `inventory.updated:${id}:${counted}:${Date.now()}`);
  }

  // --- writing ------------------------------------------------------------------------------------------------------------
  /** `POST /inventories` — 409 INVENTORY_IN_PROGRESS {number} when a count is already open. */
  async start(input: StartInventoryInput): Promise<InventoryView> {
    const id = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const ws = TenantContext.workspaceId();
      // one open count per workspace: the workspace row serialises two concurrent starts
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${ws}::uuid FOR UPDATE`;
      const open = await tx.inventoryCount.findFirst({ where: { status: { in: [...OPEN] } }, select: { number: true } });
      if (open) throw new AppException('INVENTORY_IN_PROGRESS', { number: open.number });
      const lines = await this.scopeLines(tx, input.scope, input.categoryId ?? null);
      const number = await this.counter.next(tx, 'inventory');
      const c = await tx.inventoryCount.create({
        data: { workspaceId: ws, number, scope: input.scope, categoryId: input.scope === 'category' ? (input.categoryId ?? null) : null, blockCounterSales: input.blockCounterSales, startedById: TenantContext.get().userId!, note: input.note ?? null, lineCount: lines.length } as Prisma.InventoryCountUncheckedCreateInput,
      });
      if (lines.length) await tx.inventoryCountLine.createMany({ data: lines.map((l) => ({ inventoryCountId: c.id, productId: l.productId, variantId: l.variantId, expectedQty: l.expectedQty })) });
      await this.emit(tx, c.id);
      return c.id;
    });
    return this.get(id);
  }

  private async lock(tx: Tx, id: string) {
    if (!(await lockRow(tx, 'InventoryCount', id))) throw this.notFound();
    return tx.inventoryCount.findUniqueOrThrow({ where: { id } });
  }

  /** `PUT /inventories/:id/lines` — counted quantities (draft → counting). */
  async putLines(id: string, input: InventoryLinesInput): Promise<InventoryView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const c = await this.lock(tx, id);
      if (!(OPEN as readonly string[]).includes(c.status)) throw conflict({ reason: 'INVENTORY_CLOSED', status: c.status });
      const lines = await tx.inventoryCountLine.findMany({ where: { inventoryCountId: id }, select: { id: true, productId: true, variantId: true, expectedQty: true } });
      const by = new Map(lines.map((l) => [lineKey(l.productId, l.variantId), l]));
      for (const [n, l] of input.lines.entries()) {
        const line = by.get(lineKey(l.productId, l.variantId ?? null));
        if (!line) throw validationError({ [`lines.${n}.productId`]: 'validation.invalid' });
        const difference = l.countedQty === null ? 0 : l.countedQty - line.expectedQty;
        await tx.inventoryCountLine.update({
          where: { id: line.id },
          data: { countedQty: l.countedQty, difference, differencePct: l.countedQty === null ? 0 : inventoryVariancePct(line.expectedQty, l.countedQty), ...(l.note !== undefined ? { note: l.note } : {}) },
        });
      }
      if (c.status === 'draft') await tx.inventoryCount.update({ where: { id }, data: { status: 'counting' } });
      await this.emit(tx, id);
    });
    return this.get(id);
  }

  /**
   * `POST /inventories/:id/validate` (Idempotency-Key required, Admin+). Variance = counted − (expected + movements since
   * the start); > 10 % without a note ⇒ 422 INVENTORY_VARIANCE_NOTE_REQUIRED (`fields.lines.N.note`, N = line order of GET).
   */
  async validate(id: string, input: ValidateInventoryInput): Promise<InventoryView> {
    const order = (await this.get(id)).lines.map((l) => lineKey(l.productId, l.variantId));
    await prisma.$transaction(
      async (db) => {
        const tx = db as Tx;
        const c = await this.lock(tx, id);
        if (!(OPEN as readonly string[]).includes(c.status)) throw conflict({ reason: 'INVENTORY_CLOSED', status: c.status });
        const lines = await tx.inventoryCountLine.findMany({
          where: { inventoryCountId: id },
          include: { product: { select: { name: true, trackStock: true, deletedAt: true, costPrice: true } }, variant: { select: { name: true, deletedAt: true, costPrice: true } } },
        });
        const moved = await this.movedSince(tx, c, [...new Set(lines.map((l) => l.productId))]);
        const counted = lines.filter((l) => l.countedQty !== null && l.product.trackStock && !l.product.deletedAt && !(l.variantId && l.variant?.deletedAt));
        const plan = counted.map((l) => {
          const expected = l.expectedQty + (moved.get(lineKey(l.productId, l.variantId)) ?? 0);
          return { l, expected, difference: l.countedQty! - expected, pct: inventoryVariancePct(expected, l.countedQty!), note: inventoryNeedsNote(expected, l.countedQty!) };
        });
        const missing = plan.filter((p) => p.note && !p.l.note?.trim());
        if (missing.length) throw new AppException('INVENTORY_VARIANCE_NOTE_REQUIRED', {}, Object.fromEntries(missing.map((p) => [`lines.${order.indexOf(lineKey(p.l.productId, p.l.variantId))}.note`, 'validation.required'])));
        let discrepancies = 0;
        let value = 0;
        // stable lock order (product id) like the other stock writers
        plan.sort((a, b) => a.l.productId.localeCompare(b.l.productId) || (a.l.variantId ?? '').localeCompare(b.l.variantId ?? ''));
        for (const p of plan) {
          let movementId: string | null = null;
          if (p.difference !== 0) {
            const r = await this.stock.move(tx, {
              productId: p.l.productId,
              variantId: p.l.variantId,
              change: { delta: p.difference },
              type: 'inventory',
              reason: 'inventory',
              note: `${c.number}${p.l.note ? ` · ${p.l.note}` : ''}`,
              refType: 'inventory',
              refId: c.id,
              allowNegative: true,
            });
            movementId = r.movement?.id ?? null;
            discrepancies++;
            // net value of the variances, signed like the count page and its validate dialog (J07-11: « −4 574 », never « 4 574 »)
            value += p.difference * (p.l.variant?.costPrice ?? p.l.product.costPrice ?? 0);
          }
          await tx.inventoryCountLine.update({ where: { id: p.l.id }, data: { expectedQty: p.expected, difference: p.difference, differencePct: p.pct, movementId } });
        }
        const productIds = [...new Set(plan.map((p) => p.l.productId))];
        if (productIds.length) await tx.product.updateMany({ where: { id: { in: productIds } }, data: { lastInventoryAt: new Date() } });
        await tx.inventoryCount.update({
          where: { id },
          data: { status: 'validated', validatedAt: new Date(), validatedById: TenantContext.get().userId ?? null, discrepancyCount: discrepancies, discrepancyValue: value, ...(input.note !== undefined ? { note: input.note } : {}) },
        });
        // INV-02: variance > 10 % ⇒ recommendation alert "écarts inventaire > 10 % à vérifier"
        await this.recos.raiseInventoryVariance(
          tx,
          plan.filter((p) => p.note).map((p) => ({ productId: p.l.productId, variantId: p.l.variantId, name: p.l.product.name, variantName: p.l.variant?.name ?? null, expected: p.expected, counted: p.l.countedQty!, pct: p.pct, number: c.number, inventoryId: c.id })),
        );
        await this.emit(tx, id);
      },
      { timeout: 120_000 },
    );
    return this.get(id);
  }

  /** `POST /inventories/:id/cancel` — no movement; lines kept. */
  async cancel(id: string): Promise<InventoryView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const c = await this.lock(tx, id);
      if (!(OPEN as readonly string[]).includes(c.status)) throw conflict({ reason: 'INVENTORY_CLOSED', status: c.status });
      await tx.inventoryCount.update({ where: { id }, data: { status: 'cancelled' } });
      await this.emit(tx, id);
    });
    return this.get(id);
  }

  /** `GET /inventories/:id/sheet` — printable count sheet (expected quantity, blank counted column, notes). */
  async sheet(id: string, lang?: string) {
    const l = this.printer.lang(lang);
    const t = GDS_LABELS[l];
    const c = await this.get(id);
    const scopeLabel = c.scope === 'category' ? (c.categoryName ?? '') : c.scope;
    return this.printer.print(
      {
        lang: l,
        shopName: await this.printer.shopName(),
        title: t.inventory!,
        number: c.number,
        meta: [
          { label: t.scope!, value: scopeLabel },
          { label: t.startedAt!, value: dateLabel(c.startedAt) },
        ],
        columns: [
          { header: t.product!, width: 5 },
          { header: t.sku!, width: 2 },
          { header: t.expectedQty!, width: 1.4, align: 'right' },
          { header: t.counted!, width: 1.4, align: 'right' },
          { header: t.note!, width: 2.5 },
        ],
        rows: c.lines.map((x) => [x.variantName ? `${x.name} · ${x.variantName}` : x.name, x.sku ?? '', String(x.currentExpectedQty), x.countedQty === null ? '' : String(x.countedQty), x.note ?? '']),
        totals: [],
        note: c.note,
      },
      c.number,
    );
  }
}
