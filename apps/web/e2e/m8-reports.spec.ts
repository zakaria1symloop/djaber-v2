// M8 — /reports + /reports/[key] (Figma "ANA-03 — Reports — hub (23 reports) + export jobs", "ANA-04 — Report — template
// (Ventes par produit) + large export banner"), AT-RPT-01: 23 reports / 9 in simple mode, favourites (`PATCH /me/prefs`),
// search [FE], Operator 403, template KPIs / chart / table / totals / sort / row link, CSV immediate · XLSX job listed in
// "Exports récents" · PDF, monthly e-mail schedule, every report renders, unknown key 404, range refused by the API.
// Real API + worker; the > 5 000 rows banner, a running / failed job and the plan without `scheduled_reports` are
// intercepted (marked `// mock:` with the reason).
import { expect, test } from '@playwright/test';
import { REPORT_KEYS } from '@djaber/shared';
import { expectNoA11yViolations } from './support/a11y';
import { API, apiReady, authHeaders, type Account } from './support/m1';
import { setStockMode } from './support/m2';
import { inviteOperator } from './support/m3-inbox';
import { sidebar, signIn, toastOf } from './support/m4-agents';
import { open } from './support/m5-orders';
import { gdsOwner, product, sale, type SeedProduct } from './support/m7';
import { algiersDay, apiGet, digits, reportsReady, waitJob } from './support/m8';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let oud: SeedProduct;

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await gdsOwner(request, 'm8rep');
  test.skip(!(await reportsReady(request, owner)), 'reports (M8) not served');
  oud = await product(request, owner, { name: 'Parfum Oud 100 ml', price: 4500, cost: 2400, stock: 30 });
  const robe = await product(request, owner, { name: 'La Robe satin', price: 4900, cost: 3200, stock: 30 });
  await sale(request, owner, { lines: [{ productId: oud.id, quantity: 2 }], amountPaid: 9000 });
  await sale(request, owner, { lines: [{ productId: robe.id, quantity: 1 }], amountPaid: 4900 });
});

const hubRows = (page: import('@playwright/test').Page) => page.getByTestId('reports-groups').locator('[data-group]:not([data-group="favorites"]) [data-report]');

test('AT-RPT-01 — hub: 23 reports in 5 groups, search and [FE], favourites saved in the user prefs; axe', async ({ page, request }) => {
  await signIn(page, owner);
  await open(page, '/fr/reports', () => page.getByTestId('reports-groups'));
  await expect(hubRows(page)).toHaveCount(23);
  await expect(page.getByTestId('reports-groups').locator('[data-group]')).toHaveCount(5);
  await expect(page.getByRole('heading', { name: 'Rapports' })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('searchbox').fill('caisse');
  await expect(page).toHaveURL(/q=caisse/);
  await expect(page.locator('[data-report="cash_register"]')).toBeVisible();
  await expect(page.locator('[data-report="sales_by_product"]')).toHaveCount(0);
  await page.getByRole('searchbox').fill('zzzz introuvable');
  await expect(page.getByText('Aucun rapport ne correspond à « zzzz introuvable ».')).toBeVisible();
  await page.getByRole('button', { name: 'Effacer les filtres' }).click();
  await expect(hubRows(page)).toHaveCount(23);

  await page.locator('[data-group="sales"] [data-report="sales_by_product"]').getByTestId('report-favorite').click();
  await expect(page.locator('[data-group="favorites"] [data-report="sales_by_product"]')).toBeVisible();
  await expect(async () => {
    const me = await apiGet<{ prefs: { reportFavorites?: string[] } }>(request, owner, '/me');
    expect(me.prefs.reportFavorites).toContain('sales_by_product');
  }).toPass({ timeout: 15_000 });
  await page.reload();
  await expect(page.locator('[data-group="favorites"] [data-report="sales_by_product"]')).toBeVisible();
});

test('AT-RPT-01 — simple stock mode lists the 9 simple reports (and keeps Rapports in the sidebar)', async ({ page, request }) => {
  await setStockMode(request, owner, 'simple');
  try {
    await signIn(page, owner);
    await open(page, '/fr/reports', () => page.getByTestId('reports-groups'));
    await expect(hubRows(page)).toHaveCount(9);
    await expect(page.getByTestId('reports-simple-note')).toContainText('9 rapports');
    await expect(page.locator('[data-report="cash_register"]')).toHaveCount(0);
    await expect(sidebar(page).getByRole('link', { name: 'Rapports', exact: true })).toBeVisible();
  } finally {
    await setStockMode(request, owner, 'advanced');
  }
});

test('AT-RPT-01 — an Operator gets the 403 page, no sidebar item, analytics without "Rapports détaillés"', async ({ page, request }) => {
  const op = await inviteOperator(request, owner, 'Omar');
  const r = await request.get(`${API}/reports`, { headers: authHeaders(op) });
  expect(r.status()).toBe(403);
  await signIn(page, op);
  await expect(sidebar(page).getByRole('link', { name: 'Rapports', exact: true })).toHaveCount(0);
  await open(page, '/fr/reports', () => page.getByText('403'));
  await open(page, '/fr/analytics', () => page.getByTestId('analytics-tabs'));
  await expect(page.getByTestId('analytics-reports')).toHaveCount(0);
});

test('ANA-04 — template: KPIs with the comparison, chart, table with TOTAL, sort in the URL, row → product', async ({ page }) => {
  await signIn(page, owner);
  await open(page, '/fr/reports/sales_by_product', () => page.getByTestId('report-table'));
  await expect(page.getByRole('heading', { name: 'Ventes par produit' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: "Fil d'Ariane" })).toContainText('Ventes & revenus');
  await expect(page.getByTestId('report-kpis').locator('[data-kpi="revenue"]')).toContainText(digits(13900));
  await expect(page.getByTestId('report-chart')).toBeVisible();
  await expect(page.getByTestId('report-totals')).toContainText(digits(13900));
  await expect(page.getByTestId('report-table')).toContainText('Parfum Oud 100 ml');
  // advanced mode: cost and margin columns are shown
  await expect(page.getByTestId('report-table').locator('th', { hasText: 'Marge (DA)' })).toBeVisible();
  await page.getByRole('button', { name: /Quantité/ }).click();
  await expect(page).toHaveURL(/sort=/);
  await page.getByTestId('report-table').locator('tr', { hasText: 'Parfum Oud 100 ml' }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/products/${oud.id}`));
  await expectNoA11yViolations(page);
});

test('AT-RPT-01 — CSV ≤ 5 000 rows is immediate, XLSX is a job listed in Exports récents (PRÊT · Télécharger), PDF immediate', async ({ page, request }) => {
  await signIn(page, owner);
  await open(page, '/fr/reports/sales_by_product', () => page.getByTestId('report-table'));
  await page.getByTestId('report-export').click();
  await page.locator('[data-export="csv"]').click();
  await expect(toastOf(page, /CSV prêt/)).toBeVisible({ timeout: 30_000 });

  const started = page.waitForResponse((r) => /\/reports\/sales_by_product\?.*format=xlsx/.test(r.url()) && r.status() === 202);
  await page.getByTestId('report-export').click();
  await page.locator('[data-export="xlsx"]').click();
  const jobId = ((await (await started).json()) as { data: { jobId: string } }).data.jobId;
  await expect(page.getByTestId('export-running').or(toastOf(page, /Export terminé|Export XLSX lancé/))).toBeVisible({ timeout: 30_000 });
  const job = await waitJob(request, owner, jobId);
  expect(job.status).toBe('done');

  await page.getByTestId('report-export').click();
  await page.locator('[data-export="pdf"]').click();
  await expect(toastOf(page, /PDF prêt/)).toBeVisible({ timeout: 30_000 });

  await open(page, '/fr/reports', () => page.getByTestId('export-jobs').locator(`[data-job="${jobId}"]`));
  const row = page.getByTestId('export-jobs').locator(`[data-job="${jobId}"]`);
  await expect(row).toContainText(/Ventes par produit · .* · XLSX/);
  await expect(row.getByTestId('job-pill')).toContainText(/PRÊT · expire dans [67] j/);
  await expect(row.getByTestId('job-download')).toBeVisible();
});

test('AT-RPT-01 — > 5 000 rows banner; a running export is cancelled (JOB_NOT_CANCELLABLE when it just ended); a failed one is retried', async ({ page }) => {
  await signIn(page, owner);
  // mock: seeding more than 5 000 report rows through the API is too slow for an e2e run — the JSON answer says 12 480 rows
  await page.route(/\/api\/v1\/reports\/sales_by_product\?(?!.*format=(csv|xlsx|pdf))/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { data: { totalRows: number; csvMode: string }; meta: { total: number } };
    body.data.totalRows = 12480;
    body.data.csvMode = 'job';
    body.meta.total = 12480;
    await route.fulfill({ response: res, json: body });
  });
  await open(page, '/fr/reports/sales_by_product', () => page.getByTestId('large-export-banner'));
  await expect(page.getByTestId('large-export-banner')).toContainText('12 480 lignes');
  await page.unroute(/\/api\/v1\/reports\/sales_by_product/);

  // mock: a job cannot be held "running" or made to fail on demand with the fake drivers — the jobs list is answered here
  const now = new Date().toISOString();
  const base = { kind: 'export', total: 12480, resultUrl: null, error: null, createdAt: now, updatedAt: now, expiresAt: null };
  const jobs = [
    { ...base, id: '00000000-0000-4000-8000-0000000000a1', status: 'running', progress: 64, result: { kind: 'report', reportKey: 'inventory_variances', from: '2026-09-01', to: '2026-10-05', format: 'xlsx', rows: 12480 } },
    { ...base, id: '00000000-0000-4000-8000-0000000000a2', status: 'failed', progress: 10, result: { kind: 'report', reportKey: 'cash_register', from: '2026-09-05', to: '2026-10-05', format: 'csv' }, error: { code: 'REPORT_EXPORT_FAILED', message: 'Export échoué', ref: 'req_x' } },
  ];
  await page.route(/\/api\/v1\/jobs\?/, (route) => route.fulfill({ json: { data: jobs, meta: { page: 1, pageSize: 10, total: 2 } } }));
  await page.route(/\/api\/v1\/jobs\/[^/]+\/cancel/, (route) => route.fulfill({ status: 409, json: { error: { code: 'JOB_NOT_CANCELLABLE', message: 'Tâche déjà terminée ou non annulable.', ref: 'req_c' } } }));
  let retried = false;
  await page.route(/\/api\/v1\/jobs\/[^/]+\/retry/, (route) => {
    retried = true;
    return route.fulfill({ status: 202, json: { data: { jobId: '00000000-0000-4000-8000-0000000000a3' } } });
  });
  await open(page, '/fr/reports', () => page.getByTestId('export-jobs').locator('[data-state="running"]'));
  await expect(page.locator('[data-state="running"] [data-testid="job-pill"]')).toContainText('EN COURS · 64 %');
  await expect(page.locator('[data-state="failed"] [data-testid="job-pill"]')).toContainText('ÉCHEC · REPORT_EXPORT_FAILED');
  await page.getByTestId('job-cancel').click();
  await expect(toastOf(page, 'JOB_NOT_CANCELLABLE')).toBeVisible();
  await page.getByTestId('job-retry').click();
  await expect(toastOf(page, 'Export relancé')).toBeVisible();
  expect(retried).toBe(true);
});

test('AT-RPT-01 — monthly e-mail: schedule, listed, stop', async ({ page, request }) => {
  await signIn(page, owner);
  await open(page, '/fr/reports/sales_by_period', () => page.getByTestId('report-schedule'));
  await page.getByTestId('report-schedule').click();
  const dlg = page.getByTestId('schedule-dialog');
  await expect(dlg.getByLabel('E-MAIL')).toHaveValue(owner.email);
  await dlg.getByLabel('E-MAIL').fill('compta@example.com');
  await dlg.getByLabel('JOUR DU MOIS').selectOption('5');
  await page.getByTestId('schedule-submit').click();
  await expect(toastOf(page, 'Envoi mensuel planifié le 5 à compta@example.com')).toBeVisible();
  const schedules = await apiGet<{ email: string; dayOfMonth: number; reportKey: string }[]>(request, owner, '/reports/schedules');
  expect(schedules.some((s) => s.email === 'compta@example.com' && s.dayOfMonth === 5 && s.reportKey === 'sales_by_period')).toBe(true);
  await page.getByTestId('report-schedule').click();
  await expect(page.locator('[data-schedule="compta@example.com"]')).toContainText('chaque mois le 5');
  await page.locator('[data-schedule="compta@example.com"]').getByTestId('schedule-stop').click();
  await expect(toastOf(page, 'compta@example.com ne recevra plus ce rapport')).toBeVisible();
  await page.keyboard.press('Escape');

  // without `scheduled_reports` (Starter / free plan): real plan since M9, see m9-carryovers.spec.ts
});

test('GDS-10 — every one of the 23 reports renders its data or its empty state ([S] → data / [E])', async ({ page }) => {
  await signIn(page, owner);
  for (const key of REPORT_KEYS) {
    await page.goto(`/fr/reports/${key}`);
    await expect(page.getByTestId('report-table').or(page.getByText('Aucune donnée sur la période')).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Impossible de charger')).toHaveCount(0);
  }
});

test('ANA-04 — unknown report key ⇒ 404; a range refused by the API keeps the page with the code', async ({ page }) => {
  await signIn(page, owner);
  await page.goto('/fr/reports/not_a_report');
  await expect(page.getByText(/introuvable|404/i).first()).toBeVisible({ timeout: 30_000 });
  await page.goto(`/fr/reports/sales_by_period?period=custom&from=2020-01-01&to=${algiersDay(0)}`);
  await expect(page.getByText(errText('REPORT_RANGE_TOO_LONG'))).toBeVisible({ timeout: 30_000 });
});
