// ANA-02 daily figures (`DailyStat.metrics`): ONE computation used by the nightly rollup (`sched-daily-stats`) and by the
// live part of `AnalyticsService` (today, days without a rollup, page filter), so a figure never has two formulas.
// Every number is an event counted on its Africa/Algiers day (orders on `orderedAt`, revenue on `deliveredAt` / `soldAt`
// per 04 §4, confirmations on `confirmedAt`, …). Rows are recomputed and overwritten, never incremented.
import { Prisma, prisma } from '@djaber/db';

/** Bump when the shape or a formula changes: older rollup rows are then ignored (recomputed live, rewritten at night). */
// 2: `revenue.salesPaid` (UX-052, 10/11) — cached days of version 1 are computed again
export const METRICS_VERSION = 2;

type Num = Record<string, number>;
export type ChannelDay = { conv: number; handoffs: number; in: number; out: number; orders: number; aiOrders: number; aiRevenue: number; aiReplies: number };
export type AgentDay = { conv: number; handoffs: number; orders: number; confirmed: number; revenue: number; credits: number; runs: number };
export type WilayaDay = { orders: number; delivered: number; returned: number; revenue: number };
export type ProductDay = { sold: number; revenue: number; cogs: number; requested: number };
export type CourierDay = { parcels: number; delivered: number; returned: number; failed: number; daysSum: number; daysCount: number; cod: number; fees: number };
export type ModelDay = { runs: number; inputTokens: number; outputTokens: number; costMicro: number };

export type DayMetrics = {
  v: number;
  orders: {
    created: number; ai: number; confirmed: number; confirmedAi: number; shipped: number; delivered: number; deliveredCod: number; cancelled: number; returned: number;
    calls: number; orderedValue: number; cashCollected: number;
  };
  srcCreated: Num; srcDelivered: Num; srcRevenue: Num;
  /** current status of the orders placed that day (cohort) */
  status: Num;
  cancelReasons: Num;
  payment: Num;
  revenue: { sales: number; salesCount: number; salesPaid: number; orders: number; ordersAi: number; deliveryFees: number; salesDiscount: number; ordersDiscount: number; salesTax: number; ordersTax: number };
  conv: { created: number; handoffs: number; purchaseIntent: number; abandoned: number };
  msgPerConv: number[];
  msg: { in: number; out: number; ai: number; human: number };
  hours: number[];
  ai: { runs: number; replies: number; ok: number; unclear: number; unknown: number; handoff: number; error: number; fallback: number; vision: number; transcription: number; inputTokens: number; outputTokens: number; costMicro: number; skippedWindow: number };
  aiLatency: number[];
  humanLatency: number[];
  intents: Num;
  lang: Num;
  reactions: { like: number; dislike: number };
  credits: { total: number; text: number; image: number; voice: number; textN: number; imageN: number; voiceN: number };
  models: Record<string, ModelDay>;
  channels: Record<string, ChannelDay>;
  agents: Record<string, AgentDay>;
  wilayas: Record<string, WilayaDay>;
  products: Record<string, ProductDay>;
  ship: { created: number; customerFees: number; courierFees: number; delivered: number; returned: number; failed: number; firstAttempt: number; secondAttempt: number; daysSum: number; daysCount: number; cod: number };
  shipDays: number[];
  couriers: Record<string, CourierDay>;
};

// --- histograms (mergeable approximations of medians / p95) -------------------------------------------------------------
/** upper edges; the last bucket (index = edges.length) is "above", represented by `over` */
export const HIST = {
  aiLatency: { edges: [1, 2, 3, 5, 8, 13, 20, 30, 60], over: 120 }, // seconds
  humanLatency: { edges: [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440], over: 2880 }, // minutes
  msgPerConv: { edges: [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50], over: 100 }, // messages
  shipDays: { edges: [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30], over: 45 }, // days
} as const;
export type HistName = keyof typeof HIST;
export const bucketOf = (h: HistName, v: number) => {
  const edges = HIST[h].edges as readonly number[];
  const i = edges.findIndex((e) => v <= e);
  return i === -1 ? edges.length : i;
};
export const percentile = (h: HistName, counts: number[], p: number): number | null => {
  const total = counts.reduce((s, n) => s + n, 0);
  if (!total) return null;
  const target = Math.max(1, Math.ceil(total * p));
  let cum = 0;
  for (let i = 0; i < counts.length; i++) {
    cum += counts[i] ?? 0;
    if (cum >= target) return i < HIST[h].edges.length ? (HIST[h].edges[i] as number) : HIST[h].over;
  }
  return HIST[h].over;
};
const zeros = (n: number) => Array.from({ length: n }, () => 0);

export const emptyDay = (): DayMetrics => ({
  v: METRICS_VERSION,
  orders: { created: 0, ai: 0, confirmed: 0, confirmedAi: 0, shipped: 0, delivered: 0, deliveredCod: 0, cancelled: 0, returned: 0, calls: 0, orderedValue: 0, cashCollected: 0 },
  srcCreated: {}, srcDelivered: {}, srcRevenue: {}, status: {}, cancelReasons: {}, payment: {},
  revenue: { sales: 0, salesCount: 0, salesPaid: 0, orders: 0, ordersAi: 0, deliveryFees: 0, salesDiscount: 0, ordersDiscount: 0, salesTax: 0, ordersTax: 0 },
  conv: { created: 0, handoffs: 0, purchaseIntent: 0, abandoned: 0 },
  msgPerConv: zeros(HIST.msgPerConv.edges.length + 1),
  msg: { in: 0, out: 0, ai: 0, human: 0 },
  hours: zeros(24),
  ai: { runs: 0, replies: 0, ok: 0, unclear: 0, unknown: 0, handoff: 0, error: 0, fallback: 0, vision: 0, transcription: 0, inputTokens: 0, outputTokens: 0, costMicro: 0, skippedWindow: 0 },
  aiLatency: zeros(HIST.aiLatency.edges.length + 1),
  humanLatency: zeros(HIST.humanLatency.edges.length + 1),
  intents: {}, lang: {},
  reactions: { like: 0, dislike: 0 },
  credits: { total: 0, text: 0, image: 0, voice: 0, textN: 0, imageN: 0, voiceN: 0 },
  models: {}, channels: {}, agents: {}, wilayas: {}, products: {},
  ship: { created: 0, customerFees: 0, courierFees: 0, delivered: 0, returned: 0, failed: 0, firstAttempt: 0, secondAttempt: 0, daysSum: 0, daysCount: 0, cod: 0 },
  shipDays: zeros(HIST.shipDays.edges.length + 1),
  couriers: {},
});

/** Deep sum of `src` into `dst` (numbers add, arrays add element-wise, objects recurse; missing keys are created). */
export const mergeInto = <T>(dst: T, src: unknown): T => {
  if (!src || typeof src !== 'object') return dst;
  const d = dst as Record<string, unknown>;
  for (const [key, val] of Object.entries(src as Record<string, unknown>)) {
    if (key === 'v') continue;
    if (typeof val === 'number') d[key] = ((d[key] as number) ?? 0) + val;
    else if (Array.isArray(val)) {
      const arr = (Array.isArray(d[key]) ? d[key] : (d[key] = [])) as number[];
      val.forEach((n, i) => (arr[i] = (arr[i] ?? 0) + (Number(n) || 0)));
    } else if (val && typeof val === 'object') {
      if (!d[key] || typeof d[key] !== 'object') d[key] = {};
      mergeInto(d[key], val);
    }
  }
  return dst;
};
export const sumDays = (days: Iterable<DayMetrics>): DayMetrics => {
  const out = emptyDay();
  for (const m of days) mergeInto(out, m);
  return out;
};

// --- SQL ------------------------------------------------------------------------------------------------------------------
const n = (v: unknown) => Number(v ?? 0) || 0;
/** Africa/Algiers day of a UTC timestamp column (UTC+1, no DST). */
const D = (col: string) => Prisma.raw(`to_char(${col} + interval '1 hour', 'YYYY-MM-DD')`);
const inc = (o: Num, k: string | null | undefined, by: number) => {
  const key = k ?? 'none';
  o[key] = (o[key] ?? 0) + by;
};
const entry = <T>(o: Record<string, T>, k: string, make: () => T): T => (o[k] ??= make());
const ch0 = (): ChannelDay => ({ conv: 0, handoffs: 0, in: 0, out: 0, orders: 0, aiOrders: 0, aiRevenue: 0, aiReplies: 0 });
const ag0 = (): AgentDay => ({ conv: 0, handoffs: 0, orders: 0, confirmed: 0, revenue: 0, credits: 0, runs: 0 });
const wi0 = (): WilayaDay => ({ orders: 0, delivered: 0, returned: 0, revenue: 0 });
const pr0 = (): ProductDay => ({ sold: 0, revenue: 0, cogs: 0, requested: 0 });
const co0 = (): CourierDay => ({ parcels: 0, delivered: 0, returned: 0, failed: 0, daysSum: 0, daysCount: 0, cod: 0, fees: 0 });
const mo0 = (): ModelDay => ({ runs: 0, inputTokens: 0, outputTokens: 0, costMicro: 0 });
export const courierKey = (provider: string, accountId: string | null) => `${provider}:${accountId ?? 'none'}`;
const thresholds = (h: HistName) => Prisma.raw(`ARRAY[${(HIST[h].edges as readonly number[]).join(',')}]::float8[]`);

export type ComputeScope = { workspaceId: string; gte: Date; lt: Date; channelId?: string | null };

/**
 * Figures of every Algiers day of `[gte, lt)` for one workspace (`channelId` restricts to one page: counter sales and
 * unlinked parcels drop out). Returns only days with activity; callers fill the gaps with `emptyDay()`.
 */
export async function computeDays(s: ComputeScope): Promise<Map<string, DayMetrics>> {
  const ws = Prisma.sql`${s.workspaceId}::uuid`;
  const { gte, lt } = s;
  const chO = s.channelId ? Prisma.sql`AND o."channelId" = ${s.channelId}::uuid` : Prisma.empty;
  const chC = s.channelId ? Prisma.sql`AND c."channelId" = ${s.channelId}::uuid` : Prisma.empty;
  const chL = s.channelId ? Prisma.sql`AND l."channelId" = ${s.channelId}::uuid` : Prisma.empty;
  const q = <T>(sql: Prisma.Sql) => prisma.$queryRaw<T[]>(sql);

  const [created, confirmed, cancelled, delivered, shipped, returned, sales, lines, requested, convs, msgCounts, handoffs, messages, reactions, runs, aiLat, humanLat, credits, shipCreated, shipDone] = await Promise.all([
    q<{ d: string; source: string; status: string; ch: string | null; ag: string | null; wi: number | null; pm: string; c: number; total: bigint; paid: bigint; calls: bigint }>(Prisma.sql`
      SELECT ${D('o."orderedAt"')} d, o."source" source, o."status" status, o."channelId" ch, o."agentId" ag, o."wilayaId" wi, o."paymentMethod" pm,
             count(*)::int c, coalesce(sum(o."total"),0)::bigint total, coalesce(sum(o."amountPaid"),0)::bigint paid, coalesce(sum(o."callAttempts"),0)::bigint calls
      FROM "Order" o WHERE o."workspaceId" = ${ws} AND o."orderedAt" >= ${gte} AND o."orderedAt" < ${lt} ${chO}
      GROUP BY 1,2,3,4,5,6,7`),
    q<{ d: string; source: string; ag: string | null; c: number }>(Prisma.sql`
      SELECT ${D('o."confirmedAt"')} d, o."source" source, o."agentId" ag, count(*)::int c FROM "Order" o
      WHERE o."workspaceId" = ${ws} AND o."confirmedAt" >= ${gte} AND o."confirmedAt" < ${lt} ${chO} GROUP BY 1,2,3`),
    q<{ d: string; reason: string | null; c: number }>(Prisma.sql`
      SELECT ${D('o."cancelledAt"')} d, o."cancelReason"::text reason, count(*)::int c FROM "Order" o
      WHERE o."workspaceId" = ${ws} AND o."status" = 'cancelled' AND o."cancelledAt" >= ${gte} AND o."cancelledAt" < ${lt} ${chO} GROUP BY 1,2`),
    // 04 §4 Revenue (orders part) = Σ total of delivered orders on deliveredAt — same predicate as the home KPI
    q<{ d: string; source: string; ch: string | null; ag: string | null; wi: number | null; cod: boolean; c: number; total: bigint; fees: bigint; disc: bigint; tax: bigint }>(Prisma.sql`
      SELECT ${D('o."deliveredAt"')} d, o."source" source, o."channelId" ch, o."agentId" ag, o."wilayaId" wi, (o."paymentMethod" = 'cash') cod, count(*)::int c,
             coalesce(sum(o."total"),0)::bigint total, coalesce(sum(o."deliveryFee"),0)::bigint fees, coalesce(sum(o."discount"),0)::bigint disc, coalesce(sum(o."tax"),0)::bigint tax
      FROM "Order" o WHERE o."workspaceId" = ${ws} AND o."status" = 'delivered' AND o."deliveredAt" >= ${gte} AND o."deliveredAt" < ${lt} ${chO}
      GROUP BY 1,2,3,4,5,6`),
    q<{ d: string; c: number }>(Prisma.sql`
      SELECT ${D('o."shippedAt"')} d, count(*)::int c FROM "Order" o
      WHERE o."workspaceId" = ${ws} AND o."shippedAt" >= ${gte} AND o."shippedAt" < ${lt} ${chO} GROUP BY 1`),
    q<{ d: string; wi: number | null; c: number }>(Prisma.sql`
      SELECT ${D('COALESCE(h."effectiveAt", h."at")')} d, o."wilayaId" wi, count(DISTINCT o."id")::int c
      FROM "OrderStatusHistory" h JOIN "Order" o ON o."id" = h."orderId"
      WHERE o."workspaceId" = ${ws} AND o."status" = 'returned' AND h."field" = 'status' AND h."to" = 'returned'
        AND COALESCE(h."effectiveAt", h."at") >= ${gte} AND COALESCE(h."effectiveAt", h."at") < ${lt} ${chO}
      GROUP BY 1,2`),
    // 04 §4 Revenue (sales part) = Σ total of completed counter sales on soldAt (no page: excluded under a page filter)
    s.channelId
      ? Promise.resolve([] as { d: string; c: number; total: bigint; disc: bigint; tax: bigint; paid: bigint }[])
      : q<{ d: string; c: number; total: bigint; disc: bigint; tax: bigint; paid: bigint }>(Prisma.sql`
      SELECT ${D('s."soldAt"')} d, count(*)::int c, coalesce(sum(s."total"),0)::bigint total, coalesce(sum(s."discount"),0)::bigint disc, coalesce(sum(s."tax"),0)::bigint tax, coalesce(sum(s."amountPaid"),0)::bigint paid
      FROM "Sale" s WHERE s."workspaceId" = ${ws} AND s."status" = 'completed' AND s."soldAt" >= ${gte} AND s."soldAt" < ${lt} GROUP BY 1`),
    q<{ d: string; pid: string; qty: bigint; rev: bigint; cogs: bigint }>(Prisma.sql`
      SELECT d, pid, sum(qty)::bigint qty, sum(rev)::bigint rev, sum(cogs)::bigint cogs FROM (
        SELECT ${D('o."deliveredAt"')} d, i."productId" pid, i."quantity" qty, i."total" rev, i."quantity" * coalesce(i."costPrice",0) cogs
        FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
        WHERE o."workspaceId" = ${ws} AND o."status" = 'delivered' AND o."deliveredAt" >= ${gte} AND o."deliveredAt" < ${lt} ${chO}
        ${s.channelId ? Prisma.empty : Prisma.sql`
        UNION ALL
        SELECT ${D('s."soldAt"')} d, i."productId" pid, i."quantity" qty, i."total" rev, i."quantity" * coalesce(i."costPrice",0) cogs
        FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId"
        WHERE s."workspaceId" = ${ws} AND s."status" = 'completed' AND s."soldAt" >= ${gte} AND s."soldAt" < ${lt}`}
      ) x GROUP BY 1,2`),
    q<{ d: string; pid: string | null; c: number }>(Prisma.sql`
      SELECT ${D('r."startedAt"')} d, t."args"->>'productId' pid, count(*)::int c
      FROM "AiToolCall" t JOIN "AiRun" r ON r."id" = t."aiRunId" LEFT JOIN "Conversation" c ON c."id" = r."conversationId"
      WHERE r."workspaceId" = ${ws} AND t."name" = 'get_product' AND r."kind" = 'reply' AND r."startedAt" >= ${gte} AND r."startedAt" < ${lt} ${chC}
      GROUP BY 1,2`),
    q<{ d: string; ch: string; ag: string | null; c: number; intent: number; abandoned: number }>(Prisma.sql`
      SELECT ${D('c."createdAt"')} d, c."channelId" ch, c."agentId" ag, count(*)::int c,
             count(*) FILTER (WHERE c."lastAiIntent" = 'sale')::int intent,
             count(*) FILTER (WHERE c."lastAiIntent" = 'sale' AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."conversationId" = c."id"))::int abandoned
      FROM "Conversation" c WHERE c."workspaceId" = ${ws} AND c."deletedAt" IS NULL AND c."createdAt" >= ${gte} AND c."createdAt" < ${lt} ${chC}
      GROUP BY 1,2,3`),
    q<{ d: string; m: number; c: number }>(Prisma.sql`
      SELECT x.d, x.m, count(*)::int c FROM (
        SELECT ${D('c."createdAt"')} d, (SELECT count(*) FROM "Message" mm WHERE mm."conversationId" = c."id")::int m
        FROM "Conversation" c WHERE c."workspaceId" = ${ws} AND c."deletedAt" IS NULL AND c."createdAt" >= ${gte} AND c."createdAt" < ${lt} ${chC}
      ) x GROUP BY 1,2`),
    q<{ d: string; ch: string | null; ag: string | null; c: number }>(Prisma.sql`
      SELECT ${D('r."startedAt"')} d, c."channelId" ch, r."agentId" ag, count(DISTINCT r."conversationId")::int c
      FROM "AiRun" r JOIN "Conversation" c ON c."id" = r."conversationId"
      WHERE r."workspaceId" = ${ws} AND r."status" = 'handoff' AND r."kind" = 'reply' AND r."startedAt" >= ${gte} AND r."startedAt" < ${lt} ${chC}
      GROUP BY 1,2,3`),
    q<{ d: string; ch: string; dir: string; au: string; h: number; c: number }>(Prisma.sql`
      SELECT ${D('m."sentAt"')} d, c."channelId" ch, m."direction"::text dir, m."author"::text au, EXTRACT(HOUR FROM m."sentAt" + interval '1 hour')::int h, count(*)::int c
      FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE m."workspaceId" = ${ws} AND m."sentAt" >= ${gte} AND m."sentAt" < ${lt} ${chC}
      GROUP BY 1,2,3,4,5`),
    q<{ d: string; r: string; c: number }>(Prisma.sql`
      SELECT ${D('m."sentAt"')} d, m."customerReaction"::text r, count(*)::int c
      FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE m."workspaceId" = ${ws} AND m."author" = 'ai' AND m."customerReaction" IS NOT NULL AND m."sentAt" >= ${gte} AND m."sentAt" < ${lt} ${chC}
      GROUP BY 1,2`),
    // ANA-02 fix: cost = tokens × the model's prices (USD per 1 M tokens ⇒ tokens × price = micro-USD)
    q<{ d: string; kind: string; status: string; ag: string | null; model: string; fb: boolean; ch: string | null; intent: string | null; lang: string | null; c: number; tin: bigint; tout: bigint; cost: bigint; skipped: number }>(Prisma.sql`
      SELECT ${D('r."startedAt"')} d, r."kind"::text kind, r."status"::text status, r."agentId" ag, r."modelId" model, r."usedFallback" fb, c."channelId" ch,
             r."intent"::text intent, NULLIF(r."meta"->>'language', '') lang, count(*)::int c,
             coalesce(sum(r."inputTokens"),0)::bigint tin, coalesce(sum(r."outputTokens"),0)::bigint tout,
             coalesce(sum(r."inputTokens" * m."inputPricePerM" + r."outputTokens" * m."outputPricePerM"),0)::bigint cost,
             count(*) FILTER (WHERE 'outside_window' = ANY(r."flags"))::int skipped
      FROM "AiRun" r JOIN "AiModel" m ON m."id" = r."modelId" LEFT JOIN "Conversation" c ON c."id" = r."conversationId"
      WHERE r."workspaceId" = ${ws} AND r."kind" NOT IN ('test', 'test_scenario') AND r."startedAt" >= ${gte} AND r."startedAt" < ${lt} ${chC}
      GROUP BY 1,2,3,4,5,6,7,8,9`),
    q<{ d: string; b: number; c: number }>(Prisma.sql`
      SELECT ${D('r."startedAt"')} d, width_bucket(r."latencyMs" / 1000.0, ${thresholds('aiLatency')}) b, count(*)::int c
      FROM "AiRun" r LEFT JOIN "Conversation" c ON c."id" = r."conversationId"
      WHERE r."workspaceId" = ${ws} AND r."kind" = 'reply' AND r."latencyMs" IS NOT NULL AND r."startedAt" >= ${gte} AND r."startedAt" < ${lt} ${chC}
      GROUP BY 1,2`),
    // human reply time: first human message after a customer message, delay since that customer message (minutes)
    q<{ d: string; b: number; c: number }>(Prisma.sql`
      SELECT ${D('m."sentAt"')} d, width_bucket(EXTRACT(EPOCH FROM (m."sentAt" - p.at)) / 60.0, ${thresholds('humanLatency')}) b, count(*)::int c
      FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
      JOIN LATERAL (SELECT max(i."sentAt") at FROM "Message" i WHERE i."conversationId" = m."conversationId" AND i."direction" = 'in' AND i."sentAt" <= m."sentAt") p ON p.at IS NOT NULL
      WHERE m."workspaceId" = ${ws} AND m."author" = 'human' AND m."sentAt" >= ${gte} AND m."sentAt" < ${lt} ${chC}
        AND NOT EXISTS (SELECT 1 FROM "Message" x WHERE x."conversationId" = m."conversationId" AND x."author" = 'human' AND x."sentAt" > p.at AND x."sentAt" < m."sentAt")
      GROUP BY 1,2`),
    q<{ d: string; action: string; ag: string | null; ch: string | null; c: number; credits: bigint }>(Prisma.sql`
      SELECT ${D('l."createdAt"')} d, l."action"::text action, l."agentId" ag, l."channelId" ch, count(*)::int c, coalesce(-sum(l."credits"),0)::bigint credits
      FROM "CreditLedger" l WHERE l."workspaceId" = ${ws} AND l."kind" = 'debit' AND l."createdAt" >= ${gte} AND l."createdAt" < ${lt} ${chL}
      GROUP BY 1,2,3,4`),
    q<{ d: string; provider: string; acc: string | null; c: number; fees: bigint; customer: bigint }>(Prisma.sql`
      SELECT ${D('s."createdAt"')} d, s."provider"::text provider, s."courierAccountId" acc, count(*)::int c,
             coalesce(sum(s."courierCost"),0)::bigint fees, coalesce(sum(o."deliveryFee"),0)::bigint customer
      FROM "Shipment" s JOIN "Order" o ON o."id" = s."orderId"
      WHERE s."workspaceId" = ${ws} AND s."status" <> 'cancelled' AND s."createdAt" >= ${gte} AND s."createdAt" < ${lt} ${chO}
      GROUP BY 1,2,3`),
    q<{ d: string; status: string; provider: string; acc: string | null; b: number | null; c: number; days: number | null; cod: bigint; att1: number; att2: number }>(Prisma.sql`
      SELECT x.d, x.status, x.provider, x.acc, CASE WHEN x.status = 'delivered' THEN width_bucket(x.days, ${thresholds('shipDays')}) END b, count(*)::int c,
             sum(x.days) FILTER (WHERE x.status = 'delivered')::float8 days, coalesce(sum(x.cod) FILTER (WHERE x.status = 'delivered'),0)::bigint cod,
             count(*) FILTER (WHERE x.status = 'delivered' AND x.attempts <= 1)::int att1, count(*) FILTER (WHERE x.status = 'delivered' AND x.attempts = 2)::int att2
      FROM (
        SELECT ${D('COALESCE(s."lastEventAt", s."updatedAt")')} d, s."status"::text status, s."provider"::text provider, s."courierAccountId" acc, s."codAmount" cod, s."deliveryAttempts" attempts,
               EXTRACT(EPOCH FROM (COALESCE(s."lastEventAt", s."updatedAt") - s."createdAt")) / 86400.0 days
        FROM "Shipment" s JOIN "Order" o ON o."id" = s."orderId"
        WHERE s."workspaceId" = ${ws} AND s."status" IN ('delivered', 'returned', 'failed')
          AND COALESCE(s."lastEventAt", s."updatedAt") >= ${gte} AND COALESCE(s."lastEventAt", s."updatedAt") < ${lt} ${chO}
      ) x GROUP BY 1,2,3,4,5`),
  ]);

  const days = new Map<string, DayMetrics>();
  const day = (d: string) => {
    let m = days.get(d);
    if (!m) days.set(d, (m = emptyDay()));
    return m;
  };
  const idx = (b: number | null | undefined, h: HistName) => Math.min(Math.max(Number(b ?? 0), 0), HIST[h].edges.length);

  for (const r of created) {
    const m = day(r.d);
    const c = r.c;
    m.orders.created += c;
    if (r.source === 'ai') m.orders.ai += c;
    m.orders.calls += n(r.calls);
    m.orders.orderedValue += n(r.total);
    // 04 §4 "Cash collected" = Σ amountPaid of the orders placed in the period (same as the home tile)
    m.orders.cashCollected += n(r.paid);
    inc(m.srcCreated, r.source, c);
    inc(m.status, r.status, c);
    inc(m.payment, r.pm, c);
    if (r.ch) {
      const x = entry(m.channels, r.ch, ch0);
      x.orders += c;
      if (r.source === 'ai') x.aiOrders += c;
    }
    if (r.ag) entry(m.agents, r.ag, ag0).orders += c;
    if (r.wi) entry(m.wilayas, String(r.wi), wi0).orders += c;
  }
  for (const r of confirmed) {
    const m = day(r.d);
    m.orders.confirmed += r.c;
    if (r.source === 'ai') m.orders.confirmedAi += r.c;
    if (r.ag) entry(m.agents, r.ag, ag0).confirmed += r.c;
  }
  for (const r of cancelled) {
    const m = day(r.d);
    m.orders.cancelled += r.c;
    inc(m.cancelReasons, r.reason ?? 'other', r.c);
  }
  for (const r of delivered) {
    const m = day(r.d);
    const total = n(r.total);
    m.orders.delivered += r.c;
    if (r.cod) m.orders.deliveredCod += r.c;
    m.revenue.orders += total;
    if (r.source === 'ai') m.revenue.ordersAi += total;
    m.revenue.deliveryFees += n(r.fees);
    m.revenue.ordersDiscount += n(r.disc);
    m.revenue.ordersTax += n(r.tax);
    inc(m.srcDelivered, r.source, r.c);
    inc(m.srcRevenue, r.source, total);
    if (r.ch && r.source === 'ai') entry(m.channels, r.ch, ch0).aiRevenue += total;
    if (r.ag) entry(m.agents, r.ag, ag0).revenue += total;
    if (r.wi) {
      const w = entry(m.wilayas, String(r.wi), wi0);
      w.delivered += r.c;
      w.revenue += total;
    }
  }
  for (const r of shipped) day(r.d).orders.shipped += r.c;
  for (const r of returned) {
    const m = day(r.d);
    m.orders.returned += r.c;
    if (r.wi) entry(m.wilayas, String(r.wi), wi0).returned += r.c;
  }
  for (const r of sales) {
    const m = day(r.d);
    m.revenue.sales += n(r.total);
    m.revenue.salesCount += r.c;
    m.revenue.salesDiscount += n(r.disc);
    m.revenue.salesTax += n(r.tax);
    // UX-052: money paid on counter sales counts in « Cash collected » (04 §4)
    m.revenue.salesPaid += n(r.paid);
  }
  for (const r of lines) {
    const p = entry(day(r.d).products, r.pid, pr0);
    p.sold += n(r.qty);
    p.revenue += n(r.rev);
    p.cogs += n(r.cogs);
  }
  for (const r of requested) if (r.pid && /^[0-9a-f-]{36}$/i.test(r.pid)) entry(day(r.d).products, r.pid, pr0).requested += r.c;
  for (const r of convs) {
    const m = day(r.d);
    m.conv.created += r.c;
    m.conv.purchaseIntent += r.intent;
    m.conv.abandoned += r.abandoned;
    entry(m.channels, r.ch, ch0).conv += r.c;
    if (r.ag) entry(m.agents, r.ag, ag0).conv += r.c;
  }
  for (const r of msgCounts) day(r.d).msgPerConv[bucketOf('msgPerConv', r.m)]! += r.c;
  for (const r of handoffs) {
    const m = day(r.d);
    m.conv.handoffs += r.c;
    if (r.ch) entry(m.channels, r.ch, ch0).handoffs += r.c;
    if (r.ag) entry(m.agents, r.ag, ag0).handoffs += r.c;
  }
  for (const r of messages) {
    const m = day(r.d);
    const x = entry(m.channels, r.ch, ch0);
    if (r.dir === 'in') {
      m.msg.in += r.c;
      x.in += r.c;
      m.hours[r.h]! += r.c;
    } else {
      m.msg.out += r.c;
      x.out += r.c;
    }
    if (r.au === 'ai') {
      m.msg.ai += r.c;
      x.aiReplies += r.c;
    }
    if (r.au === 'human') m.msg.human += r.c;
  }
  for (const r of reactions) {
    const m = day(r.d);
    if (r.r === 'like') m.reactions.like += r.c;
    else if (r.r === 'dislike') m.reactions.dislike += r.c;
  }
  for (const r of runs) {
    const m = day(r.d);
    const c = r.c;
    m.ai.inputTokens += n(r.tin);
    m.ai.outputTokens += n(r.tout);
    m.ai.costMicro += n(r.cost);
    const mo = entry(m.models, r.model, mo0);
    mo.runs += c;
    mo.inputTokens += n(r.tin);
    mo.outputTokens += n(r.tout);
    mo.costMicro += n(r.cost);
    if (r.kind === 'vision') m.ai.vision += c;
    if (r.kind === 'transcription') m.ai.transcription += c;
    if (r.kind !== 'reply') continue;
    m.ai.runs += c;
    if (r.status === 'ok' || r.status === 'unclear' || r.status === 'unknown' || r.status === 'handoff' || r.status === 'error') m.ai[r.status] += c;
    if (r.fb) m.ai.fallback += c;
    m.ai.skippedWindow += r.skipped;
    if (r.intent) inc(m.intents, r.intent, c);
    if (r.lang) inc(m.lang, r.lang.toLowerCase(), c);
    if (r.ag) entry(m.agents, r.ag, ag0).runs += c;
  }
  for (const r of aiLat) day(r.d).aiLatency[idx(r.b, 'aiLatency')]! += r.c;
  for (const r of humanLat) day(r.d).humanLatency[idx(r.b, 'humanLatency')]! += r.c;
  for (const r of credits) {
    const m = day(r.d);
    const cr = n(r.credits);
    m.credits.total += cr;
    if (r.action === 'text_reply') {
      m.credits.text += cr;
      m.credits.textN += r.c;
    } else if (r.action === 'image_recognition') {
      m.credits.image += cr;
      m.credits.imageN += r.c;
    } else if (r.action === 'voice_transcription') {
      m.credits.voice += cr;
      m.credits.voiceN += r.c;
    }
    if (r.ag) entry(m.agents, r.ag, ag0).credits += cr;
  }
  for (const r of shipCreated) {
    const m = day(r.d);
    m.ship.created += r.c;
    m.ship.courierFees += n(r.fees);
    m.ship.customerFees += n(r.customer);
    const co = entry(m.couriers, courierKey(r.provider, r.acc), co0);
    co.parcels += r.c;
    co.fees += n(r.fees);
  }
  for (const r of shipDone) {
    const m = day(r.d);
    const co = entry(m.couriers, courierKey(r.provider, r.acc), co0);
    if (r.status === 'delivered') {
      m.ship.delivered += r.c;
      m.ship.daysSum += Number(r.days ?? 0);
      m.ship.daysCount += r.c;
      m.ship.cod += n(r.cod);
      m.ship.firstAttempt += r.att1;
      m.ship.secondAttempt += r.att2;
      m.shipDays[idx(r.b, 'shipDays')]! += r.c;
      co.delivered += r.c;
      co.daysSum += Number(r.days ?? 0);
      co.daysCount += r.c;
      co.cod += n(r.cod);
    } else if (r.status === 'returned') {
      m.ship.returned += r.c;
      co.returned += r.c;
    } else if (r.status === 'failed') {
      m.ship.failed += r.c;
      co.failed += r.c;
    }
  }
  // day sums of delivery days are fractional: keep 2 decimals so the JSON stays small
  for (const m of days.values()) {
    m.ship.daysSum = Math.round(m.ship.daysSum * 100) / 100;
    for (const co of Object.values(m.couriers)) co.daysSum = Math.round(co.daysSum * 100) / 100;
  }
  return days;
}
