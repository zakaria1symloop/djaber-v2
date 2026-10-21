// Pure helpers of the import wizard (CAT-06, FL-12): file checks, header auto-mapping, required fields, the wizard
// phase derived from the job, row windowing and the client-side error report.
import { IMPORT_FIELDS, IMPORT_MAX_BYTES, IMPORT_REQUIRED_FIELDS, type ImportField, type ImportPreviewResult, type ImportPreviewRow } from '@djaber/shared';

export const IMPORT_EXTENSIONS = ['csv', 'xlsx', 'xls'] as const;
export const IMPORT_ACCEPT = '.csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const IMPORT_PAGE_SIZE = 50;

export const fileExtension = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name.trim())?.[1] ?? '').toLowerCase();

/** Client-side refusal before any upload: wrong type → `UPLOAD_TYPE_INVALID`, over 5 MB → `IMPORT_TOO_LARGE`. */
export function checkImportFile(file: { name: string; size: number }): 'UPLOAD_TYPE_INVALID' | 'IMPORT_TOO_LARGE' | null {
  if (!(IMPORT_EXTENSIONS as readonly string[]).includes(fileExtension(file.name))) return 'UPLOAD_TYPE_INVALID';
  if (file.size > IMPORT_MAX_BYTES) return 'IMPORT_TOO_LARGE';
  return null;
}

/** `1,2 Mo` / `340 Ko` (fr, ar) · `1.2 MB` / `340 KB` (en). */
export function formatFileSize(bytes: number, locale: string): string {
  const en = locale === 'en';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ${en ? 'KB' : 'Ko'}`;
  const mb = (Math.round((bytes / (1024 * 1024)) * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return `${en ? mb : mb.replace('.', ',')} ${en ? 'MB' : 'Mo'}`;
}

/* ---------- column mapping ---------- */
export type ImportMapping = Partial<Record<ImportField, string | null>>;

/** Header aliases (FR / EN, as V1), compared without accents, case, spaces and punctuation. */
const ALIASES: Record<ImportField, readonly string[]> = {
  sku: ['sku', 'ref', 'reference', 'code', 'codeproduit', 'refproduit', 'productcode'],
  name: ['name', 'nom', 'designation', 'produit', 'product', 'nomproduit', 'productname', 'titre', 'title', 'libelle'],
  description: ['description', 'desc', 'details'],
  category: ['category', 'categorie', 'famille', 'rayon'],
  unit: ['unit', 'unite'],
  price: ['price', 'prix', 'prixdevente', 'prixvente', 'pv', 'sellingprice', 'saleprice', 'tarif'],
  oldPrice: ['oldprice', 'ancienprix', 'prixbarre', 'compareatprice'],
  costPrice: ['costprice', 'cost', 'cout', 'prixdachat', 'prixachat', 'pa', 'purchaseprice'],
  stock: ['stock', 'qte', 'quantite', 'quantity', 'qty', 'enstock'],
  minStock: ['minstock', 'stockmin', 'stockminimum', 'seuil', 'seuilalerte', 'alerte', 'threshold'],
  weightGrams: ['weightgrams', 'weight', 'poids', 'poidsg', 'poidsgrammes'],
  keywords: ['keywords', 'motscles', 'tags', 'etiquettes'],
  isActive: ['isactive', 'active', 'actif', 'visible', 'statut', 'status'],
};

export const normalizeHeader = (h: string): string =>
  h
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Mapping shown in the dialog: the server detection first (when its header still exists in the file), then the alias
 * table for the fields it left empty. A header is used once; the first field of `IMPORT_FIELDS` wins.
 */
export function autoMapping(headers: readonly string[], detected: ImportMapping = {}): Record<ImportField, string | null> {
  const out = {} as Record<ImportField, string | null>;
  const used = new Set<string>();
  for (const f of IMPORT_FIELDS) {
    const h = detected[f];
    out[f] = h && headers.includes(h) && !used.has(h) ? h : null;
    if (out[f]) used.add(out[f]!);
  }
  for (const f of IMPORT_FIELDS) {
    if (out[f]) continue;
    const hit = headers.find((h) => !used.has(h) && ALIASES[f].includes(normalizeHeader(h)));
    if (hit) {
      out[f] = hit;
      used.add(hit);
    }
  }
  return out;
}

/** Required target fields (`name`, `price`) without a column. */
export const missingRequiredFields = (mapping: ImportMapping): ImportField[] => IMPORT_REQUIRED_FIELDS.filter((f) => !mapping[f]);

/** Headers chosen for more than one field (the dialog refuses them). */
export function duplicateHeaders(mapping: ImportMapping): string[] {
  const seen = new Map<string, number>();
  for (const f of IMPORT_FIELDS) {
    const h = mapping[f];
    if (h) seen.set(h, (seen.get(h) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([h]) => h);
}

/** Body of `POST /products/import/mapping`: only the fields that have a column. */
export const mappingPayload = (mapping: ImportMapping): Partial<Record<ImportField, string>> =>
  Object.fromEntries(IMPORT_FIELDS.filter((f) => !!mapping[f]).map((f) => [f, mapping[f] as string])) as Partial<Record<ImportField, string>>;

/* ---------- wizard phase ---------- */
export type ImportPhase = 'upload' | 'analysing' | 'analysisFailed' | 'mapping' | 'preview' | 'importing' | 'done' | 'importFailed';
type JobLike = { status: string; result: Pick<ImportPreviewResult, 'stage' | 'missingColumns'> | null } | null | undefined;

/**
 * Where the wizard stands for a job. `committing` = the commit was requested for this job (`?step=import` in the URL):
 * the same job kind serves the analysis and the import, so the URL tells them apart after a refresh.
 */
export function importPhase(jobId: string | null, job: JobLike, committing: boolean): ImportPhase {
  if (!jobId) return 'upload';
  if (!job) return committing ? 'importing' : 'analysing';
  const running = job.status === 'queued' || job.status === 'running';
  const failed = job.status === 'failed' || job.status === 'cancelled';
  if (job.result?.stage === 'committed' && !running && !failed) return 'done';
  if (committing) return failed ? 'importFailed' : running ? 'importing' : job.result?.stage === 'preview' ? 'preview' : 'done';
  if (running) return 'analysing';
  // required columns not found: the job fails with IMPORT_COLUMNS_MISSING but keeps the headers for the mapping dialog
  if (failed && job.result?.stage === 'mapping') return 'mapping';
  if (failed || !job.result) return 'analysisFailed';
  if (job.result.stage === 'committed') return 'done';
  if (job.result.stage === 'mapping' || (job.result.missingColumns?.length ?? 0) > 0) return 'mapping';
  return 'preview';
}

export const stepOfPhase = (p: ImportPhase): 1 | 2 | 3 => (p === 'preview' ? 2 : p === 'importing' || p === 'done' || p === 'importFailed' ? 3 : 1);

/* ---------- preview rows ---------- */
export const IMPORT_TABS = ['errors', 'all', 'categories'] as const;
export type ImportTab = (typeof IMPORT_TABS)[number];

export const invalidRows = (rows: readonly ImportPreviewRow[]): ImportPreviewRow[] => rows.filter((r) => !r.ok);

/** One page of rows: the table never renders more than `size` rows (a file may hold 2 000). */
export function windowRows<T>(rows: readonly T[], page: number, size = IMPORT_PAGE_SIZE): { rows: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, total: rows.length };
}

/** Category names of the valid rows that are not in the catalogue yet (case and accents ignored), with their row count. */
export function newCategoryNames(rows: readonly ImportPreviewRow[], existing: readonly string[]): { name: string; rows: number }[] {
  const known = new Set(existing.map(normalizeHeader));
  const found = new Map<string, { name: string; rows: number }>();
  for (const r of rows) {
    const raw = r.values.category;
    if (!r.ok || typeof raw !== 'string' || !raw.trim()) continue;
    const key = normalizeHeader(raw);
    if (!key || known.has(key)) continue;
    const hit = found.get(key);
    if (hit) hit.rows++;
    else found.set(key, { name: raw.trim(), rows: 1 });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Rows that will be written. Rows over the plan limit are already reported as errors (`PLAN_LIMIT`), so not in `valid`. */
export const importableCount = (totals: Pick<ImportPreviewResult['totals'], 'valid'>): number => Math.max(0, totals.valid ?? 0);

/* ---------- error report (client side) ---------- */
const BOM = String.fromCharCode(0xfeff);
const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? '' : String(v);
  // a cell starting with = + - @ would be run as a formula by spreadsheet software
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV of the rows in error (`;` separator, CRLF, BOM: opens directly in Excel FR): line number, the imported values,
 * then one "CODE — text" per error.
 */
export function buildErrorsCsv(
  rows: readonly ImportPreviewRow[],
  o: { fields: readonly ImportField[]; headers: { row: string; errors: string; field: (f: ImportField) => string }; describe: (e: ImportPreviewRow['errors'][number]) => string },
): string {
  const lines = [[o.headers.row, ...o.fields.map(o.headers.field), o.headers.errors].map(csvCell).join(';')];
  for (const r of invalidRows(rows)) {
    lines.push([r.row, ...o.fields.map((f) => r.values[f] ?? ''), r.errors.map(o.describe).join(' | ')].map(csvCell).join(';'));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/* ---------- example file (tester report 2026-10-20: "a CSV example so the client knows the columns") ---------- */
/** Column headers of the example file, in the interface language — each one is a header alias the import recognises. */
const TEMPLATE_HEADERS: Record<'fr' | 'ar' | 'en', Record<ImportField, string>> = {
  fr: { sku: 'SKU', name: 'Nom', description: 'Description', category: 'Catégorie', unit: 'Unité', price: 'Prix', oldPrice: 'Ancien prix', costPrice: 'Coût', stock: 'Stock', minStock: 'Seuil', weightGrams: 'Poids', keywords: 'Mots-clés', isActive: 'Actif' },
  en: { sku: 'SKU', name: 'Name', description: 'Description', category: 'Category', unit: 'Unit', price: 'Price', oldPrice: 'Old price', costPrice: 'Cost price', stock: 'Stock', minStock: 'Min stock', weightGrams: 'Weight', keywords: 'Keywords', isActive: 'Active' },
  ar: { sku: 'الرمز', name: 'الاسم', description: 'الوصف', category: 'الفئة', unit: 'الوحدة', price: 'السعر', oldPrice: 'السعر القديم', costPrice: 'التكلفة', stock: 'المخزون', minStock: 'الحد الادنى', weightGrams: 'الوزن', keywords: 'الكلمات المفتاحية', isActive: 'نشط' },
};
const TEMPLATE_ROWS: Record<'fr' | 'ar' | 'en', Partial<Record<ImportField, string>>[]> = {
  fr: [
    { sku: 'ROBE-001', name: 'Robe kabyle brodée', description: 'Robe traditionnelle brodée main, tailles S à XL', category: 'Robes', unit: 'pc', price: '6500', oldPrice: '7500', costPrice: '3500', stock: '12', minStock: '3', weightGrams: '800', keywords: 'robe, kabyle, fête', isActive: 'oui' },
    { sku: 'ARGAN-100', name: "Huile d'argan 100 ml", description: 'Huile pure pressée à froid', category: 'Cosmétiques', unit: 'pc', price: '1800', costPrice: '900', stock: '40', minStock: '10', weightGrams: '150', keywords: 'argan, soin', isActive: 'oui' },
  ],
  en: [
    { sku: 'DRESS-001', name: 'Embroidered Kabyle dress', description: 'Hand-embroidered traditional dress, sizes S to XL', category: 'Dresses', unit: 'pc', price: '6500', oldPrice: '7500', costPrice: '3500', stock: '12', minStock: '3', weightGrams: '800', keywords: 'dress, kabyle, party', isActive: 'yes' },
    { sku: 'ARGAN-100', name: 'Argan oil 100 ml', description: 'Pure cold-pressed oil', category: 'Cosmetics', unit: 'pc', price: '1800', costPrice: '900', stock: '40', minStock: '10', weightGrams: '150', keywords: 'argan, care', isActive: 'yes' },
  ],
  ar: [
    { sku: 'ROBE-001', name: 'فستان قبائلي مطرز', description: 'فستان تقليدي مطرز يدويًا، المقاسات من S إلى XL', category: 'فساتين', unit: 'pc', price: '6500', oldPrice: '7500', costPrice: '3500', stock: '12', minStock: '3', weightGrams: '800', keywords: 'فستان, قبائلي, حفلة', isActive: 'نعم' },
    { sku: 'ARGAN-100', name: 'زيت الأرغان 100 مل', description: 'زيت نقي معصور على البارد', category: 'مستحضرات التجميل', unit: 'pc', price: '1800', costPrice: '900', stock: '40', minStock: '10', weightGrams: '150', keywords: 'أرغان, عناية', isActive: 'نعم' },
  ],
};

/**
 * Example CSV of the import (every column, two filled rows), `;`-separated with a UTF-8 BOM so Excel opens it with its
 * accents and Arabic intact. Prices in whole dinars, weight in grams, unit = an abbreviation of the shop's units.
 */
export function importTemplateCsv(locale: string): string {
  const l = locale === 'ar' || locale === 'en' ? locale : 'fr';
  const lines = [IMPORT_FIELDS.map((f) => csvCell(TEMPLATE_HEADERS[l][f])).join(';'), ...TEMPLATE_ROWS[l].map((r) => IMPORT_FIELDS.map((f) => csvCell(r[f] ?? '')).join(';'))];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
