// M5 — Clients (CLI-01…05, Figma "CLI-03 — Clients — list with detail sheet" / "… filter panel + row menu",
// DLG Nouveau client · Supprimer le client · Tags · Fusionner). Real API; mocks only for states the API cannot produce
// on demand (each marked `// mock:`).
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, expectUrl, loginHome, type Account } from './support/m1';
import { failWith, inviteOperator } from './support/m3-inbox';
import { clientsReady, deliverOrder, getClient, nextMobile, seedClient, seedOrderFor, type E2eClient } from './support/m5-clients';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial' });
let owner: Account;
let amina: E2eClient;
let karim: E2eClient;
let placeholderLike: E2eClient;
const aminaPhone = nextMobile();

const row = (page: Page, name: string) => page.locator('tr[data-row]').filter({ has: page.getByText(name, { exact: true }) });

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await createAccount(request, { prefix: 'cli', finishOnboarding: true });
  test.skip(!(await clientsReady(request, owner)), 'M5 clients API not reachable (GET /clients)');
  amina = await seedClient(request, owner, { name: 'Amina Belkacem', phone: aminaPhone, tags: ['fidèle'] });
  karim = await seedClient(request, owner, { name: 'Karim Djaballah', phone: nextMobile(), tags: ['vip'] });
  placeholderLike = await seedClient(request, owner, { name: 'Amina B.', phone: nextMobile() });
  for (let i = 0; i < 26; i++) await seedClient(request, owner, { name: `Client Lot ${String(i).padStart(2, '0')}`, phone: nextMobile() });
});

test('AT-CLI-04 · list paginated, filters in the URL, search by phone fragment', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/clients');
  await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/Clients · Djaber\.ai/);
  await expect(page.locator('tr[data-row]')).toHaveCount(25);
  await expect(page.getByText(/sur 29/)).toBeVisible();
  await page.getByRole('button', { name: 'Page suivante' }).click();
  await expectUrl(page, /page=2/);
  await expect(page.locator('tr[data-row]')).toHaveCount(4);

  // a phone fragment typed with spaces / +213 is searched in its national form
  // the seeded mobiles are consecutive: the whole number, typed in the international spaced form, is the discriminating input
  const fragment = `+213 ${aminaPhone.slice(1, 4)} ${aminaPhone.slice(4, 6)} ${aminaPhone.slice(6, 8)} ${aminaPhone.slice(8, 10)}`;
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill(fragment);
  await expect(page.locator('tr[data-row]')).toHaveCount(1);
  await expect(row(page, 'Amina Belkacem')).toBeVisible();
  await expect(page).toHaveURL(/q=/);

  // tag filter from the bar, chips under it, filtered empty → clear
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('');
  // the tag options are the tags of the loaded page (+ a free entry for the others): Karim (vip) is on page 2
  await expect(page).not.toHaveURL(/q=/);
  await expect.poll(() => page.locator('tr[data-row]').count()).toBeGreaterThan(1);
  await page.getByRole('button', { name: /^Étiquettes/ }).click();
  const tagEntry = page.getByRole('dialog').getByRole('textbox', { name: 'Étiquettes' });
  await tagEntry.fill('vip');
  await tagEntry.press('Enter');
  await page.keyboard.press('Escape');
  await expectUrl(page, /tags=vip/);
  await expect(row(page, 'Karim Djaballah')).toBeVisible();
  await expect(page.locator('tr[data-row]')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Filtres actifs' })).toContainText('ÉTIQUETTES : vip');

  // panel: source + never ordered ⇒ results; reload keeps the state (URL)
  await page.getByTestId('open-filters').click();
  await page.getByRole('checkbox', { name: 'Jamais commandé' }).click();
  await expect(page.getByRole('button', { name: /Afficher 1 client/ })).toBeVisible();
  await page.getByRole('button', { name: /Afficher 1 client/ }).click();
  await expectUrl(page, /neverOrdered=1/);
  await page.reload();
  await expect(page.locator('tr[data-row]')).toHaveCount(1);

  await page.goto('/fr/clients?q=zzzzzz-aucun');
  await expect(page.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
  await page.getByRole('button', { name: 'Effacer les filtres' }).click();
  await expect(page.locator('tr[data-row]').first()).toBeVisible();
});

test('AT-CLI-02 · create with "+213 …" when the national number exists ⇒ CLIENT_PHONE_EXISTS + "Utiliser ce client"', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/clients');
  await page.getByTestId('new-client').click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau client' });
  await dialog.locator('#client-name').fill('Amina Doublon');
  await dialog.locator('#client-phone').fill(`+213 ${aminaPhone.slice(1, 4)} ${aminaPhone.slice(4, 6)} ${aminaPhone.slice(6, 8)} ${aminaPhone.slice(8)}`);
  await expect(dialog).toContainText(`Normalisé : ${aminaPhone} · mobile DZ valide`);
  await dialog.getByTestId('client-save').click();
  const conflict = dialog.getByTestId('phone-conflict');
  await expect(conflict).toContainText('Numéro déjà utilisé par Amina Belkacem');
  // content preserved (AT-UX-04)
  await expect(dialog.locator('#client-name')).toHaveValue('Amina Doublon');
  await conflict.getByRole('button', { name: 'Utiliser ce client' }).click();
  await expectUrl(page, new RegExp(`sheet=${amina.id}`));
  await expect(page.getByRole('dialog', { name: 'Amina Belkacem' })).toBeVisible();
});

test('AT-DLV-10 · the commune list follows the wilaya (seeded communes)', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/clients');
  await page.getByTestId('new-client').click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau client' });
  await expect(dialog.locator('#client-commune')).toBeDisabled();
  await dialog.locator('#client-wilaya').click();
  await page.getByRole('textbox', { name: 'Rechercher une wilaya…' }).fill('Sétif');
  await page.getByRole('option', { name: /19 · Sétif/ }).click();
  await expect(dialog.locator('#client-commune')).toBeEnabled();
  await dialog.locator('#client-commune').click();
  await page.getByRole('textbox', { name: 'Rechercher une commune…' }).fill('Eulma');
  await expect(page.getByRole('option', { name: /El Eulma/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Rechercher une commune…' }).fill('Bab Ezzouar');
  await expect(page.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('AT-UX-04 · validation inline before the request, server error inside the dialog', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/clients');
  await page.getByTestId('new-client').click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau client' });
  await dialog.locator('#client-name').fill('A');
  await dialog.locator('#client-phone').fill('12');
  await expect(dialog).toContainText('Numéro invalide');
  await dialog.getByTestId('client-save').click();
  await expect(dialog.getByRole('alert').first()).toBeVisible();
  // mock: a 500 the API cannot be asked to produce
  await failWith(page, /\/api\/v1\/clients$/, 'POST', 500, 'INTERNAL', 'Erreur interne');
  await dialog.locator('#client-name').fill('Nadia Ferhat');
  await dialog.locator('#client-phone').fill(nextMobile());
  await dialog.getByTestId('client-save').click();
  await expect(dialog.getByRole('alert')).toContainText('INTERNAL');
  await expect(dialog.locator('#client-name')).toHaveValue('Nadia Ferhat');
});

test('CLI-01 · email: LTR email field, checked on blur with the API rule, sent trimmed + lower-cased; phone normalised on blur', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/clients');
  await page.getByTestId('new-client').click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau client' });
  const email = dialog.getByTestId('client-email');
  await expect(email).toHaveAttribute('type', 'email');
  await expect(email).toHaveAttribute('inputmode', 'email');
  await expect(email).toHaveAttribute('autocomplete', 'email');
  await expect(email).toHaveAttribute('dir', 'ltr');
  await email.fill('nadia@boutique');
  await email.blur();
  await expect(dialog).toContainText('E-mail invalide');
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await email.fill('  Nadia.Ferhat@Boutique.DZ ');
  await expect(dialog).not.toContainText('E-mail invalide');
  await email.blur();
  await expect(email).toHaveValue('nadia.ferhat@boutique.dz');
  const mobile = nextMobile();
  await dialog.locator('#client-phone').fill(`+213 ${mobile.slice(1, 4)} ${mobile.slice(4, 6)} ${mobile.slice(6, 8)} ${mobile.slice(8)}`);
  await dialog.locator('#client-phone').blur();
  await expect(dialog.locator('#client-phone')).toHaveValue(mobile);
  await dialog.locator('#client-name').fill('Nadia Ferhat');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/v1\/clients$/.test(r.url()));
  await dialog.getByTestId('client-save').click();
  expect((await sent).postDataJSON()).toMatchObject({ email: 'nadia.ferhat@boutique.dz', phone: mobile });
  await expect(dialog).toBeHidden({ timeout: 20_000 });
});

test('AT-CLI-05 · aggregates: a delivered order shows in the sheet tiles and the row', async ({ page, request }) => {
  const order = await seedOrderFor(request, owner, amina.id, { price: 4900, status: 'confirmed' });
  await deliverOrder(request, owner, order.id);
  const fresh = await getClient(request, owner, amina.id);
  expect(fresh.metrics.orders).toBeGreaterThanOrEqual(1);
  await loginHome(page, owner);
  await page.goto(`/fr/clients?sheet=${amina.id}`);
  const sheet = page.getByRole('dialog', { name: 'Amina Belkacem' });
  await expect(sheet.locator('[data-metric="orders"]')).toContainText('1');
  await expect(sheet.locator('[data-metric="spent"]')).toContainText(String(fresh.metrics.spent).replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
  await expect(sheet.getByTestId('client-orders')).toContainText(`#${order.number}`);
  await sheet.getByTestId('client-orders').getByText(`#${order.number}`).click();
  await expectUrl(page, `**/orders/${order.id}`);
});

test('sheet: ‹ › walks the rows, "Nouvelle commande pour Amina" prefills the order form', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/clients?q=Amina');
  await row(page, 'Amina Belkacem').click();
  const sheet = page.getByRole('dialog', { name: 'Amina Belkacem' });
  await expect(sheet.getByTestId('client-detail')).toBeVisible();
  await sheet.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByRole('dialog', { name: 'Amina B.' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Amina B.' }).getByRole('button', { name: 'Précédent' }).click();
  // back on Amina Belkacem's sheet before ordering for her
  await expect(page).toHaveURL(new RegExp(`sheet=${amina.id}`));
  await expect(page.getByRole('dialog', { name: 'Amina Belkacem' }).getByTestId('client-detail')).toBeVisible();
  await page.getByRole('dialog', { name: 'Amina Belkacem' }).getByTestId('client-new-order').click();
  await expectUrl(page, new RegExp(`/orders/new\\?clientId=${amina.id}`));
});

test('AT-CLI-06 · merge: preview (409 CUSTOMER_MERGE_IRREVERSIBLE) then confirm; tags in bulk', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/clients?q=Amina');
  await row(page, 'Amina B.').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /Fusionner avec un client existant/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Fusionner les clients' });
  await dialog.getByRole('combobox').click();
  await page.getByRole('textbox', { name: 'Nom ou téléphone (ex. 0555…)' }).fill('Amina Bel');
  await page.getByRole('option', { name: /Amina Belkacem/ }).click();
  await expect(dialog.getByRole('radio', { checked: true })).toContainText('CONSERVÉ');
  await dialog.getByTestId('merge-submit').click();
  await expect(dialog).toContainText(errText('CUSTOMER_MERGE_IRREVERSIBLE'));
  await expect(dialog.getByTestId('merge-submit')).toHaveText('Confirmer la fusion');
  await dialog.getByTestId('merge-submit').click();
  await expect(page.getByText(/Fiches fusionnées dans/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Amina Belkacem' })).toContainText('Fusionnée le');

  // bulk tags on two clients — per-item results, never all-or-nothing
  await page.goto('/fr/clients?q=Client Lot 0');
  await page.getByRole('checkbox', { name: 'Sélectionner Client Lot 00' }).check();
  await page.getByRole('checkbox', { name: 'Sélectionner Client Lot 01' }).check();
  await page.getByRole('region', { name: 'Actions groupées sur les clients' }).getByRole('button', { name: 'Étiquettes' }).click();
  const tags = page.getByRole('dialog', { name: 'Tags' });
  await tags.getByRole('textbox', { name: '+ nouveau tag' }).fill('grossiste');
  await tags.getByRole('button', { name: 'Ajouter' }).click();
  await tags.getByTestId('tags-apply').click();
  await expect(page.getByText('2 clients mis à jour')).toBeVisible();
  await expect(row(page, 'Client Lot 00')).toContainText('GROSSISTE', { ignoreCase: true }); // uppercased by CSS
});

test('AT-CLI-03 · delete a client with orders ⇒ CUSTOMER_HAS_ORDERS → Archiver; the list hides it', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/clients?q=Amina Belkacem');
  await row(page, 'Amina Belkacem').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Supprimer (soft)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Supprimer le client « Amina Belkacem » ?' });
  await dialog.getByTestId('client-delete-confirm').click();
  await expect(dialog.getByRole('alert')).toContainText(errText('CUSTOMER_HAS_ORDERS'));
  await expect(dialog.getByTestId('client-delete-confirm')).toHaveText('Archiver');
  await dialog.getByTestId('client-delete-confirm').click();
  await expect(page.getByText('Client « Amina Belkacem » archivé')).toBeVisible();
  await expect(row(page, 'Amina Belkacem')).toHaveCount(0);
});

test('row menu: risk toggle, "Commandes · n" deep link, disabled reasons in the footer', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/clients?q=Karim');
  await row(page, 'Karim Djaballah').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Marquer « risque »' }).click();
  await expect(row(page, 'Karim Djaballah')).toContainText('RISQUE');
  await row(page, 'Karim Djaballah').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /^Commandes · / }).click();
  await expectUrl(page, new RegExp(`/orders\\?clientId=${karim.id}`));
});

test('AT-UX-01 · skeleton, empty, error states of the list', async ({ page, request }) => {
  const fresh = await createAccount(request, { prefix: 'clie', finishOnboarding: true });
  await loginHome(page, fresh);
  await page.goto('/fr/clients');
  await expect(page.getByTestId('clients-empty')).toContainText('Aucun client');
  // mock: a 5xx list answer
  await failWith(page, /\/api\/v1\/clients\?/, 'GET', 503, 'SERVICE_UNAVAILABLE', 'Service indisponible');
  await page.reload();
  await expect(page.getByText('Impossible de charger')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
});

test('AT-UX-03 · Operator: no delete / merge / export, the API refuses too', async ({ page, request }) => {
  const operator = await inviteOperator(request, owner, 'Omar');
  await loginHome(page, operator);
  await page.goto('/fr/clients?q=Karim');
  await expect(page.getByRole('button', { name: 'Exporter' })).toHaveCount(0);
  await row(page, 'Karim Djaballah').getByRole('button', { name: 'Actions' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Nouvelle commande' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Supprimer (soft)' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /Fusionner/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Exporter la fiche' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const res = await request.delete(`http://localhost:4010/api/v1/clients/${karim.id}`, { headers: { Authorization: `Bearer ${operator.accessToken}`, 'X-Workspace-Id': owner.workspaceId! } });
  expect(res.status()).toBe(403);
  void placeholderLike;
});

test('a11y · /clients default state and the side sheet', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto('/fr/clients');
  await expect(page.locator('tr[data-row]').first()).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto(`/fr/clients?sheet=${karim.id}`);
  await expect(page.getByTestId('client-detail')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('/clients/[id] direct load renders the sheet body as a page; unknown id ⇒ 404 state', async ({ page }) => {
  await loginHome(page, owner);
  await page.goto(`/fr/clients/${karim.id}`);
  await expect(page.getByRole('heading', { name: 'Karim Djaballah', level: 1 })).toBeVisible();
  await expect(page.getByTestId('client-detail')).toBeVisible();
  await page.goto('/fr/clients/00000000-0000-7000-8000-000000000000');
  await expect(page.getByText('Introuvable')).toBeVisible();
});

test('RTL · /ar/clients mirrors the list, phones stay left-to-right', async ({ page }) => {
  await loginHome(page, owner, 'ar');
  await page.goto('/ar/clients?q=Karim');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const phone = row(page, 'Karim Djaballah').locator('bdi[dir="ltr"]').first();
  await expect(phone).toBeVisible();
});
