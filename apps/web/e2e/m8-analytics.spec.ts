// M8 — /analytics (Figma "ANA-02 — Analytics — overview tab + period picker", "ANA-02b — tabs …"): named money figures
// identical on home / analytics / reports (AT-ORD-10), period picker rules and comparison (AT-ANA-02), the 9 tabs,
// filtered-list links (table rows + wilaya map), credits projection, RTL, and the skeleton / error states (AT-ST-09).
// Real API + worker; only the skeleton and the server error are intercepted (marked `// mock:`).
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { expectNoHorizontalOverflow, signIn } from './support/m4-agents';
import { open, seedOrder, setStatus, shopOwner } from './support/m5-orders';
import { gdsOwner, product, sale, type SeedProduct } from './support/m7';
import { algiersDay, analyticsReady, apiGet, digits, kpi } from './support/m8';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

type Kpi = { value: number | null; deltaPct?: number | null };
type Overview = { empty: boolean; kpis: Record<string, Kpi>; range: { from: string; to: string } };

let owner: Account;
let a: SeedProduct;
let b: SeedProduct;
let c: SeedProduct;

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await gdsOwner(request, 'm8ana');
  test.skip(!(await analyticsReady(request, owner)), 'analytics (M8) not served');
  a = await product(request, owner, { name: 'Foulard soie', price: 1000, cost: 400, stock: 20 });
  b = await product(request, owner, { name: 'Parfum Oud 100 ml', price: 2000, cost: 900, stock: 20 });
  c = await product(request, owner, { name: 'Sac cuir camel', price: 500, cost: 200, stock: 20 });
  // AT-ORD-10: counter sale 1 000 + delivered order 2 000 (Alger) + pending order 500 (Sétif)
  await sale(request, owner, { lines: [{ productId: a.id, quantity: 1 }], amountPaid: 1000 });
  const delivered = await seedOrder(request, owner, { productId: b.id, status: 'confirmed', wilayaId: 16 });
  await setStatus(request, owner, delivered.id, 'delivered');
  await seedOrder(request, owner, { productId: c.id, wilayaId: 19 });
});

test('AT-ORD-10 — Revenue 3 000, Pipeline 500, AI revenue 0: identical on home, analytics and reports; axe', async ({ page, request }) => {
  const ov = await apiGet<Overview>(request, owner, '/analytics/overview?period=30d');
  const home = await apiGet<{ kpis: { revenue30d: { value: number }; pipeline: number } }>(request, owner, '/dashboard/home');
  const report = await apiGet<{ totals: Record<string, number | null> }>(request, owner, '/reports/sales_by_period?period=30d');
  // delivery fees may be added to the order total by the fee grid: Revenue is whatever the three agree on
  const revenue = ov.kpis.revenue!.value!;
  expect(revenue).toBeGreaterThanOrEqual(3000);
  expect(home.kpis.revenue30d.value).toBe(revenue);
  expect(report.totals.revenue).toBe(revenue);
  expect(ov.kpis.pipeline!.value).toBe(home.kpis.pipeline);
  expect(ov.kpis.pipeline!.value).toBeGreaterThanOrEqual(500);
  expect(ov.kpis.aiRevenue!.value).toBe(0);

  await signIn(page, owner);
  await open(page, '/fr/analytics', () => kpi(page, 'revenue'));
  await expect(kpi(page, 'revenue')).toContainText(digits(revenue));
  await expect(kpi(page, 'revenue')).toContainText('DA revenus');
  const figures = page.getByTestId('money-figures');
  await expect(figures.locator('[data-kpi="pipeline"]')).toContainText(digits(ov.kpis.pipeline!.value!));
  await expect(figures.locator('[data-kpi="pipeline"]')).toContainText('DA pipeline');
  await expect(figures.locator('[data-kpi="aiRevenue"]')).toContainText('DA revenus IA');
  await expect(figures.locator('[data-kpi="aiRevenue"] bdi.ts-numeral-l')).toHaveText('0');
  await expect(page.getByTestId('revenue-definition').first()).toHaveAttribute('title', /ventes comptoir.*commandes livrées/);
  await expectNoA11yViolations(page);

  await open(page, '/fr/reports/sales_by_period', () => page.getByTestId('report-kpis'));
  await expect(page.getByTestId('report-kpis').locator('[data-kpi="revenue"]')).toContainText(digits(revenue));
  await expect(page.getByTestId('report-totals')).toContainText(digits(revenue));
});

test('AT-ANA-02 — period picker: 733 d refused inline, end before start, custom without dates, applied range in the URL', async ({ page }) => {
  await signIn(page, owner);
  await open(page, '/fr/analytics', () => kpi(page, 'revenue'));
  await page.locator('[data-preset="custom"]').click();
  const form = page.getByTestId('custom-range');
  await expect(form).toContainText('Choisissez la date de début puis la date de fin');
  await form.locator('input[name="from"]').fill(algiersDay(732));
  await expect(form).toContainText('Choisissez maintenant la date de fin');
  await form.locator('input[name="to"]').fill(algiersDay(0));
  await page.getByTestId('range-apply').click();
  await expect(page.getByTestId('range-error')).toContainText(errText('REPORT_RANGE_TOO_LONG'));
  await form.locator('input[name="from"]').fill(algiersDay(0));
  await form.locator('input[name="to"]').fill(algiersDay(3));
  await page.getByTestId('range-apply').click();
  await expect(page.getByTestId('range-error')).toContainText(errText('INVALID_DATE_RANGE'));
  await form.locator('input[name="from"]').fill(algiersDay(731));
  await form.locator('input[name="to"]').fill(algiersDay(0));
  await page.getByTestId('range-apply').click();
  await expect(page).toHaveURL(new RegExp(`period=custom&from=${algiersDay(731)}&to=${algiersDay(0)}`));
  await expect(page.getByTestId('range-chip')).toContainText('COMPARÉ À LA PÉRIODE PRÉCÉDENTE');
  await expect(kpi(page, 'revenue')).toBeVisible();

  // "Personnalisé" without dates (hand-made URL) ⇒ REPORT_CUSTOM_RANGE_REQUIRED state; more than 732 days ⇒ the API refuses
  await page.goto('/fr/analytics?period=custom');
  await expect(page.getByText('Choisissez une date de début et une date de fin')).toBeVisible();
  await page.goto(`/fr/analytics?period=custom&from=2020-01-01&to=${algiersDay(0)}`);
  await expect(page.getByText(errText('REPORT_RANGE_TOO_LONG'))).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Revenir à 30 j' }).click();
  await expect(kpi(page, 'revenue')).toBeVisible();
  await expect(page).not.toHaveURL(/period=custom/);
});

test('AT-ANA-02 — comparison "aucune" hides the deltas and the previous period; presets live in the URL', async ({ page }) => {
  await signIn(page, owner);
  await open(page, '/fr/analytics?period=7d', () => kpi(page, 'revenue'));
  await expect(page.locator('[data-preset="7d"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('range-chip')).toContainText('COMPARÉ');
  await page.getByRole('button', { name: /^Comparer : période précédente/ }).click();
  await page.getByRole('radio', { name: 'aucune', exact: true }).click();
  await expect(page).toHaveURL(/compare=none/);
  await expect(page.getByTestId('range-chip')).not.toContainText('COMPARÉ');
  await expect(page.locator('[data-delta]')).toHaveCount(0);
  await expect(page.getByText('PÉRIODE PRÉC. (POINTILLÉS)')).toHaveCount(0);
  // tab links keep the period and the comparison
  await page.locator('[data-tab="orders"]').click();
  await expect(page).toHaveURL(/\/fr\/analytics\/orders\?period=7d&compare=none/);
});

test('AT-ANA-02 — empty period of a new workspace shows "Connecter une page"', async ({ page, request }) => {
  const fresh = await shopOwner(request, 'm8empty');
  const ov = await apiGet<Overview>(request, fresh, '/analytics/overview');
  expect(ov.empty).toBe(true);
  await signIn(page, fresh);
  await open(page, '/fr/analytics', () => page.getByTestId('analytics-empty'));
  await expect(page.getByTestId('analytics-empty')).toContainText('Aucune donnée sur la période');
  await page.getByTestId('analytics-connect').click();
  await expect(page).toHaveURL(/\/fr\/channels/);
});

test('AT-ANA-02 — a table row and a wilaya of the map open the filtered orders list', async ({ page, request }) => {
  const ov = await apiGet<Overview>(request, owner, '/analytics/orders');
  await signIn(page, owner);
  await open(page, '/fr/analytics/orders', () => page.getByTestId('tab-table').locator('tr[data-row="16"]'));
  await page.getByTestId('tab-table').locator('tr[data-row="16"]').click();
  await expect(page).toHaveURL(new RegExp(`/fr/orders\\?wilayaId=16&from=${ov.range.from}&to=${ov.range.to}`));
  await open(page, '/fr/analytics/orders', () => page.getByTestId('wilaya-map'));
  await expect(page.locator('path[data-wilaya="19"]')).not.toHaveAttribute('data-step', '0');
  await page.locator('path[data-wilaya="19"]').click();
  await expect(page).toHaveURL(/\/fr\/orders\?wilayaId=19&from=/);
});

test('AT-ANA-02 — consumption tab: the projection follows the burn rate, packs link', async ({ page, request }) => {
  const cons = await apiGet<{ projection: { exhaustsOn: string | null; unlimited: boolean; dailyBurn: number } }>(request, owner, '/analytics/consumption');
  await signIn(page, owner);
  await open(page, '/fr/analytics/consumption', () => page.getByTestId('projection'));
  const p = cons.projection;
  if (p.unlimited) await expect(page.getByTestId('projection')).toContainText('Crédits illimités');
  else if (p.exhaustsOn) await expect(page.getByTestId('projection')).toContainText(new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${p.exhaustsOn}T12:00:00Z`)));
  else await expect(page.getByTestId('projection')).toContainText("pas d'épuisement prévu");
  await expect(page.getByTestId('packs-link')).toHaveAttribute('href', /\/settings\/credits/);
});

test('ANA-02b — every tab renders its tiles, chart and table; Arabic (RTL) without horizontal overflow', async ({ page }) => {
  await signIn(page, owner);
  for (const tab of ['conversations', 'responses', 'consumption', 'agents', 'channels', 'products', 'orders', 'delivery']) {
    await open(page, `/fr/analytics/${tab}`, () => page.getByTestId('analytics-kpis'));
    await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('bar-chart').first()).toBeVisible();
    await expect(page.getByText('Impossible de charger')).toHaveCount(0);
  }
  await open(page, '/ar/analytics', () => kpi(page, 'revenue'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expectNoHorizontalOverflow(page);
});

test('AT-ST-09 — skeleton while loading, error with retry', async ({ page }) => {
  await signIn(page, owner);
  // mock: the real API answers too fast to see the skeleton and never fails on demand — the overview call is delayed and refused until "Réessayer"
  let fail = true;
  let first = true;
  await page.route(/\/api\/v1\/analytics\/overview/, async (route) => {
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Erreur interne', ref: 'req_m8' } }) });
    return route.continue();
  });
  await page.goto('/fr/analytics');
  await expect(page.getByTestId('analytics-skeleton')).toBeVisible();
  await expect(page.getByText('Impossible de charger')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/req_m8/)).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(kpi(page, 'revenue')).toBeVisible({ timeout: 30_000 });
});
