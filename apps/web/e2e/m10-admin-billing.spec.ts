// M10 — ADM-04 plans editor, ADM-05 subscriptions & invoices, ADM-15 credit packs & promo codes (Figma frames of the same
// names + "DLG — Platform admin — dialogs catalogue") against the real API (PAYMENT_DRIVER=fake): create plan with card
// preview and PLAN_SLUG_TAKEN (AT-DLG-68 / AT-BIL-09), edit with the impact preview → version n+1, delete blocked by
// PLAN_IN_USE (AT-DLG-69), dunning row RELANCE J0 + manual payment partial then full (12 §26), create subscription ⇒
// SUBSCRIPTION_ALREADY_ACTIVE (AT-DLG-69), promo code create / duplicate / deactivate (ADM-15).
import { expect, test, type Page } from '@playwright/test';
import { API, authHeaders, createAccount, type Account } from './support/m1';
import { adminHeaders } from './support/m10-help';
import { loginAdmin, modAdmin, type ModAdmin } from './support/m10-mod';
import { devSubscription, subscribe, subscriptionOf } from './support/m9';

test.describe.configure({ mode: 'serial' });

let admin: ModAdmin;
let merchant: Account;
let page: Page;
let wsName: string;
const tag = Date.now().toString(36);

test.beforeAll(async ({ request, browser }) => {
  test.setTimeout(300_000);
  admin = await modAdmin(request, 'super_admin', 'm10wb');
  merchant = await createAccount(request, { prefix: 'm10wb-shop', finishOnboarding: true });
  wsName = `Maison WB ${tag}`;
  await request.patch(`${API}/workspace`, { headers: authHeaders(merchant), data: { name: wsName } });
  await subscribe(request, merchant, 'starter');
  page = await (await browser.newContext({ locale: 'fr-DZ', timezoneId: 'Africa/Algiers' })).newPage();
  await loginAdmin(page, admin, '/fr/admin/plans');
});

test.afterAll(async ({ request }) => {
  await page?.context().close();
  // the e2e plan must not stay in the public catalogue of the shared dev database
  const plans = await (await request.get(`${API}/admin/plans`, { headers: adminHeaders(admin) })).json().catch(() => null);
  for (const p of (plans?.data ?? []) as { id: string; slug: string }[]) if (p.slug === `business-${tag}`) await request.delete(`${API}/admin/plans/${p.id}`, { headers: adminHeaders(admin) });
});

test('AT-DLG-68 / AT-BIL-09 Créer un plan: card preview follows the inputs, all limits 0 blocked, duplicate slug ⇒ PLAN_SLUG_TAKEN inline', async () => {
  await expect(page.getByTestId('plan-cards').locator('[data-plan="starter"]')).toBeVisible();
  await page.getByTestId('new-plan').click();
  const dlg = page.getByTestId('dlg-plan-create');
  await dlg.getByLabel('Slug').fill(`business-${tag}`);
  await dlg.getByLabel('Nom (FR)').fill(`Business ${tag}`);
  await dlg.getByLabel('Prix mensuel (DA)').fill('9900');
  await dlg.getByLabel('Prix annuel (DA)').fill('99000');
  await expect(dlg).toContainText('−17 % affiché');
  await dlg.getByLabel('Pages', { exact: true }).fill('0');
  await dlg.getByLabel('Agents', { exact: true }).fill('0');
  await expect(page.getByTestId('dlg-plan-create-submit')).toBeDisabled();
  await dlg.getByLabel('Pages', { exact: true }).fill('10');
  await dlg.getByLabel('Crédits / mois').fill('12000');
  await dlg.getByRole('checkbox', { name: /Visible sur la page tarifs/ }).uncheck();
  await page.getByTestId('plan-preview-toggle').click();
  const preview = page.getByTestId('plan-preview');
  await expect(preview).toContainText(`Business ${tag}`);
  await expect(preview).toContainText('9 900');
  await expect(preview).toContainText('10 pages');
  await expect(preview).toContainText('12 000 crédits / mois');
  await page.getByTestId('dlg-plan-create-submit').click();
  await expect(page.getByText(`Plan « Business ${tag} » créé (version 1).`)).toBeVisible();
  await expect(page.getByTestId('plan-cards').locator(`[data-plan="business-${tag}"]`)).toBeVisible();

  // the same slug again ⇒ PLAN_SLUG_TAKEN under the slug field, content preserved
  await page.getByTestId('new-plan').click();
  await dlg.getByLabel('Slug').fill(`business-${tag}`);
  await dlg.getByLabel('Nom (FR)').fill('Doublon');
  await dlg.getByLabel('Pages', { exact: true }).fill('1');
  await page.getByTestId('dlg-plan-create-submit').click();
  await expect(dlg.getByText('Slug déjà utilisé.')).toBeVisible();
  await expect(dlg.getByLabel('Nom (FR)')).toHaveValue('Doublon');
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
});

test('ADM-04 editor: impact preview while editing, "Enregistrer la version 2", leave guard', async () => {
  await page.getByTestId(`edit-business-${tag}`).click();
  const editor = page.getByTestId('plan-editor');
  await expect(editor).toContainText(`Modifier « Business ${tag} » (Plan.version 1 → 2)`);
  await editor.getByLabel('Pages max').fill('8');
  await expect(page.getByTestId('plan-impact')).toContainText('Impact : 0 abonnés.');
  // leave guard on an in-app link
  await page.getByRole('link').filter({ has: page.getByText('Utilisateurs', { exact: true }) }).click();
  await expect(page.getByRole('dialog', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
  await page.getByRole('button', { name: 'Rester' }).click();
  await page.getByTestId('plan-save').click();
  await expect(page.getByText('Version 2 enregistrée.')).toBeVisible();
  await expect(page).not.toHaveURL(/edit=/);
});

test('AT-DLG-69 Supprimer le plan with subscribers ⇒ greyed with PLAN_IN_USE (D42 reason in the menu), "Migrer les abonnés" needs a target + reason', async () => {
  const starter = page.getByTestId('plan-cards').locator('[data-plan="starter"]');
  await starter.getByRole('button', { name: 'Actions' }).click();
  const del = page.getByRole('menuitem', { name: 'Supprimer' });
  await expect(del).toHaveAttribute('data-disabled', '');
  await expect(page.getByRole('menu')).toContainText('(PLAN_IN_USE)');
  await page.getByRole('menuitem', { name: 'Migrer les abonnés' }).click();
  const dlg = page.getByTestId('dlg-plan-migrate');
  await expect(dlg).toBeVisible();
  await expect(page.getByTestId('dlg-plan-migrate-submit')).toBeDisabled();
  await dlg.getByLabel('Migrer les abonnés vers').selectOption({ label: 'Pro' });
  await expect(page.getByTestId('dlg-plan-migrate-submit')).toBeDisabled();
  await dlg.getByLabel('Raison').fill('Fusion des offres Starter et Pro');
  await expect(page.getByTestId('dlg-plan-migrate-submit')).toBeEnabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
});

test('12 §26 subscriptions: dunning row RELANCE J0, manual payment partial (INVOICE_PARTIAL_PAYMENT) then full ⇒ paid + reactivation', async ({ request }) => {
  test.setTimeout(120_000);
  await devSubscription(request, merchant, 'dunning', { stage: 'd0' });
  await expect.poll(async () => (await subscriptionOf(request, merchant)).status, { timeout: 30_000 }).toBe('dunning');
  const sub = await subscriptionOf(request, merchant);
  const remaining = sub.unpaidInvoice!.remaining;
  await page.goto(`/fr/admin/subscriptions?q=${encodeURIComponent(wsName)}`);
  const row = page.getByRole('row', { name: new RegExp(wsName) });
  await expect(row.locator('[data-pill]')).toHaveText('RELANCE J0');
  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Marquer la facture payée (paiement manuel)' }).click();
  const dlg = page.getByTestId('dlg-manual-payment');
  await expect(page.getByRole('dialog')).toContainText(sub.unpaidInvoice!.number);
  await dlg.getByLabel('Mode').selectOption('manual_ccp');
  await dlg.getByLabel('Référence').fill(`CCP-${tag}`);
  await dlg.getByLabel('Montant reçu (DA)').fill(String(Math.floor(remaining / 2)));
  await expect(page.getByTestId('dlg-manual-payment-submit')).toHaveText('Enregistrer le paiement partiel');
  await page.getByTestId('dlg-manual-payment-submit').click();
  await expect(page.getByText(/Paiement partiel enregistré : reste/)).toBeVisible();
  await expect(row.locator('[data-pill]')).toHaveText('RELANCE J0');

  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Marquer la facture payée (paiement manuel)' }).click();
  await dlg.getByLabel('Référence').fill(`CCP-${tag}-2`);
  await expect(page.getByTestId('dlg-manual-payment-submit')).toHaveText('Confirmer et réactiver');
  await page.getByTestId('dlg-manual-payment-submit').click();
  await expect(page.getByText(/Paiement enregistré, facture payée/)).toBeVisible();
  await expect(row.locator('[data-pill]')).toHaveText('ACTIF');
});

test('AT-DLG-69 Abonnement — créer: an active subscription exists ⇒ SUBSCRIPTION_ALREADY_ACTIVE with "Modifier l\'abonnement existant"', async () => {
  await page.getByTestId('new-subscription').click();
  const dlg = page.getByTestId('dlg-subscription');
  await dlg.getByRole('combobox').first().click();
  await page.getByRole('textbox', { name: "Nom de l'espace, propriétaire…" }).fill(wsName);
  await page.getByRole('option', { name: new RegExp(wsName) }).click();
  await dlg.locator('#s-plan').selectOption({ label: 'Pro' });
  await dlg.getByLabel('Raison').fill('Contrat signé salon Expo (offre privée)');
  await page.getByTestId('dlg-subscription-submit').click();
  await expect(dlg).toContainText('SUBSCRIPTION_ALREADY_ACTIVE');
  await dlg.getByRole('button', { name: "Modifier l'abonnement existant" }).click();
  await expect(page.getByRole('dialog')).toContainText(wsName);
  await expect(dlg.locator('#s-plan')).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
});

test('ADM-05 tabs and KPIs: Factures tab filtered by status in the URL', async () => {
  await page.goto('/fr/admin/subscriptions');
  await expect(page.getByRole('region', { name: 'Indicateurs abonnements' })).toContainText('DA MRR');
  await page.getByRole('button', { name: /^Factures/ }).click();
  await expect(page).toHaveURL(/tab=invoices/);
  await page.goto(`/fr/admin/subscriptions?tab=invoices&status=paid&q=${encodeURIComponent(wsName)}`);
  await expect(page.getByTestId('invoices-list')).toContainText('PAYÉE');
});

test('ADM-15 promo codes: create (dialog, like « + Pack » — UX-006; the chosen effect stays readable — UX-009), duplicate code ⇒ inline error, deactivate ⇒ DÉSACTIVÉ', async () => {
  await page.goto('/fr/admin/credits');
  await expect(page.getByTestId('packs-panel')).toBeVisible();
  const code = `E2E${tag}`.toUpperCase();
  await page.getByTestId('new-promo').click();
  const form = page.getByTestId('promo-form');
  await form.getByLabel('Code').fill(code);
  await form.getByLabel('Effet').selectOption('credits');
  await expect(form.getByLabel('Effet')).toHaveValue('credits');
  // the select is wide enough to show its label (it was squeezed to the padding)
  expect((await form.getByLabel('Effet').boundingBox())!.width).toBeGreaterThan(120);
  await form.getByLabel('Valeur').fill('300');
  await page.getByTestId('promo-form-submit').click();
  await expect(page.getByText(`Code ${code} enregistré.`)).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(code) });
  await expect(row.locator('[data-pill]')).toHaveText('ACTIF');

  await page.getByTestId('new-promo').click();
  await form.getByLabel('Code').fill(code);
  await form.getByLabel('Valeur').fill('10');
  await page.getByTestId('promo-form-submit').click();
  await expect(form.locator('[role=alert]').first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();

  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Désactiver' }).click();
  // one-click deactivation is confirmed first
  await page.getByRole('dialog').getByRole('button', { name: 'Désactiver' }).click();
  await expect(page.getByText(`Code ${code} désactivé.`)).toBeVisible();
  await expect(row.locator('[data-pill]')).toHaveText('DÉSACTIVÉ');
});
