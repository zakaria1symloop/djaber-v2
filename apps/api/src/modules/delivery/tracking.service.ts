// DLV-04 / 04 §22 / 05-integrations §2.6 — tracking sync. `sched-tracking-sync` (every 10 min) marks parcels without any
// courier event for 30 d `stale`, then groups the due parcels (`nextSyncAt <= now`) by courier account into
// `courier.track-batch` jobs of ≤ 50 (batch endpoint when the provider has one). Each job waits for the account's
// limiter slot (2 / s by default). Courier webhooks are verified on the raw body, stored as `InboundEvent`, and the
// status is RE-FETCHED before being applied (06 §3). Applying a status = ShipmentEffects.apply.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SHIPMENT_STALE_STATUS_AFTER_DAYS, SHIPMENT_TRACKED_STATUSES } from '@djaber/shared';
import { Prisma, prisma, rawPrisma, TenantContext, type Job, type Shipment, type Tx } from '@djaber/db';
import { AppException, notFound } from '../../core/errors/app.exception';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { JobService } from '../jobs/job.service';
import { CourierAdapters } from './adapters/courier-registry';
import { isCourierError, TRACK_BATCH_MAX, type TrackResult } from './adapters/courier-adapter';
import { CourierAccountService } from './courier-account.service';
import { CourierLimiter } from './courier-limiter';
import { ShipmentEffects } from './shipment-effects.service';
import { encodeShipmentError } from './shipment.presenter';
import { nextSyncAt } from './tracking-rules';

const DAY = 86_400_000;
const HOUR = 3_600_000;
type TrackBatchData = { courierAccountId: string; shipmentIds: string[]; workspaceId: string; manual?: boolean };
const TRACKED = [...SHIPMENT_TRACKED_STATUSES] as Shipment['status'][];

@Injectable()
export class TrackingService implements OnModuleInit {
  private readonly log = new Logger(TrackingService.name);
  constructor(
    private readonly fx: ShipmentEffects,
    private readonly accounts: CourierAccountService,
    private readonly adapters: CourierAdapters,
    private readonly limiter: CourierLimiter,
    private readonly queueOutbox: QueueOutbox,
    private readonly registry: ProcessorRegistry,
    private readonly jobs: JobService,
  ) {}

  onModuleInit() {
    this.registry.cron('sched-tracking-sync', '*/10 * * * *', () => this.schedule());
    this.registry.register('courier', 'track-batch', (data: TrackBatchData) => this.trackBatch(data), { concurrency: 4 });
    this.registry.register('courier', 'courier-webhook', (data: { inboundEventId: string }) => this.processWebhook(data.inboundEventId), { concurrency: 8 });
    this.registry.register('jobs', 'tracking-refresh', (data: { jobId: string }) => this.refreshJob(data.jobId), { concurrency: 2 });
  }

  /** `POST /shipments/bulk/sync { ids }` → 202 `{ jobId }` (Job `tracking_refresh`). */
  async requestBulkSync(ids: string[]) {
    const job = await this.jobs.create({ kind: 'tracking_refresh', name: 'tracking-refresh', payload: { ids: [...new Set(ids)] }, total: ids.length });
    return { jobId: job.id };
  }

  async refreshJob(jobId: string) {
    await this.jobs.run(jobId, async (job: Job) => {
      const ids = ((job.payload ?? {}) as { ids?: string[] }).ids ?? [];
      const rows = await prisma.shipment.findMany({ where: { id: { in: ids }, trackingNumber: { not: null }, provider: { not: 'manual' }, courierAccountId: { not: null } }, select: { id: true, courierAccountId: true, workspaceId: true } });
      const groups = new Map<string, string[]>();
      for (const r of rows) groups.set(r.courierAccountId!, [...(groups.get(r.courierAccountId!) ?? []), r.id]);
      let done = 0;
      for (const [accountId, list] of groups) {
        for (let i = 0; i < list.length; i += TRACK_BATCH_MAX) {
          const chunk = list.slice(i, i + TRACK_BATCH_MAX);
          await this.trackBatch({ courierAccountId: accountId, shipmentIds: chunk, workspaceId: TenantContext.workspaceId(), manual: true });
          done += chunk.length;
          await this.jobs.progress(jobId, (done / Math.max(1, rows.length)) * 100);
        }
      }
      return { result: { synced: rows.length, skipped: ids.length - rows.length }, status: rows.length < ids.length ? 'partial' : 'done' };
    });
  }

  // --- scheduler ------------------------------------------------------------------------------------------------------------
  /** `sched-tracking-sync`: stale rule, then one `track-batch` job per (account, ≤ 50 due parcels). Returns the counts. */
  async schedule(now = new Date()) {
    const staled = await this.markStale(now);
    const due = await TenantContext.runSystem(() =>
      prisma.shipment.findMany({
        where: { status: { in: TRACKED }, nextSyncAt: { lte: now }, trackingNumber: { not: null }, provider: { not: 'manual' }, courierAccountId: { not: null }, courierAccount: { isActive: true } },
        select: { id: true, workspaceId: true, courierAccountId: true },
        orderBy: { nextSyncAt: 'asc' },
        take: 50_000,
      }),
    );
    const groups = new Map<string, { workspaceId: string; ids: string[] }>();
    for (const s of due) {
      const g = groups.get(s.courierAccountId!) ?? { workspaceId: s.workspaceId, ids: [] };
      g.ids.push(s.id);
      groups.set(s.courierAccountId!, g);
    }
    const bucket = Math.floor(now.getTime() / (10 * 60_000));
    let jobs = 0;
    for (const [accountId, g] of groups) {
      // claimed for 30 min so that a slow batch is not scheduled twice; the job writes the real next date
      for (let i = 0; i < g.ids.length; i += 5000) {
        const part = g.ids.slice(i, i + 5000);
        await TenantContext.runSystem(() => prisma.shipment.updateMany({ where: { id: { in: part } }, data: { nextSyncAt: new Date(now.getTime() + 30 * 60_000) } }));
      }
      for (let i = 0; i < g.ids.length; i += TRACK_BATCH_MAX) {
        const chunk = g.ids.slice(i, i + TRACK_BATCH_MAX);
        await TenantContext.runAs(g.workspaceId, () =>
          prisma.$transaction((db) => this.queueOutbox.add(db as Tx, 'courier', 'track-batch', { courierAccountId: accountId, shipmentIds: chunk, workspaceId: g.workspaceId }, `track:${accountId}:${bucket}:${i / TRACK_BATCH_MAX}`, { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } })),
        );
        jobs++;
      }
    }
    return { staled, due: due.length, jobs };
  }

  /** DLV-04: no courier event for 30 d ⇒ `stale`, polling stops (a system event is written; deliveryStatus unchanged). */
  async markStale(now = new Date()) {
    const limit = new Date(now.getTime() - SHIPMENT_STALE_STATUS_AFTER_DAYS * DAY);
    const rows = await TenantContext.runSystem(() => prisma.shipment.findMany({ where: { status: { in: TRACKED }, provider: { not: 'manual' }, lastEventAt: { lt: limit } }, select: { id: true, workspaceId: true }, take: 5000 }));
    for (const r of rows) {
      await TenantContext.runAs(r.workspaceId, () =>
        prisma.$transaction(async (db) => {
          const tx = db as Tx;
          const s = await this.fx.lockShipment(tx, r.id);
          if (!TRACKED.includes(s.status) || !s.lastEventAt || s.lastEventAt >= limit) return;
          const u = await tx.shipment.update({ where: { id: s.id }, data: { status: 'stale', nextSyncAt: null } });
          await tx.shipmentEvent.create({ data: { shipmentId: s.id, rawStatus: 'stale', mappedStatus: 'stale', at: now, source: 'system', description: `no courier event for ${SHIPMENT_STALE_STATUS_AFTER_DAYS} d` } });
          await this.fx.emit(tx, u);
        }),
      );
    }
    return rows.length;
  }

  // --- the batch (`courier.track-batch`) -------------------------------------------------------------------------------
  async trackBatch(data: TrackBatchData) {
    await TenantContext.runAs(data.workspaceId, async () => {
      const account = await prisma.courierAccount.findFirst({ where: { id: data.courierAccountId } });
      if (!account) return;
      const shipments = await prisma.shipment.findMany({ where: { id: { in: data.shipmentIds }, courierAccountId: account.id, trackingNumber: { not: null }, ...(data.manual ? {} : { status: { in: TRACKED } }) } });
      if (!shipments.length) return;
      const adapter = this.adapters.get(account.provider, account.baseUrl);
      const creds = this.accounts.open(account);
      const now = new Date();
      let results: TrackResult[] = [];
      const missing: Shipment[] = [];
      try {
        if (adapter.trackMany && shipments.length > 1) {
          await this.limiter.take(account.id, 'track');
          results = await adapter.trackMany(creds, shipments.map((s) => s.trackingNumber!));
        } else {
          for (const s of shipments) {
            await this.limiter.take(account.id, 'track');
            try {
              results.push(await adapter.track(creds, s.trackingNumber!));
            } catch (e) {
              if (isCourierError(e) && e.kind === 'not_found') missing.push(s);
              else throw e;
            }
          }
        }
      } catch (e) {
        if (!isCourierError(e)) throw e;
        // 03-events §3: failure ⇒ `Shipment.lastError`, `nextSyncAt` pushed +2 h; 401 flags the account
        await prisma.$transaction(async (db) => {
          const tx = db as Tx;
          if (e.kind === 'auth') await this.accounts.flagCredentials(tx, account.id);
          await tx.shipment.updateMany({ where: { id: { in: shipments.map((s) => s.id) } }, data: { lastError: encodeShipmentError(e.kind === 'auth' ? 'COURIER_CREDENTIALS_INVALID' : 'COURIER_UNAVAILABLE'), nextSyncAt: new Date(now.getTime() + 2 * HOUR) } });
        });
        if (data.manual) for (const s of shipments) await prisma.$transaction(async (db) => this.fx.emit(db as Tx, await (db as Tx).shipment.findUniqueOrThrow({ where: { id: s.id } })));
        return;
      }
      const byTracking = new Map(results.map((r) => [r.trackingNumber, r]));
      const unchanged: Shipment[] = [];
      for (const s of shipments) {
        const r = byTracking.get(s.trackingNumber!);
        if (!r) {
          if (!missing.includes(s)) missing.push(s);
          continue;
        }
        // nothing new: only the sync stamps (bulk update below) — the common case of a big batch
        const same = r.mapped === s.status && r.rawStatus === s.rawStatus && (!r.at || (!!s.lastEventAt && new Date(r.at).getTime() <= s.lastEventAt.getTime() + 1000));
        if (same && !data.manual) {
          unchanged.push(s);
          continue;
        }
        await prisma.$transaction((db) => this.fx.apply(db as Tx, s.id, { rawStatus: r.rawStatus, mapped: r.mapped, failureReason: r.failureReason, at: r.at, location: r.location, description: r.description, source: 'poll' }), { timeout: 20_000 });
      }
      if (unchanged.length) await this.stamp(unchanged, now);
      if (missing.length) {
        await prisma.$transaction(async (db) => {
          const tx = db as Tx;
          await tx.shipment.updateMany({ where: { id: { in: missing.map((s) => s.id) } }, data: { lastError: encodeShipmentError('TRACKING_NOT_FOUND'), lastSyncedAt: now } });
          for (const s of missing) await tx.shipment.update({ where: { id: s.id }, data: { nextSyncAt: nextSyncAt(s.createdAt, now) } });
          if (data.manual) for (const s of missing) await this.fx.emit(tx, await tx.shipment.findUniqueOrThrow({ where: { id: s.id } }));
        });
      }
    });
  }

  /** Same status as last time: `lastSyncedAt` + cadence (two set-based updates: early / late parcels). */
  private async stamp(rows: Shipment[], now: Date) {
    const early = rows.filter((s) => now.getTime() - s.createdAt.getTime() < 3 * DAY).map((s) => s.id);
    const late = rows.filter((s) => now.getTime() - s.createdAt.getTime() >= 3 * DAY).map((s) => s.id);
    if (early.length) await prisma.shipment.updateMany({ where: { id: { in: early } }, data: { lastSyncedAt: now, lastError: null, nextSyncAt: new Date(now.getTime() + 2 * HOUR) } });
    if (late.length) await prisma.shipment.updateMany({ where: { id: { in: late } }, data: { lastSyncedAt: now, lastError: null, nextSyncAt: new Date(now.getTime() + 12 * HOUR) } });
  }

  // --- courier webhooks (06 §3) ---------------------------------------------------------------------------------------------
  /**
   * `POST /webhooks/couriers/:courierAccountId`: signature check on the raw body (adapter `parseWebhook`, null ⇒ 401),
   * events stored as `InboundEvent` (dedup on `externalId`) with their `courier-webhook` jobs, atomically. No courier call.
   */
  async ingestWebhook(courierAccountId: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined): Promise<number> {
    const account = await TenantContext.runSystem(() => prisma.courierAccount.findUnique({ where: { id: courierAccountId } }));
    if (!account) throw notFound();
    const adapter = this.adapters.get(account.provider, account.baseUrl);
    if (!adapter.parseWebhook) throw notFound();
    const events = adapter.parseWebhook(headers, rawBody ?? Buffer.alloc(0), this.accounts.webhookSecretOf(account));
    if (events === null) throw new AppException('WEBHOOK_SIGNATURE_INVALID');
    if (!events.length) return 0;
    const rows = events.slice(0, 500).map((e) => {
      const externalId = `courier:${account.id}:${e.trackingNumber}:${e.rawStatus}:${e.at ?? ''}`.slice(0, 250);
      return { externalId, payload: { courierAccountId: account.id, workspaceId: account.workspaceId, trackingNumber: e.trackingNumber, rawStatus: e.rawStatus, at: e.at ?? null } };
    });
    const values = Prisma.join(rows.map((r) => Prisma.sql`(uuid_generate_v7(), 'courier'::"InboundProvider", ${r.externalId}, ${JSON.stringify(r.payload)}::jsonb, now())`));
    const opts = JSON.stringify({ attempts: 3, backoff: { type: 'fixed', delay: 10_000 } });
    return rawPrisma.$executeRaw`
      WITH ev AS (
        INSERT INTO "InboundEvent" ("id","provider","externalId","payload","receivedAt")
        VALUES ${values}
        ON CONFLICT ("externalId") DO NOTHING
        RETURNING "id","externalId"
      )
      INSERT INTO "Outbox" ("id","workspaceId","topic","key","payload","attempts","createdAt")
      SELECT uuid_generate_v7(), ${account.workspaceId}::uuid, 'job', 'cwh:' || ev."externalId",
             jsonb_build_object('queue', 'courier', 'name', 'courier-webhook', 'data', jsonb_build_object('inboundEventId', ev."id", 'workspaceId', ${account.workspaceId}::text), 'opts', ${opts}::jsonb),
             0, now()
      FROM ev
      ON CONFLICT ("topic","key") DO NOTHING`;
  }

  /** `courier.courier-webhook`: re-fetch `track()` (the webhook body is never trusted for the status), then apply. */
  async processWebhook(inboundEventId: string) {
    const ev = await TenantContext.runSystem(() => prisma.inboundEvent.findUnique({ where: { id: inboundEventId } }));
    if (!ev || ev.processedAt) return;
    const p = ev.payload as { courierAccountId: string; workspaceId: string; trackingNumber: string; rawStatus: string; at: string | null };
    const done = (error: string | null) => TenantContext.runSystem(() => prisma.inboundEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), error } }));
    await TenantContext.runAs(p.workspaceId, async () => {
      const s = await prisma.shipment.findFirst({ where: { courierAccountId: p.courierAccountId, trackingNumber: p.trackingNumber }, orderBy: { createdAt: 'desc' } });
      const account = await prisma.courierAccount.findFirst({ where: { id: p.courierAccountId } });
      if (!s || !account) return done('unknown_tracking');
      const adapter = this.adapters.get(account.provider, account.baseUrl);
      await this.limiter.take(account.id, 'track');
      let r: TrackResult;
      try {
        r = await adapter.track(this.accounts.open(account), p.trackingNumber);
      } catch (e) {
        if (isCourierError(e) && e.kind === 'not_found') return done('TRACKING_NOT_FOUND');
        throw e; // retried (3 / 10 s); the event stays unprocessed until then
      }
      await prisma.$transaction((db) => this.fx.apply(db as Tx, s.id, { rawStatus: r.rawStatus, mapped: r.mapped, failureReason: r.failureReason, at: r.at, location: r.location, description: r.description, source: 'webhook' }), { timeout: 20_000 });
      return done(null);
    });
  }
}
