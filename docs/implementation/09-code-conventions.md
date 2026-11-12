# 09 — Code conventions and scaffolds

Copy these files as they are; rename only the entity. Decisions made here (not re-opened in code): **zod + `nestjs-zod`** for DTOs (not class-validator — `packages/shared` zod schemas are the single validator for API, web, mobile and AI tools, 07 §2); **Vitest** for unit, **Jest + Supertest + embedded Postgres + redis-memory-server (no Docker, see root CLAUDE.md)** for integration/e2e API, **Playwright** for web e2e; **TanStack Query v5**, **react-hook-form**, **next-intl**; **Socket.IO**; **BullMQ**; **Pino**.

---

## 1. Naming, layout, lint

- Files kebab-case: `quick-reply.service.ts`, `quick-reply.controller.ts`, `quick-reply.repository.ts`, `quick-reply.module.ts`, `dto/create-quick-reply.dto.ts`, `quick-reply.permissions.ts`, `processors/<job>.processor.ts`, `events/<entity>-<verb>.event.ts`.
- Classes PascalCase (`QuickReplyService`), interfaces without `I` prefix, enums from `packages/shared` (`OrderStatus.new`).
- DB models singular PascalCase (Prisma); tables snake_case via `@@map`; columns camelCase (Prisma default) — **follow `prisma-schema.prisma` as written**.
- Routes plural kebab-case: `/workspace/quick-replies`, params `:id`.
- Tests: `*.spec.ts` (unit, next to the file), `*.int.spec.ts` (integration, under `apps/api/test/<module>/`), `*.e2e.ts` (Playwright, `apps/web/e2e/<area>/`), story `*.stories.tsx`. Test titles start with the AT id when one exists.
- ESLint: `@typescript-eslint/recommended-type-checked`, `import/order` (builtin, external, internal `@djaber/*`, relative), `no-restricted-imports` forbidding `@prisma/client` outside `packages/db` and `*.repository.ts`, forbidding `process.env` outside `core/config`, forbidding physical CSS classes (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`) in `apps/web` (custom rule `djaber/no-physical-direction`), forbidding string literals in JSX outside `*.stories.tsx` (`djaber/no-literal-jsx-text`). Prettier: 2 spaces, single quotes, trailing commas `all`, width 100.
- `tsconfig` strict, `noUncheckedIndexedAccess`, path aliases `@djaber/shared`, `@djaber/db`, `@djaber/ui`, `@api/*` (apps/api/src), `@web/*` (apps/web/src).
- Commit footer attribution as configured in the repo.

Folder layout: `01-nest-module-map.md` §1 (API) and `02-next-route-map.md` §1 (web).

---

## 2. Core scaffolds (`apps/api/src/core`)

### 2.1 Error envelope

```ts
// core/errors/app.exception.ts
import { HttpException } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@djaber/shared/errors';

export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    public readonly params: Record<string, string | number> = {},
    public readonly fields: Record<string, string> = {},
    public readonly details?: unknown,                 // provider message, per-item errors, `{ changedBy, changedAt, current }` on CONFLICT
    status: number = ERROR_CODES[code].status,
  ) {
    super({ code, params, fields, details }, status);
  }
}
export const notFound = () => new AppException('NOT_FOUND');
export const forbidden = () => new AppException('FORBIDDEN');
export const conflict = (details: unknown) => new AppException('CONFLICT', {}, {}, details);
```

Wire format emitted for every error (api-contract §1.5, exactly these six keys; `params`, `fields`, `details` present as `{}` / `{}` / `null` when empty; `ref` = the request id `X-Request-Id`, always present):

```json
{ "error": { "code": "ORDER_INVALID_TRANSITION", "message": "Transition impossible : confirmée → livrée.", "params": { "from": "confirmed", "to": "delivered" }, "fields": {}, "details": null, "ref": "01J9W2K4N8QZ6V7X3YB5C9D0EF" } }
```

```ts
// core/errors/app-exception.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { AppException } from './app.exception';
import { I18nService } from '../i18n/i18n.service';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(AppExceptionFilter.name);
  constructor(private readonly i18n: I18nService) {}

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const locale = req.locale ?? 'fr';
    const ref: string = req.id;                       // X-Request-Id set by RequestIdMiddleware (uuid v7), echoed on every response
    const body = (code: string, params: Record<string, string | number>, fields: Record<string, string>, details: unknown) =>
      ({ error: { code, message: this.i18n.t(locale, `error.${code}`, { ...params, ref }), params, fields, details: details ?? null, ref } });

    if (err instanceof AppException) {
      return res.status(err.getStatus()).json(body(err.code, err.params, err.fields, err.details));
    }
    if (err instanceof ZodValidationException) {
      const fields: Record<string, string> = {};
      for (const issue of err.getZodError().issues) fields[issue.path.join('.')] = issue.message; // messages are validation.* keys
      return res.status(422).json(body('VALIDATION_ERROR', {}, fields, null));
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const code = status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST';
      return res.status(status).json(body(code, {}, {}, null));
    }
    this.log.error({ ref, err }, 'unhandled');
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body('INTERNAL', {}, {}, null));
  }
}
```

### 2.2 Response envelope + warnings + pagination

```ts
// core/errors/warnings.bag.ts
import { Injectable, Scope } from '@nestjs/common';
@Injectable({ scope: Scope.REQUEST })
export class WarningsBag { readonly items: { code: string; params?: Record<string, unknown> }[] = []; add(code: string, params?: Record<string, unknown>) { this.items.push({ code, params }); } }
```

```ts
// core/http/envelope.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import { isPage } from './pagination';
import { WarningsBag } from '../errors/warnings.bag';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly warnings: WarningsBag) {}
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map((body) => {
      if (body === undefined) return { data: null, meta: { warnings: this.warnings.items } };
      if (isPage(body)) return { data: body.data, meta: { page: body.page, pageSize: body.pageSize, total: body.total, warnings: this.warnings.items } };
      if (body && typeof body === 'object' && 'nextCursor' in body && 'data' in body) return { data: body.data, meta: { nextCursor: body.nextCursor, hasMore: body.nextCursor !== null, warnings: this.warnings.items } };
      if (body && typeof body === 'object' && 'results' in body && Array.isArray((body as any).results)) { const r = (body as any).results as { ok: boolean }[]; return { data: { results: r }, meta: { ok: r.filter((x) => x.ok).length, failed: r.filter((x) => !x.ok).length, warnings: this.warnings.items } }; }
      return { data: body, meta: { warnings: this.warnings.items } };
    }));
  }
}
```

```ts
// core/http/pagination.ts
import { z } from 'zod';
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
  sort: z.string().regex(/^-?[a-zA-Z]+$/).optional(),            // "-createdAt"
});
export type PageQuery = z.infer<typeof PageQuery>;
export type Page<T> = { data: T[]; page: number; pageSize: number; total: number };
export const isPage = (b: unknown): b is Page<unknown> => !!b && typeof b === 'object' && 'data' in b && 'total' in b && 'pageSize' in b;
export const toSkipTake = (q: PageQuery) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
export const toOrderBy = (q: PageQuery, allowed: readonly string[], fallback = '-createdAt') => {
  const s = q.sort && allowed.includes(q.sort.replace(/^-/, '')) ? q.sort : fallback;
  return { [s.replace(/^-/, '')]: s.startsWith('-') ? 'desc' : 'asc' } as Record<string, 'asc' | 'desc'>;
};
export const page = <T>(data: T[], total: number, q: PageQuery): Page<T> => ({ data, total, page: q.page, pageSize: q.pageSize });
```

### 2.3 Tenancy

```ts
// core/tenancy/tenant.context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
export type MembershipRole = 'owner' | 'admin' | 'operator';
export type TenantInfo = {
  workspaceId: string; userId?: string; apiKeyId?: string;
  role?: MembershipRole; readOnly: boolean; platformRole?: string;
  locale: 'fr' | 'ar' | 'en'; stockMode: 'simple' | 'advanced'; suspended: boolean;
  limits: { maxPages: number; maxAgents: number; maxProducts: number; maxConversationsPerMonth: number; maxMembers: number; monthlyCredits: number };
  impersonation?: { sessionId: string; adminId: string };
};
const als = new AsyncLocalStorage<TenantInfo>();
export const TenantContext = {
  run: <T>(info: TenantInfo, fn: () => T) => als.run(info, fn),
  get: (): TenantInfo => { const t = als.getStore(); if (!t) throw new Error('TenantContextMissing'); return t; },
  maybe: () => als.getStore(),
  workspaceId: () => TenantContext.get().workspaceId,
};
```

```ts
// core/tenancy/tenant.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors/app.exception';
import { TenantContext, type TenantInfo } from './tenant.context';
import { TenantResolver } from './tenant.resolver';
import { IS_PUBLIC, IS_PLATFORM } from '../auth/decorators';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly resolver: TenantResolver) {}
  async canActivate(ctx: ExecutionContext) {
    const h = ctx.getHandler(), c = ctx.getClass();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [h, c])) return true;
    const req = ctx.switchToHttp().getRequest();
    if (this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, [h, c])) {
      req.tenant = await this.resolver.forPlatform(req.user);       // platformRole check happens in PlatformRoleGuard
      return this.wrap(req, ctx);
    }
    const info: TenantInfo | null = req.apiKey
      ? await this.resolver.forApiKey(req.apiKey)
      : await this.resolver.forUser(req.user, req.headers['x-workspace-id']);
    if (!info) throw new AppException('NOT_FOUND');
    if (info.suspended && !this.resolver.isSuspendedAllowed(req.path)) throw new AppException('WORKSPACE_SUSPENDED');
    req.tenant = info;
    return this.wrap(req, ctx);
  }
  // Runs the rest of the pipeline inside the ALS context (Nest executes guards → interceptors → handler in the same async chain).
  private wrap(req: any, _ctx: ExecutionContext) { TenantContext.run(req.tenant, () => {}); als_patch(req); return true; }
}
// als_patch: core/tenancy/als.middleware.ts installs an Express middleware that calls `TenantContext.run(req.tenant ?? placeholder, next)`
// so the context is created once per request; TenantGuard only fills `req.tenant` fields into the existing store (Object.assign).
```

```ts
// core/tenancy/als.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { TenantContext } from './tenant.context';
@Injectable()
export class AlsMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    req.tenant = { workspaceId: '', readOnly: false, locale: 'fr', stockMode: 'simple', suspended: false, limits: {} } as any;
    TenantContext.run(req.tenant, next);          // guards later Object.assign(req.tenant, resolved)
  }
}
```
(`TenantGuard.wrap` therefore does `Object.assign(TenantContext.get(), info)`; the snippet above is simplified.)

```ts
// packages/db/src/client.ts — tenant extension
import { PrismaClient } from '@prisma/client';
import { TenantContext } from '@api/core/tenancy/tenant.context';
import { TENANT_MODELS } from './tenant-models';             // generated: every model with a workspaceId field
export const prisma = new PrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const t = TenantContext.maybe();
        if (!t || !t.workspaceId) { if (process.env.ALLOW_NO_TENANT === '1') return query(args); throw new Error(`TenantContextMissing for ${model}.${operation}`); }
        const a: any = args;
        if (['findMany','findFirst','findFirstOrThrow','update','updateMany','delete','deleteMany','count','aggregate','groupBy'].includes(operation))
          a.where = { AND: [{ workspaceId: t.workspaceId }, a.where ?? {}] };
        if (operation === 'create') a.data = { workspaceId: t.workspaceId, ...a.data };
        if (operation === 'createMany') a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: any) => ({ workspaceId: t.workspaceId, ...d }));
        if (operation === 'upsert') { a.where = { ...a.where }; a.create = { workspaceId: t.workspaceId, ...a.create }; }
        return query(a);
      },
    },
  },
});
export type Db = typeof prisma;
```
Admin cross-workspace reads use `TenantContext.run({ ...platformInfo, workspaceId: targetWorkspaceId }, …)` per target, never `ALLOW_NO_TENANT`.

### 2.4 Auth decorators, RBAC

```ts
// core/auth/decorators.ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC = 'isPublic'; export const Public = () => SetMetadata(IS_PUBLIC, true);
export const IS_PLATFORM = 'isPlatform'; export const Platform = () => SetMetadata(IS_PLATFORM, true);
export const PERMISSION = 'permission'; export const RequirePermission = (key: MerchantPermission) => SetMetadata(PERMISSION, key);
export const PLATFORM_PERMISSION = 'platformPermission'; export const RequirePlatformRole = (key: PlatformPermission) => SetMetadata(PLATFORM_PERMISSION, key);
export const API_SCOPE = 'apiScope'; export const ApiScope = (scope: ApiKeyScope) => SetMetadata(API_SCOPE, scope);
export const VERIFIED_EMAIL = 'verifiedEmail'; export const RequireVerifiedEmail = () => SetMetadata(VERIFIED_EMAIL, true);
export const IDEMPOTENT = 'idempotent'; export const Idempotent = (o: { required: boolean } = { required: false }) => SetMetadata(IDEMPOTENT, o);
export const AUDITED = 'audited'; export const Audited = (o: AuditOptions) => SetMetadata(AUDITED, o);
import type { MerchantPermission, PlatformPermission } from '../rbac/permission-matrix';
import type { ApiKeyScope } from '@djaber/shared/enums';
export type AuditOptions = { entity: string; action: string; idFrom?: 'params.id' | 'result.id'; diff?: boolean; reasonFrom?: 'body.reason' };
```

```ts
// core/rbac/permission.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors/app.exception';
import { MERCHANT_PERMISSIONS, PLATFORM_PERMISSIONS, type MerchantPermission, type PlatformPermission } from './permission-matrix';
import { API_SCOPE, PERMISSION, PLATFORM_PERMISSION, IS_PUBLIC } from '../auth/decorators';
import { TenantContext } from '../tenancy/tenant.context';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const t = TenantContext.get();
    const platformKey = this.reflector.getAllAndOverride<PlatformPermission>(PLATFORM_PERMISSION, targets);
    if (platformKey) {
      if (!t.platformRole || !PLATFORM_PERMISSIONS[platformKey].includes(t.platformRole as never)) throw new AppException('FORBIDDEN');
      return true;
    }
    const key = this.reflector.getAllAndOverride<MerchantPermission>(PERMISSION, targets);
    if (!key) throw new Error(`Route ${req.method} ${req.path} has no @RequirePermission`);   // fail closed at dev time
    if (t.apiKeyId) {
      const scope = this.reflector.getAllAndOverride<string>(API_SCOPE, targets);
      if (!scope || !req.apiKey.scopes.includes(scope)) throw new AppException('API_SCOPE_FORBIDDEN', { scope: scope ?? '—' });
      return true;
    }
    if (t.impersonation && req.method !== 'GET') throw new AppException('ADMIN_IMPERSONATION_FORBIDDEN_ACTION');
    if (!t.role || !MERCHANT_PERMISSIONS[key].includes(t.role)) throw new AppException('FORBIDDEN');
    if (t.readOnly && req.method !== 'GET') throw new AppException('READ_ONLY_MEMBER');
    return true;
  }
}
```
`permission-matrix.ts` content: `01-nest-module-map.md` §3.2.

### 2.5 Idempotency interceptor

```ts
// core/idempotency/idempotency.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { from, of, switchMap, tap } from 'rxjs';
import Redis from 'ioredis';
import { IDEMPOTENT } from '../auth/decorators';
import { AppException } from '../errors/app.exception';
import { TenantContext } from '../tenancy/tenant.context';
import { prisma } from '@djaber/db';

const TTL_S = 24 * 3600;
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly redis: Redis) {}
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const opt = this.reflector.getAllAndOverride<{ required: boolean }>(IDEMPOTENT, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest(); const res = ctx.switchToHttp().getResponse();
    if (!opt || req.method !== 'POST') return next.handle();
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key) { if (opt.required) throw new AppException('IDEMPOTENCY_KEY_MISSING'); return next.handle(); }
    const ws = TenantContext.workspaceId();
    const hash = createHash('sha256').update(`${req.method}:${req.path}:${JSON.stringify(req.body ?? {})}`).digest('hex');
    const rkey = `idem:${ws}:${key}`;
    return from(this.redis.get(rkey)).pipe(switchMap(async (cached) => {
      if (cached === 'inflight') throw new AppException('CONFLICT');
      if (cached) { const c = JSON.parse(cached); if (c.hash !== hash) throw new AppException('IDEMPOTENCY_MISMATCH'); res.setHeader('Idempotent-Replayed', 'true'); res.status(c.status); return { replay: c.body }; }
      const ok = await this.redis.set(rkey, 'inflight', 'EX', 60, 'NX');
      if (!ok) throw new AppException('CONFLICT');
      return { replay: undefined };
    }), switchMap(({ replay }) => replay !== undefined ? of(replay) : next.handle().pipe(tap({
      next: async (body) => { const rec = JSON.stringify({ hash, status: res.statusCode, body }); await this.redis.set(rkey, rec, 'EX', TTL_S);
        await prisma.idempotencyKey.create({ data: { key, requestHash: hash, responseCode: res.statusCode, responseBody: body as object, expiresAt: new Date(Date.now() + TTL_S * 1000) } }); },
      error: async () => { await this.redis.del(rkey); },
    }))));
  }
}
```

### 2.6 Audit interceptor

```ts
// core/audit/audit.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap } from 'rxjs';
import { AUDITED, type AuditOptions } from '../auth/decorators';
import { OutboxService } from '../outbox/outbox.service';
import { TenantContext } from '../tenancy/tenant.context';
import { get } from 'lodash-es';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly outbox: OutboxService) {}
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const o = this.reflector.getAllAndOverride<AuditOptions>(AUDITED, [ctx.getHandler(), ctx.getClass()]);
    if (!o) return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const before = req.auditBefore;                       // services may set req.auditBefore for diffs
    return next.handle().pipe(tap(async (result) => {
      const t = TenantContext.get();
      await this.outbox.enqueueNoTx({ topic: 'audit', key: `audit:${req.id}`, payload: {
        workspaceId: t.workspaceId || null,
        actorType: t.impersonation ? 'admin_impersonation' : t.apiKeyId ? 'api_key' : t.platformRole && !t.role ? 'admin' : 'user',
        actorId: t.userId ?? t.apiKeyId ?? null,
        action: o.action, entity: o.entity,
        entityId: o.idFrom === 'result.id' ? (result as any)?.id : get(req, o.idFrom ?? 'params.id'),
        diff: o.diff ? { before, after: result } : null,
        reason: o.reasonFrom ? get(req, o.reasonFrom) : null,
        ip: req.ip, userAgent: req.headers['user-agent'], impersonationSessionId: t.impersonation?.sessionId ?? null,
      } });
    }));
  }
}
```

### 2.7 Outbox

```ts
// core/outbox/outbox.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '@djaber/db';
export type OutboxTopic = 'ws' | 'notification' | 'meta-send' | 'webhook' | 'sheets' | 'audit';
export type OutboxMessage = { topic: OutboxTopic; key: string; payload: Record<string, unknown>; workspaceId?: string | null };
@Injectable()
export class OutboxService {
  async enqueue(tx: Prisma.TransactionClient, m: OutboxMessage) {
    // Requires @@unique([topic, key]) on Outbox (00-build-order §0 open item 7). Table name per the schema's @@map (default "Outbox").
    await tx.$executeRaw`INSERT INTO "Outbox" ("id","workspaceId","topic","key","payload","attempts","createdAt") VALUES (uuid_generate_v7(), ${m.workspaceId ?? null}::uuid, ${m.topic}, ${m.key}, ${JSON.stringify(m.payload)}::jsonb, 0, now()) ON CONFLICT ("topic","key") DO NOTHING`;
  }
  enqueueNoTx(m: OutboxMessage) { return this.enqueue(prisma as unknown as Prisma.TransactionClient, m); }
  ws(tx: Prisma.TransactionClient, room: string, event: string, payload: Record<string, unknown>, key = `${event}:${payload.id ?? crypto.randomUUID()}`) {
    return this.enqueue(tx, { topic: 'ws', key: `ws:${key}`, payload: { room, event, payload } });
  }
}
```
`OutboxRelay` (worker): see `03-events-and-jobs.md` §1.

### 2.8 WebSocket gateway

```ts
// core/ws/ws.gateway.ts
import { OnGatewayConnection, WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ResyncService } from './resync.service';

@WebSocketGateway({ namespace: '/ws', cors: { origin: process.env.WEB_ORIGINS!.split(','), credentials: true } })
export class WsGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  constructor(private readonly jwt: JwtService, private readonly resync: ResyncService) {}
  async handleConnection(socket: Socket) {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; wid?: string; role?: string; pr: string; imp?: string; exp: number }>(socket.handshake.auth?.token);
      socket.data = { userId: claims.sub, workspaceId: claims.wid };
      await socket.join([`user:${claims.sub}`, ...(claims.wid ? [`ws:${claims.wid}`] : [])]);
      if (claims.pr && claims.pr !== 'none') await socket.join('admin:platform');
      const ms = claims.exp * 1000 - Date.now() - 60_000;
      if (ms > 0) setTimeout(() => socket.emit('auth.expiring', { expiresAt: new Date(claims.exp * 1000).toISOString() }), ms).unref();
    } catch { socket.disconnect(true); }
  }
  @SubscribeMessage('resync')
  async onResync(@ConnectedSocket() s: Socket, @MessageBody() body: { since: string }) {
    return this.resync.build(s.data.workspaceId, s.data.userId, new Date(body.since));
  }
}
// core/ws/ws.emitter.ts — used by OutboxRelay (worker) through the Redis adapter:
// const io = new Emitter(redis); io.of('/ws').to(room).emit(event, payload);
```
Server adapter: `app.useWebSocketAdapter(new RedisIoAdapter(app))` with `@socket.io/redis-adapter`; worker uses `@socket.io/redis-emitter`.

### 2.9 BullMQ processor pattern

```ts
// core/queue/queues.ts
export const QUEUES = { metaInbound: 'meta-inbound', aiReply: 'ai-reply', media: 'media', outbox: 'outbox', jobs: 'jobs', courier: 'courier', payments: 'payments', notifications: 'notifications', scheduled: 'scheduled' } as const;
export const CONCURRENCY: Record<string, number> = { 'meta-inbound': 16, 'ai-reply': 8, media: 8, outbox: 16, jobs: 2, courier: 4, payments: 4, notifications: 8, scheduled: 1 };
```

```ts
// modules/<m>/processors/<job>.processor.ts  — template
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUES } from '@api/core/queue/queues';
import { TenantContext } from '@api/core/tenancy/tenant.context';
import { TenantResolver } from '@api/core/tenancy/tenant.resolver';

type Payload = { workspaceId: string; shipmentId: string; requestId: string };

@Processor(QUEUES.courier, { concurrency: 4, limiter: { max: 5, duration: 1000, groupKey: 'courierAccountId' } })
export class CreateParcelProcessor extends WorkerHost {
  private readonly log = new Logger(CreateParcelProcessor.name);
  constructor(private readonly tenants: TenantResolver, private readonly shipments: ShipmentService) { super(); }

  async process(job: Job<Payload, void, 'create-parcel'>) {
    if (job.name !== 'create-parcel') return;                                 // one class per job name; other names handled by their own processor
    const tenant = await this.tenants.forWorker(job.data.workspaceId);
    return TenantContext.run(tenant, async () => {
      // 1. idempotency by state: a shipment already 'sent' means a previous attempt succeeded after the ack was lost
      const s = await this.shipments.get(job.data.shipmentId);
      if (s.status !== 'pending') return;
      try {
        await this.shipments.createAtCourier(s);                              // writes Shipment.sent + outbox inside one tx
      } catch (e) {
        if (e instanceof CourierError && e.kind !== 'unavailable') { await this.shipments.markFailed(s.id, e); throw new UnrecoverableError(e.code); } // no retry
        throw e;                                                                // retry per queue policy
      }
    });
  }
  @OnWorkerEvent('failed') onFailed(job: Job<Payload>, err: Error) {
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) this.log.error({ jobId: job.id, err }, 'final failure'); // DLQ: removeOnFail=false
  }
}
```
Enqueue helper: `queue.add('create-parcel', payload, { jobId: `parcel:${shipmentId}`, attempts: 6, backoff: { type: 'custom' }, removeOnComplete: 1000, removeOnFail: false })` with `settings.backoffStrategy = (attempt) => [60e3, 300e3, 1800e3, 7200e3, 7200e3, 7200e3][attempt - 1]`.

### 2.10 Scheduler pattern

```ts
// modules/billing/schedulers/credit-periods.scheduler.ts
@Injectable()
export class CreditPeriodsScheduler {
  constructor(private readonly lock: RedisLock, private readonly svc: CreditService) {}
  @Cron('0 0 * * *', { timeZone: 'Africa/Algiers', name: 'sched-credit-periods' })
  async run() { await this.lock.withLock('sched-credit-periods', 600, () => this.svc.openPeriodsDueToday()); }
}
```

---

## 3. Worked example — `QuickReply` end to end (M1, SET › Réponses rapides)

Spec: 03 §20, INB-03; frames `SET — Settings — Quick replies · System messages · Notifications · Stock mode · Danger zone`, `DLG — Settings & billing — dialogs catalogue` (Réponse rapide), `DLG — Inbox & queue` (Réponses rapides popover). Rules: title unique per workspace (`QUICK_REPLY_TITLE_TAKEN`), body ≤ 1 000 with variables `{prénom} {boutique} {total}`, optional shortcut `/xxx`, drag reorder, 4 defaults seeded per locale, permission `workspace.settings` for writes, `inbox.read` for reads.

### 3.1 Prisma model (as expected in `prisma-schema.prisma`)
```prisma
model QuickReply {
  id          String    @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  workspaceId String    @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  title       String    @db.VarChar(80)
  body        String    @db.VarChar(1000)
  shortcut    String?   @db.VarChar(30)
  locale      Locale    @default(fr)
  sortOrder   Int       @default(0)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@unique([workspaceId, locale, title])
  @@index([workspaceId, sortOrder])
}
```
Migration: `pnpm --filter db prisma migrate dev --name m1_quick_reply_create`.

### 3.2 Shared schema (`packages/shared/src/schemas/quick-reply.ts`)
```ts
import { z } from 'zod';
export const QuickReplyBody = z.string().trim().min(1, 'validation.required').max(1000, 'validation.length');
export const CreateQuickReplySchema = z.object({
  title: z.string().trim().min(1, 'validation.required').max(80, 'validation.length'),
  body: QuickReplyBody,
  shortcut: z.string().trim().regex(/^\/[a-z0-9-]{1,29}$/, 'validation.shortcut').optional().nullable(),
  locale: z.enum(['fr', 'ar', 'en']).default('fr'),
}).strict();
export const UpdateQuickReplySchema = CreateQuickReplySchema.partial().strict();
export const ReorderQuickRepliesSchema = z.object({ ids: z.array(z.string().uuid()).min(1) }).strict();
export type CreateQuickReply = z.infer<typeof CreateQuickReplySchema>;
export type UpdateQuickReply = z.infer<typeof UpdateQuickReplySchema>;
export const QuickReplyView = z.object({ id: z.string(), title: z.string(), body: z.string(), shortcut: z.string().nullable(), locale: z.enum(['fr','ar','en']), sortOrder: z.number(), createdAt: z.string(), updatedAt: z.string() });
export type QuickReplyView = z.infer<typeof QuickReplyView>;
```

### 3.3 DTOs (`apps/api/src/modules/workspace/dto/quick-reply.dto.ts`)
```ts
import { createZodDto } from 'nestjs-zod';
import { CreateQuickReplySchema, UpdateQuickReplySchema, ReorderQuickRepliesSchema } from '@djaber/shared/schemas/quick-reply';
export class CreateQuickReplyDto extends createZodDto(CreateQuickReplySchema) {}
export class UpdateQuickReplyDto extends createZodDto(UpdateQuickReplySchema) {}
export class ReorderQuickRepliesDto extends createZodDto(ReorderQuickRepliesSchema) {}
```

### 3.4 Repository
```ts
// modules/workspace/quick-reply.repository.ts
import { Injectable } from '@nestjs/common';
import { prisma } from '@djaber/db';
import { notFound } from '@api/core/errors/app.exception';
@Injectable()
export class QuickReplyRepository {
  list() { return prisma.quickReply.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }); }   // workspaceId injected by the tenant extension
  async byIdOrNotFound(id: string) { const r = await prisma.quickReply.findFirst({ where: { id } }); if (!r) throw notFound(); return r; }
  titleExists(title: string, exceptId?: string) { return prisma.quickReply.count({ where: { title, NOT: exceptId ? { id: exceptId } : undefined } }).then((n) => n > 0); }
  maxSortOrder() { return prisma.quickReply.aggregate({ _max: { sortOrder: true } }).then((a) => a._max.sortOrder ?? -1); }
  create(data: { title: string; body: string; shortcut: string | null; locale: 'fr'|'ar'|'en'; sortOrder: number }) { return prisma.quickReply.create({ data }); }
  update(id: string, data: Partial<{ title: string; body: string; shortcut: string | null; locale: 'fr'|'ar'|'en' }>) { return prisma.quickReply.update({ where: { id }, data }); }
  delete(id: string) { return prisma.quickReply.delete({ where: { id } }); }
  reorder(ids: string[]) { return prisma.$transaction(ids.map((id, i) => prisma.quickReply.update({ where: { id }, data: { sortOrder: i } }))); }
}
```

### 3.5 Service
```ts
// modules/workspace/quick-reply.service.ts
import { Injectable } from '@nestjs/common';
import { AppException } from '@api/core/errors/app.exception';
import { QuickReplyRepository } from './quick-reply.repository';
import type { CreateQuickReply, UpdateQuickReply } from '@djaber/shared/schemas/quick-reply';

@Injectable()
export class QuickReplyService {
  constructor(private readonly repo: QuickReplyRepository) {}
  list() { return this.repo.list(); }
  async create(input: CreateQuickReply) {
    if (await this.repo.titleExists(input.title)) throw new AppException('QUICK_REPLY_TITLE_TAKEN', {}, { title: 'validation.title_taken' });   // 03 §20 · DLG Réponse rapide
    const sortOrder = (await this.repo.maxSortOrder()) + 1;
    return this.repo.create({ ...input, shortcut: input.shortcut ?? null, sortOrder });
  }
  async update(id: string, input: UpdateQuickReply) {
    await this.repo.byIdOrNotFound(id);
    if (input.title && (await this.repo.titleExists(input.title, id))) throw new AppException('QUICK_REPLY_TITLE_TAKEN', {}, { title: 'validation.title_taken' });
    return this.repo.update(id, { ...input, shortcut: input.shortcut === undefined ? undefined : input.shortcut ?? null });
  }
  async remove(id: string) { await this.repo.byIdOrNotFound(id); await this.repo.delete(id); }
  async reorder(ids: string[]) {
    const existing = await this.repo.list();
    if (existing.length !== ids.length || !existing.every((r) => ids.includes(r.id))) throw new AppException('VALIDATION_ERROR', {}, { ids: 'validation.reorder_incomplete' });
    await this.repo.reorder(ids);
    return this.repo.list();
  }
  /** Used by the inbox composer: replaces {prénom} {boutique} {total} — INB-03 */
  render(body: string, vars: { firstName?: string; shop: string; total?: number }) {
    return body.replace('{prénom}', vars.firstName ?? '').replace('{boutique}', vars.shop).replace('{total}', vars.total != null ? `${vars.total} DA` : '');
  }
}
```

### 3.6 Controller
```ts
// modules/workspace/quick-reply.controller.ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audited, RequirePermission } from '@api/core/auth/decorators';
import { QuickReplyService } from './quick-reply.service';
import { CreateQuickReplyDto, ReorderQuickRepliesDto, UpdateQuickReplyDto } from './dto/quick-reply.dto';

@ApiTags('workspace')
@Controller('workspace/quick-replies')
export class QuickReplyController {
  constructor(private readonly svc: QuickReplyService) {}

  @Get() @RequirePermission('inbox.read')
  list() { return this.svc.list(); }

  @Post() @RequirePermission('workspace.settings') @Audited({ entity: 'QuickReply', action: 'create', idFrom: 'result.id' })
  create(@Body() dto: CreateQuickReplyDto) { return this.svc.create(dto); }

  @Patch('order') @RequirePermission('workspace.settings') @Audited({ entity: 'QuickReply', action: 'reorder' })
  reorder(@Body() dto: ReorderQuickRepliesDto) { return this.svc.reorder(dto.ids); }

  @Patch(':id') @RequirePermission('workspace.settings') @Audited({ entity: 'QuickReply', action: 'update', diff: true })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuickReplyDto) { return this.svc.update(id, dto); }

  @Delete(':id') @RequirePermission('workspace.settings') @Audited({ entity: 'QuickReply', action: 'delete' })
  async remove(@Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(id); }
}
```
Register in `workspace.module.ts` (`controllers: [..., QuickReplyController]`, `providers: [..., QuickReplyService, QuickReplyRepository]`).

### 3.7 Integration test (`apps/api/test/workspace/quick-reply.int.spec.ts`)
```ts
import { createTestApp, type TestApp } from '../support/test-app';     // boots Nest with embedded Postgres + redis-memory-server (no Docker, see root CLAUDE.md), returns helpers
import { asOwner, asAdmin, asOperator, otherWorkspace } from '../support/actors';

describe('workspace/quick-replies', () => {
  let app: TestApp;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(() => app.close());
  beforeEach(() => app.resetDb());

  it('AT-SET-01 owner creates, lists, updates, reorders and deletes a quick reply', async () => {
    const owner = await asOwner(app);
    const created = await owner.post('/workspace/quick-replies', { title: 'Livraison Sétif', body: 'Bonjour {prénom}, livraison 500 DA', shortcut: '/livr' }).expect(201);
    expect(created.body.data).toMatchObject({ title: 'Livraison Sétif', shortcut: '/livr', sortOrder: 4 });   // 4 seeded defaults before it
    const list = await owner.get('/workspace/quick-replies').expect(200);
    expect(list.body.data).toHaveLength(5);
    await owner.patch(`/workspace/quick-replies/${created.body.data.id}`, { body: 'Nouveau texte' }).expect(200);
    const ids = list.body.data.map((r: any) => r.id).reverse();
    const reordered = await owner.patch('/workspace/quick-replies/order', { ids }).expect(200);
    expect(reordered.body.data.map((r: any) => r.id)).toEqual(ids);
    await owner.delete(`/workspace/quick-replies/${created.body.data.id}`).expect(200);
    expect((await app.db.auditLog.count({ where: { entity: 'QuickReply' } }))).toBe(4);
  });

  it('rejects a duplicate title with QUICK_REPLY_TITLE_TAKEN inline on title', async () => {
    const owner = await asOwner(app);
    await owner.post('/workspace/quick-replies', { title: 'Horaires', body: 'x' }).expect(201);
    const res = await owner.post('/workspace/quick-replies', { title: 'Horaires', body: 'y' }).expect(409);
    expect(res.body.error).toMatchObject({ code: 'QUICK_REPLY_TITLE_TAKEN', fields: { title: 'validation.title_taken' } });
  });

  it('validates body length (422 VALIDATION_ERROR with fields)', async () => {
    const owner = await asOwner(app);
    const res = await owner.post('/workspace/quick-replies', { title: 'T', body: 'a'.repeat(1001) }).expect(422);
    expect(res.body.error.fields).toEqual({ body: 'validation.length' });
  });

  it('permissions: operator reads but cannot write (403 FORBIDDEN); admin can write', async () => {
    const op = await asOperator(app); const admin = await asAdmin(app);
    await op.get('/workspace/quick-replies').expect(200);
    const res = await op.post('/workspace/quick-replies', { title: 'X', body: 'y' }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await admin.post('/workspace/quick-replies', { title: 'X', body: 'y' }).expect(201);
  });

  it('AT-AUTH-11 cross-workspace id returns 404', async () => {
    const owner = await asOwner(app); const other = await otherWorkspace(app);
    const foreign = await other.post('/workspace/quick-replies', { title: 'Z', body: 'z' }).expect(201);
    await owner.patch(`/workspace/quick-replies/${foreign.body.data.id}`, { body: 'hack' }).expect(404);
    await owner.delete(`/workspace/quick-replies/${foreign.body.data.id}`).expect(404);
  });
});
```

### 3.8 i18n keys (`packages/shared/src/i18n/messages/fr.json` excerpt)
```json
{
  "settings.quickReplies.title": "Réponses rapides",
  "settings.quickReplies.description": "Insérées dans le composer avec le raccourci « / ». Glisser-déposer pour réordonner.",
  "settings.quickReplies.empty": "Créez votre première réponse rapide",
  "settings.quickReplies.add": "+ Ajouter une réponse rapide",
  "settings.quickReplies.field.title": "TITRE *",
  "settings.quickReplies.field.titleHint": "unique · QUICK_REPLY_TITLE_TAKEN",
  "settings.quickReplies.field.body": "TEXTE *",
  "settings.quickReplies.field.bodyHint": "variables : {prénom} {boutique} {total} · 1 000 caractères max",
  "settings.quickReplies.field.shortcut": "RACCOURCI",
  "settings.quickReplies.delete.title": "Supprimer « {title} » ?",
  "settings.quickReplies.delete.description": "La réponse rapide ne sera plus proposée dans le composer.",
  "validation.title_taken": "Titre déjà utilisé",
  "validation.shortcut": "Format : /mot (lettres, chiffres, tirets)",
  "validation.reorder_incomplete": "Liste incomplète",
  "error.QUICK_REPLY_TITLE_TAKEN": "Titre déjà utilisé."
}
```
Same keys in `ar.json`, `en.json` (`dialog.quickReply.title`, `action.*` already exist in 06).

### 3.9 Web — API hooks (`apps/web/src/features/quick-replies/api.ts`)
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@web/api/client';
import type { CreateQuickReply, QuickReplyView, UpdateQuickReply } from '@djaber/shared/schemas/quick-reply';
import { useWorkspaceId } from '@web/app/workspace';

export const quickRepliesKey = (ws: string) => [ws, 'quick-replies'] as const;
export function useQuickReplies() { const ws = useWorkspaceId(); return useQuery({ queryKey: quickRepliesKey(ws), queryFn: () => api.get<QuickReplyView[]>('/workspace/quick-replies') }); }
export function useCreateQuickReply() { const ws = useWorkspaceId(); const qc = useQueryClient();
  return useMutation({ mutationFn: (b: CreateQuickReply) => api.post<QuickReplyView>('/workspace/quick-replies', b), onSuccess: () => qc.invalidateQueries({ queryKey: quickRepliesKey(ws) }) }); }
export function useUpdateQuickReply() { const ws = useWorkspaceId(); const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: UpdateQuickReply & { id: string }) => api.patch<QuickReplyView>(`/workspace/quick-replies/${id}`, b), onSuccess: () => qc.invalidateQueries({ queryKey: quickRepliesKey(ws) }) }); }
export function useDeleteQuickReply() { const ws = useWorkspaceId(); const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/workspace/quick-replies/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: quickRepliesKey(ws) }) }); }
export function useReorderQuickReplies() { const ws = useWorkspaceId(); const qc = useQueryClient();
  return useMutation({ mutationFn: (ids: string[]) => api.patch<QuickReplyView[]>('/workspace/quick-replies/order', { ids }), onSuccess: (data) => qc.setQueryData(quickRepliesKey(ws), data) }); }
```

### 3.10 Web — page (`apps/web/src/app/[locale]/(app)/settings/quick-replies/page.tsx`)
```tsx
'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DataTable, ActionsDropdown, SideSheet, Dialog, EmptyState, StateWrapper, useToast, useCan, type RowAction } from '@djaber/ui';
import { useUrlFilters } from '@web/lib/use-url-filters';
import { z } from 'zod';
import { useQuickReplies, useDeleteQuickReply, useReorderQuickReplies } from '@web/features/quick-replies/api';
import { QuickReplyForm } from '@web/features/quick-replies/quick-reply-form';
import type { QuickReplyView } from '@djaber/shared/schemas/quick-reply';
import { mapApiError } from '@web/api/errors';

const Filters = z.object({ q: z.string().optional(), sheet: z.string().optional() });   // sheet = 'new' | <id>

export default function QuickRepliesPage() {
  const t = useTranslations();
  const canEdit = useCan('workspace.settings');
  const [filters, setFilters] = useUrlFilters(Filters);
  const q = useQuickReplies();
  const del = useDeleteQuickReply();
  const reorder = useReorderQuickReplies();
  const toast = useToast();
  const [toDelete, setToDelete] = useState<QuickReplyView | null>(null);

  const rows = (q.data ?? []).filter((r) => !filters.q || r.title.toLowerCase().includes(filters.q.toLowerCase()));
  const state = q.isPending ? 'skeleton' : q.isError ? 'error' : rows.length === 0 ? (filters.q ? 'filtered-empty' : 'empty') : 'ready';
  const openSheet = (id: string) => setFilters({ sheet: id });
  const currentIndex = rows.findIndex((r) => r.id === filters.sheet);

  const actions = (r: QuickReplyView): RowAction[] => [
    { id: 'edit', label: t('action.edit'), primary: true, shortcut: 'Enter', onSelect: () => openSheet(r.id), hidden: !canEdit },
    { id: 'moveUp', label: t('action.moveUp'), onSelect: () => reorder.mutate(move(rows.map((x) => x.id), r.id, -1)), disabledReason: rows[0]?.id === r.id ? 'FIRST_ITEM' : undefined, hidden: !canEdit },
    { id: 'delete', label: t('action.delete'), destructive: true, shortcut: 'Del', onSelect: () => setToDelete(r), hidden: !canEdit },
  ];

  return (
    <StateWrapper
      state={state}
      empty={{ icon: 'reply', title: t('settings.quickReplies.empty'), cta: canEdit ? { label: t('settings.quickReplies.add'), onClick: () => openSheet('new') } : undefined }}
      error={{ message: t('state.list.error.title'), onRetry: () => q.refetch() }}
    >
      <DataTable<QuickReplyView>
        columns={[
          { key: 'title', header: t('settings.quickReplies.field.title'), cell: (r) => r.title },
          { key: 'shortcut', header: t('settings.quickReplies.field.shortcut'), width: 120, ltr: true, cell: (r) => r.shortcut ?? '—' },
          { key: 'body', header: t('settings.quickReplies.field.body'), cell: (r) => <span className="line-clamp-1">{r.body}</span> },
        ]}
        rows={rows} rowKey={(r) => r.id} state={state === 'ready' ? 'ready' : 'skeleton'}
        rowActions={actions} onRowClick={(r) => openSheet(r.id)}
        pagination={{ page: 1, pageSize: 100, total: rows.length, onChange: () => {} }}
        empty={{ icon: 'reply', title: t('settings.quickReplies.empty') }}
      />

      <SideSheet
        open={!!filters.sheet} onClose={() => setFilters({ sheet: undefined })}
        title={filters.sheet === 'new' ? t('dialog.quickReply.title') : rows[currentIndex]?.title ?? ''}
        nav={currentIndex >= 0 ? { position: `${currentIndex + 1} / ${rows.length}`, onPrev: currentIndex > 0 ? () => openSheet(rows[currentIndex - 1]!.id) : undefined, onNext: currentIndex < rows.length - 1 ? () => openSheet(rows[currentIndex + 1]!.id) : undefined } : undefined}
      >
        <QuickReplyForm
          initial={filters.sheet === 'new' ? undefined : rows[currentIndex]}
          onSaved={() => { toast.push({ tone: 'success', message: t('toast.saved') }); setFilters({ sheet: undefined }); }}
        />
      </SideSheet>

      <Dialog
        open={!!toDelete} onClose={() => setToDelete(null)}
        title={t('settings.quickReplies.delete.title', { title: toDelete?.title ?? '' })}
        actions={[
          { label: t('action.cancel'), variant: 'secondary', onClick: () => setToDelete(null) },
          { label: t('action.delete'), variant: 'destructive', loading: del.isPending, onClick: async () => {
              try { await del.mutateAsync(toDelete!.id); setToDelete(null); toast.push({ tone: 'success', message: t('toast.saved') }); }
              catch (e) { toast.push({ tone: 'error', message: mapApiError(e).message, code: mapApiError(e).code }); } } },
        ]}
      >
        {t('settings.quickReplies.delete.description')}
      </Dialog>
    </StateWrapper>
  );
}
const move = (ids: string[], id: string, delta: number) => { const i = ids.indexOf(id); const j = i + delta; if (j < 0 || j >= ids.length) return ids; const c = [...ids]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; };
```

### 3.11 Web — form (`features/quick-replies/quick-reply-form.tsx`)
```tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Field, TextInput, TextArea, Button, FormErrorSummary, CodeInput } from '@djaber/ui';
import { CreateQuickReplySchema, type CreateQuickReply, type QuickReplyView } from '@djaber/shared/schemas/quick-reply';
import { useCreateQuickReply, useUpdateQuickReply } from './api';
import { applyServerErrors } from '@web/lib/forms';
import { useLeaveGuard } from '@web/lib/use-leave-guard';

export function QuickReplyForm({ initial, onSaved }: { initial?: QuickReplyView; onSaved(): void }) {
  const t = useTranslations();
  const form = useForm<CreateQuickReply>({ resolver: zodResolver(CreateQuickReplySchema), defaultValues: initial ?? { title: '', body: '', shortcut: null, locale: 'fr' } });
  const create = useCreateQuickReply(); const update = useUpdateQuickReply();
  useLeaveGuard(form.formState.isDirty, initial?.title ?? t('dialog.quickReply.title'));
  const submit = form.handleSubmit(async (values) => {
    try { if (initial) await update.mutateAsync({ id: initial.id, ...values }); else await create.mutateAsync(values); onSaved(); }
    catch (e) { applyServerErrors(form, e, t); }          // maps error.fields → setError(field, { message: t('validation.x') }); unknown → root
  });
  const busy = create.isPending || update.isPending;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={busy}>
      <FormErrorSummary form={form} />
      <Field label={t('settings.quickReplies.field.title')} hint={t('settings.quickReplies.field.titleHint')} error={form.formState.errors.title?.message}>
        <TextInput {...form.register('title')} disabled={busy} maxLength={80} />
      </Field>
      <Field label={t('settings.quickReplies.field.body')} hint={t('settings.quickReplies.field.bodyHint')} error={form.formState.errors.body?.message}>
        <TextArea {...form.register('body')} disabled={busy} maxLength={1000} rows={5} counter />
      </Field>
      <Field label={t('settings.quickReplies.field.shortcut')} error={form.formState.errors.shortcut?.message}>
        <CodeInput {...form.register('shortcut')} disabled={busy} placeholder="/livr" />   {/* codes, SKUs, references: CodeInput (LTR, no autofill / spell check); e-mails EmailInput, phones PhoneInput, URLs UrlInput — specs 04 §2 */}
      </Field>
      <div className="mt-auto flex justify-end gap-2">
        <Button type="submit" variant="primary" loading={busy}>{t('action.save')}</Button>
      </div>
    </form>
  );
}
```

### 3.12 Web — stories and e2e
`features/quick-replies/quick-replies.stories.tsx`: stories `Skeleton`, `Empty`, `FilteredEmpty`, `Error`, `List`, `SheetEdit`, `SheetNew`, `DeleteDialog`, `ReadOnlyOperator` (msw handlers per story). `apps/web/e2e/settings/quick-replies.e2e.ts`: `AT-SET-01 quick replies CRUD + reorder` (create via sheet, duplicate title shows inline error inside the sheet with content preserved, reorder, delete with dialog), `operator sees no write controls`.

### 3.13 Acceptance mapping
`AT-SET-01` (13) ⇒ `quick-reply.int.spec.ts` first test + `quick-replies.e2e.ts`; `AT-AUTH-11` row for this resource is produced by the route crawler automatically.

---

## 4. React patterns (`packages/ui` + `apps/web/src/lib`)

### 4.1 `useUrlFilters`
```ts
// apps/web/src/lib/use-url-filters.ts
'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { z } from 'zod';
export function useUrlFilters<S extends z.ZodObject<any>>(schema: S) {
  const sp = useSearchParams(); const router = useRouter(); const path = usePathname();
  const value = useMemo(() => schema.parse(Object.fromEntries(sp.entries())), [sp, schema]) as z.infer<S>;
  const set = useCallback((patch: Partial<z.infer<S>>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '' || v === null) next.delete(k); else next.set(k, Array.isArray(v) ? v.join(',') : String(v)); }
    if (!('page' in patch)) next.delete('page');                 // any filter change resets the page
    router.replace(`${path}?${next.toString()}`, { scroll: false });
  }, [sp, router, path]);
  return [value, set] as const;
}
```
Schema conventions: arrays as `z.string().transform((s) => s.split(',')).optional()`, ranges as two parameters named like the API (`minPrice` / `maxPrice`, api-contract §1.6), dates ISO `yyyy-MM-dd`, `tab`, `page`, `pageSize`, `sort`, `density`, `sheet`, `view`.

### 4.2 Data table with `Actions ⌄` (usage)
```tsx
<DataTable<OrderRow>
  columns={orderColumns(t)} rows={data.data} rowKey={(r) => r.id} state={state}
  sort={sort} onSortChange={(s) => setFilters({ sort: `${s.dir === 'desc' ? '-' : ''}${s.key}` })}
  selection={{ selected, onChange: setSelected }}
  bulkBar={<OrdersBulkBar ids={[...selected]} />}
  rowActions={(r) => orderRowActions(r, { t, can, open, setDialog })}     // built from r.actions: ActionDescriptor[] = { key, enabled, reasonCode?, primary?, shortcut? } returned by the API (contract §1.12)
  onRowClick={(r) => router.push(`/orders/${r.id}`)}
  density={filters.density} onDensityChange={(d) => setFilters({ density: d })}
  pagination={{ page: filters.page, pageSize: filters.pageSize, total: data.meta.total, onChange: (page, pageSize) => setFilters({ page, pageSize }) }}
  empty={{ icon: 'orders', title: t('state.list.empty.orders.title'), description: t('state.list.empty.orders.description'), cta: { label: t('action.newOrder'), onClick: () => router.push('/orders/new') } }}
/>
```
Rule: the API returns `actions: ActionDescriptor[]` (`{ key, enabled, reasonCode?, primary?, shortcut? }`, api-contract §1.12) for every list row and detail of Order, Shipment, Conversation, Product, Agent, Channel so the UI never computes business transitions; `toRowActions(actions, handlers, t)` maps `key` → label `action.<key>` + handler, `enabled=false` → `disabledReason=reasonCode`.

### 4.3 `ActionsDropdown` behaviour (inside `packages/ui/src/actions-dropdown.tsx`)
- Renders a chip `Actions ⌄`; menu via Radix `DropdownMenu`; items in given order; `primary` first with highlight; `disabledReason` ⇒ `aria-disabled`, greyed, and a footer line `"{label} : {reason}"` — the reason as a sentence from `lib/actions.ts` `reasonText` / `descriptorReason` (params filled, never the code — UX-056 / UX-059 / UX-060); a descriptor refused by the state machine (`isNotOffered`) is not rendered; `destructive` ⇒ red text; `shortcut` right-aligned mono.
- Keyboard: row focus + shortcut key fires `onSelect` without opening; `Enter` = primary.

### 4.4 Side sheet with ‹ ›
`SideSheet` props in `02-next-route-map.md` §5; `nav.onPrev/onNext` bound to `ArrowLeft/ArrowRight` (mirrored in RTL); URL `?sheet=<id>` drives open state so refresh/back work.

### 4.5 Dialog with destructive action
```tsx
<Dialog open title={t('dialog.cancelOrder.title', { number })} context={`${t(`enum.Order.status.${order.status}`)} · ${order.clientName} · ${fmtDa(order.total)}`}
  footerNote={t('orders.cancel.footer')}      // "Stock réservé libéré · DELIVERY_ORDER_ALREADY_SENT si expédiée → passer par « Retour »"
  actions={[{ label: t('action.keep'), variant: 'secondary', onClick: close }, { label: t('action.cancelOrder'), variant: 'destructive', disabled: !reason, onClick: submit }]}>
  <ReasonRadioGroup … /> <TextArea … /> <Checkbox label={t('orders.cancel.notifyCustomer')} />
</Dialog>
```
Destructive button never receives initial focus; `Enter` ignored while focus is in a textarea; server errors rendered by `applyServerErrors` inside the dialog.

### 4.6 Toast / banner hooks
```ts
const toast = useToast(); toast.push({ tone: 'progress', message: t('toast.export.progress', { entity, pct, rows }), progress: pct, action: { label: t('action.view'), onClick } });
const banners = useBanners(); banners.set('credits80', { tone: 'warning', message: t('banner.credits80', {...}), action: { label: t('action.buyCredits'), href: '/settings/credits' } }); banners.clear('credits80');
```
`BannerStack` picks the highest-priority banner present (`02-next-route-map.md` §2.1 order). Global banners are set by `useWorkspaceStatus()` from `GET /workspace` + WS `workspace.updated` / `credits.updated` / `channel.updated`.

### 4.7 `StateWrapper`
```tsx
<StateWrapper state={'skeleton'|'empty'|'filtered-empty'|'error'|'offline'|'ready'} skeleton={<ListSkeleton rows={5} />} empty={…} error={…} onClearFilters={…}>{children}</StateWrapper>
```
`skeleton` renders after a 300 ms delay; `offline` renders children with the stale banner and a `pointer-events-none` overlay on mutation controls (`data-mutation` attribute).

### 4.8 `useCan`
```ts
export function useCan(key: MerchantPermission) { const { role, readOnly } = useMembership(); return !readOnly && MERCHANT_PERMISSIONS[key].includes(role); }
```
Used to hide controls; the API still enforces.

### 4.9 `<Ltr>` and formatters
```tsx
export const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr" className="inline-block">{children}</bdi>;
export const fmtDa = (n: number) => `${new Intl.NumberFormat('fr-FR', { useGrouping: true, maximumFractionDigits: 0 }).format(n).replace(/ | /g, ' ')} DA`;
export const fmtPhone = (p: string) => p.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4');
export const fmtDate = (iso: string, locale: Locale) => formatInTimeZone(iso, 'Africa/Algiers', 'dd MMM yyyy', { locale: dateLocales[locale] });
```

---

## 5. Test scaffolds

```ts
// apps/api/test/support/test-app.ts — boots Nest with embedded Postgres + redis-memory-server (no Docker, see root CLAUDE.md) (postgres, redis, minio), runs migrations + seeds, exposes supertest agents and prisma
export async function createTestApp(): Promise<TestApp> { … }
export type TestApp = { close(): Promise<void>; resetDb(): Promise<void>; db: Db; http: supertest.SuperTest<supertest.Test>; fakes: { meta: FakeMeta; courier: FakeCourier; gateway: FakeGateway; google: FakeGoogle; ai: FakeAi; mail: FakeMail; push: FakePush } };
// apps/api/test/support/actors.ts — creates users/workspaces and returns agents with Authorization + X-Workspace-Id set
export async function asOwner(app, ws = 'A'): Promise<Agent>; export async function asAdmin(app, ws = 'A'); export async function asOperator(app, ws = 'A'); export async function otherWorkspace(app): Promise<Agent /* owner of workspace B */>; export async function asApiKey(app, scopes: ApiKeyScope[]); export async function asPlatform(app, role: PlatformRole);
// apps/api/test/support/factories/*.ts — one factory per model: `await factories.order(app.db, { status: 'confirmed' })`
```
Unit test file next to the unit: `order-state-machine.spec.ts` with `describe('04 §1.2 transitions')` and a table-driven `it.each`.

---

## 6. Do / Don't

**Do**
- Copy the scaffolds; keep decorators in this order: HTTP verb, `@RequirePermission`/`@RequirePlatformRole`, `@ApiScope`, `@RequireVerifiedEmail`, `@Idempotent`, `@Audited`.
- Return `actions: ActionDescriptor[]` from list/detail endpoints for state-driven row menus.
- Check `00-build-order.md` §0 before naming anything: schema/contract names win.
- Throw `AppException` with `fields` for anything the UI must show inline.
- Keep repositories the only place that touches Prisma.

**Don't**
- Don't use `class-validator`; don't duplicate zod schemas between API and web.
- Don't read `TenantContext` in controllers (services and repositories only).
- Don't put business transitions in the UI; consume `actions`.
- Don't write tests that depend on seed order beyond the documented 4 quick replies / 7 units / 69 wilayas.
