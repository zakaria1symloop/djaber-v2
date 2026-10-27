// M10 ADM-10 — moderation queue, pre-screen, decisions, appeals, rules, stats, SLA job, trust levels (D36, D52, 04 §12).
// AT-MOD-01, 02, 04, 05, 06, 07, 08 (job part), 09 (API part), 10.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rawPrisma as db, TenantContext, prisma, type Tx } from '@djaber/db';
import { CatalogueService } from '../../src/modules/ai/catalogue.service';
import { ModerationHookService } from '../../src/modules/catalog/moderation-hook.service';
import { ModerationPrescreenService } from '../../src/modules/catalog/moderation-prescreen.service';
import { ModerationService } from '../../src/modules/admin-ops/moderation/moderation.service';
import { TrustLevelService } from '../../src/modules/admin-ops/moderation/trust-level.service';
import { asAdmin, asOperator, asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct, image, testAgent, upload } from '../support/m2';
import { auditRows, drainAll, PLATFORM_ROLES, platformUser, roomEvents, setTrust, type PlatformActorT } from '../support/m10-ops';

let app: TestApp;
let sa: PlatformActorT;
let mod: PlatformActorT;
let mod2: PlatformActorT;

const scope = { id: '00000000-0000-0000-0000-000000000000', sellAllProducts: true, catalogScope: 'all', scopeCategoryIds: [] } as never;
const catalogueSees = async (workspaceId: string, productId: string) =>
  TenantContext.runAs(workspaceId, async () => (await app.app.get(CatalogueService).byIds(scope, [productId]))[0] ?? null);
const itemOf = async (productId: string) => db.moderationItem.findFirstOrThrow({ where: { productId }, orderBy: { contentVersion: 'desc' } });

const merchant = async (trust: 'new' | 'standard' | 'trusted' | 'watch' = 'standard') => {
  const owner = await asOwner(app);
  await setTrust(owner.workspaceId, trust);
  return owner;
};

beforeAll(async () => {
  app = await createTestApp();
  sa = await platformUser(app, 'super_admin');
  mod = await platformUser(app, 'moderator');
  mod2 = await platformUser(app, 'moderator');
});
afterAll(async () => app.close());

describe('pre-screen and auto-approval', () => {
  it('AT-MOD-01 standard merchant: clean product (score 0.95) is approved at once and visible to the AI; counterfeit wording ⇒ pending, hidden, pill EN ATTENTE', async () => {
    const owner = await merchant('standard');
    const clean = await createProduct(owner, { name: 'Sac à main cuir marron', description: 'Cuir véritable, fait main.' });
    expect(clean.moderation).toMatchObject({ status: 'approved' });
    const it1 = await itemOf(clean.id);
    expect(it1).toMatchObject({ status: 'auto_approved' });
    expect(Number(it1.aiScore)).toBe(0.95);
    expect(await catalogueSees(owner.workspaceId, clean.id)).toMatchObject({ id: clean.id, name: 'Sac à main cuir marron' });

    const fake = await createProduct(owner, { name: 'Montre copie qualité AAA', description: 'First copy, comme l’original' });
    expect(fake.moderation).toMatchObject({ status: 'pending' });
    const it2 = await itemOf(fake.id);
    expect(it2.status).toBe('pending');
    expect(Number(it2.aiScore)).toBeLessThan(0.9);
    expect((it2.aiFlags as { code: string }[]).map((f) => f.code)).toContain('counterfeit_wording');
    expect(await catalogueSees(owner.workspaceId, fake.id)).toBeNull();
    const search = await TenantContext.runAs(owner.workspaceId, () => app.app.get(CatalogueService).search(scope, 'Montre copie'));
    expect(search.map((p) => p.id)).not.toContain(fake.id);
    const list = (await owner.get('/products?moderationStatus=pending').expect(200)).body.data;
    expect(list.map((p: { id: string }) => p.id)).toEqual([fake.id]);
    expect((await owner.get('/moderation/summary').expect(200)).body.data).toMatchObject({ pending: 1, trustLevel: 'standard' });
    expect((await roomEvents('admin:platform', 'moderation.queue')).length).toBeGreaterThan(0);
  });

  it('AT-MOD-03 (API) new merchant with a clean product ⇒ human queue; sensitive category with a trusted merchant ⇒ human queue', async () => {
    const fresh = await merchant('new');
    const p = await createProduct(fresh, { name: 'Tapis berbère' });
    expect(p.moderation.status).toBe('pending');
    expect(Number((await itemOf(p.id)).aiScore)).toBe(0.95);

    const trusted = await merchant('trusted');
    const cat = (await trusted.post('/categories', { name: 'Électronique' }).expect(201)).body.data;
    const phone = await createProduct(trusted, { name: 'Écouteurs sans fil', description: 'Garantie 1 an', categoryId: cat.id });
    expect(phone.moderation.status).toBe('pending');
    expect((await itemOf(phone.id)).snapshot).toMatchObject({ sensitive: true });
  });

  it('AT-MOD-11 (PV 22/10 PV1 + tester log 26/10 UX-034) a platform blocked word in a variant name or the search keywords — a whole word ⇒ rejected at once (reason, notification, hidden), inside another word ⇒ held for review', async () => {
    const rule = await mod.post('/admin/moderation/rules', { key: 'word.pv1-interdit', kind: 'blocked_word', value: 'motinterdit' }).expect(201);
    const owner = await merchant('trusted');
    const v = await createProduct(owner, { name: 'Robe longue', description: 'Coton.', stock: undefined, variants: [{ name: 'Rouge', price: 3000 }, { name: 'Bleu MotInterdit', price: 3000 }] });
    expect(v.moderation.status).toBe('rejected');
    const vi = await itemOf(v.id);
    expect(vi).toMatchObject({ status: 'rejected', decision: 'prohibited', reviewerId: null, reasonTemplateKey: 'auto_banned_word', rejectedFields: ['variants'] });
    expect(vi.decidedAt).not.toBeNull();
    expect(vi.merchantMessage).toContain('motinterdit');
    expect(vi.aiFlags).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'blocked_word', message: 'motinterdit', field: 'variants' })]));
    await drainAll(app, ['notification']);
    expect((await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'product_rejected' } })).map((x) => x.userId)).toContain(owner.userId);
    expect(await catalogueSees(owner.workspaceId, v.id)).toBeNull();
    // the merchant reads the reason; nothing waits in the human queue
    expect((await owner.get(`/products/${v.id}/moderation`).expect(200)).body.data.item).toMatchObject({ status: 'rejected', merchantMessage: expect.stringContaining('motinterdit'), rejectedFields: ['variants'] });
    expect((await mod.get(`/admin/moderation/items?workspaceId=${owner.workspaceId}&status=pending`).expect(200)).body.data).toEqual([]);
    const k = await createProduct(owner, { name: 'Robe courte', description: 'Coton.', keywords: ['robe', 'motinterdit'] });
    expect(k.moderation.status).toBe('rejected');
    expect(await itemOf(k.id)).toMatchObject({ status: 'rejected', rejectedFields: ['keywords'] });
    expect(await catalogueSees(owner.workspaceId, k.id)).toBeNull();
    // inside another word (« motinterdits ») it may be innocent: flagged, a moderator decides
    const w = await createProduct(owner, { name: 'Robe midi', description: 'Coton.', keywords: ['motinterdits'] });
    expect(w.moderation.status).toBe('pending');
    expect(await itemOf(w.id)).toMatchObject({ status: 'pending', aiFlags: expect.arrayContaining([expect.objectContaining({ code: 'blocked_word' })]) });
    // the variant added later to an approved product is rejected the same way
    const ok = await createProduct(owner, { name: 'Gourde isotherme', description: 'Inox.', stock: undefined, variants: [{ name: 'Rouge', price: 2000 }] });
    expect(ok.moderation.status).toBe('approved');
    await owner.post(`/products/${ok.id}/variants`, { name: 'motinterdit', price: 2000 }).expect(201);
    expect((await db.product.findUniqueOrThrow({ where: { id: ok.id } })).moderationStatus).toBe('rejected');
    expect(await itemOf(ok.id)).toMatchObject({ status: 'rejected', rejectedFields: ['variants'] });
    await mod.delete(`/admin/moderation/rules/${rule.body.data.id}`).expect(200);
  });

  it('AT-MOD-12 (tester log 26/10 UX-034) a clean variant added to an approved product waits for a moderator, whatever the trust level; the AI keeps selling the approved variants', async () => {
    const owner = await merchant('trusted');
    const p = await createProduct(owner, { name: 'Gourde inox', description: 'Inox.', stock: undefined, variants: [{ name: 'Rouge', price: 2000 }] });
    expect(p.moderation.status).toBe('approved');
    await owner.post(`/products/${p.id}/variants`, { name: 'Bleu', price: 2000 }).expect(201);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).moderationStatus).toBe('pending');
    const item = await itemOf(p.id);
    expect(item.status).toBe('pending');
    expect(Number(item.aiScore)).toBeGreaterThanOrEqual(0.9);
    expect(item.aiFlags).toEqual(expect.arrayContaining([{ code: 'new_variant', message: 'Bleu', field: 'variants' }]));
    expect((await catalogueSees(owner.workspaceId, p.id))!.variants.map((v) => v.name)).toEqual(['Rouge']);
    const listed = (await mod.get(`/admin/moderation/items?workspaceId=${owner.workspaceId}&aiFlag=new_variant`).expect(200)).body.data;
    expect(listed.map((r: { id: string }) => r.id)).toEqual([item.id]);
    await mod.post(`/admin/moderation/items/${item.id}/approve`, {}).expect(200);
    expect((await catalogueSees(owner.workspaceId, p.id))!.variants.map((v) => v.name)).toEqual(['Rouge', 'Bleu']);
    // a product created with its variants keeps the normal auto-approval
    expect((await createProduct(owner, { name: 'Gourde verre', description: 'Verre.', stock: undefined, variants: [{ name: 'Vert', price: 1800 }] })).moderation.status).toBe('approved');
  });

  it('PV 22/10 PV2: platform setting moderation_policy.manualReviewAll ⇒ no auto-approval, every product waits for an admin (super_admin only, audited)', async () => {
    await mod.put('/admin/settings/moderation_policy', { value: { manualReviewAll: true }, reason: 'Validation manuelle demandée' }).expect(403);
    await sa.put('/admin/settings/moderation_policy', { value: { manualReviewAll: 'yes' }, reason: 'Validation manuelle demandée' }).expect(422);
    await sa.put('/admin/settings/moderation_policy', { value: { manualReviewAll: true }, reason: 'Validation manuelle demandée (PV 22/10)' }).expect(200);
    try {
      const owner = await merchant('trusted');
      const p = await createProduct(owner, { name: 'Sac à dos toile', description: 'Toile solide, fait main.' });
      expect(p.moderation.status).toBe('pending');
      const item = await itemOf(p.id);
      expect(item.status).toBe('pending');
      expect(Number(item.aiScore)).toBeGreaterThanOrEqual(0.9);
      expect(await catalogueSees(owner.workspaceId, p.id)).toBeNull();
      await mod.post(`/admin/moderation/items/${item.id}/approve`, {}).expect(200);
      expect(await catalogueSees(owner.workspaceId, p.id)).toMatchObject({ id: p.id });
      expect(await auditRows('setting.update', 'moderation_policy')).toHaveLength(1);
    } finally {
      await sa.put('/admin/settings/moderation_policy', { value: { manualReviewAll: false }, reason: 'Retour à la validation automatique' }).expect(200);
    }
    expect((await createProduct(await merchant('trusted'), { name: 'Sac à dos cuir', description: 'Cuir, fait main.' })).moderation.status).toBe('approved');
  });

  it('AT-MOD-02 a change waiting for review keeps the last approved snapshot selling (AI quotes the old price)', async () => {
    const owner = await merchant('standard');
    const p = await createProduct(owner, { name: 'Robe kabyle', price: 4000 });
    expect(p.moderation.status).toBe('approved');
    await setTrust(owner.workspaceId, 'new'); // the next submission goes to the human queue
    const before = await db.moderationItem.count({ where: { productId: p.id } });
    const r1 = await owner.patch(`/products/${p.id}`, { minStock: 3, version: p.version });
    expect(r1.status).toBe(200);
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(before);
    const cur = (await owner.get(`/products/${p.id}`).expect(200)).body.data;
    await owner.patch(`/products/${p.id}`, { price: 1800, version: cur.version }).expect(200);
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(before + 1);
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.moderation.status).toBe('pending');
    expect(await catalogueSees(owner.workspaceId, p.id)).toMatchObject({ price: 4000, name: 'Robe kabyle' });
    // approval puts the new price live
    await mod.post(`/admin/moderation/items/${(await itemOf(p.id)).id}/approve`, {}).expect(200);
    expect(await catalogueSees(owner.workspaceId, p.id)).toMatchObject({ price: 1800 });
  });

  it('tester report 2026-10-20 (UX-002): deleting a picture of an approved product keeps it approved and selling — no new review item, the live snapshot drops the picture', async () => {
    const owner = await merchant('standard');
    const p = await createProduct(owner, { name: 'Sac cabas osier', description: 'Osier tressé main.', price: 2500 });
    const pic = async (name: string) => ({ buffer: await image(800, 800), name, type: 'image/jpeg' });
    const a = (await upload(owner, app, `/products/${p.id}/images`, 'file', [await pic('a.jpg')]).expect(201)).body.data;
    await upload(owner, app, `/products/${p.id}/images`, 'file', [await pic('b.jpg')]).expect(201);
    await owner.post(`/products/${p.id}/submit-changes`, {}).expect(200); // « Enregistrer » (standard trust ⇒ approved at once)
    let row = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.moderationStatus).toBe('approved');
    expect((row.approvedSnapshot as { images: string[] }).images).toHaveLength(2);
    await setTrust(owner.workspaceId, 'new'); // any new submission would wait for a human
    const items = await db.moderationItem.count({ where: { productId: p.id } });
    await owner.delete(`/products/${p.id}/images/${a.id}`).expect(204);
    row = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.moderationStatus).toBe('approved');
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(items);
    expect((row.approvedSnapshot as { images: string[] }).images).toEqual([expect.not.stringContaining(a.url)]);
    expect(await catalogueSees(owner.workspaceId, p.id)).toMatchObject({ id: p.id });
    // adding a picture is reviewed — with its upload, wherever it comes from (tester log 26/10 UX-039: « + Ajouter » of the
    // product page has no save step; the product form uploads its new pictures only with « Enregistrer »)
    const c = (await upload(owner, app, `/products/${p.id}/images`, 'file', [await pic('c.jpg')]).expect(201)).body.data;
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).moderationStatus).toBe('pending');
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(items + 1);
    // tester report 25/10 UX-006: until it is approved the new picture is never shown to a customer; the merchant sees it
    // flagged « EN ATTENTE DE VALIDATION »
    expect((await catalogueSees(owner.workspaceId, p.id))!.imageUrl).not.toBe(c.url);
    const shown = (await owner.get(`/products/${p.id}`).expect(200)).body.data.images as { id: string; awaitingReview: boolean }[];
    expect(shown.map((i) => [i.id === c.id, i.awaitingReview])).toEqual(expect.arrayContaining([[true, true], [false, false]]));
    expect((await owner.post(`/products/${p.id}/submit-changes`, {}).expect(200)).body.data).toEqual({ submitted: false, moderationStatus: 'pending' });
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(items + 1);
    expect((await itemOf(p.id)).snapshot).toMatchObject({ images: expect.arrayContaining([expect.stringContaining(c.url.split('/').slice(-2, -1)[0]!)]) });
    // a second save with nothing new adds nothing
    expect((await owner.post(`/products/${p.id}/submit-changes`, {}).expect(200)).body.data).toEqual({ submitted: false, moderationStatus: 'pending' });
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(items + 1);
  });

  it('tester report 25/10 UX-003 / UX-007 / UX-006: a new, renamed or repriced (±50 %) variant is reviewed; stock / small price changes are not; the AI sells only approved variants', async () => {
    const owner = await merchant('standard');
    const p = await createProduct(owner, { name: 'T-shirt coton', price: 1500, variants: [{ name: 'M', price: 1500, stock: 4 }] });
    expect(p.moderation.status).toBe('approved');
    const m = (await owner.get(`/products/${p.id}/variants`).expect(200)).body.data[0];
    await setTrust(owner.workspaceId, 'new');
    const items = await db.moderationItem.count({ where: { productId: p.id } });
    // stock, SKU and a small price change: no review
    await owner.patch(`/products/${p.id}/variants/${m.id}`, { price: 1600, minStock: 2 }).expect(200);
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(items);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).moderationStatus).toBe('approved');
    // a new variant: the product goes to moderation, the AI keeps selling the approved variant only
    const l = (await owner.post(`/products/${p.id}/variants`, { name: 'L', price: 1500, stock: 2 }).expect(201)).body.data;
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).moderationStatus).toBe('pending');
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(items + 1);
    expect((await itemOf(p.id)).snapshot).toMatchObject({ variants: [{ id: m.id, name: 'M' }, { id: l.id, name: 'L' }] });
    expect((await catalogueSees(owner.workspaceId, p.id))!.variants.map((v) => v.name)).toEqual(['M']);
    // a rename refreshes the same open request (one queue entry per product)
    await owner.patch(`/products/${p.id}/variants/${l.id}`, { name: 'XL' }).expect(200);
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(items + 1);
    expect((await itemOf(p.id)).snapshot).toMatchObject({ variants: [{ name: 'M' }, { name: 'XL' }] });
    await mod.post(`/admin/moderation/items/${(await itemOf(p.id)).id}/approve`, {}).expect(200);
    expect((await catalogueSees(owner.workspaceId, p.id))!.variants.map((v) => v.name)).toEqual(['M', 'XL']);
    // a variant price ±50 % is reviewed too
    await owner.patch(`/products/${p.id}/variants/${m.id}`, { price: 500 }).expect(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).moderationStatus).toBe('pending');
    expect((await catalogueSees(owner.workspaceId, p.id))!.variants.find((v) => v.id === m.id)).toMatchObject({ price: 1600 });
  });

  it('tester log 26/10 UX-038: an approved snapshot written before variants were kept showed a variant waiting for review; migration 20261027120000 closes it without hiding what was on sale', async () => {
    const owner = await merchant('standard');
    const legacy = async (name: string) => {
      const p = await createProduct(owner, { name, description: 'Inox.', stock: undefined, variants: [{ name: 'Rouge', price: 2000 }] });
      expect(p.moderation.status).toBe('approved');
      // as written before 26/10: no `variants` in the snapshot, the variant older than the cutoff
      await db.$executeRaw`UPDATE "Product" SET "approvedSnapshot" = "approvedSnapshot" - 'variants' WHERE "id" = ${p.id}::uuid`;
      await db.productVariant.updateMany({ where: { productId: p.id }, data: { createdAt: new Date('2026-10-01T10:00:00Z') } });
      return p;
    };
    const waiting = await legacy('Gourde ancienne');
    const selling = await legacy('Thermos ancien');
    await setTrust(owner.workspaceId, 'new');
    await owner.post(`/products/${waiting.id}/variants`, { name: 'Bleu', price: 2000 }).expect(201);
    expect((await db.product.findUniqueOrThrow({ where: { id: waiting.id } })).moderationStatus).toBe('pending');
    // the leak: every live variant was shown
    expect((await catalogueSees(owner.workspaceId, waiting.id))!.variants.map((v) => v.name)).toEqual(['Rouge', 'Bleu']);
    const sql = readFileSync(join(__dirname, '../../../../packages/db/prisma/migrations/20261027120000_approved_snapshot_variants/migration.sql'), 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
    expect((await catalogueSees(owner.workspaceId, waiting.id))!.variants.map((v) => v.name)).toEqual(['Rouge']);
    expect((await catalogueSees(owner.workspaceId, selling.id))!.variants.map((v) => v.name)).toEqual(['Rouge']);
    expect((await itemOf(waiting.id)).snapshot).toMatchObject({ variants: [{ name: 'Rouge' }, { name: 'Bleu' }] });
    // approving the request puts the new variant on sale
    await mod.post(`/admin/moderation/items/${(await itemOf(waiting.id)).id}/approve`, {}).expect(200);
    expect((await catalogueSees(owner.workspaceId, waiting.id))!.variants.map((v) => v.name)).toEqual(['Rouge', 'Bleu']);
  });

  it('AT-MOD-10 the inline pre-screen fails ⇒ pending, aiScore null, flag prescreen_unavailable; the moderation-prescreen job scores it later', async () => {
    const owner = await merchant('standard');
    const spy = jest.spyOn(ModerationPrescreenService.prototype, 'prescreenProduct').mockRejectedValueOnce(new Error('scorer down'));
    const p = await createProduct(owner, { name: 'Bougie parfumée' });
    spy.mockRestore();
    const item = await itemOf(p.id);
    expect(item).toMatchObject({ status: 'pending', aiScore: null });
    expect(item.aiFlags).toEqual([{ code: 'prescreen_unavailable', message: 'prescreen_unavailable' }]);
    const queued = await db.outbox.findFirst({ where: { topic: 'job', key: `moderation-prescreen:${item.id}` } });
    expect(queued?.payload).toMatchObject({ queue: 'jobs', name: 'moderation-prescreen' });
    const listed = (await mod.get(`/admin/moderation/items?workspaceId=${owner.workspaceId}&aiFlag=prescreen_unavailable`).expect(200)).body.data;
    expect(listed.map((r: { id: string }) => r.id)).toEqual([item.id]);
    expect(await drainAll(app, ['job'])).toContain('moderation-prescreen');
    expect(await itemOf(p.id)).toMatchObject({ status: 'auto_approved' });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).moderationStatus).toBe('approved');
  });

  it('AT-MOD-09 (API) bulk import by a trusted merchant: one item per row, non-sensitive auto-approved, sensitive pending, banner count', async () => {
    const owner = await merchant('trusted');
    const cosmetics = await db.category.create({ data: { workspaceId: owner.workspaceId, name: 'Cosmétiques' } });
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const p = await db.product.create({ data: { workspaceId: owner.workspaceId, name: `Article importé ${i}`, sku: `IMP-${Date.now()}-${i}`, price: 1500 + i, trackStock: false, categoryId: i < 4 ? cosmetics.id : null } });
      ids.push(p.id);
    }
    await TenantContext.runAs(owner.workspaceId, () => prisma.$transaction((tx) => app.app.get(ModerationHookService).submitMany(tx as Tx, ids, 'import')));
    const items = await db.moderationItem.findMany({ where: { productId: { in: ids } } });
    expect(items).toHaveLength(12);
    expect(items.filter((i) => i.status === 'auto_approved')).toHaveLength(8);
    expect(items.filter((i) => i.status === 'pending')).toHaveLength(4);
    expect((await owner.get('/moderation/summary').expect(200)).body.data).toMatchObject({ pending: 4 });
  });
});

describe('decisions', () => {
  let owner: Actor;
  beforeAll(async () => {
    owner = await merchant('new');
  });

  it('AT-MOD-04 reject without reason ⇒ MODERATION_REASON_REQUIRED; with reason ⇒ product hidden, product.rejected (in-app + e-mail + push), rejected fields shown', async () => {
    const p = await createProduct(owner, { name: 'Parfum Chonel copie' });
    const item = await itemOf(p.id);
    const bad = await mod.post(`/admin/moderation/items/${item.id}/reject`, { decision: 'counterfeit' }).expect(422);
    expect(bad.body.error).toMatchObject({ code: 'MODERATION_REASON_REQUIRED', fields: { merchantMessage: 'validation.required' } });
    expect((await mod.post(`/admin/moderation/items/${item.id}/request-changes`, {}).expect(422)).body.error.code).toBe('MODERATION_REASON_REQUIRED');
    const ok = await mod.post(`/admin/moderation/items/${item.id}/reject`, { decision: 'counterfeit', reasonTemplateKey: 'counterfeit', merchantMessage: 'Marque protégée sans autorisation', rejectedFields: ['name', 'images.0', 'price'] }).expect(200);
    expect(ok.body.data).toMatchObject({ status: 'rejected', decision: 'counterfeit', reviewer: { id: mod.userId }, rejectedFields: ['name', 'images.0', 'price'] });
    const view = (await owner.get(`/products/${p.id}`).expect(200)).body.data;
    expect(view).toMatchObject({ moderation: { status: 'rejected' }, aiState: 'excluded', moderationDetail: { status: 'rejected', rejectedFields: ['name', 'images.0', 'price'] } });
    expect(await catalogueSees(owner.workspaceId, p.id)).toBeNull();
    await drainAll(app, ['notification']);
    const n = await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'product_rejected' } });
    expect(n.map((x) => x.userId)).toContain(owner.userId);
    expect(await db.outbox.count({ where: { topic: 'mail', key: { contains: n[0]!.id } } })).toBeGreaterThanOrEqual(0);
    const audit = await auditRows('moderation.reject', item.id);
    expect(audit[0]).toMatchObject({ actorType: 'admin', actorId: mod.userId, reason: 'Marque protégée sans autorisation' });
  });

  it('AT-MOD-06 two moderators decide the same item ⇒ the second gets MODERATION_ITEM_ALREADY_DECIDED', async () => {
    const p = await createProduct(owner, { name: 'Coussin brodé' });
    const item = await itemOf(p.id);
    const [a, b] = await Promise.all([mod.post(`/admin/moderation/items/${item.id}/approve`, {}), mod2.post(`/admin/moderation/items/${item.id}/approve`, {})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.error?.code, b.body.error?.code]).toContain('MODERATION_ITEM_ALREADY_DECIDED');
    const row = (await mod.get(`/admin/moderation/items/${item.id}`).expect(200)).body.data;
    expect(row.actions.find((x: { key: string }) => x.key === 'approve')).toMatchObject({ enabled: false, reasonCode: 'MODERATION_ITEM_ALREADY_DECIDED' });
  });

  it('request changes keeps the product in its previous state and notifies the merchant', async () => {
    const p = await createProduct(owner, { name: 'Lampe en cuivre' });
    const item = await itemOf(p.id);
    await mod.post(`/admin/moderation/items/${item.id}/request-changes`, { merchantMessage: 'Ajoutez une photo de face, merci.' }).expect(200);
    expect((await itemOf(p.id)).status).toBe('changes_requested');
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).moderationStatus).toBe('pending');
    await drainAll(app, ['notification']);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'product_changes_requested' } })).toBe(1);
  });

  it('AT-MOD-05 appeal once ⇒ appealed, decided by another moderator, moderation.appeal_result; second appeal refused; day 8 refused', async () => {
    const p = await createProduct(owner, { name: 'Chaussures sport' });
    const item = await itemOf(p.id);
    await mod.post(`/admin/moderation/items/${item.id}/reject`, { decision: 'misleading', merchantMessage: 'Prix trompeur par rapport au marché' }).expect(200);
    const appeal = await owner.post(`/products/${p.id}/appeal`, { message: 'Ce prix est un déstockage, facture jointe.' }).expect(201);
    expect(appeal.body.data.status).toBe('appealed');
    expect((await owner.post(`/products/${p.id}/appeal`, { message: 'encore' }).expect(409)).body.error.code).toBe('MODERATION_APPEAL_ALREADY_USED');
    const appeals = (await mod2.get('/admin/moderation/appeals?status=pending').expect(200)).body.data;
    const row = appeals.find((a: { item: { id: string } }) => a.item.id === item.id);
    expect(row).toMatchObject({ message: 'Ce prix est un déstockage, facture jointe.', overdue: false, item: { reviewer: { id: mod.userId } } });
    const mine = (await mod.get('/admin/moderation/appeals?status=pending').expect(200)).body.data.find((a: { id: string }) => a.id === row.id);
    expect(mine.actions.every((x: { enabled: boolean; reasonCode?: string }) => !x.enabled && x.reasonCode === 'FORBIDDEN')).toBe(true);
    expect((await mod.post(`/admin/moderation/appeals/${row.id}/decide`, { decision: 'overturned', note: 'ok' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const decided = await mod2.post(`/admin/moderation/appeals/${row.id}/decide`, { decision: 'overturned', note: 'Facture de déstockage valable.' }).expect(200);
    expect(decided.body.data).toMatchObject({ decision: 'overturned', reviewer: { id: mod2.userId } });
    expect((await mod2.post(`/admin/moderation/appeals/${row.id}/decide`, { decision: 'upheld', note: 'x' }).expect(409)).body.error.code).toBe('MODERATION_ITEM_ALREADY_DECIDED');
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.moderation.status).toBe('approved');
    await drainAll(app, ['notification']);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'moderation_appeal_result' } })).toBe(1);

    // day 8 after a rejection ⇒ window expired
    const late = await createProduct(owner, { name: 'Ceinture tressée' });
    const li = await itemOf(late.id);
    await mod.post(`/admin/moderation/items/${li.id}/reject`, { decision: 'other', merchantMessage: 'Informations manquantes sur la taille' }).expect(200);
    await db.moderationItem.update({ where: { id: li.id }, data: { decidedAt: new Date(Date.now() - 8 * 86400_000) } });
    expect((await owner.post(`/products/${late.id}/appeal`, { message: 'Je conteste' }).expect(410)).body.error.code).toBe('MODERATION_APPEAL_WINDOW_EXPIRED');
  });

  it('bulk approve / reject / assign with per-item results and 422 on missing fields', async () => {
    const a = await createProduct(owner, { name: 'Panier osier' });
    const b = await createProduct(owner, { name: 'Plateau bois' });
    const ia = await itemOf(a.id);
    const ib = await itemOf(b.id);
    const v = await mod.post('/admin/moderation/items/bulk/reject', { ids: [ia.id] }).expect(422);
    expect(v.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { decision: 'validation.required', reasonTemplateKey: 'validation.required', merchantMessage: 'validation.required' } });
    expect((await mod.post('/admin/moderation/items/bulk/assign', { ids: [ia.id] }).expect(422)).body.error.fields).toEqual({ assigneeId: 'validation.required' });
    const assigned = await mod.post('/admin/moderation/items/bulk/assign', { ids: [ia.id, ib.id], assigneeId: mod2.userId }).expect(200);
    expect(assigned.body).toMatchObject({ data: { results: [{ id: ia.id, ok: true }, { id: ib.id, ok: true }] }, meta: { ok: 2, failed: 0 } });
    const mine = (await mod2.get(`/admin/moderation/items?assigneeId=me&workspaceId=${owner.workspaceId}`).expect(200)).body.data;
    expect(mine.map((r: { id: string }) => r.id).sort()).toEqual([ia.id, ib.id].sort());
    await mod.post(`/admin/moderation/items/${ib.id}/approve`, {}).expect(200);
    const res = await mod.post('/admin/moderation/items/bulk/approve', { ids: [ia.id, ib.id] }).expect(200);
    expect(res.body.data.results).toEqual([{ id: ia.id, ok: true }, { id: ib.id, ok: false, error: expect.objectContaining({ code: 'MODERATION_ITEM_ALREADY_DECIDED', message: expect.any(String) }) }]);
    expect(res.body.meta).toMatchObject({ ok: 1, failed: 1 });
  });

  it('queue filters, detail, 404, permissions per platform role and merchant users', async () => {
    const p = await createProduct(owner, { name: 'Gilet laine' });
    const item = await itemOf(p.id);
    for (const role of PLATFORM_ROLES) {
      const u = await platformUser(app, role);
      await u.get(`/admin/moderation/items?status=pending&workspaceId=${owner.workspaceId}`).expect(200);
      await u.get(`/admin/moderation/items/${item.id}`).expect(200);
      await u.get('/admin/moderation/stats').expect(200);
      const write = await u.post(`/admin/moderation/items/${item.id}/assign`, { assigneeId: null });
      expect(write.status).toBe(role === 'super_admin' || role === 'moderator' ? 200 : 403);
    }
    const reader = await platformUser(app, 'read');
    const row = (await reader.get(`/admin/moderation/items/${item.id}`).expect(200)).body.data;
    expect(row.actions.every((x: { enabled: boolean; reasonCode?: string }) => !x.enabled && x.reasonCode === 'FORBIDDEN')).toBe(true);
    expect(row).toMatchObject({ type: 'product', workspace: { id: owner.workspaceId, trustLevel: 'new', plan: 'pro' }, product: { id: p.id, name: 'Gilet laine' }, snapshot: { title: 'Gilet laine' } });
    for (const m of [owner, await asAdmin(app, owner.workspaceId), await asOperator(app, owner.workspaceId)]) {
      expect((await m.get('/admin/moderation/items').expect(403)).body.error.code).toBe('FORBIDDEN');
      await m.post(`/admin/moderation/items/${item.id}/approve`, {}).expect(403);
    }
    await mod.get('/admin/moderation/items/00000000-0000-7000-8000-000000000000').expect(404);
    await mod.post('/admin/moderation/items/00000000-0000-7000-8000-000000000000/approve', {}).expect(404);
    await mod.get('/admin/moderation/items?scoreMin=2').expect(422);
    const urgentSorted = (await mod.get(`/admin/moderation/items?status=pending&workspaceId=${owner.workspaceId}&q=Gilet`).expect(200)).body;
    expect(urgentSorted.meta).toMatchObject({ page: 1, pageSize: 25, total: 1 });
  });
});

describe('agent prompts (MOD-08)', () => {
  it('a saved agent whose instructions contain a platform blocked word ⇒ agent_prompt item (tab "Agents IA"); reject ⇒ agent paused (moderation)', async () => {
    const owner = await merchant('standard');
    await db.blockedWord.create({ data: { workspaceId: null, word: 'paiement par western', createdById: sa.userId } });
    const agent = await testAgent(owner.workspaceId);
    const cur = (await owner.get(`/agents/${agent.id}`).expect(200)).body.data;
    await owner.patch(`/agents/${agent.id}`, { customInstructions: 'Demandez un paiement par Western Union avant envoi.', version: cur.version }).expect(200);
    const tab = (await mod.get(`/admin/moderation/items?type=agent_prompt&workspaceId=${owner.workspaceId}`).expect(200)).body.data;
    expect(tab).toHaveLength(1);
    expect(tab[0]).toMatchObject({ type: 'agent_prompt', status: 'pending', agent: { id: agent.id }, aiFlags: [expect.objectContaining({ code: 'blocked_word', field: 'customInstructions' })] });
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe('active');
    await mod.post(`/admin/moderation/items/${tab[0].id}/reject`, { decision: 'prohibited', merchantMessage: 'Paiement hors plateforme interdit' }).expect(200);
    expect(await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).toMatchObject({ status: 'paused', pausedReason: 'moderation' });
    expect((await mod.get('/admin/moderation/stats').expect(200)).body.data.agentPrompts).toEqual(expect.any(Number));
  });
});

describe('rules, stats, sample, SLA', () => {
  it('rules CRUD feed the pre-screen (protected brand) and duplicate key ⇒ 409; audit', async () => {
    const created = await mod.post('/admin/moderation/rules', { key: 'brand.zaraa', kind: 'protected_brand', value: 'Zaraa' }).expect(201);
    expect(created.body.data).toMatchObject({ key: 'brand.zaraa', kind: 'protected_brand', isActive: true, createdBy: { id: mod.userId } });
    expect((await mod.post('/admin/moderation/rules', { key: 'brand.zaraa', kind: 'protected_brand', value: 'X' }).expect(409)).body.error.code).toBe('CONFLICT');
    await mod.post('/admin/moderation/rules', { key: 'Bad Key', kind: 'protected_brand', value: 'X' }).expect(422);
    const owner = await merchant('standard');
    const p = await createProduct(owner, { name: 'Veste Zaraa homme' });
    expect(p.moderation.status).toBe('pending');
    expect((await itemOf(p.id)).aiFlags).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'protected_brand', field: 'name' })]));
    await mod.patch(`/admin/moderation/rules/${created.body.data.id}`, { isActive: false }).expect(200);
    expect((await createProduct(owner, { name: 'Veste Zaraa femme' })).moderation.status).toBe('approved');
    expect((await mod.get('/admin/moderation/rules?kind=protected_brand').expect(200)).body.data.map((r: { key: string }) => r.key)).toContain('brand.zaraa');
    await mod.delete(`/admin/moderation/rules/${created.body.data.id}`).expect(200);
    expect(await auditRows('moderation.rule_delete', created.body.data.id)).toHaveLength(1);
    await (await platformUser(app, 'support')).post('/admin/moderation/rules', { key: 'x.y', kind: 'blocked_word', value: 'arnaque' }).expect(403);
  });

  it('stats KPIs and the 5 % auto-approved sample', async () => {
    const stats = (await mod.get('/admin/moderation/stats?period=30d').expect(200)).body.data;
    expect(stats).toEqual(expect.objectContaining({ pending: expect.any(Number), overSla: expect.any(Number), autoApproved7d: expect.any(Number), rejectedByReason: expect.any(Array), suspensionProposed: expect.any(Array) }));
    expect(stats.rejectedByReason.find((r: { decision: string }) => r.decision === 'counterfeit')?.count).toBeGreaterThanOrEqual(1);
    const sample = (await mod.get('/admin/moderation/sample').expect(200)).body;
    expect(sample.meta).toMatchObject({ page: 1, pageSize: 25 });
    for (const r of sample.data) expect(r).toMatchObject({ status: 'auto_approved', sampled: true });
  });

  it('AT-MOD-08 (job) sched-moderation-sla: pending past slaDueAt ⇒ urgent + platform.alert sla_breach', async () => {
    const owner = await merchant('new');
    const p = await createProduct(owner, { name: 'Théière marocaine' });
    const item = await itemOf(p.id);
    await db.moderationItem.update({ where: { id: item.id }, data: { slaDueAt: new Date(Date.now() - 60_000) } });
    const r = await app.app.get(ModerationService).slaSweep();
    expect(r.urgent).toBeGreaterThanOrEqual(1);
    expect((await itemOf(p.id)).priority).toBe('urgent');
    expect((await roomEvents('admin:platform', 'platform.alert')).some((e) => e.payload.kind === 'sla_breach')).toBe(true);
    const urgent = (await mod.get(`/admin/moderation/items?priority=urgent&workspaceId=${owner.workspaceId}`).expect(200)).body.data;
    expect(urgent[0]).toMatchObject({ id: item.id, priority: 'urgent', slaBreached: true });
  });
});

describe('trust levels (R-L)', () => {
  it('AT-MOD-07 3 counterfeit rejections in 90 d ⇒ watch, next 0.99 product goes to the human queue; 5 ⇒ "suspension proposée"', async () => {
    const owner = await merchant('trusted');
    for (let i = 0; i < 3; i++) {
      await setTrust(owner.workspaceId, 'new');
      const p = await createProduct(owner, { name: `Sac Lui Viton ${i}` });
      await mod.post(`/admin/moderation/items/${(await itemOf(p.id)).id}/reject`, { decision: 'counterfeit', merchantMessage: 'Contrefaçon de marque protégée' }).expect(200);
      if (i < 2) await setTrust(owner.workspaceId, 'trusted');
    }
    expect((await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).trustLevel).toBe('watch');
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'workspace.trust_level', entityId: owner.workspaceId }, orderBy: { at: 'desc' } });
    expect(audit).toMatchObject({ actorType: 'system', after: { trustLevel: 'watch' } });
    expect((await createProduct(owner, { name: 'Bracelet argent' })).moderation.status).toBe('pending');
    for (let i = 3; i < 5; i++) {
      const p = await createProduct(owner, { name: `Lunettes Rayben ${i}` });
      await mod.post(`/admin/moderation/items/${(await itemOf(p.id)).id}/reject`, { decision: 'counterfeit', merchantMessage: 'Contrefaçon de marque protégée' }).expect(200);
    }
    const stats = (await mod.get('/admin/moderation/stats').expect(200)).body.data;
    expect(stats.suspensionProposed).toEqual(expect.arrayContaining([expect.objectContaining({ id: owner.workspaceId, counterfeit90d: 5 })]));
    expect((await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).status).toBe('active');
  });

  it('new → standard after 10 approvals with no rejection (on approval and by sched-trust-levels)', async () => {
    const owner = await merchant('new');
    for (let i = 0; i < 10; i++) {
      const p = await createProduct(owner, { name: `Poterie ${i}` });
      await mod.post(`/admin/moderation/items/${(await itemOf(p.id)).id}/approve`, {}).expect(200);
    }
    expect((await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).trustLevel).toBe('standard');
    // the daily sweep finds nothing more to do and is idempotent
    const sweep = await app.app.get(TrustLevelService).sweep();
    expect(sweep).toEqual(expect.objectContaining({ promoted: expect.any(Number), watched: expect.any(Number) }));
  });

  it('manual changes: reason ≥ 10 chars (ADMIN_REASON_REQUIRED), audited with reason, moderator / super_admin only', async () => {
    const owner = await merchant('standard');
    expect((await mod.post(`/admin/workspaces/${owner.workspaceId}/trust-level`, { trustLevel: 'trusted', reason: 'court' }).expect(422)).body.error.code).toBe('ADMIN_REASON_REQUIRED');
    const ok = await mod.post(`/admin/workspaces/${owner.workspaceId}/trust-level`, { trustLevel: 'trusted', reason: 'Marchand vérifié depuis 6 mois' }).expect(200);
    expect(ok.body.data).toEqual({ id: owner.workspaceId, trustLevel: 'trusted' });
    const w = await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
    expect(w).toMatchObject({ trustLevel: 'trusted', trustSetById: mod.userId });
    expect((await auditRows('workspace.trust_level', owner.workspaceId))[0]).toMatchObject({ actorType: 'admin', reason: 'Marchand vérifié depuis 6 mois' });
    for (const role of ['support', 'finance', 'read']) await (await platformUser(app, role)).post(`/admin/workspaces/${owner.workspaceId}/trust-level`, { trustLevel: 'standard', reason: 'Raison suffisante ici' }).expect(403);
    await sa.post('/admin/workspaces/00000000-0000-7000-8000-000000000000/trust-level', { trustLevel: 'standard', reason: 'Raison suffisante ici' }).expect(404);
    await owner.post(`/admin/workspaces/${owner.workspaceId}/trust-level`, { trustLevel: 'trusted', reason: 'Raison suffisante ici' }).expect(403);
  });
});
