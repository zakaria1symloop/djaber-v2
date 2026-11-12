// M1 — settings: quick replies, system messages, handoff reminder (AT-SET-01, UI side). Needs the API on :4010.
import { expect, test } from '@playwright/test';
import { API, apiReady, authHeaders, createAccount, loginHome, type Account } from './support/m1';

test.describe.configure({ mode: 'serial' });
let account: Account;
test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  account = await createAccount(request, { prefix: 'set', finishOnboarding: true });
});

test('AT-SET-01 quick replies: create, duplicate title inline, edit, reorder, delete', async ({ page }) => {
  await loginHome(page, account);
  await page.goto('/fr/settings/quick-replies');
  await expect(page.getByRole('heading', { name: 'Réponses rapides' })).toBeVisible();
  const titles = () => page.getByTestId('quick-replies').getByRole('listitem').evaluateAll((els) => els.map((e) => e.getAttribute('data-title')));
  const dialog = page.getByRole('dialog');
  const add = async (title: string, body: string, shortcut = '') => {
    await page.getByRole('button', { name: '+ Ajouter une réponse rapide' }).first().click();
    await dialog.locator('#qr-title').fill(title);
    await dialog.locator('#qr-body').fill(body);
    await dialog.locator('#qr-shortcut').fill(shortcut);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  };

  await add('Livraison Sétif', 'Bonjour {prénom}, livraison à Sétif : 500 DA à domicile.', '/livr');
  await expect(page.locator('[data-title="Livraison Sétif"]')).toBeVisible();
  await add('Stop-desk Alger', 'Retrait en stop-desk à Alger : 350 DA.');
  await expect(page.locator('[data-title="Stop-desk Alger"]')).toBeVisible();

  // invalid shortcut: client validation, nothing sent
  await page.getByRole('button', { name: '+ Ajouter une réponse rapide' }).first().click();
  await dialog.locator('#qr-title').fill('Retours');
  await dialog.locator('#qr-body').fill('Retour possible sous 7 jours.');
  await dialog.locator('#qr-shortcut').fill('retour');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Format : /mot');
  // duplicate title (same language): inline error inside the dialog, content preserved
  await dialog.locator('#qr-shortcut').fill('');
  await dialog.locator('#qr-title').fill('Stop-desk Alger');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Titre déjà utilisé.');
  await expect(dialog.locator('#qr-body')).toHaveValue('Retour possible sous 7 jours.');
  await dialog.locator('#qr-title').fill('Retours');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.locator('[data-title="Retours"]')).toBeVisible();

  // edit through Actions ⌄ (first item = Modifier)
  await page.locator('[data-title="Stop-desk Alger"]').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Modifier' }).click();
  await expect(dialog.locator('#qr-title')).toHaveValue('Stop-desk Alger');
  await dialog.locator('#qr-title').fill('Stop-desk Alger centre');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.locator('[data-title="Stop-desk Alger centre"]')).toBeVisible();
  await expect(page.locator('[data-title="Stop-desk Alger"]')).toHaveCount(0);

  // reorder: "Monter" on the last row, persisted after a reload; first row cannot go up (reason shown)
  const before = await titles();
  const last = before[before.length - 1]!;
  await page.locator(`[data-title="${last}"]`).getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Monter' }).click();
  const expected = [...before.slice(0, -2), last, before[before.length - 2]!];
  await expect.poll(titles).toEqual(expected);
  await page.reload();
  await expect.poll(titles).toEqual(expected);
  await page.locator(`[data-title="${expected[0]}"]`).getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Monter' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('Monter : déjà en première position')).toBeVisible();
  await page.keyboard.press('Escape');

  // delete with confirmation
  await page.locator('[data-title="Retours"]').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Supprimer' }).click();
  await expect(dialog.getByRole('heading', { name: 'Supprimer « Retours » ?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.locator('[data-title="Retours"]')).toHaveCount(0);
});

test('AT-SET-01 system messages: edit per locale, preview, reset restores the 3 default locales', async ({ page, request }) => {
  await loginHome(page, account);
  await page.goto('/fr/settings/system-messages');
  const handoff = page.locator('#sm-handoff');
  const frDefault = 'Je transmets à un membre de l\'équipe qui vous répondra très vite.';
  await expect(handoff).toHaveValue(frDefault);
  // 4 editable keys + the 3 fixed platform texts, read-only
  await expect(page.locator('[data-message]')).toHaveCount(4);
  await expect(page.getByText('TEXTE FIXE · VOCAL NON COMPRIS — non modifiable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

  // French + English edited, Arabic untouched; the preview replaces {shop}
  await handoff.fill('Un collègue prend le relais dans l’heure 🙏');
  await page.locator('#sm-welcome').fill('Salam, bienvenue chez {shop} !');
  await expect(page.locator('[data-preview="welcome"]')).toHaveText('Salam, bienvenue chez Boutique de Amel !');
  await page.getByRole('radio', { name: 'English' }).click();
  await page.locator('#sm-handoff').fill('A colleague will take over within the hour.');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

  const stored = async () =>
    ((await (await request.get(`${API}/workspace/system-messages`, { headers: authHeaders(account) })).json()) as { data: Record<string, Record<string, string>> }).data;
  let s = await stored();
  expect(s.handoff!.fr).toBe('Un collègue prend le relais dans l’heure 🙏');
  expect(s.handoff!.en).toBe('A colleague will take over within the hour.');
  expect(s.handoff!.ar).toBe('سأحوّلك إلى أحد أفراد الفريق ليرد عليك قريبًا.');
  expect(s.welcome!.fr).toBe('Salam, bienvenue chez {shop} !');

  await page.reload();
  await expect(page.locator('#sm-handoff')).toHaveValue('Un collègue prend le relais dans l’heure 🙏');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('#sm-handoff')).toHaveAttribute('dir', 'rtl');

  // "Réinitialiser" on handoff: the 3 locales go back to the defaults, the other keys keep their text
  await page.locator('[data-message="handoff"]').getByRole('button', { name: 'Réinitialiser' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Message système — réinitialiser' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Réinitialiser' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('radio', { name: 'Français' }).click();
  await expect(page.locator('#sm-handoff')).toHaveValue(frDefault);
  s = await stored();
  expect(s.handoff!.fr).toBe(frDefault);
  expect(s.handoff!.en).toBe("I'm passing this to a team member who will reply shortly.");
  expect(s.welcome!.fr).toBe('Salam, bienvenue chez {shop} !');
});

test('AT-SET-01 handoff reminder 0 disables the owner reminder; auto-pause and free delivery are saved', async ({ page, request }) => {
  await loginHome(page, account);
  await page.goto('/fr/settings/workspace');
  await expect(page.locator('#handoffReminderMin')).toHaveValue('30');
  const save = page.getByRole('button', { name: 'Enregistrer' });
  await expect(save).toBeDisabled();

  // validation: the phone must be Algerian, the reminder within 0–1440
  await page.locator('#phone').fill('12345');
  await page.locator('#handoffReminderMin').fill('5000');
  await save.click();
  await expect(page.getByText('Numéro invalide (ex. 0555123456)')).toBeVisible();
  await expect(page.getByText('Valeur hors limites (0–1440)')).toBeVisible();

  await page.locator('#phone').fill('+213 550 11 22 33');
  await page.locator('#phone').blur();
  await expect(page.locator('#phone')).toHaveValue('0550112233'); // normalised on blur
  await page.locator('#handoffReminderMin').fill('0');
  await page.locator('#freeDeliveryThreshold').fill('8000');
  await page.getByRole('switch', { name: /Répondre manuellement met l’IA en pause/ }).click();
  await save.click();
  await expect(save).toBeDisabled();

  const w = ((await (await request.get(`${API}/workspace`, { headers: authHeaders(account) })).json()) as { data: Record<string, unknown> }).data;
  expect(w.handoffReminderMin).toBe(0);
  expect(w.freeDeliveryThreshold).toBe(8000);
  expect(w.autoPauseOnManualReply).toBe(false);
  expect(w.phone).toBe('0550112233');

  await page.reload();
  await expect(page.locator('#handoffReminderMin')).toHaveValue('0');
  await expect(page.locator('#freeDeliveryThreshold')).toHaveValue('8 000'); // MoneyInput groups thousands
  await expect(page.getByRole('switch', { name: /Répondre manuellement met l’IA en pause/ })).toHaveAttribute('aria-checked', 'false');

  // leave guard on a dirty form
  await page.locator('#name').fill('Boutique Amel');
  await page.getByRole('link', { name: 'Profil', exact: true }).click();
  const guard = page.getByRole('dialog');
  await expect(guard.getByRole('heading', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
  await guard.getByRole('button', { name: 'Rester' }).click();
  await expect(page).toHaveURL(/\/fr\/settings\/workspace$/);
  await expect(page.locator('#name')).toHaveValue('Boutique Amel');
});

test('members at the plan limit: "Inviter un membre" greyed with PLAN_LIMIT + "Changer de plan"; revoking an invitation is confirmed', async ({ page, request }) => {
  // one pending invitation, then the plan is served with maxMembers = members + invitations (the API answers 403 PLAN_LIMIT)
  const invitee = `limit-${Date.now()}@example.dz`;
  const res = await request.post(`${API}/workspace/invitations`, { headers: authHeaders(account), data: { email: invitee, role: 'operator' } });
  expect(res.status()).toBeLessThan(300);
  await page.route(/\/api\/v1\/workspace$/, async (route) => {
    const r = await route.fetch();
    const body = (await r.json()) as { data: { plan: { limits: { maxMembers: number } } } };
    body.data.plan.limits.maxMembers = 2;
    await route.fulfill({ response: r, json: body });
  });
  await loginHome(page, account);
  await page.goto('/fr/settings/members');
  const invite = page.getByTestId('members-invite');
  await expect(invite).toBeDisabled();
  await expect(invite).toHaveAttribute('title', /Limite du plan atteinte/);
  await expect(page.getByTestId('members-change-plan')).toHaveAttribute('href', '/fr/settings/billing');

  const row = page.locator(`[data-invitation="${invitee}"]`);
  await row.getByTestId('invitation-revoke').click();
  const confirm = page.getByRole('dialog', { name: `Révoquer l’invitation de ${invitee} ?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Annuler' }).click();
  await expect(row).toBeVisible();
  await row.getByTestId('invitation-revoke').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Révoquer' }).click();
  await expect(row).toHaveCount(0);
});
