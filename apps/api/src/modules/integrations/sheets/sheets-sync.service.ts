// GSH-04 / GSH-05 / GSH-07 — worker side of Google Sheets (03-events §1 `sheets` topic, §3 `outbox/sheets-upsert`,
// `jobs/sheets-backfill`, §4 `sched-sheets-health`). One-way (GSH-08): rows are written, never deleted.
// Row located by `djaber_id` (column R), never by row number: column R is read before every write (no cache — a cached index
// would hit another order after a re-sort), so a re-sorted sheet gets the same row updated and a row deleted by hand is
// re-appended (FL-11).
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job as BullJob } from 'bullmq';
import { SHEETS_DEBOUNCE_MS, SHEETS_HEADERS, type SheetsFilters } from '@djaber/shared';
import { prisma, TenantContext, type SheetsConnection, type Tx } from '@djaber/db';
import { CryptoService } from '../../../core/crypto/crypto.service';
import { AppException } from '../../../core/errors/app.exception';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ProcessorRegistry } from '../../../core/queue/processor.registry';
import { QueueService } from '../../../core/queue/queue.service';
import { RedisService } from '../../../core/redis/redis.provider';
import { algiersDayEnd, algiersDayStart } from '../../../core/time/algiers';
import { JobService } from '../../jobs/job.service';
import { NotificationProducer } from '../../notifications/notification.producer';
import { matchesFilters, rowOf, sheetsRowOf, type Labeler, type SheetsOrder } from './sheets-row';
import { SHEETS_ERROR_CODE, SHEETS_GATEWAY, SheetsApiError, type SheetCell, type SheetsGateway } from './sheets.gateway';
import { stopdeskLabels, type StopdeskLabel } from '../../delivery/stopdesk-names';

const UPSERT_ATTEMPTS = 5;
const BATCH = 100;
const orderInclude = {
  channel: { select: { name: true, platform: true } },
  wilaya: { select: { nameFr: true } },
  commune: { select: { nameFr: true } },
  items: { select: { productName: true, variantName: true, quantity: true }, orderBy: { id: 'asc' as const } },
  shipments: { select: { provider: true, trackingNumber: true, status: true }, orderBy: { createdAt: 'desc' as const } },
} as const;

type UpsertData = { connectionId: string; orderId: string; workspaceId: string };

@Injectable()
export class SheetsSyncService implements OnModuleInit {
  private readonly log = new Logger(SheetsSyncService.name);
  constructor(
    @Inject(SHEETS_GATEWAY) private readonly gateway: SheetsGateway,
    private readonly registry: ProcessorRegistry,
    private readonly queue: QueueService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly i18n: I18nService,
    private readonly jobs: JobService,
    private readonly notifications: NotificationProducer,
  ) {}

  onModuleInit() {
    this.registry.onOutbox('sheets', (row) => this.schedule(row));
    this.registry.register('outbox', 'sheets-upsert', (data: UpsertData, job: BullJob) => this.upsertJob(data, job), { concurrency: 4 });
    this.registry.register('jobs', 'sheets-backfill', (data: { jobId: string }) => this.jobs.run(data.jobId, (j) => this.backfill(j.payload as { connectionId: string; from: string; to: string }, j.id)));
    this.registry.register('outbox', 'sheets-revoke', (data: { sealed: string }) => this.gateway.revoke(this.crypto.decrypt(data.sealed)).catch(() => undefined));
    this.registry.cron('sched-sheets-health', '15 * * * *', () => this.health());
  }

  refreshToken(c: Pick<SheetsConnection, 'refreshToken'>) {
    return this.crypto.decrypt(Buffer.from(c.refreshToken).toString('utf8'));
  }

  // --- outbox `sheets` ⇒ debounced job ------------------------------------------------------------------------------------------
  /** `sheets:<orderId>:<version>` rows ⇒ one delayed `sheets-upsert` per order (a newer change moves the delay, GSH-04 5 s). */
  async schedule(row: { payload: any; workspaceId: string | null }) {
    const orderId = row.payload?.orderId as string | undefined;
    if (!orderId || !row.workspaceId) return;
    const c = await TenantContext.runSystem(() => prisma.sheetsConnection.findFirst({ where: { workspaceId: row.workspaceId!, status: 'active', spreadsheetId: { not: null } }, select: { id: true } }));
    if (!c) return;
    await this.queue.replaceDelayed('outbox', 'sheets-upsert', { connectionId: c.id, orderId, workspaceId: row.workspaceId }, `sheets:${orderId}`, SHEETS_DEBOUNCE_MS, {
      attempts: UPSERT_ATTEMPTS,
      backoff: { type: 'exponential', delay: 30_000 },
    });
  }

  // --- one row ---------------------------------------------------------------------------------------------------------------------
  private labeler(locale: string): Labeler {
    return (kind, value) => {
      const key = kind === 'status' ? `enum.Order.status.${value}` : kind === 'method' ? `enum.Order.paymentMethod.${value}` : kind === 'source' ? `enum.Order.source.${value}` : `couriers.provider.${value}`;
      const text = this.i18n.t(locale, key);
      return text === key ? value : text;
    };
  }

  /** `desks`: relay point names of the batch (UX-049: the name, never the technical id). */
  private toSheetsOrder(o: any, desks: Map<string, StopdeskLabel>): SheetsOrder {
    const s = o.shipments?.find((x: { status: string }) => x.status !== 'cancelled') ?? null;
    return { ...o, stopdeskName: o.isStopdesk && o.stopdeskId ? (desks.get(o.stopdeskId)?.name ?? null) : null, shipment: s ? { provider: s.provider, trackingNumber: s.trackingNumber } : null };
  }

  private ids(c: SheetsConnection, rt: string): Promise<string[]> {
    return this.gateway.readIdColumn(rt, c.spreadsheetId!, c.sheetName);
  }

  /** Writes one order. Returns 'skipped' (filters / no sheet), 'updated' or 'appended'. Throws `SheetsApiError`. */
  async upsert(connectionId: string, orderId: string): Promise<'skipped' | 'updated' | 'appended'> {
    return TenantContext.runSystem(async () => {
      const c = await prisma.sheetsConnection.findUnique({ where: { id: connectionId }, include: { workspace: { select: { locale: true } } } });
      if (!c || !c.spreadsheetId || c.status === 'disconnected') return 'skipped';
      const order = await prisma.order.findFirst({ where: { id: orderId, workspaceId: c.workspaceId }, include: orderInclude });
      if (!order) return 'skipped';
      const o = this.toSheetsOrder(order, await stopdeskLabels([order.isStopdesk ? order.stopdeskId : null]));
      if (!matchesFilters(o, c.filters as Partial<SheetsFilters>)) return 'skipped';
      const values = sheetsRowOf(o, this.labeler(c.workspace.locale));
      const rt = this.refreshToken(c);
      // always re-read column R: a cached index would point at another order after a re-sort of the sheet (GSH-04 fix)
      let row = rowOf(await this.ids(c, rt), orderId);
      let outcome: 'updated' | 'appended';
      if (row) {
        await this.gateway.updateRow(rt, c.spreadsheetId, c.sheetName, row, values);
        outcome = 'updated';
      } else {
        row = (await this.gateway.appendRows(rt, c.spreadsheetId, c.sheetName, [values]))[0] ?? null;
        outcome = 'appended';
      }
      const now = new Date();
      await prisma.$transaction([
        prisma.sheetsRow.upsert({ where: { orderId }, create: { connectionId: c.id, orderId, rowIndex: row ?? null, syncedAt: now }, update: { connectionId: c.id, rowIndex: row ?? null, syncedAt: now } }),
        prisma.sheetsConnection.update({ where: { id: c.id }, data: { lastSyncAt: now, ...(c.status === 'error' ? { status: 'active', lastError: null } : {}) } }),
      ]);
      return outcome;
    });
  }

  /** `outbox/sheets-upsert`: token / missing sheet ⇒ error at once (no retry); quota and others retried, error after the last attempt. */
  async upsertJob(data: UpsertData, job?: Pick<BullJob, 'attemptsMade' | 'opts'>) {
    try {
      return { outcome: await this.upsert(data.connectionId, data.orderId) };
    } catch (e) {
      const kind = e instanceof SheetsApiError ? e.kind : 'other';
      const last = !job || (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? UPSERT_ATTEMPTS);
      if (kind === 'revoked' || kind === 'not_found' || last) {
        await this.markError(data.connectionId, SHEETS_ERROR_CODE[kind]);
        return { outcome: 'error', code: SHEETS_ERROR_CODE[kind] };
      }
      throw e;
    }
  }

  /** `SheetsConnection.status = error` + `sheets.error` to Owners / Admins (at most once an hour per connection). */
  async markError(connectionId: string, code: string, tx?: Tx) {
    await TenantContext.runSystem(async () => {
      const c = await prisma.sheetsConnection.findUnique({ where: { id: connectionId } });
      if (!c) return;
      const run = async (db: Tx) => {
        await db.sheetsConnection.update({ where: { id: c.id }, data: { status: 'error', lastError: code } });
        const hour = Math.floor(Date.now() / 3_600_000);
        await this.notifications.emit(db, { type: 'sheets_error', workspaceId: c.workspaceId, target: { roles: ['owner', 'admin'] }, key: `sheets_error:${c.id}:${hour}`, data: { code } });
      };
      if (tx) await run(tx);
      else await prisma.$transaction((db) => run(db as Tx));
    });
    this.log.warn({ connectionId, code }, 'google sheets sync error');
  }

  // --- backfill (GSH-05) -------------------------------------------------------------------------------------------------------------
  /** Orders of `[from, to]` (Algiers days) by `orderedAt` ascending, 100 per batch; existing rows updated, the others appended. */
  async backfill(p: { connectionId: string; from: string; to: string }, jobId: string) {
    const c = await TenantContext.runSystem(() => prisma.sheetsConnection.findUnique({ where: { id: p.connectionId }, include: { workspace: { select: { locale: true } } } }));
    if (!c || !c.spreadsheetId) throw new AppException('SHEETS_NOT_CONNECTED');
    const where = { workspaceId: c.workspaceId, orderedAt: { gte: algiersDayStart(p.from), lt: algiersDayEnd(p.to) } };
    const total = await prisma.order.count({ where });
    const rt = this.refreshToken(c);
    const label = this.labeler(c.workspace.locale);
    let cursor: string | undefined;
    let done = 0;
    let written = 0;
    let skipped = 0;
    try {
      for (;;) {
        if (await this.jobs.isCancelled(jobId)) break;
        const batch = await prisma.order.findMany({ where, include: orderInclude, orderBy: [{ orderedAt: 'asc' }, { id: 'asc' }], take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (!batch.length) break;
        cursor = batch[batch.length - 1]!.id;
        const ids = await this.ids(c, rt);
        const desks = await stopdeskLabels(batch.map((r) => (r.isStopdesk ? r.stopdeskId : null)));
        const updates: { row: number; values: SheetCell[] }[] = [];
        const appends: { id: string; values: SheetCell[] }[] = [];
        for (const raw of batch) {
          const o = this.toSheetsOrder(raw, desks);
          if (!matchesFilters(o, c.filters as Partial<SheetsFilters>)) {
            skipped++;
            continue;
          }
          const values = sheetsRowOf(o, label);
          const row = rowOf(ids, o.id);
          if (row) updates.push({ row, values });
          else appends.push({ id: o.id, values });
        }
        await this.gateway.batchUpdate(rt, c.spreadsheetId, c.sheetName, updates);
        const rows = appends.length ? await this.gateway.appendRows(rt, c.spreadsheetId, c.sheetName, appends.map((a) => a.values)) : [];
        const now = new Date();
        const byOrder = new Map<string, number | null>([...updates.map((u) => [ids[u.row - 1]!, u.row] as const), ...appends.map((a, i) => [a.id, rows[i] ?? null] as const)]);
        for (const [orderId, rowIndex] of byOrder) {
          await TenantContext.runSystem(() => prisma.sheetsRow.upsert({ where: { orderId }, create: { connectionId: c.id, orderId, rowIndex, syncedAt: now }, update: { connectionId: c.id, rowIndex, syncedAt: now } }));
        }
        written += byOrder.size;
        done += batch.length;
        await this.jobs.progress(jobId, total ? (done / total) * 100 : 100);
      }
    } catch (e) {
      if (e instanceof SheetsApiError) {
        await this.markError(c.id, SHEETS_ERROR_CODE[e.kind]);
        throw new AppException(SHEETS_ERROR_CODE[e.kind] === 'INTERNAL' ? 'INTERNAL' : SHEETS_ERROR_CODE[e.kind]);
      }
      throw e;
    }
    await TenantContext.runSystem(() => prisma.sheetsConnection.update({ where: { id: c.id }, data: { lastSyncAt: new Date() } }));
    return { result: { kind: 'sheets-backfill', from: p.from, to: p.to, total, written, skipped } };
  }

  // --- health (GSH-07) -------------------------------------------------------------------------------------------------------------
  /** Hourly: a connection in error retries one upsert (its latest order); success ⇒ `active`. */
  async health() {
    const broken = await TenantContext.runSystem(() => prisma.sheetsConnection.findMany({ where: { status: 'error', spreadsheetId: { not: null } }, take: 200 }));
    let healed = 0;
    for (const c of broken) {
      const last = await TenantContext.runSystem(() => prisma.order.findFirst({ where: { workspaceId: c.workspaceId }, orderBy: { updatedAt: 'desc' }, select: { id: true } }));
      try {
        if (last) await this.upsert(c.id, last.id);
        else await this.gateway.getSpreadsheet(this.refreshToken(c), c.spreadsheetId!);
        await TenantContext.runSystem(() => prisma.sheetsConnection.update({ where: { id: c.id }, data: { status: 'active', lastError: null } }));
        healed++;
      } catch (e) {
        this.log.debug({ connectionId: c.id, err: String(e) }, 'sheets still in error');
      }
    }
    return { checked: broken.length, healed };
  }

  /** Header labels of the tab in the workspace locale. */
  static header(locale: string) {
    return SHEETS_HEADERS[(locale as 'fr' | 'ar' | 'en') in SHEETS_HEADERS ? (locale as 'fr' | 'ar' | 'en') : 'fr'];
  }
}
