// MSG-07 — the product card a customer receives on Messenger / Instagram: one generic-template element per product (or per
// picture for a gallery), built once for the send and for « Aperçu carte Messenger » (PV 09/11: the preview showed a card
// with a « Commander » button while the customer received a picture and a line of text, without any button; only the main
// picture of a product could ever be shown).
import { formatMoney, getMessages, PRODUCT_CARDS_MAX, type AppLocale, type MessageCardView } from '@djaber/shared';
import type { prisma, Tx } from '@djaber/db';
import { approvedFields, approvedImages, approvedVariants } from '../catalog/approved-content';
import { reservedQuantities } from '../catalog/stock.service';

export type CardButton = { title: string; payload: string };
export type CardElement = { title: string; subtitle?: string; imageUrl?: string; buttons: CardButton[] };
export type CardLabels = { order: string; photos: string; photo: string };

/** Meta limits of a generic-template element. */
const TITLE_MAX = 80;
const SUBTITLE_MAX = 80;
const BUTTON_MAX = 20;
/** Elements of one carousel (Meta: 10). */
export const GALLERY_MAX = 10;

/** The button postbacks: `ORDER:<productId>` / `PHOTOS:<productId>`. */
export const CARD_POSTBACK = /^(ORDER|PHOTOS):([0-9a-f-]{36})$/i;

export const cardLabels = (locale: AppLocale): CardLabels => {
  const m = getMessages(locale);
  return { order: m['customer.card.order'] ?? 'Commander', photos: m['customer.card.photos'] ?? 'Plus de photos', photo: m['customer.card.photo'] ?? 'Photo {n}/{total}' };
};

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const cardPrice = (c: Pick<MessageCardView, 'price' | 'priceMax' | 'oldPrice'>) =>
  `${formatMoney(c.price)}${c.priceMax && c.priceMax !== c.price ? ` – ${formatMoney(c.priceMax)}` : ''}${c.oldPrice && c.oldPrice > c.price ? ` (${formatMoney(c.oldPrice)})` : ''}`;

const SEP = ' · ';
/**
 * The subtitle « [Photo n/total ·] variants · price ». The price is the key line of the card: when the whole line is longer
 * than Meta's 80 characters, the variant list is the part that is shortened (or dropped), never the price (journey J02-1:
 * six short variant names cut « 4 500 DA » into « 4 50… »).
 */
export const cardSubtitle = (c: MessageCardView, l: CardLabels): string => {
  const photo = c.photo ? l.photo.replace('{n}', String(c.photo.n)).replace('{total}', String(c.photo.total)) : null;
  const price = cardPrice(c);
  const fixed = [photo, price].filter(Boolean).join(SEP);
  const room = SUBTITLE_MAX - fixed.length - SEP.length;
  let variants = c.variants ?? null;
  if (variants && variants.length > room) {
    // shorten on a separator so no variant name is cut in the middle; keep « … » to say there are more
    const names = variants.split(SEP);
    let kept = '';
    for (const n of names) {
      const next = kept ? `${kept}${SEP}${n}` : n;
      if (next.length + 2 > room) break; // room for « · … » / « … »
      kept = next;
    }
    variants = kept ? `${kept} …` : null;
  }
  return cut([photo, variants, price].filter(Boolean).join(SEP), SUBTITLE_MAX);
};

export const cardElement = (c: MessageCardView, l: CardLabels): CardElement => ({
  title: cut(c.name, TITLE_MAX),
  subtitle: cardSubtitle(c, l),
  ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
  buttons: [
    { title: cut(l.order, BUTTON_MAX), payload: `ORDER:${c.productId}` },
    // the other pictures of the product (a gallery card already is one of them)
    ...(!c.photo && (c.photos ?? 0) > 1 ? [{ title: cut(l.photos, BUTTON_MAX), payload: `PHOTOS:${c.productId}` }] : []),
  ],
});

/**
 * The cards of products (≤ 5, in the order asked), or with `gallery` every picture of the first product (≤ 10). `ai`: only
 * what moderation approved (name, pictures, variants — tester report 25/10 UX-006); a member sends the product as it is.
 * A product with variants shows its variants and their price range, never the base price (tester report 2026-10-20).
 */
export async function productCards(db: Tx | typeof prisma, productIds: string[], o: { ai: boolean; gallery?: boolean }): Promise<MessageCardView[]> {
  // unknown / inactive ids are dropped before the 5 cards are counted (AT-MSG-09)
  const wanted = [...new Set(productIds)].slice(0, o.gallery ? 1 : 30);
  if (!wanted.length) return [];
  const rows = await (db as Tx).product.findMany({
    where: { id: { in: wanted }, deletedAt: null, isActive: true },
    select: { id: true, name: true, description: true, price: true, oldPrice: true, hasVariants: true, trackStock: true, sellOutOfStock: true, moderationStatus: true, approvedSnapshot: true, variants: { where: { deletedAt: null, isActive: true }, select: { id: true, name: true, price: true, stock: true }, orderBy: { createdAt: 'asc' } } },
  });
  // journey re-run J03r-4 (18/11): a sold-out variant is not offered on the card — « S · M · L · XL » with L at 0 next to the AI's « la L
  // est épuisée ». Sold out = stock tracked, no sale beyond stock, and nothing left once the unconfirmed orders' share is held (the AI
  // catalogue's own count). The price range is the offered variants'; a product whose every variant is sold out lists none.
  let held = new Map<string, number>();
  try {
    held = await reservedQuantities(db, rows.filter((r) => r.trackStock && r.hasVariants).map((r) => r.id));
  } catch {
    // no tenant context (or a read failure): the stock as stored
  }
  const soldOut = (p: (typeof rows)[number], v: { id: string; stock: number }) => p.trackStock && !p.sellOutOfStock && v.stock - (held.get(`${p.id}:${v.id}`) ?? 0) <= 0;
  const images = await (db as Tx).productImage.findMany({ where: { productId: { in: rows.map((p) => p.id) } }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], select: { productId: true, url: true } });
  const imagesOf = (p: (typeof rows)[number]) => {
    const own = images.filter((i) => i.productId === p.id);
    return o.ai ? approvedImages(p, own) : own;
  };
  const byId = new Map(rows.map((p) => [p.id, o.ai ? { ...p, ...approvedFields(p), variants: approvedVariants(p, p.variants) } : p]));
  const base = (p: NonNullable<ReturnType<typeof byId.get>>): Omit<MessageCardView, 'imageUrl'> => {
    if (!p.hasVariants || !p.variants.length) return { productId: p.id, name: p.name, price: p.price, ...(p.oldPrice && p.oldPrice > p.price ? { oldPrice: p.oldPrice } : {}) };
    const row = rows.find((r) => r.id === p.id)!;
    const stockOf = new Map(row.variants.map((v) => [v.id, v.stock]));
    const offered = p.variants.filter((v) => !soldOut(row, { id: v.id, stock: stockOf.get(v.id) ?? 0 }));
    const prices = (offered.length ? offered : p.variants).map((v) => v.price);
    const [min, max] = [Math.min(...prices), Math.max(...prices)];
    return { productId: p.id, name: p.name, price: min, ...(max !== min ? { priceMax: max } : {}), ...(offered.length ? { variants: offered.map((v) => v.name).slice(0, 8).join(' · ') } : {}) };
  };
  if (o.gallery) {
    const p = byId.get(wanted[0]!);
    const row = rows.find((r) => r.id === wanted[0]);
    if (!p || !row) return [];
    const pics = imagesOf(row).slice(0, GALLERY_MAX);
    return pics.map((img, i) => ({ ...base(p), imageUrl: img.url, photo: { n: i + 1, total: pics.length } }));
  }
  return wanted
    .map((id): MessageCardView | null => {
      const p = byId.get(id);
      const row = rows.find((r) => r.id === id);
      if (!p || !row) return null;
      const pics = imagesOf(row);
      return { ...base(p), imageUrl: pics[0]?.url ?? null, photos: pics.length };
    })
    .filter((c): c is MessageCardView => !!c)
    .slice(0, PRODUCT_CARDS_MAX);
}
