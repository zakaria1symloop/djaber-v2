// Home dashboard rules (Figma "ANA-01 — Home — default", "ANA-01 — Home — new workspace + banners", "ANA-01b — Home &
// Notifications — states catalogue"; 12 §3, §18; `HomeView` of `GET /dashboard/home`). Pure functions, unit tested.
import { compareHomeQueueItems, HOME_QUEUE_KINDS, HOME_QUEUE_MAX, type HomePageCard, type HomeQueueItem, type HomeQueueKind, type HomeView } from '@djaber/shared';

/* ---------- "À TRAITER" cards ---------- */
/** Tone key of the `Home.queue` pill map (the API kind `task` is the TÂCHE card = `job` colour). */
export const queueToneKey = (kind: HomeQueueKind): string => (kind === 'task' ? 'job' : kind);
/** COLIS · STOCK · PAGE · INSIGHT · CONVERSATION · RAPPEL · TÂCHE */
export const queueLabelKey = (kind: HomeQueueKind): string => `home.queue.kind.${kind}`;

/** 12 §18: sort urgency first (0 = most urgent), then age (oldest waiting first), then key (same order as the API); at most 8 cards. */
export function sortQueue(items: readonly HomeQueueItem[], max = HOME_QUEUE_MAX): HomeQueueItem[] {
  const open = items
    .filter((i) => !i.handled)
    .sort(compareHomeQueueItems)
    .slice(0, max);
  return [...open, ...handledQueue(items)];
}

/** M8 (03 §37 ANA-01): items handled in the last 24 h stay greyed after the open ones ("fait par …"), newest first. */
export const HANDLED_MAX = 3;
export function handledQueue(items: readonly HomeQueueItem[], max = HANDLED_MAX): HomeQueueItem[] {
  return items
    .filter((i) => !!i.handled)
    .sort((a, b) => Date.parse(b.handled!.at) - Date.parse(a.handled!.at) || a.key.localeCompare(b.key))
    .slice(0, max);
}

/**
 * UX-065 — "Tout voir" of 12 §18: one link per kind that has cards counted by the server but not drawn, to the page
 * where ALL the cards of that kind are ("+ 2 alertes stock" → Produits › Stock bas, "+ 1 colis en échec" → Livraison ›
 * Échecs, conversations / insights → File d'attente …), in the order of the kinds. Empty when every card is on screen.
 */
export const QUEUE_MORE_HREF: Record<HomeQueueKind, string> = {
  parcel: '/delivery?tab=failed',
  stock: '/products?lowStock=1',
  page: '/channels',
  insight: '/queue',
  conversation: '/queue',
  callback: '/orders?confirmationStatus=callback',
  task: '/notifications?group=jobs&types=job_failed',
};
export type QueueMore = { kind: HomeQueueKind; count: number; key: string; href: string };
export function queueOverflow(queue: HomeView['queue'], shown: readonly HomeQueueItem[]): QueueMore[] {
  const drawn = new Map<HomeQueueKind, number>();
  for (const i of shown) if (!i.handled) drawn.set(i.kind, (drawn.get(i.kind) ?? 0) + 1);
  return HOME_QUEUE_KINDS.flatMap((kind) => {
    const count = Math.max(0, (queue.counts?.[kind] ?? 0) - (drawn.get(kind) ?? 0));
    return count > 0 ? [{ kind, count, key: `home.queue.moreKind.${kind}`, href: QUEUE_MORE_HREF[kind] }] : [];
  });
}

/** Internal path of a card (`path` comes from the server: only same-origin absolute paths are followed). */
export const queueHref = (item: Pick<HomeQueueItem, 'path' | 'kind'>): string => {
  const p = (item.path ?? '').trim();
  if (p.startsWith('/') && !p.startsWith('//') && !p.includes('\\')) return p.replace(/^\/(fr|ar|en)(?=\/|$)/, '') || '/home';
  return item.kind === 'conversation' || item.kind === 'insight' ? '/queue' : '/home';
};

/**
 * Words of a card. The server sends raw details per kind (insight type, "stock / seuil", callback instant, job kind,
 * failure reason, platform): they become the ANA-01b lines ("4 restants (seuil 5)", "Rappeler à 16:00"…).
 */
export type QueueText = { title: { key: string; params: Record<string, string | number> } | string; subtitle: { key: string; params: Record<string, string | number> } | string | null };
export function queueText(item: Pick<HomeQueueItem, 'kind' | 'title' | 'subtitle'>, clock: (iso: string) => string): QueueText {
  const raw = item.subtitle ?? null;
  switch (item.kind) {
    case 'insight':
      return { title: item.title, subtitle: raw ? { key: `enum.AgentInsight.type.${raw}`, params: {} } : null };
    case 'stock': {
      const m = /^(-?\d+)\s*\/\s*(\d+)$/.exec(raw ?? '');
      return { title: item.title, subtitle: m ? { key: 'home.queue.sub.stock', params: { stock: Number(m[1]), min: Number(m[2]) } } : raw };
    }
    case 'callback':
      return { title: item.title, subtitle: raw && !Number.isNaN(Date.parse(raw)) ? { key: 'home.queue.sub.callback', params: { time: clock(raw) } } : raw };
    case 'parcel':
      return { title: item.title, subtitle: raw ? { key: `enum.Shipment.failureReason.${raw}`, params: {} } : null };
    case 'page':
      return { title: item.title, subtitle: { key: 'home.queue.sub.page', params: { platform: raw === 'instagram' ? 'Instagram' : 'Facebook' } } };
    case 'task':
      return { title: { key: 'home.queue.task.failed', params: { kind: item.title } }, subtitle: raw };
    default:
      return { title: item.title, subtitle: raw };
  }
}

/** Age of a card / row as the frames write it: "2 MIN", "1 H", "HIER", "IL Y A 2 J" (uppercased by the CSS). */
export function shortAge(iso: string, now = Date.now()): { key: string; count: number } {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { key: 'home.age.now', count: 0 };
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 1) return { key: 'home.age.now', count: 0 };
  if (min < 60) return { key: 'home.age.minutes', count: min };
  const h = Math.floor(min / 60);
  if (h < 24) return { key: 'home.age.hours', count: h };
  const d = Math.floor(h / 24);
  if (d === 1) return { key: 'home.age.yesterday', count: 1 };
  return { key: 'home.age.days', count: d };
}

/* ---------- "APERÇU" KPI tiles ---------- */
export type HomeTile = { key: 'pages' | 'products' | 'revenue' | 'stock'; value: number; money: boolean; sub: { key: string; count: number }[] };
/**
 * The four tiles of the frame, from the named figures of 04 §4 (AT-ANA-01): PAGES CONNECTÉES = active channels,
 * PRODUITS = catalogue size (+ low stock), CHIFFRE D'AFFAIRES (30 J) = Revenue 30 d, VALEUR DU STOCK = stock value
 * (at cost when the server gives it — advanced mode —, otherwise at retail).
 */
export function homeTiles(k: HomeView['kpis']): HomeTile[] {
  const low = k.products.lowStock + k.products.outOfStock;
  return [
    { key: 'pages', value: k.channels.active, money: false, sub: k.channels.needsReconnect > 0 ? [{ key: 'home.kpi.pages.reconnect', count: k.channels.needsReconnect }] : [] },
    { key: 'products', value: k.products.total, money: false, sub: low > 0 ? [{ key: 'home.kpi.products.low', count: low }] : [] },
    { key: 'revenue', value: k.revenue30d.value, money: true, sub: revenueSources(k.revenueSources30d) },
    { key: 'stock', value: k.stockValue.cost ?? k.stockValue.retail, money: true, sub: [] },
  ];
}

/**
 * UX-063 — line under CHIFFRE D'AFFAIRES (30 J): what the amount is made of, from the server counts (same rows as the
 * amount, 04 §4 Revenue): "1 commande livrée · 1 vente"; only the non-zero parts; nothing when both are 0.
 */
export function revenueSources(s: HomeView['kpis']['revenueSources30d'] | undefined): { key: string; count: number }[] {
  const parts: { key: string; count: number }[] = [];
  if (s && s.deliveredOrders > 0) parts.push({ key: 'home.kpi.revenue.deliveredOrders', count: s.deliveredOrders });
  if (s && s.sales > 0) parts.push({ key: 'home.kpi.revenue.sales', count: s.sales });
  return parts;
}

/* ---------- "ACTIONS RAPIDES" ---------- */
export type QuickActionKey = HomeView['quickActions'][number]['key'];
export const QUICK_ACTION_HREF: Record<QuickActionKey, string> = {
  connect_page: '/channels',
  add_product: '/products/new',
  create_agent: '/agents',
  new_order: '/orders/new',
  open_inbox: '/inbox',
  import_products: '/products/import',
};
/** The three cards of the frame when the server sends none (connect a page, add products, AI agents). */
export const DEFAULT_QUICK_ACTIONS: HomeView['quickActions'] = [
  { key: 'connect_page', enabled: true },
  { key: 'add_product', enabled: true },
  { key: 'create_agent', enabled: true },
];
/** The frame draws three cards (Connecter une page · Ajouter des produits · Agents IA): those keys, with the server state. */
export const FRAME_QUICK_ACTIONS: readonly QuickActionKey[] = ['connect_page', 'add_product', 'create_agent'];
export const quickActionsOf = (view: Pick<HomeView, 'quickActions'> | null | undefined): HomeView['quickActions'] =>
  FRAME_QUICK_ACTIONS.map((key) => view?.quickActions?.find((a) => a.key === key) ?? DEFAULT_QUICK_ACTIONS.find((a) => a.key === key)!);

/* ---------- "VOS PAGES" cards ---------- */
/** "● IA": an active agent answers on the page (and the page itself is live). */
export const aiLive = (card: Pick<HomePageCard, 'status' | 'agent'>): boolean => card.status === 'active' && card.agent?.status === 'active';
/** Agent row of the card: ready (active) / paused / draft / none. */
export const agentState = (card: Pick<HomePageCard, 'agent'>): 'ready' | 'paused' | 'draft' | 'none' =>
  !card.agent ? 'none' : card.agent.status === 'active' ? 'ready' : card.agent.status === 'paused' ? 'paused' : 'draft';

/**
 * Button of the agent row: none → link one (channel page "IA & agent"); draft → finish it (the agent page resumes the
 * wizard at its step); paused → resume it (agent page, "Reprendre"); ready → regenerate from the page.
 */
export const agentCta = (
  card: Pick<HomePageCard, 'id' | 'agent'>,
): { labelKey: string; href: string } => {
  const state = agentState(card);
  if (state === 'none')
    return { labelKey: 'home.pages.agent.link', href: `/channels/${card.id}/ai` };
  if (state === 'draft')
    return { labelKey: 'gaps.home.agent.finish', href: `/agents/${card.agent!.id}` };
  if (state === 'paused')
    return { labelKey: 'gaps.home.agent.resume', href: `/agents/${card.agent!.id}` };
  return { labelKey: 'home.pages.agent.regenerate', href: `/agents/generate?channel=${card.id}` };
};

/* ---------- "DÉMARRER n / 4" ---------- */
export const checklistDone = (g: Pick<HomeView['getStarted'], 'checklist'>): number => Object.values(g.checklist).filter(Boolean).length;
