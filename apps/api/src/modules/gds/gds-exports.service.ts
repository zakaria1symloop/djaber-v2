// M8 (M7 carry-over, Figma GDS-07 / GDS-08 "Exporter"): `GET /purchases/export` and `GET /sales/export` → the generic
// export job (kind `export`, CSV / XLSX, kept 7 days) with the list filters.
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { PurchaseListItemView, PurchasesQuery, SaleListItemView, SalesQuery } from '@djaber/shared';
import { algiersDay } from '../../core/time/algiers';
import { exportDate, exportDateTime, exportLabel } from '../jobs/export-cells';
import { ExportService } from '../jobs/export.service';
import { PurchaseService } from './purchase.service';
import { SaleService } from './sale.service';

const MAX_ROWS = 50_000;

@Injectable()
export class GdsExportsService implements OnModuleInit {
  constructor(
    private readonly exports: ExportService,
    private readonly purchases: PurchaseService,
    private readonly sales: SaleService,
  ) {}

  onModuleInit() {
    this.exports.registerSource('purchases', (f, ctx) => this.purchasesTable(f as Partial<PurchasesQuery>, ctx.locale));
    this.exports.registerSource('sales', (f, ctx) => this.salesTable(f as Partial<SalesQuery>, ctx.locale));
  }

  private async purchasesTable(q: Partial<PurchasesQuery>, locale: 'fr' | 'ar' | 'en') {
    const rows = (await this.purchases.list({ ...q, page: 1, pageSize: MAX_ROWS } as unknown as PurchasesQuery)).data;
    const h = HEADERS[locale] ?? HEADERS.fr;
    type R = PurchaseListItemView;
    return {
      sheetName: h.purchases,
      fileName: `achats-${algiersDay()}`,
      rows,
      columns: [
        { header: h.number, value: (r: R) => r.number },
        { header: h.date, value: (r: R) => exportDateTime(r.purchasedAt) },
        { header: h.supplier, value: (r: R) => r.supplier?.name ?? '' },
        { header: h.status, value: (r: R) => exportLabel(locale, 'enum.Purchase.status', r.status) },
        { header: h.items, value: (r: R) => r.itemCount },
        { header: h.total, value: (r: R) => r.total },
        { header: h.paid, value: (r: R) => r.amountPaid },
        { header: h.remaining, value: (r: R) => r.remaining },
        { header: h.payment, value: (r: R) => exportLabel(locale, 'enum.Purchase.paymentStatus', r.paymentStatus) },
        { header: h.expected, value: (r: R) => exportDate(r.expectedAt) },
      ],
    };
  }

  private async salesTable(q: Partial<SalesQuery>, locale: 'fr' | 'ar' | 'en') {
    const rows = (await this.sales.list({ ...q, page: 1, pageSize: MAX_ROWS } as unknown as SalesQuery)).data;
    const h = HEADERS[locale] ?? HEADERS.fr;
    type R = SaleListItemView;
    return {
      sheetName: h.sales,
      fileName: `ventes-${algiersDay()}`,
      rows,
      columns: [
        { header: h.number, value: (r: R) => r.number },
        { header: h.date, value: (r: R) => exportDateTime(r.soldAt) },
        { header: h.client, value: (r: R) => r.client?.name ?? r.customerName ?? '' },
        { header: h.phone, value: (r: R) => r.client?.phone ?? '' },
        { header: h.status, value: (r: R) => exportLabel(locale, 'enum.Sale.status', r.status) },
        { header: h.items, value: (r: R) => r.items.map((i) => `${i.name}${i.variant ? ` · ${i.variant}` : ''} × ${i.qty}`).join(' ; ') },
        { header: h.total, value: (r: R) => r.total },
        { header: h.paid, value: (r: R) => r.amountPaid },
        { header: h.remaining, value: (r: R) => r.remaining },
        { header: h.payment, value: (r: R) => exportLabel(locale, 'enum.Sale.paymentStatus', r.paymentStatus) },
        { header: h.method, value: (r: R) => exportLabel(locale, ['sales.method', 'orders.payment.method'], r.paymentMethod) },
        { header: h.seller, value: (r: R) => (r.seller ? `${r.seller.firstName} ${r.seller.lastName}`.trim() : '') },
      ],
    };
  }
}

const HEADERS = {
  fr: { purchases: 'Achats', sales: 'Ventes', number: 'N°', date: 'Date', supplier: 'Fournisseur', client: 'Client', phone: 'Téléphone', status: 'Statut', items: 'Articles', total: 'Total', paid: 'Payé', remaining: 'Reste dû', payment: 'Paiement', method: 'Mode', expected: 'Livraison prévue', seller: 'Vendeur' },
  en: { purchases: 'Purchases', sales: 'Sales', number: 'No.', date: 'Date', supplier: 'Supplier', client: 'Client', phone: 'Phone', status: 'Status', items: 'Items', total: 'Total', paid: 'Paid', remaining: 'Remaining', payment: 'Payment', method: 'Method', expected: 'Expected delivery', seller: 'Seller' },
  ar: { purchases: 'المشتريات', sales: 'المبيعات', number: 'الرقم', date: 'التاريخ', supplier: 'المورّد', client: 'الزبون', phone: 'الهاتف', status: 'الحالة', items: 'المواد', total: 'المجموع', paid: 'المدفوع', remaining: 'المتبقي', payment: 'الدفع', method: 'الطريقة', expected: 'التسليم المتوقع', seller: 'البائع' },
} as const;
