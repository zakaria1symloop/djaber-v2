// M1 — auth, members and workspace lifecycle through the UI (13-acceptance-tests AT-AUTH-01…12, UI side).
// Needs the API on :4010 and the worker (dev mailbox `.local/mail`). AT-AUTH-11 (cross-workspace 404, table-driven)
// is an API integration test; its UI side is the localized 404 of e2e/shell.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { API, apiReady, authHeaders, createAccount, expectUrl, freshTotp, login, loginHome, logout, mailLink, PASSWORD, uniqueEmail, waitForMail, type Account } from './support/m1';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
});

// Local debugging: `E2E_OWNER=<e-mail of an onboarded owner created with the e2e password>` skips the sign-up tests
// (sign-ups are rate limited to 20 / h / IP) and runs the others with that account.
const DEBUG_OWNER = process.env.E2E_OWNER;
const owner = { email: DEBUG_OWNER ?? uniqueEmail('owner'), password: PASSWORD };
const operator = { email: uniqueEmail('operator'), password: PASSWORD };
let signedUpAt = 0;

test.describe('sign-up and login', () => {
  test('AT-AUTH-01 sign up ⇒ owned workspace on trial, verification mail, onboarding step 1', async ({ page, request }) => {
    test.skip(!!DEBUG_OWNER, 'E2E_OWNER debug run');
    signedUpAt = Date.now() - 2000;
    await page.goto('/fr/signup');
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
    // client validation first: nothing is sent with a weak password
    await page.locator('#firstName').fill('Amel');
    await page.locator('#lastName').fill('Benali');
    await page.locator('#email').fill(owner.email);
    await page.locator('#password').fill('abc12');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByText('8 caractères min, 1 lettre + 1 chiffre (5 saisis)')).toBeVisible();
    await page.locator('#password').fill(owner.password);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();

    await expectUrl(page, '**/fr/onboarding/welcome');
    await expect(page.getByRole('heading', { name: /Bienvenue, Amel/ })).toBeVisible();

    const mail = await waitForMail(owner.email, /^auth\/verify$/, { after: signedUpAt });
    expect(mailLink(mail)).toContain('/verify-email?token=');

    // what the API created (D60, D43): owner membership, Pro trial, 4 system messages × 3 locales
    const res = await request.post(`${API}/auth/login`, { data: { email: owner.email, password: owner.password } });
    const { data } = (await res.json()) as { data: { accessToken: string; user: { ownedWorkspaceId: string; memberships: { role: string }[] } } };
    expect(data.user.memberships).toHaveLength(1);
    expect(data.user.memberships[0]!.role).toBe('owner');
    const ws = await request.get(`${API}/workspace`, { headers: authHeaders({ accessToken: data.accessToken, workspaceId: data.user.ownedWorkspaceId }) });
    const w = ((await ws.json()) as { data: { onboardingStep: number; plan: { slug: string; status: string }; systemMessages: Record<string, Record<string, string>> } }).data;
    expect(w.plan.slug).toBe('pro');
    expect(w.plan.status).toBe('trial');
    expect(Object.keys(w.systemMessages).sort()).toEqual(['handoff', 'out_of_hours', 'out_of_stock', 'welcome']);
    for (const k of Object.keys(w.systemMessages)) expect(Object.keys(w.systemMessages[k]!).sort()).toEqual(['ar', 'en', 'fr']);

    // "Passer la configuration" → Home with the checklist at 0 / 4
    await page.getByRole('button', { name: 'Passer la configuration' }).click();
    await expectUrl(page, '**/fr/home');
    await expect(page.getByTestId('checklist-count')).toHaveText('0 / 4');
  });

  test('AT-AUTH-02 sign up with an existing e-mail ⇒ inline AUTH_EMAIL_TAKEN with links, form kept', async ({ page }) => {
    test.skip(!!DEBUG_OWNER, 'E2E_OWNER debug run');
    await page.goto('/fr/signup');
    await page.locator('#firstName').fill('Autre');
    await page.locator('#lastName').fill('Personne');
    await page.locator('#email').fill(owner.email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Cet e-mail est déjà utilisé' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/fr/login');
    // the typed e-mail is carried to the reset form
    await expect(alert.getByRole('link', { name: 'Mot de passe oublié ?' })).toHaveAttribute('href', /^\/fr\/forgot-password\?email=/);
    await expect(page).toHaveURL(/\/fr\/signup$/);
    await expect(page.locator('#firstName')).toHaveValue('Autre');
  });

  test('AT-AUTH-03 wrong password and unknown e-mail show the same form-level error', async ({ page }) => {
    await login(page, { email: owner.email, password: 'Wrong-pass1' });
    const alert = page.getByRole('alert').filter({ hasText: 'E-mail ou mot de passe incorrect.' });
    await expect(alert).toBeVisible();
    // form level, never on a field
    await expect(page.locator('#email')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#password')).not.toHaveAttribute('aria-invalid', 'true');

    await login(page, { email: uniqueEmail('nobody'), password: 'Wrong-pass1' });
    await expect(page.getByRole('alert').filter({ hasText: 'E-mail ou mot de passe incorrect.' })).toBeVisible();
    await expect(page).toHaveURL(/\/fr\/login/);
  });

  test('AT-AUTH-04 6th failed login in 15 min ⇒ 429 and a countdown, button disabled', async ({ page }) => {
    const email = uniqueEmail('locked');
    await page.goto('/fr/login');
    await page.locator('#email').fill(email);
    const submit = page.locator('form button[type=submit]');
    for (let i = 0; i < 5; i++) {
      await page.locator('#password').fill(`Wrong-pass${i}`);
      await submit.click();
      await expect(page.getByRole('alert').filter({ hasText: 'E-mail ou mot de passe incorrect.' })).toBeVisible();
      await expect(submit).toBeEnabled();
    }
    await page.locator('#password').fill('Wrong-pass6');
    await submit.click();
    await expect(page.getByRole('alert').filter({ hasText: /Trop de tentatives\. Réessayez dans \d{1,2}:\d{2}\./ })).toBeVisible();
    await expect(submit).toBeDisabled();
  });

  test('AT-AUTH-08 unverified account: Home banner with resend, then the link confirms the address', async ({ page }) => {
    test.skip(!!DEBUG_OWNER, 'E2E_OWNER debug run');
    await loginHome(page, owner);
    const banner = page.getByRole('status').filter({ hasText: 'Vérifiez votre e-mail pour pouvoir connecter une page' });
    await expect(banner).toContainText(owner.email);
    const before = Date.now() - 1000;
    await banner.getByRole('button', { name: 'Renvoyer' }).click();
    // 60 s cooldown on the button
    await expect(banner.getByRole('button', { name: /Renvoyer dans \d:\d{2}/ })).toBeDisabled();
    const mail = await waitForMail(owner.email, /^auth\/verify$/, { after: before });

    await page.goto(mailLink(mail));
    await expect(page.getByRole('heading', { name: 'Adresse confirmée ✓' })).toBeVisible();
    await expect(page.getByText(`${owner.email} est vérifiée`)).toBeVisible();
    await page.getByRole('link', { name: 'Continuer vers mon espace' }).click();
    await expectUrl(page, '**/fr/home');
    await expect(page.getByText('Vérifiez votre e-mail pour pouvoir connecter une page')).toHaveCount(0);

    // the link is single use
    await page.goto(mailLink(mail));
    await expect(page.getByRole('heading', { name: /Lien de vérification (invalide|expiré)/ })).toBeVisible();
  });

  test('AT-AUTH-05 a revoked session shows "Session expirée" and returns to the origin page after login', async ({ page, context }) => {
    await loginHome(page, owner);
    await page.goto('/fr/settings/members');
    await expect(page.locator(`[data-member="${owner.email}"]`)).toBeVisible();
    await page.waitForLoadState('networkidle');
    // the refresh token family is gone (reuse detection revokes it server side): every call answers 401, refresh included
    await context.clearCookies();
    await page.route('**/api/v1/**', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_REFRESH_REUSED', message: 'Session révoquée', ref: 'e2e' } }) }),
    );
    // the next call of the page (sessions list of Sécurité) finds the session gone
    await page.getByRole('navigation', { name: 'Paramètres' }).getByRole('link', { name: 'Sécurité' }).click();
    await expect(page.getByRole('heading', { name: 'Session expirée' })).toBeVisible();
    await expect(page.getByText('Vous reviendrez sur /settings/security')).toBeVisible();
    await page.unroute('**/api/v1/**');
    await page.getByRole('link', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/fr\/login\?returnTo=%2Fsettings%2Fsecurity/);
    await page.locator('#email').fill(owner.email);
    await page.locator('#password').fill(owner.password);
    await page.locator('form button[type=submit]').click();
    await expectUrl(page, '**/fr/settings/security');
    await expect(page.getByRole('heading', { name: 'Sécurité', exact: true })).toBeVisible();
    await expect(page.getByTestId('sessions')).toBeVisible();
  });

  test('AT-AUTH-06 reset link: valid ⇒ form, success logs in, second use ⇒ invalid; forgot always answers the same', async ({ page }) => {
    await page.goto('/fr/forgot-password');
    const before = Date.now() - 1000;
    await page.locator('#email').fill(owner.email);
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();
    await expect(page.getByText('Si un compte existe pour cet e-mail, un lien a été envoyé.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Renvoyer dans \d:\d{2}/ })).toBeDisabled();
    const link = mailLink(await waitForMail(owner.email, /^auth\/reset$/, { after: before }));

    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Réinitialiser le mot de passe' })).toBeVisible();
    // mismatch stays on the form
    await page.locator('#password').fill('Nouveau-pass2');
    await page.locator('#confirm').fill('Nouveau-pass3');
    await page.getByRole('button', { name: 'Réinitialiser' }).click();
    await expect(page.getByText('Ne correspond pas')).toBeVisible();
    await page.locator('#confirm').fill('Nouveau-pass2');
    await page.getByRole('button', { name: 'Réinitialiser' }).click();
    await expectUrl(page, '**/fr/home');
    owner.password = 'Nouveau-pass2';

    // used twice ⇒ the expired / invalid card with "Recevoir un nouveau lien"
    await logout(page);
    await page.goto(link);
    await expect(page.getByRole('heading', { name: /Lien (expiré|invalide)/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recevoir un nouveau lien' })).toBeVisible();
    await page.goto('/fr/reset-password?token=not-a-real-token-0123456789');
    await expect(page.getByRole('heading', { name: /Lien (expiré|invalide)/ })).toBeVisible();

    // the same answer for an unknown address
    await page.goto('/fr/forgot-password');
    await page.locator('#email').fill(uniqueEmail('ghost'));
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();
    await expect(page.getByText('Si un compte existe pour cet e-mail, un lien a été envoyé.')).toBeVisible();

    // the old password no longer works, the new one does
    await login(page, { email: owner.email, password: PASSWORD });
    await expect(page.getByRole('alert').filter({ hasText: 'E-mail ou mot de passe incorrect.' })).toBeVisible();
    await loginHome(page, owner);
  });
});

test.describe('two-factor authentication', () => {
  let account: Account;
  let secret = '';
  let codes: string[] = [];

  const enterOtp = async (page: Page, code: string) => {
    await page.getByRole('textbox', { name: 'Code à 6 chiffres 1' }).click();
    await page.keyboard.type(code);
  };

  test('AT-AUTH-07 enable 2FA, login asks the code, recovery code works once, regeneration needs the password', async ({ page, request }) => {
    account = await createAccount(request, { prefix: 'twofa', finishOnboarding: true });
    await loginHome(page, account);
    await page.goto('/fr/settings/security');

    // step 1–2: secret + code (a wrong code first)
    await page.getByRole('button', { name: 'Activer', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByAltText('QR code de configuration')).toBeVisible();
    secret = ((await dialog.getByTestId('totp-secret').textContent()) ?? '').replace(/\s/g, '');
    expect(secret.length).toBeGreaterThanOrEqual(16);
    await enterOtp(page, '000000');
    await expect(dialog.getByRole('alert')).toContainText('Code invalide');
    await enterOtp(page, await freshTotp(secret));

    // step 3: 10 recovery codes, the dialog closes only once they are saved
    await expect(dialog.getByTestId('recovery-codes').getByRole('listitem')).toHaveCount(10);
    codes = await dialog.getByTestId('recovery-codes').getByRole('listitem').allTextContents();
    await expect(dialog.getByRole('button', { name: 'Terminer' })).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Terminer' }).click();
    await expect(page.getByText('ACTIVÉE', { exact: true })).toBeVisible();

    // login now stops at the 2FA step
    await logout(page);
    await login(page, account);
    await expect(page.getByRole('heading', { name: 'Vérification en deux étapes' })).toBeVisible();
    await expect(page.getByText(/Le code expire dans \d:\d{2}\./)).toBeVisible();
    await enterOtp(page, '000000');
    await expect(page.getByRole('alert').filter({ hasText: 'Code invalide' })).toBeVisible();
    await enterOtp(page, await freshTotp(secret));
    await expectUrl(page, '**/fr/home');

    // a recovery code works once
    await logout(page);
    await login(page, account);
    await page.getByRole('button', { name: 'Utiliser un code de récupération' }).click();
    await page.locator('#recovery').fill(codes[0]!);
    await page.getByRole('button', { name: 'Vérifier' }).click();
    await expectUrl(page, '**/fr/home');
    await logout(page);
    await login(page, account);
    await page.getByRole('button', { name: 'Utiliser un code de récupération' }).click();
    await page.locator('#recovery').fill(codes[0]!);
    await page.getByRole('button', { name: 'Vérifier' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Code invalide' })).toBeVisible();
    await page.locator('#recovery').fill(codes[1]!);
    await page.getByRole('button', { name: 'Vérifier' }).click();
    await expectUrl(page, '**/fr/home');

    // regeneration: wrong password inline, right password ⇒ 10 new codes
    await page.goto('/fr/settings/security');
    await page.getByRole('button', { name: 'Régénérer les codes' }).click();
    const regen = page.getByRole('dialog');
    await regen.locator('#twofa-pw').fill('Wrong-pass1');
    await regen.getByRole('button', { name: 'Régénérer' }).click();
    await expect(regen.getByRole('alert')).toContainText('Mot de passe actuel incorrect');
    await regen.locator('#twofa-pw').fill(account.password);
    await regen.getByRole('button', { name: 'Régénérer' }).click();
    await expect(regen.getByTestId('recovery-codes').getByRole('listitem')).toHaveCount(10);
    const fresh = await regen.getByTestId('recovery-codes').getByRole('listitem').allTextContents();
    expect(fresh).not.toContain(codes[2]);
  });
});

test.describe('members, ownership and deletion', () => {
  test('AT-AUTH-09 owner invites an operator who accepts; the operator has no owner / admin controls', async ({ page, browser }) => {
    await loginHome(page, owner);
    await page.goto('/fr/settings/members');
    const before = Date.now() - 1000;
    await page.getByRole('button', { name: 'Inviter un membre' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#invite-email').fill(operator.email);
    await dialog.getByRole('radio', { name: /Opérateur/ }).check();
    await dialog.getByRole('button', { name: 'Envoyer l’invitation' }).click();
    const row = page.locator(`[data-invitation="${operator.email}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: /Renvoyer \(dans \d:\d{2}\)/ })).toBeDisabled();

    // inviting the same address again: inline INVITATION_PENDING, the dialog keeps its content
    await page.getByRole('button', { name: 'Inviter un membre' }).first().click();
    await dialog.locator('#invite-email').fill(operator.email);
    await dialog.getByRole('button', { name: 'Envoyer l’invitation' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Invitation déjà envoyée à cet e-mail.');
    await expect(dialog.locator('#invite-email')).toHaveValue(operator.email);
    await dialog.getByRole('button', { name: 'Annuler' }).click();

    // the invitee opens the link logged out and signs up with the fixed e-mail: no workspace is created (D30)
    const link = mailLink(await waitForMail(operator.email, /^workspace\/invitation$/, { after: before }));
    const guest = await browser.newContext({ locale: 'fr-DZ' });
    const p = await guest.newPage();
    await p.goto(link);
    await expect(p.getByRole('heading', { name: /Rejoindre « .+ »/ })).toBeVisible();
    await expect(p.locator('#email')).toHaveValue(operator.email);
    await expect(p.locator('#email')).toBeDisabled();
    await p.locator('#firstName').fill('Nadia');
    await p.locator('#lastName').fill('Ferhat');
    await p.locator('#password').fill(operator.password);
    await p.getByRole('button', { name: 'Créer mon compte et rejoindre' }).click();
    await expectUrl(p, '**/fr/home');

    // operator: no workspace settings, no danger zone, no invite button, 403 on a direct link
    await p.goto('/fr/settings/members');
    await expect(p.getByRole('heading', { name: 'Membres & invitations' })).toBeVisible();
    const subnav = p.getByRole('navigation', { name: 'Paramètres' });
    await expect(subnav.getByRole('link', { name: 'Profil' })).toBeVisible();
    await expect(subnav.getByRole('link', { name: 'Zone de danger' })).toHaveCount(0);
    await expect(subnav.getByRole('link', { name: 'Espace de travail' })).toHaveCount(0);
    await expect(p.getByRole('button', { name: 'Inviter un membre' })).toHaveCount(0);
    await expect(p.locator(`[data-member="${owner.email}"]`).getByRole('button', { name: 'Actions' })).toHaveCount(0);
    await p.goto('/fr/settings/danger');
    await expect(p.getByText('403', { exact: true })).toBeVisible();
    await expect(p.getByText('Accès refusé')).toBeVisible();
    await guest.close();

    // owner side: the member is listed with its role
    await page.reload();
    const member = page.locator(`[data-member="${operator.email}"]`);
    await expect(member).toContainText('Nadia Ferhat');
    await expect(member).toContainText('Opérateur');
    await expect(page.locator(`[data-invitation="${operator.email}"]`)).toHaveCount(0);
  });

  test('AT-AUTH-10 the owner cannot be removed or demoted; an invited user may create one workspace', async ({ page }) => {
    await loginHome(page, owner);
    await page.goto('/fr/settings/members');
    // owner row: only the transfer, greyed with its reason while no admin exists
    await page.locator(`[data-member="${owner.email}"]`).getByRole('button', { name: 'Actions' }).click();
    const transfer = page.getByRole('menuitem', { name: 'Transférer la propriété' });
    await expect(transfer).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Le nouveau propriétaire doit être un admin de l\'espace.')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Retirer' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // promote the operator, then the transfer dialog opens and asks for the password
    await page.locator(`[data-member="${operator.email}"]`).getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Passer Admin' }).click();
    await expect(page.locator(`[data-member="${operator.email}"]`)).toContainText('Admin');
    await page.locator(`[data-member="${owner.email}"]`).getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Transférer la propriété' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#transfer-password').fill('Wrong-pass1');
    await dialog.getByRole('button', { name: 'Transférer' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/incorrect/);
    await expect(dialog.locator('#transfer-password')).toHaveValue('Wrong-pass1');
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await logout(page);

    // the invited user owns nothing: "Créer un espace" is offered once
    await loginHome(page, operator);
    await page.getByRole('button', { name: /Menu utilisateur/ }).click();
    await page.getByRole('menuitem', { name: 'Créer un espace' }).click();
    await expectUrl(page, '**/fr/workspaces/new');
    await page.locator('#name').fill('Atelier E2E');
    await page.getByRole('button', { name: 'Créer et démarrer l’onboarding' }).click();
    await expectUrl(page, '**/fr/onboarding/welcome');
    await page.getByRole('button', { name: 'Passer la configuration' }).click();
    await expectUrl(page, '**/fr/home');
    // two memberships ⇒ the switcher appears; the menu no longer offers a creation
    await expect(page.getByRole('button', { name: 'Changer d’espace' })).toContainText('Atelier E2E');
    await page.getByRole('button', { name: /Menu utilisateur/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Créer un espace' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/fr/workspaces/new');
    await expect(page.getByText('Vous possédez déjà un espace de travail')).toBeVisible();
  });

  test('AT-AUTH-12 workspace deletion: typed confirmation ⇒ scheduled state and banner, cancel restores it', async ({ page }) => {
    await loginHome(page, operator);
    // the session opens on the owned workspace ("Atelier E2E")
    await expect(page.getByRole('button', { name: 'Changer d’espace' })).toContainText('Atelier E2E');
    await page.goto('/fr/settings/danger');
    await page.getByRole('button', { name: 'Supprimer l’espace…' }).click();
    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: 'Programmer la suppression' });
    await dialog.locator('#confirm-name').fill('atelier e2e');
    await dialog.locator('#delete-ws-password').fill(operator.password);
    await expect(submit).toBeDisabled(); // the name must match exactly
    // tester report 25/10: the hint names the workspace; no debt note unless the API answers WORKSPACE_HAS_DEBT
    await expect(dialog.getByText('Tapez « Atelier E2E » exactement : le nom de l'espace, pas votre e-mail.')).toBeVisible();
    await expect(dialog.getByText(/WORKSPACE_HAS_DEBT/)).toHaveCount(0);
    await dialog.locator('#confirm-name').fill('Atelier E2E');
    await dialog.locator('#delete-ws-password').fill('Wrong-pass1');
    await submit.click();
    await expect(dialog.getByRole('alert').filter({ hasText: /mot de passe/i })).toBeVisible();
    await dialog.locator('#delete-ws-password').fill(operator.password);
    await submit.click();

    await expect(page.locator('[data-state="scheduled"]')).toContainText('SUPPRESSION J+30');
    await expect(page.getByRole('alert').filter({ hasText: 'Suppression de l’espace programmée le' })).toBeVisible();
    // every mutation is refused meanwhile (409 WORKSPACE_DELETION_SCHEDULED ⇒ toast)
    await page.goto('/fr/settings/stock-mode');
    await page.getByRole('radio', { name: /Avancé/ }).click();
    await expect(page.getByText(/WORKSPACE_DELETION_SCHEDULED|Suppression programmée/).first()).toBeVisible();

    await page.goto('/fr/settings/danger');
    await page.getByRole('button', { name: 'Annuler la suppression' }).first().click();
    await expect(page.getByRole('button', { name: 'Supprimer l’espace…' })).toBeVisible();
    await expect(page.getByText('Suppression de l’espace programmée le')).toHaveCount(0);
  });
});
