// M7 — /suppliers (Figma "GDS-06 — Suppliers — list + detail sheet", DLG GDS "Nouveau fournisseur", "Enregistrer un
// paiement fournisseur"): list with filters in the URL, detail sheet, payment allocated to the oldest purchase with its
// locked cash row, delete refused while purchases exist (SUPPLIER_HAS_PURCHASES → Désactiver), Operator 403.
// Real API: nothing is mocked.
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { operatorOf } from './support/m4-inbox';
import { open, row } from './support/m5-orders';
import { algiersToday, gdsOwner, gdsReady, getJson, openRowMenu, product, purchase, receiveAll, supplier, type SeedProduct, type SeedSupplier } from './support/m7';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let oud: SeedProduct;
let belkacem: SeedSupplier;

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await gdsOwner(request, 'm7sup');
  test.skip(!(await gdsReady(request, owner)), 'GDS operations (M7) not served');
  oud = await product(request, owner, { name: 'Parfum Oud 100 ml', price: 4500, cost: 1500, stock: 12 });
  belkacem = await supplier(request, owner, 'Belkacem Import', { phone: '0550123456', email: 'belkacem@import.dz', terms: 'Paiement à 30 j', paymentTermsDays: 30 });
});

test('GDS-06 — empty state, then list with KPIs of the sheet, filters in the URL; axe', async ({ page, request }) => {
  const empty = await gdsOwner(request, 'm7supempty');
  await signIn(page, empty);
  await open(page, '/fr/suppliers', () => page.getByText('Aucun fournisseur'));
  await expectNoA11yViolations(page);

  const p = await purchase(request, owner, { supplierId: belkacem.id, lines: [{ productId: oud.id, quantity: 10, unitCost: 1500 }] });
  await receiveAll(request, owner, p);
  await page.context().clearCookies();
  await signIn(page, owner);
  await open(page, '/fr/suppliers', () => row(page, belkacem.id));
  await expect(row(page, belkacem.id)).toContainText('Belkacem Import');
  await expect(row(page, belkacem.id)).toContainText(/15\s?000/);

  // "Solde dû" chip → URL; the sheet opens on ?sheet=
  await page.getByRole('button', { name: /^Solde dû/ }).click();
  await page.getByRole('radio', { name: 'Avec un solde dû' }).click();
  await expect(page).toHaveURL(/hasBalance=1/);
  await page.keyboard.press('Escape');
  await row(page, belkacem.id).click();
  await expect(page).toHaveURL(new RegExp(`sheet=${belkacem.id}`));
  const sheet = page.getByTestId('supplier-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-kpi="balance"]')).toContainText(/15\s?000/);
  await expect(sheet.getByTestId('supplier-purchases')).toContainText(p.number);
  await expect(sheet).toContainText('Paiement à 30 j');
});

test('AT-DLG-30 — Nouveau fournisseur (terms saved) · Paiement fournisseur: > due refused, oldest first, locked cash row', async ({ page, request }) => {
  await signIn(page, owner);
  await open(page, '/fr/suppliers', () => page.getByTestId('supplier-new'));
  await page.getByTestId('supplier-new').click();
  const dlg = page.getByTestId('supplier-dialog');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(dlg.getByRole('alert').first()).toBeVisible(); // name required
  await dlg.getByLabel('Nom').fill('Textile Sétif');
  await dlg.getByLabel('Téléphone').fill('0661987654');
  await dlg.getByLabel('Délai de paiement (j)').fill('30');
  await dlg.getByLabel('Délai de livraison moyen (j)').fill('5');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page.locator('[data-toast]').filter({ hasText: 'Textile Sétif' })).toBeVisible();
  const list = await getJson<{ id: string; name: string }[]>(request, owner, '/suppliers?q=Textile');
  const textile = list.find((s) => s.name === 'Textile Sétif')!;
  const full = await getJson<{ paymentTermsDays: number; avgLeadDays: number }>(request, owner, `/suppliers/${textile.id}`);
  expect(full.paymentTermsDays).toBe(30);
  expect(full.avgLeadDays).toBe(5);

  // two received purchases, nothing paid: 4 000 + 6 000 due
  const p1 = await receiveAll(request, owner, await purchase(request, owner, { supplierId: textile.id, lines: [{ productId: oud.id, quantity: 4, unitCost: 1000 }] }));
  const p2 = await receiveAll(request, owner, await purchase(request, owner, { supplierId: textile.id, lines: [{ productId: oud.id, quantity: 6, unitCost: 1000 }] }));
  await open(page, `/fr/suppliers?sheet=${textile.id}`, () => page.getByTestId('supplier-pay'));
  await page.getByTestId('supplier-pay').click();
  const pay = page.getByTestId('supplier-payment-dialog');
  await expect(pay.getByLabel('Montant (DA)')).toHaveValue(/10\s?000/);
  await pay.getByLabel('Montant (DA)').fill('12000');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(pay.getByText(/supérieur au solde dû/)).toBeVisible();
  await pay.getByLabel('Montant (DA)').fill('5000');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page.locator('[data-toast]').filter({ hasText: /Paiement de 5\s?000/ })).toBeVisible();

  // oldest first: p1 fully paid (4 000), p2 gets 1 000; one locked cash row per purchase touched
  expect((await getJson<{ remaining: number }>(request, owner, `/purchases/${p1.id}`)).remaining).toBe(0);
  expect((await getJson<{ remaining: number }>(request, owner, `/purchases/${p2.id}`)).remaining).toBe(5000);
  const cash = await getJson<{ category: string; isAutomatic: boolean; amount: number; reference: { id: string } | null }[]>(request, owner, `/cash?day=${algiersToday()}&category=purchase`);
  expect(cash.filter((c) => c.isAutomatic && c.reference && [p1.id, p2.id].includes(c.reference.id)).map((c) => c.amount).sort()).toEqual([1000, 4000]);
});

test('AT-GDS-13 — delete a supplier with purchases ⇒ SUPPLIER_HAS_PURCHASES greyed → Désactiver', async ({ page, request }) => {
  await purchase(request, owner, { supplierId: belkacem.id, lines: [{ productId: oud.id, quantity: 1, unitCost: 1500 }] });
  await signIn(page, owner);
  await open(page, '/fr/suppliers', () => row(page, belkacem.id));
  const menu = await openRowMenu(page, belkacem.id);
  await expect(menu.locator('[data-action="delete"]')).toHaveAttribute('data-disabled', '');
  await expect(menu).toContainText(errText('SUPPLIER_HAS_PURCHASES'));
  await menu.locator('[data-action="deactivate"]').click();
  await expect(page.locator('[data-toast]').filter({ hasText: 'Belkacem Import désactivé' })).toBeVisible();
  await expect(row(page, belkacem.id)).toContainText('Inactif');
  // an inactive supplier is not offered by the purchase form: "Nouvel achat" stays visible, greyed with its reason
  const inactiveMenu = await openRowMenu(page, belkacem.id);
  await expect(inactiveMenu.locator('[data-action="new_purchase"]')).toHaveAttribute('data-disabled', '');
  await expect(inactiveMenu).toContainText('Fournisseur désactivé : réactivez-le pour lui passer un achat.');
  await page.keyboard.press('Escape');
  await (await openRowMenu(page, belkacem.id)).locator('[data-action="activate"]').click();
  await expect(row(page, belkacem.id)).not.toContainText('Inactif');
});

test('GDS-06 — Operator: no sidebar entry and 403 on /suppliers (gds.read = Admin+)', async ({ page, request }) => {
  const op = await operatorOf(request, owner, 'm7sup-op');
  await signIn(page, op);
  await page.goto('/fr/suppliers');
  await expect(page.getByText('403').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Fournisseurs' })).toHaveCount(0);
});
