// M2 — categories & units (CAT-04): create / rename, duplicate name inline, AT-CAT-06 (delete in use ⇒ reassign),
// custom unit create / delete, system unit read-only. Needs the API on :4010.
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, loginHome, type Account } from './support/m1';
import { catalogReady, seedCategory, seedProduct, setStockMode } from './support/m2';

test.describe.configure({ mode: 'serial' });
let account: Account;
const tag = Date.now().toString(36);
const NAME = `Vêtements ${tag}`;
const RENAMED = `Mode ${tag}`;
const USED = `Accessoires ${tag}`;
const TARGET = `Maroquinerie ${tag}`;
const PRODUCT = `Sac cuir ${tag}`;
const UNIT = `Boîte de 6 ${tag}`;
let productId = '';

const category = (name: string) => `[data-category="${name}"]`;

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  account = await createAccount(request, { prefix: 'cat', finishOnboarding: true });
  // "+ Unité" exists in advanced mode only
  test.skip(!(await catalogReady(request, account)), 'M2 catalogue API not reachable');
  await setStockMode(request, account, 'advanced');
});

test('CAT-04 empty state, create and rename a category, duplicate name inline, axe', async ({ page }) => {
  await loginHome(page, account);
  await page.goto('/fr/categories');
  await expect(page.getByRole('heading', { name: 'Catégories & unités' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aucune catégorie' })).toBeVisible();
  await expect(page.getByTestId('units').locator('[data-system]')).toHaveCount(7);
  await expectNoA11yViolations(page);

  // create (the sheet is in the URL)
  await page.getByTestId('new-category').click();
  await expect(page).toHaveURL(/sheet=new/);
  const sheet = page.getByRole('dialog');
  await sheet.locator('#category-name').fill(NAME);
  await sheet.locator('#category-description').fill('Robes, ensembles, kimonos');
  await sheet.locator('[data-color="#fbbf24"]').click();
  await page.getByTestId('category-save').click();
  await expect(page.locator(category(NAME))).toContainText('Robes, ensembles, kimonos');
  await expect(page).not.toHaveURL(/sheet=/);

  // duplicate name: inline under the field, content preserved
  await page.getByTestId('new-category').click();
  await sheet.locator('#category-name').fill(NAME);
  await sheet.locator('#category-description').fill('Doublon');
  await page.getByTestId('category-save').click();
  await expect(sheet.getByRole('alert')).toContainText('Catégorie existante.');
  await expect(sheet.locator('#category-description')).toHaveValue('Doublon');
  await sheet.getByRole('button', { name: 'Annuler' }).click();
  await page.getByRole('button', { name: 'Quitter' }).click();
  await expect(sheet).toHaveCount(0);

  // rename through Actions ⌄
  await page.locator(category(NAME)).getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Modifier' }).click();
  await expect(sheet.locator('#category-name')).toHaveValue(NAME);
  await sheet.locator('#category-name').fill(RENAMED);
  await page.getByTestId('category-save').click();
  await expect(page.locator(category(RENAMED))).toBeVisible();
  await expect(page.locator(category(NAME))).toHaveCount(0);
  await expectNoA11yViolations(page);

  // 2 levels max: a sub-category of a root, shown indented under it
  await page.getByTestId('new-category').click();
  await sheet.locator('#category-name').fill(`Robes ${tag}`);
  await sheet.locator('#category-parent').selectOption({ label: RENAMED });
  await page.getByTestId('category-save').click();
  await expect(page.locator(category(`Robes ${tag}`))).toHaveAttribute('data-depth', '1');
});

test('AT-CAT-06 delete a category used by a product: reassign dialog, then gone and the product shows the new category', async ({ page, request }) => {
  const used = await seedCategory(request, account, USED, { color: '#fb923c' });
  await seedCategory(request, account, TARGET, { color: '#60a5fa' });
  productId = (await seedProduct(request, account, { name: PRODUCT, price: 5200, stock: 4, categoryId: used.id })).id;

  await loginHome(page, account);
  await page.goto('/fr/categories');
  const row = page.locator(category(USED));
  await expect(row).toContainText('1');
  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Supprimer' }).click();
  const dialog = page.getByTestId('delete-dialog');
  await expect(dialog).toHaveAttribute('data-mode', 'reassign');
  await expect(dialog).toContainText('1 produit utilise cette catégorie.');
  // UX-051: nothing preselected, the button waits for a choice
  await expect(dialog.locator('#reassign-to')).toHaveValue('');
  await expect(page.getByTestId('taxonomy-delete')).toBeDisabled();
  await dialog.locator('#reassign-to').selectOption({ label: TARGET });
  await page.getByRole('button', { name: 'Réassigner et supprimer' }).click();
  await expect(page.locator(category(USED))).toHaveCount(0);
  await expect(page.locator(category(TARGET))).toContainText('1');

  await page.goto(`/fr/products/${productId}`);
  await expect(page.getByTestId('product-sub')).toContainText(TARGET);
});

test('CAT-04 units: system units are read-only, a custom unit is created then deleted', async ({ page }) => {
  await loginHome(page, account);
  await page.goto('/fr/categories');
  const units = page.getByTestId('units');
  // system unit: both actions greyed with the reason
  const piece = units.locator('[data-system]').first();
  await expect(piece).toContainText('SYSTÈME · LECTURE SEULE');
  await piece.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Modifier' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('menuitem', { name: 'Supprimer' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('menu')).toContainText('UNIT_SYSTEM_READONLY');
  await page.keyboard.press('Escape');

  // create: required fields inline, then "6 × <first system unit>"
  await page.getByTestId('new-unit').click();
  const dialog = page.getByRole('dialog');
  await page.getByTestId('unit-save').click();
  await expect(dialog.getByRole('alert').first()).toContainText('Champ requis');
  await dialog.locator('#unit-name').fill(UNIT);
  await dialog.locator('#unit-abbreviation').fill('bt6');
  await dialog.locator('#unit-contains').fill('6');
  await dialog.locator('#unit-base').selectOption({ index: 1 });
  await page.getByTestId('unit-save').click();
  const custom = units.locator(`[data-unit="${UNIT}"]`);
  await expect(custom).toContainText('PERSONNALISÉE');
  await expect(custom).toContainText('6 ×');

  // delete (unused): plain confirmation
  await custom.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Supprimer' }).click();
  await expect(page.getByTestId('delete-dialog')).toHaveAttribute('data-mode', 'confirm');
  await page.getByTestId('taxonomy-delete').click();
  await expect(custom).toHaveCount(0);
});
