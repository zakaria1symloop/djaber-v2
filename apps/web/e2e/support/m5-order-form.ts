// Helpers of the M5 new order form specs: seeds through the real API (fake adapters only, nothing leaves the machine).
import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { API, authHeaders, type Account } from './m1';

type Json = Record<string, unknown>;
const call = async <T>(request: APIRequestContext, a: Account, method: 'post' | 'put' | 'get', path: string, data?: Json, headers: Record<string, string> = {}): Promise<T> => {
  const res = await request[method](`${API}${path}`, {
    headers: { ...authHeaders(a), ...headers },
    ...(data ? { data } : {}),
  });
  expect(res.status(), `${method.toUpperCase()} ${path}: ${await res.text()}`).toBeLessThan(300);
  return ((await res.json()) as { data: T }).data;
};

/** True when the M5 orders + fee quote endpoints answer (the specs skip themselves otherwise, with the reason). */
export async function ordersReady(request: APIRequestContext, a: Account): Promise<boolean> {
  try {
    const [orders, quote] = await Promise.all([
      request.get(`${API}/orders?pageSize=25`, { headers: authHeaders(a), timeout: 5000 }),
      request.get(`${API}/delivery/fees/quote?wilayaId=16&stopdesk=false&subtotal=1000`, {
        headers: authHeaders(a),
        timeout: 5000,
      }),
    ]);
    return orders.ok() && quote.ok();
  } catch {
    return false;
  }
}

/** A unique valid DZ mobile per call. */
let seq = 0;
export const uniqueMobile = () => `05${String((Date.now() + seq++ * 7919) % 100_000_000).padStart(8, '0')}`;
export const formatMobile = (p: string) => `${p.slice(0, 4)} ${p.slice(4, 6)} ${p.slice(6, 8)} ${p.slice(8, 10)}`;

/** Fee grid: wilaya 16 home 400 / stop-desk 250 / free from 5 000 DA, wilaya 33 not served (AT-ORD-09). */
export async function seedFeeGrid(request: APIRequestContext, a: Account) {
  await call(request, a, 'post', '/delivery/fees/seed', { overwrite: false });
  await call(request, a, 'put', '/delivery/fees/16', {
    homePrice: 400,
    stopdeskPrice: 250,
    returnPrice: 200,
    freeAbove: 5000,
    isActive: true,
  });
  await call(request, a, 'put', '/delivery/fees/33', {
    homePrice: 1500,
    stopdeskPrice: 1000,
    returnPrice: 700,
    isActive: false,
  });
}

export const firstCommune = async (request: APIRequestContext, a: Account, wilayaId: number) =>
  (await call<{ id: number; nameFr: string }[]>(request, a, 'get', `/geo/wilayas/${wilayaId}/communes`))[0]!;

export const seedClient = (request: APIRequestContext, a: Account, data: Json) => call<{ id: string; name: string; phone: string }>(request, a, 'post', '/clients', data);
export const markRisky = (request: APIRequestContext, a: Account, id: string) => call<Json>(request, a, 'post', `/clients/${id}/risk`, { riskLevel: 'high' });
export const getOrder = (request: APIRequestContext, a: Account, id: string) =>
  call<{
    id: string;
    number: string;
    status: string;
    deliveryFee: number;
    total: number;
    client: { id: string };
  }>(request, a, 'get', `/orders/${id}`);
export const createOrder = (request: APIRequestContext, a: Account, data: Json) =>
  call<{ id: string; number: string }>(request, a, 'post', '/orders', data, {
    'Idempotency-Key': randomUUID(),
  });

/** Opens a wilaya / commune combobox of the form and picks the option whose label contains `text`. */
export async function pickCombo(page: Page, id: string, text: string) {
  await page.locator(`#${id}`).click();
  const list = page.getByRole('listbox');
  await list
    .getByRole('option', { name: new RegExp(text) })
    .first()
    .click();
  await expect(list).toBeHidden();
}

/** Adds a product line through the product search of the form. */
export async function addProduct(page: Page, name: string) {
  await page.locator('#product-search').fill(name);
  await page
    .getByTestId('product-results')
    .getByRole('option', { name: new RegExp(name) })
    .first()
    .click();
  await expect(page.getByTestId('order-lines')).toContainText(name);
}
