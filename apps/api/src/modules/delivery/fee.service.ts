// DLV-01 / DLV-02 — the workspace fee grid (69 `DeliveryFeeRule` rows seeded from the V1 default table at workspace
// creation), "fill missing" / "reset all", per-row custom price and reset to default, and the quote used by the order
// form and the orders service (04 §4: free above the threshold for home delivery; customer price = grid, D15).
import { Injectable } from '@nestjs/common';
import { defaultFeeFor, prisma, TenantContext, type DeliveryFeeRule, type Tx } from '@djaber/db';
import { WILAYA_COUNT, type FeeGridMeta, type FeeQuoteView, type FeeRuleView, type UpdateFeeRuleInput } from '@djaber/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppException } from '../../core/errors/app.exception';
import { action } from '../catalog/catalog.util';

type Rule = Pick<DeliveryFeeRule, 'homePrice' | 'stopdeskPrice' | 'isActive' | 'freeAbove'>;

/** DLV-01 seed = the V1 default table (`packages/db/src/defaults.ts`), one row per wilaya, `source=default`. */
export const defaultFeeRows = async (tx: Tx, workspaceId: string) => {
  const wilayas = await tx.wilaya.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  return wilayas.map((w) => {
    const f = defaultFeeFor(w.id);
    return { workspaceId, wilayaId: w.id, homePrice: f.home, stopdeskPrice: f.stopdesk, returnPrice: f.return, isActive: true, source: 'default' as const, freeAbove: null };
  });
};

/**
 * Pure quote (04 §4, DLV-01/02): no rule or inactive rule ⇒ not served; stop-desk needs a stop-desk price; home delivery
 * is free when the subtotal reaches the rule's `freeAbove`, else the workspace threshold. An Admin+ override wins.
 */
export const quoteFee = (rule: Rule | null, o: { wilayaId: number; isStopdesk: boolean; subtotal?: number | null; threshold: number | null; override?: number | null }): FeeQuoteView => {
  const stopdeskAvailable = !!rule && rule.isActive && rule.stopdeskPrice > 0;
  const freeFrom = rule?.freeAbove ?? o.threshold ?? null;
  const base = !rule ? 0 : o.isStopdesk ? rule.stopdeskPrice : rule.homePrice;
  const common = { courierCost: null, stopdeskAvailable, freeFrom, wilayaId: o.wilayaId, isStopdesk: o.isStopdesk };
  if (!rule || !rule.isActive) return { ...common, fee: 0, base, free: false, reason: 'not_served', wilayaServed: false };
  if (o.isStopdesk && !stopdeskAvailable) return { ...common, fee: 0, base, free: false, reason: 'stopdesk_unavailable', wilayaServed: true };
  if (o.override !== undefined && o.override !== null) return { ...common, fee: o.override, base, free: o.override === 0, reason: 'override', wilayaServed: true };
  const free = !o.isStopdesk && freeFrom !== null && o.subtotal !== undefined && o.subtotal !== null && o.subtotal >= freeFrom;
  return { ...common, fee: free ? 0 : base, base, free, reason: free ? 'free_threshold' : 'grid', wilayaServed: true };
};

/** Words of the fee note per app language (UX-046, 10/11: the note stayed in French on the Arabic and English pages). */
const FEE_NOTE = {
  fr: { grid: (w: string, m: string, b: number) => `GRILLE ${w} · ${m} ${b}`, home: 'DOMICILE', stopdesk: 'POINT RELAIS', free: 'OFFERTE', changed: 'MODIFIÉ', notServed: 'NON DESSERVIE', arrow: '→' },
  en: { grid: (w: string, m: string, b: number) => `${w} FEE GRID · ${m} ${b}`, home: 'HOME', stopdesk: 'PICKUP POINT', free: 'FREE', changed: 'CHANGED', notServed: 'NOT SERVED', arrow: '→' },
  ar: { grid: (w: string, m: string, b: number) => `شبكة رسوم ${w} · ${m} ${b}`, home: 'توصيل للمنزل', stopdesk: 'نقطة استلام', free: 'مجاني', changed: 'معدَّل', notServed: 'غير مخدومة', arrow: '←' },
} as const;

/**
 * "GRILLE SÉTIF · DOMICILE 400 → OFFERTE" (OrderDto.feeExplanation) — assembled by the server in the request's language
 * (`Accept-Language`), with the wilaya name of that language (Arabic name in Arabic).
 */
export const feeExplanation = (q: FeeQuoteView, wilaya: string | { nameFr: string; nameAr: string } | null, locale = 'fr') => {
  const w = FEE_NOTE[locale === 'ar' || locale === 'en' ? locale : 'fr'];
  const name = wilaya === null ? String(q.wilayaId) : typeof wilaya === 'string' ? wilaya : locale === 'ar' ? wilaya.nameAr || wilaya.nameFr : wilaya.nameFr;
  const head = w.grid(name.toUpperCase(), q.isStopdesk ? w.stopdesk : w.home, q.base);
  if (q.reason === 'free_threshold') return `${head} ${w.arrow} ${w.free}`;
  if (q.reason === 'override') return `${head} ${w.arrow} ${q.fee} (${w.changed})`;
  if (q.reason === 'not_served') return `${head} ${w.arrow} ${w.notServed}`;
  return head;
};

@Injectable()
export class FeeService {
  constructor(private readonly audit: AuditService) {}

  /** The 69 default rows of a workspace. Existing rows are kept unless `overwrite`. */
  async seedDefaults(tx: Tx, workspaceId: string, overwrite = false) {
    const rows = await defaultFeeRows(tx, workspaceId);
    if (overwrite) {
      for (const r of rows) {
        await tx.deliveryFeeRule.upsert({ where: { workspaceId_wilayaId: { workspaceId, wilayaId: r.wilayaId } }, create: r, update: { homePrice: r.homePrice, stopdeskPrice: r.stopdeskPrice, returnPrice: r.returnPrice, isActive: true, source: 'default', freeAbove: null } });
      }
      return rows.length;
    }
    const r = await tx.deliveryFeeRule.createMany({ data: rows, skipDuplicates: true });
    return r.count;
  }

  private view(w: { id: number; code: string; nameFr: string; nameAr: string }, r: DeliveryFeeRule | undefined, courierCost: number | null = null): FeeRuleView {
    const d = defaultFeeFor(w.id);
    return {
      wilayaId: w.id,
      code: w.code,
      nameFr: w.nameFr,
      nameAr: w.nameAr,
      homePrice: r?.homePrice ?? d.home,
      stopdeskPrice: r?.stopdeskPrice ?? d.stopdesk,
      returnPrice: r?.returnPrice ?? d.return,
      freeAbove: r?.freeAbove ?? null,
      // a wilaya without a row is not served (the AI and the order form say so) until "Compléter les manquantes"
      isActive: r ? r.isActive : false,
      source: r?.source ?? 'default',
      courierCost,
      actions: [action('edit', 'delivery.manage'), action('reset', 'delivery.manage', { reasonCode: r?.source === 'custom' ? undefined : 'FEE_RULE_NOT_FOUND' })],
    };
  }

  /** `GET /delivery/fees` — 69 rows in wilaya order + `meta`. */
  async grid(): Promise<{ data: FeeRuleView[]; meta: FeeGridMeta }> {
    const [wilayas, rules, ws] = await Promise.all([
      prisma.wilaya.findMany({ orderBy: { id: 'asc' } }),
      prisma.deliveryFeeRule.findMany(),
      prisma.workspace.findUniqueOrThrow({ where: { id: TenantContext.workspaceId() }, select: { freeDeliveryThreshold: true, defaultCourierAccountId: true } }),
    ]);
    const by = new Map(rules.map((r) => [r.wilayaId, r]));
    // M6: the cached home rate of the default courier (informational, D15)
    const rates = ws.defaultCourierAccountId ? await prisma.courierRateCache.findMany({ where: { courierAccountId: ws.defaultCourierAccountId } }) : [];
    const cost = new Map(rates.map((x) => [x.wilayaId, x.homePrice]));
    const data = wilayas.map((w) => this.view(w, by.get(w.id), cost.get(w.id) ?? null));
    return { data, meta: { freeDeliveryThreshold: ws.freeDeliveryThreshold, custom: rules.filter((r) => r.source === 'custom').length, inactive: data.filter((r) => !r.isActive).length, missing: WILAYA_COUNT - rules.length } };
  }

  private async row(wilayaId: number) {
    const w = await prisma.wilaya.findUnique({ where: { id: wilayaId } });
    if (!w) throw new AppException('NOT_FOUND');
    return w;
  }

  private auditFees(action: string, entityId: string | null, after: unknown) {
    const t = TenantContext.get();
    return this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action, entity: 'DeliveryFeeRule', entityId, after });
  }

  /** `PUT /delivery/fees/:wilayaId` — custom prices for one wilaya (audited: fee changes are money settings). */
  async update(wilayaId: number, input: UpdateFeeRuleInput): Promise<FeeRuleView> {
    const w = await this.row(wilayaId);
    const ws = TenantContext.workspaceId();
    const d = defaultFeeFor(wilayaId);
    const data = { homePrice: input.homePrice, stopdeskPrice: input.stopdeskPrice, returnPrice: input.returnPrice ?? undefined, freeAbove: input.freeAbove === undefined ? undefined : input.freeAbove, isActive: input.isActive ?? undefined, source: 'custom' as const };
    const r = await prisma.deliveryFeeRule.upsert({
      where: { workspaceId_wilayaId: { workspaceId: ws, wilayaId } },
      create: { workspaceId: ws, wilayaId, homePrice: input.homePrice, stopdeskPrice: input.stopdeskPrice, returnPrice: input.returnPrice ?? d.return, freeAbove: input.freeAbove ?? null, isActive: input.isActive ?? true, source: 'custom' },
      update: data,
    });
    await this.auditFees('delivery_fee.update', r.id, { wilayaId, ...input });
    return this.view(w, r);
  }

  /** `DELETE /delivery/fees/:wilayaId` — back to the default prices (`source=default`); 422 FEE_RULE_NOT_FOUND when not custom. */
  async reset(wilayaId: number): Promise<FeeRuleView> {
    const w = await this.row(wilayaId);
    const existing = await prisma.deliveryFeeRule.findFirst({ where: { wilayaId } });
    if (!existing || existing.source !== 'custom') throw new AppException('FEE_RULE_NOT_FOUND');
    const d = defaultFeeFor(wilayaId);
    const r = await prisma.deliveryFeeRule.update({ where: { id: existing.id }, data: { homePrice: d.home, stopdeskPrice: d.stopdesk, returnPrice: d.return, freeAbove: null, isActive: true, source: 'default' } });
    await this.auditFees('delivery_fee.reset', r.id, { wilayaId });
    return this.view(w, r);
  }

  /** `POST /delivery/fees/seed { overwrite }` — fill the missing rows (custom kept) or reset every row. */
  async seed(overwrite: boolean) {
    const ws = TenantContext.workspaceId();
    const written = await prisma.$transaction((tx) => this.seedDefaults(tx as Tx, ws, overwrite));
    await this.auditFees(overwrite ? 'delivery_fee.reset_all' : 'delivery_fee.fill_missing', null, { written });
    return { written, ...(await this.grid()) };
  }

  /** Quote for the current workspace (order form, orders service). `db` = the caller's transaction when inside one. */
  async quote(o: { wilayaId: number; isStopdesk: boolean; subtotal?: number | null; override?: number | null }, db: Tx | typeof prisma = prisma): Promise<FeeQuoteView> {
    const [rule, ws] = await Promise.all([
      db.deliveryFeeRule.findFirst({ where: { wilayaId: o.wilayaId } }),
      db.workspace.findUniqueOrThrow({ where: { id: TenantContext.workspaceId() }, select: { freeDeliveryThreshold: true } }),
    ]);
    return quoteFee(rule, { ...o, threshold: ws.freeDeliveryThreshold });
  }

  /** Return fee charged when an order comes back (D27): the grid's `returnPrice` of the order's wilaya. */
  async returnPrice(wilayaId: number | null, db: Tx | typeof prisma = prisma): Promise<number> {
    if (!wilayaId) return 0;
    const rule = await db.deliveryFeeRule.findFirst({ where: { wilayaId } });
    return rule?.returnPrice ?? defaultFeeFor(wilayaId).return;
  }
}
