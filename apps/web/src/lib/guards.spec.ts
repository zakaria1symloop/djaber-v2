import { describe, expect, it } from 'vitest';
import { authHref, decideApp, decideAuth, decideOnboarding, isTunnelTransit, loginHref, needsOnboarding, ONBOARDING_SKIPPED, onboardingPath, onboardingWrite, safeReturnTo, stepNumber, stepSlug, type GuardInput } from './guards';

const base: GuardInput = {
  status: 'authenticated',
  pathname: '/home',
  membershipCount: 1,
  role: 'owner',
  workspace: { onboardingStep: 6, status: 'active' },
};

describe('onboarding steps (ONB-01)', () => {
  it('maps the stored step to its route', () => {
    expect(stepSlug(0)).toBe('welcome');
    expect(stepSlug(1)).toBe('welcome');
    expect(stepSlug(3)).toBe('first-product');
    expect(stepSlug(6)).toBe('ready');
    expect(stepSlug(99)).toBe('ready');
    expect(onboardingPath(5)).toBe('/onboarding/connect');
    expect(stepNumber('stock-mode')).toBe(2);
  });
  it('never moves the saved progress back when a reopened step is left', () => {
    expect(onboardingWrite(3, 3)).toBe(4);
    expect(onboardingWrite(0, 1)).toBe(2);
    // step 1 reopened from the stepper while the progress is at step 5: nothing is written
    expect(onboardingWrite(5, 1)).toBeNull();
    expect(onboardingWrite(5, 4)).toBeNull();
    expect(onboardingWrite(5, 5)).toBe(6);
    expect(onboardingWrite(6, 2)).toBeNull();
  });
  it('is shown to the owner until step 6 or skip (99)', () => {
    expect(needsOnboarding({ onboardingStep: 3 }, 'owner')).toBe(true);
    expect(needsOnboarding({ onboardingStep: 6 }, 'owner')).toBe(false);
    expect(needsOnboarding({ onboardingStep: ONBOARDING_SKIPPED }, 'owner')).toBe(false);
    expect(needsOnboarding({ onboardingStep: 1 }, 'operator')).toBe(false);
    expect(needsOnboarding({ onboardingStep: 1 }, 'admin')).toBe(false);
    expect(needsOnboarding(null, 'owner')).toBe(false);
  });
});

describe('returnTo', () => {
  it('accepts only same-origin paths', () => {
    expect(safeReturnTo('/orders/42?tab=history')).toBe('/orders/42?tab=history');
    expect(safeReturnTo('//evil.example')).toBe('/home');
    expect(safeReturnTo('https://evil.example')).toBe('/home');
    expect(safeReturnTo('/\\evil.example')).toBe('/home');
    expect(safeReturnTo(null)).toBe('/home');
    expect(safeReturnTo('/login?returnTo=/x')).toBe('/home');
  });
  it('builds the login link with the origin path', () => {
    expect(loginHref('/orders/42', '?tab=history')).toBe('/login?returnTo=%2Forders%2F42%3Ftab%3Dhistory');
    expect(loginHref('/home')).toBe('/login');
  });
});

describe('(app) guard', () => {
  it('waits while the session or the workspace loads', () => {
    expect(decideApp({ ...base, status: 'loading' })).toEqual({ kind: 'wait' });
    expect(decideApp({ ...base, workspace: null, workspaceLoading: true })).toEqual({ kind: 'wait' });
  });
  it('UX-047: an account in its deletion grace goes to « Compte désactivé » (/workspaces/new) first, shop or not', () => {
    expect(decideApp({ ...base, deletionScheduled: true })).toEqual({ kind: 'redirect', to: '/workspaces/new' });
    expect(decideApp({ ...base, deletionScheduled: true, workspace: null, workspaceLoading: true })).toEqual({ kind: 'redirect', to: '/workspaces/new' });
    expect(decideOnboarding({ ...base, deletionScheduled: true, slug: 'welcome' })).toEqual({ kind: 'redirect', to: '/workspaces/new' });
    expect(decideApp({ ...base, deletionScheduled: false })).toEqual(decideApp(base));
  });
  it('redirects visitors to /login with returnTo', () => {
    expect(decideApp({ ...base, status: 'anonymous', pathname: '/settings/members' })).toEqual({ kind: 'redirect', to: '/login?returnTo=%2Fsettings%2Fmembers' });
  });
  it('sends anonymous visitors of /help to the public help centre (12 §1b), not the ticket pages', () => {
    expect(decideApp({ ...base, status: 'anonymous', pathname: '/help' })).toEqual({ kind: 'redirect', to: '/help-center' });
    expect(decideApp({ ...base, status: 'anonymous', pathname: '/help', search: '?q=cr%C3%A9dits&category=stock&x=1' })).toEqual({ kind: 'redirect', to: '/help-center?q=cr%C3%A9dits&category=stock' });
    expect(decideApp({ ...base, status: 'anonymous', pathname: '/help', search: '?article=reconnect-ig' })).toEqual({ kind: 'redirect', to: '/help/reconnect-ig' });
    expect(decideApp({ ...base, status: 'anonymous', pathname: '/help/contact' })).toEqual({ kind: 'redirect', to: '/login?returnTo=%2Fhelp%2Fcontact' });
    expect(decideApp({ ...base, pathname: '/help' })).toEqual({ kind: 'render' });
  });
  it('shows the session-expired state instead of redirecting', () => {
    expect(decideApp({ ...base, status: 'expired' })).toEqual({ kind: 'state', state: 'session-expired' });
  });
  it('sends a user without workspace to /workspaces/new', () => {
    expect(decideApp({ ...base, membershipCount: 0, workspace: null, role: null })).toEqual({ kind: 'redirect', to: '/workspaces/new' });
  });
  it('resumes the tunnel at the saved step (AT-ONB-01)', () => {
    expect(decideApp({ ...base, workspace: { onboardingStep: 3, status: 'active' } })).toEqual({ kind: 'redirect', to: '/onboarding/first-product' });
    expect(decideApp({ ...base, workspace: { onboardingStep: 0, status: 'active' } })).toEqual({ kind: 'redirect', to: '/onboarding/welcome' });
  });
  it('lets the connect return page run during the tunnel (the page step needs it)', () => {
    expect(decideApp({ ...base, pathname: '/channels/connect/return', workspace: { onboardingStep: 5, status: 'active' } })).toEqual({ kind: 'render' });
    expect(decideApp({ ...base, pathname: '/channels', workspace: { onboardingStep: 5, status: 'active' } })).toEqual({ kind: 'redirect', to: '/onboarding/connect' });
  });
  it('lets the first three agent-wizard steps run at the agent step only ("Partir de zéro")', () => {
    const at = (step: number, pathname: string) => decideApp({ ...base, pathname, workspace: { onboardingStep: step, status: 'active' } });
    for (const p of ['/agents/new', '/agents/new/identity', '/agents/new/knowledge', '/agents/new/behaviour']) expect(at(4, p)).toEqual({ kind: 'render' });
    // channels and activation need a connected page (step 5): back to the tunnel
    expect(at(4, '/agents/new/channels')).toEqual({ kind: 'redirect', to: '/onboarding/agent' });
    expect(at(4, '/agents/new/activate')).toEqual({ kind: 'redirect', to: '/onboarding/agent' });
    expect(at(4, '/agents')).toEqual({ kind: 'redirect', to: '/onboarding/agent' });
    expect(at(4, '/agents/new-thing')).toEqual({ kind: 'redirect', to: '/onboarding/agent' });
    // at another step the wizard is not part of the tunnel
    expect(at(3, '/agents/new')).toEqual({ kind: 'redirect', to: '/onboarding/first-product' });
    expect(at(5, '/agents/new/knowledge')).toEqual({ kind: 'redirect', to: '/onboarding/connect' });
    expect(isTunnelTransit('/channels/connect/return', 2)).toBe(true);
  });
  it('lets skipped or finished tunnels and non-owners through', () => {
    expect(decideApp({ ...base, workspace: { onboardingStep: 99, status: 'active' } })).toEqual({ kind: 'render' });
    expect(decideApp({ ...base, role: 'operator', workspace: { onboardingStep: 2, status: 'active' } })).toEqual({ kind: 'render' });
  });
  it('blocks a suspended workspace except Settings and Help', () => {
    const ws = { onboardingStep: 6, status: 'suspended' as const };
    expect(decideApp({ ...base, workspace: ws })).toEqual({ kind: 'state', state: 'suspended' });
    expect(decideApp({ ...base, workspace: ws, pathname: '/settings/profile' })).toEqual({ kind: 'render' });
    expect(decideApp({ ...base, workspace: ws, pathname: '/help/contact' })).toEqual({ kind: 'render' });
  });
});

describe('(onboarding) guard', () => {
  const at = (step: number, slug: string, role: GuardInput['role'] = 'owner') =>
    decideOnboarding({ ...base, role, pathname: `/onboarding/${slug}`, slug, workspace: { onboardingStep: step, status: 'active' } });
  it('renders the current step and the previous ones', () => {
    expect(at(3, 'first-product')).toEqual({ kind: 'render' });
    expect(at(3, 'welcome')).toEqual({ kind: 'render' });
    expect(at(0, 'welcome')).toEqual({ kind: 'render' });
  });
  it('does not open a step ahead of the progress', () => {
    expect(at(2, 'connect')).toEqual({ kind: 'redirect', to: '/onboarding/stock-mode' });
  });
  it('keeps Ready visible once finished and sends skipped tunnels home', () => {
    expect(at(6, 'ready')).toEqual({ kind: 'render' });
    expect(at(99, 'welcome')).toEqual({ kind: 'redirect', to: '/home' });
  });
  it('is for the owner only and rejects unknown slugs', () => {
    expect(at(2, 'welcome', 'operator')).toEqual({ kind: 'redirect', to: '/home' });
    expect(at(4, 'nope')).toEqual({ kind: 'redirect', to: '/onboarding/agent' });
  });
});

describe('(auth) guard', () => {
  it('sends a logged-in user to returnTo or Home', () => {
    expect(decideAuth({ status: 'authenticated', pathname: '/login', returnTo: '/orders', ownedWorkspaceId: 'w' })).toEqual({ kind: 'redirect', to: '/orders' });
    expect(decideAuth({ status: 'authenticated', pathname: '/signup', returnTo: 'https://x', ownedWorkspaceId: 'w' })).toEqual({ kind: 'redirect', to: '/home' });
  });
  it('renders the pages for visitors, and the token pages for everyone', () => {
    expect(decideAuth({ status: 'anonymous', pathname: '/login', ownedWorkspaceId: null })).toEqual({ kind: 'render' });
    expect(decideAuth({ status: 'expired', pathname: '/login', ownedWorkspaceId: null })).toEqual({ kind: 'render' });
    expect(decideAuth({ status: 'authenticated', pathname: '/verify-email', ownedWorkspaceId: 'w' })).toEqual({ kind: 'render' });
    expect(decideAuth({ status: 'authenticated', pathname: '/invitations/abc', ownedWorkspaceId: 'w' })).toEqual({ kind: 'render' });
    expect(decideAuth({ status: 'loading', pathname: '/reset-password', ownedWorkspaceId: null })).toEqual({ kind: 'render' });
  });
  it('requires a session for /workspaces/new', () => {
    expect(decideAuth({ status: 'anonymous', pathname: '/workspaces/new', ownedWorkspaceId: null })).toEqual({ kind: 'redirect', to: '/login?returnTo=%2Fworkspaces%2Fnew' });
    expect(decideAuth({ status: 'authenticated', pathname: '/workspaces/new', ownedWorkspaceId: null })).toEqual({ kind: 'render' });
  });
});

describe('links between the auth pages', () => {
  it('"Créer un compte" keeps returnTo (invitation), "Mot de passe oublié" the typed e-mail; unsafe or empty values are dropped', () => {
    expect(authHref('/signup', { returnTo: '/invitations/abc' })).toBe('/signup?returnTo=%2Finvitations%2Fabc');
    expect(authHref('/signup', { returnTo: null })).toBe('/signup');
    expect(authHref('/signup', { returnTo: '//evil.example' })).toBe('/signup');
    expect(authHref('/login', { returnTo: '/signup' })).toBe('/login');
    expect(authHref('/forgot-password', { email: ' amina@shop.dz ' })).toBe('/forgot-password?email=amina%40shop.dz');
    expect(authHref('/forgot-password', { email: '' })).toBe('/forgot-password');
  });
});
