// Client list L56 (Houssem live 23–24/11, UX-077 / UX-085): the customer sends one of the shop's own product pictures — it is the
// same picture after Messenger re-encoded and resized it, and another picture is never taken for it.
import sharp from 'sharp';
import { imageSignature, SAME_IMAGE_MARGIN, SAME_IMAGE_MAX, signatureDistance } from './image-hash';

/** A picture with large coloured shapes (a « product photo »): `seed` moves and recolours them. */
const picture = async (seed: number, width = 900, height = 700): Promise<Buffer> => {
  const r = (n: number) => Math.abs(Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1;
  const shapes = Array.from({ length: 9 }, (_, i) => {
    const [x, y, w, h] = [r(i) * width * 0.8, r(i + 20) * height * 0.8, 60 + r(i + 40) * width * 0.4, 40 + r(i + 60) * height * 0.4];
    const fill = `rgb(${Math.floor(r(i + 80) * 255)},${Math.floor(r(i + 100) * 255)},${Math.floor(r(i + 120) * 255)})`;
    return i % 2 ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>` : `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="rgb(${Math.floor(r(1) * 255)},${Math.floor(r(2) * 255)},${Math.floor(r(3) * 255)})"/>${shapes.join('')}</svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();
};
const SEEDS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

describe('imageSignature — the shop’s own picture sent back by a customer', () => {
  it('the same picture re-encoded (JPEG 40–75, WebP 50), resized (200–1 600 px) or sent as PNG stays within the limit', async () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const original = await picture(seed);
      const s = (await imageSignature(original))!;
      expect(s).toHaveLength(576);
      const copies = await Promise.all([
        sharp(original).jpeg({ quality: 60 }).toBuffer(),
        sharp(original).resize(480).jpeg({ quality: 75 }).toBuffer(),
        sharp(original).resize(1600).png().toBuffer(),
        sharp(original).resize(320).webp({ quality: 50 }).toBuffer(),
        sharp(original).resize(720).jpeg({ quality: 40 }).toBuffer(),
        sharp(original).resize(200).jpeg({ quality: 50 }).toBuffer(),
      ]);
      for (const c of copies) expect(signatureDistance(s, (await imageSignature(c))!)).toBeLessThanOrEqual(SAME_IMAGE_MAX);
    }
  });

  it('other pictures are far away: never within the limit plus its margin', async () => {
    const all = await Promise.all(SEEDS.map(async (seed) => (await imageSignature(await picture(seed)))!));
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(signatureDistance(all[i]!, all[j]!)).toBeGreaterThan(SAME_IMAGE_MAX + SAME_IMAGE_MARGIN);
  });

  it('bytes that are no picture, and a flat picture, give no signature', async () => {
    expect(await imageSignature(Buffer.from('FAKE-IMAGE:robe rouge'))).toBeNull();
    expect(await imageSignature(await sharp({ create: { width: 300, height: 300, channels: 3, background: '#cc0000' } }).png().toBuffer())).toBeNull();
  });
});
