// M10 — platform admin ops screens of web-b: ADM-12 support tickets (Figma "ADM-12 — Platform admin — support tickets"),
// ADM-13 platform settings ("ADM-13 — … platform settings"), ADM-14 jobs & health ("ADM-14 — … jobs & health").
// AT-HELP-03 (support side: reply ⇒ EN ATTENTE CLIENT, internal note, resolve, satisfaction, TICKET_CLOSED),
// AT-HELP-04 (overdue ⇒ DÉPASSÉ DE n), AT-PFS-02 (force update needs the 2FA code), AT-PFS-04 (maintenance window from
// ADM-13, admin side), AT-PFS-07 (provider "Tester" states), AT-OPS-01 (queues table, pause / resume), AT-OPS-03
// (declare → update → resolve an incident, public status page entry), 403 / read-only per platform role.
// Real API on :4010 (fake drivers); platform admins are created in the development database (contract-a e2e note).
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { API, apiReady, authHeaders, createAccount, totp, type Account } from './support/m1';
import { adminHeaders, createTicket, sql } from './support/m10-help';
import { asAdmin, loginAdmin, modAdmin, type ModAdmin } from './support/m10-mod';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial' });
let merchant: Account;
let sa: ModAdmin;
let readOnly: ModAdmin;
let page: Page;
const stamp = Date.now().toString(36);
const window30 = () => Math.floor(Date.now() / 30_000);

/** A TOTP code of a 30 s window this admin has not used yet (each code is accepted once). */
async function unusedCode(a: ModAdmin) {
  while (window30() <= a.usedWindow || 30_000 - (Date.now() % 30_000) < 5_000) await new Promise((r) => setTimeout(r, 1_000));
  a.usedWindow = window30();
  return totp(a.secret);
}

test.beforeAll(async ({ request, browser }) => {
  test.setTimeout(300_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  merchant = await createAccount(request, { prefix: 'm10ops', finishOnboarding: true });
  sa = await modAdmin(request, 'super_admin', 'm10ops');
  const ready = await request.get(`${API}/admin/support/stats`, { headers: adminHeaders(sa) });
  test.skip(!ready.ok(), `M10 ops API not deployed (GET /admin/support/stats → ${ready.status()})`);
  readOnly = await modAdmin(request, 'read', 'm10ops');
  page = await (await browser.newContext()).newPage();
  await loginAdmin(page, sa, '/fr/admin/support');
});
test.afterAll(async ({ request }) => {
  // never leave the platform in maintenance (every other spec writes)
  if (sa) await request.put(`${API}/admin/maintenance`, { headers: adminHeaders(sa), data: { enabled: false, scope: 'all' } });
  await page?.context().close();
});

test('AT-HELP-03 support side: row with SLA, canned reply, "Envoyer & attendre le client", note interne, Résoudre, satisfaction, TICKET_CLOSED', async ({ request }) => {
  const ticket = await createTicket(request, merchant, { message: `Depuis hier les commandes n’arrivent plus dans ma feuille ${stamp}.` });
  // the shared dev DB keeps tickets of earlier runs (more than one page): the list is searched by this ticket's number
  await page.goto(`/fr/admin/support?q=${encodeURIComponent(ticket.number)}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Support' })).toBeVisible();
  await expect(page.locator('[data-tab="open"]')).toHaveAttribute('aria-current', 'page');
  const row = page.locator(`tr[data-row="${ticket.id}"]`);
  await expect(row).toContainText(`#${ticket.number}`);
  await expect(row.locator('[data-sla="remaining"]')).toContainText('RESTANTES');
  await expectNoA11yViolations(page);

  // detail under the list, in the URL (?sheet=)
  await row.click();
  await expect(page).toHaveURL(new RegExp(`sheet=${ticket.id}`));
  const detail = page.getByTestId('ticket-detail');
  await expect(detail).toHaveAttribute('data-status', 'open');
  await expect(detail.locator('li[data-author="user"]').first()).toContainText(stamp);
  await expect(page.getByTestId('ticket-context')).toContainText('ESPACE');

  // "/" opens the canned replies; picking one fills the composer, then "Envoyer & attendre le client"
  const composer = page.getByTestId('ticket-composer');
  await composer.fill('/sheets');
  await page.getByTestId('canned-suggestions').getByRole('button').first().click();
  await expect(composer).not.toHaveValue('/sheets');
  await page.getByTestId('ticket-send').click();
  await expect(detail).toHaveAttribute('data-status', 'pending_customer');
  await expect(detail.locator('li[data-author="support"]')).toHaveCount(1);
  const merchantView = await (await request.get(`${API}/support/tickets/${ticket.id}`, { headers: authHeaders(merchant) })).json();
  expect(merchantView.data.status).toBe('pending_customer');
  expect(merchantView.data.awaitingMe).toBe(true);

  // internal note: visible here, never to the merchant
  await composer.fill('Vérifier le quota Google plateforme avant de relancer.');
  await page.getByTestId('ticket-note').click();
  await expect(detail.locator('li[data-internal]')).toContainText('NOTE INTERNE');
  const merchantMsgs = (await (await request.get(`${API}/support/tickets/${ticket.id}`, { headers: authHeaders(merchant) })).json()).data.messages as { body: string }[];
  expect(merchantMsgs.some((m) => m.body.includes('quota Google plateforme'))).toBe(false);

  // the merchant answers ⇒ back to "open"; support resolves; the merchant rates ⇒ closed ⇒ composer locked
  await request.post(`${API}/support/tickets/${ticket.id}/messages`, { headers: authHeaders(merchant), data: { body: 'Merci, c’est reconnecté.', attachments: [] } });
  await page.reload();
  await expect(detail).toHaveAttribute('data-status', 'open');
  await page.getByTestId('ticket-resolve').click();
  await expect(detail).toHaveAttribute('data-status', 'resolved');
  await expect(page.getByTestId('ticket-reopen')).toBeVisible();
  expect((await request.post(`${API}/support/tickets/${ticket.id}/rate`, { headers: authHeaders(merchant), data: { score: 5 } })).ok()).toBeTruthy();
  await page.reload();
  await expect(detail).toHaveAttribute('data-status', 'closed');
  await expect(page.getByTestId('ticket-satisfaction')).toContainText('5/5');
  await expect(composer).toBeDisabled();
  await expect(page.getByTestId('ticket-send')).toBeDisabled();
  await expect(page.getByTestId('ticket-send')).toHaveAttribute('title', /TICKET_CLOSED/);
});

test('AT-HELP-04 an overdue ticket shows "DÉPASSÉ DE n" and filters / tabs live in the URL', async ({ request }) => {
  const ticket = await createTicket(request, merchant, { category: 'credits', priority: 'urgent', message: `Crédits consommés trop vite cette semaine ${stamp}.` });
  await sql(`UPDATE "SupportTicket" SET "slaDueAt" = now() - interval '20 minutes' WHERE "id" = $1::uuid`, ticket.id);
  await page.goto('/fr/admin/support?priority=urgent');
  const row = page.locator(`tr[data-row="${ticket.id}"]`);
  await expect(row.locator('[data-sla="breached"]')).toContainText('DÉPASSÉ DE');
  await expect(row).toContainText(/urgent/i);
  // tab "Tous" + filter kept in the URL; a filter without result ⇒ filtered empty
  await page.locator('[data-tab="all"]').click();
  await expect(page).toHaveURL(/tab=all/);
  await expect(page).toHaveURL(/priority=urgent/);
  await page.goto('/fr/admin/support?tab=all&q=zzintrouvablezz');
  await expect(page.getByText('Aucun résultat')).toBeVisible();
});

test('ADM-12 canned replies: create, shown in the list, delete', async () => {
  const key = `/e2e-${stamp}`;
  await page.goto('/fr/admin/support/canned-replies');
  await expect(page.getByRole('heading', { level: 1, name: 'Réponses types' })).toBeVisible();
  await page.getByTestId('canned-new').click();
  const form = page.getByTestId('canned-form');
  await form.locator('#cr-key').fill(key);
  await form.locator('#cr-title').fill('Test e2e');
  await form.locator('#cr-body-fr').fill('Bonjour, voici la marche à suivre.');
  await page.getByTestId('dialog-submit').click();
  const row = page.locator('tr', { hasText: key });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Supprimer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(row).toHaveCount(0);
});

test('AT-PFS-02 force update: raising the minimum version asks the 2FA code; wrong code ⇒ TWO_FA_CONFIRMATION_REQUIRED; right code ⇒ saved', async ({ request }) => {
  const before = await asAdmin<{ platform: string; minVersion: string; latestVersion: string; recommendedVersion: string; storeUrl: string; storeStatus: string; updateMessage: { fr: string } }>(request, sa, 'get', '/admin/app-versions/android');
  try {
    await page.goto('/fr/admin/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Paramètres plateforme' })).toBeVisible();
    await expect(page.getByTestId('force-update-note')).toContainText('2FA');
    // AT-PFS-05 (ADM-13 side): the legal documents table shows the acceptance rate of each published version
    await expect(page.getByTestId('legal').locator('tbody tr').first()).toBeVisible();
    await expect(page.getByTestId('legal')).toContainText('%');
    await expectNoA11yViolations(page);
    const row = page.getByTestId('app-versions').locator('tr[data-row="android"]');
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Modifier' }).click();
    const form = page.getByTestId('app-version-form');
    // the new minimum = the published version (always allowed) — strictly above the current minimum
    const target = before.latestVersion === before.minVersion ? before.latestVersion.replace(/(\d+)$/, (n) => String(Number(n) + 1)) : before.latestVersion;
    if (target !== before.latestVersion) await form.locator('#av-latest').fill(target);
    await form.locator('#av-min').fill(target);
    if (before.recommendedVersion !== target) await form.locator('#av-rec').fill(target);
    await expect(page.getByTestId('force-update')).toContainText('appareils');
    await expect(page.getByTestId('dialog-submit')).toBeDisabled();
    await form.locator('#av-code').fill('000000');
    await page.getByTestId('dialog-submit').click();
    await expect(form.getByRole('alert').last()).toContainText(errText('TWO_FA_CONFIRMATION_REQUIRED'));
    await expect(form.locator('#av-min')).toHaveValue(target);
    await form.locator('#av-code').fill(await unusedCode(sa));
    await page.getByTestId('dialog-submit').click();
    await expect(page.getByTestId('app-version-form')).toHaveCount(0);
    await expect(row).toContainText(target);
  } finally {
    // lowering the minimum needs no code: put the seeded values back
    await request.put(`${API}/admin/app-versions/android`, {
      headers: adminHeaders(sa),
      data: { minVersion: before.minVersion, recommendedVersion: before.recommendedVersion, latestVersion: before.latestVersion, storeUrl: before.storeUrl, updateMessage: before.updateMessage, storeStatus: before.storeStatus },
    });
  }
});

test('ADM-13 feature flag create + web switch, AT-PFS-07 provider "Tester" states (rejected / unreachable / ok), settings history', async ({ request }) => {
  const key = `e2e_${stamp}`.replace(/[^a-z0-9_]/g, '');
  await page.goto('/fr/admin/settings');
  await page.getByTestId('flag-new').click();
  const form = page.getByTestId('flag-form');
  await form.locator('#flag-key').fill(key);
  await form.locator('#flag-desc').fill('Flag de test e2e');
  await page.getByTestId('dialog-submit').click();
  const row = page.getByTestId('flags').locator(`tr[data-row="${key}"]`);
  await expect(row).toBeVisible();
  const web = row.getByRole('switch', { name: `${key} sur le web` });
  await expect(web).toHaveAttribute('aria-checked', 'false');
  await web.click();
  // no percentage on either platform yet: going to 100 % is confirmed
  await page.getByRole('dialog').getByRole('button', { name: 'Activer pour 100 %' }).click();
  await expect(web).toHaveAttribute('aria-checked', 'true');
  await expect(row).toContainText('100 %');
  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Supprimer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(row).toHaveCount(0);

  // provider "Tester": the fake provider answers what its config simulates (contract-b settings "How to produce")
  const zr = page.getByTestId('providers').locator('tr[data-row="courier_zr"]');
  const runTest = async () => {
    await zr.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Tester' }).click();
  };
  try {
    await request.put(`${API}/admin/providers/courier_zr`, { headers: adminHeaders(sa), data: { config: { simulate: 'rejected', latencyMs: 120 }, reason: 'e2e AT-PFS-07 rejected' } });
    await runTest();
    await expect(page.getByTestId('provider-test-courier_zr')).toHaveAttribute('data-state', 'rejected');
    await expect(page.getByTestId('provider-test-courier_zr')).toContainText('REJETÉE');
    await request.put(`${API}/admin/providers/courier_zr`, { headers: adminHeaders(sa), data: { config: { simulate: 'unreachable' }, reason: 'e2e AT-PFS-07 unreachable' } });
    await runTest();
    await expect(page.getByTestId('provider-test-courier_zr')).toHaveAttribute('data-state', 'unreachable');
    await request.put(`${API}/admin/providers/courier_zr`, { headers: adminHeaders(sa), data: { config: { simulate: 'ok', latencyMs: 120 }, reason: 'e2e AT-PFS-07 ok' } });
    await runTest();
    await expect(page.getByTestId('provider-test-courier_zr')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('provider-test-courier_zr')).toContainText('MS');
  } finally {
    await request.put(`${API}/admin/providers/courier_zr`, { headers: adminHeaders(sa), data: { config: {}, reason: 'e2e AT-PFS-07 reset' } });
  }

  await page.getByTestId('settings-history-open').click();
  await expect(page.getByTestId('settings-history')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('AT-PFS-04 (admin side) maintenance scheduled from ADM-13 and switched off; incident banner toggle', async ({ request }) => {
  await page.goto('/fr/admin/settings');
  await page.getByTestId('maintenance-mode').click();
  const form = page.getByTestId('maintenance-form');
  await form.getByRole('switch', { name: 'Maintenance activée' }).click();
  await form.getByRole('radio', { name: /Programmer une fenêtre/ }).click();
  const pad = (n: number) => String(n).padStart(2, '0');
  const at = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  await form.locator('#mt-from').fill(at(new Date(Date.now() + 2 * 86_400_000)));
  await form.locator('#mt-to').fill(at(new Date(Date.now() + 2 * 86_400_000 + 7_200_000)));
  await form.locator('#mt-text-fr').fill('Maintenance planifiée e2e');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('maintenance-mode')).toContainText('Programmé');
  const scheduled = await asAdmin<{ maintenance: { enabled: boolean; active: boolean } }>(request, sa, 'get', '/admin/settings');
  expect(scheduled.maintenance).toMatchObject({ enabled: true, active: false });

  // switch it off again
  await page.getByTestId('maintenance').getByRole('switch', { name: 'Maintenance activée' }).click();
  await form.getByRole('switch', { name: 'Maintenance activée' }).click();
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('maintenance-mode')).toContainText('Désactivé');

  // incident banner: visible without text ⇒ inline error; with a text ⇒ "visible : oui"; then hidden (always left hidden:
  // a visible banner would show in every later spec)
  try {
    await page.getByTestId('incident-banner-open').click();
    const banner = page.getByTestId('incident-banner-form');
    const visible = banner.getByRole('switch', { name: 'Visible' });
    if ((await visible.getAttribute('aria-checked')) !== 'true') await visible.click();
    await banner.locator('#banner-text-fr').fill('');
    await page.getByTestId('dialog-submit').click();
    await expect(banner.getByRole('alert').first()).toBeVisible();
    await banner.locator('#banner-text-fr').fill(`Lenteurs IA ${stamp}`);
    await page.getByTestId('dialog-submit').click();
    await expect(page.getByTestId('incident-banner-open')).toContainText('visible : oui');
    await page.getByTestId('incident-banner-open').click();
    await banner.getByRole('switch', { name: 'Visible' }).click();
    await page.getByTestId('dialog-submit').click();
    await expect(page.getByTestId('incident-banner-open')).toContainText('visible : non');
  } finally {
    await request.put(`${API}/admin/incident-banner`, { headers: adminHeaders(sa), data: { visible: false } });
  }
});

test('AT-OPS-01 jobs & health: queues table with states, pause ⇒ PAUSE ⇒ resume; schedulers "Lancer maintenant"', async ({ request }) => {
  await page.goto('/fr/admin/health');
  await expect(page.getByRole('heading', { level: 1, name: 'Tâches & santé' })).toBeVisible();
  const queues = page.getByTestId('queues');
  await expect(queues.locator('tr[data-row="ai-reply"]')).toBeVisible();
  await expect(page.getByTestId('meta-webhooks')).toContainText('signatures invalides');
  await expectNoA11yViolations(page);
  const row = queues.locator('tr[data-row="reports-export"]');
  const target = (await row.count()) ? row : queues.locator('tbody tr').nth(1);
  const name = (await target.getAttribute('data-row'))!;
  try {
    await target.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Pause' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Pause' }).click();
    await expect(target.locator('[data-state="paused"]')).toBeVisible();
    await target.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Reprendre' }).click();
    await expect(target.locator('[data-state="paused"]')).toHaveCount(0);
  } finally {
    await request.post(`${API}/admin/queues/${name}/resume`, { headers: adminHeaders(sa), data: {} });
  }
  const scheduler = queues.locator('tr[data-row="scheduler"]');
  if (await scheduler.count()) {
    await scheduler.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: /Lancer maintenant/ }).click();
    await expect(page.getByTestId('schedulers').locator('li').first()).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

/** A job that fails for good on the `jobs` queue (no handler for its name — contract-b health "How to produce": DLQ rows). */
async function failingJob(name: string) {
  const require = createRequire(resolve(__dirname, '../../api/package.json'));
  const { Queue } = require('bullmq');
  const queue = new Queue('jobs', { connection: { host: '127.0.0.1', port: 63799, maxRetriesPerRequest: null } });
  try {
    const job = await queue.add(name, { e2e: name }, { attempts: 1, removeOnFail: { age: 3600 } });
    return String(job.id);
  } finally {
    await queue.close();
  }
}

test('OPS-02 DLQ: a failed job shows payload + trace, "Rejouer" re-queues it with the same payload (AT-API-02-style replay)', async ({ request }) => {
  const name = `e2e-dlq-${stamp}`;
  const id = await failingJob(name);
  await expect
    .poll(async () => JSON.stringify((await (await request.get(`${API}/admin/queues/jobs/failed`, { headers: adminHeaders(sa) })).json()).data ?? []), { timeout: 30_000 })
    .toContain(name);
  await page.goto('/fr/admin/health');
  const row = page.getByTestId('dlq').locator(`[data-job="${id}"]`);
  await expect(row).toContainText(`jobs · ${name}`);
  await row.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('no handler for jobs/');
  await expect(dialog.locator('pre').first()).toContainText(name);
  await page.getByTestId('job-replay').click();
  await expect(dialog).toHaveCount(0);
  // the replayed copy (same payload, new id "<id>_replay1") fails again on the same missing handler
  await expect
    .poll(async () => JSON.stringify((await (await request.get(`${API}/admin/queues/jobs/failed`, { headers: adminHeaders(sa) })).json()).data ?? []), { timeout: 30_000 })
    .toContain(`${id}_replay1`);
  await request.post(`${API}/admin/queues/jobs/drain-failed`, { headers: adminHeaders(sa), data: {} });
});

test('AT-OPS-03 declare an incident ⇒ public status page entry; update; resolve with post-mortem ⇒ RÉSOLU', async ({ request }) => {
  const title = `Synchro Sheets en pause ${stamp}`;
  await page.goto('/fr/admin/health');
  await page.getByTestId('incident-declare').click();
  const form = page.getByTestId('incident-form');
  await page.getByTestId('dialog-submit').click();
  await expect(form.getByRole('alert').first()).toBeVisible();
  await form.locator('#incident-title-fr').fill(title);
  await form.getByRole('radio', { name: 'Majeur' }).click();
  await form.getByText('Google Sheets', { exact: true }).click();
  await page.getByTestId('dialog-submit').click();
  const detail = page.getByTestId('incident-detail');
  await expect(detail).toHaveAttribute('data-status', 'open');
  const status = await (await request.get(`${API}/status`)).json();
  expect(JSON.stringify(status.data.incidents)).toContain(title);

  await page.locator('#incident-update-fr').fill('Quota Google atteint, reprise prévue à 12:00.');
  await page.getByTestId('incident-update-submit').click();
  await expect(detail).toContainText('Quota Google atteint');
  await page.getByTestId('incident-resolve-start').click();
  await page.locator('#incident-pm').fill('Cause : quota plateforme. Aucune donnée perdue.');
  await page.getByTestId('incident-resolve-submit').click();
  await expect(page.getByTestId('incidents').locator('[data-status="resolved"]', { hasText: title })).toBeVisible();
});

test('read-only platform role: settings / health / support readable, every write control hidden', async ({ browser }) => {
  const p = await (await browser.newContext()).newPage();
  try {
    await loginAdmin(p, readOnly, '/fr/admin/settings');
    await expect(p.getByRole('heading', { level: 1, name: 'Paramètres plateforme' })).toBeVisible();
    await expect(p.getByTestId('settings-save')).toHaveCount(0);
    await expect(p.getByTestId('flag-new')).toHaveCount(0);
    await expect(p.getByTestId('maintenance').getByRole('switch')).toBeDisabled();
    await p.goto('/fr/admin/health');
    await expect(p.getByTestId('queues')).toBeVisible();
    await expect(p.getByTestId('incident-declare')).toHaveCount(0);
    await expect(p.getByTestId('queues').getByRole('button', { name: 'Actions' })).toHaveCount(0);
    await p.goto('/fr/admin/support');
    await expect(p.getByRole('heading', { level: 1, name: 'Support' })).toBeVisible();
    await expect(p.getByTestId('ticket-new')).toHaveCount(0);
    // the API refuses the write too
    const r = await p.request.put(`${API}/admin/maintenance`, { headers: adminHeaders(readOnly), data: { enabled: false, scope: 'all' } });
    expect(r.status()).toBe(403);
  } finally {
    await p.context().close();
  }
});
