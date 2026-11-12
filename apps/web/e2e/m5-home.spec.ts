// M5 — home dashboard (ANA-01): AT-ANA-01 (KPI tiles equal the named figures of `GET /dashboard/home`, "À traiter"
// lists needs-human conversations + insights, and failed parcels / low stock / reconnect cards), AT-UX-05 (Get Started
// reflects real entities), the states of "ANA-01b" (new workspace "Tout est calme", 0 page card, skeleton, error),
// the page cards and their badges, RTL (/ar/home), axe on the default state.
// On the REAL API; `page.route` only where the fake drivers cannot produce the state (each use says why).
import { formatNumber } from '@djaber/shared';
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, expectUrl, loginHome, type Account } from './support/m1';
import { activeAgent, customerSays, INSIGHT_TRIGGERS, nextSender, setupShop, type Shop } from './support/m4-real';
import { dashboardReady, fixtureHome, getHome, mockHome } from './support/m5-home';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

/** `1 240 000` → `1,24 M` as on the tile (fr), under one million the grouped number. */
const compact = (n: number) => (Math.abs(n) < 1_000_000 ? formatNumber(n) : `${(Math.round(n / 10_000) / 100).toFixed(2).replace(/0$/, '').replace('.', ',')} M`);

let fresh: Account;
test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  fresh = await createAccount(request, { prefix: 'home', finishOnboarding: true });
  test.skip(!(await dashboardReady(request, fresh)), 'M5 dashboard API (GET /dashboard/home) not reachable');
});

test('AT-UX-05 new workspace: "Tout est calme", no page card, Get Started 0 / 4, tiles at 0, localized title, axe', async ({ page }) => {
  await loginHome(page, fresh);
  await expect(page).toHaveTitle('Accueil · Djaber.ai');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(fresh.firstName);
  await expect(page.getByTestId('home-queue-empty')).toContainText('Tout est calme');
  await expect(page.getByTestId('home-pages-empty')).toContainText('Aucune page connectée');
  await expect(page.getByTestId('home-pages-empty').getByRole('link', { name: 'Connecter Facebook' })).toHaveAttribute('href', /\/fr\/channels$/);
  await expect(page.getByTestId('checklist-count')).toHaveText('0 / 4');
  const kpis = page.getByTestId('home-kpis');
  await expect(kpis.locator('[data-kpi=pages]')).toContainText('0');
  await expect(kpis.locator('[data-kpi=products]')).toContainText('0');
  // quick actions of the frame
  for (const name of ['Connecter une page', 'Ajouter des produits', 'Agents IA']) await expect(page.getByTestId('home-quick-actions')).toContainText(name);
  await expectNoA11yViolations(page);
});

test.describe('with a shop (fake pages, catalogue, active agent)', () => {
  let shop: Shop;
  test.beforeAll(async ({ request }) => {
    shop = await setupShop(request, 'home-shop');
  });

  test('AT-ANA-01 KPI tiles equal the named figures of the server; AT-UX-05 steps follow the real entities', async ({ page, request }) => {
    const home = await getHome(request, shop.owner);
    await loginHome(page, shop.owner);
    const kpis = page.getByTestId('home-kpis');
    await expect(kpis.locator('[data-kpi=pages]')).toContainText(formatNumber(home.kpis.channels.active));
    await expect(kpis.locator('[data-kpi=products]')).toContainText(formatNumber(home.kpis.products.total));
    await expect(kpis.locator('[data-kpi=revenue]')).toContainText(compact(home.kpis.revenue30d.value));
    await expect(kpis.locator('[data-kpi=stock]')).toContainText(compact(home.kpis.stockValue.cost ?? home.kpis.stockValue.retail));
    // pages and products exist ⇒ the two first steps are done (no agent linked yet ⇒ step 3 open)
    await expect(page.locator('[data-step=channel] [data-done=true]')).toBeVisible();
    await expect(page.locator('[data-step=product] [data-done=true]')).toBeVisible();
    await expect(page.locator('[data-step=agent] [data-done=false]')).toBeVisible();
    // one card per connected page, with its status badge
    for (const p of home.pages) await expect(page.getByTestId('home-pages').locator(`[data-page="${p.id}"]`)).toContainText(p.name);
    // tiles CONV. · MSG 7J · NON LUS · STOCK are the server's figures
    const first = page.getByTestId('home-pages').locator(`[data-page="${home.pages[0].id}"]`);
    await expect(first.locator('[data-tile=conversations] dd')).toHaveText(String(home.pages[0].conversations.total));
    await expect(first.locator('[data-tile=messages] dd')).toHaveText(String(home.pages[0].messages7d.total));
    await expect(first.locator('[data-tile=stock] dd')).toHaveText(String(home.kpis.products.total));
    await expect(first).toContainText(/connectée le/i);
  });

  test('AT-ANA-01 "À traiter" lists the needs-human conversation and the insight of a real customer message', async ({ page, request }) => {
    await activeAgent(request, shop.owner, { name: 'Vendeur Pro', channelId: shop.facebook.id });
    const sender = nextSender();
    await customerSays(request, shop.owner, { channelId: shop.facebook.id, sender, text: INSIGHT_TRIGGERS.handoff });
    let home = await getHome(request, shop.owner);
    await expect.poll(async () => (home = await getHome(request, shop.owner)).queue.items.some((i) => i.kind === 'conversation'), { timeout: 60_000 }).toBe(true);
    await loginHome(page, shop.owner);
    const queue = page.getByTestId('home-queue');
    await expect(queue.getByRole('heading', { name: 'À traiter' })).toBeVisible();
    await expect(queue).toContainText(formatNumber(home.queue.total));
    const card = queue.locator('[data-kind=conversation]').first();
    await expect(card).toContainText('CONVERSATION');
    await expect(card).toContainText(`Client ${sender}`);
    // the agent step is done now (active agent linked to a page)
    await expect(page.locator('[data-step=agent] [data-done=true]')).toBeVisible();
    // the card opens its target
    const target = home.queue.items.find((i) => i.kind === 'conversation')!.path;
    await card.click();
    await expectUrl(page, `**/fr${target}`);
  });
});

test('AT-ANA-01 card kinds COLIS / STOCK / PAGE / INSIGHT / CONVERSATION / RAPPEL / TÂCHE, "+ n autres", page badges, disabled quick action', async ({ page }) => {
  // mock: failed parcels need a courier (M6) and a reconnect card a revoked Meta token — the fake drivers produce neither
  await mockHome(page, fixtureHome());
  await loginHome(page, fresh);
  const queue = page.getByTestId('home-queue');
  for (const label of ['COLIS', 'STOCK', 'PAGE', 'INSIGHT', 'CONVERSATION', 'RAPPEL', 'TÂCHE']) await expect(queue.getByText(label, { exact: true })).toBeVisible();
  // urgency first, then the oldest: the reconnect card (2 h) comes before the failed parcel (1 h)
  await expect(queue.locator('[data-kind]').first()).toHaveAttribute('data-kind', 'page');
  await expect(page.getByTestId('home-queue-more')).toContainText('+ 2 autres');
  await expect(page.getByTestId('home-queue-more')).toHaveAttribute('href', /\/fr\/queue$/);
  const pages = page.getByTestId('home-pages');
  await expect(pages.locator('[data-page="11111111-1111-7111-8111-111111111111"]')).toContainText('ACTIVE');
  await expect(pages.locator('[data-page="22222222-2222-7222-8222-222222222222"]')).toContainText('EN ATTENTE META');
  await expect(pages.locator('[data-page="33333333-3333-7333-8333-333333333333"]')).toContainText('RECONNEXION REQUISE');
  await expect(pages.locator('[data-page="44444444-4444-7444-8444-444444444444"]')).toContainText('EN PAUSE (PLAN)');
  await expect(pages.locator('[data-page="11111111-1111-7111-8111-111111111111"]')).toContainText('IA');
  await expect(page.getByTestId('home-kpis').locator('[data-kpi=revenue]')).toContainText('1,18 M');
  await expect(page.getByTestId('home-kpis').locator('[data-kpi=pages]')).toContainText('1 à reconnecter');
  // AT-UX-03: a refused quick action is not a dead link — greyed with its reason
  const agents = page.locator('[data-action=create_agent]');
  await expect(agents.getByRole('link')).toHaveCount(0);
  await expect(agents.locator('[aria-disabled=true]')).toContainText(errText('PLAN_LIMIT'));
  await queue.locator('[data-kind=callback]').click();
  await expectUrl(page, '**/fr/orders/00000000-0000-7000-8000-000000001041');
});

test('ANA-01b skeleton (same grid) then the error state with Réessayer', async ({ page }) => {
  // mock: a slow and then failing dashboard cannot be produced by the API on demand
  let calls = 0;
  // the first call and its 2 automatic retries (5xx) fail; "Réessayer" then gets the dashboard
  await mockHome(page, () => (++calls <= 3 ? { status: 500, code: 'INTERNAL', message: 'boom' } : fixtureHome()), { delayMs: 1500 });
  await loginHome(page, fresh);
  await expect(page.getByTestId('home-skeleton')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByTestId('home-kpis')).toBeVisible({ timeout: 30_000 });
});

test('RTL: /ar/home is mirrored, numbers stay LTR, no horizontal scroll', async ({ page }) => {
  // mock: the full frame content (queue, four page states) — see above
  await mockHome(page, fixtureHome());
  await loginHome(page, fresh);
  await page.goto('/ar/home');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page).toHaveTitle('الرئيسية · Djaber.ai');
  await expect(page.getByTestId('home-kpis')).toBeVisible();
  await expect(page.getByTestId('checklist-count')).toHaveAttribute('dir', 'ltr');
  // the main column sits on the right of the pages column in RTL
  const main = await page.getByTestId('home-queue').boundingBox();
  const side = await page.getByTestId('home-pages').boundingBox();
  expect(main!.x).toBeGreaterThan(side!.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
