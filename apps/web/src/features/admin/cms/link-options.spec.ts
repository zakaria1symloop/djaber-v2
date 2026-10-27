// Tester log 26/10 UX-036 — the pages offered for an announcement « Lien ».
import { getMessages, isAnnouncementLink } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import { announcementLinkOptions } from './link-options';

const fr = getMessages('fr');
const t = (key: string) => fr[key] ?? key;

describe('announcementLinkOptions (UX-036)', () => {
  const options = announcementLinkOptions(t);
  it('every page passes the API rule, once, with a translated name', () => {
    for (const o of options) expect(isAnnouncementLink(o.value)).toBe(true);
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
    for (const o of options) expect(o.label).not.toMatch(/^(nav|public|admin)\./);
  });
  it('public site pages, the sidebar items and the settings menu — never a sub-page', () => {
    const values = options.map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['/', '/pricing', '/features', '/help-center', '/status', '/legal/terms', '/home', '/orders', '/products', '/settings', '/settings/billing']));
    expect(values).not.toContain('/products/new');
    for (const v of values) expect(v.split('/').filter(Boolean).length).toBeLessThanOrEqual(2);
    for (const v of values.filter((x) => x.split('/').filter(Boolean).length === 2)) expect(v).toMatch(/^\/(legal|settings)\//);
  });
  it('« factu » finds « Plan & facturation » (search on the name and the hint)', () => {
    const hit = options.filter((o) => `${o.label} ${o.hint}`.toLowerCase().includes('factu'));
    expect(hit.map((o) => o.value)).toContain('/settings/billing');
  });
});
