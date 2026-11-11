// ORD-09 / DLV-06 — A5 order slips (pdfkit renderer in ./print): one order on demand (`GET /orders/:id/print`, the file
// is written under `private/` and returned as a signed URL), several as a job (`POST /orders/bulk/print` → 202).
import { Injectable, OnModuleInit } from '@nestjs/common';
import { prisma, TenantContext, type Job, type Tx } from '@djaber/db';
import type { BulkOrderPrintInput, OrderPrintQuery } from '@djaber/shared';
import { ConfigService } from '../../core/config/config.service';
import { notFound } from '../../core/errors/app.exception';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { StorageService } from '../../core/storage/storage.service';
import { stopdeskLabels, stopdeskText } from '../delivery/stopdesk-names';
import { JobService } from '../jobs/job.service';
import { logoBytes } from '../uploads/logo-bytes';
import { renderOrderSlips, type OrderSlipData, type SlipLang } from './print/order-slip.pdf';

const PRINT_URL_TTL_S = 24 * 3600;
const PAYMENT_LABEL: Record<SlipLang, Record<string, string>> = {
  fr: { cash: 'Paiement à la livraison', card: 'Carte', transfer: 'Virement', ccp: 'CCP', other: 'Autre' },
  ar: { cash: 'الدفع عند الاستلام', card: 'بطاقة', transfer: 'تحويل', ccp: 'CCP', other: 'أخرى' },
  en: { cash: 'Cash on delivery', card: 'Card', transfer: 'Transfer', ccp: 'CCP', other: 'Other' },
};

@Injectable()
export class OrderPrintService implements OnModuleInit {
  constructor(
    private readonly storage: StorageService,
    private readonly jobs: JobService,
    private readonly registry: ProcessorRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.registry.register('jobs', 'order-slips', (data: { jobId: string }) => this.process(data.jobId), { concurrency: 2 });
  }

  private lang(l: string | undefined): SlipLang {
    const t = l ?? TenantContext.get().locale;
    return t === 'ar' || t === 'en' ? t : 'fr';
  }

  /** Slip data of the given orders, in the requested order (missing ids are skipped). */
  async slips(ids: string[], lang: SlipLang): Promise<OrderSlipData[]> {
    // UX-048 (10/11): the slip carries the shop's logo, name, phone and address (Paramètres › Boutique)
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: TenantContext.workspaceId() }, select: { name: true, phone: true, address: true, logoUrl: true } });
    const logo = await logoBytes(this.storage, ws.logoUrl);
    const rows = await prisma.order.findMany({
      where: { id: { in: ids } },
      include: { items: { orderBy: { id: 'asc' } }, wilaya: true, commune: true, shipments: { where: { status: { notIn: ['cancelled'] } }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const by = new Map(rows.map((r) => [r.id, r]));
    // UX-049: the relay point's name and address, never its technical id
    const desks = await stopdeskLabels(rows.map((r) => (r.isStopdesk ? r.stopdeskId : null)));
    const web = this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '');
    return ids
      .map((id) => by.get(id))
      .filter((o): o is NonNullable<typeof o> => !!o)
      .map((o) => ({
        shopName: ws.name,
        shopPhone: ws.phone,
        shopAddress: ws.address,
        logo,
        number: o.number,
        orderedAt: o.orderedAt.toISOString(),
        clientName: o.clientName,
        clientPhone: o.clientPhone,
        clientPhone2: o.clientPhone2,
        wilaya: o.wilaya ? `${o.wilaya.code} · ${lang === 'ar' ? o.wilaya.nameAr : o.wilaya.nameFr}` : null,
        commune: o.communeText ?? (o.commune ? (lang === 'ar' ? o.commune.nameAr : o.commune.nameFr) : null),
        address: o.address,
        isStopdesk: o.isStopdesk,
        stopdeskName: o.stopdeskId ? stopdeskText(desks.get(o.stopdeskId)) : null,
        items: o.items.map((i) => ({ name: i.productName, variant: i.variantName, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })),
        subtotal: o.subtotal,
        discount: o.discount,
        deliveryFee: o.deliveryFee,
        total: o.total,
        amountPaid: o.amountPaid,
        paymentMethod: PAYMENT_LABEL[lang][o.paymentMethod] ?? o.paymentMethod,
        notes: o.notes,
        trackingUrl: o.shipments[0] ? `${web}/s/${o.shipments[0].publicTrackingToken}` : null,
      }));
  }

  private async store(body: Buffer, name: string, createdById: string | null | undefined) {
    const ws = TenantContext.workspaceId();
    const key = `private/ws/${ws}/prints/${name}.pdf`;
    await this.storage.put(key, body, 'application/pdf');
    const upload = createdById ? await prisma.upload.create({ data: { workspaceId: ws, storageKey: key, url: key, mime: 'application/pdf', size: body.length, kind: 'label', createdById } }) : null;
    return { key, upload };
  }

  /** `GET /orders/:id/print` → `{ url, fileName, expiresAt }` (signed, 24 h). */
  async printOne(id: string, q: OrderPrintQuery) {
    const lang = this.lang(q.lang);
    const slips = await this.slips([id], lang);
    if (!slips.length) throw notFound();
    const pdf = await renderOrderSlips(slips, { withPrices: q.withPrices, twoPerPage: q.twoPerPage, lang });
    const { key } = await this.store(pdf, `${slips[0]!.number}-${Date.now()}`, TenantContext.get().userId);
    return { url: this.storage.signedUrl(key, PRINT_URL_TTL_S), fileName: `${slips[0]!.number}.pdf`, size: pdf.length, expiresAt: new Date(Date.now() + PRINT_URL_TTL_S * 1000).toISOString() };
  }

  /** `POST /orders/bulk/print` → `202 { jobId }` (Job `kind=labels`, name `order-slips`). Unknown ids are ignored by the job. */
  async requestBulk(input: BulkOrderPrintInput, tx?: Tx) {
    const job = await this.jobs.create({ kind: 'labels', name: 'order-slips', payload: { ids: input.ids, withPrices: input.withPrices, twoPerPage: input.twoPerPage, lang: this.lang(input.lang) }, total: input.ids.length, expiresAt: new Date(Date.now() + 7 * 86_400_000) }, tx);
    return { jobId: job.id };
  }

  async process(jobId: string) {
    await this.jobs.run(jobId, async (job: Job) => {
      const p = (job.payload ?? {}) as { ids?: string[]; withPrices?: boolean; twoPerPage?: boolean; lang?: SlipLang };
      const slips = await this.slips(p.ids ?? [], p.lang ?? 'fr');
      const pdf = await renderOrderSlips(slips, { withPrices: p.withPrices !== false, twoPerPage: p.twoPerPage === true, lang: p.lang ?? 'fr' });
      const { upload } = await this.store(pdf, `bons-${jobId}`, job.createdById);
      return { resultUploadId: upload?.id ?? null, result: { kind: 'order_slips', count: slips.length, skipped: (p.ids?.length ?? 0) - slips.length, fileName: `bons-de-commande-${slips.length}.pdf`, size: pdf.length }, status: slips.length < (p.ids?.length ?? 0) ? 'partial' : 'done' };
    });
  }
}
