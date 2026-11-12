// M2 — product page (CAT-09 / CAT-10): blocks per stock mode, inline variant edit, AT-CAT-07 (UI side), AT-CAT-13,
// 404. Needs the API on :4010.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, expectUrl, loginHome, type Account } from './support/m1';
import { archiveProduct, catalogReady, seedCategory, seedProduct, setStockMode, sku } from './support/m2';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial' });
let account: Account;
const tag = Date.now().toString(36);
const CATEGORY = `Parfums ${tag}`;
const VARIANT_PRODUCT = `Parfum Oud ${tag}`;
const TO_ARCHIVE = `Montre Classic ${tag}`;
const REUSED = `Montre Sport ${tag}`;
const REUSED_SKU = sku('MONT');
let variantProductId = '';
let lowVariantId = '';
let toArchiveId = '';
let reusedId = '';

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  account = await createAccount(request, { prefix: 'pdp', finishOnboarding: true });
  test.skip(!(await catalogReady(request, account)), 'M2 catalogue API not reachable');
  await setStockMode(request, account, 'advanced');
  const category = await seedCategory(request, account, CATEGORY, { color: '#a78bfa' });
  const product = await seedProduct(request, account, {
    name: VARIANT_PRODUCT,
    price: 4500,
    costPrice: 2400,
    categoryId: category.id,
    variants: [
      { name: '50 ml', price: 2900, costPrice: 1500, stock: 4, minStock: 5 },
      { name: '100 ml', price: 4500, costPrice: 2400, stock: 12, minStock: 5 },
      { name: 'Coffret', price: 6900, costPrice: 3900, stock: 0, minStock: 2 },
    ],
  });
  variantProductId = product.id;
  lowVariantId = product.variants.find((v) => v.name === '50 ml')!.id;
  toArchiveId = (await seedProduct(request, account, { name: TO_ARCHIVE, price: 6000, stock: 3 })).id;
  reusedId = (await seedProduct(request, account, { name: REUSED, sku: REUSED_SKU, price: 7000, stock: 1 })).id;
});

test('CAT-09 advanced mode: every block of a variant product, inline variant edit, axe', async ({ page }) => {
  await loginHome(page, account);
  await page.goto(`/fr/products/${variantProductId}`);
  await expect(page.getByRole('heading', { name: VARIANT_PRODUCT, level: 1 })).toBeVisible();
  await expect(page.getByTestId('product-blocks')).toHaveAttribute('data-mode', 'advanced');
  await expect(page.getByTestId('product-sub')).toContainText(CATEGORY);
  await expect(page.getByTestId('product-sub')).toContainText('3 variantes');
  for (const block of ['block-gallery', 'block-variants', 'block-movements', 'block-pricing', 'block-stock', 'block-agents', 'block-moderation']) {
    await expect(page.getByTestId(block)).toBeVisible();
  }
  await expect(page.getByTestId('pricing-cost')).toBeVisible();
  await expect(page.getByTestId('pricing-margin')).toBeVisible();
  await expect(page.getByTestId('stock-total')).toContainText('16 u');
  await expect(page.getByTestId('stock-total')).toContainText('3 variantes');
  await expect(page.getByTestId('stock-total')).toContainText('2 en alerte');
  // opening quantities are movements
  await expect(page.getByTestId('block-movements').locator('[data-movement]').first()).toBeVisible();
  await expect(page.getByTestId('edit-product')).toHaveAttribute('href', new RegExp(`/fr/products/${variantProductId}/edit$`));
  await expectNoA11yViolations(page);

  // click on a row = inline edit; Enter saves price / cost / threshold, the stock is not editable here
  const row = page.locator(`[data-variant="${lowVariantId}"]`);
  await expect(row).toContainText(/2.900/);
  await row.click();
  await expect(row.locator('[data-field="price"]')).toBeFocused();
  await row.locator('[data-field="price"]').fill('');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('variant-error')).toContainText('Prix de vente requis');
  await row.locator('[data-field="price"]').fill('3100');
  await row.locator('[data-field="minStock"]').fill('3');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-toast]').filter({ hasText: 'Enregistré' })).toBeVisible();
  await expect(row).not.toHaveAttribute('data-editing', 'true');
  await expect(row).toContainText(/3.100/);
  // 4 units with a threshold of 3: no longer in alert
  await expect(page.getByTestId('stock-total')).toContainText('1 en alerte');

  // stock moves only through "Ajuster", on that variant
  await row.getByRole('button', { name: /Ajuster le stock de 50 ml/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#adj-variant')).toHaveValue(lowVariantId);
  await dialog.getByRole('button', { name: 'Annuler' }).click();
});

test('CAT-09 simple mode: only gallery, price, stock, agents and validation', async ({ page, request }) => {
  await setStockMode(request, account, 'simple');
  try {
    await loginHome(page, account);
    await page.goto(`/fr/products/${variantProductId}`);
    await expect(page.getByTestId('product-blocks')).toHaveAttribute('data-mode', 'simple');
    await expect(page.getByTestId('pricing-price')).toBeVisible();
    await expect(page.getByTestId('block-stock')).toBeVisible();
    await expect(page.getByTestId('block-gallery')).toBeVisible();
    await expect(page.getByTestId('block-moderation')).toBeVisible();
    for (const hidden of ['block-variants', 'block-movements', 'pricing-cost', 'pricing-margin']) await expect(page.getByTestId(hidden)).toHaveCount(0);
  } finally {
    await setStockMode(request, account, 'advanced');
  }
});

test('AT-CAT-07 archive from the page: archived banner, read-only, hidden from the default products list', async ({ page }) => {
  await loginHome(page, account);
  await page.goto(`/fr/products/${toArchiveId}`);
  await expect(page.getByRole('heading', { name: TO_ARCHIVE, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Archiver' }).click();
  await page.getByTestId('archive-submit').click();
  await expectUrl(page, '**/fr/products');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-row]').filter({ hasText: TO_ARCHIVE })).toHaveCount(0);

  await page.goto(`/fr/products/${toArchiveId}`);
  await expect(page.getByTestId('archived-banner')).toContainText('masqué des listes et de l’IA');
  await expect(page.getByTestId('product-pills')).toContainText('ARCHIVÉ');
  await expect(page.getByTestId('edit-product')).toHaveCount(0);
  await expect(page.getByTestId('adjust-stock')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restaurer' })).toBeVisible();
});

test('AT-CAT-13 restore an archived product whose SKU was reused: PRODUCT_SKU_ALREADY_EXISTS, then restored', async ({ page, request }) => {
  // A is archived, B takes A's SKU
  await archiveProduct(request, account, reusedId);
  const taker = await seedProduct(request, account, { name: `${REUSED} II`, sku: REUSED_SKU, price: 7500, stock: 1 });

  await loginHome(page, account);
  await page.goto(`/fr/products/${reusedId}`);
  await expect(page.getByTestId('archived-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Restaurer' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('restore-submit').click();
  // the dialog asks for a new SKU
  await expect(dialog).toContainText(errText('PRODUCT_SKU_ALREADY_EXISTS'));
  await expect(dialog.locator('#restore-sku')).toBeVisible();
  await expect(page.getByTestId('archived-banner')).toBeVisible();

  // once the SKU is free again (or replaced), the same dialog restores the product
  await archiveProduct(request, account, taker.id);
  await dialog.locator('#restore-sku').fill(`${REUSED_SKU}-R`);
  await dialog.getByTestId('restore-submit').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('archived-banner')).toHaveCount(0);
  await expect(page.getByTestId('edit-product')).toBeVisible();
});

test('CAT-09 unknown or foreign id answers 404 with a way back', async ({ page }) => {
  await loginHome(page, account);
  await page.goto(`/fr/products/${randomUUID()}`);
  await expect(page.getByRole('heading', { name: 'Introuvable' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Retour', exact: true })).toHaveAttribute('href', '/fr/products');
});
