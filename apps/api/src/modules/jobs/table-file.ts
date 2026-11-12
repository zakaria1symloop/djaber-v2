// Tabular files in and out: CSV / XLSX parser for imports, CSV / XLSX writer for exports (06 §7).
// Generic on purpose: products now, orders / clients / reports in later milestones.
import { isDateCell, readXlsx, writeXlsx, XLSX_MIME, type Cell } from './xlsx';

export type TableFormat = 'csv' | 'xlsx';
export type ParsedTable = { format: TableFormat; headers: string[]; rows: string[][] };
/** `kind` / `width` only matter for the PDF rendering (alignment, money formatting, relative column width). */
export type TableColumn<T> = { header: string; value: (row: T) => Cell; kind?: 'text' | 'money' | 'number'; width?: number };

export class TableFileError extends Error {
  constructor(public readonly reason: 'type' | 'unreadable') {
    super(`table file: ${reason}`);
  }
}

const CSV_MIMES = new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']);

/** Format from the file name first (browsers send unreliable mime types for CSV), then from the content. */
export const detectFormat = (fileName: string, mime: string, buf: Buffer): TableFormat | null => {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  const isZip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (ext === 'xlsx' || mime === XLSX_MIME) return isZip ? 'xlsx' : null;
  if (ext === 'csv' || (!ext && CSV_MIMES.has(mime))) return isZip ? null : 'csv';
  return null;
};

/** RFC 4180 CSV with `,` `;` or tab as separator (detected on the first line), quotes, CRLF, UTF-8 BOM. */
export const parseCsv = (text: string): string[][] => {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const sep = [';', '\t', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

/** First non-empty row = headers; empty rows are dropped; cells are trimmed. */
export const readTable = (buf: Buffer, fileName: string, mime: string): ParsedTable => {
  const format = detectFormat(fileName, mime, buf);
  if (!format) throw new TableFileError('type');
  let raw: string[][];
  try {
    raw = format === 'xlsx' ? readXlsx(buf) : parseCsv(buf.toString('utf8'));
  } catch {
    throw new TableFileError('unreadable');
  }
  const rows = raw.map((r) => r.map((c) => (c ?? '').trim())).filter((r) => r.some((c) => c !== ''));
  const headers = rows.shift() ?? [];
  return { format, headers, rows };
};

/** Spreadsheet formula injection guard: a text cell never starts a formula. */
const safe = (v: Cell): Cell => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const csvCell = (v: Cell) => {
  if (v === null || v === undefined) return '';
  // UX-058: a date is written as the Algiers wall-clock text (« 11/11/2026 15:38 »)
  const s = isDateCell(v) ? v.text : String(safe(v));
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const writeTable = <T>(format: TableFormat, sheetName: string, columns: TableColumn<T>[], rows: T[]): { body: Buffer; mime: string; ext: TableFormat } => {
  const matrix: Cell[][] = [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => c.value(r)))];
  if (format === 'xlsx') return { body: writeXlsx(sheetName, matrix.map((r) => r.map(safe))), mime: XLSX_MIME, ext: 'xlsx' };
  // BOM so that Excel opens the file as UTF-8 (Arabic product names)
  const text = '\ufeff' + matrix.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return { body: Buffer.from(text, 'utf8'), mime: 'text/csv; charset=utf-8', ext: 'csv' };
};
