// 09-code-conventions §2.3 — TenantContext lives in @djaber/db (not in apps/api) so the Prisma tenant
// extension can read it without a package → app dependency; apps/api re-exports it from core/tenancy.
import { AsyncLocalStorage } from 'node:async_hooks';

export type MembershipRole = 'owner' | 'admin' | 'operator';

export type TenantLimits = {
  maxPages: number;
  maxAgents: number;
  maxProducts: number;
  maxConversationsPerMonth: number;
  maxMembers: number;
  monthlyCredits: number;
};

export type TenantInfo = {
  workspaceId: string;
  userId?: string;
  apiKeyId?: string;
  role?: MembershipRole;
  readOnly: boolean;
  /** sections the Owner hid from this member (`MEMBER_SECTIONS`): every key of them is refused */
  hiddenSections?: string[];
  platformRole?: string;
  locale: 'fr' | 'ar' | 'en';
  /** language of the request (`?lang` / `Accept-Language`); `locale` becomes the account's or workspace's once resolved */
  requestLocale?: 'fr' | 'ar' | 'en';
  stockMode: 'simple' | 'advanced';
  suspended: boolean;
  deletionScheduledAt?: Date | null;
  emailVerified?: boolean;
  /** platform routes: D41 — every platform role needs 2FA (`TWO_FA_REQUIRED_FOR_ROLE`) */
  totpEnabled?: boolean;
  /** outside production, a platform user listed in `PLATFORM_2FA_EXEMPT_EMAILS` (testing) skips the D41 2FA check */
  twoFaExempt?: boolean;
  limits: TenantLimits;
  impersonation?: { sessionId: string; adminId: string };
  /** When true the tenant extension lets queries through without a workspace filter (platform/system code only). */
  bypass?: boolean;
};

const als = new AsyncLocalStorage<TenantInfo>();

export const NO_LIMITS: TenantLimits = {
  maxPages: 0,
  maxAgents: 0,
  maxProducts: 0,
  maxConversationsPerMonth: 0,
  maxMembers: 0,
  monthlyCredits: 0,
};

/**
 * Prisma promises are lazy: the query starts when `.then` is called. If a callback returns one without awaiting it,
 * the query would start after the AsyncLocalStorage scope is gone. Awaiting inside the scope keeps the tenant visible.
 */
const settleInside = <T>(fn: () => T): T => {
  const r = fn();
  if (r && typeof (r as { then?: unknown }).then === 'function') return (async () => await r)() as T;
  return r;
};

export const TenantContext = {
  run: <T>(info: TenantInfo, fn: () => T) => als.run(info, () => settleInside(fn)),
  get: (): TenantInfo => {
    const t = als.getStore();
    if (!t) throw new Error('TenantContextMissing');
    return t;
  },
  maybe: () => als.getStore(),
  workspaceId: () => TenantContext.get().workspaceId,
  /** System / platform code that must read across workspaces (schedulers, admin lists, auth before a workspace is known). */
  runSystem: <T>(fn: () => T) =>
    als.run(
      // the request's language survives the switch (admin lists show names in the language they are viewed in)
      { workspaceId: '', readOnly: false, locale: 'fr', stockMode: 'simple', suspended: false, limits: NO_LIMITS, bypass: true, requestLocale: als.getStore()?.requestLocale },
      () => settleInside(fn),
    ),
  /** Runs `fn` scoped to one workspace (worker jobs, admin acting on a target workspace). */
  runAs: <T>(workspaceId: string, fn: () => T, extra: Partial<TenantInfo> = {}) =>
    als.run(
      { workspaceId, readOnly: false, locale: 'fr', stockMode: 'simple', suspended: false, limits: NO_LIMITS, requestLocale: als.getStore()?.requestLocale, ...extra },
      () => settleInside(fn),
    ),
};
