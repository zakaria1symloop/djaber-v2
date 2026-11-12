// Helpers of the M5 home / notification preferences / carry-over specs. Real API first (`GET /dashboard/home`,
// `GET|PUT /notification-preferences`, `PATCH /me/prefs`, clients and orders of M5); contract-shaped `HomeView`
// fixtures only for the states the fake drivers cannot produce (failed parcels need couriers — M6 —, server errors).
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page, Route } from '@playwright/test';
import { API, authHeaders, type Account } from './m1';

type Json = Record<string, unknown>;
const CORS = { 'access-control-allow-origin': 'http://localhost:3010', 'access-control-allow-credentials': 'true' };

async function ok(request: APIRequestContext, a: Account, path: string): Promise<boolean> {
  try {
    return (await request.get(`${API}${path}`, { headers: authHeaders(a), timeout: 5000 })).ok();
  } catch {
    return false;
  }
}
export const dashboardReady = (request: APIRequestContext, a: Account) => ok(request, a, '/dashboard/home');
export const preferencesReady = (request: APIRequestContext, a: Account) => ok(request, a, '/notification-preferences');
export const ordersReady = (request: APIRequestContext, a: Account) => ok(request, a, '/orders/stats');
export const clientsReady = (request: APIRequestContext, a: Account) => ok(request, a, '/clients?pageSize=25');

async function call<T>(request: APIRequestContext, a: Account, method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, data?: Json, headers: Record<string, string> = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, { method, headers: { ...authHeaders(a), ...headers }, data });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  const body = (await res.json().catch(() => null)) as { data: T } | null;
  return body?.data as T;
}
export const get = <T>(request: APIRequestContext, a: Account, path: string) => call<T>(request, a, 'GET', path);
export const post = <T>(request: APIRequestContext, a: Account, path: string, data: Json = {}, headers: Record<string, string> = {}) => call<T>(request, a, 'POST', path, data, headers);
export const put = <T>(request: APIRequestContext, a: Account, path: string, data: Json = {}) => call<T>(request, a, 'PUT', path, data);
export const patch = <T>(request: APIRequestContext, a: Account, path: string, data: Json = {}) => call<T>(request, a, 'PATCH', path, data);

/* ---------- read models (subset of `HomeView`, `NotificationPreferenceView`) ---------- */
export type HomeKpis = {
  channels: { active: number; total: number; needsReconnect: number };
  products: { total: number; lowStock: number; outOfStock: number };
  revenue30d: { value: number };
  orders30d: { value: number };
  stockValue: { retail: number; cost: number | null };
};
export type RealHome = { queue: { items: { key: string; kind: string; title: string; path: string }[]; total: number }; kpis: HomeKpis; pages: { id: string; name: string; status: string }[]; getStarted: { done: number } };
export type RealPreference = { type: string; group: string; inApp: boolean; email: boolean; push: boolean; sound: boolean; emailMode: string; pushMode: string };

export const getHome = (request: APIRequestContext, a: Account) => get<RealHome>(request, a, '/dashboard/home');
export const getPreferences = (request: APIRequestContext, a: Account) => get<RealPreference[]>(request, a, '/notification-preferences');
export const getMe = (request: APIRequestContext, a: Account) => get<{ prefs: { soundOnMessage: boolean } }>(request, a, '/me');

/** A client with a name and a phone (not a placeholder) and one manual order for it (`POST /orders`, Idempotency-Key). */
export async function clientWithOrder(request: APIRequestContext, a: Account, o: { name: string; phone: string; productId: string }): Promise<{ clientId: string; orderId: string; number: string }> {
  const order = await post<{ id: string; number: string; client: { id: string } }>(
    request,
    a,
    '/orders',
    { client: { name: o.name, phone: o.phone }, items: [{ productId: o.productId, quantity: 1 }], paymentMethod: 'cash', status: 'new' },
    { 'Idempotency-Key': randomUUID() },
  );
  return { clientId: order.client.id, orderId: order.id, number: order.number };
}

/* ---------- `HomeView` fixtures (mock: failed parcels / reconnect cards need M6 couriers or a revoked Meta token) ---------- */
const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
export const QUEUE_KINDS = ['parcel', 'stock', 'page', 'insight', 'conversation', 'callback', 'task'] as const;
export const fixtureHome = (over: Json = {}): Json => ({
  greeting: { firstName: 'Amel', workspaceName: 'Boutique Amel', partOfDay: 'evening' },
  queue: {
    items: [
      { key: 'parcel:1', kind: 'parcel', urgency: 0, title: 'Échec de livraison · #CMD-1037 · Lina S.', subtitle: 'Client absent (2/3)', since: at(60), path: '/orders/00000000-0000-7000-8000-000000001037', ref: {} },
      { key: 'page:1', kind: 'page', urgency: 0, title: 'Reconnexion requise · Amel Outlet (FB)', subtitle: 'Jeton expiré', since: at(120), path: '/channels/33333333-3333-7333-8333-333333333333', ref: {} },
      { key: 'conversation:1', kind: 'conversation', urgency: 0, title: 'Amina B.', subtitle: 'راني حابة نبدل القياس', since: at(2), path: '/inbox/00000000-0000-7000-8000-00000000c001', ref: {} },
      { key: 'stock:1', kind: 'stock', urgency: 1, title: 'Stock faible · Parfum Oud 50 ml', subtitle: '4 restants (seuil 5)', since: at(180), path: '/products?lowStock=1', ref: {} },
      { key: 'insight:1', kind: 'insight', urgency: 1, title: 'Sujet inconnu ×12 · Vendeur Pro', subtitle: '« vous avez des iPhone ? »', since: at(30), path: '/agents/aaaaaaaa-0000-7000-8000-000000000001/insights', ref: {} },
      { key: 'callback:1', kind: 'callback', urgency: 1, title: 'Rappeler à 16:00 · #CMD-1041 · Yacine M.', subtitle: 'sans réponse 2/3', since: at(5), path: '/orders/00000000-0000-7000-8000-000000001041', ref: {} },
      { key: 'task:1', kind: 'task', urgency: 2, title: 'Import terminé · 118 produits', subtitle: '12 erreurs', since: at(3000), path: '/products/import', ref: {} },
    ],
    total: 9,
    counts: { parcel: 2, stock: 2, page: 1, insight: 1, conversation: 1, callback: 1, task: 1 },
  },
  kpis: {
    channels: { active: 2, total: 3, needsReconnect: 1 },
    products: { total: 128, lowStock: 2, outOfStock: 0 },
    revenue30d: { value: 1_184_000, previous: null, deltaPct: null },
    revenueSources30d: { deliveredOrders: 90, sales: 6 },
    aiRevenue30d: { value: 700_000, previous: null, deltaPct: null },
    pipeline: 0,
    cashCollected30d: 0,
    orders30d: { value: 96, previous: null, deltaPct: null },
    aiOrders30d: 70,
    ordersToConfirm: 12,
    stockValue: { retail: 1_240_000, cost: null },
    conversations30d: 300,
  },
  quickActions: [
    { key: 'connect_page', enabled: true },
    { key: 'add_product', enabled: true },
    { key: 'create_agent', enabled: false, reasonCode: 'PLAN_LIMIT' },
  ],
  pages: [
    { id: '11111111-1111-7111-8111-111111111111', platform: 'facebook', name: 'Boutique Amel', avatarUrl: null, status: 'active', pausedReason: null, agent: { id: 'aaaaaaaa-0000-7000-8000-000000000001', name: 'Vendeur Pro', status: 'active' }, needsHuman: 3, unread: 3, aiOrders30d: 12, connectedAt: '2026-08-12T10:00:00.000Z', conversations: { total: 128, active: 32 }, messages7d: { total: 340, inbound: 210 } },
    { id: '22222222-2222-7222-8222-222222222222', platform: 'instagram', name: '@amel.store', avatarUrl: null, status: 'pending_review', pausedReason: null, agent: null, needsHuman: 0, unread: 0, aiOrders30d: 0, connectedAt: '2026-08-12T10:00:00.000Z', conversations: { total: 128, active: 32 }, messages7d: { total: 340, inbound: 210 } },
    { id: '33333333-3333-7333-8333-333333333333', platform: 'facebook', name: 'Amel Outlet', avatarUrl: null, status: 'needs_reconnect', pausedReason: null, agent: null, needsHuman: 0, unread: 1, aiOrders30d: 0, connectedAt: '2026-08-12T10:00:00.000Z', conversations: { total: 128, active: 32 }, messages7d: { total: 340, inbound: 210 } },
    { id: '44444444-4444-7444-8444-444444444444', platform: 'facebook', name: 'Amel Cosmétiques', avatarUrl: null, status: 'paused', pausedReason: 'plan', agent: { id: 'a2', name: 'Service Client', status: 'paused' }, needsHuman: 0, unread: 0, aiOrders30d: 0, connectedAt: '2026-08-12T10:00:00.000Z', conversations: { total: 128, active: 32 }, messages7d: { total: 340, inbound: 210 } },
  ],
  getStarted: { step: 99, checklist: { channel: true, product: true, agent: true, order: false }, done: 3, total: 4 },
  credits: { total: 5000, planUsed: 3760, planLimit: 5000, unlimited: false, exhausted: false, usedPct: 75 },
  banners: [],
  generatedAt: new Date().toISOString(),
  ...over,
});

/** Serves `GET /dashboard/home` from a fixture (or an error / a delay) — everything else stays on the real API. */
export async function mockHome(page: Page, answer: Json | { status: number; code: string; message: string } | (() => Json), o: { delayMs?: number } = {}) {
  await page.route(/\/api\/v1\/dashboard\/home(\?|$)/, async (route: Route) => {
    if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
    const a = typeof answer === 'function' ? answer() : answer;
    if ('status' in a && typeof a.status === 'number' && 'code' in a) {
      return route.fulfill({ status: a.status, contentType: 'application/json', headers: CORS, body: JSON.stringify({ error: { code: a.code, message: a.message, params: {}, fields: {}, details: null, ref: 'req_e2e' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data: a, meta: {} }) });
  });
}
