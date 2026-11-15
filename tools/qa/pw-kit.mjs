// QA kit for the live full-site test campaign (docs/audit/full-test-2026-11-15/README.md).
// One import gives an agent: a signed-in page (role × locale) on the live site, a recorder of console errors / failed
// API calls / technical text on screen, screenshots, and a SAFETY NET that aborts the API calls that could touch the
// real world (courier parcels, payments, Meta pages, deletions, other shops in the admin). Blocked calls are recorded
// as `blocked`, never as bugs.
//
//   import { open } from '../../tools/qa/pw-kit.mjs';     // from a scratch script
//   const qa = await open({ role: 'owner', locale: 'fr', area: 'orders' });
//   await qa.go('/orders');                                // client-side navigation, waits for the network
//   await qa.check('orders list');                         // records text leaks of the current page
//   await qa.shot('orders-list');                          // .local/qa/campaign/<area>/orders-list.png
//   ... use qa.page (Playwright Page) for clicks / fills ...
//   const log = await qa.close();                          // { consoleErrors, apiErrors, leaks, blocked }
//
// Accounts: .local/qa/accounts.json (git-ignored) { web, api, shop, owner:{email,password}, admin:{…}, operator:{…}, superadmin:{…} }
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(resolve(root, 'apps/web/package.json'))('@playwright/test');
export const accounts = JSON.parse(readFileSync(resolve(root, '.local/qa/accounts.json'), 'utf8'));

/** API calls never let through (method, path regex). The UI may still open the dialog; the submit is aborted. */
export const BLOCKED = [
  ['POST', /\/orders\/[^/]+\/shipments\b/], // send to a real courier
  ['POST', /\/shipments\/(bulk|[^/]+\/(retry|change-courier|retry-delivery))/],
  ['POST', /\/delivery\/couriers(\/|$)/], // courier credentials are checked against the courier
  ['POST', /\/(checkout|packs\/checkout|payment-link|invoices\/[^/]+\/pay)\b/], // Chargily
  ['POST', /\/channels\/(connect|[^/]+\/reconnect)/], // Meta pages
  ['POST', /\/conversations\/[^/]+\/messages/], // a reply to a real Messenger customer
  ['POST', /\/(deletion-request|data-deletion|transfer-ownership)\b/],
  ['POST', /\/workspace\/deletion(?!\/cancel)/],
  ['DELETE', /\/deletion-request\b/],
  ['POST', /\/integrations\/(google|sheets)\/(connect|oauth)/],
  ['POST', /\/webhooks\/[^/]+\/test\b/],
  ['POST', /\/admin\/workspaces\/[^/]+\/(suspend|schedule-deletion|credits|credits\/remove|change-plan|extend)/],
  ['DELETE', /\/admin\//],
  ['POST', /\/admin\/(invoices\/[^/]+\/mark-paid|users\/[^/]+\/(block|disable-2fa|revoke-sessions|reset-password|platform-role))/],
  // the four test accounts are shared by every agent: no password / e-mail / 2FA / role / membership change, no
  // re-opened onboarding, no stock-mode switch (it changes the screens other agents are testing)
  ['PATCH', /\/me\/password$/],
  ['POST', /\/me\/email-change$/],
  ['POST', /\/auth\/2fa\/(setup|enable|disable|recovery-codes)$/],
  ['PATCH', /\/workspace\/members\//],
  ['DELETE', /\/workspace\/members\//],
  ['PATCH', /\/workspace\/onboarding$/],
  ['PATCH', /\/workspace$/, /"stockMode"/],
  // 15/11: the test shop's real ZR Express accounts are deactivated and auto-send is off — never switch them back on
  ['PATCH', /\/workspace$/, /"autoSendToCourier"\s*:\s*true/],
  ['PATCH', /\/delivery\/couriers\//],
  ['PUT', /\/delivery\/couriers\//],
  // gaps found by the settings run (15/11): workspace deletion, subscription cancel, Google OAuth, session sign-out
  ['DELETE', /\/workspace$/],
  ['POST', /\/billing\/cancel/],
  ['GET', /\/integrations\/google-sheets\/connect/],
  ['DELETE', /\/me\/sessions(\/|$)/],
  ['POST', /\/me\/sessions\/(revoke|logout)/],
  // gap found by the delivery run (15/11): cancelling a parcel reaches the real courier
  ['POST', /\/shipments\/[^/]+\/(cancel|sync)/],
  // 15/11 after the admin run: no admin write at all for the remaining areas
  ['POST', /\/admin\//],
  ['PATCH', /\/admin\//],
  ['PUT', /\/admin\//],
];

const LEAK_RULES = [
  [/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, 'raw {placeholder}'],
  [/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g, 'code in capitals'],
  [/\b[a-z]{2,}(?:_[a-z0-9]{2,})+\b/g, 'snake_case value'],
  [/\b(?:undefined|NaN|Invalid Date|\[object Object\])\b|(?<![\w-])null(?![\w-])/g, 'JavaScript value'],
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g, 'ISO / UTC date'],
];
const ALLOW = new Set(['COD', 'SKU', 'IA', 'AI', 'PDF', 'CSV', 'API', 'URL', 'DA', 'DZD', 'ZR', 'CCP', 'CIB', 'TVA', 'FAQ', 'PRO', 'OK', 'SMS', 'QR', 'ID']);

export async function open({ role = 'owner', locale = 'fr', area = 'misc', headless = true, viewport = { width: 1440, height: 900 } } = {}) {
  const acc = accounts[role];
  if (!acc) throw new Error(`no account for role ${role}`);
  const dir = resolve(root, '.local/qa/campaign', area);
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext({ viewport, locale: locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR' });
  const page = await ctx.newPage();
  const log = { consoleErrors: [], apiErrors: [], leaks: [], blocked: [] };
  page.on('console', (m) => m.type() === 'error' && log.consoleErrors.push({ url: page.url(), text: m.text().slice(0, 400) }));
  page.on('pageerror', (e) => log.consoleErrors.push({ url: page.url(), text: `pageerror: ${String(e.message ?? e).slice(0, 400)}` }));
  page.on('response', async (r) => {
    if (!r.url().startsWith(accounts.api) || r.status() < 400) return;
    let body = '';
    try {
      body = (await r.text()).slice(0, 300);
    } catch {}
    log.apiErrors.push({ page: page.url(), method: r.request().method(), url: r.url().replace(accounts.api, ''), status: r.status(), body });
  });
  await ctx.route(`${accounts.api}/**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (BLOCKED.some(([m, re, body]) => m === req.method() && re.test(path) && (!body || body.test(req.postData() ?? '')))) {
      log.blocked.push({ method: req.method(), path, page: page.url() });
      return route.fulfill({ status: 418, contentType: 'application/json', body: JSON.stringify({ error: { code: 'QA_BLOCKED', message: 'blocked by the QA kit (safety)', ref: 'qa' } }) });
    }
    return route.continue();
  });

  const settle = async () => {
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  };
  // sign in through the real login page
  await page.goto(`${accounts.web}/${locale}/login`);
  await page.locator('input[type="email"]').fill(acc.email);
  await page.locator('input[type="password"]').fill(acc.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 25_000 });
  await settle();

  const qa = {
    page,
    ctx,
    log,
    dir,
    locale,
    settle,
    /** client-side navigation inside the app (keeps the in-memory session); `path` without the locale prefix */
    async go(path) {
      const url = `/${locale}${path}`;
      const ok = await page.evaluate((u) => (window.next?.router ? (window.next.router.push(u), true) : false), url);
      if (!ok) await page.goto(`${accounts.web}${url}`);
      await page.waitForURL((u) => u.pathname === url.split('?')[0], { timeout: 15_000 }).catch(() => undefined);
      await settle();
    },
    /** full page load (session is restored from the refresh cookie) */
    async load(path) {
      await page.goto(`${accounts.web}/${locale}${path}`);
      await settle();
    },
    /** records technical text visible in <main>, dialogs and menus right now */
    async check(where = page.url()) {
      const text = await page.evaluate(() => [...document.querySelectorAll('main, [role="dialog"], [role="menu"], [role="alert"], [role="status"]')].map((e) => e.innerText).join('\n'));
      for (const [re, why] of LEAK_RULES) for (const m of text.matchAll(re)) if (!ALLOW.has(m[0])) log.leaks.push({ where, hit: m[0], why, excerpt: text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' ') });
    },
    async shot(name) {
      const p = resolve(dir, `${locale}-${name}.png`);
      await page.screenshot({ path: p, fullPage: false });
      return p;
    },
    async close() {
      await browser.close();
      return log;
    },
  };
  return qa;
}
