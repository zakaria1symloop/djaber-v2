// M11 — public site (web-public): PublicLayout (PUB-01), landing / features, pricing (AT-PUB-01), legal CMS pages
// (AT-PUB-02), public help centre, Meta data-deletion `?lang=` (AT-PUB-03 UI), public account deletion (AT-PUB-04), SEO.
// Real API (fake drivers). CMS entries are created through the platform admin API with unique keys. Every visitor
// context gets its own `X-Forwarded-For` address so the 3 / h / IP limits of the public forms stay per test.
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { API, apiReady, authHeaders, createAccount, mailLink, waitForMail } from './support/m1';
import { adminHeaders, platformAdmin, type Admin } from './support/m10-help';
import { inviteMember } from './support/m9';

test.describe.configure({ timeout: 180_000 });

const digits = (s: string) => s.replace(/[\s  ]/g, '');
const ip = () => `10.${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
async function visitor(browser: Browser) {
  return browser.newContext({ locale: 'fr-DZ', timezoneId: 'Africa/Algiers', extraHTTPHeaders: { 'X-Forwarded-For': ip() } });
}
const data = async <T>(request: APIRequestContext, path: string): Promise<T> => ((await (await request.get(`${API}${path}`)).json()) as { data: T }).data;
// streamed pages: the skeleton is replaced once the server content is revealed (the hidden copy is gone by then)
const settled = (page: import('@playwright/test').Page) => expect(page.getByTestId('public-skeleton')).toHaveCount(0);
const noHorizontalScroll = async (page: import('@playwright/test').Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

type Plan = { slug: string; name: string; priceMonthly: number; priceYearly: number; yearlyDiscountPct?: number; trialDays: number };
const sections = (body: string) => body.split('\n').filter((l) => /^##\s/.test(l)).length;

test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable');
});

test('PUB-01 — landing: header links, hero, 6 feature blocks, plans, footer, hreflang; axe', async ({ browser, request }) => {
  const [hero, features, plans] = await Promise.all([data<{ title: string }>(request, '/cms/landing?lang=fr'), data<{ body: string }>(request, '/cms/features?lang=fr'), data<Plan[]>(request, '/plans')]);
  const ctx = await visitor(browser);
  const page = await ctx.newPage();
  await page.goto('/fr');
  await expect(page).toHaveURL(/\/fr$/);
  await settled(page);
  await expect(page.locator('#main').getByTestId('landing')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(hero.title);
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  for (const name of ['Fonctionnalités', 'Tarifs', 'Aide', 'Statut']) await expect(nav.getByRole('link', { name })).toBeVisible();
  await expect(page.getByTestId('feature-block')).toHaveCount(sections(features.body));
  await expect(page.getByTestId('pricing-plan')).toHaveCount(plans.length);
  const footer = page.getByTestId('public-footer');
  for (const name of ['Conditions', 'Confidentialité', 'Supprimer mon compte', 'Statut', 'Contact']) await expect(footer.getByRole('link', { name, exact: true })).toBeVisible();
  // SEO: title, description, canonical + hreflang alternates
  await expect(page).toHaveTitle(/Djaber\.ai/);
  await expect(page.locator('link[rel="alternate"][hreflang="ar"]')).toHaveAttribute('href', /\/ar$/);
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute('href', /\/fr$/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
  await expectNoA11yViolations(page);
  await nav.getByRole('link', { name: 'Fonctionnalités' }).click();
  await expect(page).toHaveURL(/\/fr\/features$/);
  await expect(page.getByTestId('feature-block')).toHaveCount(sections(features.body));
  await expect(nav.getByRole('link', { name: 'Fonctionnalités' })).toHaveAttribute('aria-current', 'page');
  // Arabic mirrors without horizontal scroll
  await page.goto('/ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await settled(page);
  await expect(page.locator('#main').getByTestId('landing')).toBeVisible();
  await noHorizontalScroll(page);
  await ctx.close();
});

test('AT-PUB-01 — pricing lists the visible plans only, yearly toggle −17 %, FAQ, CTA → sign-up with the trial', async ({ browser, request }) => {
  const [plans, faq, packs] = await Promise.all([data<Plan[]>(request, '/plans'), data<{ body: string }>(request, '/cms/pricing-faq?lang=fr'), data<{ priceWebDzd: number }[]>(request, '/credit-packs')]);
  const paid = plans.filter((p) => p.priceMonthly > 0);
  const pct = Math.max(...paid.map((p) => (p.yearlyDiscountPct && p.yearlyDiscountPct > 0 ? Math.round(p.yearlyDiscountPct) : Math.round(((p.priceMonthly * 12 - p.priceYearly) * 100) / (p.priceMonthly * 12)))));
  const ctx = await visitor(browser);
  const page = await ctx.newPage();
  await page.goto('/fr/pricing');
  await settled(page);
  const cards = page.getByTestId('pricing-plan');
  await expect(cards).toHaveCount(plans.length);
  expect(await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-plan')))).toEqual(plans.map((p) => p.slug));
  await expect(page.getByTestId('pricing-cards')).not.toContainText('Agence');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Un vendeur IA pour votre page, à partir de');
  await expect(page.getByTestId('pricing-note')).toContainText(`packs de crédits à partir de`);
  expect(digits(await page.getByTestId('pricing-note').innerText())).toContain(`${Math.min(...packs.map((p) => p.priceWebDzd))}DA`);

  // monthly → yearly: −17 % label computed from the plans, monthly equivalent + "facturé … DA / an", URL keeps the cycle
  const yearly = page.getByRole('radio', { name: `Annuel −${pct} %` });
  await expect(page.getByRole('radio', { name: 'Mensuel' })).toHaveAttribute('aria-checked', 'true');
  await yearly.click();
  await expect(yearly).toHaveAttribute('aria-checked', 'true');
  await expect(page).toHaveURL(/\?cycle=yearly$/);
  const first = paid[0]!;
  const card = page.locator(`[data-testid="pricing-plan"][data-plan="${first.slug}"]`);
  // mono labels are upper-cased by CSS: compare without case
  expect(digits(await card.innerText()).toLowerCase()).toContain(`${Math.round(first.priceYearly / 12)}da/mois·annuel`);
  expect(digits(await card.innerText()).toLowerCase()).toContain(`facturé${first.priceYearly}da/an`);

  // FAQ: one accordion item per `## ` question of the CMS entry
  const items = page.getByTestId('faq-item');
  await expect(items).toHaveCount(sections(faq.body));
  await items.first().locator('summary').click();
  await expect(items.first()).toHaveAttribute('open', '');
  await expectNoA11yViolations(page);

  // CTA of a paid plan → sign-up (the 14-day trial starts there)
  const cta = page.getByTestId(`pricing-cta-${first.slug}`);
  await expect(cta).toHaveText(`Essai gratuit ${first.trialDays} j`);
  await cta.click();
  await expect(page).toHaveURL(new RegExp(`/fr/signup\\?plan=${first.slug}&cycle=yearly$`));
  await expect(page.locator('#email')).toBeVisible();

  await page.goto('/ar/pricing?cycle=yearly');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('radio').nth(1)).toHaveAttribute('aria-checked', 'true');
  await noHorizontalScroll(page);
  await ctx.close();
});

test.describe('CMS pages (platform admin entries)', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: Admin;
  const suffix = Date.now().toString(36);
  const legalKey = `e2e-legal-${suffix}`;
  const draftKey = `e2e-draft-${suffix}`;
  const guideKey = `e2e-guide-pub-${suffix}`;
  let draftId = '';

  const cms = async (request: APIRequestContext, method: 'post' | 'put', path: string, body: unknown) => {
    const r = await request[method](`${API}${path}`, { headers: { ...adminHeaders(admin), 'Idempotency-Key': randomUUID() }, data: body });
    const j = (await r.json()) as { data: { id: string } };
    expect(r.ok(), `${path} → ${r.status()} ${JSON.stringify(j)}`).toBeTruthy();
    return j.data;
  };

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    admin = await platformAdmin(request, 'super_admin', 'm11pub');
    // a legal page published in French only, then edited: v1 → v2
    const legal = await cms(request, 'post', '/admin/cms', { key: legalKey, type: 'legal', locales: { fr: { title: `CGU e2e ${suffix}`, body: '## 1. Objet\n\nAncien texte de l’objet.\n\n## 2. Compte\n\nTexte commun.' } } });
    await cms(request, 'post', `/admin/cms/${legal.id}/publish`, { fallbackToFr: true });
    await cms(request, 'put', `/admin/cms/${legal.id}/locales/fr`, { title: `CGU e2e ${suffix}`, body: '## 1. Objet\n\nNouveau texte de l’objet.\n\n## 2. Compte\n\nTexte commun.\n\n## 3. Résiliation\n\nAjout v2.' });
    await cms(request, 'post', `/admin/cms/${legal.id}/publish`, { fallbackToFr: true });
    // a draft (never published) and a help guide of the "stock" category
    draftId = (await cms(request, 'post', '/admin/cms', { key: draftKey, type: 'legal', locales: { fr: { title: `Brouillon ${suffix}`, body: 'Texte non publié.' } } })).id;
    const guide = await cms(request, 'post', '/admin/cms', { key: guideKey, type: 'help', category: 'stock', locales: { fr: { title: `Inventaire tournant ${suffix}`, body: '## Étapes\n\n- Ouvrir Stock\n- Compter' } } });
    await cms(request, 'post', `/admin/cms/${guide.id}/publish`, { fallbackToFr: true });
  });

  test('AT-PUB-02 — legal page: version + date, ?lang=ar ⇒ French text + banner, history v1 → v2 diff, unpublished ⇒ 404, signed preview', async ({ browser, request }) => {
    const ctx = await visitor(browser);
    const page = await ctx.newPage();
    await page.goto(`/fr/legal/${legalKey}`);
    const legal = page.getByTestId('legal-page');
    await expect(legal).toHaveAttribute('data-version', '2');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`CGU e2e ${suffix}`);
    await expect(page.getByTestId('legal-version')).toContainText('v2 · en vigueur depuis le');
    await expect(page.getByTestId('cms-fallback')).toHaveCount(0);
    // version history at the bottom with the diff v1 → v2
    await expect(page.getByTestId('legal-history')).toContainText('Historique des versions');
    await expect(page.getByTestId('legal-history')).toContainText('Modifications de la v1 à la v2');
    await expect(page.locator('[data-diff="del"]')).toContainText('Ancien texte de l’objet.');
    await expect(page.locator('[data-diff="add"]').first()).toContainText('Nouveau texte de l’objet.');
    await expectNoA11yViolations(page);

    // ?lang=ar without an Arabic version ⇒ French content + "non disponible en العربية" banner (French interface)
    await page.getByTestId('legal-lang-ar').click();
    await expect(page).toHaveURL(new RegExp(`/fr/legal/${legalKey}\\?lang=ar$`));
    await expect(page.getByTestId('cms-fallback')).toHaveText('Cette page n’est pas encore disponible en العربية — version française affichée.');
    await expect(legal).toHaveAttribute('data-lang', 'fr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`CGU e2e ${suffix}`);

    // unpublished slug ⇒ HTTP 404 "Page introuvable" with search + links
    const res = await page.goto(`/fr/legal/${draftKey}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId('public-not-found')).toContainText('Page introuvable');
    await expect(page.getByTestId('public-not-found').getByRole('link', { name: 'Aide' })).toBeVisible();
    expect((await page.goto('/fr/legal/Bad..Key'))?.status()).toBe(404);

    // the admin signed preview link (24 h) shows the draft with the preview banner
    const link = ((await (await request.get(`${API}/admin/cms/${draftId}/preview-link`, { headers: adminHeaders(admin) })).json()) as { data: { url: string } }).data.url;
    const u = new URL(link);
    await page.goto(`/fr${u.pathname}${u.search}`);
    await expect(page.getByTestId('cms-preview')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Brouillon ${suffix}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await ctx.close();
  });

  test('public help centre: categories, search, guide page with FR fallback, unknown guide 404; anonymous /help → help centre', async ({ browser }) => {
    const ctx = await visitor(browser);
    const page = await ctx.newPage();
    await page.goto('/fr/help-center');
    await settled(page);
    await expect(page.getByTestId('public-help')).toBeVisible();
    await expect(page.getByTestId('help-categories').getByRole('link')).toHaveCount(8);
    await page.getByTestId('help-category-stock').click();
    await expect(page).toHaveURL(/\/fr\/help-center\?category=stock$/);
    await expect(page.getByTestId('help-results')).toContainText(`Inventaire tournant ${suffix}`);
    // search (≥ 2 characters), no match ⇒ filtered empty state
    await page.getByRole('searchbox').fill('x');
    await page.getByTestId('help-search-submit').click();
    await expect(page.getByText('Saisissez au moins 2 caractères.')).toBeVisible();
    await page.getByRole('searchbox').fill(`zzz-${suffix}`);
    await page.getByTestId('help-search-submit').click();
    await expect(page.getByText('Aucun guide ne correspond')).toBeVisible();
    await page.getByRole('searchbox').fill(`Inventaire tournant ${suffix}`);
    await page.getByTestId('help-search-submit').click();
    await page.getByTestId('help-results').getByTestId('help-guide').first().click();
    await expect(page).toHaveURL(new RegExp(`/fr/help/${guideKey}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Inventaire tournant ${suffix}`);
    await expect(page.getByTestId('cms-body').getByRole('listitem')).toHaveCount(2);
    await expectNoA11yViolations(page);
    // English interface, French-only guide ⇒ fallback banner
    await page.goto(`/en/help/${guideKey}`);
    await expect(page.getByTestId('cms-fallback')).toHaveText('This page is not available in English yet — showing the French version.');
    expect((await page.goto(`/fr/help/inconnu-${suffix}`))?.status()).toBe(404);
    await expect(page.getByTestId('public-not-found')).toBeVisible();
    // 12 §1b: the public help stays reachable at /help without login
    await page.goto(`/fr/help?article=${guideKey}`);
    await expect(page).toHaveURL(new RegExp(`/fr/help/${guideKey}$`));
    await page.goto('/fr/help');
    await expect(page).toHaveURL(/\/fr\/help-center$/);
    await ctx.close();
  });
});

test('AT-PUB-03 — Meta data-deletion status: ?lang=en opens the English page of the same code', async ({ browser }) => {
  const ctx = await visitor(browser);
  const page = await ctx.newPage();
  await page.goto('/fr/meta/data-deletion/zz-unknown-code?lang=en');
  await expect(page).toHaveURL(/\/en\/meta\/data-deletion\/zz-unknown-code$/);
  await expect(page.getByTestId('data-deletion')).toHaveAttribute('data-status', 'not_found');
  await ctx.close();
});

test.describe('AT-PUB-04 — public account deletion', () => {
  test('same neutral answer for an unknown e-mail and after the 3 / h / IP limit; validation; expired link', async ({ browser }) => {
    const ctx = await visitor(browser);
    const page = await ctx.newPage();
    await page.goto('/fr/account/deletion');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Supprimer mon compte Djaber');
    await expect(page.getByTestId('deletion-steps').getByRole('listitem')).toHaveCount(4);
    await expectNoA11yViolations(page);
    // client validation: e-mail + consent required
    await page.getByTestId('del-submit').click();
    await expect(page.getByTestId('deletion-form')).toContainText('Champ requis');
    for (let i = 1; i <= 4; i++) {
      const email = `inconnu.${i}.${Date.now().toString(36)}@example.com`;
      await page.locator('#del-email').fill(email);
      await page.getByTestId('del-consent').check();
      const answer = page.waitForResponse((r) => r.url().endsWith('/account-deletion/request') && r.request().method() === 'POST');
      await page.getByTestId('del-submit').click();
      expect((await answer).status()).toBe(i <= 3 ? 200 : 429);
      // the 4th request of the hour answers 429 RATE_LIMITED: the page shows the very same text
      await expect(page.getByTestId('deletion-sent')).toContainText(`Si un compte existe pour ${email}, un e-mail a été envoyé avec un lien de confirmation valable 24 h.`);
      await page.getByRole('button', { name: 'Utiliser une autre adresse' }).click();
    }
    // unknown link ⇒ LIEN INVALIDE (full-test 15/11 PUBLIC-11; « expiré » is for a 410 only) + "Refaire une demande"
    await page.goto(`/fr/account/deletion?token=${'x'.repeat(43)}`);
    await expect(page.getByTestId('deletion-state')).toHaveAttribute('data-state', 'invalid');
    await expect(page.getByTestId('deletion-state')).toContainText('Ce lien n’est pas valide.');
    await page.getByTestId('del-restart').click();
    await expect(page.getByTestId('deletion-form')).toBeVisible();
    await ctx.close();
  });

  test('e-mail link → confirm with export → deactivated + date + export link → cancel; owner ⇒ ACCOUNT_OWNS_WORKSPACE', async ({ browser, request }) => {
    // an invited member owns no workspace: the account can be deleted; the owner of a live workspace cannot
    const owner = await createAccount(request, { prefix: 'm11delown', finishOnboarding: true });
    const user = await inviteMember(request, owner, 'operator', 'Yacine');
    const me = (await (await request.get(`${API}/me`, { headers: authHeaders({ ...user, workspaceId: null }) })).json()) as { data: { ownedWorkspaceId: string | null } };
    expect(me.data.ownedWorkspaceId).toBeNull();
    const ctx = await visitor(browser);
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto('/fr/account/deletion');
    await page.locator('#del-email').fill(user.email);
    await page.getByTestId('del-consent').check();
    await page.getByTestId('del-submit').click();
    await expect(page.getByTestId('deletion-sent')).toBeVisible();
    const mail = await waitForMail(user.email, /account-deletion-request/, { after: t0 - 1000, timeoutMs: 60_000 });
    await page.goto(`/fr${mailLink(mail).replace(/^\/(fr|ar|en)/, '')}`);
    const state = page.getByTestId('deletion-state');
    await expect(state).toHaveAttribute('data-state', 'confirm');
    await expect(state).toContainText('Confirmer la suppression du compte');
    await page.getByTestId('del-export').check();
    await page.getByTestId('del-confirm').click();
    await expect(state).toHaveAttribute('data-state', 'grace');
    await expect(state).toContainText('Compte désactivé');
    await expect(state).toContainText('Suppression définitive le');
    // the page continues with the cancel token: a reload keeps the state, the export finishes (worker job)
    await expect(page).toHaveURL(/token=/);
    await page.reload();
    await expect(state).toHaveAttribute('data-state', 'grace');
    await expect(page.getByTestId('deletion-export')).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
    await expect(page.getByTestId('deletion-export-link')).toHaveText('Exporter mes données');
    await page.getByTestId('del-cancel').click();
    await expect(state).toHaveAttribute('data-state', 'cancelled');
    await expect(state).toContainText('Suppression annulée');

    // the owner of a live workspace is blocked at confirmation
    const t1 = Date.now();
    const ctx2 = await visitor(browser);
    const p2 = await ctx2.newPage();
    await p2.goto('/fr/account/deletion');
    await p2.locator('#del-email').fill(owner.email);
    await p2.getByTestId('del-consent').check();
    await p2.getByTestId('del-submit').click();
    await expect(p2.getByTestId('deletion-sent')).toBeVisible();
    const m2 = await waitForMail(owner.email, /account-deletion-request/, { after: t1 - 1000, timeoutMs: 60_000 });
    await p2.goto(`/fr${mailLink(m2).replace(/^\/(fr|ar|en)/, '')}`);
    await p2.getByTestId('del-confirm').click();
    const s2 = p2.getByTestId('deletion-state');
    await expect(s2).toHaveAttribute('data-state', 'blocked');
    await expect(s2).toHaveAttribute('data-code', 'ACCOUNT_OWNS_WORKSPACE');
    await expect(s2).toContainText('Vous êtes propriétaire d’une boutique active');
    await ctx.close();
    await ctx2.close();
  });
});

test('SEO — robots.txt and sitemap.xml list the public pages with their language alternates', async ({ page }) => {
  const robots = await (await page.goto('/robots.txt'))!.text();
  expect(robots).toContain('Sitemap:');
  expect(robots).toContain('Disallow: /fr/admin');
  const sitemap = await (await page.goto('/sitemap.xml'))!.text();
  expect(sitemap).toContain('/fr/pricing</loc>');
  expect(sitemap).toContain('hreflang="ar"');
});
