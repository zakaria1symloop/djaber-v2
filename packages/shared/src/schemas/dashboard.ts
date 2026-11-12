// Home dashboard (03 §16 ANA-01 / ANA-03, §37 ANA-01; 08 §4.3; 12 §3, §18; 06 "Notifications, home, analytics").
// `GET /dashboard/home` (permission `analytics.read`, every member). Money = integer DZD, figures named per 04 §4.
import type { ChannelRefView } from './channels';

/** "À traiter" card types `[FIG ANA-01b]`: COLIS · STOCK · PAGE · INSIGHT · CONVERSATION · RAPPEL · TÂCHE. */
export const HOME_QUEUE_KINDS = ['parcel', 'stock', 'page', 'insight', 'conversation', 'callback', 'task'] as const;
export type HomeQueueKind = (typeof HOME_QUEUE_KINDS)[number];
/** 12 §18: at most 8 cards, then "Tout voir". */
export const HOME_QUEUE_MAX = 8;
/** Home banners in priority order (12 §0 / §16): the web shows the first ones. */
export const HOME_BANNERS = ['credits_exhausted', 'credits_80', 'plan_expired', 'plan_expiring', 'reconnect', 'pending_meta', 'resume_onboarding', 'email_unverified'] as const;
export type HomeBannerKind = (typeof HOME_BANNERS)[number];

export type HomeQueueItem = {
  /** stable key: `<kind>:<id>` */
  key: string;
  kind: HomeQueueKind;
  /** 0 = most urgent; cards are sorted by urgency, then age (oldest first) */
  urgency: 0 | 1 | 2;
  title: string;
  subtitle: string | null;
  /** when the item started waiting (handoff time, failure time, callback time …; STOCK = the movement that brought the line to its threshold / 0, UX-062) */
  since: string;
  /** web path of the target (mobile = `djaber://` + path) */
  path: string;
  /** object ids the card refers to (conversationId, orderId, shipmentId, productId, variantId, channelId, insightId, jobId) */
  ref: Record<string, string>;
  /** M8 (03 §37 ANA-01): an item handled in the last 24 h stays greyed with "fait par …"; open items have no `handled` */
  handled?: { at: string; by: { id: string; name: string } | null };
};
/**
 * 12 §18 order of the "À traiter" cards (UX-065): urgency first (0 = most urgent), then age (oldest `since` first), then
 * `key` so the 8 slots are deterministic. Shared by the API (which picks the cards) and the web (which draws them).
 */
export const compareHomeQueueItems = (a: Pick<HomeQueueItem, 'urgency' | 'since' | 'key'>, b: Pick<HomeQueueItem, 'urgency' | 'since' | 'key'>): number =>
  a.urgency - b.urgency || Date.parse(a.since) - Date.parse(b.since) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export type HomeKpi = { value: number; previous: number | null; deltaPct: number | null };
export type HomePageCard = ChannelRefView & {
  pausedReason: 'manual' | 'plan' | 'moderation' | null;
  agent: { id: string; name: string; status: 'draft' | 'active' | 'paused' } | null;
  needsHuman: number;
  unread: number;
  aiOrders30d: number;
  /** when the page was connected (`Channel.createdAt`) — "connectée le 12 août" */
  connectedAt: string;
  /** "CONV." tile: conversations of the page / of them not closed (active or needs_human) */
  conversations: { total: number; active: number };
  /** "MSG 7J" tile: messages of the last 7 days / of them received from customers ("entr.") */
  messages7d: { total: number; inbound: number };
};
export type HomeView = {
  greeting: { firstName: string; workspaceName: string; partOfDay: 'morning' | 'afternoon' | 'evening' };
  /** "À traiter": the first `HOME_QUEUE_MAX` items + the total count of each kind */
  queue: { items: HomeQueueItem[]; total: number; counts: Record<HomeQueueKind, number> };
  /** KPI tiles, period "30 j" (Africa/Algiers), previous = the 30 days before */
  kpis: {
    channels: { active: number; total: number; needsReconnect: number };
    products: { total: number; lowStock: number; outOfStock: number };
    /** 04 §4 Revenue = Σ completed sales (soldAt) + Σ delivered orders (deliveredAt), 30 d */
    revenue30d: HomeKpi;
    /**
     * UX-063: what `revenue30d.value` is made of, same period and same definitions (04 §4 Revenue): delivered orders
     * (status delivered, deliveredAt in the 30 d) and completed counter sales (soldAt in the 30 d). Line under the tile.
     */
    revenueSources30d: { deliveredOrders: number; sales: number };
    /** 04 §4 AI revenue = Revenue restricted to AI orders, 30 d */
    aiRevenue30d: HomeKpi;
    /** 04 §4 Pipeline = Σ Order.total, status ∈ new / confirmed / preparing / shipped (now) */
    pipeline: number;
    /** 04 §4 Cash collected = Σ amountPaid of orders placed in the 30 d */
    cashCollected30d: number;
    orders30d: HomeKpi;
    aiOrders30d: number;
    ordersToConfirm: number;
    /** GDS-01 stock value at retail (tracked products + active variants); at cost in advanced mode */
    stockValue: { retail: number; cost: number | null };
    conversations30d: number;
  };
  quickActions: { key: 'new_order' | 'add_product' | 'connect_page' | 'create_agent' | 'open_inbox' | 'import_products'; enabled: boolean; reasonCode?: string }[];
  pages: HomePageCard[];
  getStarted: { step: number; checklist: { channel: boolean; product: boolean; agent: boolean; order: boolean }; done: number; total: number };
  credits: { total: number; planUsed: number; planLimit: number; unlimited: boolean; exhausted: boolean; usedPct: number };
  banners: { kind: HomeBannerKind; params?: Record<string, string | number> }[];
  generatedAt: string;
};
