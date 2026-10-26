// 04 §12 "Visibility while pending" — what a customer may be shown of a product: only what moderation approved. Shared by
// the AI catalogue (prompt, tools, vision) and the product cards the AI sends.
//  - fields (name, description, price): the approved snapshot while a change waits for the decision, the live row otherwise;
//  - pictures: those of the approved snapshot (a picture added since waits for the save and the decision);
//  - variants: those of the approved snapshot (a new variant waits; while a change is pending, the approved name and price).
// A snapshot written before pictures / variants were kept lists none of them: the live ones stay (tester report 25/10 UX-006).
import type { Prisma } from '@djaber/db';

/** The upload folder of an image (`…/product/<uuid>/…`): the same picture before and after its re-encode. */
export const imageToken = (url: string) => /\/product\/([0-9a-f-]{36})\//i.exec(url)?.[1] ?? url;

type Snap = { title?: string; description?: string | null; price?: number; images?: string[]; variants?: { id: string; name: string; price: number }[] };
type Moderated = { moderationStatus: string; approvedSnapshot: Prisma.JsonValue | null };

const snapshotOf = (p: Pick<Moderated, 'approvedSnapshot'>): Snap | null =>
  p.approvedSnapshot && typeof p.approvedSnapshot === 'object' && !Array.isArray(p.approvedSnapshot) ? (p.approvedSnapshot as Snap) : null;

export const approvedFields = (p: Moderated & { name: string; description: string | null; price: number }) => {
  const s = p.moderationStatus === 'pending' ? snapshotOf(p) : null;
  return s ? { name: s.title ?? p.name, description: s.description ?? null, price: typeof s.price === 'number' ? s.price : p.price } : { name: p.name, description: p.description, price: p.price };
};

export const approvedImages = <I extends { url: string }>(p: Pick<Moderated, 'approvedSnapshot'>, images: I[]): I[] => {
  const s = snapshotOf(p);
  if (!s || !Array.isArray(s.images)) return images;
  const ok = new Set(s.images.map(imageToken));
  return images.filter((i) => ok.has(imageToken(i.url)));
};

export const approvedVariants = <V extends { id: string; name: string; price: number }>(p: Moderated, variants: V[]): V[] => {
  const s = snapshotOf(p);
  if (!s || !Array.isArray(s.variants)) return variants;
  const by = new Map(s.variants.map((v) => [v.id, v]));
  return variants.filter((v) => by.has(v.id)).map((v) => (p.moderationStatus === 'pending' ? { ...v, name: by.get(v.id)!.name, price: by.get(v.id)!.price } : v));
};
