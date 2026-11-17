// M10 — ADM-06 AI providers (Figma "ADM-06 — … AI providers, routing & pricing calculator"), ADM-07 agent presets
// ("ADM-07 — … agent presets editor") and ADM-08 CMS ("ADM-08 — … CMS per locale") against the real API (AI_DRIVER=fake):
// provider key test states REJETÉE / INJOIGNABLE / OK without saving (AT-DLG-72), routing table + calculator, new
// preset draft + locale pills + PRESET_LOCALE_INCOMPLETE (AT-DLG-73), CMS slug rules CMS_SLUG_INVALID / CMS_SLUG_TAKEN
// (AT-DLG-73, AT-ERR-10) and publish blocked by CMS_LOCALE_MISSING until "replier sur FR" (AT-ERR-10).
import { expect, test, type Page } from '@playwright/test';
import { API } from './support/m1';
import { adminHeaders } from './support/m10-help';
import { loginAdmin, modAdmin, type ModAdmin } from './support/m10-mod';

test.describe.configure({ mode: 'serial' });

let admin: ModAdmin;
let page: Page;
const tag = Date.now().toString(36);

test.beforeAll(async ({ request, browser }) => {
  test.setTimeout(240_000);
  admin = await modAdmin(request, 'super_admin', 'm10wc');
  page = await (await browser.newContext({ locale: 'fr-DZ', timezoneId: 'Africa/Algiers' })).newPage();
  await loginAdmin(page, admin, '/fr/admin/ai');
});

test.afterAll(async ({ request }) => {
  await page?.context().close();
  // leave nothing published in the shared dev database
  const presets = await (await request.get(`${API}/admin/agent-presets`, { headers: adminHeaders(admin) })).json().catch(() => null);
  for (const p of (presets?.data ?? []) as { id: string; key: string }[]) if (p.key.endsWith(tag)) await request.delete(`${API}/admin/agent-presets/${p.id}`, { headers: adminHeaders(admin) });
});

test('AT-DLG-72 Clé fournisseur IA: Tester shows REJETÉE (AI_PROVIDER_KEY_REJECTED), INJOIGNABLE (AI_PROVIDER_UNREACHABLE), OK · n MS — nothing saved', async () => {
  const cards = page.getByTestId('provider-cards');
  await expect(cards.locator('[data-provider]').first()).toBeVisible();
  const first = cards.locator('[data-provider]').first();
  await first.getByRole('button', { name: 'Remplacer la clé' }).click();
  const dlg = page.getByTestId('dlg-provider-key');
  await dlg.getByLabel('Nouvelle clé').fill('sk-e2e-reject-0000');
  await page.getByTestId('key-test').click();
  await expect(dlg.locator('[data-key-test="rejected"]')).toContainText('REJETÉE');
  await expect(page.getByTestId('dlg-provider-key-submit')).toBeDisabled();
  await dlg.getByLabel('Nouvelle clé').fill('sk-e2e-unreachable-0000');
  await page.getByTestId('key-test').click();
  await expect(dlg.locator('[data-key-test="unreachable"]')).toContainText('INJOIGNABLE');
  await expect(dlg).toContainText('enregistrer quand même ?');
  await dlg.getByLabel('Nouvelle clé').fill('sk-e2e-valid-0000');
  await page.getByTestId('key-test').click();
  await expect(dlg.locator('[data-key-test="ok"]')).toContainText(/OK · \d+ MS/);
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
});

test('ADM-06 routing per capability + pricing calculator simulate', async () => {
  await expect(page.getByRole('table', { name: /Routage par capacité/ })).toContainText('Texte (réponse)');
  const calc = page.getByTestId('pricing-calculator');
  await expect(calc.locator('[data-sim="text"]')).toContainText('DA');
  await calc.getByLabel('Marge cible (%)').fill('90');
  await page.getByTestId('simulate').click();
  await expect(calc.locator('[data-sim="text"]')).toContainText('marge');
});

test('AT-DLG-73 Nouveau préréglage "Vide" ⇒ draft v1 in the editor; Publier ⇒ PRESET_LOCALE_INCOMPLETE inline; locale pills in the URL', async () => {
  await page.goto('/fr/admin/presets');
  await page.getByTestId('new-preset').click();
  const dlg = page.getByTestId('dlg-preset');
  await dlg.getByLabel('Nom (FR)').fill(`Restauration ${tag}`);
  await dlg.getByLabel('Clé').fill(`resto_${tag}`);
  await dlg.getByRole('radio', { name: 'Vide' }).check();
  await page.getByTestId('dlg-preset-submit').click();
  await expect(page.getByText(`Brouillon v1 de « Restauration ${tag} » créé.`)).toBeVisible();
  const editor = page.getByTestId('preset-editor');
  await expect(editor).toContainText(`Restauration ${tag} — brouillon v1`);
  await expect(editor.locator('[data-locale="en"]')).toContainText('manquant');
  await editor.locator('[data-locale="ar"]').click();
  await expect(page).toHaveURL(/locale=ar/);
  await editor.locator('[data-locale="fr"]').click();
  await page.getByTestId('preset-publish').click();
  await expect(editor.getByRole('alert').or(editor.locator('[role=alert]')).first()).toContainText(/PRESET_LOCALE_INCOMPLETE|incompl/);
  // filling the FR prompt and testing updates the publication checks
  await editor.getByLabel(/Prompt système \(FR\)/).fill('Tu es le vendeur de {{shop_name}}. Réponds dans la langue du client ({{language}}).');
  await page.getByTestId('preset-test').click();
  await expect(page.getByTestId('preset-checks').locator('[data-check="variables"]')).toHaveAttribute('data-state', 'ok');
});

test('AT-DLG-73 / AT-ERR-10 Nouvelle entrée CMS: CMS_SLUG_INVALID, CMS_SLUG_TAKEN inline; publish ⇒ CMS_LOCALE_MISSING until "replier sur FR"', async () => {
  await page.goto('/fr/admin/cms?tab=help');
  await page.getByTestId('new-cms').click();
  const dlg = page.getByTestId('dlg-cms');
  await dlg.getByLabel('Type').selectOption('help');
  await dlg.getByLabel('Slug').fill('Mauvais Slug !');
  await dlg.getByLabel('Titre (FR)').fill(`Aide e2e ${tag}`);
  await page.getByTestId('dlg-cms-submit').click();
  await expect(dlg.getByText('Slug invalide (lettres, chiffres, tirets).')).toBeVisible();
  await dlg.getByLabel('Slug').fill(`aide-e2e-${tag}`);
  // without the 3 languages: AR / EN stay missing and have no FR fallback yet
  await dlg.getByRole('checkbox', { name: /Créer les 3 langues/ }).uncheck();
  await page.getByTestId('dlg-cms-submit').click();
  await expect(page.getByText('Entrée créée.')).toBeVisible();
  const editor = page.getByTestId('cms-editor');
  await expect(editor).toBeVisible();

  // same slug again ⇒ CMS_SLUG_TAKEN
  await page.getByTestId('new-cms').click();
  await dlg.getByLabel('Type').selectOption('help');
  await dlg.getByLabel('Slug').fill(`aide-e2e-${tag}`);
  await dlg.getByLabel('Titre (FR)').fill('Doublon');
  await page.getByTestId('dlg-cms-submit').click();
  await expect(dlg.getByText('Slug déjà utilisé.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();

  // FR body written, AR / EN empty ⇒ publish refused, then allowed with the FR fallback
  await editor.getByLabel('Contenu (FR)').fill('Comment acheter un pack de crédits depuis Facturation.');
  await page.getByTestId('cms-save').click();
  await expect(page.getByText('Brouillon enregistré.')).toBeVisible();
  await page.getByTestId('cms-publish').click();
  await expect(page.getByTestId('cms-locale-missing')).toContainText('CMS_LOCALE_MISSING');
  await page.getByRole('checkbox', { name: 'Replier sur FR pour les langues vides' }).check();
  await page.getByTestId('cms-publish').click();
  await expect(page.getByText('Entrée publiée.')).toBeVisible();
  // the row shows FR PUBLIÉ; then unpublished again (nothing left online)
  const row = page.getByRole('row', { name: new RegExp(`Aide e2e ${tag}`) });
  await expect(row).toContainText('PUBLIÉ');
  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Dépublier' }).click();
  // journeys 16/11 J13-4: the unpublish asks its reason
  await page.getByTestId('dlg-cms-unpublish').getByLabel('Raison').fill('Guide remplacé par la version 2');
  await page.getByRole('dialog').getByRole('button', { name: 'Dépublier' }).click();
  await expect(page.getByText('Entrée dépubliée (404 côté public).')).toBeVisible();
});
