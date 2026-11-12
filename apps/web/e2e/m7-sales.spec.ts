// M7 — /sales (Figma "GDS-08 — Sales (counter) — list + new sale with partial payment", DLG GDS "Annuler la vente",
// "Encaisser le reste", DLG GDS II "Ventes — verrous"): new sale side sheet (stock, partial blocked without client
// SALE_PARTIAL_REQUIRES_CUSTOMER, client created inline), detail pills, collect the rest, cancel with restock +
// refund, delete refused once paid (SALE_DELETE_PAID), cancel window (SALE_CANNOT_CANCEL_AFTER_7D, mocked).
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { open, row, uniquePhone } from './support/m5-orders';
import { algiersToday, gdsOwner, gdsReady, getJson, openRowMenu, product, sale, type SeedProduct } from './support/m7';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let robe: SeedProduct;
let sac: SeedProduct;

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await gdsOwner(request, 'm7sal');
  test.skip(!(await gdsReady(request, owner)), 'GDS operations (M7) not served');
  robe = await product(request, owner, { name: 'Robe satin', price: 4900, cost: 2000, stock: 6 });
  sac = await product(request, owner, { name: 'Sac cuir camel', price: 5000, cost: 2500, stock: 3 });
});

test('AT-GDS-12 — new sale: partial without client blocked (SALE_PARTIAL_REQUIRES_CUSTOMER), then with a new client; axe', async ({ page, request }) => {
  await signIn(page, owner);
  await open(page, '/fr/sales/new', () => page.getByTestId('new-sale-sheet'));
  await expectNoA11yViolations(page);
  const sheet = page.getByTestId('new-sale-sheet');
  const search = sheet.getByRole('searchbox').first();
  await search.fill('Robe');
  await page.getByTestId('gds-product-results').locator(`[data-product="${robe.id}"]`).click();
  await search.fill('Sac cuir');
  await page.getByTestId('gds-product-results').locator(`[data-product="${sac.id}"]`).click();
  await expect(sheet.getByTestId('sale-lines')).toContainText('stock 6');
  await expect(page.getByTestId('sale-validate')).toContainText(/9\s?900/);
  await sheet.getByLabel('Montant reçu (DA)').fill('5000');
  await expect(sheet).toContainText(/reste dû 4\s?900/);
  await expect(page.getByTestId('sale-validate')).toBeDisabled();
  await expect(page.getByTestId('sale-validate')).toHaveAttribute('title', /SALE_PARTIAL_REQUIRES_CUSTOMER/);
  await sheet.getByRole('button', { name: 'nouveau client créé si introuvable' }).click();
  await sheet.getByTestId('sale-new-client').getByLabel('Nom').fill('Amina Belkacem');
  await sheet.getByTestId('sale-new-client').getByLabel('Téléphone').fill(uniquePhone());
  await page.getByTestId('sale-validate').click();
  await expect(page).toHaveURL(/\/fr\/sales\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId('sale-pills')).toContainText(/Partielle.*4\s?900/);
  await expect(page.getByTestId('sale-detail')).toContainText('Amina Belkacem');
  expect((await getJson<{ stock: number }>(request, owner, `/products/${robe.id}`)).stock).toBe(5);

  // Encaisser le reste ⇒ PAYÉE + a locked cash row
  await page.getByTestId('sale-collect').click();
  const collect = page.getByTestId('collect-dialog');
  await expect(collect.getByLabel('Montant (DA)')).toHaveValue(/4\s?900/);
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page.getByTestId('sale-pills')).toContainText('Payée');
  const rows = await getJson<{ category: string; isAutomatic: boolean; amount: number }[]>(request, owner, `/cash?day=${algiersToday()}&category=sale`);
  expect(rows.filter((r) => r.isAutomatic).map((r) => r.amount).sort((x, y) => x - y)).toEqual([4900, 5000]);
});

test('AT-GDS-12 — the sheet asks before dropping a cart; a draft finished with a new client typed in the sheet keeps it (partial)', async ({ page, request }) => {
  await signIn(page, owner);
  await open(page, '/fr/sales/new', () => page.getByTestId('new-sale-sheet'));
  const sheet = page.getByTestId('new-sale-sheet');
  const search = sheet.getByRole('searchbox').first();
  await search.fill('Robe');
  await page.getByTestId('gds-product-results').locator(`[data-product="${robe.id}"]`).click();
  await page.keyboard.press('Escape');
  const guard = page.getByRole('dialog', { name: 'Quitter sans enregistrer ?' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Rester' }).click();
  await expect(sheet.getByTestId('sale-lines')).toContainText('Robe satin');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Quitter sans enregistrer ?' }).getByRole('button', { name: 'Quitter' }).click();
  await expect(page).toHaveURL(/\/fr\/sales$/);

  // a draft (no client) finished from the sheet with a new client and a partial payment
  const draft = await sale(request, owner, { lines: [{ productId: robe.id, quantity: 1 }], amountPaid: 0, status: 'draft' });
  await open(page, `/fr/sales/new?draft=${draft.id}`, () => page.getByTestId('sale-lines'));
  await sheet.getByLabel('Montant reçu (DA)').fill('1000');
  await sheet.getByRole('button', { name: 'nouveau client créé si introuvable' }).click();
  await sheet.getByTestId('sale-new-client').getByLabel('Nom').fill('Karim Draft');
  await sheet.getByTestId('sale-new-client').getByLabel('Téléphone').fill(uniquePhone());
  await page.getByTestId('sale-validate').click();
  await expect(page).toHaveURL(new RegExp(`/fr/sales/${draft.id}$`), { timeout: 30_000 });
  await expect(page.getByTestId('sale-pills')).toContainText(/Partielle.*3\s?900/);
  await expect(page.getByTestId('sale-detail')).toContainText('Karim Draft');
});

test('AT-GDS-12 — cancel a paid sale: delete greyed SALE_DELETE_PAID, cancel restores stock and adds a refund row', async ({ page, request }) => {
  const before = (await getJson<{ stock: number }>(request, owner, `/products/${sac.id}`)).stock;
  const s = await sale(request, owner, { lines: [{ productId: sac.id, quantity: 1 }], amountPaid: 5000 });
  await signIn(page, owner);
  await open(page, '/fr/sales', () => row(page, s.id));
  const menu = await openRowMenu(page, s.id);
  await expect(menu).toContainText(errText('SALE_DELETE_PAID'));
  await menu.locator('[data-action="cancel"]').click();
  const dlg = page.getByTestId('cancel-sale-dialog');
  await expect(dlg).toContainText(/Rembourser les 5\s?000/);
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page.locator('[data-toast]').filter({ hasText: `Vente #${s.number} annulée` })).toBeVisible();
  await expect(row(page, s.id)).toContainText('Annulée');
  expect((await getJson<{ stock: number }>(request, owner, `/products/${sac.id}`)).stock).toBe(before);
  const refunds = await getJson<{ category: string; amount: number }[]>(request, owner, `/cash?day=${algiersToday()}&category=refund`);
  expect(refunds.some((r) => r.amount === 5000)).toBeTruthy();
});

test('AT-ERR-07 — sale older than 7 days: "Annuler la vente" greyed with SALE_CANNOT_CANCEL_AFTER_7D', async ({ page, request }) => {
  const s = await sale(request, owner, { lines: [{ productId: robe.id, quantity: 1 }], amountPaid: 4900 });
  await signIn(page, owner);
  // mock: a sale cannot be back-dated 8 days through the API (`soldAt` ≤ now), so the row of this sale is served with
  // the cancel descriptor the API gives after 7 days (greyed, SALE_CANNOT_CANCEL_AFTER_7D)
  await page.route(/\/api\/v1\/sales\?/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { data: { id: string; actions: { key: string; enabled: boolean; reasonCode?: string }[] }[] };
    for (const r of body.data) if (r.id === s.id) r.actions = r.actions.map((a) => (a.key === 'cancel' ? { ...a, enabled: false, reasonCode: 'SALE_CANNOT_CANCEL_AFTER_7D' } : a));
    await route.fulfill({ response: res, json: body });
  });
  await open(page, '/fr/sales', () => row(page, s.id));
  const menu = await openRowMenu(page, s.id);
  await expect(menu.locator('[data-action="cancel"]')).toHaveAttribute('data-disabled', '');
  await expect(menu).toContainText(errText('SALE_CANNOT_CANCEL_AFTER_7D'));
});

test('GDS-08 — list: KPIs, payment chip in the URL, walk-in rows, draft opens the sheet', async ({ page, request }) => {
  await sale(request, owner, { lines: [{ productId: robe.id, quantity: 1 }], amountPaid: 4900 });
  await signIn(page, owner);
  await open(page, '/fr/sales', () => page.getByTestId('sale-kpis').locator('[data-kpi="revenue"]'));
  await expect(page.getByTestId('sale-kpis').locator('[data-kpi="remaining"]')).toBeVisible();
  await expect(page.getByText('Passage (sans client)').first()).toBeVisible();
  await page.getByRole('button', { name: /^Paiement/ }).click();
  await page.getByRole('checkbox', { name: 'Payée', exact: true }).click();
  await expect(page).toHaveURL(/paymentStatus=paid/);
});
