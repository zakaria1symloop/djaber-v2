// Helpers of the M7 suites (GDS operations): advanced-mode shop, suppliers / purchases / sales through the API with
// Idempotency-Key, cash and movement readers.
import { randomUUID } from 'node:crypto';
import { rawPrisma as db } from '@djaber/db';
import type { Actor } from './actors';
import { asOwner } from './actors';
import type { TestApp } from './app';
import { createProduct } from './m2';
import { seedFees } from './m5';

export const idem = () => ({ 'Idempotency-Key': randomUUID() });

/** An owner whose workspace is in advanced stock mode (set before the first request: the tenant context is cached). */
export const advancedShop = async (app: TestApp, o: { fees?: boolean } = {}) => {
  const owner = await asOwner(app);
  await db.workspace.update({ where: { id: owner.workspaceId }, data: { stockMode: 'advanced' } });
  if (o.fees) await seedFees(app, owner.workspaceId);
  return owner;
};

export const supplier = async (actor: Actor, over: Record<string, unknown> = {}) => {
  // one phone per supplier: the same phone twice in a workspace is SUPPLIER_ALREADY_EXISTS
  const r = await actor.post('/suppliers', { name: `Fournisseur ${randomUUID().slice(0, 4)}`, phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, ...over });
  if (r.status !== 201) throw new Error(`supplier: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data as Record<string, any>;
};

export const postPurchase = (actor: Actor, body: Record<string, unknown>) => actor.post('/purchases', body).set(idem());
export const purchase = async (actor: Actor, body: Record<string, unknown>) => {
  const r = await postPurchase(actor, body);
  if (r.status !== 201) throw new Error(`purchase: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data as Record<string, any>;
};
export const receive = (actor: Actor, id: string, body: Record<string, unknown>) => actor.post(`/purchases/${id}/receive`, body).set(idem());

export const postSale = (actor: Actor, body: Record<string, unknown>) => actor.post('/sales', body).set(idem());
export const sale = async (actor: Actor, body: Record<string, unknown>) => {
  const r = await postSale(actor, body);
  if (r.status !== 201) throw new Error(`sale: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data as Record<string, any>;
};

export const product = (actor: Actor, over: Record<string, unknown> = {}) => createProduct(actor, { name: `Produit ${randomUUID().slice(0, 4)}`, price: 2500, costPrice: 1000, stock: 10, ...over });

export const stockOf = async (productId: string, variantId?: string) =>
  variantId ? (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock : (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
export const costOf = async (productId: string, variantId?: string) =>
  variantId ? (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).costPrice : (await db.product.findUniqueOrThrow({ where: { id: productId } })).costPrice;
export const movementsOf = (refType: 'sale' | 'purchase' | 'inventory', refId: string) => db.stockMovement.findMany({ where: { refType, refId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
/** Automatic cash rows of a sale / purchase (through its payment entries, plus rows sourced on the document). */
export const cashOfDoc = async (sourceType: 'sale' | 'purchase', id: string) => {
  const entries = await db.paymentEntry.findMany({ where: { sourceType, sourceId: id } });
  const ids = entries.map((e) => e.cashTransactionId).filter((x): x is string => !!x);
  return db.cashTransaction.findMany({ where: { OR: [{ id: { in: ids } }, { sourceType, sourceId: id }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
};

export const DAY = 86_400_000;
export { db };
