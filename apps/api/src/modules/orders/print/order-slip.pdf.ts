// DLV-06 / ORD-09 A5 order slip: server-side PDF renderer (pdfkit, pure function, no DI).
// Arabic runs use Noto Naskh Arabic (OFL, apps/api/assets/fonts), Latin runs use Helvetica.
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';

export type SlipLang = 'fr' | 'ar' | 'en';
export type OrderSlipData = {
  shopName: string;
  shopPhone: string | null;
  /** UX-048 (10/11): the shop address and logo of Paramètres › Boutique (« utilisé sur PDF et étiquettes ») */
  shopAddress?: string | null;
  logo?: Buffer | null; // PNG / JPEG bytes; skipped when unreadable
  number: string; // "CMD-1042"
  orderedAt: string; // ISO UTC; rendered in Africa/Algiers as dd/mm/yyyy HH:mm, Latin digits
  clientName: string; // may contain Arabic or Latin
  clientPhone: string; // "0555123456", rendered grouped "0555 12 34 56"
  clientPhone2: string | null;
  wilaya: string | null; // "16 · Alger" (already formatted by the caller)
  commune: string | null;
  address: string | null; // may contain Arabic
  isStopdesk: boolean;
  stopdeskName: string | null; // relay point name (+ address), never its technical id (UX-049)
  items: { name: string; variant: string | null; sku: string | null; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  amountPaid: number; // integer DZD
  paymentMethod: string; // already-localized label, e.g. "Paiement à la livraison"
  notes: string | null;
  trackingUrl: string | null; // public tracking link, printed as text under the header (no QR code)
};
export type OrderSlipOptions = { withPrices: boolean; twoPerPage: boolean; lang: SlipLang };

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const FONT_FILES = { regular: 'NotoNaskhArabic-Regular.ttf', bold: 'NotoNaskhArabic-Bold.ttf' } as const;

/** `src/modules/orders/print` and `dist/modules/orders/print` are both 4 levels below `apps/api`. */
export function slipFontPath(weight: keyof typeof FONT_FILES): string {
  return resolve(__dirname, '../../../../assets/fonts', FONT_FILES[weight]);
}

type FontKey = 'lat' | 'latB' | 'ar' | 'arB';
const PDF_FONT: Record<FontKey, string> = { lat: 'Helvetica', latB: 'Helvetica-Bold', ar: 'slip-ar', arB: 'slip-ar-bold' };
const isArabicFont = (f: FontKey): boolean => f === 'ar' || f === 'arB';

// ---------------------------------------------------------------------------
// Formatting helpers (Latin digits, integer DZD, Africa/Algiers)
// ---------------------------------------------------------------------------

/** `12500` -> `12 500 DA`. */
export function formatSlipAmount(value: number): string {
  const v = Math.round(value);
  const digits = Math.abs(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${v < 0 ? '-' : ''}${digits} DA`;
}

/** `0555123456` -> `0555 12 34 56`; 9-digit landlines -> `021 23 45 67`; anything else unchanged. */
export function formatSlipPhone(raw: string): string {
  const d = normalizeDigits(raw).replace(/[^\d+]/g, '');
  if (/^0\d{9}$/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
  if (/^0\d{8}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7)}`;
  return raw.trim();
}

const ALGIERS_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Algiers',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** ISO UTC -> `dd/mm/yyyy HH:mm` in Africa/Algiers. */
export function formatSlipDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = ALGIERS_FMT.formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Arabic-Indic digits -> Latin digits; whitespace collapsed. */
function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (c) => {
    const cp = c.charCodeAt(0);
    return String(cp >= 0x06f0 ? cp - 0x06f0 : cp - 0x0660);
  });
}
const clean = (text: string): string => normalizeDigits(text).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Minimal bidi: pdfkit/fontkit shape Arabic and reverse an RTL run, but do no
// paragraph-level reordering, so lines are split into (direction, font) runs here.
// ---------------------------------------------------------------------------

const isArabicCp = (cp: number): boolean =>
  (cp >= 0x0600 && cp <= 0x06ff) ||
  (cp >= 0x0750 && cp <= 0x077f) ||
  (cp >= 0x08a0 && cp <= 0x08ff) ||
  (cp >= 0xfb50 && cp <= 0xfdff) ||
  (cp >= 0xfe70 && cp <= 0xfeff);

// Characters of the WinAnsi (cp1252) encoding used by the standard Helvetica font.
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);
const isWinAnsi = (cp: number): boolean => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp);

type Strong = 'L' | 'R';
/** L/R strong letters, E European digits (weak), N neutrals. */
type CharClass = Strong | 'E' | 'N';
function charClass(ch: string): CharClass {
  const cp = ch.codePointAt(0) ?? 0;
  if (isArabicCp(cp)) return cp === 0x060c ? 'N' : 'R'; // Arabic comma is a neutral
  if (cp >= 0x30 && cp <= 0x39) return 'E';
  return /[\p{L}\p{N}]/u.test(ch) ? 'L' : 'N';
}

export type BidiRun = { text: string; font: 'arabic' | 'latin'; rtl: boolean };
type Seg = { text: string; font: FontKey; level: number; arabic: boolean };

/** Logical text -> runs in visual (left-to-right drawing) order. */
function visualSegments(text: string, bold: boolean): Seg[] {
  const chars = Array.from(text);
  if (chars.length === 0) return [];
  const raw = chars.map(charClass);
  // Paragraph direction = first strong letter (digits are weak), LTR when there is none.
  const base: Strong = (raw.find((t) => t === 'L' || t === 'R') as Strong | undefined) ?? 'L';

  // W7: digits preceded by a Latin letter (or at the start of an LTR paragraph) are LTR text.
  let lastStrong: Strong = base;
  const types: CharClass[] = raw.map((t) => {
    if (t === 'L' || t === 'R') lastStrong = t;
    return t === 'E' && lastStrong === 'L' ? 'L' : t;
  });

  // N1/N2: neutrals take the direction of their neighbours when both agree (digits count as RTL), else the base.
  const asDir = (t: CharClass | undefined): Strong => (t === 'L' ? 'L' : t === undefined ? base : 'R');
  const resolved: CharClass[] = [...types];
  for (let i = 0; i < chars.length; ) {
    if (types[i] !== 'N') {
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && types[j] === 'N') j++;
    const prev = i > 0 ? asDir(types[i - 1]) : base;
    const next = j < chars.length ? asDir(types[j]) : base;
    const dir = prev === next ? prev : base;
    for (let k = i; k < j; k++) resolved[k] = dir;
    i = j;
  }

  // Embedding levels (I1/I2) + font per character, grouped into logical segments.
  const logical: Seg[] = [];
  chars.forEach((ch, i) => {
    const t = resolved[i] ?? base;
    const level = t === 'R' ? 1 : t === 'E' ? 2 : base === 'L' ? 0 : 2;
    const cp = ch.codePointAt(0) ?? 0;
    let font: FontKey;
    let out = ch;
    if (level % 2 === 1 && (isArabicCp(cp) || ch === ' ')) font = 'ar';
    else if (isWinAnsi(cp)) font = 'lat';
    else if (isArabicCp(cp)) font = 'ar';
    else {
      font = 'lat';
      out = '?'; // no glyph in either font
    }
    if (bold) font = font === 'ar' ? 'arB' : 'latB';
    const arabic = charClass(ch) === 'R';
    const last = logical[logical.length - 1];
    if (last && last.font === font && last.level === level) {
      last.text += out;
      last.arabic ||= arabic;
    } else {
      logical.push({ text: out, font, level, arabic });
    }
  });

  // Reorder segments (UBA rule L2), from the highest level down to 1.
  const maxLevel = Math.max(...logical.map((s) => s.level));
  let segs = logical;
  for (let lvl = maxLevel; lvl >= 1; lvl--) {
    const next: Seg[] = [];
    for (let i = 0; i < segs.length; ) {
      const s = segs[i] as Seg;
      if (s.level < lvl) {
        next.push(s);
        i++;
        continue;
      }
      let j = i;
      while (j < segs.length && (segs[j] as Seg).level >= lvl) j++;
      next.push(...segs.slice(i, j).reverse());
      i = j;
    }
    segs = next;
  }
  // RTL runs with Arabic letters are reversed by fontkit itself; reverse neutral-only RTL runs here.
  return segs.map((s) => (s.level % 2 === 1 && !s.arabic ? { ...s, text: Array.from(s.text).reverse().join('') } : s));
}

/** Exposed for tests: visual run order of a line. */
export function orderBidiRuns(text: string): BidiRun[] {
  return visualSegments(clean(text), false).map((s) => ({
    text: s.text,
    font: isArabicFont(s.font) ? 'arabic' : 'latin',
    rtl: s.level % 2 === 1,
  }));
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

type LabelKey =
  | 'title' | 'client' | 'name' | 'phone' | 'phone2' | 'delivery' | 'home' | 'wilaya' | 'commune' | 'address' | 'stopdesk'
  | 'item' | 'qty' | 'price' | 'total' | 'subtotal' | 'discount' | 'deliveryFee' | 'paid' | 'collect' | 'payment'
  | 'note' | 'tracking' | 'continued';

const LABELS: Record<SlipLang, Record<LabelKey, string>> = {
  fr: {
    title: 'Bon de commande', client: 'Client', name: 'Nom', phone: 'Téléphone', phone2: 'Téléphone 2', delivery: 'Livraison',
    home: 'À domicile', wilaya: 'Wilaya', commune: 'Commune', address: 'Adresse', stopdesk: 'Point relais',
    item: 'Article', qty: 'Qté', price: 'Prix', total: 'Total', subtotal: 'Sous-total', discount: 'Remise',
    deliveryFee: 'Livraison', paid: 'Déjà payé', collect: 'À encaisser', payment: 'Paiement', note: 'Note',
    tracking: 'Suivi', continued: 'suite',
  },
  ar: {
    title: 'وصل الطلبية', client: 'الزبون', name: 'الاسم', phone: 'الهاتف', phone2: 'الهاتف 2', delivery: 'التوصيل',
    home: 'إلى المنزل', wilaya: 'الولاية', commune: 'البلدية', address: 'العنوان', stopdesk: 'نقطة الاستلام',
    item: 'المنتج', qty: 'الكمية', price: 'السعر', total: 'المجموع', subtotal: 'المجموع الفرعي', discount: 'التخفيض',
    deliveryFee: 'التوصيل', paid: 'المدفوع مسبقا', collect: 'المبلغ المطلوب', payment: 'الدفع', note: 'ملاحظة',
    tracking: 'التتبع', continued: 'تابع',
  },
  en: {
    title: 'Order slip', client: 'Customer', name: 'Name', phone: 'Phone', phone2: 'Phone 2', delivery: 'Delivery',
    home: 'Home delivery', wilaya: 'Wilaya', commune: 'Commune', address: 'Address', stopdesk: 'Pickup point',
    item: 'Item', qty: 'Qty', price: 'Price', total: 'Total', subtotal: 'Subtotal', discount: 'Discount',
    deliveryFee: 'Delivery', paid: 'Already paid', collect: 'To collect', payment: 'Payment', note: 'Note',
    tracking: 'Tracking', continued: 'continued',
  },
};

/** Exposed for tests (glyph coverage of the Arabic labels). */
export function slipLabels(lang: SlipLang): Readonly<Record<string, string>> {
  return LABELS[lang];
}

// ---------------------------------------------------------------------------
// Page geometry
// ---------------------------------------------------------------------------

const A5: [number, number] = [419.53, 595.28];
const A4: [number, number] = [595.28, 841.89];
const LINE = 1.5; // line height factor (Naskh has tall ascenders/descenders)
const ASCENT = 1.05; // baseline offset from the top of a line, in font sizes
const LOGO = 40; // header logo box (pt)

type Box = { x0: number; x1: number; top: number; bottom: number };
type Align = 'left' | 'right' | 'center';
type TextStyle = { size: number; bold?: boolean; align?: Align };

class Pager {
  private half: 0 | 1 = 1;
  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly twoPerPage: boolean,
  ) {}

  next(): Box {
    const doc = this.doc;
    if (!this.twoPerPage) {
      doc.addPage({ size: A5, margin: 0 });
      return { x0: 28, x1: A5[0] - 28, top: 28, bottom: A5[1] - 28 };
    }
    const [w, h] = A4;
    if (this.half === 1) {
      doc.addPage({ size: A4, margin: 0 });
      doc.save().lineWidth(0.5).dash(4, { space: 4 }).moveTo(12, h / 2).lineTo(w - 12, h / 2).stroke().undash().restore();
      this.half = 0;
      return { x0: 32, x1: w - 32, top: 24, bottom: h / 2 - 20 };
    }
    this.half = 1;
    return { x0: 32, x1: w - 32, top: h / 2 + 24, bottom: h - 24 };
  }
}

class SlipWriter {
  private box: Box;
  private y: number;
  private readonly rtl: boolean;
  private readonly L: Record<LabelKey, string>;
  private onBreak: (() => void) | null = null;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly pager: Pager,
    private readonly slip: OrderSlipData,
    private readonly opts: OrderSlipOptions,
  ) {
    this.rtl = opts.lang === 'ar';
    this.L = LABELS[opts.lang];
    this.box = pager.next();
    this.y = this.box.top;
  }

  // -- primitives -----------------------------------------------------------

  private get start(): Align {
    return this.rtl ? 'right' : 'left';
  }
  private get end(): Align {
    return this.rtl ? 'left' : 'right';
  }
  private get width(): number {
    return this.box.x1 - this.box.x0;
  }
  /** Left x of a column placed `offset` points from the reading-start edge. */
  private colX(offset: number, w: number): number {
    return this.rtl ? this.box.x1 - offset - w : this.box.x0 + offset;
  }

  private measure(text: string, size: number, bold = false): number {
    let w = 0;
    for (const s of visualSegments(text, bold)) w += this.segWidth(s, size);
    return w;
  }
  private segWidth(s: Seg, size: number): number {
    this.doc.font(PDF_FONT[s.font]).fontSize(size);
    // `features` makes pdfkit shape the whole run at once instead of word by word.
    return this.doc.widthOfString(s.text, isArabicFont(s.font) ? { features: [] } : {});
  }

  /** Draws one line (no wrapping) inside [x, x + w], `top` = top of the line box. */
  private drawLine(text: string, x: number, top: number, w: number, style: TextStyle): void {
    const segs = visualSegments(clean(text), !!style.bold);
    const widths = segs.map((s) => this.segWidth(s, style.size));
    const total = widths.reduce((a, b) => a + b, 0);
    const align = style.align ?? 'left';
    let cx = align === 'right' ? x + w - total : align === 'center' ? x + (w - total) / 2 : x;
    const baseline = top + style.size * ASCENT;
    segs.forEach((s, i) => {
      this.doc
        .font(PDF_FONT[s.font])
        .fontSize(style.size)
        .text(s.text, cx, baseline, { lineBreak: false, baseline: 'alphabetic', ...(isArabicFont(s.font) ? { features: [] } : {}) });
      cx += widths[i] ?? 0;
    });
  }

  /** Greedy word wrap on logical text; over-long words are split by characters. */
  private wrap(text: string, w: number, size: number, bold = false): string[] {
    const lines: string[] = [];
    let cur = '';
    const pushWord = (word: string): void => {
      if (this.measure(word, size, bold) <= w) {
        cur = word;
        return;
      }
      let chunk = '';
      for (const ch of Array.from(word)) {
        if (chunk && this.measure(chunk + ch, size, bold) > w) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      cur = chunk;
    };
    for (const word of clean(text).split(' ').filter(Boolean)) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (cur && this.measure(candidate, size, bold) <= w) cur = candidate;
      else {
        if (cur) lines.push(cur);
        pushWord(word);
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  /** Wrapped block at an explicit position (no page break); returns the bottom y. */
  private block(text: string, x: number, top: number, w: number, style: TextStyle): number {
    let y = top;
    for (const line of this.wrap(text, w, style.size, style.bold)) {
      this.drawLine(line, x, y, w, style);
      y += style.size * LINE;
    }
    return y;
  }

  private ensure(h: number): void {
    if (this.y + h <= this.box.bottom) return;
    this.box = this.pager.next();
    this.y = this.box.top;
    this.continuationHeader();
    this.onBreak?.();
  }

  private rule(weight = 0.6, gap = 6, color = '#000000'): void {
    this.doc.save().lineWidth(weight).strokeColor(color).moveTo(this.box.x0, this.y).lineTo(this.box.x1, this.y).stroke().restore();
    this.y += gap;
  }

  /** Label + wrapping value spanning the full width; flows across pages line by line. */
  private flowField(label: string, value: string, labelW: number, size = 9.5): void {
    const valueW = this.width - labelW;
    const lines = this.wrap(value, valueW, size);
    lines.forEach((line, i) => {
      this.ensure(size * LINE);
      if (i === 0) this.drawLine(label, this.colX(0, labelW), this.y + 1, labelW, { size: size - 1, bold: true, align: this.start });
      this.drawLine(line, this.colX(labelW, valueW), this.y, valueW, { size, align: this.start });
      this.y += size * LINE;
    });
  }

  // -- sections -------------------------------------------------------------

  render(): void {
    this.header();
    this.parties();
    this.itemsTable();
    if (this.opts.withPrices) this.totals();
    this.footer();
  }

  private header(): void {
    const s = this.slip;
    const leftW = this.width * 0.56;
    const rightW = this.width - leftW - 8;
    const top = this.y;
    // UX-048: logo at the start of the header, then name, phone and address of the shop
    let logoH = 0;
    if (s.logo) {
      try {
        this.doc.image(s.logo, this.colX(0, LOGO), top, { fit: [LOGO, LOGO] });
        logoH = LOGO;
      } catch {
        logoH = 0; // unreadable image: the header is printed without it
      }
    }
    const textX = logoH ? LOGO + 8 : 0;
    const textW = leftW - textX;
    let a = this.block(s.shopName, this.colX(textX, textW), top, textW, { size: 15, bold: true, align: this.start });
    if (s.shopPhone) {
      this.drawLine(formatSlipPhone(s.shopPhone), this.colX(textX, textW), a, textW, { size: 9, align: this.start });
      a += 9 * LINE;
    }
    if (s.shopAddress) a = this.block(s.shopAddress, this.colX(textX, textW), a, textW, { size: 8.5, align: this.start });
    a = Math.max(a, top + logoH);
    const rx = this.colX(leftW + 8, rightW);
    let b = top;
    this.drawLine(this.L.title, rx, b, rightW, { size: 9, bold: true, align: this.end });
    b += 9 * LINE;
    this.drawLine(s.number, rx, b, rightW, { size: 14, bold: true, align: this.end });
    b += 14 * LINE;
    this.drawLine(formatSlipDate(s.orderedAt), rx, b, rightW, { size: 9, align: this.end });
    b += 9 * LINE;
    this.y = Math.max(a, b) + 2;
    if (s.trackingUrl) this.flowField(this.L.tracking, s.trackingUrl, 52, 8.5);
    this.y += 2;
    this.rule(1, 8);
  }

  private parties(): void {
    const s = this.slip;
    const L = this.L;
    const gap = 16;
    const colW = (this.width - gap) / 2;
    const labelW = 60;
    const column = (offset: number, title: string, rows: [string, string, boolean?][]): number => {
      const x = this.colX(offset, colW);
      let y = this.y;
      this.drawLine(title, x, y, colW, { size: 9.5, bold: true, align: this.start });
      y += 9.5 * LINE + 1;
      for (const [label, value, strong] of rows) {
        const lx = this.rtl ? x + colW - labelW : x;
        const vx = this.rtl ? x : x + labelW;
        this.drawLine(label, lx, y + 1, labelW, { size: 8.5, bold: true, align: this.start });
        y = this.block(value, vx, y, colW - labelW, { size: strong ? 10.5 : 9.5, bold: strong, align: this.start });
      }
      return y;
    };
    const clientRows: [string, string, boolean?][] = [
      [L.name, s.clientName, true],
      [L.phone, formatSlipPhone(s.clientPhone), true],
    ];
    if (s.clientPhone2) clientRows.push([L.phone2, formatSlipPhone(s.clientPhone2)]);
    const deliveryRows: [string, string, boolean?][] = [];
    if (s.wilaya) deliveryRows.push([L.wilaya, s.wilaya]);
    if (s.commune) deliveryRows.push([L.commune, s.commune]);
    if (s.isStopdesk) deliveryRows.push([L.stopdesk, s.stopdeskName ?? '-', true]);
    else if (s.address) deliveryRows.push([L.address, s.address]);
    const deliveryTitle = `${L.delivery} · ${s.isStopdesk ? L.stopdesk : L.home}`;
    const a = column(0, L.client, clientRows);
    const b = column(colW + gap, deliveryTitle, deliveryRows);
    this.y = Math.max(a, b) + 4;
    this.rule(0.6, 8);
  }

  private itemsTable(): void {
    const L = this.L;
    const withPrices = this.opts.withPrices;
    const qtyW = withPrices ? 34 : 44;
    const priceW = withPrices ? 66 : 0;
    const totalW = withPrices ? 72 : 0;
    const nameW = this.width - qtyW - priceW - totalW;
    const cols = {
      name: this.colX(0, nameW),
      qty: this.colX(nameW, qtyW),
      price: this.colX(nameW + qtyW, priceW),
      total: this.colX(nameW + qtyW + priceW, totalW),
    };
    const headerRow = (): void => {
      const h = 8.5;
      this.drawLine(L.item, cols.name, this.y, nameW - 6, { size: h, bold: true, align: this.start });
      this.drawLine(L.qty, cols.qty, this.y, qtyW, { size: h, bold: true, align: 'center' });
      if (withPrices) {
        this.drawLine(L.price, cols.price, this.y, priceW - 4, { size: h, bold: true, align: this.end });
        this.drawLine(L.total, cols.total, this.y, totalW, { size: h, bold: true, align: this.end });
      }
      this.y += h * LINE;
      this.rule(0.6, 4);
    };
    this.ensure(8.5 * LINE + 40);
    headerRow();
    this.onBreak = headerRow;

    const nameSize = 9.5;
    const subSize = 8;
    const pad = 4;
    this.slip.items.forEach((item, idx) => {
      const nameLines = this.wrap(item.name, nameW - 6, nameSize);
      const variant = item.variant?.trim() || null;
      const sku = item.sku?.trim() || null;
      // Variant and SKU are drawn as separate runs (an Arabic variant + Latin SKU must not be bidi-mixed).
      const pieces = variant && sku ? [variant, '·', sku] : null;
      const pieceW = pieces ? pieces.map((p) => this.measure(p, subSize)) : [];
      const gapW = 4;
      const fitsOneLine = pieces !== null && pieceW.reduce((a, b) => a + b + gapW, 0) <= nameW - 6;
      const subLines = fitsOneLine ? [''] : variant || sku ? this.wrap([variant, sku].filter(Boolean).join(' · '), nameW - 6, subSize) : [];
      const rowH = nameLines.length * nameSize * LINE + subLines.length * subSize * LINE + pad;
      this.ensure(rowH + 2);
      const top = this.y;
      let y = top;
      for (const line of nameLines) {
        this.drawLine(line, cols.name, y, nameW - 6, { size: nameSize, align: this.start });
        y += nameSize * LINE;
      }
      if (fitsOneLine && pieces) {
        // Start edge: left in LTR, right edge of the name column in RTL.
        let cursor = this.rtl ? cols.name + nameW - 6 : cols.name;
        pieces.forEach((p, i) => {
          const w = pieceW[i] ?? 0;
          const x = this.rtl ? cursor - w : cursor;
          this.drawLine(p, x, y, w, { size: subSize, align: 'left' });
          cursor = this.rtl ? cursor - w - gapW : cursor + w + gapW;
        });
        y += subSize * LINE;
      } else {
        for (const line of subLines) {
          this.drawLine(line, cols.name, y, nameW - 6, { size: subSize, align: this.start });
          y += subSize * LINE;
        }
      }
      this.drawLine(String(Math.round(item.quantity)), cols.qty, top, qtyW, { size: 10, bold: true, align: 'center' });
      if (withPrices) {
        this.drawLine(formatSlipAmount(item.unitPrice), cols.price, top, priceW - 4, { size: nameSize, align: this.end });
        this.drawLine(formatSlipAmount(item.total), cols.total, top, totalW, { size: nameSize, align: this.end });
      }
      this.y = top + rowH;
      if (idx < this.slip.items.length - 1) this.rule(0.3, 4, '#9a9a9a');
    });
    this.onBreak = null;
    this.y += 2;
    this.rule(0.6, 6);
  }

  private totals(): void {
    const s = this.slip;
    const L = this.L;
    const rows: [string, string, boolean][] = [[L.subtotal, formatSlipAmount(s.subtotal), false]];
    if (s.discount > 0) rows.push([L.discount, formatSlipAmount(-Math.abs(s.discount)), false]);
    rows.push([L.deliveryFee, formatSlipAmount(s.deliveryFee), false]);
    rows.push([L.total, formatSlipAmount(s.total), true]);
    if (s.amountPaid > 0) rows.push([L.paid, formatSlipAmount(-Math.abs(s.amountPaid)), false]);
    const size = 9.5;
    this.ensure(rows.length * size * LINE + 4);
    const blockW = Math.min(240, this.width * 0.62);
    const x = this.rtl ? this.box.x0 : this.box.x1 - blockW;
    const labelAlign: Align = this.rtl ? 'right' : 'left';
    for (const [label, amount, strong] of rows) {
      this.drawLine(label, x, this.y, blockW, { size, bold: strong, align: labelAlign });
      this.drawLine(amount, x, this.y, blockW, { size, bold: strong, align: this.end });
      this.y += size * LINE;
    }
    this.y += 4;
  }

  private footer(): void {
    const s = this.slip;
    const L = this.L;
    if (s.paymentMethod.trim()) this.flowField(L.payment, s.paymentMethod, 70);
    if (s.notes && s.notes.trim()) {
      const paragraphs = s.notes.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
      paragraphs.forEach((p, i) => this.flowField(i === 0 ? L.note : '', p, 70));
    }
    // Large "amount to collect" box.
    const h = 40;
    this.y += 6;
    this.ensure(h + 2);
    const { x0 } = this.box;
    this.doc.save().lineWidth(1.4).rect(x0, this.y, this.width, h).stroke().restore();
    const inner = this.width - 24;
    this.drawLine(L.collect, x0 + 12, this.y + (h - 12 * LINE) / 2 + 2, inner, { size: 12, bold: true, align: this.start });
    this.drawLine(formatSlipAmount(Math.max(0, s.total - s.amountPaid)), x0 + 12, this.y + (h - 18 * LINE) / 2 + 3, inner, {
      size: 18,
      bold: true,
      align: this.end,
    });
    this.y += h;
  }

  private continuationHeader(): void {
    const w = this.width;
    this.drawLine(`${this.slip.number} (${this.L.continued})`, this.box.x0, this.y, w, { size: 9, bold: true, align: this.start });
    this.drawLine(this.slip.shopName, this.box.x0, this.y, w, { size: 9, align: this.end });
    this.y += 9 * LINE + 2;
    this.rule(0.6, 6);
  }
}

// ---------------------------------------------------------------------------
// Bidi text helpers shared with the parcel labels (delivery/labels): same fonts and run ordering as the slips.
// ---------------------------------------------------------------------------

export type BidiStyle = { size: number; bold?: boolean; align?: 'left' | 'right' | 'center' };

/** Registers the Arabic fonts on a document (call once per document). */
export function registerSlipFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont(PDF_FONT.ar, slipFontPath('regular'));
  doc.registerFont(PDF_FONT.arB, slipFontPath('bold'));
}

function bidiSegWidth(doc: PDFKit.PDFDocument, s: Seg, size: number): number {
  doc.font(PDF_FONT[s.font]).fontSize(size);
  return doc.widthOfString(s.text, isArabicFont(s.font) ? { features: [] } : {});
}

/** Width of a line of mixed Arabic / Latin text. */
export function measureBidi(doc: PDFKit.PDFDocument, text: string, size: number, bold = false): number {
  return visualSegments(clean(text), bold).reduce((w, s) => w + bidiSegWidth(doc, s, size), 0);
}

/** One line (no wrapping) inside [x, x + w]; `top` = top of the line box. */
export function drawBidiLine(doc: PDFKit.PDFDocument, text: string, x: number, top: number, w: number, style: BidiStyle): void {
  const segs = visualSegments(clean(text), !!style.bold);
  const widths = segs.map((s) => bidiSegWidth(doc, s, style.size));
  const total = widths.reduce((a, b) => a + b, 0);
  const align = style.align ?? 'left';
  let cx = align === 'right' ? x + w - total : align === 'center' ? x + (w - total) / 2 : x;
  const baseline = top + style.size * ASCENT;
  segs.forEach((s, i) => {
    doc
      .font(PDF_FONT[s.font])
      .fontSize(style.size)
      .text(s.text, cx, baseline, { lineBreak: false, baseline: 'alphabetic', ...(isArabicFont(s.font) ? { features: [] } : {}) });
    cx += widths[i] ?? 0;
  });
}

/** Greedy word wrap (logical order), at most `maxLines` lines (the last one is cut with "…"). */
export function wrapBidi(doc: PDFKit.PDFDocument, text: string, w: number, size: number, bold = false, maxLines = 99): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of clean(text).split(' ').filter(Boolean)) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (!cur || measureBidi(doc, candidate, size, bold) <= w) cur = candidate;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]} …`;
    return kept;
  }
  return lines.length ? lines : [''];
}

/** Line height used by the helpers above. */
export const BIDI_LINE = LINE;

/** One slip per order. A5 portrait per slip; `twoPerPage` = two A5 slips stacked on an A4 portrait page (cut line between). */
export async function renderOrderSlips(slips: OrderSlipData[], opts: OrderSlipOptions): Promise<Buffer> {
  return new Promise<Buffer>((resolvePdf, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      margin: 0,
      lang: opts.lang === 'ar' ? 'ar-DZ' : opts.lang === 'fr' ? 'fr-DZ' : 'en',
      info: {
        Title: slips.length === 1 && slips[0] ? slips[0].number : `${slips.length} slips`,
        Creator: 'Djaber',
        Producer: 'Djaber',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      doc.registerFont(PDF_FONT.ar, slipFontPath('regular'));
      doc.registerFont(PDF_FONT.arB, slipFontPath('bold'));
      const pager = new Pager(doc, opts.twoPerPage);
      if (slips.length === 0) pager.next();
      for (const slip of slips) new SlipWriter(doc, pager, slip, opts).render();
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
