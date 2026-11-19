// 09-code-conventions §2.4
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ApiScope as ApiScopeName } from '@djaber/shared';
import type { MerchantPermission, PlatformPermission } from '../rbac/permission-matrix';

/** No authentication at all (webhooks, public pages, login). */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Any logged-in user, no workspace needed (`/me/*`, `/legal/*`, `/workspaces`, invitations). */
export const IS_AUTHENTICATED_ONLY = 'isAuthenticatedOnly';
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED_ONLY, true);

/** Platform (super-admin area) route: no workspace, platform role required. */
export const IS_PLATFORM = 'isPlatform';
export const Platform = () => SetMetadata(IS_PLATFORM, true);

export const PERMISSION = 'permission';
export const RequirePermission = (key: MerchantPermission) => SetMetadata(PERMISSION, key);

export const PLATFORM_PERMISSION = 'platformPermission';
export const RequirePlatformRole = (key: PlatformPermission) => SetMetadata(PLATFORM_PERMISSION, key);

/**
 * 06 §5 — API-key whitelist. `@ApiScope('orders:write')` on a handler (wins), or `@ApiScopes({ read, write })` on a controller:
 * GET/HEAD need `read`, every other method `write` (absent ⇒ refused). A route with neither answers `403 API_SCOPE_FORBIDDEN`
 * to an API key.
 */
export const API_SCOPE = 'apiScope';
export const ApiScope = (scope: ApiScopeName) => SetMetadata(API_SCOPE, scope);
export const API_SCOPES_BY_METHOD = 'apiScopesByMethod';
export type ApiScopesByMethod = { read?: ApiScopeName; write?: ApiScopeName };
export const ApiScopes = (s: ApiScopesByMethod) => SetMetadata(API_SCOPES_BY_METHOD, s);

export const VERIFIED_EMAIL = 'verifiedEmail';
export const RequireVerifiedEmail = () => SetMetadata(VERIFIED_EMAIL, true);

export const IDEMPOTENT = 'idempotent';
export const Idempotent = (o: { required: boolean } = { required: false }) => SetMetadata(IDEMPOTENT, o);

export type AuditOptions = {
  entity: string;
  action: string;
  /** where the audited record's id is read (journey J13v-5: a route whose param is not `:id` names it, e.g. `params.jobId`) */
  idFrom?: `params.${string}` | `result.${string}`;
  diff?: boolean;
  reasonFrom?: 'body.reason';
};
export const AUDITED = 'audited';
export const Audited = (o: AuditOptions) => SetMetadata(AUDITED, o);

export type RateLimitOptions = {
  /** Name of the limit (also the Redis key prefix). */
  name: string;
  max: number;
  windowSeconds: number;
  /** What the counter is keyed by. `ip+body.email` for login, `user` by default. */
  by?: 'ip' | 'user' | 'workspace' | 'ip+email' | 'email';
};
export const RATE_LIMIT = 'rateLimit';
export const RateLimit = (o: RateLimitOptions) => SetMetadata(RATE_LIMIT, o);

export type AuthUser = { id: string; platformRole: string; sessionId?: string };

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
