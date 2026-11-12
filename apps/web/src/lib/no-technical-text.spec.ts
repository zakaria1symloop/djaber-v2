// UX-059 (retest 12/11) — GLOBAL rule of 12-screen-states: no technical text on merchant (shop) screens. No error code in
// capitals, raw key, spec / Figma reference (D9, DLV-05), model name (AgentVersion, Order.status), HTTP status or
// unfilled placeholder in what the merchant reads. This test keeps the rule for the whole catalogue and the screens' code,
// not screen by screen. Platform admin texts (`admin*`, `platform*`) and the developer surfaces listed below keep codes.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const MESSAGES = join(ROOT, 'packages/shared/src/i18n/messages');
const ERRORS = join(ROOT, 'packages/shared/src/errors');
const LOCALES = ['fr', 'ar', 'en'] as const;

const ADMIN_KEY = /^(admin|platform|billingDoc\.)/;
/** Developer surfaces where the technical name is the content (API keys, webhooks, template variables, Meta's own names). */
const ALLOWED_KEYS = new Set([
  'settings.integrations.apiKeys.usage',
  'settings.integrations.apiKeys.headerHint',
  'settings.integrations.webhooks.description',
  'settings.integrations.webhooks.signatureHint',
  'agents.template.hint',
  'channels.connect.explainer.permission.catalog',
  'channels.connect.explainer.permission.igMessages',
  'channels.connect.explainer.permission.igProfile',
  'channels.connect.explainer.permission.instagram',
  'channels.connect.explainer.permission.messaging',
  'validation.announcementLink',
]);

const RULES: [string, RegExp][] = [
  ['error code in brackets', /\((?:[A-Z][A-Z0-9]+_[A-Z0-9_]+)\)/],
  ['raw error code', /\b[A-Z][A-Z0-9]+_[A-Z0-9_]{3,}\b/],
  ['snake_case code in brackets', /\([a-z]+_[a-z_]+\)/],
  ['spec decision id', /\(D\d{1,3}\)|\bD\d{1,3}\b(?![+−-])/],
  ['spec / Figma frame id', /\b(?:DLV|ORD|CAT|AGT|AGV|CHN|INB|MSG|NTF|LST|PAY|GDS|CSH|MOD|ADM|MOB|FL|AT)-\d{2}\b/],
  ['model name in brackets', /\((?:[A-Z][a-z]+){2,}\)/],
  ['model field', /\b(?:Order|Customer|Agent|Product|Shipment|Workspace|Conversation)\.[a-z][A-Za-z]+/],
  ['url query hint', /\?[A-Za-zÀ-ÿ؀-ۿ]+=/],
  ['HTTP status', /\((?:401|403|404|409|422|429|500)\)/],
  ['spec section', /§ ?\d/],
  ['time zone id', /Africa\/Algiers/],
];

const load = (file: string): Record<string, string> => JSON.parse(readFileSync(file, 'utf8'));
const merchantCatalogue = (locale: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const f of readdirSync(MESSAGES)) if (f.endsWith(`.${locale}.json`) && !f.includes('source') && !f.startsWith('admin')) Object.assign(out, load(join(MESSAGES, f)));
  for (const [code, text] of Object.entries(load(join(ERRORS, `messages.${locale}.json`)))) out[`error.${code}`] = text;
  return out;
};
/** Placeholders and ICU blocks are not text the merchant reads. */
const visible = (s: string): string => {
  let out = s;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/\{[^{}]*\}/g, ' ');
  }
  return out;
};

describe('merchant catalogue: no technical text (UX-059)', () => {
  for (const locale of LOCALES) {
    it(`${locale}: every merchant string reads as words`, () => {
      const found: string[] = [];
      for (const [key, text] of Object.entries(merchantCatalogue(locale))) {
        if (ADMIN_KEY.test(key) || ALLOWED_KEYS.has(key)) continue;
        const v = visible(text);
        for (const [name, re] of RULES) if (re.test(v)) found.push(`${key} — ${name}: ${text}`);
      }
      expect(found).toEqual([]);
    });
  }
});

const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f) && !/\.(spec|stories)\.tsx$/.test(f)) out.push(p);
  }
  return out;
};
const ADMIN_FILE = /[\\/](admin[^\\/]*|\(admin\))[\\/]/;

describe('merchant screens: no code appended to a sentence (UX-059)', () => {
  it('no « (SOME_CODE) » / « CODE : » literal and no `${code}` in brackets in the JSX of the shop screens', () => {
    const found: string[] = [];
    for (const file of walk(resolve(__dirname, '..'))) {
      if (ADMIN_FILE.test(file)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (/<Ltr[^>]*>\s*\(?[A-Z][A-Z0-9]+_[A-Z0-9_]+\)?\s*<\/Ltr>/.test(line) || /\(\$\{[^}]*(?:\.code|reasonCode|lockReason)\}\)/.test(line) || /\$\{[^}]*error\??\.code[^}]*\}\s*(?:—|·|:)/.test(line)) found.push(`${file.slice(ROOT.length)}:${i + 1}`);
        });
    }
    expect(found).toEqual([]);
  });
});
