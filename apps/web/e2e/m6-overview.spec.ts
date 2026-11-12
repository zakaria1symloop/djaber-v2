// M6 — /delivery (Figma "DLV-08 — Delivery — overview + tracking panel", "MECH — Delivery filters + row menu + bulk send
// results"): tiles, tabs, filters in the URL, row menu with greyed reasons, tracking panel with the "Actualiser" states,
// failure flow (FL-25), no-courier card, RTL. Real API + worker with the fake courier driver: nothing is mocked.
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { apiCall, open, row, seedProduct, shopOwner } from './support/m5-orders';
import { confirmedOrder, deliveryReady, getParcel, markFailed, seedCourier, sendOrder, waitParcel, type Courier, type Parcel } from './support/m6';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let product: { id: string; name: string };
let zr: Courier;
let eco: Courier;

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await shopOwner(request, 'm6over');
  test.skip(!(await deliveryReady(request, owner)), 'delivery module (M6) not served');
  product = await seedProduct(request, owner, 'Parfum Oud', 4700, 80);
});

test('DLV-08 — no courier: tiles, tabs, "Aucun transporteur configuré" with its CTA (→ add dialog) and Livraison propre; axe', async ({ page }) => {
  await signIn(page, owner);
  await open(page, '/fr/delivery', () => page.getByTestId('delivery-kpis').locator('[data-kpi="toSend"]'));
  await expect(page.getByTestId('delivery-no-courier')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Livraison propre' })).toBeVisible();
  await expect(page.locator('nav [data-tab="failed"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('delivery-empty')).toHaveAttribute('data-tab', 'failed');
  await expectNoA11yViolations(page);
  await page.getByTestId('no-courier-cta').click();
  await expect(page.getByTestId('courier-dialog')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/fr\/delivery\/couriers$/);
});

test('DLV-08 / MECH — rows, tabs and filters in the URL, row menu greyed with its code, "Envoyer les confirmées (n)"', async ({ page, request }) => {
  zr = await seedCourier(request, owner, { provider: 'zrexpress', isDefault: true });
  eco = await seedCourier(request, owner, { provider: 'ecotrack', isDefault: false });
  const toSend = await confirmedOrder(request, owner, product.id, { name: 'Amina Belkacem' });
  const sent = await confirmedOrder(request, owner, product.id, { name: 'Lina Saidi' });
  await sendOrder(request, owner, sent.id, zr.id);
  await signIn(page, owner);

  await open(page, '/fr/delivery?tab=to_send', () => row(page, toSend.id));
  await expect(page.getByTestId('send-confirmed')).toContainText(/Envoyer les confirmées \(\d+\)/);
  // a row without parcel: "Envoyer au transporteur" is the primary (first) item
  await row(page, toSend.id).getByRole('button', { name: /Actions/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem').first()).toContainText('Envoyer au transporteur');
  await page.keyboard.press('Escape');

  await page.locator('nav [data-tab="in_transit"]').click();
  await expect(page).toHaveURL(/tab=in_transit/);
  await expect(row(page, sent.id)).toBeVisible();
  await expect(row(page, sent.id)).toContainText(/ZR-/);
  // ZR Express cannot cancel a parcel: the item stays visible, greyed, with its code in the footer
  await row(page, sent.id).getByRole('button', { name: /Actions/ }).click();
  await expect(page.getByRole('menu')).toContainText(errText('COURIER_CANCEL_NOT_ALLOWED'));
  await page.keyboard.press('Escape');

  // filter panel → URL
  await page.getByTestId('open-filters').click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'EcoTrack', exact: true }).first().click();
  await expect(page).toHaveURL(/provider=ecotrack/);
  await page.keyboard.press('Escape');
  await expect(row(page, sent.id)).toHaveCount(0);
  await expect(page.getByText('Aucun résultat').first()).toBeVisible();
  await page.getByRole('button', { name: /Effacer/ }).first().click();
  await expect(row(page, sent.id)).toBeVisible();
});

test('AT-DLV-12 — "Actualiser" in the tracking panel: à jour, then limited to 1 / 5 min (TRACKING_SYNC_RATE_LIMITED, API 429)', async ({ page, request }) => {
  const o = await confirmedOrder(request, owner, product.id, { name: 'Mehdi Hamdi' });
  const p = await sendOrder(request, owner, o.id, zr.id);
  await signIn(page, owner);
  await open(page, `/fr/delivery?tab=all&sheet=${p.id}`, () => page.getByTestId('tracking-panel').locator('[data-testid="tracking-sync"]'));
  await expect(page.getByTestId('tracking-panel')).toHaveAttribute('data-status', 'sent');
  await page.getByTestId('tracking-refresh').click();
  await expect(page.getByTestId('tracking-sync')).toHaveAttribute('data-state', 'fresh', { timeout: 30_000 });
  await expect(page.getByTestId('tracking-refresh')).toBeDisabled();
  // the API refuses a second refresh within 5 min
  const again = await apiCall(request, owner, 'POST', `/shipments/${p.id}/sync`);
  expect(again.status).toBe(429);
  expect(again.error?.code).toBe('TRACKING_SYNC_RATE_LIMITED');
  // reopened: the panel reads the cooldown of the parcel
  await page.reload();
  await expect(page.getByTestId('tracking-sync')).toHaveAttribute('data-state', 'limited', { timeout: 30_000 });
  await expect(page.getByTestId('tracking-sync')).toContainText(errText('TRACKING_SYNC_RATE_LIMITED'));
  await expect(page.getByTestId('tracking-timeline')).toBeVisible();
});

test('AT-DLV-11 — failure flow: Échecs row (reason + attempt n/3), "Relancer" not offered by ZR (COURIER_CANCEL_NOT_ALLOWED), EcoTrack re-attempt +1, third failure ⇒ return proposed', async ({ page, request }) => {
  // ZR Express: no re-attempt API
  const a = await confirmedOrder(request, owner, product.id, { name: 'Karim Djebbar' });
  const pa = await sendOrder(request, owner, a.id, zr.id);
  await markFailed(request, owner, pa.id, 'unreachable');
  // EcoTrack: re-attempt through the courier
  const b = await confirmedOrder(request, owner, product.id, { name: 'Rym Aouadi' });
  const pb = await sendOrder(request, owner, b.id, eco.id);
  await signIn(page, owner);

  await open(page, '/fr/delivery', () => row(page, a.id));
  await expect(row(page, a.id)).toContainText('INJOIGNABLE');
  await expect(row(page, a.id)).toContainText('tentative 1/3');
  await row(page, a.id).getByRole('button', { name: /Actions/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Relancer la livraison' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('menu')).toContainText(errText('COURIER_CANCEL_NOT_ALLOWED'));
  await page.keyboard.press('Escape');

  // EcoTrack parcel: failure recorded from the UI ("Échec de livraison" dialog), then "Relancer la livraison"
  await open(page, `/fr/delivery?tab=all&sheet=${pb.id}`, () => page.getByTestId('tracking-panel').locator('[data-testid="tracking-sync"]'));
  await page.getByRole('dialog').getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('menuitem', { name: 'Échec de livraison' }).click();
  await page.getByTestId('mark-failed-dialog').getByRole('radio', { name: /injoignable/i }).click();
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('tracking-panel')).toHaveAttribute('data-status', 'failed', { timeout: 30_000 });
  await expect(page.getByTestId('panel-failed')).toContainText('INJOIGNABLE');
  await page.getByTestId('panel-actions').getByRole('button', { name: 'Relancer la livraison' }).click();
  await page.getByTestId('retry-delivery-dialog').getByRole('textbox').fill('Client disponible après 17h');
  await page.getByTestId('dialog-submit').click();
  let p: Parcel = await waitParcel(request, owner, pb.id, (x) => x.status === 'out_for_delivery');
  // two more failures (2nd re-attempt through the API) ⇒ 3 attempts
  await markFailed(request, owner, pb.id, 'unreachable');
  await apiCall(request, owner, 'POST', `/shipments/${pb.id}/retry-delivery`, {});
  p = await waitParcel(request, owner, pb.id, (x) => x.status === 'out_for_delivery');
  await markFailed(request, owner, p.id, 'refused');
  expect((await getParcel(request, owner, pb.id)).status).toBe('failed');
  await page.reload();
  await expect(page.getByTestId('panel-failed')).toContainText('proposez le retour', { timeout: 30_000 });
  await expect(page.getByTestId('panel-actions').getByRole('button').first()).toHaveText('Marquer retournée');
  await page.getByTestId('panel-actions').getByRole('button', { name: 'Marquer retournée' }).click();
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('tracking-panel')).toHaveAttribute('data-status', 'returned', { timeout: 30_000 });
  await expect(page.getByTestId('panel-returned')).toBeVisible();
});

test('MECH — bulk send results from the notification link (/delivery?job=): per-order outcome, retry lists the failed orders in "À envoyer"', async ({ page }) => {
  // the job of an "envoi groupé" (kind bulk_send) is served finished, one order created and one refused
  const jobId = '00000000-0000-7000-8000-00000000b5e1';
  const failedOrder = '00000000-0000-7000-8000-00000000f001';
  await page.route(new RegExp(`/api/v1/jobs/${jobId}$`), (route) =>
    route.fulfill({
      json: {
        data: {
          id: jobId,
          kind: 'bulk_send',
          status: 'partial',
          progress: 100,
          total: 2,
          resultUrl: null,
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: null,
          result: {
            ok: 1,
            failed: 1,
            queued: 0,
            results: [
              { id: '00000000-0000-7000-8000-00000000a001', ok: true, orderNumber: '1201', data: { shipmentId: '00000000-0000-7000-8000-00000000c001', status: 'sent', trackingNumber: 'ZR-E2E-1' } },
              { id: failedOrder, ok: false, orderNumber: '1202', error: { code: 'ORDER_ADDRESS_REQUIRED', message: 'Adresse requise' } },
            ],
          },
        },
      },
    }),
  );
  await signIn(page, owner);
  await open(page, `/fr/delivery?job=${jobId}`, () => page.getByTestId('bulk-send-results'));
  const results = page.getByTestId('bulk-send-results');
  await expect(results).toContainText('#1201');
  await expect(results).toContainText(errText('ORDER_ADDRESS_REQUIRED'));
  await page.getByTestId('bulk-send-retry').click();
  await expect(page).toHaveURL(new RegExp(`tab=to_send.*ids=${failedOrder}|ids=${failedOrder}.*tab=to_send`));
  await expect(page).not.toHaveURL(/job=/);
});

test('RTL — /ar/delivery mirrors the overview; tracking numbers stay left-to-right; axe', async ({ page }) => {
  await signIn(page, owner, 'ar');
  await open(page, '/ar/delivery?tab=all', () => page.getByTestId('delivery-kpis').locator('[data-kpi="toSend"]'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('nav [data-tab="all"]')).toHaveAttribute('aria-current', 'page');
  const tracking = page.locator('table bdi[dir="ltr"], table [dir="ltr"]').filter({ hasText: /ZR-|ECO-/ }).first();
  await expect(tracking).toBeVisible();
  await expectNoA11yViolations(page);
});
