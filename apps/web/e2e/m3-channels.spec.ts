// M3 — channels (UI side of AT-CHN-01…12). Frames: "CHN-06 — Channels — list with statuses", "CHN-07 — Channel page —
// overview", "CHN-07b — … Messages · AI settings · History tabs", "DLG — Agents & channels" (connect flow, report,
// disconnect, resume swap, sync history), "GLOBAL — Plan expired — free limits applied (Channels)".
// "fixture" tests serve `/channels*` with `page.route` (states the fake Meta adapter cannot produce over HTTP);
// "real" tests run the whole connect flow against this repo's API with META_DRIVER=fake. Needs the API on :4010.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, expectUrl, loginHome, type Account } from './support/m1';
import { channelsReady, fixtureChannels, IDS, listChannels, mockChannels, verifyEmail, type ChannelsMock } from './support/m3-channels';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 1000 } });

const card = (page: Page, id: string) => page.locator(`[data-testid="channel-card"][data-channel="${id}"]`);
const mock = (o: Partial<ChannelsMock> = {}): ChannelsMock => ({ channels: fixtureChannels(), writes: [], ...o });

test.describe('fixtures — statuses, report rows, dialogs', () => {
  let account: Account;
  test.beforeAll(async ({ request }) => {
    test.skip(!(await apiReady(request)), 'API not reachable on :4010');
    account = await createAccount(request, { prefix: 'chnfx', finishOnboarding: true });
  });

  test('CHN-06 list: summary, Meta approval notice, platform tabs in the URL, plan-limit card, axe', async ({ page }) => {
    await mockChannels(page, mock());
    await loginHome(page, account);
    await page.goto('/fr/channels');
    await expect(page.getByRole('heading', { name: 'Pages connectées', level: 1 })).toBeVisible();
    await expect(page.getByTestId('channels-summary')).toHaveText('3 pages · 1 active · 1 à reconnecter · limite du plan 3 / 3');
    await expect(page.getByTestId('channel-card')).toHaveCount(3);
    await expect(page.getByText(/Validation Meta en attente : la permission « messages Instagram » est en cours d'examen/)).toBeVisible();
    await expect(page.getByTestId('plan-limit-card')).toContainText('Limite du plan atteinte (3 / 3 pages)');
    await expect(page.getByTestId('plan-limit-card')).toContainText('Déconnectez une page ou passez au plan Pro pour en connecter davantage.');
    await expectNoA11yViolations(page);

    // platform tabs are URL state
    await expect(async () => {
      await page.getByRole('radio', { name: 'Instagram 1' }).click();
      await expect(page).toHaveURL(/tab=instagram/, { timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByTestId('channel-card')).toHaveCount(1);
    await expect(card(page, IDS.cosmetics)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Instagram 1' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Toutes 3' }).click();
    await expect(page).not.toHaveURL(/tab=/);
  });

  test('AT-CHN-04 / AT-CHN-07 cards: needs_reconnect strip + shell banner, Meta approval pending strip and status dialog', async ({ page }) => {
    await mockChannels(page, mock());
    await loginHome(page, account);
    await page.goto('/fr/channels');

    const outlet = card(page, IDS.outlet);
    await expect(outlet).toHaveAttribute('data-state', 'needs_reconnect');
    await expect(outlet.getByTestId('state-strip')).toContainText('À RECONNECTER');
    await expect(outlet.getByTestId('state-strip')).toContainText("Jeton révoqué par Meta le 06 oct. 2026. L'IA ne répond plus sur cette page.");
    await expect(outlet.getByTestId('state-strip').getByRole('button', { name: 'Reconnecter' })).toBeVisible();
    await expect(outlet.getByTestId('ai-state')).toHaveText('SANS IA');
    // banner `reconnect` of the shell (priority above e-mail unverified)
    await expect(page.getByText('Page « Amel Outlet » : jeton Meta expiré.', { exact: false })).toBeVisible();

    const ig = card(page, IDS.cosmetics);
    await expect(ig).toHaveAttribute('data-state', 'pending_review');
    await expect(ig.getByTestId('state-strip')).toContainText('EN ATTENTE META');
    await expect(ig.getByTestId('state-strip')).toContainText("L'IA répondra dès l'approbation de la permission messages.");
    await expect(card(page, IDS.amel).getByTestId('ai-state')).toHaveText('IA ACTIVE');
    await expect(card(page, IDS.amel).getByTestId('state-strip')).toHaveCount(0);

    // "Voir le statut" → App Review status of the permissions
    await page.getByRole('button', { name: 'Voir le statut' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: "État de l'approbation Meta" })).toBeVisible();
    await expect(dialog.getByTestId('approval-permissions')).toContainText('instagram_manage_messages');
    await expect(dialog.getByTestId('approval-permissions')).toContainText("EN COURS D'EXAMEN");
    await dialog.getByRole('button', { name: 'OK' }).click();

    // the row menu comes from the server descriptors: a greyed item keeps its reason in the footer
    await outlet.getByRole('button', { name: 'Actions' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Reconnecter (nouveau jeton Meta)' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Synchroniser les infos de page' })).toHaveAttribute('aria-disabled', 'true');
    await expect(menu).toContainText(errText('PAGE_TOKEN_EXPIRED'));
    await expect(menu.getByRole('menuitem', { name: 'Déconnecter la page' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('AT-CHN-02 / 03 / 08 per-page report: CONNECTÉE, EN ATTENTE META, IGNORÉE ×2 with codes, LIMITE, AVERTISSEMENT', async ({ page }) => {
    await mockChannels(page, mock());
    await loginHome(page, account);
    // same-tab return of the connect flow: the report is read from the API and shown on the list
    await page.goto('/fr/channels?connectReport=99999999-9999-7999-8999-999999999999');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Rapport de connexion' })).toBeVisible();
    await expect(dialog).toContainText('6 pages trouvées sur le compte Meta');
    const rows = dialog.getByTestId('connect-report').locator('li');
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0)).toContainText('Boutique Amel (FB)');
    await expect(rows.nth(0)).toContainText('CONNECTÉE');
    await expect(rows.nth(1)).toContainText('@amel.store (IG)');
    await expect(rows.nth(1)).toContainText('EN ATTENTE META');
    await expect(rows.nth(1)).toContainText(errText('PAGE_INSTAGRAM_PENDING_APPROVAL'));
    await expect(rows.nth(2)).toContainText('IGNORÉE');
    await expect(rows.nth(2)).toContainText(errText('PAGE_ALREADY_CONNECTED_ELSEWHERE'));
    await expect(rows.nth(2)).toContainText('Page déjà connectée à un autre espace.');
    await expect(rows.nth(3)).toContainText(errText('PAGE_MESSAGING_PERMISSION_MISSING'));
    await expect(rows.nth(4)).toContainText('LIMITE');
    await expect(rows.nth(4)).toContainText(errText('PLAN_LIMIT'));
    await expect(rows.nth(5)).toContainText('AVERTISSEMENT');
    await expect(rows.nth(5)).toContainText(errText('PAGE_WEBHOOK_SUBSCRIBE_FAILED'));
    await expect(dialog.getByRole('link', { name: 'Comparer les plans' })).toBeVisible();
    await expectNoA11yViolations(page);
    await dialog.getByRole('button', { name: 'Fermer' }).last().click();
    await expect(page).not.toHaveURL(/connectReport/);
  });

  test('AT-CHN-01 / AT-CHN-12 outcomes of a returned flow: invalid state dialog, cancelled toast, unverified e-mail dialog', async ({ page }) => {
    await mockChannels(page, mock());
    await loginHome(page, account);
    await page.goto('/fr/channels?connectError=OAUTH_STATE_INVALID');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Connexion expirée' })).toBeVisible();
    await expect(dialog).toContainText('La session de connexion a expiré, recommencez.');
    await expect(dialog).toContainText(errText('OAUTH_STATE_INVALID'));
    await dialog.getByRole('button', { name: 'Annuler' }).click();

    await page.goto('/fr/channels?connectError=OAUTH_CANCELLED');
    await expect(page.locator('[data-toast]').filter({ hasText: 'Connexion annulée' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // explainer → continue with an unverified e-mail (this account never opened its verification link)
    await page.getByTestId('connect-facebook').click();
    const explainer = page.getByRole('dialog');
    await expect(explainer.getByRole('heading', { name: 'Connecter une page — explications' })).toBeVisible();
    await expect(explainer).toContainText('Lire et répondre aux messages de la page (pages_messaging)');
    await expect(explainer).toContainText('Jamais : publier, voir vos amis, vos données personnelles');
    await expect(explainer.getByTestId('connect-plan')).toHaveText('Plan : 3 / 3 pages');
    // FL-05 F-2: at the limit the new pages will be skipped (PLAN_LIMIT); "Continuer" stays (reconnecting a page works)
    await expect(explainer.getByTestId('connect-at-limit')).toContainText(errText('PLAN_LIMIT'));
    await expect(explainer.getByTestId('connect-continue')).toBeEnabled();
    await explainer.getByRole('radio', { name: 'Instagram (DM)' }).click();
    await expect(explainer.getByTestId('connect-continue')).toHaveText('Continuer avec Instagram');
    await explainer.getByRole('radio', { name: 'Facebook (Messenger)' }).click();
    await explainer.getByTestId('connect-continue').click();
    const unverified = page.getByRole('dialog');
    await expect(unverified.getByRole('heading', { name: 'Vérifiez votre e-mail' })).toBeVisible();
    await expect(unverified).toContainText(errText('AUTH_EMAIL_UNVERIFIED'));
    await expect(unverified.getByRole('button', { name: 'Renvoyer' })).toBeVisible();
    await unverified.getByRole('button', { name: 'OK' }).click();
  });

  test('GLOBAL plan expired: a page paused by the plan resumes through "Réactiver et échanger"', async ({ page }) => {
    const m = mock({ channels: fixtureChannels({ planExpired: true }) });
    await mockChannels(page, m);
    await loginHome(page, account);
    await page.goto('/fr/channels');
    const ig = card(page, IDS.cosmetics);
    await expect(ig).toHaveAttribute('data-state', 'paused_plan');
    await expect(ig.getByTestId('state-strip')).toContainText('EN PAUSE · PLAN');
    await expect(ig.getByTestId('state-strip')).toContainText('Messages conservés, IA silencieuse. Reprendre cette page met une autre en pause.');
    await ig.getByTestId('state-strip').getByRole('button', { name: 'Reprendre' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Réactiver « Amel Cosmétiques »' })).toBeVisible();
    await expect(dialog).toContainText('Réactiver cette page mettra en pause une autre page.');
    await expect(dialog.getByRole('radio')).toHaveCount(1);
    await expect(dialog.getByRole('radio', { name: /Mettre en pause « Boutique Amel »/ })).toBeChecked();
    await expect(dialog.getByRole('link', { name: 'Comparer les plans' })).toBeVisible();
    await dialog.getByTestId('swap-confirm').click();
    await expect(page.locator('[data-toast]').filter({ hasText: '« Amel Cosmétiques » réactivée' })).toBeVisible();
    expect(m.writes).toEqual([`PATCH /channels/${IDS.cosmetics} {"status":"active","swapWithChannelId":"${IDS.amel}"}`]);
    await expect(card(page, IDS.amel)).toHaveAttribute('data-state', 'paused_plan');
    await expect(card(page, IDS.cosmetics)).toHaveAttribute('data-state', 'active');
  });

  test('AT-CHN-09 page overview: insights unavailable card, Djaber counts still shown, health block, tabs, axe', async ({ page }) => {
    await mockChannels(page, mock({ insightsUnavailable: true }));
    await loginHome(page, account);
    await page.goto(`/fr/channels/${IDS.amel}`);
    await expect(page.getByRole('heading', { name: 'Boutique Amel', level: 1 })).toBeVisible();
    await expect(page.getByTestId('meta-insights')).toHaveAttribute('data-state', 'unavailable');
    await expect(page.getByTestId('meta-insights')).toContainText('Statistiques Meta indisponibles pour cette page ; les compteurs Djaber restent visibles.');
    await expect(page.getByTestId('meta-insights')).toContainText(errText('INBOX_INSIGHTS_UNAVAILABLE'));
    await expect(page.getByTestId('channel-counts')).toContainText('128');
    await expect(page.getByTestId('channel-counts')).toContainText('12 actives · 3 à traiter');
    await expect(page.getByTestId('channel-counts')).toContainText('210 entrants · 130 sortants');
    await expect(page.getByTestId('channel-health')).toContainText('Abonné (messages, clics sur les boutons)');
    await expect(page.getByTestId('channel-health')).toContainText('instagram_manage_messages');
    await expect(page.getByTestId('channel-agent')).toContainText('Vendeur Pro');
    await expect(page.getByTestId('channel-facts')).toContainText('ID 1049…82');
    await expectNoA11yViolations(page);

    const tabs = page.getByRole('navigation', { name: 'Sections de la page' });
    await expect(tabs.getByRole('link')).toHaveCount(5); // + Analyse de la page (M4)
    await tabs.getByRole('link', { name: 'IA & agent' }).click();
    await expectUrl(page, `**/fr/channels/${IDS.amel}/ai`);
    await expect(page.getByTestId('channel-ai')).toContainText('Vendeur Pro');
    await expect(page.getByTestId('channel-ai')).toContainText(errText('AGENT_CHANNEL_SWITCH_NEXT_THREAD'));
    await expect(page.getByTestId('channel-welcome')).toBeVisible();
    await tabs.getByRole('link', { name: /Messages/ }).click();
    await expectUrl(page, `**/fr/channels/${IDS.amel}/messages`);
    await expect(page.getByRole('heading', { name: 'Aucune conversation sur cette page' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ouvrir dans la boîte' })).toHaveAttribute('href', new RegExp(`/fr/inbox\\?channel=${IDS.amel}$`));
  });

  test('AT-CHN-11 history: timeline, filters in the URL, sync dialog keeps its content on PAGE_SYNC_TOKEN_EXPIRED', async ({ page }) => {
    await mockChannels(page, mock({ syncTokenExpired: true }));
    await loginHome(page, account);
    await page.goto(`/fr/channels/${IDS.amel}/history`);
    await expect(page.getByTestId('channel-events').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('channel-events')).toContainText('Page connectée');
    await page.getByRole('radio', { name: '7 j' }).click();
    await expect(page).toHaveURL(/period=7d/);
    await page.getByRole('button', { name: /^Type : tous/ }).click();
    // the checkbox is driven by the URL: click, then wait for the state
    await page.getByRole('checkbox', { name: 'Historique synchronisé' }).click();
    await expect(page).toHaveURL(/kind=history_synced/);
    await page.keyboard.press('Escape');

    await page.getByTestId('sync-history').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: "Synchroniser l'historique" })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: '30 jours' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: '90 jours (Pro)' })).toBeVisible();
    await expect(dialog).toContainText('25 conversations × 25 messages au plus');
    await dialog.getByRole('radio', { name: '7 jours' }).check();
    await dialog.getByTestId('sync-submit').click();
    await expect(dialog.getByRole('alert')).toContainText('Synchronisation impossible : page à reconnecter.');
    await expect(dialog.getByRole('alert')).toContainText(errText('PAGE_SYNC_TOKEN_EXPIRED'));
    await expect(dialog.getByRole('radio', { name: '7 jours' })).toBeChecked();
  });

  test('AT-CHN-06 disconnect dialog: three consequences, destructive confirm, page ends DÉCONNECTÉ', async ({ page }) => {
    const m = mock();
    await mockChannels(page, m);
    await loginHome(page, account);
    await page.goto(`/fr/channels/${IDS.amel}`);
    await page.getByTestId('disconnect-page').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Déconnecter « Boutique Amel » ?' })).toBeVisible();
    await expect(dialog).toContainText('DESTRUCTIF');
    await expect(dialog).toContainText('agent Vendeur Pro');
    await expect(dialog.locator('li')).toHaveText([
      'Djaber se désabonne des webhooks de la page et supprime le jeton',
      "L'agent est détaché ; les conversations et commandes sont conservées (lecture)",
      'Vous pourrez reconnecter la page plus tard (même historique)',
    ]);
    await dialog.getByTestId('disconnect-confirm').click();
    await expectUrl(page, '**/fr/channels');
    expect(m.writes).toEqual([`DELETE /channels/${IDS.amel}`]);
    await expect(card(page, IDS.amel)).toHaveAttribute('data-state', 'disconnected');
    await expect(card(page, IDS.amel).getByTestId('state-strip')).toContainText('DÉCONNECTÉ');
  });
});

test.describe('real API (fake Meta adapter) — connect, report, page, pause, reconnect, disconnect', () => {
  let account: Account;
  let pageId = '';
  let pageName = '';

  test.beforeAll(async ({ request }) => {
    test.skip(!(await apiReady(request)), 'API not reachable on :4010');
    account = await createAccount(request, { prefix: 'chn', finishOnboarding: true });
    test.skip(!(await channelsReady(request, account)), 'M3 channels API not served by the running build (GET /channels)');
    await verifyEmail(request, account);
  });

  test('empty state with both connect buttons, axe', async ({ page }) => {
    await loginHome(page, account);
    await page.goto('/fr/channels');
    await expect(page.getByRole('heading', { name: 'Aucune page connectée' })).toBeVisible();
    await expect(page.getByTestId('connect-facebook')).toBeVisible();
    await expect(page.getByTestId('connect-instagram')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('AT-CHN-12 OAuth refused ⇒ "Connexion annulée", nothing stored', async ({ page, request }) => {
    // the fake dialog URL is our own callback: `error=access_denied` instead of the code is what Meta sends on refusal
    await page.route('**/api/v1/channels/connect/facebook', async (route) => {
      const res = await route.fetch();
      const json = (await res.json()) as { data: { url: string; expiresAt: string } };
      const url = new URL(json.data.url);
      url.searchParams.delete('code');
      url.searchParams.set('error', 'access_denied');
      await route.fulfill({ response: res, json: { ...json, data: { ...json.data, url: url.toString() } } });
    });
    await loginHome(page, account);
    await page.goto('/fr/channels');
    await page.getByTestId('connect-facebook').click();
    await page.getByTestId('connect-continue').click();
    await expect(page.locator('[data-toast]').filter({ hasText: 'Connexion annulée' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Aucune page connectée' })).toBeVisible();
    expect(await listChannels(request, account)).toHaveLength(0);
  });

  test('AT-CHN-01 tampered state ⇒ "Connexion expirée" dialog (OAUTH_STATE_INVALID), nothing stored', async ({ page, request }) => {
    await page.route('**/api/v1/channels/connect/facebook', async (route) => {
      const res = await route.fetch();
      const json = (await res.json()) as { data: { url: string; expiresAt: string } };
      const url = new URL(json.data.url);
      url.searchParams.set('state', `${url.searchParams.get('state') ?? ''}tampered`);
      await route.fulfill({ response: res, json: { ...json, data: { ...json.data, url: url.toString() } } });
    });
    await loginHome(page, account);
    await page.goto('/fr/channels');
    await page.getByTestId('connect-facebook').click();
    await page.getByTestId('connect-continue').click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Connexion expirée' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
    expect(await listChannels(request, account)).toHaveLength(0);
  });

  test('AT-CHN-02 / AT-CHN-03 connect in a pop-up ⇒ per-page report, cards on the list', async ({ page, request }) => {
    await loginHome(page, account);
    await page.goto('/fr/channels');
    await page.getByTestId('connect-facebook').click();
    const popup = page.waitForEvent('popup');
    await page.getByTestId('connect-continue').click();
    await popup;
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Rapport de connexion' })).toBeVisible({ timeout: 20_000 });
    const rows = dialog.getByTestId('connect-report').locator('li');
    await expect(rows.first()).toContainText('(FB)');
    await expect(dialog.locator('li[data-row="connected"]').first()).toContainText('CONNECTÉE');
    // every page of the Meta account has a row; the ones beyond the plan limit are LIMITE with PLAN_LIMIT (AT-CHN-03)
    const stored = await listChannels(request, account);
    expect(stored.length).toBeGreaterThan(0);
    const limited = await dialog.locator('li[data-row="limit"]').count();
    if (limited > 0) await expect(dialog.locator('li[data-row="limit"]').first()).toContainText(errText('PLAN_LIMIT'));
    await dialog.getByRole('button', { name: 'Fermer' }).last().click();

    const first = stored.find((c) => c.platform === 'facebook' && c.parentChannelId === null)!;
    pageId = first.id;
    pageName = first.name;
    await expect(page.getByTestId('channel-card')).toHaveCount(stored.length);
    await expect(card(page, pageId)).toHaveAttribute('data-state', 'active');
    await expect(card(page, pageId)).toContainText(pageName);
    // a linked Instagram account is a second card, child of the page (CHN-02)
    const child = stored.find((c) => c.parentChannelId === pageId);
    if (child) await expect(card(page, child.id)).toContainText(`LIÉ À ${pageName.toUpperCase()}`, { ignoreCase: true });
    await expectNoA11yViolations(page);
  });

  test('CHN-07 page: overview, health, history with the "Page connectée" event, sync history job', async ({ page }) => {
    test.skip(!pageId, 'no connected page');
    await loginHome(page, account);
    await page.goto(`/fr/channels/${pageId}`);
    await expect(page.getByRole('heading', { name: pageName, level: 1 })).toBeVisible();
    await expect(page.getByTestId('channel-counts')).toBeVisible();
    await expect(page.getByTestId('channel-health')).toContainText('Abonné (messages, clics sur les boutons)');
    await expect(page.getByTestId('meta-insights')).toHaveAttribute('data-state', /ready|unavailable/);
    await expectNoA11yViolations(page);

    await page.getByRole('navigation', { name: 'Sections de la page' }).getByRole('link', { name: 'Historique' }).click();
    await expectUrl(page, `**/fr/channels/${pageId}/history`);
    await expect(page.getByTestId('channel-events').locator('li[data-kind="connected"]')).toBeVisible();
    await page.getByTestId('sync-history').click();
    await page.getByRole('dialog').getByTestId('sync-submit').click();
    await expect(page.getByTestId('sync-job')).toHaveAttribute('data-status', /done|partial/, { timeout: 30_000 });
    await expect(page.getByTestId('sync-job')).toContainText('Historique synchronisé');
  });

  test('pause then resume from the list (row menu and state strip)', async ({ page }) => {
    test.skip(!pageId, 'no connected page');
    await loginHome(page, account);
    await page.goto('/fr/channels');
    await card(page, pageId).getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Mettre en pause' }).click();
    await expect(card(page, pageId)).toHaveAttribute('data-state', 'paused');
    await expect(card(page, pageId).getByTestId('state-strip')).toContainText('EN PAUSE');
    await card(page, pageId).getByTestId('state-strip').getByRole('button', { name: 'Reprendre' }).click();
    await expect(card(page, pageId)).toHaveAttribute('data-state', 'active');
  });

  test('AT-CHN-12 reconnecting the same page updates it: no duplicate card', async ({ page, request }) => {
    test.skip(!pageId, 'no connected page');
    const before = (await listChannels(request, account)).length;
    await loginHome(page, account);
    await page.goto('/fr/channels');
    await card(page, pageId).getByRole('button', { name: 'Actions' }).click();
    const popup = page.waitForEvent('popup');
    await page.getByRole('menuitem', { name: 'Reconnecter (nouveau jeton Meta)' }).click();
    await popup;
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Rapport de connexion' })).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByTestId('connect-report')).toContainText('déjà connectée · jeton mis à jour');
    await dialog.getByRole('button', { name: 'Fermer' }).last().click();
    expect((await listChannels(request, account)).length).toBe(before);
    await expect(page.getByTestId('channel-card')).toHaveCount(before);
  });

  test('AT-CHN-06 disconnect from the danger zone: history kept, card DÉCONNECTÉ with Reconnecter', async ({ page, request }) => {
    test.skip(!pageId, 'no connected page');
    await loginHome(page, account);
    await page.goto(`/fr/channels/${pageId}`);
    await page.getByTestId('disconnect-page').click();
    await page.getByRole('dialog').getByTestId('disconnect-confirm').click();
    await expectUrl(page, '**/fr/channels');
    await expect(card(page, pageId)).toHaveAttribute('data-state', 'disconnected');
    await expect(card(page, pageId).getByTestId('state-strip').getByRole('button', { name: 'Reconnecter' })).toBeVisible();
    expect((await listChannels(request, account)).find((c) => c.id === pageId)?.status).toBe('disconnected');
    // the page stays readable
    await page.goto(`/fr/channels/${pageId}/history`);
    await expect(page.getByTestId('channel-events').locator('li[data-kind="disconnected"]')).toBeVisible();
  });
});
