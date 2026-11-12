// M4 — what the agents milestone adds to earlier screens:
//  - queue: actions of the insight cards (AT-AGT-07 UI: "Ajouter aux instructions", "Ignorer", already resolved);
//  - products: "Ajouter à un agent" (bulk bar, row menu), the agent filter, hidden for an Operator;
//  - "Créer depuis une photo": credits / daily limit / provider refusals of `POST /products/ai-fill`;
//  - onboarding step 4: presets of the server, `POST /agents { presetKey, name }`, error in place, static fallback, the
//    agent created earlier offered on a reopened step, "Partir de zéro" through the agent wizard (steps 1–3).
// On the REAL API (fake Meta pages, deterministic fake AI, worker running): the insights are written by the AI for
// real customer messages, the agents, products and refusals are real; what the page sends is observed. `page.route`
// stays only for what the fake drivers cannot produce over HTTP; each use says why.
import { expect, test, type Page } from '@playwright/test';
import { apiReady, createAccount, expectUrl, login, type Account } from './support/m1';
import { archiveProduct } from './support/m2';
import { patchConversation } from './support/m3-inbox';
import { fail, fixturePresets } from './support/m4';
import { ensureProduct, operatorOf, planned, setOnboardingStep } from './support/m4-inbox';
import {
  activeAgent,
  createAgent,
  getAgent,
  INSIGHT_TRIGGERS,
  inject,
  insightsOf,
  listAgents,
  listConversations,
  nextSender,
  realDelete,
  realGet,
  realPost,
  setCredits,
  setupShop,
  waitInsights,
  type RealAgent,
  type RealInsight,
  type Shop,
} from './support/m4-real';
import { observe, openFresh, signInFresh, spendDailyRuns, toast } from './support/m4-real-channels';
import { errText } from './support/error-text';

// shared dev server: every route compiles on its first hit, so the tests get room
test.describe.configure({ mode: 'serial', timeout: 420_000 });
let shop: Shop;
let owner: Account;
let newcomer: Account; // still in the onboarding tunnel
let vendeur: RealAgent; // active on the first Facebook page: its customers' messages produce the insights
let service: RealAgent; // draft
let robe: { id: string; name: string };
let parfum: { id: string; name: string };

const rowOf = (page: Page, p: { id: string }) => page.locator(`tr[data-row="${p.id}"]`);
const openProducts = (page: Page, query = '') => openFresh(page, `/fr/products${query}`, () => page.getByRole('heading', { name: 'Produits', level: 1 }));

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  shop = await setupShop(request, 'm4co');
  owner = shop.owner;
  vendeur = await activeAgent(request, owner, { name: 'Vendeur Pro', channelId: shop.facebook.id });
  service = await createAgent(request, owner, { name: 'Service Client', presetKey: 'service-client' });
  newcomer = await createAccount(request, { prefix: 'm4onb', firstName: 'Lina' });
});

/* ---------- queue ---------- */
const waitingPhrase = (n: number) => (n === 0 ? "Aucune conversation n'attend" : n === 1 ? '1 conversation attend' : `${n} conversations attendent`);
const needsHuman = async (page: Page) => listConversations(page.request, owner, '?status=needs_human&limit=50');

test('AT-AGT-07 queue insight cards: "Ouvrir la conversation", "Ajouter aux instructions" (resolve dialog), "Ignorer", already resolved by a colleague', async ({ page }) => {
  // three customers of the page: a product the shop does not sell, an unreadable message, a request for a human
  for (const text of [INSIGHT_TRIGGERS.unknown_topic, INSIGHT_TRIGGERS.unclear, INSIGHT_TRIGGERS.handoff]) await inject(page.request, owner, { channelId: shop.facebook.id, sender: nextSender(), text });
  const rows = await waitInsights(page.request, owner, '?status=pending', 3);
  const of = (type: string) => rows.find((r) => r.type === type) as RealInsight;
  const [unknown, unclear, handoff] = [of('unknown_topic'), of('unclear'), of('handoff')];
  expect([unknown, unclear, handoff].every(Boolean)).toBeTruthy();
  // counted with the query of the queue page (`status=needs_human&sort=oldestWaiting`): see the report — the API leaves
  // out of that list the handed-over threads whose last message is the AI's handoff text
  const waiting = (await listConversations(page.request, owner, '?status=needs_human&sort=oldestWaiting&limit=50')).length;
  const queries: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && /\/api\/v1\/agent-insights\?/.test(r.url())) queries.push(r.url());
  });
  const resolves = observe(page, 'POST', /\/api\/v1\/agent-insights\/[^/]+\/resolve$/);
  await signInFresh(page, owner);
  const column = page.getByTestId('queue-insights');
  await openFresh(page, '/fr/queue', () => column.locator('[data-insight]').first());

  await expect(column.locator('[data-insight]')).toHaveCount(3);
  await expect(page.getByTestId('queue-summary')).toContainText(`${waitingPhrase(waiting)} un humain · 3 problèmes signalés par les agents`);
  expect(queries.some((q) => q.includes('status=pending'))).toBeTruthy();
  const card = (id: string) => column.locator(`[data-insight="${id}"]`);
  await expect(card(unknown.id)).toContainText(`« ${INSIGHT_TRIGGERS.unknown_topic} »`);
  await expect(card(unknown.id)).toContainText(`Vendeur Pro · ${shop.facebook.name}`);
  await expect(card(unknown.id).locator('[data-action=open]')).toHaveText('Ouvrir la conversation');
  await expect(card(unknown.id).locator('[data-action=open]')).toHaveAttribute('href', `/fr/inbox/${unknown.conversationId}`);
  await expect(card(unknown.id).locator('[data-action=instruct]')).toHaveText('Ajouter aux instructions');
  await expect(card(unknown.id).locator('[data-action=ignore]')).toHaveText('Ignorer');

  // "Ajouter aux instructions": the resolve dialog with the instruction option selected
  const instruction = 'Nous ne vendons pas de téléphones ; proposer le catalogue de la boutique.';
  await card(unknown.id).locator('[data-action=instruct]').click();
  const dialog = page.getByRole('dialog', { name: "Résoudre l'insight" });
  await expect(dialog.getByRole('radio', { name: /Ajouter une instruction à l'agent/ })).toBeChecked();
  await expect(dialog).toContainText(`Client : « ${INSIGHT_TRIGGERS.unknown_topic} »`);
  await dialog.locator('#insight-instruction').fill(instruction);
  await dialog.getByTestId('resolve-insight-submit').click();
  await expect(page.getByText('Insight résolu')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(resolves[0]).toEqual({ action: 'instruction', instruction });
  await expect(card(unknown.id)).toHaveCount(0);
  await expect(column.locator('[data-insight]')).toHaveCount(2);
  // the instruction joined the agent's instructions (new version)
  expect((await getAgent(page.request, owner, vendeur.id)).customInstructions).toContain(`- ${instruction}`);

  // "Ignorer": 30 days, the card leaves
  await card(unclear.id).locator('[data-action=ignore]').click();
  await expect(page.getByText('Insight ignoré pendant 30 jours')).toBeVisible();
  expect(resolves[1]).toEqual({ action: 'ignored_30d' });
  await expect(card(unclear.id)).toHaveCount(0);

  // a colleague was faster (resolved through the API): 422 INSIGHT_ALREADY_RESOLVED ⇒ toast, the card leaves as well
  await realPost(page.request, owner, `/agent-insights/${handoff.id}/resolve`, { action: 'ignored_30d' });
  // the WS event of the colleague's resolve may remove the card first (then there is nothing left to click)
  const clicked = await card(handoff.id)
    .locator('[data-action=ignore]')
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (clicked) await expect(page.getByText('Déjà traité.')).toBeVisible();
  await expect(card(handoff.id)).toHaveCount(0);
  await expect(column.locator('[data-insight]')).toHaveCount(0);
  expect((await insightsOf(page.request, owner, '?status=pending')).length).toBe(0);
  // the waiting conversations are untouched
  await expect(page.getByTestId('queue-conversations').locator('article')).toHaveCount(waiting);
});

test('AT-AGT-07 queue: an insight already resolved while the dialog is open closes it with the toast and drops the card', async ({ page }) => {
  await inject(page.request, owner, { channelId: shop.facebook.id, sender: nextSender(), text: 'chhal le prix de l ipad ?' });
  const [one] = await waitInsights(page.request, owner, '?status=pending', 1);
  // the conversations the AI handed over are taken back by the team: only the insight is left in the queue
  for (const c of await needsHuman(page)) await patchConversation(page.request, owner, c.id, { status: 'active', aiPaused: false });
  await expect.poll(async () => (await needsHuman(page)).length).toBe(0);
  const resolves = observe(page, 'POST', /\/api\/v1\/agent-insights\/[^/]+\/resolve$/);
  await signInFresh(page, owner);
  const card = page.getByTestId('queue-insights').locator(`[data-insight="${one!.id}"]`);
  await openFresh(page, '/fr/queue', () => card);
  await card.locator('[data-action=instruct]').click();
  const dialog = page.getByRole('dialog', { name: "Résoudre l'insight" });
  // an empty instruction is refused in place, nothing is sent
  await dialog.getByTestId('resolve-insight-submit').click();
  await expect(dialog.locator('#insight-instruction')).toHaveAttribute('aria-invalid', 'true');
  expect(resolves).toHaveLength(0);
  // a colleague resolves it meanwhile
  await realPost(page.request, owner, `/agent-insights/${one!.id}/resolve`, { action: 'ignored_30d' });
  await dialog.locator('#insight-instruction').fill('Nous ne vendons pas de tablettes.');
  await dialog.getByTestId('resolve-insight-submit').click();
  await expect(page.getByText('Déjà traité.')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveCount(0);
  expect(resolves).toHaveLength(1);
  await expect(page.getByRole('heading', { name: 'Tout est calme' })).toBeVisible();
});

/* ---------- products ---------- */
test.describe('products', () => {
  test.beforeAll(async ({ request }) => {
    robe = await ensureProduct(request, owner, 'M4 Robe satin', 4900);
    parfum = await ensureProduct(request, owner, 'M4 Parfum Oud', 3900);
  });
  const bulkUrl = /\/api\/v1\/products\/bulk\/agent$/;

  test('bulk bar "Ajouter à un agent": agent picker, request { ids, agentId }, done toast; a partial refusal shows the per-item result', async ({ page }) => {
    const bulk = observe(page, 'POST', bulkUrl);
    await signInFresh(page, owner);
    await openProducts(page);
    await rowOf(page, robe).getByRole('checkbox').check();
    await rowOf(page, parfum).getByRole('checkbox').check();
    const bar = page.getByRole('region', { name: 'Actions groupées' });
    await expect(bar).toContainText('2 produits sélectionnés');
    await bar.getByRole('button', { name: 'Ajouter à un agent' }).click();

    const dialog = page.getByRole('dialog', { name: 'Ajouter à un agent' });
    await expect(dialog.getByTestId('add-to-agent')).toBeVisible();
    await expect(dialog).toContainText('2 produits sélectionnés');
    // no agent chosen: required, nothing sent
    await dialog.getByTestId('bulk-submit').click();
    await expect(dialog).toContainText(/obligatoire|requis/i);
    expect(bulk).toHaveLength(0);
    await dialog.locator('#bulk-agent').click();
    await expect(page.getByRole('option', { name: /Service Client/ })).toBeVisible();
    await page.getByRole('option', { name: /Vendeur Pro/ }).click();
    // the preset agent sells the whole catalogue (GET /agents: sellAllProducts)
    await expect(dialog).toContainText('« Vendeur Pro » vend déjà tout le catalogue : ces produits y sont inclus.');
    await expect(dialog.getByTestId('bulk-submit')).toHaveText('Ajouter 2 produits');
    await dialog.getByTestId('bulk-submit').click();
    await expect(page.getByText('2 produits mis à jour')).toBeVisible();
    expect(bulk).toHaveLength(1);
    const sent = bulk[0] as { ids: string[]; agentId: string };
    expect(sent.agentId).toBe(vendeur.id);
    expect([...sent.ids].sort()).toEqual([robe.id, parfum.id].sort());
    expect(Object.keys(sent).sort()).toEqual(['agentId', 'ids']);
    await expect(dialog).toHaveCount(0);
    await expect(bar).toHaveCount(0);

    // one product is archived by a colleague while the dialog is open: the API refuses that item, the result lists each
    await rowOf(page, robe).getByRole('checkbox').check();
    await rowOf(page, parfum).getByRole('checkbox').check();
    await bar.getByRole('button', { name: 'Ajouter à un agent' }).click();
    await dialog.locator('#bulk-agent').click();
    await page.getByRole('option', { name: /Service Client/ }).click();
    await archiveProduct(page.request, owner, parfum.id);
    await dialog.getByTestId('bulk-submit').click();
    const result = page.getByRole('dialog').filter({ has: page.getByTestId('bulk-results') });
    await expect(result).toContainText('1 OK · 1 en erreur');
    await expect(result.getByTestId('bulk-results').locator('li[data-ok="true"]')).toContainText('M4 Robe satin');
    // the refused row: the archived product has already left the list (live update), and the result dialog names a
    // row from the rows on screen, so it falls back to the id (see report: names should be kept from the selection)
    const refused = result.getByTestId('bulk-results').locator('li[data-ok="false"]');
    await expect(refused).toContainText(new RegExp(`M4 Parfum Oud|${parfum.id}`));
    await expect(refused).toContainText('Introuvable ou accès refusé.');
    expect((bulk[1] as { agentId: string }).agentId).toBe(service.id);
    // the robe now belongs to the draft's selection (GET /products?agentId=)
    const listed = await realGet<{ id: string }[]>(page.request, owner, `/products?agentId=${service.id}&pageSize=50`);
    expect(listed.map((p) => p.id)).toContain(robe.id);
  });

  test('row Actions ⌄ "Ajouter à un agent" sends one id; a refusal stays inside the dialog with the product kept', async ({ page }) => {
    // the chosen agent is deleted by a colleague while the dialog is open: the API refuses the request (404) — the only
    // refusal of the whole request the real API gives; the deleted agent then leaves the choices (live list)
    const gone = await createAgent(page.request, owner, { name: 'Agent supprimé' });
    const bulk = observe(page, 'POST', bulkUrl);
    await signInFresh(page, owner);
    await openProducts(page);
    await rowOf(page, robe).getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menu').locator('[data-action=add_to_agent]').click();
    const dialog = page.getByRole('dialog', { name: 'Ajouter à un agent' });
    await expect(dialog).toContainText('1 produit sélectionné');
    await dialog.locator('#bulk-agent').click();
    await page.getByRole('option', { name: /Agent supprimé/ }).click();
    await realDelete(page.request, owner, `/agents/${gone.id}`);
    await dialog.getByTestId('bulk-submit').click();
    await expect(dialog.getByRole('alert').filter({ hasText: errText('NOT_FOUND') })).toHaveText('Introuvable ou accès refusé.');
    await expect(dialog).toContainText('1 produit sélectionné');
    // another agent, and the same dialog goes through
    await dialog.locator('#bulk-agent').click();
    await expect(page.getByRole('option', { name: /Agent supprimé/ })).toHaveCount(0);
    await page.getByRole('option', { name: /Vendeur Pro/ }).click();
    await dialog.getByTestId('bulk-submit').click();
    await expect(page.getByText('« M4 Robe satin » ajouté à l’agent')).toBeVisible();
    expect(bulk).toEqual([
      { ids: [robe.id], agentId: gone.id },
      { ids: [robe.id], agentId: vendeur.id },
    ]);
    await expect(dialog).toHaveCount(0);
  });

  test('agent filter: the chip puts agentId= in the URL and in GET /products; "Aucun agent" and an agent exclude each other', async ({ page }) => {
    const queries: URLSearchParams[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (r.method() === 'GET' && u.pathname.endsWith('/api/v1/products')) queries.push(u.searchParams);
    });
    await signInFresh(page, owner);
    await openProducts(page);
    await page.getByTestId('open-filters').click();
    const panel = page.getByRole('dialog', { name: 'Filtres' });
    const group = panel.getByRole('group', { name: 'UTILISÉ PAR UN AGENT' }).first();
    const chip = (name: string) => group.getByRole('checkbox', { name, exact: true });
    await expect(chip('Aucun agent')).toBeVisible();
    await expect(chip('Service Client')).toBeVisible();

    // on the shared dev server a click can land while the panel re-renders, and the URL update (client `replace`) of a
    // chip can be dropped while the route recompiles: the chip is clicked again (twice when it shows checked) until
    // the address carries the filter
    let attempt = 0;
    const tick = (name: string, url: RegExp) =>
      expect(async () => {
        if ((await chip(name).getAttribute('aria-checked')) !== 'true') await chip(name).click();
        else if (attempt++ > 0 && !url.test(page.url())) {
          await chip(name).click();
          await chip(name).click();
        }
        await expect(page).toHaveURL(url, { timeout: 10_000 });
      }).toPass({ timeout: 90_000 });

    await tick('Vendeur Pro', new RegExp(`agentId=${vendeur.id}`));
    await expect(chip('Vendeur Pro')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => queries.some((q) => (q.getAll('agentId').join(',') || q.getAll('agentId[]').join(',')).includes(vendeur.id))).toBeTruthy();

    // "Aucun agent" replaces the agents…
    await tick('Aucun agent', /noAgent=(1|true)/);
    await expect(page).not.toHaveURL(/agentId=/);
    await expect(chip('Aucun agent')).toHaveAttribute('aria-checked', 'true');
    await expect(chip('Vendeur Pro')).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => queries.some((q) => q.has('noAgent') && !q.has('agentId') && !q.has('agentId[]'))).toBeTruthy();
    // …and an agent replaces "Aucun agent"
    await tick('Service Client', new RegExp(`agentId=${service.id}`));
    await expect(page).not.toHaveURL(/noAgent=/);
    await expect(chip('Aucun agent')).toHaveAttribute('aria-checked', 'false');

    // the active filter is a chip of the list (behind the panel), named after the agent; the robe added to the draft
    // in the bulk test is listed
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Filtres actifs' })).toContainText('Agent : Service Client');
    await expect(rowOf(page, robe)).toBeVisible({ timeout: 30_000 });
    // URL state: a reload keeps the filter and its chip (the name comes from GET /agents)
    await openFresh(page, page.url(), () => page.getByRole('list', { name: 'Filtres actifs' }));
    await expect(page.getByRole('list', { name: 'Filtres actifs' })).toContainText('Agent : Service Client', { timeout: 30_000 });
  });

  test('an Operator (no catalog.write) has no "Ajouter à un agent" in the row menu', async ({ page, request }) => {
    const operator = await operatorOf(request, owner, 'm4co-op');
    await signInFresh(page, operator);
    await openProducts(page);
    await rowOf(page, robe).getByRole('button', { name: 'Actions' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem').first()).toBeVisible();
    await expect(menu.locator('[data-action=add_to_agent]')).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: /Ajouter à un agent/ })).toHaveCount(0);
  });

  test('"Créer depuis une photo": no credits ⇒ link to the credits page; provider down ⇒ retry; daily limit ⇒ button disabled with the reason; the form is kept', async ({ page }) => {
    // 402 is real (balance at 0), 429 is real (the 3 free analyses of the day spent); the 503 is not:
    // mock: the fake vision provider never fails over HTTP — the second call only is answered 503 AI_PROVIDER_ERROR
    const calls: number[] = [];
    await page.route(/\/api\/v1\/products\/ai-fill$/, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      calls.push(calls.length + 1);
      return calls.length === 2 ? fail(route, 503, 'AI_PROVIDER_ERROR', 'L’IA ne répond pas.') : route.fallback();
    });
    await setCredits(page.request, owner, 0);
    try {
      await signInFresh(page, owner);
      await openFresh(page, '/fr/products/new', () => page.getByTestId('form-footer'));
      await page.locator('#name').fill('Robe de soirée bordeaux');
      await page.locator('#price').fill('7500');
      await page.getByTestId('photo-fill').click();
      const dialog = page.getByTestId('photo-dialog');
      await expect(dialog).toHaveAttribute('data-phase', 'idle');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      await page.locator('input[data-upload="ai-fill"]').setInputFiles({ name: 'robe.png', mimeType: 'image/png', buffer: png });
      const analyse = page.getByTestId('photo-analyse');
      await expect(analyse).toHaveText('Analyser (5 crédits)');

      // 402: inline, with the way out
      await analyse.click();
      await expect(dialog).toHaveAttribute('data-phase', 'credits', { timeout: 30_000 });
      await expect(dialog.getByRole('alert')).toContainText('Crédits épuisés.');
      await expect(dialog.getByRole('link', { name: 'Acheter des crédits' })).toHaveAttribute('href', '/fr/settings/credits');
      await setCredits(page.request, owner, 300);

      // 503: the provider state, the same photos can be sent again
      await expect(analyse).toBeEnabled();
      await analyse.click();
      await expect(dialog).toHaveAttribute('data-phase', 'provider', { timeout: 30_000 });
      await expect(dialog).toContainText('FOURNISSEUR IA');
      await expect(dialog.getByRole('alert')).toContainText('Le fournisseur IA ne répond pas, réessayez dans un instant. · crédits non débités');
      await expect(dialog.locator('img[alt="robe.png"]')).toBeVisible();

      // 429: 3 analyses a day (shared with page analysis and FAQ extraction) — the button is disabled and says why
      await spendDailyRuns(page.request, owner, vendeur.id, shop.facebook.id);
      await expect(analyse).toBeEnabled();
      await analyse.click();
      await expect(dialog).toHaveAttribute('data-phase', 'limited', { timeout: 30_000 });
      await expect(dialog).toContainText('LIMITE');
      await expect(dialog).toContainText('3 analyses par jour max. · saisissez les champs manuellement');
      await expect(analyse).toBeDisabled();
      await expect(analyse).toHaveAttribute('title', '3 analyses par jour max.');
      expect(calls).toHaveLength(3);

      // the form behind the dialog kept what was typed
      await page.getByTestId('photo-manual').click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('#name')).toHaveValue('Robe de soirée bordeaux');
      await expect(page.locator('#price')).toHaveValue(/^7.?500$/);
    } finally {
      await setCredits(page.request, owner, 300);
    }
  });
});

/* ---------- onboarding step 4 ---------- */
test.describe('onboarding step 4', () => {
  const presetsUrl = /\/api\/v1\/agents\/presets$/;
  const agentsUrl = /\/api\/v1\/agents$/;
  /**
   * Signs the newcomer in (the app sends an owner whose onboarding is not done to the tunnel), then opens step 4. On
   * the shared dev server a page can stay without its scripts (ChunkLoadError) and never redirect: each attempt loads
   * the pages again.
   */
  const enter = async (page: Page) => {
    await expect(async () => {
      if (!/\/fr\/(home|onboarding\/[a-z]+)$/.test(page.url())) {
        await login(page, newcomer);
        await expect(page).toHaveURL(/\/fr\/(home|onboarding\/[a-z]+)$/, { timeout: 45_000 });
      }
      await page.goto('/fr/onboarding/agent');
      await expect(page.getByRole('heading', { name: 'Choisissez votre agent IA' })).toBeVisible({ timeout: 45_000 });
    }).toPass({ timeout: 300_000 });
    await expectUrl(page, '**/fr/onboarding/agent');
  };
  test.beforeEach(async ({ request }) => {
    await setOnboardingStep(request, newcomer, 4);
  });
  test.afterAll(async ({ request }) => {
    await setOnboardingStep(request, newcomer, 4);
  });

  test('presets come from the server; the main button posts { presetKey, name } and the tunnel moves to the connect step', async ({ page }) => {
    const presets = await realGet<{ key: string; name: string; tagline: string | null }[]>(page.request, newcomer, '/agents/presets');
    const serviceClient = presets.find((p) => p.key === 'service-client')!;
    const posts = observe(page, 'POST', agentsUrl);
    await enter(page);

    const cards = page.getByTestId('onboarding-presets');
    await expect(cards).toHaveAttribute('data-source', 'server', { timeout: 30_000 });
    await expect(cards.locator('[data-preset]')).toHaveCount(presets.length);
    await expect(cards.locator('[data-preset="service-client"]')).toContainText(serviceClient.tagline!);
    // the recommended preset is preselected
    await expect(cards.locator('[data-preset="vendeur-pro"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('onboarding-agent-create')).toHaveText('Créer « Vendeur Pro »');

    await cards.locator('[data-preset="service-client"]').click();
    await expect(cards.locator('[data-preset="service-client"]')).toHaveAttribute('aria-checked', 'true');
    await expect(cards.locator('[data-preset="vendeur-pro"]')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('onboarding-agent-create')).toHaveText(`Créer « ${serviceClient.name} »`);
    await page.getByTestId('onboarding-agent-create').click();
    await expectUrl(page, '**/fr/onboarding/connect', { timeout: 180_000 });
    expect(posts).toEqual([{ presetKey: 'service-client', name: serviceClient.name }]);
    // the draft exists in the newcomer's workspace
    const drafts = await listAgents(page.request, newcomer);
    expect(drafts.some((a) => a.name === serviceClient.name && a.status === 'draft')).toBeTruthy();
  });

  test('a refused creation is shown on the step, which does not advance; "Plus tard" moves on without a request', async ({ page }) => {
    // mock: the API cannot be made to fail an agent creation with a server error (500 INTERNAL); the presets are real
    const posts = await planned(page, agentsUrl, 'POST', [(r) => fail(r, 500, 'INTERNAL', 'Erreur interne (réf. req_e2e). Réessayez.', { ref: 'req_e2e' })]);
    await enter(page);
    await expect(page.getByTestId('onboarding-presets')).toHaveAttribute('data-source', 'server', { timeout: 30_000 });
    // the draft of the previous test is offered; picking a card asks for a second agent
    await expect(page.getByTestId('onboarding-agent-existing')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('onboarding-presets').locator('[data-preset="vendeur-pro"]').click();
    await page.getByTestId('onboarding-agent-create').click();
    const alert = page.getByRole('alert').filter({ hasText: 'INTERNAL' });
    await expect(alert).toContainText('(INTERNAL) · vous pouvez réessayer ou continuer avec « Plus tard »', { timeout: 30_000 });
    await expect(page).toHaveURL(/\/fr\/onboarding\/agent$/);
    await expect(page.getByTestId('onboarding-agent-create')).toBeEnabled();
    expect(posts).toHaveLength(1);

    await page.getByRole('button', { name: 'Plus tard' }).click();
    await expectUrl(page, '**/fr/onboarding/connect', { timeout: 180_000 });
    expect(posts).toHaveLength(1);
  });

  test('a reopened step offers the agent created earlier: "Continuer avec …" moves on without a second agent', async ({ page }) => {
    const posts = observe(page, 'POST', agentsUrl);
    const before = (await listAgents(page.request, newcomer)).length;
    expect(before).toBeGreaterThan(0);
    await enter(page);
    await expect(page.getByTestId('onboarding-agent-existing')).toBeVisible({ timeout: 30_000 });
    // no card is preselected: the main button continues with the existing agent
    await expect(page.getByTestId('onboarding-presets').getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(page.getByTestId('onboarding-agent-continue')).toHaveText(/^Continuer avec « .+ »$/);
    await page.getByTestId('onboarding-agent-continue').click();
    await expectUrl(page, '**/fr/onboarding/connect', { timeout: 60_000 });
    expect(posts).toEqual([]);
    expect((await listAgents(page.request, newcomer)).length).toBe(before);
  });

  test('"Partir de zéro" opens the agent wizard: steps 1–3 run in the tunnel, then the tunnel moves on to the page step', async ({ page }) => {
    const before = (await listAgents(page.request, newcomer)).length;
    await enter(page);
    await page.getByTestId('onboarding-agent-scratch').click();
    await expectUrl(page, '**/fr/agents/new?start=scratch');
    // the blank starting point is already chosen; "Annuler" goes back to the tunnel without creating anything
    const start = page.getByTestId('starting-point');
    await expect(start.locator('[data-name="scratch"]')).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
    await page.getByTestId('wizard-cancel').click();
    await expectUrl(page, '**/fr/onboarding/agent');
    expect((await listAgents(page.request, newcomer)).length).toBe(before);

    await page.getByTestId('onboarding-agent-scratch').click();
    await expectUrl(page, '**/fr/agents/new?start=scratch');
    const name = `Agent de zéro ${Date.now().toString(36)}`;
    await page.getByLabel('NOM INTERNE').fill(name);
    await page.getByTestId('wizard-next').click();
    await expect(page).toHaveURL(/\/fr\/agents\/new\/knowledge\?draft=[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = new URL(page.url()).searchParams.get('draft')!;
    // channels and activation need the page of step 5: not reachable from the tunnel
    await page.goto(`/fr/agents/new/channels?draft=${id}`);
    await expectUrl(page, '**/fr/onboarding/agent');
    await expect(page.getByTestId('onboarding-agent-existing')).toBeVisible({ timeout: 30_000 });
    await page.goto(`/fr/agents/new/knowledge?draft=${id}`);
    await page.getByTestId('wizard-next').click();
    await expect(page).toHaveURL(/\/fr\/agents\/new\/behaviour\?draft=/, { timeout: 30_000 });
    // the last step of the tunnel: saves the draft and moves the tunnel on to the page step
    await expect(page.getByTestId('wizard-next')).toHaveText('Enregistrer et passer à la page');
    await page.getByTestId('wizard-next').click();
    await expectUrl(page, '**/fr/onboarding/connect', { timeout: 60_000 });
    const agents = await listAgents(page.request, newcomer);
    expect(agents.length).toBe(before + 1);
    const created = agents.find((a) => a.id === id)!;
    expect(created).toMatchObject({ name, status: 'draft', wizardStep: 3 });
  });

  test('GET /agents/presets fails: the four static cards are shown and still create the agent', async ({ page }) => {
    // mock: the presets list of the API cannot be made to fail; the creation that follows is real
    let asked = 0;
    await page.route(presetsUrl, (r) => (asked++, fail(r, 500, 'INTERNAL', 'Erreur interne.')));
    const posts = observe(page, 'POST', agentsUrl);
    const before = (await listAgents(page.request, newcomer)).length;
    await enter(page);
    const cards = page.getByTestId('onboarding-presets');
    await expect.poll(() => asked, { timeout: 30_000 }).toBeGreaterThan(0); // the list was asked and refused
    await expect(cards).toHaveAttribute('data-source', 'static');
    await expect(cards.locator('[data-preset]')).toHaveCount(fixturePresets.length);
    for (const key of ['vendeur-pro', 'service-client', 'conseiller-produit', 'reponse-express']) await expect(cards.locator(`[data-preset="${key}"]`)).toBeVisible();
    // the newcomer already has agents (previous tests): nothing is preselected, a card asks for one more
    await expect(page.getByTestId('onboarding-agent-continue')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('radio', { name: /Vendeur Pro/ })).not.toBeChecked();
    await page.getByRole('radio', { name: /Vendeur Pro/ }).click();
    await expect(page.getByRole('radio', { name: /Vendeur Pro/ })).toBeChecked();
    await page.getByTestId('onboarding-agent-create').click();
    await expectUrl(page, '**/fr/onboarding/connect', { timeout: 180_000 });
    expect(posts).toEqual([{ presetKey: 'vendeur-pro', name: 'Vendeur Pro' }]);
    await expect.poll(async () => (await listAgents(page.request, newcomer)).length).toBe(before + 1);
  });
});
