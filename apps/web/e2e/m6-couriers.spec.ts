// M6 — /delivery/couriers (Figma "DLV-01/03 — Delivery — fee grid + couriers settings" couriers half, DLG II "Ajouter un
// transporteur" with its test states, "Supprimer le transporteur" blocked) and the "copy courier rates" action of the fee
// grid. Real API + worker with the fake courier driver: nothing is mocked.
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { apiCall, dialog, open, seedProduct, shopOwner } from './support/m5-orders';
import { confirmedOrder, deliveryReady, seedCourier, sendOrder } from './support/m6';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await shopOwner(request, 'm6cour');
  test.skip(!(await deliveryReady(request, owner)), 'delivery module (M6) not served');
});
test.beforeEach(async ({ page }) => {
  await signIn(page, owner);
});

test('AT-DLV-01 (couriers) — empty state, add ZR Express: per-provider fields, test OK, default card; axe', async ({ page }) => {
  await open(page, '/fr/delivery/couriers', () => page.getByTestId('couriers-page'));
  await expect(page.getByText('Aucun transporteur configuré').first()).toBeVisible();
  await expect(page.locator('[data-testid="courier-provider-card"]')).toHaveCount(3);
  await expectNoA11yViolations(page);

  await page.getByTestId('add-courier').click();
  const d = page.getByTestId('courier-dialog');
  await expect(d).toHaveAttribute('data-provider', 'zrexpress');
  // required fields per provider (DLV-03 fix)
  await page.getByTestId('dialog-submit').click();
  await expect(d.getByText('Champ requis').first()).toBeVisible();
  // EcoTrack asks for the instance URL, Livraison propre for nothing
  await d.getByRole('radio', { name: 'EcoTrack' }).click();
  await expect(page.locator('#cr-baseUrl')).toBeVisible();
  await d.getByRole('radio', { name: 'Livraison propre' }).click();
  await expect(d).toContainText("n'a pas de compte");
  await expect(page.locator('#cr-token')).toHaveCount(0);

  await d.getByRole('radio', { name: 'ZR Express' }).click();
  // two ZR platforms: the new one by default (API key + tenant id), Procolis on demand (token + key)
  await d.getByRole('radio', { name: 'Ancienne plateforme (Procolis)' }).click();
  await expect(page.locator('#cr-token')).toBeVisible();
  await d.getByRole('radio', { name: 'Nouvelle plateforme (zrexpress.app)' }).click();
  await expect(page.locator('#cr-token')).toHaveCount(0);
  await page.locator('#cr-apiKey').fill('e2e-key-ok');
  await page.locator('#cr-tenantId').fill('e2e-tenant-ok');
  await page.locator('#cr-sname').fill('Boutique Amel');
  await page.locator('#cr-sphone').fill('0550112233');
  await page.getByTestId('dialog-submit').click();
  // created, tested (fake: OK), closed
  await expect(d).toBeHidden({ timeout: 30_000 });
  const card = page.locator('[data-testid="courier-card"][data-courier="zrexpress"]');
  await expect(card).toContainText(/connecté/i);
  await expect(card).toContainText('PAR DÉFAUT');
  await expect(card).toContainText('CLÉ API + ID TENANT');
  await expect(card).toContainText('étiquette ✓');
  await expect(page.locator('[data-testid="courier-provider-card"]')).toHaveCount(2);
  // D9 auto-send: workspace setting next to the couriers
  await page.getByTestId('auto-send').getByRole('switch').click();
  await expect(page.getByText('Envoi automatique activé')).toBeVisible();
  await page.getByTestId('auto-send').getByRole('switch').click();
  await expect(page.getByText('Envoi automatique désactivé')).toBeVisible();
});

test('AT-DLV-01 (couriers) — test states: refused credentials (COURIER_CREDENTIALS_INVALID), unreachable courier saved anyway (COURIER_UNAVAILABLE)', async ({ page }) => {
  await open(page, '/fr/delivery/couriers', () => page.getByTestId('couriers-page'));
  await page.locator('[data-testid="courier-provider-card"][data-courier="yalidine"]').getByRole('button').click();
  const d = page.getByTestId('courier-dialog');
  await expect(d).toHaveAttribute('data-provider', 'yalidine');
  await page.locator('#cr-apiId').fill('invalid-id');
  await page.locator('#cr-apiToken').fill('invalid-token');
  await page.getByTestId('courier-dialog-test').click();
  await expect(d.getByTestId('courier-test')).toHaveAttribute('data-state', 'rejected', { timeout: 30_000 });
  await expect(d.getByTestId('courier-test')).toContainText('COURIER_CREDENTIALS_INVALID');
  // the account exists (saved before the test): the dialog stays in edit mode
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('[data-testid="courier-card"][data-courier="yalidine"]')).toContainText(/identifiants refusés/i);

  await page.locator('[data-testid="courier-provider-card"][data-courier="ecotrack"]').getByRole('button').click();
  await page.locator('#cr-baseUrl').fill('https://maystro.ecotrack.dz');
  await page.locator('#cr-token').fill('down-token');
  await page.getByTestId('dialog-submit').click();
  await expect(d.getByTestId('courier-test')).toHaveAttribute('data-state', 'unreachable', { timeout: 30_000 });
  await expect(d.getByTestId('courier-test')).toContainText('COURIER_UNAVAILABLE');
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('[data-testid="courier-card"][data-courier="ecotrack"]')).toBeVisible();
});

test('AT-DLV-01 (couriers) — delete blocked while parcels are on the way (COURIER_HAS_ACTIVE_SHIPMENTS) → Désactiver', async ({ page, request }) => {
  const p = await seedProduct(request, owner, 'Montre Classic', 6000);
  const o = await confirmedOrder(request, owner, p.id);
  const couriers = await apiCall<{ id: string; provider: string }[]>(request, owner, 'GET', '/delivery/couriers');
  const zr = couriers.data.find((c) => c.provider === 'zrexpress')!;
  await sendOrder(request, owner, o.id, zr.id);

  await open(page, '/fr/delivery/couriers', () => page.locator('[data-testid="courier-card"][data-courier="zrexpress"]'));
  const card = page.locator('[data-testid="courier-card"][data-courier="zrexpress"]');
  await card.getByTestId('courier-delete').click();
  await expect(page.getByTestId('delete-courier-dialog')).toHaveAttribute('data-blocked', 'true');
  await expect(page.getByTestId('courier-delete-blocked')).toContainText('COURIER_HAS_ACTIVE_SHIPMENTS');
  await page.getByTestId('courier-deactivate').click();
  await expect(card).toContainText(/inactif/i);
  // back on for the next specs
  await card.getByTestId('courier-toggle').click();
  await expect(card).not.toContainText(/inactif/i);
});

test('DLV-07 — fee grid "Copier depuis un transporteur": diff preview (domicile / stop-desk), apply all', async ({ page, request }) => {
  const owner2 = await shopOwner(request, 'm6rates');
  await seedCourier(request, owner2, { provider: 'zrexpress' });
  await page.context().clearCookies();
  await signIn(page, owner2);
  await open(page, '/fr/delivery/fees', () => page.getByTestId('fee-grid'));
  await page.getByTestId('fees-copy').click();
  const d = page.getByTestId('copy-rates-dialog');
  await expect(d.getByTestId('copy-rates-diff')).toBeVisible({ timeout: 60_000 });
  await expect(d.getByTestId('copy-rates-diff').locator('tbody tr').first()).toContainText('→');
  await dialog(page).getByTestId('dialog-submit').click();
  await expect(d).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('[data-source="custom"]').first()).toBeVisible();
});
