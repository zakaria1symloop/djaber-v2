import { Injectable } from '@nestjs/common';
import { prisma, TenantContext, type Prisma } from '@djaber/db';
import { RequestMeta } from '../http/request-meta';

export type AuditEntry = {
  workspaceId?: string | null;
  actorType: 'user' | 'ai' | 'system' | 'courier' | 'api' | 'admin' | 'api_key';
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  impersonationSessionId?: string | null;
  /** auth session (JWT `sid`) of the acting person — filled from the request when omitted */
  sessionId?: string | null;
};

/** Actors whose request context (ip, device, session) is theirs: a person or a key of the shop, never an inbound provider call. */
const PERSON_ACTORS = new Set<AuditEntry['actorType']>(['user', 'admin', 'api_key', 'api']);

const SECRET_KEYS = /password|secret|token|hash|credentials|recoveryCodes|totp/i;

/** Removes secret-looking keys before a value is stored in the audit trail (07-non-functional: never log secrets). */
export const redact = (v: unknown, depth = 0): unknown => {
  if (v === null || v === undefined || depth > 4) return v ?? null;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(val, depth + 1);
    }
    return out;
  }
  return v;
};

@Injectable()
export class AuditService {
  /** Sensitive actions listed in 01-nest-module-map §3.4 must call this (or use `@Audited`). */
  async write(e: AuditEntry) {
    // J13-2 (journeys 16/11): every row written while serving a person's request carries its ip / device / session, even when
    // the caller passed none (API keys, webhooks, safety, clients wrote « CONTEXTE — »). Values a caller passes win.
    const req = PERSON_ACTORS.has(e.actorType) ? RequestMeta.current() : null;
    const impersonationSessionId = e.impersonationSessionId ?? TenantContext.maybe()?.impersonation?.sessionId ?? null;
    await TenantContext.runSystem(() =>
      prisma.auditLog.create({
        data: {
          workspaceId: e.workspaceId ?? null,
          actorType: e.actorType,
          actorId: e.actorId ?? null,
          actorRole: e.actorRole ?? null,
          action: e.action,
          entity: e.entity,
          entityId: e.entityId ?? null,
          before: (redact(e.before) ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (redact(e.after) ?? undefined) as Prisma.InputJsonValue | undefined,
          reason: e.reason ?? null,
          ip: e.ip ?? req?.ip ?? null,
          userAgent: e.userAgent ?? req?.userAgent ?? null,
          sessionId: e.sessionId ?? req?.sessionId ?? null,
          impersonationSessionId,
        },
      }),
    );
  }
}
