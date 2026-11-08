// 03 §37 ORD "Import orders" (D69) — pure part of the order import: column auto-mapping and per-row validation against
// the catalogue / geography loaded by the service. Columns `clientName, phone, wilaya, commune?, address, items
// ("SKU×qty;SKU×qty"), note?`. Each error = an error-catalogue code + the field.
// PV 08/11 (« l'importation de commandes à partir d'un fichier plateforme conforme déclenche une erreur »): a file
// exported by Djaber itself (Commandes › Exporter, standard or ZR Express layout, in French or Arabic) is read back: its
// articles name the products (« Robe · S × 2 × 4500 », « Robe S x2, Sac x1 »), its wilayas may be in Arabic, its
// columns are « Tel 1 », « Produit »…
import { fullName, isPhoneDz, normalizePhoneDz, ORDER_IMPORT_FIELDS, ORDER_IMPORT_REQUIRED_FIELDS, type OrderImportField, type OrderImportPreviewRow, type OrderImportRowError } from '@djaber/shared';
import { fold, WILAYA_ALIASES } from '../ai/tools/wilaya-aliases';

export type OrderImportMapping = Partial<Record<OrderImportField, string>>;
const ALIASES: Record<OrderImportField, string[]> = {
  clientName: ['clientname', 'client', 'nom', 'name', 'nom client', 'nom complet', 'nom et prenom', 'nom prenom', 'destinataire', 'customer', 'customer name', 'full name', 'الاسم', 'الزبون', 'العميل', 'الاسم الكامل'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'numero', 'tel 1', 'tel1', 'telephone 1', 'phone 1', 'mobile 1', 'numero de telephone', 'الهاتف', 'رقم الهاتف'],
  wilaya: ['wilaya', 'willaya', 'code wilaya', 'wilaya code', 'state', 'الولاية'],
  commune: ['commune', 'city', 'ville', 'البلدية'],
  address: ['address', 'adresse', 'العنوان'],
  items: ['items', 'articles', 'article', 'produits', 'produit', 'products', 'product', 'designation', 'sku', 'المنتجات', 'المنتج'],
  note: ['note', 'notes', 'remarque', 'remarques', 'observation', 'comment', 'commentaire', 'ملاحظة', 'ملاحظات'],
};

/** A header as compared with the aliases: the Djaber export adds a hint (« Articles (nom × qté × prix) », « Adresse / point relais »). */
// cut before `fold` (it turns the brackets and the slash into spaces); the aliases go through `fold` too — the Arabic
// ones lost their article « ال » there and never matched
const headerKey = (h: string) => fold(h.replace(/\(.*?\)/g, ' ').split(/\s+\/\s+/)[0]!.replace(/[_-]+/g, ' '));
const FOLDED = Object.fromEntries(Object.entries(ALIASES).map(([f, list]) => [f, new Set(list.map(headerKey))])) as Record<OrderImportField, Set<string>>;

export const autoMapOrders = (headers: string[]): OrderImportMapping => {
  const m: OrderImportMapping = {};
  const used = new Set<string>();
  for (const f of ORDER_IMPORT_FIELDS) {
    const h = headers.find((x) => !used.has(x) && FOLDED[f].has(headerKey(x)));
    if (h) {
      m[f] = h;
      used.add(h);
    }
  }
  return m;
};
export const missingOrderColumns = (m: OrderImportMapping) => ORDER_IMPORT_REQUIRED_FIELDS.filter((f) => !m[f]);

/**
 * "SKU×2;SKU2×1" (also `x`, `*` before the quantity; `;`, `|`, a line break or ", " between lines; a bare SKU = 1). The
 * Djaber export writes « name · variant × quantity × unit price »: the second number is the price, dropped (the
 * catalogue price applies). `sku` is the reference as written — a SKU or a product name, resolved by `lookupItem`.
 */
export const parseItems = (raw: string): { sku: string; quantity: number; raw: string }[] | null => {
  const parts = raw
    .split(/[;|\n]+|,\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const out: { sku: string; quantity: number; raw: string }[] = [];
  for (const p of parts) {
    const m = /^(.+?)\s*(?:[×xX*]\s*(\d+))?(?:\s*[×xX*]\s*\d+(?:[.,]\d+)?)?$/.exec(p);
    if (!m) return null;
    const quantity = m[2] ? Number(m[2]) : 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) return null;
    out.push({ sku: m[1]!.trim(), quantity, raw: p });
  }
  return out;
};

/** Product / variant names compared without accents, case, or the punctuation between a name and its variant. */
export const itemKey = (s: string) => fold(s).replace(/[·()\-–_/]+/g, ' ').replace(/\s+/g, ' ').trim();
/** An article reference: the line as written (a SKU such as « BOX12 »), then its SKU part, then a product / variant name. */
export const lookupItem = (cat: ImportCatalog, it: { sku: string; raw: string }): { hit: ImportItem | undefined; quantity: number | null } => {
  const by = (s: string) => cat.skus.get(s) ?? cat.skus.get(s.toUpperCase()) ?? cat.names.get(itemKey(s));
  const whole = by(it.raw);
  return whole ? { hit: whole, quantity: 1 } : { hit: by(it.sku), quantity: null };
};

export type ImportItem = { productId: string; variantId: string | null; name: string; hasVariants: boolean; trackStock: boolean; available: number | null; price: number };
export type ImportCatalog = {
  /** SKU → product (no variant) or variant of a product */
  skus: Map<string, ImportItem>;
  /** `itemKey` of « product » and « product variant » → the same entries (a variant without its own SKU is found by name) */
  names: Map<string, ImportItem>;
  wilayas: Map<number, { id: number; nameFr: string; nameAr?: string; served: boolean; homePrice: number }>;
  communes: Map<number, Map<string, number>>;
  existingPhones: Set<string>;
};

export const resolveWilaya = (raw: string, wilayas: ImportCatalog['wilayas']): number | null => {
  const t = raw.trim();
  const n = /^\d{1,2}$/.test(t) ? Number(t) : /^(\d{1,2})\s*[-–.]/.exec(t) ? Number(/^(\d{1,2})/.exec(t)![1]) : null;
  if (n && wilayas.has(n)) return n;
  const f = fold(t.replace(/^\d{1,2}\s*[-–.]\s*/, ''));
  if (WILAYA_ALIASES[f]) return WILAYA_ALIASES[f]!;
  for (const w of wilayas.values()) if (fold(w.nameFr) === f || (w.nameAr && fold(w.nameAr) === f)) return w.id;
  return null;
};

/** One row of the file → values + errors. Stock is checked per row against the stock left by the rows above it. */
export function buildOrderRow(rowNo: number, raw: Record<string, string>, mapping: OrderImportMapping, cat: ImportCatalog, taken: Map<string, number>): OrderImportPreviewRow {
  const get = (f: OrderImportField) => (mapping[f] ? String(raw[mapping[f]!] ?? '').trim() : '');
  const errors: OrderImportRowError[] = [];
  const name = get('clientName');
  if (!fullName.safeParse(name).success) errors.push({ field: 'clientName', code: 'VALIDATION_ERROR', params: { rule: 'validation.name' } });
  const phone = normalizePhoneDz(get('phone'));
  if (!isPhoneDz(phone)) errors.push({ field: 'phone', code: 'VALIDATION_ERROR', params: { rule: 'validation.phone' } });
  const wilayaId = resolveWilaya(get('wilaya'), cat.wilayas);
  const wilaya = wilayaId ? cat.wilayas.get(wilayaId)! : null;
  if (!wilaya) errors.push({ field: 'wilaya', code: 'VALIDATION_ERROR', params: { rule: 'validation.wilaya' } });
  else if (!wilaya.served) errors.push({ field: 'wilaya', code: 'WILAYA_NOT_SERVED' });
  const communeRaw = get('commune');
  const communeId = wilayaId && communeRaw ? (cat.communes.get(wilayaId)?.get(fold(communeRaw)) ?? null) : null;
  if (communeRaw.length > 100) errors.push({ field: 'commune', code: 'VALIDATION_ERROR', params: { rule: 'validation.commune' } });
  const address = get('address');
  if (address.length < 10) errors.push({ field: 'address', code: 'VALIDATION_ERROR', params: { rule: 'validation.address' } });
  const note = get('note') || null;
  const parsed = parseItems(get('items'));
  const items: OrderImportPreviewRow['values']['items'] = [];
  let subtotal = 0;
  if (!parsed) errors.push({ field: 'items', code: 'VALIDATION_ERROR', params: { rule: 'validation.quantity' } });
  else {
    const need = new Map<string, number>();
    for (const ref of parsed) {
      const found = lookupItem(cat, ref);
      const hit = found.hit;
      const it = { sku: ref.sku, quantity: found.quantity ?? ref.quantity };
      if (!hit) {
        errors.push({ field: 'items', code: 'NOT_FOUND', params: { sku: it.sku } });
        items.push({ sku: it.sku, quantity: it.quantity, productId: null, variantId: null, name: null, unitPrice: null });
        continue;
      }
      if (hit.hasVariants && !hit.variantId) errors.push({ field: 'items', code: 'VARIANT_REQUIRED', params: { sku: it.sku } });
      items.push({ sku: it.sku, quantity: it.quantity, productId: hit.productId, variantId: hit.variantId, name: hit.name, unitPrice: hit.price });
      subtotal += hit.price * it.quantity;
      if (hit.trackStock && hit.available !== null) {
        const k = `${hit.productId}|${hit.variantId ?? ''}`;
        need.set(k, (need.get(k) ?? 0) + it.quantity);
        const left = hit.available - (taken.get(k) ?? 0);
        if ((need.get(k) ?? 0) > left) errors.push({ field: 'items', code: 'ORDER_INSUFFICIENT_STOCK', params: { product: hit.name, available: Math.max(0, left) } });
      }
    }
    // a valid row reserves its quantities for the rows below it (the commit takes them in file order)
    if (!errors.length) for (const [k, q] of need) taken.set(k, (taken.get(k) ?? 0) + q);
  }
  return {
    row: rowNo,
    ok: errors.length === 0,
    values: { clientName: name || null, phone: isPhoneDz(phone) ? phone : get('phone') || null, wilayaId, wilaya: wilaya?.nameFr ?? (get('wilaya') || null), commune: communeRaw || null, communeId, address: address || null, note, items },
    total: wilaya && parsed ? subtotal + wilaya.homePrice : null,
    client: isPhoneDz(phone) ? (cat.existingPhones.has(phone) ? 'existing' : 'new') : null,
    errors,
  };
}
