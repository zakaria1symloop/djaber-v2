// Thin facade of the merchant billing routes that are not the subscription itself: return page, invoices (+ pay, PDF),
// billing info, payments list, promo codes, ledger CSV / XLSX export (job `export`, kind `ledger`).
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { BillingInfoDto, BillingInfoInput, CheckoutReturnDto, InvoicesQuery, LedgerExportQuery, PayInvoiceResultDto } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type BillingPayment } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { AppException } from '../../core/errors/app.exception';
import { I18nService } from '../../core/i18n/i18n.service';
import { algiersDay, algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { CreditService } from '../credits/credit.service';
import { exportDateTime } from '../jobs/export-cells';
import { ExportService } from '../jobs/export.service';
import { InvoiceService } from './invoice.service';
import { PaymentService } from './payment.service';
import { PlanService } from './plan.service';
import { PromoService } from './promo.service';

@Injectable()
export class BillingService implements OnModuleInit {
  constructor(
    private readonly payments: PaymentService,
    private readonly invoicesSvc: InvoiceService,
    private readonly plans: PlanService,
    private readonly promos: PromoService,
    private readonly credits: CreditService,
    private readonly exports: ExportService,
    private readonly i18n: I18nService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.exports.registerSource('ledger', (filters, ctx) => this.ledgerTable(filters as LedgerExportQuery, ctx.locale));
  }

  forbiddenOnMobile(): never {
    throw new AppException('FORBIDDEN');
  }

  /** `GET /billing/checkout/return?ref`. */
  checkoutReturn(ref: string, locale: string): Promise<CheckoutReturnDto> {
    return this.payments.returnStatus(ref, async (p: BillingPayment) => {
      const intent = this.payments.intentOf(p);
      const inv = p.invoiceId ? await prisma.invoice.findFirst({ where: { id: p.invoiceId } }) : null;
      const base = { invoiceId: inv?.id ?? null, invoiceNumber: inv?.number ?? null, planUntil: null as string | null, planName: null as string | null, credits: null as number | null };
      if (intent?.kind === 'pack') {
        const purchase = await prisma.creditPackPurchase.findFirst({ where: { id: intent.purchaseId }, include: { pack: true } });
        return { kind: 'pack' as const, ...base, credits: purchase?.pack.credits ?? null };
      }
      const sub = await prisma.subscription.findFirst({ where: { status: { in: ['trial', 'active', 'dunning'] } }, include: { plan: true }, orderBy: { createdAt: 'desc' } });
      const plan = intent?.kind === 'subscription' ? await this.plans.byId(intent.planId) : (sub?.plan ?? null);
      return { kind: intent?.kind === 'invoice' ? ('invoice' as const) : ('subscription' as const), ...base, planName: plan ? this.plans.name(plan, locale) : null, planUntil: p.status === 'paid' && sub ? sub.currentPeriodEnd.toISOString() : null };
    });
  }

  async info(): Promise<BillingInfoDto> {
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: TenantContext.workspaceId() }, select: { billingInfo: true } });
    const b = (ws.billingInfo ?? {}) as { companyName?: string; nif?: string; address?: string };
    return { companyName: b.companyName ?? null, nif: b.nif ?? null, address: b.address ?? null };
  }

  async saveInfo(input: BillingInfoInput): Promise<BillingInfoDto> {
    const t = TenantContext.get();
    const before = await this.info();
    const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()]));
    await prisma.workspace.update({ where: { id: t.workspaceId }, data: { billingInfo: Object.keys(clean).length ? (clean as Prisma.InputJsonValue) : Prisma.DbNull } });
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId ?? null, actorRole: t.role ?? null, action: 'billing.info_update', entity: 'Workspace', entityId: t.workspaceId, before, after: clean });
    return this.info();
  }

  invoices(q: InvoicesQuery, locale: string) {
    return this.invoicesSvc.list(q, locale);
  }

  invoicePdf(id: string, locale: string) {
    return this.invoicesSvc.pdf(id, locale);
  }

  /** `POST /billing/invoices/:id/pay` — a Chargily checkout for the remaining amount of an `unpaid` invoice. */
  async payInvoice(id: string, locale: 'fr' | 'ar' | 'en'): Promise<PayInvoiceResultDto> {
    const inv = await this.invoicesSvc.byIdOrNotFound(id);
    if (inv.status !== 'unpaid') throw new AppException('CONFLICT', {}, {}, { status: inv.status });
    const remaining = await this.invoicesSvc.remaining(prisma as never, inv);
    if (remaining <= 0) throw new AppException('CONFLICT', {}, {}, { remaining });
    const t = TenantContext.get();
    return this.payments.start({ amount: remaining, description: `Djaber — ${inv.number}`, intent: { kind: 'invoice', invoiceId: inv.id, userId: t.userId ?? null }, invoiceId: inv.id, locale, subscriptionId: inv.subscriptionId });
  }

  /** `GET /billing/payments`. */
  listPayments(q: { page: number; pageSize: number }) {
    return this.payments.list(q);
  }

  async validatePromo(code: string, planId: string | undefined, platform: 'web' | 'mobile') {
    const plan = planId ? await this.plans.buyable(planId) : null;
    return this.promos.validate(code, plan, platform);
  }

  redeemPromo(code: string, platform: 'web' | 'mobile') {
    return this.promos.redeem(code, platform, () => this.credits.summary());
  }

  /** `GET /credits/ledger/export` → 202 `{ jobId }`. */
  exportLedger(q: LedgerExportQuery) {
    const { format, ...filters } = q;
    return this.exports.request('ledger', filters, format, { kind: 'ledger', format });
  }

  private async ledgerTable(q: Omit<LedgerExportQuery, 'format'>, locale: 'fr' | 'ar' | 'en') {
    const where: Prisma.CreditLedgerWhereInput = {
      kind: { in: ['credit', 'debit'] },
      ...(q.action?.length ? { action: { in: q.action } } : {}),
      ...(q.agentId ? { agentId: q.agentId } : {}),
      ...(q.bucket ? { bucket: q.bucket } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: algiersDayStart(q.from) } : {}), ...(q.to ? { lt: algiersDayEnd(q.to) } : {}) } } : {}),
    };
    const rows = await prisma.creditLedger.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100_000 });
    const agentIds = [...new Set(rows.map((r) => r.agentId).filter((x): x is string => !!x))];
    const agents = new Map((agentIds.length ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : []).map((a) => [a.id, a.name]));
    const t = (k: string) => this.i18n.t(locale, k);
    type Row = (typeof rows)[number];
    return {
      sheetName: t('billingDoc.ledger.sheet'),
      fileName: `credits-${algiersDay()}`,
      columns: [
        { header: t('billingDoc.date'), value: (r: Row) => exportDateTime(r.createdAt) },
        { header: t('billingDoc.ledger.action'), value: (r: Row) => t(`enum.CreditLedger.action.${r.action}`) },
        { header: t('billingDoc.ledger.bucket'), value: (r: Row) => t(`billingDoc.ledger.bucket.${r.bucket}`) },
        { header: t('billingDoc.ledger.credits'), value: (r: Row) => r.credits, kind: 'number' as const },
        { header: t('billingDoc.ledger.balance'), value: (r: Row) => r.balanceAfter, kind: 'number' as const },
        { header: t('billingDoc.ledger.detail'), value: (r: Row) => r.reason ?? '' },
        { header: t('billingDoc.ledger.agent'), value: (r: Row) => (r.agentId ? (agents.get(r.agentId) ?? '') : '') },
      ],
      rows,
    };
  }
}
