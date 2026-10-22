import { describe, expect, it } from 'vitest';
import { searchTerm } from '@/lib/phone';
import { exactPhoneMatch } from './client-section';
import {
  cancelHref,
  decodeDraft,
  draftToForm,
  emptyOrderForm,
  encodeDraft,
  firstErrorField,
  isFormDirty,
  lineIndexOf,
  lineStockWarning,
  orderTotals,
  serverField,
  toCreatePayload,
  validateOrderForm,
  validationChecklist,
  type FormLine,
  type OrderFormValues,
} from './model';

const line = (o: Partial<FormLine> = {}): FormLine => ({
  key: 'k1',
  productId: 'p1',
  productName: 'La Robe satin',
  sku: 'RS-NM',
  imageUrl: null,
  hasVariants: false,
  trackStock: true,
  stock: 10,
  variants: [],
  variantId: null,
  unitPrice: '4900',
  quantity: 1,
  ...o,
});
const variants = [
  { id: 'v1', name: 'Noir · M', price: 4900, stock: 1, isActive: true },
  { id: 'v2', name: 'Bordeaux', price: 2400, stock: 41, isActive: true },
];
const filled = (o: Partial<OrderFormValues> = {}): OrderFormValues => ({
  ...emptyOrderForm(),
  client: { id: null, name: 'Amina Belkacem', phone: '0555 12 34 56', phone2: '' },
  lines: [line()],
  wilayaId: 19,
  communeId: 1901,
  address: 'Cité 500 logements, bât. 12',
  ...o,
});

describe('order totals (integer DZD)', () => {
  it('sums lines, discount, quoted fee and remaining', () => {
    const v = filled({
      lines: [line({ unitPrice: '4900', quantity: 1 }), line({ key: 'k2', productId: 'p2', unitPrice: '2400', quantity: 1 }), line({ key: 'k3', productId: 'p3', unitPrice: '4900', quantity: 2 })],
      discount: '0',
      amountPaid: '',
    });
    expect(orderTotals(v, 0)).toEqual({
      itemCount: 4,
      subtotal: 17_100,
      discount: 0,
      fee: 0,
      total: 17_100,
      paid: 0,
      remaining: 17_100,
    });
  });
  it('uses the override before the quote, caps the discount at the subtotal, never a negative remaining', () => {
    const v = filled({
      lines: [line({ unitPrice: '1000', quantity: 2 })],
      feeOverride: '350',
      discount: '5000',
      amountPaid: '9999',
    });
    const t = orderTotals(v, 400);
    expect(t.fee).toBe(350);
    expect(t.discount).toBe(2000);
    expect(t.total).toBe(350);
    expect(t.remaining).toBe(0);
  });
  it('quote not known yet ⇒ fee 0', () => {
    expect(orderTotals(filled(), null).fee).toBe(0);
  });
});

describe('stock warnings', () => {
  it('last unit of a variant, insufficient, untracked', () => {
    expect(lineStockWarning(line({ hasVariants: true, variants, variantId: 'v1', quantity: 1 }))).toBe('last_unit');
    expect(lineStockWarning(line({ hasVariants: true, variants, variantId: 'v1', quantity: 2 }))).toBe('insufficient');
    expect(lineStockWarning(line({ hasVariants: true, variants, variantId: null }))).toBeNull();
    expect(lineStockWarning(line({ trackStock: false, stock: null, quantity: 99 }))).toBeNull();
    expect(lineStockWarning(line({ stock: 3, quantity: 2 }))).toBeNull();
  });
  it('a product sold at zero stock (PV 22/10): more than the stock is a back-order warning, the items check stays ok', () => {
    expect(lineStockWarning(line({ stock: 0, quantity: 2, sellOutOfStock: true }))).toBe('backorder');
    expect(lineStockWarning(line({ stock: 0, quantity: 2 }))).toBe('insufficient');
    const items = validationChecklist(filled({ lines: [line({ stock: 0, quantity: 2, sellOutOfStock: true })] }), { wilayaServed: true });
    expect(items.find((i) => i.key === 'items')?.state).toBe('ok');
  });
});

describe('validation', () => {
  it('a new client needs a valid name and DZ phone', () => {
    const e = validateOrderForm(filled({ client: { id: null, name: 'A', phone: '12', phone2: '' } }));
    expect(e['client.name']?.key).toBe('validation.name');
    expect(e['client.phone']?.key).toBe('validation.phone');
    expect(validateOrderForm(filled({ client: { id: 'c1', name: '', phone: '', phone2: '' } }))['client.name']).toBeUndefined();
  });
  it('a picked client without a phone (« À compléter ») is ordered for once its phone is given — sent with the client id (tester report 2026-10-20)', () => {
    const noPhone = { id: 'c1', name: 'Amina', phone: '', phone2: '', hasPhone: false };
    expect(validateOrderForm(filled({ client: noPhone }))['client.phone']?.key).toBe('validation.required');
    expect(validateOrderForm(filled({ client: { ...noPhone, phone: '12' } }))['client.phone']?.key).toBe('validation.phone');
    const ok = filled({ client: { ...noPhone, phone: '0555 12 34 56' } });
    expect(validateOrderForm(ok)['client.phone']).toBeUndefined();
    expect(toCreatePayload(ok, { status: 'new', canMoney: false }).client).toEqual({ id: 'c1', phone: '0555123456' });
    // a client with a phone on record is sent by id only
    expect(toCreatePayload(filled({ client: { id: 'c1', name: 'A', phone: '0555123456', phone2: '', hasPhone: true } }), { status: 'new', canMoney: false }).client).toEqual({ id: 'c1' });
  });
  it('at least one line, variant required, quantity and price', () => {
    expect(validateOrderForm(filled({ lines: [] })).lines?.key).toBe('orderForm.error.noItems');
    const e = validateOrderForm(filled({ lines: [line({ hasVariants: true, variants, variantId: null, unitPrice: '' })] }));
    expect(e['lines.0.variantId']?.key).toBe('error.VARIANT_REQUIRED');
    expect(e['lines.0.unitPrice']?.key).toBe('validation.price');
  });
  it('status confirmed requires wilaya, commune and a 10-character home address (ORDER_ADDRESS_REQUIRED)', () => {
    const empty = filled({ wilayaId: null, communeId: null, address: '' });
    expect(validateOrderForm(empty, { status: 'new' })).toEqual({});
    const e = validateOrderForm(empty, { status: 'confirmed' });
    expect(Object.keys(e)).toEqual(['wilayaId', 'address']);
    expect(validateOrderForm(filled({ communeId: null }), { status: 'confirmed' }).communeId?.key).toBe('validation.required');
    expect(validateOrderForm(filled({ address: '', isStopdesk: true }), { status: 'confirmed' })).toEqual({});
    expect(validateOrderForm(filled({ address: 'court' }), { status: 'new' }).address?.key).toBe('validation.address');
  });
  it('paid amount above the total', () => {
    expect(validateOrderForm(filled({ amountPaid: '5000' }), { quotedFee: 0 }).amountPaid?.key).toBe('orderForm.error.paidOverTotal');
  });
  it('first error follows the form order', () => {
    expect(firstErrorField(validateOrderForm(filled({ client: { id: null, name: '', phone: '', phone2: '' }, lines: [] })))).toBe('client.name');
  });
});

describe('validation checklist', () => {
  it('ok / missing / warnings', () => {
    const items = validationChecklist(filled({ lines: [line({ hasVariants: true, variants, variantId: 'v1' })] }), { wilayaServed: true });
    expect(items.map((i) => `${i.key}:${i.state}`)).toEqual(['client:ok', 'items:ok', 'address:ok', 'fee:ok', 'variants:ok', 'lastUnit:warning']);
    expect(items.at(-1)?.params).toEqual({ name: 'Noir · M' });
    const notServed = validationChecklist(filled(), { wilayaServed: false });
    expect(notServed.find((i) => i.key === 'fee')?.state).toBe('missing');
    expect(notServed.find((i) => i.key === 'notServed')?.state).toBe('warning');
    expect(validationChecklist(filled({ wilayaId: null, communeId: null, address: '' }), null).find((i) => i.key === 'address')?.state).toBe('warning');
  });
});

describe('form → CreateOrderInput', () => {
  it('new client with normalised phone, delivery, override and discount only for orders.money', () => {
    const v = filled({
      client: { id: null, name: ' Amina Belkacem ', phone: '+213 555 12 34 56', phone2: '' },
      feeOverride: '300',
      discount: '500',
      amountPaid: '1000',
      notes: ' matin ',
      conversationId: 'conv1',
    });
    expect(toCreatePayload(v, { status: 'confirmed', canMoney: true })).toEqual({
      client: { name: 'Amina Belkacem', phone: '0555123456' },
      items: [{ productId: 'p1', quantity: 1, unitPrice: 4900 }],
      paymentMethod: 'cash',
      status: 'confirmed',
      delivery: {
        wilayaId: 19,
        communeId: 1901,
        isStopdesk: false,
        address: 'Cité 500 logements, bât. 12',
        deliveryFee: 300,
      },
      amountPaid: 1000,
      discount: 500,
      notes: 'matin',
      conversationId: 'conv1',
    });
    const operator = toCreatePayload(v, { status: 'new', canMoney: false });
    expect(operator.delivery?.deliveryFee).toBeUndefined();
    expect(operator.discount).toBeUndefined();
  });
  it('existing client, variant line, stop-desk, no delivery block without wilaya, confirm flag', () => {
    const v = filled({
      client: { id: 'c1', name: 'Amina', phone: '0555123456', phone2: '' },
      lines: [line({ hasVariants: true, variants, variantId: 'v2', unitPrice: '2400', quantity: 2 })],
      isStopdesk: true,
      stopdeskId: 'sd1',
    });
    const p = toCreatePayload(v, { status: 'new', canMoney: false, confirm: true });
    expect(p.client).toEqual({ id: 'c1' });
    expect(p.items).toEqual([{ productId: 'p1', variantId: 'v2', quantity: 2, unitPrice: 2400 }]);
    expect(p.delivery).toMatchObject({ isStopdesk: true, stopdeskId: 'sd1' });
    expect(p.confirm).toBe(true);
    expect(toCreatePayload(filled({ wilayaId: null }), { status: 'new', canMoney: false }).delivery).toBeUndefined();
  });
  it('duplicate draft → form', () => {
    const f = draftToForm(
      {
        client: { id: 'c1' },
        items: [{ productId: 'p1', quantity: 1 }],
        paymentMethod: 'cash',
        status: 'new',
        delivery: { wilayaId: 16, communeId: null, isStopdesk: false, address: 'Rue Didouche 12' },
      },
      [line()],
    );
    expect(f.client.id).toBe('c1');
    expect(f.wilayaId).toBe(16);
    expect(f.address).toBe('Rue Didouche 12');
    expect(f.lines).toHaveLength(1);
  });
});

describe('server errors', () => {
  it('maps field paths of the envelope onto the form', () => {
    expect(serverField('items.2.variantId')).toBe('lines.2.variantId');
    expect(serverField('items')).toBe('lines');
    expect(serverField('delivery.address')).toBe('address');
    expect(serverField('delivery.communeText')).toBe('communeId');
    expect(serverField('client.phone')).toBe('client.phone');
    expect(serverField('unknown.field')).toBeNull();
  });
  it('finds the line of a line-level error', () => {
    const lines = [line(), line({ key: 'k2', productId: 'p2', productName: 'Foulard soie' })];
    expect(lineIndexOf(lines, { productId: 'p2' }, {})).toBe(1);
    expect(lineIndexOf(lines, null, { product: 'Foulard soie · Bordeaux' })).toBe(1);
    expect(lineIndexOf(lines, { index: 0 }, {})).toBe(0);
    expect(lineIndexOf(lines, null, {})).toBe(-1);
  });
});

describe('draft codec', () => {
  it('round-trips and rejects garbage', () => {
    const v = filled();
    expect(decodeDraft(encodeDraft(v))).toEqual(v);
    expect(decodeDraft('{"nope":1}')).toBeNull();
    expect(decodeDraft('not json')).toBeNull();
    expect(decodeDraft(null)).toBeNull();
  });
  it('dirty only when something was typed', () => {
    const initial = emptyOrderForm();
    expect(isFormDirty(emptyOrderForm(), initial)).toBe(false);
    expect(isFormDirty({ ...initial, notes: 'x' }, initial)).toBe(true);
  });
});

describe('client search', () => {
  it('phone fragments are sent normalised, names as typed', () => {
    expect(searchTerm('0555 12')).toBe('055512');
    expect(searchTerm('+213 555')).toBe('0555');
    expect(searchTerm(' Amina ')).toBe('Amina');
  });
  it('exact phone match among results', () => {
    const rows = [
      { id: 'c1', phone: '0555123456', phone2: null },
      { id: 'c2', phone: '0661441092', phone2: null },
    ] as never[];
    expect(exactPhoneMatch(rows, '+213 555 12 34 56')).toMatchObject({ id: 'c1' });
    expect(exactPhoneMatch(rows, '0555 12')).toBeNull();
  });
});

describe('cancelHref — "Annuler" goes back where the order was started', () => {
  it('conversation, then client, then duplicated order, else the list', () => {
    expect(cancelHref({ conversationId: 'c1', clientId: 'cl1' })).toBe('/inbox/c1');
    expect(cancelHref({ clientId: 'cl1' })).toBe('/clients?sheet=cl1');
    expect(cancelHref({ duplicateId: 'o1' })).toBe('/orders/o1');
    expect(cancelHref({})).toBe('/orders');
    expect(cancelHref({ conversationId: null, clientId: null, duplicateId: null })).toBe('/orders');
  });
});
