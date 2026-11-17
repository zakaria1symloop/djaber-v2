// full-test 15/11 ADMIN-01 retest (journeys 16/11 J13): state of an AI route from its models and their providers.
import { routeHealth } from './ai-route-health';

const m = (isActive = true, providerActive = true) => ({ isActive, provider: { isActive: providerActive, displayName: 'P' } });

describe('routeHealth', () => {
  it('ok when the primary answers and the fallback (if any) too', () => {
    expect(routeHealth({ failoverActive: false, primaryModel: m(), fallbackModel: m() })).toEqual({ state: 'ok', issue: null });
    expect(routeHealth({ failoverActive: false, primaryModel: m(), fallbackModel: null })).toEqual({ state: 'ok', issue: null });
  });
  it('forced bascule ⇒ failover', () => {
    expect(routeHealth({ failoverActive: true, primaryModel: m(), fallbackModel: m() }).state).toBe('failover');
  });
  it('primary model or provider off, fallback on ⇒ failover / primary_off', () => {
    expect(routeHealth({ failoverActive: false, primaryModel: m(true, false), fallbackModel: m() })).toEqual({ state: 'failover', issue: 'primary_off' });
    expect(routeHealth({ failoverActive: false, primaryModel: m(), fallbackModel: m() }, true)).toEqual({ state: 'failover', issue: 'primary_off' });
  });
  it('nothing answers ⇒ degraded / no_model (voice route with Groq and OpenAI off)', () => {
    expect(routeHealth({ failoverActive: false, primaryModel: m(true, false), fallbackModel: m(true, false) })).toEqual({ state: 'degraded', issue: 'no_model' });
    expect(routeHealth({ failoverActive: false, primaryModel: m(false), fallbackModel: null })).toEqual({ state: 'degraded', issue: 'no_model' });
  });
  it('primary fine but its fallback off ⇒ degraded / no_fallback (the text route read « OK »)', () => {
    expect(routeHealth({ failoverActive: false, primaryModel: m(), fallbackModel: m(true, false) })).toEqual({ state: 'degraded', issue: 'no_fallback' });
  });
});
