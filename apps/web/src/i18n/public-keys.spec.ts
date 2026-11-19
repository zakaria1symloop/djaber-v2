// full-test 15/11 PUBLIC-04: the public / auth / status / tracking pages receive only the public subset of the catalogue
// (src/i18n/public-keys.json); these tests fail when a public component can show a key outside it.
import { readFileSync } from 'node:fs';
import { getMessages, LOCALES } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import { publicMessages, restMessages } from '@/lib/server-messages';
import { catalogueKeys, keysIn, publicKeys, reachableFiles, serialize } from '../../scripts/public-messages.mjs';
import PUBLIC_KEYS from './public-keys.json';

const files = reachableFiles() as string[];

describe('public i18n subset (PUBLIC-04)', () => {
  it('is up to date with the code of the public routes (run `node apps/web/scripts/public-messages.mjs`)', () => {
    const fresh = serialize(publicKeys()) as string;
    expect(PUBLIC_KEYS).toEqual(JSON.parse(fresh));
  });

  it('covers every literal key a public component passes to t() (same rule as tools/i18n-check.mjs)', () => {
    const subset = new Set<string>(PUBLIC_KEYS);
    const missing: string[] = [];
    const RE = [/\bt\(\s*'([^'$]+)'/g, /\bt\(\s*"([^"$]+)"/g, /\b(?:key|labelKey|titleKey|descriptionKey|hintKey|emptyKey)\s*:\s*'([a-z][\w]*\.[\w.]+)'/g];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const re of RE) for (const m of src.matchAll(re)) if (!subset.has(m[1]!) && catalogueKeys().has(m[1])) missing.push(`${m[1]} (${f})`);
    }
    expect(missing).toEqual([]);
  });

  it('follows the import graph from the public entries (auth card, tracking page, status page, providers, 404)', () => {
    const rel = files.map((f) => f.replace(/\\/g, '/'));
    for (const f of [
      'components/providers.tsx',
      'components/public-header.tsx',
      'components/auth/auth-card.tsx',
      'components/global-states.tsx',
      'features/delivery/public/tracking-page.tsx',
      'features/status/status-page.tsx',
      'features/public/account-deletion.tsx',
      'app/[locale]/(auth)/signup/page.tsx',
      'app/[locale]/not-found.tsx',
    ])
      expect(rel.some((p) => p.endsWith(`apps/web/src/${f}`))).toBe(true);
    // the merchant app and the admin are not public: their screens stay out of the graph
    expect(rel.some((p) => p.includes('/app/[locale]/(app)/') || p.includes('/app/[locale]/(admin)/') || p.includes('/features/admin/'))).toBe(false);
  });

  it('reads built keys: concatenated heads, templates and namespace paths', () => {
    const all = new Set(['public.footer.terms', 'public.footer.privacy', 'help.category.orders', 'help.category.orders.description', 'enum.Order.returnReason.refused', 'error.NOT_FOUND', 'admin.nav.home']);
    const found = keysIn("t(`public.footer.${k}`); t(`help.category.${c}.description`); const P = ['enum.Order.returnReason']; t('error.' + code);", all) as Set<string>;
    expect([...found].sort()).toEqual(['enum.Order.returnReason.refused', 'error.NOT_FOUND', 'help.category.orders.description', 'public.footer.privacy', 'public.footer.terms']);
  });

  it('holds every API error and field message (forms show the code the server returns)', () => {
    const subset = new Set<string>(PUBLIC_KEYS);
    for (const k of Object.keys(getMessages('fr'))) if (k.startsWith('error.') || k.startsWith('validation.')) expect(subset.has(k)).toBe(true);
  });

  it('leaves the merchant app / admin catalogue out (the subset is a small part of the catalogue)', () => {
    const all = Object.keys(getMessages('fr'));
    expect(PUBLIC_KEYS.length).toBeLessThan(all.length * 0.15);
    expect(PUBLIC_KEYS.filter((k) => k.startsWith('admin.')).length).toBeLessThan(20);
    for (const k of ['orders.calls', 'admin.nav.users', 'nav.orders']) if (k in getMessages('fr')) expect(PUBLIC_KEYS).not.toContain(k);
  });

  it('public + rest = the whole catalogue of each locale, no key twice', () => {
    for (const l of LOCALES) {
      const pub = publicMessages(l);
      const rest = restMessages(l);
      const full = getMessages(l);
      expect(Object.keys(pub).length + Object.keys(rest).length).toBe(Object.keys(full).length);
      expect({ ...pub, ...rest }).toEqual(full);
      for (const k of Object.keys(pub)) expect(k in rest).toBe(false);
    }
  });
});
