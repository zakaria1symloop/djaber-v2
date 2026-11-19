// 09-code-conventions §2.6 / 01-nest-module-map §3.4
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap } from 'rxjs';
import { TenantContext } from '@djaber/db';
import { AUDITED, type AuditOptions } from '../auth/decorators';
import { AuditService } from './audit.service';

const getPath = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly log = new Logger(AuditInterceptor.name);
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    if (ctx.getType() !== 'http') return next.handle();
    const o = this.reflector.getAllAndOverride<AuditOptions>(AUDITED, [ctx.getHandler(), ctx.getClass()]);
    if (!o) return next.handle();
    const req = ctx.switchToHttp().getRequest();
    return next.handle().pipe(
      tap((result) => {
        const t = TenantContext.maybe();
        const entityId =
          o.idFrom?.startsWith('result.') ? getPath(result, o.idFrom.slice('result.'.length)) : getPath(req, o.idFrom ?? 'params.id');
        this.audit
          .write({
            workspaceId: t?.workspaceId || null,
            actorType: t?.impersonation ? 'admin' : t?.apiKeyId ? 'api_key' : t?.platformRole && !t.role ? 'admin' : 'user',
            actorId: t?.userId ?? null,
            actorRole: t?.role ?? t?.platformRole ?? null,
            action: o.action,
            entity: o.entity,
            entityId: entityId ? String(entityId) : null,
            before: o.diff ? (req.auditBefore ?? null) : null, // services may set req.auditBefore for diffs
            after: o.diff ? ((result as object) ?? null) : null,
            reason: o.reasonFrom ? ((getPath(req, o.reasonFrom) as string | undefined) ?? null) : null,
            ip: req.ip ?? null,
            userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
            impersonationSessionId: t?.impersonation?.sessionId ?? null,
          })
          .catch((e) => this.log.error({ err: String(e) }, 'audit write failed'));
      }),
    );
  }
}
