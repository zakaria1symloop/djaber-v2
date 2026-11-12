// M4 — "Générer un agent depuis ma page" on the REAL API (UI side of AT-AGT-03). Frame: "DLG — Agents & channels"
// (AGT-03): 1 CHOISIR the page and the period → 2 ANALYSE… (job, cancellable) → 3 REVUE → 4 APPLIQUER to a new agent,
// or to the agent linked to the page after a confirmation. The job id lives in the URL: a reload resumes the flow.
// One shop for the file: customer questions arrive on the first page through the dev simulator and a member answers
// them as the page (the FAQ candidates the generation reads), an active agent answers on that page; the jobs run on
// the worker with the fake AI. `page.route` only where the fake drivers cannot produce the state (`// mock:`).
import { expect as baseExpect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { API, apiReady, authHeaders, createAccount, expectUrl, type Account } from './support/m1';
import { clickForRoute, clickForUrl } from './support/m4-agent-page';
import { signIn } from './support/m4-agents';
import { activeAgent, linkPage, listAgents, nextSender, realGet, setupShop, type Shop } from './support/m4-real';
import { ANY_JOB, bodyOf, clearGenerationLimits, failJob, fullAgent, holdJobRunning, load, questionAnswered, recordRequests, startGeneration, versionsOf, waitJob, type RealJob } from './support/m4-real-agent-page';
import { errText } from './support/error-text';

// the dev server is shared with the other suites (transitions can take seconds)
const expect = baseExpect.configure({ timeout: 20_000 });
let context: BrowserContext;
const test = base.extend<{ page: Page }>({
  page: async ({}, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});
test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

const FIRST = { timeout: 60_000 };
const POLL = { timeout: 30_000 }; // the job is polled every 1.5 s (5 s when the socket is up)
const TAG = Date.now().toString(36).slice(-4);
const LINKED = `Vendeur ${TAG}`;
const root = (page: Page) => page.getByTestId('generate-agent');
const toast = (page: Page, text: string | RegExp) => page.locator('[data-toast]').filter({ hasText: text });
const steps = (page: Page) => page.getByRole('list', { name: 'Étapes de la génération' }).getByRole('listitem');
const generateUrl = (query: string) => `/fr/agents/generate${query}`;
const LANG: Record<string, string> = { fr: 'FR', ar: 'AR', en: 'EN', arabizi: 'arabizi', darija: 'darija', mixed: 'mixte', kabyle: 'kabyle' };
type Generation = { channelId: string; conversations: number; messages: number; summary: string; languages: { code: string; pct: number }[]; topQuestions: { question: string; count: number }[]; tone: string; proposedInstructions: string; proposedFaq: { q: string; a: string }[]; linkedAgent: { id: string; name: string } | null };

let shop: Shop;
let owner: Account;
let linkedId = '';
/** a finished generation of the first page (3 conversations, linked agent) and one of the second page (empty) */
let done: RealJob & { result: Generation };
let empty: RealJob & { result: Generation };
const allPages = () => [shop.facebook.id, shop.facebook2.id, shop.instagram.id];
const clearLimits = () => clearGenerationLimits(owner.workspaceId, allPages());

test.beforeAll(async ({ browser, request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  test.setTimeout(300_000);
  shop = await setupShop(request, 'm4gen', { products: false });
  owner = shop.owner;
  // what the page already said to its customers (no agent yet: a member answered)
  for (const [question, answer] of [
    ['Vous livrez à Sétif ?', 'Oui, en 48 h, 600 DA.'],
    ['Vous livrez à Sétif ?', 'Oui, en 48 h, 600 DA.'],
    ['Kayen taille L ?', 'Oui, du S au XL.'],
  ] as const)
    await questionAnswered(request, owner, { channelId: shop.facebook.id, sender: nextSender(), question, answer });
  linkedId = (await activeAgent(request, owner, { name: LINKED, channelId: shop.facebook.id })).id;

  await clearLimits();
  done = (await waitJob(request, owner, (await startGeneration(request, owner, shop.facebook.id)).jobId)) as typeof done;
  expect(done.status).toBe('done');
  await clearLimits();
  empty = (await waitJob(request, owner, (await startGeneration(request, owner, shop.facebook2.id)).jobId)) as typeof empty;
  expect(empty.status).toBe('done');
  await clearLimits();

  context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'fr-DZ', timezoneId: 'Africa/Algiers', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await signIn(page, owner);
  // let the requests that follow the sign-in settle: a rotation of the refresh cookie cut by `close` revokes the session
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.close();
});
test.afterAll(async () => {
  await context?.close();
});

/**
 * Opens the generation page. The shared dev server can leave a navigation on its loading state, and the session of the
 * shared context can be lost (refresh answered 401): the page is opened again, after a new sign-in when needed.
 */
async function open(page: Page, query: string, who: Account = owner) {
  await baseExpect(async () => {
    await load(page, () => page.goto(generateUrl(query)));
    if (await root(page).waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false)) return;
    await signIn(page, who);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    throw new Error('the generation page did not open: signed in again');
  }).toPass({ timeout: 200_000 });
}
const jobInUrl = (page: Page) => new URL(page.url()).searchParams.get('job');

test('choose: page preselected from the URL, period 30 j, steps, axe — "Analyser" starts the job and puts it in the URL', async ({ page, request }) => {
  const channels = ((await (await request.get(`${API}/channels`, { headers: authHeaders(owner) })).json()) as { data: { id: string; name: string; platform: 'facebook' | 'instagram'; counts: { conversations: number } }[] }).data;
  const starts = recordRequests(page, 'POST', /\/agents\/generate$/);
  await clearLimits();
  await open(page, `?channel=${shop.facebook.id}`);
  await expect(page.getByRole('heading', { name: 'Générer un agent depuis ma page', level: 1 })).toBeVisible();
  await expect(page).toHaveTitle('Générer un agent depuis ma page · Djaber.ai');
  await expect(root(page)).toHaveAttribute('data-phase', 'choose');
  await expect(steps(page)).toHaveText(['1 · CHOISIR', '2 · ANALYSE…', '3 · REVUE', '4 · APPLIQUER']);
  await expect(steps(page).nth(0)).toHaveAttribute('aria-current', 'step');

  const channel = page.getByLabel('CANAL');
  await expect(channel).toHaveValue(shop.facebook.id);
  await expect(channel.locator('option')).toHaveText(channels.map((c) => `${c.name} (${c.platform === 'facebook' ? 'Facebook' : 'Instagram'}, ${c.counts.conversations} conv.)`));
  expect(channels.find((c) => c.id === shop.facebook.id)!.counts.conversations).toBe(3);
  const period = page.getByLabel('PÉRIODE');
  await expect(period).toHaveValue('30');
  await expect(period.locator('option')).toHaveText(['7 j', '30 j', '90 j']);
  await expect(root(page)).toContainText("Rien n'est créé avant votre validation. 1 analyse par page / 24 h.");
  await expect(root(page).getByRole('link', { name: 'Annuler' })).toHaveAttribute('href', /\/fr\/agents$/);
  await expectNoA11yViolations(page);

  await page.getByTestId('generate-start').click();
  await expect(page).toHaveURL(/[?&]job=[0-9a-f-]{36}/, POLL);
  await expect(page).toHaveURL(new RegExp(`[?&]channel=${shop.facebook.id}`));
  await expect(root(page)).not.toHaveAttribute('data-phase', 'choose');
  expect(starts.map(bodyOf)).toEqual([{ channelId: shop.facebook.id, days: 30 }]);
  // the real job ends on its own (fake AI): the review follows
  await expect(root(page)).toHaveAttribute('data-phase', 'review', POLL);
  expect((await waitJob(request, owner, jobInUrl(page)!)).status).toBe('done');
});

test('another page and period are sent as chosen', async ({ page, request }) => {
  const starts = recordRequests(page, 'POST', /\/agents\/generate$/);
  await clearLimits();
  await open(page, '');
  await page.getByLabel('CANAL').selectOption(shop.instagram.id);
  await page.getByLabel('PÉRIODE').selectOption('90');
  await page.getByTestId('generate-start').click();
  await expect(page).toHaveURL(/[?&]job=[0-9a-f-]{36}/, POLL);
  expect(starts.map(bodyOf)).toEqual([{ channelId: shop.instagram.id, days: 90 }]);
  await expect(root(page)).toHaveAttribute('data-phase', 'review', POLL);
  const job = await waitJob(request, owner, jobInUrl(page)!);
  expect((job.result as Generation).channelId).toBe(shop.instagram.id);
});

test('AT-AGT-03 running (progress, cancellable) ⇒ review ⇒ "Créer un nouvel agent" creates a draft and opens its wizard', async ({ page, request }) => {
  const linkedBefore = await fullAgent(request, owner, linkedId);
  await clearLimits();
  await open(page, `?channel=${shop.facebook.id}`);
  await page.getByTestId('generate-start').click();
  await expect(page).toHaveURL(/[?&]job=[0-9a-f-]{36}/, POLL);
  const jobId = jobInUrl(page)!;
  const job = (await waitJob(request, owner, jobId)) as typeof done;
  expect(job.status).toBe('done');
  // mock: the fake AI ends the job in well under a second — its real answer is held as "running 42 %" to see the
  // running phase (reloaded once the job's own socket events are over, so that none of them moves the bar)
  await page.waitForTimeout(2_000);
  const release = await holdJobRunning(page, jobId, 42);
  await load(page, () => page.reload());
  await expect(root(page)).toHaveAttribute('data-phase', 'running', FIRST);
  const run = page.getByTestId('generate-running');
  await expect(run).toContainText('Lecture des conversations… 42 %');
  await expect(run.getByRole('progressbar', { name: 'ANALYSE…' })).toHaveAttribute('aria-valuenow', '42');
  await expect(run).toContainText('Annulable · environ 1 minute. Vous pouvez quitter la page : le résultat reste disponible.');
  await expect(page.getByTestId('generate-cancel')).toHaveText('Annuler');
  await expect(steps(page).nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('generate-apply-new')).toHaveCount(0);

  // the job's real answer: the review of what the page said
  await release();
  await expect(root(page)).toHaveAttribute('data-phase', 'review', POLL);
  const r = job.result;
  expect(r).toMatchObject({ channelId: shop.facebook.id, conversations: 3, messages: 6, linkedAgent: { id: linkedId, name: LINKED } });
  expect(r.topQuestions).toEqual([
    { question: 'Vous livrez à Sétif ?', count: 2 },
    { question: 'Kayen taille L ?', count: 1 },
  ]);
  const review = page.getByTestId('generate-review');
  await expect(review).toContainText(`${shop.facebook.name} · 3 conversations · 6 messages lus`);
  await expect(review).toContainText('RÉSUMÉ');
  await expect(review).toContainText(r.summary);
  await expect(review).toContainText('LANGUES & TON DÉTECTÉS');
  await expect(review).toContainText(`${r.languages.map((l) => `${LANG[l.code] ?? l.code} ${Math.round(l.pct)} %`).join(' · ')} · ton ${r.tone}`);
  await expect(review).toContainText('QUESTIONS FRÉQUENTES');
  await expect(page.getByTestId('generate-questions').getByRole('listitem')).toHaveText(['Vous livrez à Sétif ? (2)', 'Kayen taille L ? (1)']);
  await expect(review).toContainText('INSTRUCTIONS PROPOSÉES');
  // M11: the proposal is editable before applying (textarea)
  await expect(page.getByTestId('generate-instructions')).toHaveValue(r.proposedInstructions);
  expect(await page.getByTestId('generate-instructions').inputValue()).toContain('- Vous livrez à Sétif ?');
  await expect(review).toContainText("2 FAQ proposées · tout reste modifiable dans la configuration de l'agent après application.");
  await expect(steps(page).nth(2)).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('generate-apply-new')).toHaveText('Créer un nouvel agent');
  await expect(page.getByTestId('generate-apply-update')).toHaveText(`Mettre à jour ${LINKED}`);

  const applies = recordRequests(page, 'POST', new RegExp(`/agents/generate/${jobId}/apply$`));
  await page.getByTestId('generate-apply-new').click();
  const name = `Agent de ${shop.facebook.name}`;
  await expect(toast(page, `Agent « ${name} » créé en brouillon depuis la page`)).toBeVisible(POLL);
  expect(applies.map(bodyOf)).toEqual([{}]);
  await expectUrl(page, /\/fr\/agents\/new\/knowledge\?draft=[0-9a-f-]{36}$/, { timeout: 90_000 });
  const draftId = new URL(page.url()).searchParams.get('draft')!;
  const draft = await fullAgent(request, owner, draftId);
  expect(draft).toMatchObject({ name, status: 'draft' });
  expect(draft.customInstructions).toContain('- Vous livrez à Sétif ?');
  // the page already answers with its agent: the new draft is not linked; the generated FAQ is on it
  expect(draft.channels).toEqual([]);
  expect((await realGet<{ question: string; answer: string }[]>(request, owner, `/agents/${draftId}/faq`)).map((f) => f.question).sort()).toEqual(['Kayen taille L ?', 'Vous livrez à Sétif ?']);
  // the other agents are untouched
  const linkedAfter = await fullAgent(request, owner, linkedId);
  expect({ v: linkedAfter.currentVersion, i: linkedAfter.customInstructions }).toEqual({ v: linkedBefore.currentVersion, i: linkedBefore.customInstructions });
});

test('AT-AGT-03 "Mettre à jour <agent lié>" asks first: cancel ⇒ nothing sent; confirm ⇒ apply { agentId, confirm } and the agent page', async ({ page, request }) => {
  const before = await fullAgent(request, owner, linkedId);
  const others = async () => (await listAgents(request, owner)).filter((a) => a.id !== linkedId).map((a) => ({ id: a.id, version: a.version, currentVersion: a.currentVersion }));
  const othersBefore = await others();
  const applies = recordRequests(page, 'POST', new RegExp(`/agents/generate/${done.id}/apply$`));
  await open(page, `?channel=${shop.facebook.id}&job=${done.id}`);
  await expect(root(page)).toHaveAttribute('data-phase', 'review', FIRST);
  await page.getByTestId('generate-apply-update').click();
  const dialog = page.getByRole('dialog', { name: `Mettre à jour « ${LINKED} » ?` });
  await expect(dialog).toContainText("Les instructions proposées remplacent celles de l'agent lié à cette page et créent une nouvelle version (restaurable). Les autres agents ne sont pas touchés.");
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  expect(applies).toHaveLength(0);
  await expect(root(page)).toHaveAttribute('data-phase', 'review');

  await page.getByTestId('generate-apply-update').click();
  await dialog.getByRole('button', { name: 'Mettre à jour (crée une version)' }).click();
  await expect(toast(page, `« ${LINKED} » mis à jour · version v${before.currentVersion + 1} créée`)).toBeVisible(POLL);
  expect(applies.map(bodyOf)).toEqual([{ agentId: linkedId, confirm: true }]);
  await expectUrl(page, new RegExp(`/fr/agents/${linkedId}$`), { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: LINKED, level: 1 })).toBeVisible(FIRST);
  // only the linked agent changed: a new version with the proposed instructions
  const after = await fullAgent(request, owner, linkedId);
  expect(after.currentVersion).toBe(before.currentVersion + 1);
  expect(after.customInstructions).toContain(done.result.proposedInstructions.split('\n')[0]!);
  expect((await versionsOf(request, owner, linkedId))[0]).toMatchObject({ isCurrent: true, note: `generation:${done.id}` });
  expect(await others()).toEqual(othersBefore);
});

test('a page without linked agent only offers "Créer un nouvel agent"; a reload with ?job= resumes the review', async ({ page }) => {
  expect(empty.result).toMatchObject({ channelId: shop.facebook2.id, conversations: 0, messages: 0, linkedAgent: null, proposedFaq: [], topQuestions: [] });
  const starts = recordRequests(page, 'POST', /\/agents\/generate$/);
  await open(page, `?channel=${shop.facebook2.id}&job=${empty.id}`);
  await expect(root(page)).toHaveAttribute('data-phase', 'review', FIRST);
  await expect(page.getByTestId('generate-apply-new')).toBeVisible();
  await expect(page.getByTestId('generate-apply-update')).toHaveCount(0);
  const review = page.getByTestId('generate-review');
  await expect(review).toContainText(`${shop.facebook2.name} · 0 conversations · 0 messages lus`);
  await expect(review).toContainText(`— · ton ${empty.result.tone}`);
  await expect(page.getByTestId('generate-questions').getByRole('listitem')).toHaveText(['—']);
  await expect(review).toContainText('Aucune FAQ proposée');

  await load(page, () => page.reload());
  await expect(root(page)).toHaveAttribute('data-phase', 'review', FIRST);
  // nothing to read ⇒ nothing proposed (no AI call)
  expect(empty.result.proposedInstructions).toBe('');
  await expect(page.getByTestId('generate-instructions')).toHaveValue('');
  await expect(page).toHaveURL(new RegExp(`[?&]job=${empty.id}`));
  // nothing was started again
  expect(starts).toHaveLength(0);

  // "Annuler" in the review asks before dropping the analysis (it counted in the daily limit)
  await page.getByTestId('generate-discard').click();
  const ask = page.getByRole('dialog');
  await expect(ask.getByRole('heading', { name: 'Abandonner cette analyse ?' })).toBeVisible();
  await ask.getByRole('button', { name: "Garder l'analyse" }).click();
  await expect(root(page)).toHaveAttribute('data-phase', 'review');
  await page.getByTestId('generate-discard').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Abandonner' }).click();
  await expect(root(page)).toHaveAttribute('data-phase', 'choose', FIRST);
  expect(starts).toHaveLength(0);
});

test('"Annuler" while running cancels the job and comes back to the choice', async ({ page, request }) => {
  // mock: see the running test — the real (finished) job is held as "running 10 %"
  await holdJobRunning(page, done.id, 10);
  const cancels = recordRequests(page, 'POST', new RegExp(`/jobs/${done.id}/cancel$`));
  await open(page, `?channel=${shop.facebook.id}&job=${done.id}`);
  await expect(root(page)).toHaveAttribute('data-phase', 'running', FIRST);
  await expect(page.getByTestId('generate-running')).toContainText('Lecture des conversations… 10 %');
  const answer = page.waitForResponse((r) => r.url().endsWith(`/jobs/${done.id}/cancel`) && r.request().method() === 'POST');
  await clickForUrl(page, page.getByTestId('generate-cancel'), /[?&]job=/, false);
  await expect(root(page)).toHaveAttribute('data-phase', 'choose');
  await expect(page).toHaveURL(new RegExp(`[?&]channel=${shop.facebook.id}`));
  expect(cancels.length).toBeGreaterThanOrEqual(1);
  // the real job had already finished: the API refuses the cancel and the page goes back to the choice all the same
  expect((await answer).status()).toBeGreaterThanOrEqual(400);
  expect((await realGet<RealJob>(request, owner, `/jobs/${done.id}`)).status).toBe('done');
  await expect(page.getByLabel('CANAL')).toHaveValue(shop.facebook.id);
});

test('failed job: message with its code, "Réessayer" analyses the same page again (new job in the URL)', async ({ page }) => {
  // mock: a generation only fails on a provider / format error, which the fake AI never produces over HTTP
  await failJob(page, ANY_JOB, { code: 'AI_PROVIDER_ERROR', message: "L'IA ne répond pas ; la conversation passe en file.", params: {}, ref: done.id });
  const cancels = recordRequests(page, 'POST', /\/jobs\/[0-9a-f-]{36}\/cancel$/);
  await open(page, `?channel=${shop.facebook.id}&job=${done.id}`);
  await expect(root(page)).toHaveAttribute('data-phase', 'failed', FIRST);
  await expect(page.getByTestId('generate-failed')).toHaveText("L'IA ne répond pas ; la conversation passe en file.");
  await expect(root(page).getByRole('alert')).toContainText('Réessayez : une analyse échouée ne compte pas et ne coûte rien.');
  await expect(page.getByTestId('generate-review')).toHaveCount(0);
  await expect(page.getByTestId('generate-reconnect')).toHaveCount(0);
  const starts = recordRequests(page, 'POST', /\/agents\/generate$/);
  await clearLimits();
  await page.getByTestId('generate-retry').click();
  await expect.poll(() => starts.length, POLL).toBe(1);
  expect(starts.map(bodyOf)).toEqual([{ channelId: shop.facebook.id, days: 30 }]);
  await expect(page).toHaveURL(/[?&]job=[0-9a-f-]{36}/, POLL);
  await expect.poll(() => jobInUrl(page), POLL).not.toBe(done.id);
  // a finished job is not cancelled
  expect(cancels).toHaveLength(0);
});

test('a job that failed without detail says "Analyse interrompue."; one that lacks the page permission offers to reconnect', async ({ page }) => {
  // mock: same as above (failed jobs cannot be produced by the fake drivers)
  await failJob(page, ANY_JOB, null);
  await open(page, `?channel=${shop.facebook.id}&job=${done.id}`);
  await expect(page.getByTestId('generate-failed')).toHaveText('Analyse interrompue.', FIRST);
  await page.unrouteAll({ behavior: 'wait' });
  await failJob(page, ANY_JOB, { code: 'PAGE_ANALYSIS_PERMISSION_REQUIRED', message: 'Reconnectez la page avec la permission "contenu".', params: {}, ref: done.id });
  await load(page, () => page.reload());
  await expect(page.getByTestId('generate-failed')).toHaveText('Reconnectez la page avec la permission "contenu".', FIRST);
  await expect(page.getByTestId('generate-reconnect')).toHaveAttribute('href', new RegExp(`/fr/channels/${shop.facebook.id}$`));
});

test('ANALYSIS_RATE_LIMITED on start: inline warning with the code, still on the choice, nothing in the URL', async ({ page, request }) => {
  // the real limit: the second page was analysed a moment ago (1 analysis / page / 24 h)
  const error = page.getByTestId('generate-error');
  const outcome = () => expect.poll(async () => ((await error.count()) ? 'limited' : /[?&]job=/.test(page.url()) ? 'started' : 'waiting'), { timeout: 30_000 }).not.toBe('waiting');
  for (let attempt = 0; ; attempt++) {
    await open(page, `?channel=${shop.facebook2.id}`);
    // analysed through the API right before the click (202, or 429 when its counter is still set)
    await request.post(`${API}/agents/generate`, { headers: authHeaders(owner), data: { channelId: shop.facebook2.id, days: 30 } });
    await page.getByTestId('generate-start').click();
    await outcome();
    if ((await error.count()) || attempt === 2) break;
    // the global setup of another spec run cleared the limiter counters in between: once more
  }
  await expect(error).toHaveAttribute('data-code', 'ANALYSIS_RATE_LIMITED');
  await expect(error).toHaveText('3 analyses par jour max.');
  // a warning, not an error: announced as a status
  await expect(root(page).getByRole('status').filter({ hasText: errText('ANALYSIS_RATE_LIMITED') })).toBeVisible();
  await expect(root(page)).toHaveAttribute('data-phase', 'choose');
  await expect(page).not.toHaveURL(/job=/);
  await expect(page.getByTestId('generate-reconnect')).toHaveCount(0);
  await expect(page.getByLabel('CANAL')).toHaveValue(shop.facebook2.id);
  // a day later (the counters cleared), the next try goes through
  await clearLimits();
  await page.getByTestId('generate-start').click();
  await expect(page).toHaveURL(/[?&]job=[0-9a-f-]{36}/, POLL);
  await expect(root(page)).toHaveAttribute('data-phase', 'review', POLL);
  await expect(page.getByTestId('generate-error')).toHaveCount(0);
});

test('PAGE_ANALYSIS_PERMISSION_REQUIRED on start: message and "Reconnecter la page…" towards the channel page', async ({ page }) => {
  // mock: the generation reads the stored conversations and never checks the page's read permission (only the page
  // analysis of CHN-08 does), so the API cannot answer 403 PAGE_ANALYSIS_PERMISSION_REQUIRED to `POST /agents/generate`
  await page.route(/\/api\/v1\/agents\/generate$/, (route) =>
    route.request().method() !== 'POST'
      ? route.fallback()
      : route.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': 'http://localhost:3010', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ error: { code: 'PAGE_ANALYSIS_PERMISSION_REQUIRED', message: 'Reconnectez la page avec la permission "contenu".', params: {}, fields: {}, details: null, ref: 'e2e-ref' } }) }),
  );
  await open(page, `?channel=${shop.facebook.id}`);
  await page.getByTestId('generate-start').click();
  const error = page.getByTestId('generate-error');
  await expect(error).toHaveAttribute('data-code', 'PAGE_ANALYSIS_PERMISSION_REQUIRED');
  await expect(error).toHaveText('Reconnectez la page avec la permission "contenu".');
  await expect(root(page).getByRole('alert').filter({ hasText: errText('PAGE_ANALYSIS_PERMISSION_REQUIRED') })).toBeVisible();
  await expect(root(page)).toHaveAttribute('data-phase', 'choose');
  const reconnect = page.getByTestId('generate-reconnect');
  await expect(reconnect).toHaveText('Reconnecter la page avec la permission de lecture');
  await expect(reconnect).toHaveAttribute('href', new RegExp(`/fr/channels/${shop.facebook.id}$`));
  await clickForRoute(page, reconnect, new RegExp(`/fr/channels/${shop.facebook.id}$`));
});

test('no connected page: info with a link to "Pages connectées", nothing to start', async ({ browser, request }) => {
  const bare = await createAccount(request, { prefix: 'm4gen0', finishOnboarding: true });
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'fr-DZ', timezoneId: 'Africa/Algiers', viewport: { width: 1440, height: 1000 } });
  try {
    const page = await ctx.newPage();
    await signIn(page, bare);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const starts = recordRequests(page, 'POST', /\/agents\/generate$/);
    await open(page, '', bare);
    await expect(root(page)).toHaveAttribute('data-phase', 'choose');
    const info = root(page).getByRole('status').filter({ hasText: 'Connectez' });
    await expect(info).toContainText("Connectez d'abord une page pour générer un agent depuis ses conversations.", FIRST);
    await expect(info.getByRole('link', { name: 'Pages connectées' })).toHaveAttribute('href', /\/fr\/channels$/);
    await expect(page.getByLabel('CANAL')).toHaveCount(0);
    await expect(page.getByTestId('generate-start')).toBeDisabled();
    expect(starts).toHaveLength(0);
  } finally {
    await ctx.close();
  }
});

test('a refused apply is shown inline and the review stays', async ({ page, request }) => {
  await open(page, `?channel=${shop.facebook.id}&job=${done.id}`);
  await expect(root(page)).toHaveAttribute('data-phase', 'review', FIRST);
  // between the review and the click, the page was unlinked from its agent: the API refuses to update an agent that
  // no longer answers on the analysed page (404)
  await linkPage(request, owner, shop.facebook.id, null);
  try {
    await page.getByTestId('generate-apply-update').click();
    await page.getByRole('dialog', { name: `Mettre à jour « ${LINKED} » ?` }).getByRole('button', { name: 'Mettre à jour (crée une version)' }).click();
    await expect(page.getByTestId('generate-error')).toHaveAttribute('data-code', 'NOT_FOUND', POLL);
    await expect(page.getByTestId('generate-error')).toHaveText('Introuvable ou accès refusé.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(root(page)).toHaveAttribute('data-phase', 'review');
    expect(await page.getByTestId('generate-instructions').inputValue()).toContain('- Vous livrez à Sétif ?');
    await expect(page.getByTestId('generate-apply-new')).toBeEnabled();
  } finally {
    await linkPage(request, owner, shop.facebook.id, linkedId);
  }
});
