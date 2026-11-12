// UX-061 (12/11) — public « Supprimer mon compte Djaber »: while a link is valid a new request sends nothing and keeps
// it (04 §16 `ACCOUNT_DELETION_PENDING`), one deletion e-mail per address per 24 h, always the same answer.
jest.mock('@djaber/db', () => ({
  ...jest.requireActual('@djaber/db'),
  prisma: {
    user: { findFirst: jest.fn() },
    accountDeletionRequest: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
  TenantContext: { ...jest.requireActual('@djaber/db').TenantContext, runSystem: <T>(fn: () => T) => fn() },
}));

import { prisma } from '@djaber/db';
import { AccountDeletionService, deletionMailCooldownKey, LINK_MAIL_COOLDOWN_S, publicLinkOutcome } from './account-deletion.service';

const mockPrisma = prisma as unknown as {
  user: { findFirst: jest.Mock };
  accountDeletionRequest: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};

const HOUR = 3600_000;
const now = new Date('2026-11-12T10:00:00.000Z');
const user = { id: 'u1', email: 'houssem@test.local', status: 'active', locale: 'en', deletedAt: null };

describe('publicLinkOutcome (04 §16)', () => {
  const row = (status: string, ageH: number, tokenHash: string | null = 'h') => ({ status, requestedAt: new Date(now.getTime() - ageH * HOUR), tokenHash }) as never;
  it('a valid pending link ⇒ pending (no new e-mail); grace ⇒ nothing; none / blocked / expired link ⇒ send', () => {
    expect(publicLinkOutcome(row('pending_confirmation', 1), now)).toBe('pending');
    expect(publicLinkOutcome(row('pending_confirmation', 23.9), now)).toBe('pending');
    expect(publicLinkOutcome(row('pending_confirmation', 24.1), now)).toBe('send');
    expect(publicLinkOutcome(row('pending_confirmation', 1, null), now)).toBe('send');
    expect(publicLinkOutcome(row('grace', 100), now)).toBe('grace');
    expect(publicLinkOutcome(row('blocked', 1, null), now)).toBe('send');
    expect(publicLinkOutcome(null, now)).toBe('send');
  });
});

describe('AccountDeletionService.publicRequest (UX-061)', () => {
  const store = new Map<string, string>();
  const redis = {
    client: {
      set: jest.fn(async (key: string, value: string, _ex: string, _ttl: number, _nx: string) => (store.has(key) ? null : (store.set(key, value), 'OK'))),
      del: jest.fn(async (key: string) => Number(store.delete(key))),
    },
  };
  const mail = { send: jest.fn() };
  const audit = { write: jest.fn() };
  const crypto = { sha256: (v: string) => `sha:${v}` };
  const config = { get: () => 'https://djaber.test' };
  const svc = new AccountDeletionService({} as never, {} as never, mail as never, audit as never, {} as never, crypto as never, config as never, {} as never, {} as never, redis as never);
  const client = { ip: '10.0.0.1', userAgent: 'jest' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    svc.requestFloorMs = 0;
    mockPrisma.user.findFirst.mockResolvedValue(user);
    mockPrisma.accountDeletionRequest.findFirst.mockResolvedValue(null);
    mockPrisma.accountDeletionRequest.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'r1', ...data }));
    mockPrisma.accountDeletionRequest.update.mockImplementation(async ({ data }: { data: object }) => ({ id: 'r1', ...data }));
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
  });

  it('first request ⇒ one e-mail, 24 h cooldown on the address; unknown address ⇒ the same answer, no e-mail', async () => {
    expect(await svc.publicRequest(user.email, undefined, client)).toEqual({ sent: true });
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send.mock.calls[0][0]).toMatchObject({ to: user.email, template: 'auth/account-deletion-request', locale: 'en' });
    expect(redis.client.set).toHaveBeenCalledWith(deletionMailCooldownKey('u1'), '1', 'EX', LINK_MAIL_COOLDOWN_S, 'NX');
    expect(LINK_MAIL_COOLDOWN_S).toBe(24 * 3600);

    mockPrisma.user.findFirst.mockResolvedValue(null);
    expect(await svc.publicRequest('nobody@test.local', undefined, client)).toEqual({ sent: true });
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('second request while the link is valid ⇒ no e-mail, the previous link (token) is left untouched', async () => {
    mockPrisma.accountDeletionRequest.findFirst.mockResolvedValue({ id: 'r1', status: 'pending_confirmation', tokenHash: 'sha:first', requestedAt: new Date(Date.now() - HOUR) });
    expect(await svc.publicRequest(user.email, undefined, client)).toEqual({ sent: true });
    expect(mail.send).not.toHaveBeenCalled();
    expect(mockPrisma.accountDeletionRequest.update).not.toHaveBeenCalled();
    expect(redis.client.set).not.toHaveBeenCalled();
  });

  it('at most one deletion e-mail per address per 24 h, even when the previous link is gone (cancelled, blocked…)', async () => {
    await svc.publicRequest(user.email, undefined, client);
    // the request was cancelled from the link: no open request any more
    mockPrisma.accountDeletionRequest.findFirst.mockResolvedValue(null);
    await svc.publicRequest(user.email, undefined, client);
    await svc.publicRequest(user.email, undefined, client);
    expect(mail.send).toHaveBeenCalledTimes(1);
    // 24 h later (cooldown expired) ⇒ a new link
    store.clear();
    await svc.publicRequest(user.email, undefined, client);
    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it('grace running or blocked account ⇒ no e-mail', async () => {
    mockPrisma.accountDeletionRequest.findFirst.mockResolvedValue({ id: 'r1', status: 'grace', tokenHash: 'sha:c', requestedAt: new Date(Date.now() - 48 * HOUR) });
    await svc.publicRequest(user.email, undefined, client);
    mockPrisma.accountDeletionRequest.findFirst.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue({ ...user, status: 'blocked' });
    await svc.publicRequest(user.email, undefined, client);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('a failed send frees the cooldown (nothing left, nothing locked)', async () => {
    mockPrisma.$transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.publicRequest(user.email, undefined, client)).rejects.toThrow('db down');
    expect(store.has(deletionMailCooldownKey('u1'))).toBe(false);
  });

  it('every answer takes at least the floor, e-mail sent or not', async () => {
    svc.requestFloorMs = 60;
    for (const found of [user, null]) {
      mockPrisma.user.findFirst.mockResolvedValue(found);
      const t0 = Date.now();
      await svc.publicRequest(user.email, undefined, client);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
    }
  });
});
