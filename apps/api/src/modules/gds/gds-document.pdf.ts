// GDS printouts (pdfkit, same fonts / bidi helpers as the order slips): purchase order `GET /purchases/:id/print`,
// sale ticket `GET /sales/:id/receipt`, inventory count sheet `GET /inventories/:id/sheet`. A4 portrait: header (shop,
// document title + number, meta lines), one table (repeated header on each page), totals, footer note.
import PDFDocument from 'pdfkit';
import { BIDI_LINE, drawBidiLine, formatSlipAmount, formatSlipDate, registerSlipFonts, wrapBidi } from '../orders/print/order-slip.pdf';

export type GdsLang = 'fr' | 'ar' | 'en';
export type GdsColumn = { header: string; width: number; align?: 'left' | 'right' | 'center' };
export type GdsDocument = {
  lang: GdsLang;
  shopName: string;
  title: string;
  number: string;
  meta: { label: string; value: string }[];
  columns: GdsColumn[];
  rows: string[][];
  totals: { label: string; value: string; bold?: boolean }[];
  note?: string | null;
  /** M8 report / export tables: A4 landscape for wide tables */
  landscape?: boolean;
  /** M8: shop logo (PNG / JPEG bytes) drawn at the top corner; ignored when unreadable */
  logo?: Buffer | null;
};

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const ROW_H = 18;

export const money = (n: number) => formatSlipAmount(n);

/**
 * full-test 15/11 SALES-CASH-20: the embedded fonts have no emoji / dingbats — pdfkit printed « ? » for « ✓ » and « 😀 ».
 * Those signs are left out (letters of every script, digits and punctuation stay).
 */
const NO_GLYPH = /\p{Extended_Pictographic}|[\u2600-\u27BF\u2B00-\u2BFF\uFE0E\uFE0F\u200D\u20E3]|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu;
export const printable = (text: string): string => (text ? text.replace(NO_GLYPH, '').replace(/[ \t]{2,}/g, ' ').trim() : text);
export const dateLabel = (iso: string) => formatSlipDate(iso);

export async function renderGdsDocument(input: GdsDocument): Promise<Buffer> {
  const d: GdsDocument = {
    ...input,
    shopName: printable(input.shopName),
    meta: input.meta.map((m) => ({ label: m.label, value: printable(m.value) })),
    rows: input.rows.map((row) => row.map(printable)),
    note: input.note ? printable(input.note) : input.note,
  };
  return new Promise<Buffer>((resolvePdf, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0, lang: d.lang === 'ar' ? 'ar-DZ' : d.lang === 'fr' ? 'fr-DZ' : 'en', info: { Title: `${d.title} ${d.number}`, Creator: 'Djaber', Producer: 'Djaber' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      registerSlipFonts(doc);
      const PAGE: [number, number] = d.landscape ? [A4[1], A4[0]] : A4;
      const width = PAGE[0] - 2 * M;
      const scale = width / d.columns.reduce((s, c) => s + c.width, 0);
      const cols = d.columns.map((c) => ({ ...c, w: c.width * scale }));
      const rtl = d.lang === 'ar';
      const ordered = rtl ? [...cols].reverse() : cols;
      let y = 0;
      const header = () => {
        doc.addPage({ size: PAGE, margin: 0 });
        y = M;
        if (d.logo) {
          try {
            doc.image(d.logo, rtl ? M : PAGE[0] - M - 60, M, { fit: [60, 36] });
          } catch {
            // unsupported image format (webp, svg): the header stays text-only
          }
        }
        drawBidiLine(doc, d.shopName, M, y, width, { size: 11, bold: true, align: rtl ? 'right' : 'left' });
        y += 11 * BIDI_LINE;
        drawBidiLine(doc, `${d.title} ${d.number}`, M, y, width, { size: 16, bold: true, align: rtl ? 'right' : 'left' });
        y += 16 * BIDI_LINE + 4;
        for (const m of d.meta) {
          drawBidiLine(doc, `${m.label} : ${m.value}`, M, y, width, { size: 9, align: rtl ? 'right' : 'left' });
          y += 9 * BIDI_LINE;
        }
        y += 6;
        tableHeader();
      };
      const tableHeader = () => {
        doc.save().rect(M, y, width, ROW_H).fill('#eeeeee').restore();
        let x = M;
        for (const c of ordered) {
          drawBidiLine(doc, c.header, x + 3, y + 3, c.w - 6, { size: 8, bold: true, align: c.align ?? (rtl ? 'right' : 'left') });
          x += c.w;
        }
        y += ROW_H;
      };
      header();
      for (const row of d.rows) {
        const cells = rtl ? [...row].reverse() : row;
        const wrapped = ordered.map((c, i) => wrapBidi(doc, cells[i] ?? '', c.w - 6, 9, false, 3));
        const h = Math.max(ROW_H, Math.max(...wrapped.map((w) => w.length)) * 9 * BIDI_LINE + 4);
        if (y + h > PAGE[1] - M - 60) {
          header();
        }
        let x = M;
        ordered.forEach((c, i) => {
          let ty = y + 3;
          for (const line of wrapped[i]!) {
            drawBidiLine(doc, line, x + 3, ty, c.w - 6, { size: 9, align: c.align ?? (rtl ? 'right' : 'left') });
            ty += 9 * BIDI_LINE;
          }
          x += c.w;
        });
        doc.save().lineWidth(0.3).strokeColor('#cccccc').moveTo(M, y + h).lineTo(M + width, y + h).stroke().restore();
        y += h;
      }
      y += 8;
      for (const t of d.totals) {
        if (y + 14 > PAGE[1] - M) header();
        drawBidiLine(doc, `${t.label} : ${t.value}`, M, y, width, { size: t.bold ? 11 : 9, bold: t.bold, align: rtl ? 'left' : 'right' });
        y += (t.bold ? 11 : 9) * BIDI_LINE;
      }
      if (d.note) {
        y += 6;
        for (const line of wrapBidi(doc, d.note, width, 9, false, 6)) {
          drawBidiLine(doc, line, M, y, width, { size: 9, align: rtl ? 'right' : 'left' });
          y += 9 * BIDI_LINE;
        }
      }
      doc.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export const GDS_LABELS: Record<GdsLang, Record<string, string>> = {
  fr: {
    purchase: 'Bon de commande fournisseur', sale: 'Ticket de vente', inventory: "Feuille d'inventaire", supplier: 'Fournisseur', date: 'Date', expected: 'Livraison prévue',
    invoice: 'Facture fournisseur', status: 'Statut', product: 'Produit', variant: 'Variante', qty: 'Qté', received: 'Reçu', unitCost: 'Coût unit.', unitPrice: 'Prix unit.',
    total: 'Total', subtotal: 'Sous-total', tax: 'Taxe', shipping: 'Frais de port', discount: 'Remise', paid: 'Payé', remaining: 'Reste dû', client: 'Client', seller: 'Vendeur',
    payment: 'Paiement', sku: 'SKU', expectedQty: 'Attendu', counted: 'Compté', scope: 'Périmètre', startedAt: 'Commencé le', note: 'Note', walkIn: 'Passage',
  },
  ar: {
    purchase: 'وصل طلب مورّد', sale: 'وصل البيع', inventory: 'ورقة الجرد', supplier: 'المورّد', date: 'التاريخ', expected: 'التسليم المتوقع',
    invoice: 'فاتورة المورّد', status: 'الحالة', product: 'المنتج', variant: 'المتغيّر', qty: 'الكمية', received: 'المستلم', unitCost: 'تكلفة الوحدة', unitPrice: 'سعر الوحدة',
    total: 'المجموع', subtotal: 'المجموع الفرعي', tax: 'الضريبة', shipping: 'مصاريف الشحن', discount: 'التخفيض', paid: 'المدفوع', remaining: 'المتبقي', client: 'الزبون', seller: 'البائع',
    payment: 'الدفع', sku: 'SKU', expectedQty: 'المتوقع', counted: 'المعدود', scope: 'النطاق', startedAt: 'بدأ في', note: 'ملاحظة', walkIn: 'زبون عابر',
  },
  en: {
    purchase: 'Purchase order', sale: 'Sales receipt', inventory: 'Inventory count sheet', supplier: 'Supplier', date: 'Date', expected: 'Expected delivery',
    invoice: 'Supplier invoice', status: 'Status', product: 'Product', variant: 'Variant', qty: 'Qty', received: 'Received', unitCost: 'Unit cost', unitPrice: 'Unit price',
    total: 'Total', subtotal: 'Subtotal', tax: 'Tax', shipping: 'Shipping', discount: 'Discount', paid: 'Paid', remaining: 'Remaining', client: 'Client', seller: 'Seller',
    payment: 'Payment', sku: 'SKU', expectedQty: 'Expected', counted: 'Counted', scope: 'Scope', startedAt: 'Started', note: 'Note', walkIn: 'Walk-in',
  },
};
