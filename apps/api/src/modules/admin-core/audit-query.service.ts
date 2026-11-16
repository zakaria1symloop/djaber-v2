// ADM-09 audit log viewer (filters incl. impersonation, before / after) + signed export (CSV with a `# sha256=` header line,
// or JSON) as a platform job; the export is itself audited (`audit.export`). Also the invoices export job of ADM-05.
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { AdminAuditExportInput, AdminAuditQuery, AuditLogDto } from '@djaber/shared';
import { Prisma, prisma, TenantContext, type Job } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { AdminJobsService, sha256 } from './admin-jobs.service';
import { DAY, assertUuid, type AdminActor } from './admin.util';

const EXPORT_MAX_ROWS = 100_000;
const PERIOD_DAYS: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
type Row = Prisma.AuditLogGetPayload<{ include: { actor: { select: { id: true; firstName: true; lastName: true } } } }>;

@Injectable()
export class AuditQueryService implements OnModuleInit {
  constructor(
    private readonly jobs: AdminJobsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.jobs.handle('admin-audit-export', (job) => this.runExport(job));
    this.jobs.handle('admin-invoices-export', (job) => this.runInvoicesExport(job));
  }

  private where(q: Partial<AdminAuditQuery>): Prisma.AuditLogWhereInput {
    const and: Prisma.AuditLogWhereInput[] = [];
    if (q.actorId) and.push({ actorId: q.actorId });
    if (q.action?.length) and.push({ OR: q.action.map((a) => (a.endsWith('*') || !a.includes('.') ? { action: { startsWith: a.replace(/\*$/, '') } } : { action: a })) });
    if (q.entity?.length) and.push({ entity: { in: q.entity } });
    if (q.workspaceId) and.push({ workspaceId: q.workspaceId });
    if (q.impersonationSessionId) and.push({ OR: [{ impersonationSessionId: q.impersonationSessionId }, { entity: 'ImpersonationSession', entityId: q.impersonationSessionId }] });
    if (q.impersonation === 'only') and.push({ impersonationSessionId: { not: null } });
    if (q.impersonation === 'exclude') and.push({ impersonationSessionId: null });
    if (q.from) and.push({ at: { gte: algiersDayStart(q.from) } });
    if (q.to) and.push({ at: { lt: algiersDayEnd(q.to) } });
    if (q.period && !q.from) and.push({ at: { gte: new Date(Date.now() - PERIOD_DAYS[q.period]! * DAY) } });
    if (q.q) {
      const s = q.q.trim();
      and.push({ OR: [{ action: { contains: s, mode: 'insensitive' } }, { reason: { contains: s, mode: 'insensitive' } }, { ip: { startsWith: s } }, { entityId: s }, { actor: { OR: [{ firstName: { contains: s, mode: 'insensitive' } }, { lastName: { contains: s, mode: 'insensitive' } }, { email: { contains: s, mode: 'insensitive' } }] } }] });
    }
    return and.length ? { AND: and } : {};
  }

  private async dtos(rows: Row[]): Promise<AuditLogDto[]> {
    const wsIds = [...new Set(rows.map((r) => r.workspaceId).filter((x): x is string => !!x))];
    const wss = wsIds.length ? await prisma.workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } }) : [];
    const users = rows.filter((r) => r.entity === 'User' && r.entityId).map((r) => r.entityId!);
    const targets = users.length ? await prisma.user.findMany({ where: { id: { in: users } }, select: { id: true, email: true } }) : [];
    return rows.map((r) => {
      const ws = wss.find((w) => w.id === r.workspaceId);
      const name = r.actor ? `${r.actor.firstName} ${r.actor.lastName}`.trim() : r.actorType === 'system' ? 'Système' : r.actorType;
      const label = r.entity === 'Workspace' ? ws?.name ?? r.entityId ?? '—' : r.entity === 'User' ? targets.find((t) => t.id === r.entityId)?.email ?? r.entityId ?? '—' : `${r.entity}${r.entityId ? ` ${r.entityId.slice(0, 8)}` : ''}`;
      return {
        id: r.id,
        at: r.at.toISOString(),
        actor: { type: r.actorType, id: r.actorId, name, role: r.actorRole },
        action: r.action,
        target: { entity: r.entity, id: r.entityId, label, ...(ws ? { workspace: ws } : {}) },
        reason: r.reason,
        context: { ip: r.ip ? r.ip.replace(/\.\d+\.\d+$/, '.x.x') : null, userAgent: r.userAgent, impersonationSessionId: r.impersonationSessionId, twoFactor: r.actorType === 'admin' && (r.actor as { totpEnabled?: boolean } | null)?.totpEnabled === true },
        before: (r.before as Record<string, unknown> | null) ?? null,
        after: (r.after as Record<string, unknown> | null) ?? null,
      };
    });
  }
  // full-test 15/11 ADMIN-02: « 2FA ✓ » only for an actor whose account has 2FA on (a sign-in of such an account always asks for the code) — it was claimed for every admin row
  private readonly include = { actor: { select: { id: true, firstName: true, lastName: true, totpEnabled: true } } } as const;

  async list(q: AdminAuditQuery): Promise<Page<AuditLogDto>> {
    const where = this.where(q);
    const [total, rows] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, include: this.include, orderBy: [{ at: 'desc' }, { id: 'desc' }], ...toSkipTake(q) })]);
    return page(await this.dtos(rows), total, q);
  }

  async get(id: string): Promise<AuditLogDto> {
    assertUuid(id);
    const r = await prisma.auditLog.findUnique({ where: { id }, include: this.include });
    if (!r) throw notFound();
    return (await this.dtos([r]))[0]!;
  }

  async workspaceAudit(workspaceId: string, q: { page: number; pageSize: number }) {
    assertUuid(workspaceId);
    if (!(await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } }))) throw notFound();
    return this.list({ ...q, workspaceId } as AdminAuditQuery);
  }

  /** `POST /admin/audit-logs/export` → 202 `{ jobId }`. */
  async export(input: AdminAuditExportInput, actor: AdminActor) {
    if (input.to < input.from) throw new AppException('VALIDATION_ERROR', {}, { to: 'validation.range' });
    const job = await this.jobs.create('audit_export', 'admin-audit-export', { ...input }, actor.userId);
    await this.audit.write({ actorType: 'admin', actorId: actor.userId, actorRole: actor.platformRole, action: 'audit.export', entity: 'Job', entityId: job.id, after: { ...input }, ip: actor.ip, userAgent: actor.userAgent });
    return { jobId: job.id };
  }

  private csvCell(v: unknown) {
    const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  private async runExport(job: Job) {
    const p = job.payload as AdminAuditExportInput;
    const where = this.where({ from: p.from, to: p.to, workspaceId: p.workspaceId, actorId: p.actorId, action: p.action, impersonation: p.impersonation });
    const rows = await TenantContext.runSystem(() => prisma.auditLog.findMany({ where, include: this.include, orderBy: [{ at: 'asc' }, { id: 'asc' }], take: EXPORT_MAX_ROWS }));
    const dtos = await this.dtos(rows);
    const stamp = `${p.from}_${p.to}`;
    if (p.format === 'json') {
      const body = JSON.stringify({ from: p.from, to: p.to, count: dtos.length, entries: dtos });
      const hash = sha256(body);
      return { result: { format: 'json', rows: dtos.length, sha256: hash }, file: { body: Buffer.from(JSON.stringify({ sha256: hash, ...JSON.parse(body) })), name: `audit-${stamp}.json`, mime: 'application/json' } };
    }
    const header = ['id', 'at', 'actorType', 'actorId', 'actorName', 'actorRole', 'action', 'entity', 'entityId', 'workspaceId', 'reason', 'ip', 'impersonationSessionId', 'before', 'after'];
    const lines = [header.join(',')];
    for (const d of dtos) lines.push([d.id, d.at, d.actor.type, d.actor.id, d.actor.name, d.actor.role, d.action, d.target.entity, d.target.id, d.target.workspace?.id ?? null, d.reason, d.context.ip, d.context.impersonationSessionId, d.before, d.after].map((c) => this.csvCell(c)).join(','));
    const content = `${lines.join('\n')}\n`;
    const hash = sha256(content);
    return { result: { format: 'csv_signed', rows: dtos.length, sha256: hash }, file: { body: Buffer.from(`# sha256=${hash}\n${content}`, 'utf8'), name: `audit-${stamp}.csv`, mime: 'text/csv' } };
  }

  /** `GET /admin/invoices/export?from&to` → 202 (ADM-05 "Exporter comptabilité"). CSV only (xlsx requested ⇒ CSV, same columns). */
  async exportInvoices(input: { from: string; to: string; format: string }, actor: AdminActor) {
    if (input.to < input.from) throw new AppException('VALIDATION_ERROR', {}, { to: 'validation.range' });
    const job = await this.jobs.create('export', 'admin-invoices-export', { ...input }, actor.userId);
    await this.audit.write({ actorType: 'admin', actorId: actor.userId, actorRole: actor.platformRole, action: 'invoice.export', entity: 'Job', entityId: job.id, after: { ...input }, ip: actor.ip, userAgent: actor.userAgent });
    return { jobId: job.id };
  }

  private async runInvoicesExport(job: Job) {
    const p = job.payload as { from: string; to: string };
    const rows = await TenantContext.runSystem(() => prisma.invoice.findMany({ where: { createdAt: { gte: algiersDayStart(p.from), lt: algiersDayEnd(p.to) } }, include: { workspace: { select: { name: true } }, payments: { where: { status: 'paid' } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: EXPORT_MAX_ROWS }));
    const lines = [['number', 'date', 'workspace', 'kind', 'status', 'amount', 'paid', 'method', 'paidAt'].join(',')];
    for (const i of rows) lines.push([i.number, i.createdAt.toISOString().slice(0, 10), i.workspace.name, i.kind, i.status, i.amount, i.payments.reduce((n, x) => n + x.amount, 0), i.method, i.paidAt?.toISOString() ?? ''].map((c) => this.csvCell(c)).join(','));
    return { result: { rows: rows.length, format: 'csv' }, file: { body: Buffer.from(`${lines.join('\n')}\n`, 'utf8'), name: `invoices-${p.from}_${p.to}.csv`, mime: 'text/csv' } };
  }
}
