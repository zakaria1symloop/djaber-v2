// M7 — /purchases (Figma "GDS-07 — Purchases — list + receive dialog", "CAT-11 / GDS-06b — New purchase form · Purchase
// detail", DLG GDS II "Achats — verrous"): new purchase (untracked line refused, Brouillon / Commander), receive with an
// over-receipt (200 ⚠ PURCHASE_OVER_RECEIVE) and the weighted-average cost, detail pills, locks (cancel received
// PURCHASE_ALREADY_RECEIVED, delete PURCHASE_DELETE_NOT_PENDING), partial cancel, KPIs following the filters.
// Real API: nothing is mocked.
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { open, row } from './support/m5-orders';
import { gdsOwner, gdsReady, getJson, openRowMenu, product, purchase, supplier, type SeedProduct, type SeedSupplier } from './support/m7';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let oud: SeedProduct;
let musc: SeedProduct;
let service: SeedProduct;
let orient: SeedSupplier;

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await gdsOwner(request, 'm7pur');
  test.skip(!(await gdsReady(request, owner)), 'GDS operations (M7) not served');
  oud = await product(request, owner, { name: 'Parfum Oud 100 ml', price: 4500, cost: 100, stock: 10 });
  musc = await product(request, owner, { name: 'Parfum Musc 50 ml', price: 2500, cost: 900, stock: 0 });
  service = await product(request, owner, { name: 'Retouche couture', price: 800, trackStock: false });
  orient = await supplier(request, owner, 'Parfumerie Orient');
});

test('GDS-06b — new purchase: untracked product greyed in the picker (PURCHASE_UNTRACKED_PRODUCT), Brouillon then Commander; axe', async ({ page }) => {
  await signIn(page, owner);
  await open(page, `/fr/purchases/new?supplierId=${orient.id}`, () => page.getByTestId('purchase-form'));
  await expectNoA11yViolations(page);
  const form = page.getByTestId('purchase-form');
  await expect(form.getByLabel('Fournisseur')).toHaveValue(orient.id);
  const search = form.getByRole('searchbox').first();
  // a service (untracked) is listed greyed with PURCHASE_UNTRACKED_PRODUCT and cannot be added
  await search.fill('Retouche');
  const refused = page.getByTestId('gds-product-results').locator(`[data-product="${service.id}"]`);
  await expect(refused).toBeDisabled();
  await expect(refused).toHaveAttribute('title', /est un service : non achetable/);
  await expect(form.locator(`tr[data-line="${service.id}"]`)).toHaveCount(0);
  await search.fill('Parfum Oud');
  await page.getByTestId('gds-product-results').locator(`[data-product="${oud.id}"]`).click();
  await form.getByLabel(/Coût unitaire — Parfum Oud/).fill('1500');
  await expect(page.getByTestId('purchase-totals')).toContainText(/1\s?500/);
  await page.getByTestId('purchase-save-draft').click();
  await expect(page).toHaveURL(/\/fr\/purchases\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId('purchase-pills')).toContainText('Brouillon');
  await page.getByTestId('purchase-order').click();
  await expect(page.getByTestId('purchase-pills')).toContainText('Commandé');
});

test('AT-GDS-11 / AT-DLG-75 — receive 14 of 12 ⇒ PURCHASE_OVER_RECEIVE accepted, line 14, weighted average cost; received locks', async ({ page, request }) => {
  // stock 10 at cost 100, receive at 160 ⇒ AT-GDS-16 numbers checked on the product
  const p = await purchase(request, owner, { supplierId: orient.id, lines: [{ productId: oud.id, quantity: 12, unitCost: 160 }] });
  await signIn(page, owner);
  await open(page, `/fr/purchases/${p.id}`, () => page.getByTestId('purchase-receive'));
  await page.getByTestId('purchase-receive').click();
  const dlg = page.getByTestId('receive-dialog');
  await expect(page.getByRole('dialog')).toContainText('Reste à recevoir : 12 sur 12');
  const qty = dlg.getByLabel(/Reçu aujourd'hui — Parfum Oud/);
  await qty.fill('0');
  await expect(page.getByRole('dialog').getByTestId('dialog-submit')).toBeDisabled();
  await qty.fill('14');
  await expect(dlg.getByTestId('over-receive-warning')).toContainText(errText('PURCHASE_OVER_RECEIVE'));
  await expect(page.getByRole('dialog').getByTestId('dialog-submit')).toContainText('Valider la réception (14 u)');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page.locator('[data-toast]').filter({ hasText: errText('PURCHASE_OVER_RECEIVE') })).toBeVisible();
  await expect(page.getByTestId('purchase-pills')).toContainText('Reçu');
  const full = await getJson<{ items: { quantity: number; receivedQty: number }[] }>(request, owner, `/purchases/${p.id}`);
  expect(full.items[0]).toMatchObject({ quantity: 14, receivedQty: 14 });
  // (10 × 100 + 14 × 160) / 24 = 135 (half-up)
  expect((await getJson<{ costPrice: number }>(request, owner, `/products/${oud.id}`)).costPrice).toBe(135);
  await expect(page.getByTestId('purchase-movements')).toBeVisible();

  // received: cancel and delete greyed with their codes
  await page.getByRole('button', { name: /Actions/ }).last().click();
  const menu = page.getByRole('menu');
  await expect(menu.locator('[data-action="cancel"]')).toHaveAttribute('data-disabled', '');
  await expect(menu).toContainText(errText('PURCHASE_ALREADY_RECEIVED'));
  await expect(menu).toContainText(errText('PURCHASE_DELETE_NOT_PENDING'));
});

test('AT-GDS-11 — partial purchase cancelled: received units stay, the rest is no longer due', async ({ page, request }) => {
  const p = await purchase(request, owner, { supplierId: orient.id, lines: [{ productId: musc.id, quantity: 12, unitCost: 900 }] });
  await signIn(page, owner);
  await open(page, `/fr/purchases/${p.id}`, () => page.getByTestId('purchase-receive'));
  await page.getByTestId('purchase-receive').click();
  await page.getByTestId('receive-dialog').getByLabel(/Reçu aujourd'hui — Parfum Musc/).fill('8');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page.getByTestId('purchase-pills')).toContainText(/Partiel\s*8\/12/);
  await page.getByRole('button', { name: /Actions/ }).last().click();
  await page.getByRole('menu').locator('[data-action="cancel"]').click();
  const dlg = page.getByTestId('cancel-purchase-dialog');
  await expect(dlg).toContainText('les 8 u reçues restent en stock');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page.getByTestId('purchase-pills')).toContainText('Annulé');
  const prod = await getJson<{ stock: number }>(request, owner, `/products/${musc.id}`);
  expect(prod.stock).toBe(8);
});

test('GDS-07 — list: KPIs follow the filters, status chip in the URL, row menu (draft: delete allowed)', async ({ page, request }) => {
  const draft = await purchase(request, owner, { supplierId: orient.id, lines: [{ productId: oud.id, quantity: 2, unitCost: 1000 }], status: 'draft' });
  await signIn(page, owner);
  await open(page, '/fr/purchases', () => row(page, draft.id));
  await expect(page.getByTestId('purchase-kpis').locator('[data-kpi="drafts"]')).toBeVisible();
  await page.getByTestId('purchase-kpis').locator('[data-kpi="drafts"]').click();
  await expect(page).toHaveURL(/status=draft/);
  await expect(row(page, draft.id)).toBeVisible();
  await expect(page.getByTestId('purchases-count')).toContainText('1 achat');
  const menu = await openRowMenu(page, draft.id);
  await expect(menu.getByRole('menuitem').first()).toContainText('Commander');
  await menu.locator('[data-action="delete"]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.locator('[data-toast]').filter({ hasText: `Achat #${draft.number} supprimé` })).toBeVisible();
  await expect(page.getByText('Aucun résultat').first()).toBeVisible();
});
