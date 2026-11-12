// M10 — merchant-side effects of the platform decisions (Figma "SAFE — Trust & safety (merchant)", "MOD — Product —
// rejected view + appeal dialog (merchant)"): AT-SAFE-03 merchant part (platform blacklist ⇒ PLATEFORME 🔒 row, no
// "Débloquer", API CUSTOMER_BLOCKED_BY_PLATFORM — replaces the M3 fixture), AT-MOD-04 merchant part (rejection with
// reason ⇒ rejected view highlights the fields) and MOD-05 appeal with a PDF attachment (carry-over M2). Real API on :4010.
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { API, apiReady, authHeaders, createAccount, loginHome, type Account } from './support/m1';
import { uniquePhone } from './support/m3-misc';
import { platformAdmin, type Admin } from './support/m10-help';
import { asAdmin, asMerchant, moderationReady, pendingProduct } from './support/m10-mod';
import { errText } from './support/error-text';

test.describe.configure({ mode: 'serial' });
let owner: Account;
let admin: Admin;

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  owner = await createAccount(request, { prefix: 'safe10', finishOnboarding: true });
  admin = await platformAdmin(request, 'super_admin', 'safe10');
  test.skip(!(await moderationReady(request, admin)), 'M10 ops & safety API (contract-b) not reachable');
});

test('AT-SAFE-03 platform blacklist ⇒ PLATEFORME row without "Débloquer"; the API refuses the unblock (CUSTOMER_BLOCKED_BY_PLATFORM)', async ({ page, request }) => {
  const phone = uniquePhone();
  await asMerchant(request, owner, 'post', '/clients', { name: 'Client liste noire', phone });
  const row = await asAdmin<{ id: string }>(request, admin, 'post', '/admin/blacklist', { phone, reason: 'Spam multi-boutiques confirmé (e2e)' });
  try {
    await loginHome(page, owner);
    await page.goto('/fr/settings/security');
    const platform = page.getByTestId('blocks').locator('li[data-source=platform]');
    await expect(platform).toHaveCount(1);
    await expect(platform).toContainText('PLATEFORME');
    await expect(platform.getByTestId('unblock')).toHaveCount(0);
    await platform.getByTestId('unblock-locked').hover();
    await expect(page.getByRole('tooltip')).toContainText(errText('CUSTOMER_BLOCKED_BY_PLATFORM'));
    await expectNoA11yViolations(page);

    const blocks = (await (await request.get(`${API}/safety/blocks`, { headers: authHeaders(owner) })).json()) as { data: { id: string; source: string }[] };
    const block = blocks.data.find((b) => b.source === 'platform');
    expect(block).toBeTruthy();
    const refused = await request.delete(`${API}/safety/blocks/${block!.id}`, { headers: authHeaders(owner) });
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('CUSTOMER_BLOCKED_BY_PLATFORM');
  } finally {
    await asAdmin(request, admin, 'delete', `/admin/blacklist/${row.id}`, { reason: 'Levée après le test e2e' });
  }
  await page.reload();
  await expect(page.getByTestId('blocks').locator('li[data-source=platform]')).toHaveCount(0);
});

test('AT-MOD-04 rejection with reason ⇒ rejected view highlights the fields; MOD-05 appeal with a PDF attachment', async ({ page, request }) => {
  const { product, item } = await pendingProduct(request, admin, owner);
  await asAdmin(request, admin, 'post', `/admin/moderation/items/${item.id}/reject`, {
    decision: 'counterfeit',
    reasonTemplateKey: 'counterfeit',
    merchantMessage: 'Ce produit utilise une marque protégée : retirez la marque du titre.',
    rejectedFields: ['title', 'price'],
  });

  await loginHome(page, owner);
  await page.goto(`/fr/products/${product.id}`);
  const banner = page.getByTestId('rejected-banner');
  await expect(banner).toContainText('retirez la marque du titre');
  await expect(page.getByTestId('rejected-fields')).toContainText('Titre');

  await page.getByTestId('appeal-open').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Contester le refus' })).toBeVisible();
  // a text file is refused inline (PDF or image only)
  await dialog.getByTestId('appeal-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(dialog.getByText(errText('UPLOAD_TYPE_INVALID'))).toBeVisible();
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  await dialog.getByTestId('appeal-file').setInputFiles({ name: 'facture_import_sept.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(dialog.getByTestId('appeal-file-name')).toContainText('facture_import_sept.pdf');
  await dialog.locator('#appeal-message').fill('Nous vendons des produits importés avec facture (jointe). Le prix est promotionnel.');
  await dialog.getByTestId('appeal-submit').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Contestation en cours').first()).toBeVisible();

  const appeals = await asAdmin<{ item: { productId: string | null }; attachmentUrl: string | null; attachmentMime: string | null }[]>(request, admin, 'get', '/admin/moderation/appeals?status=pending&pageSize=100');
  const appeal = appeals.find((a) => a.item.productId === product.id);
  expect(appeal?.attachmentMime).toBe('application/pdf');
  expect(appeal?.attachmentUrl, 'the PDF is attached to the appeal').toBeTruthy();
});
