// 07-non-functional §4 / 04 §9 / 04 §13 "Retention" — compliance purges, a step of `sched-retention` (01:00 Africa/Algiers,
// one scheduler keyed by its name, so the job id is deterministic). Every rule deletes (or redacts) only rows past their
// period, in batches of `BATCH`, at most `MAX_BATCHES` per rule and run (the next night continues): running it twice is a
// no-op. Payment events (5 years) are purged by the messaging step with the other inbound events.
//   AuditLog                         24 months
//   Report (closed)                  2 years after its decision          (04 §13 "Reports and blocks kept 2 years")
//   CustomerBlock (lifted)           2 years after it was lifted
//   PlatformBlacklist (revoked)      2 years after it was revoked
//   AiToolCall args / results        redacted after 12 months            (« tool args with PII masked after 12 months »)
//   AiRun (+ its tool calls)         24 months
//   Job rows (finished)              90 days
// Invoices, billing payments and credit-pack purchases are never purged here (10 years, kept through the workspace purge).
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, prisma, TenantContext } from '@djaber/db';
import { ProcessorRegistry } from '../queue/processor.registry';

const DAY = 86_400_000;
export const AUDIT_RETENTION_MONTHS = 24;
export const SAFETY_RETENTION_MONTHS = 24;
export const AI_TOOL_ARGS_MASK_MONTHS = 12;
export const AI_RUN_RETENTION_MONTHS = 24;
export const JOB_RETENTION_DAYS = 90;
const BATCH = 1000;
const MAX_BATCHES = 50;
const REDACTED = { redacted: true } as const;
const CLOSED_REPORTS = ['actioned', 'dismissed'] as const;
const FINISHED_JOBS = ['done', 'partial', 'failed', 'cancelled'] as const;

/** `now` minus `months` calendar months (UTC instant); a day missing in the target month clamps to its last day. */
export const monthsAgo = (now: Date, months: number) => {
  const d = new Date(now.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
};

export type ComplianceRetentionResult = { auditLogs: number; reports: number; blocks: number; blacklist: number; aiToolCallsRedacted: number; aiRuns: number; jobs: number };

@Injectable()
export class ComplianceRetentionService implements OnModuleInit {
  private readonly log = new Logger(ComplianceRetentionService.name);
  constructor(private readonly registry: ProcessorRegistry) {}

  onModuleInit() {
    this.registry.extendCron('sched-retention', 'compliance', () => this.purge());
  }

  /** Deletes the rows `ids()` returns, batch by batch. */
  private async batched(ids: () => Promise<{ id: string }[]>, remove: (ids: string[]) => Promise<{ count: number }>) {
    let n = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const rows = await ids();
      if (!rows.length) break;
      n += (await remove(rows.map((r) => r.id))).count;
      if (rows.length < BATCH) break;
    }
    return n;
  }

  async purge(now = new Date()): Promise<ComplianceRetentionResult> {
    return TenantContext.runSystem(async () => {
      const audit = monthsAgo(now, AUDIT_RETENTION_MONTHS);
      const safety = monthsAgo(now, SAFETY_RETENTION_MONTHS);
      const mask = monthsAgo(now, AI_TOOL_ARGS_MASK_MONTHS);
      const runs = monthsAgo(now, AI_RUN_RETENTION_MONTHS);
      const jobs = new Date(now.getTime() - JOB_RETENTION_DAYS * DAY);

      const auditLogs = await this.batched(
        () => prisma.auditLog.findMany({ where: { at: { lt: audit } }, select: { id: true }, take: BATCH }),
        (ids) => prisma.auditLog.deleteMany({ where: { id: { in: ids } } }),
      );
      // closed reports only (an open / reviewing report is still worked on); blocks and blacklist rows linked to them lose the link
      const reportWhere: Prisma.ReportWhereInput = { status: { in: [...CLOSED_REPORTS] }, OR: [{ resolvedAt: { lt: safety } }, { resolvedAt: null, updatedAt: { lt: safety } }] };
      const reports = await this.batched(
        () => prisma.report.findMany({ where: reportWhere, select: { id: true }, take: BATCH }),
        async (ids) => {
          await prisma.customerBlock.updateMany({ where: { reportId: { in: ids } }, data: { reportId: null } });
          await prisma.platformBlacklist.updateMany({ where: { reportId: { in: ids } }, data: { reportId: null } });
          return prisma.report.deleteMany({ where: { id: { in: ids } } });
        },
      );
      // a block still in force is kept whatever its age; a lifted one goes 2 years after it was lifted
      const blocks = await this.batched(
        () => prisma.customerBlock.findMany({ where: { unblockedAt: { lt: safety } }, select: { id: true }, take: BATCH }),
        (ids) => prisma.customerBlock.deleteMany({ where: { id: { in: ids } } }),
      );
      const blacklist = await this.batched(
        () => prisma.platformBlacklist.findMany({ where: { revokedAt: { lt: safety } }, select: { id: true }, take: BATCH }),
        (ids) => prisma.platformBlacklist.deleteMany({ where: { id: { in: ids } } }),
      );
      const aiToolCallsRedacted = await this.batched(
        () => prisma.aiToolCall.findMany({ where: { aiRun: { startedAt: { lt: mask } }, NOT: { args: { equals: REDACTED } } }, select: { id: true }, take: BATCH }),
        (ids) => prisma.aiToolCall.updateMany({ where: { id: { in: ids } }, data: { args: REDACTED, result: REDACTED } }),
      );
      // credit ledger rows, messages and reports keep their own figures; their link to the run is dropped (FK set null)
      const aiRuns = await this.batched(
        () => prisma.aiRun.findMany({ where: { startedAt: { lt: runs }, status: { not: 'running' } }, select: { id: true }, take: BATCH }),
        (ids) => prisma.aiRun.deleteMany({ where: { id: { in: ids } } }),
      );
      const jobsPurged = await this.batched(
        () => prisma.job.findMany({ where: { status: { in: [...FINISHED_JOBS] }, updatedAt: { lt: jobs } }, select: { id: true }, take: BATCH }),
        (ids) => prisma.job.deleteMany({ where: { id: { in: ids } } }),
      );
      const result = { auditLogs, reports, blocks, blacklist, aiToolCallsRedacted, aiRuns, jobs: jobsPurged };
      if (Object.values(result).some((n) => n > 0)) this.log.log(result, 'compliance retention purge');
      return result;
    });
  }
}
