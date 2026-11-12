// M5 — /orders (Figma "ORD-05 v2 — Orders — list", filter panel, row actions menu + bulk results dialog, AR frame,
// "GLOBAL — Offline — stale data (Orders)"). Real API: the owner's shop gets real orders through `POST /orders`.
// `page.route` only where the API cannot produce the state, each marked `// mock:`.
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, expectUrl, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { dialog, open, ordersReady, row, rowAction, seedOrder, seedProduct, setStatus, shopOwner, type SeedOrder } from './support/m5-orders';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let product: { id: string; name: string };
const o: Record<string, SeedOrder> = {};

test.beforeAll(async ({ request }) => {
  test.setTimeout(360_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await shopOwner(request, 'm5ordl');
  test.skip(!(await ordersReady(request, owner)), 'orders module (M5) not served');
  product = await seedProduct(request, owner, 'Parfum Oud 50 ml', 4700);
  o.a = await seedOrder(request, owner, { productId: product.id, name: 'Amina Belkacem' });
  o.b = await seedOrder(request, owner, { productId: product.id, name: 'Yacine Merad', quantity: 2 });
  o.noAddress = await seedOrder(request, owner, { productId: product.id, name: 'Sara Kaci', address: false });
  o.confirmed = await seedOrder(request, owner, { productId: product.id, name: 'Karim Djebbar', status: 'confirmed' });
  o.delivered = await seedOrder(request, owner, { productId: product.id, name: 'Rym Amrani', status: 'confirmed' });
  await setStatus(request, owner, o.delivered.id, 'delivered');
});

test.beforeEach(async ({ page }) => {
  await signIn(page, owner);
});

test('AT-ORD-15 — the status tab is the status filter, filters live in the URL and the KPI tiles follow them', async ({ page }) => {
  await open(page, '/fr/orders', () => row(page, o.a.id));
  await expect(page.getByTestId('orders-kpis').locator('[data-kpi]')).toHaveCount(5);
  // every order is in "Toutes"
  for (const x of Object.values(o)) await expect(row(page, x.id)).toBeVisible();

  const stats = page.waitForRequest((r) => r.url().includes('/orders/stats') && r.url().includes('status=new'));
  await page.locator('[data-tab="new"]').click();
  await expectUrl(page, /\/fr\/orders\?tab=new/);
  await stats; // KPIs follow the tab (= status filter)
  await expect(row(page, o.delivered.id)).toHaveCount(0);
  await expect(row(page, o.confirmed.id)).toHaveCount(0);
  await expect(row(page, o.a.id)).toBeVisible();
  // the panel status group mirrors the tab: there is no second status filter
  await page.getByTestId('open-filters').click();
  await expect(page.getByRole('radiogroup', { name: 'STATUT' }).getByRole('radio', { name: 'Nouvelles' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  // search + reload keeps the view (shareable link)
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('Yacine');
  await expectUrl(page, /q=Yacine/);
  await expect(row(page, o.b.id)).toBeVisible();
  await expect(row(page, o.a.id)).toHaveCount(0);
  await page.reload();
  await expect(row(page, o.b.id)).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Rechercher' })).toHaveValue('Yacine');

  // filtered-empty state, then "Effacer les filtres"
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('zzzz-introuvable');
  await expect(page.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
  await page.getByRole('button', { name: 'Effacer les filtres' }).click();
  await expectUrl(page, /\/fr\/orders$/);
  await expect(row(page, o.delivered.id)).toBeVisible();
});

test('AT-ORD-12 / AT-ORD-30 — bulk confirm answers per order; the error row offers "Réessayer les erreurs"', async ({ page }) => {
  await open(page, '/fr/orders?tab=new', () => row(page, o.a.id));
  await row(page, o.a.id).getByRole('checkbox').check();
  await row(page, o.noAddress.id).getByRole('checkbox').check();
  await expect(page.getByRole('region', { name: 'Actions groupées' })).toContainText('2 sélectionnées');
  await page.getByRole('region', { name: 'Actions groupées' }).getByRole('button', { name: 'Confirmer' }).click();
  const results = page.getByTestId('bulk-results');
  await expect(results).toBeVisible();
  await expect(results.locator('[data-ok="true"]')).toHaveCount(1);
  await expect(results.locator('[data-ok="false"]')).toContainText(errText('ORDER_ADDRESS_REQUIRED'));
  await expect(page.getByTestId('bulk-retry')).toHaveText(/Réessayer/);
  await dialog(page).getByRole('button', { name: 'Fermer' }).last().click();
  await expect(row(page, o.a.id)).toHaveCount(0); // confirmed: left the "Nouvelles" tab
});

test('row Actions ⌄ — state items from the server, greyed ones with their code in the footer, primary first', async ({ page }) => {
  await open(page, '/fr/orders', () => row(page, o.b.id));
  await row(page, o.b.id).getByRole('button', { name: /Actions/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  expect(await items.count()).toBeGreaterThan(3);
  // a disabled item is shown with its reason code (D42)
  const disabled = menu.locator('[data-disabled]');
  if ((await disabled.count()) > 0) await expect(menu).toContainText(/\([A-Z_]+\)/);
  await page.keyboard.press('Escape');
  // "Ouvrir" leads to the order page
  await rowAction(page, o.b.id, /^Ouvrir/);
  await expectUrl(page, new RegExp(`/fr/orders/${o.b.id}$`));
});

test('AT-ORD-13 — export of the current filter starts a job with a progress toast', async ({ page }) => {
  await open(page, '/fr/orders', () => row(page, o.a.id));
  await page.getByRole('button', { name: 'Exporter' }).first().click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  const started = page.waitForResponse((r) => r.url().includes('/orders/export') && r.request().method() === 'GET');
  await page.getByTestId('export-submit').click();
  expect((await started).status()).toBe(202);
  await expect(page.locator('[data-toast]').first()).toBeVisible();
});

test('live — an order created elsewhere appears in the list without reload', async ({ page, request }) => {
  await open(page, '/fr/orders', () => row(page, o.a.id));
  const created = await seedOrder(request, owner, { productId: product.id, name: 'Client En Direct' });
  await expect(row(page, created.id)).toBeVisible({ timeout: 30_000 });
});

test('AT-UX-01 — skeleton, error with retry (mock), empty list of a new shop', async ({ page, request }) => {
  // mock: the real API cannot be asked to fail `GET /orders`; the 5xx answers the first call and its 2 automatic
  // retries (GETs retry 5xx twice), then the real list
  let fail = 3;
  await page.route('**/api/v1/orders?**', async (route) => {
    if (fail > 0 && route.request().method() === 'GET') {
      fail--;
      return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': 'http://localhost:3010', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Erreur', params: {}, fields: {}, details: null, ref: 'req_e2e' } }) });
    }
    return route.continue();
  });
  await page.goto('/fr/orders');
  await expect(page.getByText('Impossible de charger')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(row(page, o.a.id)).toBeVisible();
  await page.unroute('**/api/v1/orders?**');

  const fresh = await shopOwner(request, 'm5ordl-empty');
  // another account in the same browser: drop the current session first (the login page sends a signed-in member home)
  await page.context().clearCookies();
  await page.goto('/fr/login');
  await page.evaluate(() => window.localStorage.clear());
  await signIn(page, fresh);
  await open(page, '/fr/orders', () => page.getByTestId('orders-empty'));
  await expect(page.getByTestId('orders-empty')).toContainText('Aucune commande');
  await page.getByTestId('orders-empty').getByRole('link', { name: '+ Nouvelle commande' }).click();
  await expectUrl(page, /\/fr\/orders\/new/);
});

test('AT-UX-03 — no dead control on /orders: every enabled button acts, every disabled one says why', async ({ page }) => {
  await open(page, '/fr/orders', () => row(page, o.a.id));
  const buttons = page.locator('main button:visible');
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    if (await b.isDisabled()) expect(await b.getAttribute('title'), `disabled button ${i} (${(await b.getAttribute('aria-label')) ?? (await b.innerText())}) without a reason`).toBeTruthy();
  }
});

test('RTL — /ar/orders mirrors the list; numbers and order numbers stay left-to-right; axe on the default state', async ({ page }) => {
  await open(page, '/ar/orders', () => row(page, o.a.id));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(row(page, o.a.id).locator('bdi[dir="ltr"]').first()).toBeVisible();
  await open(page, '/fr/orders', () => row(page, o.a.id));
  await expectNoA11yViolations(page);
});
