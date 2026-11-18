// LST-03 / D42 / D47 — saved views of the lists (03 §34, 04 §24, 05 §16, 06 §8.1, api-contract `SavedViewDto`).
// `filters` = the list's URL parameters (api-contract §1.6: same names as the API query, plus `q` and the page's status
// `tab` preset), stored as strings exactly as the URL carries them (lists comma-joined, flags `1` / `true`).
import { z } from 'zod';
import { ListDensityValues, SavedViewPageValues, type SavedViewPage } from '../enums';
import { DELIVERY_TABS } from './delivery';

export const SAVED_VIEW_NAME_MAX = 60;
/** Keys never stored in a view: paging, sorting (own column), the open sheet and the presentation params. */
export const SAVED_VIEW_RESERVED_KEYS = ['view', 'page', 'pageSize', 'cursor', 'limit', 'sort', 'sheet', 'density', 'hide', 'layout'] as const;

const filterKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, 'validation.invalid');
const filterValue = z.union([z.string().max(500, 'validation.length'), z.number().finite(), z.boolean(), z.array(z.string().max(100, 'validation.length')).max(100, 'validation.length')]);
export const SavedViewFiltersSchema = z.record(filterKey, filterValue).refine((o) => Object.keys(o).length <= 40, 'validation.length');

const name = z.string().trim().min(1, 'validation.required').max(SAVED_VIEW_NAME_MAX, 'validation.length');
const sort = z.string().regex(/^-?[a-zA-Z]{1,40}$/, 'validation.invalid');
const columnKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/, 'validation.invalid');

/** `POST /me/saved-views` (06 §8.1). */
export const CreateSavedViewSchema = z
  .object({
    page: z.enum(SavedViewPageValues),
    name,
    filters: SavedViewFiltersSchema.default({}),
    sort: sort.nullish(),
    columns: z.array(columnKey).max(40, 'validation.length').optional(),
    density: z.enum(ListDensityValues).nullish(),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type CreateSavedView = z.input<typeof CreateSavedViewSchema>;

/** `PATCH /me/saved-views/:id` — own views only (a shared view of another member ⇒ 403 SAVED_VIEW_SHARED_READONLY). */
export const UpdateSavedViewSchema = CreateSavedViewSchema.omit({ page: true }).partial().strict();
export type UpdateSavedView = z.input<typeof UpdateSavedViewSchema>;

/** `POST /me/saved-views/:id/share { isShared? }` (`views.share`, Admin+): `true` (default) shares, `false` stops sharing. */
export const ShareSavedViewSchema = z.object({ isShared: z.boolean().default(true) }).strict();

/** `GET /me/saved-views?page=` */
export const SavedViewsQuerySchema = z.object({ page: z.enum(SavedViewPageValues).optional() }).strict();

export type SavedViewDto = {
  id: string;
  page: SavedViewPage;
  name: string;
  filters: Record<string, string | number | boolean | string[]>;
  sort: string | null;
  columns: string[];
  density: 'compact' | 'comfortable' | null;
  isDefault: boolean;
  isShared: boolean;
  sharedBy: { id: string; name: string; avatarUrl: string | null } | null;
  /** true for a view shared by another member: apply or duplicate only (04 §24) */
  readOnly: boolean;
  /** members (other than the author) who see the shared view — the count of the delete confirmation (04 §24); 0 when not shared */
  sharedWith: number;
  createdAt: string;
  updatedAt: string;
};

/** Stored filters without the reserved keys (paging, sort, presentation). */
export const cleanSavedViewFilters = <T extends Record<string, unknown>>(filters: T): T => {
  const out = { ...filters };
  for (const k of SAVED_VIEW_RESERVED_KEYS) delete (out as Record<string, unknown>)[k];
  return out;
};

const PRODUCT_TAB_PRESETS: Record<string, Record<string, string>> = {
  active: { status: 'active' },
  hidden: { status: 'inactive' },
  pending: { moderationStatus: 'pending' },
  rejected: { moderationStatus: 'rejected,appealed' },
};
const ORDER_TABS = ['new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'returned'];

/**
 * The API query of a stored view (06 §1 « Saved views »: `?view=<id>` expands the stored filters): the web-only status
 * `tab` becomes the filter it stands for — same presets as the web lists (orders: the status; products: 12 §21 tabs;
 * delivery: `DELIVERY_TABS`); values are strings as in a URL. Explicit query params override them (the caller merges).
 */
export const savedViewApiQuery = (page: SavedViewPage, filters: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  const { tab, ...rest } = cleanSavedViewFilters(filters);
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '' || v === false) return;
    out[k] = Array.isArray(v) ? v.map(String).join(',') : String(v);
  };
  if (typeof tab === 'string') {
    if (page === 'orders' && ORDER_TABS.includes(tab)) put('status', tab);
    if (page === 'products') for (const [k, v] of Object.entries(PRODUCT_TAB_PRESETS[tab] ?? {})) put(k, v);
    if (page === 'delivery' && tab in DELIVERY_TABS) for (const [k, v] of Object.entries(DELIVERY_TABS[tab as keyof typeof DELIVERY_TABS])) put(k, v);
  }
  for (const [k, v] of Object.entries(rest)) put(k, v);
  return out;
};
