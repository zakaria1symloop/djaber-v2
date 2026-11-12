// M4 — credits (UI side of AT-BIL-03 / AT-AI-14) on the REAL API: header pill `used / limit` (amber from 80 %, red when
// exhausted), shell banners `credits80` / `credits100` / `negativeCredits`, and the read-only page /settings/credits
// (Figma "BIL-04 / BIL-03 — Credits page (ledger)": tiles, meter, ledger with filters in the URL).
// One shop for the whole file (14-day Pro trial: 300 credits, trial `grant` row): real AI turns (text 1 · photo 5 ·
// vocal 3) write the ledger, `POST /dev/ai/credits { balance }` moves the balance (an `adjustment` / `grant` row each).
// `page.route` only where the API cannot produce the state over HTTP; each use says why.
// Purchases (packs, calculator, export), pack balance and the negative balance of a store refund: m9-credits.spec.ts.
import { expect as baseExpect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, expectUrl, type Account } from './support/m1';
import { failWith, inviteOperator, patchAnswer } from './support/m3-inbox';
import { NAV } from './support/m4-agents';
import { seedProduct, sku } from './support/m2';
import { recordLedger, signIn } from './support/m4-credits';
import { activeAgent, conversationOf, creditsOf, inject, nextSender, realGet, refreshToken, setCredits, setupShop, waitAiMessages, type RealAgent, type RealCredits, type Shop } from './support/m4-real';

test.describe.configure({ mode: 'serial', timeout: 300_000 });
// URL and list updates wait for the shared `next dev` server: assertions get 15 s instead of 5
const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

type FullCredits = RealCredits & { burnRatePerDay: number; pricePerCreditDzd: number; packPricePerCreditDzd: number | null };
type LedgerRow = { id: string; action: string; bucket: string; credits: number; balanceAfter: number; detail: string; agent: { id: string; name: string } | null; conversationId: string | null };

const FIRST = { timeout: 60_000 };
const pill = (page: Page) => page.getByTestId('credits-pill');
const rows = (page: Page) => page.getByTestId('ledger-row');
const shellBanner = (page: Page, id: string) => page.locator(`[data-shell-banner="${id}"]`);
/** regex source of a number as `formatNumber` prints it ("12 500": any space between the groups) */
const n = (v: number) => (v < 0 ? '-' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s');
const rx = (s: string) => new RegExp(s);
const DATE = '\\d{1,2} \\S+ \\d{4}';
/** `YYYY-MM-DD` in Africa/Algiers, `offset` days from today */
const algiersDay = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date(Date.now() + offset * 86_400_000));
/** `openPage` with more room per attempt: the shared `next dev` server recompiles routes after every restart / edit */
async function openPage(page: Page, url: string, ready: () => Locator, as?: Account) {
  await expect(async () => {
    await page.goto(url, { timeout: 90_000 });
    // a navigation aborted on the busy dev server can lose the rotated refresh cookie: the app then lands on the
    // sign-in page after loading, and the account signs in again
    const login = page.locator('#email');
    await expect(ready().or(login)).toBeVisible({ timeout: 60_000 });
    if (await login.isVisible()) {
      await signIn(page, as ?? owner);
      await page.goto(url, { timeout: 90_000 });
    }
    await expect(ready()).toBeVisible({ timeout: 60_000 });
  }).toPass({ timeout: 240_000 });
}
/**
 * A filter click on the shared dev server can be lost (the dropdown re-renders while the URL changes, or the closing
 * overlay takes it): the click is repeated until the URL says it was taken, never once the URL already does.
 */
async function until(page: Page, click: () => Promise<unknown>, url: RegExp, negate = false) {
  const done = () => url.test(page.url()) !== negate;
  await expect(async () => {
    if (!done()) await click();
    // a client navigation commits the URL once the dev server answered the route payload (slow when it is busy)
    await expect.poll(done, { timeout: 20_000, message: `URL ${page.url()} ${negate ? 'still matches' : 'does not match'} ${url}` }).toBe(true);
  }).toPass({ timeout: 90_000 });
}
const CREDITS_URL = /\/api\/v1\/credits(\?.*)?$/;
const LEDGER_URL = /\/api\/v1\/credits\/ledger(\?.*)?$/;

let shop: Shop;
let owner: Account;
let agent: RealAgent;
const NAME = `Vendeur crédits ${Date.now().toString(36)}`;
const ledgerOf = (request: APIRequestContext, query = '') => realGet<LedgerRow[]>(request, owner, `/credits/ledger?pageSize=100${query}`);
const req = (page: Page) => page.context().request;

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  shop = await setupShop(request, 'm4cred');
  owner = shop.owner;
  agent = await activeAgent(request, owner, { name: NAME, channelId: shop.facebook.id });
  // the fake vision describes every simulated photo as "photo <hash>": a product named "Photo" is the product it
  // recognises (pass 2 answers ⇒ the turn costs 5 credits, `image_recognition`)
  await seedProduct(request, owner, { name: 'Photo', price: 1500, stock: 5, sku: sku('E2E') });
});

test('empty ledger: "Aucune consommation sur la période"; tiles of a fresh trial (300 credits, nothing used)', async ({ page }) => {
  const c = await creditsOf(req(page), owner);
  expect([c.plan.used, c.plan.limit]).toEqual([0, 300]);
  // mock: every workspace has its trial `grant` row, so the real ledger is never empty — the rows are emptied, the
  // balance stays the real one
  await patchAnswer(page, LEDGER_URL, () => []);
  await signIn(page, owner);
  await openPage(page, '/fr/settings/credits', () => page.getByRole('heading', { name: 'Aucune consommation sur la période' }));
  await expect(page.getByText('Les réponses de l’IA, les renouvellements et les packs apparaîtront ici.')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('tile-used')).toContainText('aucune consommation récente');
  await expect(page.getByTestId('tile-plan')).toContainText('300');
  await expect(page.getByTestId('tile-plan')).toContainText(/sur 300 · renouvelés le/);
});

test('ok level: neutral pill "used / limit" linking to /settings/credits, no credits banner', async ({ page }) => {
  const c = await creditsOf(req(page), owner);
  await signIn(page, owner);
  await expect(pill(page)).toHaveAttribute('data-level', 'ok', FIRST);
  await expect(pill(page)).toHaveText(rx(`${n(c.plan.used)} / ${n(c.plan.limit)}`));
  await expect(pill(page)).toHaveAttribute('title', 'Crédits utilisés ce mois');
  const link = page.getByRole('link', { name: rx(`^Crédits : ${n(c.plan.used)} / ${n(c.plan.limit)}$`) });
  await expect(link).toHaveAttribute('href', /\/fr\/settings\/credits$/);
  await expect(page.locator('[data-shell-banner^="credits"], [data-shell-banner="negativeCredits"]')).toHaveCount(0);
  await link.click();
  await expectUrl(page, '**/fr/settings/credits', NAV);
  await expect(page.getByRole('heading', { name: 'Crédits', level: 1 })).toBeVisible(FIRST);
});

test('default state: tiles, meter, ledger rows of real AI turns (text · photo · vocal) — M9 purchase controls, axe', async ({ page }) => {
  const r = req(page);
  // three customers: a text question (1), a photo (5), a voice note (3)
  const turns = [
    { sender: nextSender(), text: 'Bonjour' },
    { sender: nextSender(), image: true },
    { sender: nextSender(), audio: true },
  ];
  for (const t of turns) await inject(r, owner, { channelId: shop.facebook.id, ...t });
  const conversations = await Promise.all(turns.map((t) => conversationOf(r, owner, t.sender)));
  await Promise.all(conversations.map((c) => waitAiMessages(r, owner, c.id)));
  let ledger: LedgerRow[] = [];
  await expect
    .poll(async () => (ledger = await ledgerOf(r)).filter((l) => ['text_reply', 'image_recognition', 'voice_transcription'].includes(l.action)).map((l) => l.action).sort(), { timeout: 60_000 })
    .toEqual(['image_recognition', 'text_reply', 'voice_transcription']);
  const c = await realGet<FullCredits>(r, owner, '/credits');
  expect(c.plan.used).toBe(9);

  await signIn(page, owner);
  await openPage(page, '/fr/settings/credits', () => page.getByRole('heading', { name: 'Crédits', level: 1 }));
  await expect(page).toHaveTitle('Crédits · Djaber.ai');
  await expect(page.locator('a[aria-current="page"][href$="/settings/credits"]')).toHaveText('Crédits');

  const tiles = page.getByTestId('credits-tiles');
  await expect(tiles.getByTestId('tile-plan')).toContainText(rx(n(c.plan.remaining)), FIRST);
  await expect(tiles.getByTestId('tile-plan')).toContainText('restants (plan)');
  await expect(tiles.getByTestId('tile-plan')).toContainText(rx(`sur ${n(c.plan.limit)} · renouvelés le ${DATE}`));
  await expect(tiles.getByTestId('tile-packs')).toContainText('0');
  await expect(tiles.getByTestId('tile-packs')).toContainText('restants (packs)');
  await expect(tiles.getByTestId('tile-packs')).toContainText('consommés après le plan');
  await expect(tiles.getByTestId('tile-used')).toContainText(rx(n(c.plan.used)));
  await expect(tiles.getByTestId('tile-used')).toContainText('utilisés ce mois');
  // 9 credits over the last 7 days ⇒ ≈ 1 / j, with the projected exhaustion date
  await expect(tiles.getByTestId('tile-used')).toContainText(rx(`≈ ${Math.max(1, Math.round(c.burnRatePerDay))} / j → épuisés le ${DATE}`));
  await expect(tiles.getByTestId('tile-price')).toContainText('DA / crédit');
  await expect(tiles.getByTestId('tile-price')).toContainText((Math.round(c.pricePerCreditDzd * 100) / 100).toFixed(2).replace('.', ','));
  if (c.packPricePerCreditDzd !== null) await expect(tiles.getByTestId('tile-price')).toContainText(`pack moyen : ${c.packPricePerCreditDzd.toFixed(2).replace('.', ',')} DA`);

  const meter = page.getByTestId('credits-meter');
  await expect(meter).toHaveAttribute('data-level', 'ok');
  await expect(meter).toContainText(rx(`PÉRIODE DU ${DATE} AU ${DATE}`));
  await expect(meter.getByRole('meter')).toHaveAttribute('aria-valuenow', String(c.plan.used));
  await expect(meter.getByRole('meter')).toHaveAttribute('aria-valuemax', String(c.plan.limit));
  await expect(page.getByTestId('credits-state')).toHaveAttribute('data-level', 'ok');
  await expect(page.getByTestId('credits-state')).toHaveText('L’IA répond normalement.');
  await expect(page.getByTestId('credits-negative')).toHaveCount(0);

  // ledger: newest first, action pill, agent (+ link to the conversation), signed credits, balance after the row
  await expect(page.getByRole('heading', { name: 'Historique (CreditLedger)' })).toBeVisible();
  await expect(rows(page)).toHaveCount(ledger.length);
  const row = (action: string) => page.locator(`[data-testid="ledger-row"][data-action="${action}"]`);
  const api = (action: string) => ledger.find((l) => l.action === action)!;
  const text = row('text_reply');
  await expect(text).toHaveAttribute('data-bucket', 'plan');
  await expect(text).toContainText('TEXTE');
  await expect(text.locator('td').nth(2)).toContainText(NAME);
  // the action code the API puts in `detail` when the row has no reason is not repeated next to the pill
  await expect(text.locator('td').nth(2)).not.toContainText('text_reply');
  await expect(text.getByRole('link', { name: 'Conversation ›' })).toHaveAttribute('href', `/fr/inbox/${api('text_reply').conversationId}`);
  await expect(text.locator('td').nth(3)).toHaveText('−1');
  await expect(text.locator('td').nth(4)).toHaveText(rx(`^${n(api('text_reply').balanceAfter)}$`));
  await expect(row('image_recognition')).toContainText('PHOTO');
  await expect(row('image_recognition').locator('td').nth(3)).toHaveText('−5');
  await expect(row('voice_transcription')).toContainText('VOCAL');
  await expect(row('voice_transcription').locator('td').nth(3)).toHaveText('−3');
  // the trial opens the period with a `grant` row of 300
  const trial = row('grant');
  await expect(trial).toContainText('GESTE');
  await expect(trial.locator('td').nth(2)).toHaveText("Crédits de l'essai Pro");
  await expect(trial.locator('td').nth(3)).toHaveText('+300');
  await expect(trial.locator('td').nth(4)).toHaveText('300');
  await expect(page.getByRole('table', { name: 'Historique (CreditLedger)' }).getByRole('columnheader')).toHaveText(['QUAND', 'ACTION', 'DÉTAIL', 'CRÉDITS', 'SOLDE']);
  for (const name of ['Période', 'Action', 'Agent', 'Origine']) await expect(page.getByTestId('credits-ledger').getByRole('button', { name, exact: true })).toBeVisible();

  // M9: pack purchase, calculator and export (their flows: m9-credits.spec.ts)
  await expect(page.getByTestId('open-buy-pack')).toHaveText('Acheter un pack');
  await expect(page.getByTestId('open-calculator')).toHaveText('Calculateur');
  await expect(page.getByTestId('ledger-export')).toHaveText('Exporter CSV');
  await expectNoA11yViolations(page);
});

test('ledger filters live in the URL: action, origin, agent, period — filtered-empty and "Effacer les filtres"', async ({ page }) => {
  const r = req(page);
  const all = await ledgerOf(r);
  const count = (actions: string[]) => all.filter((l) => actions.includes(l.action)).length;
  const calls = await recordLedger(page);
  await signIn(page, owner);
  await openPage(page, '/fr/settings/credits', () => rows(page).first());
  await expect(rows(page)).toHaveCount(all.length);
  const ledger = page.getByTestId('credits-ledger');
  /** opens the dropdown when its option is not shown, then clicks the option */
  const pick = async (dropdown: string, option: Locator) => {
    if (!(await option.isVisible())) await ledger.getByRole('button', { name: dropdown, exact: true }).click({ timeout: 5_000 });
    await option.click({ timeout: 5_000 });
  };

  // action (multi)
  await until(page, () => pick('Action', page.getByRole('checkbox', { name: 'TEXTE' })), /action=text_reply/);
  await expect(rows(page)).toHaveCount(count(['text_reply']));
  await expect(rows(page)).toHaveAttribute('data-action', 'text_reply');
  await until(page, () => pick('Action', page.getByRole('checkbox', { name: 'PHOTO' })), /action=text_reply(%2C|,)image_recognition/);
  await expect(rows(page)).toHaveCount(count(['text_reply', 'image_recognition']));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Filtres' })).toContainText(/Action : TEXTE, PHOTO/i);
  expect(calls.at(-1)!.get('action')).toBe('text_reply,image_recognition');

  // a reload keeps the filter
  await page.reload();
  await expect(rows(page)).toHaveCount(count(['text_reply', 'image_recognition']), FIRST);
  await expect(page.getByRole('list', { name: 'Filtres' })).toContainText(/Action : TEXTE, PHOTO/i);

  // origin = pack ⇒ nothing matches (packs are bought from M9)
  await until(page, () => pick('Origine', page.getByRole('radio', { name: 'Pack' })), /bucket=pack/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
  await expect(page.getByText(/Aucun\(e\) ligne ne correspond à « .*Origine : Pack.* »\./i)).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await until(page, () => page.getByRole('button', { name: 'Effacer les filtres' }).click({ timeout: 5_000 }), /bucket=|action=/, true);
  await expect(rows(page)).toHaveCount(all.length);
  await expect(page.getByRole('list', { name: 'Filtres' })).toHaveCount(0);

  // agent
  await until(page, () => pick('Agent', page.getByRole('radio', { name: NAME })), new RegExp(`agentId=${agent.id}`));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Filtres' })).toContainText(`Agent : ${NAME}`);
  await expect.poll(() => calls.at(-1)!.get('agentId')).toBe(agent.id);
  await expect(rows(page)).toHaveCount(all.filter((l) => l.agent?.id === agent.id).length);
  await until(page, () => page.getByRole('button', { name: /^Retirer Agent/ }).click({ timeout: 5_000 }), /agentId=/, true);

  // period: typed dates
  const typeDate = async (label: 'Du' | 'Au', value: string) => {
    if (!(await page.getByLabel(label, { exact: true }).isVisible())) await ledger.getByRole('button', { name: 'Période', exact: true }).click({ timeout: 5_000 });
    await page.getByLabel(label, { exact: true }).fill(value, { timeout: 5_000 });
  };
  await until(page, () => typeDate('Du', '2026-09-12'), /from=2026-09-12/);
  await until(page, () => typeDate('Au', '2026-09-30'), /from=2026-09-12&to=2026-09-30/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Filtres' })).toContainText(/Période : 12 sept\. 2026 → 30 sept\. 2026/i);
  await expect.poll(() => `${calls.at(-1)!.get('from')}→${calls.at(-1)!.get('to')}`).toBe('2026-09-12→2026-09-30');
  await until(page, () => page.getByRole('button', { name: 'Effacer tout' }).click({ timeout: 5_000 }), /from=|to=/, true);

  // a deep link is read back: filters, and a period typed backwards is sent in order
  const today = algiersDay();
  const yesterday = algiersDay(-1);
  const grants = await ledgerOf(r, `&action=grant&bucket=plan&from=${yesterday}&to=${today}`);
  expect(grants.length).toBeGreaterThan(0);
  await openPage(page, `/fr/settings/credits?from=${today}&to=${yesterday}&action=grant&bucket=plan`, () => rows(page).first());
  await expect(rows(page)).toHaveCount(grants.length);
  await expect(rows(page)).toHaveAttribute('data-action', 'grant');
  const last = calls.at(-1)!;
  expect([last.get('from'), last.get('to'), last.get('action'), last.get('bucket')]).toEqual([yesterday, today, 'grant', 'plan']);
});

test.describe('header pill and shell banners', () => {
  test('warning from 80 %: amber pill and the credits80 banner (status) with "Voir les crédits"', async ({ page }) => {
    // 50 credits left of 300 ⇒ 250 used (83 %)
    const c = await setCredits(req(page), owner, 50);
    expect(c.plan.used).toBe(c.plan.limit - 50);
    await signIn(page, owner);
    await expect(pill(page)).toHaveAttribute('data-level', 'warning', FIRST);
    await expect(pill(page)).toHaveAttribute('title', '80 % des crédits utilisés');
    const banner = shellBanner(page, 'credits80');
    await expect(banner.getByRole('status')).toBeVisible();
    await expect(banner).toHaveText(rx(`80 % des crédits utilisés \\(${n(c.plan.used)} / ${n(c.plan.limit)}\\)\\. À ce rythme, épuisés le ${DATE}\\.`));
    await banner.getByRole('button', { name: 'Voir les crédits' }).click();
    await expectUrl(page, '**/fr/settings/credits', NAV);
    await expect(page.getByTestId('credits-meter')).toHaveAttribute('data-level', 'warning', FIRST);
    await expect(page.getByTestId('credits-state')).toHaveText('Plus de 80 % des crédits du plan sont utilisés.');
  });

  test('a page to reconnect outranks credits80 (banner priority)', async ({ page }) => {
    expect((await creditsOf(req(page), owner)).plan.used).toBeGreaterThanOrEqual(240);
    // mock: a page goes to `needs_reconnect` only on a Meta token error, which the fake Meta adapter cannot be asked for
    // over HTTP — the real channel list is answered with the first page in that state
    await patchAnswer(page, /\/api\/v1\/channels(\?.*)?$/, (list: Record<string, unknown>[]) => list.map((ch) => (ch.id === shop.facebook.id ? { ...ch, status: 'needs_reconnect' } : ch)));
    await signIn(page, owner);
    await expect(pill(page)).toHaveAttribute('data-level', 'warning', FIRST);
    await expect(shellBanner(page, 'reconnect')).toBeVisible(FIRST);
    await expect(shellBanner(page, 'reconnect')).toContainText(shop.facebook.name);
    await expect(shellBanner(page, 'credits80')).toHaveCount(0);
  });

  test('exhausted: red pill and the credits100 alert, "Acheter des crédits" opens the pack purchase of /settings/credits', async ({ page }) => {
    const c = await setCredits(req(page), owner, 0);
    expect([c.exhausted, c.plan.used]).toEqual([true, c.plan.limit]);
    await signIn(page, owner);
    await expect(pill(page)).toHaveAttribute('data-level', 'exhausted', FIRST);
    await expect(pill(page)).toHaveText(rx(`${n(c.plan.used)} / ${n(c.plan.limit)}`));
    await expect(pill(page)).toHaveAttribute('title', 'Crédits épuisés — l’IA ne répond plus');
    const banner = shellBanner(page, 'credits100');
    await expect(banner.getByRole('alert')).toBeVisible();
    await expect(banner).toHaveText(rx(`Crédits épuisés \\(${n(c.plan.used)} / ${n(c.plan.limit)}\\) — l'IA ne répond plus\\. Rechargez ou attendez le ${DATE}\\.`));
    await banner.getByRole('button', { name: 'Acheter des crédits' }).click();
    await expect(page).toHaveURL(/\/fr\/settings\/credits\?buy=1$/, NAV);
    await expect(page.getByTestId('buy-pack-dialog')).toBeVisible(FIRST);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/fr\/settings\/credits$/);
    await expect(page.getByTestId('credits-meter')).toHaveAttribute('data-level', 'exhausted', FIRST);
    await expect(page.getByTestId('credits-state')).toHaveAttribute('data-level', 'exhausted');
    await expect(page.getByTestId('credits-state')).toHaveText('Crédits épuisés : l’IA ne répond plus, les réponses manuelles fonctionnent.');
    await expect(page.getByTestId('tile-plan')).toContainText('0');
  });

  // pack balance (plan used up, AI still answering ⇒ warning) and negative balance (store refund): real API in
  // m9-credits.spec.ts since M9 (they replaced the `// mock:` answers of M4)

  test('the pill follows the balance live (WS credits.updated): an AI turn, then 80 %, then exhausted — no reload', async ({ page }) => {
    const r = req(page);
    const start = await setCredits(r, owner, 300); // a +300 grant: limit 600, used 300 ⇒ ok
    expect(start.exhausted).toBe(false);
    await signIn(page, owner);
    await expect(pill(page)).toHaveAttribute('data-level', 'ok', FIRST);
    await expect(pill(page)).toHaveText(rx(`${n(start.plan.used)} / ${n(start.plan.limit)}`));

    // a customer message: the AI reply debits 1 credit and the pill follows
    const sender = nextSender();
    await inject(r, owner, { channelId: shop.facebook.id, sender, text: 'Bonjour' });
    await waitAiMessages(r, owner, (await conversationOf(r, owner, sender)).id);
    await expect.poll(async () => (await creditsOf(r, owner)).plan.used, { timeout: 30_000 }).toBe(start.plan.used + 1);
    await expect(pill(page)).toHaveText(rx(`${n(start.plan.used + 1)} / ${n(start.plan.limit)}`), { timeout: 30_000 });

    // 10 % left ⇒ amber pill and the credits80 banner
    const warn = await setCredits(r, owner, Math.floor(start.plan.limit / 10));
    await expect(pill(page)).toHaveAttribute('data-level', 'warning', { timeout: 30_000 });
    await expect(shellBanner(page, 'credits80')).toContainText(rx(`${n(warn.plan.used)} / ${n(warn.plan.limit)}`));
    // nothing left ⇒ red pill and the credits100 alert
    await setCredits(r, owner, 0);
    await expect(pill(page)).toHaveAttribute('data-level', 'exhausted', { timeout: 30_000 });
    await expect(shellBanner(page, 'credits100')).toBeVisible();
    await setCredits(r, owner, 300);
    await expect(pill(page)).toHaveAttribute('data-level', 'ok', { timeout: 30_000 });
  });
});

test.describe('Operator', () => {
  let operator: Account;
  test.beforeAll(async ({ request }) => {
    await refreshToken(request, owner);
    operator = await inviteOperator(request, owner);
  });

  test('sees the pill and the balance, not the ledger (billing.read): `ledger-forbidden`, no ledger request, axe', async ({ page }) => {
    const c = await creditsOf(req(page), owner);
    const calls = await recordLedger(page);
    await signIn(page, operator);
    await expect(pill(page)).toHaveAttribute('data-level', 'ok', FIRST);
    await expect(pill(page)).toHaveText(rx(`${n(c.plan.used)} / ${n(c.plan.limit)}`));
    await page.getByRole('link', { name: /^Crédits : / }).click();
    await expectUrl(page, '**/fr/settings/credits', NAV);
    await expect(page.getByTestId('tile-plan')).toContainText(rx(n(c.plan.remaining)), FIRST);
    await expect(page.getByTestId('tile-packs')).toContainText('0');
    await expect(page.getByTestId('tile-used')).toContainText(rx(n(c.plan.used)));
    await expect(page.getByTestId('credits-meter')).toHaveAttribute('data-level', 'ok');
    await expect(page.getByTestId('ledger-forbidden')).toHaveText('L’historique détaillé est réservé aux admins de l’espace.');
    await expect(page.getByTestId('credits-ledger')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('a[aria-current="page"][href$="/settings/credits"]')).toHaveText('Crédits');
    expect(calls).toHaveLength(0);
    // the API refuses it as well
    const res = await page.context().request.get(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4010'}/api/v1/credits/ledger`, { headers: { Authorization: `Bearer ${operator.accessToken}`, 'X-Workspace-Id': owner.workspaceId ?? '' } });
    expect(res.status()).toBe(403);
    await expectNoA11yViolations(page);
  });
});

test.describe('/settings/credits', () => {
  test('ledger error: "Impossible de charger" with the reference, "Réessayer" loads it; the tiles stay', async ({ page }) => {
    const all = await ledgerOf(req(page));
    const c = await creditsOf(req(page), owner);
    // mock: a 5xx of the ledger cannot be provoked over HTTP
    await failWith(page, LEDGER_URL, 'GET', 500, 'INTERNAL', 'Erreur interne');
    await signIn(page, owner);
    await openPage(page, '/fr/settings/credits', () => page.getByRole('heading', { name: 'Impossible de charger' }));
    await expect(page.getByTestId('tile-plan')).toContainText(rx(n(c.plan.remaining)));
    await expect(page.getByTestId('credits-ledger')).toContainText('(ref. e2e-ref)');
    await expect(rows(page)).toHaveCount(0);
    await page.unroute(LEDGER_URL);
    await page.getByTestId('credits-ledger').getByRole('button', { name: 'Réessayer' }).click();
    await expect(rows(page)).toHaveCount(Math.min(25, all.length), FIRST);
    await expect(page.getByRole('heading', { name: 'Impossible de charger' })).toHaveCount(0);
  });

  test('pagination state lives in the URL (page, pageSize) and is sent to the API', async ({ page }) => {
    const r = req(page);
    // one ledger row per balance change: top the ledger up to 60 rows with distinct balances
    const before = (await ledgerOf(r)).length;
    for (let i = before; i < 60; i++) await setCredits(r, owner, 1000 + i);
    const all = await ledgerOf(r);
    const total = all.length;
    expect(total).toBeGreaterThanOrEqual(60);
    const calls = await recordLedger(page);
    await signIn(page, owner);
    await openPage(page, '/fr/settings/credits', () => rows(page).first());
    await expect(rows(page)).toHaveCount(25);
    const ledger = page.getByTestId('credits-ledger');
    await expect(ledger).toContainText(rx(`1–25 sur ${total}`));
    await expect(ledger.getByRole('button', { name: 'Page précédente' })).toBeDisabled();
    await until(page, () => ledger.getByRole('button', { name: 'Page suivante' }).click({ timeout: 5_000 }), /page=2/);
    await expect(ledger).toContainText(rx(`26–50 sur ${total}`));
    await expect(rows(page).first().locator('td').nth(4)).toHaveText(rx(`^${n(all[25]!.balanceAfter)}$`));
    await page.reload();
    await expect(ledger).toContainText(rx(`26–50 sur ${total}`), FIRST);
    expect(calls.at(-1)!.get('page')).toBe('2');
    await until(page, () => ledger.getByRole('button', { name: 'Page suivante' }).click({ timeout: 5_000 }), /page=3/);
    await expect(rows(page)).toHaveCount(Math.min(25, total - 50));
    if (total <= 75) await expect(ledger.getByRole('button', { name: 'Page suivante' })).toBeDisabled();
    await until(page, () => ledger.getByRole('combobox', { name: '25 / page' }).selectOption('50', { timeout: 5_000 }), /pageSize=50/);
    await expect.poll(() => calls.at(-1)!.get('pageSize')).toBe('50');
    await setCredits(r, owner, 300);
  });
});
