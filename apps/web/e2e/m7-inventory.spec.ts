// M7 — /inventory (DLG GDS "Lancer un inventaire" / "Valider l'inventaire", 03 INV-01…03, 04 §19): start dialog with
// the scope sizes, one open count (INVENTORY_IN_PROGRESS), counting saved line by line, counter sales blocked
// (SALE_BLOCKED_BY_INVENTORY), note required above 10 % (INVENTORY_VARIANCE_NOTE_REQUIRED), validation ⇒ INVENTAIRE
// movements linked to #INV-n. Real API: nothing is mocked.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { apiCall, open } from './support/m5-orders';
import { gdsOwner, gdsReady, getJson, product, type SeedProduct } from './support/m7';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let baskets: SeedProduct;
let sac: SeedProduct;
let inventoryId: string;

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await gdsOwner(request, 'm7inv');
  test.skip(!(await gdsReady(request, owner)), 'GDS operations (M7) not served');
  baskets = await product(request, owner, { name: 'Baskets Air 42', price: 7800, cost: 4000, stock: 21, minStock: 25 });
  sac = await product(request, owner, { name: 'Sac cuir camel', price: 5000, cost: 2500, stock: 3, minStock: 5 });
  await product(request, owner, { name: 'Parfum Oud 100 ml', price: 4500, cost: 1500, stock: 40, minStock: 2 });
});

test('AT-INV-01 / AT-DLG-33 — start on "alerts" scope (sizes shown), blocking flag, second start refused; axe', async ({ page, request }) => {
  await signIn(page, owner);
  await open(page, '/fr/inventory', () => page.getByTestId('inventory-start'));
  await expectNoA11yViolations(page);
  await page.getByTestId('inventory-start').click();
  const dlg = page.getByTestId('inventory-start-dialog');
  await expect(dlg).toContainText(/Tout le stock \(3 produits/);
  await expect(dlg).toContainText('Produits en alerte seulement (2)');
  await dlg.getByRole('radio', { name: /Produits en alerte/ }).click();
  await dlg.getByRole('checkbox').check();
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page).toHaveURL(/\/fr\/inventory\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  inventoryId = page.url().split('/').pop()!;
  await expect(page.getByTestId('inventory-lines').locator('tbody tr')).toHaveCount(2);
  await expect(page.getByText(errText('SALE_BLOCKED_BY_INVENTORY'))).toBeVisible();

  // one open count per workspace; counter sales are blocked while it counts
  const again = await apiCall(request, owner, 'POST', '/inventories', { scope: 'all' });
  expect(again.status).toBe(409);
  expect(again.error?.code).toBe('INVENTORY_IN_PROGRESS');
  const blocked = await apiCall(request, owner, 'POST', '/sales', { items: [{ productId: sac.id, quantity: 1 }], amountPaid: 5000, paymentMethod: 'cash' }, { 'Idempotency-Key': randomUUID() });
  expect(blocked.error?.code).toBe('SALE_BLOCKED_BY_INVENTORY');
  await open(page, '/fr/inventory', () => page.getByTestId('inventory-open'));
  await expect(page.getByTestId('inventory-start')).toBeDisabled();
});

test('AT-INV-02 / AT-DLG-33 — count, note required above 10 %, validate ⇒ INVENTAIRE movements', async ({ page, request }) => {
  await signIn(page, owner);
  await open(page, `/fr/inventory/${inventoryId}`, () => page.getByTestId('inventory-lines'));
  const line = (id: string) => page.locator(`tr[data-line="${id}:"]`);
  await line(baskets.id).getByLabel(/Quantité comptée/).fill('18');
  await line(baskets.id).getByLabel(/Quantité comptée/).press('Enter');
  await expect(line(baskets.id)).toHaveAttribute('data-state', 'counted');
  await line(sac.id).getByLabel(/Quantité comptée/).fill('1');
  await line(sac.id).getByLabel(/Quantité comptée/).press('Enter');
  await expect(line(sac.id)).toHaveAttribute('data-state', 'counted');
  await expect(line(sac.id)).toContainText('⚠');

  await page.getByTestId('inventory-validate').click();
  const dlg = page.getByTestId('inventory-validate-dialog');
  await expect(page.getByRole('dialog')).toContainText('2 écarts');
  await expect(page.getByRole('dialog').getByTestId('dialog-submit')).toContainText('Valider (2 mouvements)');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(dlg).toContainText(errText('INVENTORY_VARIANCE_NOTE_REQUIRED'));
  await dlg.locator(`li[data-line="${baskets.id}:"]`).getByRole('textbox').fill('Paire abîmée retirée');
  await dlg.locator(`li[data-line="${sac.id}:"]`).getByRole('textbox').fill('2 pièces en vitrine non comptées');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page.locator('[data-toast]').filter({ hasText: /validé · 2 mouvements/ })).toBeVisible();
  await expect(page.getByText(/Inventaire validé le/)).toBeVisible();

  expect((await getJson<{ stock: number }>(request, owner, `/products/${baskets.id}`)).stock).toBe(18);
  const moves = await getJson<{ type: string; reference: { type: string; id: string } | null }[]>(request, owner, `/stock/movements?productId=${sac.id}&type=inventory`);
  expect(moves[0]?.reference).toMatchObject({ type: 'inventory', id: inventoryId });
  // the movements journal links the reference to the count (M2 carry-over)
  await open(page, `/fr/movements?productId=${sac.id}&type=inventory`, () => page.getByTestId('movement-kpis'));
  await page.getByRole('link', { name: /#INV-/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/fr/inventory/${inventoryId}`));
});
