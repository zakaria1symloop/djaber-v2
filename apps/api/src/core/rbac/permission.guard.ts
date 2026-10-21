// 09-code-conventions §2.4
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isHidden } from '@djaber/shared';
import { TenantContext } from '@djaber/db';
import { AppException } from '../errors/app.exception';
import {
  API_SCOPE,
  API_SCOPES_BY_METHOD,
  type ApiScopesByMethod,
  IS_AUTHENTICATED_ONLY,
  IS_PLATFORM,
  IS_PUBLIC,
  PERMISSION,
  PLATFORM_PERMISSION,
  VERIFIED_EMAIL,
} from '../auth/decorators';
import {
  MERCHANT_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  type MerchantPermission,
  type PlatformPermission,
} from './permission-matrix';

/** 06 §5 whitelist: the handler's `@ApiScope` wins, else the controller's `@ApiScopes({ read, write })` by HTTP method. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- Nest reflector targets (handler, class)
export const apiScopeOf = (reflector: Reflector, targets: Function[], method: string): string | null => {
  const explicit = reflector.get<string | undefined>(API_SCOPE, targets[0]!);
  if (explicit) return explicit;
  const byMethod = reflector.getAllAndOverride<ApiScopesByMethod | undefined>(API_SCOPES_BY_METHOD, targets);
  if (!byMethod) return reflector.get<string | undefined>(API_SCOPE, targets[1]!) ?? null;
  return (method === 'GET' || method === 'HEAD' ? byMethod.read : byMethod.write) ?? null;
};

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const t = TenantContext.get();

    if (this.reflector.getAllAndOverride<boolean>(VERIFIED_EMAIL, targets) && t.emailVerified === false) {
      throw new AppException('AUTH_EMAIL_UNVERIFIED');
    }

    const platformKey = this.reflector.getAllAndOverride<PlatformPermission>(PLATFORM_PERMISSION, targets);
    if (platformKey || this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets)) {
      if (!platformKey) throw new Error(`Platform route ${req.method} ${req.path} has no @RequirePlatformRole`);
      const allowed = PLATFORM_PERMISSIONS[platformKey] as readonly string[];
      if (!t.platformRole) throw new AppException('FORBIDDEN');
      // D41 / PRL-02: every platform role must have 2FA enabled — access blocked until then (testing exemption: tenant.resolver)
      if (!t.totpEnabled && !t.twoFaExempt) throw new AppException('TWO_FA_REQUIRED_FOR_ROLE');
      if (!allowed.includes(t.platformRole)) throw new AppException('FORBIDDEN');
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_ONLY, targets)) return true;

    const key = this.reflector.getAllAndOverride<MerchantPermission>(PERMISSION, targets);
    if (!key) throw new Error(`Route ${req.method} ${req.path} has no @RequirePermission`); // fail closed at dev time
    if (t.apiKeyId) {
      const scope = apiScopeOf(this.reflector, targets, req.method);
      if (!scope || !(req.apiKey.scopes as string[]).includes(scope)) {
        throw new AppException('API_SCOPE_FORBIDDEN', { scope: scope ?? '—' });
      }
      return true;
    }
    if (t.impersonation && req.method !== 'GET') throw new AppException('ADMIN_IMPERSONATION_FORBIDDEN_ACTION');
    const roles = MERCHANT_PERMISSIONS[key] as readonly string[];
    if (!t.role || !roles.includes(t.role)) throw new AppException('FORBIDDEN');
    // a section the Owner hid from this member (owner decision 2026-10-21)
    if (isHidden(t.hiddenSections, key)) throw new AppException('FORBIDDEN');
    if (t.readOnly && req.method !== 'GET') throw new AppException('READ_ONLY_MEMBER');
    return true;
  }
}
