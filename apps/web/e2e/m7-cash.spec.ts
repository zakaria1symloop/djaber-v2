// M7 — /cash (Figma "GDS-09 — Cash register — ledger with locked automatic rows", DLG GDS "Mouvement de caisse manuel",
// DLG GDS II "Caisse — verrous"): period pills ↔ table ↔ KPIs in sync (09 §4 regression), AUTO 🔒 rows locked
// (CAISSE_EDIT_AUTOMATIC), manual row, day close with a gap (note required, CORRECTION row, CASH_DAY_CLOSED), reopen,
// edit window (CASH_ENTRY_EDIT_WINDOW_EXPIRED, mocked).
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { signIn } from './support/m4-agents';
import { open, row } from './support/m5-orders';
import { algiersDaysAgo, algiersToday, cashEntry, gdsOwner, gdsReady, getJson, openRowMenu, product, sale } from './support/m7';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let owner: Account;
let saleRowId: string;

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await gdsOwner(request, 'm7cash');
  test.skip(!(await gdsReady(request, owner)), 'GDS operations (M7) not served');
  const p = await product(request, owner, { name: 'Parfum Oud', price: 4500, stock: 20 });
  await sale(request, owner, { lines: [{ productId: p.id, quantity: 1 }], amountPaid: 4500 });
  const rows = await getJson<{ id: string; category: string }[]>(request, owner, `/cash?day=${algiersToday()}`);
  saleRowId = rows.find((r) => r.category === 'sale')!.id;
});

test('09 §4 regression — period pills, table and KPIs read the same selection; axe', async ({ page, request }) => {
  await cashEntry(request, owner, { type: 'income', amount: 19000, category: 'deposit', description: 'Apport ouverture' });
  await cashEntry(request, owner, { type: 'expense', amount: 1550, category: 'shipping', description: 'Carburant livraison Sétif', date: new Date(Date.parse(`${algiersDaysAgo(1)}T10:00:00Z`)).toISOString() });
  await signIn(page, owner);
  await open(page, '/fr/cash', () => page.getByTestId('cash-kpis').locator('[data-kpi="income"]'));
  await expectNoA11yViolations(page);
  // today: the sale (4 500) + the deposit (19 000)
  await expect(page.getByTestId('cash-kpis').locator('[data-kpi="income"]')).toContainText(/23\s?500/);
  await expect(page.getByTestId('cash-count')).toContainText('2 lignes');
  await expect(row(page, saleRowId)).toBeVisible();
  // yesterday pill: only the fuel row, the KPIs follow
  await page.getByRole('button', { name: /^Jour :/ }).click();
  await page.getByTestId('cash-period').locator('[data-period="yesterday"]').click();
  await expect(page).toHaveURL(new RegExp(`day=${algiersDaysAgo(1)}`));
  await expect(page.getByTestId('cash-count')).toContainText('1 ligne');
  await expect(page.getByTestId('cash-kpis').locator('[data-kpi="expense"]')).toContainText(/1\s?550/);
  await expect(page.getByTestId('cash-kpis').locator('[data-kpi="income"]')).toContainText('+0');
  // 7 days: the three rows, current balance = opening + every row of the selection
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Jour :/ }).click();
  await page.getByTestId('cash-period').locator('[data-period="7d"]').click();
  await expect(page).toHaveURL(/period=7d/);
  await expect(page.getByTestId('cash-count')).toContainText('3 lignes');
  await expect(page.getByTestId('cash-kpis').locator('[data-kpi="current"]')).toContainText(/21\s?950/);
  const stats = await getJson<{ currentBalance: number; income: number; expense: number }>(request, owner, '/cash/stats?period=7d');
  expect(stats).toMatchObject({ currentBalance: 21950, income: 23500, expense: 1550 });
});

test('AT-CSH-02 — AUTO 🔒 row: edit / delete greyed (CAISSE_EDIT_AUTOMATIC), click opens the sale; manual row > 24 h greyed (mock)', async ({ page, request }) => {
  const manual = await cashEntry(request, owner, { type: 'expense', amount: 800, category: 'other', description: 'Sacs papier' });
  await signIn(page, owner);
  // mock: a manual row cannot be created 25 h in the past and still be "today"; its edit descriptor is served as the API
  // answers after 24 h (greyed, CASH_ENTRY_EDIT_WINDOW_EXPIRED)
  await page.route(/\/api\/v1\/cash\?/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { data: { id: string; actions: { key: string; enabled: boolean; reasonCode?: string }[] }[]; meta: unknown };
    for (const r of body.data) if (r.id === manual.id) r.actions = r.actions.map((a) => (a.key === 'edit' || a.key === 'delete' ? { ...a, enabled: false, reasonCode: 'CASH_ENTRY_EDIT_WINDOW_EXPIRED' } : a));
    await route.fulfill({ response: res, json: body });
  });
  await open(page, '/fr/cash', () => row(page, saleRowId));
  await expect(row(page, saleRowId).locator('[data-source="auto"]')).toBeVisible();
  let menu = await openRowMenu(page, saleRowId);
  await expect(menu.locator('[data-action="edit"]')).toHaveAttribute('data-disabled', '');
  await expect(menu).toContainText(errText('CAISSE_EDIT_AUTOMATIC'));
  await page.keyboard.press('Escape');
  menu = await openRowMenu(page, manual.id);
  await expect(menu).toContainText(errText('CASH_ENTRY_EDIT_WINDOW_EXPIRED'));
  await page.keyboard.press('Escape');
  await row(page, saleRowId).click();
  await expect(page).toHaveURL(/\/fr\/sales\/[0-9a-f-]{36}$/, { timeout: 30_000 });
});

test('AT-CSH-01 / AT-DLG-75 — close the day: gap needs a note, CORRECTION row, CASH_DAY_CLOSED on a new row, reopen', async ({ page, request }) => {
  const shop = await gdsOwner(request, 'm7cashclose');
  await cashEntry(request, shop, { type: 'income', amount: 76350, category: 'deposit', description: 'Fond de caisse' });
  await signIn(page, shop);
  await open(page, '/fr/cash', () => page.getByTestId('cash-close'));
  await page.getByTestId('cash-close').click();
  const dlg = page.getByTestId('cash-close-dialog');
  await expect(dlg.getByTestId('cash-theoretical')).toContainText(/76\s?350/);
  await dlg.getByLabel('Compté en caisse (DA)').fill('76000');
  await expect(dlg.getByTestId('cash-gap')).toContainText(/−350/);
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(dlg.getByRole('alert')).toBeVisible(); // note required with a gap
  await dlg.getByLabel(/Note/).fill('Monnaie rendue en trop');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page.getByTestId('cash-day-closed')).toContainText(/écart −350/);
  await expect(page.getByText('Correction').first()).toBeVisible();
  await expect(page.getByTestId('cash-close')).toBeDisabled();

  // a manual row on the closed day ⇒ CASH_DAY_CLOSED inside the dialog, content kept
  await page.getByTestId('cash-new').click();
  const manual = page.getByTestId('cash-manual-dialog');
  await manual.getByLabel('Montant (DA)').fill('500');
  await manual.getByLabel('Libellé').fill('Ticket parking');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(manual).toContainText(errText('CASH_DAY_CLOSED'));
  await expect(manual.getByLabel('Libellé')).toHaveValue('Ticket parking');
  // typed content: closing asks first ("Quitter sans enregistrer ?")
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Quitter sans enregistrer ?' }).getByRole('button', { name: 'Quitter' }).click();

  // reopen (Owner = Admin+): reason required, the day opens again
  await page.getByRole('button', { name: 'Rouvrir la journée' }).click();
  await page.getByTestId('cash-reopen-dialog').getByLabel(/motif/i).fill('Erreur de comptage');
  await page.getByRole('dialog').getByTestId('dialog-submit').click();
  await expect(page.getByTestId('cash-day-closed')).toHaveCount(0);
  await expect(page.getByTestId('cash-close')).toBeEnabled();
});
