// DLV-06 / ORD-09 A5 order slip: unit tests for the pdfkit renderer (pages, Arabic glyph coverage, formatting).
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  formatSlipAmount,
  formatSlipDate,
  formatSlipPhone,
  orderBidiRuns,
  renderOrderSlips,
  slipFontPath,
  slipLabels,
  type OrderSlipData,
} from './order-slip.pdf';

type FontkitFont = { hasGlyphForCodePoint(cp: number): boolean };
// fontkit is pdfkit's own dependency (not a direct dependency of the api): resolve it next to pdfkit.
const fontkit = require(require.resolve('fontkit', { paths: [dirname(require.resolve('pdfkit'))] })) as {
  create(buffer: Buffer): FontkitFont;
};

const pageCount = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;

function slip(over: Partial<OrderSlipData> = {}): OrderSlipData {
  return {
    shopName: 'Boutique Yasmine',
    shopPhone: '0770112233',
    number: 'CMD-1042',
    orderedAt: '2026-10-11T23:30:00.000Z',
    clientName: 'Amine Benali',
    clientPhone: '0555123456',
    clientPhone2: null,
    wilaya: '16 · Alger',
    commune: 'Bab Ezzouar',
    address: 'Cité 200 logements, bloc B, porte 12',
    isStopdesk: false,
    stopdeskName: null,
    items: [
      { name: 'Robe kabyle brodée', variant: 'Rouge / M', sku: 'RK-001-M', quantity: 2, unitPrice: 4500, total: 9000 },
      { name: 'Foulard soie', variant: null, sku: null, quantity: 1, unitPrice: 1500, total: 1500 },
    ],
    subtotal: 10500,
    discount: 500,
    deliveryFee: 600,
    total: 10600,
    amountPaid: 0,
    toCollect: 10600,
    paymentMethod: 'Paiement à la livraison',
    notes: 'Appeler avant de livrer.\nPas le vendredi.',
    trackingUrl: 'https://djaber.app/t/abc123XYZ',
    ...over,
  };
}

const arabicSlip = (i: number): OrderSlipData =>
  slip({
    number: `CMD-20${i}`,
    clientName: 'محمد أمين بن علي',
    address: 'حي 200 مسكن، عمارة 3، الطابق الثاني',
    wilaya: '31 · وهران',
    commune: 'بئر الجير',
    paymentMethod: 'الدفع عند الاستلام',
    notes: 'الاتصال قبل التوصيل',
    items: [{ name: 'فستان قبائلي', variant: 'أحمر / M', sku: 'RK-001-M', quantity: 1, unitPrice: 4500, total: 4500 }],
    isStopdesk: i === 2,
    stopdeskName: i === 2 ? 'Yalidine Oran Centre' : null,
    amountPaid: i === 1 ? 1000 : 0,
    toCollect: i === 1 ? 9600 : 10600,
  });

describe('order slip PDF (DLV-06 / ORD-09)', () => {
  it('ships the Arabic font files and licence, resolved from src/ like from dist/', () => {
    for (const weight of ['regular', 'bold'] as const) {
      const file = slipFontPath(weight);
      expect(file.replace(/\\/g, '/')).toMatch(/apps\/api\/assets\/fonts\/NotoNaskhArabic-(Regular|Bold)\.ttf$/);
      expect(existsSync(file)).toBe(true);
    }
    expect(existsSync(slipFontPath('regular').replace(/NotoNaskhArabic-Regular\.ttf$/, 'OFL.txt'))).toBe(true);
  });

  it('the Arabic font covers every Arabic character of the labels and sample data (no .notdef boxes)', () => {
    const sample = [
      ...Object.values(slipLabels('ar')),
      ...[arabicSlip(1)].flatMap((s) => [s.clientName, s.address ?? '', s.wilaya ?? '', s.commune ?? '', s.paymentMethod, s.notes ?? '']),
      'ءآأؤإئابةتثجحخدذرزسشصضطظعغفقكلمنهوىيـ،؛؟',
    ].join('');
    const arabicChars = Array.from(new Set(Array.from(sample))).filter((c) => /[؀-ۿ]/.test(c));
    expect(arabicChars.length).toBeGreaterThan(30);
    for (const weight of ['regular', 'bold'] as const) {
      const font = fontkit.create(readFileSync(slipFontPath(weight)));
      const missing = arabicChars.filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0) ?? 0));
      expect(missing).toEqual([]);
      // Latin digits are also present (amounts may share a run with Arabic text).
      expect(Array.from('0123456789').every((d) => font.hasGlyphForCodePoint(d.charCodeAt(0)))).toBe(true);
    }
  });

  it('renders one French A5 slip with prices on a single page', async () => {
    const pdf = await renderOrderSlips([slip()], { withPrices: true, twoPerPage: false, lang: 'fr' });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pageCount(pdf)).toBe(1);
    expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 419.53 595.28]');
  });

  it('renders 3 Arabic slips two-per-page without prices on 2 A4 pages and embeds the Arabic font', async () => {
    const pdf = await renderOrderSlips([1, 2, 3].map(arabicSlip), { withPrices: false, twoPerPage: true, lang: 'ar' });
    const raw = pdf.toString('latin1');
    expect(raw.startsWith('%PDF')).toBe(true);
    expect(pageCount(pdf)).toBe(2);
    expect(raw).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoNaskhArabic-Bold/);
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoNaskhArabic-Regular/);
  });

  it('flows a 40-item order onto extra A5 pages', async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      name: i % 3 === 0 ? `منتج رقم ${i + 1}` : `Article numéro ${i + 1} avec un nom assez long pour passer à la ligne`,
      variant: i % 2 === 0 ? 'Noir / XL' : null,
      sku: `SKU-${1000 + i}`,
      quantity: (i % 4) + 1,
      unitPrice: 1250,
      total: 1250 * ((i % 4) + 1),
    }));
    const pdf = await renderOrderSlips([slip({ items })], { withPrices: true, twoPerPage: false, lang: 'fr' });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(pages).toBeLessThanOrEqual(6);

    const half = await renderOrderSlips([slip({ items }), slip()], { withPrices: false, twoPerPage: true, lang: 'en' });
    expect(pageCount(half)).toBeGreaterThanOrEqual(3);
  });

  it('renders an empty batch as one blank page', async () => {
    const pdf = await renderOrderSlips([], { withPrices: true, twoPerPage: false, lang: 'en' });
    expect(pageCount(pdf)).toBe(1);
  });

  it('formats amounts, phones and Algiers dates with Latin digits', () => {
    expect(formatSlipAmount(12500)).toBe('12 500 DA');
    expect(formatSlipAmount(1234567)).toBe('1 234 567 DA');
    expect(formatSlipAmount(0)).toBe('0 DA');
    expect(formatSlipAmount(-500)).toBe('–500 DA'); // journey J06v-2: the PDF-safe minus, glued
    expect(formatSlipPhone('0555123456')).toBe('0555 12 34 56');
    expect(formatSlipPhone('٠٥٥٥١٢٣٤٥٦')).toBe('0555 12 34 56');
    expect(formatSlipPhone('021234567')).toBe('021 23 45 67');
    expect(formatSlipPhone('+33 6 12')).toBe('+33 6 12');
    // 23:30 UTC = 00:30 next day in Africa/Algiers (UTC+1).
    expect(formatSlipDate('2026-10-11T23:30:00.000Z')).toBe('12/10/2026 00:30');
  });

  it('keeps numbers left-to-right inside Arabic text and orders runs right-to-left', () => {
    // Logical "حي 200 مسكن": visually (left to right) "مسكن", "200", "حي".
    const runs = orderBidiRuns('حي 200 مسكن').filter((r) => r.text.trim() !== '');
    expect(runs.map((r) => r.text.trim())).toEqual(['مسكن', '200', 'حي']);
    expect(runs.map((r) => r.rtl)).toEqual([true, false, true]);
    expect(runs[1]?.font).toBe('latin');
    // Digits are weak: "31 · وهران" is an RTL paragraph, so the wilaya code ends up on the right.
    expect(orderBidiRuns('31 · وهران').map((r) => r.text.trim()).filter(Boolean)).toEqual(['وهران', '·', '31']);
    // Digits after a Latin letter stay inside the LTR run (SKU inside Arabic text).
    expect(orderBidiRuns('أحمر RK-001-M').map((r) => r.text.trim()).filter(Boolean)).toEqual(['RK-001-M', 'أحمر']);
    // Latin text stays a single LTR run.
    expect(orderBidiRuns('CMD-1042 · 16 · Alger')).toEqual([{ text: 'CMD-1042 · 16 · Alger', font: 'latin', rtl: false }]);
    // Arabic name inside a French slip: one Arabic RTL run.
    expect(orderBidiRuns('محمد أمين')).toEqual([{ text: 'محمد أمين', font: 'arabic', rtl: true }]);
  });
});
