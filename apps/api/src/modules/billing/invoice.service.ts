// BIL-03 / 04 §14 "Invoices" — numbering `F-<year>-<seq>` (one sequence for the platform, never reused), listing,
// remaining amount (Σ paid BillingPayment rows), PDF (A4: workspace billing info, lines, total, payment reference).
import { Injectable } from '@nestjs/common';
import type { InvoiceDto, InvoicesQuery } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Invoice, type InvoiceKind, type InvoiceStatus, type PaymentMethodBilling, type Tx } from '@djaber/db';
import { notFound } from '../../core/errors/app.exception';
import { I18nService } from '../../core/i18n/i18n.service';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { algiersDay } from '../../core/time/algiers';
import { dateLabel, money, renderGdsDocument } from '../gds/gds-document.pdf';

export type InvoiceLine = { label: string; amount: number; quantity?: number; key?: string; params?: Record<string, string | number>; planId?: string; cycle?: 'monthly' | 'yearly'; periodStart?: string; periodEnd?: string };
const year = (d = new Date()) => algiersDay(d).slice(0, 4);

@Injectable()
export class InvoiceService {
  constructor(private readonly i18n: I18nService) {}

  /** Next platform-wide number, inside the caller's transaction (advisory lock: two invoices never get the same number). */
  async nextNumber(tx: Tx): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('invoice-number', 0))`;
    const y = year();
    const prefix = `F-${y}-`;
    const start = prefix.length + 1;
    const [row] = await tx.$queryRaw<{ n: number | null }[]>`SELECT max(substring("number" from ${start}::int)::int) AS n FROM "Invoice" WHERE "number" LIKE ${prefix + '%'} AND substring("number" from ${start}::int) ~ '^[0-9]+$'`;
    return `${prefix}${String((row?.n ?? 0) + 1).padStart(5, '0')}`;
  }

  async create(
    tx: Tx,
    d: { workspaceId: string; kind: InvoiceKind; status: InvoiceStatus; amount: number; lines: InvoiceLine[]; subscriptionId?: string | null; creditPackPurchaseId?: string | null; method?: PaymentMethodBilling | null; dueAt?: Date | null; paidAt?: Date | null; dunningStage?: Invoice['dunningStage'] },
  ): Promise<Invoice> {
    const ws = await tx.workspace.findUniqueOrThrow({ where: { id: d.workspaceId }, select: { name: true, billingInfo: true } });
    return tx.invoice.create({
      data: {
        workspaceId: d.workspaceId,
        number: await this.nextNumber(tx),
        kind: d.kind,
        status: d.status,
        amount: d.amount,
        lines: d.lines as unknown as Prisma.InputJsonValue,
        billingInfo: { workspaceName: ws.name, ...((ws.billingInfo as Record<string, unknown> | null) ?? {}) } as Prisma.InputJsonValue,
        subscriptionId: d.subscriptionId ?? null,
        creditPackPurchaseId: d.creditPackPurchaseId ?? null,
        method: d.method ?? null,
        dueAt: d.dueAt ?? null,
        paidAt: d.paidAt ?? null,
        dunningStage: d.dunningStage ?? null,
      },
    });
  }

  /** Amount still due: invoice amount − Σ paid payments (manual partial payments included). */
  async remaining(tx: Tx, inv: Pick<Invoice, 'id' | 'amount' | 'status'>): Promise<number> {
    if (inv.status === 'paid' || inv.status === 'void' || inv.status === 'refunded') return 0;
    const paid = await tx.billingPayment.aggregate({ where: { invoiceId: inv.id, status: 'paid' }, _sum: { amount: true } });
    return Math.max(0, inv.amount - (paid._sum.amount ?? 0));
  }

  lineText(line: InvoiceLine, locale: string) {
    if (!line.key) return line.label;
    const params = { ...(line.params ?? {}) };
    if (typeof params.cycle === 'string' && (params.cycle === 'monthly' || params.cycle === 'yearly')) params.cycle = this.i18n.t(locale, `billingDoc.cycle.${params.cycle}`);
    if (typeof params.store === 'string' && (params.store === 'google_play' || params.store === 'app_store')) params.store = this.i18n.t(locale, `billingDoc.store.${params.store}`);
    return this.i18n.t(locale, line.key, params);
  }

  async toDto(inv: Invoice, locale: string, tx: Tx = prisma as unknown as Tx): Promise<InvoiceDto> {
    const lines = (inv.lines as unknown as InvoiceLine[]) ?? [];
    return {
      id: inv.id,
      number: inv.number,
      kind: inv.kind,
      date: inv.createdAt.toISOString(),
      label: lines[0] ? this.lineText(lines[0], locale) : inv.number,
      amount: inv.amount,
      status: inv.status,
      method: inv.method,
      paidAt: inv.paidAt?.toISOString() ?? null,
      // retest 11/11 M-20: an invoice « À venir » (renewal from J−7) opens too — its PDF reads « À venir » with the due date
      pdfUrl: `/api/v1/billing/invoices/${inv.id}/pdf`,
      dueAt: inv.dueAt?.toISOString() ?? null,
      remaining: await this.remaining(tx, inv),
      dunningStage: inv.dunningStage,
      lines: lines.map((l) => ({ label: this.lineText(l, locale), amount: l.amount, ...(l.quantity ? { quantity: l.quantity } : {}) })),
    };
  }

  /** `GET /billing/invoices?status&page` (newest first). */
  async list(q: InvoicesQuery, locale: string): Promise<Page<InvoiceDto>> {
    const where: Prisma.InvoiceWhereInput = q.status?.length ? { status: { in: q.status } } : {};
    const [rows, total] = await Promise.all([prisma.invoice.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }), prisma.invoice.count({ where })]);
    return page(await Promise.all(rows.map((r) => this.toDto(r, locale))), total, q);
  }

  async byIdOrNotFound(id: string): Promise<Invoice> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    const inv = await prisma.invoice.findFirst({ where: { id } });
    if (!inv) throw notFound();
    return inv;
  }

  /** `GET /billing/invoices/:id/pdf`. */
  async pdf(id: string, locale: string): Promise<{ body: Buffer; fileName: string }> {
    const inv = await this.byIdOrNotFound(id);
    const lang = (['fr', 'ar', 'en'].includes(locale) ? locale : 'fr') as 'fr' | 'ar' | 'en';
    const t = (k: string, p: Record<string, string | number> = {}) => this.i18n.t(lang, k, p);
    const info = (inv.billingInfo ?? {}) as { workspaceName?: string; companyName?: string; nif?: string; address?: string };
    const payment = await prisma.billingPayment.findFirst({ where: { invoiceId: inv.id, status: 'paid' }, orderBy: { paidAt: 'desc' } });
    const remaining = await this.remaining(prisma as unknown as Tx, inv);
    const lines = (inv.lines as unknown as InvoiceLine[]) ?? [];
    const meta = [
      { label: t('billingDoc.date'), value: dateLabel(inv.createdAt.toISOString()) },
      { label: t('billingDoc.status'), value: t(`enum.Invoice.status.${inv.status}`) },
      { label: t('billingDoc.billedTo'), value: info.companyName || info.workspaceName || '' },
      ...(info.nif ? [{ label: t('billingDoc.nif'), value: info.nif }] : []),
      ...(info.address ? [{ label: t('billingDoc.address'), value: info.address }] : []),
      ...(inv.dueAt ? [{ label: t('billingDoc.dueAt'), value: dateLabel(inv.dueAt.toISOString()) }] : []),
      ...(inv.paidAt ? [{ label: t('billingDoc.paidAt'), value: dateLabel(inv.paidAt.toISOString()) }] : []),
      ...(inv.method ? [{ label: t('billingDoc.method'), value: inv.method === 'cib' || inv.method === 'edahabia' ? `Chargily (${inv.method === 'cib' ? 'CIB' : 'Edahabia'})` : inv.method }] : []),
      ...(payment ? [{ label: t('billingDoc.reference'), value: payment.reference ?? payment.providerCheckoutId }] : []),
    ];
    const body = await renderGdsDocument({
      lang,
      shopName: t('billingDoc.seller'),
      title: t('billingDoc.invoice'),
      number: inv.number,
      meta,
      columns: [
        { header: t('billingDoc.col.label'), width: 5 },
        { header: t('billingDoc.col.amount'), width: 2, align: 'right' },
      ],
      rows: lines.map((l) => [this.lineText(l, lang), money(l.amount)]),
      totals: [{ label: t('billingDoc.total'), value: money(inv.amount), bold: true }, ...(remaining > 0 ? [{ label: t('billingDoc.remaining'), value: money(remaining) }] : [])],
      note: `${t('billingDoc.noVat')} ${inv.method === 'cib' || inv.method === 'edahabia' ? t('billingDoc.chargilyNote') : ''}`.trim(),
    });
    return { body, fileName: `${inv.number}.pdf` };
  }

  /** Workspace-scoped read used by the subscription view (dunning banner). */
  async unpaid(tx: Tx, workspaceId: string) {
    return tx.invoice.findFirst({ where: { workspaceId, status: 'unpaid' }, orderBy: { createdAt: 'desc' } });
  }

  static ws() {
    return TenantContext.workspaceId();
  }
}
