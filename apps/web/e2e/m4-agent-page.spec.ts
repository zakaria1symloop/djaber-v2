// M4 — agent page on the REAL M4 API (deterministic fake AI, fake Meta pages, worker running) — UI side of
// AT-AGT-07 / AT-AGT-08 / AT-AI-10 / AT-AI-16 / AT-AI-17. Frames: "AGT-03 — Agent page — overview (tabs, versions,
// rollback)", "AGT-04 — Agent page — Configuration tab (edit as tabs, dirty, saving, conflict)", "AGT-08 — Agent page —
// Insights queue tab", "AGT-07 — Agent playground — dry run with tool calls", "DLG — Agents & channels".
// One shop for the file (`beforeAll`): agents built through the API, versions made by real saves, metrics and insights
// produced by real customer messages (`POST /dev/meta/inbound`), a second admin as "the colleague". `page.route` is
// used only where the fake drivers cannot produce the state over HTTP; every such use says why (`// mock:`).
import { expect as baseExpect, test as base, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, API, authHeaders, expectUrl, type Account } from './support/m1';
import { patchAnswer } from './support/m3-inbox';
import { agentPath, clickForRoute, clickForUrl, clickUntil, composer, say, toast } from './support/m4-agent-page';
import { signIn } from './support/m4-agents';
import { activateAgent, conversationOf, createAgent, INSIGHT_TRIGGERS, inject, insightsOf, linkPage, nextSender, patchAgent, pauseAgent, setBlockedWords, setupShop, waitAiMessages, waitInsights, type RealInsight, type Shop } from './support/m4-real';
import { bodyOf, confidence, fullAgent, inviteAdmin, lastDays, load, metricsOf, num, numRe, recordRequests, resolveInsight, seconds, versionsOf } from './support/m4-real-agent-page';

// the dev server is shared with the other suites (routes compile on first hit, transitions can take seconds)
const expect = baseExpect.configure({ timeout: 20_000 });
const FIRST = { timeout: 60_000 };
const UNKNOWN_AGENT = 'aaaaaaaa-0000-7000-8000-000000000999';

// One sign-in for the file: every test opens its own page in ONE signed-in context.
let context: BrowserContext;
const test = base.extend<{ page: Page }>({
  page: async ({}, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});
test.describe.configure({ timeout: 240_000 });

const TAG = Date.now().toString(36).slice(-4);
const NAMES = { a: `Vendeur ${TAG}`, b: `Config ${TAG}`, c: `Service ${TAG}`, d: `Brouillon ${TAG}`, e: `Insights ${TAG}` };
const V3_NOTE = 'Ajout mot-clé « arnaque » · quantité max 8';
let shop: Shop;
let owner: Account;
let colleague: Account;
const ids = { a: '', b: '', c: '', d: '', e: '' };
/** pending insights of agent E by kind, built in `beforeAll` */
const seeded = { tablette: '', ok: '' };

test.beforeAll(async ({ browser, request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  test.setTimeout(480_000);
  shop = await setupShop(request, 'agtpage');
  owner = shop.owner;
  colleague = await inviteAdmin(request, owner, 'Nadia', 'Ferhat');

  // A — "Vendeur": v1 created from the preset, v2 activation, v3 a manual save with a note
  const a = await createAgent(request, owner, { name: NAMES.a, wizard: { displayName: 'Amel', tone: 'warm', emojiLevel: 'moderate', languages: ['darija', 'fr'], defaultLanguage: 'darija', catalogScope: 'all', policies: { delivery: '2–5 jours · stop-desk disponible' }, maxQtyPerOrder: 5 } });
  ids.a = a.id;
  await linkPage(request, owner, shop.facebook.id, a.id);
  await activateAgent(request, owner, a.id);
  await patchAgent(request, owner, a.id, { wizard: { maxQtyPerOrder: 8, handoffKeywords: ['arnaque'] }, note: V3_NOTE });
  // real conversations for the KPI tiles: two price questions answered by the AI, one handoff
  const metricSenders = [nextSender(), nextSender(), nextSender()];
  const metricTexts = ['chhal le prix de la robe satin ?', 'chhal le prix du foulard soie ?', 'je veux parler à un humain'];
  for (const [i, s] of metricSenders.entries()) await inject(request, owner, { channelId: shop.facebook.id, sender: s, text: metricTexts[i] });

  // C — paused by its owner (activated on Instagram, then paused); B takes Instagram over
  const c = await createAgent(request, owner, { name: NAMES.c });
  ids.c = c.id;
  await linkPage(request, owner, shop.instagram.id, c.id);
  await activateAgent(request, owner, c.id);
  await pauseAgent(request, owner, c.id);
  const b = await createAgent(request, owner, { name: NAMES.b, wizard: { maxQtyPerOrder: 5 } });
  ids.b = b.id;
  await linkPage(request, owner, shop.instagram.id, b.id);
  await activateAgent(request, owner, b.id);
  // D — a draft without page
  ids.d = (await createAgent(request, owner, { name: NAMES.d })).id;
  // E — the insights agent, on the second Facebook page
  const e = await createAgent(request, owner, { name: NAMES.e });
  ids.e = e.id;
  await linkPage(request, owner, shop.facebook2.id, e.id);
  await activateAgent(request, owner, e.id);

  for (const s of metricSenders) await waitAiMessages(request, owner, (await conversationOf(request, owner, s)).id);

  // insights of E: unknown topic ×2 (one group), unclear, handoff, plus one later resolved (FAQ) and one ignored
  const triggers: [string, string][] = [
    [nextSender(), INSIGHT_TRIGGERS.unknown_topic],
    [nextSender(), INSIGHT_TRIGGERS.unknown_topic],
    [nextSender(), INSIGHT_TRIGGERS.unclear],
    [nextSender(), INSIGHT_TRIGGERS.handoff],
    [nextSender(), 'chhal le prix de la tablette ?'],
    [nextSender(), 'ok ?'],
  ];
  for (const [s, text] of triggers) await inject(request, owner, { channelId: shop.facebook2.id, sender: s, text });
  await waitInsights(request, owner, `?agentId=${e.id}&pageSize=50`, triggers.length, 90_000);
  // error: the AI reply names a product whose word is blocked ⇒ withheld, handoff, `error` insight
  await setBlockedWords(request, owner, ['satin']);
  try {
    await inject(request, owner, { channelId: shop.facebook2.id, sender: nextSender(), text: 'chhal le prix de la robe satin ?' });
    await waitInsights(request, owner, `?agentId=${e.id}&type=error`, 1, 90_000);
  } finally {
    await setBlockedWords(request, owner, []);
  }
  const all = await insightsOf(request, owner, `?agentId=${e.id}&pageSize=50`);
  seeded.tablette = all.find((i) => i.customerMessage.includes('tablette'))!.id;
  seeded.ok = all.find((i) => i.customerMessage === 'ok ?')!.id;
  await resolveInsight(request, owner, seeded.tablette, { action: 'faq', question: 'Vous vendez des tablettes ?', answer: 'Non, uniquement de la mode.' });
  await resolveInsight(request, owner, seeded.ok, { action: 'ignored_30d' });

  context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'fr-DZ', timezoneId: 'Africa/Algiers', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await signIn(page, owner);
  // let the requests that follow the sign-in settle: a rotation of the refresh cookie cut by `close` revokes the session
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // the shared `next dev` server compiles a route on its first hit: open each tab once before the tests time them
  // (best effort: a test opens its own page with `go`, which retries)
  for (const url of [...(['', '/configuration', '/insights', '/playground'] as const).map((tab) => agentPath(ids.a, tab)), `/fr/agents/new/knowledge?draft=${ids.d}`]) {
    await load(page, () => page.goto(url, { timeout: 120_000 })).catch(() => undefined);
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => undefined);
  }
  await page.close();
});
test.afterAll(async () => {
  await context?.close();
});

const tabs = (page: Page) => page.getByRole('navigation', { name: "Sections de l'agent" });
/**
 * Opens a tab of an agent. The shared dev server can leave a navigation on its loading state, and the session of the
 * shared context can be lost (refresh answered 401): the page is opened again, after a new sign-in when needed.
 */
async function go(page: Page, url: string) {
  await baseExpect(async () => {
    await load(page, () => page.goto(url));
    if (await tabs(page).waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false)) return;
    await signIn(page, owner);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    throw new Error(`${url} did not open: signed in again`);
  }).toPass({ timeout: 200_000 });
}
const sectionTab = (page: Page, key: string) => page.locator(`[data-section-tab="${key}"]`);
const saveButton = (page: Page) => page.getByTestId('config-save');
const maxQty = (page: Page) => page.locator('#agent-max-qty');
const inspectorRow = (page: Page, key: string) => page.locator(`[data-testid="inspector"] [data-row="${key}"]`);
const fbLabel = () => `${shop.facebook.name} (FB)`;
const AGENT_A = () => `/agents/${ids.a}`;

test.describe('AGT-03 overview', () => {
  test('header: name, status and version pills, facts, tabs with aria-current, document title, axe', async ({ page, request }) => {
    const a = await fullAgent(request, owner, ids.a);
    const versions = await versionsOf(request, owner, ids.a);
    await go(page, agentPath(ids.a));
    await expect(page.getByRole('heading', { name: NAMES.a, level: 1 })).toBeVisible(FIRST);
    await expect(page).toHaveTitle(`${NAMES.a} · Djaber.ai`);
    await expect(page.getByTestId('agent-status')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('agent-status')).toHaveText('ACTIF');
    await expect(page.getByTestId('agent-version')).toHaveText(new RegExp(`^V${a.currentVersion} · modifié `));
    await expect(page.getByTestId('agent-facts')).toContainText(`${fbLabel()} · darija · FR · texte · photo · vocal · commandes · livraison`);
    await expect(page.getByRole('switch', { name: `Agent ${NAMES.a} actif` })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('agent-paused-banner')).toHaveCount(0);

    const nav = tabs(page);
    // + the M5 link tabs of AGT-03 (views of the inbox and of the orders list filtered by this agent)
    await expect(nav.getByRole('link')).toHaveText(["Vue d'ensemble", 'Configuration', `Insights${a.pendingInsights}`, 'Bac à essai', 'Conversations', 'Commandes']);
    await expect(nav.getByTestId('agent-tab-orders')).toHaveAttribute('href', `/fr/orders?source=ai&agentId=${ids.a}`);
    await expect(nav.getByRole('link', { name: "Vue d'ensemble" })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Configuration' })).toHaveAttribute('href', `/fr${AGENT_A()}/configuration`);
    await expect(nav.getByRole('link', { name: /^Insights/ })).toHaveAttribute('href', `/fr${AGENT_A()}/insights`);
    await expect(nav.getByRole('link', { name: 'Bac à essai' })).toHaveAttribute('href', `/fr${AGENT_A()}/playground`);
    await expect(nav.getByRole('link', { name: 'Configuration' })).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('agent-versions').locator('li[data-version]')).toHaveCount(versions.length);
    await expect(page.getByTestId('agent-kpis')).toBeVisible();
    await expectNoA11yViolations(page);

    await clickForRoute(page, nav.getByRole('link', { name: 'Bac à essai' }), new RegExp(`${AGENT_A()}/playground$`));
    await expect(nav.getByRole('link', { name: 'Bac à essai' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: "Vue d'ensemble" })).not.toHaveAttribute('aria-current', 'page');
  });

  test('AT-AGT-08 KPI tiles of the last 30 days, then 7 j in the URL reads /metrics?from&to', async ({ page, request }) => {
    const m = (await fullAgent(request, owner, ids.a)).metrics30d;
    // the three conversations of `beforeAll`: two answered, one handed over
    expect(m.conversations).toBe(3);
    expect(m.handledWithoutHuman).toBe(2);
    await go(page, agentPath(ids.a));
    const kpi = (key: string) => page.locator(`[data-testid="agent-kpis"] [data-kpi="${key}"]`);
    await expect(kpi('conversations')).toContainText('3', FIRST);
    await expect(kpi('conversations')).toContainText('conversations · 30 j');
    await expect(kpi('handled')).toContainText('67 %');
    await expect(kpi('handled')).toContainText('2 conversations');
    await expect(kpi('orders')).toContainText('0');
    await expect(kpi('orders')).toContainText('0 % confirmées · 0 livrées');
    await expect(kpi('latency')).toContainText(seconds(m.avgLatencyMs));
    await expect(kpi('latency')).toContainText(`p95 ${seconds(m.p95LatencyMs)}`);
    await expect(kpi('credits')).toContainText(new RegExp(numRe(m.credits)));
    await expect(kpi('credits')).toContainText(`≈ ${String(Math.round((m.credits * 10) / m.conversations) / 10).replace('.', ',')} / conv.`);
    await expect(page.getByRole('radio', { name: '30 j' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/^Dernière réponse : /)).toBeVisible();

    const metrics = page.waitForRequest((r) => r.url().includes(`${AGENT_A()}/metrics?`) && r.method() === 'GET');
    await clickUntil(page.getByRole('radio', { name: '7 j' }), () => expect(page).toHaveURL(/[?&]period=7(&|$)/, { timeout: 2000 }));
    const q = new URL((await metrics).url()).searchParams;
    expect(q.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 7 inclusive days of Africa/Algiers
    expect(Math.round((Date.parse(q.get('to')!) - Date.parse(q.get('from')!)) / 86_400_000)).toBe(6);
    expect({ from: q.get('from'), to: q.get('to') }).toEqual(lastDays(7));
    const week = await metricsOf(request, owner, ids.a, q.get('from')!, q.get('to')!);
    expect(week.handoffs).toBe(1);
    await expect(kpi('conversations')).toContainText('conversations · 7 j');
    await expect(kpi('conversations')).toContainText(`${num(week.aiMessages)} réponses IA`);
    await expect(kpi('handled')).toContainText('1 transferts');

    // the period is URL state
    await load(page, () => page.reload());
    await expect(page.getByRole('radio', { name: '7 j' })).toHaveAttribute('aria-checked', 'true', FIRST);
    await expect(kpi('conversations')).toContainText('réponses IA');
    await clickForUrl(page, page.getByRole('radio', { name: '30 j' }), /period=/, false);
    await expect(kpi('conversations')).toContainText('conversations · 30 j');
    await expect(kpi('conversations')).not.toContainText('réponses IA');
  });

  test('configuration summary: one line per section with "Modifier (étape n) ›" to configuration?section=…', async ({ page, request }) => {
    const a = await fullAgent(request, owner, ids.a);
    await go(page, agentPath(ids.a));
    const row = (key: string) => page.locator(`[data-testid="agent-summary"] [data-row="${key}"]`);
    await expect(row('identity')).toContainText('Amel · Chaleureux & concis · Avec modération', FIRST);
    await expect(row('knowledge')).toContainText(`Tout le catalogue (${a.productCount}) · 1 règle · 0 FAQ`);
    expect(a.productCount).toBe(shop.products.length);
    await expect(row('behaviour')).toContainText(`Texte · Photo · Vocal · Commandes · Livraison · Cross-sell · max ${a.wizard.maxQtyPerOrder} u / ∞`);
    await expect(row('channels')).toContainText(fbLabel());
    await expect(row('system')).toContainText('Transfert · hors horaires · rupture — Paramètres › Messages système');
    for (const [key, step] of [
      ['identity', 1],
      ['knowledge', 2],
      ['behaviour', 3],
      ['channels', 4],
    ] as const) {
      await expect(row(key).getByRole('link', { name: `Modifier (étape ${step}) ›` })).toHaveAttribute('href', `/fr${AGENT_A()}/configuration?section=${key}`);
    }
    await clickForRoute(page, row('behaviour').getByRole('link', { name: 'Modifier (étape 3) ›' }), new RegExp(`${AGENT_A()}/configuration\\?section=behaviour$`));
    await expect(sectionTab(page, 'behaviour')).toHaveAttribute('aria-current', 'true', FIRST);
    await expect(maxQty(page)).toHaveValue(String(a.wizard.maxQtyPerOrder));
  });

  test('versions: v3 ACTUELLE / v2 / v1, Diff of v2, Restaurer v2 creates v4', async ({ page, request }) => {
    expect((await versionsOf(request, owner, ids.a)).map((v) => [v.version, v.isCurrent])).toEqual([
      [3, true],
      [2, false],
      [1, false],
    ]);
    await go(page, agentPath(ids.a));
    const versions = page.getByTestId('agent-versions');
    const v = (n: number) => versions.locator(`li[data-version="${n}"]`);
    await expect(versions.locator('li[data-version]')).toHaveCount(3, FIRST);
    await expect(v(3)).toHaveAttribute('data-current', 'true');
    await expect(v(3)).toContainText('ACTUELLE');
    await expect(v(3)).toContainText(V3_NOTE);
    await expect(v(3).getByTestId('version-restore')).toHaveCount(0);
    await expect(v(2)).not.toHaveAttribute('data-current', 'true');
    await expect(v(2)).toContainText(`${owner.firstName} ${owner.lastName.slice(0, 1)}.`);
    await expect(v(2)).toContainText('Activation');
    await expect(v(1)).toContainText('Création depuis le préréglage « Vendeur Pro »');

    // Diff: the fields that differ between v2 and the current v3 (current value → value of v2)
    await v(2).getByTestId('version-diff').click();
    await expect(v(2).getByTestId('version-diff')).toHaveAttribute('aria-expanded', 'true');
    const diff = v(2).getByTestId('diff-list');
    await expect(v(2)).toContainText('v2 comparée à v3');
    await expect(diff.locator('[data-diff="maxQtyPerOrder"] dt')).toHaveText('Quantité max');
    await expect(diff.locator('[data-diff="maxQtyPerOrder"] dd')).toHaveText(/^\s*8\s*→\s*5\s*$/);
    await expect(diff.locator('[data-diff="handoffKeywords"]')).toContainText('Mots-clés de transfert');
    await expect(diff.locator('[data-diff="handoffKeywords"]')).toContainText('arnaque');
    await v(2).getByTestId('version-diff').click();
    await expect(versions.getByTestId('diff-list')).toHaveCount(0);

    // Restaurer: confirmation, then a new version
    const restores = recordRequests(page, 'POST', new RegExp(`/agents/${ids.a}/versions/2/restore$`));
    await v(2).getByTestId('version-restore').click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog.getByRole('heading', { name: 'Restaurer la version v2 ?' })).toBeVisible();
    await expect(dialog).toContainText('La configuration de cette version redevient active et crée la version v4.');
    expect(restores).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Restaurer', exact: true }).click();
    await expect(toast(page, 'Version restaurée · v4 créée')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(restores).toHaveLength(1);
    await expect(page.getByTestId('agent-version')).toHaveText(/^V4 · /);
    await expect(v(4)).toHaveAttribute('data-current', 'true');
    await expect(v(4)).toContainText('ACTUELLE');
    await expect(v(4)).toContainText("Restauration d'une version");
    const after = await fullAgent(request, owner, ids.a);
    expect(after.currentVersion).toBe(4);
    expect(after.wizard.maxQtyPerOrder).toBe(5);
  });

  test('preset update notice: "Appliquer (crée vN)" asks first, then applies the preset version and records it', async ({ page, request }) => {
    const a = await fullAgent(request, owner, ids.a);
    expect(a.preset?.key).toBe('vendeur-pro');
    const presetVersion = a.preset!.version;
    // mock: since M10 the admin publishes preset versions (`POST /admin/agent-presets/:id/versions/:v/publish`), but the
    // seeded platform presets are shared by every workspace of the dev API (a new version announces an update to all of
    // them). The real answer is patched to announce the preset's published version, which the API can apply.
    let announce = true;
    await patchAnswer(page, new RegExp(`/api/v1/agents/${ids.a}(\\?|$)`), (d: { preset: Record<string, unknown> | null }) => (announce && d.preset ? { ...d, preset: { ...d.preset, updateAvailable: presetVersion } } : d));
    await go(page, agentPath(ids.a));
    const notice = page.getByTestId('preset-update');
    await expect(notice).toContainText(`Préréglage « ${a.preset!.name} » v${presetVersion} disponible (facultatif).`, FIRST);
    const applies = recordRequests(page, 'POST', new RegExp(`/agents/${ids.a}/apply-preset-update$`));
    await notice.getByRole('button', { name: `Appliquer (crée v${a.currentVersion + 1})` }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog.getByRole('heading', { name: `Appliquer la mise à jour de « ${a.preset!.name} » ?` })).toBeVisible();
    await expect(dialog).toContainText(`la version v${a.currentVersion + 1} est créée`);
    expect(applies).toHaveLength(0);
    announce = false;
    await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click();
    await expect(toast(page, `Version v${a.currentVersion + 1} créée`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(applies.map(bodyOf)).toEqual([{ presetVersion }]);
    await expect(notice).toHaveCount(0);
    const top = page.getByTestId('agent-versions').locator(`li[data-version="${a.currentVersion + 1}"]`);
    await expect(top).toHaveAttribute('data-current', 'true');
    await expect(top).toContainText(`Mise à jour du préréglage (v${presetVersion})`);
    expect((await versionsOf(request, owner, ids.a))[0]).toMatchObject({ version: a.currentVersion + 1, source: 'preset_update', isCurrent: true });
  });

  test('paused agent: banner with "Reprendre"; a draft resumes in the wizard; unknown id ⇒ not found with a back link', async ({ page, request }) => {
    await go(page, agentPath(ids.c));
    await expect(page.getByRole('heading', { name: NAMES.c, level: 1 })).toBeVisible(FIRST);
    await expect(page.getByTestId('agent-status')).toHaveAttribute('data-state', 'paused');
    await expect(page.getByTestId('agent-status')).toHaveText('EN PAUSE');
    await expect(page.getByTestId('agent-paused-banner')).toHaveText('Agent en pause : il ne répond plus sur ses pages. Les nouveaux messages arrivent dans la boîte sans réponse IA.');
    const resumes = recordRequests(page, 'POST', new RegExp(`/agents/${ids.c}/resume$`));
    const banner = page.getByRole('status').filter({ has: page.getByTestId('agent-paused-banner') });
    await banner.getByRole('button', { name: 'Reprendre', exact: true }).click();
    await expect(toast(page, `Agent « ${NAMES.c} » repris`)).toBeVisible();
    expect(resumes).toHaveLength(1);
    await expect(page.getByTestId('agent-status')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('agent-paused-banner')).toHaveCount(0);
    expect((await fullAgent(request, owner, ids.c)).status).toBe('active');

    // paused by the plan (no switch, banner to the plans): real plan expiry since M9, see m9-carryovers.spec.ts

    // a draft has no page: it resumes in the wizard (created from the API at step 1 ⇒ step 2)
    await load(page, () => page.goto(agentPath(ids.d)));
    await expectUrl(page, new RegExp(`/fr/agents/new/knowledge\\?draft=${ids.d}$`), { timeout: 120_000 });

    // unknown id (or another workspace): 404 state
    await load(page, () => page.goto(agentPath(UNKNOWN_AGENT)));
    await expect(page.getByRole('heading', { name: 'Introuvable', exact: true })).toBeVisible(FIRST);
    await expect(page.getByText("Cet élément n'existe pas ou appartient à un autre espace (404).")).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Retour', exact: true })).toHaveAttribute('href', '/fr/agents');
    await expect(tabs(page)).toHaveCount(0);
  });
});

test.describe('AGT-04 configuration tab', () => {
  /** B back to its known state (name, max quantity 5) before a test edits it; returns the saved agent */
  async function resetB(request: APIRequestContext) {
    await patchAgent(request, owner, ids.b, { name: NAMES.b, description: null, wizard: { maxQtyPerOrder: 5 } });
    return fullAgent(request, owner, ids.b);
  }
  const patches = (page: Page) => recordRequests(page, 'PATCH', new RegExp(`/agents/${ids.b}$`));

  test('section tabs in the URL, dirty dot + MODIFIÉ + banner, cancel, ONE PATCH with the dirty section and the version, axe', async ({ page, request }) => {
    const b = await resetB(request);
    const sent = patches(page);
    await go(page, agentPath(ids.b, '/configuration'));
    const form = page.getByTestId('agent-configuration');
    await expect(form).toBeVisible(FIRST);
    await expect(sectionTab(page, 'identity')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('#agent-name')).toHaveValue(NAMES.b);
    await expect(saveButton(page)).toHaveText('Enregistrer');
    await expect(saveButton(page)).toBeDisabled();
    await expect(form).toContainText(`version actuelle v${b.currentVersion}`);
    await expectNoA11yViolations(page);

    await clickForUrl(page, sectionTab(page, 'behaviour'), /[?&]section=behaviour$/);
    await expect(sectionTab(page, 'behaviour')).toHaveAttribute('aria-current', 'true');
    await expect(maxQty(page)).toHaveValue('5');
    await load(page, () => page.reload());
    await expect(maxQty(page)).toHaveValue('5', FIRST);

    // dirty: dot on the tab, MODIFIÉ badge, banner, counted save button
    await maxQty(page).fill('8');
    await expect(sectionTab(page, 'behaviour')).toHaveAttribute('data-dirty', 'true');
    await expect(sectionTab(page, 'behaviour').getByLabel('MODIFIÉ')).toBeVisible();
    await expect(sectionTab(page, 'identity')).not.toHaveAttribute('data-dirty', 'true');
    await expect(page.locator('[data-section="capabilities"]').getByText('MODIFIÉ', { exact: true })).toBeVisible();
    await expect(page.getByTestId('config-dirty')).toContainText('Modifications non enregistrées dans Comportement.');
    await expect(saveButton(page)).toHaveText('Enregistrer (1 section modifiée)');
    await expect(form).toHaveAttribute('data-dirty', '1');

    // Annuler les modifications
    await page.getByRole('button', { name: 'Annuler les modifications' }).click();
    await expect(maxQty(page)).toHaveValue('5');
    await expect(page.getByTestId('config-dirty')).toHaveCount(0);
    await expect(sectionTab(page, 'behaviour')).not.toHaveAttribute('data-dirty', 'true');
    await expect(saveButton(page)).toBeDisabled();

    // save: one PATCH, only the section that changed, with the optimistic-lock version
    await maxQty(page).fill('8');
    await saveButton(page).click();
    await expect(toast(page, `Version v${b.currentVersion + 1} créée`)).toBeVisible();
    expect(sent).toHaveLength(1);
    const body = bodyOf(sent[0]!);
    expect(body.version).toBe(b.version);
    expect((body.wizard as { maxQtyPerOrder: number }).maxQtyPerOrder).toBe(8);
    // nothing of Identité / Connaissances travels with it
    expect(Object.keys(body)).not.toContain('name');
    expect(Object.keys(body)).not.toContain('description');
    for (const k of ['displayName', 'languages', 'tone', 'policies', 'catalogScope']) expect(Object.keys(body.wizard as object)).not.toContain(k);
    await expect(page.getByTestId('agent-version')).toHaveText(new RegExp(`^V${b.currentVersion + 1} · `));
    await expect(page.getByTestId('config-dirty')).toHaveCount(0);
    await expect(saveButton(page)).toHaveText('Enregistrer');
    await expect(maxQty(page)).toHaveValue('8');
    await expect(form).toContainText(`version actuelle v${b.currentVersion + 1}`);
    const saved = await fullAgent(request, owner, ids.b);
    expect(saved.wizard.maxQtyPerOrder).toBe(8);
    expect(saved.currentVersion).toBe(b.currentVersion + 1);
  });

  test('validation: max quantity 0 ⇒ summary + inline error, nothing sent; empty name ⇒ switches to the first invalid section', async ({ page, request }) => {
    await resetB(request);
    const sent = patches(page);
    await go(page, agentPath(ids.b, '/configuration', '?section=behaviour'));
    await expect(maxQty(page)).toHaveValue('5', FIRST);
    await maxQty(page).fill('0');
    await saveButton(page).click();
    const summary = page.getByTestId('validation-summary');
    await expect(summary).toContainText('Validation : 1 erreur');
    await expect(summary).toContainText(/La quantité max doit être ≥ 1 \(et ≤ 1\s?000\)\./);
    await expect(maxQty(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-section="order"]').getByRole('alert')).toContainText('La quantité max doit être ≥ 1');
    expect(sent).toHaveLength(0);
    // fixing the field clears its error
    await maxQty(page).fill('6');
    await expect(summary).toHaveCount(0);
    await page.getByRole('button', { name: 'Annuler les modifications' }).click();

    // the name is emptied in Identité, the save is asked from another section
    await clickForUrl(page, sectionTab(page, 'identity'), /section=/, false);
    await page.locator('#agent-name').fill('');
    await clickForUrl(page, sectionTab(page, 'behaviour'), /section=behaviour/);
    await expect(sectionTab(page, 'identity')).toHaveAttribute('data-dirty', 'true');
    await clickForUrl(page, saveButton(page), /section=/, false);
    await expect(sectionTab(page, 'identity')).toHaveAttribute('aria-current', 'true');
    await expect(summary).toContainText('Le nom interne est requis.');
    await expect(page.locator('#agent-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-section="identity"]').getByRole('alert')).toContainText('Le nom interne est requis.');
    expect(sent).toHaveLength(0);
    expect((await fullAgent(request, owner, ids.b)).name).toBe(NAMES.b);
  });

  test('409 CONFLICT ⇒ "Modifié par quelqu\'un d\'autre"; Recharger keeps my section and takes their other values; second save succeeds', async ({ page, request }) => {
    const b = await resetB(request);
    const sent = patches(page);
    await go(page, agentPath(ids.b, '/configuration', '?section=behaviour'));
    await expect(maxQty(page)).toHaveValue('5', FIRST);
    await maxQty(page).fill('8');
    await expect(saveButton(page)).toHaveText('Enregistrer (1 section modifiée)');

    // a colleague saves another section in the meantime: the server is one version ahead
    await patchAgent(request, colleague, ids.b, { name: `${NAMES.b} (Nadia)` });
    await saveButton(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: "Modifié par quelqu'un d'autre" })).toBeVisible();
    await expect(dialog).toContainText('CONFLICT (409) · Nadia Ferhat il y a');
    await expect(dialog).toContainText('votre brouillon est conservé.');
    expect(sent.map((r) => bodyOf(r).version)).toEqual([b.version]);
    // nothing of mine was written
    expect((await fullAgent(request, owner, ids.b)).wizard.maxQtyPerOrder).toBe(5);

    await dialog.getByRole('button', { name: 'Recharger', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: `${NAMES.b} (Nadia)`, level: 1 })).toBeVisible();
    await expect(maxQty(page)).toHaveValue('8');
    await expect(saveButton(page)).toHaveText('Enregistrer (1 section modifiée)');
    await expect(sectionTab(page, 'identity')).not.toHaveAttribute('data-dirty', 'true');
    await clickForUrl(page, sectionTab(page, 'identity'), /section=/, false);
    await expect(page.locator('#agent-name')).toHaveValue(`${NAMES.b} (Nadia)`);

    await saveButton(page).click();
    await expect(toast(page, `Version v${b.currentVersion + 2} créée`)).toBeVisible();
    expect(sent.map((r) => bodyOf(r).version)).toEqual([b.version, b.version + 1]);
    expect(Object.keys(bodyOf(sent[1]!))).not.toContain('name');
    const saved = await fullAgent(request, owner, ids.b);
    expect(saved.wizard.maxQtyPerOrder).toBe(8);
    expect(saved.name).toBe(`${NAMES.b} (Nadia)`);
    await expect(saveButton(page)).toBeDisabled();
  });

  test('409 CONFLICT ⇒ Écraser resends my section on the fresh version', async ({ page, request }) => {
    const b = await resetB(request);
    const sent = patches(page);
    await go(page, agentPath(ids.b, '/configuration', '?section=behaviour'));
    await expect(maxQty(page)).toHaveValue('5', FIRST);
    await maxQty(page).fill('9');
    await patchAgent(request, colleague, ids.b, { description: 'Répond sur Instagram' });
    await saveButton(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: "Modifié par quelqu'un d'autre" })).toBeVisible();
    await dialog.getByRole('button', { name: 'Écraser', exact: true }).click();
    await expect(toast(page, `Version v${b.currentVersion + 2} créée`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(sent.map((r) => bodyOf(r).version)).toEqual([b.version, b.version + 1]);
    expect((bodyOf(sent[1]!).wizard as { maxQtyPerOrder: number }).maxQtyPerOrder).toBe(9);
    const saved = await fullAgent(request, owner, ids.b);
    expect(saved.wizard.maxQtyPerOrder).toBe(9);
    await expect(maxQty(page)).toHaveValue('9');
    await expect(page.getByTestId('config-dirty')).toHaveCount(0);
  });

  test('leave guard: dirty + "Vue d\'ensemble" ⇒ "Quitter sans enregistrer ?" (Rester keeps the edit, Quitter leaves)', async ({ page, request }) => {
    await resetB(request);
    await go(page, agentPath(ids.b, '/configuration', '?section=behaviour'));
    await expect(maxQty(page)).toHaveValue('5', FIRST);
    await maxQty(page).fill('8');
    await expect(page.getByTestId('config-dirty')).toBeVisible();
    await tabs(page).getByRole('link', { name: "Vue d'ensemble" }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog.getByRole('heading', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
    await expect(dialog).toContainText(`Vous avez des modifications non enregistrées sur « ${NAMES.b} ».`);
    await dialog.getByRole('button', { name: 'Rester', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/configuration\?section=behaviour$/);
    await expect(maxQty(page)).toHaveValue('8');

    // the guard is asked again when the navigation was dropped (hot reload of the shared dev server)
    await expect(async () => {
      if (page.url().endsWith(`/agents/${ids.b}`)) return;
      await tabs(page).getByRole('link', { name: "Vue d'ensemble" }).click({ timeout: 5000 });
      await dialog.getByRole('button', { name: 'Quitter', exact: true }).click({ timeout: 5000 });
      await expect(page).toHaveURL(new RegExp(`/agents/${ids.b}$`), { timeout: 40_000 });
    }).toPass({ timeout: 150_000 });
    await expect(page.getByTestId('agent-summary')).toBeVisible(FIRST);
    expect((await fullAgent(request, owner, ids.b)).wizard.maxQtyPerOrder).toBe(5);
  });

  test('channels section: pages with their states, "Déplacer ici" asks before moving a page', async ({ page, request }) => {
    const channels = await (await request.get(`${API}/channels`, { headers: authHeaders(owner) })).json();
    const fb1 = (channels.data as { id: string; counts: { conversations: number } }[]).find((c) => c.id === shop.facebook.id)!;
    // mock: a page whose Meta token was revoked (`needs_reconnect`) — the fake Meta adapter cannot revoke over HTTP
    await patchAnswer(page, /\/api\/v1\/channels(\?|$)/, (rows: { id: string; status: string }[]) => rows.map((c) => (c.id === shop.facebook2.id ? { ...c, status: 'needs_reconnect' } : c)));
    const puts = recordRequests(page, 'PUT', new RegExp(`/channels/${shop.facebook.id}/agent$`));
    try {
      await go(page, agentPath(ids.b, '/configuration', '?section=channels'));
      const option = (id: string) => page.locator(`[data-testid="channel-option"][data-channel="${id}"]`);
      await expect(page.getByTestId('channel-option')).toHaveCount(3, FIRST);
      await expect(sectionTab(page, 'channels')).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('[data-section="channels"]')).toHaveAttribute('data-selected', '1');
      await expect(page.getByText("Une page ne peut avoir qu'un seul agent.", { exact: false })).toBeVisible();

      await expect(option(shop.instagram.id)).toHaveAttribute('data-state', 'selected');
      await expect(option(shop.instagram.id)).toContainText('SÉLECTIONNÉE');
      await expect(option(shop.instagram.id).getByRole('checkbox', { name: `Cet agent répond sur ${shop.instagram.name}` })).toBeChecked();
      await expect(option(shop.facebook.id)).toHaveAttribute('data-state', 'linked_elsewhere');
      await expect(option(shop.facebook.id)).toContainText(`LIÉE À « ${NAMES.a} »`);
      await expect(option(shop.facebook.id)).toContainText(new RegExp(`FACEBOOK · ${fb1.counts.conversations} conversations · ACTIVE`));
      await expect(option(shop.facebook2.id)).toHaveAttribute('data-state', 'reconnect');
      await expect(option(shop.facebook2.id)).toContainText('À RECONNECTER');
      await expect(option(shop.facebook2.id).getByRole('checkbox')).toBeDisabled();
      await expect(option(shop.facebook2.id).getByRole('link', { name: 'Reconnecter' })).toHaveAttribute('href', `/fr/channels/${shop.facebook2.id}`);
      await expect(page.locator('[data-section="channels"]')).toContainText("Le changement s'applique aux nouvelles conversations.");
      // the section writes at once: it never makes the form dirty
      await expect(saveButton(page)).toBeDisabled();

      await option(shop.facebook.id).getByTestId('channel-move').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: `Déplacer « ${shop.facebook.name} » vers « ${NAMES.b} » ?` })).toBeVisible();
      await expect(dialog.getByTestId('move-dialog')).toContainText(`« ${NAMES.a} » ne répondra plus sur cette page.`);
      expect(puts).toHaveLength(0);
      await dialog.getByTestId('move-confirm').click();
      await expect(toast(page, `« ${shop.facebook.name} » rattachée à ${NAMES.b}`)).toBeVisible();
      expect(puts.map(bodyOf)).toEqual([{ agentId: ids.b, move: true }]);
      await expect(option(shop.facebook.id)).toHaveAttribute('data-state', 'selected');
      await expect(page.locator('[data-section="channels"]')).toHaveAttribute('data-selected', '2');
      await expect(page.getByTestId('agent-facts')).toContainText(fbLabel());
      expect((await fullAgent(request, owner, ids.b)).channels.map((c) => c.id).sort()).toEqual([shop.facebook.id, shop.instagram.id].sort());
    } finally {
      // the page goes back to "Vendeur" for the playground tests
      await linkPage(request, owner, shop.facebook.id, ids.a);
    }
  });
});

test.describe('AGT-08 insights tab', () => {
  const row = (page: Page, type: string) => page.locator(`[data-insight][data-type="${type}"]`);
  const pendingOf = (request: APIRequestContext, grouped = true) => insightsOf(request, owner, `?agentId=${ids.e}&status=pending&groupByTopic=${grouped}&pageSize=50`);

  test('AT-AGT-07 tabs with counts, type filter and "Regrouper par sujet" in the URL; rows show pill, n ×, Client / IA / Cause; axe', async ({ page, request }) => {
    const heads = await pendingOf(request);
    expect(heads.map((i) => i.type).sort()).toEqual(['error', 'handoff', 'unclear', 'unknown_topic']);
    const unknown = heads.find((i) => i.type === 'unknown_topic')! as RealInsight & { aiResponse: string; occurrences: number };
    expect(unknown.occurrences).toBe(2);
    const e = await fullAgent(request, owner, ids.e);
    expect(e.pendingInsights).toBe(5);

    await go(page, agentPath(ids.e, '/insights'));
    const root = page.getByTestId('agent-insights');
    await expect(page.locator('[data-insight]')).toHaveCount(4, FIRST);
    await expect(root).toHaveAttribute('data-status', 'pending');
    await expect(tabs(page).getByRole('link', { name: /^Insights/ })).toHaveAttribute('aria-current', 'page');
    await expect(tabs(page).getByRole('link', { name: /^Insights/ })).toHaveText('Insights5');
    // M8 carry-over: the three tab counts come from `meta.counts` (every pending insight, like the "Insights 5" badge), not from the grouped heads
    await expect(page.getByRole('radio', { name: 'En attente 5' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /^Résolus/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Ignorés/ })).toBeVisible();

    const first = row(page, 'unknown_topic');
    await expect(first).toContainText('SUJET INCONNU');
    await expect(first).toContainText('2 ×');
    await expect(first).toContainText(`Client : « ${INSIGHT_TRIGGERS.unknown_topic} »`);
    await expect(first).toContainText(`IA : « ${unknown.aiResponse} »`);
    await expect(first).toContainText('Cause : question hors catalogue');
    await expect(first.getByRole('link', { name: 'Voir la conversation' })).toHaveAttribute('href', `/fr/inbox/${unknown.conversationId}`);
    await expect(row(page, 'handoff')).toContainText('TRANSFERT');
    await expect(row(page, 'handoff')).toContainText('Cause : le client demande un humain');
    await expect(row(page, 'unclear')).toContainText('Client : « ?? »');
    await expect(row(page, 'error')).toContainText('ERREUR IA');
    await expect(row(page, 'error')).toContainText('IA : (aucune réponse)');
    await expect(row(page, 'error')).toContainText('Cause : mot bloqué · satin');
    await expectNoA11yViolations(page);

    // "Regrouper par sujet" is on by default; off ⇒ ?group=0 and groupByTopic=false
    const group = page.getByRole('button', { name: 'Regrouper par sujet' });
    await expect(group).toHaveAttribute('aria-pressed', 'true');
    const ungrouped = page.waitForRequest((r) => r.url().includes('/agent-insights?') && new URL(r.url()).searchParams.get('groupByTopic') === 'false');
    await clickForUrl(page, group, /[?&]group=0(&|$)/);
    const sent = new URL((await ungrouped).url()).searchParams;
    expect(sent.get('agentId')).toBe(ids.e);
    expect(sent.get('status')).toBe('pending');
    await expect(group).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-insight]')).toHaveCount(5);
    await expect(row(page, 'unknown_topic')).toHaveCount(2);
    await expect(row(page, 'unknown_topic').first()).not.toContainText('2 ×');
    await clickForUrl(page, group, /group=/, false);
    await expect(page.locator('[data-insight]')).toHaveCount(4);
    await expect(first).toContainText('2 ×');

    // type filter
    await page.getByRole('button', { name: 'Type : tous' }).click();
    const typed = page.waitForRequest((r) => r.url().includes('/agent-insights?') && new URL(r.url()).searchParams.get('type') === 'error');
    await clickForUrl(page, page.getByRole('checkbox', { name: 'erreur IA' }), /[?&]type=error(&|$)/);
    await typed;
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-insight]')).toHaveCount(1);
    await expect(row(page, 'error')).toBeVisible();

    // status tabs
    await clickForUrl(page, page.getByRole('radio', { name: /^Résolus/ }), /[?&]status=resolved(&|$)/);
    await expect(root).toHaveAttribute('data-status', 'resolved');
    // filtered-empty: no resolved insight of type "erreur IA"
    await expect(page.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
    await expect(page.getByText('Aucun(e) insight ne correspond à « erreur IA ».')).toBeVisible();
    await clickForUrl(page, page.getByRole('button', { name: 'Effacer les filtres' }), /type=/, false);
    await expect(page).toHaveURL(/[?&]status=resolved(&|$)/);
    const resolved = page.locator(`[data-insight="${seeded.tablette}"]`);
    await expect(page.locator('[data-insight]')).toHaveCount(1);
    await expect(resolved).toContainText('Client : « chhal le prix de la tablette ? »');
    await expect(resolved).toContainText('FAQ créée');
    await expect(resolved.getByTestId('insight-resolve')).toHaveCount(0);

    await clickForUrl(page, page.getByRole('radio', { name: /^Ignorés/ }), /[?&]status=dismissed(&|$)/);
    await expect(page.locator(`[data-insight="${seeded.ok}"]`)).toContainText('Ignoré 30 j');
    // the filters survive a reload
    await load(page, () => page.reload());
    await expect(page.getByRole('radio', { name: /^Ignorés/ })).toHaveAttribute('aria-checked', 'true', FIRST);
    await expect(page.locator(`[data-insight="${seeded.ok}"]`)).toBeVisible();
  });

  test('AT-AGT-07 Résoudre: instruction (required) posts {action:"instruction"}, FAQ needs question + answer, Ignorer posts ignored_30d', async ({ page, request }) => {
    const heads = await pendingOf(request);
    const id = (type: string) => heads.find((i) => i.type === type)!.id;
    const unknown = heads.find((i) => i.type === 'unknown_topic')! as RealInsight & { aiResponse: string };
    const sent = recordRequests(page, 'POST', /\/agent-insights\/[0-9a-f-]{36}\/resolve$/);
    const sentTo = (insight: string) => sent.filter((r) => r.url().includes(insight)).map(bodyOf);
    const before = await fullAgent(request, owner, ids.e);

    await go(page, agentPath(ids.e, '/insights'));
    await expect(page.locator('[data-insight]')).toHaveCount(4, FIRST);
    await expect(tabs(page).getByRole('link', { name: /^Insights/ })).toHaveText('Insights5');
    const dialog = page.getByRole('dialog');

    // instruction
    await page.locator(`[data-insight="${id('unknown_topic')}"]`).getByTestId('insight-resolve').click();
    await expect(dialog.getByRole('heading', { name: "Résoudre l'insight" })).toBeVisible();
    await expect(dialog).toContainText('Type : sujet inconnu · 2 fois');
    await expect(dialog).toContainText(`Client : « ${INSIGHT_TRIGGERS.unknown_topic} » → IA : « ${unknown.aiResponse} »`);
    await expect(dialog.getByRole('radio', { name: /Ajouter une instruction à l'agent/ })).toHaveAttribute('aria-checked', 'true');
    await dialog.getByTestId('resolve-insight-submit').click();
    await expect(dialog.getByText('Champ requis')).toBeVisible();
    await expect(dialog.locator('#insight-instruction')).toHaveAttribute('aria-invalid', 'true');
    expect(sent).toHaveLength(0);
    await dialog.locator('#insight-instruction').fill('Nous ne vendons pas de téléphones ; proposer le catalogue.');
    await dialog.getByTestId('resolve-insight-submit').click();
    await expect(toast(page, "Instruction ajoutée à l'agent · nouvelle version")).toBeVisible();
    expect(sentTo(id('unknown_topic'))).toEqual([{ action: 'instruction', instruction: 'Nous ne vendons pas de téléphones ; proposer le catalogue.' }]);
    await expect(dialog).toHaveCount(0);
    // the whole topic leaves the list (both occurrences)
    await expect(page.locator(`[data-insight="${id('unknown_topic')}"]`)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'En attente 3' })).toBeVisible();
    await expect(tabs(page).getByRole('link', { name: /^Insights/ })).toHaveText('Insights3');
    // "- …" appended to the instructions, new version (AT-AGT-07)
    const after = await fullAgent(request, owner, ids.e);
    expect(after.customInstructions).toMatch(/- Nous ne vendons pas de téléphones ; proposer le catalogue\.$/);
    expect(after.currentVersion).toBe(before.currentVersion + 1);
    await expect(page.getByTestId('agent-version')).toHaveText(new RegExp(`^V${after.currentVersion} · `));

    // FAQ: the question is prefilled with the customer message; both fields are required
    await page.locator(`[data-insight="${id('unclear')}"]`).getByTestId('insight-resolve').click();
    await dialog.getByRole('radio', { name: /Créer une FAQ/ }).click();
    await expect(dialog.locator('#insight-question')).toHaveValue('??');
    await expect(dialog.locator('#insight-instruction')).toHaveCount(0);
    await dialog.locator('#insight-question').fill('');
    await dialog.getByTestId('resolve-insight-submit').click();
    await expect(dialog.getByText('Champ requis')).toHaveCount(2);
    expect(sentTo(id('unclear'))).toHaveLength(0);
    await dialog.locator('#insight-question').fill('Vous avez la même couleur que la dernière fois ?');
    await dialog.locator('#insight-answer').fill('Oui, indiquez la référence ou envoyez une photo.');
    await dialog.getByTestId('resolve-insight-submit').click();
    await expect(toast(page, 'FAQ créée')).toBeVisible();
    expect(sentTo(id('unclear'))).toEqual([{ action: 'faq', question: 'Vous avez la même couleur que la dernière fois ?', answer: 'Oui, indiquez la référence ou envoyez une photo.' }]);
    await expect(page.locator(`[data-insight="${id('unclear')}"]`)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'En attente 2' })).toBeVisible();

    // "Ignorer" of a row: no dialog
    await page.locator(`[data-insight="${id('handoff')}"]`).getByTestId('insight-ignore').click();
    await expect(toast(page, 'Insight ignoré pendant 30 jours')).toBeVisible();
    expect(sentTo(id('handoff'))).toEqual([{ action: 'ignored_30d' }]);
    await expect(page.locator(`[data-insight="${id('handoff')}"]`)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'En attente 1' })).toBeVisible();
    // one row left: no bulk action
    await expect(page.getByTestId('insights-dismiss-all')).toHaveCount(0);
    expect((await insightsOf(request, owner, `?agentId=${ids.e}&status=dismissed&pageSize=50`)).map((i) => i.id)).toContain(id('handoff'));
  });

  test('INSIGHT_ALREADY_RESOLVED ⇒ info toast and the row leaves (row action and dialog); "Ignorer tout" in bulk', async ({ page, request }) => {
    // four fresh topics on the page of E (two off-catalogue questions, two unclear messages)
    const fresh = ['chhal le prix du laptop ?', 'hm ?', 'chhal le prix de la console ?', 'chhal le prix du drone ?'];
    for (const text of fresh) await inject(request, owner, { channelId: shop.facebook2.id, sender: nextSender(), text });
    await expect.poll(async () => (await pendingOf(request)).length, { timeout: 90_000 }).toBeGreaterThanOrEqual(5);
    const heads = await pendingOf(request);
    const byText = (t: string) => heads.find((i) => i.customerMessage === t)!.id;
    const laptop = byText('chhal le prix du laptop ?');
    const hm = byText('hm ?');

    await go(page, agentPath(ids.e, '/insights'));
    await expect(page.locator('[data-insight]')).toHaveCount(heads.length, FIRST);
    /** the colleague resolves the insight just before the page's own request reaches the API: the real answer is 422 */
    const colleagueFirst = async (insightId: string, body: Record<string, unknown>) =>
      page.route(new RegExp(`/api/v1/agent-insights/${insightId}/resolve$`), async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await resolveInsight(request, colleague, insightId, body);
        await route.continue();
      });

    // "Ignorer" of the row
    await colleagueFirst(laptop, { action: 'product' });
    await page.locator(`[data-insight="${laptop}"]`).getByTestId('insight-ignore').click();
    await expect(page.locator('[data-toast="info"]').filter({ hasText: 'Déjà traité.' })).toBeVisible();
    await expect(page.locator(`[data-insight="${laptop}"]`)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: `En attente ${heads.length - 1}` })).toBeVisible();

    // same answer from the dialog: it closes, the list is refreshed
    await colleagueFirst(hm, { action: 'ignored_30d' });
    await page.locator(`[data-insight="${hm}"]`).getByTestId('insight-resolve').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText("Si un collègue l'a déjà traité");
    await dialog.locator('#insight-instruction').fill('Demander la référence du produit.');
    await dialog.getByTestId('resolve-insight-submit').click();
    await expect(page.locator('[data-toast="info"]').filter({ hasText: 'Déjà traité.' }).first()).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(`[data-insight="${hm}"]`)).toHaveCount(0);
    const left = heads.length - 2;
    await expect(page.getByRole('radio', { name: `En attente ${left}` })).toBeVisible();
    // what the colleague did stays
    expect((await insightsOf(request, owner, `?agentId=${ids.e}&status=resolved&pageSize=50`)).map((i) => i.id)).toContain(laptop);

    // bulk
    const bulk = recordRequests(page, 'POST', /\/agent-insights\/bulk\/dismiss$/);
    await expect(page.getByTestId('insights-dismiss-all')).toHaveText(`Ignorer tout (${left})`);
    await page.getByTestId('insights-dismiss-all').click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(confirm.getByRole('heading', { name: `Ignorer ${left} insights ?` })).toBeVisible();
    await expect(confirm).toContainText('ne plus signaler ce sujet 30 j');
    await confirm.getByRole('button', { name: 'Ignorer', exact: true }).click();
    await expect(toast(page, `${left} insights ignorés`)).toBeVisible();
    expect(((bodyOf(bulk[0]!).ids as string[]) ?? []).sort()).toEqual(heads.filter((i) => i.id !== laptop && i.id !== hm).map((i) => i.id).sort());
    await expect(page.getByRole('heading', { name: "Aucun insight en attente — votre agent s'en sort bien 🎉" })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'En attente 0' })).toBeVisible();
    expect(await pendingOf(request)).toHaveLength(0);
  });

  test('empty state "Aucun insight en attente" with a link to the resolved tab', async ({ page, request }) => {
    // B answers on Instagram, where no customer wrote: it never had an insight
    expect(await insightsOf(request, owner, `?agentId=${ids.b}&pageSize=50`)).toHaveLength(0);
    await go(page, agentPath(ids.b, '/insights'));
    await expect(page.getByRole('heading', { name: "Aucun insight en attente — votre agent s'en sort bien 🎉" })).toBeVisible(FIRST);
    await expect(page.getByText("Les problèmes rencontrés par l'agent apparaîtront ici et dans Accueil › À faire.")).toBeVisible();
    await expect(page.getByTestId('insights-list')).toHaveCount(0);
    await expect(page.getByTestId('insights-dismiss-all')).toHaveCount(0);
    await expect(tabs(page).getByRole('link', { name: /^Insights/ })).toHaveText('Insights0');
    await expect(page.getByText("Les insights apparaissent aussi dans la File d'attente (compteur).")).toBeVisible();
    await clickForUrl(page, page.getByRole('button', { name: 'Résolus', exact: true }), /[?&]status=resolved(&|$)/);
    await expect(page.getByRole('heading', { name: "Aucun insight résolu pour l'instant." })).toBeVisible();
  });
});

test.describe('AGT-07 playground', () => {
  type Turn = { turnId: string; sessionId: string; reply: string; status: string; statusDetail: string | null; intent: string; confidence: number; model: string; tokens: { input: number; output: number }; latencyMs: number; toolCalls: { name: string; simulated: boolean; result: unknown }[]; cards: { productId: string; name: string; price: number }[]; creditsInProd: number; language: string; promptPreview: string[]; systemMessages: { key: string; text: string }[] };
  const TEST_URL = () => new RegExp(`/api/v1/agents/${ids.a}/test$`);
  const turnOf = (page: Page) => page.waitForResponse((r) => TEST_URL().test(new URL(r.url()).pathname) && r.request().method() === 'POST').then(async (r) => ((await r.json()) as { data: Turn }).data);
  const tests = (page: Page) => recordRequests(page, 'POST', TEST_URL());
  const cardsLabel = (n: number) => (n === 0 ? 'aucun produit' : n === 1 ? '1 produit' : `${n} produits`);
  const toolsLabel = (n: number, simulated: number) => `${n === 0 ? 'aucun appel' : n === 1 ? '1 appel' : `${n} appels`} · ${simulated} simulé(s)`;

  test('AT-AI-17 empty state + simulation banner; a turn shows the tool chip, the reply, the real card and fills the inspector; axe', async ({ page, request }) => {
    const a = await fullAgent(request, owner, ids.a);
    const sent = tests(page);
    await go(page, agentPath(ids.a, '/playground'));
    const root = page.getByTestId('agent-playground');
    await expect(root.getByRole('heading', { name: `Bac à essai · ${NAMES.a}` })).toBeVisible(FIRST);
    await expect(root.getByTestId('model-badge')).toHaveText(a.model.label);
    const banner = page.getByTestId('playground-banner');
    await expect(banner).toContainText('SIMULATION');
    await expect(banner).toContainText('Aucun crédit consommé · les commandes créées ici sont simulées (TEST-n).');
    await expect(page.getByTestId('playground-turns')).toHaveText('0 tours · limite 60 / h');
    await expect(page.getByTestId('playground-thread')).toContainText('Écrivez comme un client (darija, arabizi, français) ou lancez un scénario');
    await expect(inspectorRow(page, 'empty')).toContainText('Envoyez un message pour voir le détail du tour.');
    await expect(page.locator('[data-scenario]')).toHaveCount(8);
    await expect(page.getByTestId('playground-send')).toBeDisabled();
    await expect(page.getByTestId('playground-reset')).toBeDisabled();
    await expect(page.getByTestId('playground-export')).toBeDisabled();
    await expect(page.getByTestId('turn-add-instruction')).toHaveCount(0);
    await expectNoA11yViolations(page);

    const answered = turnOf(page);
    await say(page, 'chhal le prix de la robe satin ?');
    const turn = await answered;
    expect(turn.status).toBe('OK');
    expect(turn.toolCalls.map((t) => t.name)).toEqual(['search_products']);
    expect(turn.cards.map((c) => c.name)).toContain('Robe satin');
    const thread = page.getByTestId('playground-thread');
    await expect(thread.locator('[data-message="customer"]')).toContainText('chhal le prix de la robe satin ?');
    await expect(thread.locator('[data-message="customer"]')).toContainText('VOUS (CLIENTE SIMULÉE)');
    const chip = thread.locator('[data-tool="search_products"]');
    await expect(chip).toBeVisible();
    await expect(chip).not.toHaveAttribute('data-simulated', 'true');
    await expect(chip).toContainText('OUTIL');
    await expect(chip).not.toContainText('(simulé)');
    const ai = thread.locator('[data-message="ai"]');
    await expect(ai).toContainText(turn.reply);
    await expect(ai).toContainText(`${NAMES.a} · OK · ${turn.intent.toUpperCase()} · ${confidence(turn.confidence)}`);
    await expect(thread.getByTestId('playground-turn')).toHaveAttribute('data-status', 'OK');
    const cards = thread.getByRole('list', { name: 'Cartes produit' });
    await expect(cards.getByRole('listitem')).toHaveCount(turn.cards.length);
    const robe = cards.getByRole('listitem').filter({ hasText: 'Robe satin' });
    await expect(robe).toContainText(/4\s900\sDA/);
    await expect(robe).toContainText('CARTE RÉELLE');

    await expect(inspectorRow(page, 'status')).toContainText('OK');
    await expect(inspectorRow(page, 'intent')).toContainText(`${turn.intent.toUpperCase()} · confiance ${confidence(turn.confidence)}`);
    await expect(inspectorRow(page, 'model')).toContainText(turn.model);
    await expect(inspectorRow(page, 'tokens')).toContainText(new RegExp(`${numRe(turn.tokens.input)} entrée · ${numRe(turn.tokens.output)} sortie`));
    await expect(inspectorRow(page, 'latency')).toContainText(seconds(turn.latencyMs));
    await expect(inspectorRow(page, 'tools')).toContainText(toolsLabel(1, 0));
    await expect(inspectorRow(page, 'credits')).toContainText(`0 (bac à essai) · en prod : ${turn.creditsInProd}`);
    await expect(inspectorRow(page, 'cards')).toContainText(cardsLabel(turn.cards.length));
    await expect(inspectorRow(page, 'language')).toContainText(turn.language);
    await expect(page.getByTestId('prompt-preview').getByRole('listitem')).toHaveCount(turn.promptPreview.length);
    await expect(page.getByTestId('playground-turns')).toHaveText('1 tours · limite 60 / h');
    await expect(composer(page)).toHaveValue('');

    // the API is stateless: the session id and the whole history travel with every turn
    await say(page, 'ch7al livraison l Setif ?');
    await expect(thread.locator('[data-message="ai"]')).toHaveCount(2);
    await expect.poll(() => sent.length).toBe(2);
    const [b1, b2] = sent.map(bodyOf);
    expect(b1!.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(b1!.messages).toEqual([{ role: 'user', text: 'chhal le prix de la robe satin ?' }]);
    expect(b2!.sessionId).toBe(b1!.sessionId);
    expect(b2!.messages).toEqual([
      { role: 'user', text: 'chhal le prix de la robe satin ?' },
      { role: 'assistant', text: turn.reply },
      { role: 'user', text: 'ch7al livraison l Setif ?' },
    ]);
    await expect(page.getByTestId('playground-turns')).toHaveText('2 tours · limite 60 / h');

    // Réinitialiser: empty thread, new session
    await page.getByTestId('playground-reset').click();
    await expect(thread.locator('[data-message]')).toHaveCount(0);
    await expect(page.getByTestId('playground-turns')).toHaveText('0 tours · limite 60 / h');
    await expect(inspectorRow(page, 'empty')).toBeVisible();
    await expect(thread).toContainText('Écrivez comme un client');
    await say(page, 'salam');
    await expect.poll(() => sent.length).toBe(3);
    const b3 = bodyOf(sent[2]!);
    expect(b3.messages).toEqual([{ role: 'user', text: 'salam' }]);
    expect(b3.sessionId).not.toBe(b1!.sessionId);
    await expect(thread.locator('[data-message="ai"]')).toHaveCount(1);
  });

  test('AT-AI-16 a simulated create_order is flagged "(simulé)" with TEST-n; AT-AI-10 a handoff shows HANDOFF and the system message', async ({ page }) => {
    // mock: M4 has no HTTP route that writes a delivery-fee rule, so the dry-run create_order of the real turn stops at
    // the wilaya check (WILAYA_NOT_SERVED ⇒ handoff). The real turn is kept and only its create_order result is given
    // the dry-run shape the tool returns once the wilaya is served (tool-registry `createOrder`, `ctx.dryRun`).
    let realOrderCall = false;
    await page.route(TEST_URL(), async (route) => {
      if (route.request().method() !== 'POST' || !JSON.stringify(route.request().postDataJSON()).includes('je confirme')) return route.fallback();
      const res = await route.fetch();
      const json = (await res.json()) as { data: Turn };
      const call = json.data.toolCalls.find((t) => t.name === 'create_order');
      realOrderCall = !!call;
      if (!call) return route.fulfill({ response: res, json });
      const simulated = { ok: true, orderId: null, number: 'TEST-4821', simulated: true, subtotal: 4900, deliveryFee: 400, total: 5300, items: [{ name: 'Robe satin', variant: null, quantity: 1, unitPrice: 4900 }], duplicateOf: null, paymentOptions: ['cod'] };
      const data = { ...json.data, reply: 'Votre commande TEST-4821 est enregistrée. Total : 5300 DA.', status: 'OK', statusDetail: null, intent: 'sale', toolCalls: [{ ...call, result: simulated, simulated: true }], cards: [], systemMessages: json.data.systemMessages.filter((m) => m.key !== 'handoff') };
      return route.fulfill({ response: res, json: { ...json, data } });
    });
    await go(page, agentPath(ids.a, '/playground'));
    await expect(page.getByTestId('playground-banner')).toBeVisible(FIRST);
    const thread = page.getByTestId('playground-thread');

    await say(page, 'Amina, 0555123456, Sétif, je confirme');
    const order = thread.locator('[data-tool="create_order"]');
    await expect(order).toHaveAttribute('data-simulated', 'true');
    expect(realOrderCall).toBe(true);
    await expect(order).toContainText('create_order (simulé)');
    await expect(order).toContainText('TEST-4821');
    await expect(thread.locator('[data-message="ai"]')).toContainText('TEST-4821');
    await expect(inspectorRow(page, 'tools')).toContainText(toolsLabel(1, 1));
    await expect(inspectorRow(page, 'cards')).toContainText('aucun produit');
    await expect(inspectorRow(page, 'credits')).toContainText('0 (bac à essai)');
    await expect(thread.getByRole('list', { name: 'Cartes produit' })).toHaveCount(0);
    // the chip folds
    await order.getByRole('button', { name: "Détail de l'outil create_order" }).click();
    await expect(order).not.toContainText('TEST-4821');

    // a real handoff turn
    const answered = turnOf(page);
    await say(page, 'je veux un remboursement');
    const turn = await answered;
    expect(turn).toMatchObject({ status: 'HANDOFF', statusDetail: 'refund' });
    const handoffText = turn.systemMessages.find((m) => m.key === 'handoff');
    expect(handoffText, 'the workspace handoff text').toBeTruthy();
    const second = thread.getByTestId('playground-turn').nth(1);
    await expect(second).toHaveAttribute('data-status', 'HANDOFF');
    await expect(second.locator('[data-message="ai"]')).toContainText('Je transmets votre demande à un conseiller.');
    await expect(second.locator('[data-message="ai"]')).toContainText(`${NAMES.a} · HANDOFF · COMPLAINT · ${confidence(turn.confidence)}`);
    await expect(second.locator('[data-message="system"]')).toContainText(`Message système « handoff » : ${handoffText!.text}`);
    await expect(second.locator('[data-tool]')).toHaveCount(0);
    await expect(inspectorRow(page, 'status')).toContainText('HANDOFF');
    await expect(inspectorRow(page, 'intent')).toContainText(`COMPLAINT · confiance ${confidence(turn.confidence)}`);
    await expect(inspectorRow(page, 'tools')).toContainText(toolsLabel(0, 0));
    await expect(inspectorRow(page, 'language')).toContainText(turn.language);
  });

  test('a scenario chip sends {scenario, messages: []}; ?scenario=anger runs it when the tab opens', async ({ page }) => {
    const sent = tests(page);
    await go(page, agentPath(ids.a, '/playground'));
    await expect(page.getByTestId('playground-banner')).toBeVisible(FIRST);
    const thread = page.getByTestId('playground-thread');
    await expect(page.locator('[data-scenario="refund"]')).toHaveText('Remboursement');
    const refund = turnOf(page);
    await page.locator('[data-scenario="refund"]').click();
    await expect(thread.locator('[data-message="customer"]')).toContainText('Remboursement');
    await expect(thread.locator('[data-message="ai"]')).toHaveCount(1);
    expect((await refund).status).toBe('HANDOFF');
    expect(sent).toHaveLength(1);
    const body = bodyOf(sent[0]!);
    expect(body.scenario).toBe('refund');
    expect(body.messages).toEqual([]);
    expect(Object.keys(body).sort()).toEqual(['messages', 'scenario', 'sessionId']);

    // deep link of the wizard / of the scenario list
    sent.length = 0;
    const anger = turnOf(page);
    await load(page, () => page.goto(agentPath(ids.a, '/playground', '?scenario=anger')));
    await expect(thread.locator('[data-message="customer"]')).toContainText('Réclamation (transfert)', FIRST);
    await expect(thread.locator('[data-message="ai"]')).toHaveCount(1);
    expect((await anger).status).toBe('HANDOFF');
    await expect(inspectorRow(page, 'status')).toContainText('HANDOFF');
    // once, also when React mounts the effect twice
    await page.waitForTimeout(1500);
    expect(sent).toHaveLength(1);
    expect(bodyOf(sent[0]!).scenario).toBe('anger');
    expect(bodyOf(sent[0]!).messages).toEqual([]);
    await expect(thread.locator('[data-message="customer"]')).toHaveCount(1);
    await expect(page.getByTestId('playground-turns')).toHaveText('1 tours · limite 60 / h');
  });

  test('AI_PROVIDER_ERROR ⇒ inline error with "Réessayer": the same message is resent once, one customer bubble', async ({ page }) => {
    // mock: the fake AI fails only when scripted in-process (`failModel`); over HTTP a turn always succeeds. The first
    // turn answers the envelope of the API's own failure (worker gave up ⇒ 503 AI_PROVIDER_ERROR), the retry is real.
    let failed = 0;
    await page.route(TEST_URL(), (route) => {
      if (route.request().method() !== 'POST' || failed++) return route.fallback();
      return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': 'http://localhost:3010', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ error: { code: 'AI_PROVIDER_ERROR', message: "L'IA ne répond pas ; la conversation passe en file.", params: {}, fields: {}, details: null, ref: 'e2e-ref' } }) });
    });
    const sent = tests(page);
    await go(page, agentPath(ids.a, '/playground'));
    await expect(page.getByTestId('playground-banner')).toBeVisible(FIRST);
    const thread = page.getByTestId('playground-thread');
    await say(page, 'chhal le prix du foulard soie ?');
    const error = page.getByTestId('playground-error');
    await expect(error).toHaveAttribute('data-code', 'AI_PROVIDER_ERROR');
    await expect(error.getByRole('alert')).toContainText("L'IA ne répond pas ; la conversation passe en file.");
    await expect(page.getByTestId('playground-rate-limited')).toHaveCount(0);
    await expect(composer(page)).toBeEnabled();
    await expect(thread.locator('[data-message="customer"]')).toHaveCount(1);

    const answered = turnOf(page);
    await page.getByTestId('playground-retry').click();
    const turn = await answered;
    await expect(thread.locator('[data-message="ai"]')).toHaveCount(1);
    await expect(error).toHaveCount(0);
    await expect(thread.locator('[data-message="customer"]')).toHaveCount(1);
    await expect(thread.locator('[data-message="customer"]')).toContainText('chhal le prix du foulard soie ?');
    expect(sent).toHaveLength(2);
    // the failed message is not sent twice in the history of the retry
    expect(bodyOf(sent[1]!).messages).toEqual([{ role: 'user', text: 'chhal le prix du foulard soie ?' }]);
    expect(bodyOf(sent[1]!).sessionId).toBe(bodyOf(sent[0]!).sessionId);
    await expect(inspectorRow(page, 'status')).toContainText(turn.status);
    expect(turn.status).toBe('OK');
  });

  test('quick fixes: add an instruction from the turn (PATCH customInstructions "- …"), flag the turn, export the conversation', async ({ page, request }) => {
    await patchAgent(request, owner, ids.a, { customInstructions: 'Toujours saluer la cliente.' });
    const fresh = await fullAgent(request, owner, ids.a);
    const patches = recordRequests(page, 'PATCH', new RegExp(`/agents/${ids.a}$`));
    const flags = recordRequests(page, 'POST', new RegExp(`/agents/${ids.a}/test/flag$`));
    await go(page, agentPath(ids.a, '/playground'));
    await expect(page.getByTestId('playground-banner')).toBeVisible(FIRST);
    const answered = turnOf(page);
    await say(page, 'vous avez des iPhone ?');
    const turn = await answered;
    await expect(page.getByTestId('playground-thread').locator('[data-message="ai"]')).toHaveCount(1);
    const dialog = page.getByRole('dialog');

    // Ajouter une instruction depuis ce tour
    await page.getByTestId('turn-add-instruction').click();
    await expect(dialog.getByRole('heading', { name: 'Ajouter une instruction depuis ce tour' })).toBeVisible();
    await dialog.getByTestId('turn-dialog-submit').click();
    await expect(dialog.getByRole('alert')).toContainText('Champ requis');
    expect(patches).toHaveLength(0);
    await dialog.locator('#turn-dialog-text').fill('Nous ne vendons pas d’électronique.');
    await dialog.getByTestId('turn-dialog-submit').click();
    await expect(toast(page, 'Instruction ajoutée · nouvelle version créée')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(patches).toHaveLength(1);
    const patch = bodyOf(patches[0]!);
    expect(patch.customInstructions).toBe('Toujours saluer la cliente.\n- Nous ne vendons pas d’électronique.');
    expect(patch.version).toBe(fresh.version);
    expect(patch.note).toBe('Instruction ajoutée depuis le bac à essai');
    const saved = await fullAgent(request, owner, ids.a);
    expect(saved.customInstructions).toBe('Toujours saluer la cliente.\n- Nous ne vendons pas d’électronique.');
    expect((await versionsOf(request, owner, ids.a))[0]).toMatchObject({ version: fresh.currentVersion + 1, note: 'Instruction ajoutée depuis le bac à essai' });
    await expect(page.getByTestId('agent-version')).toHaveText(new RegExp(`^V${fresh.currentVersion + 1} · `));
    // the conversation is kept
    await expect(page.getByTestId('playground-thread').locator('[data-message="ai"]')).toHaveCount(1);

    // Signaler une mauvaise réponse (eval)
    await page.getByTestId('turn-flag').click();
    await expect(dialog.getByRole('heading', { name: 'Signaler une mauvaise réponse (eval)' })).toBeVisible();
    await dialog.getByTestId('turn-dialog-submit').click();
    await expect(toast(page, 'Réponse signalée pour évaluation')).toBeVisible();
    expect(flags.map(bodyOf)).toEqual([{ turnId: turn.turnId }]);

    // Exporter la conversation (eval)
    const exported = page.waitForResponse((r) => r.url().includes(`/agents/${ids.a}/test/export?sessionId=`));
    const download = page.waitForEvent('download');
    await page.getByTestId('playground-export').click();
    const res = await exported;
    expect(new URL(res.url()).searchParams.get('sessionId')).toBe(turn.sessionId);
    const file = ((await res.json()) as { data: { turns: { turnId: string; flagged: unknown }[] } }).data;
    expect(file.turns.map((t) => t.turnId)).toEqual([turn.turnId]);
    expect(file.turns[0]!.flagged).toBeTruthy();
    expect((await download).suggestedFilename()).toBe(`playground-${turn.sessionId.slice(0, 8)}.json`);
  });

  // last of the file: it spends the 60 turns / h of the workspace
  test('AT-AI-16 PLAYGROUND_RATE_LIMITED ⇒ inline error with a countdown, composer and scenarios blocked', async ({ page, request }) => {
    // the real limit: turns through the API until one answers 429 (60 turns / h / workspace)
    const exhaust = async () => {
      for (let round = 0; round < 10; round++) {
        const statuses = await Promise.all(
          Array.from({ length: 8 }, () => request.post(`${API}/agents/${ids.a}/test`, { headers: authHeaders(owner), data: { messages: [{ role: 'user', text: 'salam' }] }, timeout: 60_000 }).then((r) => r.status())),
        );
        expect(statuses.every((s) => s === 200 || s === 429), `turn statuses ${statuses.join(',')}`).toBe(true);
        if (statuses.includes(429)) return;
      }
      throw new Error('no PLAYGROUND_RATE_LIMITED after 80 turns');
    };
    const sent = tests(page);
    const thread = page.getByTestId('playground-thread');
    for (let attempt = 0; ; attempt++) {
      await exhaust();
      sent.length = 0;
      await go(page, agentPath(ids.a, '/playground'));
      await expect(page.getByTestId('playground-banner')).toBeVisible(FIRST);
      await say(page, 'salam');
      await expect.poll(async () => ((await page.getByTestId('playground-error').count()) ? 'limited' : (await thread.locator('[data-message="ai"]').count()) ? 'answered' : 'waiting'), { timeout: 60_000 }).not.toBe('waiting');
      if ((await page.getByTestId('playground-error').count()) || attempt === 2) break;
      // the global setup of another spec run cleared the limiter counters in between: spend them again
    }
    const error = page.getByTestId('playground-error');
    await expect(error).toHaveAttribute('data-code', 'PLAYGROUND_RATE_LIMITED');
    await expect(error).toContainText('Limite de test atteinte (60/h).');
    // the API sends no Retry-After for this code: the screen counts down the default minute
    await expect(error).toContainText(/réessayez dans (1:00|0:5\d)/);
    await expect(page.getByTestId('playground-rate-limited')).toContainText('Limite de test atteinte (60/h).');
    await expect(page.getByTestId('playground-rate-limited')).toContainText(/réessayez dans (1:00|0:5\d)/);
    await expect(composer(page)).toBeDisabled();
    await expect(page.getByTestId('playground-send')).toBeDisabled();
    await expect(page.locator('[data-scenario="refund"]')).toBeDisabled();
    await expect(page.getByTestId('playground-retry')).toHaveCount(0);
    await expect(page.getByTestId('playground-thread').locator('[data-message="ai"]')).toHaveCount(0);
    await expect(page.getByTestId('playground-turns')).toHaveText('0 tours · limite 60 / h');
    // the countdown ticks
    const before = await page.getByTestId('playground-rate-limited').innerText();
    await expect(page.getByTestId('playground-rate-limited')).not.toHaveText(before, { timeout: 5000 });
    expect(sent).toHaveLength(1);
  });
});

