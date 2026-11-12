// M4 — agents list (UI side of AT-AGT-01, AT-AGT-07). Frames: "AGT-01 — Agents — list (active, paused, insights)",
// "MECH — Agents filters + row menu", "DLG — Agents & channels" (Supprimer l'agent, Mettre en pause, Lien de test,
// limite du plan, Résoudre l'insight). States: 12-screen-states §9.
// Everything runs on the REAL API (fake AI + fake Meta, worker running): one shop per file with its agents (active with
// two pages, paused without page, paused with a page, draft at step 2) and four insights written by the fake AI from
// real customer messages. Tests that change the world create their own agents and remove them. `page.route` is used
// only where the API cannot produce the state; each use says why (`// mock:`).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { agentCard, expectRoute, NAV, openPage, signIn, toastOf } from './support/m4-agents';
import { activateAgent, createAgent, customerSays, insightsOf, linkPage, listAgents, nextSender, realPost, setupShop, type Shop } from './support/m4-real';
import { agentByName, agentRow, agentsWorld, dropAgents, patchAgentsList, pausedAgent, rawCall, recordWrites, seedInsight, type AgentRow, type AgentsWorld, type InsightRow } from './support/m4-real-agents';
import { errText } from './support/error-text';

// one shared `next dev` server: first hits compile, so every test gets room for a repeated navigation
test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 1000 } });
// (the file-level configure above does not reach the nested describes: the timeout is set per test as well)
test.beforeEach(() => test.setTimeout(240_000));

let shop: Shop;
let owner: Account;
let w: AgentsWorld;
let ins: Record<'unknown_topic' | 'unclear' | 'handoff' | 'error', InsightRow>;

test.beforeAll(async ({ request }) => {
  test.setTimeout(420_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  shop = await setupShop(request, 'agtlist');
  owner = shop.owner;
  w = await agentsWorld(request, shop);
  // four pending insights of "Vendeur Pro", one of each type, from real customer messages on its page
  const fb = shop.facebook.id;
  const [unknown, unclear, handoff] = await Promise.all([
    seedInsight(request, owner, fb, 'unknown_topic', 'chhal le prix de l iphone ?'),
    seedInsight(request, owner, fb, 'unclear', '??'),
    seedInsight(request, owner, fb, 'handoff', 'je veux parler à un humain'),
  ]);
  // `error`: the AI reply names "Foulard soie" and "foulard" is a blocked word for the time of the turn
  const error = await seedInsight(request, owner, fb, 'error', 'chhal le prix du foulard soie ?', 'foulard');
  ins = { unknown_topic: unknown, unclear, handoff, error };
});

/** Signs in and opens `/agents` (the route compiles on its first hit). */
async function openList(page: Page, query = '') {
  await signIn(page, owner);
  await openPage(page, `/fr/agents${query}`, () => page.getByRole('heading', { name: 'Agents IA', level: 1 }));
}
/** A reload / direct visit of the list (the shared dev server can leave a navigation on its loader: it is repeated). */
const reopen = (page: Page, url: string, ready: () => ReturnType<Page['locator']>) => openPage(page, url, ready);
const openMenu = async (page: Page, id: string) => {
  await agentCard(page, id).getByRole('button', { name: 'Actions' }).click();
  return page.getByRole('menu');
};
// The "paused by the plan" card (`pausedReason: 'plan'`, "Reprendre" refused PLAN_LIMIT) is produced by a real plan
// expiry since M9: see m9-carryovers.spec.ts. Here "Conseiller Produit" is paused manually.

test.describe('list — states, summary, plan limit', () => {
  test('AT-AGT-01 the four card states with their pills, summary line, no-channel strip, insights badge, axe', async ({ page, request }) => {
    const vendeurNow = await agentRow(request, owner, w.vendeur.id);
    await openList(page);
    await expect(page.getByTestId('agent-card')).toHaveCount(4, { timeout: 30_000 });
    await expect(page.getByTestId('agents-count')).toHaveText('4');

    const pills: [string, string, string][] = [
      [w.vendeur.id, 'active', 'ACTIF'],
      [w.service.id, 'paused', 'EN PAUSE'],
      [w.conseiller.id, 'paused', 'EN PAUSE'],
      [w.draft.id, 'draft', 'BROUILLON'],
    ];
    for (const [id, state, label] of pills) {
      await expect(agentCard(page, id)).toHaveAttribute('data-state', state);
      await expect(agentCard(page, id).getByTestId('agent-status')).toHaveText(label);
    }
    // "n / m agents (plan …)" next to the subtitle: active + paused count, drafts never (Pro trial: 5 agents)
    await expect(page.getByTestId('agents-summary')).toContainText('Créez et gérez des agents IA qui vendent vos produits sur les pages connectées');
    await expect(page.getByTestId('agents-summary')).toContainText(/3 \/ 5 agents \(plan .*\)/);
    await expect(page.getByTestId('agents-plan-line')).toContainText(/Il vous reste 2 agents sur votre plan/);
    await expect(page.getByTestId('agents-plan-line')).not.toHaveAttribute('data-at-limit', /.+/);
    // "+ Nouvel agent" is always there; below the limit it is a link to the wizard
    await expect(page.getByTestId('new-agent')).toHaveText('+ Nouvel agent');
    await expect(page.getByTestId('new-agent')).toHaveAttribute('href', '/fr/agents/new');

    // active agent: live indicator, its two pages, the model the platform routing chose, pending insights badge
    const vendeur = agentCard(page, w.vendeur.id);
    await expect(vendeur).toContainText('IA ACTIVE');
    await expect(vendeur).toContainText('AMICAL');
    expect(vendeurNow.model?.label).toBeTruthy();
    await expect(vendeur.getByTestId('model-badge')).toHaveText(vendeurNow.model!.label);
    expect(vendeurNow.pendingInsights).toBeGreaterThanOrEqual(4);
    await expect(vendeur.getByTestId('agent-insights-badge')).toHaveText(`${vendeurNow.pendingInsights} insights`);
    await expect(vendeur.getByTestId('agent-insights-badge')).toHaveAttribute('href', `/fr/agents/${w.vendeur.id}/insights`);
    await expect(vendeur.getByRole('listitem').filter({ hasText: shop.facebook.name })).toBeVisible();
    await expect(vendeur.getByRole('listitem').filter({ hasText: shop.instagram.name })).toBeVisible();
    await expect(vendeur.getByTestId('agent-no-channel')).toHaveCount(0);

    // agent without any page: "AUCUNE PAGE LIÉE" strip with the code
    const strip = agentCard(page, w.service.id).getByTestId('agent-no-channel');
    await expect(strip).toContainText('AUCUNE PAGE LIÉE');
    await expect(strip).toContainText("Rattachez au moins une page avant d'activer.");
    await expect(strip).toContainText(errText('AGENT_NO_CHANNEL'));
    await expect(strip.getByRole('link', { name: 'Rattacher une page' })).toHaveAttribute('href', `/fr/agents/${w.service.id}/configuration?section=channels`);
    await expect(agentCard(page, w.service.id)).toContainText('IA SILENCIEUSE');

    // paused by the plan (its own strip, no "Actif" switch): real plan expiry in m9-carryovers.spec.ts

    // draft saved at step 2: where it stopped and how to resume it; neither switch nor "Tester"
    const draft = agentCard(page, w.draft.id);
    await expect(draft).toContainText('Brouillon · étape 3 / 5 · Comportement');
    await expect(draft.getByTestId('agent-resume-draft')).toHaveText('Reprendre le brouillon');
    await expect(draft.getByTestId('agent-resume-draft')).toHaveAttribute('href', `/fr/agents/new/behaviour?draft=${w.draft.id}`);
    await expect(draft.getByRole('switch')).toHaveCount(0);
    await expect(draft.getByRole('link', { name: 'Tester', exact: true })).toHaveCount(0);
    await expect(draft.getByTestId('agent-no-channel')).toHaveCount(0);

    await expectNoA11yViolations(page);
  });

  test('AT-AGT-01 at the plan limit: the plan line shows it and "+ Nouvel agent" opens the plan dialog, a draft stays possible', async ({ page, request }) => {
    // two more active agents (5 / 5): each borrows the second page for its activation, the page then goes back
    const extra: string[] = [];
    try {
      for (const name of ['Agent limite A', 'Agent limite B']) {
        const d = await createAgent(request, owner, { name });
        extra.push(d.id);
        await linkPage(request, owner, shop.facebook2.id, d.id);
        await activateAgent(request, owner, d.id);
      }
      await linkPage(request, owner, shop.facebook2.id, w.conseiller.id);
      // the server refuses a sixth activation: the state the page shows is the real one
      const sixth = await createAgent(request, owner, { name: 'Agent limite C' });
      extra.push(sixth.id);
      await linkPage(request, owner, shop.facebook2.id, sixth.id);
      const refused = await rawCall(request, owner, 'POST', `/agents/${sixth.id}/activate`, {});
      expect(refused.status).toBe(403);
      expect(refused.body.error).toMatchObject({ code: 'PLAN_LIMIT', params: { resource: 'agents', limit: 5, current: 5 } });
      await linkPage(request, owner, shop.facebook2.id, w.conseiller.id);

      await openList(page);
      await expect(page.getByTestId('agent-card')).toHaveCount(7, { timeout: 30_000 });
      await expect(page.getByTestId('agents-summary')).toContainText(/5 \/ 5 agents \(plan .*\)/);
      const line = page.getByTestId('agents-plan-line');
      await expect(line).toHaveAttribute('data-at-limit', 'true');
      await expect(line).toContainText(/Limite atteinte : 5 \/ 5 agents sur votre plan/);
      await expect(line).toContainText("Les brouillons ne comptent pas ; l'activation est bloquée.");

      await expect(page.getByTestId('new-agent')).toBeVisible();
      await page.getByTestId('new-agent').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: "Limite d'agents atteinte" })).toBeVisible();
      await expect(dialog).toContainText('5 / 5 agents actifs ou en pause');
      await expect(dialog.getByTestId('agents-limit-dialog')).toContainText("Votre plan ne permet pas d'activer un agent de plus.");
      await expect(dialog.getByTestId('agents-limit-dialog')).toContainText(errText('PLAN_LIMIT'));
      await expect(dialog.getByTestId('limit-create-draft')).toHaveText('Créer un brouillon');
      await dialog.getByTestId('limit-create-draft').click();
      await expectRoute(page, '**/fr/agents/new');
      await expect(page.getByRole('heading', { name: "Identité de l'agent", level: 1 })).toBeVisible(NAV);
    } finally {
      await dropAgents(request, owner, extra);
      await linkPage(request, owner, shop.facebook2.id, w.conseiller.id);
    }
  });

  test('empty state: no agent yet, with its CTA to the wizard', async ({ page, request }) => {
    // a second workspace, without any agent
    const empty = (await setupShop(request, 'agtempty', { pages: false, products: false })).owner;
    await signIn(page, empty);
    await openPage(page, '/fr/agents', () => page.getByRole('heading', { name: "Aucun agent pour l'instant" }));
    await expect(page.getByText("Partez d'un modèle (Vendeur Pro, Service Client, Conseiller Produit, Réponse Express) ou de zéro", { exact: false })).toBeVisible();
    await expect(page.getByTestId('agent-card')).toHaveCount(0);
    await expect(page.getByTestId('agents-plan-line')).toHaveCount(0);
    await expect(page.getByTestId('agents-select-toggle')).toHaveCount(0);
    await expect(page.getByTestId('agents-pending-insights')).toContainText("Aucun problème signalé : vos agents s'en sortent bien.");
    const list = page.getByRole('region', { name: 'VOS AGENTS' });
    await expect(list.getByRole('link', { name: 'Générer depuis une page' })).toHaveAttribute('href', '/fr/agents/generate');
    await list.getByRole('link', { name: '+ Nouvel agent' }).click();
    await expectRoute(page, '**/fr/agents/new');
  });

  test('error state: the list cannot be loaded, "Réessayer" loads it', async ({ page }) => {
    // mock: the real API has no way to make `GET /agents` fail on demand (5xx state of the list)
    const failing = /\/api\/v1\/agents(\?.*)?$/;
    await page.route(failing, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': 'http://localhost:3010', 'access-control-allow-credentials': 'true' },
        body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Erreur interne', params: {}, fields: {}, details: null, ref: 'req_e2e' } }),
      });
    });
    await openList(page);
    const list = page.getByRole('region', { name: 'VOS AGENTS' });
    // 5xx answers are retried twice before the state is shown
    await expect(list.getByRole('heading', { name: 'Impossible de charger' })).toBeVisible({ timeout: 30_000 });
    await expect(list).toContainText('Une erreur est survenue (ref. req_e2e).');
    await expect(page.getByTestId('agent-card')).toHaveCount(0);
    await page.unroute(failing);
    await list.getByRole('button', { name: 'Réessayer' }).click();
    await expect(page.getByTestId('agent-card')).toHaveCount(4, { timeout: 15_000 });
  });
});

test.describe('filters and search in the URL', () => {
  test('status chips → ?status=active,paused, active chips, "Effacer tout", reload keeps the view', async ({ page }) => {
    await openList(page);
    await expect(page.getByTestId('agent-card')).toHaveCount(4, { timeout: 30_000 });

    await page.getByTestId('agents-filters').getByRole('button', { name: 'Statut' }).click();
    const chips = page.getByRole('group', { name: 'Statut' });
    await chips.getByRole('checkbox', { name: 'Actifs' }).click();
    await expect(page).toHaveURL(/[?&]status=active(&|$)/, NAV);
    await expect(page.getByTestId('agent-card')).toHaveCount(1);
    await expect(agentCard(page, w.vendeur.id)).toBeVisible();
    await chips.getByRole('checkbox', { name: 'En pause' }).click();
    await expect(page).toHaveURL(/[?&]status=active(,|%2C)paused(&|$)/, NAV);
    await expect(chips.getByRole('checkbox', { name: 'Actifs' })).toHaveAttribute('aria-checked', 'true');
    await expect(chips.getByRole('checkbox', { name: 'Brouillons' })).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('agent-card')).toHaveCount(3);
    await expect(agentCard(page, w.draft.id)).toHaveCount(0);
    await expect(page.getByTestId('agents-count')).toHaveText('3');
    const active = page.getByRole('list', { name: 'Filtres' });
    await expect(active.getByRole('listitem').first()).toHaveText('Statut : Actifs, En pause');
    await expect(page.getByTestId('agents-filters').getByRole('button', { name: 'Statut' })).toContainText('2');

    // the view is in the URL: a reload restores it
    await reopen(page, page.url(), () => page.getByTestId('agent-card').first());
    await expect(page.getByTestId('agent-card')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByRole('list', { name: 'Filtres' }).getByRole('listitem').first()).toHaveText('Statut : Actifs, En pause');
    await expect(page).toHaveURL(/[?&]status=active(,|%2C)paused(&|$)/, NAV);

    // one chip removed by its ×, then everything
    await page.getByRole('list', { name: 'Filtres' }).getByRole('button', { name: 'Retirer le filtre Statut : Actifs, En pause' }).click();
    await expect(page).not.toHaveURL(/status=/, NAV);
    await expect(page.getByTestId('agent-card')).toHaveCount(4);
    await expect(page.getByRole('list', { name: 'Filtres' })).toHaveCount(0);

    await reopen(page, '/fr/agents?status=draft', () => page.getByTestId('agent-card').first());
    await expect(page.getByTestId('agent-card')).toHaveCount(1, { timeout: 30_000 });
    await expect(agentCard(page, w.draft.id)).toBeVisible();
    await page.getByRole('list', { name: 'Filtres' }).getByRole('button', { name: 'Effacer tout' }).click();
    await expect(page).not.toHaveURL(/status=/, NAV);
    await expect(page.getByTestId('agent-card')).toHaveCount(4);
  });

  test('search → ?q=, filtered-empty state with "Effacer les filtres", reload keeps the search', async ({ page }) => {
    await openList(page);
    await expect(page.getByTestId('agent-card')).toHaveCount(4, { timeout: 30_000 });
    const search = page.getByRole('searchbox', { name: 'Rechercher' });
    await expect(search).toHaveAttribute('placeholder', 'Nom ou description…');

    await search.fill('service');
    await expect(page).toHaveURL(/[?&]q=service(&|$)/, NAV);
    await expect(page.getByTestId('agent-card')).toHaveCount(1);
    await expect(agentCard(page, w.service.id)).toBeVisible();
    await reopen(page, page.url(), () => page.getByTestId('agent-card').first());
    await expect(page.getByRole('searchbox', { name: 'Rechercher' })).toHaveValue('service', { timeout: 30_000 });
    await expect(page.getByTestId('agent-card')).toHaveCount(1);

    // search + status that matches nothing ⇒ filtered-empty (not the "no agent yet" state)
    const list = page.getByRole('region', { name: 'VOS AGENTS' });
    await reopen(page, '/fr/agents?q=introuvable&status=active', () => list.getByRole('heading', { name: 'Aucun résultat' }));
    await expect(list).toContainText('Aucun(e) agent ne correspond à « introuvable · Statut : Actifs ».');
    await expect(page.getByRole('heading', { name: "Aucun agent pour l'instant" })).toHaveCount(0);
    await list.getByRole('button', { name: 'Effacer les filtres' }).click();
    await expect(page).not.toHaveURL(/[?&](q|status)=/, NAV);
    await expect(page.getByTestId('agent-card')).toHaveCount(4);
    await expect(page.getByRole('searchbox', { name: 'Rechercher' })).toHaveValue('');
  });
});

test.describe('row actions', () => {
  test('Actions ⌄ of an active agent: items, "Supprimer" greyed with its reason and code, direct "Tester", the switch opens the pause dialog', async ({ page, request }) => {
    const pending = (await agentRow(request, owner, w.vendeur.id)).pendingInsights;
    // mock: the API sends `delete` enabled for an agent with pages (agent.service.ts `actions()`), and its single
    // DELETE unlinks the pages instead of refusing — 04 §240 / 11 AGENT_HAS_CHANNELS want it greyed (reported as API bug)
    await patchAgentsList(page, (a) => (a.channels.length ? { ...a, actions: a.actions.map((d) => (d.key === 'delete' ? { key: 'delete', enabled: false, reasonCode: 'AGENT_HAS_CHANNELS' } : d)) } : a));
    const writes = recordWrites(page, /^\/api\/v1\/agents/);
    await openList(page);
    const vendeur = agentCard(page, w.vendeur.id);
    await expect(vendeur).toBeVisible({ timeout: 30_000 });

    const menu = await openMenu(page, w.vendeur.id);
    await expect(menu).toContainText('Vendeur Pro · ACTIF');
    const items = ['Modifier (assistant 5 étapes)', "Ouvrir la fiche de l'agent", 'Tester dans le bac à essai', 'Mettre en pause', 'Dupliquer', `Voir les insights (${pending})`, 'Exporter la configuration (JSON)', 'Partager un lien de test (24 h)', 'Supprimer'];
    for (const name of items) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
    // an active agent is paused, not resumed or activated
    await expect(menu.getByRole('menuitem', { name: 'Reprendre', exact: true })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Tester et activer', exact: true })).toHaveCount(0);
    // the primary action comes first
    await expect(menu.getByRole('menuitem').first()).toHaveText('Modifier (assistant 5 étapes)');
    // forbidden by the server descriptor: visible, greyed, reason + code in the footer
    await expect(menu.getByRole('menuitem', { name: 'Supprimer', exact: true })).toHaveAttribute('aria-disabled', 'true');
    await expect(menu).toContainText("pages rattachées : changez les canaux d'abord.");
    await expect(menu.getByRole('menuitem', { name: 'Mettre en pause', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // an agent without page can be deleted, a paused one resumed
    const serviceMenu = await openMenu(page, w.service.id);
    await expect(serviceMenu.getByRole('menuitem', { name: 'Supprimer', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    await expect(serviceMenu.getByRole('menuitem', { name: 'Reprendre', exact: true })).toBeVisible();
    await expect(serviceMenu).not.toContainText(errText('AGENT_HAS_CHANNELS'));
    await page.keyboard.press('Escape');
    // paused by the plan ("Reprendre" refused PLAN_LIMIT): real plan expiry in m9-carryovers.spec.ts

    await expect(vendeur.getByRole('link', { name: 'Tester', exact: true })).toHaveAttribute('href', `/fr/agents/${w.vendeur.id}/playground`);

    const toggle = vendeur.getByRole('switch', { name: 'Agent Vendeur Pro actif' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Mettre en pause « Vendeur Pro »' })).toBeVisible();
    await expect(dialog).toContainText('2 canaux · les nouvelles conversations restent sans réponse IA');
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toEqual([]);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect((await agentRow(request, owner, w.vendeur.id)).status).toBe('active');
  });

  test('pause with open conversations: the first confirm shows the count of waiting conversations, the second pauses; the switch resumes', async ({ page, request }) => {
    // a customer is being answered on a page of the agent (message < 24 h, AI not paused on the thread)
    await customerSays(request, owner, { channelId: shop.facebook.id, sender: nextSender(), text: 'Bonjour' });
    // what the server reports (a 409 without `confirm` changes nothing)
    const probe = await rawCall(request, owner, 'POST', `/agents/${w.vendeur.id}/pause`, {});
    expect(probe.status).toBe(409);
    expect(probe.body.error?.code).toBe('AGENT_PAUSED_WITH_OPEN_THREADS');
    const open = Number(probe.body.error?.params?.count);
    expect(open).toBeGreaterThanOrEqual(1);

    const writes = recordWrites(page, /\/agents\/[^/]+\/(pause|resume)$/);
    try {
      await openList(page);
      const vendeur = agentCard(page, w.vendeur.id);
      await expect(vendeur).toBeVisible({ timeout: 30_000 });

      await (await openMenu(page, w.vendeur.id)).getByRole('menuitem', { name: 'Mettre en pause', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('pause-agent')).toContainText('Pendant la pause, les nouveaux messages arrivent dans la boîte sans réponse IA.');
      await expect(dialog.getByTestId('pause-open-threads')).toHaveCount(0);
      await expect(dialog.getByTestId('pause-agent-confirm')).toHaveText('Mettre en pause');
      await dialog.getByTestId('pause-agent-confirm').click();

      // 409 AGENT_PAUSED_WITH_OPEN_THREADS is a confirmation, not an error: the dialog stays open with the count
      await expect(dialog.getByTestId('pause-open-threads')).toHaveText(`${open} conversations attendent une réponse : elles passeront en « À traiter ».`);
      await expect(dialog).toContainText(errText('AGENT_PAUSED_WITH_OPEN_THREADS'));
      await expect(dialog.getByTestId('pause-agent-confirm')).toHaveText('Mettre en pause quand même');
      await expect(vendeur).toHaveAttribute('data-state', 'active');
      expect(writes.map((x) => x.body)).toEqual([{}]);

      await dialog.getByTestId('pause-agent-confirm').click();
      await expect(toastOf(page, 'Agent « Vendeur Pro » en pause')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(writes.map((x) => x.body)).toEqual([{}, { confirm: true }]);
      await expect(vendeur).toHaveAttribute('data-state', 'paused');
      await expect(vendeur.getByTestId('agent-status')).toHaveText('EN PAUSE');
      await expect(vendeur).toContainText('IA SILENCIEUSE');
      expect((await agentRow(request, owner, w.vendeur.id)).status).toBe('paused');

      // resume through the "Actif" switch: no dialog
      const toggle = vendeur.getByRole('switch', { name: 'Agent Vendeur Pro actif' });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      await expect(toastOf(page, 'Agent « Vendeur Pro » repris')).toBeVisible();
      await expect.poll(() => writes.filter((x) => x.path.endsWith('/resume')).length).toBe(1);
      await expect(vendeur).toHaveAttribute('data-state', 'active');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    } finally {
      if ((await agentRow(request, owner, w.vendeur.id)).status === 'paused') await realPost(request, owner, `/agents/${w.vendeur.id}/resume`);
    }
  });

  test('delete: the typed name enables the button; AGENT_HAS_CHANNELS is shown inside the dialog, then the agent is removed', async ({ page, request }) => {
    const NAME = 'Agent à supprimer';
    const doomed = await pausedAgent(request, owner, { name: NAME, channelId: shop.facebook2.id, returnTo: w.conseiller.id });
    try {
      await openList(page);
      await expect(agentCard(page, doomed.id)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('agent-card')).toHaveCount(5);

      await (await openMenu(page, doomed.id)).getByRole('menuitem', { name: 'Supprimer', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: `Supprimer l'agent « ${NAME} » ?` })).toBeVisible();
      await expect(dialog.getByTestId('delete-agent')).toContainText('DESTRUCTIF');
      await expect(dialog.getByTestId('delete-agent')).toContainText('EN PAUSE · 0 canal');
      const confirm = dialog.getByTestId('delete-agent-confirm');
      const name = dialog.getByLabel('TAPEZ LE NOM POUR CONFIRMER');
      await expect(confirm).toBeDisabled();
      await name.fill('Agent à');
      await expect(confirm).toBeDisabled();
      await name.fill(NAME);
      await expect(confirm).toBeEnabled();

      // a colleague linked a page meanwhile (real link through the API)…
      await linkPage(request, owner, shop.facebook2.id, doomed.id);
      // mock: …but the API's DELETE /agents/:id unlinks the pages and deletes anyway (agent.service.ts `remove()`); 04 §240
      // wants 409 AGENT_HAS_CHANNELS {count}. The refusal is served once, the way the server should answer (API bug reported).
      const del = new RegExp(`/api/v1/agents/${doomed.id}$`);
      await page.route(del, (route) =>
        route.request().method() !== 'DELETE'
          ? route.fallback()
          : route.fulfill({ status: 409, contentType: 'application/json', headers: { 'access-control-allow-origin': 'http://localhost:3010', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ error: { code: 'AGENT_HAS_CHANNELS', message: "1 pages rattachées : changez les canaux d'abord.", params: { count: 1 }, fields: {}, details: null, ref: 'req_e2e' } }) }),
      );
      await confirm.click();
      const alert = dialog.getByRole('alert');
      await expect(alert).toContainText("pages rattachées : changez les canaux d'abord.");
      await expect(alert).toContainText(errText('AGENT_HAS_CHANNELS'));
      await expect(alert.getByRole('link', { name: 'Changer les canaux' })).toHaveAttribute('href', `/fr/agents/${doomed.id}/configuration?section=channels`);
      await expect(dialog.getByRole('heading', { name: `Supprimer l'agent « ${NAME} » ?` })).toBeVisible();
      await expect(name).toHaveValue(NAME);
      await expect(agentCard(page, doomed.id)).toHaveCount(1);
      await expect(page.locator('[data-toast]')).toHaveCount(0);
      expect((await agentByName(request, owner, NAME))?.id).toBe(doomed.id);

      // the page goes back to its agent ("Changer les canaux"), the second attempt reaches the real API: card removed + toast
      await linkPage(request, owner, shop.facebook2.id, w.conseiller.id);
      await page.unroute(del);
      await confirm.click();
      await expect(toastOf(page, `Agent « ${NAME} » supprimé`)).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(agentCard(page, doomed.id)).toHaveCount(0);
      await expect(page.getByTestId('agent-card')).toHaveCount(4);
      expect(await agentByName(request, owner, NAME)).toBeUndefined();
    } finally {
      await dropAgents(request, owner, [doomed.id]);
      await linkPage(request, owner, shop.facebook2.id, w.conseiller.id);
    }
  });

  test('duplicate lands on the wizard of the copy', async ({ page, request }) => {
    let copyId: string | undefined;
    try {
      await openList(page);
      await expect(agentCard(page, w.vendeur.id)).toBeVisible({ timeout: 30_000 });
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/agents/${w.vendeur.id}/duplicate`)),
        (await openMenu(page, w.vendeur.id)).getByRole('menuitem', { name: 'Dupliquer', exact: true }).click(),
      ]);
      const copy = ((await res.json()) as { data: { id: string; name: string; status: string; channels: unknown[]; wizardStep: number } }).data;
      copyId = copy.id;
      expect(copy).toMatchObject({ name: 'Vendeur Pro (copie)', status: 'draft', channels: [] });
      await expect(toastOf(page, 'Copie de « Vendeur Pro » créée en brouillon, sans canal')).toBeVisible();
      // the copy is a draft saved at step 1: the wizard resumes on the next step
      await expectRoute(page, new RegExp(`/fr/agents/new/knowledge\\?draft=${copy.id}$`));
      await expect(page.getByRole('heading', { name: "Ce que l'agent sait", level: 1 })).toBeVisible(NAV);
      await expect(page.getByRole('navigation', { name: "Fil d'Ariane" })).toContainText('Vendeur Pro (copie)');
    } finally {
      await dropAgents(request, owner, [copyId ?? (await agentByName(request, owner, 'Vendeur Pro (copie)'))?.id]);
    }
  });

  test('export JSON downloads the configuration of the agent', async ({ page, request }) => {
    const { currentVersion } = await agentRow(request, owner, w.vendeur.id);
    await openList(page);
    await expect(agentCard(page, w.vendeur.id)).toBeVisible({ timeout: 30_000 });
    const menu = await openMenu(page, w.vendeur.id);
    const [download] = await Promise.all([page.waitForEvent('download'), menu.getByRole('menuitem', { name: 'Exporter la configuration (JSON)', exact: true }).click()]);
    expect(download.suggestedFilename()).toBe(`agent-vendeur-pro-v${currentVersion}.json`);
    const json = JSON.parse(readFileSync(await download.path(), 'utf8')) as { agent: { id: string; name: string; channels: { id: string }[] }; faqs: unknown[] };
    expect(json.agent).toMatchObject({ id: w.vendeur.id, name: 'Vendeur Pro' });
    expect(json.agent.channels.map((c) => c.id).sort()).toEqual([shop.facebook.id, shop.instagram.id].sort());
  });

  test('test link dialog: create → URL field + copy', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const writes = recordWrites(page, /\/test-links$/);
    await openList(page);
    await expect(agentCard(page, w.vendeur.id)).toBeVisible({ timeout: 30_000 });
    await (await openMenu(page, w.vendeur.id)).getByRole('menuitem', { name: 'Partager un lien de test (24 h)', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Lien de test' })).toBeVisible();
    await expect(dialog).toContainText('Vendeur Pro · page publique valable 24 h');
    await expect(dialog.getByTestId('test-link')).toContainText('aucune commande créée, rien envoyé aux clients, aucun crédit consommé');
    await expect(dialog.getByLabel('LIEN À PARTAGER')).toHaveCount(0);
    expect(writes).toEqual([]); // nothing is created before the merchant asks

    const [res] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/agents/${w.vendeur.id}/test-links`)), dialog.getByTestId('test-link-create').click()]);
    expect(res.status()).toBe(201);
    const { url } = ((await res.json()) as { data: { url: string; expiresAt: string } }).data;
    expect(url).toMatch(/^https?:\/\/[^/]+(\/[a-z]{2})?\/agent-test\/[A-Za-z0-9_-]{16,}$/);
    await expect(dialog.getByLabel('LIEN À PARTAGER')).toHaveValue(url);
    await expect(dialog.getByLabel('LIEN À PARTAGER')).toHaveAttribute('readonly', '');
    await expect(dialog).toContainText(/Expire le /);
    expect(writes.map((x) => x.body)).toEqual([{ expiresInHours: 24 }]);

    await dialog.getByTestId('test-link-copy').click();
    await expect(toastOf(page, 'Copié')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await dialog.getByRole('button', { name: 'Fermer' }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('multi-select: delete two → one result per agent, the refused one stays selected', async ({ page, request }) => {
    const spare = await createAgent(request, owner, { name: 'Brouillon jetable' });
    try {
      const writes = recordWrites(page, /\/agents\/bulk\//);
      await openList(page);
      await expect(page.getByTestId('agent-card')).toHaveCount(5, { timeout: 30_000 });
      await expect(page.getByRole('checkbox', { name: 'Sélectionner Vendeur Pro' })).toHaveCount(0);

      await page.getByTestId('agents-select-toggle').click();
      await expect(page.getByTestId('agents-select-toggle')).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('checkbox', { name: 'Sélectionner Vendeur Pro' }).check();
      await page.getByRole('checkbox', { name: 'Sélectionner Brouillon jetable' }).check();
      const bar = page.getByRole('region', { name: 'Actions groupées' });
      await expect(bar).toContainText('2 agents sélectionnés');
      await expect(bar).toContainText('Les actions groupées renvoient un résultat par agent (ok / erreur) — jamais tout ou rien.');
      for (const name of ['Mettre en pause', 'Reprendre', 'Supprimer', 'Désélectionner']) await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();

      await bar.getByRole('button', { name: 'Supprimer', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Supprimer 2 agents ?' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();

      // the bulk delete never unlinks pages: "Vendeur Pro" (2 pages) is refused, the draft is deleted
      await expect(toastOf(page, "1 réussi(s) · 1 refusé(s) — « Vendeur Pro » : 2 pages rattachées : changez les canaux d'abord.")).toBeVisible();
      expect(writes.map((x) => x.path)).toEqual(['/agents/bulk/delete']);
      expect(((writes[0]!.body as { ids: string[] }).ids ?? []).sort()).toEqual([w.vendeur.id, spare.id].sort());
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(agentCard(page, spare.id)).toHaveCount(0);
      await expect(page.getByTestId('agent-card')).toHaveCount(4);
      expect((await listAgents(request, owner)).map((a) => a.id)).not.toContain(spare.id);
      // the refused agent is still there and still selected
      await expect(page.getByRole('checkbox', { name: 'Sélectionner Vendeur Pro' })).toBeChecked();
      await expect(bar).toContainText('1 agent sélectionné');

      await bar.getByRole('button', { name: 'Désélectionner', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Actions groupées' })).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: 'Sélectionner Vendeur Pro' })).not.toBeChecked();
    } finally {
      await dropAgents(request, owner, [spare.id]);
    }
  });
});

test.describe('pending insights column', () => {
  const insights = (page: Page) => page.getByTestId('agents-pending-insights');
  const row = (page: Page, i: InsightRow) => insights(page).locator(`[data-insight="${i.id}"]`);
  const pendingCount = async (request: Parameters<typeof insightsOf>[0]) => (await insightsOf(request, owner, '?status=pending')).length;

  test('AT-AGT-07 "Ajouter aux instructions" resolves with an instruction, "Ignorer" ignores the topic for 30 days', async ({ page, request }) => {
    const total = await pendingCount(request);
    const badge = (await agentRow(request, owner, w.vendeur.id)).pendingInsights;
    const writes = recordWrites(page, /\/agent-insights\//);
    await openList(page);
    await expect(insights(page).locator('[data-insight]')).toHaveCount(Math.min(5, total), { timeout: 30_000 });
    await expect(insights(page).getByRole('heading', { name: 'PROBLÈMES EN ATTENTE' })).toBeVisible();
    const unknown = ins.unknown_topic;
    await expect(row(page, unknown)).toContainText('SUJET INCONNU');
    await expect(row(page, unknown)).toContainText(`Vendeur Pro · ${shop.facebook.name}`);
    await expect(row(page, unknown)).toContainText('« chhal le prix de l iphone ? »');
    // the pipeline code of the cause is shown in words
    if (unknown.detail === 'off_catalogue') await expect(row(page, unknown)).toContainText('question hors catalogue');
    if (unknown.detail) await expect(row(page, unknown)).not.toContainText(unknown.detail);
    await expect(row(page, ins.unclear)).toContainText('INCOMPRÉHENSION');
    await expect(row(page, ins.handoff)).toContainText('TRANSFERT');
    await expect(row(page, ins.error)).toContainText('ERREUR IA');
    await expect(row(page, ins.error)).toContainText('mot bloqué');
    await expect(row(page, unknown).getByRole('link', { name: 'Ouvrir la conversation' })).toHaveAttribute('href', `/fr/inbox/${unknown.conversationId}`);

    // resolve dialog: the instruction is required, then posted
    await row(page, unknown).getByRole('button', { name: 'Ajouter aux instructions' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: "Résoudre l'insight" })).toBeVisible();
    await expect(dialog).toContainText(`Type : sujet inconnu · ${unknown.occurrences} fois`);
    await expect(dialog.getByTestId('resolve-insight')).toContainText(`Client : « ${unknown.customerMessage} » → IA : « ${unknown.aiResponse ?? '—'} »`);
    await expect(dialog.getByRole('radio', { name: /Ajouter une instruction à l'agent/ })).toHaveAttribute('aria-checked', 'true');
    await dialog.getByTestId('resolve-insight-submit').click();
    await expect(dialog.getByText('Champ requis')).toBeVisible();
    expect(writes).toEqual([]);
    const INSTRUCTION = "Nous ne vendons pas d'électronique ; proposer le catalogue mode.";
    await dialog.getByLabel('INSTRUCTION', { exact: true }).fill(INSTRUCTION);
    await dialog.getByTestId('resolve-insight-submit').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toEqual([{ method: 'POST', path: `/agent-insights/${unknown.id}/resolve`, body: { action: 'instruction', instruction: INSTRUCTION } }]);
    await expect(row(page, unknown)).toHaveCount(0);
    await expect(insights(page).locator('[data-insight]')).toHaveCount(Math.min(5, total - 1));
    // the badge of the agent follows, and the instruction is now part of the agent (new version)
    await expect(agentCard(page, w.vendeur.id).getByTestId('agent-insights-badge')).toHaveText(`${badge - 1} insights`);
    expect((await agentRow(request, owner, w.vendeur.id)).customInstructions).toContain(`- ${INSTRUCTION}`);

    // "Ignorer" of a row: no dialog
    await row(page, ins.unclear).getByRole('button', { name: 'Ignorer', exact: true }).click();
    await expect(toastOf(page, 'Insight ignoré pendant 30 jours')).toBeVisible();
    expect(writes.at(-1)).toEqual({ method: 'POST', path: `/agent-insights/${ins.unclear.id}/resolve`, body: { action: 'ignored_30d' } });
    await expect(row(page, ins.unclear)).toHaveCount(0);
    await expect(insights(page).locator('[data-insight]')).toHaveCount(Math.min(5, total - 2));
    expect((await insightsOf(request, owner, '?status=dismissed')).map((i) => i.id)).toContain(ins.unclear.id);
  });

  test('AT-AGT-07 INSIGHT_ALREADY_RESOLVED (a colleague was faster): toast with the code, the row leaves', async ({ page, request }) => {
    const total = await pendingCount(request);
    await openList(page);
    await expect(insights(page).locator('[data-insight]')).toHaveCount(Math.min(5, total), { timeout: 30_000 });
    await expect(row(page, ins.handoff)).toBeVisible();
    await expect(row(page, ins.error)).toBeVisible();

    // The colleague resolves through the API just before the page's request reaches it (with an earlier resolve, the WS
    // `agent.updated` would refresh the column first): the 422 the page reads is the real answer of the server.
    const colleagueFirst = async (insightId: string, body: Record<string, unknown>) => {
      const url = new RegExp(`/api/v1/agent-insights/${insightId}/resolve$`);
      await page.route(url, async (route) => {
        if (route.request().method() === 'POST') await realPost(request, owner, `/agent-insights/${insightId}/resolve`, body);
        await route.continue();
      });
      return url;
    };

    // through the dialog
    await row(page, ins.handoff).getByRole('button', { name: 'Ajouter aux instructions' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('INSTRUCTION', { exact: true }).fill('Toujours proposer un conseiller.');
    const r1 = await colleagueFirst(ins.handoff.id, { action: 'product' });
    const [answer] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/agent-insights/${ins.handoff.id}/resolve`)), dialog.getByTestId('resolve-insight-submit').click()]);
    expect(answer.status()).toBe(422);
    expect(((await answer.json()) as { error: { code: string } }).error.code).toBe('INSIGHT_ALREADY_RESOLVED');
    await expect(toastOf(page, 'Déjà traité.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row(page, ins.handoff)).toHaveCount(0);
    await expect(insights(page).locator('[data-insight]')).toHaveCount(Math.min(5, total - 1));
    await page.unroute(r1);

    // through "Ignorer" of a row
    await colleagueFirst(ins.error.id, { action: 'ignored_30d' });
    await row(page, ins.error).getByRole('button', { name: 'Ignorer', exact: true }).click();
    await expect(page.locator('[data-toast="info"]').filter({ hasText: 'Déjà traité.' }).last()).toBeVisible();
    await expect(row(page, ins.error)).toHaveCount(0);
    const left = total - 2;
    if (left > 0) await expect(insights(page).locator('[data-insight]')).toHaveCount(Math.min(5, left));
    else await expect(insights(page)).toContainText("Aucun problème signalé : vos agents s'en sortent bien.");
  });
});
