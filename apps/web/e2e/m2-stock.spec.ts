// M2 — stock dashboard (GDS-01) and movements journal (GDS-05): AT-CAT-02, AT-CAT-09 (UI side). Needs the API on :4010.
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { API, apiReady, authHeaders, createAccount, loginHome, type Account } from './support/m1';
import { catalogReady } from './support/m2';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial' });
let account: Account;
const tag = Date.now().toString(36);
const SERVICE = `Retouche couture ${tag}`;
const SIMPLE = `Parfum Oud ${tag}`;
const VARIANT_PRODUCT = `Robe satin ${tag}`;
const VARIANT = 'Noir · M';
let simpleId = '';
let variantProductId = '';
let variantId = '';
let serviceId = '';

const post = async (request: APIRequestContext, path: string, data: unknown, headers: Record<string, string> = {}) => request.post(`${API}${path}`, { headers: { ...authHeaders(account), ...headers }, data });
const setMode = async (request: APIRequestContext, stockMode: 'simple' | 'advanced') => {
  const res = await request.patch(`${API}/workspace`, { headers: authHeaders(account), data: { stockMode } });
  expect(res.ok(), await res.text()).toBeTruthy();
};

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  account = await createAccount(request, { prefix: 'stk', finishOnboarding: true });
  test.skip(!(await catalogReady(request, account)), 'M2 catalogue API not available');
  await setMode(request, 'advanced');
  const created = async (data: unknown) => {
    const res = await post(request, '/products', data);
    expect(res.ok(), await res.text()).toBeTruthy();
    return ((await res.json()) as { data: { id: string; variants: { id: string; name: string }[] } }).data;
  };
  serviceId = (await created({ name: SERVICE, price: 800, trackStock: false })).id;
  simpleId = (await created({ name: SIMPLE, price: 4500, costPrice: 2400, stock: 3, minStock: 5 })).id;
  const withVariants = await created({ name: VARIANT_PRODUCT, price: 6900, variants: [{ name: VARIANT, price: 6900, stock: 1, minStock: 2 }, { name: 'Noir · L', price: 6900, stock: 6 }] });
  variantProductId = withVariants.id;
  variantId = withVariants.variants.find((v) => v.name === VARIANT)!.id;
});

test('GDS-01 advanced dashboard: tiles, recent movements, low stock with restock, axe', async ({ page }) => {
  await loginHome(page, account);
  await page.goto('/fr/stock');
  await expect(page.getByRole('heading', { name: 'Tableau de bord stock' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('MODE AVANCÉ', { exact: true })).toBeVisible();
  const tiles = page.getByTestId('stock-tiles');
  await expect(tiles.getByTestId('tile-products')).toContainText('1 service exclu');
  await expect(tiles.getByTestId('tile-cost')).toBeVisible();
  await expect(tiles.getByTestId('tile-retail')).toBeVisible();
  await expect(tiles.getByTestId('tile-items')).toContainText('10'); // 3 + 1 + 6, the service has no stock
  await expect(tiles.getByTestId('tile-low')).toHaveAttribute('href', /\/fr\/products\?lowStock=1$/);
  await expect(page.getByRole('link', { name: 'Mouvements', exact: true }).last()).toHaveAttribute('href', /\/fr\/movements$/);
  // opening quantities are movements
  await expect(page.getByTestId('recent-movements').getByText(SIMPLE)).toBeVisible();
  await expectNoA11yViolations(page);

  // "Réapprovisionner" (advanced mode, M7) opens a new purchase prefilled with that variant (M2 carry-over closed)
  const row = page.getByTestId('low-stock').locator(`[data-variant="${variantId}"]`);
  await expect(row).toContainText(`${VARIANT_PRODUCT} · ${VARIANT}`);
  await expect(row).toContainText('seuil 2');
  await row.getByRole('button', { name: 'Réapprovisionner' }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/purchases/new\\?productId=.*variantId=${variantId}`), { timeout: 30_000 });
});

test('AT-CAT-02 service product: no stock adjustment offered, PRODUCT_NOT_STOCK_TRACKED from the API', async ({ page, request }) => {
  const res = await post(request, '/stock/adjustments', { productId: serviceId, type: 'in', quantity: 1, reason: 'correction' }, { 'Idempotency-Key': randomUUID() });
  expect(res.status()).toBe(422);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PRODUCT_NOT_STOCK_TRACKED');

  await loginHome(page, account);
  await page.goto('/fr/stock');
  await page.getByRole('button', { name: 'Ajuster un stock' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#adj-product').click();
  const search = page.getByRole('textbox', { name: 'Rechercher par nom ou SKU…' });
  // tracked products are offered…
  await search.fill(tag);
  await expect(page.getByRole('option', { name: new RegExp(SIMPLE) })).toBeVisible();
  // …a service never is
  await expect(page.getByRole('option', { name: new RegExp(SERVICE) })).toHaveCount(0);
  await search.fill(SERVICE);
  await expect(page.getByRole('option', { name: new RegExp(SERVICE) })).toHaveCount(0);
  await expect(page.getByRole('listbox')).toContainText('Aucun résultat');
});

test('AT-CAT-09 adjust on a variant product: variant and reason required, "Définir" shows the result, movement carries the variant', async ({ page, request }) => {
  // product level is refused by the API
  const res = await post(request, '/stock/adjustments', { productId: variantProductId, type: 'in', quantity: 1, reason: 'correction' }, { 'Idempotency-Key': randomUUID() });
  expect(res.status()).toBe(422);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PRODUCT_HAS_VARIANTS');

  await loginHome(page, account);
  await page.goto('/fr/movements');
  await expect(page.getByRole('heading', { name: 'Mouvements de stock' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '+ Ajuster le stock' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#adj-product').click();
  await page.getByRole('textbox', { name: 'Rechercher par nom ou SKU…' }).fill(VARIANT_PRODUCT);
  await page.getByRole('option', { name: new RegExp(VARIANT_PRODUCT) }).click();
  await expect(dialog.locator('#adj-variant')).toBeVisible();

  // "Définir" 4 without variant nor reason: nothing is sent, both are asked
  let sent = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/stock/adjustments')) sent++;
  });
  await dialog.getByRole('radio', { name: /Définir/ }).click();
  await dialog.locator('#adj-qty').fill('4');
  const submit = dialog.getByRole('button', { name: /Enregistrer l.ajustement/ });
  await submit.click();
  await expect(dialog.getByText('Ajustez le stock par variante.')).toBeVisible();
  await expect(dialog.getByText('Champ requis')).toBeVisible();
  expect(sent).toBe(0);

  // with the variant: the computed result is shown (1 → 4 = an entry of 3)
  await dialog.locator('#adj-variant').selectOption(variantId);
  await expect(dialog.getByTestId('adjust-preview')).toContainText(`${VARIANT} passe de 1 à 4`);
  await expect(dialog.getByTestId('adjust-preview')).toContainText('« entrée »');
  await submit.click();
  await expect(dialog.getByText('Champ requis')).toBeVisible(); // reason still missing
  expect(sent).toBe(0);
  await dialog.locator('#adj-reason').selectOption('inventory');
  await dialog.locator('#adj-note').fill('Comptage e2e');
  await submit.click();
  await expect(dialog).toBeHidden();
  expect(sent).toBe(1);

  // the journal shows the movement with the variant name, the delta and before → after
  const row = page.getByRole('table', { name: 'Mouvements de stock' }).locator('tbody tr').first();
  await expect(row.getByTestId('movement-product')).toHaveText(`${VARIANT_PRODUCT} · ${VARIANT}`);
  await expect(row.getByTestId('movement-qty')).toHaveText('+3');
  await expect(row).toContainText('1 → 4');
  await expect(row).toContainText('Inventaire');
  await expect(row).toContainText(account.firstName);

  // immutable journal: edit / delete are greyed with the code, reverse and snapshot are offered
  await row.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Modifier' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Supprimer' })).toBeDisabled();
  await expect(page.getByRole('menu')).toContainText(errText('GDS_MOVEMENT_IMMUTABLE'));
  await page.getByRole('menuitem', { name: 'Voir le stock à cette date' }).click();
  await expect(page.getByRole('dialog').getByTestId('snapshot')).toContainText(VARIANT_PRODUCT);
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).last().click();

  // contre-passer: a new inverse movement on top of the journal
  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Contre-passer' }).click();
  await page.getByRole('dialog').locator('#reverse-note').fill('Erreur de comptage');
  await page.getByRole('dialog').getByRole('button', { name: 'Contre-passer' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const top = page.getByRole('table', { name: 'Mouvements de stock' }).locator('tbody tr').first();
  await expect(top.getByTestId('movement-qty')).toHaveText('−3');
  await expect(top).toContainText('4 → 1');
});

test('GDS-05 /movements?productId= deep link preselects the product filter, axe', async ({ page }) => {
  await loginHome(page, account);
  await page.goto(`/fr/movements?productId=${simpleId}`);
  const chips = page.getByRole('list', { name: 'Filtres actifs' });
  await expect(chips).toContainText(new RegExp(`PRODUIT : ${SIMPLE}`, 'i'));
  await expect(page.getByTestId('open-filters')).toHaveText('Filtres (1)');
  const names = page.getByRole('table', { name: 'Mouvements de stock' }).getByTestId('movement-product');
  await expect(names.first()).toHaveText(SIMPLE);
  for (const text of await names.allTextContents()) expect(text).toBe(SIMPLE);
  await expectNoA11yViolations(page);

  // removing the chip clears the URL and shows the whole journal again
  await chips.getByRole('button', { name: /Retirer le filtre/ }).click();
  await expect(page).not.toHaveURL(/productId=/);
  await expect(page.getByRole('table', { name: 'Mouvements de stock' }).getByText(VARIANT_PRODUCT).first()).toBeVisible();

  // a filter is URL state: type chip from the panel
  await page.getByTestId('open-filters').click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'INVENTAIRE', exact: true }).click();
  await expect(page).toHaveURL(/type=inventory/);
});

test('GDS-01 simple mode: reduced dashboard, movements explain the advanced mode', async ({ page, request }) => {
  await setMode(request, 'simple');
  try {
    await loginHome(page, account);
    await page.goto('/fr/stock');
    const tiles = page.getByTestId('stock-tiles');
    await expect(tiles.getByTestId('tile-products')).toBeVisible();
    await expect(tiles.getByTestId('tile-low')).toBeVisible();
    await expect(tiles.getByTestId('tile-retail')).toBeVisible();
    await expect(tiles.getByTestId('tile-cost')).toHaveCount(0);
    await expect(tiles.getByTestId('tile-items')).toHaveCount(0);
    await expect(page.getByText('MODE AVANCÉ', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('recent-movements')).toHaveCount(0);
    await expect(page.getByTestId('low-stock').getByRole('button', { name: 'Ajuster', exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('low-stock').getByRole('button', { name: 'Réapprovisionner' })).toHaveCount(0);

    await page.goto('/fr/movements');
    await expect(page.getByText('Le journal des mouvements fait partie du mode avancé')).toBeVisible();
    await expect(page.getByTestId('movements-stock-mode')).toHaveAttribute('href', /\/fr\/settings\/stock-mode$/);
  } finally {
    await setMode(request, 'advanced');
  }
});
