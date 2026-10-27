// M2 — product create / edit form (`/products/new`, `/products/[id]/edit`) and the onboarding "first product" step.
// AT-CAT-01, AT-CAT-03 (UI side), AT-CAT-04, AT-CAT-10, leave guard, 409 conflict, RTL, axe. Needs the API on :4010.
import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { API, apiReady, authHeaders, createAccount, expectUrl, login, loginHome, type Account } from './support/m1';
import { catalogReady, getProduct, seedProduct, setStockMode, sku, type SeedProduct } from './support/m2';

test.describe.configure({ mode: 'serial' });

/* ---------- a valid one-colour PNG of w × h (the API re-encodes real pictures only) ---------- */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, sum]);
};
const png = (w: number, h: number, shade: number) => {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8; // bit depth
  head[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h, shade);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0; // filter byte of each line
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const picture = (i: number, side = 640) => ({ name: `photo-${i}.png`, mimeType: 'image/png', buffer: png(side, side, 40 + i * 15) });

let account: Account;
let variantSku: string;
let withVariants: SeedProduct;
let plain: SeedProduct;
let gallery: SeedProduct;

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  account = await createAccount(request, { prefix: 'pform', finishOnboarding: true });
  test.skip(!(await catalogReady(request, account)), 'M2 catalogue endpoints not available');
  await setStockMode(request, account, 'advanced');
  variantSku = sku('RS-NS');
  withVariants = await seedProduct(request, account, {
    name: 'La Robe satin',
    sku: sku('RS'),
    price: 4900,
    variants: [
      { name: 'Noir · S', sku: variantSku, price: 4900, stock: 6, minStock: 2 },
      { name: 'Noir · M', price: 4900, stock: 1, minStock: 2 },
    ],
  });
  plain = await seedProduct(request, account, { name: 'Parfum Oud 100 ml', sku: sku('PO'), price: 4500, costPrice: 2400, stock: 12 });
  gallery = await seedProduct(request, account, { name: 'Montre Classic', sku: sku('MC'), price: 6000, stock: 3 });
});

const openEdit = async (page: Page, id: string, locale = 'fr') => {
  await page.goto(`/${locale}/products/${id}/edit`);
  await expect(page.getByTestId('form-footer')).toBeVisible({ timeout: 30_000 });
};
const openNew = async (page: Page, locale = 'fr') => {
  await page.goto(`/${locale}/products/new`);
  await expect(page.getByTestId('form-footer')).toBeVisible({ timeout: 30_000 });
};

test('AT-CAT-01 price 0 ⇒ validation.price inline; selling < cost ⇒ saved with a warning; SKU of a variant ⇒ "SKU déjà utilisé", content preserved', async ({ page, request }) => {
  await loginHome(page, account);
  await openNew(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Nouveau produit' })).toBeVisible();
  const name = `Coffret Oud ${Date.now().toString(36)}`;
  await page.locator('#name').fill(name);
  await page.locator('#price').fill('0');
  await page.locator('#stock').fill('5');
  await page.getByTestId('form-save').click();
  await expect(page.locator('[data-section="price"]').getByRole('alert')).toHaveText('Prix de vente requis (> 0)');
  await expect(page.getByTestId('validation-summary')).toContainText('Validation : 1 erreurs');
  await expect(page).toHaveURL(/\/fr\/products\/new$/);

  // selling < cost: live warning with the margin, saving stays possible
  await page.locator('#price').fill('4000');
  await page.locator('#costPrice').fill('5000');
  await expect(page.getByTestId('below-cost')).toContainText('Prix de vente inférieur au coût (marge −25 %)');

  // SKU equal to the SKU of an existing variant: 409 shown under the field, nothing lost
  await page.locator('#sku').fill(variantSku);
  await page.getByTestId('form-save').click();
  await expect(page.locator('[data-section="info"]').getByRole('alert')).toHaveText('SKU déjà utilisé');
  await expect(page.locator('#sku')).toBeFocused();
  await expect(page.locator('#name')).toHaveValue(name);
  await expect(page.locator('#price')).toHaveValue(/^4.?000$/);
  await expect(page.locator('#costPrice')).toHaveValue(/^5.?000$/);
  await expect(page.locator('#stock')).toHaveValue('5');

  // empty SKU ⇒ generated by the server; saved although the price is under the cost
  await page.locator('#sku').fill('');
  await page.getByTestId('form-save').click();
  await expect(page.locator('[data-toast="warning"]').filter({ hasText: 'SELLING_BELOW_COST' })).toBeVisible({ timeout: 20_000 });
  await expectUrl(page, /\/fr\/products\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  const saved = (await getProduct(request, account, id)) as SeedProduct & { price: number; costPrice: number; stock: number };
  expect(saved.name).toBe(name);
  expect(saved.price).toBe(4000);
  expect(saved.costPrice).toBe(5000);
  expect(saved.stock).toBe(5);
  expect(saved.sku).toMatch(/^PRD-/);
});

test('AT-CAT-03 variant product: total stock is the read-only sum, adjustments ask for a variant, low variant is flagged', async ({ page }) => {
  await loginHome(page, account);
  await openEdit(page, withVariants.id);
  await expect(page.getByRole('heading', { level: 1, name: 'La Robe satin' })).toBeVisible();
  await expect(page.getByText('2 VARIANTES')).toBeVisible();
  await expect(page.getByText('Produit à variantes : le stock total est la somme des variantes (lecture seule).')).toBeVisible();
  await expect(page.getByTestId('variants-total')).toHaveText('7');
  // no product-level quantity field nor product-level adjust link; the service switch is locked
  await expect(page.locator('#stock')).toHaveCount(0);
  await expect(page.getByTestId('stock-adjust-link')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Suivre le stock' })).toBeDisabled();

  const low = page.locator('[data-variant="Noir · M"]');
  await expect(low.getByTestId('variant-stock')).toHaveText('1');
  await expect(low.getByTestId('variant-stock').locator('xpath=..')).toHaveClass(/text-accent-starred/);
  await expect(page.locator('[data-variant="Noir · S"]').getByTestId('variant-stock')).toHaveText('6');

  // the saved row has no quantity input: stock moves through "Ajuster" only
  await low.getByTestId('variant-toggle').click();
  await expect(low.getByTestId('variant-editor')).toBeVisible();
  await expect(low.locator('input[id$="-stock"]')).toHaveCount(0);

  // header "Ajuster le stock": the variant is required (PRODUCT_HAS_VARIANTS)
  await page.getByTestId('product-adjust').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#adj-variant')).toBeVisible();
  await dialog.locator('#adj-qty').fill('2');
  await dialog.locator('#adj-reason').selectOption('correction');
  await dialog.getByRole('button', { name: 'Enregistrer l’ajustement' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'PRODUCT_HAS_VARIANTS' })).toBeVisible();
  // from the row menu the variant is preselected
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await low.getByRole('button', { name: /^Actions/ }).click();
  await page.getByRole('menuitem', { name: 'Ajuster le stock' }).click();
  await expect(page.getByRole('dialog').locator('#adj-variant')).not.toHaveValue('');
  await page.getByRole('dialog').locator('#adj-qty').fill('4');
  await page.getByRole('dialog').locator('#adj-reason').selectOption('correction');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer l’ajustement' }).click();
  await expect(low.getByTestId('variant-stock')).toHaveText('5', { timeout: 20_000 });
  await expect(page.getByTestId('variants-total')).toHaveText('11');
});

test('a new variant saved with "Enregistrer" leaves the form clean: no unsaved note, save disabled, no leave guard', async ({ page, request }) => {
  await loginHome(page, account);
  await openEdit(page, withVariants.id);
  await page.getByTestId('variant-add').click();
  const editor = page.getByTestId('variant-editor').last();
  await editor.locator('input[id$="-name"]').fill('Rouge · L');
  await editor.locator('input[id$="-price"]').fill('5200');
  await expect(page.getByTestId('dirty-note')).toContainText('variante Rouge · L');
  await page.getByTestId('form-save').click();
  await expect(page.locator('[data-toast]').filter({ hasText: 'Enregistré' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('dirty-note')).toHaveText('');
  await expect(page.getByTestId('form-save')).toBeDisabled();
  const saved = (await getProduct(request, account, withVariants.id)) as SeedProduct & { variants: { name: string }[] };
  expect(saved.variants.map((v) => v.name)).toContain('Rouge · L');
  // "Annuler" has nothing to discard: it leaves without the "Quitter sans enregistrer ?" dialog
  await page.getByTestId('form-cancel').click();
  await expect(page).toHaveURL(new RegExp(`/products/${withVariants.id}$`));
  await expect(page.getByRole('heading', { name: 'Quitter sans enregistrer ?' })).toHaveCount(0);
});

test('AT-CAT-04 the 11th image is refused inline (IMAGES_LIMIT); new pictures are sent with « Enregistrer » (UX-039); deleting the primary image promotes the next one', async ({ page, request }) => {
  test.setTimeout(180_000);
  await loginHome(page, account);
  await openEdit(page, gallery.id);
  const input = page.locator('input[data-upload="product-image"]');
  const count = page.getByTestId('image-count');
  await expect(count).toHaveText('0 / 10');
  await input.setInputFiles([picture(0)]);
  await expect(count).toHaveText('1 / 10');
  await input.setInputFiles(Array.from({ length: 9 }, (_, i) => picture(i + 1)));
  await expect(count).toHaveText('10 / 10');
  // tester log 26/10 UX-039: the new pictures wait in the form (« À ENREGISTRER »): nothing reached the product yet
  await expect(page.getByTestId('dirty-note')).toContainText('images');
  await expect(page.locator('[data-section="images"]').getByText('À ENREGISTRER')).toHaveCount(10);
  expect(((await getProduct(request, account, gallery.id)) as unknown as { images: unknown[] }).images).toHaveLength(0);

  await input.setInputFiles([picture(11)]);
  await expect(page.locator('[data-section="images"]').getByRole('alert').filter({ hasText: '10 images max par produit.' })).toBeVisible();
  await expect(count).toHaveText('10 / 10');
  // « Enregistrer » uploads them in order (the first one becomes the primary image)
  await page.getByTestId('form-save').click();
  await expect(page.getByTestId('dirty-note')).toHaveText('', { timeout: 90_000 });
  expect(((await getProduct(request, account, gallery.id)) as unknown as { images: unknown[] }).images).toHaveLength(10);

  // wait for the re-encode ("ENVOI…" ends), then delete the primary image
  await expect(page.locator('[data-section="images"] li[data-status="processing"]')).toHaveCount(0, { timeout: 90_000 });
  const primary = page.locator('[data-section="images"] li[data-image]').filter({ hasText: 'PRINCIPALE' });
  await expect(primary).toHaveCount(1);
  const primaryId = await primary.getAttribute('data-image');
  await primary.hover();
  await primary.getByRole('button', { name: 'Supprimer l’image' }).click();
  await expect(count).toHaveText('9 / 10', { timeout: 20_000 });
  await expect(page.locator(`[data-section="images"] li[data-image="${primaryId}"]`)).toHaveCount(0);
  const next = page.locator('[data-section="images"] li[data-image]').filter({ hasText: 'PRINCIPALE' });
  await expect(next).toHaveCount(1, { timeout: 20_000 });
  const images = ((await getProduct(request, account, gallery.id)) as unknown as { images: { id: string; isPrimary: boolean }[] }).images;
  expect(images).toHaveLength(9);
  expect(images.filter((i) => i.isPrimary).map((i) => i.id)).toEqual([await next.getAttribute('data-image')]);
});

test('tester log 26/10 UX-039: a picture added in « Modifier » then « Annuler » is dropped; « + Ajouter » of the product page sends it to moderation', async ({ page, request }) => {
  test.setTimeout(120_000);
  await loginHome(page, account);
  await openEdit(page, plain.id);
  await page.locator('input[data-upload="product-image"]').setInputFiles([picture(20)]);
  await expect(page.getByTestId('image-count')).toHaveText('1 / 10');
  await page.getByTestId('form-cancel').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Quitter', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/products/${plain.id}$`));
  expect(((await getProduct(request, account, plain.id)) as unknown as { images: unknown[] }).images).toHaveLength(0);
  // the product page uploads at once: the picture is part of the product and waits for Djaber's review
  await page.locator('[data-testid="block-gallery"] input[data-upload="product-image"]').setInputFiles([picture(21)]);
  await expect.poll(async () => ((await getProduct(request, account, plain.id)) as unknown as { images: unknown[] }).images.length, { timeout: 30_000 }).toBe(1);
  const after = (await getProduct(request, account, plain.id)) as unknown as { moderation: { status: string } };
  expect(['pending', 'approved']).toContain(after.moderation.status);
});

test('AT-CAT-10 "Créer depuis une photo" fills only the empty fields and never the price', async ({ page }) => {
  await loginHome(page, account);
  await openNew(page);
  await page.locator('#name').fill('Mon nom à moi');
  await page.locator('#price').fill('4900');
  await page.getByTestId('photo-fill').click();
  const dialog = page.getByTestId('photo-dialog');
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Créer depuis une photo' })).toBeVisible();
  await expect(page.getByTestId('photo-analyse')).toBeDisabled();
  await page.locator('input[data-upload="ai-fill"]').setInputFiles([picture(1), picture(2)]);
  await page.getByTestId('photo-analyse').click();
  await expect(dialog).toHaveAttribute('data-phase', /^(filled|unavailable|failed|credits|error)$/, { timeout: 30_000 });
  const phase = await dialog.getAttribute('data-phase');

  if (phase === 'filled') {
    await page.getByTestId('photo-done').click();
    // the typed name and the price are untouched; an empty field that was filled is highlighted until edited
    await expect(page.locator('#name')).toHaveValue('Mon nom à moi');
    await expect(page.locator('[data-ai-filled="name"]')).toHaveCount(0);
    const description = await page.locator('#description').inputValue();
    if (description) {
      await expect(page.locator('[data-ai-filled="description"]')).toBeVisible();
      await page.locator('#description').fill(`${description} (relu)`);
      await expect(page.locator('[data-ai-filled="description"]')).toHaveCount(0);
    }
  } else if (phase === 'unavailable') {
    // no vision model configured: the unavailable state, then the entry button is disabled with the reason
    await expect(dialog.getByText('INDISPONIBLE')).toBeVisible();
    await expect(dialog.getByRole('status').filter({ hasText: 'IMAGE_ANALYSIS_UNAVAILABLE' })).toBeVisible();
    await page.getByTestId('photo-manual').click();
    await expect(page.getByTestId('photo-fill-off').getByRole('button')).toBeDisabled();
  } else {
    // failed / no credits / daily limit: shown inside the dialog, manual entry stays possible
    await expect(dialog.getByRole('alert')).toBeVisible();
    await page.getByTestId('photo-manual').click();
  }
  await expect(page.locator('#name')).toHaveValue('Mon nom à moi');
  await expect(page.locator('#price')).toHaveValue(/^4.?900$/);
});

test('leave guard on a dirty form, then 409 conflict: Recharger takes the server version, Écraser resubmits the draft', async ({ page, request }) => {
  await loginHome(page, account);
  await openEdit(page, plain.id);
  await expect(page.getByTestId('form-save')).toBeDisabled();
  await page.locator('#description').fill('Bois de oud et musc blanc.');
  await expect(page.getByTestId('dirty-note')).toHaveText('● Modifications non enregistrées (description)');

  // leaving through the back link or "Annuler" asks first
  await page.getByRole('link', { name: 'Produits', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Rester' }).click();
  await page.getByTestId('form-cancel').click();
  await expect(dialog.getByRole('heading', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Rester' }).click();
  await expect(page.locator('#description')).toHaveValue('Bois de oud et musc blanc.');

  // someone else saves the product meanwhile
  const patch = async (data: Record<string, unknown>) => {
    const current = await getProduct(request, account, plain.id);
    const res = await request.patch(`${API}/products/${plain.id}`, { headers: authHeaders(account), data: { ...data, version: current.version } });
    expect(res.ok(), await res.text()).toBeTruthy();
  };
  await patch({ name: 'Parfum Oud 100 ml (édition)' });
  await page.getByTestId('form-save').click();
  await expect(dialog.getByRole('heading', { name: "Modifié par quelqu'un d'autre" })).toBeVisible();
  await dialog.getByRole('button', { name: 'Recharger' }).click();
  await expect(page.locator('#name')).toHaveValue('Parfum Oud 100 ml (édition)');
  await expect(page.locator('#description')).toHaveValue('');
  await expect(page.getByTestId('dirty-note')).toHaveText('');

  // second round: keep the draft and overwrite
  await page.locator('#description').fill('Bois de oud, musc blanc, ambre.');
  await patch({ weightGrams: 250 });
  await page.getByTestId('form-save').click();
  await expect(dialog.getByRole('heading', { name: "Modifié par quelqu'un d'autre" })).toBeVisible();
  await dialog.getByRole('button', { name: 'Écraser' }).click();
  await expect(page.locator('[data-toast]').filter({ hasText: 'Enregistré' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('dirty-note')).toHaveText('');
  const saved = (await getProduct(request, account, plain.id)) as SeedProduct & { description: string; weightGrams: number };
  expect(saved.description).toBe('Bois de oud, musc blanc, ambre.');
  expect(saved.weightGrams).toBe(250); // the other change is kept: only the edited field was sent
  await expect(page.locator('#weightGrams')).toHaveValue('250');
});

test('AT-UX-02 the product form in Arabic is right-to-left, SKU and amounts stay left-to-right, no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, account, 'ar');
  await expectUrl(page, '**/ar/home');
  await openEdit(page, withVariants.id, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#sku')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#price').locator('xpath=..')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('[data-section="stock"]').getByText('المخزون', { exact: true }).first()).toBeVisible();
  // two columns: the main one on the right (start side), STOCK / ORGANISATION on the left
  const info = (await page.locator('[data-section="info"]').boundingBox())!;
  const stock = (await page.locator('[data-section="stock"]').boundingBox())!;
  expect(stock.x + stock.width).toBeLessThanOrEqual(info.x);
  await expect(page.getByTestId('variants-total').locator('xpath=..')).toHaveAttribute('dir', 'ltr');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}`).toBeLessThanOrEqual(0);
    const inner = await page.locator('#main').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(inner, `main overflow at ${width}`).toBeLessThanOrEqual(0);
  }
  // one column under lg
  const infoNarrow = (await page.locator('[data-section="info"]').boundingBox())!;
  const stockNarrow = (await page.locator('[data-section="stock"]').boundingBox())!;
  expect(stockNarrow.y).toBeGreaterThan(infoNarrow.y + infoNarrow.height - 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await openNew(page, 'ar');
  await expect(page.getByRole('heading', { level: 1, name: 'منتج جديد' })).toBeVisible();
  await expect(page.locator('#sku')).toHaveAttribute('dir', 'ltr');
});

test('a11y: /products/new has no serious violation; ?type=service preselects "Suivre le stock" off', async ({ page }) => {
  await loginHome(page, account);
  await openNew(page);
  await expect(page.getByRole('switch', { name: 'Suivre le stock' })).toBeChecked();
  await expectNoA11yViolations(page);
  await page.goto('/fr/products/new?type=service');
  await expect(page.getByTestId('form-footer')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Suivre le stock' })).not.toBeChecked();
  await expect(page.locator('#stock')).toHaveCount(0);
});

test('AT-ONB-01 the "first product" step creates the product, with inline errors, then moves to the agent step', async ({ page, request }) => {
  const fresh = await createAccount(request, { prefix: 'pformonb', firstName: 'Lina' });
  const step = await request.patch(`${API}/workspace/onboarding`, { headers: authHeaders(fresh), data: { step: 3 } });
  expect(step.ok(), await step.text()).toBeTruthy();
  await login(page, fresh);
  await expectUrl(page, '**/fr/onboarding/first-product');
  await expect(page.getByRole('heading', { name: 'Ajoutez votre premier produit' })).toBeVisible();

  await page.getByTestId('first-product-submit').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Champ requis' }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/first-product$/);
  await page.locator('#p-name').fill('La Robe satin');
  await page.locator('#p-price').fill('0');
  await page.locator('#p-stock').fill('14');
  await page.getByTestId('first-product-submit').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Prix de vente requis (> 0)' })).toBeVisible();
  await expect(page.locator('#p-name')).toHaveValue('La Robe satin');

  await page.locator('#p-price').fill('4900');
  await page.getByTestId('first-product-submit').click();
  await expectUrl(page, '**/fr/onboarding/agent', { timeout: 20_000 });
  const list = await request.get(`${API}/products?pageSize=25`, { headers: authHeaders(fresh) });
  const rows = ((await list.json()) as { data: { name: string; price: number; stock: number }[] }).data;
  expect(rows.map((r) => [r.name, r.price, r.stock])).toEqual([['La Robe satin', 4900, 14]]);
  // reopened: the product created is shown, "Continuer" creates nothing; the step stays skippable ("Plus tard")
  await page.getByRole('link', { name: 'Produit', exact: true }).click();
  await expectUrl(page, '**/fr/onboarding/first-product');
  await expect(page.getByTestId('first-product-existing')).toContainText('« La Robe satin »');
  await expect(page.getByTestId('first-product-submit')).toHaveCount(0);
  await page.getByTestId('first-product-continue').click();
  await expectUrl(page, '**/fr/onboarding/agent');
  await page.getByRole('link', { name: 'Produit', exact: true }).click();
  await expectUrl(page, '**/fr/onboarding/first-product');
  await page.getByRole('button', { name: 'Plus tard' }).click();
  await expectUrl(page, '**/fr/onboarding/agent');
  const again = await request.get(`${API}/products?pageSize=25`, { headers: authHeaders(fresh) });
  expect(((await again.json()) as { data: unknown[] }).data).toHaveLength(1);
});
