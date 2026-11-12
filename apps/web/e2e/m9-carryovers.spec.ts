// M9 — states left to billing by earlier stages, now produced by the REAL API (dev billing clock / fake gateway) instead
// of the `// mock:` answers of M4 / M8:
// - agent `pausedReason: 'plan'` (m4-agents / m4-agent-page): a trial with 2 active agents expires ⇒ free plan (1 agent),
//   the newest agent paused by the plan: card PAUSE (PLAN), "Reprendre" refused PLAN_LIMIT, page banner, no switch;
// - M8 scheduled reports without `scheduled_reports` (m8-reports): a Starter workspace gets the real
//   `PLAN_FEATURE_REQUIRED` and the "Comparer les plans" link to /settings/billing;
// - M3 / M8 "Comparer les plans" links land on the real /settings/billing.
import { expect as baseExpect, test } from '@playwright/test';
import { API, apiReady, authHeaders } from './support/m1';
import { signIn } from './support/m4-agents';
import { activeAgent, listAgents, setupShop } from './support/m4-real';
import { billingClock, billingReady, subscribe, subscriptionOf } from './support/m9';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 300_000 });
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
});

test('M4 carry-over — agent paused by the plan after expiry: PAUSE (PLAN), "Reprendre" refused PLAN_LIMIT, page banner without switch', async ({ page, request }) => {
  const s = await setupShop(request, 'm9agp', { products: false });
  test.skip(!(await billingReady(request, s.owner)), 'M9 billing endpoints not available');
  await activeAgent(request, s.owner, { name: 'Vendeur ancien', channelId: s.facebook.id });
  await activeAgent(request, s.owner, { name: 'Vendeur récent', channelId: s.facebook2.id });
  await billingClock(request, s.owner, 15);
  await expect.poll(async () => (await subscriptionOf(request, s.owner)).expiredFrom !== null, { timeout: 30_000 }).toBe(true);
  // newest first: "Vendeur récent" is paused by the plan
  const recent = (await listAgents(request, s.owner)).find((a) => a.name === 'Vendeur récent')!;
  expect([recent.status, recent.pausedReason]).toEqual(['paused', 'plan']);

  await signIn(page, s.owner);
  await page.goto('/fr/agents');
  const card = page.locator(`[data-testid="agent-card"][data-agent="${recent.id}"]`);
  await expect(card).toHaveAttribute('data-state', 'paused_plan', { timeout: 30_000 });
  await expect(card.getByTestId('agent-status')).toHaveText('PAUSE (PLAN)');
  // its own strip, no "Actif" switch
  await expect(card.getByTestId('agent-paused-plan')).toContainText('En pause par le plan');
  await expect(card.getByRole('switch')).toHaveCount(0);
  // "Reprendre" on an agent paused by the plan: the free plan has no slot left ⇒ the API refuses PLAN_LIMIT and the
  // limit dialog offers "Comparer les plans" (the descriptor itself is not greyed yet: web-requests H)
  await card.getByRole('button', { name: 'Actions' }).click();
  const menu = page.getByRole('menu');
  const resume = menu.getByRole('menuitem', { name: 'Reprendre', exact: true });
  if ((await resume.getAttribute('aria-disabled')) === 'true') {
    await expect(menu).toContainText(errText('PLAN_LIMIT'));
    await page.keyboard.press('Escape');
  } else {
    await resume.click();
    await expect(page.getByTestId('agents-limit-dialog')).toContainText(errText('PLAN_LIMIT'));
    await page.keyboard.press('Escape');
  }
  expect((await listAgents(request, s.owner)).find((a) => a.id === recent.id)?.status).toBe('paused');

  await page.goto(`/fr/agents/${recent.id}`);
  await expect(page.getByTestId('agent-status')).toHaveAttribute('data-state', 'paused_plan', { timeout: 30_000 });
  await expect(page.getByTestId('agent-paused-banner')).toContainText("En pause par le plan : la limite d'agents est atteinte.");
  await expect(page.getByRole('switch', { name: /Agent Vendeur récent actif/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Comparer les plans' }).click();
  await expect(page).toHaveURL(/\/fr\/settings\/billing$/);
  await expect(page.getByTestId('plan-cards')).toBeVisible({ timeout: 30_000 });
});

test('M8 carry-over — Starter has no scheduled reports: upgrade state, real PLAN_FEATURE_REQUIRED, "Comparer les plans" → /settings/billing', async ({ page, request }) => {
  const s = await setupShop(request, 'm9rpt', { products: false, pages: false });
  test.skip(!(await billingReady(request, s.owner)), 'M9 billing endpoints not available');
  await subscribe(request, s.owner, 'starter');
  const refused = await request.post(`${API}/reports/sales_by_period/schedule`, { headers: authHeaders(s.owner), data: { email: s.owner.email, dayOfMonth: 5 } });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('PLAN_FEATURE_REQUIRED');
  await signIn(page, s.owner);
  await expect(async () => {
    await page.goto('/fr/reports/sales_by_period', { timeout: 60_000 });
    await expect(page.getByTestId('report-schedule')).toBeVisible({ timeout: 30_000 });
  }).toPass({ timeout: 120_000 });
  // the plan of the workspace has no `scheduled_reports`: the dialog opens on the upgrade state (the API refuses as well)
  await page.getByTestId('report-schedule').click();
  await expect(page.getByTestId('schedule-gated')).toContainText(errText('PLAN_FEATURE_REQUIRED'));
  await expect(page.getByTestId('schedule-submit')).toHaveCount(0);
  await page.getByTestId('schedule-upgrade').click();
  await expect(page).toHaveURL(/\/fr\/settings\/billing$/);
  await expect(page.locator('[data-testid="plan-card"][data-plan="starter"]')).toContainText('VOTRE PLAN', { timeout: 30_000 });
});
