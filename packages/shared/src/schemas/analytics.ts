// Analytics (03 §16 ANA-02 / ANA-03, §37 ANA; 04 §4 named figures, §8 dates; 06 "Notifications, home, analytics";
// 12 §24; Figma ANA-02 / ANA-02b). `GET /analytics/overview` + the 8 tab endpoints, permission `analytics.read` (every
// member). Money = integer DZD; percentages = one decimal (68.4 = 68.4 %); days = `YYYY-MM-DD` in Africa/Algiers.
import { z } from 'zod';

export const ANALYTICS_TABS = ['overview', 'conversations', 'responses', 'consumption', 'agents', 'channels', 'products', 'orders', 'delivery'] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];
/** 04 §8 presets (Figma "Trimestre" = `90d`); `custom` needs `from` and `to`. */
export const ANALYTICS_PERIODS = ['today', '7d', '30d', 'month', 'last_month', '90d', 'year', 'custom'] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
/** 04 §8 / 11 §7: a custom range is at most 732 days (`REPORT_RANGE_TOO_LONG`). */
export const ANALYTICS_MAX_RANGE_DAYS = 732;
export const ANALYTICS_DEFAULT_PERIOD: AnalyticsPeriod = '30d';
/** "Stock dormant" threshold of the Produits tab and of the `dead_stock` report (Figma "sans vente > 60 j"). */
export const DEAD_STOCK_DAYS = 60;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'validation.date');

/**
 * Query of the overview and of every tab. Rules (errors of 11 §7, checked by the API in this order):
 * - neither `period` nor dates ⇒ `30d`; `from` + `to` without `period` ⇒ `custom`;
 * - `period=custom` (or a single date) without both dates ⇒ 422 `REPORT_CUSTOM_RANGE_REQUIRED`;
 * - `to` before `from` ⇒ 422 `INVALID_DATE_RANGE`; more than 732 days ⇒ 422 `REPORT_RANGE_TOO_LONG`.
 * `compare=previous` (default) adds `previous` / `deltaPct` / `deltaPts` to every KPI and the dashed previous series
 * (previous period = same length ending the day before `from`); `compare=none` leaves them out (12 §24 "aucune").
 * `channelId` restricts every figure to one connected page (counter sales are then excluded from Revenue).
 */
export const AnalyticsQuerySchema = z
  .object({
    period: z.enum(ANALYTICS_PERIODS).optional(),
    from: day.optional(),
    to: day.optional(),
    compare: z.enum(['previous', 'none']).optional(),
    channelId: z.string().uuid('validation.id').optional(),
  })
  .strict();
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

// --- common view parts ------------------------------------------------------------------------------------------------
export type AnalyticsUnit = 'count' | 'money' | 'pct' | 'seconds' | 'minutes' | 'days' | 'ratio' | 'credits' | 'usd';
/** 04 §4 / ANA-03: the label of a money KPI names the figure it shows ("Revenus", "Revenus nets", …). */
export const MONEY_FIGURES = ['revenue', 'net_revenue', 'pipeline', 'cash_collected', 'ai_revenue'] as const;
export type MoneyFigureName = (typeof MONEY_FIGURES)[number];

export type AnalyticsKpi = {
  /** `null` = nothing to compute on the period (tile shows "—") */
  value: number | null;
  unit: AnalyticsUnit;
  /** with `compare=previous` only */
  previous?: number | null;
  /** relative change in % (one decimal) — counts and money */
  deltaPct?: number | null;
  /** change in points — percentage KPIs ("+5 pts") */
  deltaPts?: number | null;
  /** money KPIs: which 04 §4 figure it is */
  figure?: MoneyFigureName;
  /** small figures of the tile sub-line (keys documented on each view) */
  hint?: Record<string, number | string | null>;
};

export type AnalyticsRange = {
  period: AnalyticsPeriod;
  from: string;
  to: string;
  days: number;
  compare: 'previous' | 'none';
  previous: { from: string; to: string } | null;
  timezone: 'Africa/Algiers';
  channelId: string | null;
  /** today is inside the range (its figures are live and still moving) */
  includesToday: boolean;
  /** how the figures were obtained: nightly `DailyStat` rows vs live queries (today, missing days, page filter) */
  source: { rollupDays: number; liveDays: number };
};

/** One point per day of the range; `previous` = the same offset in the previous period (dashed line). */
export type AnalyticsSeries<K extends string = string> = {
  keys: K[];
  points: { day: string; values: Record<K, number>; previousDay: string | null; previous: Record<K, number> | null }[];
};

type Base = {
  range: AnalyticsRange;
  generatedAt: string;
  /** no activity at all on the period (PÉRIODE VIDE) */
  empty: boolean;
  /** the workspace has at least one connected page (CTA "Connecter une page" of the empty state otherwise) */
  hasChannels: boolean;
};
type Delta = { previous: number | null; deltaPct: number | null };
export type AnalyticsChannelRef = { channelId: string; name: string; platform: 'facebook' | 'instagram' };

// --- overview (ANA-02) --------------------------------------------------------------------------------------------------
export type AnalyticsOverviewView = Base & {
  kpis: {
    /** hint: salesCount, deliveredOrders, salesRevenue, ordersRevenue */
    revenue: AnalyticsKpi;
    /** hint: confirmedPct, aiOrders */
    orders: AnalyticsKpi;
    /** delivered ÷ shipped of the period (pct); hint: shipped, delivered, returned */
    deliveryRate: AnalyticsKpi;
    /** hint: aiHandledPct, handoffs */
    conversations: AnalyticsKpi;
    /** hint: monthPct, remaining (null = unlimited), text, image, voice */
    creditsUsed: AnalyticsKpi;
    netRevenue: AnalyticsKpi;
    /** snapshot (now), no comparison */
    pipeline: AnalyticsKpi;
    cashCollected: AnalyticsKpi;
    aiRevenue: AnalyticsKpi;
  };
  /** "Revenus par jour" bars + "COMMANDES" line */
  series: AnalyticsSeries<'revenue' | 'orders'>;
  bestDay: { day: string; revenue: number } | null;
  /** "Entonnoir conversation → livraison" */
  funnel: { conversations: number; purchaseIntent: number; ordersCreated: number; confirmed: number; delivered: number };
  /** Revenue per product (delivered order lines + counter sale lines), top 5 */
  topProducts: AnalyticsProductRow[];
  /** "Top wilayas (commandes livrées)", top 5 by orders */
  topWilayas: AnalyticsWilayaRow[];
  /** "Par canal · agent": one row per page + `channelId: null` = orders without a page ("Manuel (opérateurs)") */
  byChannel: { channelId: string | null; name: string | null; platform: 'facebook' | 'instagram' | null; agent: { id: string; name: string } | null; orders: number; conversations: number; previous: number | null; deltaPct: number | null }[];
};

export type AnalyticsProductRow = Delta & {
  productId: string;
  name: string;
  /** units asked about by the AI (`get_product` tool calls) */
  requested: number;
  /** units sold (delivered orders + counter sales) */
  sold: number;
  revenue: number;
  /** no revenue in the previous period ("nouveau") */
  isNew: boolean;
};
export type AnalyticsWilayaRow = {
  wilayaId: number;
  code: string;
  name: string;
  nameAr: string;
  /** orders placed */
  orders: number;
  /** orders delivered in the period */
  delivered: number;
  returned: number;
  /** delivered ÷ orders (pct) */
  deliveredPct: number | null;
  /** Revenue of the delivered orders of the wilaya */
  revenue: number;
  previousDeliveredPct: number | null;
  deltaPts: number | null;
};

// --- conversations ------------------------------------------------------------------------------------------------------
export type AnalyticsConversationsView = Base & {
  kpis: {
    conversations: AnalyticsKpi;
    /** conversations without a handoff ÷ conversations (pct); hint: handoffs */
    aiHandledPct: AnalyticsKpi;
    /** median from a histogram (approximate above 10); hint: average */
    messagesPerConversation: AnalyticsKpi;
    /** median of the AI reply time (seconds); hint: p95 */
    aiResponseTime: AnalyticsKpi;
    /** median of the human reply time (minutes); hint: p95 */
    humanResponseTime: AnalyticsKpi;
  };
  /** "langues : darija 61 % · FR 30 % · arabizi 9 %" (from the AI run language) */
  languages: { language: string; count: number; pct: number }[];
  /** inbound messages per hour of day (0–23, Africa/Algiers) and the busiest 3-hour window ("heures de pointe 19h–22h") */
  hours: number[];
  peakHours: { from: number; to: number } | null;
  series: AnalyticsSeries<'new' | 'transferred'>;
  byChannel: (AnalyticsChannelRef & Delta & { conversations: number; aiPct: number | null; handoffs: number })[];
};

// --- responses (AI replies) ----------------------------------------------------------------------------------------------
export type AnalyticsResponsesView = Base & {
  kpis: {
    /** AI messages sent; hint: text, image, voice */
    aiReplies: AnalyticsKpi;
    /** hint: monthPct */
    creditsUsed: AnalyticsKpi;
    creditsPerReply: AnalyticsKpi;
    /** AI runs in error ÷ runs (pct); hint: fallbacks (runs answered by the fallback provider) */
    errorRate: AnalyticsKpi;
    /** 👍 + 👎 on AI messages; hint: likes, dislikes, score (likes ÷ total × 5, one decimal) */
    reactions: AnalyticsKpi;
  };
  series: AnalyticsSeries<'replies' | 'errors' | 'handoffs'>;
  byIntent: { intent: string; runs: number; pct: number }[];
  byStatus: { status: string; runs: number }[];
};

// --- consumption (credits & AI cost) ------------------------------------------------------------------------------------
export type AnalyticsConsumptionView = Base & {
  kpis: {
    creditsUsed: AnalyticsKpi;
    /** Σ AiRun tokens × AiModel prices, USD (ANA-02 fix of the V1 hard-coded price) */
    costUsd: AnalyticsKpi;
    costPerReplyUsd: AnalyticsKpi;
    /** hint: input, output */
    tokens: AnalyticsKpi;
  };
  /** "projection : épuisement le 09 oct. au rythme actuel → lien packs" */
  projection: { balance: number | null; unlimited: boolean; dailyBurn: number; exhaustsOn: string | null; packsPath: string };
  /** "Crédits par jour et par type" */
  series: AnalyticsSeries<'text' | 'image' | 'voice'>;
  /** TYPE · VOLUME · CRÉDITS · COÛT / UNITÉ · Δ ("Commandes (0 crédit)" = type `orders`) */
  byType: (Delta & { type: 'text' | 'image' | 'voice' | 'orders'; volume: number; credits: number; unitCost: number })[];
  byModel: { modelId: string; name: string; provider: string; runs: number; inputTokens: number; outputTokens: number; costUsd: number }[];
};

// --- agents -------------------------------------------------------------------------------------------------------------
export type AnalyticsAgentsView = Base & {
  kpis: {
    /** snapshot; hint: paused */
    activeAgents: AnalyticsKpi;
    /** average autonomy of the agents (pct); hint: one entry per agent name */
    autonomy: AnalyticsKpi;
    /** orders created by the AI; hint: confirmedPct */
    ordersCreated: AnalyticsKpi;
    /** snapshot; hint: resolved (in the period) */
    insightsPending: AnalyticsKpi;
  };
  /** autonomy per day, one key per agent id */
  series: AnalyticsSeries<string>;
  agents: (Delta & { agentId: string; name: string; status: string; conversations: number; autonomyPct: number | null; orders: number; aiRevenue: number; credits: number })[];
};

// --- channels -----------------------------------------------------------------------------------------------------------
export type AnalyticsChannelsView = Base & {
  kpis: {
    /** snapshot; hint: pendingMeta */
    activePages: AnalyticsKpi;
    /** Σ followers of the Facebook pages (snapshot, no comparison) */
    followers: AnalyticsKpi;
    /** hint: aiPct */
    conversationsFacebook: AnalyticsKpi;
    conversationsInstagram: AnalyticsKpi;
    /** hint: skippedWindow (AI replies not sent: outside the 24 h window) */
    inboundMessages: AnalyticsKpi;
  };
  /** inbound messages per day, one key per channel id */
  series: AnalyticsSeries<string>;
  channels: (AnalyticsChannelRef & Delta & { inbound: number; outbound: number; conversations: number; orders: number; aiOrders: number; aiRevenue: number })[];
};

// --- products -----------------------------------------------------------------------------------------------------------
export type AnalyticsProductsView = Base & {
  kpis: {
    /** snapshot; hint: lowStock */
    activeProducts: AnalyticsKpi;
    /** hint: distinct */
    unitsSold: AnalyticsKpi;
    /** revenue of the best product; hint: productId, name */
    topProduct: AnalyticsKpi;
    /**
     * (gross sales − COGS) ÷ gross sales of the sold lines with a known cost price (pct) — the « Marge moyenne » of the report
     * Ventes par produit (journeys 16/11 J11-2 / J11-3); value null in simple stock mode or without such a line;
     * hint: advanced (1 / 0), unknownCost (line amounts sold without a cost price, left out)
     */
    avgMarginPct: AnalyticsKpi;
    /** tracked products with stock and no sale for 60 days (snapshot); hint: valueAtCost (lines with a known cost price), days */
    deadStock: AnalyticsKpi;
  };
  /** revenue per day per category: the 3 best category ids + `other` */
  series: AnalyticsSeries<string>;
  categories: { key: string; categoryId: string | null; name: string | null }[];
  products: AnalyticsProductRow[];
  /** "demandé mais absent" — topics the AI could not answer (insights `unknown_topic`) */
  requestedAbsent: { topic: string; count: number }[];
};

// --- orders -------------------------------------------------------------------------------------------------------------
export type AnalyticsOrdersView = Base & {
  kpis: {
    /** hint: ai, human */
    orders: AnalyticsKpi;
    /** confirmed ÷ orders (pct); hint: callsPerOrder */
    confirmationRate: AnalyticsKpi;
    /** hint: deliveryRate (pct of shipped), codPct (delivered paid cash on delivery) */
    delivered: AnalyticsKpi;
    /** cancelled ÷ orders (pct); hint: wrongNumberPct */
    cancelledPct: AnalyticsKpi;
    /** returned ÷ (delivered + returned) (pct); hint: returned */
    returnedPct: AnalyticsKpi;
    /** conversations with a purchase intent and no order ("paniers abandonnés"); hint: pct */
    abandoned: AnalyticsKpi;
    revenue: AnalyticsKpi;
    netRevenue: AnalyticsKpi;
    pipeline: AnalyticsKpi;
    cashCollected: AnalyticsKpi;
    aiRevenue: AnalyticsKpi;
  };
  series: AnalyticsSeries<'ai' | 'manual' | 'mobile' | 'api' | 'import'>;
  funnel: { created: number; confirmed: number; shipped: number; delivered: number };
  bySource: { source: string; orders: number; delivered: number; revenue: number }[];
  /** every wilaya with activity (choropleth data + table), sorted by orders */
  wilayas: AnalyticsWilayaRow[];
  cancelReasons: { reason: string; count: number; pct: number }[];
  paymentMix: { method: string; count: number; pct: number }[];
  byStatus: { status: string; count: number }[];
};

// --- delivery (DLV-11) --------------------------------------------------------------------------------------------------
export type AnalyticsCourierRow = {
  /** `<provider>:<courierAccountId|none>` */
  key: string;
  provider: string;
  courierAccountId: string | null;
  name: string;
  parcels: number;
  delivered: number;
  deliveredPct: number | null;
  returned: number;
  returnedPct: number | null;
  failed: number;
  avgDays: number | null;
  codCollected: number;
  courierFees: number;
};
export type AnalyticsDeliveryView = Base & {
  kpis: {
    /** parcels created; hint: one entry per courier name */
    shipped: AnalyticsKpi;
    /** average days created → delivered; hint: p95 */
    avgDays: AnalyticsKpi;
    /** delivered at the first attempt ÷ delivered (pct); hint: secondAttemptPct */
    firstAttemptPct: AnalyticsKpi;
    /** snapshot of failed parcels; hint: over48h */
    openFailures: AnalyticsKpi;
    /** Σ courier cost of the parcels; hint: customerFees (Σ delivery fees charged) */
    courierFees: AnalyticsKpi;
  };
  /** average delivery days per day, one key per courier key */
  series: AnalyticsSeries<string>;
  couriers: AnalyticsCourierRow[];
};

export type AnalyticsViewOf = {
  overview: AnalyticsOverviewView;
  conversations: AnalyticsConversationsView;
  responses: AnalyticsResponsesView;
  consumption: AnalyticsConsumptionView;
  agents: AnalyticsAgentsView;
  channels: AnalyticsChannelsView;
  products: AnalyticsProductsView;
  orders: AnalyticsOrdersView;
  delivery: AnalyticsDeliveryView;
};
