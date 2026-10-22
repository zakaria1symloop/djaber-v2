// Pure logic of the page-analysis review (CHN-08, FL-15): view state, default selection, per-row validation
// (price > 0 and quantity > 0 on selected rows), duplicates, the import payload and its per-item outcome.
import type { AnalysisDto, AnalysisImportInput, AnalysisImportResult, AnalysisItem } from '@djaber/shared';

export const IMPORT_MAX_ITEMS = 100;
export const NAME_MAX = 255;

/* ---------- screen state ---------- */
export type AnalysisViewState = 'idle' | 'permission' | 'running' | 'empty' | 'done' | 'failed';
/** `errorCode` = code of a refused `GET` / `POST /channels/:id/analysis` (permission missing on the Meta token). */
export const analysisViewState = (dto: Pick<AnalysisDto, 'state' | 'items'> | null | undefined, errorCode?: string | null): AnalysisViewState => {
  if (errorCode === 'PAGE_ANALYSIS_PERMISSION_REQUIRED' || dto?.state === 'permission_required') return 'permission';
  if (!dto || dto.state === 'none') return 'idle';
  if (dto.state === 'running') return 'running';
  if (dto.state === 'failed') return 'failed';
  return dto.items.length ? 'done' : 'empty';
};
/** "terminé en 48 s" — null when a bound is missing. */
export const durationSeconds = (startedAt: string | null, finishedAt: string | null): number | null => {
  if (!startedAt || !finishedAt) return null;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
};
export const summaryCounts = (dto: Pick<AnalysisDto, 'items' | 'postsDone'>) => ({ posts: dto.postsDone, detected: dto.items.length, duplicates: dto.items.filter((i) => i.duplicateOf).length });

/* ---------- rows ---------- */
/** Editable copy of one detected product; `price` and `quantity` are the digits typed in the fields. */
export type RowEdit = { selected: boolean; name: string; price: string; quantity: string; category: string; isService?: boolean };
export type Edits = Record<string, RowEdit>;
export type RowStatus = 'new' | 'exists' | 'price_missing';

const digits = (n: number | null | undefined): string => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : '');
/**
 * Starting state of the grid: what the analysis proposed; selected = not a duplicate and a price was read on the post.
 * The stock is not written on a post: it starts at 1 and the merchant corrects it.
 */
export const initialEdits = (items: readonly AnalysisItem[]): Edits =>
  Object.fromEntries(items.map((i) => [i.key, { selected: !i.duplicateOf && (i.price ?? 0) > 0, name: i.name, price: digits(i.price), quantity: '1', category: i.category ?? '', ...(i.isService ? { isService: true } : {}) }]));

export const rowStatus = (item: Pick<AnalysisItem, 'duplicateOf'>, edit: Pick<RowEdit, 'price'> | undefined): RowStatus => (item.duplicateOf ? 'exists' : Number(edit?.price || 0) > 0 ? 'new' : 'price_missing');

export type RowIssues = { name?: string; price?: string; quantity?: string };
/** i18n keys of what blocks the import of a row. */
export const rowIssues = (e: RowEdit): RowIssues => {
  const out: RowIssues = {};
  const name = e.name.trim();
  if (!name) out.name = 'validation.required';
  else if (name.length > NAME_MAX) out.name = 'validation.length';
  if (!/^\d+$/.test(e.price) || Number(e.price) <= 0) out.price = 'validation.price';
  if (!e.isService && (!/^\d+$/.test(e.quantity) || Number(e.quantity) <= 0)) out.quantity = 'validation.quantity';
  return out;
};
export const hasIssues = (e: RowEdit): boolean => Object.keys(rowIssues(e)).length > 0;

/** Rows that can still be imported (already imported ones are locked). */
const open = (items: readonly AnalysisItem[], imported: ReadonlySet<string>) => items.filter((i) => !imported.has(i.key));
export const selectedKeys = (items: readonly AnalysisItem[], edits: Edits, imported: ReadonlySet<string> = new Set()): string[] =>
  open(items, imported)
    .filter((i) => edits[i.key]?.selected)
    .map((i) => i.key);
export const invalidSelected = (items: readonly AnalysisItem[], edits: Edits, imported: ReadonlySet<string> = new Set()): string[] => selectedKeys(items, edits, imported).filter((k) => hasIssues(edits[k]!));
export const allSelected = (items: readonly AnalysisItem[], edits: Edits, imported: ReadonlySet<string> = new Set()): boolean => {
  const rows = open(items, imported);
  return rows.length > 0 && rows.every((i) => edits[i.key]?.selected);
};

export const patchRow = (edits: Edits, key: string, patch: Partial<RowEdit>): Edits => (edits[key] ? { ...edits, [key]: { ...edits[key], ...patch } } : edits);
/** "Tout sélectionner" (or none when everything already is). */
export const selectAll = (items: readonly AnalysisItem[], edits: Edits, imported: ReadonlySet<string>, selected: boolean): Edits => {
  const next = { ...edits };
  for (const i of open(items, imported)) if (next[i.key]) next[i.key] = { ...next[i.key]!, selected };
  return next;
};
/** "Désélectionner les doublons": rows that look like an existing product. */
export const deselectDuplicates = (items: readonly AnalysisItem[], edits: Edits): Edits => {
  const next = { ...edits };
  for (const i of items) if (i.duplicateOf && next[i.key]?.selected) next[i.key] = { ...next[i.key]!, selected: false };
  return next;
};
export const selectedDuplicates = (items: readonly AnalysisItem[], edits: Edits): number => items.filter((i) => i.duplicateOf && edits[i.key]?.selected).length;

/* ---------- import ---------- */
/** Body of `POST /channels/:id/analysis/import` for the selected valid rows, with the keys in the order sent. */
export const buildImport = (items: readonly AnalysisItem[], edits: Edits, imported: ReadonlySet<string> = new Set()): { keys: string[]; body: AnalysisImportInput } => {
  const rows = open(items, imported)
    .filter((i) => edits[i.key]?.selected && !hasIssues(edits[i.key]!))
    .slice(0, IMPORT_MAX_ITEMS);
  return {
    keys: rows.map((i) => i.key),
    body: {
      items: rows.map((i) => {
        const e = edits[i.key]!;
        return { name: e.name.trim(), description: i.description ?? null, price: Number(e.price), quantity: e.isService ? 1 : Number(e.quantity), category: e.category.trim() || null, imageUrl: i.imageUrl ?? null, postId: i.postId, ...(e.isService ? { isService: true } : {}) };
      }),
    },
  };
};

export type ImportOutcome = { created: Record<string, { productId: string; sku: string }>; failed: Record<string, { code: string; message: string }> };
/**
 * Per-row outcome of an import: `failed[].index` points into the list that was sent; `created[]` is matched by key
 * when the server echoes one of ours, otherwise by position among the rows that did not fail.
 */
export const importOutcome = (keys: readonly string[], result: AnalysisImportResult): ImportOutcome => {
  const failed: ImportOutcome['failed'] = {};
  for (const f of result.failed ?? []) {
    const key = keys[f.index];
    if (key) failed[key] = { code: f.code, message: f.message };
  }
  const created: ImportOutcome['created'] = {};
  const rest = keys.filter((k) => !failed[k]);
  const known = new Set(keys);
  (result.created ?? []).forEach((c, i) => {
    const key = known.has(c.key) && !failed[c.key] ? c.key : rest[i];
    if (key && !created[key]) created[key] = { productId: c.productId, sku: c.sku };
  });
  return { created, failed };
};

/** "LIMITE DU PLAN : 128 + 7 ≤ 1 000 ✓" — null when the plan has no product limit. */
export const planRoom = (usage: number | null | undefined, limit: number | null | undefined, adding: number): { current: number; adding: number; limit: number; ok: boolean } | null => {
  if (typeof usage !== 'number' || typeof limit !== 'number' || limit < 0) return null;
  return { current: usage, adding, limit, ok: usage + adding <= limit };
};
