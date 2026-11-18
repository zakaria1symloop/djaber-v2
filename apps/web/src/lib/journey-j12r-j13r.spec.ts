// Journeys 18/11 J12r / J13r: the `?change=` deep link follows the plan card (J12r-1), the « modification demandée » state of
// a product (J13r-2), the AI route models (J13-7 / J13r-6), the default Open Graph picture of the public pages (J12r-2).
import { describe, expect, it } from 'vitest';
import { modelFits, routeModelId } from '@/features/admin/ai/dialogs';
import { deepLinkAction, planCta, type PlanLike, type SubscriptionLike } from '@/features/billing/logic';
import { moderationView } from '@/features/catalog/product-page/logic';
import { aiExclusion, moderationPillStatus } from '@/features/catalog/ui';
import { pageMetadata } from './seo';

const NOW = Date.parse('2026-11-18T10:00:00Z');
const day = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
const free: PlanLike = { id: 'p-free', slug: 'free', priceMonthly: 0, priceYearly: 0 };
const starter: PlanLike = { id: 'p-starter', slug: 'starter', priceMonthly: 1900, priceYearly: 19000 };
const pro: PlanLike = { id: 'p-pro', slug: 'pro', priceMonthly: 4900, priceYearly: 49000 };
const sub = (o: Partial<SubscriptionLike> = {}): SubscriptionLike => ({ plan: starter, status: 'active', billingCycle: 'monthly', currentPeriodEnd: day(20), cancelAtPeriodEnd: false, dunningStage: null, trialEndsAt: null, ...o });

describe('J12r-1: ?change=<slug> does what the card does', () => {
  it('the free plan during a trial opens nothing (greyed card, its reason is said)', () => {
    const trial = sub({ plan: pro, status: 'trial', billingCycle: 'none', trialEndsAt: day(14) });
    expect(deepLinkAction(planCta(free, trial, 'monthly', NOW))).toBe('refuse');
    expect(deepLinkAction(planCta(starter, trial, 'monthly', NOW))).toBe('dialog');
  });
  it('the free plan of a paid plan opens the cancel dialog; a renewal not open yet opens nothing', () => {
    expect(deepLinkAction(planCta(free, sub(), 'monthly', NOW))).toBe('cancel');
    expect(deepLinkAction(planCta(starter, sub({ currentPeriodEnd: day(20) }), 'monthly', NOW))).toBe('refuse');
    expect(deepLinkAction(planCta(pro, sub(), 'monthly', NOW))).toBe('dialog');
  });
});

describe('J13r-2: a review that asked for changes', () => {
  const detail = { status: 'pending', changesRequested: true, submittedAt: day(-1), decidedAt: day(0), decision: null, merchantMessage: 'Ajoutez une photo.', rejectedFields: ['images'], rules: [], history: [], appeal: { status: 'available' as const, deadlineAt: null, decision: null } };
  it('is its own state with the moderator message, not « en attente de validation »', () => {
    const v = moderationView({ moderation: { status: 'pending', changesRequested: true }, moderationDetail: detail });
    expect(v.kind).toBe('changes_requested');
    expect(v.message).toBe('Ajoutez une photo.');
    expect(moderationView({ moderation: { status: 'pending' }, moderationDetail: { ...detail, changesRequested: false } }).kind).toBe('pending');
  });
  it('the pills and the AI reason say it too', () => {
    expect(moderationPillStatus({ status: 'pending', changesRequested: true })).toBe('changes_requested');
    expect(moderationPillStatus({ status: 'pending' })).toBe('pending');
    expect(moderationPillStatus({ status: 'rejected', changesRequested: true })).toBe('rejected');
    expect(aiExclusion({ aiState: 'excluded', isActive: true, moderation: { status: 'pending', changesRequested: true } })).toBe('changes_requested');
  });
});

describe('J13-7 / J13r-6: AI route models', () => {
  const models = [
    { id: 'm1', modelId: 'claude-haiku-5-5', capabilities: ['text'] },
    { id: 'm2', modelId: 'whisper-large-v3-turbo', capabilities: ['text', 'transcription'] },
  ];
  it('a Whisper model is offered to the voice route only, whatever its row says', () => {
    expect(modelFits(models[1]!, 'text')).toBe(false);
    expect(modelFits(models[1]!, 'transcription')).toBe(true);
    expect(modelFits(models[0]!, 'text')).toBe(true);
  });
  it('the route model is found by its row id or by the provider model name (« Forcer la bascule » did nothing)', () => {
    expect(routeModelId(models, 'm1')).toBe('m1');
    expect(routeModelId(models, 'claude-haiku-5-5')).toBe('m1');
    expect(routeModelId(models, undefined)).toBeUndefined();
  });
});

describe('J12r-2: every public page carries the Open Graph picture', () => {
  it('og:image + summary_large_image on a page with its own metadata', () => {
    const m = pageMetadata({ locale: 'ar', path: '/pricing', title: 'Tarifs', description: 'd' });
    expect(m.openGraph?.images).toEqual([{ url: '/ar/opengraph-image', width: 1200, height: 630, alt: 'Djaber.ai' }]);
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', images: ['/ar/opengraph-image'] });
  });
});
