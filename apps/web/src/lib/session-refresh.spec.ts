// client list L03 (Boutique de Lalla 22/11, « Session expirée » every 5–15 min): a refresh that fails without being refused
// (network, API restart, 429) is retried and never ends the session; only a refused refresh cookie does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRaw, apiSession } from './api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const token = (expInSec: number) => `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expInSec })).replace(/=+$/, '')}.s`;

describe('session refresh (L03)', () => {
  let events: string[];
  let off: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    off = apiSession.on((e) => events.push(e));
    apiSession.set({ accessToken: token(900), workspaceId: 'w' });
  });
  afterEach(() => {
    off();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a refresh that fails (503, network) is retried; the request goes through and the session stays', async () => {
    const refreshes = [() => json(503, {}), () => Promise.reject(new TypeError('network')), () => json(200, { data: { accessToken: token(900) } })];
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/auth/refresh')) return refreshes.shift()!();
        calls++;
        return calls === 1 ? json(401, { error: { code: 'AUTH_TOKEN_EXPIRED' } }) : json(200, { data: { ok: true } });
      }),
    );
    const pending = apiRaw<{ ok: boolean }>('/me');
    await vi.advanceTimersByTimeAsync(6_000);
    expect((await pending).data).toEqual({ ok: true });
    expect(events).not.toContain('session-expired');
  });

  it('a refused refresh (401) ends the session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (String(url).endsWith('/auth/refresh') ? json(401, { error: { code: 'AUTH_REFRESH_INVALID' } }) : json(401, { error: { code: 'AUTH_TOKEN_EXPIRED' } }))),
    );
    const pending = apiRaw('/me').catch(() => null);
    await vi.advanceTimersByTimeAsync(6_000);
    await pending;
    expect(events).toContain('session-expired');
  });

  it('a network outage during the refresh never shows « Session expirée »', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (String(url).endsWith('/auth/refresh') ? Promise.reject(new TypeError('network')) : json(401, { error: { code: 'AUTH_TOKEN_EXPIRED' } }))),
    );
    const pending = apiRaw('/me').catch(() => null);
    await vi.advanceTimersByTimeAsync(6_000);
    await pending;
    expect(events).not.toContain('session-expired');
  });

  it('the token is renewed one minute before it ends, without a 401', async () => {
    const fetchMock = vi.fn(async () => json(200, { data: { accessToken: token(900) } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', globalThis); // the renewal timer runs in the browser only
    apiSession.set({ accessToken: token(120) });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
