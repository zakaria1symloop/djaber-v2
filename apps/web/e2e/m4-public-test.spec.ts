// M4 — public shared test page `/agent-test/[token]` (Figma "AGT-07 — Agent playground", shared read-only variant;
// "DLG — Agents & channels" Lien de test; 12-screen-states §22). No account: the 24 h token of the link is the only
// credential. On the REAL API: one shop per run (`setupShop`, catalogue with "Robe satin"), an agent whose name shown to
// customers is "Amel (assistante)" and a real link (`POST /agents/:id/test-links`); the page answers through the
// deterministic fake AI (dry run, no credit). Nothing here signs in. `page.route` remains only for the expiry of a link
// (a link lives ≥ 1 h), each use says why.
import { randomUUID } from 'node:crypto';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { API, apiReady } from './support/m1';
import { composer, say } from './support/m4-agent-page';
import { createAgent, setupShop, type Shop } from './support/m4-real';
import { enter, failOnce, testLinkOf } from './support/m4-real-wizard';

test.use({ viewport: { width: 1280, height: 900 } });
test.describe.configure({ timeout: 300_000 });

// the dev server is shared with the other suites (routes compile on first hit, transitions can take seconds)
const expect = baseExpect.configure({ timeout: 15_000 });
const FIRST = { timeout: 30_000 };
const AGENT = 'Amel (assistante)';
const PLAYGROUND_TURNS_PER_HOUR = 60;

let shop: Shop;
let agentId = '';
let token = '';
test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  shop = await setupShop(request, 'agtpub', { pages: false });
  agentId = (await createAgent(request, shop.owner, { name: `Vendeur partagé ${Date.now().toString(36)}`, wizard: { displayName: AGENT } })).id;
  token = (await testLinkOf(request, shop.owner, agentId)).token;
});

const shared = (page: Page) => page.getByTestId('shared-test');
const state = (page: Page, s: string) => page.locator(`[data-testid="shared-test"][data-state="${s}"]`);
const pathOf = (t: string, locale = 'fr') => `/${locale}/agent-test/${t}`;
const isSend = (url: string, t: string) => url.endsWith(`/api/v1/agent-test/${t}/messages`);

test('intro state: agent, expiry, SIMULATION, no app shell; a message shows the typing chip, the reply and the card — no tools, no inspector, no Authorization', async ({ page }) => {
  // delay only (the real answer is untouched): the fake model answers too fast to see the typing chip
  await page.route(/\/api\/v1\/agent-test\/[^/]+\/messages$/, async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1200));
    await route.fallback();
  });
  const loaded = page.waitForRequest((r) => r.method() === 'GET' && r.url().endsWith(`/api/v1/agent-test/${token}`));
  await enter(page, pathOf(token), () => state(page, 'intro'));
  await expect(page).toHaveTitle("Test d'un agent · Djaber.ai");
  expect((await (await loaded).allHeaders()).authorization).toBeUndefined();

  await expect(page.getByRole('heading', { name: AGENT, level: 1 })).toBeVisible();
  await expect(page.getByTestId('shared-intro')).toContainText(/Lien valable jusqu'au \d{2} /);
  await expect(shared(page).getByText('SIMULATION', { exact: true })).toBeVisible();
  await expect(page.getByTestId('playground-thread')).toContainText("Écrivez comme un client : l'agent répond avec le vrai catalogue de la boutique. C'est une simulation, aucune commande n'est créée.");
  await expect(shared(page)).toContainText('Page de test partagée par un marchand Djaber.ai · rien n\'est envoyé à un client.');
  await expect(page.getByTestId('playground-send')).toBeDisabled();
  // public page: no sidebar, no header of the app, no merchant tooling
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Menu utilisateur/ })).toHaveCount(0);
  await expect(page.getByTestId('credits-pill')).toHaveCount(0);
  await expect(page.locator('[data-scenario]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Joindre une photo' })).toHaveCount(0);
  await expect(page.getByTestId('playground-banner')).toHaveCount(0);

  // a price question: the fake model searches the real catalogue of the shop
  const QUESTION = 'chhal le prix de la robe satin ?';
  const first = page.waitForRequest((r) => r.method() === 'POST' && isSend(r.url(), token));
  const firstAnswer = page.waitForResponse((r) => r.request().method() === 'POST' && isSend(r.url(), token));
  await say(page, QUESTION);
  const thread = page.getByTestId('playground-thread');
  await expect(thread.locator('[data-message="customer"]')).toContainText(QUESTION);
  await expect(thread.getByRole('status').filter({ hasText: `${AGENT} répond…` })).toBeVisible();
  await expect(shared(page)).toHaveAttribute('data-state', 'conversation');
  const req = await first;
  expect(req.postDataJSON()).toEqual({ text: QUESTION, history: [] });
  const headers = await req.allHeaders();
  expect(headers.authorization).toBeUndefined();
  expect(headers['x-workspace-id']).toBeUndefined();
  expect(headers['accept-language']).toBe('fr');
  const res = await firstAnswer;
  expect(res.status()).toBe(200);
  const { data: reply } = (await res.json()) as { data: { reply: string; cards: { name: string; price: number }[] } };
  // what a customer would see: the text and the cards, nothing about the model or the tools
  expect(Object.keys(reply).sort()).toEqual(['cards', 'reply']);
  expect(reply.cards.map((c) => c.name)).toContain('Robe satin');

  const ai = thread.locator('[data-message="ai"]');
  await expect(ai).toContainText(/Robe satin/i);
  await expect(thread.getByRole('status').filter({ hasText: 'répond…' })).toHaveCount(0);
  // the public reply shows the agent and the time, never the status line of the merchant playground
  await expect(ai).toContainText(new RegExp(`${AGENT.replace(/[()]/g, '\\$&')} · \\d{2}:\\d{2}`));
  await expect(ai).not.toContainText('SALE');
  const cards = thread.getByRole('list', { name: 'Cartes produit' });
  await expect(cards.getByRole('listitem')).toHaveCount(reply.cards.length);
  const satin = cards.getByRole('listitem').filter({ hasText: 'Robe satin' });
  await expect(satin).toContainText('4 900 DA');
  await expect(cards).not.toContainText('CARTE RÉELLE');
  await expect(page.locator('[data-tool]')).toHaveCount(0);
  await expect(page.getByTestId('inspector')).toHaveCount(0);
  await expect(page.getByTestId('prompt-preview')).toHaveCount(0);
  await expect(page.getByTestId('turn-flag')).toHaveCount(0);

  // the next message carries the conversation so far (with the real first reply)
  const second = page.waitForRequest((r) => r.method() === 'POST' && isSend(r.url(), token));
  await say(page, 'ch7al livraison l Alger ?');
  await expect(thread.locator('[data-message="ai"]')).toHaveCount(2, FIRST);
  expect((await second).postDataJSON()).toEqual({
    text: 'ch7al livraison l Alger ?',
    history: [
      { role: 'user', text: QUESTION },
      { role: 'assistant', text: reply.reply },
    ],
  });
});

test('expired link ⇒ "Lien expiré" (410 AGENT_TEST_LINK_EXPIRED), no composer; an unknown link shows the same state', async ({ page }) => {
  // mock: a link lives at least 1 h (`expiresInHours` ≥ 1), so the API cannot answer 410 during a run: the opening
  // read of a real link is answered with the error the API sends once it expired
  await failOnce(page, new RegExp(`/api/v1/agent-test/${token}$`), 'GET', 410, 'AGENT_TEST_LINK_EXPIRED', 'Lien de test expiré (24 h).', { times: Infinity });
  await enter(page, pathOf(token), () => state(page, 'expired'));
  await expect(page.getByRole('heading', { name: 'Lien expiré' })).toBeVisible();
  await expect(page.getByText('Lien de test expiré (24 h). Demandez un nouveau lien à la personne qui vous l\'a envoyé.')).toBeVisible();
  await expect(page.getByTestId('playground-composer')).toHaveCount(0);
  await expect(page.getByTestId('shared-intro')).toHaveCount(0);
  await expect(shared(page).getByText('SIMULATION', { exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Test d'un agent · Djaber.ai");

  // a token the API does not know (real 404): the same dead end, never an error page
  const unknown = randomUUID().replace(/-/g, '');
  const res = await page.request.get(`${API}/agent-test/${unknown}`);
  expect(res.status()).toBe(404);
  await enter(page, pathOf(unknown), () => state(page, 'expired'));
  await expect(page.getByRole('heading', { name: 'Lien expiré' })).toBeVisible();
  await expect(page.getByTestId('playground-composer')).toHaveCount(0);
});

test('the link expires during the conversation: the next message answers 410 ⇒ expired state', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && isSend(r.url(), token) && sent.push(r.postData() ?? ''));
  await enter(page, pathOf(token), () => state(page, 'intro'));
  await say(page, 'salam');
  await expect(page.getByTestId('playground-thread').locator('[data-message="ai"]')).toHaveCount(1, FIRST);
  await expect(shared(page)).toHaveAttribute('data-state', 'conversation');

  // mock: the 24 h of the link cannot pass during a run: the next message is answered with the API's 410
  await failOnce(page, new RegExp(`/api/v1/agent-test/${token}/messages$`), 'POST', 410, 'AGENT_TEST_LINK_EXPIRED', 'Lien de test expiré (24 h).');
  await say(page, 'ch7al ?');
  await expect(shared(page)).toHaveAttribute('data-state', 'expired');
  await expect(page.getByRole('heading', { name: 'Lien expiré' })).toBeVisible();
  await expect(page.getByText(/Lien de test expiré \(24 h\)\./)).toBeVisible();
  await expect(page.getByTestId('playground-composer')).toHaveCount(0);
  expect(sent).toHaveLength(2);
});

test('PLAYGROUND_RATE_LIMITED ⇒ rate-limited state with a countdown, composer blocked', async ({ page, request }) => {
  // a fresh link of the same agent, whose 60 turns of the hour are used through the public API (real dry-run turns)
  const busy = (await testLinkOf(request, shop.owner, agentId)).token;
  // (until the API itself answers 429: the limiter counters of the dev Redis are shared with the other runs)
  for (let sent = 0; ; sent += 10) {
    const codes = await Promise.all(Array.from({ length: 10 }, (_, j) => request.post(`${API}/agent-test/${busy}/messages`, { data: { text: `salam ${sent + j}` }, timeout: 90_000 }).then((r) => r.status())));
    expect(codes.every((c) => c === 200 || c === 429), codes.join(',')).toBe(true);
    if (codes.includes(429)) break;
    expect(sent, 'the playground limit of a link is 60 turns / h').toBeLessThan(PLAYGROUND_TURNS_PER_HOUR + 20);
  }
  await enter(page, pathOf(busy), () => state(page, 'intro'));
  await say(page, 'salam');
  await expect(shared(page)).toHaveAttribute('data-state', 'rate-limited');
  const error = page.getByTestId('playground-error');
  await expect(error).toHaveAttribute('data-code', 'PLAYGROUND_RATE_LIMITED');
  await expect(error).toContainText('Limite de test atteinte (60/h).');
  // no Retry-After on this answer: the page waits one minute
  await expect(page.getByTestId('playground-rate-limited')).toContainText(/réessayez dans (1:00|0:[0-5]\d)/);
  await expect(composer(page)).toBeDisabled();
  await expect(page.getByTestId('playground-send')).toBeDisabled();
  await expect(page.getByTestId('playground-retry')).toHaveCount(0);
  await expect(page.getByTestId('playground-thread').locator('[data-message="customer"]')).toHaveCount(1);
  await expect(page.getByTestId('playground-thread').locator('[data-message="ai"]')).toHaveCount(0);
  const before = await page.getByTestId('playground-rate-limited').innerText();
  await expect(page.getByTestId('playground-rate-limited')).not.toHaveText(before, { timeout: 5000 });
});

test('locale switch to Arabic keeps the page (dir=rtl); axe on the intro state', async ({ page }) => {
  await enter(page, pathOf(token), () => state(page, 'intro'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expectNoA11yViolations(page);

  const languages = page.getByRole('group', { name: 'Langue' });
  await expect(languages.getByRole('button', { name: 'fr', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // one click, then a long wait: on the shared dev server the transition can take half a minute, and a repeated click
  // restarts it
  const arabic = new RegExp(`/ar/agent-test/${token}$`);
  await expect(async () => {
    if (!arabic.test(page.url())) await languages.getByRole('button', { name: 'ar', exact: true }).click();
    await expect(page).toHaveURL(arabic, { timeout: 60_000 });
  }).toPass({ timeout: 150_000 });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', FIRST);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(shared(page)).toHaveAttribute('data-state', 'intro', FIRST);
  await expect(page.getByRole('heading', { name: AGENT, level: 1 })).toBeVisible();
  await expect(shared(page).locator('button[lang="ar"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('playground-composer')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expectNoA11yViolations(page);
});
