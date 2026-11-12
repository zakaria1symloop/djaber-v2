import type { HomeQueueItem, HomeView } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import { agentCta, agentState, aiLive, checklistDone, homeTiles, QUICK_ACTION_HREF, QUEUE_MORE_HREF, queueHref, queueLabelKey, queueOverflow, queueText, queueToneKey, quickActionsOf, revenueSources, shortAge, sortQueue } from './logic';

const item = (key: string, kind: HomeQueueItem['kind'], urgency: 0 | 1 | 2, minAgo: number, now = Date.parse('2026-10-12T12:00:00Z')): HomeQueueItem => ({
  key,
  kind,
  urgency,
  title: key,
  subtitle: null,
  since: new Date(now - minAgo * 60_000).toISOString(),
  path: `/queue`,
  ref: {},
});
const kpis = (o: Partial<HomeView['kpis']> = {}): HomeView['kpis'] => ({
  channels: { active: 2, total: 3, needsReconnect: 0 },
  products: { total: 128, lowStock: 2, outOfStock: 1 },
  revenue30d: { value: 1_184_000, previous: null, deltaPct: null },
  revenueSources30d: { deliveredOrders: 9, sales: 1 },
  aiRevenue30d: { value: 0, previous: null, deltaPct: null },
  pipeline: 0,
  cashCollected30d: 0,
  orders30d: { value: 12, previous: null, deltaPct: null },
  aiOrders30d: 8,
  ordersToConfirm: 3,
  stockValue: { retail: 1_240_000, cost: null },
  conversations30d: 40,
  ...o,
});

describe('home queue cards (12 §18)', () => {
  it('maps every kind to its label key and pill tone (task = TÂCHE = job colour)', () => {
    expect(queueLabelKey('parcel')).toBe('home.queue.kind.parcel');
    expect(queueToneKey('task')).toBe('job');
    expect(queueToneKey('callback')).toBe('callback');
  });
  it('sorts by urgency then age (oldest first) and keeps at most 8', () => {
    const items = [item('a', 'stock', 2, 5), item('b', 'conversation', 0, 2), item('c', 'parcel', 0, 60), item('d', 'page', 1, 1)];
    expect(sortQueue(items).map((i) => i.key)).toEqual(['c', 'b', 'd', 'a']);
    const many = Array.from({ length: 12 }, (_, i) => item(`k${i}`, 'conversation', 1, i));
    expect(sortQueue(many)).toHaveLength(8);
  });
  it('UX-065: a new stock-out never pushes an older one out of the 8 slots; equal ages are ordered by key', () => {
    const old = Array.from({ length: 9 }, (_, i) => item(`stock:old${i}`, 'stock', 0, 1_200 + i));
    const shown = sortQueue(old).map((i) => i.key);
    const fresh = [item('stock:new1', 'stock', 0, 1), item('stock:new2', 'stock', 0, 0)];
    expect(sortQueue([...fresh, ...old]).map((i) => i.key)).toEqual(shown);
    expect(shown).not.toContain('stock:old0'); // the youngest of the 9 old ones is the hidden one
    expect(sortQueue([item('z', 'stock', 0, 5), item('a', 'stock', 0, 5)]).map((i) => i.key)).toEqual(['a', 'z']);
  });
  it('UX-065: one "+ n …" link per hidden kind, to the page that lists all the cards of that kind', () => {
    const shown = [item('a', 'conversation', 0, 1), item('b', 'stock', 0, 2)];
    const counts = { parcel: 1, stock: 3, page: 0, insight: 4, conversation: 1, callback: 0, task: 0 };
    expect(queueOverflow({ items: shown, total: 9, counts }, shown)).toEqual([
      { kind: 'parcel', count: 1, key: 'home.queue.moreKind.parcel', href: '/delivery?tab=failed' },
      { kind: 'stock', count: 2, key: 'home.queue.moreKind.stock', href: '/products?lowStock=1' },
      { kind: 'insight', count: 4, key: 'home.queue.moreKind.insight', href: '/queue' },
    ]);
    expect(queueOverflow({ items: shown, total: 2, counts: { ...counts, parcel: 0, stock: 1, insight: 0 } }, shown)).toEqual([]);
  });
  it('every kind has a "Tout voir" destination (the Queue only lists conversations and insights, 12 §4)', () => {
    expect(QUEUE_MORE_HREF).toEqual({
      parcel: '/delivery?tab=failed',
      stock: '/products?lowStock=1',
      page: '/channels',
      insight: '/queue',
      conversation: '/queue',
      callback: '/orders?confirmationStatus=callback',
      task: '/notifications?group=jobs&types=job_failed',
    });
  });
  it('follows only internal paths (locale prefix removed), else the queue / home', () => {
    expect(queueHref({ path: '/inbox/abc', kind: 'conversation' })).toBe('/inbox/abc');
    expect(queueHref({ path: '/fr/orders/1', kind: 'callback' })).toBe('/orders/1');
    expect(queueHref({ path: 'https://evil.example', kind: 'conversation' })).toBe('/queue');
    expect(queueHref({ path: '//evil', kind: 'stock' })).toBe('/home');
  });
  it('writes ages like the frames (2 MIN, 1 H, HIER, IL Y A 2 J)', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    expect(shortAge(new Date(now - 30_000).toISOString(), now)).toEqual({ key: 'home.age.now', count: 0 });
    expect(shortAge(new Date(now - 2 * 60_000).toISOString(), now)).toEqual({ key: 'home.age.minutes', count: 2 });
    expect(shortAge(new Date(now - 90 * 60_000).toISOString(), now)).toEqual({ key: 'home.age.hours', count: 1 });
    expect(shortAge(new Date(now - 30 * 3600_000).toISOString(), now)).toEqual({ key: 'home.age.yesterday', count: 1 });
    expect(shortAge(new Date(now - 50 * 3600_000).toISOString(), now)).toEqual({ key: 'home.age.days', count: 2 });
  });
});

describe('home queue card words (ANA-01b lines from the raw server details)', () => {
  const clock = () => '16:00';
  it('turns the raw details into the frame lines', () => {
    expect(queueText({ kind: 'stock', title: 'Parfum Oud', subtitle: '4 / 5' }, clock).subtitle).toEqual({ key: 'home.queue.sub.stock', params: { stock: 4, min: 5 } });
    expect(queueText({ kind: 'callback', title: 'CMD-1041 · Yacine M.', subtitle: '2026-10-12T15:00:00.000Z' }, clock).subtitle).toEqual({ key: 'home.queue.sub.callback', params: { time: '16:00' } });
    expect(queueText({ kind: 'insight', title: 'Vendeur Pro', subtitle: 'unknown_topic' }, clock).subtitle).toEqual({ key: 'enum.AgentInsight.type.unknown_topic', params: {} });
    expect(queueText({ kind: 'parcel', title: 'CMD-1037 · Lina S.', subtitle: 'unreachable' }, clock).subtitle).toEqual({ key: 'enum.Shipment.failureReason.unreachable', params: {} });
    expect(queueText({ kind: 'page', title: 'Amel Outlet', subtitle: 'facebook' }, clock).subtitle).toEqual({ key: 'home.queue.sub.page', params: { platform: 'Facebook' } });
    expect(queueText({ kind: 'task', title: 'import', subtitle: null }, clock).title).toEqual({ key: 'home.queue.task.failed', params: { kind: 'import' } });
    expect(queueText({ kind: 'conversation', title: 'Amina B.', subtitle: 'salam' }, clock)).toEqual({ title: 'Amina B.', subtitle: 'salam' });
    expect(queueText({ kind: 'stock', title: 'x', subtitle: 'texte libre' }, clock).subtitle).toBe('texte libre');
  });
});

describe('home KPI tiles (AT-ANA-01 named figures)', () => {
  it('reads the four tiles of the frame from the named figures', () => {
    const tiles = homeTiles(kpis());
    expect(tiles.map((t) => [t.key, t.value])).toEqual([
      ['pages', 2],
      ['products', 128],
      ['revenue', 1_184_000],
      ['stock', 1_240_000],
    ]);
    expect(tiles[1]!.sub).toEqual([{ key: 'home.kpi.products.low', count: 3 }]);
    expect(tiles[2]!.sub).toEqual([
      { key: 'home.kpi.revenue.deliveredOrders', count: 9 },
      { key: 'home.kpi.revenue.sales', count: 1 },
    ]);
    expect(tiles[0]!.sub).toEqual([]);
  });
  it('UX-063: the revenue line explains the amount — only the parts that exist, nothing when both are 0', () => {
    expect(revenueSources({ deliveredOrders: 3, sales: 0 })).toEqual([{ key: 'home.kpi.revenue.deliveredOrders', count: 3 }]);
    expect(revenueSources({ deliveredOrders: 0, sales: 2 })).toEqual([{ key: 'home.kpi.revenue.sales', count: 2 }]);
    expect(revenueSources({ deliveredOrders: 0, sales: 0 })).toEqual([]);
    expect(revenueSources(undefined)).toEqual([]); // older API without the field
  });
  it('uses the stock value at cost when the server gives it (advanced mode)', () => {
    expect(homeTiles(kpis({ stockValue: { retail: 10, cost: 7 } }))[3]!.value).toBe(7);
  });
  it('flags pages to reconnect and hides an empty low-stock line', () => {
    const tiles = homeTiles(kpis({ channels: { active: 1, total: 2, needsReconnect: 1 }, products: { total: 4, lowStock: 0, outOfStock: 0 } }));
    expect(tiles[0]!.sub).toEqual([{ key: 'home.kpi.pages.reconnect', count: 1 }]);
    expect(tiles[1]!.sub).toEqual([]);
  });
});

describe('home quick actions and page cards', () => {
  it('draws the three cards of the frame with the server state, defaults when absent', () => {
    expect(quickActionsOf({ quickActions: [] }).map((a) => a.key)).toEqual(['connect_page', 'add_product', 'create_agent']);
    const server = quickActionsOf({ quickActions: [{ key: 'new_order', enabled: true }, { key: 'create_agent', enabled: false, reasonCode: 'FORBIDDEN' }, { key: 'connect_page', enabled: true }] });
    expect(server.map((a) => a.key)).toEqual(['connect_page', 'add_product', 'create_agent']);
    expect(server[2]).toEqual({ key: 'create_agent', enabled: false, reasonCode: 'FORBIDDEN' });
    expect(QUICK_ACTION_HREF.new_order).toBe('/orders/new');
  });
  it('shows "● IA" only for an active agent on an active page', () => {
    const agent = { id: 'a', name: 'Vendeur Pro', status: 'active' as const };
    expect(aiLive({ status: 'active', agent })).toBe(true);
    expect(aiLive({ status: 'needs_reconnect', agent })).toBe(false);
    expect(aiLive({ status: 'active', agent: { ...agent, status: 'paused' } })).toBe(false);
  });
  it('derives the agent row state', () => {
    expect(agentState({ agent: null })).toBe('none');
    expect(agentState({ agent: { id: 'a', name: 'x', status: 'draft' } })).toBe('draft');
    expect(agentState({ agent: { id: 'a', name: 'x', status: 'paused' } })).toBe('paused');
    expect(agentState({ agent: { id: 'a', name: 'x', status: 'active' } })).toBe('ready');
  });
  it('counts the Get Started steps done (AT-UX-05)', () => {
    expect(checklistDone({ checklist: { channel: true, product: true, agent: false, order: false } })).toBe(2);
  });
});

describe('home handled cards (M8 carry-over, 03 §37 ANA-01)', () => {
  it('keeps the open items first and appends the items handled in the last 24 h, newest first', () => {
    const open = item('open', 'stock', 1, 10);
    const h1 = { ...item('h1', 'conversation', 0, 30), handled: { at: '2026-10-12T11:00:00Z', by: { id: 'u', name: 'Nadia F.' } } };
    const h2 = { ...item('h2', 'parcel', 0, 40), handled: { at: '2026-10-12T11:30:00Z', by: null } };
    const sorted = sortQueue([h1, open, h2]);
    expect(sorted.map((i) => i.key)).toEqual(['open', 'h2', 'h1']);
    // handled cards never count in the "+ n autres" line
    expect(queueOverflow({ items: [h1, open, h2], total: 1, counts: { stock: 1 } } as unknown as HomeView['queue'], sorted)).toEqual([]);
  });
});

describe('agentCta — button of the agent row of a page card', () => {
  it('none → link one, draft → finish, paused → resume, ready → regenerate', () => {
    expect(agentCta({ id: 'p1', agent: null })).toEqual({ labelKey: 'home.pages.agent.link', href: '/channels/p1/ai' });
    expect(agentCta({ id: 'p1', agent: { id: 'a1', name: 'x', status: 'draft' } })).toEqual({ labelKey: 'gaps.home.agent.finish', href: '/agents/a1' });
    expect(agentCta({ id: 'p1', agent: { id: 'a1', name: 'x', status: 'paused' } })).toEqual({ labelKey: 'gaps.home.agent.resume', href: '/agents/a1' });
    expect(agentCta({ id: 'p1', agent: { id: 'a1', name: 'x', status: 'active' } })).toEqual({ labelKey: 'home.pages.agent.regenerate', href: '/agents/generate?channel=p1' });
  });
});
