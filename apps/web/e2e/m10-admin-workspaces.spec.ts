// M10 — admin shell + ADM-02 workspaces (Figma "ADM-01 — Platform admin — overview" sidebar, "ADM-02 — Platform admin —
// workspaces list + detail sheet", "DLG — Platform admin — dialogs catalogue") against the real API: shell guard and role
// tag, L6 states with filters in the URL, detail sheet tabs, suspend / reactivate (AT-DLG-70), credits (AT-DLG-71),
// create a workspace for a client (AT-DLG-74), read-only impersonation with the red bar (AT-IMP-01, AT-DLG-75,
// AT-ERR-02) and the AT-ST-11 workspace states.
import { expect, test, type Page } from '@playwright/test';
import { API, authHeaders, createAccount, loginHome, uniqueEmail, type Account } from './support/m1';
import { loginAdmin, modAdmin, type ModAdmin } from './support/m10-mod';

test.describe.configure({ mode: 'serial' });

let admin: ModAdmin;
let merchant: Account;
let page: Page;
let wsId: string;
let wsName: string;

test.beforeAll(async ({ request, browser }) => {
  test.setTimeout(240_000);
  admin = await modAdmin(request, 'super_admin', 'm10wa');
  merchant = await createAccount(request, { prefix: 'm10wa-shop', finishOnboarding: true });
  wsName = `Boutique WA ${Date.now().toString(36)}`;
  const ws = await (await request.patch(`${API}/workspace`, { headers: authHeaders(merchant), data: { name: wsName } })).json();
  wsId = ws.data.id;
  expect(ws.data.name).toBe(wsName);
  page = await (await browser.newContext({ locale: 'fr-DZ', timezoneId: 'Africa/Algiers' })).newPage();
  await loginAdmin(page, admin, '/fr/admin/workspaces');
});

/** In-app navigation through a sidebar link (a full reload would end the in-memory impersonation): retried until the URL changes. */
async function navigate(name: string, url: RegExp) {
  await expect(async () => {
    await page.getByRole('link', { name, exact: true }).first().click();
    await expect(page).toHaveURL(url, { timeout: 3_000 });
  }).toPass({ timeout: 25_000 });
}

test.afterAll(async () => {
  await page?.context().close();
});

test('admin shell: role tag, every admin area in the sidebar, "← Retour à mon espace"', async () => {
  await expect(page.getByTestId('admin-role-tag')).toHaveText('PLATEFORME · SUPER ADMIN');
  const nav = page.getByRole('navigation').first();
  for (const label of ["Vue d'ensemble", 'Espaces de travail', 'Utilisateurs', 'Modération', 'Signalements', 'Support', 'Plans', 'Abonnements & factures', 'Crédits & promos', 'Fournisseurs IA', "Préréglages d'agents", 'Contenu (CMS)', "Journal d'audit", 'Tâches & santé', 'Paramètres plateforme', 'Équipe plateforme', '← Retour à mon espace'])
    await expect(nav.getByRole('link').filter({ has: page.getByText(label, { exact: true }) })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Espaces de travail', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('a member without a platform role gets the 403 page on /admin', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'fr-DZ', timezoneId: 'Africa/Algiers' });
  const p = await ctx.newPage();
  await loginHome(p, merchant);
  await p.goto('/fr/admin/plans');
  await expect(p.getByText('Votre rôle plateforme (—) ne permet pas cette action (403).')).toBeVisible();
  await ctx.close();
});

test('AT-ST-11 workspaces list: status pill, search + filters in the URL, filtered-empty, detail sheet tabs', async () => {
  await page.goto(`/fr/admin/workspaces?q=${encodeURIComponent(wsName)}`);
  const row = page.getByRole('row', { name: new RegExp(wsName) });
  await expect(row).toBeVisible();
  await expect(row.locator('[data-pill]')).toHaveText(/ESSAI|ACTIF/);
  // filter chip → URL; a filter matching nothing → filtered-empty with "Effacer les filtres"
  await page.goto(`/fr/admin/workspaces?q=${encodeURIComponent(wsName)}&status=suspended`);
  await expect(page.getByText('Aucun résultat')).toBeVisible();
  await page.getByRole('button', { name: 'Effacer les filtres' }).click();
  await expect(page).not.toHaveURL(/status=/);
  // sheet in the URL, tabs in `stab`
  await page.goto(`/fr/admin/workspaces?q=${encodeURIComponent(wsName)}&sheet=${wsId}`);
  const sheet = page.getByTestId('ws-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Propriétaire');
  await expect(sheet).toContainText(merchant.email);
  await sheet.getByRole('button', { name: /Membres/ }).click();
  await expect(page).toHaveURL(/stab=members/);
  await expect(sheet).toContainText(merchant.email);
  await sheet.getByRole('button', { name: 'Résumé' }).click();
});

test('AT-DLG-71 Ajouter des crédits: amount + reason ≥ 10 chars, credited with a toast', async () => {
  await page.goto(`/fr/admin/workspaces?q=${encodeURIComponent(wsName)}&sheet=${wsId}`);
  await page.getByTestId('ws-btn-add_credits').click();
  const dlg = page.getByTestId('dlg-credits');
  await dlg.getByLabel('Crédits').fill('250');
  await dlg.getByLabel('Motif').fill('court');
  await expect(page.getByTestId('dlg-credits-submit')).toBeDisabled();
  await dlg.getByLabel('Motif').fill('Incident OpenAI du 05 oct. (geste)');
  await page.getByTestId('dlg-credits-submit').click();
  await expect(page.getByText('250 crédits ajoutés.')).toBeVisible();
});

test('AT-DLG-70 Suspendre: reason list, detail ≥ 10 chars, owner e-mail toggle ⇒ SUSPENDU; Réactiver with a reason', async () => {
  await page.goto(`/fr/admin/workspaces?q=${encodeURIComponent(wsName)}&sheet=${wsId}`);
  await page.getByTestId('ws-btn-suspend').click();
  const dlg = page.getByTestId('dlg-suspend');
  await expect(dlg.getByRole('radio')).toHaveCount(5);
  await dlg.getByRole('radio', { name: 'Impayé' }).check();
  await expect(dlg.getByRole('checkbox', { name: "Envoyer l'e-mail de suspension au propriétaire" })).toBeChecked();
  await expect(page.getByTestId('dlg-suspend-submit')).toBeDisabled();
  await dlg.getByLabel('Détail (journalisé, visible par le marchand)').fill('Trois factures impayées · relances sans réponse');
  await page.getByTestId('dlg-suspend-submit').click();
  await expect(page.getByText('Espace suspendu.')).toBeVisible();
  await expect(page.locator(`tr[data-row="${wsId}"] [data-pill]`)).toHaveText('SUSPENDU');
  // filtered by status=suspended it is listed
  await page.goto(`/fr/admin/workspaces?q=${encodeURIComponent(wsName)}&status=suspended&sheet=${wsId}`);
  await expect(page.locator(`tr[data-row="${wsId}"]`)).toBeVisible();
  await page.getByTestId('ws-btn-reactivate').click();
  await page.getByTestId('dlg-reactivate').getByLabel('Raison').fill('Paiement reçu par virement CCP');
  await page.getByTestId('dlg-reactivate-submit').click();
  await expect(page.getByText('Espace réactivé.')).toBeVisible();
});

test('AT-DLG-74 Créer un espace pour un client: the new workspace opens in the sheet', async () => {
  await page.goto('/fr/admin/workspaces');
  await page.getByTestId('create-workspace').click();
  const dlg = page.getByTestId('dlg-create-ws');
  const name = `Bijoux ${Date.now().toString(36)}`;
  await dlg.getByLabel("Nom de l'espace").fill(name);
  await dlg.getByLabel('E-mail du propriétaire').fill(uniqueEmail('m10wa-client'));
  // journeys 16/11 J13-8: negative credits refused before submit; the reason is typed by the admin
  await dlg.getByLabel('Crédits initiaux').fill('-50');
  await expect(dlg).toContainText('Doit être supérieur à 0.');
  await expect(page.getByTestId('dlg-create-ws-submit')).toBeDisabled();
  await dlg.getByLabel('Crédits initiaux').fill('500');
  await dlg.getByLabel('Raison').fill('Création assistée salon Expo Alger');
  await page.getByTestId('dlg-create-ws-submit').click();
  await expect(page.getByText(`Espace « ${name} » créé.`)).toBeVisible();
  await expect(page).toHaveURL(/sheet=/);
  await expect(page.getByTestId('ws-sheet')).toBeVisible();
});

test('AT-IMP-01 / AT-DLG-75 read-only impersonation: reason ≥ 10, no mode selector, red bar in the merchant shell, writes refused, Quitter', async () => {
  await page.goto(`/fr/admin/workspaces?q=${encodeURIComponent(wsName)}&sheet=${wsId}`);
  await page.getByTestId('ws-btn-impersonate').click();
  const dlg = page.getByTestId('dlg-impersonate');
  await expect(dlg).toContainText('Mode : lecture seule uniquement');
  await expect(dlg.getByRole('radio')).toHaveCount(0);
  await dlg.getByLabel('Raison').fill('trop court');
  await expect(page.getByTestId('dlg-impersonate-submit')).toBeEnabled();
  await dlg.getByLabel('Raison').fill('court');
  await expect(page.getByTestId('dlg-impersonate-submit')).toBeDisabled();
  await dlg.getByLabel('Raison').fill('Ticket #4821 : vérifier la synchro Sheets');
  await page.getByTestId('dlg-impersonate-submit').click();
  await expect(page).toHaveURL(/\/fr\/home/);
  const bar = page.getByTestId('impersonation-bar');
  await expect(bar).toContainText(`Vous agissez en tant que ${wsName} · lecture seule ·`);
  await expect(bar).toContainText(/\d+ min/);
  // in-app navigation keeps the session (the token lives in memory only: a reload ends the view on this tab)
  await navigate('Clients', /\/fr\/clients/);
  await expect(bar).toBeVisible();
  await page.getByTestId('impersonation-quit').click();
  await expect(page).toHaveURL(new RegExp(`/fr/admin/workspaces\\?sheet=${wsId}`));
  await expect(page.getByTestId('impersonation-bar')).toHaveCount(0);
});

test('AT-ERR-02 impersonation: a write ⇒ ADMIN_IMPERSONATION_FORBIDDEN_ACTION toast under the red bar; expiry ⇒ state back to admin', async () => {
  await page.goto(`/fr/admin/workspaces?q=${encodeURIComponent(wsName)}&sheet=${wsId}`);
  await page.getByTestId('ws-btn-impersonate').click();
  await page.getByTestId('dlg-impersonate').getByLabel('Raison').fill('Vérifier le paramétrage des réponses rapides');
  await page.getByTestId('dlg-impersonate-submit').click();
  await expect(page.getByTestId('impersonation-bar')).toBeVisible();
  // the only write the read-only shell still offers: the language preference (PATCH /me) — refused under the session
  await page.getByRole('button', { name: /Menu utilisateur/ }).click();
  await page.getByRole('menuitem', { name: /Langue/ }).click();
  await page.getByRole('radio', { name: 'English' }).check();
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText('Action interdite en mode « connecté en tant que ».').first()).toBeVisible();
  await page.getByRole('dialog', { name: 'Langue & région' }).getByRole('button', { name: 'Fermer' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Langue & région' })).toHaveCount(0);
  // mock: the 30 min window cannot be waited for — the next merchant read answers the expiry code
  await page.route(/\/api\/v1\/orders/, (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ADMIN_IMPERSONATION_EXPIRED', message: 'Session « en tant que » expirée (30 min).', ref: 'e2e' } }) }));
  await navigate('Commandes', /\/fr\/orders/);
  await expect(page.getByText("Session d'impersonation terminée")).toBeVisible();
  await page.unroute(/\/api\/v1\/orders/);
  await page.getByRole('button', { name: "Retour à l'admin" }).click();
  await expect(page).toHaveURL(/\/fr\/admin\/workspaces/);
});
