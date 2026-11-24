// Houssem live 23–24/11 (UX-077, UX-085) — client list L56 « le client a partagé une image identique à celle d'un produit, l'IA ne l'a
// pas reconnue »: a customer who sends one of the shop's own product pictures (saved from the page, forwarded, re-compressed by
// Messenger) is matched on the picture itself, before any AI call. The signature of a picture: its 24 × 24 grey pixels stretched to
// the picture's own range; two signatures are compared by their mean absolute difference (0–255). Measured on 20 pictures and six
// re-encodings of each (JPEG 40–75, WebP 50, 200–1 600 px): the same picture ≤ 7.1, another picture ≥ 31.9 (bit hashes — difference,
// mean, median — overlapped: 24 against 45, 29 against 60).
import sharp from 'sharp';

const SIDE = 24;
/** Largest distance between two encodings of the same picture. */
export const SAME_IMAGE_MAX = 14;
/** Another product within this much of the best one makes the match ambiguous (the same picture used by two products). */
export const SAME_IMAGE_MARGIN = 6;

/** The signature of a picture (576 bytes), null when the bytes are no picture or the picture is flat (nothing to compare). */
export const imageSignature = async (body: Buffer): Promise<Buffer | null> => {
  try {
    const px = await sharp(body, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' }).greyscale().resize(SIDE, SIDE, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer();
    if (px.length !== SIDE * SIDE) return null;
    let lo = 255;
    let hi = 0;
    for (const v of px) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // a flat picture (a plain colour, an empty frame) says nothing
    if (hi - lo < 24) return null;
    return Buffer.from(px.map((v) => Math.round(((v - lo) / (hi - lo)) * 255)));
  } catch {
    return null;
  }
};

/** Mean absolute difference of two signatures (0 = the same picture, ~30 and more = another picture). */
export const signatureDistance = (a: Buffer, b: Buffer): number => {
  if (a.length !== b.length || !a.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
};
