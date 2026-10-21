// Import wizard logic (CAT-06, FL-12, AT-CAT-05 UI side): file checks, auto-mapping, required fields, phase, windowing, error CSV.
import { IMPORT_MAX_BYTES, type ImportPreviewRow } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import {
  autoMapping,
  buildErrorsCsv,
  checkImportFile,
  duplicateHeaders,
  fileExtension,
  formatFileSize,
  importableCount,
  importPhase,
  importTemplateCsv,
  mappingPayload,
  missingRequiredFields,
  newCategoryNames,
  stepOfPhase,
  windowRows,
} from './logic';

const row = (n: number, ok: boolean, values: ImportPreviewRow['values'] = {}, errors: ImportPreviewRow['errors'] = []): ImportPreviewRow => ({ row: n, ok, action: ok ? 'create' : 'skip', values, errors });

describe('checkImportFile', () => {
  it('accepts csv / xlsx / xls up to 5 MB', () => {
    expect(checkImportFile({ name: 'catalogue.CSV', size: 10 })).toBeNull();
    expect(checkImportFile({ name: 'catalogue-octobre.xlsx', size: IMPORT_MAX_BYTES })).toBeNull();
    expect(checkImportFile({ name: 'old.xls', size: 1 })).toBeNull();
  });
  it('refuses another type before the size', () => {
    expect(checkImportFile({ name: 'photo.png', size: 10 })).toBe('UPLOAD_TYPE_INVALID');
    expect(checkImportFile({ name: 'sans-extension', size: 10 })).toBe('UPLOAD_TYPE_INVALID');
    expect(checkImportFile({ name: 'big.pdf', size: IMPORT_MAX_BYTES + 1 })).toBe('UPLOAD_TYPE_INVALID');
  });
  it('refuses a file over 5 MB', () => {
    expect(checkImportFile({ name: 'big.csv', size: IMPORT_MAX_BYTES + 1 })).toBe('IMPORT_TOO_LARGE');
  });
  it('reads the extension and formats sizes', () => {
    expect(fileExtension('a.b.XLSX')).toBe('xlsx');
    expect(formatFileSize(1_258_291, 'fr')).toBe('1,2 Mo');
    expect(formatFileSize(1_258_291, 'en')).toBe('1.2 MB');
    expect(formatFileSize(2 * 1024 * 1024, 'fr')).toBe('2 Mo');
    expect(formatFileSize(340 * 1024, 'fr')).toBe('340 Ko');
    expect(formatFileSize(12, 'en')).toBe('1 KB');
  });
});

describe('autoMapping', () => {
  const headers = ['Désignation', 'Réf', 'Prix', "Prix d'achat", 'Qté', 'Famille', 'Unité', 'Ref interne'];
  it('detects FR aliases without accents, case or punctuation', () => {
    expect(autoMapping(headers)).toMatchObject({ name: 'Désignation', sku: 'Réf', price: 'Prix', costPrice: "Prix d'achat", stock: 'Qté', category: 'Famille', unit: 'Unité', description: null, keywords: null });
  });
  it('detects EN headers', () => {
    expect(autoMapping(['SKU', 'Name', 'Price', 'Stock', 'Category'])).toMatchObject({ sku: 'SKU', name: 'Name', price: 'Price', stock: 'Stock', category: 'Category' });
  });
  it('keeps the server detection and completes the rest', () => {
    const m = autoMapping(headers, { name: 'Ref interne', price: 'Colonne absente' });
    expect(m.name).toBe('Ref interne');
    expect(m.price).toBe('Prix'); // the detected header is not in the file: alias table
    expect(m.sku).toBe('Réf');
  });
  it('never uses a header twice', () => {
    const m = autoMapping(['Prix', 'Nom'], { oldPrice: 'Prix' });
    expect(m.oldPrice).toBe('Prix');
    expect(m.price).toBeNull();
    expect(duplicateHeaders(m)).toEqual([]);
  });
});

describe('required fields and payload', () => {
  it('name and price are required', () => {
    expect(missingRequiredFields({ name: 'Nom', price: 'Prix' })).toEqual([]);
    expect(missingRequiredFields({ name: 'Nom', price: null })).toEqual(['price']);
    expect(missingRequiredFields({})).toEqual(['name', 'price']);
  });
  it('reports a header chosen for two fields', () => {
    expect(duplicateHeaders({ name: 'A', description: 'A', price: 'B' })).toEqual(['A']);
  });
  it('sends only the mapped fields', () => {
    expect(mappingPayload({ name: 'Nom', price: 'Prix', stock: null, sku: undefined })).toEqual({ name: 'Nom', price: 'Prix' });
  });
});

describe('importPhase', () => {
  const result = (stage: 'mapping' | 'preview' | 'committed', missingColumns: string[] = []) => ({ stage, missingColumns }) as never;
  it('follows the analysis job', () => {
    expect(importPhase(null, null, false)).toBe('upload');
    expect(importPhase('j', undefined, false)).toBe('analysing');
    expect(importPhase('j', { status: 'running', result: null }, false)).toBe('analysing');
    expect(importPhase('j', { status: 'done', result: result('mapping') }, false)).toBe('mapping');
    expect(importPhase('j', { status: 'done', result: result('preview', ['price']) }, false)).toBe('mapping');
    expect(importPhase('j', { status: 'done', result: result('preview') }, false)).toBe('preview');
    expect(importPhase('j', { status: 'failed', result: null }, false)).toBe('analysisFailed');
    // IMPORT_COLUMNS_MISSING: the failed job keeps the headers so the mapping dialog can open
    expect(importPhase('j', { status: 'failed', result: result('mapping', ['price']) }, false)).toBe('mapping');
    expect(importPhase('j', { status: 'done', result: null }, false)).toBe('analysisFailed');
  });
  it('follows the commit job (`?step=import`)', () => {
    expect(importPhase('j', undefined, true)).toBe('importing');
    expect(importPhase('j', { status: 'queued', result: result('preview') }, true)).toBe('importing');
    expect(importPhase('j', { status: 'failed', result: result('preview') }, true)).toBe('importFailed');
    expect(importPhase('j', { status: 'done', result: result('committed') }, true)).toBe('done');
    expect(importPhase('j', { status: 'partial', result: result('committed') }, false)).toBe('done');
    // a refresh on an old link: the job is back on its preview
    expect(importPhase('j', { status: 'done', result: result('preview') }, true)).toBe('preview');
  });
  it('maps phases onto the three steps', () => {
    expect(['upload', 'analysing', 'analysisFailed', 'mapping'].map((p) => stepOfPhase(p as never))).toEqual([1, 1, 1, 1]);
    expect(stepOfPhase('preview')).toBe(2);
    expect(['importing', 'done', 'importFailed'].map((p) => stepOfPhase(p as never))).toEqual([3, 3, 3]);
  });
});

describe('rows', () => {
  it('windows 2 000 rows by pages of 50 and clamps the page', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => i + 1);
    expect(windowRows(rows, 1)).toMatchObject({ page: 1, pages: 40, total: 2000 });
    expect(windowRows(rows, 1).rows).toHaveLength(50);
    expect(windowRows(rows, 40).rows[49]).toBe(2000);
    expect(windowRows(rows, 99).page).toBe(40);
    expect(windowRows(rows, 0).page).toBe(1);
    expect(windowRows([], 3)).toEqual({ rows: [], page: 1, pages: 1, total: 0 });
    expect(windowRows(rows, 2, 25).rows[0]).toBe(26);
  });
  it('lists the categories to create from the valid rows only', () => {
    const rows = [row(2, true, { category: 'Vêtements' }), row(3, true, { category: 'vetements ' }), row(4, true, { category: 'Parfums' }), row(5, false, { category: 'Jouets' }), row(6, true, { category: null }), row(7, true, { category: 'Accessoires' })];
    expect(newCategoryNames(rows, ['parfums'])).toEqual([
      { name: 'Accessoires', rows: 1 },
      { name: 'Vêtements', rows: 2 },
    ]);
  });
  it('counts what will be written', () => {
    expect(importableCount({ valid: 118 })).toBe(118);
    expect(importableCount({ valid: 0 })).toBe(0);
  });
});

describe('buildErrorsCsv', () => {
  const rows = [
    row(13, true, { name: 'Robe', price: 4500 }),
    row(14, false, { name: 'RP-01', sku: 'RP-01', price: null }, [{ field: 'price', code: 'validation.price' }]),
    row(57, false, { name: 'Sac "cuir"; camel', sku: 'SC-CAM', price: 7200 }, [
      { field: 'sku', code: 'PRODUCT_SKU_ALREADY_EXISTS' },
      { field: 'sku', code: 'IMPORT_DUPLICATE_SKU_IN_FILE', params: { row: 41 } },
    ]),
    row(98, false, { name: '=SUM(A1)', sku: '-12', price: 1900 }, [{ field: null, code: 'X' }]),
  ];
  const csv = buildErrorsCsv(rows, {
    fields: ['name', 'sku', 'price'],
    headers: { row: 'Ligne', errors: 'Erreurs', field: (f) => f.toUpperCase() },
    describe: (e) => `${e.code}${e.params?.row ? `:${e.params.row}` : ''}`,
  });
  const lines = csv.slice(1).trimEnd().split('\r\n');
  it('starts with a BOM and a header line', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe('Ligne;NAME;SKU;PRICE;Erreurs');
  });
  it('keeps only the rows in error', () => {
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('14;RP-01;RP-01;;validation.price');
  });
  it('quotes separators and quotes, joins several errors', () => {
    expect(lines[2]).toBe('57;"Sac ""cuir""; camel";SC-CAM;7200;PRODUCT_SKU_ALREADY_EXISTS | IMPORT_DUPLICATE_SKU_IN_FILE:41');
  });
  it('neutralises formula cells', () => {
    expect(lines[3]).toBe("98;'=SUM(A1);'-12;1900;X");
  });
});

describe('example file (tester report 2026-10-20)', () => {
  it('one header per import field, two example rows, Excel-friendly', () => {
    const csv = importTemplateCsv('fr');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split(/\r\n/);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('SKU;Nom;Description;Catégorie;Unité;Prix;Ancien prix;Coût;Stock;Seuil;Poids;Mots-clés;Actif');
    expect(lines[1]).toContain(';robe, kabyle, fête;');
    expect(importTemplateCsv('en').split(/\r\n/)[0]).toContain('Name;Description');
    expect(importTemplateCsv('ar').split(/\r\n/)[0]).toContain('الاسم');
  });
});
