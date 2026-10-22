// 04-ai-pipeline §4.2 — the tools of a reply turn: JSON Schemas given to the model (names are final) and their
// execution. A tool never throws for a bad argument: it returns `{ ok:false, error:{ code, field, example } }` so the
// model re-asks the customer. Result codes (PRODUCT_NOT_AVAILABLE, WILAYA_NOT_SERVED, VARIANT_REQUIRED, …) are internal
// to the run: never returned by the API, not in the error catalogue. Every read is scoped to the agent's catalogue.
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AGENT_DEFAULT_MAX_AMOUNT, AGENT_DEFAULT_MAX_QTY, HANDOFF_REASONS, isPhoneDz, normalizePhoneDz, WILAYA_COUNT } from '@djaber/shared';
import { prisma, TenantContext, type Agent } from '@djaber/db';
import { FAQ_CANDIDATE_INSIGHT_AT } from '../ai.constants';
import { CatalogueService, type CatalogueProduct } from '../catalogue.service';
import type { AiToolDef } from '../provider/ai.gateway';
import { ORDER_TOOLS, PAYMENT_LINK_TOOL, type CancellableOrder, type CreateOrderRequest, type OrderTools, type PaymentLinkTool, type ToolResult } from './order-tools';
import { FlagsService } from '../../../core/flags/flags.service';
import { fold, WILAYA_ALIASES } from './wilaya-aliases';

export type ToolName = 'search_products' | 'get_product' | 'quote_delivery' | 'create_order' | 'cancel_order' | 'lookup_order' | 'handoff_to_human' | 'add_faq_candidate' | 'create_payment_link';
export type ToolRunContext = { workspaceId: string; agent: Agent; conversationId: string | null; clientId: string | null; channelId: string | null; runId: string; callId: string; dryRun: boolean };

const ALIASES: Record<string, ToolName> = { get_shipping_fee: 'quote_delivery', get_order_status: 'lookup_order' };
export const canonicalTool = (name: string): string => ALIASES[name] ?? name;

export const TOOL_DEFS: Record<ToolName, AiToolDef> = {
  search_products: {
    name: 'search_products',
    description: 'Find products in the shop catalogue by free text (name, keywords, category, colour, size).',
    parameters: { type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 } } },
  },
  get_product: {
    name: 'get_product',
    description: 'Full details of one catalogue product (description, variants with stock, recommendations).',
    parameters: { type: 'object', required: ['productId'], additionalProperties: false, properties: { productId: { type: 'string' } } },
  },
  quote_delivery: {
    name: 'quote_delivery',
    description: "Delivery fee for a wilaya from the merchant's grid (home or stop-desk). Apply free-delivery threshold. Give wilayaId or wilayaName.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { wilayaId: { type: 'integer', minimum: 1, maximum: WILAYA_COUNT }, wilayaName: { type: 'string' }, isStopdesk: { type: 'boolean', default: false }, subtotal: { type: 'integer', minimum: 0 } },
      // no top-level anyOf (Anthropic refuses it): `quote` answers INVALID_ARGS when both are missing
    },
  },
  create_order: {
    name: 'create_order',
    description: 'Create a cash-on-delivery order ONLY after the customer explicitly confirmed the recap.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['clientName', 'clientPhone', 'wilayaId', 'items', 'customerConfirmed'],
      properties: {
        clientName: { type: 'string', minLength: 3, maxLength: 80 },
        clientPhone: { type: 'string', pattern: '^(\\+213|00213|0)?[5-7][0-9]{8}$' },
        secondPhone: { type: 'string' },
        wilayaId: { type: 'integer', minimum: 1, maximum: WILAYA_COUNT },
        communeName: { type: 'string', maxLength: 100 },
        address: { type: 'string', maxLength: 500 },
        isStopdesk: { type: 'boolean', default: false },
        stopdeskId: { type: 'string' },
        items: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', required: ['productId', 'quantity'], properties: { productId: { type: 'string' }, variantId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } } } },
        notes: { type: 'string', maxLength: 500 },
        customerConfirmed: { const: true },
        phoneConfirmed: { type: 'boolean', description: 'true once the customer re-confirmed the phone number when a tool asked for it' },
        replacesOrder: { type: 'string', maxLength: 30, description: "number of THIS customer's order that the new one replaces (other product, size, quantity or address): the new order is created first, then that one is cancelled" },
      },
    },
  },
  cancel_order: {
    name: 'cancel_order',
    description: "Cancel one of THIS customer's orders that the shop has NOT confirmed yet. Never creates an order; to change an order use create_order with replacesOrder.",
    parameters: { type: 'object', additionalProperties: false, properties: { orderNumber: { type: 'string' }, reason: { type: 'string', maxLength: 200 }, customerConfirmed: { type: 'boolean' } } },
  },
  lookup_order: {
    name: 'lookup_order',
    description: "Status of THIS customer's recent orders (order status, courier status, tracking number).",
    parameters: { type: 'object', additionalProperties: false, properties: { orderNumber: { type: 'string' } } },
  },
  handoff_to_human: {
    name: 'handoff_to_human',
    description: 'Escalate to the merchant team. Use when a rule requires it or the customer asks.',
    parameters: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { enum: [...HANDOFF_REASONS] }, detail: { type: 'string', maxLength: 200 } } },
  },
  add_faq_candidate: {
    name: 'add_faq_candidate',
    description: 'Record a customer question the shop has no answer for, so the merchant can add it.',
    parameters: { type: 'object', required: ['question'], additionalProperties: false, properties: { question: { type: 'string', maxLength: 300 }, topic: { type: 'string', maxLength: 80 } } },
  },
  /** enabledWhen: workspace.onlinePaymentEnabled && flag `online_payment` (P2 — offered since M9). */
  create_payment_link: {
    name: 'create_payment_link',
    description: 'Create an online payment link (Chargily: CIB / Edahabia card, valid 15 minutes) for an order of THIS customer, only when the customer asks to pay online. Give the returned url to the customer; cash on delivery stays possible.',
    parameters: { type: 'object', required: ['orderId'], additionalProperties: false, properties: { orderId: { type: 'string', description: 'order id or order number (CMD-1001)' } } },
  },
};
/** §4.2 "Tool availability per run": order-taking is always on (D23); the payment link is conditional. */
export const RUN_TOOLS: ToolName[] = ['search_products', 'get_product', 'quote_delivery', 'lookup_order', 'add_faq_candidate', 'handoff_to_human', 'create_order', 'cancel_order'];

const invalid = (field: string, example?: string | number): ToolResult => ({ ok: false, error: { code: 'VALIDATION', field, ...(example !== undefined ? { example } : {}) } });
const str = z.string().trim();
const SearchArgs = z.object({ query: str.min(1).max(200), limit: z.coerce.number().int().min(1).max(30).default(10) });
const QuoteArgs = z.object({ wilayaId: z.coerce.number().int().min(1).max(WILAYA_COUNT).optional(), wilayaName: str.max(120).optional(), isStopdesk: z.boolean().default(false), subtotal: z.coerce.number().int().min(0).optional() });
const OrderArgs = z.object({
  clientName: str.min(3).max(80),
  clientPhone: str.min(1).max(30),
  secondPhone: str.max(30).optional(),
  wilayaId: z.coerce.number().int().min(1).max(WILAYA_COUNT),
  communeName: str.max(100).optional(),
  address: str.max(500).optional(),
  isStopdesk: z.boolean().default(false),
  stopdeskId: str.max(80).optional(),
  items: z.array(z.object({ productId: str.min(1), variantId: str.optional(), quantity: z.coerce.number().int().min(1) })).min(1).max(20),
  notes: str.max(500).optional(),
  customerConfirmed: z.unknown().optional(),
  phoneConfirmed: z.boolean().optional(),
  replacesOrder: str.max(30).optional(),
});
const EXAMPLES: Record<string, string | number> = { clientName: 'Amine Benali', clientPhone: '0555123456', secondPhone: '0661123456', wilayaId: 16, address: 'Cité 200 logements, Bt 4, Bab Ezzouar', quantity: 1 };
const normQuestion = (q: string) => fold(q).replace(/\s+/g, ' ').slice(0, 200);
const seqOf = (s: string) => 1000 + ([...s].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % 9000);

@Injectable()
export class ToolRegistry {
  constructor(
    private readonly catalogue: CatalogueService,
    @Inject(ORDER_TOOLS) private readonly orders: OrderTools,
    @Inject(PAYMENT_LINK_TOOL) private readonly paymentLinks: PaymentLinkTool,
    private readonly flags: FlagsService,
  ) {}

  /** Tools offered to the model for this run. */
  defs(): AiToolDef[] {
    return RUN_TOOLS.map((n) => TOOL_DEFS[n]);
  }

  /** §4.2 "Tool availability per run": + `create_payment_link` when the workspace switched online payment on. */
  async defsFor(workspaceId: string): Promise<AiToolDef[]> {
    const base = this.defs();
    if (!(await this.paymentLinks.enabledFor(workspaceId))) return base;
    if (!(await this.flags.isEnabledOr('online_payment', workspaceId, true))) return base;
    return [...base, TOOL_DEFS.create_payment_link];
  }

  /**
   * A tool result that ends the turn with the team: `handoff_to_human`, or a write tool the platform could not perform.
   * Returns the handoff reason, else null.
   */
  forcedHandoff(name: string, args: Record<string, unknown>, result: unknown): string | null {
    if (canonicalTool(name) === 'handoff_to_human') return typeof args.reason === 'string' && (HANDOFF_REASONS as readonly string[]).includes(args.reason) ? args.reason : 'other';
    const r = result as { hint?: unknown; error?: { code?: unknown } } | null;
    // 04 §13 / 04-ai-pipeline §4.2: a blocked customer, or a risky one with RISKY_CLIENT_POLICY=handoff, goes to the team
    if (r?.hint === 'risky_client' || r?.error?.code === 'CUSTOMER_BLOCKED') return 'risky_client';
    if (r?.hint === 'handoff') return r.error?.code === 'ORDERS_UNAVAILABLE' ? 'orders_unavailable' : 'other';
    return null;
  }

  async execute(rawName: string, args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const name = canonicalTool(rawName);
    switch (name) {
      case 'search_products':
        return this.search(args, ctx);
      case 'get_product':
        return this.product(args, ctx);
      case 'quote_delivery':
        return this.quote(args);
      case 'lookup_order':
        return this.lookup(args, ctx);
      case 'create_order':
        return this.createOrder(args, ctx);
      case 'cancel_order':
        return this.cancelOrder(args, ctx);
      case 'handoff_to_human':
        return { ok: true };
      case 'add_faq_candidate':
        return this.faqCandidate(args, ctx);
      case 'create_payment_link':
        return this.paymentLinks.forAi({ workspaceId: ctx.workspaceId, clientId: ctx.clientId, dryRun: ctx.dryRun }, typeof args.orderId === 'string' ? args.orderId.trim() : '');
      default:
        return { ok: false, error: { code: 'UNKNOWN_TOOL', name: rawName } };
    }
  }

  private view(p: CatalogueProduct) {
    // a product with variants is quoted at its variants' prices only (VARIANT_REQUIRED at create_order)
    const prices = p.variants.map((v) => v.price);
    const price = p.hasVariants ? (prices.length ? Math.min(...prices) : null) : p.price;
    const extra = p.hasVariants ? { priceMax: prices.length ? Math.max(...prices) : null, variantRequired: true } : { oldPrice: p.oldPrice };
    return { id: p.id, name: p.name, sku: p.sku, price, ...extra, stock: p.stock, hasVariants: p.hasVariants, variants: p.variants, imageUrl: p.imageUrl, category: p.category };
  }

  private async search(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const a = SearchArgs.safeParse(args);
    if (!a.success) return invalid(String(a.error.issues[0]?.path[0] ?? 'query'), 'robe satin');
    const products = await this.catalogue.search(ctx.agent, a.data.query, a.data.limit);
    return { products: products.map((p) => this.view(p)) };
  }

  private async product(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const id = typeof args.productId === 'string' ? args.productId : '';
    const [p] = await this.catalogue.byIds(ctx.agent, [id], true);
    // FL-01 F-9: archived / inactive / not approved / out of scope — the model is told, the customer sees no error
    if (!p) return { ok: false, error: { code: 'PRODUCT_NOT_AVAILABLE', productId: id } };
    return { ...this.view(p), description: p.description, recommendations: p.also };
  }

  private async wilaya(a: { wilayaId?: number; wilayaName?: string }) {
    if (a.wilayaId) return prisma.wilaya.findUnique({ where: { id: a.wilayaId } });
    const wanted = fold(a.wilayaName ?? '');
    if (!wanted) return null;
    const all = await prisma.wilaya.findMany();
    const exact = all.find((w) => fold(w.nameFr) === wanted || fold(w.nameAr) === wanted || w.code === wanted || String(w.id) === wanted);
    if (exact) return exact;
    const alias = WILAYA_ALIASES[wanted];
    if (alias) return all.find((w) => w.id === alias) ?? null;
    // the name inside a longer answer ("pour Oran svp", "wilaya de Sétif", "livraison à Ksar El Boukhari"): official
    // names first, then the spellings; the longest phrase wins ("Bir El Ater" over a shorter name inside it)
    const padded = ` ${wanted} `;
    const longest = (pairs: [string, number][]) => pairs.filter(([n]) => n && padded.includes(` ${n} `)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
    const id = longest(all.flatMap((w) => [[fold(w.nameFr), w.id], [fold(w.nameAr), w.id]] as [string, number][])) ?? longest(Object.entries(WILAYA_ALIASES));
    return id ? (all.find((w) => w.id === id) ?? null) : null;
  }

  /** Delivery fee of the merchant's grid; `free` when the subtotal reaches the rule's (or the workspace's) threshold. */
  async quote(args: Record<string, unknown>): Promise<ToolResult> {
    const a = QuoteArgs.safeParse(args);
    if (!a.success || (!a.data.wilayaId && !a.data.wilayaName)) return invalid('wilayaName', 'Alger');
    const wilaya = await this.wilaya(a.data);
    if (!wilaya) return invalid('wilayaName', 'Alger');
    const [rule, ws] = await Promise.all([
      prisma.deliveryFeeRule.findFirst({ where: { wilayaId: wilaya.id } }),
      prisma.workspace.findUniqueOrThrow({ where: { id: TenantContext.workspaceId() }, select: { freeDeliveryThreshold: true } }),
    ]);
    const stopdeskAvailable = !!rule && rule.isActive && rule.stopdeskPrice > 0;
    // FL-02 F-2: no rule / inactive rule ⇒ not served
    if (!rule || !rule.isActive) return { ok: false, error: { code: 'WILAYA_NOT_SERVED', wilayaId: wilaya.id, wilayaName: wilaya.nameFr, stopdeskAvailable: false } };
    if (a.data.isStopdesk && !stopdeskAvailable) return { ok: false, error: { code: 'WILAYA_NOT_SERVED', wilayaId: wilaya.id, wilayaName: wilaya.nameFr, stopdeskAvailable: false, homeAvailable: true } };
    const freeFrom = rule.freeAbove ?? ws.freeDeliveryThreshold ?? null;
    const free = !a.data.isStopdesk && freeFrom !== null && a.data.subtotal !== undefined && a.data.subtotal >= freeFrom;
    return { ok: true, wilayaId: wilaya.id, wilayaName: wilaya.nameFr, isStopdesk: a.data.isStopdesk, fee: free ? 0 : a.data.isStopdesk ? rule.stopdeskPrice : rule.homePrice, free, freeFrom, stopdeskAvailable, stopdeskFee: stopdeskAvailable ? rule.stopdeskPrice : null, etaDays: '2–5' };
  }

  /** AI-13: this client's orders, except closed ones older than 30 days. */
  private async lookup(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    if (!ctx.clientId) return { orders: [] };
    const number = typeof args.orderNumber === 'string' && args.orderNumber.trim() ? args.orderNumber.trim() : null;
    const old = new Date(Date.now() - 30 * 86_400_000);
    const rows = await prisma.order.findMany({
      where: { clientId: ctx.clientId, ...(number ? { number: { equals: number, mode: 'insensitive' } } : { NOT: { status: { in: ['delivered', 'cancelled', 'returned'] }, orderedAt: { lt: old } } }) },
      orderBy: { orderedAt: 'desc' },
      take: 5,
      include: { shipments: { orderBy: { createdAt: 'desc' }, take: 1, include: { events: { orderBy: { at: 'desc' }, take: 1 } } } },
    });
    return {
      orders: rows.map((o) => {
        const s = o.shipments[0];
        const e = s?.events[0];
        return { number: o.number, status: o.status, deliveryStatus: o.deliveryStatus, courier: s ? s.provider : null, trackingNumber: s?.trackingNumber ?? null, lastEvent: e ? { at: e.at.toISOString(), label: e.description ?? e.rawStatus } : null, total: o.total, orderedAt: o.orderedAt.toISOString() };
      }),
    };
  }

  /** Validation, catalogue check and limits of `create_order` (04 §5, FL-02); the write itself is the `OrderTools` port. */
  async prepareOrder(args: Record<string, unknown>, ctx: ToolRunContext): Promise<{ ok: true; request: CreateOrderRequest } | { ok: false; result: ToolResult }> {
    const fail = (result: ToolResult) => ({ ok: false as const, result });
    const a = OrderArgs.safeParse(args);
    if (!a.success) {
      const path = a.error.issues[0]?.path ?? [];
      const field = String(path[path.length - 1] ?? path[0] ?? 'items');
      return fail(invalid(path[0] === 'items' && path.length > 1 ? `items.${field}` : field, EXAMPLES[field]));
    }
    const d = a.data;
    if (d.customerConfirmed !== true) return fail({ ok: false, error: { code: 'CONFIRMATION_REQUIRED', message: 'show the recap and wait for the explicit confirmation of the customer' } });
    const phone = normalizePhoneDz(d.clientPhone);
    if (!isPhoneDz(phone)) return fail(invalid('clientPhone', EXAMPLES.clientPhone));
    const phone2 = d.secondPhone ? normalizePhoneDz(d.secondPhone) : null;
    if (phone2 && !isPhoneDz(phone2)) return fail(invalid('secondPhone', EXAMPLES.secondPhone));
    if (!d.isStopdesk && (d.address ?? '').length < 10) return fail(invalid('address', EXAMPLES.address));

    // A9: the order it replaces must be this customer's and not confirmed by the shop yet; its units count as free here
    let replaces: CreateOrderRequest['replaces'] = null;
    const freed = new Map<string, number>();
    if (d.replacesOrder) {
      const old = ctx.clientId ? await prisma.order.findFirst({ where: { clientId: ctx.clientId, number: { equals: d.replacesOrder.trim(), mode: 'insensitive' } }, include: { items: true } }) : null;
      if (!old || old.status === 'cancelled' || old.status === 'returned' || old.status === 'delivered' || old.deliveryStatus !== 'not_sent') return fail({ ok: false, error: { code: 'ORDER_NOT_REPLACEABLE', number: d.replacesOrder } });
      if (old.status !== 'new') return fail({ ok: false, error: { code: 'ORDER_CONFIRMED_BY_SELLER', number: old.number }, hint: 'handoff' });
      replaces = { id: old.id, number: old.number };
      for (const i of old.items) freed.set(`${i.productId}:${i.variantId ?? ''}`, (freed.get(`${i.productId}:${i.variantId ?? ''}`) ?? 0) + i.quantity);
    }

    const products = await this.catalogue.byIds(ctx.agent, d.items.map((i) => i.productId));
    const by = new Map(products.map((p) => [p.id, p]));
    const items: CreateOrderRequest['items'] = [];
    for (const i of d.items) {
      const p = by.get(i.productId);
      // AI-14: an archived / inactive product is dropped with a message, never ordered
      if (!p) return fail({ ok: false, error: { code: 'PRODUCT_NOT_AVAILABLE', productId: i.productId } });
      const v = p.hasVariants ? p.variants.find((x) => x.id === i.variantId) : null;
      if (p.hasVariants && !v) return fail({ ok: false, error: { code: 'VARIANT_REQUIRED', productId: p.id, availableVariants: p.variants.filter((x) => p.sellOutOfStock || x.stock > 0).map((x) => ({ id: x.id, name: x.name, price: x.price, stock: x.stock })) } });
      const stock = v ? v.stock : p.stock !== null && freed.size ? p.stock + (freed.get(`${p.id}:`) ?? 0) : p.stock;
      const free = stock === null ? null : v ? stock + (freed.get(`${p.id}:${v.id}`) ?? 0) : stock;
      // a product sold at zero stock (PV 22/10) is ordered whatever its stock
      if (free !== null && free < i.quantity && !p.sellOutOfStock) return fail({ ok: false, error: { code: 'ORDER_INSUFFICIENT_STOCK', productId: p.id, available: stock } });
      items.push({ productId: p.id, variantId: v?.id ?? null, quantity: i.quantity, name: p.name, variant: v?.name ?? null, unitPrice: v ? v.price : p.price });
    }
    const subtotal = items.reduce((n, i) => n + i.unitPrice * i.quantity, 0);
    const quantity = items.reduce((n, i) => n + i.quantity, 0);
    const maxQty = ctx.agent.maxQtyPerOrder ?? AGENT_DEFAULT_MAX_QTY;
    const maxAmount = ctx.agent.maxAmountPerOrder ?? AGENT_DEFAULT_MAX_AMOUNT;
    const quote = await this.quote({ wilayaId: d.wilayaId, isStopdesk: d.isStopdesk, subtotal });
    if (quote.ok === false) return fail(quote);
    const deliveryFee = Number(quote.fee ?? 0);
    // no order, no error code: the model must hand off with statusDetail=order_limits
    if (quantity > maxQty || subtotal + deliveryFee > maxAmount) return fail({ ok: false, hint: 'order_limit', maxQty, maxAmount });
    return {
      ok: true,
      request: { clientName: d.clientName, clientPhone: phone, secondPhone: phone2, wilayaId: d.wilayaId, communeName: d.communeName || null, address: d.address || null, isStopdesk: d.isStopdesk, stopdeskId: d.stopdeskId || null, notes: d.notes || null, items, subtotal, deliveryFee, total: subtotal + deliveryFee, ...(d.phoneConfirmed ? { phoneConfirmed: true } : {}), replaces },
    };
  }

  private async createOrder(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const prepared = await this.prepareOrder(args, ctx);
    if (!prepared.ok) return prepared.result;
    const r = prepared.request;
    // §8 dry run: everything validated, nothing written
    if (ctx.dryRun) return { ok: true, orderId: null, number: `TEST-${seqOf(ctx.callId)}`, simulated: true, subtotal: r.subtotal, deliveryFee: r.deliveryFee, total: r.total, items: r.items.map((i) => ({ name: i.name, variant: i.variant, quantity: i.quantity, unitPrice: i.unitPrice })), duplicateOf: null, paymentOptions: ['cod'] };
    return this.orders.createOrder({ workspaceId: ctx.workspaceId, agentId: ctx.agent.id, conversationId: ctx.conversationId, clientId: ctx.clientId, channelId: ctx.channelId, runId: ctx.runId, callId: ctx.callId }, r);
  }

  /** FL-02 F-5: this client's open orders only; one confirmed ⇒ cancel, several ⇒ ask which, none ⇒ hand off. */
  private async cancelOrder(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    if (!ctx.clientId) return { ok: false, error: { code: 'NO_OPEN_ORDER' } };
    const number = typeof args.orderNumber === 'string' && args.orderNumber.trim() ? args.orderNumber.trim().toLowerCase() : null;
    // A8 (tester report 2026-10-20): only orders the shop has not confirmed yet; a confirmed one is the team's to cancel
    const open = await prisma.order.findMany({ where: { clientId: ctx.clientId, status: 'new', deliveryStatus: 'not_sent' }, orderBy: { orderedAt: 'desc' }, take: 10 });
    const candidates: CancellableOrder[] = open.map((o) => ({ id: o.id, number: o.number, total: o.total, status: o.status, orderedAt: o.orderedAt.toISOString() }));
    const publicList = candidates.map(({ id: _id, ...c }) => c);
    const confirmed = await prisma.order.findFirst({ where: { clientId: ctx.clientId, status: { in: ['confirmed', 'preparing'] }, deliveryStatus: 'not_sent', ...(number ? { number: { equals: number, mode: 'insensitive' } } : {}) }, select: { number: true } });
    if (confirmed && (!candidates.length || (number && !candidates.some((c) => c.number.toLowerCase() === number)))) return { ok: false, error: { code: 'ORDER_CONFIRMED_BY_SELLER', number: confirmed.number }, hint: 'handoff' };
    if (!candidates.length) {
      const any = number ? await prisma.order.findFirst({ where: { clientId: ctx.clientId, number: { equals: number, mode: 'insensitive' } }, select: { id: true } }) : await prisma.order.findFirst({ where: { clientId: ctx.clientId, status: { notIn: ['cancelled', 'returned', 'delivered'] } }, select: { id: true } });
      return { ok: false, error: { code: any ? 'ORDER_NOT_CANCELLABLE' : 'NO_OPEN_ORDER' } };
    }
    const target = number ? candidates.find((c) => c.number.toLowerCase() === number) : candidates.length === 1 ? candidates[0] : undefined;
    if (number && !target) return { ok: false, error: { code: 'ORDER_NOT_CANCELLABLE' } };
    // never cancels without the customer's confirmation, and never in the playground
    if (!target || args.customerConfirmed !== true || ctx.dryRun) return { ok: true, candidates: publicList, ...(ctx.dryRun ? { simulated: true } : {}) };
    return this.orders.cancelOrder({ workspaceId: ctx.workspaceId, agentId: ctx.agent.id, conversationId: ctx.conversationId, clientId: ctx.clientId, channelId: ctx.channelId, runId: ctx.runId, callId: ctx.callId }, target, typeof args.reason === 'string' ? args.reason.slice(0, 200) : null);
  }

  /** `AgentFaq(source = ai_suggested, isActive = false)` counts the customers who asked; ≥ 3 ⇒ insight `unknown_topic`. */
  private async faqCandidate(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const question = typeof args.question === 'string' ? args.question.trim().slice(0, 300) : '';
    if (!question) return invalid('question');
    if (ctx.dryRun) return { ok: true, simulated: true };
    const key = normQuestion(question);
    const existing = (await prisma.agentFaq.findMany({ where: { agentId: ctx.agent.id, source: 'ai_suggested' }, select: { id: true, question: true, askedCount: true } })).find((f) => normQuestion(f.question) === key);
    const count = (existing?.askedCount ?? 0) + 1;
    if (existing) await prisma.agentFaq.update({ where: { id: existing.id }, data: { askedCount: count } });
    else await prisma.agentFaq.create({ data: { workspaceId: ctx.workspaceId, agentId: ctx.agent.id, question, answer: '', source: 'ai_suggested', askedCount: 1, isActive: false, sortOrder: 1000 } });
    return { ok: true, count, suggestInsight: count === FAQ_CANDIDATE_INSIGHT_AT, topicKey: key.slice(0, 80) };
  }
}
