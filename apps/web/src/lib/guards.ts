// Route-guard decisions (02-next-route-map §1, §3.3 resume rule). Pure functions: the layouts apply the result.
import type { MemberRole } from '@djaber/shared';

export const ONBOARDING_STEPS = ['welcome', 'stock-mode', 'first-product', 'agent', 'connect', 'ready'] as const;
export type OnboardingSlug = (typeof ONBOARDING_STEPS)[number];
export const ONBOARDING_DONE = 6;
/** value written by "Passer la configuration" */
export const ONBOARDING_SKIPPED = 99;

export const isOnboardingSlug = (s: string): s is OnboardingSlug => (ONBOARDING_STEPS as readonly string[]).includes(s);
/** 1-based number of a step slug. */
export const stepNumber = (slug: OnboardingSlug) => ONBOARDING_STEPS.indexOf(slug) + 1;
/** Slug of a stored `Workspace.onboardingStep` (0 and 1 both mean "welcome"). */
export const stepSlug = (step: number): OnboardingSlug => ONBOARDING_STEPS[Math.min(ONBOARDING_STEPS.length, Math.max(1, Math.trunc(step))) - 1]!;
export const onboardingPath = (step: number) => `/onboarding/${stepSlug(step)}`;
/**
 * Value to write when the merchant leaves step `leaving` (Continue, "Plus tard"): the next step, but never less than
 * the saved progress — a step reopened from the stepper must not move the resume point back. `null` = nothing to write.
 */
export const onboardingWrite = (saved: number, leaving: number): number | null => (leaving + 1 > saved ? leaving + 1 : null);

/** The tunnel is shown to the Owner only: it writes workspace settings (`PATCH /workspace/onboarding`). */
export const needsOnboarding = (w: { onboardingStep: number } | null | undefined, role: MemberRole | null | undefined) =>
  !!w && role === 'owner' && w.onboardingStep < ONBOARDING_DONE;

/** Only same-origin absolute paths are accepted as `returnTo` (no protocol-relative or external URL). */
export const safeReturnTo = (raw: string | null | undefined, fallback = '/home'): string => {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /^\/(login|signup)(\/|\?|$)/.test(raw)) return fallback;
  return raw;
};

/**
 * Link between the auth pages keeping what the visitor already gave: `returnTo` (invitation, deep link) on "Créer un
 * compte" / "Se connecter", the typed e-mail on "Mot de passe oublié" (`/forgot-password?email=`). Empty values are dropped.
 */
export const authHref = (path: string, params: Record<string, string | null | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const value = k === 'returnTo' ? safeReturnTo(v?.trim(), '') : (v ?? '').trim();
    if (value) p.set(k, value);
  }
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
};

export const loginHref = (pathname: string, search = '') => {
  const target = `${pathname}${search}`;
  return target === '/' || target === '/home' ? '/login' : `/login?returnTo=${encodeURIComponent(target)}`;
};

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated' | 'expired' | 'error';
export type GuardInput = {
  status: SessionStatus;
  pathname: string;
  search?: string;
  membershipCount: number;
  role: MemberRole | null;
  workspace: { onboardingStep: number; status: 'active' | 'suspended' | 'deletion_scheduled' } | null;
  workspaceLoading?: boolean;
  /** UX-047: the account is in its 30-day deletion grace — « Compte désactivé » (cancel / export) comes first */
  deletionScheduled?: boolean;
};
export type GuardDecision =
  | { kind: 'render' }
  | { kind: 'wait' }
  | { kind: 'redirect'; to: string }
  | { kind: 'state'; state: 'session-expired' | 'suspended' | 'error' };

/**
 * 12 §1b: "the public help page stays reachable at `/help` without login" — the in-app help hub owns `/help` inside
 * (app), so an anonymous visitor of `/help` (search / category / `?article=` guide) is sent to the public help centre.
 */
export const publicHelpHref = (pathname: string, search = ''): string | null => {
  if (pathname !== '/help') return null;
  const p = new URLSearchParams(search.replace(/^\?/, ''));
  const article = p.get('article');
  if (article) return `/help/${encodeURIComponent(article)}`;
  const out = new URLSearchParams();
  for (const k of ['q', 'category']) {
    const v = p.get(k);
    if (v) out.set(k, v);
  }
  const qs = out.toString();
  return qs ? `/help-center?${qs}` : '/help-center';
};

/** `(app)` layout: session required, then workspace, then the onboarding resume rule. */
export const decideApp = (i: GuardInput): GuardDecision => {
  if (i.status === 'loading') return { kind: 'wait' };
  if (i.status === 'expired') return { kind: 'state', state: 'session-expired' };
  if (i.status === 'error') return { kind: 'state', state: 'error' };
  if (i.status === 'anonymous') return { kind: 'redirect', to: publicHelpHref(i.pathname, i.search) ?? loginHref(i.pathname, i.search) };
  // 04 §16 / AT-DEL-02: logging in during the grace shows « Compte désactivé » (on /workspaces/new, which needs no shop)
  if (i.deletionScheduled || i.membershipCount === 0) return { kind: 'redirect', to: '/workspaces/new' };
  if (i.workspaceLoading || !i.workspace) return { kind: 'wait' };
  // a suspended workspace keeps Settings and Help reachable (api-contract §1.3: /workspace, /me*, /support/*)
  if (i.workspace.status === 'suspended' && !/^\/(settings|help)(\/|$)/.test(i.pathname)) return { kind: 'state', state: 'suspended' };
  if (needsOnboarding(i.workspace, i.role) && !isTunnelTransit(i.pathname, i.workspace.onboardingStep)) return { kind: 'redirect', to: onboardingPath(i.workspace.onboardingStep) };
  return { kind: 'render' };
};
export const CONNECT_RETURN_PATH = '/channels/connect/return';
/** Agent wizard steps that run inside the tunnel ("Partir de zéro", step 4); channels and activation come after step 5. */
export const TUNNEL_WIZARD_STEPS = ['identity', 'knowledge', 'behaviour'] as const;
const TUNNEL_WIZARD = new RegExp(`^/agents/new(/(${TUNNEL_WIZARD_STEPS.join('|')}))?/?$`);
/**
 * (app) pages that run during the tunnel: the connect flow's return leg (step 5 connects a page) and, at step 4, the
 * first three steps of the agent wizard (the from-scratch agent; it comes back to the tunnel when done).
 */
export const isTunnelTransit = (pathname: string, step: number): boolean =>
  pathname === CONNECT_RETURN_PATH || (stepSlug(step) === 'agent' && TUNNEL_WIZARD.test(pathname));

/** `(onboarding)` layout: session + owner; a finished or skipped tunnel goes home. */
export const decideOnboarding = (i: GuardInput & { slug: string }): GuardDecision => {
  if (i.status === 'loading') return { kind: 'wait' };
  if (i.status === 'expired') return { kind: 'state', state: 'session-expired' };
  if (i.status === 'error') return { kind: 'state', state: 'error' };
  if (i.status === 'anonymous') return { kind: 'redirect', to: loginHref(i.pathname, i.search) };
  if (i.deletionScheduled || i.membershipCount === 0) return { kind: 'redirect', to: '/workspaces/new' };
  if (i.workspaceLoading || !i.workspace) return { kind: 'wait' };
  if (!isOnboardingSlug(i.slug)) return { kind: 'redirect', to: onboardingPath(i.workspace.onboardingStep) };
  if (i.role !== 'owner' || i.workspace.onboardingStep === ONBOARDING_SKIPPED) return { kind: 'redirect', to: '/home' };
  // the Ready step stays visible after completion (onboardingStep = 6); later steps cannot be opened ahead of progress
  if (i.workspace.onboardingStep < ONBOARDING_DONE && stepNumber(i.slug) > Math.max(1, i.workspace.onboardingStep))
    return { kind: 'redirect', to: onboardingPath(i.workspace.onboardingStep) };
  if (i.workspace.onboardingStep > ONBOARDING_DONE) return { kind: 'redirect', to: '/home' };
  return { kind: 'render' };
};

/**
 * `(admin)` layout (02 §1, §2.3): a session and a platform role are required; no workspace is needed (a platform
 * member may own none). A member without a platform role gets the 403 page.
 */
export const decideAdmin = (i: { status: SessionStatus; pathname: string; search?: string; platformRole: string | null | undefined }): GuardDecision | { kind: 'state'; state: 'forbidden' } => {
  if (i.status === 'loading') return { kind: 'wait' };
  if (i.status === 'expired') return { kind: 'state', state: 'session-expired' };
  if (i.status === 'error') return { kind: 'state', state: 'error' };
  if (i.status === 'anonymous') return { kind: 'redirect', to: loginHref(i.pathname, i.search) };
  if (!i.platformRole || i.platformRole === 'none') return { kind: 'state', state: 'forbidden' };
  return { kind: 'render' };
};

/** `(auth)` layout: pages for anonymous visitors redirect away once logged in. */
const ANY_SESSION = /^\/(verify-email|invitations\/[^/]+|reset-password)(\/|$)/;
export const decideAuth = (i: { status: SessionStatus; pathname: string; returnTo?: string | null; ownedWorkspaceId: string | null }): GuardDecision => {
  if (i.pathname === '/workspaces/new') {
    if (i.status === 'loading') return { kind: 'wait' };
    if (i.status !== 'authenticated') return { kind: 'redirect', to: loginHref(i.pathname) };
    return { kind: 'render' };
  }
  if (ANY_SESSION.test(i.pathname)) return { kind: 'render' };
  if (i.status === 'loading') return { kind: 'wait' };
  if (i.status === 'authenticated') return { kind: 'redirect', to: safeReturnTo(i.returnTo) };
  return { kind: 'render' };
};
