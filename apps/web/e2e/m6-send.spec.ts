// M6 — sending to a courier (Figma "DLV-05 — Delivery — send to courier dialog (validation error)", "ORD-06" delivery
// block, "MECH — … bulk send results"). Real API + worker with the fake courier driver: the parcel is created by the
// worker job, the dialog follows it until `sent`; nothing is mocked.
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { dialog, getOrder, open, row, seedOrder, seedProduct, setStatus, shopOwner } from './support/m5-orders';
import { confirmedOrder, deliveryReady, orderWithUnknownCommune, seedCourier, sendOrder, type Courier } from './support/m6';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let product: { id: string; name: string };
let zr: Courier;
let eco: Courier;
const orderPage = (page: import('@playwright/test').Page, id: string) => open(page, `/fr/orders/${id}`, () => page.getByTestId('delivery-block'));

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await shopOwner(request, 'm6send');
  test.skip(!(await deliveryReady(request, owner)), 'delivery module (M6) not served');
  product = await seedProduct(request, owner, 'Robe satin', 4500, 50);
  zr = await seedCourier(request, owner, { provider: 'zrexpress', isDefault: true });
  eco = await seedCourier(request, owner, { provider: 'ecotrack', isDefault: false });
});
test.beforeEach(async ({ page }) => {
  await signIn(page, owner);
});

test('AT-DLV-01 — "Envoyer au transporteur" greyed on a new order (DELIVERY_ORDER_NOT_CONFIRMED); confirmed ⇒ dialog prefilled from the order, parcel created, tracking shown, order shipped', async ({ page, request }) => {
  const fresh = await seedOrder(request, owner, { productId: product.id });
  await orderPage(page, fresh.id);
  await expect(page.getByTestId('send-to-courier')).toBeDisabled();
  await expect(page.getByTestId('send-reason')).toContainText(errText('DELIVERY_ORDER_NOT_CONFIRMED'));

  const o = await confirmedOrder(request, owner, product.id);
  await orderPage(page, o.id);
  await expect(page.getByTestId('delivery-block')).toHaveAttribute('data-parcel', 'none');
  await page.getByTestId('send-to-courier').click();
  const d = page.getByTestId('send-dialog');
  await expect(d).toHaveAttribute('data-state', 'editing');
  await expect(d.getByRole('radio', { name: /ZR Express/ })).toHaveAttribute('aria-checked', 'true');
  // the ORDER's address (wilaya 16), never the sender default (wilaya 19)
  await expect(page.locator('#send-wilaya')).toContainText('Alger');
  await expect(page.locator('#send-address')).toHaveValue('Cité 500 logements, bât. 12, n° 4');
  await expectNoA11yViolations(page);
  await page.getByTestId('dialog-submit').click();
  await expect(d).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId('delivery-block')).toHaveAttribute('data-parcel', 'sent', { timeout: 30_000 });
  await expect(page.getByTestId('tracking-number')).toContainText(/^ZR-/);
  await expect.poll(async () => (await getOrder(request, owner, o.id)).status).toBe('shipped');
});

test('AT-DLV-02 — courier validation error (unknown commune) ⇒ inline on the commune field + "rien n\'a été créé", order unchanged', async ({ page, request }) => {
  const o = await orderWithUnknownCommune(request, owner, product.id);
  await orderPage(page, o.id);
  await page.getByTestId('send-to-courier').click();
  const d = page.getByTestId('send-dialog');
  await page.getByTestId('dialog-submit').click();
  await expect(d).toHaveAttribute('data-state', 'error', { timeout: 60_000 });
  await expect(page.getByTestId('send-error')).toContainText("rien n'a été créé chez le transporteur");
  // the field error sits on the commune field of the open dialog (form content preserved)
  await expect(dialog(page).locator('[aria-invalid="true"], [data-invalid="true"]').first()).toBeVisible();
  await expect(dialog(page)).toContainText('Inconnue Ouest');
  await expect(page.locator('#send-address')).toHaveValue('Rue des Frères Bouchama, n° 8');
  await expect.poll(async () => (await getOrder(request, owner, o.id)).status).toBe('confirmed');
  await page.getByRole('button', { name: 'Annuler' }).click();
  // the failed creation reads "Colis non créé" with "Corriger et renvoyer"
  await expect(page.getByTestId('delivery-block')).toHaveAttribute('data-parcel', 'failed');
  await expect(page.getByTestId('send-to-courier')).toHaveText('Corriger et renvoyer');
});

test('UX-064 — failed send, then the order is marked delivered by hand: LIVRAISON block « Livrée à la main » without any send button; Livraison greys « Corriger et renvoyer » with the readable reason', async ({ page, request }) => {
  const o = await orderWithUnknownCommune(request, owner, product.id);
  const parcel = await sendOrder(request, owner, o.id);
  expect(parcel.status).toBe('failed');
  await setStatus(request, owner, o.id, 'delivered');

  await orderPage(page, o.id);
  const block = page.getByTestId('delivery-block');
  await expect(block).toHaveAttribute('data-parcel', 'handled');
  await expect(block).toContainText('Livrée à la main');
  await expect(page.getByTestId('parcel-handled')).toContainText('cet envoi en échec est réglé');
  await expect(page.getByTestId('parcel-failed')).toHaveCount(0);
  await expect(page.getByTestId('send-to-courier')).toHaveCount(0);
  await expect(page.getByTestId('ship-manual')).toHaveCount(0);

  // Livraison › Toutes: neutral status, the send items greyed with the screen's words (never « delivered → shipped »)
  await open(page, `/fr/delivery?tab=all&ids=${o.id}`, () => row(page, o.id));
  await expect(row(page, o.id)).toContainText('Livrée à la main');
  await row(page, o.id).getByRole('button', { name: /Actions/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Corriger et renvoyer' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('menuitem', { name: 'Changer de transporteur' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('menu')).toContainText(errText('DELIVERY_ORDER_DELIVERED'));
  await expect(page.getByRole('menu')).not.toContainText('→');
  await page.keyboard.press('Escape');
  // not in « Échecs » any more
  await open(page, '/fr/delivery', () => page.locator('[data-kpi="failed"]'));
  await expect(row(page, o.id)).toHaveCount(0);
});

test('AT-DLV-03 — courier down (503) ⇒ parcel queued: "mis en attente", retries by the worker, order not shipped', async ({ page, request }) => {
  const owner2 = await shopOwner(request, 'm6down');
  const p2 = await seedProduct(request, owner2, 'Foulard soie', 1500);
  await seedCourier(request, owner2, { provider: 'zrexpress', token: 'down-e2e', test: false });
  const o = await confirmedOrder(request, owner2, p2.id);
  await page.context().clearCookies();
  await signIn(page, owner2);
  // mock: the fake courier driver can only be made unavailable in-process (`FakeCourierBackend.unavailable()`, used by
  // the API integration test of AT-DLV-03); from the browser the 202 parcel left `pending` with `COURIER_UNAVAILABLE`
  // (what the worker writes while it retries) is served here, and the order read carries that parcel.
  const queued = {
    id: '00000000-0000-4000-8000-0000000000d3',
    orderId: o.id,
    orderNumber: o.number,
    client: { id: '00000000-0000-4000-8000-0000000000c1', name: 'Amina Belkacem', phone: o.clientPhone, riskLevel: 'normal', isPlaceholder: false, blocked: false, orderCount: 1 },
    provider: 'zrexpress',
    courierAccount: { id: '00000000-0000-4000-8000-0000000000a1', displayName: 'ZR Express' },
    status: 'pending',
    trackingNumber: null,
    labelUrl: null,
    publicTrackingUrl: 'http://localhost:3010/s/x',
    codAmount: o.total,
    weightKg: null,
    contentSummary: null,
    address: { wilayaId: 16, wilayaName: 'Alger', communeId: null, communeText: null, address: 'Cité 500 logements', isStopdesk: false, stopdeskId: null },
    courierCost: null,
    failureReason: null,
    deliveryAttempts: 0,
    lastError: 'COURIER_UNAVAILABLE',
    error: { code: 'COURIER_UNAVAILABLE', field: null, message: 'HTTP 503' },
    lastSyncedAt: null,
    syncAvailableAt: null,
    portalUrl: null,
    lastEventAt: null,
    noMovement: false,
    returnPending: false,
    failureHandled: null,
    labelSource: 'djaber',
    events: [],
    createdAt: new Date().toISOString(),
    actions: [{ key: 'retry', enabled: true, primary: true }, { key: 'change_courier', enabled: true }, { key: 'cancel', enabled: true }, { key: 'open_order', enabled: true }],
  };
  let sent = false;
  await page.route(`**/api/v1/orders/${o.id}/shipments`, (r) => (r.request().method() === 'POST' ? ((sent = true), r.fulfill({ status: 202, json: { data: queued } })) : r.fallback()));
  await page.route(`**/api/v1/shipments/${queued.id}`, (r) => r.fulfill({ json: { data: queued } }));
  await page.route(`**/api/v1/orders/${o.id}`, async (r) => {
    if (!sent || r.request().method() !== 'GET') return r.fallback();
    const res = await r.fetch();
    const body = (await res.json()) as { data: Record<string, unknown> };
    body.data.shipments = [queued];
    body.data.deliveryStatus = 'pending';
    return r.fulfill({ response: res, json: body });
  });
  await orderPage(page, o.id);
  await page.getByTestId('send-to-courier').click();
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('send-dialog')).toHaveAttribute('data-state', 'queued', { timeout: 60_000 });
  await expect(page.getByTestId('send-queued')).toContainText('mis en attente');
  await page.getByTestId('send-close').click();
  await expect(page.getByTestId('delivery-block')).toHaveAttribute('data-parcel', 'queued');
  await expect(page.getByTestId('parcel-sending')).toContainText(errText('COURIER_UNAVAILABLE'));
  expect((await getOrder(request, owner2, o.id)).status).toBe('confirmed');
});

test('AT-DLV-07 — cancel the parcel before pickup ⇒ a second shipment is allowed; an order with an active parcel is listed as not sendable (DELIVERY_ORDER_ALREADY_SENT) in the bulk send', async ({ page, request }) => {
  const o = await confirmedOrder(request, owner, product.id, { name: 'Yacine Mansouri' });
  await sendOrder(request, owner, o.id, eco.id);
  await orderPage(page, o.id);
  await expect(page.getByTestId('delivery-block')).toHaveAttribute('data-parcel', 'sent');
  await page.getByTestId('delivery-block').getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('menuitem', { name: "Annuler l'expédition" }).click();
  await expect(page.getByTestId('cancel-parcel-dialog')).toBeVisible();
  await page.getByTestId('dialog-submit').click();
  await expect.poll(async () => (await getOrder(request, owner, o.id)).status, { timeout: 60_000 }).toBe('confirmed');
  await page.reload();
  // second shipment after a cancelled one
  await expect(page.getByTestId('send-to-courier')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('send-to-courier').click();
  await page.getByTestId('send-dialog').getByRole('radio', { name: /EcoTrack/ }).click();
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('send-dialog')).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId('delivery-block')).toHaveAttribute('data-parcel', 'sent', { timeout: 30_000 });
  await expect(page.getByTestId('tracking-number')).toContainText(/^ECO-/);

  // bulk from the orders list: the order already sent is listed with its reason, the confirmed one is sent
  const other = await confirmedOrder(request, owner, product.id, { name: 'Karim Djebbar' });
  await open(page, `/fr/orders?ids=${o.id},${other.id}`, () => row(page, other.id));
  await row(page, o.id).getByRole('checkbox').check();
  await row(page, other.id).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Envoyer au transporteur' }).click();
  const d = page.getByTestId('bulk-send-dialog');
  await expect(d.getByTestId('bulk-send-invalid')).toContainText(errText('DELIVERY_ORDER_ALREADY_SENT'));
  await page.getByTestId('bulk-send-submit').click();
  const results = page.getByTestId('bulk-send-results');
  await expect(results).toHaveAttribute('data-state', 'done', { timeout: 90_000 });
  await expect(results.locator('[data-result="ok"]')).toHaveCount(1);
  await expect(page.getByTestId('bulk-send-summary')).toContainText('1 OK');
  await expect(page.getByTestId('bulk-send-labels')).toHaveText('Imprimer 1 bordereau');
  void zr;
});
