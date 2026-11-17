// Health of one AI route for the admin (12 §26 AI providers « ÉTAT », ADM-01 alerts) — full-test 15/11 ADMIN-01, retested
// 16/11 (J13): a model answers only when it AND its provider are switched on (the runtime router skips the others,
// routing.service.ts ⇒ AGENT_MODEL_UNAVAILABLE when nothing is left).
type M = { isActive: boolean; provider: { isActive: boolean; displayName: string } } | null | undefined;

export type RouteIssue = 'no_model' | 'primary_off' | 'no_fallback' | null;

export const modelUsable = (m: M): boolean => !!m && m.isActive && m.provider.isActive;

/**
 * - forced bascule (`failoverActive`) ⇒ `failover`;
 * - primary unusable (off, or its breaker open) ⇒ `failover` when the fallback answers, else `degraded` / `no_model`;
 * - primary fine but the configured fallback is off ⇒ `degraded` / `no_fallback` (no safety net — the text route read « OK »).
 */
export function routeHealth(r: { failoverActive: boolean; primaryModel: M; fallbackModel: M }, breakerOpen = false): { state: 'ok' | 'failover' | 'degraded'; issue: RouteIssue } {
  const fb = modelUsable(r.fallbackModel);
  if (r.failoverActive) return { state: 'failover', issue: fb ? null : 'no_model' };
  if (!modelUsable(r.primaryModel) || breakerOpen) return fb ? { state: 'failover', issue: 'primary_off' } : { state: 'degraded', issue: 'no_model' };
  if (r.fallbackModel && !fb) return { state: 'degraded', issue: 'no_fallback' };
  return { state: 'ok', issue: null };
}
