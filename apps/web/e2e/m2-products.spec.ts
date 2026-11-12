// M2 — products list (CAT-08): filters in the URL, low-stock deep link, sort, selection + bulk actions with per-item
// results, row `Actions ⌄` from the server descriptors, quick-edit sheet, export job toast, archive, responsive and a11y.
// AT-CAT-11 (UI side), AT-CAT-07 (archive from the list). Needs the API on :4010 with the M2 catalogue module.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, loginHome, type Account } from './support/m1';
import { catalogReady, getProduct, seedCategory, seedProduct, setStockMode, sku, type SeedProduct } from './support/m2';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
/** a valid 1 × 1 PNG (accepted with the IMAGE_SMALL warning) */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let account: Account;
let robe: SeedProduct;
let parfum: SeedProduct;
let sac: SeedProduct;
let service: SeedProduct;
let vetements: { id: string; name: string };

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  account = await createAccount(request, { prefix: 'm2list', finishOnboarding: true });
  test.skip(!(await catalogReady(request, account)), 'M2 catalogue endpoints not available on the API');
  await setStockMode(request, account, 'advanced');
  vetements = await seedCategory(request, account, 'Vêtements', { color: '#a78bfa' });
  const accessoires = await seedCategory(request, account, 'Accessoires', { color: '#fbbf24' });
  robe = await seedProduct(request, account, {
    name: 'La Robe satin',
    sku: sku('RS'),
    price: 4900,
    costPrice: 2600,
    categoryId: vetements.id,
    variants: [
      { name: 'Noir · S', price: 4900, stock: 6, minStock: 2 },
      { name: 'Noir · M', price: 4900, stock: 1, minStock: 2 },
    ],
  });
  parfum = await seedProduct(request, account, { name: 'Parfum Oud 50 ml', sku: sku('PO'), price: 4900, costPrice: 2100, stock: 3, minStock: 5 });
  sac = await seedProduct(request, account, { name: 'Sac cuir camel', sku: sku('SC'), price: 9800, costPrice: 5400, stock: 40, minStock: 2, categoryId: accessoires.id });
  service = await seedProduct(request, account, { name: 'Livraison express Sétif', sku: sku('SRV'), price: 500, trackStock: false });
});

const rowOf = (page: Page, p: SeedProduct) => page.locator(`tr[data-row="${p.id}"]`);
const names = (page: Page) => page.locator('tbody tr[data-row] td:nth-child(2) .font-medium').allTextContents();

test('AT-CAT-11 list shows the catalogue with stock pills, margins (advanced) and the summary line', async ({ page }) => {
  await loginHome(page, account);
  await page.goto('/fr/products');
  await expect(page.getByRole('heading', { name: 'Produits', level: 1 })).toBeVisible();
  await expect(rowOf(page, robe)).toContainText('La Robe satin');
  await expect(rowOf(page, robe)).toContainText('FAIBLE'); // one variant at or under its threshold
  await expect(rowOf(page, parfum)).toContainText('FAIBLE');
  await expect(rowOf(page, sac)).not.toContainText('FAIBLE');
  await expect(rowOf(page, service)).toContainText('SERVICE');
  await expect(rowOf(page, service)).toContainText('Service · sans stock');
  await expect(page.getByRole('columnheader', { name: /COÛT/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /MARGE/ })).toBeVisible();
  await expect(page.getByText(/4 produits · 2 en stock faible/)).toBeVisible();
  await expectNoA11yViolations(page);
});

test('AT-CAT-11 ?lowStock=1 deep link preselects the filter; chips and "Effacer" restore the list', async ({ page }) => {
  await loginHome(page, account);
  await page.goto('/fr/products?lowStock=1');
  await expect(rowOf(page, parfum)).toBeVisible();
  await expect(rowOf(page, robe)).toBeVisible();
  await expect(rowOf(page, sac)).toHaveCount(0);
  await expect(rowOf(page, service)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Stock faible ·/ })).toHaveAttribute('aria-pressed', 'true');
  const chips = page.getByRole('list', { name: 'Filtres actifs' });
  await expect(chips).toContainText('Stock faible');
  await chips.getByRole('button', { name: /Retirer le filtre Stock faible/ }).click();
  await expect(page).not.toHaveURL(/lowStock/);
  await expect(rowOf(page, sac)).toBeVisible();
});

test('AT-CAT-11 filter panel: category (multi), price range, type — state lives in the URL and survives a reload', async ({ page }) => {
  await loginHome(page, account);
  await page.goto('/fr/products');
  await page.getByTestId('open-filters').click();
  const panel = page.getByRole('dialog', { name: 'Filtres' });
  await panel.getByRole('group', { name: 'CATÉGORIES' }).getByLabel('Vêtements').click();
  await expect(page).toHaveURL(new RegExp(`categoryIds=${vetements.id}`));
  await expect(rowOf(page, robe)).toBeVisible();
  await expect(rowOf(page, parfum)).toHaveCount(0);
  await panel.getByRole('button', { name: 'Réinitialiser' }).click();
  await expect(page).not.toHaveURL(/categoryIds/);

  // price 5 000 – 20 000 ⇒ only the bag
  const price = panel.getByRole('group', { name: 'PRIX DE VENTE' });
  await price.getByLabel('min').fill('5000');
  await price.getByLabel('max').fill('20000');
  await price.getByLabel('max').press('Enter');
  await expect(page).toHaveURL(/minPrice=5000/);
  await expect(page).toHaveURL(/maxPrice=20000/);
  await expect(rowOf(page, sac)).toBeVisible();
  await expect(rowOf(page, robe)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /Afficher 1 produit/ })).toBeVisible();
  await panel.getByRole('button', { name: /Afficher 1 produit/ }).click();
  await expect(page.getByRole('list', { name: 'Filtres actifs' })).toContainText(/Prix 5.000.DA – 20.000.DA/);

  await page.reload();
  await expect(rowOf(page, sac)).toBeVisible();
  await expect(rowOf(page, robe)).toHaveCount(0);

  // services only
  await page.goto('/fr/products?type=service');
  await expect(rowOf(page, service)).toBeVisible();
  await expect(rowOf(page, sac)).toHaveCount(0);

  // filtered-empty state
  await page.goto('/fr/products?q=zzzzzz');
  await expect(page.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
  await page.getByRole('button', { name: 'Effacer les filtres' }).click();
  await expect(rowOf(page, sac)).toBeVisible();
});

test('AT-CAT-11 sort by price from the header, search by SKU, page size in the URL', async ({ page }) => {
  await loginHome(page, account);
  await page.goto('/fr/products');
  await page.getByRole('button', { name: 'Trier par PRIX' }).click();
  await expect(page).toHaveURL(/sort=price/);
  // the previous page stays on screen until the sorted one arrives (placeholder data): wait for the new order
  await expect.poll(async () => (await names(page))[0]).toBe('Livraison express Sétif');
  const asc = await names(page);
  expect(asc[asc.length - 1]).toBe('Sac cuir camel');
  await page.getByRole('button', { name: 'Trier par PRIX' }).click();
  await expect(page).toHaveURL(/sort=-price/);
  await expect.poll(async () => (await names(page))[0]).toBe('Sac cuir camel');

  await page.getByRole('searchbox', { name: 'Rechercher' }).fill(parfum.sku);
  await expect(page).toHaveURL(new RegExp(`q=${parfum.sku}`));
  await expect(rowOf(page, parfum)).toBeVisible();
  await expect(rowOf(page, sac)).toHaveCount(0);

  await page.goto('/fr/products?pageSize=50&density=compact');
  await expect(page.locator('table[data-density="compact"]')).toBeVisible();
  await expect(page.getByRole('combobox', { name: /50 \/ page/ })).toBeVisible();
});

test('row Actions ⌄ comes from the server: a service cannot be adjusted (reason + code), quick edit saves on blur', async ({ page, request }) => {
  await loginHome(page, account);
  await page.goto('/fr/products');
  await rowOf(page, service).getByRole('button', { name: 'Actions' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /Ouvrir la fiche/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Ajuster le stock/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(menu).toContainText(errText('PRODUCT_NOT_STOCK_TRACKED'));
  await page.keyboard.press('Escape');

  await rowOf(page, sac).getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /Modification rapide/ }).click();
  await expect(page).toHaveURL(new RegExp(`sheet=${sac.id}`));
  const sheet = page.getByRole('dialog', { name: 'Sac cuir camel' });
  await sheet.locator('#quick-price').fill('9900');
  await sheet.locator('#quick-price').blur();
  await expect(sheet.getByTestId('quick-status')).toContainText('Prix modifié · enregistré');
  expect((await getProduct(request, account, sac.id)).price).toBe(9900);
  await expect(rowOf(page, sac)).toContainText(/9.900/);

  // stock stepper = one traced adjustment
  await sheet.getByRole('button', { name: /Ajouter 1/ }).click();
  await expect(sheet.getByTestId('quick-status')).toContainText('mouvement enregistré');
  expect((await getProduct(request, account, sac.id)).stock).toBe(41);

  // the "+" image tile opens the file picker right in the sheet and uploads there (no navigation to the edit form)
  const imagesBefore = ((await getProduct(request, account, sac.id)) as unknown as { images?: unknown[] }).images?.length ?? 0;
  const chooser = page.waitForEvent('filechooser');
  await sheet.getByTestId('quick-images').getByRole('button', { name: 'AJOUTER' }).click();
  await (await chooser).setFiles([{ name: 'sac.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX, 'base64') }]);
  await expect(page).toHaveURL(new RegExp(`sheet=${sac.id}`));
  await expect(sheet.getByText(`IMAGES · ${imagesBefore + 1} / 10`)).toBeVisible({ timeout: 30_000 });
  expect(((await getProduct(request, account, sac.id)) as unknown as { images: unknown[] }).images).toHaveLength(imagesBefore + 1);
  // a file of the wrong type is refused under its tile, inside the sheet
  await sheet.getByTestId('quick-images').locator('input[data-upload="product-image"]').setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
  await expect(sheet.getByTestId('quick-images').getByRole('alert')).toContainText(errText('IMAGE_TYPE_INVALID'));

  // ‹ › walk the rows, Esc closes and cleans the URL
  await sheet.getByRole('button', { name: 'Précédent' }).click();
  await expect(page).not.toHaveURL(new RegExp(`sheet=${sac.id}`));
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/sheet=/);
});

test('selection bar: bulk price with preview, per-item result, and bulk category', async ({ page, request }) => {
  await loginHome(page, account);
  await page.goto('/fr/products');
  await rowOf(page, parfum).getByRole('checkbox').check();
  await rowOf(page, service).getByRole('checkbox').check();
  const bar = page.getByRole('region', { name: 'Actions groupées' });
  await expect(bar).toContainText('2 produits sélectionnés');
  await bar.getByRole('button', { name: 'Prix (+ / − %)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Modifier les prix en masse' });
  await dialog.locator('#bulk-price-value').fill('10');
  await expect(dialog.getByTestId('bulk-price-preview')).toContainText(/4.900 → 5.390/);
  await dialog.getByTestId('bulk-submit').click();
  await expect(page.getByText('2 produits mis à jour')).toBeVisible();
  expect((await getProduct(request, account, parfum.id)).price).toBe(5390);
  expect((await getProduct(request, account, service.id)).price).toBe(550);

  await rowOf(page, parfum).getByRole('checkbox').check();
  await bar.getByRole('button', { name: 'Changer de catégorie' }).click();
  const cat = page.getByRole('dialog', { name: 'Changer la catégorie' });
  await cat.locator('#bulk-category').click();
  await page.getByRole('option', { name: 'Vêtements' }).click();
  await cat.getByTestId('bulk-submit').click();
  await expect(page.getByText('1 produit mis à jour')).toBeVisible();
  await expect(rowOf(page, parfum)).toContainText('Vêtements');
});

test('export of the current filter runs as a job with a progress toast', async ({ page }) => {
  await loginHome(page, account);
  await page.goto('/fr/products');
  await page.getByRole('button', { name: 'Exporter', exact: true }).click();
  await expect(page.getByText(/Export terminé/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Télécharger' })).toBeVisible();
});

test('AT-CAT-07 archive from the list hides the product; the Archivés filter shows it with Restaurer', async ({ page, request }) => {
  const temp = await seedProduct(request, account, { name: 'Produit à archiver', sku: sku('ARC'), price: 1500, stock: 4 });
  await loginHome(page, account);
  await page.goto('/fr/products');
  await rowOf(page, temp).getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /Archiver/ }).click();
  const dialog = page.getByRole('dialog', { name: /Supprimer « Produit à archiver »/ });
  await expect(dialog.getByRole('radio', { name: /Archiver/ })).toBeChecked();
  await dialog.getByLabel(/Sortir le stock restant \(4 u\)/).check();
  await dialog.getByTestId('archive-submit').click();
  await expect(page.getByText('« Produit à archiver » archivé')).toBeVisible();
  await expect(rowOf(page, temp)).toHaveCount(0);

  await page.goto('/fr/products?status=archived');
  await expect(rowOf(page, temp)).toContainText('ARCHIVÉ');
  await rowOf(page, temp).getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: /Restaurer/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Modification rapide/ })).toHaveCount(0);
});

test('simple stock mode hides the cost and margin columns', async ({ page, request }) => {
  await setStockMode(request, account, 'simple');
  await loginHome(page, account);
  await page.goto('/fr/products');
  await expect(rowOf(page, sac)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /COÛT/ })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /MARGE/ })).toHaveCount(0);
  await setStockMode(request, account, 'advanced');
});

test('responsive: no horizontal overflow at 1024, cards without multi-select at 390', async ({ page }) => {
  await loginHome(page, account);
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/fr/products');
  await expect(rowOf(page, sac)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(`li[data-row="${sac.id}"]`)).toBeVisible();
  await expect(page.locator('table')).toBeHidden();
  await expect(page.locator(`li[data-row="${sac.id}"]`).getByRole('checkbox')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
