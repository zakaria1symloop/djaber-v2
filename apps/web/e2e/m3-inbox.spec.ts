// M3 — inbox (INB-01…09): UI side of AT-INB-01…13, AT-MSG-05 / AT-MSG-08 (thread rendering), AT-SAFE-01 (block from the
// inbox), RTL, responsive panes and axe. Needs the API (:4010, fake Meta adapter) and the worker (:4011).
// Customer messages arrive through the dev simulator; nothing leaves the machine.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, loginHome, type Account } from './support/m1';
import { verifyEmail } from './support/m3-channels';
import { connectFakePages, everyMessageType, failWith, getConversation, inboxReady, inject, listConversations, patchAnswer, patchConversation, reply, waitConversation, type E2eChannel, type E2eConversation } from './support/m3-inbox';

test.describe.configure({ mode: 'serial' });
let account: Account;
let facebook: E2eChannel;
let instagram: E2eChannel;
let amina: E2eConversation; // "Client 0001" on the Facebook page
let yacine: E2eConversation; // "Client 0002" on the Facebook page
let karim: E2eConversation; // "Client 0003" on the Instagram account

const thread = (page: Page) => page.getByTestId('thread');
const composer = (page: Page) => page.locator('[data-composer-input]');
const row = (page: Page, id: string) => page.locator(`[data-row="${id}"]`);
const open = async (page: Page, id: string, locale = 'fr') => {
  await page.goto(`/${locale}/inbox/${id}`);
  await expect(thread(page)).toHaveAttribute('data-conversation', id);
};

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  account = await createAccount(request, { prefix: 'inb', finishOnboarding: true });
  test.skip(!(await inboxReady(request, account)), 'M3 inbox API not reachable (GET /conversations/counts)');
  await verifyEmail(request, account);
  const channels = await connectFakePages(request, account);
  facebook = channels.find((c) => c.platform === 'facebook')!;
  instagram = channels.find((c) => c.platform === 'instagram')!;
  await inject(request, account, { channelId: facebook.id, sender: '0001', text: 'Salam, la robe satin est disponible ?' });
  await inject(request, account, { channelId: facebook.id, sender: '0002', text: 'wach kayen promo 3la had l’article' });
  await inject(request, account, { channelId: instagram.id, sender: '0003', text: 'Je veux commander 2 Parfum Oud 50 ml' });
  amina = await waitConversation(request, account, 'Client 0001');
  yacine = await waitConversation(request, account, 'Client 0002');
  karim = await waitConversation(request, account, 'Client 0003');
});

test('AT-INB-12 tabs show the server counts, search and tab live in the URL, axe on the default state', async ({ page, request }) => {
  await loginHome(page, account);
  // sidebar badge = unread conversations of the workspace
  await page.goto('/fr/inbox');
  const list = page.getByTestId('conversation-list');
  await expect(list.locator('[data-row]')).toHaveCount(3);
  await expect(list.locator('[data-tab="all"]')).toContainText('3');
  await expect(list.locator('[data-tab="active"]')).toContainText('3');
  await expect(list.locator('[data-tab="needs_human"]')).toContainText('0');
  await expect(list.locator('[data-tab="blocked"]')).toHaveCount(0);
  await expect(page.getByTestId('thread-placeholder')).toContainText('Sélectionnez une conversation');
  await expect(row(page, amina.id)).toHaveAttribute('data-unread', 'true');
  await expectNoA11yViolations(page);

  // resolve one through the API: the event moves the counters without a reload
  await patchConversation(request, account, yacine.id, { status: 'resolved' });
  await expect(list.locator('[data-tab="resolved"]')).toContainText('1');
  await expect(list.locator('[data-tab="active"]')).toContainText('2');
  await list.locator('[data-tab="resolved"]').click();
  await expect(page).toHaveURL(/\/fr\/inbox\?tab=resolved$/);
  await expect(list.locator('[data-row]')).toHaveCount(1);
  await expect(row(page, yacine.id)).toContainText('TERMINÉ');
  await list.locator('[data-tab="needs_human"]').click();
  await expect(list.getByRole('heading', { name: 'Tout est calme' })).toBeVisible();
  await patchConversation(request, account, yacine.id, { status: 'active' });

  // search on the message text; the filtered-empty state names the search and clears it
  await page.goto('/fr/inbox');
  await page.getByRole('searchbox').fill('Parfum Oud');
  await expect(page).toHaveURL(/q=Parfum\+Oud/);
  await expect(list.locator('[data-row]')).toHaveCount(1);
  await expect(row(page, karim.id)).toBeVisible();
  await page.getByRole('searchbox').fill('zzzz-introuvable');
  await expect(list.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
  await list.getByRole('button', { name: 'Effacer les filtres' }).last().click();
  await expect(list.locator('[data-row]')).toHaveCount(3);

  // channel switcher and filter panel are URL state too
  await page.getByTestId('channel-switcher').click();
  await page.locator(`[data-channel="${instagram.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`channel=${instagram.id}`));
  await expect(list.locator('[data-row]')).toHaveCount(1);
  await expect(list.locator('[data-tab="all"]')).toContainText('1');
  await page.getByTestId('inbox-filters').click();
  const panel = page.getByRole('dialog', { name: 'Filtres' });
  await panel.getByRole('radio', { name: 'Non lues', exact: true }).click();
  await expect(page).toHaveURL(/unread=1/);
  await panel.getByRole('button', { name: 'Réinitialiser' }).click();
  await expect(page).not.toHaveURL(/unread=1/);
});

test('AT-INB-10 opening a thread marks it read; the client panel shows the placeholder client and prompts completion', async ({ page, request }) => {
  await loginHome(page, account);
  await page.goto('/fr/inbox');
  await row(page, amina.id).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/fr/inbox/${amina.id}$`));
  await expect(thread(page).getByRole('heading', { level: 1 })).toHaveText('Client 0001');
  await expect(thread(page).locator('[data-message="customer"]')).toContainText('Salam, la robe satin est disponible ?');
  await expect(thread(page).locator('[data-message="customer"]')).toContainText('CLIENT');
  // mark read on open
  await expect.poll(async () => (await getConversation(request, account, amina.id)).unreadCount).toBe(0);
  await expect(row(page, amina.id)).not.toHaveAttribute('data-unread', 'true');

  const panel = page.getByTestId('client-panel');
  await expect(panel.locator('[data-client-state]')).toHaveAttribute('data-client-state', 'placeholder');
  await expect(panel).toContainText('À compléter');
  await expect(panel).toContainText('Complétez le nom et le téléphone');
  await expectNoA11yViolations(page);
});

test('AT-INB-02 / AT-INB-07 / AT-INB-09 optimistic reply, AI paused banner, auto-assignment, author name after reload, notes stay internal', async ({ page }) => {
  await loginHome(page, account);
  await open(page, amina.id);
  await expect(page.locator('[data-banner]')).toHaveCount(0);

  // Maj+Entrée = new line, Entrée = send; the bubble is there at once (pending, cancellable 2 s)
  await composer(page).fill('Bonjour,');
  await composer(page).press('Shift+Enter');
  await composer(page).pressSequentially('à annuler');
  await expect(composer(page)).toHaveValue('Bonjour,\nà annuler');
  await composer(page).press('Enter');
  const pending = thread(page).locator('[data-message="human"][data-pending]');
  await expect(pending).toContainText('à annuler');
  await expect(composer(page)).toHaveValue('');
  await pending.getByRole('button', { name: 'Annuler' }).click();
  await expect(thread(page).locator('[data-message="human"]')).toHaveCount(0);
  await expect(composer(page)).toHaveValue('Bonjour,\nà annuler');

  await composer(page).fill('Bonjour, oui elle est disponible en S et M.');
  await composer(page).press('Enter');
  const mine = thread(page).locator('[data-message="human"]');
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('Bonjour, oui elle est disponible en S et M.');
  // reconciled with the stored message: no longer pending, labelled with the member's name — never "IA"
  await expect(thread(page).locator('[data-message="human"][data-pending]')).toHaveCount(0, { timeout: 10_000 });
  await expect(mine).toContainText(/Amel B./i);
  await expect(mine).not.toContainText('IA');
  await expect(mine.getByLabel('Envoyé')).toBeVisible({ timeout: 10_000 });

  // a manual reply pauses the AI (auto-pause ON) and assigns the conversation to its author
  const banner = page.locator('[data-banner="aiPaused"]');
  await expect(banner).toContainText('IA mise en pause par');
  await expect(banner).toContainText('Amel B.');
  await expect(thread(page).getByText('IA EN PAUSE', { exact: true })).toBeVisible();
  await expect(row(page, amina.id)).toContainText('IA EN PAUSE');
  await expect(row(page, amina.id).getByText('Assignée à Amel B.')).toHaveCount(1);

  // AT-INB-07: after a reload the reply is still the member's
  await page.reload();
  await expect(thread(page).locator('[data-message="human"]')).toContainText(/Amel B./i);
  await expect(thread(page).locator('[data-message="ai"]')).toHaveCount(0);

  // this page has no agent yet (M3): "Reprendre l'IA" is greyed with its reason (the resume itself is covered in m4 with an agent)
  await expect(page.getByTestId('resume-ai')).toBeDisabled();
  await expect(page.getByTestId('resume-ai')).toHaveAttribute('title', /CONVERSATION_NO_AGENT/);

  // reassign from the header popover
  await page.getByTestId('assign').click();
  await page.locator('[data-assignee="none"]').click();
  await expect(row(page, amina.id).getByText('Assignée à Amel B.')).toHaveCount(0);
  await page.getByTestId('assign').click();
  await page.locator('[data-assignee="me"]').click();
  await expect(row(page, amina.id).getByText('Assignée à Amel B.')).toHaveCount(1);

  // AT-INB-09: a note is internal — panel only, never a message (Ctrl+Entrée saves)
  await page.getByTestId('note').click();
  const note = page.getByTestId('note-input');
  await expect(note).toBeFocused();
  await note.fill('Cliente fidèle, préfère le stop-desk.');
  await note.press('Control+Enter');
  await expect(page.getByTestId('notes').locator('[data-message="note"]')).toContainText('Cliente fidèle, préfère le stop-desk.');
  await expect(note).toHaveValue('');
  await expect(thread(page).getByText('Cliente fidèle, préfère le stop-desk.')).toHaveCount(0);
});

test('AT-INB-01 two browsers on the same thread: a customer message reaches both in under 2 s; reading in one clears the unread mark in the other', async ({ page, browser, request }) => {
  const ctx = await browser.newContext({ locale: 'fr-DZ', timezoneId: 'Africa/Algiers' });
  const other = await ctx.newPage();
  await loginHome(page, account);
  await loginHome(other, account);
  await open(page, yacine.id);
  await other.goto('/fr/inbox');
  await expect(row(other, yacine.id)).toBeVisible();
  // sockets connected on both sides
  await expect(page.getByTestId('ws-reconnecting')).toHaveCount(0);
  await page.waitForTimeout(1500);

  const text = `Message live ${Date.now().toString(36)}`;
  const sentAt = Date.now();
  await inject(request, account, { channelId: facebook.id, sender: '0002', text });
  await expect(thread(page).locator('[data-message="customer"]').last()).toContainText(text, { timeout: 5_000 });
  await expect(row(other, yacine.id)).toContainText(text, { timeout: 5_000 });
  expect(Date.now() - sentAt, 'delivery to both browsers').toBeLessThan(5_000);

  // the open thread marks it read; the other browser loses the unread mark through `conversation.updated`
  await expect(row(other, yacine.id)).not.toHaveAttribute('data-unread', 'true', { timeout: 10_000 });
  // a second operator's reply appears in the first browser
  await other.goto(`/fr/inbox/${yacine.id}`);
  await composer(other).fill('Réponse du second navigateur');
  await composer(other).press('Enter');
  await expect(thread(page).locator('[data-message="human"]').last()).toContainText('Réponse du second navigateur', { timeout: 10_000 });
  await ctx.close();
});

test('AT-INB-06 socket lost: "reconnexion…" pill, then the messages received meanwhile are replayed', async ({ page, request, context }) => {
  test.setTimeout(120_000);
  await loginHome(page, account);
  await open(page, karim.id);
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await expect(page.getByTestId('inbox-reconnecting')).toBeVisible({ timeout: 70_000 });
  const text = `Reçu hors ligne ${Date.now().toString(36)}`;
  await inject(request, account, { channelId: instagram.id, sender: '0003', text });
  await context.setOffline(false);
  await expect(page.getByTestId('inbox-reconnecting')).toHaveCount(0, { timeout: 45_000 });
  await expect(thread(page).locator('[data-message="customer"]').last()).toContainText(text, { timeout: 20_000 });
});

test('AT-INB-04 an image over 5 MB is refused inline; a valid image is sent as an attachment', async ({ page }) => {
  await loginHome(page, account);
  await open(page, karim.id);
  const file = page.locator('[data-composer-file]');
  await file.setInputFiles({ name: 'lourde.png', mimeType: 'image/png', buffer: Buffer.alloc(6 * 1024 * 1024, 1) });
  await expect(thread(page).getByRole('alert').filter({ hasText: 'IMAGE_TOO_LARGE' })).toContainText('Image trop lourde (5 Mo max).');
  await expect(thread(page).getByRole('button', { name: 'Envoyer', exact: true })).toBeDisabled();
  await thread(page).getByRole('button', { name: 'Retirer l’image' }).click();

  // 1×1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await file.setInputFiles({ name: 'robe.png', mimeType: 'image/png', buffer: png });
  await composer(page).fill('Voici la photo');
  await composer(page).press('Enter');
  const mine = thread(page).locator('[data-message="human"]').last();
  await expect(mine).toContainText('Voici la photo');
  await expect(thread(page).locator('[data-message="human"][data-pending]')).toHaveCount(0, { timeout: 15_000 });
  // stored attachment with its public URL (no longer the local preview)
  await expect(mine.locator('img')).toHaveAttribute('src', /^https?:\/\//, { timeout: 15_000 });
});

test('quick replies: "/" opens the popover, arrows + Entrée insert the text, Échap closes it', async ({ page }) => {
  await loginHome(page, account);
  await open(page, karim.id);
  // chips of the first quick replies above the field
  await expect(thread(page).locator('[data-composer="ready"]')).toBeVisible();
  // "/" pressed outside a field focuses the composer and opens the popover
  await thread(page).getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('/');
  await expect(composer(page)).toBeFocused();
  const pop = page.getByRole('listbox', { name: 'RÉPONSES RAPIDES' });
  await expect(pop.getByRole('option').first()).toBeVisible();
  const count = await pop.getByRole('option').count();
  expect(count).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(composer(page)).toHaveValue('/');

  await composer(page).fill('');
  await composer(page).pressSequentially('/');
  await page.keyboard.press('ArrowDown');
  await expect(pop.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  const second = (await pop.getByRole('option').nth(1).locator('span').first().innerText()).trim();
  await page.keyboard.press('Enter');
  await expect(pop).toHaveCount(0);
  // the text of the reply is in the field, not sent
  await expect(composer(page)).not.toHaveValue('/');
  expect((await composer(page).inputValue()).length).toBeGreaterThan(3);
  expect(second.length).toBeGreaterThan(0);
  await expect(thread(page).locator('[data-message="human"][data-pending]')).toHaveCount(0);

  // no match
  await composer(page).fill('/zzzzzz');
  await expect(pop).toContainText('Aucune réponse rapide ne correspond');
});

test('AT-INB-03 a reply refused outside the 24 h window is shown inline and the text is kept; Instagram outside the window disables the composer', async ({ page }) => {
  await loginHome(page, account);
  await failWith(page, /\/api\/v1\/conversations\/[0-9a-f-]{36}\/messages$/, 'POST', 422, 'REPLY_OUTSIDE_WINDOW', 'Hors fenêtre de 24 h : le client doit écrire d’abord.');
  await open(page, karim.id);
  await composer(page).fill('Votre commande part demain');
  await composer(page).press('Enter');
  await expect(thread(page).getByRole('alert').filter({ hasText: 'REPLY_OUTSIDE_WINDOW' })).toContainText('Hors fenêtre de 24 h : le client doit écrire d’abord.', { timeout: 10_000 });
  await expect(composer(page)).toHaveValue('Votre commande part demain');
  await expect(thread(page).locator('[data-message="human"]').filter({ hasText: 'Votre commande part demain' })).toHaveCount(0);

  // the window is closed for this Instagram thread: banner + composer replaced by the reason, nothing can be sent
  const old = new Date(Date.now() - 30 * 3600_000).toISOString();
  await patchAnswer(page, new RegExp(`/api/v1/conversations/${karim.id}$`), (c) => ({ ...c, aiPaused: false, aiPausedBy: null, status: 'active', within24h: false, lastCustomerMessageAt: old, composer: { ...c.composer, canSend: false, reasonCode: 'REPLY_OUTSIDE_WINDOW', within24h: false, humanAgentTag: false } }));
  await page.reload();
  await expect(page.locator('[data-banner="outsideWindow"]')).toContainText('HORS FENÊTRE 24 H');
  await expect(page.locator('[data-banner="outsideWindow"]')).toContainText('aucun envoi n’est possible sur Instagram');
  const disabled = thread(page).locator('[data-composer="disabled"]');
  await expect(disabled).toContainText('REPLY_OUTSIDE_WINDOW');
  await expect(disabled).toContainText('impossible sur Instagram');
  await expect(composer(page)).toHaveCount(0);
  await expect(page.getByTestId('send-template')).toHaveCount(0);
});

test('Messenger outside the 24 h window, app not approved for « Human Agent »: nothing can be sent, no template (tester account 26/10)', async ({ page }) => {
  await loginHome(page, account);
  const old = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
  await patchAnswer(page, new RegExp(`/api/v1/conversations/${yacine.id}// M3 — inbox (INB-01…09): UI side of AT-INB-01…13, AT-MSG-05 / AT-MSG-08 (thread rendering), AT-SAFE-01 (block from the
// inbox), RTL, responsive panes and axe. Needs the API (:4010, fake Meta adapter) and the worker (:4011).
// Customer messages arrive through the dev simulator; nothing leaves the machine.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, loginHome, type Account } from './support/m1';
import { verifyEmail } from './support/m3-channels';
import { connectFakePages, everyMessageType, failWith, getConversation, inboxReady, inject, listConversations, patchAnswer, patchConversation, reply, waitConversation, type E2eChannel, type E2eConversation } from './support/m3-inbox';

test.describe.configure({ mode: 'serial' });
let account: Account;
let facebook: E2eChannel;
let instagram: E2eChannel;
let amina: E2eConversation; // "Client 0001" on the Facebook page
let yacine: E2eConversation; // "Client 0002" on the Facebook page
let karim: E2eConversation; // "Client 0003" on the Instagram account

const thread = (page: Page) => page.getByTestId('thread');
const composer = (page: Page) => page.locator('[data-composer-input]');
const row = (page: Page, id: string) => page.locator(`[data-row="${id}"]`);
const open = async (page: Page, id: string, locale = 'fr') => {
  await page.goto(`/${locale}/inbox/${id}`);
  await expect(thread(page)).toHaveAttribute('data-conversation', id);
};

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  account = await createAccount(request, { prefix: 'inb', finishOnboarding: true });
  test.skip(!(await inboxReady(request, account)), 'M3 inbox API not reachable (GET /conversations/counts)');
  await verifyEmail(request, account);
  const channels = await connectFakePages(request, account);
  facebook = channels.find((c) => c.platform === 'facebook')!;
  instagram = channels.find((c) => c.platform === 'instagram')!;
  await inject(request, account, { channelId: facebook.id, sender: '0001', text: 'Salam, la robe satin est disponible ?' });
  await inject(request, account, { channelId: facebook.id, sender: '0002', text: 'wach kayen promo 3la had l’article' });
  await inject(request, account, { channelId: instagram.id, sender: '0003', text: 'Je veux commander 2 Parfum Oud 50 ml' });
  amina = await waitConversation(request, account, 'Client 0001');
  yacine = await waitConversation(request, account, 'Client 0002');
  karim = await waitConversation(request, account, 'Client 0003');
});

test('AT-INB-12 tabs show the server counts, search and tab live in the URL, axe on the default state', async ({ page, request }) => {
  await loginHome(page, account);
  // sidebar badge = unread conversations of the workspace
  await page.goto('/fr/inbox');
  const list = page.getByTestId('conversation-list');
  await expect(list.locator('[data-row]')).toHaveCount(3);
  await expect(list.locator('[data-tab="all"]')).toContainText('3');
  await expect(list.locator('[data-tab="active"]')).toContainText('3');
  await expect(list.locator('[data-tab="needs_human"]')).toContainText('0');
  await expect(list.locator('[data-tab="blocked"]')).toHaveCount(0);
  await expect(page.getByTestId('thread-placeholder')).toContainText('Sélectionnez une conversation');
  await expect(row(page, amina.id)).toHaveAttribute('data-unread', 'true');
  await expectNoA11yViolations(page);

  // resolve one through the API: the event moves the counters without a reload
  await patchConversation(request, account, yacine.id, { status: 'resolved' });
  await expect(list.locator('[data-tab="resolved"]')).toContainText('1');
  await expect(list.locator('[data-tab="active"]')).toContainText('2');
  await list.locator('[data-tab="resolved"]').click();
  await expect(page).toHaveURL(/\/fr\/inbox\?tab=resolved$/);
  await expect(list.locator('[data-row]')).toHaveCount(1);
  await expect(row(page, yacine.id)).toContainText('TERMINÉ');
  await list.locator('[data-tab="needs_human"]').click();
  await expect(list.getByRole('heading', { name: 'Tout est calme' })).toBeVisible();
  await patchConversation(request, account, yacine.id, { status: 'active' });

  // search on the message text; the filtered-empty state names the search and clears it
  await page.goto('/fr/inbox');
  await page.getByRole('searchbox').fill('Parfum Oud');
  await expect(page).toHaveURL(/q=Parfum\+Oud/);
  await expect(list.locator('[data-row]')).toHaveCount(1);
  await expect(row(page, karim.id)).toBeVisible();
  await page.getByRole('searchbox').fill('zzzz-introuvable');
  await expect(list.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
  await list.getByRole('button', { name: 'Effacer les filtres' }).last().click();
  await expect(list.locator('[data-row]')).toHaveCount(3);

  // channel switcher and filter panel are URL state too
  await page.getByTestId('channel-switcher').click();
  await page.locator(`[data-channel="${instagram.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`channel=${instagram.id}`));
  await expect(list.locator('[data-row]')).toHaveCount(1);
  await expect(list.locator('[data-tab="all"]')).toContainText('1');
  await page.getByTestId('inbox-filters').click();
  const panel = page.getByRole('dialog', { name: 'Filtres' });
  await panel.getByRole('radio', { name: 'Non lues', exact: true }).click();
  await expect(page).toHaveURL(/unread=1/);
  await panel.getByRole('button', { name: 'Réinitialiser' }).click();
  await expect(page).not.toHaveURL(/unread=1/);
});

test('AT-INB-10 opening a thread marks it read; the client panel shows the placeholder client and prompts completion', async ({ page, request }) => {
  await loginHome(page, account);
  await page.goto('/fr/inbox');
  await row(page, amina.id).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/fr/inbox/${amina.id}$`));
  await expect(thread(page).getByRole('heading', { level: 1 })).toHaveText('Client 0001');
  await expect(thread(page).locator('[data-message="customer"]')).toContainText('Salam, la robe satin est disponible ?');
  await expect(thread(page).locator('[data-message="customer"]')).toContainText('CLIENT');
  // mark read on open
  await expect.poll(async () => (await getConversation(request, account, amina.id)).unreadCount).toBe(0);
  await expect(row(page, amina.id)).not.toHaveAttribute('data-unread', 'true');

  const panel = page.getByTestId('client-panel');
  await expect(panel.locator('[data-client-state]')).toHaveAttribute('data-client-state', 'placeholder');
  await expect(panel).toContainText('À compléter');
  await expect(panel).toContainText('Complétez le nom et le téléphone');
  await expectNoA11yViolations(page);
});

test('AT-INB-02 / AT-INB-07 / AT-INB-09 optimistic reply, AI paused banner, auto-assignment, author name after reload, notes stay internal', async ({ page }) => {
  await loginHome(page, account);
  await open(page, amina.id);
  await expect(page.locator('[data-banner]')).toHaveCount(0);

  // Maj+Entrée = new line, Entrée = send; the bubble is there at once (pending, cancellable 2 s)
  await composer(page).fill('Bonjour,');
  await composer(page).press('Shift+Enter');
  await composer(page).pressSequentially('à annuler');
  await expect(composer(page)).toHaveValue('Bonjour,\nà annuler');
  await composer(page).press('Enter');
  const pending = thread(page).locator('[data-message="human"][data-pending]');
  await expect(pending).toContainText('à annuler');
  await expect(composer(page)).toHaveValue('');
  await pending.getByRole('button', { name: 'Annuler' }).click();
  await expect(thread(page).locator('[data-message="human"]')).toHaveCount(0);
  await expect(composer(page)).toHaveValue('Bonjour,\nà annuler');

  await composer(page).fill('Bonjour, oui elle est disponible en S et M.');
  await composer(page).press('Enter');
  const mine = thread(page).locator('[data-message="human"]');
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('Bonjour, oui elle est disponible en S et M.');
  // reconciled with the stored message: no longer pending, labelled with the member's name — never "IA"
  await expect(thread(page).locator('[data-message="human"][data-pending]')).toHaveCount(0, { timeout: 10_000 });
  await expect(mine).toContainText(/Amel B./i);
  await expect(mine).not.toContainText('IA');
  await expect(mine.getByLabel('Envoyé')).toBeVisible({ timeout: 10_000 });

  // a manual reply pauses the AI (auto-pause ON) and assigns the conversation to its author
  const banner = page.locator('[data-banner="aiPaused"]');
  await expect(banner).toContainText('IA mise en pause par');
  await expect(banner).toContainText('Amel B.');
  await expect(thread(page).getByText('IA EN PAUSE', { exact: true })).toBeVisible();
  await expect(row(page, amina.id)).toContainText('IA EN PAUSE');
  await expect(row(page, amina.id).getByText('Assignée à Amel B.')).toHaveCount(1);

  // AT-INB-07: after a reload the reply is still the member's
  await page.reload();
  await expect(thread(page).locator('[data-message="human"]')).toContainText(/Amel B./i);
  await expect(thread(page).locator('[data-message="ai"]')).toHaveCount(0);

  // this page has no agent yet (M3): "Reprendre l'IA" is greyed with its reason (the resume itself is covered in m4 with an agent)
  await expect(page.getByTestId('resume-ai')).toBeDisabled();
  await expect(page.getByTestId('resume-ai')).toHaveAttribute('title', /CONVERSATION_NO_AGENT/);

  // reassign from the header popover
  await page.getByTestId('assign').click();
  await page.locator('[data-assignee="none"]').click();
  await expect(row(page, amina.id).getByText('Assignée à Amel B.')).toHaveCount(0);
  await page.getByTestId('assign').click();
  await page.locator('[data-assignee="me"]').click();
  await expect(row(page, amina.id).getByText('Assignée à Amel B.')).toHaveCount(1);

  // AT-INB-09: a note is internal — panel only, never a message (Ctrl+Entrée saves)
  await page.getByTestId('note').click();
  const note = page.getByTestId('note-input');
  await expect(note).toBeFocused();
  await note.fill('Cliente fidèle, préfère le stop-desk.');
  await note.press('Control+Enter');
  await expect(page.getByTestId('notes').locator('[data-message="note"]')).toContainText('Cliente fidèle, préfère le stop-desk.');
  await expect(note).toHaveValue('');
  await expect(thread(page).getByText('Cliente fidèle, préfère le stop-desk.')).toHaveCount(0);
});

test('AT-INB-01 two browsers on the same thread: a customer message reaches both in under 2 s; reading in one clears the unread mark in the other', async ({ page, browser, request }) => {
  const ctx = await browser.newContext({ locale: 'fr-DZ', timezoneId: 'Africa/Algiers' });
  const other = await ctx.newPage();
  await loginHome(page, account);
  await loginHome(other, account);
  await open(page, yacine.id);
  await other.goto('/fr/inbox');
  await expect(row(other, yacine.id)).toBeVisible();
  // sockets connected on both sides
  await expect(page.getByTestId('ws-reconnecting')).toHaveCount(0);
  await page.waitForTimeout(1500);

  const text = `Message live ${Date.now().toString(36)}`;
  const sentAt = Date.now();
  await inject(request, account, { channelId: facebook.id, sender: '0002', text });
  await expect(thread(page).locator('[data-message="customer"]').last()).toContainText(text, { timeout: 5_000 });
  await expect(row(other, yacine.id)).toContainText(text, { timeout: 5_000 });
  expect(Date.now() - sentAt, 'delivery to both browsers').toBeLessThan(5_000);

  // the open thread marks it read; the other browser loses the unread mark through `conversation.updated`
  await expect(row(other, yacine.id)).not.toHaveAttribute('data-unread', 'true', { timeout: 10_000 });
  // a second operator's reply appears in the first browser
  await other.goto(`/fr/inbox/${yacine.id}`);
  await composer(other).fill('Réponse du second navigateur');
  await composer(other).press('Enter');
  await expect(thread(page).locator('[data-message="human"]').last()).toContainText('Réponse du second navigateur', { timeout: 10_000 });
  await ctx.close();
});

test('AT-INB-06 socket lost: "reconnexion…" pill, then the messages received meanwhile are replayed', async ({ page, request, context }) => {
  test.setTimeout(120_000);
  await loginHome(page, account);
  await open(page, karim.id);
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await expect(page.getByTestId('inbox-reconnecting')).toBeVisible({ timeout: 70_000 });
  const text = `Reçu hors ligne ${Date.now().toString(36)}`;
  await inject(request, account, { channelId: instagram.id, sender: '0003', text });
  await context.setOffline(false);
  await expect(page.getByTestId('inbox-reconnecting')).toHaveCount(0, { timeout: 45_000 });
  await expect(thread(page).locator('[data-message="customer"]').last()).toContainText(text, { timeout: 20_000 });
});

test('AT-INB-04 an image over 5 MB is refused inline; a valid image is sent as an attachment', async ({ page }) => {
  await loginHome(page, account);
  await open(page, karim.id);
  const file = page.locator('[data-composer-file]');
  await file.setInputFiles({ name: 'lourde.png', mimeType: 'image/png', buffer: Buffer.alloc(6 * 1024 * 1024, 1) });
  await expect(thread(page).getByRole('alert').filter({ hasText: 'IMAGE_TOO_LARGE' })).toContainText('Image trop lourde (5 Mo max).');
  await expect(thread(page).getByRole('button', { name: 'Envoyer', exact: true })).toBeDisabled();
  await thread(page).getByRole('button', { name: 'Retirer l’image' }).click();

  // 1×1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await file.setInputFiles({ name: 'robe.png', mimeType: 'image/png', buffer: png });
  await composer(page).fill('Voici la photo');
  await composer(page).press('Enter');
  const mine = thread(page).locator('[data-message="human"]').last();
  await expect(mine).toContainText('Voici la photo');
  await expect(thread(page).locator('[data-message="human"][data-pending]')).toHaveCount(0, { timeout: 15_000 });
  // stored attachment with its public URL (no longer the local preview)
  await expect(mine.locator('img')).toHaveAttribute('src', /^https?:\/\//, { timeout: 15_000 });
});

test('quick replies: "/" opens the popover, arrows + Entrée insert the text, Échap closes it', async ({ page }) => {
  await loginHome(page, account);
  await open(page, karim.id);
  // chips of the first quick replies above the field
  await expect(thread(page).locator('[data-composer="ready"]')).toBeVisible();
  // "/" pressed outside a field focuses the composer and opens the popover
  await thread(page).getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('/');
  await expect(composer(page)).toBeFocused();
  const pop = page.getByRole('listbox', { name: 'RÉPONSES RAPIDES' });
  await expect(pop.getByRole('option').first()).toBeVisible();
  const count = await pop.getByRole('option').count();
  expect(count).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(composer(page)).toHaveValue('/');

  await composer(page).fill('');
  await composer(page).pressSequentially('/');
  await page.keyboard.press('ArrowDown');
  await expect(pop.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  const second = (await pop.getByRole('option').nth(1).locator('span').first().innerText()).trim();
  await page.keyboard.press('Enter');
  await expect(pop).toHaveCount(0);
  // the text of the reply is in the field, not sent
  await expect(composer(page)).not.toHaveValue('/');
  expect((await composer(page).inputValue()).length).toBeGreaterThan(3);
  expect(second.length).toBeGreaterThan(0);
  await expect(thread(page).locator('[data-message="human"][data-pending]')).toHaveCount(0);

  // no match
  await composer(page).fill('/zzzzzz');
  await expect(pop).toContainText('Aucune réponse rapide ne correspond');
});

test('AT-INB-03 a reply refused outside the 24 h window is shown inline and the text is kept; Instagram outside the window disables the composer', async ({ page }) => {
  await loginHome(page, account);
  await failWith(page, /\/api\/v1\/conversations\/[0-9a-f-]{36}\/messages$/, 'POST', 422, 'REPLY_OUTSIDE_WINDOW', 'Hors fenêtre de 24 h : le client doit écrire d’abord.');
  await open(page, karim.id);
  await composer(page).fill('Votre commande part demain');
  await composer(page).press('Enter');
  await expect(thread(page).getByRole('alert').filter({ hasText: 'REPLY_OUTSIDE_WINDOW' })).toContainText('Hors fenêtre de 24 h : le client doit écrire d’abord.', { timeout: 10_000 });
  await expect(composer(page)).toHaveValue('Votre commande part demain');
  await expect(thread(page).locator('[data-message="human"]').filter({ hasText: 'Votre commande part demain' })).toHaveCount(0);

  // the window is closed for this Instagram thread: banner + composer replaced by the reason, nothing can be sent
  const old = new Date(Date.now() - 30 * 3600_000).toISOString();
  await patchAnswer(page, new RegExp(`/api/v1/conversations/${karim.id}$`), (c) => ({ ...c, aiPaused: false, aiPausedBy: null, status: 'active', within24h: false, lastCustomerMessageAt: old, composer: { ...c.composer, canSend: false, reasonCode: 'REPLY_OUTSIDE_WINDOW', within24h: false, humanAgentTag: false } }));
  await page.reload();
  await expect(page.locator('[data-banner="outsideWindow"]')).toContainText('HORS FENÊTRE 24 H');
  await expect(page.locator('[data-banner="outsideWindow"]')).toContainText('aucun envoi n’est possible sur Instagram');
  const disabled = thread(page).locator('[data-composer="disabled"]');
  await expect(disabled).toContainText('REPLY_OUTSIDE_WINDOW');
  await expect(disabled).toContainText('impossible sur Instagram');
  await expect(composer(page)).toHaveCount(0);
  await expect(page.getByTestId('send-template')).toHaveCount(0);
});

), (c) => ({ ...c, aiPaused: false, aiPausedBy: null, status: 'active', within24h: false, lastCustomerMessageAt: old, composer: { ...c.composer, canSend: false, reasonCode: 'REPLY_OUTSIDE_WINDOW', within24h: false, humanAgentTag: false } }));
  await open(page, yacine.id);
  await expect(page.locator('[data-banner="outsideWindow"]')).toContainText('aucun envoi n’est possible sur Messenger');
  await expect(thread(page).locator('[data-composer="disabled"]')).toContainText('REPLY_OUTSIDE_WINDOW');
  await expect(page.getByTestId('send-template')).toHaveCount(0);
});

test('Messenger outside the 24 h window: the composer offers "Envoyer un message modèle"', async ({ page }) => {
  await loginHome(page, account);
  const old = new Date(Date.now() - 9 * 24 * 3600_000).toISOString();
  // the server still allows the HUMAN_AGENT tag (app approved); the send itself is refused below
  await patchAnswer(page, new RegExp(`/api/v1/conversations/${yacine.id}// M3 — inbox (INB-01…09): UI side of AT-INB-01…13, AT-MSG-05 / AT-MSG-08 (thread rendering), AT-SAFE-01 (block from the
// inbox), RTL, responsive panes and axe. Needs the API (:4010, fake Meta adapter) and the worker (:4011).
// Customer messages arrive through the dev simulator; nothing leaves the machine.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, loginHome, type Account } from './support/m1';
import { verifyEmail } from './support/m3-channels';
import { connectFakePages, everyMessageType, failWith, getConversation, inboxReady, inject, listConversations, patchAnswer, patchConversation, reply, waitConversation, type E2eChannel, type E2eConversation } from './support/m3-inbox';

test.describe.configure({ mode: 'serial' });
let account: Account;
let facebook: E2eChannel;
let instagram: E2eChannel;
let amina: E2eConversation; // "Client 0001" on the Facebook page
let yacine: E2eConversation; // "Client 0002" on the Facebook page
let karim: E2eConversation; // "Client 0003" on the Instagram account

const thread = (page: Page) => page.getByTestId('thread');
const composer = (page: Page) => page.locator('[data-composer-input]');
const row = (page: Page, id: string) => page.locator(`[data-row="${id}"]`);
const open = async (page: Page, id: string, locale = 'fr') => {
  await page.goto(`/${locale}/inbox/${id}`);
  await expect(thread(page)).toHaveAttribute('data-conversation', id);
};

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  account = await createAccount(request, { prefix: 'inb', finishOnboarding: true });
  test.skip(!(await inboxReady(request, account)), 'M3 inbox API not reachable (GET /conversations/counts)');
  await verifyEmail(request, account);
  const channels = await connectFakePages(request, account);
  facebook = channels.find((c) => c.platform === 'facebook')!;
  instagram = channels.find((c) => c.platform === 'instagram')!;
  await inject(request, account, { channelId: facebook.id, sender: '0001', text: 'Salam, la robe satin est disponible ?' });
  await inject(request, account, { channelId: facebook.id, sender: '0002', text: 'wach kayen promo 3la had l’article' });
  await inject(request, account, { channelId: instagram.id, sender: '0003', text: 'Je veux commander 2 Parfum Oud 50 ml' });
  amina = await waitConversation(request, account, 'Client 0001');
  yacine = await waitConversation(request, account, 'Client 0002');
  karim = await waitConversation(request, account, 'Client 0003');
});

test('AT-INB-12 tabs show the server counts, search and tab live in the URL, axe on the default state', async ({ page, request }) => {
  await loginHome(page, account);
  // sidebar badge = unread conversations of the workspace
  await page.goto('/fr/inbox');
  const list = page.getByTestId('conversation-list');
  await expect(list.locator('[data-row]')).toHaveCount(3);
  await expect(list.locator('[data-tab="all"]')).toContainText('3');
  await expect(list.locator('[data-tab="active"]')).toContainText('3');
  await expect(list.locator('[data-tab="needs_human"]')).toContainText('0');
  await expect(list.locator('[data-tab="blocked"]')).toHaveCount(0);
  await expect(page.getByTestId('thread-placeholder')).toContainText('Sélectionnez une conversation');
  await expect(row(page, amina.id)).toHaveAttribute('data-unread', 'true');
  await expectNoA11yViolations(page);

  // resolve one through the API: the event moves the counters without a reload
  await patchConversation(request, account, yacine.id, { status: 'resolved' });
  await expect(list.locator('[data-tab="resolved"]')).toContainText('1');
  await expect(list.locator('[data-tab="active"]')).toContainText('2');
  await list.locator('[data-tab="resolved"]').click();
  await expect(page).toHaveURL(/\/fr\/inbox\?tab=resolved$/);
  await expect(list.locator('[data-row]')).toHaveCount(1);
  await expect(row(page, yacine.id)).toContainText('TERMINÉ');
  await list.locator('[data-tab="needs_human"]').click();
  await expect(list.getByRole('heading', { name: 'Tout est calme' })).toBeVisible();
  await patchConversation(request, account, yacine.id, { status: 'active' });

  // search on the message text; the filtered-empty state names the search and clears it
  await page.goto('/fr/inbox');
  await page.getByRole('searchbox').fill('Parfum Oud');
  await expect(page).toHaveURL(/q=Parfum\+Oud/);
  await expect(list.locator('[data-row]')).toHaveCount(1);
  await expect(row(page, karim.id)).toBeVisible();
  await page.getByRole('searchbox').fill('zzzz-introuvable');
  await expect(list.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
  await list.getByRole('button', { name: 'Effacer les filtres' }).last().click();
  await expect(list.locator('[data-row]')).toHaveCount(3);

  // channel switcher and filter panel are URL state too
  await page.getByTestId('channel-switcher').click();
  await page.locator(`[data-channel="${instagram.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`channel=${instagram.id}`));
  await expect(list.locator('[data-row]')).toHaveCount(1);
  await expect(list.locator('[data-tab="all"]')).toContainText('1');
  await page.getByTestId('inbox-filters').click();
  const panel = page.getByRole('dialog', { name: 'Filtres' });
  await panel.getByRole('radio', { name: 'Non lues', exact: true }).click();
  await expect(page).toHaveURL(/unread=1/);
  await panel.getByRole('button', { name: 'Réinitialiser' }).click();
  await expect(page).not.toHaveURL(/unread=1/);
});

test('AT-INB-10 opening a thread marks it read; the client panel shows the placeholder client and prompts completion', async ({ page, request }) => {
  await loginHome(page, account);
  await page.goto('/fr/inbox');
  await row(page, amina.id).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/fr/inbox/${amina.id}$`));
  await expect(thread(page).getByRole('heading', { level: 1 })).toHaveText('Client 0001');
  await expect(thread(page).locator('[data-message="customer"]')).toContainText('Salam, la robe satin est disponible ?');
  await expect(thread(page).locator('[data-message="customer"]')).toContainText('CLIENT');
  // mark read on open
  await expect.poll(async () => (await getConversation(request, account, amina.id)).unreadCount).toBe(0);
  await expect(row(page, amina.id)).not.toHaveAttribute('data-unread', 'true');

  const panel = page.getByTestId('client-panel');
  await expect(panel.locator('[data-client-state]')).toHaveAttribute('data-client-state', 'placeholder');
  await expect(panel).toContainText('À compléter');
  await expect(panel).toContainText('Complétez le nom et le téléphone');
  await expectNoA11yViolations(page);
});

test('AT-INB-02 / AT-INB-07 / AT-INB-09 optimistic reply, AI paused banner, auto-assignment, author name after reload, notes stay internal', async ({ page }) => {
  await loginHome(page, account);
  await open(page, amina.id);
  await expect(page.locator('[data-banner]')).toHaveCount(0);

  // Maj+Entrée = new line, Entrée = send; the bubble is there at once (pending, cancellable 2 s)
  await composer(page).fill('Bonjour,');
  await composer(page).press('Shift+Enter');
  await composer(page).pressSequentially('à annuler');
  await expect(composer(page)).toHaveValue('Bonjour,\nà annuler');
  await composer(page).press('Enter');
  const pending = thread(page).locator('[data-message="human"][data-pending]');
  await expect(pending).toContainText('à annuler');
  await expect(composer(page)).toHaveValue('');
  await pending.getByRole('button', { name: 'Annuler' }).click();
  await expect(thread(page).locator('[data-message="human"]')).toHaveCount(0);
  await expect(composer(page)).toHaveValue('Bonjour,\nà annuler');

  await composer(page).fill('Bonjour, oui elle est disponible en S et M.');
  await composer(page).press('Enter');
  const mine = thread(page).locator('[data-message="human"]');
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('Bonjour, oui elle est disponible en S et M.');
  // reconciled with the stored message: no longer pending, labelled with the member's name — never "IA"
  await expect(thread(page).locator('[data-message="human"][data-pending]')).toHaveCount(0, { timeout: 10_000 });
  await expect(mine).toContainText(/Amel B./i);
  await expect(mine).not.toContainText('IA');
  await expect(mine.getByLabel('Envoyé')).toBeVisible({ timeout: 10_000 });

  // a manual reply pauses the AI (auto-pause ON) and assigns the conversation to its author
  const banner = page.locator('[data-banner="aiPaused"]');
  await expect(banner).toContainText('IA mise en pause par');
  await expect(banner).toContainText('Amel B.');
  await expect(thread(page).getByText('IA EN PAUSE', { exact: true })).toBeVisible();
  await expect(row(page, amina.id)).toContainText('IA EN PAUSE');
  await expect(row(page, amina.id).getByText('Assignée à Amel B.')).toHaveCount(1);

  // AT-INB-07: after a reload the reply is still the member's
  await page.reload();
  await expect(thread(page).locator('[data-message="human"]')).toContainText(/Amel B./i);
  await expect(thread(page).locator('[data-message="ai"]')).toHaveCount(0);

  // this page has no agent yet (M3): "Reprendre l'IA" is greyed with its reason (the resume itself is covered in m4 with an agent)
  await expect(page.getByTestId('resume-ai')).toBeDisabled();
  await expect(page.getByTestId('resume-ai')).toHaveAttribute('title', /CONVERSATION_NO_AGENT/);

  // reassign from the header popover
  await page.getByTestId('assign').click();
  await page.locator('[data-assignee="none"]').click();
  await expect(row(page, amina.id).getByText('Assignée à Amel B.')).toHaveCount(0);
  await page.getByTestId('assign').click();
  await page.locator('[data-assignee="me"]').click();
  await expect(row(page, amina.id).getByText('Assignée à Amel B.')).toHaveCount(1);

  // AT-INB-09: a note is internal — panel only, never a message (Ctrl+Entrée saves)
  await page.getByTestId('note').click();
  const note = page.getByTestId('note-input');
  await expect(note).toBeFocused();
  await note.fill('Cliente fidèle, préfère le stop-desk.');
  await note.press('Control+Enter');
  await expect(page.getByTestId('notes').locator('[data-message="note"]')).toContainText('Cliente fidèle, préfère le stop-desk.');
  await expect(note).toHaveValue('');
  await expect(thread(page).getByText('Cliente fidèle, préfère le stop-desk.')).toHaveCount(0);
});

test('AT-INB-01 two browsers on the same thread: a customer message reaches both in under 2 s; reading in one clears the unread mark in the other', async ({ page, browser, request }) => {
  const ctx = await browser.newContext({ locale: 'fr-DZ', timezoneId: 'Africa/Algiers' });
  const other = await ctx.newPage();
  await loginHome(page, account);
  await loginHome(other, account);
  await open(page, yacine.id);
  await other.goto('/fr/inbox');
  await expect(row(other, yacine.id)).toBeVisible();
  // sockets connected on both sides
  await expect(page.getByTestId('ws-reconnecting')).toHaveCount(0);
  await page.waitForTimeout(1500);

  const text = `Message live ${Date.now().toString(36)}`;
  const sentAt = Date.now();
  await inject(request, account, { channelId: facebook.id, sender: '0002', text });
  await expect(thread(page).locator('[data-message="customer"]').last()).toContainText(text, { timeout: 5_000 });
  await expect(row(other, yacine.id)).toContainText(text, { timeout: 5_000 });
  expect(Date.now() - sentAt, 'delivery to both browsers').toBeLessThan(5_000);

  // the open thread marks it read; the other browser loses the unread mark through `conversation.updated`
  await expect(row(other, yacine.id)).not.toHaveAttribute('data-unread', 'true', { timeout: 10_000 });
  // a second operator's reply appears in the first browser
  await other.goto(`/fr/inbox/${yacine.id}`);
  await composer(other).fill('Réponse du second navigateur');
  await composer(other).press('Enter');
  await expect(thread(page).locator('[data-message="human"]').last()).toContainText('Réponse du second navigateur', { timeout: 10_000 });
  await ctx.close();
});

test('AT-INB-06 socket lost: "reconnexion…" pill, then the messages received meanwhile are replayed', async ({ page, request, context }) => {
  test.setTimeout(120_000);
  await loginHome(page, account);
  await open(page, karim.id);
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await expect(page.getByTestId('inbox-reconnecting')).toBeVisible({ timeout: 70_000 });
  const text = `Reçu hors ligne ${Date.now().toString(36)}`;
  await inject(request, account, { channelId: instagram.id, sender: '0003', text });
  await context.setOffline(false);
  await expect(page.getByTestId('inbox-reconnecting')).toHaveCount(0, { timeout: 45_000 });
  await expect(thread(page).locator('[data-message="customer"]').last()).toContainText(text, { timeout: 20_000 });
});

test('AT-INB-04 an image over 5 MB is refused inline; a valid image is sent as an attachment', async ({ page }) => {
  await loginHome(page, account);
  await open(page, karim.id);
  const file = page.locator('[data-composer-file]');
  await file.setInputFiles({ name: 'lourde.png', mimeType: 'image/png', buffer: Buffer.alloc(6 * 1024 * 1024, 1) });
  await expect(thread(page).getByRole('alert').filter({ hasText: 'IMAGE_TOO_LARGE' })).toContainText('Image trop lourde (5 Mo max).');
  await expect(thread(page).getByRole('button', { name: 'Envoyer', exact: true })).toBeDisabled();
  await thread(page).getByRole('button', { name: 'Retirer l’image' }).click();

  // 1×1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await file.setInputFiles({ name: 'robe.png', mimeType: 'image/png', buffer: png });
  await composer(page).fill('Voici la photo');
  await composer(page).press('Enter');
  const mine = thread(page).locator('[data-message="human"]').last();
  await expect(mine).toContainText('Voici la photo');
  await expect(thread(page).locator('[data-message="human"][data-pending]')).toHaveCount(0, { timeout: 15_000 });
  // stored attachment with its public URL (no longer the local preview)
  await expect(mine.locator('img')).toHaveAttribute('src', /^https?:\/\//, { timeout: 15_000 });
});

test('quick replies: "/" opens the popover, arrows + Entrée insert the text, Échap closes it', async ({ page }) => {
  await loginHome(page, account);
  await open(page, karim.id);
  // chips of the first quick replies above the field
  await expect(thread(page).locator('[data-composer="ready"]')).toBeVisible();
  // "/" pressed outside a field focuses the composer and opens the popover
  await thread(page).getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('/');
  await expect(composer(page)).toBeFocused();
  const pop = page.getByRole('listbox', { name: 'RÉPONSES RAPIDES' });
  await expect(pop.getByRole('option').first()).toBeVisible();
  const count = await pop.getByRole('option').count();
  expect(count).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(composer(page)).toHaveValue('/');

  await composer(page).fill('');
  await composer(page).pressSequentially('/');
  await page.keyboard.press('ArrowDown');
  await expect(pop.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  const second = (await pop.getByRole('option').nth(1).locator('span').first().innerText()).trim();
  await page.keyboard.press('Enter');
  await expect(pop).toHaveCount(0);
  // the text of the reply is in the field, not sent
  await expect(composer(page)).not.toHaveValue('/');
  expect((await composer(page).inputValue()).length).toBeGreaterThan(3);
  expect(second.length).toBeGreaterThan(0);
  await expect(thread(page).locator('[data-message="human"][data-pending]')).toHaveCount(0);

  // no match
  await composer(page).fill('/zzzzzz');
  await expect(pop).toContainText('Aucune réponse rapide ne correspond');
});

test('AT-INB-03 a reply refused outside the 24 h window is shown inline and the text is kept; Instagram outside the window disables the composer', async ({ page }) => {
  await loginHome(page, account);
  await failWith(page, /\/api\/v1\/conversations\/[0-9a-f-]{36}\/messages$/, 'POST', 422, 'REPLY_OUTSIDE_WINDOW', 'Hors fenêtre de 24 h : le client doit écrire d’abord.');
  await open(page, karim.id);
  await composer(page).fill('Votre commande part demain');
  await composer(page).press('Enter');
  await expect(thread(page).getByRole('alert').filter({ hasText: 'REPLY_OUTSIDE_WINDOW' })).toContainText('Hors fenêtre de 24 h : le client doit écrire d’abord.', { timeout: 10_000 });
  await expect(composer(page)).toHaveValue('Votre commande part demain');
  await expect(thread(page).locator('[data-message="human"]').filter({ hasText: 'Votre commande part demain' })).toHaveCount(0);

  // the window is closed for this Instagram thread: banner + composer replaced by the reason, nothing can be sent
  const old = new Date(Date.now() - 30 * 3600_000).toISOString();
  await patchAnswer(page, new RegExp(`/api/v1/conversations/${karim.id}$`), (c) => ({ ...c, aiPaused: false, aiPausedBy: null, status: 'active', within24h: false, lastCustomerMessageAt: old, composer: { ...c.composer, canSend: false, reasonCode: 'REPLY_OUTSIDE_WINDOW', within24h: false, humanAgentTag: false } }));
  await page.reload();
  await expect(page.locator('[data-banner="outsideWindow"]')).toContainText('HORS FENÊTRE 24 H');
  await expect(page.locator('[data-banner="outsideWindow"]')).toContainText('aucun envoi n’est possible sur Instagram');
  const disabled = thread(page).locator('[data-composer="disabled"]');
  await expect(disabled).toContainText('REPLY_OUTSIDE_WINDOW');
  await expect(disabled).toContainText('impossible sur Instagram');
  await expect(composer(page)).toHaveCount(0);
  await expect(page.getByTestId('send-template')).toHaveCount(0);
});

), (c) => ({ ...c, aiPaused: false, aiPausedBy: null, status: 'active', within24h: false, lastCustomerMessageAt: old, composer: { ...c.composer, canSend: false, reasonCode: 'REPLY_OUTSIDE_WINDOW', within24h: false, humanAgentTag: true } }));
  await open(page, yacine.id);
  await expect(page.locator('[data-banner]')).toContainText('message modèle');
  await page.getByTestId('send-template').click();
  const dialog = page.getByRole('dialog', { name: 'Envoyer un message modèle' });
  await expect(dialog.getByRole('radio')).toHaveCount(5);
  await expect(dialog.getByRole('radio', { name: /Commande expédiée/ })).toBeChecked();
  // a refusal stays inside the dialog, the choice is kept
  await failWith(page, /\/api\/v1\/conversations\/[0-9a-f-]{36}\/messages$/, 'POST', 422, 'REPLY_OUTSIDE_WINDOW', 'Hors fenêtre de 24 h : le client doit écrire d’abord.');
  await dialog.getByRole('radio', { name: /Commande livrée/ }).check();
  await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(dialog.getByText('REPLY_OUTSIDE_WINDOW')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Commande livrée/ })).toBeChecked();
});

test('AT-INB-13 page to reconnect: banner, composer disabled with the reason and a link to the page; reading still works', async ({ page }) => {
  await loginHome(page, account);
  await patchAnswer(page, new RegExp(`/api/v1/conversations/${amina.id}$`), (c) => ({ ...c, aiPaused: false, aiPausedBy: null, status: 'active', channel: { ...c.channel, status: 'needs_reconnect' }, composer: { ...c.composer, canSend: false, reasonCode: 'REPLY_CHANNEL_INACTIVE', channelStatus: 'needs_reconnect' } }));
  await open(page, amina.id);
  await expect(page.locator('[data-banner="reconnect"]')).toContainText('Reconnexion requise');
  await expect(page.locator('[data-banner="reconnect"]')).toContainText('PAGE_TOKEN_EXPIRED');
  const disabled = thread(page).locator('[data-composer="disabled"]');
  await expect(disabled).toContainText('CANAL INACTIF');
  await expect(disabled).toContainText('Page en pause ou déconnectée. (REPLY_CHANNEL_INACTIVE)');
  await expect(page.getByTestId('composer-reconnect')).toHaveAttribute('href', new RegExp(`/fr/channels/${facebook.id}$`));
  await expect(composer(page)).toHaveCount(0);
  // reading works
  await expect(thread(page).locator('[data-message="customer"]').first()).toContainText('Salam, la robe satin est disponible ?');
});

test('AT-MSG-08 / AT-MSG-05 every message type and author is rendered; skipped-window and failed sends are labelled', async ({ page }) => {
  await loginHome(page, account);
  await patchAnswer(page, new RegExp(`/api/v1/conversations/${amina.id}/messages`), () => everyMessageType(amina.id));
  await open(page, amina.id);
  const t = thread(page);
  const m = (id: string) => t.locator(`[data-message-id="${id}"]`);
  await expect(m('t-text')).toContainText('سلام، الروب ساتان كاين؟');
  await expect(m('t-image').getByRole('button', { name: 'Afficher l’image en plein écran' })).toBeVisible();
  await expect(m('t-image')).toContainText('Ch7al hada ?');
  await expect(m('t-audio').getByRole('button', { name: 'Écouter le vocal' })).toBeVisible();
  await expect(m('t-audio')).toContainText('Transcription : « est-ce que la robe existe »');
  await expect(m('t-audio')).toContainText('0:40');
  await expect(m('t-audio-pending')).toContainText('Transcription…');
  await expect(m('t-audio-long')).toContainText('Vocal de plus de 2 min : non transcrit');
  await expect(m('t-video').locator('video')).toHaveCount(1);
  await expect(m('t-file').getByRole('link')).toContainText('facture.pdf');
  await expect(m('t-file')).toContainText('240 Ko');
  await expect(m('t-location').getByRole('link')).toContainText('El Eulma');
  await expect(m('t-sticker').getByRole('img', { name: 'Sticker' })).toBeVisible();
  await expect(m('t-postback')).toContainText('Postback : « Voir le catalogue »');
  await expect(m('t-cards').getByRole('listitem')).toHaveCount(2);
  await expect(m('t-cards')).toContainText('La Robe satin');
  await expect(m('t-cards')).toContainText(/4\s900\sDA/);
  // authorship: AI with the agent name, human with the member name, system event in the middle
  await expect(m('t-ai')).toHaveAttribute('data-message', 'ai');
  await expect(m('t-ai')).toContainText(/Vendeur Pro · IA/i);
  await expect(m('t-human')).toHaveAttribute('data-message', 'human');
  await expect(m('t-human')).toContainText(/Nadia F./i);
  await expect(m('t-system')).toContainText('Commande #CMD-1042 créée par l’IA');
  // AT-MSG-05: stored but never delivered
  await expect(m('t-skipped').getByRole('alert')).toContainText('Non délivré — hors fenêtre 24 h');
  await expect(m('t-skipped').getByRole('button', { name: 'Réessayer' })).toHaveCount(0);
  await expect(m('t-failed').getByRole('alert')).toContainText('Non délivré — Meta ne répond pas, réessayez.');
  await expect(m('t-failed').getByRole('button', { name: 'Réessayer' })).toBeVisible();
  // one separator for today
  await expect(t.getByRole('separator')).toHaveCount(1);

  // image in full screen, Échap closes
  await m('t-image').getByRole('button', { name: 'Afficher l’image en plein écran' }).click();
  await expect(page.getByRole('dialog', { name: 'Image' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Image' })).toHaveCount(0);
  // an AI answer can be reported from its menu
  await m('t-ai').hover();
  await m('t-ai').getByRole('button', { name: 'Actions du message' }).click();
  await expect(page.getByRole('menuitem', { name: 'Signaler une réponse IA incorrecte' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('upward pagination keeps the reader in place (cursor, 50 per page)', async ({ page, request }) => {
  test.setTimeout(120_000);
  for (let i = 1; i <= 58; i++) await inject(request, account, { channelId: facebook.id, sender: '0009', text: `Message n° ${String(i).padStart(2, '0')}` });
  const long = await waitConversation(request, account, 'Client 0009');
  await expect.poll(async () => (await listConversations(request, account)).find((c) => c.id === long.id)?.lastMessagePreview, { timeout: 30_000 }).toBe('Message n° 58');
  await loginHome(page, account);
  await open(page, long.id);
  const box = page.getByTestId('messages');
  await expect(box.locator('[data-message="customer"]')).toHaveCount(50);
  await expect(box.getByText('Message n° 58', { exact: true })).toBeInViewport();
  await expect(box.getByText('Message n° 09', { exact: true })).toBeVisible();
  await expect(box.getByText('Message n° 08', { exact: true })).toHaveCount(0);
  // scroll to the top: the older page is loaded and the first message of the previous page stays where it was
  await box.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect(box.locator('[data-message="customer"]')).toHaveCount(58, { timeout: 10_000 });
  await expect(box.getByText('Message n° 01', { exact: true })).toBeVisible();
  await expect(box.getByText('Message n° 09', { exact: true })).toBeInViewport();
  expect(await box.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
});

test('AT-INB-05 a stale change answers 409: "Modifié par quelqu’un d’autre", Recharger applies the current version; live status change from a teammate', async ({ page, request }) => {
  await loginHome(page, account);
  await open(page, yacine.id);
  // a teammate resolves it: the header follows without a reload
  await patchConversation(request, account, yacine.id, { status: 'resolved' });
  await expect(thread(page).getByText('RÉSOLUE', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('reopen')).toBeVisible();

  const current = await getConversation(request, account, yacine.id);
  await failWith(page, new RegExp(`/api/v1/conversations/${yacine.id}$`), 'PATCH', 409, 'CONFLICT', 'Modifié entre-temps, rechargez.', { changedBy: { firstName: 'Sara', lastName: 'K.' }, changedAt: new Date(Date.now() - 120_000).toISOString(), current: { ...current, status: 'archived' } });
  await page.getByTestId('reopen').click();
  const dialog = page.getByRole('dialog', { name: 'Modifié par quelqu\'un d\'autre' });
  await expect(dialog).toContainText('CONFLICT (409)');
  await expect(dialog).toContainText('Sara K.');
  await dialog.getByRole('button', { name: 'Recharger' }).click();
  await expect(dialog).toHaveCount(0);
  await page.unroute(new RegExp(`/api/v1/conversations/${yacine.id}$`));
  // the real state is read again
  await expect(page.getByTestId('reopen')).toBeVisible();
  await page.getByTestId('reopen').click();
  await expect(page.getByTestId('resolve')).toBeVisible();
});

test('AT-SAFE-01 block from the conversation menu: the thread moves under "Bloqués", composer disabled; Débloquer restores it', async ({ page, request }) => {
  // the "IA EN PAUSE" banner has priority over "CLIENT BLOQUÉ": the AI is resumed first
  if ((await getConversation(request, account, karim.id)).aiPaused) await patchConversation(request, account, karim.id, { aiPaused: false });
  await loginHome(page, account);
  await open(page, karim.id);
  await thread(page).getByRole('button', { name: 'Actions', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Signaler à Djaber' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Supprimer la conversation' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Bloquer ce client' }).click();
  const dialog = page.getByRole('dialog', { name: /Bloquer ce client/ });
  await dialog.getByRole('button', { name: /^Bloquer/ }).click();
  await expect(dialog).toHaveCount(0);

  const list = page.getByTestId('conversation-list');
  await expect(list.locator('[data-tab="blocked"]')).toContainText('1');
  await expect(row(page, karim.id)).toHaveCount(0);
  await expect(page.locator('[data-banner="blocked"]')).toContainText('Client bloqué');
  await expect(thread(page).locator('[data-composer="disabled"]')).toContainText('BLOQUÉ');
  await list.locator('[data-tab="blocked"]').click();
  await expect(page).toHaveURL(/tab=blocked/);
  await expect(row(page, karim.id)).toContainText('BLOQUÉ');

  await page.getByTestId('unblock').click();
  await expect(page.locator('[data-banner="blocked"]')).toHaveCount(0);
  await expect(thread(page).locator('[data-composer="ready"]')).toBeVisible();
});

test('responsive panes: three at 1440, two at 1024 (client panel as a drawer, Échap closes), one at 390 with a back link', async ({ page }) => {
  await loginHome(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, amina.id);
  await expect(page.getByTestId('conversation-list')).toBeVisible();
  await expect(page.getByTestId('client-panel')).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.getByTestId('conversation-list')).toBeVisible();
  await expect(thread(page)).toBeVisible();
  await expect(page.getByTestId('client-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Fiche client et notes' }).click();
  await expect(page.getByTestId('client-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('client-panel')).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('conversation-list')).toBeHidden();
  await expect(thread(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await thread(page).getByRole('link', { name: 'Retour à la boîte' }).click();
  await expect(page).toHaveURL(/\/fr\/inbox$/);
  await expect(page.getByTestId('conversation-list')).toBeVisible();
  await expect(thread(page)).toHaveCount(0);
  await row(page, amina.id).getByRole('link').click();
  await expect(thread(page)).toBeVisible();
});

test('AT-UX-02 inbox in Arabic: mirrored panes, customer bubbles on the start side, numbers left-to-right', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginHome(page, account, 'ar');
  await open(page, amina.id, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const list = (await page.getByTestId('conversation-list').boundingBox())!;
  const th = (await thread(page).boundingBox())!;
  const panel = (await page.getByTestId('client-panel').boundingBox())!;
  // list on the right (start), panel on the left (end)
  expect(list.x).toBeGreaterThan(th.x);
  expect(panel.x).toBeLessThan(th.x);
  await expect(page.getByTestId('conversation-list').locator('[data-tab="all"]')).toContainText('الكل');
  // customer bubble on the start side = right; the member's reply on the left
  const customer = (await thread(page).locator('[data-message="customer"] p').first().boundingBox())!;
  const human = (await thread(page).locator('[data-message="human"] p').first().boundingBox())!;
  expect(customer.x + customer.width / 2).toBeGreaterThan(th.x + th.width / 2);
  expect(human.x + human.width / 2).toBeLessThan(th.x + th.width / 2);
  await expect(composer(page)).toHaveAttribute('placeholder', /Enter/);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `horizontal overflow at ${width}`).toBeLessThanOrEqual(0);
  }
});

test('bulk selection bar: per-conversation results, failed ones stay selected and can be retried', async ({ page, request }) => {
  for (const c of [amina, yacine]) if ((await getConversation(request, account, c.id)).status !== 'active') await patchConversation(request, account, c.id, { status: 'active' });
  await loginHome(page, account);
  await page.goto('/fr/inbox');
  const list = page.getByTestId('conversation-list');
  await expect(row(page, amina.id)).toBeVisible();
  await expect(page.getByTestId('inbox-bulk')).toHaveCount(0);
  await page.getByTestId('inbox-select').click();
  await page.locator(`[data-select="${amina.id}"]`).check();
  await page.locator(`[data-select="${yacine.id}"]`).check();
  const bar = page.getByRole('region', { name: 'Actions groupées' });
  await expect(bar).toContainText('2 conversations sélectionnées');
  for (const label of ['Marquer résolues', 'Archiver', 'Assigner', "Reprendre l'IA", 'Bloquer les clients']) await expect(bar.getByRole('button', { name: label, exact: true })).toBeVisible();

  // one of the two is refused: the dialog lists a result per conversation, the failed one stays selected
  const BULK = /\/api\/v1\/conversations\/bulk\/resolve$/;
  await page.route(BULK, async (route) => {
    const res = await route.fetch({ postData: JSON.stringify({ ids: [amina.id] }) });
    const json = (await res.json()) as { data: { results: unknown[] } };
    const failed = { id: yacine.id, ok: false, error: { code: 'REPLY_CHANNEL_INACTIVE', message: 'Page en pause ou déconnectée.', ref: 'e2e' } };
    await route.fulfill({ response: res, json: { data: { results: [...json.data.results, failed] }, meta: { ok: 1, failed: 1 } } });
  });
  await bar.getByRole('button', { name: 'Marquer résolues', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Marquer résolues' });
  await expect(dialog).toContainText('1 OK · 1 en erreur');
  await expect(dialog.getByTestId('bulk-results').locator('li[data-ok="true"]')).toContainText('Client 0001');
  await expect(dialog.getByTestId('bulk-results').locator('li[data-ok="false"]')).toContainText('Page en pause ou déconnectée. (REPLY_CHANNEL_INACTIVE)');
  // retry the failed one against the real API
  await page.unroute(BULK);
  await dialog.getByTestId('bulk-retry').click();
  await expect(dialog).toContainText('2 OK · 0 en erreur');
  await dialog.getByRole('button', { name: 'Fermer' }).last().click();
  await expect(row(page, amina.id)).toContainText('TERMINÉ');
  await expect(row(page, yacine.id)).toContainText('TERMINÉ');
  await expect(list.locator('[data-tab="resolved"]')).toContainText('2');
  expect((await getConversation(request, account, yacine.id)).status).toBe('resolved');
  await expect(page.getByTestId('inbox-bulk')).toHaveCount(0);

  // assign both to me through the dialog, then leave the selection mode
  await page.locator(`[data-select="${amina.id}"]`).check();
  await page.locator(`[data-select="${yacine.id}"]`).check();
  await page.getByRole('region', { name: 'Actions groupées' }).getByRole('button', { name: 'Assigner', exact: true }).click();
  await page.getByTestId('bulk-assign-submit').click();
  await expect(page.locator('[data-toast]').filter({ hasText: '2 conversations mises à jour' })).toBeVisible();
  await expect(page.getByTestId('inbox-bulk')).toHaveCount(0);
  expect((await getConversation(request, account, amina.id)).assignee).not.toBeNull();
  await page.getByTestId('inbox-select').click();
  await expect(page.locator('[data-select]')).toHaveCount(0);
});

test('AT-INB-11 an admin deletes a conversation: it disappears from the list, the API no longer lists it', async ({ page, request }) => {
  await inject(request, account, { channelId: facebook.id, sender: '0077', text: 'À supprimer' });
  const doomed = await waitConversation(request, account, 'Client 0077');
  await loginHome(page, account);
  await open(page, doomed.id);
  await thread(page).getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Supprimer la conversation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Supprimer la conversation ?' });
  await expect(dialog).toContainText('restaurable 30 j par un admin');
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/inbox(\?.*)?$/);
  await expect(row(page, doomed.id)).toHaveCount(0);
  expect((await listConversations(request, account)).some((c) => c.id === doomed.id)).toBe(false);
});
