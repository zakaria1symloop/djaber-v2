import type { StockPurchasingView } from '@djaber/shared';
// Wire types of the M2 endpoints (api-contract §3.5, 06 §2 "Catalogue", §8.2, §8.6). The read models written by the
// API live in `@djaber/shared` (schemas/catalog.ts) and are re-exported here under the names the screens use.
// Shapes the contract leaves open are listed in docs/implementation/assumptions-log.md (M2 web rows).
import type {
  CategoryView,
  ImportPreviewResult,
  ImportPreviewRow,
  ModerationDetailView,
  ProductImageView,
  ProductListItemView,
  ProductModerationPill,
  ProductView,
  StockMovementView,
  StockState,
  UnitView,
  VariantView,
} from '@djaber/shared';

export type ProductListItem = ProductListItemView;
export type Product = ProductView;
export type Variant = VariantView;
export type ProductImage = ProductImageView;
export type Category = CategoryView;
export type Unit = UnitView;
export type StockMovement = StockMovementView;
export type ModerationDetail = ModerationDetailView;
export type { ImportPreviewResult, ImportPreviewRow, ProductModerationPill, StockState };

export type MovementType = StockMovement['type'];
export const MOVEMENT_TYPES: readonly MovementType[] = ['in', 'out', 'adjustment_in', 'adjustment_out', 'inventory', 'return'];
/** `MovementReason` (prisma-schema.prisma), values verbatim. */
export const MOVEMENT_REASONS = [
  'order_delivered',
  'order_created',
  'order_cancelled',
  'order_returned',
  'sale',
  'sale_cancelled',
  'purchase',
  'purchase_cancelled',
  'breakage',
  'loss',
  'initial',
  'inventory',
  'correction',
  'archive',
  'import',
  'other',
  'restock',
] as const;
export const MOVEMENT_REF_TYPES = ['order', 'sale', 'purchase', 'inventory', 'import', 'manual', 'variant'] as const;
export const MODERATION_STATUSES = ['not_required', 'pending', 'approved', 'rejected', 'appealed'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

/** `GET /moderation/summary` (06 §8.2) — banner "38 produits en attente". */
export type ModerationSummary = { pending: number; rejected: number; appealed: number; /** active products the AI may offer (J02-8) */ sellable?: number; trustLevel: 'new' | 'standard' | 'trusted' | 'watch' };

/** `GET /stock/overview` (GDS-01). `valueAtCost` / `potentialMargin` are null in simple mode (no cost price). */
export type StockOverview = {
  mode: 'simple' | 'advanced';
  totalProducts: number;
  activeProducts: number;
  trackedProducts: number;
  services: number;
  /** products with at least one line at or under its threshold, not fully out */
  lowStockCount: number;
  /** products whose every line is at 0 */
  outOfStockCount: number;
  totalItems: number;
  valueAtCost: number | null;
  /** units in stock without a cost price, left out of `valueAtCost` (J11-3); null in simple mode */
  unknownCostUnits?: number | null;
  valueAtRetail: number;
  /** retail − cost of the lines with a known cost price */
  potentialMargin: number | null;
  recentMovements: StockMovement[];
  /** M7: "ACHATS & FOURNISSEURS" block — advanced mode + `gds.read`, else null (shared `StockPurchasingView`) */
  purchasing?: StockPurchasingView | null;
};

/** `GET /products/low-stock` — one row per product or variant at or under its threshold, worst first. */
export type LowStockItem = {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  sku: string | null;
  stock: number;
  minStock: number;
  state: 'ok' | 'low' | 'out';
  primaryImageUrl: string | null;
};

/** `GET /products/:id/relations` (06 §8.6) — counts + last rows for the quick-edit sheet and the product page. */
export type ProductRelations = {
  orders: { count: number; last: { id: string; number: string; status: string; orderedAt: string; quantity: number; total: number; variantName: string | null }[] };
  movements: { count: number; last: StockMovement[] };
  agents: { count: number; last: { id: string; name: string; status: string }[] };
  recommendations: { count: number; last: { id: string; type: string; isActive: boolean; recommended: { id: string; name: string } | null }[] };
};

/** `GET /products/:id/moderation` (06 §8.2). */
export type ProductModeration = {
  status: ModerationStatus;
  contentVersion: number;
  item: { id: string; aiFlags: unknown; decision: string | null; merchantMessage: string | null; rejectedFields: string[]; decidedAt: string | null } | null;
  history: { at: string; status: string; actor: 'system' | 'moderator' | 'merchant'; note: string | null }[];
  appeal?: { status: 'available' | 'used' | 'expired'; deadlineAt: string | null; decision: string | null } | null;
};

/** `GET /products/:id/card-preview` — the Messenger card as the customer sees it. */
export type CardPreview = {
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  price: number;
  oldPrice: number | null;
  variants: string[];
  buttons: { type: string; title: string; payload?: string; disabled?: boolean }[];
  /** false while the product is inactive, pending or rejected: the card is not sent to customers */
  visibleToCustomers: boolean;
};

/** `GET /stock/snapshot?date` row (06 §8.6). */
export type SnapshotRow = { productId: string; variantId?: string | null; name: string; sku: string | null; quantityAtDate: number; costPriceAtDate: number | null; valueAtDate: number | null };

/** `POST /products/ai-fill` (06 §8.6): suggestions only; the form fills empty fields, never the price (AT-CAT-10). */
export type AiFillResult = {
  /** null = the field already had a value (sent in the request) or nothing was recognised */
  name: string | null;
  description: string | null;
  categoryId: string | null;
  unitId: string | null;
  attributes: Record<string, string[] | string> | null;
  /** names of the fields the server proposes to fill */
  filled: ('name' | 'description' | 'categoryId' | 'unitId')[];
};
export type AiFillCurrent = { name?: string; description?: string; categoryId?: string | null; unitId?: string | null };

/** Bulk endpoints (api-contract §1.4). */
export type BulkItemResult = { id: string; ok: boolean; error?: { code: string; message: string; params?: Record<string, string | number> }; data?: unknown };
export type BulkResponse = { results: BulkItemResult[]; ok: number; failed: number; warnings: { code: string; params?: Record<string, unknown> }[] };


/** A product "state" for the pills and the tabs of the list (06-i18n §4): archived › hidden (inactive) › active. */
export const productState = (p: Pick<ProductListItem, 'archived' | 'isActive'>): 'archived' | 'hidden' | 'active' => (p.archived ? 'archived' : p.isActive ? 'active' : 'hidden');

/** Category tree flattened for selects: children are prefixed with their parent ("Parfums › Parfums femme"). */
export const flattenCategories = (tree: readonly Category[]): { id: string; label: string; depth: 0 | 1; category: Category }[] =>
  tree.flatMap((c) => [{ id: c.id, label: c.name, depth: 0 as const, category: c }, ...(c.children ?? []).map((k) => ({ id: k.id, label: `${c.name} › ${k.name}`, depth: 1 as const, category: k }))]);
