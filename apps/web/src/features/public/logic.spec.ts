import { describe, expect, it } from 'vitest';
import { describe as metaDescription, languageAlternates, pageMetadata } from '@/lib/seo';
import {
  planIntentHref,
  planIntentOf,
  supportMailto,
  bestYearlyDiscount,
  canStartExport,
  cardPrice,
  cheapestPack,
  deletionView,
  diffHasChanges,
  exportPollMs,
  helpHref,
  isBlockingCode,
  isCmsKey,
  isDeletionToken,
  markdownSections,
  paragraphDiff,
  parseCycleParam,
  parseHelpQuery,
  planLines,
  searchable,
  signupHref,
  type PublicPlan,
} from './logic';

const plan = (o: Partial<PublicPlan> & { features?: string[] } = {}): PublicPlan => ({
  id: 'p',
  slug: 'starter',
  name: 'Starter',
  description: null,
  priceMonthly: 1900,
  priceYearly: 19000,
  yearlyDiscountPct: 17,
  trialDays: 14,
  isFeatured: false,
  ...o,
  limits: { maxPages: 2, maxAgents: 2, maxProducts: 500, maxConversationsPerMonth: 2000, maxMembers: 3, monthlyCredits: 1500, features: o.features ?? [], ...(o.limits ?? {}) },
});
const t = (k: string, p?: Record<string, unknown>) => (p ? `${k}(${String(p.value ?? '')})` : k);
const n = (v: number) => String(v);

describe('markdownSections', () => {
  it('splits a CMS body on "## " headings and keeps the intro', () => {
    const r = markdownSections('Intro line\n\n## Un\n\nTexte 1\n\n## Deux\nTexte 2\n- a\n');
    expect(r.intro).toBe('Intro line');
    expect(r.sections).toEqual([
      { title: 'Un', body: 'Texte 1' },
      { title: 'Deux', body: 'Texte 2\n- a' },
    ]);
  });
  it('no heading ⇒ everything is the intro', () => {
    expect(markdownSections('Juste un texte.')).toEqual({ intro: 'Juste un texte.', sections: [] });
    expect(markdownSections(null)).toEqual({ intro: '', sections: [] });
  });
});

describe('paragraphDiff', () => {
  it('marks removed, added and kept paragraphs (v3 → v4)', () => {
    const d = paragraphDiff('## 1. Objet\n\nAncien texte.\n\nCommun.', '## 1. Objet\n\nNouveau texte.\n\nCommun.\n\nAjout.');
    expect(d).toEqual([
      { kind: 'same', text: '## 1. Objet' },
      { kind: 'del', text: 'Ancien texte.' },
      { kind: 'add', text: 'Nouveau texte.' },
      { kind: 'same', text: 'Commun.' },
      { kind: 'add', text: 'Ajout.' },
    ]);
    expect(diffHasChanges(d)).toBe(true);
  });
  it('identical bodies ⇒ no change; v1 ⇒ every paragraph added', () => {
    expect(diffHasChanges(paragraphDiff('a\n\nb', 'a\n\nb'))).toBe(false);
    expect(paragraphDiff(null, 'a\n\nb').map((l) => l.kind)).toEqual(['add', 'add']);
  });
});

describe('pricing', () => {
  it('yearly toggle label = best yearly saving of the paid plans', () => {
    expect(bestYearlyDiscount([plan({ priceMonthly: 0, priceYearly: 0, yearlyDiscountPct: 0 }), plan(), plan({ yearlyDiscountPct: undefined, priceMonthly: 4900, priceYearly: 49000 })])).toBe(17);
    expect(bestYearlyDiscount([plan({ priceMonthly: 0, priceYearly: 0, yearlyDiscountPct: 0 })])).toBe(0);
  });
  it('card price: monthly, or the monthly equivalent of the yearly price; free stays 0', () => {
    expect(cardPrice(plan(), 'monthly')).toBe(1900);
    expect(cardPrice(plan(), 'yearly')).toBe(1583);
    expect(cardPrice(plan({ priceMonthly: 0, priceYearly: 0 }), 'yearly')).toBe(0);
  });
  it('card lines follow the Figma order and only list the features of the plan', () => {
    expect(planLines(plan({ features: ['voice_notes', 'image_recognition', 'couriers', 'google_sheets'] }), t, n)).toEqual([
      'billing.plan.feature.credits(1500)',
      'billing.plan.feature.pages(2) · billing.plan.feature.agents(2) · billing.plan.feature.members(3)',
      'billing.plan.feature.products(500)',
      'public.pricing.feature.channels.messenger',
      'public.pricing.feature.voice_notes · public.pricing.feature.image_recognition',
      'public.pricing.feature.google_sheets · public.pricing.feature.couriers',
    ]);
    const pro = planLines(plan({ features: ['instagram', 'api_keys', 'webhooks'], limits: { maxProducts: -1 } as PublicPlan['limits'] }), t, n);
    expect(pro[2]).toBe('billing.plan.feature.products.unlimited');
    expect(pro[3]).toBe('public.pricing.feature.channels.both');
    expect(pro[4]).toBe('public.pricing.feature.api_keys · public.pricing.feature.webhooks');
  });
  it('cheapest pack, signup link, cycle param', () => {
    expect(cheapestPack([{ id: 'a', priceWebDzd: 1500, credits: 2000 }, { id: 'b', priceWebDzd: 450, credits: 500 }])).toBe(450);
    expect(cheapestPack([])).toBeNull();
    expect(signupHref({ slug: 'pro' }, 'yearly')).toBe('/signup?plan=pro&cycle=yearly');
    expect(parseCycleParam('yearly')).toBe('yearly');
    expect(parseCycleParam(['x'])).toBe('monthly');
  });
});

describe('help centre query', () => {
  it('reads q and a known category from the URL', () => {
    expect(parseHelpQuery({ q: '  crédits ', category: 'stock' })).toEqual({ q: 'crédits', category: 'stock' });
    expect(parseHelpQuery({ category: 'nope' })).toEqual({ q: '', category: null });
    expect(searchable('a')).toBe(false);
    expect(searchable('ab')).toBe(true);
    expect(helpHref({ q: 'x y', category: 'stock' })).toBe('/help-center?q=x+y&category=stock');
    expect(helpHref({})).toBe('/help-center');
  });
});

describe('account deletion & keys', () => {
  it('maps the request status to the page view', () => {
    expect(deletionView('pending_confirmation')).toBe('confirm');
    expect(deletionView('grace')).toBe('grace');
    expect(deletionView('blocked')).toBe('blocked');
    expect(deletionView('cancelled')).toBe('cancelled');
    expect(deletionView('anonymised')).toBe('done');
    expect(isBlockingCode('ACCOUNT_OWNS_WORKSPACE')).toBe(true);
    expect(isBlockingCode('NOT_FOUND')).toBe(false);
    expect(isDeletionToken('abc')).toBe(false);
    expect(isDeletionToken('a'.repeat(43))).toBe(true);
    expect(exportPollMs('running')).toBe(3000);
    expect(exportPollMs('done')).toBe(false);
    // UX-047: the export can be (re)started while none is running or ready
    expect(canStartExport(null)).toBe(true);
    expect(canStartExport({ status: 'failed', url: null })).toBe(true);
    expect(canStartExport({ status: 'done', url: null })).toBe(true);
    expect(canStartExport({ status: 'running', url: null })).toBe(false);
    expect(canStartExport({ status: 'done', url: 'https://x/e.zip' })).toBe(false);
  });
  it('accepts CMS slugs only', () => {
    expect(isCmsKey('terms')).toBe(true);
    expect(isCmsKey('data-deletion')).toBe(true);
    expect(isCmsKey('content_rules')).toBe(true);
    expect(isCmsKey('guide.v2')).toBe(true);
    expect(isCmsKey('../etc')).toBe(false);
    expect(isCmsKey('a'.repeat(81))).toBe(false);
    expect(isCmsKey('Terms')).toBe(false);
  });
});

describe('seo', () => {
  it('hreflang alternates for the three locales + x-default', () => {
    expect(languageAlternates('/pricing')).toEqual({ fr: '/fr/pricing', ar: '/ar/pricing', en: '/en/pricing', 'x-default': '/fr/pricing' });
    const m = pageMetadata({ locale: 'ar', path: '', title: 'Djaber.ai', description: 'd' });
    expect(m.title).toBe('Djaber.ai');
    expect(m.alternates?.canonical).toBe('/ar');
    expect(pageMetadata({ locale: 'fr', path: '/x', title: 'Tarifs', description: '', noindex: true }).robots).toEqual({ index: false, follow: false });
  });
  it('meta description strips Markdown and cuts at a word', () => {
    expect(metaDescription('## Titre\n\nUn **texte** simple.')).toBe('Un texte simple.');
    const long = metaDescription('mot '.repeat(80), 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('pricing CTA → sign-up → plan offered later (D60) · public contact', () => {
  it('keeps a paid plan choice with its cycle, drops free / invalid slugs', () => {
    expect(planIntentOf('starter', 'yearly')).toEqual({ plan: 'starter', cycle: 'yearly' });
    expect(planIntentOf(' Pro ', 'weekly')).toEqual({ plan: 'pro', cycle: 'monthly' });
    expect(planIntentOf('free', 'monthly')).toBeNull();
    expect(planIntentOf('', 'monthly')).toBeNull();
    expect(planIntentOf('../admin', 'monthly')).toBeNull();
    expect(planIntentHref({ plan: 'starter', cycle: 'yearly' })).toBe('/settings/billing?change=starter&cycle=yearly');
  });
  it('visitors reach support by e-mail (the /help/contact form needs a session)', () => {
    expect(supportMailto(undefined, 'support@djaber.ai')).toBe('mailto:support@djaber.ai');
    expect(supportMailto('Suppression de compte', 'support@djaber.ai')).toBe('mailto:support@djaber.ai?subject=Suppression%20de%20compte');
    expect(supportMailto()).toMatch(/^mailto:[^@\s]+@[^@\s]+$/);
  });
});
