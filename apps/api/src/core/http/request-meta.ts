// Request context of the HTTP call being served (ip, user agent, auth session), kept in its own AsyncLocalStorage so it
// survives `TenantContext.runSystem` / `runAs` switches inside a handler. Opened by `RequestContextMiddleware`; read by
// `AuditService.write` so every audit row written while serving a request carries « context ip/device » (03 ADM-07,
// 12 §26 Audit log; journeys 16/11 J13-2 — API keys, webhooks, safety and clients rows had none).
import { AsyncLocalStorage } from 'node:async_hooks';

type Req = { ip?: string; headers?: Record<string, unknown>; user?: { sessionId?: string } };

const als = new AsyncLocalStorage<Req>();

export const RequestMeta = {
  run: <T>(req: Req, fn: () => T) => als.run(req, fn),
  /** null outside an HTTP request (worker jobs, schedulers, outbox relays). The req is read lazily: the auth guard sets `user` later. */
  current: (): { ip: string | null; userAgent: string | null; sessionId: string | null } | null => {
    const req = als.getStore();
    if (!req) return null;
    const ua = req.headers?.['user-agent'];
    return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null, sessionId: req.user?.sessionId ?? null };
  },
};
