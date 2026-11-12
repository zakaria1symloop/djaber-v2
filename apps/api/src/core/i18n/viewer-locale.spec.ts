import { NO_LIMITS, TenantContext, type TenantInfo } from '@djaber/db';
import { requestedLocale, resolveLocale } from './i18n.service';
import { viewerLocale } from './viewer-locale';

const ctx = (o: Partial<TenantInfo>): TenantInfo => ({ workspaceId: 'w', readOnly: false, locale: 'en', stockMode: 'simple', suspended: false, limits: NO_LIMITS, ...o });

describe('viewerLocale — screens follow the viewer, not the shop (weak-points audit 12/11)', () => {
  it('prefers the page language over the account and the workspace', () => {
    expect(TenantContext.run(ctx({ locale: 'en', userLocale: 'fr', requestLocale: 'ar' }), viewerLocale)).toBe('ar');
  });

  it('falls back to the account language, then the workspace, then French', () => {
    expect(TenantContext.run(ctx({ locale: 'en', userLocale: 'ar' }), viewerLocale)).toBe('ar');
    expect(TenantContext.run(ctx({ locale: 'en' }), viewerLocale)).toBe('en');
    expect(viewerLocale()).toBe('fr');
  });

  it('keeps the viewer language inside runSystem / runAs scopes', () => {
    const shopEn = ctx({ locale: 'en', requestLocale: 'ar' });
    expect(TenantContext.run(shopEn, () => TenantContext.runSystem(viewerLocale))).toBe('ar');
    expect(TenantContext.run(shopEn, () => TenantContext.runAs('w2', viewerLocale, { locale: 'en' }))).toBe('ar');
    const accountOnly = ctx({ locale: 'en', userLocale: 'ar' });
    expect(TenantContext.run(accountOnly, () => TenantContext.runSystem(viewerLocale))).toBe('ar');
    expect(TenantContext.run(accountOnly, () => TenantContext.runAs('w2', viewerLocale, { locale: 'en' }))).toBe('ar');
  });

  it('a worker scope without a viewer uses the workspace language', () => {
    expect(TenantContext.runAs('w', viewerLocale, { locale: 'en' })).toBe('en');
  });
});

describe('requestedLocale — only a supported language the client names counts as the page language', () => {
  it('reads ?lang first, then Accept-Language', () => {
    expect(requestedLocale('en-US,en;q=0.9', 'ar')).toBe('ar');
    expect(requestedLocale('de-DE,ar;q=0.8', undefined)).toBe('ar');
  });
  it('is undefined when nothing supported is named (the account / workspace language applies)', () => {
    expect(requestedLocale(undefined, undefined)).toBeUndefined();
    expect(requestedLocale('de-DE', 'xx')).toBeUndefined();
    expect(resolveLocale(undefined, undefined)).toBe('fr');
  });
});
