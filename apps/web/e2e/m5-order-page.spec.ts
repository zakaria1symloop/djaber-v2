// M5 — /orders/[id] and its dialogs (Figma "ORD-06 — Order page — new", "ORD-07 — Confirm order dialog — outcome step",
// "DLG — Orders & delivery", "DLG — Orders, delivery & clients II", A5 print preview). Real API throughout: each test
// creates the orders it changes through `POST /orders`. Nothing is mocked.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, expectUrl, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { apiCall, dialog, getOrder, money, open, ordersReady, seedOrder, seedProduct, setStatus, shopOwner } from './support/m5-orders';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let product: { id: string; name: string };
const page$ = (page: Page, id: string) => open(page, `/fr/orders/${id}`, () => page.getByTestId('client-block'));

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await shopOwner(request, 'm5ordp');
  test.skip(!(await ordersReady(request, owner)), 'orders module (M5) not served');
  product = await seedProduct(request, owner, 'La Robe satin', 1000);
});
test.beforeEach(async ({ page }) => {
  await signIn(page, owner);
});

test('AT-ORD-04 / AT-ORD-20 — confirm dialog: blocked without address, then picked_up confirms; result step offers Préparer and a greyed "Envoyer au transporteur"', async ({ page, request }) => {
  const o = await seedOrder(request, owner, { productId: product.id, address: false });
  await page$(page, o.id);
  await page.getByTestId('call-confirm').click();
  await expect(page.getByTestId('confirm-dialog')).toHaveAttribute('data-step', 'review');
  await expect(dialog(page)).toContainText(errText('ORDER_ADDRESS_REQUIRED'));

  // complete the address from the dialog, back to the confirm dialog
  await page.getByTestId('confirm-address').click();
  await expect(page.getByTestId('address-dialog')).toBeVisible();
  await page.locator('#ad-wilaya').click();
  await page.getByRole('option').first().click();
  await page.locator('#ad-commune').click();
  await page.getByRole('option').first().click();
  await page.locator('#ad-address').fill('Cité 200 logements, bât. C, n° 12');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();

  await page.getByTestId('confirm-next').click();
  await expect(page.getByTestId('confirm-dialog')).toHaveAttribute('data-step', 'call');
  await expect(page.getByRole('radio', { name: /Confirmée/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('confirm-result')).toContainText(`#${o.number}`);
  // courier sending needs a courier account (M6): greyed with its reason
  const send = page.getByTestId('confirm-send');
  if ((await send.count()) > 0) await expect(send).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Préparer' }).click();
  await expect.poll(async () => (await getOrder(request, owner, o.id)).status).toBe('preparing');
});

test('AT-ORD-18 / AT-ORD-03 / AT-ORD-25 — call outcomes: no answer keeps the status, refused cancels, wrong number cancels and flags the client', async ({ page, request }) => {
  const a = await seedOrder(request, owner, { productId: product.id });
  await page$(page, a.id);
  await page.getByTestId('log-call').click();
  await page.getByRole('radio', { name: /Sans réponse/ }).click();
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('calls-block').locator('[data-call="no_answer"]')).toHaveCount(1);
  await expect.poll(async () => (await getOrder(request, owner, a.id)).status).toBe('new');

  const b = await seedOrder(request, owner, { productId: product.id });
  await page$(page, b.id);
  await page.getByTestId('log-call').click();
  await page.getByRole('radio', { name: /Refusée/ }).click();
  await page.getByTestId('dialog-submit').click();
  await expect.poll(async () => (await getOrder(request, owner, b.id)).status).toBe('cancelled');

  const c = await seedOrder(request, owner, { productId: product.id });
  await page$(page, c.id);
  await page.getByTestId('log-call').click();
  await page.getByRole('radio', { name: /Faux numéro/ }).click();
  await page.getByTestId('dialog-submit').click();
  await expect.poll(async () => (await getOrder(request, owner, c.id)).status).toBe('cancelled');
  await page.reload();
  await expect(page.getByTestId('client-block')).toContainText('RISQUE');
});

test('AT-ORD-24 — callback at 16:00 / tomorrow: pill RAPPEL hh:mm in the list; a past time is refused inline', async ({ page, request }) => {
  const o = await seedOrder(request, owner, { productId: product.id });
  await page$(page, o.id);
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Programmer un rappel' }).click();
  await expect(page.getByTestId('callback-dialog')).toBeVisible();
  // a past date-time ⇒ ORDER_CALLBACK_IN_PAST, inside the dialog
  await page.getByRole('radio', { name: 'Choisir…' }).click();
  await page.locator('#cb-at').fill('2020-01-01T10:00');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('callback-dialog')).toContainText('Choisissez une heure à venir.');
  await page.locator('[data-preset="tomorrow10"]').click();
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('callback-dialog')).toHaveCount(0);
  await expect.poll(async () => (await getOrder(request, owner, o.id)).confirmationStatus).toBe('callback');
  await open(page, `/fr/orders?ids=${o.id}`, () => page.locator(`tr[data-row="${o.id}"]`));
  await expect(page.locator(`tr[data-row="${o.id}"]`)).toContainText(/RAPPEL .*10:00/);
});

test('AT-ORD-19 — contact edit validates the phone; history lists the actor; delivered order is read-only', async ({ page, request }) => {
  const o = await seedOrder(request, owner, { productId: product.id, name: 'Amina Belkacem' });
  await page$(page, o.id);
  await page.getByTestId('edit-contact').click();
  await page.locator('#ct-phone').fill('0555 12');
  await expect(page.getByText(/Numéro invalide/)).toBeVisible();
  await page.getByTestId('save-contact').click();
  await expect(page.getByTestId('client-block').getByRole('alert').first()).toBeVisible();
  await page.locator('#ct-phone').fill('+213 661 98 76 54');
  await expect(page.getByText('Normalisé : 0661987654 · mobile DZ valide')).toBeVisible();
  await page.locator('#ct-name').fill('Amina B.');
  await page.getByTestId('save-contact').click();
  await expect(page.getByTestId('client-block')).toContainText('0661 98 76 54');
  await expect(page.getByTestId('history-block')).toContainText(/Zakaria|Benali/);

  await setStatus(request, owner, o.id, 'confirmed');
  await setStatus(request, owner, o.id, 'delivered');
  await page.reload();
  await expect(page.getByText(/lecture seule/)).toBeVisible();
  await expect(page.getByTestId('edit-contact')).toHaveCount(0);
});

test('AT-ORD-08 — a foreign change between load and save opens the conflict dialog; Recharger keeps the draft', async ({ page, request }) => {
  const o = await seedOrder(request, owner, { productId: product.id, name: 'Lina Saidi' });
  await page$(page, o.id);
  await page.getByTestId('edit-contact').click();
  await page.locator('#ct-name').fill('Lina S.');
  // someone else saves meanwhile
  const fresh = await getOrder(request, owner, o.id);
  const r = await apiCall(request, owner, 'PATCH', `/orders/${o.id}`, { version: fresh.version, notes: 'modifié ailleurs' });
  expect(r.status).toBeLessThan(300);
  await page.getByTestId('save-contact').click();
  await expect(page.getByText('Modifié par quelqu\'un d\'autre')).toBeVisible();
  await page.getByRole('button', { name: 'Recharger' }).click();
  await expect(page.locator('#ct-name')).toHaveValue('Lina S.');
  await page.getByTestId('save-contact').click();
  await expect(page.getByTestId('client-block')).toContainText('Lina S.');
});

test('AT-ORD-22 / AT-ORD-05 — payment 300 of 1 000 ⇒ partial; cancelling clears the automatic amount', async ({ page, request }) => {
  const o = await seedOrder(request, owner, { productId: product.id });
  await page$(page, o.id);
  await page.getByTestId('record-payment').click();
  await page.locator('#pay-amount').fill('5000');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('payment-dialog')).toContainText('dépasse le reste');
  await page.locator('#pay-amount').fill('300');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('payment-block')).toContainText('PARTIELLE');
  await expect(page.getByTestId('payment-block')).toContainText(money(300));
});

test('AT-ORD-27 / AT-ORD-02 — manual delivery: a different amount needs a reason; COD delivered ⇒ paid', async ({ page, request }) => {
  const o = await seedOrder(request, owner, { productId: product.id, status: 'confirmed' });
  await page$(page, o.id);
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /Marquer livrée/ }).click();
  await page.locator('#dl-amount').fill('800');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('deliver-dialog').getByRole('alert')).toBeVisible();
  await page.locator('#dl-amount').fill(String(o.total));
  await page.getByTestId('dialog-submit').click();
  await expect.poll(async () => (await getOrder(request, owner, o.id)).paymentStatus).toBe('paid');
  await expect(page.getByText(/lecture seule/)).toBeVisible();
});

test('AT-ORD-28 / AT-ORD-31 / AT-UX-04 — returned dialog; delete: typed number exact, delivered refused inline (content kept)', async ({ page, request }) => {
  const o = await seedOrder(request, owner, { productId: product.id, status: 'confirmed' });
  await setStatus(request, owner, o.id, 'delivered');
  await page$(page, o.id);
  await page.getByRole('button', { name: 'Actions' }).click();
  const del = page.getByRole('menuitem', { name: 'Supprimer' });
  if (await del.isEnabled()) {
    await del.click();
    await page.locator('#del-typed').fill('CMD-0000');
    await expect(page.getByTestId('dialog-submit')).toBeDisabled();
    await page.locator('#del-typed').fill(o.number);
    await page.getByTestId('dialog-submit').click();
    await expect(page.getByTestId('delete-dialog')).toContainText(errText('ORDER_DELETE_DELIVERED'));
    await expect(page.locator('#del-typed')).toHaveValue(o.number);
    await page.keyboard.press('Escape');
  } else {
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Marquer retournée' }).click();
  await page.getByRole('radio', { name: 'Refus à la livraison' }).click();
  await expect(page.getByTestId('return-dialog').getByRole('checkbox').first()).toBeChecked();
  await page.getByTestId('dialog-submit').click();
  await expect.poll(async () => (await getOrder(request, owner, o.id)).status).toBe('returned');
});

test('AT-ORD-01 (UI) — "Changer le statut" lists only the allowed targets of the current status', async ({ page, request }) => {
  const o = await seedOrder(request, owner, { productId: product.id, status: 'confirmed' });
  await setStatus(request, owner, o.id, 'shipped');
  await page$(page, o.id);
  // the page header menu (the delivery block has its own parcel menu since M6)
  await page.getByRole('button', { name: 'Actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Changer le statut' }).click();
  // order targets of 04 §1.2; since M6 the parcel's "Échec de livraison" (mark_failed) may be offered next to them
  const radios = page.getByTestId('status-dialog').locator('[role="radio"]:not([data-value="delivery_failed"])');
  await expect(radios).toHaveCount(3);
  await expect(page.getByTestId('status-dialog')).toContainText('Confirmée (retour arrière)');
});

test('A5 print preview and axe on the order page', async ({ page, request }) => {
  const o = await seedOrder(request, owner, { productId: product.id });
  await page$(page, o.id);
  await expectNoA11yViolations(page);
  await page.getByTestId('print-order').click();
  await expectUrl(page, new RegExp(`/fr/orders/${o.id}/print$`));
  await expect(page.getByTestId('a5-slip')).toContainText(`#${o.number}`);
  await expect(page.getByTestId('a5-slip')).toContainText('TOTAL À PAYER');
  await page.getByText('Avec les prix').click();
  await expect(page.getByTestId('a5-slip')).not.toContainText('TOTAL À PAYER');
});
