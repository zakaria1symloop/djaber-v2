// api-contract §3.5 — read models of a product (list row, variant, image) and the `Actions ⌄` descriptors.
import type { Prisma, ProductImage, ProductVariant } from '@djaber/db';
import type { ProductImageView, ProductListItemView, ProductModerationPill, VariantView } from '@djaber/shared';
import { action, marginPct, productStockState, stockStateOf } from './catalog.util';
import { isProcessed, thumbUrlOf } from './product-image.util';

export const LIST_INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  unit: { select: { id: true, abbreviation: true } },
  images: { where: { isPrimary: true }, take: 1, select: { url: true } },
  variants: { where: { deletedAt: null }, select: { name: true, price: true, stock: true, minStock: true, isActive: true }, orderBy: { createdAt: 'asc' } },
  currentModeration: { select: { status: true, decision: true, merchantMessage: true, slaDueAt: true } },
  _count: { select: { orderItems: true, saleItems: true } },
} satisfies Prisma.ProductInclude;
export type ProductListRow = Prisma.ProductGetPayload<{ include: typeof LIST_INCLUDE }>;

/** Customer-visible and proposed by the AI: active, live, and validated (04 §12 "Visibility while pending"). */
export const isProposed = (p: { isActive: boolean; deletedAt: Date | null; moderationStatus: string }) =>
  p.isActive && !p.deletedAt && (p.moderationStatus === 'approved' || p.moderationStatus === 'not_required');

export const moderationPill = (p: Pick<ProductListRow, 'moderationStatus' | 'currentModeration'>): ProductModerationPill => ({
  status: p.moderationStatus,
  ...(p.moderationStatus === 'pending' && p.currentModeration ? { etaLabel: p.currentModeration.slaDueAt.toISOString() } : {}),
  ...(p.moderationStatus === 'rejected' && p.currentModeration?.decision ? { reason: p.currentModeration.decision } : {}),
});

const variantSummary = (names: string[]) => (names.length ? names.slice(0, 3).join(' · ') + (names.length > 3 ? ` +${names.length - 3}` : '') : null);

export const productActions = (p: { trackStock: boolean; isActive: boolean; deletedAt: Date | null; _count: { orderItems: number; saleItems: number } }) => {
  const used = p._count.orderItems + p._count.saleItems > 0;
  const remove = action('delete', 'catalog.write', { reasonCode: used ? 'PRODUCT_HAS_ORDERS' : undefined });
  if (p.deletedAt) return [action('open', 'catalog.read', { primary: true }), action('restore', 'catalog.write'), remove];
  return [
    action('open', 'catalog.read', { primary: true }),
    action('edit', 'catalog.write'),
    action('duplicate', 'catalog.write'),
    action('adjust_stock', 'stock.adjust', { reasonCode: p.trackStock ? undefined : 'PRODUCT_NOT_STOCK_TRACKED' }),
    action(p.isActive ? 'deactivate' : 'activate', 'catalog.write'),
    action('archive', 'catalog.write'),
    remove,
  ];
};

/** Lowest / highest price of the active variants of a product with variants (tester report 2026-10-20: the base price was listed as if it were sold). */
export const priceRangeOf = (p: { hasVariants: boolean; variants: { price: number; isActive: boolean }[] }): { min: number; max: number } | null => {
  const prices = p.hasVariants ? p.variants.filter((v) => v.isActive).map((v) => v.price) : [];
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
};

export const toListItem = (p: ProductListRow): ProductListItemView => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  category: p.category,
  unit: p.unit,
  price: p.price,
  oldPrice: p.oldPrice,
  costPrice: p.costPrice,
  marginPct: marginPct(p.price, p.costPrice),
  trackStock: p.trackStock,
  stock: p.trackStock ? (p.stock ?? 0) : null,
  minStock: p.minStock,
  stockState: productStockState(p),
  hasVariants: p.hasVariants,
  variantSummary: p.hasVariants ? variantSummary(p.variants.map((v) => v.name)) : null,
  priceRange: priceRangeOf(p),
  isActive: p.isActive,
  archived: !!p.deletedAt,
  primaryImageUrl: p.images[0] ? thumbUrlOf(p.images[0].url) : null,
  aiState: isProposed(p) ? 'proposed' : 'excluded',
  moderation: moderationPill(p),
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  actions: productActions(p),
});

export const toVariantView = (v: ProductVariant): VariantView => ({
  id: v.id,
  name: v.name,
  sku: v.sku,
  attributes: (v.attributes ?? {}) as Record<string, string>,
  price: v.price,
  costPrice: v.costPrice,
  stock: v.stock,
  minStock: v.minStock,
  isActive: v.isActive,
  stockState: stockStateOf(v.stock, v.minStock),
});

export const toImageView = (i: ProductImage): ProductImageView => ({
  id: i.id,
  url: i.url,
  thumbUrl: thumbUrlOf(i.url),
  width: i.width,
  height: i.height,
  isPrimary: i.isPrimary,
  altText: i.altText,
  aiCaption: i.aiCaption,
  moderationFlag: i.moderationFlag,
  processed: isProcessed(i.storageKey),
});
