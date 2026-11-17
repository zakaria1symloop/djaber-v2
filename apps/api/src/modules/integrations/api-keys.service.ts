// API-01 (03 §18) — merchant API keys: name, scopes (06 §5), environment, prefix shown, SHA-256 stored, last use, revoke.
// Plan: feature `api_keys` + `Plan.maxApiKeys` (active keys). The full key is returned once, at creation.
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { API_KEY_PREFIX_CHARS, API_KEY_RATE_LIMIT_PER_MIN, API_SCOPES, type ApiKeyCreatedDto, type ApiKeyDto, type ApiKeysOverviewDto, type ApiScope, type CreateApiKeyInput } from '@djaber/shared';
import { prisma, TenantContext, type Prisma } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { hashApiKey } from '../../core/auth/api-key-auth.service';
import { AppException, conflict, notFound } from '../../core/errors/app.exception';
import { act, auditActor, iso, planAllowance, withinLimit } from './integrations.util';

const include = { createdBy: { select: { id: true, firstName: true, lastName: true } } } as const satisfies Prisma.ApiKeyInclude;
type Row = Prisma.ApiKeyGetPayload<{ include: typeof include }>;

@Injectable()
export class ApiKeysService {
  constructor(private readonly audit: AuditService) {}

  private present(k: Row): ApiKeyDto {
    return {
      id: k.id,
      name: k.name,
      environment: k.environment,
      prefix: k.prefix,
      scopes: k.scopes.filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s)),
      status: k.revokedAt ? 'revoked' : 'active',
      lastUsedAt: iso(k.lastUsedAt),
      lastUsedIp: k.lastUsedIp,
      revokedAt: iso(k.revokedAt),
      createdBy: k.createdBy ? { id: k.createdBy.id, firstName: k.createdBy.firstName, lastName: k.createdBy.lastName } : null,
      createdAt: k.createdAt.toISOString(),
      // journey J12-5: the greyed « Révoquer » says why (« Clé API révoquée. »), never the generic CONFLICT
      actions: [act('revoke', !k.revokedAt, 'API_KEY_REVOKED')],
    };
  }

  private async allowance() {
    const ws = TenantContext.workspaceId();
    const [plan, used] = await Promise.all([planAllowance(ws), prisma.apiKey.count({ where: { revokedAt: null } })]);
    return { featureEnabled: plan.features.includes('api_keys'), limit: plan.maxApiKeys, used };
  }

  async overview(): Promise<ApiKeysOverviewDto> {
    const [rows, a] = await Promise.all([prisma.apiKey.findMany({ include, orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }] }), this.allowance()]);
    const canCreate = a.featureEnabled && withinLimit(a.limit, a.used);
    return {
      keys: rows.map((r) => this.present(r)),
      used: a.used,
      limit: a.limit,
      featureEnabled: a.featureEnabled,
      rateLimitPerMinute: API_KEY_RATE_LIMIT_PER_MIN,
      scopes: API_SCOPES,
      actions: [act('create', canCreate, a.featureEnabled ? 'PLAN_LIMIT' : 'PLAN_FEATURE_REQUIRED', true)],
    };
  }

  async create(input: CreateApiKeyInput): Promise<ApiKeyCreatedDto> {
    const t = TenantContext.get();
    const created = await prisma.$transaction(async (tx) => {
      // serialise concurrent creations of one workspace so the plan limit holds
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`api-keys:${t.workspaceId}`}))`;
      const plan = await planAllowance(t.workspaceId);
      if (!plan.features.includes('api_keys')) throw new AppException('PLAN_FEATURE_REQUIRED', { feature: 'api_keys' });
      const used = await tx.apiKey.count({ where: { revokedAt: null } });
      if (!withinLimit(plan.maxApiKeys, used)) throw new AppException('PLAN_LIMIT', { resource: 'api_keys', limit: plan.maxApiKeys, current: used });
      const raw = `dj_${input.environment}_${randomBytes(32).toString('base64url')}`;
      const prefix = raw.slice(0, `dj_${input.environment}_`.length + API_KEY_PREFIX_CHARS);
      const row = await tx.apiKey.create({
        data: { workspaceId: t.workspaceId, name: input.name, environment: input.environment, prefix, keyHash: hashApiKey(raw), scopes: input.scopes, createdById: t.userId! },
        include,
      });
      return { row, raw };
    });
    await this.audit.write({ ...auditActor(), action: 'api_key.create', entity: 'ApiKey', entityId: created.row.id, after: { name: created.row.name, prefix: created.row.prefix, scopes: created.row.scopes, environment: created.row.environment } });
    return { ...this.present(created.row), key: created.raw };
  }

  private async byId(id: string): Promise<Row> {
    const row = await prisma.apiKey.findFirst({ where: { id }, include });
    if (!row) throw notFound();
    return row;
  }

  async revoke(id: string): Promise<ApiKeyDto> {
    const row = await this.byId(id);
    if (row.revokedAt) throw conflict({ status: 'revoked' });
    const done = await prisma.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!done.count) throw conflict({ status: 'revoked' });
    await this.audit.write({ ...auditActor(), action: 'api_key.revoke', entity: 'ApiKey', entityId: id, before: { name: row.name, prefix: row.prefix } });
    return this.present(await this.byId(id));
  }
}
