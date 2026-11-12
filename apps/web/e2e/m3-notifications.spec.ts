// M3 — notification centre (NTF-01): AT-NTF-03 UI side — family / type / unread filters in the URL, unread count equal
// to the server count, deep link opens the target screen and marks the row read, "Tout marquer comme lu", bell badge.
// Needs the API on :4010 with the M3 notification routes and the outbox relay (real `stock.low` / `stock.out` rows).
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, createAccount, expectUrl, loginHome, type Account } from './support/m1';
import { catalogReady } from './support/m2';
import { notificationsReady, seedStockNotifications, unreadCount } from './support/m3-misc';

test.describe.configure({ mode: 'serial' });
let account: Account;
const tag = Date.now().toString(36);
let seeded: { lowName: string; outName: string; unread: number } | null = null;

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  account = await createAccount(request, { prefix: 'ntf', finishOnboarding: true });
  test.skip(!(await notificationsReady(request, account)), 'M3 notifications API (GET /notifications/unread-count) not reachable');
});

test('NTF-01 empty state: "Vous êtes à jour ✓", server count 0, "Tout marquer comme lu" disabled, axe', async ({ page, request }) => {
  test.skip((await unreadCount(request, account)) > 0, 'account already has notifications (E2E_REUSE)');
  await loginHome(page, account);
  await page.goto('/fr/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vous êtes à jour ✓' })).toBeVisible();
  await expect(page.getByTestId('unread-count')).toHaveText('0 non lues · comptage serveur');
  await expect(page.getByTestId('read-all')).toBeDisabled();
  // the 13 chips of the frame
  const chips = page.getByRole('group', { name: 'Filtrer les notifications' });
  for (const label of ['Toutes', 'Non lues 0', 'Commandes IA', 'À traiter', 'Problèmes IA', 'Stock', 'Colis', 'Paiements', 'Pages', 'Crédits & plan', 'Membres', 'Intégrations', 'Tâches']) {
    await expect(chips.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  // one row as in the frame: the chips never wrap (the row scrolls sideways when the window is narrower)
  await page.setViewportSize({ width: 1440, height: 900 });
  const tops = await chips.getByRole('button').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
  expect(tops).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await expectNoA11yViolations(page);
});

test('AT-NTF-03 list: unread count equals the server count, family and type filters live in the URL', async ({ page, request }) => {
  test.skip(!(await catalogReady(request, account)), 'M2 catalogue API not reachable (stock notifications are seeded through it)');
  seeded = await seedStockNotifications(request, account, tag);
  test.skip(!seeded, 'no stock notification delivered within 20 s (outbox relay / worker not running)');
  const s = seeded!;

  await loginHome(page, account);
  await page.goto('/fr/notifications');
  const list = page.getByTestId('notifications');
  await expect(page.getByTestId('unread-count')).toHaveText(`${s.unread} non lues · comptage serveur`);
  expect(await unreadCount(request, account)).toBe(s.unread);
  // the top-bar bell carries the same server count
  await expect(page.getByTestId('notification-bell-count')).toHaveText(String(s.unread));
  await expect(list.locator('li[data-unread=true]')).toHaveCount(s.unread);
  const low = list.locator('li', { hasText: `Stock faible : ${s.lowName} (3 restants)` });
  await expect(low).toContainText('STOCK');
  await expect(low).toContainText('Stock faible'); // UX-059: the type in words, never `stock.low`
  await expect(low).toContainText('Seuil : 5.');
  await expect(list.locator('li', { hasText: `Rupture : ${s.outName}` })).toContainText('Rupture de stock');
  await expectNoA11yViolations(page);

  // family chip → ?group=stock: both rows stay
  const chips = page.getByRole('group', { name: 'Filtrer les notifications' });
  await chips.getByRole('button', { name: 'Stock', exact: true }).click();
  await expect(page).toHaveURL(/group=stock/);
  await expect(list.locator('li')).toHaveCount(2);
  // type menu → ?types=stock_out: one row
  await page.getByRole('button', { name: /^Types/ }).click();
  // the checkbox is controlled by the URL (`?types=`): click, then wait for the URL
  await page.getByRole('checkbox', { name: 'stock.out' }).click();
  await expect(page).toHaveURL(/types=stock_out/);
  await expect(list.locator('li')).toHaveCount(1);
  await expect(list.locator('li')).toContainText(s.outName);
  await page.keyboard.press('Escape');

  // another family → filtered-empty state naming the filter, "Effacer les filtres" restores the list
  await chips.getByRole('button', { name: 'Tâches', exact: true }).click();
  await expect(page).toHaveURL(/group=jobs/);
  await expect(page).not.toHaveURL(/types=/);
  await expect(page.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
  await page.getByRole('button', { name: 'Effacer les filtres' }).click();
  await expect(page).toHaveURL(/\/fr\/notifications$/);
  // the two stock rows (+ the grouped `product.approved` row of the moderation family since M10)
  await expect(list.locator('li', { hasText: 'stock.' })).toHaveCount(2);

  // "Non lues" toggle is URL state too and survives a reload
  await chips.getByRole('button', { name: /^Non lues/ }).click();
  await expect(page).toHaveURL(/unread=1/);
  await page.reload();
  await expect(chips.getByRole('button', { name: /^Non lues/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(list.locator('li', { hasText: 'stock.' })).toHaveCount(2);
});

test('AT-NTF-03 deep link: "Ouvrir ›" marks the row read and opens the target screen (/products?lowStock=1)', async ({ page, request }) => {
  test.skip(!seeded, 'no seeded notification (previous test skipped)');
  const s = seeded!;
  await loginHome(page, account);
  await page.goto('/fr/notifications');
  const row = page.getByTestId('notifications').locator('li', { hasText: `Stock faible : ${s.lowName}` });
  await expect(row.getByTestId('notification-open')).toHaveAttribute('href', '/fr/products?lowStock=1');
  await row.getByTestId('notification-open').click();
  await expectUrl(page, '**/fr/products?lowStock=1');
  await expect(page.getByRole('heading', { name: 'Produits', level: 1 })).toBeVisible();
  await expect.poll(() => unreadCount(request, account)).toBe(s.unread - 1);

  await page.goBack();
  await expect(page.getByTestId('unread-count')).toHaveText(`${s.unread - 1} non lues · comptage serveur`);
  await expect(page.getByTestId('notifications').locator('li', { hasText: `Stock faible : ${s.lowName}` })).toHaveAttribute('data-unread', 'false');
});

test('AT-NTF-03 "Tout marquer comme lu": server count 0, no unread dot, the "Non lues" filter is empty', async ({ page, request }) => {
  test.skip(!seeded, 'no seeded notification (previous test skipped)');
  await loginHome(page, account);
  await page.goto('/fr/notifications');
  await page.getByTestId('read-all').click();
  await expect(page.getByText('Toutes les notifications sont marquées comme lues')).toBeVisible();
  await expect(page.getByTestId('unread-count')).toHaveText('0 non lues · comptage serveur');
  await expect(page.getByTestId('notifications').locator('li[data-unread=true]')).toHaveCount(0);
  expect(await unreadCount(request, account)).toBe(0);
  await expect(page.getByTestId('read-all')).toBeDisabled();
  await page.goto('/fr/notifications?unread=1');
  await expect(page.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
});

test('NTF-01 in Arabic: right-to-left, translated chips, slug and count stay readable', async ({ page }) => {
  await loginHome(page, account, 'ar');
  await page.goto('/ar/notifications');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'الإشعارات', level: 1 })).toBeVisible();
  await expect(page.getByRole('group', { name: 'تصفية الإشعارات' }).getByRole('button', { name: 'المخزون', exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
