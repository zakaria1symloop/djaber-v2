import { describe, expect, it } from 'vitest';
import type { Credits } from './contracts';
import { actionLabelKey, applyCreditsEvent, burnRate, creditsBanner, creditsLevel, creditsTone, isBookkeeping, levelOf, orderedRange, packLeft, packsShown, pricePerCredit, runningOnPacks, signedCredits, usedPct, warningDate } from './logic';

const credits = (o: Partial<Credits> & { used?: number; limit?: number } = {}): Credits => {
  const { used = 3_760, limit = 5_000, ...rest } = o;
  return {
    plan: { used, limit, remaining: Math.max(0, limit - used), periodStart: '2026-09-12T00:00:00.000Z', periodEnd: '2026-10-12T00:00:00.000Z' },
    packs: { remaining: 0 },
    total: Math.max(0, limit - used),
    reserved: 0,
    negative: false,
    exhausted: false,
    burnRatePerDay: 115,
    exhaustedEta: null,
    pricePerCreditDzd: 0.98,
    packPricePerCreditDzd: null,
    ...rest,
  };
};

describe('credits meter thresholds (AT-BIL-03 pill)', () => {
  it('is ok under 80 %, warning from 80 %, exhausted at 100 %', () => {
    expect(creditsLevel(0, 5_000)).toBe('ok');
    expect(creditsLevel(3_999, 5_000)).toBe('ok');
    expect(creditsLevel(4_000, 5_000)).toBe('warning');
    expect(creditsLevel(4_999, 5_000)).toBe('warning');
    expect(creditsLevel(5_000, 5_000)).toBe('exhausted');
    expect(creditsLevel(5_200, 5_000)).toBe('exhausted');
  });
  it('follows the server flag: a pack keeps the AI running after the plan credits', () => {
    expect(creditsLevel(5_000, 5_000, false)).toBe('warning');
    expect(creditsLevel(100, 5_000, true)).toBe('exhausted');
    expect(levelOf(credits({ used: 5_000, exhausted: true }))).toBe('exhausted');
  });
  it('never divides by a plan without credits', () => {
    expect(creditsLevel(0, 0)).toBe('ok');
    expect(usedPct(10, 0)).toBe(0);
    expect(usedPct(3_760, 5_000)).toBe(75);
    expect(usedPct(9_000, 5_000)).toBe(100);
  });
});

describe('shell banner', () => {
  it('picks one banner by severity', () => {
    expect(creditsBanner(null)).toBeNull();
    expect(creditsBanner(credits())).toBeNull();
    expect(creditsBanner(credits({ used: 4_100 }))).toBe('credits80');
    expect(creditsBanner(credits({ used: 5_000, exhausted: true }))).toBe('credits100');
    expect(creditsBanner(credits({ used: 5_000, exhausted: true, negative: true }))).toBe('negativeCredits');
  });
  it('dates the warning with the projection, else the period end', () => {
    expect(warningDate(credits({ exhaustedEta: '2026-10-09T00:00:00.000Z' }))).toBe('2026-10-09T00:00:00.000Z');
    expect(warningDate(credits())).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe('credits.updated event', () => {
  it('patches the cached balance', () => {
    const next = applyCreditsEvent(credits(), { planUsed: 3_765, planLimit: 5_000, packBalance: 500, exhausted: false });
    expect(next.plan).toMatchObject({ used: 3_765, limit: 5_000, remaining: 1_235 });
    expect(next.packs.remaining).toBe(500);
    expect(next.total).toBe(1_735);
    expect(next.exhausted).toBe(false);
  });
  it('keeps what the event does not carry and flags a negative pack balance', () => {
    const base = credits({ packs: { remaining: 200 } });
    expect(applyCreditsEvent(base, { planUsed: 5_000, exhausted: true })).toMatchObject({ exhausted: true, packs: { remaining: 200 }, plan: { remaining: 0 } });
    expect(applyCreditsEvent(base, { packBalance: -40 }).negative).toBe(true);
    expect(applyCreditsEvent({ ...base, negative: true }, { packBalance: 0 }).negative).toBe(false);
  });
});

describe('ledger rows', () => {
  const fmt = (n: number) => String(n);
  it('signs the credits', () => {
    expect(signedCredits(-5, fmt)).toBe('−5');
    expect(signedCredits(500, fmt)).toBe('+500');
    expect(signedCredits(0, fmt)).toBe('0');
    expect(creditsTone(500)).toBe('success');
    expect(creditsTone(-1)).toBe('neutral');
  });
  it('recognises the bookkeeping rows and the action labels', () => {
    expect(isBookkeeping({ kind: 'reserved', action: 'reserve' })).toBe(true);
    expect(isBookkeeping({ kind: 'release', action: 'release' })).toBe(true);
    expect(isBookkeeping({ kind: 'debit', action: 'text_reply' })).toBe(false);
    expect(actionLabelKey('pack_purchase')).toBe('enum.CreditLedger.action.pack_purchase');
    expect(actionLabelKey('something_new')).toBeNull();
  });
  it('formats the price and the burn rate', () => {
    expect(pricePerCredit(0.98, 'fr')).toBe('0,98');
    expect(pricePerCredit(0.98, 'en')).toBe('0.98');
    expect(pricePerCredit(null, 'fr')).toBe('—');
    expect(burnRate(0)).toBe(0);
    expect(burnRate(0.2)).toBe(1);
    expect(burnRate(114.6)).toBe(115);
  });
  it('orders a reversed period', () => {
    expect(orderedRange('2026-10-06', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-06' });
    expect(orderedRange('2026-10-01', '')).toEqual({ from: '2026-10-01', to: '' });
  });
});

describe('packs tile (AT-PCK-03)', () => {
  it('shows the debt of a store refund, the pack balance otherwise', () => {
    expect(packsShown({ packs: { remaining: 0 }, total: -120, negative: true })).toBe(-120);
    expect(packsShown({ packs: { remaining: 500 }, total: 1200, negative: false })).toBe(500);
    expect(packsShown({ packs: { remaining: -40 }, total: -40, negative: true })).toBe(-40);
  });
});

describe('pack credits in the top-bar pill (recette 11/11, Badro / M-31)', () => {
  it('the bought pack credits left are shown after the plan figure, never negative', () => {
    expect(packLeft(credits({ packs: { remaining: 5_000 } }))).toBe(5_000);
    expect(packLeft(credits({ packs: { remaining: -40 }, negative: true }))).toBe(0);
    expect(packLeft(null)).toBe(0);
  });
  it('the month is used up but packs keep the AI running: banner « crédits de packs », not « 80 % »', () => {
    expect(runningOnPacks(credits({ used: 2_000, limit: 2_000, packs: { remaining: 5_000 }, exhausted: false }))).toBe(true);
    expect(runningOnPacks(credits({ used: 1_200, limit: 2_000, packs: { remaining: 5_000 } }))).toBe(false);
    expect(runningOnPacks(credits({ used: 2_000, limit: 2_000, packs: { remaining: 0 }, exhausted: true }))).toBe(false);
  });
});
