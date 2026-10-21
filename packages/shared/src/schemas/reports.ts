// Reports hub + report template (03 §14 GDS-10 — the 23 V1 reports with their fixes; §31 INV-03 "Écarts d'inventaire";
// §33 CSH-04 "Journal de caisse"; D62; 06 "GDS operations" `GET /reports`, §8.6 schedules; 12 §24; Figma ANA-03 / ANA-04).
// Permission `reports.read` (Owner + Admin; Operators 403), schedules `reports.schedule` + plan feature `scheduled_reports`.
// Labels are i18n keys: `report.<key>.title`, `report.<key>.description`, `report.group.<group>`, `report.col.<column>`,
// `report.kpi.<kpi>`, `report.line.<line>` (P&L lines), enum cells use the usual `enum.<Model>.<field>.<value>` keys.
import { z } from 'zod';
import { email } from '../validators';
import { ANALYTICS_PERIODS, type AnalyticsUnit, type MoneyFigureName } from './analytics';

export const REPORT_GROUPS = ['sales', 'orders', 'stock', 'purchases_cash', 'clients'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export const REPORT_KEYS = [
  // VENTES & REVENUS
  'sales_by_period',
  'sales_by_product',
  'sales_by_category',
  'top_products',
  'profit_loss',
  'discounts',
  'tax_summary',
  // COMMANDES & LIVRAISON
  'return_ratio',
  'payments',
  // STOCK
  'inventory_valuation',
  'stock_alerts',
  'dead_stock',
  'stock_aging',
  'inventory_variances',
  // ACHATS & CAISSE
  'purchases_by_supplier',
  'purchases_by_period',
  'product_purchases',
  'top_suppliers',
  'cash_register',
  'cash_flow',
  'expenses',
  // CLIENTS
  'top_customers',
  'inactive_customers',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
export const isReportKey = (v: unknown): v is ReportKey => typeof v === 'string' && (REPORT_KEYS as readonly string[]).includes(v);

/** D62: CSV up to 5 000 rows is produced at once; above, and XLSX always, it is a background job (kept 7 days). */
export const REPORT_CSV_IMMEDIATE_MAX_ROWS = 5000;
export const REPORT_EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

/** `file`: signed link to an attached file (cash proof) — "Voir" on screen, left out of the exported files */
export type ReportColumnType = 'text' | 'int' | 'money' | 'pct' | 'date' | 'datetime' | 'days' | 'enum' | 'file';
/** Row links of the template ("tout tableau est cliquable"): the row carries the id in `_ref`. */
export type ReportLink = 'product' | 'order' | 'sale' | 'purchase' | 'client' | 'supplier' | 'category';
export type ReportColumnDef = {
  key: string;
  type: ReportColumnType;
  /** cost / margin columns: hidden by the web in simple stock mode (03 ONB-03; the API returns them) */
  advanced?: boolean;
  sortable?: boolean;
  /** column summed in the totals row */
  sum?: boolean;
  link?: ReportLink;
  /** enum cells: i18n prefix (`enum.Order.status`) */
  enumKey?: string;
};
export type ReportKpiDef = { key: string; unit: AnalyticsUnit; figure?: MoneyFigureName; advanced?: boolean };
/**
 * M11 (Figma ANA-04 "Ventes par produit"): `source` = sold lines of counter sales, of delivered orders or both (default);
 * `channelId` = delivered orders of one page only (counter sales have no channel, so they drop out); `groupBy` = one row per
 * variant (default) or per product. Offered only by the reports built on the sold lines (sales by product / category, top
 * products). The period reports read the daily rollups: sales and orders are already separate columns there and the
 * rollups keep no channel split.
 */
export const REPORT_SOURCES = ['all', 'sales', 'orders'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];
export const REPORT_GROUP_BY = ['variant', 'product'] as const;
export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number];
export type ReportFilterKey = 'categoryId' | 'productId' | 'supplierId' | 'clientId' | 'days' | 'q' | 'source' | 'channelId' | 'groupBy';
export type ReportDefinition = {
  key: ReportKey;
  group: ReportGroup;
  /** listed in simple stock mode (D62: 9 of 23, "sans marges, achats, caisse, inventaire") */
  simple: boolean;
  /** `range` = period picker; `snapshot` = state of today (valuation, alerts, dead stock, inactive clients) */
  period: 'range' | 'snapshot';
  columns: ReportColumnDef[];
  kpis: ReportKpiDef[];
  chart: { type: 'bar' | 'line' | 'donut'; x: string; y: string[] } | null;
  filters: ReportFilterKey[];
  defaultSort: string;
  /** default of the `days` filter (dead stock 60 d, inactive clients 90 d) */
  defaultDays?: number;
};

const c = (key: string, type: ReportColumnType, o: Omit<ReportColumnDef, 'key' | 'type'> = {}): ReportColumnDef => ({ key, type, sortable: true, ...o });
const k = (key: string, unit: AnalyticsUnit, o: Omit<ReportKpiDef, 'key' | 'unit'> = {}): ReportKpiDef => ({ key, unit, ...o });
const product = c('product', 'text', { link: 'product' });
const variant = c('variant', 'text');
const sku = c('sku', 'text');
const category = c('category', 'text', { link: 'category' });

export const REPORT_DEFINITIONS: Record<ReportKey, ReportDefinition> = {
  sales_by_period: {
    key: 'sales_by_period',
    group: 'sales',
    simple: true,
    period: 'range',
    columns: [c('day', 'date'), c('salesCount', 'int', { sum: true }), c('salesRevenue', 'money', { sum: true }), c('deliveredOrders', 'int', { sum: true }), c('ordersRevenue', 'money', { sum: true }), c('revenue', 'money', { sum: true }), c('deliveryFees', 'money', { sum: true }), c('netRevenue', 'money', { sum: true }), c('discount', 'money', { sum: true })],
    kpis: [k('revenue', 'money', { figure: 'revenue' }), k('netRevenue', 'money', { figure: 'net_revenue' }), k('salesCount', 'count'), k('deliveredOrders', 'count'), k('avgBasket', 'money')],
    chart: { type: 'line', x: 'day', y: ['revenue'] },
    filters: [],
    defaultSort: 'day',
  },
  sales_by_product: {
    key: 'sales_by_product',
    group: 'sales',
    simple: true,
    period: 'range',
    columns: [product, variant, sku, category, c('quantity', 'int', { sum: true }), c('revenue', 'money', { sum: true }), c('cogs', 'money', { sum: true, advanced: true }), c('margin', 'money', { sum: true, advanced: true }), c('marginPct', 'pct', { advanced: true }), c('sharePct', 'pct')],
    kpis: [k('revenue', 'money', { figure: 'revenue' }), k('quantity', 'count'), k('products', 'count'), k('marginPct', 'pct', { advanced: true })],
    chart: { type: 'bar', x: 'product', y: ['revenue'] },
    filters: ['categoryId', 'productId', 'source', 'channelId', 'groupBy', 'q'],
    defaultSort: '-revenue',
  },
  sales_by_category: {
    key: 'sales_by_category',
    group: 'sales',
    simple: true,
    period: 'range',
    columns: [category, c('quantity', 'int', { sum: true }), c('revenue', 'money', { sum: true }), c('cogs', 'money', { sum: true, advanced: true }), c('margin', 'money', { sum: true, advanced: true }), c('sharePct', 'pct')],
    kpis: [k('revenue', 'money', { figure: 'revenue' }), k('quantity', 'count'), k('categories', 'count')],
    chart: { type: 'donut', x: 'category', y: ['revenue'] },
    filters: ['source', 'channelId'],
    defaultSort: '-revenue',
  },
  top_products: {
    key: 'top_products',
    group: 'sales',
    simple: true,
    period: 'range',
    columns: [c('rank', 'int'), product, sku, category, c('quantity', 'int', { sum: true }), c('orders', 'int', { sum: true }), c('revenue', 'money', { sum: true })],
    kpis: [k('quantity', 'count'), k('revenue', 'money', { figure: 'revenue' }), k('products', 'count')],
    chart: { type: 'bar', x: 'product', y: ['quantity'] },
    filters: ['categoryId', 'source', 'channelId', 'q'],
    defaultSort: '-quantity',
  },
  profit_loss: {
    key: 'profit_loss',
    group: 'sales',
    simple: false,
    period: 'range',
    columns: [c('line', 'enum', { enumKey: 'report.line', sortable: false }), c('amount', 'money', { sortable: false })],
    kpis: [k('revenue', 'money', { figure: 'revenue' }), k('cogs', 'money'), k('grossMargin', 'money'), k('expenses', 'money'), k('net', 'money'), k('purchasesPaid', 'money')],
    chart: { type: 'bar', x: 'line', y: ['amount'] },
    filters: [],
    defaultSort: 'line',
  },
  discounts: {
    key: 'discounts',
    group: 'sales',
    simple: true,
    period: 'range',
    columns: [c('date', 'date'), c('number', 'text', { link: 'order' }), c('documentType', 'enum', { enumKey: 'report.documentType' }), c('client', 'text', { link: 'client' }), c('subtotal', 'money', { sum: true }), c('discount', 'money', { sum: true }), c('discountPct', 'pct'), c('total', 'money', { sum: true })],
    kpis: [k('discount', 'money'), k('documents', 'count'), k('avgDiscountPct', 'pct')],
    chart: null,
    filters: ['clientId', 'q'],
    defaultSort: '-date',
  },
  tax_summary: {
    key: 'tax_summary',
    group: 'sales',
    simple: false,
    period: 'range',
    columns: [c('day', 'date'), c('salesTax', 'money', { sum: true }), c('ordersTax', 'money', { sum: true }), c('collectedTax', 'money', { sum: true }), c('purchasesTax', 'money', { sum: true }), c('balance', 'money', { sum: true })],
    kpis: [k('collectedTax', 'money'), k('purchasesTax', 'money'), k('balance', 'money')],
    chart: { type: 'bar', x: 'day', y: ['collectedTax', 'purchasesTax'] },
    filters: [],
    defaultSort: 'day',
  },
  return_ratio: {
    key: 'return_ratio',
    group: 'orders',
    simple: true,
    period: 'range',
    columns: [product, variant, sku, c('delivered', 'int', { sum: true }), c('returned', 'int', { sum: true }), c('returnRate', 'pct')],
    kpis: [k('returnedOrders', 'count'), k('returnRate', 'pct'), k('returnCosts', 'money')],
    chart: { type: 'bar', x: 'product', y: ['returned'] },
    filters: ['categoryId', 'q'],
    defaultSort: '-returned',
  },
  payments: {
    key: 'payments',
    group: 'orders',
    simple: false,
    period: 'range',
    columns: [c('date', 'datetime'), c('documentType', 'enum', { enumKey: 'report.documentType' }), c('number', 'text', { link: 'order' }), c('party', 'text'), c('method', 'enum', { enumKey: 'enum.Order.paymentMethod' }), c('direction', 'enum', { enumKey: 'report.direction' }), c('amount', 'money', { sum: true }), c('reference', 'text')],
    kpis: [k('received', 'money'), k('paid', 'money'), k('count', 'count')],
    chart: { type: 'donut', x: 'method', y: ['amount'] },
    filters: ['q'],
    defaultSort: '-date',
  },
  inventory_valuation: {
    key: 'inventory_valuation',
    group: 'stock',
    simple: false,
    period: 'snapshot',
    columns: [product, variant, sku, category, c('stock', 'int', { sum: true }), c('costPrice', 'money'), c('valueAtCost', 'money', { sum: true }), c('price', 'money'), c('valueAtRetail', 'money', { sum: true })],
    kpis: [k('valueAtCost', 'money'), k('valueAtRetail', 'money'), k('units', 'count'), k('lines', 'count')],
    chart: null,
    filters: ['categoryId', 'q'],
    defaultSort: '-valueAtCost',
  },
  stock_alerts: {
    key: 'stock_alerts',
    group: 'stock',
    simple: true,
    period: 'snapshot',
    columns: [product, variant, sku, category, c('stock', 'int'), c('minStock', 'int'), c('state', 'enum', { enumKey: 'report.stockState' }), c('reorderQty', 'int', { sum: true })],
    kpis: [k('outCount', 'count'), k('lowCount', 'count')],
    chart: null,
    filters: ['categoryId', 'q'],
    defaultSort: 'stock',
  },
  dead_stock: {
    key: 'dead_stock',
    group: 'stock',
    simple: false,
    period: 'snapshot',
    columns: [product, variant, sku, c('stock', 'int', { sum: true }), c('valueAtCost', 'money', { sum: true }), c('lastSoldAt', 'date'), c('daysSinceSale', 'days')],
    kpis: [k('items', 'count'), k('valueAtCost', 'money')],
    chart: null,
    filters: ['categoryId', 'days', 'q'],
    defaultSort: '-daysSinceSale',
    defaultDays: 60,
  },
  stock_aging: {
    key: 'stock_aging',
    group: 'stock',
    simple: false,
    period: 'range',
    columns: [product, variant, sku, c('stock', 'int', { sum: true }), c('soldQty', 'int', { sum: true }), c('avgDailySales', 'int'), c('coverDays', 'days'), c('lastReceivedAt', 'date'), c('ageDays', 'days')],
    kpis: [k('items', 'count'), k('avgCoverDays', 'days')],
    chart: null,
    filters: ['categoryId', 'q'],
    defaultSort: '-coverDays',
  },
  inventory_variances: {
    key: 'inventory_variances',
    group: 'stock',
    simple: false,
    period: 'range',
    columns: [c('date', 'datetime'), product, variant, c('type', 'enum', { enumKey: 'enum.StockMovement.type' }), c('reason', 'enum', { enumKey: 'enum.StockMovement.reason' }), c('quantity', 'int', { sum: true }), c('before', 'int'), c('after', 'int'), c('valueAtCost', 'money', { sum: true }), c('reference', 'text'), c('actor', 'text')],
    kpis: [k('movements', 'count'), k('unitsIn', 'count'), k('unitsOut', 'count'), k('valueAtCost', 'money')],
    chart: null,
    filters: ['categoryId', 'productId', 'q'],
    defaultSort: '-date',
  },
  purchases_by_supplier: {
    key: 'purchases_by_supplier',
    group: 'purchases_cash',
    simple: false,
    period: 'range',
    columns: [c('supplier', 'text', { link: 'supplier' }), c('purchases', 'int', { sum: true }), c('total', 'money', { sum: true }), c('paid', 'money', { sum: true }), c('remaining', 'money', { sum: true }), c('lastPurchaseAt', 'date')],
    kpis: [k('total', 'money'), k('paid', 'money'), k('remaining', 'money'), k('suppliers', 'count')],
    chart: { type: 'bar', x: 'supplier', y: ['total'] },
    filters: ['supplierId', 'q'],
    defaultSort: '-total',
  },
  purchases_by_period: {
    key: 'purchases_by_period',
    group: 'purchases_cash',
    simple: false,
    period: 'range',
    columns: [c('date', 'date'), c('number', 'text', { link: 'purchase' }), c('supplier', 'text', { link: 'supplier' }), c('status', 'enum', { enumKey: 'enum.Purchase.status' }), c('total', 'money', { sum: true }), c('paid', 'money', { sum: true }), c('remaining', 'money', { sum: true })],
    kpis: [k('total', 'money'), k('paid', 'money'), k('remaining', 'money'), k('purchases', 'count')],
    chart: { type: 'bar', x: 'date', y: ['total'] },
    filters: ['supplierId', 'q'],
    defaultSort: '-date',
  },
  product_purchases: {
    key: 'product_purchases',
    group: 'purchases_cash',
    simple: false,
    period: 'range',
    columns: [product, variant, sku, c('qtyOrdered', 'int', { sum: true }), c('qtyReceived', 'int', { sum: true }), c('total', 'money', { sum: true }), c('avgUnitCost', 'money'), c('purchases', 'int')],
    kpis: [k('total', 'money'), k('units', 'count'), k('products', 'count')],
    chart: null,
    filters: ['supplierId', 'categoryId', 'productId', 'q'],
    defaultSort: '-total',
  },
  top_suppliers: {
    key: 'top_suppliers',
    group: 'purchases_cash',
    simple: false,
    period: 'range',
    columns: [c('rank', 'int'), c('supplier', 'text', { link: 'supplier' }), c('purchases', 'int', { sum: true }), c('total', 'money', { sum: true }), c('sharePct', 'pct'), c('avgLeadDays', 'days')],
    kpis: [k('total', 'money'), k('suppliers', 'count')],
    chart: { type: 'bar', x: 'supplier', y: ['total'] },
    filters: [],
    defaultSort: '-total',
  },
  cash_register: {
    key: 'cash_register',
    group: 'purchases_cash',
    simple: false,
    period: 'range',
    columns: [c('date', 'datetime'), c('description', 'text', { sortable: false }), c('reference', 'text', { sortable: false }), c('category', 'enum', { enumKey: 'enum.Cash.category' }), c('method', 'enum', { enumKey: 'enum.Order.paymentMethod' }), c('income', 'money', { sum: true }), c('expense', 'money', { sum: true }), c('balance', 'money', { sortable: false }), c('proof', 'file', { sortable: false })],
    kpis: [k('openingBalance', 'money'), k('income', 'money'), k('expense', 'money'), k('closingBalance', 'money')],
    chart: null,
    filters: ['q'],
    defaultSort: 'date',
  },
  cash_flow: {
    key: 'cash_flow',
    group: 'purchases_cash',
    simple: false,
    period: 'range',
    columns: [c('day', 'date'), c('income', 'money', { sum: true }), c('expense', 'money', { sum: true }), c('net', 'money', { sum: true }), c('balance', 'money', { sortable: false })],
    kpis: [k('openingBalance', 'money'), k('income', 'money'), k('expense', 'money'), k('net', 'money'), k('closingBalance', 'money')],
    chart: { type: 'bar', x: 'day', y: ['income', 'expense'] },
    filters: [],
    defaultSort: 'day',
  },
  expenses: {
    key: 'expenses',
    group: 'purchases_cash',
    simple: false,
    period: 'range',
    columns: [c('date', 'date'), c('kind', 'enum', { enumKey: 'report.expenseKind' }), c('category', 'text'), c('description', 'text', { sortable: false }), product, c('amount', 'money', { sum: true })],
    kpis: [k('total', 'money'), k('manual', 'money'), k('product', 'money'), k('returns', 'money')],
    chart: { type: 'donut', x: 'kind', y: ['amount'] },
    filters: ['productId', 'q'],
    defaultSort: '-date',
  },
  top_customers: {
    key: 'top_customers',
    group: 'clients',
    simple: true,
    period: 'range',
    columns: [c('rank', 'int'), c('client', 'text', { link: 'client' }), c('phone', 'text', { sortable: false }), c('orders', 'int', { sum: true }), c('sales', 'int', { sum: true }), c('ordersRevenue', 'money', { sum: true }), c('salesRevenue', 'money', { sum: true }), c('revenue', 'money', { sum: true }), c('lastOrderAt', 'date')],
    kpis: [k('clients', 'count'), k('revenue', 'money', { figure: 'revenue' })],
    chart: { type: 'bar', x: 'client', y: ['revenue'] },
    filters: ['q'],
    defaultSort: '-revenue',
  },
  inactive_customers: {
    key: 'inactive_customers',
    group: 'clients',
    simple: true,
    period: 'snapshot',
    columns: [c('client', 'text', { link: 'client' }), c('phone', 'text', { sortable: false }), c('orders', 'int', { sum: true }), c('totalSpent', 'money', { sum: true }), c('lastOrderAt', 'date'), c('daysInactive', 'days')],
    kpis: [k('clients', 'count'), k('totalSpent', 'money')],
    chart: null,
    filters: ['days', 'q'],
    defaultSort: '-daysInactive',
    defaultDays: 90,
  },
};

/** P&L lines of `profit_loss`, in display order (04 §4: purchases are listed for information, never subtracted). */
export const PNL_LINES = ['salesRevenue', 'ordersRevenue', 'revenue', 'cogs', 'grossMargin', 'manualExpenses', 'productExpenses', 'returnCosts', 'expenses', 'net', 'purchasesPaid'] as const;

/** Reports listed in simple stock mode (D62). */
export const SIMPLE_MODE_REPORTS = REPORT_KEYS.filter((key) => REPORT_DEFINITIONS[key].simple);

// --- requests -----------------------------------------------------------------------------------------------------------
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'validation.date');
const id = z.string().uuid('validation.id');

/**
 * `GET /reports/:key` — same period rules as analytics (`REPORT_CUSTOM_RANGE_REQUIRED`, `INVALID_DATE_RANGE`,
 * `REPORT_RANGE_TOO_LONG`); snapshot reports ignore the period. `format`:
 * - `json` (default) → `ReportDataView` with one page of rows (`meta.page/pageSize/total`);
 * - `csv` → ≤ 5 000 rows: `200 ReportFileView` (signed link, 24 h); more: `202 { jobId }`;
 * - `xlsx` → always `202 { jobId }` (job kind `export`, file kept 7 days);
 * - `pdf` → `200 ReportFileView`: the current page + the totals, with the shop logo (D62 "PDF = page courante + totaux").
 */
export const ReportQuerySchema = z
  .object({
    period: z.enum(ANALYTICS_PERIODS).optional(),
    from: day.optional(),
    to: day.optional(),
    compare: z.enum(['previous', 'none']).optional(),
    format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .refine((n) => n === 25 || n === 50 || n === 100, 'validation.range')
      .default(25),
    sort: z
      .string()
      .regex(/^-?[a-zA-Z]+$/, 'validation.sort')
      .optional(),
    q: z.string().trim().max(120, 'validation.length').optional(),
    categoryId: id.optional(),
    productId: id.optional(),
    supplierId: id.optional(),
    clientId: id.optional(),
    days: z.coerce.number().int().min(1, 'validation.range').max(730, 'validation.range').optional(),
    source: z.enum(REPORT_SOURCES, { errorMap: () => ({ message: 'validation.invalid' }) }).optional(),
    channelId: id.optional(),
    groupBy: z.enum(REPORT_GROUP_BY, { errorMap: () => ({ message: 'validation.invalid' }) }).optional(),
    lang: z.enum(['fr', 'ar', 'en']).optional(),
  })
  .strict();
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

/** `POST /reports/:key/schedule` — one row per workspace × report × e-mail (a second POST updates the day). */
export const ReportScheduleSchema = z.object({ email, dayOfMonth: z.number({ invalid_type_error: 'validation.range', required_error: 'validation.required' }).int('validation.range').min(1, 'validation.range').max(28, 'validation.range') }).strict();
export type ReportScheduleInput = z.infer<typeof ReportScheduleSchema>;
/** `DELETE /reports/:key/schedule` — body `{ email }` (or `?email=`). */
export const ReportUnscheduleSchema = z.object({ email }).strict();

// --- views --------------------------------------------------------------------------------------------------------------
export type ReportHubItem = {
  key: ReportKey;
  group: ReportGroup;
  simple: boolean;
  /** listed for the workspace's stock mode (simple ⇒ the 9 simple reports) */
  visible: boolean;
  favorite: boolean;
  period: 'range' | 'snapshot';
  scheduled: boolean;
};
/** `GET /reports` */
export type ReportsHubView = {
  groups: { key: ReportGroup; reports: ReportHubItem[] }[];
  favorites: ReportKey[];
  stockMode: 'simple' | 'advanced';
  /** 23 in advanced mode, 9 in simple mode */
  visibleCount: number;
  /** the plan has `scheduled_reports` and the user holds `reports.schedule` ("Planifier" shown) */
  canSchedule: boolean;
  csvImmediateMaxRows: number;
};

export type ReportCell = string | number | null;
export type ReportRowRef = { type: ReportLink; id: string };
/** Cells keyed by column key; `_ref` = the row's link target. */
export type ReportRow = { [column: string]: ReportCell | ReportRowRef | undefined; _ref?: ReportRowRef | null };
export type ReportKpiValue = { key: string; value: number | null; unit: AnalyticsUnit; figure?: MoneyFigureName; previous?: number | null; deltaPct?: number | null };
/** `GET /reports/:key?format=json` */
export type ReportDataView = {
  key: ReportKey;
  definition: ReportDefinition;
  /** null for snapshot reports */
  range: { period: string; from: string; to: string; days: number; previous: { from: string; to: string } | null } | null;
  /** applied filters (chips) */
  filters: Partial<Record<ReportFilterKey, string | number>>;
  kpis: ReportKpiValue[];
  chart: { type: 'bar' | 'line' | 'donut'; points: { x: string; label: string; values: Record<string, number> }[] } | null;
  /** one page of rows (`meta.page/pageSize/total`) */
  rows: ReportRow[];
  /** sums of the `sum` columns over every row of the report (not only the page) */
  totals: Record<string, number | null>;
  totalRows: number;
  /** CSV of this selection: `immediate` (≤ 5 000 rows) or `job` */
  csvMode: 'immediate' | 'job';
  /** monthly e-mails of this report (visible to `reports.schedule` holders) */
  schedules: ReportScheduleView[];
  generatedAt: string;
};
/** Immediate file of `format=csv|pdf` (signed link, 24 h). */
export type ReportFileView = { url: string; fileName: string; size: number; expiresAt: string; rows: number; format: 'csv' | 'pdf' };
export type ReportScheduleView = { id: string; reportKey: ReportKey; email: string; dayOfMonth: number; createdAt: string; createdBy: { id: string; name: string } | null; nextRunOn: string };
/** `Job.result` of a report export (also set while the job runs, so "Exports récents" can label the row). */
export type ReportJobResult = { kind: 'report'; reportKey: ReportKey; from: string | null; to: string | null; format: 'csv' | 'xlsx' | 'pdf'; rows?: number; fileName?: string; size?: number };
