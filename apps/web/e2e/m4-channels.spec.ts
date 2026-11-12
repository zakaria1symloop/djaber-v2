// M4 — channel page "IA & agent" tab, agent linking from the pages, and the page analysis (UI side of AT-AGT-04 seen
// from the channel, and AT-CHN-10). Frames: "CHN-07b — … IA & agent", "AGT-02 — step 4 channels (move dialog state)",
// "CHN-08 — Channel page — analysis review (import)", "CHN-06 — Channels — list with statuses".
// On the REAL API (fake Meta pages, deterministic fake AI, worker running): one shop per file (`setupShop`), its agents
// and links are built through the API, the analysis reads the five fake posts of the page (three products, one posted
// twice, one greeting without picture) and the import creates real products. What the page sends is observed, never
// answered. `page.route` stays only for the states the fake drivers cannot produce over HTTP; each use says why.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { API, apiReady, expectUrl, type Account } from './support/m1';
import { seedProduct, sku } from './support/m2';
import { failWith, inviteOperator } from './support/m3-inbox';
import { fail } from './support/m4';
import { activeAgent, createAgent, getAgent, linkPage, pauseAgent, realDelete, realPut, refreshToken, setupShop, type RealAgent, type Shop } from './support/m4-real';
import { analysisDone, analysisOf, channelOf, observe, patchWhile, productsNamed, rerunLabel, openFresh, signInFresh, spendDailyRuns, toast } from './support/m4-real-channels';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 400_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

const FIRST = { timeout: 60_000 };
let shop: Shop;
let owner: Account;
let vendeur: RealAgent; // active, answers on the first Facebook page
let service: RealAgent; // paused, no page
let conseiller: RealAgent; // draft, no page
const DUPLICATE = 'Robe satin bordeaux'; // named like the first fake post: the analysis flags it as existing

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  shop = await setupShop(request, 'm4chn');
  owner = shop.owner;
  await seedProduct(request, owner, { name: DUPLICATE, price: 4500, stock: 2, sku: sku('E2E') });
  vendeur = await activeAgent(request, owner, { name: 'Vendeur Pro', channelId: shop.facebook.id });
  // paused with no page: activated on the second page, paused, then the page is taken back
  service = await activeAgent(request, owner, { name: 'Service Client', channelId: shop.facebook2.id, presetKey: 'service-client' });
  service = await pauseAgent(request, owner, service.id);
  await linkPage(request, owner, shop.facebook2.id, null);
  conseiller = await createAgent(request, owner, { name: 'Conseiller Produit', presetKey: 'conseiller-produit' });
});

/** Links of the shop as every test of the AI tab expects them: Facebook → Vendeur Pro, Instagram free, no icebreaker. */
async function reset(request: Page['request']) {
  await linkPage(request, owner, shop.facebook.id, vendeur.id);
  await linkPage(request, owner, shop.instagram.id, null);
  await realPut(request, owner, `/channels/${shop.facebook.id}/icebreaker`, { text: '' });
}
const agentPut = (page: Page, channelId: string) => observe(page, 'PUT', new RegExp(`/api/v1/channels/${channelId}/agent$`));
const fbName = () => shop.facebook.name;

async function openAi(page: Page, who: Account = owner) {
  await signInFresh(page, who);
  await openFresh(page, `/fr/channels/${shop.facebook.id}/ai`, () => page.getByTestId('channel-ai'));
}
async function openAnalysis(page: Page, channelId: string, ready: (page: Page) => Locator = (p) => p.getByTestId('channel-analysis')) {
  await signInFresh(page, owner);
  await openFresh(page, `/fr/channels/${channelId}/analysis`, () => ready(page));
}
/** Opens the picker, chooses an agent and submits. */
async function pickAgent(page: Page, opener: Locator, agentId: string, beforeSubmit?: () => Promise<void>) {
  await opener.click();
  const picker = page.getByRole('dialog', { name: "Changer d'agent" });
  await expect(picker.getByTestId('agent-picker')).toBeVisible();
  await picker.locator(`label[data-agent="${agentId}"] input`).check();
  if (beforeSubmit) await beforeSubmit();
  await picker.getByTestId('agent-picker-submit').click();
  await expect(picker).toHaveCount(0);
}

test.describe('channel page — IA & agent tab', () => {
  test('agent card, next-thread note, picker with the current agent marked, axe', async ({ page }) => {
    await reset(page.request);
    await openAi(page);
    await expect(page.getByRole('heading', { name: fbName(), level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sections de la page' }).getByRole('link', { name: 'IA & agent' })).toHaveAttribute('aria-current', 'page');
    const card = page.getByTestId('channel-ai');
    await expect(card.getByTestId('channel-ai-agent')).toHaveAttribute('data-agent', vendeur.id);
    await expect(card.getByRole('link', { name: 'Vendeur Pro' })).toHaveAttribute('href', new RegExp(`/fr/agents/${vendeur.id}$`));
    await expect(card).toContainText('ACTIF');
    await expect(card.getByTestId('channel-ai-live')).toHaveText('IA active sur cette page');
    await expect(card).toContainText("Le changement s'applique aux nouvelles conversations.");
    await expect(card).toContainText(errText('AGENT_CHANNEL_SWITCH_NEXT_THREAD'));
    await expect(card.getByTestId('agent-change')).toHaveText('Changer');
    await expect(card.getByTestId('agent-detach')).toHaveText('Détacher');
    await expect(page.getByTestId('channel-ai-readonly')).toHaveCount(0);
    await expect(page.getByTestId('channel-icebreaker')).toBeVisible();
    await expect(page.getByTestId('channel-welcome')).toBeVisible();
    await expectNoA11yViolations(page);

    await card.getByTestId('agent-change').click();
    const picker = page.getByRole('dialog', { name: "Changer d'agent" });
    await expect(picker).toContainText(`Agent qui répond sur « ${fbName()} » · une page ne peut avoir qu'un seul agent`);
    // the three agents of the workspace (GET /agents)
    const options = picker.getByTestId('agent-picker').locator('label[data-agent]');
    await expect(options).toHaveCount(3);
    for (const a of [vendeur, service, conseiller]) await expect(picker.locator(`label[data-agent="${a.id}"]`)).toContainText(a.name);
    await expect(picker.locator(`label[data-agent="${conseiller.id}"]`)).toContainText('BROUILLON');
    const current = picker.locator(`label[data-agent="${vendeur.id}"]`);
    await expect(current).toContainText('ACTUEL');
    await expect(current.getByRole('radio')).toBeDisabled();
    // nothing chosen yet: the submit is greyed with its reason
    await expect(picker.getByTestId('agent-picker-submit')).toBeDisabled();
    await expect(picker.getByTestId('agent-picker-submit')).toHaveAttribute('title', 'Choisissez un agent');
    await picker.getByRole('button', { name: 'Annuler' }).click();
    await expect(picker).toHaveCount(0);
  });

  test('AT-AGT-04 choosing another agent asks to move the page: cancel ⇒ nothing written, confirm ⇒ PUT with move:true', async ({ page }) => {
    await reset(page.request);
    const sent = agentPut(page, shop.facebook.id);
    await openAi(page);
    await pickAgent(page, page.getByTestId('agent-change'), service.id);

    const dialog = page.getByRole('dialog', { name: `Déplacer « ${fbName()} » vers « Service Client » ?` });
    await expect(dialog.getByTestId('move-dialog')).toContainText('« Vendeur Pro » ne répondra plus sur cette page.');
    await expect(dialog.getByTestId('move-dialog')).toContainText(errText('AGENT_CHANNEL_SWITCH_NEXT_THREAD'));
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialog).toHaveCount(0);
    expect(sent).toEqual([]);
    expect((await channelOf(page.request, owner, shop.facebook.id)).agent?.id).toBe(vendeur.id);
    await expect(page.getByTestId('channel-ai-agent')).toHaveAttribute('data-agent', vendeur.id);

    await pickAgent(page, page.getByTestId('agent-change'), service.id);
    await expect(dialog.getByTestId('move-confirm')).toHaveText('Déplacer la page');
    await dialog.getByTestId('move-confirm').click();
    await expect(toast(page, `« ${fbName()} » rattachée à Service Client`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(sent).toEqual([{ agentId: service.id, move: true }]);
    await expect(page.getByTestId('channel-ai-agent')).toHaveAttribute('data-agent', service.id);
    await expect(page.getByTestId('channel-ai').getByRole('link', { name: 'Service Client' })).toBeVisible();
    // Service Client is paused: the page has an agent but the AI does not answer
    await expect(page.getByTestId('channel-ai')).toContainText('EN PAUSE');
    await expect(page.getByTestId('channel-ai-live')).toHaveText("L'IA ne répond pas sur cette page");
    // the API moved the page: the previous agent lost it
    expect((await channelOf(page.request, owner, shop.facebook.id)).agent?.id).toBe(service.id);
    expect((await getAgent(page.request, owner, vendeur.id)).channels.map((c) => c.id)).not.toContain(shop.facebook.id);
  });

  test('"Détacher" ⇒ agentId null, no-agent card; attaching on a page without agent needs no confirmation', async ({ page }) => {
    await reset(page.request);
    const sent = agentPut(page, shop.facebook.id);
    await openAi(page);
    await page.getByTestId('agent-detach').click();
    // asked first: nothing is written before the confirmation
    const confirm = page.getByRole('dialog');
    await expect(confirm.getByRole('heading', { name: 'Détacher « Vendeur Pro » ?' })).toBeVisible();
    expect(sent).toEqual([]);
    await confirm.getByRole('button', { name: 'Détacher' }).click();
    await expect(toast(page, `Agent détaché de « ${fbName()} »`)).toBeVisible();
    expect(sent).toEqual([{ agentId: null }]);
    expect((await channelOf(page.request, owner, shop.facebook.id)).agent).toBeNull();
    const card = page.getByTestId('channel-ai');
    await expect(card.getByTestId('channel-ai-none')).toHaveText("Cette page n'a pas d'IA — les messages arrivent dans la boîte sans réponse automatique.");
    await expect(card.getByTestId('channel-ai-agent')).toHaveCount(0);
    await expect(card.getByTestId('agent-attach')).toHaveText('Rattacher un agent');
    await expect(card.getByTestId('agent-create')).toHaveText('Créer un agent');
    // the wizard opens with this page: it is linked to the agent as soon as the draft is created
    await expect(card.getByTestId('agent-create')).toHaveAttribute('href', `/fr/agents/new?channel=${shop.facebook.id}`);
    await expect(card.getByTestId('agent-change')).toHaveCount(0);
    await expect(card.getByTestId('agent-detach')).toHaveCount(0);
    await expect(card.getByTestId('channel-ai-live')).toHaveText("L'IA ne répond pas sur cette page");

    // no agent on the page ⇒ straight write, no move dialog
    await pickAgent(page, card.getByTestId('agent-attach'), vendeur.id);
    await expect(toast(page, `« ${fbName()} » rattachée à Vendeur Pro`)).toBeVisible();
    await expect(page.getByTestId('move-dialog')).toHaveCount(0);
    expect(sent).toEqual([{ agentId: null }, { agentId: vendeur.id }]);
    await expect(card.getByTestId('channel-ai-agent')).toHaveAttribute('data-agent', vendeur.id);
    await expect(card.getByTestId('channel-ai-live')).toHaveText('IA active sur cette page');
    expect((await channelOf(page.request, owner, shop.facebook.id)).agent?.id).toBe(vendeur.id);
  });

  test('a server 409 AGENT_PAGE_ALREADY_ASSIGNED opens the same move dialog; confirming resends with move:true', async ({ page }) => {
    // the screen shows a page without agent, and someone links it to "Conseiller Produit" while the picker is open:
    // the API answers 409 with that agent's name
    await reset(page.request);
    await linkPage(page.request, owner, shop.facebook.id, null);
    const sent = agentPut(page, shop.facebook.id);
    await openAi(page);
    await expect(page.getByTestId('channel-ai-none')).toBeVisible();
    await pickAgent(page, page.getByTestId('agent-attach'), service.id, () => linkPage(page.request, owner, shop.facebook.id, conseiller.id).then(() => undefined));
    const dialog = page.getByRole('dialog', { name: `Déplacer « ${fbName()} » vers « Service Client » ?` });
    await expect(dialog.getByTestId('move-dialog')).toContainText('« Conseiller Produit » ne répondra plus sur cette page.');
    expect(sent).toEqual([{ agentId: service.id }]);
    await dialog.getByTestId('move-confirm').click();
    await expect(toast(page, `« ${fbName()} » rattachée à Service Client`)).toBeVisible();
    expect(sent).toEqual([{ agentId: service.id }, { agentId: service.id, move: true }]);
    await expect(page.getByTestId('channel-ai-agent')).toHaveAttribute('data-agent', service.id);
    expect((await channelOf(page.request, owner, shop.facebook.id)).agent?.id).toBe(service.id);
  });

  test('a refused move keeps the dialog open with the error inline', async ({ page }) => {
    // the chosen agent is deleted by a colleague while the move dialog is open: the API refuses the move (404)
    await reset(page.request);
    const gone = await createAgent(page.request, owner, { name: 'Agent supprimé' });
    await openAi(page);
    await pickAgent(page, page.getByTestId('agent-change'), gone.id);
    const dialog = page.getByRole('dialog', { name: new RegExp(`^Déplacer « ${fbName()} »`) });
    await expect(dialog.getByTestId('move-dialog')).toBeVisible();
    await realDelete(page.request, owner, `/agents/${gone.id}`);
    await dialog.getByTestId('move-confirm').click();
    await expect(dialog.getByRole('alert')).toHaveText('Introuvable ou accès refusé.');
    await expect(dialog.getByTestId('move-confirm')).toBeEnabled();
    await expect(page.getByTestId('channel-ai-agent')).toHaveAttribute('data-agent', vendeur.id);
    expect((await channelOf(page.request, owner, shop.facebook.id)).agent?.id).toBe(vendeur.id);
  });

  test('icebreaker: counter, save ⇒ PUT { text } + toast, more than 300 characters is blocked, clear ⇒ empty text', async ({ page }) => {
    await reset(page.request);
    const sent = observe(page, 'PUT', new RegExp(`/api/v1/channels/${shop.facebook.id}/icebreaker$`));
    await openAi(page);
    const card = page.getByTestId('channel-icebreaker');
    const field = card.getByRole('textbox', { name: "Message d'accueil (icebreaker)" });
    await expect(field).toHaveValue('');
    await expect(card.getByTestId('icebreaker-count')).toHaveText('0 / 300');
    await expect(card.getByTestId('icebreaker-save')).toBeDisabled();
    await expect(card.getByTestId('icebreaker-clear')).toHaveCount(0);

    // too long: counter in red, save greyed with the reason, nothing sent
    await field.fill('a'.repeat(301));
    await expect(card.getByTestId('icebreaker-count')).toHaveText('301 / 300');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(card.getByTestId('icebreaker-save')).toBeDisabled();
    await expect(card.getByTestId('icebreaker-save')).toHaveAttribute('title', 'Trop long (300 max)');
    expect(sent).toEqual([]);

    await field.fill('  Salam ! Une question sur nos robes ?  ');
    await expect(card.getByTestId('icebreaker-count')).toHaveText('36 / 300');
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');
    await card.getByTestId('icebreaker-save').click();
    await expect(toast(page, 'Icebreaker enregistré')).toBeVisible();
    expect(sent).toEqual([{ text: 'Salam ! Une question sur nos robes ?' }]);
    await expect(field).toHaveValue('Salam ! Une question sur nos robes ?');
    await expect(card.getByTestId('icebreaker-save')).toBeDisabled();
    expect((await channelOf(page.request, owner, shop.facebook.id)).icebreaker).toBe('Salam ! Une question sur nos robes ?');

    // kept after a reload, then cleared
    await openFresh(page, page.url(), () => field);
    await expect(field).toHaveValue('Salam ! Une question sur nos robes ?');
    // "Annuler" puts the saved text back
    await field.fill('Brouillon');
    await card.getByTestId('icebreaker-cancel').click();
    await expect(field).toHaveValue('Salam ! Une question sur nos robes ?');
    await expect(card.getByTestId('icebreaker-cancel')).toHaveCount(0);
    // "Effacer" is confirmed first
    await card.getByTestId('icebreaker-clear').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Effacer' }).click();
    await expect(toast(page, 'Icebreaker supprimé')).toBeVisible();
    expect(sent.at(-1)).toEqual({ text: '' });
    await expect(field).toHaveValue('');
    await expect(card.getByTestId('icebreaker-clear')).toHaveCount(0);
    expect((await channelOf(page.request, owner, shop.facebook.id)).icebreaker).toBeNull();
  });

  test('icebreaker: a refused save is shown inline and the text is kept', async ({ page }) => {
    await reset(page.request);
    // mock: the real API accepts any text of 300 characters or less, and its only refusal (the page disconnected
    // meanwhile) reaches the open screen live first and locks the field — a refused save cannot be produced
    await failWith(page, new RegExp(`/api/v1/channels/${shop.facebook.id}/icebreaker$`), 'PUT', 422, 'VALIDATION_ERROR', 'Texte refusé par Meta.');
    await openAi(page);
    const card = page.getByTestId('channel-icebreaker');
    const field = card.getByRole('textbox', { name: "Message d'accueil (icebreaker)" });
    await field.fill('Bonjour 👋');
    await card.getByTestId('icebreaker-save').click();
    await expect(card.getByRole('alert')).toHaveText('Texte refusé par Meta.');
    await expect(field).toHaveValue('Bonjour 👋');
    await expect(card.getByTestId('icebreaker-save')).toBeEnabled();
    expect((await channelOf(page.request, owner, shop.facebook.id)).icebreaker).toBeNull();
  });
});

test.describe('/channels list — agent line and menu', () => {
  const cardOf = (page: Page, id: string) => page.locator(`[data-testid="channel-card"][data-channel="${id}"]`);

  test('card: agent name, "Générer depuis cette page", "Rattacher un agent" on a page without agent', async ({ page }) => {
    await reset(page.request);
    const sent = agentPut(page, shop.instagram.id);
    await signInFresh(page, owner);
    await openFresh(page, '/fr/channels', () => cardOf(page, shop.facebook.id));
    const fb = cardOf(page, shop.facebook.id);
    await expect(fb.getByTestId('card-agent')).toContainText('Agent IA : Vendeur Pro');
    await expect(fb.getByTestId('card-agent').getByRole('link', { name: 'Vendeur Pro' })).toHaveAttribute('href', new RegExp(`/fr/agents/${vendeur.id}$`));
    await expect(fb.getByTestId('card-generate')).toHaveText('Générer depuis cette page');
    await expect(fb.getByTestId('card-generate')).toHaveAttribute('href', new RegExp(`/fr/agents/generate\\?channel=${shop.facebook.id}$`));

    // a page without agent: the line says so and offers to link one (no move dialog: nothing to move)
    const ig = cardOf(page, shop.instagram.id);
    await expect(ig.getByTestId('card-agent')).toContainText('Aucun agent — les messages arrivent sans réponse automatique.');
    await expect(ig.getByTestId('card-generate')).toHaveCount(0);
    await pickAgent(page, ig.getByTestId('card-link-agent'), service.id);
    await expect(toast(page, `« ${shop.instagram.name} » rattachée à Service Client`)).toBeVisible();
    expect(sent).toEqual([{ agentId: service.id }]);
    await expect(ig.getByTestId('card-agent')).toContainText('Agent IA : Service Client');
    expect((await channelOf(page.request, owner, shop.instagram.id)).agent?.id).toBe(service.id);

    await fb.getByTestId('card-generate').click();
    await expectUrl(page, `**/fr/agents/generate?channel=${shop.facebook.id}`, FIRST);
  });

  test('row menu: "Changer d\'agent" opens the picker (move dialog), "Extraire le catalogue de la page" opens the analysis', async ({ page }) => {
    await reset(page.request);
    const sent = agentPut(page, shop.facebook.id);
    await signInFresh(page, owner);
    await openFresh(page, '/fr/channels', () => cardOf(page, shop.facebook.id));
    const fb = cardOf(page, shop.facebook.id);
    await fb.getByRole('button', { name: 'Actions', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.locator('[data-action="changeAgent"]')).toHaveText("Changer d'agent");
    await expect(menu.locator('[data-action="analysis"]')).toHaveText('Extraire le catalogue de la page');
    await menu.locator('[data-action="changeAgent"]').click();
    const picker = page.getByRole('dialog', { name: "Changer d'agent" });
    await picker.locator(`label[data-agent="${conseiller.id}"] input`).check();
    await picker.getByTestId('agent-picker-submit').click();
    const dialog = page.getByRole('dialog', { name: `Déplacer « ${fbName()} » vers « Conseiller Produit » ?` });
    await expect(dialog.getByTestId('move-dialog')).toContainText('« Vendeur Pro » ne répondra plus sur cette page.');
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    expect(sent).toEqual([]);

    // a page without agent names the item "Rattacher un agent"
    await cardOf(page, shop.instagram.id).getByRole('button', { name: 'Actions', exact: true }).click();
    await expect(page.getByRole('menu').locator('[data-action="changeAgent"]')).toHaveText('Rattacher un agent');
    await page.keyboard.press('Escape');

    // a client navigation (router.push): on the shared dev server the first push to a route still compiling can be
    // dropped, so the menu item is chosen again while the address has not changed
    await expect(async () => {
      if (!page.url().endsWith('/analysis')) {
        await fb.getByRole('button', { name: 'Actions', exact: true }).click({ timeout: 10_000 });
        await page.getByRole('menu').locator('[data-action="analysis"]').click({ timeout: 10_000 });
      }
      await expectUrl(page, `**/fr/channels/${shop.facebook.id}/analysis`, { timeout: 30_000 });
    }).toPass({ timeout: 120_000 });
    // no analysis ran on this page yet
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'idle', FIRST);
  });
});

test.describe('AT-CHN-10 page analysis', () => {
  const item = (page: Page, key: string) => page.locator(`[data-testid="analysis-item"][data-key="${key}"]`);
  const analysisUrl = (channelId: string) => new RegExp(`/api/v1/channels/${channelId}/analysis$`);
  const importUrl = (channelId: string) => new RegExp(`/api/v1/channels/${channelId}/analysis/import$`);
  /** keys of the review rows by product name (the keys are the ids of the fake posts) */
  /**
   * "Relancer (n restante(s) aujourd’hui)" with the runs the API reports. Not compared with an exact count: the other
   * spec files of the shared run clear the limiter keys of the dev Redis (`clearRateLimits` on a 429 sign-up), which
   * gives the workspace its 3 runs back at any time.
   */
  const RUNS_LEFT = /^Relancer \((1 restante|[23] restantes) aujourd’hui\)$/;
  const keysOf = async (request: Page['request'], channelId: string) => Object.fromEntries((await analysisOf(request, owner, channelId)).items.map((i) => [i.name, i.key])) as Record<string, string>;

  test('idle ⇒ "Analyser la page" starts the job (POST) and the review grid follows', async ({ page }) => {
    const posts = observe(page, 'POST', analysisUrl(shop.facebook.id));
    await openAnalysis(page, shop.facebook.id);
    const root = page.getByTestId('channel-analysis');
    await expect(root).toHaveAttribute('data-state', 'idle', FIRST);
    await expect(page.getByRole('navigation', { name: 'Sections de la page' }).getByRole('link', { name: 'Analyse de la page' })).toHaveAttribute('aria-current', 'page');
    await expect(root).toContainText("L'IA lit vos 30 dernières publications et propose des produits. Rien n'est créé avant votre validation. Gratuit · 3 analyses / jour.");
    const idle = page.getByTestId('analysis-idle');
    await expect(idle.getByRole('heading', { name: 'Extraire le catalogue depuis vos publications' })).toBeVisible();
    await expect(idle).toContainText('GRATUIT · 3 ANALYSES / JOUR');
    await expect(idle.getByTestId('analysis-run')).toHaveText('Analyser la page');
    await idle.getByTestId('analysis-run').click();
    // the worker reads the five posts of the page: running, then the review (progress through WS / polling)
    await expect(root).toHaveAttribute('data-state', 'done', FIRST);
    expect(posts).toHaveLength(1);
    await expect(page.getByTestId('analysis-item')).toHaveCount(3);
    expect((await analysisOf(page.request, owner, shop.facebook.id)).state).toBe('done');
  });

  test('without pages_read_user_content: permission state + "Reconnecter" (state from the API, and refused POST)', async ({ page }) => {
    // mock: the fake pages are always connected with pages_read_user_content and a connected token cannot lose a
    // permission over HTTP — the real answer of the second page is patched to `permission_required`
    const sw = await patchWhile(page, analysisUrl(shop.facebook2.id), (d) => ({ ...d, state: 'permission_required' }));
    const posts = observe(page, 'POST', analysisUrl(shop.facebook2.id));
    await openAnalysis(page, shop.facebook2.id);
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'permission', FIRST);
    const card = page.getByTestId('analysis-permission');
    await expect(card).toHaveAttribute('role', 'alert');
    await expect(card).toContainText('PERMISSION REQUISE');
    await expect(card).toContainText('Reconnectez la page avec « contenu de la page »');
    await expect(card.getByTestId('analysis-reconnect')).toHaveText('Reconnecter');
    await expect(card.getByTestId('analysis-reconnect')).toBeEnabled();
    await expect(page.getByTestId('analysis-run')).toHaveCount(0);

    // the real answer (no analysis yet, idle) but the token lost the permission meanwhile: the POST is refused
    // mock: same reason — the API never refuses the start of an analysis of a fake page
    sw.on = false;
    await failWith(page, analysisUrl(shop.facebook2.id), 'POST', 403, 'PAGE_ANALYSIS_PERMISSION_REQUIRED', 'Reconnectez la page avec la permission "contenu".');
    await openFresh(page, page.url(), () => page.getByTestId('analysis-idle'));
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'idle');
    await page.getByTestId('analysis-run').click();
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'permission');
    await expect(page.getByTestId('analysis-permission')).toContainText(errText('PAGE_ANALYSIS_PERMISSION_REQUIRED'));
    await expect(page.getByTestId('analysis-reconnect')).toBeVisible();
    expect(posts).toHaveLength(1);
  });

  test('running: job progress "2 / 5 publications", then the review as soon as the analysis is done', async ({ page }) => {
    // mock: the worker reads the five fake posts in well under a second — the running answer is held on the real one
    // (done) until the switch is turned off
    const sw = await patchWhile(page, analysisUrl(shop.facebook.id), (d) => ({ ...d, state: 'running', progress: 40, postsDone: 2, postsTotal: 5, items: [], finishedAt: null }));
    await openAnalysis(page, shop.facebook.id);
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'running', FIRST);
    const running = page.getByTestId('analysis-running');
    await expect(running).toContainText('EN COURS');
    await expect(running).toContainText('2 / 5 publications');
    await expect(running).toContainText('Navigation libre · résultat en notification');
    await expect(running.getByRole('progressbar', { name: 'EN COURS' })).toHaveAttribute('aria-valuenow', '40');
    await expect(page.getByTestId('analysis-run')).toHaveCount(0);
    // the job ends: the page is polled while running and gets the real review
    sw.on = false;
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await expect(page.getByTestId('analysis-summary')).toContainText('TERMINÉ');
    await expect(page.getByTestId('analysis-item')).toHaveCount(3);
  });

  test('no product detected: AUCUN PRODUIT with the rerun button and its remaining runs', async ({ page }) => {
    // mock: the five fake posts always contain products (the fake Meta adapter cannot be given other posts over HTTP);
    // the real answer is kept, without its items
    await patchWhile(page, analysisUrl(shop.facebook.id), (d) => ({ ...d, items: [] }));
    await openAnalysis(page, shop.facebook.id);
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'empty', FIRST);
    const card = page.getByTestId('analysis-empty');
    await expect(card).toContainText('AUCUN PRODUIT');
    await expect(card).toContainText('Aucune publication ne ressemble à un produit — essayez avec plus de publications ou ajoutez manuellement.');
    await expect(card.getByTestId('analysis-run')).toHaveText(RUNS_LEFT);
    await expect(card.getByTestId('analysis-run')).toBeEnabled();
    await expect(page.getByTestId('analysis-grid')).toHaveCount(0);
  });

  test('failed: ÉCHEC with "Réessayer" which starts a new run', async ({ page }) => {
    // mock: the fake Meta adapter cannot be made to fail a job over HTTP — the real answer of the second page (no
    // analysis yet) is patched to `failed` until the page sends its POST; the new run is real
    const sw = await patchWhile(page, analysisUrl(shop.facebook2.id), (d) => ({ ...d, state: 'failed', items: [], error: null, finishedAt: null }));
    const posts = observe(page, 'POST', analysisUrl(shop.facebook2.id));
    page.on('request', (r) => {
      if (r.method() === 'POST' && analysisUrl(shop.facebook2.id).test(r.url())) sw.on = false;
    });
    await openAnalysis(page, shop.facebook2.id);
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'failed', FIRST);
    const card = page.getByTestId('analysis-failed');
    await expect(card).toHaveAttribute('role', 'alert');
    await expect(card).toContainText('ÉCHEC');
    await expect(card).toContainText('Analyse interrompue. Réessayez.');
    await card.getByRole('button', { name: 'Réessayer' }).click();
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'done', FIRST);
    expect(posts).toHaveLength(1);
    await expect(page.getByTestId('analysis-item')).toHaveCount(3);
    await analysisDone(page.request, owner, shop.facebook2.id);
  });

  test('review: summary, default selection, select all / deselect duplicates, validation (price > 0, qty > 0), import with FB- SKUs', async ({ page }) => {
    const keys = await keysOf(page.request, shop.facebook.id);
    const [robe, sac, ensemble] = [keys[DUPLICATE]!, keys['Sac à main cuir noir']!, keys['Ensemble sport gris']!];
    const imports = observe(page, 'POST', importUrl(shop.facebook.id));
    await openAnalysis(page, shop.facebook.id, (p) => p.getByTestId('analysis-summary'));
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'done');
    const summary = page.getByTestId('analysis-summary');
    await expect(summary).toContainText('TERMINÉ');
    await expect(summary).toContainText(/5 publications lues · 3 produits détectés · 1 ressemble à un produit existant · terminé en \d+ s/);
    await expect(summary.getByTestId('analysis-run')).toHaveText(RUNS_LEFT);
    await expect(summary.getByTestId('analysis-run')).toBeEnabled();

    // default selection: new items that carry a price
    await expect(page.getByRole('list', { name: 'Produits détectés' }).getByTestId('analysis-item')).toHaveCount(3);
    await expect(item(page, sac)).toHaveAttribute('data-status', 'new');
    await expect(item(page, sac)).toHaveAttribute('data-selected', 'true');
    await expect(item(page, sac)).toContainText('NOUVEAU');
    await expect(item(page, robe)).toHaveAttribute('data-status', 'exists');
    await expect(item(page, robe)).not.toHaveAttribute('data-selected', 'true');
    await expect(item(page, robe)).toContainText(`EXISTE DÉJÀ : ${DUPLICATE}`);
    await expect(item(page, ensemble)).toHaveAttribute('data-status', 'price_missing');
    await expect(item(page, ensemble)).not.toHaveAttribute('data-selected', 'true');
    await expect(item(page, ensemble)).toContainText('PRIX MANQUANT');
    await expect(page.getByTestId('analysis-selection')).toContainText('1 / 3 sélectionnés');
    await expect(page.getByTestId('analysis-selection')).toContainText('prix et stock requis pour importer · catégorie proposée modifiable');
    await expect(item(page, sac).getByLabel('NOM')).toHaveValue('Sac à main cuir noir');
    await expect(item(page, sac).getByLabel('PRIX *')).toHaveValue(/^6\s200$/);
    await expect(item(page, sac).getByLabel('STOCK *')).toHaveValue('1');
    await expect(item(page, sac).getByLabel(/^CATÉGORIE/)).toHaveValue('');
    await expect(item(page, ensemble).getByLabel('PRIX *')).toHaveValue('');
    await expect(page.getByTestId('analysis-import')).toHaveText('Importer 1 produit');
    await expect(page.getByTestId('analysis-footer')).toContainText('SKU « FB-… »');
    await expectNoA11yViolations(page);

    // select all / deselect duplicates
    await expect(page.getByTestId('analysis-deselect-duplicates')).toBeDisabled();
    await page.getByTestId('analysis-select-all').click();
    await expect(page.getByTestId('analysis-selection')).toContainText('3 / 3 sélectionnés');
    await expect(page.getByRole('checkbox', { name: 'Tout sélectionner' })).toBeChecked();
    await expect(page.getByTestId('analysis-select-all')).toBeDisabled();
    await expect(item(page, robe)).toHaveAttribute('data-selected', 'true');
    await page.getByTestId('analysis-deselect-duplicates').click();
    await expect(page.getByTestId('analysis-selection')).toContainText('2 / 3 sélectionnés');
    await expect(item(page, robe)).not.toHaveAttribute('data-selected', 'true');
    await expect(item(page, ensemble)).toHaveAttribute('data-selected', 'true');
    // a selected row without price says so at once
    await expect(item(page, ensemble).getByRole('alert')).toHaveText('Prix de vente requis (> 0)');

    // validation: price > 0 and quantity > 0 on the selected rows — nothing is sent
    await item(page, sac).getByLabel('STOCK *').fill('0');
    await page.getByTestId('analysis-import').click();
    await expect(page.getByTestId('analysis-invalid')).toHaveText('2 produits sélectionnés sont incomplets : prix et stock doivent être supérieurs à 0.');
    await expect(item(page, sac).getByRole('alert')).toHaveText('Quantité invalide');
    await expect(item(page, sac).getByLabel('STOCK *')).toHaveAttribute('aria-invalid', 'true');
    await expect(item(page, ensemble).getByLabel('PRIX *')).toHaveAttribute('aria-invalid', 'true');
    expect(imports).toEqual([]);
    await item(page, sac).getByLabel('STOCK *').fill('3');
    await expect(page.getByTestId('analysis-invalid')).toHaveText('1 produit sélectionné est incomplet : prix et stock doivent être supérieurs à 0.');
    await page.getByTestId('analysis-import').click();
    expect(imports).toEqual([]);

    // corrections: price of the item without price, name, price and category of the other one
    await item(page, ensemble).getByLabel('PRIX *').fill('3200');
    await expect(item(page, ensemble)).toHaveAttribute('data-status', 'new');
    await expect(page.getByTestId('analysis-invalid')).toHaveCount(0);
    await item(page, sac).getByLabel('NOM').fill('Sac à main cuir noir (grand modèle)');
    await item(page, sac).getByLabel('PRIX *').fill('6800');
    await item(page, sac).getByLabel(/^CATÉGORIE/).fill('Maroquinerie');
    await expect(item(page, sac).getByText('CATÉGORIE (NOUVELLE)')).toBeVisible();
    await expect(page.getByTestId('analysis-import')).toHaveText('Importer 2 produits');

    await page.getByTestId('analysis-import').click();
    await expect(toast(page, '2 produits importés dans le catalogue')).toBeVisible(FIRST);
    expect(imports).toHaveLength(1);
    const body = imports[0] as { items: Record<string, unknown>[] };
    expect(body.items.map(({ name, price, quantity, category }) => ({ name, price, quantity, category }))).toEqual([
      { name: 'Sac à main cuir noir (grand modèle)', price: 6800, quantity: 3, category: 'Maroquinerie' },
      { name: 'Ensemble sport gris', price: 3200, quantity: 1, category: null },
    ]);

    // the products exist in the catalogue with their FB- SKUs, price and stock
    const [bag] = await productsNamed(page.request, owner, 'Sac à main cuir noir (grand modèle)');
    const [set] = (await productsNamed(page.request, owner, 'Ensemble sport gris')).filter((p) => p.name === 'Ensemble sport gris');
    expect(bag).toMatchObject({ price: 6800, stock: 3 });
    expect(set).toMatchObject({ price: 3200, stock: 1 });
    expect(bag!.sku).toMatch(/^FB-\d{4}$/);
    expect(set!.sku).toMatch(/^FB-\d{4}$/);

    // result: counts, FB- SKUs on the imported cards (locked), the duplicate is still importable
    await expect(page.getByTestId('analysis-import-result')).toHaveText('2 produits importés dans le catalogue');
    for (const [key, ref] of [[sac, bag!.sku], [ensemble, set!.sku]] as const) {
      await expect(item(page, key)).toHaveAttribute('data-status', 'imported');
      await expect(item(page, key)).toContainText(`IMPORTÉ · ${ref}`);
      await expect(item(page, key).getByRole('checkbox')).toBeDisabled();
      await expect(item(page, key).getByLabel('NOM')).toBeDisabled();
    }
    await expect(item(page, robe)).toHaveAttribute('data-status', 'exists');
    await expect(page.getByTestId('analysis-selection')).toContainText('0 / 1 sélectionnés');
    await expect(page.getByTestId('analysis-import')).toBeDisabled();
    await expect(page.getByTestId('analysis-import')).toHaveAttribute('title', 'Sélectionnez au moins un produit');
  });

  test('review: "Annuler" puts the proposal back; PLAN_LIMIT on import is shown inline and the grid is kept', async ({ page }) => {
    const keys = await keysOf(page.request, shop.facebook2.id);
    const sac = keys['Sac à main cuir noir']!;
    await openAnalysis(page, shop.facebook2.id, (p) => p.getByTestId('analysis-grid'));
    await expect(page.getByTestId('analysis-item')).toHaveCount(3);
    await expect(page.getByTestId('analysis-selection')).toContainText('1 / 3 sélectionnés');
    await item(page, sac).getByLabel('NOM').fill('Autre nom');
    await item(page, sac).getByRole('checkbox').uncheck();
    await expect(page.getByTestId('analysis-selection')).toContainText('0 / 3 sélectionnés');
    await page.getByTestId('analysis-reset').click();
    await expect(item(page, sac).getByLabel('NOM')).toHaveValue('Sac à main cuir noir');
    await expect(page.getByTestId('analysis-selection')).toContainText('1 / 3 sélectionnés');

    // mock: refusing the whole import needs the 500 products of the trial plan — the first import is answered 403
    // PLAN_LIMIT once, the second one reaches the API
    let refused = 0;
    await page.route(importUrl(shop.facebook2.id), (route) => {
      if (route.request().method() !== 'POST' || refused++ > 0) return route.fallback();
      return fail(route, 403, 'PLAN_LIMIT', 'Limite du plan atteinte (500/500 produits).', { resource: 'products', limit: 500, current: 500 });
    });
    await item(page, sac).getByLabel('PRIX *').fill('7000');
    await page.getByTestId('analysis-import').click();
    await expect(page.getByTestId('channel-analysis').getByRole('alert').filter({ hasText: errText('PLAN_LIMIT') })).toHaveText('Limite du plan atteinte (500/500 produits).');
    await expect(page.getByTestId('analysis-import-result')).toHaveCount(0);
    await expect(item(page, sac)).toHaveAttribute('data-status', 'new');
    await expect(item(page, sac)).toHaveAttribute('data-selected', 'true');
    await expect(item(page, sac).getByLabel('PRIX *')).toHaveValue(/^7\s000$/);
    await expect(page.getByTestId('analysis-import')).toBeEnabled();
    // the same click goes through once the plan has room
    await page.getByTestId('analysis-import').click();
    await expect(page.getByTestId('analysis-import-result')).toHaveText('1 produit importé dans le catalogue', FIRST);
    await expect(page.getByTestId('channel-analysis').getByRole('alert').filter({ hasText: errText('PLAN_LIMIT') })).toHaveCount(0);
    const created = (await productsNamed(page.request, owner, 'Sac à main cuir noir')).filter((p) => p.name === 'Sac à main cuir noir');
    expect(created.map((p) => p.price)).toEqual([7000]);
  });

  test('a partial import marks the failed row with its code and offers to retry the rest', async ({ page }) => {
    const keys = await keysOf(page.request, shop.facebook2.id);
    const [sac, ensemble] = [keys['Sac à main cuir noir']!, keys['Ensemble sport gris']!];
    // mock: a per-item refusal needs the plan's 500-product limit — the first row reaches the API, the second one is
    // reported refused in the shape of the real answer (`failed[]` with the code as message)
    let createdSku = '';
    await page.route(importUrl(shop.facebook2.id), async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const sent = route.request().postDataJSON() as { items: unknown[] };
      const res = await route.fetch({ postData: JSON.stringify({ items: sent.items.slice(0, 1) }) });
      const json = (await res.json()) as { data: { created: { sku: string }[] } };
      createdSku = json.data.created[0]?.sku ?? '';
      await route.fulfill({ response: res, json: { ...json, data: { created: json.data.created, failed: [{ index: 1, code: 'PLAN_LIMIT', message: 'PLAN_LIMIT' }] } } });
    });
    await openAnalysis(page, shop.facebook2.id, (p) => p.getByTestId('analysis-grid'));
    await expect(page.getByTestId('analysis-item')).toHaveCount(3);
    await item(page, ensemble).getByRole('checkbox').check();
    await item(page, ensemble).getByLabel('PRIX *').fill('2900');
    await expect(page.getByTestId('analysis-import')).toHaveText('Importer 2 produits');
    await page.getByTestId('analysis-import').click();
    await expect(page.getByTestId('analysis-import-result')).toHaveText('1 importé(s) · 1 en échec Corrigez les lignes en rouge puis réessayez.', FIRST);
    expect(createdSku).toMatch(/^FB-\d{4}$/);
    await expect(item(page, sac)).toContainText(`IMPORTÉ · ${createdSku}`);
    await expect(item(page, ensemble).getByTestId('analysis-item-error')).toHaveText('Import impossible pour ce produit.');
    await expect(item(page, ensemble)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('analysis-import')).toHaveText('Réessayer le 1 restant');
  });

  test('rate limit: no run left today ⇒ rerun greyed with its reason; a 429 on POST ⇒ toast with the code', async ({ page }) => {
    // the 3 free runs of the day are spent for real (FAQ extractions share the counter)
    await spendDailyRuns(page.request, owner, vendeur.id, shop.facebook.id);
    expect((await analysisOf(page.request, owner, shop.facebook.id)).runsLeftToday).toBe(0);
    const posts = observe(page, 'POST', analysisUrl(shop.facebook.id));
    await openAnalysis(page, shop.facebook.id, (p) => p.getByTestId('analysis-summary'));
    const rerun = page.getByTestId('analysis-summary').getByTestId('analysis-run');
    await expect(rerun).toHaveText(rerunLabel(0));
    await expect(rerun).toBeDisabled();
    await expect(rerun).toHaveAttribute('title', /ANALYSIS_RATE_LIMITED/);
    expect(posts).toEqual([]);

    // mock (stale screen): the counter shown says 1 run left; the POST reaches the API, which refuses the 4th run
    await patchWhile(page, analysisUrl(shop.facebook.id), (d) => ({ ...d, runsLeftToday: 1 }));
    await openFresh(page, page.url(), () => rerun);
    await expect(rerun).toHaveText(rerunLabel(1));
    await rerun.click();
    await expect(toast(page, '3 analyses par jour max.')).toBeVisible();
    expect(posts).toHaveLength(1);
    await expect(rerun).toBeDisabled();
    await expect(rerun).toHaveAttribute('title', /ANALYSIS_RATE_LIMITED/);
    // the review of the last analysis stays usable
    await expect(page.getByTestId('channel-analysis')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('analysis-item')).toHaveCount(3);
  });
});

test.describe('Operator (no channels.manage)', () => {
  let operator: Account;
  test.beforeAll(async ({ request }) => {
    await refreshToken(request, owner);
    operator = await inviteOperator(request, owner);
  });

  test('AI tab is read-only: note instead of Changer / Détacher, icebreaker shown as text; analysis is reserved', async ({ page }) => {
    await reset(page.request);
    await realPut(page.request, owner, `/channels/${shop.facebook.id}/icebreaker`, { text: 'Salam ! Je peux vous aider ?' });
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith(API) && !['GET', 'OPTIONS'].includes(r.method()) && /\/channels\//.test(r.url())) writes.push(`${r.method()} ${r.url()}`);
    });
    await openAi(page, operator);
    const card = page.getByTestId('channel-ai');
    await expect(card.getByTestId('channel-ai-agent')).toContainText('Vendeur Pro');
    await expect(card.getByTestId('channel-ai-readonly')).toHaveText("Seuls les admins de l'espace changent l'agent d'une page.");
    await expect(card.getByTestId('channel-ai-actions')).toHaveCount(0);
    await expect(page.getByTestId('agent-change')).toHaveCount(0);
    await expect(page.getByTestId('agent-detach')).toHaveCount(0);
    await expect(page.getByTestId('agent-attach')).toHaveCount(0);
    const ice = page.getByTestId('channel-icebreaker');
    await expect(ice).toContainText('Salam ! Je peux vous aider ?');
    await expect(ice.getByRole('textbox')).toHaveCount(0);
    await expect(ice.getByTestId('icebreaker-save')).toHaveCount(0);

    await openFresh(page, `/fr/channels/${shop.facebook.id}/analysis`, () => page.getByTestId('analysis-forbidden'));
    await expect(page.getByTestId('analysis-forbidden')).toHaveText("L'analyse de la page est réservée aux admins de l'espace.");
    await expect(page.getByTestId('analysis-run')).toHaveCount(0);

    // the list offers neither the generation link nor the agent items
    const fb = page.locator(`[data-testid="channel-card"][data-channel="${shop.facebook.id}"]`);
    await openFresh(page, '/fr/channels', () => fb);
    await expect(fb.getByTestId('card-agent')).toContainText('Agent IA : Vendeur Pro');
    await expect(fb.getByTestId('card-generate')).toHaveCount(0);
    await expect(page.getByTestId('card-link-agent')).toHaveCount(0);
    await fb.getByRole('button', { name: 'Actions', exact: true }).click();
    await expect(page.getByRole('menu').getByRole('menuitem').first()).toBeVisible();
    await expect(page.getByRole('menu').locator('[data-action="changeAgent"]')).toHaveCount(0);
    await expect(page.getByRole('menu').locator('[data-action="analysis"]')).toHaveCount(0);
    expect(writes).toEqual([]);
  });
});
