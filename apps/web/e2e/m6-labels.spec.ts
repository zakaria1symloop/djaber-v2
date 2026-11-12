// M6 — labels (Figma "DLV-06 / ORD-09 — Labels viewer (single · merged job · Djaber fallback)", DLG "Imprimer les
// bordereaux", DLG II "Bordereau indisponible", "Annuler le colis"), self-delivery (D14 / D15) and the product label
// sheet (M2 carry-over). Real API + worker with the fake courier driver: nothing is mocked.
import { expect, test } from '@playwright/test';
import { apiReady, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { apiCall, getOrder, open, row, seedProduct, shopOwner } from './support/m5-orders';
import { confirmedOrder, deliveryReady, seedCourier, sendOrder, type Courier } from './support/m6';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let product: { id: string; name: string };
let zr: Courier;
let eco: Courier;

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await shopOwner(request, 'm6lbl');
  test.skip(!(await deliveryReady(request, owner)), 'delivery module (M6) not served');
  product = await seedProduct(request, owner, 'Montre Classic', 6000, 200);
  zr = await seedCourier(request, owner, { provider: 'zrexpress', isDefault: true });
  eco = await seedCourier(request, owner, { provider: 'ecotrack', isDefault: false });
});
test.beforeEach(async ({ page }) => {
  await signIn(page, owner);
});

test('AT-DLV-08 — ZR Express has no label API ⇒ LABEL_UNAVAILABLE + Djaber fallback label; merged labels for 10 orders (one PDF job)', async ({ page, request }) => {
  const one = await confirmedOrder(request, owner, product.id, { name: 'Lina Saidi' });
  await sendOrder(request, owner, one.id, zr.id);
  await open(page, `/fr/orders/${one.id}`, () => page.getByTestId('order-label'));
  await page.getByTestId('order-label').click();
  const viewer = page.getByTestId('label-viewer');
  await expect(viewer).toHaveAttribute('data-state', 'fallback', { timeout: 30_000 });
  await expect(page.getByTestId('label-unavailable')).toContainText(errText('LABEL_UNAVAILABLE'));
  await expect(viewer).toContainText('Bordereau Djaber');
  await expect(page.getByTestId('label-frame')).toHaveAttribute('src', /\S+/);
  await page.keyboard.press('Escape');

  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const o = await confirmedOrder(request, owner, product.id, { name: `Client lot ${i + 1}` });
    await sendOrder(request, owner, o.id, i % 2 ? eco.id : zr.id);
    ids.push(o.id);
  }
  await open(page, `/fr/orders?ids=${ids.join(',')}`, () => row(page, ids[0]!));
  for (const id of ids) await row(page, id).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Bordereaux' }).click();
  await expect(page.getByTestId('labels-dialog')).toBeVisible();
  await expect(page.getByTestId('labels-ignored')).toHaveCount(0);
  await page.getByTestId('labels-submit').click();
  const job = page.getByTestId('labels-job');
  await expect(job).toHaveAttribute('data-state', /ready|partial/, { timeout: 120_000 });
  await expect(job).toContainText('10 pages');
});

test('AT-DLV-13 — cancel the parcel before pickup (back to Confirmée); labels on 6 orders with 2 unsent ⇒ 4 labels + 2 rows SHIPMENT_NOT_CREATED; thermal 100 × 150; "bordereau imprimé" set', async ({ page, request }) => {
  const c = await confirmedOrder(request, owner, product.id, { name: 'Nadia Ferhat' });
  await sendOrder(request, owner, c.id, eco.id);
  await open(page, `/fr/orders/${c.id}`, () => page.getByTestId('delivery-block'));
  await page.getByTestId('delivery-block').getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('menuitem', { name: "Annuler l'expédition" }).click();
  await expect(page.getByTestId('cancel-parcel-dialog').getByRole('radio', { name: /Confirmée/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('dialog-submit').click();
  await expect.poll(async () => (await getOrder(request, owner, c.id)).status, { timeout: 60_000 }).toBe('confirmed');

  const sent: string[] = [];
  for (let i = 0; i < 4; i++) {
    const o = await confirmedOrder(request, owner, product.id, { name: `Envoyée ${i + 1}` });
    await sendOrder(request, owner, o.id, eco.id);
    sent.push(o.id);
  }
  const unsent = [(await confirmedOrder(request, owner, product.id, { name: 'Pas envoyée A' })).id, (await confirmedOrder(request, owner, product.id, { name: 'Pas envoyée B' })).id];
  const all = [...sent, ...unsent];
  await open(page, `/fr/delivery?tab=all&ids=${all.join(',')}`, () => row(page, all[0]!));
  for (const id of all) await row(page, id).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Bordereaux' }).click();
  await expect(page.getByTestId('labels-ignored')).toContainText('2 commandes ignorées');
  await expect(page.getByTestId('labels-dialog')).toContainText(errText('SHIPMENT_NOT_CREATED'));
  await page.getByTestId('labels-dialog').getByRole('radio', { name: /100 × 150/ }).click();
  await expect(page.getByTestId('labels-submit')).toHaveText('Imprimer (4)');
  await page.getByTestId('labels-submit').click();
  const job = page.getByTestId('labels-job');
  await expect(job).toHaveAttribute('data-state', 'partial', { timeout: 120_000 });
  await expect(page.getByTestId('labels-skipped').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('labels-skipped')).toContainText(errText('SHIPMENT_NOT_CREATED'));
  // "Marquer « bordereau imprimé »" (ticked by default) ⇒ labelPrintedAt on the printed orders
  const rows = await apiCall<{ orderId: string; labelPrintedAt: string | null }[]>(request, owner, 'GET', `/shipments?ids=${all.join(',')}&pageSize=25`);
  for (const id of sent) expect(rows.data.find((r) => r.orderId === id)?.labelPrintedAt, id).toBeTruthy();
});

test('AT-DLV-14 — Livraison propre: shipped by hand (optional tracking), Djaber label, manual status; change courier keeps the customer fee', async ({ page, request }) => {
  const o = await confirmedOrder(request, owner, product.id, { name: 'Yacine Mansouri' });
  const before = await getOrder(request, owner, o.id);
  await open(page, `/fr/orders/${o.id}`, () => page.getByTestId('ship-manual'));
  await page.getByTestId('ship-manual').click();
  await page.locator('#ship-tracking').fill('LIV-0042');
  await page.getByTestId('dialog-submit').click();
  await expect.poll(async () => (await getOrder(request, owner, o.id)).status, { timeout: 30_000 }).toBe('shipped');
  await expect(page.getByTestId('delivery-block')).toContainText('Livraison propre');
  await expect(page.getByTestId('tracking-number')).toHaveText('LIV-0042');
  // Djaber label, no fallback notice
  await page.getByTestId('order-label').click();
  await expect(page.getByTestId('label-viewer')).toHaveAttribute('data-state', 'courier', { timeout: 30_000 });
  await expect(page.getByTestId('label-unavailable')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // manual status only: no "Actualiser" for a self-delivered parcel; delivered by hand
  await expect(page.getByTestId('order-sync')).toHaveCount(0);
  await page.getByTestId('delivery-block').getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('menuitem', { name: 'Marquer livrée manuellement' }).click();
  await page.getByTestId('dialog-submit').click();
  await expect.poll(async () => (await getOrder(request, owner, o.id)).status, { timeout: 30_000 }).toBe('delivered');
  expect((await getOrder(request, owner, o.id)).deliveryFee).toBe(before.deliveryFee);

  // change courier (self-delivered parcel handed to a courier): courier cost recomputed, customer fee unchanged (D15)
  const q = await confirmedOrder(request, owner, product.id, { name: 'Sara Kaci' });
  const fee = (await getOrder(request, owner, q.id)).deliveryFee;
  const shipped = await apiCall(request, owner, 'POST', `/orders/${q.id}/ship-manual`, { trackingNumber: null, version: (await getOrder(request, owner, q.id)).version });
  expect(shipped.status, JSON.stringify(shipped.error)).toBeLessThan(300);
  await open(page, `/fr/orders/${q.id}`, () => page.getByTestId('delivery-block'));
  await page.getByTestId('delivery-block').getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('menuitem', { name: 'Changer de transporteur' }).click();
  await page.getByTestId('change-courier-dialog').getByRole('radio', { name: /EcoTrack/ }).click();
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('delivery-block')).toHaveAttribute('data-parcel', 'sent', { timeout: 60_000 });
  await expect(page.getByTestId('tracking-number')).toContainText(/^ECO-/, { timeout: 60_000 });
  expect((await getOrder(request, owner, q.id)).deliveryFee).toBe(fee);
});

test('M2 carry-over — product label sheet: bulk "Étiquettes" from /products (job → PDF)', async ({ page }) => {
  await open(page, '/fr/products', () => page.locator(`tr[data-row="${product.id}"]`));
  await page.locator(`tr[data-row="${product.id}"]`).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Étiquettes' }).click();
  await expect(page.getByTestId('product-labels-dialog')).toBeVisible();
  await page.locator('#lbl-copies').fill('2');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByText('Étiquettes prêtes')).toBeVisible({ timeout: 120_000 });
});
