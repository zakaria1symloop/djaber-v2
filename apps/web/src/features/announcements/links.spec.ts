import { describe, expect, it } from 'vitest';
import { announcementLink } from './links';

describe('announcement link (« En savoir plus »)', () => {
  it('app paths and http(s) URLs only', () => {
    expect(announcementLink('/billing')).toEqual({ href: '/billing', external: false });
    expect(announcementLink(' https://djaber.ai/blog/grille ')).toEqual({ href: 'https://djaber.ai/blog/grille', external: true });
    for (const bad of [null, '', 'javascript:alert(1)', '//evil.example', '/a b', 'ftp://x', '/a\\b']) expect(announcementLink(bad)).toBeNull();
  });
});
