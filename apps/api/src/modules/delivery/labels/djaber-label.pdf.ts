// DLV-06 / 04 §22 / 05-integrations §8 `label-djaber` — the Djaber parcel label (couriers without labels such as ZR
// Express, "Livraison propre", or on demand): shop, order number, courier + tracking, QR code of the public tracking
// page (`/s/<publicTrackingToken>`), recipient (name, phones, wilaya / commune / address or stop-desk), COD amount in
// large type, items summary, sender, "Djaber" footer. Formats: A6 (105 × 148 mm), thermal 100 × 150 mm, A5.
// pdfkit renderer, Arabic runs in Noto Naskh Arabic (shared bidi helpers of the A5 slip). Pure function, no DI.
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { drawBidiLine, formatSlipAmount, formatSlipPhone, registerSlipFonts, wrapBidi, BIDI_LINE, type BidiStyle } from '../../orders/print/order-slip.pdf';

export type LabelFormat = 'a6' | 'thermal' | 'a5';
export type LabelLang = 'fr' | 'ar' | 'en';
export type DjaberLabelData = {
  shopName: string;
  shopPhone: string | null;
  senderAddress: string | null;
  senderWilaya: string | null;
  orderNumber: string;
  courier: string;
  trackingNumber: string | null;
  recipientName: string;
  phone: string;
  phone2: string | null;
  wilaya: string | null;
  commune: string | null;
  address: string | null;
  isStopdesk: boolean;
  stopdeskName: string | null;
  codAmount: number;
  itemsSummary: string;
  trackingUrl: string;
};

const MM = 72 / 25.4;
export const LABEL_SIZES: Record<LabelFormat, [number, number]> = { a6: [105 * MM, 148 * MM], thermal: [100 * MM, 150 * MM], a5: [148 * MM, 210 * MM] };

type LabelKey = 'to' | 'from' | 'cod' | 'stopdesk' | 'home' | 'items' | 'order' | 'tracking' | 'scan';
const T: Record<LabelLang, Record<LabelKey, string>> = {
  fr: { to: 'Destinataire', from: 'Expéditeur', cod: 'À encaisser', stopdesk: 'Bureau', home: 'À domicile', items: 'Contenu', order: 'Commande', tracking: 'Suivi', scan: 'Scannez pour suivre le colis' },
  ar: { to: 'المرسل إليه', from: 'المرسل', cod: 'المبلغ المطلوب', stopdesk: 'المكتب', home: 'إلى المنزل', items: 'المحتوى', order: 'الطلب', tracking: 'التتبع', scan: 'امسح لتتبع الطرد' },
  en: { to: 'Recipient', from: 'Sender', cod: 'To collect', stopdesk: 'Office', home: 'Home delivery', items: 'Content', order: 'Order', tracking: 'Tracking', scan: 'Scan to track the parcel' },
};

/** QR code of `text` drawn as vector squares (no image), `size` points wide, top-left at (x, y). */
export const drawQr = (doc: PDFKit.PDFDocument, text: string, x: number, y: number, size: number) => {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = size / (n + 2); // 1-module quiet zone
  doc.save().fillColor('#000000');
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) doc.rect(x + (c + 1) * cell, y + (r + 1) * cell, cell + 0.05, cell + 0.05);
    }
  }
  doc.fill().restore();
};

class LabelWriter {
  private y: number;
  private readonly x0: number;
  private readonly x1: number;
  private readonly k: number;
  private readonly rtl: boolean;
  private readonly L: Record<LabelKey, string>;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly d: DjaberLabelData,
    format: LabelFormat,
    lang: LabelLang,
  ) {
    const [w] = LABEL_SIZES[format];
    this.k = w / LABEL_SIZES.a6[0];
    const m = 12 * this.k;
    this.x0 = m;
    this.x1 = w - m;
    this.y = m;
    this.rtl = lang === 'ar';
    this.L = T[lang];
  }

  private s(n: number) {
    return n * this.k;
  }
  private get w() {
    return this.x1 - this.x0;
  }
  private line(text: string, style: BidiStyle, x = this.x0, w = this.w) {
    drawBidiLine(this.doc, text, x, this.y, w, { ...style, size: this.s(style.size), align: style.align ?? (this.rtl ? 'right' : 'left') });
    this.y += this.s(style.size) * BIDI_LINE;
  }
  private block(text: string, size: number, maxLines: number, bold = false, x = this.x0, w = this.w) {
    for (const l of wrapBidi(this.doc, text, w, this.s(size), bold, maxLines)) this.line(l, { size, bold }, x, w);
  }
  private rule(gap = 4) {
    this.y += this.s(gap / 2);
    this.doc.save().lineWidth(0.6).moveTo(this.x0, this.y).lineTo(this.x1, this.y).stroke().restore();
    this.y += this.s(gap / 2);
  }

  render() {
    const d = this.d;
    const qr = this.s(70);
    const top = this.y;
    // header: shop + order + courier / tracking, QR on the reading-end side
    const textW = this.w - qr - this.s(8);
    const textX = this.rtl ? this.x1 - textW : this.x0;
    const qrX = this.rtl ? this.x0 : this.x1 - qr;
    drawQr(this.doc, d.trackingUrl, qrX, top, qr);
    this.line(d.shopName, { size: 11, bold: true }, textX, textW);
    this.line(`${this.L.order} ${d.orderNumber}`, { size: 10, bold: true }, textX, textW);
    this.line(d.courier, { size: 9 }, textX, textW);
    if (d.trackingNumber) this.line(`${this.L.tracking} ${d.trackingNumber}`, { size: 12, bold: true }, textX, textW);
    this.y = Math.max(this.y, top + qr) + this.s(2);
    this.line(this.L.scan, { size: 6, align: this.rtl ? 'left' : 'right' });
    this.rule();

    // recipient
    this.line(this.L.to.toUpperCase(), { size: 7, bold: true });
    this.block(d.recipientName, 13, 2, true);
    this.line([formatSlipPhone(d.phone), d.phone2 ? formatSlipPhone(d.phone2) : null].filter(Boolean).join('  /  '), { size: 12, bold: true });
    this.line([d.wilaya, d.commune].filter(Boolean).join(' · '), { size: 10, bold: true });
    if (d.isStopdesk) this.block(`${this.L.stopdesk} : ${d.stopdeskName ?? ''}`.trim(), 9, 2);
    else if (d.address) this.block(d.address, 9, 3);
    this.rule();

    // COD, large
    const h = this.s(40);
    this.doc.save().lineWidth(1.6).rect(this.x0, this.y, this.w, h).stroke().restore();
    const inner = this.w - this.s(16);
    drawBidiLine(this.doc, this.L.cod, this.x0 + this.s(8), this.y + (h - this.s(10) * BIDI_LINE) / 2 + this.s(1), inner, { size: this.s(10), bold: true, align: this.rtl ? 'right' : 'left' });
    drawBidiLine(this.doc, formatSlipAmount(d.codAmount), this.x0 + this.s(8), this.y + (h - this.s(20) * BIDI_LINE) / 2 + this.s(3), inner, { size: this.s(20), bold: true, align: this.rtl ? 'left' : 'right' });
    this.y += h + this.s(4);

    // content
    this.line(this.L.items.toUpperCase(), { size: 7, bold: true });
    this.block(d.itemsSummary || '—', 8, 3);
    this.rule();

    // sender
    this.line(this.L.from.toUpperCase(), { size: 7, bold: true });
    this.line([d.shopName, d.shopPhone ? formatSlipPhone(d.shopPhone) : null].filter(Boolean).join(' · '), { size: 8 });
    const from = [d.senderAddress, d.senderWilaya].filter(Boolean).join(' · ');
    if (from) this.block(from, 7, 2);

    // footer
    const pageH = this.doc.page.height;
    drawBidiLine(this.doc, `Djaber · ${d.trackingUrl}`, this.x0, pageH - this.s(16), this.w, { size: this.s(6), align: 'center' });
  }
}

/** One label per page, in the given order. */
export async function renderDjaberLabels(labels: DjaberLabelData[], format: LabelFormat = 'a6', lang: LabelLang = 'fr'): Promise<Buffer> {
  return new Promise<Buffer>((resolvePdf, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0, lang: lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-DZ' : 'en', info: { Title: labels.length === 1 && labels[0] ? labels[0].orderNumber : `${labels.length} labels`, Creator: 'Djaber', Producer: 'Djaber' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      registerSlipFonts(doc);
      if (!labels.length) doc.addPage({ size: LABEL_SIZES[format], margin: 0 });
      for (const l of labels) {
        doc.addPage({ size: LABEL_SIZES[format], margin: 0 });
        new LabelWriter(doc, l, format, lang).render();
      }
      doc.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
