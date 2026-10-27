// The two platform-admin billing writes needed now (the admin UI is M10):
//   POST /admin/invoices/:id/mark-paid (ADM-04, D71, 04 §14 "Manual payment"; finance + super_admin): amount = remaining ⇒
//     invoice paid + immediate reactivation (renewal at any dunning stage); amount < remaining ⇒ payment recorded, invoice
//     stays unpaid, `200 ⚠ INVOICE_PARTIAL_PAYMENT {remaining}`; amount > remaining ⇒ 422 VALIDATION_ERROR
//     (`fields.amount = validation.range`, max = remaining). Audited `invoice.mark_paid`. No credit note in v2.
//   POST /admin/workspaces/:id/credits (PRM-03): `CreditLedger(bucket=plan, kind=credit, action=grant)`, e-mail to the
//     Owner + in-app notification `credits.granted` (tester report 22/10 UX-021), audit `credits.grant` with the reason;
//     support ≤ 1 000 (`403 ADMIN_CREDIT_GRANT_LIMIT {max}`).
//   POST /admin/workspaces/:id/credits/remove (tester report 22/10 UX-019; finance + super_admin): a negative
//     `adjustment` of the plan credits, at most what is left of them, audit `credits.remove`; e-mail to the Owner +
//     in-app notification `credits.removed` with the reason (tester log 26/10 UX-040).
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ADMIN_REASON_MIN, ADMIN_SUPPORT_GRANT_MAX, type AdminGrantCreditsInput, type AdminGrantCreditsResultDto, type AdminMarkPaidInput, type AdminMarkPaidResultDto, type AdminRemoveCreditsInput } from '@djaber/shared';
import { prisma, TenantContext, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { MailOutbox } from '../../core/mail/mail.outbox';
import { NotificationProducer } from '../notifications/notification.producer';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { CreditService } from '../credits/credit.service';
import { lockBilling } from './billing.util';
import { InvoiceService } from './invoice.service';
import { PaymentService } from './payment.service';

type Admin = { userId: string; platformRole: string; ip?: string | null; userAgent?: string | null };

@Injectable()
export class AdminBillingService {
  constructor(
    private readonly payments: PaymentService,
    private readonly invoices: InvoiceService,
    private readonly credits: CreditService,
    private readonly tenants: TenantResolver,
    private readonly audit: AuditService,
    private readonly mail: MailOutbox,
    private readonly config: ConfigService,
    private readonly notifications: NotificationProducer,
  ) {}

  private reason(r: string) {
    if ((r ?? '').trim().length < ADMIN_REASON_MIN) throw new AppException('ADMIN_REASON_REQUIRED', {}, { reason: 'validation.length' });
    return r.trim();
  }

  async markPaid(invoiceId: string, input: AdminMarkPaidInput, admin: Admin): Promise<{ result: AdminMarkPaidResultDto; partial: number | null }> {
    const reason = this.reason(input.reason);
    if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) throw notFound();
    const inv0 = await TenantContext.runSystem(() => prisma.invoice.findUnique({ where: { id: invoiceId } }));
    if (!inv0) throw notFound();
    const tenant = await this.tenants.forWorker(inv0.workspaceId);
    const paidAt = new Date(input.paidAt.length === 10 ? `${input.paidAt}T12:00:00Z` : input.paidAt);
    if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 86_400_000) throw new AppException('VALIDATION_ERROR', {}, { paidAt: 'validation.date' });
    const out = await TenantContext.run({ ...tenant, userId: admin.userId }, () =>
      prisma.$transaction(
        async (db) => {
          const tx = db as Tx;
          await lockBilling(tx, inv0.workspaceId);
          const inv = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId } });
          if (inv.status !== 'unpaid' && inv.status !== 'upcoming') throw new AppException('CONFLICT', {}, {}, { status: inv.status });
          // the proof is a platform file uploaded by this admin (`POST /uploads { kind: payment_proof }`, no workspace)
          if (input.proofUploadId && !(await TenantContext.runSystem(() => tx.upload.findFirst({ where: { id: input.proofUploadId, kind: 'payment_proof', workspaceId: null, createdById: admin.userId } })))) throw new AppException('VALIDATION_ERROR', {}, { proofUploadId: 'validation.id' });
          const remaining = await this.invoices.remaining(tx, inv);
          if (input.amount > remaining) throw new AppException('VALIDATION_ERROR', { max: remaining }, { amount: 'validation.range' });
          if (input.amount === remaining) {
            const r = await this.payments.activateManually(tx, { intent: { kind: 'invoice', invoiceId: inv.id, userId: admin.userId }, amount: input.amount, method: input.method, reference: input.reference, invoiceId: inv.id, recordedById: admin.userId, proofUploadId: input.proofUploadId ?? null, paidAt });
            return { paymentId: r.paymentId, remaining: 0, reactivated: inv.kind === 'subscription' };
          }
          // partial: recorded, the invoice stays unpaid
          const p = await tx.billingPayment.create({ data: { workspaceId: inv.workspaceId, invoiceId: inv.id, amount: input.amount, status: 'paid', provider: 'manual', providerCheckoutId: `manual:${randomUUID()}`, reference: input.reference, recordedById: admin.userId, proofUploadId: input.proofUploadId ?? null, paidAt, raw: { manual: { method: input.method, partial: true } } } });
          return { paymentId: p.id, remaining: remaining - input.amount, reactivated: false };
        },
        { timeout: 30_000 },
      ),
    );
    await this.tenants.invalidate(inv0.workspaceId);
    await this.audit.write({ workspaceId: inv0.workspaceId, actorType: 'admin', actorId: admin.userId, actorRole: admin.platformRole, action: 'invoice.mark_paid', entity: 'Invoice', entityId: invoiceId, before: { status: inv0.status }, after: { amount: input.amount, method: input.method, reference: input.reference, remaining: out.remaining }, reason, ip: admin.ip ?? null, userAgent: admin.userAgent ?? null });
    const inv = await TenantContext.runAs(inv0.workspaceId, () => prisma.invoice.findFirstOrThrow({ where: { id: invoiceId } }));
    const dto = await TenantContext.runAs(inv0.workspaceId, () => this.invoices.toDto(inv, 'fr'));
    return { result: { invoice: dto, paymentId: out.paymentId, remaining: out.remaining, reactivated: out.reactivated }, partial: out.remaining > 0 ? out.remaining : null };
  }

  async grantCredits(workspaceId: string, input: AdminGrantCreditsInput, admin: Admin): Promise<AdminGrantCreditsResultDto> {
    const reason = this.reason(input.reason);
    if (admin.platformRole === 'support' && input.credits > ADMIN_SUPPORT_GRANT_MAX) throw new AppException('ADMIN_CREDIT_GRANT_LIMIT', { max: ADMIN_SUPPORT_GRANT_MAX });
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw notFound();
    const ws = await TenantContext.runSystem(() => prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null }, include: { owner: { select: { email: true, locale: true } } } }));
    if (!ws) throw notFound();
    const tenant = await this.tenants.forWorker(workspaceId);
    const key = `admin-grant:${workspaceId}:${randomUUID()}`;
    const entryId = await TenantContext.run({ ...tenant, userId: admin.userId }, () =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const w = await this.credits.writeIn(tx, workspaceId, { bucket: 'plan', action: 'grant', credits: input.credits, key, reason: `admin:${input.type ?? 'commercial'}:${reason}`.slice(0, 500), grantedById: admin.userId });
        if (ws.owner) {
          await this.mail.send(
            { to: ws.owner.email, template: 'billing/credits-granted', locale: ws.owner.locale, params: { credits: input.credits, workspaceName: ws.name, reason, url: `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}/settings/credits` }, key: `mail:${key}`, workspaceId },
            tx,
          );
        }
        await this.notifications.emit(tx, { type: 'credits_granted', workspaceId, target: { owner: true }, key: `credits_granted:${w.entryId}`, data: { credits: input.credits, reason } });
        return w.entryId;
      }),
    );
    await this.audit.write({ workspaceId, actorType: 'admin', actorId: admin.userId, actorRole: admin.platformRole, action: 'credits.grant', entity: 'Workspace', entityId: workspaceId, after: { credits: input.credits, type: input.type ?? 'commercial', ledgerEntryId: entryId }, reason, ip: admin.ip ?? null, userAgent: admin.userAgent ?? null });
    const balance = await TenantContext.run(tenant, () => this.credits.summary());
    return { ledgerEntryId: entryId, balance };
  }

  async removeCredits(workspaceId: string, input: AdminRemoveCreditsInput, admin: Admin): Promise<AdminGrantCreditsResultDto> {
    const reason = this.reason(input.reason);
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw notFound();
    const ws = await TenantContext.runSystem(() => prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null }, select: { id: true, name: true, owner: { select: { email: true, locale: true } } } }));
    if (!ws) throw notFound();
    const tenant = await this.tenants.forWorker(workspaceId);
    const key = `admin-remove:${workspaceId}:${randomUUID()}`;
    const entryId = await TenantContext.run({ ...tenant, userId: admin.userId }, () =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await this.credits.lockIn(tx, workspaceId);
        const b = await this.credits.balanceIn(tx, workspaceId);
        // only plan credits (granted or of the plan) can be taken back; bought packs are the merchant's
        const max = b.unlimited ? 0 : Math.max(0, b.plan);
        if (input.credits > max) throw new AppException('VALIDATION_ERROR', {}, { credits: 'validation.range' }, { max });
        const w = await this.credits.writeIn(tx, workspaceId, { bucket: 'plan', action: 'adjustment', credits: -input.credits, key, reason: `admin:remove:${reason}`.slice(0, 500), grantedById: admin.userId });
        // tester log 26/10 UX-040: the Owner is told like for a grant — e-mail with the reason + in-app notification
        if (ws.owner) {
          await this.mail.send(
            { to: ws.owner.email, template: 'billing/credits-removed', locale: ws.owner.locale, params: { credits: input.credits, workspaceName: ws.name, reason, url: `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}/settings/credits` }, key: `mail:${key}`, workspaceId },
            tx,
          );
        }
        await this.notifications.emit(tx, { type: 'credits_removed', workspaceId, target: { owner: true }, key: `credits_removed:${w.entryId}`, data: { credits: input.credits, reason } });
        return w.entryId;
      }),
    );
    await this.audit.write({ workspaceId, actorType: 'admin', actorId: admin.userId, actorRole: admin.platformRole, action: 'credits.remove', entity: 'Workspace', entityId: workspaceId, after: { credits: -input.credits, ledgerEntryId: entryId }, reason, ip: admin.ip ?? null, userAgent: admin.userAgent ?? null });
    const balance = await TenantContext.run(tenant, () => this.credits.summary());
    return { ledgerEntryId: entryId, balance };
  }
}
