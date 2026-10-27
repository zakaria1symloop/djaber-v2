// M2 — product images (CAT-02): upload, limits, order, primary, delete, the `media` jobs (re-encode + thumbnail, caption),
// and "Créer depuis une photo" (CAT-07).
import sharp from 'sharp';
import { StorageService } from '../../src/core/storage/storage.service';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import { RedisService } from '../../src/core/redis/redis.provider';
import { IMAGE_CAPTION_PROVIDER, PRODUCT_VISION_PROVIDER, UnavailableProductVisionProvider, type ImageCaptionProvider } from '../../src/modules/catalog/ai.providers';
import { asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct, db, drain, image, upload, wsEvents } from '../support/m2';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => jest.restoreAllMocks());

const jpeg = async (w = 800, h = 800, name = 'photo.jpg') => ({ buffer: await image(w, h), name, type: 'image/jpeg' });
/** Reads a stored object back through its public URL path (`/api/v1/files/<key>`). */
const fetchFile = (url: string) => app.app.get(StorageService).get(url.split('/api/v1/files/')[1]!);

describe('product images', () => {
  it('AT-CAT-04 11th image ⇒ IMAGES_LIMIT; delete primary ⇒ next becomes primary; caption generated', async () => {
    const owner = await asOwner(app);
    const p = await createProduct(owner);
    const captions = app.app.get<ImageCaptionProvider>(IMAGE_CAPTION_PROVIDER);
    const spy =jest.spyOn(captions, 'caption').mockImplementation(async ({ productName }) => `Photo de ${productName}`);

    const first = await upload(owner, app, `/products/${p.id}/images`, 'file', [await jpeg(1200, 900)]).expect(201);
    expect(first.body.data).toMatchObject({ width: 1200, height: 900, isPrimary: true, processed: false, aiCaption: null, altText: null, moderationFlag: null });
    expect(first.body.meta.warnings).toEqual([]);
    for (let i = 1; i < 10; i++) await upload(owner, app, `/products/${p.id}/images`, 'file', [await jpeg(700, 700, `p${i}.jpg`)]).expect(201);
    const eleventh = await upload(owner, app, `/products/${p.id}/images`, 'file', [await jpeg()]).expect(422);
    expect(eleventh.body.error.code).toBe('IMAGES_LIMIT');
    let images = (await owner.get(`/products/${p.id}`).expect(200)).body.data.images;
    expect(images).toHaveLength(10);
    expect(images.map((i: any) => i.isPrimary)).toEqual([true, ...Array(9).fill(false)]);

    // worker: re-encode (normalised webp + 400 px thumbnail), then caption
    const ran = await drain(app, owner.workspaceId);
    expect(ran.filter((n) => n === 'reencode-image')).toHaveLength(10);
    expect(ran.filter((n) => n === 'caption-image')).toHaveLength(10);
    expect(spy).toHaveBeenCalledTimes(10);
    const detail = (await owner.get(`/products/${p.id}`).expect(200)).body.data;
    images = detail.images;
    expect(images[0]).toMatchObject({ processed: true, width: 1200, height: 900, aiCaption: `Photo de ${p.name}`, isPrimary: true });
    expect(images[0].url).toMatch(/\/image\.webp$/);
    expect(images[0].thumbUrl).toMatch(/\/thumb\.webp$/);
    expect(detail.primaryImageUrl).toBe(images[0].thumbUrl);
    const main = await sharp((await fetchFile(images[0].url)).body).metadata();
    const thumb = await sharp((await fetchFile(images[0].thumbUrl)).body).metadata();
    expect([main.format, main.width, main.height]).toEqual(['webp', 1200, 900]);
    expect([thumb.format, thumb.width, thumb.height]).toEqual(['webp', 400, 300]);
    expect((await wsEvents(owner.workspaceId, 'product.updated')).length).toBeGreaterThanOrEqual(20); // "ENVOI…" ends on this event
    // running the jobs again changes nothing (idempotent)
    const registry = app.app.get(ProcessorRegistry);
    await registry.handlers.get('media')!.get('reencode-image')!({ productImageId: images[0].id, workspaceId: owner.workspaceId }, {} as never);
    await registry.handlers.get('media')!.get('caption-image')!({ productImageId: images[0].id, workspaceId: owner.workspaceId }, {} as never);
    expect(spy).toHaveBeenCalledTimes(10);

    // deleting the primary promotes the next one
    await owner.delete(`/products/${p.id}/images/${images[0].id}`).expect(204);
    const after = (await owner.get(`/products/${p.id}`).expect(200)).body.data.images;
    expect(after).toHaveLength(9);
    expect(after[0]).toMatchObject({ id: images[1].id, isPrimary: true });
    expect(after.filter((i: any) => i.isPrimary)).toHaveLength(1);
    await expect(fetchFile(images[0].url)).rejects.toBeDefined(); // files removed with the row
    await upload(owner, app, `/products/${p.id}/images`, 'file', [await jpeg()]).expect(201); // a slot is free again
  });

  it('caption hook: the AI port captions the image (fake adapter in tests); a provider failure is retried by the queue', async () => {
    const owner = await asOwner(app);
    const p = await createProduct(owner);
    const img = (await upload(owner, app, `/products/${p.id}/images`, 'file', [await jpeg()]).expect(201)).body.data;
    expect(await drain(app, owner.workspaceId)).toEqual(expect.arrayContaining(['reencode-image', 'caption-image']));
    expect((await db.productImage.findUniqueOrThrow({ where: { id: img.id } })).aiCaption).toBe(`Photo du produit ${p.name}`);
    const queued = await db.outbox.findMany({ where: { workspaceId: owner.workspaceId, topic: 'job' } });
    expect(queued.map((r) => r.key).sort()).toEqual([`cap:${img.id}`, `img:${img.id}`]); // deterministic job ids (03 §3)
    expect((queued.find((r) => r.key === `img:${img.id}`)!.payload as any).opts).toMatchObject({ attempts: 3 });

    // an image that has its caption is left alone (the job is safe to run twice); without one the provider is called again
    await db.productImage.update({ where: { id: img.id }, data: { aiCaption: null } });
    const captions = app.app.get<ImageCaptionProvider>(IMAGE_CAPTION_PROVIDER);
    jest.spyOn(captions, 'caption').mockRejectedValueOnce(new Error('provider down'));
    const registry = app.app.get(ProcessorRegistry);
    await expect(registry.handlers.get('media')!.get('caption-image')!({ productImageId: img.id, workspaceId: owner.workspaceId }, {} as never)).rejects.toThrow('provider down');
    // another workspace id never reaches the image
    await registry.handlers.get('media')!.get('caption-image')!({ productImageId: img.id, workspaceId: (await asOwner(app)).workspaceId }, {} as never);
    expect((await db.productImage.findUniqueOrThrow({ where: { id: img.id } })).aiCaption).toBeNull();
  });

  it('validation: type, size, small image warning; reorder, primary, alt text; roles and cross-workspace', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const stranger = await asOwner(app);
    const p = await createProduct(owner);
    const url = `/products/${p.id}/images`;

    expect((await upload(owner, app, url, 'file', [{ buffer: Buffer.from('%PDF-1.4'), name: 'doc.pdf', type: 'application/pdf' }]).expect(415)).body.error.code).toBe('IMAGE_TYPE_INVALID');
    expect((await upload(owner, app, url, 'file', [{ buffer: Buffer.from('not an image'), name: 'fake.jpg', type: 'image/jpeg' }]).expect(415)).body.error.code).toBe('IMAGE_TYPE_INVALID');
    const big = Buffer.concat([await image(100, 100), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    expect((await upload(owner, app, url, 'file', [{ buffer: big, name: 'big.jpg', type: 'image/jpeg' }]).expect(413)).body.error.code).toBe('IMAGE_TOO_LARGE');
    expect((await upload(owner, app, url, 'file', []).expect(422)).body.error.fields).toEqual({ file: 'validation.required' });

    const small = await upload(owner, app, url, 'file', [await jpeg(500, 320)]).expect(201);
    expect(small.body.meta.warnings).toEqual([{ code: 'IMAGE_SMALL', params: { px: 320 }, field: 'file' }]);
    const b = (await upload(owner, app, url, 'file', [{ buffer: await image(900, 900, 'png'), name: 'b.png', type: 'image/png' }]).expect(201)).body.data;
    const c = (await upload(owner, app, url, 'file', [{ buffer: await image(900, 900, 'webp'), name: 'c.webp', type: 'image/webp' }]).expect(201)).body.data;
    const a = small.body.data;
    // images are a moderated field (tester log 26/10 UX-039): an upload is a picture the merchant keeps (the product form
    // holds its new pictures until « Enregistrer »), so it goes to moderation with it — here one request per upload, each
    // auto-approved at once (standard shop); « Enregistrer » has nothing left to send
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(4);
    expect((await owner.post(`/products/${p.id}/submit-changes`, {}).expect(200)).body.data).toEqual({ submitted: false, moderationStatus: 'approved' });
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(4);

    const reordered = await owner.patch(`${url}/order`, { ids: [c.id, a.id, b.id] }).expect(200);
    expect(reordered.body.data.map((i: any) => i.id)).toEqual([c.id, a.id, b.id]);
    expect(reordered.body.data.find((i: any) => i.isPrimary).id).toBe(a.id); // the order does not change the primary
    for (const bad of [[c.id, a.id], [c.id, a.id, a.id], [c.id, a.id, b.id, '018f0000-0000-7000-8000-000000000000']]) {
      expect((await owner.patch(`${url}/order`, { ids: bad }).expect(422)).body.error.fields).toHaveProperty('ids');
    }
    const primary = await owner.patch(`${url}/${b.id}`, { isPrimary: true, altText: 'Vue de face' }).expect(200);
    expect(primary.body.data).toMatchObject({ id: b.id, isPrimary: true, altText: 'Vue de face' });
    const list = (await owner.get(`/products/${p.id}`).expect(200)).body.data.images;
    expect(list.filter((i: any) => i.isPrimary).map((i: any) => i.id)).toEqual([b.id]);
    expect((await owner.patch(`${url}/${b.id}`, { altText: '' }).expect(200)).body.data.altText).toBeNull();
    expect((await owner.patch(`${url}/${b.id}`, { isPrimary: false }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    expect((await upload(operator, app, url, 'file', [await jpeg()]).expect(403)).body.error.code).toBe('FORBIDDEN');
    await operator.patch(`${url}/order`, { ids: [a.id, b.id, c.id] }).expect(403);
    await operator.patch(`${url}/${a.id}`, { altText: 'x' }).expect(403);
    await operator.delete(`${url}/${a.id}`).expect(403);
    await upload(stranger, app, url, 'file', [await jpeg()]).expect(404);
    await stranger.patch(`${url}/order`, { ids: [a.id, b.id, c.id] }).expect(404);
    await stranger.patch(`${url}/${a.id}`, { altText: 'x' }).expect(404);
    await stranger.delete(`${url}/${a.id}`).expect(404);
    const mine = await createProduct(stranger);
    await stranger.delete(`/products/${mine.id}/images/${a.id}`).expect(404); // an image id of another product
    // an archived product is read-only
    await owner.delete(`/products/${p.id}`).expect(204);
    await upload(owner, app, url, 'file', [await jpeg()]).expect(404);

    // duplicate with images copies the normalised files
    const q = await createProduct(owner);
    await upload(owner, app, `/products/${q.id}/images`, 'file', [await jpeg()]).expect(201);
    await drain(app, owner.workspaceId);
    const copy = (await owner.post(`/products/${q.id}/duplicate`, { name: 'Copie avec image', copyImages: true }).expect(201)).body.data;
    expect(copy.images).toHaveLength(1);
    expect(copy.images[0]).toMatchObject({ processed: true, isPrimary: true });
    expect(copy.images[0].url).not.toBe((await owner.get(`/products/${q.id}`).expect(200)).body.data.images[0].url);
    expect((await fetchFile(copy.images[0].thumbUrl)).mime).toBe('image/webp');
  });
});

describe('POST /products/ai-fill', () => {
  it('AT-CAT-10 "create from photo" fills only empty name / description / category / unit; never price', async () => {
    const owner = await asOwner(app);
    const category = (await owner.post('/categories', { name: 'Maison' }).expect(201)).body.data;
    const photos = [{ buffer: await image(800, 800), name: 'lampe-de-chevet_bois.jpg', type: 'image/jpeg' }, { buffer: await image(640, 640), name: 'dos.jpg', type: 'image/jpeg' }];

    const empty = await upload(owner, app, '/products/ai-fill', 'photos', photos).expect(200);
    expect(empty.body.data).toMatchObject({ name: 'Lampe de chevet bois', categoryId: category.id, filled: ['name', 'description', 'categoryId', 'unitId'] });
    expect(empty.body.data.description).toContain('2 photo(s)');
    expect(empty.body.data.unitId).toEqual(expect.any(String));
    expect(empty.body.data.attributes).toEqual({ photos: '2' });
    expect(Object.keys(empty.body.data).some((k) => /price|cost/i.test(k))).toBe(false);
    // deterministic fake provider: same photos ⇒ same answer
    expect((await upload(owner, app, '/products/ai-fill', 'photos', photos).expect(200)).body.data).toEqual(empty.body.data);

    // fields the form already has are left alone
    const partial = await upload(owner, app, '/products/ai-fill', 'photos', photos, { name: 'Mon titre', categoryId: category.id, description: '  ' }).expect(200);
    expect(partial.body.data).toMatchObject({ name: null, categoryId: null, filled: ['description', 'unitId'] });
    expect(partial.body.data.description).toEqual(expect.any(String));

    // 3 analyses / day / workspace (07-non-functional §3 `analysis`)
    expect((await upload(owner, app, '/products/ai-fill', 'photos', photos).expect(429)).body.error.code).toBe('ANALYSIS_RATE_LIMITED');
  });

  it('1–5 photos, image types only, Admin+; a provider outage answers IMAGE_ANALYSIS_UNAVAILABLE without using the allowance', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const one = { buffer: await image(700, 700), name: 'a.jpg', type: 'image/jpeg' };
    expect((await upload(owner, app, '/products/ai-fill', 'photos', []).expect(422)).body.error.fields).toEqual({ photos: 'validation.required' });
    expect((await upload(owner, app, '/products/ai-fill', 'photos', Array(6).fill(one)).expect(422)).body.error.fields).toEqual({ photos: 'validation.length' });
    expect((await upload(owner, app, '/products/ai-fill', 'photos', [{ buffer: Buffer.from('x'), name: 'a.txt', type: 'text/plain' }]).expect(415)).body.error.code).toBe('IMAGE_TYPE_INVALID');
    expect((await upload(operator, app, '/products/ai-fill', 'photos', [one]).expect(403)).body.error.code).toBe('FORBIDDEN');

    const vision = app.app.get(PRODUCT_VISION_PROVIDER);
    jest.spyOn(vision, 'describe').mockImplementationOnce(() => new UnavailableProductVisionProvider().describe());
    expect((await upload(owner, app, '/products/ai-fill', 'photos', [one]).expect(503)).body.error.code).toBe('IMAGE_ANALYSIS_UNAVAILABLE');
    const keys = await app.app.get(RedisService).client.keys(`rl:analysis:${owner.workspaceId}:*`);
    expect(Number(await app.app.get(RedisService).client.get(keys[0]!))).toBe(0);
    // no category in the workspace: the suggestion has none
    expect((await upload(owner, app, '/products/ai-fill', 'photos', [one]).expect(200)).body.data).toMatchObject({ name: 'A', categoryId: null });
  });
});
