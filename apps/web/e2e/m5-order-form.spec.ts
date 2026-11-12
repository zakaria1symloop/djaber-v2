// M5 — new order form (`/orders/new`, Figma "ORD-02 — New order — form (client conflict, variant, fee quote)" + AR).
// UI side of AT-ORD-09 (fee grid / free / not served / Admin override), AT-ORD-14 (risk badge), AT-ORD-17 (confirmed
// without address), AT-CLI-02 (phone conflict → use existing), AT-UX-04 (server error inline, content preserved),
// variant required, insufficient stock, `?clientId` prefill, leave guard, Operator (no fee override), RTL, axe.
// Real API on :4010 (fake adapters); no state here needs a mock.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, expectUrl, loginHome, type Account } from './support/m1';
import { catalogReady, seedProduct, sku } from './support/m2';
import { inviteOperator } from './support/m3-inbox';
import { addProduct, firstCommune, formatMobile, getOrder, markRisky, ordersReady, pickCombo, seedClient, seedFeeGrid, uniqueMobile } from './support/m5-order-form';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial' });

let owner: Account;
let operator: Account;
const tag = sku('OF');
const foulard = `Foulard soie ${tag}`;
const robe = `La Robe satin ${tag}`;
let amina: { id: string; name: string; phone: string };
let risky: { id: string; name: string; phone: string };
let commune16: { id: number; nameFr: string };

const open = async (page: Page, query = '') => {
  await page.goto(`/fr/orders/new${query}`);
  await expect(page.getByRole('heading', { name: 'Nouvelle commande', level: 1 })).toBeVisible();
};
const pickClient = async (page: Page, q: string, name: string) => {
  await page.locator('#client-search').fill(q);
  await page
    .getByTestId('client-results')
    .getByRole('button', { name: new RegExp(name) })
    .click();
  await expect(page.getByTestId('picked-client')).toContainText(name);
};

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await createAccount(request, { prefix: 'of', finishOnboarding: true });
  test.skip(!(await catalogReady(request, owner)), 'M2 catalogue API not reachable');
  test.skip(!(await ordersReady(request, owner)), 'M5 orders API not reachable (GET /orders, GET /delivery/fees/quote)');
  await seedFeeGrid(request, owner);
  commune16 = await firstCommune(request, owner, 16);
  await seedProduct(request, owner, { name: foulard, sku: sku('FS'), price: 2400, stock: 41 });
  await seedProduct(request, owner, {
    name: robe,
    sku: sku('RS'),
    price: 4900,
    variants: [
      { name: 'Noir · M', price: 4900, stock: 1 },
      { name: 'Blanc · S', price: 4900, stock: 8 },
    ],
  });
  amina = await seedClient(request, owner, {
    name: 'Amina Belkacem',
    phone: uniqueMobile(),
    address: {
      wilayaId: 16,
      communeId: commune16.id,
      address: 'Cité 500 logements, bât. 12',
      isStopdesk: false,
    },
  });
  risky = await seedClient(request, owner, { name: 'Karim Djabbar', phone: uniqueMobile() });
  await markRisky(request, owner, risky.id);
  operator = await inviteOperator(request, owner, 'Nadia');
});

test('default state: client picker, items, delivery, payment, summary rail — axe clean', async ({ page }) => {
  await loginHome(page, owner);
  await open(page);
  await expect(page.locator('[data-section="client"]')).toContainText('REQUIS : NOM + TÉLÉPHONE');
  await expect(page.getByTestId('no-lines')).toBeVisible();
  await expect(page.getByTestId('fee-title')).toHaveText('Choisissez la wilaya pour calculer les frais');
  await expect(page.getByTestId('validation-checklist')).toContainText('Client : nom + téléphone valides');
  await expect(page.getByTestId('fee-override')).toHaveCount(0); // no wilaya yet
  await expect(page).toHaveTitle(/Nouvelle commande · Djaber\.ai/);
  await expectNoA11yViolations(page);
});

test('AT-ORD-09 fee: grid 400, free from 5 000 DA, stop-desk, wilaya not served, Admin override saved', async ({ page, request }) => {
  await loginHome(page, owner);
  await open(page);
  await pickClient(page, amina.phone.slice(0, 6), 'Amina Belkacem');
  // the default address of the client is prefilled
  await expect(page.locator('#address')).toHaveValue('Cité 500 logements, bât. 12');
  await addProduct(page, foulard);
  await expect(page.getByTestId('fee-title')).toHaveText('Frais de livraison client : 400 DA');
  await expect(page.getByTestId('fee-quote')).toContainText('GRILLE');
  // 3 × 2 400 = 7 200 ≥ 5 000 ⇒ free
  await page.getByRole('button', { name: 'Augmenter la quantité' }).first().click();
  await page.getByRole('button', { name: 'Augmenter la quantité' }).first().click();
  await expect(page.getByTestId('fee-title')).toHaveText('Frais de livraison client : 0 DA (offerte)');
  await expect(page.getByTestId('order-totals')).toContainText('7 200 DA');
  // wilaya 33 is inactive in the grid
  await pickCombo(page, 'wilayaId', '33 ·');
  await expect(page.getByTestId('fee-title')).toHaveText('Wilaya non desservie');
  await expect(page.getByTestId('fee-quote')).toContainText(errText('WILAYA_NOT_SERVED'));
  await expect(page.locator('[data-check="notServed"]')).toBeVisible();
  // back to Alger, stop-desk, then the Admin override
  await pickCombo(page, 'wilayaId', '16 ·');
  await pickCombo(page, 'communeId', commune16.nameFr);
  await page.getByRole('radio', { name: 'Stop-desk' }).click();
  await page.getByTestId('fee-override').click();
  await page.locator('#feeOverride').fill('300');
  await expect(page.getByTestId('fee-title')).toHaveText('Frais de livraison client : 300 DA');
  await page.getByTestId('form-save').click();
  await expectUrl(page, /\/fr\/orders\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  const order = await getOrder(request, owner, id);
  expect(order.deliveryFee).toBe(300);
  expect(order.client.id).toBe(amina.id);
});

test('AT-CLI-02 phone conflict: "+213 …" of an existing client ⇒ notice + "Utiliser ce client"', async ({ page }) => {
  await loginHome(page, owner);
  await open(page);
  await page.locator('#client-search').fill('Nouvelle');
  await page.getByTestId('client-create').click();
  await page.locator('#client-name').fill('Amina B.');
  await page.locator('#client-phone').fill(`+213 ${amina.phone.slice(1, 4)} ${amina.phone.slice(4, 6)} ${amina.phone.slice(6, 8)} ${amina.phone.slice(8)}`);
  await expect(page.locator('[data-section="client"]')).toContainText(`Normalisé : ${amina.phone} · mobile DZ valide`);
  const notice = page.getByTestId('phone-conflict');
  await expect(notice).toContainText('Ce numéro appartient déjà à Amina Belkacem');
  await expect(notice).toContainText(errText('CLIENT_PHONE_EXISTS'));
  await page.getByRole('button', { name: 'Utiliser ce client' }).click();
  await expect(page.getByTestId('picked-client')).toContainText('Amina Belkacem');
  await expect(page.getByTestId('picked-client')).toContainText(formatMobile(amina.phone));
});

test('AT-ORD-14 risk badge on a picked client', async ({ page }) => {
  await loginHome(page, owner);
  await open(page);
  await pickClient(page, 'Karim', 'Karim Djabbar');
  await expect(page.getByTestId('picked-client')).toContainText('RISQUE');
});

test('AT-ORD-17 "Confirmée" without address ⇒ inline errors + summary, nothing sent', async ({ page }) => {
  await loginHome(page, owner);
  await open(page);
  await pickClient(page, 'Karim', 'Karim Djabbar');
  await addProduct(page, foulard);
  await page.getByRole('radio', { name: /Confirmée/ }).click();
  let posted = false;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/v1\/orders$/.test(r.url())) posted = true;
  });
  await page.getByTestId('form-save').click();
  const summary = page.getByTestId('validation-summary');
  await expect(summary).toContainText('Validation : 2 erreurs');
  await expect(summary).toContainText('Wilaya');
  await expect(summary).toContainText('Adresse');
  await expect(page.locator('[data-section="delivery"]')).toContainText('Adresse requise (10 caractères min)');
  await expect(page.locator('#wilayaId')).toBeFocused();
  expect(posted).toBe(false);
  await expect(page.locator('[data-check="address"]')).toHaveAttribute('data-state', 'missing');
});

test('variant required, then insufficient stock: server error on the line, content preserved (AT-UX-04)', async ({ page }) => {
  await loginHome(page, owner);
  await open(page);
  await pickClient(page, 'Karim', 'Karim Djabbar');
  await addProduct(page, robe);
  await page.getByTestId('form-save').click();
  await expect(page.getByTestId('order-lines')).toContainText('Choisissez une variante.');
  await expect(page.locator('[data-check="variants"]')).toHaveAttribute('data-state', 'missing');
  // Noir · M has 1 unit: the last-unit warning, then 2 units = insufficient
  await page.locator('#line-0-variant').selectOption({ label: 'Noir · M (stock 1)' });
  await expect(page.getByTestId('order-lines')).toContainText('Dernière unité de cette variante');
  await page.getByRole('button', { name: 'Augmenter la quantité' }).first().click();
  await expect(page.getByTestId('order-lines')).toContainText('Stock insuffisant');
  await page.locator('#notes').fill('Livrer le matin');
  await page.getByTestId('form-save').click();
  // refused by the server on the line; the form keeps everything that was typed
  await expect(page.locator('[data-section="items"]').getByRole('alert').first()).toContainText(/Stock insuffisant|INSUFFICIENT_STOCK/);
  await expect(page).toHaveURL(/\/orders\/new$/);
  await expect(page.getByTestId('picked-client')).toContainText('Karim Djabbar');
  await expect(page.locator('#notes')).toHaveValue('Livrer le matin');
  await expect(page.getByTestId('order-lines')).toContainText(robe);
});

test('?clientId prefill: client card and default address; new order saved as "Nouvelle"', async ({ page, request }) => {
  await loginHome(page, owner);
  await open(page, `?clientId=${amina.id}`);
  await expect(page.getByTestId('picked-client')).toContainText('Amina Belkacem');
  await expect(page.locator('#address')).toHaveValue('Cité 500 logements, bât. 12');
  await expect(page.locator('#wilayaId')).toContainText('16 ·');
  await expect(page.locator('[data-section="delivery"]')).toContainText("Préremplie depuis l'adresse par défaut de la cliente");
  await addProduct(page, foulard);
  await page.getByTestId('save-later').click();
  await expectUrl(page, /\/fr\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Commande #.+ enregistrée/)).toBeVisible();
  const order = await getOrder(request, owner, page.url().split('/').pop()!);
  expect(order.status).toBe('new');
});

test('leave guard on a dirty form', async ({ page }) => {
  await loginHome(page, owner);
  await open(page);
  await page.locator('#client-search').fill('Sara');
  await page.getByTestId('client-create').click();
  await page.locator('#client-phone').fill('0770 23 11 48');
  await page.getByRole('link', { name: 'Commandes' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
  await page.getByRole('button', { name: 'Rester' }).click();
  await expect(page).toHaveURL(/\/orders\/new$/);
});

test('Operator: creates orders, but no fee override and no discount (orders.money)', async ({ page }) => {
  await loginHome(page, operator);
  await open(page);
  await pickClient(page, 'Karim', 'Karim Djabbar');
  await addProduct(page, foulard);
  await pickCombo(page, 'wilayaId', '16 ·');
  await expect(page.getByTestId('fee-title')).toHaveText('Frais de livraison client : 400 DA');
  await expect(page.getByTestId('fee-override')).toHaveCount(0);
  await expect(page.locator('#discount')).toHaveCount(0);
});

test('RTL: /ar/orders/new is mirrored, phones stay left-to-right', async ({ page }) => {
  await loginHome(page, owner, 'ar');
  await page.goto('/ar/orders/new');
  await expect(page.getByRole('heading', { name: 'طلب جديد', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#client-phone').locator('xpath=ancestor::div[@dir="ltr"][1]')).toHaveCount(1);
  await expect(page.getByTestId('order-totals')).toContainText('الملخص');
});
