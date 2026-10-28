// M1 — AUTH-01…09: register, login, refresh rotation + reuse detection, logout, sessions, forgot / reset,
// e-mail verification, TOTP 2FA, profile, password / e-mail change, account deletion request, scheduled jobs.
import sharp from 'sharp';
import { TokenService } from '../../src/core/auth/token.service';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import { AccountDeletionService } from '../../src/modules/auth/account-deletion.service';
import { AuthScheduler } from '../../src/modules/auth/auth.scheduler';
import { TwoFactorService } from '../../src/modules/auth/two-factor.service';
import { anonymous, asAdmin, asLoneUser, asOwner, asPlatform, createUser } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { api, clearRate, cookieHeader, db, eventually, login, mailsTo, PASSWORD, refreshCookie, register, setPassword, tokenOf, uniqEmail, withToken } from '../support/m1';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const DAY = 86_400_000;

describe('AUTH-01 register', () => {
  it('AT-AUTH-01 sign up creates user, owned workspace, 14-day Pro trial, 300 credits, defaults and a verification mail', async () => {
    const u = await register(app, { locale: 'ar' });
    const body = u.res.body.data;
    expect(body.expiresIn).toBe(900);
    expect(body.refreshToken).toBeUndefined(); // web: cookie only
    expect(cookieHeader(u.res)).toMatch(/HttpOnly/i);
    expect(cookieHeader(u.res)).toMatch(/SameSite=Lax/i);
    expect(cookieHeader(u.res)).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookieHeader(u.res)).not.toMatch(/Secure/i); // Secure only in production
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|totpSecret|recoveryCodes|tokenHash/);

    const user = await db.user.findUniqueOrThrow({ where: { email: u.email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.ownedWorkspaceId).toBeTruthy();
    expect(body.user).toMatchObject({ id: user.id, email: u.email, locale: 'ar', emailVerifiedAt: null, totpEnabled: false, platformRole: 'none', status: 'active', ownedWorkspaceId: user.ownedWorkspaceId, pendingLegal: [] });
    expect(body.user.memberships).toEqual([expect.objectContaining({ workspaceId: user.ownedWorkspaceId, role: 'owner', readOnly: false })]);

    const wsId = user.ownedWorkspaceId!;
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: wsId } });
    expect(ws.onboardingStep).toBe(1);
    expect(ws.locale).toBe('ar');
    const sm = ws.systemMessages as Record<string, Record<string, string>>;
    expect(Object.keys(sm).sort()).toEqual(['handoff', 'out_of_hours', 'out_of_stock', 'welcome']);
    for (const k of Object.keys(sm)) expect(Object.keys(sm[k]!).sort()).toEqual(['ar', 'en', 'fr']);

    expect(await db.membership.findMany({ where: { workspaceId: wsId } })).toEqual([expect.objectContaining({ userId: user.id, role: 'owner' })]);
    const sub = await db.subscription.findFirstOrThrow({ where: { workspaceId: wsId }, include: { plan: true } });
    expect(sub).toMatchObject({ status: 'trial', billingCycle: 'none', provider: 'none' });
    expect(sub.plan.slug).toBe('pro');
    expect(sub.trialEndsAt!.getTime()).toBe(sub.currentPeriodEnd.getTime());
    expect(Math.round((sub.trialEndsAt!.getTime() - Date.now()) / DAY)).toBe(14);
    const ledger = await db.creditLedger.findMany({ where: { workspaceId: wsId } });
    expect(ledger).toEqual([expect.objectContaining({ action: 'grant', kind: 'credit', bucket: 'plan', credits: 300, balanceAfter: 300 })]);
    const replies = await db.quickReply.findMany({ where: { workspaceId: wsId }, orderBy: { sortOrder: 'asc' } });
    expect(replies).toHaveLength(4);
    expect(replies.every((r) => r.locale === 'ar')).toBe(true);
    // the documents in force are accepted by signing up
    expect(await db.legalAcceptance.count({ where: { userId: user.id } })).toBe(3);

    const [mail] = await mailsTo(app, u.email, 'auth/verify');
    expect(mail).toBeDefined();
    expect(mail!.locale).toBe('ar');
    expect(mail!.html).toContain('dir="rtl"');
    // the outbox row never holds a usable link
    const row = await db.outbox.findFirstOrThrow({ where: { topic: 'mail', key: `verify:${user.id}:signup` } });
    expect(JSON.stringify(row.payload)).not.toContain(tokenOf(mail));

    // lands in onboarding step 1
    const me = await u.get('/me').expect(200);
    expect(me.body.data.workspace).toMatchObject({ id: wsId, role: 'owner', readOnly: false, onboardingStep: 1, stockMode: 'simple', status: 'active' });
    expect(me.body.data.workspace.plan).toMatchObject({ slug: 'pro', status: 'trial' });
    expect(me.body.data.workspace.plan.limits.maxMembers).toBe(10);
  });

  it('AT-AUTH-02 existing e-mail ⇒ 409 AUTH_EMAIL_TAKEN and nothing is created', async () => {
    const u = await register(app);
    const before = { users: await db.user.count(), workspaces: await db.workspace.count() };
    const res = await api(app).post('/api/v1/auth/register').send({ firstName: 'A', lastName: 'B', email: u.email.toUpperCase(), password: PASSWORD }).expect(409);
    expect(res.body.error.code).toBe('AUTH_EMAIL_TAKEN');
    expect({ users: await db.user.count(), workspaces: await db.workspace.count() }).toEqual(before);
  });

  it('validation: weak password, bad e-mail, missing names, unknown field ⇒ 422 with fields', async () => {
    const res = await api(app).post('/api/v1/auth/register').send({ firstName: '', lastName: 'B', email: 'nope', password: 'short' }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toMatchObject({ firstName: 'validation.required', email: 'validation.email', password: 'validation.password' });
    await api(app).post('/api/v1/auth/register').send({ firstName: 'A', lastName: 'B', email: uniqEmail(), password: PASSWORD, workspaceId: 'x' }).expect(422);
    await api(app).post('/api/v1/auth/register').send({ firstName: 'A', lastName: 'B', email: uniqEmail(), password: 'onlyletters' }).expect(422);
  });

  it('mobile client receives the refresh token in the body and no cookie', async () => {
    const u = await register(app, { device: { platform: 'android', name: 'Pixel', appVersion: '1.0.0' } });
    expect(u.res.body.data.refreshToken).toEqual(expect.any(String));
    expect(cookieHeader(u.res)).toBe('');
    const res = await api(app).post('/api/v1/auth/refresh').send({ refreshToken: u.res.body.data.refreshToken }).expect(200);
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).not.toBe(u.res.body.data.refreshToken);
    expect(cookieHeader(res)).toBe('');
  });
});

describe('AUTH-02 / AUTH-08 login', () => {
  it('logs in with the right password and returns MeDto + access token + refresh cookie', async () => {
    const u = await register(app);
    const res = await login(app, u.email.toUpperCase()).expect(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe(u.email);
    expect(refreshCookie(res)).toBeTruthy();
    const claims = await app.app.get(TokenService).verifyAccess(res.body.data.accessToken);
    expect(claims).toMatchObject({ sub: res.body.data.user.id, wid: res.body.data.user.ownedWorkspaceId, role: 'owner', pr: 'none' });
    expect((await db.user.findUniqueOrThrow({ where: { email: u.email } })).lastLoginAt).not.toBeNull();
  });

  it('AT-AUTH-03 wrong password and unknown e-mail return the identical error and comparable timing', async () => {
    const u = await register(app);
    const time = async (email: string) => {
      const t0 = process.hrtime.bigint();
      const res = await login(app, email, 'Wrong-password-1').expect(401);
      return { ms: Number(process.hrtime.bigint() - t0) / 1e6, error: res.body.error };
    };
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    await time(uniqEmail('warmup')); // first call computes the dummy hash
    const wrong: number[] = [];
    const unknown: number[] = [];
    let wrongError: any;
    let unknownError: any;
    for (let i = 0; i < 4; i++) {
      const a = await time(u.email);
      const b = await time(uniqEmail('ghost'));
      wrong.push(a.ms);
      unknown.push(b.ms);
      wrongError = a.error;
      unknownError = b.error;
    }
    expect(wrongError.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect({ ...unknownError, ref: '' }).toEqual({ ...wrongError, ref: '' });
    expect(Math.abs(median(wrong) - median(unknown))).toBeLessThan(50);
  });

  it('AT-AUTH-04 6th failed login in 15 min ⇒ 429 RATE_LIMITED with retryAfter; a success resets the counter', async () => {
    const u = await register(app);
    for (let i = 0; i < 5; i++) await login(app, u.email, 'Wrong-password-1').expect(401);
    const res = await login(app, u.email, 'Wrong-password-1').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.params.retryAfter).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // even the right password is refused while locked
    await login(app, u.email).expect(429);

    const v = await register(app);
    for (let i = 0; i < 4; i++) await login(app, v.email, 'Wrong-password-1').expect(401);
    await login(app, v.email).expect(200);
    for (let i = 0; i < 5; i++) await login(app, v.email, 'Wrong-password-1').expect(401);
  });

  it('blocked user ⇒ 403 AUTH_USER_BLOCKED; validation ⇒ 422', async () => {
    const u = await register(app);
    await db.user.update({ where: { email: u.email }, data: { status: 'blocked' } });
    expect((await login(app, u.email).expect(403)).body.error.code).toBe('AUTH_USER_BLOCKED');
    expect((await api(app).post('/api/v1/auth/login').send({ email: 'x' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('AUTH-02 / AUTH-04 refresh, logout, sessions', () => {
  const refresh = (cookie: string) => api(app).post('/api/v1/auth/refresh').set('Cookie', `djaber_rt=${cookie}`).send({});

  it('rotates the refresh token on every call', async () => {
    const u = await register(app);
    const r1 = await refresh(u.cookie).expect(200);
    const c1 = refreshCookie(r1)!;
    expect(c1).toBeTruthy();
    expect(c1).not.toBe(u.cookie);
    expect(r1.body.data.refreshToken).toBeUndefined();
    await withToken(app, r1.body.data.accessToken).get('/me').expect(200);
    await refresh(c1).expect(200);
    expect((await api(app).post('/api/v1/auth/refresh').send({}).expect(401)).body.error.code).toBe('UNAUTHORIZED');
    expect((await refresh('unknown-token-unknown-token').expect(401)).body.error.code).toBe('UNAUTHORIZED');
  });

  it('PV 28/10 « fermeture de session »: two tabs refreshing with the same cookie at once both stay signed in; after a logout the old cookie is refused', async () => {
    const u = await register(app);
    // tab A and tab B start together: both present the cookie of the login
    const [a, b] = await Promise.all([refresh(u.cookie), refresh(u.cookie)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // the second one a few seconds later (lost response, slow tab) is accepted too
    const c = await refresh(u.cookie).expect(200);
    for (const r of [a, b, c]) await withToken(app, r.body.data.accessToken).get('/me').expect(200);
    const rows = await db.refreshToken.findMany({ where: { userId: u.userId } });
    expect(new Set(rows.map((r) => r.familyId)).size).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'auth.sessions_revoked', entityId: u.userId } })).toBe(0);
    // every cookie issued keeps working
    await refresh(refreshCookie(c)!).expect(200);
    // a logout closes the session: the cookie of the login is refused even inside the window
    await api(app).post('/api/v1/auth/logout').set('Cookie', `djaber_rt=${refreshCookie(a)!}`).send({}).expect(204);
    expect((await refresh(u.cookie).expect(401)).body.error.code).toBe('AUTH_REFRESH_REUSED');
  });

  it('AT-AUTH-05 refresh token reused after rotation ⇒ whole family revoked; next request 401', async () => {
    const u = await register(app);
    const r1 = await refresh(u.cookie).expect(200);
    const fresh = refreshCookie(r1)!;
    // beyond the grace window of concurrent tabs (REFRESH_REUSE_GRACE_S = 60 s)
    await db.refreshToken.updateMany({ where: { userId: u.userId, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 120_000) } });
    const reused = await refresh(u.cookie).expect(401);
    expect(reused.body.error.code).toBe('AUTH_REFRESH_REUSED');
    expect(cookieHeader(reused)).toMatch(/djaber_rt=;/); // cookie cleared
    // the token issued by the legitimate rotation is revoked too
    expect((await refresh(fresh).expect(401)).body.error.code).toBe('AUTH_REFRESH_REUSED');
    const rows = await db.refreshToken.findMany({ where: { userId: u.userId } });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect(new Set(rows.map((r) => r.familyId)).size).toBe(1);
    const audit = await eventually(() => db.auditLog.findFirst({ where: { action: 'auth.sessions_revoked', entityId: u.userId } }));
    expect(audit).toBeTruthy();
    // another session of the same user is untouched
    const other = await login(app, u.email).expect(200);
    await refresh(refreshCookie(other)!).expect(200);
  });

  it('logout revokes the session; logout?all revokes every session', async () => {
    const u = await register(app);
    const second = await login(app, u.email).expect(200);
    const out = await api(app).post('/api/v1/auth/logout').set('Cookie', `djaber_rt=${u.cookie}`).send({}).expect(204);
    expect(cookieHeader(out)).toMatch(/djaber_rt=;/);
    await refresh(u.cookie).expect(401);
    await refresh(refreshCookie(second)!).expect(200);

    const third = await login(app, u.email).expect(200);
    const fourth = await login(app, u.email).expect(200);
    await withToken(app, third.body.data.accessToken).post('/auth/logout?all').expect(204);
    await refresh(refreshCookie(third)!).expect(401);
    await refresh(refreshCookie(fourth)!).expect(401);
    // anonymous logout is a no-op
    await api(app).post('/api/v1/auth/logout').send({}).expect(204);
  });

  it('sessions: list (current flagged), revoke one, unknown id ⇒ 404, another user ⇒ 404', async () => {
    const u = await register(app);
    const second = await login(app, u.email).set('User-Agent', 'Second device').expect(200);
    const list = await u.get('/me/sessions').expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((s: any) => s.current)).toHaveLength(1);
    const other = list.body.data.find((s: any) => !s.current);
    expect(other.userAgent).toBe('Second device');
    expect(JSON.stringify(list.body.data)).not.toMatch(/tokenHash/);

    const stranger = await register(app);
    await stranger.delete(`/me/sessions/${other.id}`).expect(404);
    await u.delete(`/me/sessions/${other.id}`).expect(204);
    await u.delete(`/me/sessions/${other.id}`).expect(404);
    await u.delete('/me/sessions/not-a-uuid').expect(400);
    await refresh(refreshCookie(second)!).expect(401);
    expect((await u.get('/me/sessions').expect(200)).body.data).toHaveLength(1);
    await anonymous(app).get('/me/sessions').expect(401);
  });
});

describe('AUTH-03 forgot / reset password', () => {
  it('AT-AUTH-06 reset link: valid ⇒ form; success logs in and revokes other sessions; used twice ⇒ invalid; after 61 min ⇒ expired', async () => {
    const u = await register(app);
    const old = await login(app, u.email).expect(200);

    // always 200, same body, for a known and an unknown address
    const known = await api(app).post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(200);
    const unknown = await api(app).post('/api/v1/auth/forgot-password').send({ email: uniqEmail('ghost') }).expect(200);
    expect(known.body.data).toEqual(unknown.body.data);

    const [mail] = await mailsTo(app, u.email, 'auth/reset');
    const token = tokenOf(mail);
    expect(String(mail!.params!.url)).toContain('/reset-password?token=');
    expect((await api(app).get(`/api/v1/auth/reset-password/${token}`).expect(200)).body.data.valid).toBe(true);

    expect((await api(app).post('/api/v1/auth/reset-password').send({ token, password: 'weak' }).expect(422)).body.error.fields).toMatchObject({ password: 'validation.password' });

    const done = await api(app).post('/api/v1/auth/reset-password').send({ token, password: 'Nouveau-pass-2027' }).expect(200);
    expect(done.body.data.accessToken).toEqual(expect.any(String)); // logged in
    expect(done.body.data.user.emailVerifiedAt).not.toBeNull(); // the link proves the mailbox
    // other sessions revoked
    await api(app).post('/api/v1/auth/refresh').set('Cookie', `djaber_rt=${refreshCookie(old)}`).send({}).expect(401);
    await api(app).post('/api/v1/auth/refresh').set('Cookie', `djaber_rt=${u.cookie}`).send({}).expect(401);
    await api(app).post('/api/v1/auth/refresh').set('Cookie', `djaber_rt=${refreshCookie(done)}`).send({}).expect(200);
    await login(app, u.email, PASSWORD).expect(401);
    await login(app, u.email, 'Nouveau-pass-2027').expect(200);

    // used twice ⇒ invalid
    expect((await api(app).post('/api/v1/auth/reset-password').send({ token, password: 'Encore-un-2028' }).expect(400)).body.error.code).toBe('AUTH_RESET_TOKEN_INVALID');
    expect((await api(app).get(`/api/v1/auth/reset-password/${token}`).expect(400)).body.error.code).toBe('AUTH_RESET_TOKEN_INVALID');
    expect((await api(app).get('/api/v1/auth/reset-password/does-not-exist-does-not-exist').expect(400)).body.error.code).toBe('AUTH_RESET_TOKEN_INVALID');
    const audit = await eventually(() => db.auditLog.findFirst({ where: { action: 'auth.password_reset', entityId: u.userId } }));
    expect(audit).toBeTruthy();

    // after 61 minutes ⇒ expired
    const v = await register(app);
    await api(app).post('/api/v1/auth/forgot-password').send({ email: v.email }).expect(200);
    const token2 = tokenOf((await mailsTo(app, v.email, 'auth/reset'))[0]);
    const row = await db.emailToken.findFirstOrThrow({ where: { userId: v.userId, kind: 'reset' } });
    expect(Math.round((row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000)).toBe(60);
    await db.emailToken.update({ where: { id: row.id }, data: { expiresAt: new Date(row.createdAt.getTime() - 60_000) } });
    expect((await api(app).get(`/api/v1/auth/reset-password/${token2}`).expect(410)).body.error.code).toBe('AUTH_RESET_TOKEN_EXPIRED');
    expect((await api(app).post('/api/v1/auth/reset-password').send({ token: token2, password: 'Nouveau-pass-2027' }).expect(410)).body.error.code).toBe('AUTH_RESET_TOKEN_EXPIRED');
  });

  it('60 s resend cooldown (one mail) and 3 / h / e-mail ⇒ 429', async () => {
    const u = await register(app);
    for (let i = 0; i < 3; i++) await api(app).post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(200);
    expect(await mailsTo(app, u.email, 'auth/reset')).toHaveLength(1);
    const res = await api(app).post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    await api(app).post('/api/v1/auth/forgot-password').send({ email: 'bad' }).expect(422);
  });
});

describe('AUTH-09 e-mail verification', () => {
  it('verifies with the link, single use; resend has a 60 s cooldown; expired link ⇒ 410', async () => {
    const u = await register(app);
    // resend: new link, the previous one stops working
    const first = tokenOf((await mailsTo(app, u.email, 'auth/verify'))[0]);
    expect((await u.post('/auth/verify-email/resend').expect(200)).body.data.sent).toBe(true);
    const cooldown = await u.post('/auth/verify-email/resend').expect(429);
    expect(cooldown.body.error.params.retryAfter).toBeGreaterThan(0);
    const mails = await mailsTo(app, u.email, 'auth/verify');
    expect(mails).toHaveLength(2);
    const second = tokenOf(mails[0]);
    expect(second).not.toBe(first);
    expect((await api(app).post('/api/v1/auth/verify-email').send({ token: first }).expect(410)).body.error.code).toBe('AUTH_VERIFY_TOKEN_EXPIRED');

    const ok = await api(app).post('/api/v1/auth/verify-email').send({ token: second }).expect(200);
    expect(ok.body.data).toMatchObject({ email: u.email, emailVerifiedAt: expect.any(String) });
    expect((await u.get('/me').expect(200)).body.data.emailVerifiedAt).not.toBeNull();
    await api(app).post('/api/v1/auth/verify-email').send({ token: second }).expect(410);
    await api(app).post('/api/v1/auth/verify-email').send({ token: 'x' }).expect(422);
    // already verified: resend is a no-op
    await clearRate(app, 'rl:verify-resend*');
    expect((await u.post('/auth/verify-email/resend').expect(200)).body.data.sent).toBe(false);
    await anonymous(app).post('/auth/verify-email/resend').expect(401);

    const v = await register(app);
    const token = tokenOf((await mailsTo(app, v.email, 'auth/verify'))[0]);
    await db.emailToken.updateMany({ where: { userId: v.userId, kind: 'verify' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api(app).post('/api/v1/auth/verify-email').send({ token }).expect(410)).body.error.code).toBe('AUTH_VERIFY_TOKEN_EXPIRED');
  });

  it('AT-AUTH-08 unverified account cannot connect a channel, everything else works; reminder e-mail at day 7', async () => {
    const u = await register(app);
    // the real connect route (M3): the only action an unverified account cannot do (D32)
    const blocked = await u.get('/channels/connect/facebook').expect(403);
    expect(blocked.body.error.code).toBe('AUTH_EMAIL_UNVERIFIED');
    // everything else works
    await u.get('/workspace').expect(200);
    await u.patch('/workspace', { name: 'Boutique non vérifiée' }).expect(200);
    await u.post('/workspace/quick-replies', { title: 'Sans vérification', body: 'ok' }).expect(201);

    // day 7 reminder: registered as a scheduler, sent once
    const registry = app.app.get(ProcessorRegistry);
    expect(registry.crons.map((c) => c.name)).toEqual(expect.arrayContaining(['sched-email-verify-reminder', 'sched-retention', 'sched-workspace-purge']));
    const scheduler = app.app.get(AuthScheduler);
    await scheduler.verifyReminders();
    expect(await mailsTo(app, u.email, 'auth/verify-reminder')).toHaveLength(0); // day 0: nothing
    await db.user.update({ where: { id: u.userId }, data: { createdAt: new Date(Date.now() - 7 * DAY) } });
    const day6 = await register(app);
    await db.user.update({ where: { id: day6.userId }, data: { createdAt: new Date(Date.now() - 5 * DAY) } });
    await scheduler.verifyReminders();
    await scheduler.verifyReminders(); // a second run does not send twice
    const reminders = await mailsTo(app, u.email, 'auth/verify-reminder');
    expect(reminders).toHaveLength(1);
    expect(await mailsTo(app, day6.email, 'auth/verify-reminder')).toHaveLength(0);

    // the reminder link verifies the account, after which connecting is allowed
    await api(app).post('/api/v1/auth/verify-email').send({ token: tokenOf(reminders[0]) }).expect(200);
    const start = await u.get('/channels/connect/facebook').expect(200);
    expect(start.body.data.url).toContain('/api/v1/channels/callback/facebook?code=');
  });
});

describe('AUTH-05 TOTP 2FA', () => {
  const enable2fa = async (u: { post: (url: string, body?: object) => any }) => {
    const setup = await u.post('/auth/2fa/setup').expect(200);
    const secret: string = setup.body.data.secret;
    expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Djaber/);
    const bad = await u.post('/auth/2fa/enable', { code: '000000' });
    // 000000 could be the right code once in a million runs
    if (bad.status === 200) return { secret, recoveryCodes: bad.body.data.recoveryCodes as string[] };
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('AUTH_2FA_INVALID');
    const ok = await u.post('/auth/2fa/enable', { code: TwoFactorService.codeFor(secret) }).expect(200);
    return { secret, recoveryCodes: ok.body.data.recoveryCodes as string[] };
  };

  it('AT-AUTH-07 login returns mfaToken; code ⇒ tokens; second use / expired mfaToken ⇒ 401; recovery code once; regeneration needs the password', async () => {
    const u = await register(app);
    const { secret, recoveryCodes } = await enable2fa(u);
    expect(recoveryCodes).toHaveLength(10);
    expect((await u.get('/me').expect(200)).body.data.totpEnabled).toBe(true);
    // the secret is stored encrypted, the recovery codes hashed
    const row = await db.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(Buffer.from(row.totpSecret!).toString('utf8')).not.toContain(secret);
    expect(JSON.stringify(row.recoveryCodes)).not.toContain(recoveryCodes[0]);
    await u.post('/auth/2fa/setup').expect(409);

    const step1 = await login(app, u.email).expect(200);
    expect(step1.body.data).toEqual({ mfaToken: expect.any(String) });
    expect(refreshCookie(step1)).toBeUndefined();
    const mfaToken: string = step1.body.data.mfaToken;
    // the mfaToken is not an access token
    await withToken(app, mfaToken).get('/me').expect(401);

    const wrong = await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken, code: '12345' }).expect(401);
    expect(wrong.body.error.code).toBe('AUTH_2FA_INVALID');
    // ±1 step drift is accepted
    const ok = await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken, code: TwoFactorService.codeFor(secret, -1) }).expect(200);
    expect(ok.body.data.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(ok)).toBeTruthy();
    // single use
    const again = await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken, code: TwoFactorService.codeFor(secret) }).expect(401);
    expect(again.body.error.code).toBe('AUTH_MFA_TOKEN_EXPIRED');
    // expired / forged
    const expired = await app.app.get(TokenService).signPurpose('mfa', { sub: u.userId, jti: 'expired-1' }, -10);
    expect((await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken: expired, code: TwoFactorService.codeFor(secret) }).expect(401)).body.error.code).toBe('AUTH_MFA_TOKEN_EXPIRED');
    expect((await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken: u.token, code: TwoFactorService.codeFor(secret) }).expect(401)).body.error.code).toBe('AUTH_MFA_TOKEN_EXPIRED');
    await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken }).expect(422);
    // two steps away is refused
    const t2 = (await login(app, u.email).expect(200)).body.data.mfaToken;
    await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken: t2, code: TwoFactorService.codeFor(secret, -3) }).expect(401);

    // recovery code works once
    const t3 = (await login(app, u.email).expect(200)).body.data.mfaToken;
    await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken: t3, recoveryCode: recoveryCodes[0] }).expect(200);
    const t4 = (await login(app, u.email).expect(200)).body.data.mfaToken;
    expect((await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken: t4, recoveryCode: recoveryCodes[0] }).expect(401)).body.error.code).toBe('AUTH_2FA_INVALID');

    // regeneration needs the password; old codes die
    expect((await u.post('/auth/2fa/recovery-codes', { password: 'Wrong-password-1' }).expect(422)).body.error.code).toBe('AUTH_CURRENT_PASSWORD_INCORRECT');
    const regen = await u.post('/auth/2fa/recovery-codes', { password: PASSWORD }).expect(200);
    expect(regen.body.data.recoveryCodes).toHaveLength(10);
    const t5 = (await login(app, u.email).expect(200)).body.data.mfaToken;
    await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken: t5, recoveryCode: recoveryCodes[1] }).expect(401);
    await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken: t5, recoveryCode: regen.body.data.recoveryCodes[0] }).expect(200);

    // disable needs the password and is audited
    await u.post('/auth/2fa/disable', { password: 'Wrong-password-1' }).expect(422);
    await u.post('/auth/2fa/disable', { password: PASSWORD }).expect(200);
    expect((await login(app, u.email).expect(200)).body.data.accessToken).toEqual(expect.any(String));
    const audit = await eventually(() => db.auditLog.findFirst({ where: { action: 'auth.2fa_disable', entityId: u.userId } }));
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it('AT-AUTH-07 a platform role cannot disable 2FA (TWO_FA_REQUIRED_FOR_ROLE)', async () => {
    const admin = await asPlatform(app, 'super_admin', { totpEnabled: false });
    await setPassword(app, admin.userId);
    await enable2fa(admin);
    const res = await admin.post('/auth/2fa/disable', { password: PASSWORD }).expect(403);
    expect(res.body.error.code).toBe('TWO_FA_REQUIRED_FOR_ROLE');
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.userId } })).totpEnabled).toBe(true);
  });

  it('2FA verify is limited to 5 attempts per mfaToken ⇒ 429', async () => {
    const u = await register(app);
    const { secret } = await enable2fa(u);
    const mfaToken = (await login(app, u.email).expect(200)).body.data.mfaToken;
    for (let i = 0; i < 5; i++) await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken, code: '1234' }).expect(401);
    const res = await api(app).post('/api/v1/auth/2fa/verify').send({ mfaToken, code: TwoFactorService.codeFor(secret) }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    await anonymous(app).post('/auth/2fa/setup').expect(401);
  });
});

describe('AUTH-06 profile', () => {
  it('GET /me for a user without workspace; PATCH /me validation and update; prefs', async () => {
    const lone = await asLoneUser(app);
    const me = await lone.get('/me').expect(200);
    expect(me.body.data).toMatchObject({ ownedWorkspaceId: null, memberships: [], workspace: null, flags: {}, pendingLegal: [], deletionScheduledAt: null });
    expect(me.body.data.prefs).toEqual({ listDensity: 'comfortable', soundOnMessage: true, dismissedAnnouncementIds: [], reportFavorites: [] });
    await anonymous(app).get('/me').expect(401);

    const bad = await lone.patch('/me', { firstName: '', phone: '123', locale: 'de' }).expect(422);
    expect(bad.body.error.fields).toMatchObject({ firstName: 'validation.required', phone: 'validation.phone' });
    await lone.patch('/me', { email: 'x@y.dz' }).expect(422); // e-mail changes only through /me/email-change
    const ok = await lone.patch('/me', { firstName: 'Nadia', lastName: 'Ferhat', phone: '+213 555 12 34 56', locale: 'ar' }).expect(200);
    expect(ok.body.data).toMatchObject({ firstName: 'Nadia', lastName: 'Ferhat', phone: '0555123456', locale: 'ar' });

    await lone.patch('/me/prefs', { listDensity: 'huge' }).expect(422);
    const prefs = await lone.patch('/me/prefs', { listDensity: 'compact', reportFavorites: ['sales'] }).expect(200);
    expect(prefs.body.data).toEqual({ listDensity: 'compact', soundOnMessage: true, dismissedAnnouncementIds: [], reportFavorites: ['sales'] });
    expect((await lone.get('/me/prefs').expect(200)).body.data.listDensity).toBe('compact');
  });

  it('avatar upload: direct, two-step, type and size errors, foreign upload refused', async () => {
    const u = await asLoneUser(app);
    const png = await sharp({ create: { width: 900, height: 700, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
    const direct = await api(app).post('/api/v1/me/avatar').set(u.headers).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(200);
    expect(direct.body.data.avatarUrl).toMatch(/\/api\/v1\/files\/users\//);
    expect(direct.body.data.upload).toMatchObject({ mime: 'image/webp', width: 512 });
    expect((await u.get('/me').expect(200)).body.data.avatarUrl).toBe(direct.body.data.avatarUrl);
    // the stored object is served
    const file = await api(app).get(new URL(direct.body.data.avatarUrl).pathname).expect(200);
    expect(file.headers['content-type']).toBe('image/webp');

    const up = await api(app).post('/api/v1/uploads').set(u.headers).field('kind', 'avatar').attach('file', png, { filename: 'b.png', contentType: 'image/png' }).expect(201);
    expect(up.body.data).toMatchObject({ id: expect.any(String), mime: 'image/webp' });
    await u.patch('/me', { avatarUploadId: up.body.data.id }).expect(200);
    const stranger = await asLoneUser(app);
    await stranger.patch('/me', { avatarUploadId: up.body.data.id }).expect(422);
    expect((await u.patch('/me', { avatarUploadId: null }).expect(200)).body.data.avatarUrl).toBeNull();

    const txt = await api(app).post('/api/v1/me/avatar').set(u.headers).attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' }).expect(415);
    expect(txt.body.error.code).toBe('IMAGE_TYPE_INVALID');
    // a text file disguised as a PNG is refused after decoding
    await api(app).post('/api/v1/me/avatar').set(u.headers).attach('file', Buffer.from('not an image'), { filename: 'a.png', contentType: 'image/png' }).expect(415);
    const big = await api(app).post('/api/v1/me/avatar').set(u.headers).attach('file', Buffer.alloc(5 * 1024 * 1024 + 10, 1), { filename: 'big.png', contentType: 'image/png' }).expect(413);
    expect(big.body.error.code).toBe('IMAGE_TOO_LARGE');
    await api(app).post('/api/v1/uploads').set(u.headers).field('kind', 'export').attach('file', png, { filename: 'b.png', contentType: 'image/png' }).expect(422);
    await api(app).post('/api/v1/me/avatar').set(u.headers).expect(422);
    await api(app).post('/api/v1/uploads').field('kind', 'avatar').attach('file', png, { filename: 'b.png', contentType: 'image/png' }).expect(401);
  });

  it('password change: wrong current ⇒ 422, weak ⇒ 422, success keeps this session and revokes the others, audited', async () => {
    const u = await register(app);
    const other = await login(app, u.email).expect(200);
    const wrong = await u.patch('/me/password', { currentPassword: 'Wrong-password-1', newPassword: 'Nouveau-pass-2027' }).expect(422);
    expect(wrong.body.error).toMatchObject({ code: 'AUTH_CURRENT_PASSWORD_INCORRECT', fields: { currentPassword: 'validation.invalid' } });
    expect((await u.patch('/me/password', { currentPassword: PASSWORD, newPassword: 'weak' }).expect(422)).body.error.fields).toMatchObject({ newPassword: 'validation.password' });
    const ok = await u.patch('/me/password', { currentPassword: PASSWORD, newPassword: 'Nouveau-pass-2027' }).expect(200);
    expect(ok.body.data.sessionsRevoked).toBe(1);
    await api(app).post('/api/v1/auth/refresh').set('Cookie', `djaber_rt=${refreshCookie(other)}`).send({}).expect(401);
    await api(app).post('/api/v1/auth/refresh').set('Cookie', `djaber_rt=${u.cookie}`).send({}).expect(200);
    await login(app, u.email, PASSWORD).expect(401);
    await login(app, u.email, 'Nouveau-pass-2027').expect(200);
    const audit = await eventually(() => db.auditLog.findFirst({ where: { action: 'auth.password_change', entityId: u.userId } }));
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain('Nouveau-pass-2027');
  });

  it('e-mail change: password required, taken ⇒ 409, confirmation link switches the address, old address notified, audited', async () => {
    const u = await register(app);
    const taken = await register(app);
    const next = uniqEmail('new');
    expect((await u.post('/me/email-change', { email: next, password: 'Wrong-password-1' }).expect(422)).body.error.code).toBe('AUTH_CURRENT_PASSWORD_INCORRECT');
    expect((await u.post('/me/email-change', { email: taken.email, password: PASSWORD }).expect(409)).body.error.code).toBe('AUTH_EMAIL_TAKEN');
    await u.post('/me/email-change', { email: 'bad', password: PASSWORD }).expect(422);
    await u.post('/me/email-change', { email: u.email, password: PASSWORD }).expect(422);
    expect((await u.post('/me/email-change', { email: next, password: PASSWORD }).expect(202)).body.data).toEqual({ pendingEmail: next });
    // nothing changes before the confirmation
    expect((await u.get('/me').expect(200)).body.data.email).toBe(u.email);
    expect(await mailsTo(app, u.email, 'auth/email-change-notice')).toHaveLength(1);
    const [mail] = await mailsTo(app, next, 'auth/email-change');
    const res = await api(app).post('/api/v1/auth/verify-email').send({ token: tokenOf(mail) }).expect(200);
    expect(res.body.data.email).toBe(next);
    expect((await u.get('/me').expect(200)).body.data).toMatchObject({ email: next, emailVerifiedAt: expect.any(String) });
    await login(app, u.email).expect(401);
    await login(app, next).expect(200);
    await api(app).post('/api/v1/auth/verify-email').send({ token: tokenOf(mail) }).expect(410);
    expect(await eventually(() => db.auditLog.findFirst({ where: { action: 'auth.email_change', entityId: u.userId } }))).toBeTruthy();
  });
});

describe('AUTH-07 account deletion request', () => {
  it('owner ⇒ 422 ACCOUNT_OWNS_WORKSPACE (recorded as blocked); wrong password ⇒ 422', async () => {
    const u = await register(app);
    expect((await u.post('/me/deletion-request', { password: 'Wrong-password-1' }).expect(422)).body.error.code).toBe('AUTH_CURRENT_PASSWORD_INCORRECT');
    expect((await u.get('/me/deletion-request').expect(200)).body.data).toBeNull();
    const res = await u.post('/me/deletion-request', { password: PASSWORD }).expect(422);
    expect(res.body.error.code).toBe('ACCOUNT_OWNS_WORKSPACE');
    expect((await u.get('/me/deletion-request').expect(200)).body.data).toMatchObject({ status: 'blocked', blockedReason: 'ACCOUNT_OWNS_WORKSPACE', scheduledAt: null });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.userId } })).status).toBe('active');
    await u.post('/me/deletion-request', {}).expect(422);
  });

  it('member: 202 grace 30 d, sessions revoked, memberships removed, mail; second request ⇒ ACCOUNT_DELETION_PENDING; cancel by logging in; anonymised after the grace', async () => {
    const owner = await asOwner(app);
    const member = await asAdmin(app, owner.workspaceId);
    await setPassword(app, member.userId);
    const email = (await db.user.findUniqueOrThrow({ where: { id: member.userId } })).email;
    const session = await login(app, email).expect(200);

    const res = await member.post('/me/deletion-request', { password: PASSWORD }).expect(202);
    expect(res.body.data).toMatchObject({ status: 'grace', blockedReason: null, exportUrl: null });
    expect(Math.round((new Date(res.body.data.scheduledAt).getTime() - Date.now()) / DAY)).toBe(30);
    expect(await db.membership.count({ where: { userId: member.userId } })).toBe(0);
    await api(app).post('/api/v1/auth/refresh').set('Cookie', `djaber_rt=${refreshCookie(session)}`).send({}).expect(401);
    expect(await mailsTo(app, email, 'auth/account-deletion-confirm')).toHaveLength(1);
    // the workspace is no longer reachable with the old access token
    await member.get('/workspace').expect(401);

    // logging in during the grace period shows the scheduled deletion and allows the cancel
    const back = await login(app, email).expect(200);
    expect(back.body.data.user).toMatchObject({ status: 'deletion_scheduled', deletionScheduledAt: res.body.data.scheduledAt });
    const again = withToken(app, back.body.data.accessToken);
    expect((await again.post('/me/deletion-request', { password: PASSWORD }).expect(409)).body.error.code).toBe('ACCOUNT_DELETION_PENDING');
    expect((await again.delete('/me/deletion-request').expect(200)).body.data.status).toBe('cancelled');
    expect((await again.get('/me').expect(200)).body.data).toMatchObject({ status: 'active', deletionScheduledAt: null, memberships: [] });
    await again.delete('/me/deletion-request').expect(404);

    // a new request, then the grace elapses ⇒ anonymised
    await again.post('/me/deletion-request', { password: PASSWORD }).expect(202);
    const svc = app.app.get(AccountDeletionService);
    expect(await svc.anonymiseDue()).toBe(0);
    await db.accountDeletionRequest.updateMany({ where: { userId: member.userId, status: 'grace' }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    expect(await svc.anonymiseDue()).toBe(1);
    expect(await svc.anonymiseDue()).toBe(0);
    const gone = await db.user.findUniqueOrThrow({ where: { id: member.userId } });
    expect(gone).toMatchObject({ firstName: 'Membre supprimé', email: `deleted+${member.userId}@anon.djaber.ai`, phone: null, avatarUrl: null, totpEnabled: false });
    expect(gone.deletedAt).not.toBeNull();
    await login(app, email).expect(401);
  });

  it('2FA enabled ⇒ totpCode required (TWO_FA_CONFIRMATION_REQUIRED)', async () => {
    const owner = await asOwner(app);
    const member = await asAdmin(app, owner.workspaceId);
    await setPassword(app, member.userId);
    const secret = (await member.post('/auth/2fa/setup').expect(200)).body.data.secret;
    await member.post('/auth/2fa/enable', { code: TwoFactorService.codeFor(secret) }).expect(200);
    expect((await member.post('/me/deletion-request', { password: PASSWORD }).expect(403)).body.error.code).toBe('TWO_FA_CONFIRMATION_REQUIRED');
    expect((await member.post('/me/deletion-request', { password: PASSWORD, totpCode: '000001' }).expect(403)).body.error.code).toBe('TWO_FA_CONFIRMATION_REQUIRED');
    await member.post('/me/deletion-request', { password: PASSWORD, totpCode: TwoFactorService.codeFor(secret) }).expect(202);
  });
});

describe('scheduled cleanup', () => {
  it('sched-retention removes expired refresh tokens (> 30 d), used / expired e-mail tokens and expired idempotency keys', async () => {
    const user = await createUser();
    const owner = await asOwner(app);
    await db.refreshToken.createMany({
      data: [
        { userId: user.id, familyId: user.id, tokenHash: `old-${user.id}`, expiresAt: new Date(Date.now() - 31 * DAY) },
        { userId: user.id, familyId: user.id, tokenHash: `recent-${user.id}`, expiresAt: new Date(Date.now() - 2 * DAY) },
      ],
    });
    await db.emailToken.createMany({
      data: [
        { userId: user.id, kind: 'verify', tokenHash: `expired-${user.id}`, expiresAt: new Date(Date.now() - 1000) },
        { userId: user.id, kind: 'verify', tokenHash: `live-${user.id}`, expiresAt: new Date(Date.now() + DAY) },
      ],
    });
    await db.idempotencyKey.create({
      data: { workspaceId: owner.workspaceId, key: `k-${user.id}`, actorKey: user.id, requestHash: 'h', responseCode: 200, responseBody: {}, expiresAt: new Date(Date.now() - 1000) },
    });
    const out = await app.app.get(AuthScheduler).retention();
    expect(out.refreshTokens).toBeGreaterThanOrEqual(1);
    expect((await db.refreshToken.findMany({ where: { userId: user.id } })).map((r) => r.tokenHash)).toEqual([`recent-${user.id}`]);
    expect((await db.emailToken.findMany({ where: { userId: user.id } })).map((r) => r.tokenHash)).toEqual([`live-${user.id}`]);
    expect(await db.idempotencyKey.count({ where: { key: `k-${user.id}` } })).toBe(0);
  });
});
