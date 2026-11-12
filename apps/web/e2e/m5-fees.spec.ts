// M5 — Delivery fee grid (DLV-01/02/09, Figma "DLV-01/03 — Delivery — fee grid + couriers settings" grid half,
// DLG II "Grille des frais — actions"). Real API; mocks only where marked `// mock:`.
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, expectUrl, loginHome, type Account } from './support/m1';
import { failWith, inviteOperator } from './support/m3-inbox';
import { feesReady, getFees, putFee } from './support/m5-clients';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial' });
let owner: Account;

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await createAccount(request, { prefix: 'fee', finishOnboarding: true });
  test.skip(!(await feesReady(request, owner)), 'M5 delivery API not reachable (GET /delivery/fees)');
});

test('AT-DLV-09 · 69 rows, inline edit saved on blur, fill missing keeps custom, reset all after confirm', async ({ page, request }) => {
  await loginHome(page, owner);
  // since M6 `/delivery` is the overview (DLV-08); the grid is its "Grille des frais" tab
  await page.goto('/fr/delivery');
  await page.locator('nav [data-tab="fees"]').click();
  await expectUrl(page, '**/fr/delivery/fees');
  await expect(page.getByRole('heading', { name: 'Tarifs & transporteurs', level: 1 })).toBeVisible();
  const grid = page.getByTestId('fee-grid');
  await expect(grid.locator('tbody tr')).toHaveCount(69);

  // edit Sétif home price: saved on blur, row becomes PERSONNALISÉ
  const setif = grid.locator('tr[data-wilaya="19"]');
  const home = setif.getByRole('textbox', { name: /DOMICILE · Sétif/ });
  await home.fill('450');
  await home.blur();
  await expect(setif).toHaveAttribute('data-source', 'custom');
  await expect(setif).toContainText('PERSONNALISÉ');
  expect((await getFees(request, owner)).data.find((r) => r.wilayaId === 19)?.homePrice).toBe(450);

  // "Compléter les manquants" keeps the custom row
  await page.getByTestId('fees-fill').click();
  await expect(page.getByText(/wilayas? complétées?|Aucune wilaya manquante/)).toBeVisible();
  await expect(setif.getByRole('textbox', { name: /DOMICILE · Sétif/ })).toHaveValue('450');

  // reset row ↺ back to default
  await setif.getByRole('button', { name: 'Réinitialiser la ligne (valeurs par défaut)' }).click();
  await expect(setif).toHaveAttribute('data-source', 'default');

  // "Tout réinitialiser" asks first
  await putFee(request, owner, 16, { homePrice: 999, stopdeskPrice: 250 });
  await page.reload();
  await expect(grid.locator('tr[data-wilaya="16"]')).toHaveAttribute('data-source', 'custom');
  await page.getByTestId('fees-reset-all').click();
  const confirm = page.getByRole('dialog', { name: 'Réinitialiser toute la grille ?' });
  await expect(confirm).toContainText('69 wilayas');
  await confirm.getByRole('button', { name: 'Réinitialiser la grille' }).click();
  await expect(page.getByText('Grille réinitialisée aux valeurs par défaut')).toBeVisible();
  await expect(grid.locator('tr[data-source="custom"]')).toHaveCount(0);
});

test('active toggle: a wilaya not served shows the note; reset of a default row is greyed (FEE_RULE_NOT_FOUND)', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/delivery/fees');
  const illizi = page.getByTestId('fee-grid').locator('tr[data-wilaya="33"]');
  await illizi.getByRole('switch', { name: /Wilaya desservie : Illizi/ }).click();
  await expect(illizi).toContainText("Non desservie — l'IA le dit au client");
  await illizi.getByRole('switch', { name: /Wilaya desservie : Illizi/ }).click();
  await expect(illizi).not.toContainText('Non desservie');
  const oran = page.getByTestId('fee-grid').locator('tr[data-wilaya="31"]');
  await expect(oran.getByRole('button', { name: 'Réinitialiser la ligne (valeurs par défaut)' })).toBeDisabled();
});

test('free-delivery rule: switching on writes the workspace threshold, search filters the rows', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/delivery/fees');
  await page.getByRole('switch', { name: 'Livraison offerte' }).click();
  await expect(page.getByText(/Livraison offerte à partir de 5\s000\sDA/)).toBeVisible();
  const amount = page.getByRole('textbox', { name: 'Seuil de livraison offerte (DA)' });
  await amount.fill('8000');
  await amount.blur();
  await expect(page.getByText(/Livraison offerte à partir de 8\s000\sDA/)).toBeVisible();
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('setif');
  await expect(page.getByTestId('fee-grid').locator('tbody tr')).toHaveCount(1);
});

test('AT-UX-04 · a refused write shows the error on the row and restores the value', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/delivery/fees');
  // mock: a validation refusal for one row
  await failWith(page, /\/api\/v1\/delivery\/fees\/25$/, 'PUT', 422, 'VALIDATION_ERROR', 'Prix invalide');
  const row = page.getByTestId('fee-grid').locator('tr[data-wilaya="25"]');
  const home = row.getByRole('textbox', { name: /DOMICILE · Constantine/ });
  const before = await home.inputValue();
  await home.fill('1234');
  await home.blur();
  await expect(row.getByRole('alert').last()).toContainText(errText('VALIDATION_ERROR'));
  await expect(home).toHaveValue(before);
});

test('AT-UX-03 · Operator: grid read-only with the reason, API refuses', async ({ page, request }) => {
  const operator = await inviteOperator(request, owner, 'Omar');
  await loginHome(page, operator);
  await page.goto('/fr/delivery/fees');
  await expect(page.getByTestId('fee-grid').locator('tbody tr')).toHaveCount(69);
  await expect(page.getByTestId('fees-fill')).toBeDisabled();
  await expect(page.getByTestId('fees-fill')).toHaveAttribute('title', /delivery\.manage/);
  await expect(page.getByTestId('fee-grid').locator('tr[data-wilaya="16"]').getByRole('textbox').first()).toBeDisabled();
  const res = await request.put('http://localhost:4010/api/v1/delivery/fees/16', { headers: { Authorization: `Bearer ${operator.accessToken}`, 'X-Workspace-Id': owner.workspaceId! }, data: { homePrice: 1, stopdeskPrice: 1 } });
  expect(res.status()).toBe(403);
});

test('DeliveryTabs: overview · fee grid · couriers (open since M6)', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/delivery/fees');
  const tabs = page.getByRole('navigation', { name: 'Livraison' });
  await expect(tabs.getByRole('link', { name: 'Grille des frais' })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Transporteurs' }).click();
  await expectUrl(page, '**/fr/delivery/couriers');
  await tabs.getByRole('link', { name: "Vue d'ensemble" }).click();
  await expectUrl(page, '**/fr/delivery');
});

test('a11y · /delivery/fees default state', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/delivery/fees');
  await expect(page.getByTestId('fee-grid').locator('tbody tr').first()).toBeVisible();
  await expectNoA11yViolations(page);
});
