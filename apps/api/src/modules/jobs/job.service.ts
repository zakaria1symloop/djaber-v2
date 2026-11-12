// 01-nest-module-map `jobs` — `Job` rows for long operations (api-contract §1.11): 202 { jobId } → GET /jobs/:id,
// WS `job.updated`, notification `job.finished` / `job.failed`. Used by imports, exports, and every later bulk / report job.
import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@djaber/shared';
import { prisma, TenantContext, type Job, type JobKind, type JobStatus, type Prisma, type Tx } from '@djaber/db';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { I18nService } from '../../core/i18n/i18n.service';
import { viewerLocale } from '../../core/i18n/viewer-locale';
import { OutboxService } from '../../core/outbox/outbox.service';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { StorageService } from '../../core/storage/storage.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { WsEmitter } from '../../core/ws/ws.emitter';
import { jobRefs } from '../notifications/notification.catalog';
import { NotificationProducer } from '../notifications/notification.producer';

export type JobError = { code: string; params?: Record<string, string | number> };
export type JobOutcome = { result?: unknown; resultUploadId?: string | null; status?: 'done' | 'partial'; notify?: boolean };
export type CreateJobInput = {
  kind: JobKind;
  /** BullMQ job name in queue `jobs` (03-events-and-jobs §3) */
  name: string;
  payload?: Record<string, unknown>;
  total?: number | null;
  expiresAt?: Date | null;
  /** initial `Job.result` (M8: report exports carry their label — report, period, format — from creation on) */
  result?: Record<string, unknown>;
};
export type JobDto = {
  id: string;
  kind: JobKind;
  /** job name of 03 §3 (`product-import-preview`, `export`, …): tells two jobs of the same kind apart */
  name: string | null;
  status: JobStatus;
  progress: number;
  total: number | null;
  result: unknown | null;
  resultUrl: string | null;
  error: { code: string; message: string; params: Record<string, string | number>; ref: string } | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
};
type JobHead = Pick<Job, 'id' | 'workspaceId' | 'createdById' | 'kind' | 'status' | 'progress'> & { result?: unknown; error?: string | null };

const TERMINAL: JobStatus[] = ['done', 'partial', 'failed', 'cancelled'];
const OPEN: JobStatus[] = ['queued', 'running'];
/** Signed link lifetime of a job result file (api-contract §1.11). */
const RESULT_URL_TTL_S = 24 * 3600;
/** WS payloads stay small: big results (import previews) are fetched with GET /jobs/:id. */
const WS_RESULT_MAX_CHARS = 4000;

@Injectable()
export class JobService {
  private readonly log = new Logger(JobService.name);
  constructor(
    private readonly outbox: OutboxService,
    private readonly queueOutbox: QueueOutbox,
    private readonly tenants: TenantResolver,
    private readonly storage: StorageService,
    private readonly i18n: I18nService,
    private readonly ws: WsEmitter,
    private readonly notifications: NotificationProducer,
  ) {}

  // --- producing ------------------------------------------------------------------------------------------------------
  /** Creates the row (status `queued`) and schedules the worker job, atomically with the caller's transaction when given. */
  async create(input: CreateJobInput, tx?: Tx): Promise<Job> {
    const t = TenantContext.get();
    const run = async (db: Tx) => {
      const job = await db.job.create({
        data: {
          workspaceId: t.workspaceId,
          kind: input.kind,
          queue: 'jobs',
          status: 'queued',
          total: input.total ?? null,
          // the page language of the request that queues the job: texts the job writes for the screen use it (viewerLocale)
          payload: { ...(input.payload ?? {}), name: input.name, ...(t.requestLocale ? { viewerLocale: t.requestLocale } : {}) } as Prisma.InputJsonValue,
          expiresAt: input.expiresAt ?? null,
          ...(input.result ? { result: input.result as Prisma.InputJsonValue } : {}),
          createdById: t.userId ?? null,
        },
      });
      await this.schedule(db, job, input.name);
      return job;
    };
    return tx ? run(tx) : prisma.$transaction((db) => run(db as Tx));
  }

  /** (Re-)schedules a worker job for an existing row; `suffix` keeps the deterministic id unique per step (`:commit`, `:map2`). */
  async schedule(tx: Tx, job: JobHead, name: string, suffix = '') {
    await this.queueOutbox.add(tx, 'jobs', name, { jobId: job.id, workspaceId: job.workspaceId }, `job:${job.id}${suffix}`, { attempts: 1 });
    await this.emitUpdated(tx, { ...job, result: null, error: null });
  }

  private async emitUpdated(tx: Tx, job: JobHead) {
    const result = job.result !== undefined && job.result !== null && JSON.stringify(job.result).length <= WS_RESULT_MAX_CHARS ? job.result : undefined;
    const payload = {
      id: job.id,
      job: { id: job.id, kind: job.kind, status: job.status, progress: job.progress, result, error: this.parseError(job.error ?? null) ?? undefined },
    };
    const stamp = `${job.id}:${job.status}:${job.progress}:${Date.now()}`;
    if (job.workspaceId) await this.outbox.ws(tx, `ws:${job.workspaceId}`, 'job.updated', payload, `job.updated:ws:${stamp}`);
    if (job.createdById) await this.outbox.ws(tx, `user:${job.createdById}`, 'job.updated', payload, `job.updated:user:${stamp}`);
  }

  // --- worker side ----------------------------------------------------------------------------------------------------
  /**
   * Wraps a job handler: loads the row, opens the tenant scope of its workspace (acting user = the job creator),
   * marks it `running`, stores the outcome. An `AppException` thrown by `fn` becomes `Job.status = failed` with its code
   * (no retry: these are business refusals); any other error is recorded as `INTERNAL` and re-thrown for the DLQ.
   */
  async run(jobId: string, fn: (job: Job) => Promise<JobOutcome | void>): Promise<void> {
    const job = await TenantContext.runSystem(() => prisma.job.findUnique({ where: { id: jobId } }));
    if (!job || !job.workspaceId) return;
    if (!OPEN.includes(job.status)) return; // already finished or cancelled: running twice is a no-op
    const workspaceId = job.workspaceId;
    const tenant = await this.tenants.forWorker(workspaceId);
    const createdById = job.createdById;
    const [membership, creator] = createdById
      ? await TenantContext.runSystem(() =>
          Promise.all([
            prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: createdById } } }),
            prisma.user.findUnique({ where: { id: createdById }, select: { locale: true } }),
          ]),
        )
      : [null, null];
    // screen texts written by the job (row errors, results) follow the person who queued it, not the shop (viewerLocale)
    const queuedIn = (job.payload as { viewerLocale?: unknown } | null)?.viewerLocale;
    const requestLocale = queuedIn === 'fr' || queuedIn === 'ar' || queuedIn === 'en' ? queuedIn : undefined;
    await TenantContext.run({ ...tenant, userId: createdById ?? undefined, role: membership?.role, requestLocale, userLocale: creator?.locale }, async () => {
      const running = await this.transition(job.id, OPEN, { status: 'running' });
      if (!running) return;
      try {
        const out = (await fn(running)) ?? {};
        await this.finish(job.id, out);
      } catch (e) {
        if (e instanceof AppException) {
          await this.fail(job.id, { code: e.code, params: e.params });
          return;
        }
        this.log.error({ jobId, err: e instanceof Error ? e.message : String(e) }, 'job failed');
        await this.fail(job.id, { code: 'INTERNAL' });
        throw e;
      }
    });
  }

  private async transition(id: string, from: JobStatus[], data: Prisma.JobUpdateManyMutationInput, after?: (tx: Tx, job: Job) => Promise<void>): Promise<Job | null> {
    return prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const r = await tx.job.updateMany({ where: { id, status: { in: from } }, data });
      if (!r.count) return null;
      const job = await tx.job.findUniqueOrThrow({ where: { id } });
      await this.emitUpdated(tx, job);
      if (after) await after(tx, job);
      return job;
    });
  }

  /** Progress 0–100 (ephemeral: straight to the socket from the worker; no outbox row per tick). */
  async progress(id: string, pct: number) {
    const progress = Math.max(0, Math.min(100, Math.round(pct)));
    const r = await prisma.job.updateMany({ where: { id, status: 'running' }, data: { progress } });
    if (!r.count) return;
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return;
    const payload = { id, job: { id, kind: job.kind, status: job.status, progress } };
    if (job.workspaceId) this.ws.emit(`ws:${job.workspaceId}`, 'job.updated', payload);
    if (job.createdById) this.ws.emit(`user:${job.createdById}`, 'job.updated', payload);
  }

  async isCancelled(id: string) {
    const job = await prisma.job.findUnique({ where: { id }, select: { status: true } });
    return !job || job.status === 'cancelled';
  }

  async finish(id: string, out: JobOutcome = {}) {
    const data: Prisma.JobUncheckedUpdateManyInput = { status: out.status ?? 'done', progress: 100, error: null };
    if (out.result !== undefined) data.result = out.result as Prisma.InputJsonValue;
    if (out.resultUploadId !== undefined) data.resultUploadId = out.resultUploadId;
    return this.transition(id, ['running'], data as Prisma.JobUpdateManyMutationInput, async (tx, job) => {
      if (out.notify === false || !job.workspaceId || !job.createdById) return;
      await this.notifications.emit(tx, {
        type: 'job_finished',
        workspaceId: job.workspaceId,
        userIds: [job.createdById],
        key: `job_finished:${job.id}:${job.updatedAt.getTime()}`,
        // `channelId` / `agentId` of the payload: the deep link opens the screen of the job (notification.catalog `jobPath`)
        data: { ...jobRefs(job.payload), jobId: job.id, kind: job.kind, name: this.nameOf(job), label: this.labelOf(job), ...this.importCounts(job.kind, out.result) },
      });
    });
  }

  /** `{label}` of `notification.job.finished|failed.title`: the job name of 03 §3, else its kind. */
  private labelOf(job: Pick<Job, 'payload' | 'kind'>): string {
    return this.nameOf(job) ?? job.kind;
  }

  /** An import that committed reports its counts: the notification uses the `job.finished.import` texts. */
  private importCounts(kind: JobKind, result: unknown): { imported?: number; skipped?: number } {
    const report = (result as { report?: { created?: unknown; updated?: unknown; skipped?: unknown } } | null | undefined)?.report;
    if (kind !== 'import' || !report || typeof report.created !== 'number') return {};
    return { imported: report.created + (typeof report.updated === 'number' ? report.updated : 0), skipped: typeof report.skipped === 'number' ? report.skipped : 0 };
  }

  async fail(id: string, error: JobError) {
    return this.transition(id, OPEN, { status: 'failed', error: JSON.stringify(error) }, async (tx, job) => {
      if (!job.workspaceId || !job.createdById) return;
      await this.notifications.emit(tx, {
        type: 'job_failed',
        workspaceId: job.workspaceId,
        userIds: [job.createdById],
        key: `job_failed:${job.id}:${job.updatedAt.getTime()}`,
        data: { ...jobRefs(job.payload), jobId: job.id, kind: job.kind, name: this.nameOf(job), label: this.labelOf(job), error: error.code },
      });
    });
  }

  // --- reading (HTTP) ---------------------------------------------------------------------------------------------------
  nameOf(job: Pick<Job, 'payload'>): string | null {
    const p = job.payload as { name?: unknown } | null;
    return typeof p?.name === 'string' ? p.name : null;
  }

  private parseError(raw: string | null): JobError | null {
    if (!raw) return null;
    try {
      const e = JSON.parse(raw) as JobError;
      return e && typeof e.code === 'string' ? e : { code: 'INTERNAL' };
    } catch {
      return { code: 'INTERNAL' };
    }
  }

  async toDto(job: Job, locale: string = viewerLocale()): Promise<JobDto> {
    const err = this.parseError(job.error);
    let resultUrl: string | null = null;
    if (job.resultUploadId && (!job.expiresAt || job.expiresAt > new Date())) {
      const upload = await prisma.upload.findFirst({ where: { id: job.resultUploadId, workspaceId: job.workspaceId } });
      if (upload) resultUrl = this.storage.signedUrl(upload.storageKey, RESULT_URL_TTL_S);
    }
    const code: ErrorCode = err && err.code in ERROR_CODES ? (err.code as ErrorCode) : 'INTERNAL';
    return {
      id: job.id,
      kind: job.kind,
      name: this.nameOf(job),
      status: job.status,
      progress: job.progress,
      total: job.total,
      result: job.result ?? null,
      resultUrl,
      error: err ? { code, message: this.i18n.t(locale, `error.${code}`, { ...(err.params ?? {}), ref: job.id }), params: err.params ?? {}, ref: job.id } : null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      finishedAt: TERMINAL.includes(job.status) ? job.updatedAt.toISOString() : null,
      expiresAt: job.expiresAt ? job.expiresAt.toISOString() : null,
    };
  }

  /** `Job` is not a tenant model (platform jobs have no workspace): the workspace filter is explicit here. */
  async byIdOrNotFound(id: string): Promise<Job> {
    const t = TenantContext.get();
    const job = await prisma.job.findFirst({ where: { id, workspaceId: t.workspaceId } });
    // an operator only sees the jobs they started (exports of the lists they may read)
    if (!job || (t.role === 'operator' && job.createdById !== t.userId)) throw notFound();
    return job;
  }

  async get(id: string, locale?: string) {
    return this.toDto(await this.byIdOrNotFound(id), locale);
  }

  async list(q: { page: number; pageSize: number; kind?: JobKind[]; status?: JobStatus[] }, locale?: string): Promise<Page<JobDto>> {
    const where: Prisma.JobWhereInput = {
      workspaceId: TenantContext.workspaceId(),
      ...(q.kind?.length ? { kind: { in: q.kind } } : {}),
      ...(q.status?.length ? { status: { in: q.status } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.job.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }),
      prisma.job.count({ where }),
    ]);
    return page(await Promise.all(rows.map((r) => this.toDto(r, locale))), total, q);
  }

  /** `POST /jobs/:id/cancel` — queued | running only (processors poll `isCancelled`). */
  async cancel(id: string, locale?: string) {
    const job = await this.byIdOrNotFound(id);
    const done = await this.transition(job.id, OPEN, { status: 'cancelled' });
    if (!done) throw new AppException('JOB_NOT_CANCELLABLE');
    return this.toDto(done, locale);
  }

  /** `POST /jobs/:id/retry` — failed | partial only: a new job with the same payload. */
  async retry(id: string) {
    const job = await this.byIdOrNotFound(id);
    const name = this.nameOf(job);
    if ((job.status !== 'failed' && job.status !== 'partial') || !name) throw new AppException('JOB_NOT_CANCELLABLE');
    const label = (job.payload as { label?: unknown } | null)?.label;
    const created = await this.create({ kind: job.kind, name, payload: (job.payload ?? {}) as Record<string, unknown>, total: job.total, expiresAt: job.expiresAt ? new Date(Date.now() + (job.expiresAt.getTime() - job.createdAt.getTime())) : null, ...(label && typeof label === 'object' ? { result: label as Record<string, unknown> } : {}) });
    return { jobId: created.id };
  }
}
