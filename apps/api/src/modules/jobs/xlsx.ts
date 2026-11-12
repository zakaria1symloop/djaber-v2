// Minimal XLSX (Office Open XML) reader / writer: one sheet, strings / numbers / booleans and date cells (UX-058).
// Enough for catalogue imports and list exports; shared by every export / import of later milestones.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * UX-058 (12/11): a date cell. `date` = Excel serial number of the wall-clock time (days since 1899-12-30, already in
 * Africa/Algiers — Excel has no time zones), `format` picks the number format (`dd/mm/yyyy hh:mm` or `dd/mm/yyyy`),
 * `text` = the same value written out for CSV / PDF. Built by `exportDateTime` / `exportDate` (export-cells.ts).
 */
export type DateCell = { date: number; format: 'datetime' | 'date'; text: string };
export type Cell = string | number | boolean | null | undefined | DateCell;
export const isDateCell = (v: unknown): v is DateCell => typeof v === 'object' && v !== null && typeof (v as DateCell).date === 'number' && typeof (v as DateCell).text === 'string';

/** Style index in `xl/styles.xml` per date format (0 = the default style). */
const DATE_STYLE = { datetime: 1, date: 2 } as const;
/** Width (characters) of a column holding dates, so that Excel does not show « ##### ». */
const DATE_WIDTH = { datetime: 17, date: 11 } as const;
const STYLES =
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export { XLSX_MIME };

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // control characters are not valid in XML 1.0
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const unesc = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

/** One-sheet workbook. The first row is usually the header row. */
export const writeXlsx = (sheetName: string, rows: Cell[][]): Buffer => {
  const widths = new Map<number, number>();
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (v === null || v === undefined || v === '') return '';
          if (isDateCell(v)) {
            if (!Number.isFinite(v.date)) return '';
            widths.set(c, Math.max(widths.get(c) ?? 0, DATE_WIDTH[v.format]));
            return `<c r="${ref}" s="${DATE_STYLE[v.format]}"><v>${v.date}</v></c>`;
          }
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const cols = widths.size
    ? `<cols>${[...widths.entries()]
        .sort(([a], [b]) => a - b)
        .map(([c, w]) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';
  const name = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `${head}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`,
    ),
    'xl/styles.xml': strToU8(`${head}${STYLES}`),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
};

/** Uncompressed size accepted per archive entry (zip-bomb guard). */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

const textOf = (xml: string) => {
  // rich text: concatenate every <t> run, skipping phonetic runs
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += unesc(m[1] ?? '');
  return out;
};

/** Rows of the first sheet, every cell as a string ('' when empty). Throws when the file is not a workbook. */
export const readXlsx = (buf: Buffer): string[][] => {
  const wanted = (name: string) => name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels' || name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(name);
  const zip = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      if (!wanted(f.name)) return false;
      if (f.originalSize > MAX_ENTRY_BYTES) throw new Error('xlsx: entry too large');
      return true;
    },
  });
  const file = (name: string) => (zip[name] ? strFromU8(zip[name]!) : undefined);
  const workbook = file('xl/workbook.xml');
  if (!workbook) throw new Error('xlsx: workbook missing');

  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rid = /<sheet\b[^>]*?r:id="([^"]+)"/.exec(workbook)?.[1];
  const rels = file('xl/_rels/workbook.xml.rels');
  if (rid && rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (new RegExp(`Id="${rid}"`).test(m[0])) {
        const target = /Target="([^"]+)"/.exec(m[0])?.[1];
        if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      }
    }
  }
  const sheet = file(sheetPath) ?? Object.keys(zip).filter((k) => k.startsWith('xl/worksheets/')).map((k) => strFromU8(zip[k]!))[0];
  if (!sheet) throw new Error('xlsx: sheet missing');

  const shared: string[] = [];
  const sst = file('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(textOf(m[1] ?? ''));

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? '';
      const inner = cm[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(inner);
      else if (type === 'b') value = v === '1' ? 'true' : 'false';
      else if (v !== undefined) value = unesc(v);
      while (row.length < col) row.push('');
      row[col] = value;
    }
    rows.push(row);
  }
  return rows;
};
