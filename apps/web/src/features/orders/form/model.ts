// New order form model (Figma "ORD-02 — New order — form", 12 §5 "New order", 04 §1.2 / §1.6 / §2 / §4). Pure functions,
// unit tested: totals (integer DZD), validation checklist, form → `CreateOrderInput`, server field paths → form fields.
// The form keeps strings for money inputs (digits only, '' = empty) like the product form.
import { fullName as fullNameRule, isPhoneDz, normalizePhoneDz } from '@djaber/shared';
import type { CreateOrderInput, OrderDraft, PaymentMethod } from '@/features/orders/contracts';

export type FormClient = {
  /** null = a new client created with the order (found by phone first on the server, CLI-02) */
  id: string | null;
  name: string;
  phone: string;
  phone2: string;
  /** read-only facts of a picked client */
  riskLevel?: 'normal' | 'high';
  isPlaceholder?: boolean;
  blocked?: boolean;
  orderCount?: number;
  /** false: the picked client has no phone on record — the form asks for it and the order completes the client */
  hasPhone?: boolean;
};
export type VariantOption = {
  id: string;
  name: string;
  price: number;
  stock: number;
  isActive: boolean;
};
export type FormLine = {
  key: string;
  productId: string;
  productName: string;
  sku: string | null;
  imageUrl: string | null;
  hasVariants: boolean;
  trackStock: boolean;
  /** the product takes orders at zero stock (PV 22/10): asking more than the stock is a back-order, not an error */
  sellOutOfStock?: boolean;
  /** stock of the product (no variants); variants carry their own */
  stock: number | null;
  variants: VariantOption[];
  variantId: string | null;
  /** digits; defaults to the catalogue price */
  unitPrice: string;
  quantity: number;
};
export type OrderFormValues = {
  client: FormClient;
  lines: FormLine[];
  wilayaId: number | null;
  communeId: number | null;
  isStopdesk: boolean;
  stopdeskId: string | null;
  address: string;
  /** Admin+ fee override (digits, '' = grid quote) */
  feeOverride: string;
  /** order-level discount (digits) — Admin+ */
  discount: string;
  paymentMethod: PaymentMethod;
  amountPaid: string;
  status: 'new' | 'confirmed';
  notes: string;
  conversationId: string | null;
};

export const ADDRESS_MIN = 10;
export const NOTES_MAX = 2000;

export const emptyClient = (): FormClient => ({ id: null, name: '', phone: '', phone2: '' });
export const emptyOrderForm = (o: { conversationId?: string | null } = {}): OrderFormValues => ({
  client: emptyClient(),
  lines: [],
  wilayaId: null,
  communeId: null,
  isStopdesk: false,
  stopdeskId: null,
  address: '',
  feeOverride: '',
  discount: '',
  paymentMethod: 'cash',
  amountPaid: '',
  status: 'new',
  notes: '',
  conversationId: o.conversationId ?? null,
});

const int = (digits: string): number => (digits === '' ? 0 : Math.max(0, Math.trunc(Number(digits)) || 0));

/* ---------- lines & stock ---------- */
export const lineVariant = (l: FormLine): VariantOption | null => (l.variantId ? (l.variants.find((v) => v.id === l.variantId) ?? null) : null);
/** Stock available for the line (variant stock, product stock, or null when not tracked / not chosen yet). */
export const lineStock = (l: FormLine): number | null => {
  if (!l.trackStock) return null;
  if (l.hasVariants) return lineVariant(l)?.stock ?? null;
  return l.stock;
};
/**
 * `last_unit` when the line takes the last unit(s) exactly, `insufficient` when it asks more than the stock —
 * `backorder` instead for a product sold at zero stock (PV 22/10: allowed, a warning only).
 */
export const lineStockWarning = (l: FormLine): 'last_unit' | 'insufficient' | 'backorder' | null => {
  const s = lineStock(l);
  if (s === null) return null;
  if (l.quantity > s) return l.sellOutOfStock ? 'backorder' : 'insufficient';
  if (l.quantity === s) return 'last_unit';
  return null;
};
export const lineTotal = (l: FormLine): number => int(l.unitPrice) * Math.max(0, l.quantity);

/* ---------- totals (04 §4: integer DZD) ---------- */
export type OrderTotals = {
  itemCount: number;
  subtotal: number;
  discount: number;
  fee: number;
  total: number;
  paid: number;
  remaining: number;
};
/** `fee` = the override when set, else the grid quote (null while not quoted ⇒ 0). */
export function orderTotals(v: Pick<OrderFormValues, 'lines' | 'discount' | 'amountPaid' | 'feeOverride'>, quotedFee: number | null): OrderTotals {
  const subtotal = v.lines.reduce((s, l) => s + lineTotal(l), 0);
  const itemCount = v.lines.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  const discount = Math.min(int(v.discount), subtotal);
  const fee = v.feeOverride !== '' ? int(v.feeOverride) : (quotedFee ?? 0);
  const total = subtotal - discount + fee;
  const paid = int(v.amountPaid);
  return { itemCount, subtotal, discount, fee, total, paid, remaining: Math.max(0, total - paid) };
}

/* ---------- validation ---------- */
export type FieldKey =
  | 'client.name'
  | 'client.phone'
  | 'client.phone2'
  | 'lines'
  | `lines.${number}.variantId`
  | `lines.${number}.quantity`
  | `lines.${number}.unitPrice`
  | 'wilayaId'
  | 'communeId'
  | 'address'
  | 'amountPaid'
  | 'discount'
  | 'feeOverride'
  | 'notes';
/** field → i18n key of the message (+ params) */
export type FormErrors = Partial<Record<FieldKey, { key: string; params?: Record<string, string | number> }>>;

const validName = (s: string) => fullNameRule.safeParse(s).success;
export const validPhone = (s: string) => isPhoneDz(normalizePhoneDz(s.trim()));

/** Client-side rules (the server checks them again): the status picked decides whether the address is required. */
export function validateOrderForm(v: OrderFormValues, o: { status?: 'new' | 'confirmed'; quotedFee?: number | null } = {}): FormErrors {
  const status = o.status ?? v.status;
  const e: FormErrors = {};
  // a picked client without a phone (« À compléter ») is ordered for once its phone is given here
  if (v.client.id && v.client.hasPhone === false && !validPhone(v.client.phone)) e['client.phone'] = { key: v.client.phone.trim() ? 'validation.phone' : 'validation.required' };
  if (!v.client.id) {
    if (!validName(v.client.name)) e['client.name'] = { key: v.client.name.trim() ? 'validation.name' : 'validation.required' };
    if (!validPhone(v.client.phone))
      e['client.phone'] = {
        key: v.client.phone.trim() ? 'validation.phone' : 'validation.required',
      };
    if (v.client.phone2.trim() && !validPhone(v.client.phone2)) e['client.phone2'] = { key: 'validation.phone' };
  }
  if (v.lines.length === 0) e.lines = { key: 'orderForm.error.noItems' };
  v.lines.forEach((l, i) => {
    if (l.hasVariants && !l.variantId) e[`lines.${i}.variantId`] = { key: 'error.VARIANT_REQUIRED' };
    if (!Number.isInteger(l.quantity) || l.quantity < 1) e[`lines.${i}.quantity`] = { key: 'validation.quantity' };
    if (l.unitPrice === '' || int(l.unitPrice) <= 0) e[`lines.${i}.unitPrice`] = { key: 'validation.price' };
  });
  const confirm = status === 'confirmed';
  if (confirm && !v.wilayaId) e.wilayaId = { key: 'validation.required' };
  if (confirm && v.wilayaId && !v.communeId) e.communeId = { key: 'validation.required' };
  const address = v.address.trim();
  if (!v.isStopdesk && ((confirm && address.length < ADDRESS_MIN) || (address.length > 0 && address.length < ADDRESS_MIN))) e.address = { key: 'validation.address' };
  if (v.notes.length > NOTES_MAX) e.notes = { key: 'validation.length', params: { max: NOTES_MAX } };
  const t = orderTotals(v, o.quotedFee ?? null);
  if (t.paid > t.total && t.total > 0) e.amountPaid = { key: 'orderForm.error.paidOverTotal' };
  return e;
}
export const firstErrorField = (e: FormErrors): FieldKey | null => (Object.keys(e)[0] as FieldKey | undefined) ?? null;

/* ---------- validation checklist of the summary rail ---------- */
export type CheckState = 'ok' | 'missing' | 'warning';
export type CheckItem = {
  key: 'client' | 'items' | 'address' | 'fee' | 'variants' | 'lastUnit' | 'notServed';
  state: CheckState;
  params?: Record<string, string | number>;
};
export function validationChecklist(v: OrderFormValues, quote: { wilayaServed: boolean } | null): CheckItem[] {
  const clientOk = v.client.id ? v.client.hasPhone !== false || validPhone(v.client.phone) : validName(v.client.name) && validPhone(v.client.phone);
  const stockOk = v.lines.length > 0 && v.lines.every((l) => lineStockWarning(l) !== 'insufficient');
  const addressOk = !!v.wilayaId && !!v.communeId && (v.isStopdesk || v.address.trim().length >= ADDRESS_MIN);
  const withVariants = v.lines.filter((l) => l.hasVariants);
  const items: CheckItem[] = [
    { key: 'client', state: clientOk ? 'ok' : 'missing' },
    { key: 'items', state: stockOk ? 'ok' : 'missing' },
    { key: 'address', state: addressOk ? 'ok' : v.status === 'confirmed' ? 'missing' : 'warning' },
    { key: 'fee', state: !!v.wilayaId && !!quote?.wilayaServed ? 'ok' : 'missing' },
  ];
  if (withVariants.length)
    items.push({
      key: 'variants',
      state: withVariants.every((l) => !!l.variantId) ? 'ok' : 'missing',
    });
  if (v.wilayaId && quote && !quote.wilayaServed) items.push({ key: 'notServed', state: 'warning' });
  for (const l of v.lines) {
    if (lineStockWarning(l) === 'last_unit')
      items.push({
        key: 'lastUnit',
        state: 'warning',
        params: { name: lineVariant(l)?.name ?? l.productName },
      });
  }
  return items;
}

/* ---------- payload ---------- */
export function toCreatePayload(v: OrderFormValues, o: { status: 'new' | 'confirmed'; canMoney: boolean; confirm?: boolean }): CreateOrderInput {
  const client: CreateOrderInput['client'] = v.client.id
    ? { id: v.client.id, ...(v.client.hasPhone === false ? { phone: normalizePhoneDz(v.client.phone.trim()) } : {}) }
    : {
        name: v.client.name.trim(),
        phone: normalizePhoneDz(v.client.phone.trim()),
        ...(v.client.phone2.trim() ? { phone2: normalizePhoneDz(v.client.phone2.trim()) } : {}),
      };
  const payload: CreateOrderInput = {
    client,
    items: v.lines.map((l) => ({
      productId: l.productId,
      ...(l.variantId ? { variantId: l.variantId } : {}),
      quantity: l.quantity,
      unitPrice: int(l.unitPrice),
    })),
    paymentMethod: v.paymentMethod,
    status: o.status,
  };
  if (v.wilayaId) {
    payload.delivery = {
      wilayaId: v.wilayaId,
      ...(v.communeId ? { communeId: v.communeId } : {}),
      isStopdesk: v.isStopdesk,
      ...(v.isStopdesk && v.stopdeskId ? { stopdeskId: v.stopdeskId } : {}),
      ...(v.address.trim() ? { address: v.address.trim() } : {}),
      ...(o.canMoney && v.feeOverride !== '' ? { deliveryFee: int(v.feeOverride) } : {}),
    };
  }
  if (v.amountPaid !== '' && int(v.amountPaid) > 0) payload.amountPaid = int(v.amountPaid);
  if (o.canMoney && v.discount !== '' && int(v.discount) > 0) payload.discount = int(v.discount);
  if (v.notes.trim()) payload.notes = v.notes.trim();
  if (v.conversationId) payload.conversationId = v.conversationId;
  if (o.confirm) payload.confirm = true;
  return payload;
}

/** `POST /orders/:id/duplicate` draft → form values (product facts are filled by the caller once loaded). */
export function draftToForm(d: OrderDraft, lines: FormLine[]): OrderFormValues {
  const base = emptyOrderForm({ conversationId: null });
  const c = d.client as { id?: string; name?: string; phone?: string; phone2?: string | null };
  return {
    ...base,
    client: c.id ? { ...emptyClient(), id: c.id } : { ...emptyClient(), name: c.name ?? '', phone: c.phone ?? '', phone2: c.phone2 ?? '' },
    lines,
    wilayaId: d.delivery?.wilayaId ?? null,
    communeId: d.delivery?.communeId ?? null,
    isStopdesk: d.delivery?.isStopdesk ?? false,
    stopdeskId: d.delivery?.stopdeskId ?? null,
    address: d.delivery?.address ?? '',
    paymentMethod: d.paymentMethod ?? 'cash',
    discount: d.discount ? String(d.discount) : '',
    notes: d.notes ?? '',
    conversationId: d.conversationId ?? null,
  };
}

/* ---------- server errors ---------- */
/** `fields` path of the error envelope → form field (`items.2.variantId` → `lines.2.variantId`, `delivery.address` → `address`). */
export function serverField(path: string): FieldKey | null {
  const p = path.replace(/^body\./, '');
  const item = /^items\.(\d+)\.(variantId|quantity|unitPrice)$/.exec(p);
  if (item) return `lines.${Number(item[1])}.${item[2] as 'variantId' | 'quantity' | 'unitPrice'}`;
  if (/^items(\.\d+)?$/.test(p)) return 'lines';
  const map: Record<string, FieldKey> = {
    'client.name': 'client.name',
    'client.phone': 'client.phone',
    'client.phone2': 'client.phone2',
    phone: 'client.phone',
    name: 'client.name',
    'delivery.wilayaId': 'wilayaId',
    'delivery.communeId': 'communeId',
    'delivery.communeText': 'communeId',
    'delivery.address': 'address',
    'delivery.deliveryFee': 'feeOverride',
    amountPaid: 'amountPaid',
    discount: 'discount',
    notes: 'notes',
  };
  return map[p] ?? null;
}

/** Line index of a line-level error without a field path (`ORDER_INSUFFICIENT_STOCK {product}`, `VARIANT_REQUIRED`). */
export function lineIndexOf(lines: FormLine[], details: unknown, params: Record<string, unknown>): number {
  const d = (details ?? {}) as { productId?: string; variantId?: string | null; index?: number };
  if (typeof d.index === 'number' && d.index >= 0 && d.index < lines.length) return d.index;
  const productId = d.productId ?? (typeof params.productId === 'string' ? params.productId : undefined);
  if (productId) {
    const i = lines.findIndex((l) => l.productId === productId && (!d.variantId || l.variantId === d.variantId));
    if (i >= 0) return i;
  }
  const name = typeof params.product === 'string' ? params.product : undefined;
  if (name) {
    const i = lines.findIndex((l) => name.startsWith(l.productName));
    if (i >= 0) return i;
  }
  return -1;
}

/* ---------- draft (sessionStorage) ---------- */
const DRAFT_KEY = (route: string) => `djaber.draft:${route}`;
const validDraft = (v: unknown): v is OrderFormValues =>
  !!v && typeof v === 'object' && Array.isArray((v as OrderFormValues).lines) && typeof (v as OrderFormValues).client === 'object' && (v as OrderFormValues).client !== null;
export const encodeDraft = (v: OrderFormValues): string => JSON.stringify(v);
export function decodeDraft(raw: string | null): OrderFormValues | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!validDraft(parsed)) return null;
    const base = emptyOrderForm();
    return { ...base, ...parsed, client: { ...base.client, ...parsed.client } };
  } catch {
    return null;
  }
}
export function readOrderDraft(route: string): OrderFormValues | null {
  try {
    return decodeDraft(window.sessionStorage.getItem(DRAFT_KEY(route)));
  } catch {
    return null;
  }
}
export function writeOrderDraft(route: string, v: OrderFormValues) {
  try {
    window.sessionStorage.setItem(DRAFT_KEY(route), encodeDraft(v));
  } catch {
    // storage full or blocked: the draft is a convenience
  }
}
export function clearOrderDraft(route: string) {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY(route));
  } catch {}
}
/** True when the merchant typed something worth keeping (an untouched form leaves no draft and no leave guard). */
export const isFormDirty = (v: OrderFormValues, initial: OrderFormValues): boolean => JSON.stringify(v) !== JSON.stringify(initial);

/**
 * "Annuler" of the form goes back where the order was started: the conversation (`?conversationId=`), the client
 * sheet (`?clientId=`), the order being duplicated (`?duplicate=`), else the orders list.
 */
export const cancelHref = (o: { conversationId?: string | null; clientId?: string | null; duplicateId?: string | null }): string =>
  o.conversationId ? `/inbox/${o.conversationId}` : o.clientId ? `/clients?sheet=${o.clientId}` : o.duplicateId ? `/orders/${o.duplicateId}` : '/orders';
