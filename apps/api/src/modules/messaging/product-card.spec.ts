import { cardElement, cardSubtitle } from './product-card';

const labels = { order: 'Commander', photos: 'Plus de photos', photo: 'Photo {n}/{total}' };
const id = '01a1e537-beb6-7b43-8512-5aebb3314683';

describe('cardSubtitle (journey J02-1: the price is never the part that gets cut)', () => {
  it('a short line is kept whole', () => {
    const s = cardSubtitle({ productId: id, name: 'T-shirt', price: 1500, priceMax: 1900, imageUrl: null, variants: 'S · M · L · XL' }, labels);
    expect(s).toMatch(/^S · M · L · XL · 1\s500\sDA – 1\s900\sDA$/);
  });
  it('six variants: the variant list is shortened, the full price range stays', () => {
    const variants = '40 · Noir · 40 · Blanc · 41 · Noir · 41 · Blanc · 42 · Noir · 42 · Blanc';
    const s = cardSubtitle({ productId: id, name: 'Chaussures', price: 4500, priceMax: 4800, imageUrl: null, variants }, labels);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s).toMatch(/4\s500\sDA – 4\s800\sDA$/);
    expect(s).toContain('…');
    expect(s.startsWith('40 · Noir')).toBe(true);
  });
  it('a gallery card keeps « Photo n/total » and the price', () => {
    const variants = Array.from({ length: 8 }, (_, i) => `Variante très longue numéro ${i + 1}`).join(' · ');
    const s = cardSubtitle({ productId: id, name: 'X', price: 125000, imageUrl: 'u', variants, photo: { n: 2, total: 5 } }, labels);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.startsWith('Photo 2/5 · ')).toBe(true);
    expect(s).toMatch(/125\s000\sDA$/);
  });
  it('the element uses the same subtitle', () => {
    const c = { productId: id, name: 'Robe', price: 4900, oldPrice: 5900, imageUrl: null, photos: 2 };
    const e = cardElement(c, labels);
    expect(e.subtitle).toBe(cardSubtitle(c, labels));
    expect(e.buttons.map((b) => b.payload)).toEqual([`ORDER:${id}`, `PHOTOS:${id}`]);
  });
});

describe('productCards (journey re-run J03r-4: a sold-out variant is never offered on the card)', () => {
  const robe = (o: { sellOutOfStock?: boolean; trackStock?: boolean } = {}) => ({
    id,
    name: 'Robe kabyle brodée',
    description: null,
    price: 4900,
    oldPrice: null,
    hasVariants: true,
    trackStock: o.trackStock ?? true,
    sellOutOfStock: o.sellOutOfStock ?? false,
    moderationStatus: 'approved',
    approvedSnapshot: null,
    variants: [
      { id: 'v-s', name: 'S', price: 4900, stock: 5 },
      { id: 'v-m', name: 'M', price: 4900, stock: 5 },
      { id: 'v-l', name: 'L', price: 4600, stock: 0 },
      { id: 'v-xl', name: 'XL', price: 5200, stock: 2 },
    ],
  });
  const db = (row: ReturnType<typeof robe>, reserved: { productId: string; variantId: string | null; reserved: number }[] = []) =>
    ({ product: { findMany: async () => [row] }, productImage: { findMany: async () => [] }, $queryRaw: async () => reserved }) as never;
  it('« S · M · XL », the range of the offered variants (L at 0 and its lower price left out)', async () => {
    const { productCards } = await import('./product-card');
    const [c] = await productCards(db(robe()), [id], { ai: true });
    expect(c).toMatchObject({ variants: 'S · M · XL', price: 4900, priceMax: 5200 });
  });
  it('sold beyond stock, or stock not tracked: every variant stays', async () => {
    const { productCards } = await import('./product-card');
    expect((await productCards(db(robe({ sellOutOfStock: true })), [id], { ai: true }))[0]!.variants).toBe('S · M · L · XL');
    expect((await productCards(db(robe({ trackStock: false })), [id], { ai: true }))[0]!.variants).toBe('S · M · L · XL');
  });
});
