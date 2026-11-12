// M4 — Operator view of the agents screens (01-nest-module-map §3.2, `packages/shared/src/permissions.ts`): an Operator
// reads the agents (`agents.read`), tests them (`agents.test`), handles insights (`insights.manage`) and sees the
// credit balance (`billing.read_credits`); everything that changes an agent (`agents.manage`) and the credit ledger
// (`billing.read`) is hidden, read-only or a 403 page — and the API refuses the write as well.
// Everything runs on the REAL API: the owner's shop (fake Meta pages, an active agent, a paused one, a draft, two
// insights written by the fake AI from real customer messages) and an Operator invited through the dev mailbox.
// Nothing is mocked.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { operatorOf } from './support/m4-inbox';
import { openPage, signIn } from './support/m4-agents';
import { activeAgent, createAgent, creditsOf, insightsOf, setupShop, type Shop } from './support/m4-real';
import { agentRow, pausedAgent, rawCall, recordWrites, seedInsight, type InsightRow } from './support/m4-real-agents';

// shared dev server: every route compiles on its first hit, so the tests get room
test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(() => test.setTimeout(240_000));
let shop: Shop;
let owner: Account;
let operator: Account;
const ids = { vendeur: '', service: '', draft: '' };
let unknown: InsightRow;
let unclear: InsightRow;

const card = (page: Page, id: string) => page.locator(`[data-testid="agent-card"][data-agent="${id}"]`);
/** digits of a number whatever the thousands separator ("1 540", "1 540") */
const num = (n: number) => new RegExp(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\\D?'));
const start = async (page: Page, path: string, ready: () => ReturnType<Page['locator']>) => {
  await signIn(page, operator);
  await openPage(page, path, ready);
};

test.beforeAll(async ({ request }) => {
  test.setTimeout(360_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  shop = await setupShop(request, 'm4opw');
  owner = shop.owner;
  operator = await operatorOf(request, owner, 'm4opw-op');
  ids.vendeur = (await activeAgent(request, owner, { name: 'Vendeur Pro', channelId: shop.facebook.id })).id;
  ids.service = (await pausedAgent(request, owner, { name: 'Service Client', presetKey: 'service-client', channelId: shop.facebook2.id, returnTo: null, keepPage: true })).id;
  ids.draft = (await createAgent(request, owner, { name: 'Réponse Express (brouillon)', presetKey: 'reponse-express' })).id;
  [unknown, unclear] = await Promise.all([seedInsight(request, owner, shop.facebook.id, 'unknown_topic', 'chhal le prix de l iphone ?'), seedInsight(request, owner, shop.facebook.id, 'unclear', '??')]);
});

test('Operator on /agents: the list and "Tester" are there; no creation, selection, switch or management item; pending insights can be handled', async ({ page, request }) => {
  const pending = (await agentRow(request, owner, ids.vendeur)).pendingInsights;
  const writes = recordWrites(page, /./);
  await start(page, '/fr/agents', () => card(page, ids.vendeur));
  const vendeur = card(page, ids.vendeur);
  await expect(page.locator('[data-testid="agent-card"]')).toHaveCount(3);

  // nothing that creates or manages
  await expect(page.getByTestId('new-agent')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '+ Nouvel agent' })).toHaveCount(0);
  await expect(page.getByTestId('generate-agent')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Générer depuis une page' })).toHaveCount(0);
  await expect(page.getByTestId('agents-select-toggle')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sélectionner', exact: true })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(vendeur.getByText('Actif', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('agent-resume-draft')).toHaveCount(0);
  // the plan line stays readable, without the billing link (`billing.read` is Admin+)
  await expect(page.getByTestId('agents-plan-line')).toBeVisible();
  await expect(page.getByTestId('agents-plan-line').getByRole('link')).toHaveCount(0);

  // testing is allowed: direct link + menu item
  await expect(vendeur.getByRole('link', { name: 'Tester', exact: true })).toHaveAttribute('href', `/fr/agents/${ids.vendeur}/playground`);
  await vendeur.getByRole('button', { name: 'Actions', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Tester dans le bac à essai' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: `Voir les insights (${pending})` })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Voir les conversations' })).toBeVisible();
  for (const name of [/Modifier/, /Mettre en pause/, /Dupliquer/, /Exporter/, /Supprimer/, /Partager un lien de test/, /Reprendre/]) await expect(menu.getByRole('menuitem', { name })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // a paused agent has no "Reprendre", a draft only what can be read
  await card(page, ids.service).getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Tester dans le bac à essai' })).toBeVisible();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: /Reprendre|Supprimer|Modifier/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await card(page, ids.draft).getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: /Reprendre le brouillon|Tester et activer|Supprimer|Dupliquer/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // insights.manage is granted to every member: the column and its actions
  const column = page.getByTestId('agents-pending-insights');
  await expect(column).toContainText('PROBLÈMES EN ATTENTE');
  const row = column.locator(`[data-insight="${unclear.id}"]`);
  await expect(row.getByRole('link', { name: 'Ouvrir la conversation' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Ajouter aux instructions' })).toBeVisible();
  const before = await column.locator('[data-insight]').count();
  await row.getByRole('button', { name: 'Ignorer' }).click();
  await expect(page.getByText('Insight ignoré pendant 30 jours')).toBeVisible();
  await expect(column.locator('[data-insight]')).toHaveCount(before - 1);
  expect(writes.filter((x) => x.path.includes('/resolve'))).toEqual([{ method: 'POST', path: `/agent-insights/${unclear.id}/resolve`, body: { action: 'ignored_30d' } }]);
  expect((await insightsOf(request, owner, '?status=dismissed')).map((i) => i.id)).toContain(unclear.id);
  // …and no write to an agent was attempted
  expect(writes.filter((x) => x.path.startsWith('/agents'))).toEqual([]);
  await expectNoA11yViolations(page);
});

test('Operator on an agent page: no "Modifier", no switch, versions without "Restaurer", summary without edit links', async ({ page, request }) => {
  const { currentVersion } = await agentRow(request, owner, ids.vendeur);
  await start(page, `/fr/agents/${ids.vendeur}`, () => page.getByRole('heading', { level: 1, name: /Vendeur Pro/ }));
  await expect(page.getByTestId('agent-facts')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Modifier', exact: true })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Tester', exact: true })).toHaveAttribute('href', `/fr/agents/${ids.vendeur}/playground`);

  const summary = page.getByTestId('agent-summary');
  await expect(summary.locator('[data-row]').first()).toBeVisible();
  await expect(summary.getByRole('link')).toHaveCount(0);
  await expect(summary).not.toContainText('Modifier (étape');

  const versions = page.getByTestId('agent-versions');
  expect(currentVersion).toBeGreaterThanOrEqual(2);
  await expect(versions).toContainText(`v${currentVersion}`);
  await expect(versions.getByTestId('version-diff').first()).toBeVisible();
  await expect(versions.getByTestId('version-restore')).toHaveCount(0);
  await expect(versions.getByRole('button', { name: 'Restaurer' })).toHaveCount(0);
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Tester dans le bac à essai' })).toBeVisible();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: /Modifier|Mettre en pause|Dupliquer|Exporter|Supprimer/ })).toHaveCount(0);
});

test('Operator on the configuration: read-only note, fields disabled, no save button', async ({ page }) => {
  const writes = recordWrites(page, /^\/api\/v1\/agents/);
  await start(page, `/fr/agents/${ids.vendeur}/configuration`, () => page.getByTestId('agent-configuration'));
  const config = page.getByTestId('agent-configuration');
  await expect(page.getByTestId('config-readonly')).toHaveText("Opérateur : lecture seule. Seuls les admins modifient la configuration d'un agent.");
  await expect(page.getByTestId('config-save')).toHaveCount(0);
  await expect(page.getByTestId('config-dirty')).toHaveCount(0);
  // every field of the section is disabled
  const fields = config.locator('input, textarea, select');
  await expect(fields.first()).toBeVisible();
  expect(await fields.count()).toBeGreaterThan(0);
  await expect(config.locator('input:enabled:not([type=file]), textarea:enabled, select:enabled')).toHaveCount(0);
  await expect(config.locator('#agent-name')).toBeDisabled();
  await expect(config.locator('#agent-name')).toHaveValue('Vendeur Pro');
  await expect(config.locator('#agent-tone')).toBeDisabled();
  // the avatar choice is not a form control: it is disabled like the fields (a new agent uses its initials)
  await expect(config.getByRole('radio', { name: 'Photo de la page' })).toBeDisabled();
  await expect(config.getByRole('radio', { name: 'Initiales' })).toBeChecked();
  await expect(page.getByTestId('config-dirty')).toHaveCount(0);
  await expect(config).not.toHaveAttribute('data-dirty', /.+/);
  await expectNoA11yViolations(page);
  expect(writes).toEqual([]);
});

test('Operator in the playground: can send a message (agents.test); no "Ajouter une instruction depuis ce tour", no "Modifier l\'agent"', async ({ page, request }) => {
  const before = (await creditsOf(request, owner)).plan.used;
  const writes = recordWrites(page, /^\/api\/v1\/agents/);
  await start(page, `/fr/agents/${ids.vendeur}/playground`, () => page.getByTestId('agent-playground'));
  const playground = page.getByTestId('agent-playground');
  await expect(playground).toContainText('Bac à essai · Vendeur Pro');
  await expect(page.getByRole('link', { name: "Modifier l'agent" })).toHaveCount(0);
  await expectNoA11yViolations(page);

  const input = page.getByTestId('playground-composer').locator('textarea');
  await expect(input).toBeEnabled();
  await input.fill('chhal le prix de la robe satin ?');
  await page.getByTestId('playground-send').click();
  const turn = page.getByTestId('playground-turn').first();
  // the fake AI finds the product of the catalogue and answers with it (dry run)
  await expect(turn).toContainText(/Robe satin/i, { timeout: 60_000 });
  expect(writes.filter((x) => x.method === 'POST' && x.path === `/agents/${ids.vendeur}/test`)).toHaveLength(1);
  expect((await creditsOf(request, owner)).plan.used).toBe(before);

  // the inspector of the turn: flagging is allowed, turning it into an instruction is not
  await expect(page.getByTestId('turn-flag')).toBeVisible();
  await expect(page.getByTestId('turn-add-instruction')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ajouter une instruction depuis ce tour' })).toHaveCount(0);
});

test('Operator on the insights tab: can resolve an insight with an instruction', async ({ page, request }) => {
  const writes = recordWrites(page, /\/agent-insights\//);
  await start(page, `/fr/agents/${ids.vendeur}/insights`, () => page.getByTestId('insights-list').locator(`[data-insight="${unknown.id}"]`));
  const list = page.getByTestId('insights-list');
  await expect(list.locator('[data-insight]')).toHaveCount((await insightsOf(request, owner, `?agentId=${ids.vendeur}&status=pending`)).length);
  await expectNoA11yViolations(page);
  await list.locator(`[data-insight="${unknown.id}"]`).getByTestId('insight-resolve').click();
  const dialog = page.getByRole('dialog', { name: "Résoudre l'insight" });
  await dialog.locator('#insight-instruction').fill('Nous ne vendons pas d’électronique.');
  await dialog.getByTestId('resolve-insight-submit').click();
  await expect(page.getByText("Instruction ajoutée à l'agent · nouvelle version")).toBeVisible();
  await expect(list.locator(`[data-insight="${unknown.id}"]`)).toHaveCount(0);
  expect(writes).toEqual([{ method: 'POST', path: `/agent-insights/${unknown.id}/resolve`, body: { action: 'instruction', instruction: 'Nous ne vendons pas d’électronique.' } }]);
  // the server applied it: the instruction is part of the agent now
  expect((await agentRow(request, owner, ids.vendeur)).customInstructions).toContain('- Nous ne vendons pas d’électronique.');
});

test('Operator on /agents/new and /agents/generate: the 403 page', async ({ page }) => {
  const writes = recordWrites(page, /./);
  await start(page, '/fr/agents/new', () => page.getByRole('heading', { name: 'Accès refusé' }));
  await expect(page.getByText('403', { exact: true })).toBeVisible();
  await expect(page.getByText(/Cette page est réservée aux admins de l'espace\. Votre rôle : /)).toBeVisible();
  await expect(page.getByTestId('wizard-footer')).toHaveCount(0);

  // (a first hit compiles the route on the shared dev server: the navigation is repeated until the page answers)
  await openPage(page, '/fr/agents/generate', () => page.getByRole('heading', { name: 'Accès refusé' }));
  await expect(page.getByText('403', { exact: true })).toBeVisible();  expect(writes.filter((x) => x.path.startsWith('/agents'))).toEqual([]);
});

test('Operator on /settings/credits: balance tiles visible, the ledger is reserved to admins', async ({ page, request }) => {
  const c = await creditsOf(request, owner);
  await start(page, '/fr/settings/credits', () => page.getByTestId('credits-tiles'));
  await expect(page.getByTestId('tile-plan')).toContainText(num(c.plan.remaining));
  await expect(page.getByTestId('tile-plan')).toContainText('restants (plan)');
  await expect(page.getByTestId('tile-packs')).toContainText(num(c.packs.remaining));
  await expect(page.getByTestId('tile-used')).toContainText(num(c.plan.used));
  await expect(page.getByTestId('ledger-forbidden')).toHaveText('L’historique détaillé est réservé aux admins de l’espace.');
  await expect(page.getByTestId('credits-ledger')).toHaveCount(0);
  await expect(page.getByTestId('ledger-row')).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test('the API refuses every agent write of an Operator with 403 (and the credit ledger), nothing changes', async ({ request }) => {
  const before = await agentRow(request, owner, ids.vendeur);
  const refused: [string, Awaited<ReturnType<typeof rawCall>>][] = [
    ['create', await rawCall(request, operator, 'POST', '/agents', { presetKey: 'vendeur-pro', name: 'Agent de l’opérateur' })],
    ['generate', await rawCall(request, operator, 'POST', '/agents/generate', { channelId: shop.facebook.id, days: 30 })],
    ['update', await rawCall(request, operator, 'PATCH', `/agents/${ids.vendeur}`, { version: before.version, name: 'Renommé' })],
    ['pause', await rawCall(request, operator, 'POST', `/agents/${ids.vendeur}/pause`, { confirm: true })],
    ['resume', await rawCall(request, operator, 'POST', `/agents/${ids.service}/resume`, {})],
    ['delete', await rawCall(request, operator, 'DELETE', `/agents/${ids.draft}`)],
    ['test link', await rawCall(request, operator, 'POST', `/agents/${ids.vendeur}/test-links`, { expiresInHours: 24 })],
    ['export', await rawCall(request, operator, 'GET', `/agents/${ids.vendeur}/export`)],
    ['ledger', await rawCall(request, operator, 'GET', '/credits/ledger')],
  ];
  for (const [what, r] of refused) {
    expect(r.status, what).toBe(403);
    expect(r.body.error?.code, what).toBe('FORBIDDEN');
  }
  // what the Operator may do answers
  expect((await rawCall(request, operator, 'GET', `/agents/${ids.vendeur}`)).status).toBe(200);
  expect((await rawCall(request, operator, 'GET', '/credits')).status).toBe(200);
  const after = await agentRow(request, owner, ids.vendeur);
  expect(after).toMatchObject({ name: 'Vendeur Pro', status: 'active', version: before.version });
  expect((await agentRow(request, owner, ids.draft)).status).toBe('draft');
});
