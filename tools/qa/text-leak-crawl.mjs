// QA crawler — finds technical text shown to merchants (codes, raw keys, {placeholders}, raw enum values, ISO dates,
// spec numbers, undefined / NaN, untranslated words) on every shop page, in fr / ar / en.
// It reads the page text, tooltips (title, aria-label, placeholder) and the content of the « Actions » menus.
// Read-only: it signs in as a platform admin and opens the target shop through the read-only impersonation (D21-bis,
// audited, every write is refused by the API), then moves between pages client-side (the impersonation token lives in
// memory, a reload would end it). Nothing is clicked except menu triggers (closed again with Escape).
//
// Usage (from the repo root):
//   QA_ADMIN_EMAIL=… QA_ADMIN_PASSWORD=… node tools/qa/text-leak-crawl.mjs --shop "test's shop H-07" [--web https://djaber.vercel.app] [--locales fr,ar,en] [--out .local/qa]
// Output: <out>/text-leaks-<date>.md (one line per finding: rule · page · locale · excerpt) + .json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(resolve(root, 'apps/web/package.json'))('@playwright/test');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const WEB = arg('web', 'https://djaber.vercel.app').replace(/\/$/, '');
const API = arg('api', 'https://djaber.72-60-190-211.sslip.io') + '/api/v1';
const SHOP = arg('shop', '');
const LOCALES = arg('locales', 'fr,ar,en').split(',');
const OUT = resolve(root, arg('out', '.local/qa'));
const EMAIL = process.env.QA_ADMIN_EMAIL;
const PASSWORD = process.env.QA_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD || !SHOP) {
  console.error('QA_ADMIN_EMAIL, QA_ADMIN_PASSWORD and --shop are required');
  process.exit(2);
}

/** Shop pages (02-next-route-map); `[id]` pages are reached through the first links found on their list page. */
const PAGES = ['/home', '/queue', '/inbox', '/orders', '/orders/new', '/orders/import', '/clients', '/products', '/products/new', '/products/import', '/categories', '/services', '/stock', '/inventory', '/movements', '/suppliers', '/purchases', '/purchases/new', '/sales', '/sales/new', '/cash', '/delivery', '/delivery?tab=failed', '/delivery/couriers', '/delivery/fees', '/agents', '/agents/new', '/agents/generate', '/channels', '/analytics', '/reports', '/recommendations', '/notifications', '/help', '/help/contact', '/help/tickets', '/settings', '/settings/profile', '/settings/workspace', '/settings/members', '/settings/notifications', '/settings/quick-replies', '/settings/system-messages', '/settings/security', '/settings/stock-mode', '/settings/credits', '/settings/billing', '/settings/integrations', '/settings/danger'];
const DETAIL_FROM = { '/orders': /^\/orders\/[0-9a-f-]{36}$/, '/clients': /^\/clients\/[0-9a-f-]{36}$/, '/products': /^\/products\/[0-9a-f-]{36}$/, '/purchases': /^\/purchases\/[0-9a-f-]{36}$/, '/sales': /^\/sales\/[0-9a-f-]{36}$/, '/agents': /^\/agents\/[0-9a-f-]{36}$/, '/channels': /^\/channels\/[0-9a-f-]{36}$/, '/inbox': /^\/inbox\/[0-9a-f-]{36}$/, '/help/tickets': /^\/help\/tickets\/[0-9a-f-]{36}$/, '/inventory': /^\/inventory\/[0-9a-f-]{36}$/ };
const SUBPAGES = { '/agents/': ['/configuration', '/insights'], '/channels/': ['/ai', '/history', '/analysis'] };

// Words that look technical but are product vocabulary (keep this list short and justified).
const ALLOW = new Set(['COD', 'SKU', 'IA', 'AI', 'PDF', 'CSV', 'API', 'URL', 'DA', 'DZD', 'ZR', 'CCP', 'CIB', 'TVA', 'FAQ', 'PRO', 'OK', 'SMS', 'QR', 'ID', 'EcoTrack', 'WhatsApp', 'Messenger', 'Instagram', 'Facebook', 'Djaber', 'Yalidine', 'Chargily', 'Edahabia', 'Google', 'BaridiMob', 'iPhone', 'YouTube', 'TikTok', 'JavaScript', 'PayPal', 'OpenAI', 'ChatGPT']);
const RULES = [
  { id: 'placeholder', re: /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, why: 'raw {placeholder} not filled' },
  { id: 'error-code', re: /\b[A-Z][A-Z0-9]{1,}(?:_[A-Z0-9]+)+\b/g, why: 'error / enum code in capitals' },
  { id: 'snake-case', re: /\b[a-z]{2,}(?:_[a-z0-9]{2,})+\b/g, why: 'raw snake_case value (enum, reason, key)' },
  { id: 'dotted-key', re: /\b[a-z][a-zA-Z]+\.[a-z][a-zA-Z_]+(?:\.[a-zA-Z_]+)*\b/g, why: 'i18n key or event name', skip: (m, text) => /@|https?:|www\.|\.(com|dz|app|io|fr|net|org|png|jpe?g|webp|pdf|csv|xlsx)\b/i.test(m) || /\.(com|dz|app|io|fr|net|org)$/.test(m) || /[\w-]+@/.test(text) },
  { id: 'spec-id', re: /\((?:D\d{1,2}|[A-Z]{2,4}-\d{2,3})\)|\b(?:DLV|ORD|CAT|MOD|ADM|ONB|AGT|INB|GDS|CLI|BIL|AUTH|SAFE)-\d{2}\b/g, why: 'spec / Figma reference' },
  { id: 'camel-model', re: /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g, why: 'code model name (CamelCase)', skip: (m) => ALLOW.has(m) },
  { id: 'iso-date', re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g, why: 'ISO / UTC date' },
  { id: 'js-value', re: /\b(?:undefined|NaN|Invalid Date|\[object Object\])\b|(?<![\w-])null(?![\w-])/g, why: 'JavaScript value shown' },
  { id: 'json', re: /[[{]"[a-zA-Z]+":/g, why: 'raw JSON' },
  { id: 'upper-key', re: /[A-Z]{3,}(?:_[A-Z]+)*\.[A-Z]{2,}(?:_[A-Z]+)*/g, why: 'raw event / notification key in capitals' },
];
/** Texts that document variables on purpose (quick replies, system messages): not a leak. */
const INTENDED = [/variable/i, /\{(prénom|boutique|total|PRODUCT|SHOP|name|price|description|stock)\}/];
const UNTRANSLATED = { ar: /\b[A-Za-zÀ-ÿ]{5,}\b/g };

const findings = [];
const seen = new Set();
const check = (text, page, locale, where) => {
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      const hit = m[0];
      if (r.id === 'error-code' && ALLOW.has(hit)) continue;
      if (r.id === 'placeholder' && INTENDED[1].test(hit)) continue;
      if (r.skip?.(hit, text.slice(Math.max(0, m.index - 30), m.index + hit.length + 30))) continue;
      const excerpt = text.slice(Math.max(0, m.index - 50), m.index + hit.length + 50).replace(/\s+/g, ' ').trim();
      const key = `${r.id}|${hit}|${page.replace(/[0-9a-f-]{36}/g, ':id')}|${locale}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ rule: r.id, why: r.why, hit, page, locale, where, excerpt });
    }
  }
  const re = UNTRANSLATED[locale];
  if (re) {
    const words = [...new Set([...text.matchAll(re)].map((m) => m[0]).filter((w) => !ALLOW.has(w)))];
    if (words.length) {
      const key = `untranslated|${page.replace(/[0-9a-f-]{36}/g, ':id')}|${where}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({ rule: 'untranslated', why: 'Latin words on an Arabic page (check: product data or missing translation)', hit: words.slice(0, 12).join(' '), page, locale, where, excerpt: '' });
      }
    }
  }
};

const login = async () => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const j = await r.json();
  const token = j.data?.accessToken ?? j.data?.tokens?.accessToken;
  if (!token) throw new Error(`admin login refused: ${j.error?.code ?? r.status}`);
  const ws = await (await fetch(`${API}/admin/workspaces?q=${encodeURIComponent(SHOP)}&pageSize=25`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const hit = (ws.data ?? []).find((w) => w.name === SHOP) ?? ws.data?.[0];
  if (!hit) throw new Error(`shop « ${SHOP} » not found`);
  return hit;
};

const settle = async (page) => {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
};
const readPage = async (page, path, locale) => {
  const text = await page.evaluate(() => {
    const attrs = [...document.querySelectorAll('[title],[aria-label],[placeholder],[data-reason]')].map((e) => [e.getAttribute('title'), e.getAttribute('aria-label'), e.getAttribute('placeholder'), e.getAttribute('data-reason')].filter(Boolean).join(' · '));
    return { body: document.querySelector('main')?.innerText ?? document.body.innerText, attrs: attrs.join('\n') };
  });
  check(text.body, path, locale, 'page');
  check(text.attrs, path, locale, 'tooltip / label');
  // tabs of the page (history, delivery, versions…): each one read once
  const tabs = page.locator('main [role="tab"]');
  const nt = Math.min(await tabs.count(), 8);
  for (let i = 1; i < nt; i++) {
    try {
      await tabs.nth(i).click({ timeout: 3000 });
      await page.waitForTimeout(700);
      check(await page.evaluate(() => document.querySelector('main')?.innerText ?? ''), path, locale, `tab #${i + 1}`);
    } catch {
      /* a disabled tab */
    }
  }
  // « Actions ⌄ » menus (disabled reasons live there): open up to 6, read, close
  const triggers = page.locator('main [aria-haspopup="menu"]');
  const n = Math.min(await triggers.count(), 6);
  for (let i = 0; i < n; i++) {
    try {
      await triggers.nth(i).click({ timeout: 3000 });
      await page.waitForTimeout(300);
      const menu = await page.evaluate(() => [...document.querySelectorAll('[role="menu"]')].map((m) => m.innerText + '\n' + [...m.querySelectorAll('[title],[aria-label],[data-reason]')].map((e) => e.getAttribute('title') ?? e.getAttribute('aria-label') ?? e.getAttribute('data-reason')).join('\n')).join('\n'));
      check(menu, path, locale, `actions menu #${i + 1}`);
      await page.keyboard.press('Escape');
    } catch {
      await page.keyboard.press('Escape').catch(() => undefined);
    }
  }
};
const go = async (page, url) => {
  await page.evaluate((u) => (window.next?.router ? window.next.router.push(u) : (window.location.href = u)), url);
  await page.waitForURL((u) => u.pathname + u.search === url || u.pathname === url.split('?')[0], { timeout: 15_000 }).catch(() => undefined);
  await settle(page);
};

const run = async () => {
  const shop = await login();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const visited = [];
  for (const locale of LOCALES) {
    await page.goto(`${WEB}/${locale}/login`);
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20_000 });
    await page.goto(`${WEB}/${locale}/admin/workspaces?sheet=${shop.id}`);
    await settle(page);
    // the sheet's impersonate button, then the dialog (reason ≥ 10 characters); labels from the message catalogue
    const L = { fr: ['Se connecter en tant que', 'Se connecter (lecture seule)'], ar: ['الدخول باسمه', 'الدخول (قراءة فقط)'], en: ['Log in as', 'Log in (read-only)'] }[locale];
    await page.getByRole('button', { name: L[0], exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: L[1] }) });
    await dialog.locator('textarea, input:not([type]), input[type="text"]').first().fill('QA: lecture des textes affichés (crawler)');
    await dialog.getByRole('button', { name: L[1] }).click();
    await page.waitForURL(/\/home/, { timeout: 20_000 });
    await settle(page);
    const queue = [...PAGES];
    const done = new Set();
    while (queue.length) {
      const p = queue.shift();
      if (done.has(p)) continue;
      done.add(p);
      const url = `/${locale}${p}`;
      await go(page, url);
      if (!page.url().includes(p.split('?')[0])) {
        findings.push({ rule: 'navigation', why: 'page did not open', hit: page.url(), page: p, locale, where: 'page', excerpt: '' });
        continue;
      }
      visited.push(`${locale}${p}`);
      await readPage(page, p, locale);
      const re = DETAIL_FROM[p];
      if (re) {
        const links = await page.evaluate((loc) => [...document.querySelectorAll('main a[href]')].map((a) => new URL(a.href).pathname.replace(new RegExp(`^/${loc}`), '')), locale);
        const details = [...new Set(links.filter((l) => re.test(l)))].slice(0, 2);
        for (const d of details) {
          queue.unshift(d);
          for (const [prefix, subs] of Object.entries(SUBPAGES)) if (d.startsWith(prefix)) for (const s of subs) queue.splice(1, 0, d + s);
        }
      }
    }
    console.log(`${locale}: ${done.size} pages read, ${findings.filter((f) => f.locale === locale).length} findings`);
    await ctx.clearCookies();
  }
  await browser.close();
  mkdirSync(OUT, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const byRule = Object.groupBy ? Object.groupBy(findings, (f) => f.rule) : findings.reduce((a, f) => ((a[f.rule] ??= []).push(f), a), {});
  const md = [`# Text leaks — ${SHOP} — ${day}`, '', `${visited.length} page views · ${findings.length} findings`, ''];
  for (const [rule, list] of Object.entries(byRule)) {
    md.push(`## ${rule} — ${list[0].why} (${list.length})`, '');
    for (const f of list) md.push(`- \`${f.hit}\` · ${f.page} · ${f.locale} · ${f.where}${f.excerpt ? ` — « ${f.excerpt} »` : ''}`);
    md.push('');
  }
  writeFileSync(resolve(OUT, `text-leaks-${day}.md`), md.join('\n'));
  writeFileSync(resolve(OUT, `text-leaks-${day}.json`), JSON.stringify({ shop: SHOP, visited, findings }, null, 2));
  console.log(`report: ${resolve(OUT, `text-leaks-${day}.md`)}`);
};
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
