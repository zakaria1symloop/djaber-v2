// API-03 (03 §18, 06 §4 / §8.10) — outbound webhook endpoints: CRUD, secret (AES-256-GCM at rest, shown once), test ping,
// re-enable after auto-disable, secret rotation, deliveries log + replay. Delivery itself: `WebhookDispatchService`.
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  WEBHOOK_DISABLE_AFTER,
  WEBHOOK_EVENTS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_S,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type WebhookCreatedDto,
  type WebhookDeliveriesQuery,
  type WebhookDeliveryDto,
  type WebhookEndpointDto,
  type WebhookEvent,
  type WebhooksOverviewDto,
} from '@djaber/shared';
import { prisma, TenantContext, type Prisma, type WebhookDelivery, type WebhookEndpoint } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AppException, conflict, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { act, auditActor, iso, planAllowance, withinLimit } from './integrations.util';
import { WebhookDispatchService, deliverySummary, maxAttemptsOf } from './webhook-dispatch.service';
import { isPrivateHttps, newWebhookSecret, secretHint, webhookUrlAllowed } from './webhook-signing';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly dispatch: WebhookDispatchService,
  ) {}

  // --- presenters -------------------------------------------------------------------------------------------------------
  private secretOf(e: Pick<WebhookEndpoint, 'secret'>) {
    return this.crypto.decrypt(Buffer.from(e.secret).toString('utf8'));
  }

  private async present(e: WebhookEndpoint): Promise<WebhookEndpointDto> {
    // the banner "désactivé après 50 échecs (502)" reads the last failed attempt
    const lastFailed = e.failureCount > 0 || !e.isActive ? await prisma.webhookDelivery.findFirst({ where: { endpointId: e.id, error: { not: null } }, orderBy: { createdAt: 'desc' } }) : null;
    const disabled = !e.isActive;
    return {
      id: e.id,
      url: e.url,
      events: e.events.filter((x): x is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(x)),
      status: disabled ? 'disabled' : 'active',
      isActive: e.isActive,
      failureCount: e.failureCount,
      disableAfter: WEBHOOK_DISABLE_AFTER,
      disabledAt: iso(e.disabledAt),
      disabledReason: e.disabledReason,
      lastFailure: lastFailed ? { responseCode: lastFailed.responseCode, error: lastFailed.error, at: lastFailed.createdAt.toISOString() } : null,
      lastDeliveryAt: iso(e.lastDeliveryAt),
      secretRotatedAt: iso(e.secretRotatedAt),
      secretHint: secretHint(this.secretOf(e)),
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      actions: [
        act('test', e.isActive, 'WEBHOOK_ENDPOINT_DISABLED'),
        act('edit', true),
        act('rotate_secret', true),
        // journey J12-5: greyed reasons in words (they were the generic CONFLICT « Modifié entre-temps, rechargez. »)
        act('enable', disabled, 'WEBHOOK_ENDPOINT_ACTIVE', disabled),
        act('deliveries', true),
        act('delete', true),
      ],
    };
  }

  presentDelivery(d: WebhookDelivery & { endpoint: Pick<WebhookEndpoint, 'url' | 'isActive'> }): WebhookDeliveryDto {
    const max = maxAttemptsOf(d.event);
    return {
      id: d.id,
      endpointId: d.endpointId,
      endpointUrl: d.endpoint.url,
      event: d.event,
      summary: deliverySummary(d.event, d.payload),
      status: d.status,
      attempt: d.attempt,
      maxAttempts: max,
      responseCode: d.responseCode,
      durationMs: d.durationMs,
      error: d.error,
      nextAttemptAt: iso(d.nextAttemptAt),
      replayOfId: d.replayOfId,
      createdAt: d.createdAt.toISOString(),
      payload: d.payload,
      actions: [act('replay', d.endpoint.isActive && d.status !== 'pending', d.endpoint.isActive ? 'WEBHOOK_DELIVERY_PENDING' : 'WEBHOOK_ENDPOINT_DISABLED')],
    };
  }

  private async allowance() {
    const ws = TenantContext.workspaceId();
    const [plan, used] = await Promise.all([planAllowance(ws), prisma.webhookEndpoint.count()]);
    return { featureEnabled: plan.features.includes('webhooks'), limit: plan.maxWebhooks, used };
  }

  async overview(): Promise<WebhooksOverviewDto> {
    const [rows, a] = await Promise.all([prisma.webhookEndpoint.findMany({ orderBy: { createdAt: 'asc' } }), this.allowance()]);
    return {
      endpoints: await Promise.all(rows.map((r) => this.present(r))),
      used: a.used,
      limit: a.limit,
      featureEnabled: a.featureEnabled,
      events: WEBHOOK_EVENTS,
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
      retryDelaysSeconds: WEBHOOK_RETRY_DELAYS_S,
      actions: [act('create', a.featureEnabled && withinLimit(a.limit, a.used), a.featureEnabled ? 'PLAN_LIMIT' : 'PLAN_FEATURE_REQUIRED', true)],
    };
  }

  private assertUrl(url: string) {
    if (!webhookUrlAllowed(url, this.config.isProd)) {
      // full-test 15/11 SETTINGS-12: an https URL on a private / local host is refused for that reason, not « HTTPS obligatoire »
      if (this.config.isProd && isPrivateHttps(url)) throw new AppException('WEBHOOK_URL_PRIVATE', {}, { url: 'validation.url_private' });
      throw new AppException('WEBHOOK_URL_INVALID', {}, { url: 'validation.url_https' });
    }
  }

  async byId(id: string): Promise<WebhookEndpoint> {
    const e = await prisma.webhookEndpoint.findFirst({ where: { id } });
    if (!e) throw notFound();
    return e;
  }

  async get(id: string) {
    return this.present(await this.byId(id));
  }

  async create(input: CreateWebhookInput): Promise<WebhookCreatedDto> {
    this.assertUrl(input.url);
    const t = TenantContext.get();
    const secret = newWebhookSecret(randomBytes(24));
    const row = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`webhooks:${t.workspaceId}`}))`;
      const plan = await planAllowance(t.workspaceId);
      if (!plan.features.includes('webhooks')) throw new AppException('PLAN_FEATURE_REQUIRED', { feature: 'webhooks' });
      const used = await tx.webhookEndpoint.count();
      if (!withinLimit(plan.maxWebhooks, used)) throw new AppException('PLAN_LIMIT', { resource: 'webhooks', limit: plan.maxWebhooks, current: used });
      return tx.webhookEndpoint.create({
        data: { workspaceId: t.workspaceId, url: input.url, events: input.events, secret: Buffer.from(this.crypto.encrypt(secret), 'utf8'), createdById: t.userId ?? (await this.creatorFallback(t.workspaceId)) },
      });
    });
    await this.audit.write({ ...auditActor(), action: 'webhook.create', entity: 'WebhookEndpoint', entityId: row.id, after: { url: row.url, events: row.events } });
    return { ...(await this.present(row)), secret };
  }

  /** An endpoint created with an API key (`webhooks:manage`) is attributed to the workspace owner. */
  private async creatorFallback(workspaceId: string): Promise<string> {
    const owner = await TenantContext.runSystem(() => prisma.membership.findFirst({ where: { workspaceId, role: 'owner' }, select: { userId: true } }));
    if (!owner) throw notFound();
    return owner.userId;
  }

  async update(id: string, input: UpdateWebhookInput): Promise<WebhookEndpointDto> {
    const before = await this.byId(id);
    if (input.url) this.assertUrl(input.url);
    const row = await prisma.webhookEndpoint.update({ where: { id }, data: { ...(input.url ? { url: input.url } : {}), ...(input.events ? { events: input.events } : {}) } });
    await this.audit.write({ ...auditActor(), action: 'webhook.update', entity: 'WebhookEndpoint', entityId: id, before: { url: before.url, events: before.events }, after: { url: row.url, events: row.events } });
    return this.present(row);
  }

  async remove(id: string) {
    const before = await this.byId(id);
    await prisma.webhookEndpoint.delete({ where: { id } });
    await this.audit.write({ ...auditActor(), action: 'webhook.delete', entity: 'WebhookEndpoint', entityId: id, before: { url: before.url, events: before.events } });
  }

  async rotateSecret(id: string): Promise<WebhookCreatedDto> {
    await this.byId(id);
    const secret = newWebhookSecret(randomBytes(24));
    const row = await prisma.webhookEndpoint.update({ where: { id }, data: { secret: Buffer.from(this.crypto.encrypt(secret), 'utf8'), secretRotatedAt: new Date() } });
    await this.audit.write({ ...auditActor(), action: 'webhook.rotate_secret', entity: 'WebhookEndpoint', entityId: id });
    return { ...(await this.present(row)), secret };
  }

  /** `POST /webhooks/:id/enable` — only a disabled endpoint; resets the consecutive failure counter. */
  async enable(id: string): Promise<WebhookEndpointDto> {
    const e = await this.byId(id);
    if (e.isActive) throw conflict({ status: 'active' });
    const row = await prisma.webhookEndpoint.update({ where: { id }, data: { isActive: true, failureCount: 0, disabledAt: null, disabledReason: null } });
    await this.audit.write({ ...auditActor(), action: 'webhook.enable', entity: 'WebhookEndpoint', entityId: id, before: { disabledAt: iso(e.disabledAt), failureCount: e.failureCount } });
    return this.present(row);
  }

  /** `POST /webhooks/:id/test` — a `ping` delivery (one attempt), sent by the worker. */
  async test(id: string): Promise<WebhookDeliveryDto> {
    const e = await this.byId(id);
    if (!e.isActive) throw new AppException('WEBHOOK_ENDPOINT_DISABLED');
    const d = await prisma.$transaction((tx) => this.dispatch.createDelivery(tx, e, 'ping', { endpointId: e.id }, `ping:${e.id}:${Date.now()}`));
    return this.presentDelivery({ ...d, endpoint: e });
  }

  private async deliveryOrNotFound(id: string) {
    const d = await prisma.webhookDelivery.findFirst({ where: { id, endpoint: { workspaceId: TenantContext.workspaceId() } }, include: { endpoint: true } });
    if (!d) throw notFound();
    return d;
  }

  /** `POST /webhooks/deliveries/:id/replay` — a new delivery with the same payload (`replayOfId`). */
  async replay(id: string): Promise<WebhookDeliveryDto> {
    const d = await this.deliveryOrNotFound(id);
    if (!d.endpoint.isActive) throw new AppException('WEBHOOK_ENDPOINT_DISABLED');
    if (d.status === 'pending') throw conflict({ status: d.status });
    const created = await prisma.$transaction((tx) => this.dispatch.enqueueDelivery(tx, d.endpoint, { event: d.event, payload: d.payload as Prisma.InputJsonValue, replayOfId: d.id }));
    await this.audit.write({ ...auditActor(), action: 'webhook.replay', entity: 'WebhookDelivery', entityId: created.id, after: { replayOf: d.id, event: d.event } });
    return this.presentDelivery({ ...created, endpoint: d.endpoint });
  }

  async deliveries(q: WebhookDeliveriesQuery, endpointId?: string): Promise<Page<WebhookDeliveryDto>> {
    if (endpointId) await this.byId(endpointId);
    const ep = endpointId ?? q.endpointId;
    const where: Prisma.WebhookDeliveryWhereInput = {
      endpoint: { workspaceId: TenantContext.workspaceId() },
      ...(ep ? { endpointId: ep } : {}),
      ...(q.status?.length ? { status: { in: q.status } } : {}),
      ...(q.event?.length ? { event: { in: q.event } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.webhookDelivery.findMany({ where, include: { endpoint: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }),
      prisma.webhookDelivery.count({ where }),
    ]);
    return page(rows.map((r) => this.presentDelivery(r)), total, q);
  }

  async delivery(id: string) {
    return this.presentDelivery(await this.deliveryOrNotFound(id));
  }
}
