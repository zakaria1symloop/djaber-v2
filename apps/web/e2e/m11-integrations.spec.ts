// M11 — Settings › Intégrations on the REAL API (SHEETS_DRIVER=fake: simulated Google consent page + spreadsheets kept by
// the API; outbound webhooks delivered by the worker to the API's local receiver `/dev/webhook-receiver/<name>`; no
// Google, no live URL). AT-ST-10 (5 Sheets states, API key shown once, webhook disabled banner), AT-GSH-01, AT-API-01,
// AT-API-02, plan gate, Operator 403, filters of the deliveries journal in the URL. No `// mock:`.
import { randomUUID } from 'node:crypto';
import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { API, apiReady, createAccount, type Account } from './support/m1';
import { expectNoHorizontalOverflow, openPage, signIn } from './support/m4-agents';
import { idem, realGet, realPost } from './support/m4-real';
import { seedOrder, seedProduct, setStatus } from './support/m5-orders';
import { inviteMember, subscribe } from './support/m9';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

type Sheets = { state: string; spreadsheetId: string | null; spreadsheetTitle: string | null; googleEmail: string | null; lastError: { code: string } | null; actions: { key: string; enabled: boolean }[] };
type FakeSheet = { id: string; title: string; owner: string; tabs: Record<string, (string | number)[][]> };
type Endpoint = { id: string; url: string; status: string; failureCount: number };
type Delivery = { id: string; status: string; event: string; replayOfId: string | null };
type Note = { type: string };

const sheetsOf = (request: APIRequestContext, a: Account) => realGet<Sheets>(request, a, '/integrations/google-sheets');
const fakeSheet = async (request: APIRequestContext, id: string): Promise<FakeSheet> => {
  const r = await request.get(`${API}/dev/google/spreadsheets/${id}`);
  expect(r.ok(), await r.text()).toBeTruthy();
  return ((await r.json()) as { data: FakeSheet }).data;
};
/** data rows of the "Commandes" tab (row 1 = headers); column R (index 17) = djaber_id */
const rowsOf = (s: FakeSheet) => (s.tabs.Commandes ?? []).slice(1);
const ID_COL = 17;
const STATUS_COL = 13;
const receiver = (name: string, fail?: number) => `${API}/dev/webhook-receiver/${name}${fail ? `?fail=${fail}` : ''}`;
const sheetsCard = (page: Page) => page.getByTestId('sheets-card');
const notesOf = (request: APIRequestContext, a: Account) => realGet<Note[]>(request, a, '/notifications');

let owner: Account;

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable');
  owner = await createAccount(request, { prefix: 'm11int', finishOnboarding: true });
  const ok = await request.get(`${API}/api-keys`, { headers: { Authorization: `Bearer ${owner.accessToken}`, 'X-Workspace-Id': owner.workspaceId! } });
  test.skip(!ok.ok(), 'M11 integrations endpoints not available');
});

test('AT-ST-10 / AT-GSH-01 — Sheets: not connected → simulated Google consent → pick sheet (create) → active; rows appended and updated after a re-sort; token revoked ⇒ error + reconnect; sheet deleted; disconnect', async ({ page, request }) => {
  await signIn(page, owner);
  // /settings/integrations opens the Sheets tab; the sub-nav has "Intégrations" (Owner)
  await openPage(page, '/fr/settings/integrations', () => sheetsCard(page));
  await expect(page).toHaveURL(/\/fr\/settings\/integrations\/sheets$/);
  await expect(page.getByRole('navigation', { name: 'Paramètres' }).getByRole('link', { name: 'Intégrations' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('integrations-tabs').locator('[data-tab="sheets"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('api-docs-link')).toHaveAttribute('href', /\/api\/docs$/);
  // state 1: not connected
  await expect(sheetsCard(page)).toHaveAttribute('data-state', 'not_connected');
  await expect(page.getByTestId('sheets-pill')).toContainText('Non connecté');
  await expectNoA11yViolations(page);

  // "Connecter Google" → the API's simulated consent page → "Autoriser" → back with ?sheets=connected
  await page.getByTestId('sheets-connect').click();
  await expect(page).toHaveURL(/\/dev\/google\/consent\?/, { timeout: 30_000 });
  await page.getByRole('link', { name: 'Autoriser' }).click();
  await expect(page).toHaveURL(/\/fr\/settings\/integrations\/sheets$/, { timeout: 30_000 });
  // state 2: connected, sheet to choose — the dialog opens by itself
  const dialog = page.getByTestId('sheets-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(sheetsCard(page)).toHaveAttribute('data-state', 'pick_sheet');
  await expect(page.getByRole('dialog')).toContainText(owner.email);
  // a pasted URL of an unknown sheet ⇒ SHEETS_SPREADSHEET_NOT_FOUND inline, content preserved
  await page.getByTestId('sheets-option-url').click();
  const unknown = 'https://docs.google.com/spreadsheets/d/fakeDoesNotExist0000000000000/edit';
  await page.getByTestId('sheets-url').fill(unknown);
  await page.getByTestId('sheets-submit').click();
  await expect(page.getByRole('dialog')).toContainText(errText('SHEETS_SPREADSHEET_NOT_FOUND'));
  await expect(page.getByTestId('sheets-url')).toHaveValue(unknown);
  // create "Djaber · Commandes <boutique>"
  await page.getByTestId('sheets-option-create').click();
  await page.getByTestId('sheets-submit').click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  // state 3: active
  await expect(sheetsCard(page)).toHaveAttribute('data-state', 'active');
  await expect(page.getByTestId('sheets-link')).toContainText('Djaber · Commandes');
  const s = await sheetsOf(request, owner);
  expect(s.state).toBe('active');
  const sheetId = s.spreadsheetId!;
  expect((await fakeSheet(request, sheetId)).tabs.Commandes?.[0]?.[0]).toBe('Numéro');

  // AT-GSH-01: an order ⇒ its row within 10 s (5 s debounce + worker)
  const product = await seedProduct(request, owner, 'Robe satin', 4900, 20);
  const order = await seedOrder(request, owner, { productId: product.id, name: 'Amina Sheets' });
  await expect.poll(async () => rowsOf(await fakeSheet(request, sheetId)).filter((r) => r[ID_COL] === order.id).length, { timeout: 15_000, intervals: [1_000] }).toBe(1);
  // re-sorted sheet: the status change still lands on the same row (found by djaber_id, never by position)
  await request.post(`${API}/dev/google/spreadsheets/${sheetId}/shuffle`);
  const before = String(rowsOf(await fakeSheet(request, sheetId)).find((r) => r[ID_COL] === order.id)![STATUS_COL]);
  await setStatus(request, owner, order.id, 'confirmed');
  await expect
    .poll(async () => {
      const rows = rowsOf(await fakeSheet(request, sheetId)).filter((r) => r[ID_COL] === order.id);
      return rows.length === 1 && String(rows[0]![STATUS_COL]) !== before ? 'updated' : `rows=${rows.length}`;
    }, { timeout: 20_000, intervals: [1_000] })
    .toBe('updated');
  await page.reload();
  await expect(page.getByTestId('sheets-rows')).toContainText('1 commandes synchronisées', { timeout: 30_000 });
  await expect(page.getByTestId('sheets-pill')).toContainText(/synchro/i);

  // filters: only orders of the source "manuel" (the dialog keeps "toutes les pages")
  await page.getByTestId('sheets-filters').click();
  await page.getByTestId('sheets-all-sources').uncheck();
  await page.getByTestId('sheets-sources').locator('[data-chip="manual"]').click();
  await page.getByTestId('sheets-submit').click();
  await expect(page.getByTestId('sheets-filters-summary')).toHaveText('Toutes les pages · sources manuel');

  // backfill of the last 30 days (job + progress, then the card is refreshed)
  await page.getByTestId('sheets-backfill').click();
  await expect(page.getByTestId('sheets-dialog')).toHaveAttribute('data-mode', 'backfill');
  await page.getByTestId('sheets-submit').click();
  await expect(page.locator('[data-toast]').filter({ hasText: 'Rattrapage' }).first()).toBeVisible();

  // token revoked at Google ⇒ next sync fails ⇒ error state + "Reconnecter Google"
  await request.post(`${API}/dev/google/accounts/${encodeURIComponent(owner.email)}/revoke`);
  await setStatus(request, owner, order.id, 'preparing');
  await expect.poll(async () => (await sheetsOf(request, owner)).lastError?.code ?? 'none', { timeout: 30_000, intervals: [1_000] }).toBe('SHEETS_TOKEN_REVOKED');
  await page.reload();
  // state 4: error, access revoked
  await expect(sheetsCard(page)).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
  await expect(page.getByTestId('sheets-error')).toHaveAttribute('data-code', 'SHEETS_TOKEN_REVOKED');
  await expect(page.getByTestId('sheets-reconnect')).toBeVisible();
  // the sheets.error notification reached the Owner
  await expect.poll(async () => (await notesOf(request, owner)).some((n) => /sheets[._]error/.test(n.type)), { timeout: 20_000 }).toBe(true);
  // reconnect: same consent flow, the chosen sheet is kept (same Google account)
  await page.getByTestId('sheets-reconnect').click();
  await expect(page).toHaveURL(/\/dev\/google\/consent\?/, { timeout: 30_000 });
  await page.getByRole('link', { name: 'Autoriser' }).click();
  await expect(page).toHaveURL(/\/fr\/settings\/integrations\/sheets$/, { timeout: 30_000 });
  await expect(sheetsCard(page)).toHaveAttribute('data-state', 'active', { timeout: 30_000 });
  expect((await sheetsOf(request, owner)).spreadsheetId).toBe(sheetId);

  // state 5: sheet deleted in Drive ⇒ "feuille introuvable" + "Choisir une autre feuille"
  await request.post(`${API}/dev/google/spreadsheets/${sheetId}/delete`);
  await setStatus(request, owner, order.id, 'confirmed').catch(() => undefined);
  await seedOrder(request, owner, { productId: product.id, name: 'Yacine Sheets' });
  await expect.poll(async () => (await sheetsOf(request, owner)).lastError?.code ?? 'none', { timeout: 30_000, intervals: [1_000] }).toBe('SHEETS_SPREADSHEET_NOT_FOUND');
  await page.reload();
  await expect(page.getByTestId('sheets-error')).toHaveAttribute('data-code', 'SHEETS_SPREADSHEET_NOT_FOUND', { timeout: 30_000 });
  await expect(page.getByTestId('sheets-pick-other')).toBeVisible();

  // disconnect (confirmation: the sheet is not deleted)
  await page.getByTestId('sheets-disconnect').click();
  await expect(page.getByRole('dialog')).toContainText('La feuille n’est pas supprimée, la synchro s’arrête.');
  await page.getByRole('dialog').getByRole('button', { name: 'Déconnecter' }).click();
  await expect(sheetsCard(page)).toHaveAttribute('data-state', 'not_connected');
  expect((await sheetsOf(request, owner)).state).toBe('not_connected');
});

test('AT-ST-10 / AT-API-01 — API key: create (name, scopes) → shown once → orders:read only; outside its scopes 403 API_SCOPE_FORBIDDEN, /billing always 403; revoke ⇒ 401 API_KEY_REVOKED', async ({ page, request }) => {
  await signIn(page, owner);
  await openPage(page, '/fr/settings/integrations/api-keys', () => page.getByTestId('api-keys-card'));
  await expect(page.getByTestId('api-keys-allowance')).toContainText('0 / 5');
  await page.getByTestId('api-key-create').click();
  // validation: name and one scope required
  await page.getByTestId('api-key-submit').click();
  await expect(page.getByRole('dialog')).toContainText('Champ requis');
  await expect(page.getByRole('dialog')).toContainText('Choisissez au moins une portée.');
  await page.getByTestId('api-key-name').fill('ERP interne');
  await page.getByTestId('api-key-scopes').locator('[data-chip="orders:read"]').click();
  await page.getByTestId('api-key-submit').click();
  // shown once
  const secret = page.getByTestId('api-key-secret');
  await expect(secret).toContainText('elle ne sera plus jamais affichée');
  const key = (await secret.locator('[data-secret]').textContent())!.trim();
  expect(key).toMatch(/^dj_live_/);
  await expectNoA11yViolations(page);
  await page.getByTestId('api-key-done').click();
  const row = page.getByTestId('api-key-row').filter({ hasText: 'ERP interne' });
  await expect(row).toHaveAttribute('data-status', 'active');
  await expect(row).toContainText(key.slice(0, 16));
  await expect(row).not.toContainText(key);
  await expect(row).toContainText('jamais utilisée');
  // the key is never shown again
  await page.reload();
  await expect(page.getByTestId('api-key-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(key)).toHaveCount(0);

  // AT-API-01 with the key
  const asKey = { 'X-API-Key': key };
  expect((await request.get(`${API}/orders?pageSize=25`, { headers: asKey })).status()).toBe(200);
  const refused = await request.post(`${API}/orders`, { headers: { ...asKey, ...idem() }, data: { items: [] } });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('API_SCOPE_FORBIDDEN');
  const billing = await request.get(`${API}/billing/subscription`, { headers: asKey });
  expect(billing.status()).toBe(403);
  await page.reload();
  await expect(page.getByTestId('api-key-row').filter({ hasText: 'ERP interne' })).toContainText('dernière utilisation', { timeout: 30_000 });

  // revoke (one Actions ⌄ per row) ⇒ RÉVOQUÉE, the key answers 401 API_KEY_REVOKED, the menu item is greyed
  await page.getByTestId('api-key-row').filter({ hasText: 'ERP interne' }).getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Révoquer' }).click();
  await expect(page.getByRole('dialog')).toContainText(errText('API_KEY_REVOKED'));
  await page.getByRole('dialog').getByRole('button', { name: 'Révoquer' }).click();
  const revoked = page.getByTestId('api-key-row').filter({ hasText: 'ERP interne' });
  await expect(revoked).toHaveAttribute('data-status', 'revoked');
  await expect(revoked).toContainText('Révoquée');
  const after = await request.get(`${API}/orders?pageSize=25`, { headers: asKey });
  expect(after.status()).toBe(401);
  expect(((await after.json()) as { error: { code: string } }).error.code).toBe('API_KEY_REVOKED');
  await revoked.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Révoquer' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('menu')).toContainText('(CONFLICT)');
  await page.keyboard.press('Escape');
});

test('AT-ST-10 / AT-API-02 — webhooks: add (events, secret once), test ping delivered + signed; failing 50× ⇒ disabled banner + notification; re-enable; journal filters in the URL; replay; rotate; delete', async ({ page, request }) => {
  const okName = `m11ok${randomUUID().slice(0, 8)}`;
  const badName = `m11ko${randomUUID().slice(0, 8)}`;
  await signIn(page, owner);
  await openPage(page, '/fr/settings/integrations/webhooks', () => page.getByTestId('webhooks-card'));
  await expect(page.getByTestId('webhooks-card')).toContainText('Aucun endpoint');

  // add an endpoint: invalid URL inline, then a valid one; the secret is shown once
  await page.getByTestId('webhook-add').click();
  await page.getByTestId('webhook-url').fill('pas une url');
  await page.getByTestId('webhook-submit').click();
  await expect(page.getByRole('dialog')).toContainText('HTTPS obligatoire');
  await expect(page.getByRole('dialog')).toContainText('Choisissez au moins un événement.');
  await page.getByTestId('webhook-url').fill(receiver(okName));
  await page.getByTestId('webhook-events').locator('[data-chip="order.created"]').click();
  await page.getByTestId('webhook-events').locator('[data-chip="customer.new"]').click();
  await page.getByTestId('webhook-submit').click();
  const secret = page.getByTestId('webhook-secret');
  await expect(secret).toBeVisible();
  expect((await secret.locator('[data-secret]').textContent())!.trim()).toMatch(/^whsec_/);
  await page.getByTestId('webhook-secret-done').click();
  const okRow = page.getByTestId('webhook-row').filter({ hasText: okName });
  await expect(okRow).toHaveAttribute('data-status', 'active');
  await expect(okRow).toContainText('order.created · customer.new');

  // test ping ⇒ journal filtered on the endpoint (URL), delivered 200, signed with the secret
  await okRow.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Tester' }).click();
  await expect(page).toHaveURL(/[?&]endpoint=[0-9a-f-]{36}/);
  const ping = page.locator('[data-testid="delivery-row"][data-event="ping"]').first();
  await expect(ping).toHaveAttribute('data-status', 'success', { timeout: 45_000 });
  await expect(ping).toContainText(/200 · \d+ ms/);
  const hits = (await (await request.get(`${API}/dev/webhook-receiver/${okName}`)).json()) as { data: { event: string; signatureValid: boolean }[] };
  expect(hits.data.some((h) => h.event === 'ping' && h.signatureValid)).toBe(true);
  // payload view (local menu item)
  await ping.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Voir le contenu' }).click();
  await expect(page.getByTestId('delivery-payload')).toContainText('"event": "ping"');
  await page.keyboard.press('Escape');

  // a failing receiver (503): 50 failed attempts ⇒ disabled + webhook.disabled notification (AT-API-02)
  const bad = await realPost<{ id: string; secret: string }>(request, owner, '/webhooks', { url: receiver(badName, 503), events: ['customer.new'] });
  for (let i = 0; i < 50; i++) await realPost(request, owner, `/webhooks/${bad.id}/test`, {}, idem());
  await expect.poll(async () => (await realGet<Endpoint>(request, owner, `/webhooks/${bad.id}`)).status, { timeout: 120_000, intervals: [2_000] }).toBe('disabled');
  await page.reload();
  const banner = page.locator(`[data-testid="webhook-disabled-banner"][data-endpoint="${bad.id}"]`);
  await expect(banner).toContainText('désactivé après 50 échecs (503)', { timeout: 30_000 });
  await expect(page.getByTestId('webhook-row').filter({ hasText: badName })).toHaveAttribute('data-status', 'disabled');
  await expect.poll(async () => (await notesOf(request, owner)).some((n) => /webhook[._]disabled/.test(n.type)), { timeout: 20_000 }).toBe(true);
  // "Tester" is greyed with the server reason on the disabled endpoint
  await page.getByTestId('webhook-row').filter({ hasText: badName }).getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Tester' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('menu')).toContainText(errText('WEBHOOK_ENDPOINT_DISABLED'));
  await page.keyboard.press('Escape');

  // journal filters live in the URL: endpoint + status (filtered-empty), then another status from the select
  await page.goto(`/fr/settings/integrations/webhooks?endpoint=${bad.id}&status=success`);
  await expect(page.getByTestId('deliveries-status')).toHaveValue('success', { timeout: 30_000 });
  await expect(page.locator('[data-testid="delivery-row"]')).toHaveCount(0);
  await page.getByTestId('deliveries-status').selectOption('exhausted');
  await expect(page).toHaveURL(/status=exhausted/);
  await expect(page).toHaveURL(new RegExp(`endpoint=${bad.id}`));
  await expect(page.locator('[data-testid="delivery-row"]').first()).toHaveAttribute('data-status', 'exhausted', { timeout: 30_000 });
  await expect(page.locator('[data-testid="delivery-row"]').first()).toContainText('503 · tentative');

  // re-enable from the banner (failure counter reset), then replay a failed delivery from the journal
  await page.getByTestId('webhook-enable').click();
  await expect(banner).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('webhook-row').filter({ hasText: badName })).toHaveAttribute('data-status', 'active');
  expect((await realGet<Endpoint>(request, owner, `/webhooks/${bad.id}`)).failureCount).toBe(0);
  const firstFailed = page.locator('[data-testid="delivery-row"][data-status="exhausted"]').first();
  const failedId = await firstFailed.getAttribute('data-delivery');
  await firstFailed.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Rejouer' }).click();
  await expect(page.locator('[data-toast]').filter({ hasText: 'renvoyé' }).first()).toBeVisible();
  await expect
    .poll(async () => (await realGet<Delivery[]>(request, owner, `/webhooks/${bad.id}/deliveries?pageSize=25`)).some((d) => d.replayOfId === failedId), { timeout: 20_000 })
    .toBe(true);

  // edit: rotate the secret (new secret shown once), then delete with confirmation
  await page.getByTestId('webhook-row').filter({ hasText: okName }).getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Modifier' }).click();
  await expect(page.getByTestId('webhook-url')).toHaveValue(receiver(okName));
  await page.getByTestId('webhook-rotate').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Régénérer le secret' }).click();
  await expect(page.getByTestId('webhook-secret')).toBeVisible();
  await page.getByTestId('webhook-secret-done').click();
  await page.getByTestId('webhook-row').filter({ hasText: okName }).getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Supprimer' }).click();
  await expect(page.getByRole('dialog')).toContainText('Les livraisons sont conservées 30 j.');
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByTestId('webhook-row').filter({ hasText: okName })).toHaveCount(0);
});

test('plan without api_keys / webhooks (Starter): create disabled with PLAN_FEATURE_REQUIRED + "Comparer les plans"; Arabic without horizontal overflow; Operator ⇒ no "Intégrations" entry and 403 page', async ({ page, request }) => {
  const starter = await createAccount(request, { prefix: 'm11sta', finishOnboarding: true });
  await subscribe(request, starter, 'starter');
  await signIn(page, starter);
  await openPage(page, '/fr/settings/integrations/api-keys', () => page.getByTestId('api-keys-card'));
  await expect(page.locator('[data-testid="plan-gate"][data-feature="api_keys"]')).toContainText(errText('PLAN_FEATURE_REQUIRED'));
  await expect(page.getByTestId('api-key-create')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('api-key-create')).toHaveAttribute('title', errText('PLAN_FEATURE_REQUIRED'));
  await page.getByTestId('integrations-tabs').locator('[data-tab="webhooks"]').click();
  await expect(page.locator('[data-testid="plan-gate"][data-feature="webhooks"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('webhook-add')).toHaveAttribute('aria-disabled', 'true');
  // Starter keeps Google Sheets
  await page.getByTestId('integrations-tabs').locator('[data-tab="sheets"]').click();
  await expect(sheetsCard(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="plan-gate"]')).toHaveCount(0);
  // "Comparer les plans" → billing
  await page.getByTestId('integrations-tabs').locator('[data-tab="api-keys"]').click();
  await page.getByRole('button', { name: 'Comparer les plans' }).click();
  await expect(page).toHaveURL(/\/fr\/settings\/billing$/, { timeout: 30_000 });

  // Arabic: RTL, no horizontal overflow on the three tabs (1440, then 390)
  const ready = { sheets: 'sheets-card', 'api-keys': 'api-keys-card', webhooks: 'webhooks-card' } as const;
  for (const tab of ['sheets', 'api-keys', 'webhooks'] as const) {
    await openPage(page, `/ar/settings/integrations/${tab}`, () => page.getByTestId(ready[tab]));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, '/ar/settings/integrations/webhooks', () => page.getByTestId('webhooks-card'));
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Operator: no entry in the sub-nav, 403 page on a direct link (the API refuses too)
  const operator = await inviteMember(request, starter, 'operator');
  const refused = await request.get(`${API}/api-keys`, { headers: { Authorization: `Bearer ${operator.accessToken}`, 'X-Workspace-Id': starter.workspaceId! } });
  expect(refused.status()).toBe(403);
  await page.context().clearCookies();
  await signIn(page, operator);
  const subnav = page.getByRole('navigation', { name: 'Paramètres' });
  await openPage(page, '/fr/settings/profile', () => subnav.getByRole('link', { name: 'Profil' }));
  await expect(subnav.getByRole('link', { name: 'Intégrations' })).toHaveCount(0);
  await page.goto('/fr/settings/integrations/webhooks');
  await expect(page.getByText('403', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Accès refusé')).toBeVisible();
  await expect(page.getByTestId('webhooks-card')).toHaveCount(0);
});

test('unknown tab ⇒ localized 404 page', async ({ page }) => {
  await signIn(page, owner);
  await page.goto('/fr/settings/integrations/couriers');
  await expect(page.getByText('Introuvable ou accès refusé')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('integrations-tabs')).toHaveCount(0);
});
