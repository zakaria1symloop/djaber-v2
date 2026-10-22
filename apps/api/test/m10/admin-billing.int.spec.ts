// M10 (api-a) — ADM-04 plans editor (AT-BIL-08, AT-BIL-09), ADM-05 subscriptions / invoices / manual payments list,
// ADM-15 credit packs & promo codes & pricing history (+ AT-PRM-03 role split of credit grants).
import { randomUUID } from 'node:crypto';
import { rawPrisma as db } from '@djaber/db';
import { asOwner, asPlatform } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { callback, fakeMeta, forbidNetwork, startConnect } from '../support/m3';
import { drainAll } from '../support/m10-ops';
import { makePaid, planId } from '../support/m9';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  app = await createTestApp();
  net = forbidNetwork();
});
// global catalogue rows created here are removed so the seed counts of other suites stay exact (same test database)
const createdPlans: string[] = [];
const createdPacks: string[] = [];
afterAll(async () => {
  await db.subscription.deleteMany({ where: { plan: { slug: { in: createdPlans } } } });
  await db.planVersion.deleteMany({ where: { plan: { slug: { in: createdPlans } } } });
  await db.plan.deleteMany({ where: { slug: { in: createdPlans } } });
  await db.creditPack.deleteMany({ where: { slug: { in: createdPacks } } });
  net.restore();
  await app.close();
});

const REASON = 'Geste commercial validé par la direction';
const lastAudit = (action: string, entityId: string) => db.auditLog.findFirst({ where: { action, entityId }, orderBy: { at: 'desc' } });
const planBody = (slug: string) => (createdPlans.push(slug), { slug, name: { fr: `Plan ${slug}`, ar: 'خطة', en: `Plan ${slug}` }, priceMonthly: 2900, priceYearly: 29000, maxPages: 3, maxAgents: 3, maxProducts: 800, maxConversationsPerMonth: 3000, maxMembers: 4, monthlyCredits: 2500, features: ['voice_notes', 'instagram'] });

describe('ADM-04 plans', () => {
  it('AT-BIL-09 create: duplicate slug ⇒ PLAN_SLUG_TAKEN, all limits 0 ⇒ 422, finance allowed / support 403; delete with subscribers ⇒ PLAN_IN_USE {count}; migrate; archive / restore; versions', async () => {
    const fin = await asPlatform(app, 'finance');
    const slug = `p-${randomUUID().slice(0, 6)}`;
    expect((await (await asPlatform(app, 'support')).post('/admin/plans', planBody(slug)).expect(403)).body.error.code).toBe('FORBIDDEN');
    const zero = { ...planBody(slug), maxPages: 0, maxAgents: 0, maxProducts: 0, maxConversationsPerMonth: 0, maxMembers: 0, monthlyCredits: 0 };
    expect((await fin.post('/admin/plans', zero).expect(422)).body.error.fields).toEqual({ maxPages: 'validation.range' });
    await fin.post('/admin/plans', { ...planBody(slug), slug: 'Bad Slug' }).expect(422);
    const plan = (await fin.post('/admin/plans', planBody(slug)).expect(201)).body.data;
    expect(plan).toMatchObject({ slug, version: 1, subscribers: 0, nameI18n: { fr: `Plan ${slug}` }, features: ['voice_notes', 'instagram'] });
    expect((await fin.post('/admin/plans', planBody(slug)).expect(409)).body.error.code).toBe('PLAN_SLUG_TAKEN');
    expect(await lastAudit('plan.create', plan.id)).toBeTruthy();
    // two subscribers ⇒ PLAN_IN_USE 2
    const a = await asOwner(app, slug);
    const b = await asOwner(app, slug);
    expect((await fin.delete(`/admin/plans/${plan.id}`).expect(409)).body.error).toMatchObject({ code: 'PLAN_IN_USE', params: { count: 2 } });
    const list = (await fin.get('/admin/plans').expect(200)).body.data;
    expect(list.find((p: any) => p.id === plan.id)).toMatchObject({ subscribers: 2 });
    expect(list.find((p: any) => p.id === plan.id).actions.find((x: any) => x.key === 'delete')).toEqual({ key: 'delete', enabled: false, reasonCode: 'PLAN_IN_USE' });
    // migrate subscribers to starter now
    const starter = await planId('starter');
    await fin.post(`/admin/plans/${plan.id}/migrate`, { toPlanId: starter, when: 'now' }).expect(422);
    expect((await fin.post(`/admin/plans/${plan.id}/migrate`, { toPlanId: starter, when: 'now', reason: REASON }).expect(200)).body.data).toEqual({ migrated: 2 });
    for (const w of [a, b]) expect((await db.subscription.findFirstOrThrow({ where: { workspaceId: w.workspaceId, status: 'active' } })).planId).toBe(starter);
    // archive / restore, then delete without subscribers ⇒ archived (history) → 204
    expect((await fin.post(`/admin/plans/${plan.id}/archive`, {}).expect(200)).body.data.archivedAt).not.toBeNull();
    expect((await fin.post(`/admin/plans/${plan.id}/archive`, {}).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await fin.post(`/admin/plans/${plan.id}/restore`, {}).expect(200)).body.data.archivedAt).toBeNull();
    expect((await fin.get(`/admin/plans/${plan.id}/versions`).expect(200)).body.data.map((v: any) => v.version)).toEqual([1]);
    // migrated subscriptions no longer reference the plan ⇒ deleted
    await fin.delete(`/admin/plans/${plan.id}`).expect(204);
    expect(await db.plan.findUnique({ where: { id: plan.id } })).toBeNull();
    await fin.get(`/admin/plans/${randomUUID()}`).expect(404);
    expect((await fin.delete(`/admin/plans/${(await db.plan.findUniqueOrThrow({ where: { slug: 'free' } })).id}`).expect(409)).body.error.code).toBe('CONFLICT');
  });

  it('AT-BIL-08 plan edit maxPages 3 → 2: impact (dry run) lists the grandfathered workspace, version +1, workspace keeps its 3 pages, a 4th ⇒ PLAN_LIMIT_GRANDFATHERED (no pause); price change ⇒ notice to subscribers; diff audited', async () => {
    const sa = await asPlatform(app);
    const slug = `g-${randomUUID().slice(0, 6)}`;
    const plan = (await sa.post('/admin/plans', planBody(slug)).expect(201)).body.data;
    const owner = await asOwner(app, slug);
    const meta = fakeMeta(app);
    for (let i = 0; i < 3; i++) {
      const s = await startConnect(owner);
      const id = `7${Date.now()}${i}`.slice(0, 15);
      meta.setPages(s.seed, [{ id, name: `P${i}`, accessToken: `fake-page-token.${id}`, tasks: ['MANAGE', 'MESSAGING'], pictureUrl: null, followersCount: 1 }]);
      await callback(app, 'facebook', { code: s.code, state: s.state });
    }
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId, status: 'active', parentChannelId: null } })).toBe(3);
    const dry = (await sa.patch(`/admin/plans/${plan.id}`, { maxPages: 2, dryRun: true }).expect(200)).body.data;
    expect(dry).toEqual({ plan: null, impact: { subscribers: 1, overLimit: [{ limit: 'pages', count: 1 }], priceChangeAt: null, emailDueBy: null } });
    expect((await db.plan.findUniqueOrThrow({ where: { id: plan.id } })).version).toBe(1);
    const res = (await sa.patch(`/admin/plans/${plan.id}`, { maxPages: 2, priceMonthly: 3200, reason: 'Ajustement grille' }).expect(200)).body.data;
    expect(res.plan).toMatchObject({ version: 2, limits: { maxPages: 2 }, priceMonthly: 3200 });
    expect(res.impact.priceChangeAt).not.toBeNull();
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId, status: 'active', parentChannelId: null } })).toBe(3);
    const s = await startConnect(owner);
    meta.setPages(s.seed, [{ id: `8${Date.now()}`.slice(0, 15), name: 'P4', accessToken: 'fake-page-token.x', tasks: ['MANAGE', 'MESSAGING'], pictureUrl: null, followersCount: 1 }]);
    const report = await callback(app, 'facebook', { code: s.code, state: s.state });
    expect(report.pages.map((p) => p.code)).toEqual(['PLAN_LIMIT_GRANDFATHERED']);
    const row = await lastAudit('plan.update', plan.id);
    expect(row!.before).toMatchObject({ version: 1, maxPages: 3, priceMonthly: 2900 });
    expect(row!.after).toMatchObject({ version: 2, maxPages: 2, priceMonthly: 3200 });
    expect(row!.before).not.toHaveProperty('maxAgents'); // only the changed lines
    const versions = (await sa.get(`/admin/plans/${plan.id}/versions`).expect(200)).body.data;
    expect(versions.map((v: any) => v.version)).toEqual([2, 1]);
    expect(versions[0].impactCount).toBe(1);
  });
});

describe('ADM-05 subscriptions, invoices, payments', () => {
  it('list with KPIs and filters, create (SUBSCRIPTION_ALREADY_ACTIVE), patch extend, discount, cancel at period end, cancel-now ⇒ free plan, resend dunning; invoices + export job; manual payments tab', async () => {
    const fin = await asPlatform(app, 'finance');
    const owner = await asOwner(app, 'free');
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
    const pro = await planId('pro');
    await fin.post('/admin/subscriptions', { workspaceId: owner.workspaceId, planId: pro, cycle: 'monthly', startsAt: '2026-10-01' }).expect(422);
    const created = (await fin.post('/admin/subscriptions', { workspaceId: owner.workspaceId, planId: pro, cycle: 'monthly', startsAt: '2026-10-01', reason: REASON }).expect(201)).body.data;
    expect(created).toMatchObject({ workspace: { id: owner.workspaceId }, plan: { slug: 'pro' }, status: 'active', provider: 'manual', appliedPrice: 4900, cycle: 'monthly' });
    expect((await fin.post('/admin/subscriptions', { workspaceId: owner.workspaceId, planId: pro, cycle: 'monthly', startsAt: '2026-10-01', reason: REASON }).expect(409)).body.error.code).toBe('SUBSCRIPTION_ALREADY_ACTIVE');
    expect((await lastAudit('subscription.create', created.id))!.reason).toBe(REASON);
    const list = (await fin.get(`/admin/subscriptions?q=${encodeURIComponent(ws.name)}`).expect(200)).body;
    expect(list.data.map((s: any) => s.id)).toEqual([created.id]);
    expect(list.meta.kpis).toMatchObject({ mrr: expect.any(Number), counts: { subscriptions: expect.any(Number) } });
    expect((await fin.get('/admin/subscriptions?status=trial&pageSize=100').expect(200)).body.data.every((s: any) => s.status === 'trial')).toBe(true);
    await fin.get('/admin/subscriptions?status=nope').expect(422);
    const end = new Date(created.currentPeriodEnd).getTime();
    const ext = (await fin.patch(`/admin/subscriptions/${created.id}`, { extendDays: 7, reason: REASON }).expect(200)).body.data;
    expect(new Date(ext.currentPeriodEnd).getTime()).toBe(end + 7 * 86_400_000);
    const disc = (await fin.post(`/admin/subscriptions/${created.id}/discount`, { kind: 'percent', value: 20, periods: 3, reason: REASON }).expect(200)).body.data;
    expect(disc.discountPct).toBe(20);
    await fin.post(`/admin/subscriptions/${created.id}/discount`, { kind: 'percent', value: 120, periods: 3, reason: REASON }).expect(422);
    expect((await fin.post(`/admin/subscriptions/${created.id}/resend-dunning`, { reason: REASON }).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await fin.post(`/admin/subscriptions/${created.id}/cancel`, { reason: REASON }).expect(200)).body.data.cancelAtPeriodEnd).toBe(true);
    await fin.post(`/admin/subscriptions/${created.id}/cancel`, { reason: REASON }).expect(409);
    const now = (await fin.post(`/admin/subscriptions/${created.id}/cancel-now`, { reason: REASON }).expect(200)).body.data;
    expect(now.status).toBe('cancelled');
    const cur = await db.subscription.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, status: 'active' }, include: { plan: true } });
    expect(cur.plan.slug).toBe('free');
    expect((await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).status).toBe('active'); // never suspended
    await fin.post(`/admin/subscriptions/${created.id}/explode`, { reason: REASON }).expect(404);
    expect((await (await asPlatform(app, 'support')).post(`/admin/subscriptions/${created.id}/cancel`, { reason: REASON }).expect(403)).body.error.code).toBe('FORBIDDEN');

    // resend dunning on a dunning subscription with an unpaid invoice
    const d = await asOwner(app);
    await makePaid(app, d.workspaceId, 'starter');
    const sub = await db.subscription.findFirstOrThrow({ where: { workspaceId: d.workspaceId, status: 'active', billingCycle: 'monthly' } });
    await db.subscription.update({ where: { id: sub.id }, data: { status: 'dunning', dunningStage: 'd0' } });
    const inv = await db.invoice.create({ data: { workspaceId: d.workspaceId, number: `T-${randomUUID().slice(0, 8)}`, kind: 'subscription', status: 'unpaid', amount: 1900, lines: [], subscriptionId: sub.id } });
    const row = (await fin.post(`/admin/subscriptions/${sub.id}/resend-dunning`, { reason: REASON }).expect(200)).body.data;
    expect(row.unpaidInvoice).toMatchObject({ id: inv.id, remaining: 1900 });
    await drainAll(app, ['notification']);
    expect(await db.notification.count({ where: { workspaceId: d.workspaceId, type: 'invoice_unpaid' } })).toBeGreaterThanOrEqual(1);

    // invoices list + manual payment (M9 endpoint) shows in the manual payments tab
    const invs = (await fin.get(`/admin/invoices?workspaceId=${d.workspaceId}&status=unpaid`).expect(200)).body.data;
    expect(invs[0]).toMatchObject({ id: inv.id, workspace: { id: d.workspaceId }, status: 'unpaid' });
    expect(invs[0].actions.find((x: any) => x.key === 'mark_paid')).toMatchObject({ enabled: true });
    await fin.post(`/admin/invoices/${inv.id}/mark-paid`, { method: 'manual_ccp', amount: 900, reference: 'CCP-0098', paidAt: '2026-10-05', reason: REASON }).expect(200);
    const pays = (await fin.get(`/admin/payments?q=CCP-0098`).expect(200)).body.data;
    expect(pays[0]).toMatchObject({ amount: 900, provider: 'manual', method: 'manual_ccp', reference: 'CCP-0098', invoice: { id: inv.id } });
    // the rest with a proof: a platform file of this admin is accepted, a workspace upload is not (UX-012)
    const mine = await db.upload.create({ data: { workspaceId: null, storageKey: `users/${fin.userId}/payment_proof/${randomUUID()}.pdf`, url: '/files/proof.pdf', mime: 'application/pdf', size: 10, kind: 'payment_proof', createdById: fin.userId } });
    const wsFile = await db.upload.create({ data: { workspaceId: d.workspaceId, storageKey: `ws/${d.workspaceId}/cash_proof/${randomUUID()}.pdf`, url: '/files/x.pdf', mime: 'application/pdf', size: 10, kind: 'cash_proof', createdById: fin.userId } });
    expect((await fin.post(`/admin/invoices/${inv.id}/mark-paid`, { method: 'manual_ccp', amount: 1000, reference: 'CCP-0099', paidAt: '2026-10-06', proofUploadId: wsFile.id, reason: REASON }).expect(422)).body.error.fields).toMatchObject({ proofUploadId: 'validation.id' });
    await fin.post(`/admin/invoices/${inv.id}/mark-paid`, { method: 'manual_ccp', amount: 1000, reference: 'CCP-0099', paidAt: '2026-10-06', proofUploadId: mine.id, reason: REASON }).expect(200);
    expect((await fin.get(`/admin/payments?q=CCP-0099`).expect(200)).body.data[0].proofUrl).toBeTruthy();
    const exp = (await fin.get('/admin/invoices/export?from=2026-01-01&to=2026-12-31').expect(202)).body.data;
    await drainAll(app, ['job']);
    const job = (await fin.get(`/admin/jobs/${exp.jobId}`).expect(200)).body.data;
    expect(job).toMatchObject({ status: 'done', kind: 'export' });
    expect(job.resultUrl).toBeTruthy();
    await (await asPlatform(app, 'finance')).get(`/admin/jobs/${exp.jobId}`).expect(404); // another admin's job
    await fin.get('/admin/invoices/export?from=2026-12-31&to=2026-01-01').expect(422);
  });
});

describe('ADM-15 packs, promo codes, pricing history', () => {
  it('packs list with KPIs, create (slug / store id unique), patch (hide on mobile), purchases; promo codes CRUD + state + deactivate + redemptions; pricing versions; read role 403 on writes', async () => {
    const fin = await asPlatform(app, 'finance');
    const packs = (await fin.get('/admin/credit-packs').expect(200)).body;
    expect(packs.data.map((p: any) => p.slug)).toEqual(expect.arrayContaining(['pack-500', 'pack-2000', 'pack-6000']));
    expect(packs.meta.kpis).toMatchObject({ packsSold30d: { total: expect.any(Number) }, activeCodes: expect.any(Number) });
    const slug = `agence-${randomUUID().slice(0, 4)}`;
    createdPacks.push(slug);
    const body = { slug, name: { fr: 'Agence', ar: 'وكالة', en: 'Agency' }, credits: 20000, priceWebDzd: 11000, visibleMobile: false };
    expect((await (await asPlatform(app, 'read')).post('/admin/credit-packs', body).expect(403)).body.error.code).toBe('FORBIDDEN');
    await fin.post('/admin/credit-packs', { ...body, credits: 0 }).expect(422);
    const pack = (await fin.post('/admin/credit-packs', body).expect(201)).body.data;
    expect(pack).toMatchObject({ slug, credits: 20000, visibleMobile: false, isActive: true, nameI18n: { en: 'Agency' } });
    expect((await fin.post('/admin/credit-packs', body).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await fin.patch(`/admin/credit-packs/${pack.id}`, { isActive: false }).expect(200)).body.data.isActive).toBe(false);
    await fin.patch(`/admin/credit-packs/${randomUUID()}`, { isActive: false }).expect(404);
    expect(Array.isArray((await fin.get('/admin/credit-packs/purchases').expect(200)).body.data)).toBe(true);

    const code = `LANCE-${randomUUID().slice(0, 4).toUpperCase()}`;
    await fin.post('/admin/promo-codes', { code, kind: 'percent_discount', value: 150 }).expect(422);
    await fin.post('/admin/promo-codes', { code, kind: 'credits', value: 100, target: 'workspace' }).expect(422);
    const promo = (await fin.post('/admin/promo-codes', { code: code.toLowerCase(), kind: 'percent_discount', value: 20, periods: 2, planSlugs: ['starter', 'pro'], maxUses: 500, validFrom: '2026-10-06', validTo: '2026-11-06' }).expect(201)).body.data;
    expect(promo).toMatchObject({ code, kind: 'percent_discount', value: 20, uses: 0, state: 'active', perWorkspaceLimit: 1 });
    expect((await fin.post('/admin/promo-codes', { code, kind: 'credits', value: 10 }).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await fin.get(`/admin/promo-codes?q=${code}`).expect(200)).body.data[0].id).toBe(promo.id);
    // a redemption ⇒ value is fixed, the list shows it
    const owner = await asOwner(app);
    await db.promoRedemption.create({ data: { promoCodeId: promo.id, workspaceId: owner.workspaceId, userId: owner.userId } });
    expect((await fin.patch(`/admin/promo-codes/${promo.id}`, { value: 30 }).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await fin.patch(`/admin/promo-codes/${promo.id}`, { maxUses: 1 }).expect(200)).body.data).toMatchObject({ uses: 1, state: 'used' });
    expect((await fin.get(`/admin/promo-codes/${promo.id}/redemptions`).expect(200)).body.data[0]).toMatchObject({ workspace: { id: owner.workspaceId } });
    expect((await fin.post(`/admin/promo-codes/${promo.id}/deactivate`, {}).expect(200)).body.data.state).toBe('inactive');
    expect((await fin.get('/admin/promo-codes?state=inactive&pageSize=100').expect(200)).body.data.map((p: any) => p.id)).toContain(promo.id);
    expect(await lastAudit('promo_code.create', promo.id)).toBeTruthy();
    const versions = (await fin.get('/admin/credit-pricing/versions').expect(200)).body.data;
    expect(versions[0]).toMatchObject({ version: expect.any(Number), costs: { text: expect.any(Number) } });
    expect(versions.filter((v: any) => v.current)).toHaveLength(1);
  });

  it('UX-010 delete a pack: allowed while never bought (audited), refused CREDIT_PACK_HAS_PURCHASES {count} once a purchase exists (any status); read role 403', async () => {
    const fin = await asPlatform(app, 'finance');
    const make = async () => {
      const slug = `test-${randomUUID().slice(0, 6)}`;
      createdPacks.push(slug);
      return (await fin.post('/admin/credit-packs', { slug, name: { fr: 'Pack test' }, credits: 100, priceWebDzd: 500 }).expect(201)).body.data;
    };
    const unused = await make();
    expect(unused).toMatchObject({ purchases: 0, actions: expect.arrayContaining([{ key: 'delete', enabled: true }]) });
    await (await asPlatform(app, 'read')).delete(`/admin/credit-packs/${unused.id}`).expect(403);
    await fin.delete(`/admin/credit-packs/${unused.id}`).expect(204);
    expect(await db.creditPack.findUnique({ where: { id: unused.id } })).toBeNull();
    expect(await lastAudit('credit_pack.delete', unused.id)).toBeTruthy();
    await fin.delete(`/admin/credit-packs/${unused.id}`).expect(404);

    const bought = await make();
    const owner = await asOwner(app);
    await db.creditPackPurchase.create({ data: { workspaceId: owner.workspaceId, creditPackId: bought.id, channel: 'web', status: 'failed', amount: 500, purchasedById: owner.userId } });
    const row = (await fin.get('/admin/credit-packs').expect(200)).body.data.find((p: any) => p.id === bought.id);
    expect(row).toMatchObject({ purchases: 1, actions: expect.arrayContaining([{ key: 'delete', enabled: false, reasonCode: 'CREDIT_PACK_HAS_PURCHASES' }]) });
    expect((await fin.delete(`/admin/credit-packs/${bought.id}`).expect(409)).body.error).toMatchObject({ code: 'CREDIT_PACK_HAS_PURCHASES', params: { count: 1 } });
    await db.creditPackPurchase.deleteMany({ where: { creditPackId: bought.id } });
  });

  it('AT-PRM-03 credit grants: support 1 200 ⇒ ADMIN_CREDIT_GRANT_LIMIT {1000}; finance ⇒ ok, audit credits.grant with reason; moderator 403', async () => {
    const owner = await asOwner(app);
    expect((await (await asPlatform(app, 'support')).post(`/admin/workspaces/${owner.workspaceId}/credits`, { credits: 1200, reason: REASON }).expect(403)).body.error).toMatchObject({ code: 'ADMIN_CREDIT_GRANT_LIMIT', params: { max: 1000 } });
    expect((await (await asPlatform(app, 'moderator')).post(`/admin/workspaces/${owner.workspaceId}/credits`, { credits: 10, reason: REASON }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await (await asPlatform(app, 'finance')).post(`/admin/workspaces/${owner.workspaceId}/credits`, { credits: 1200, reason: REASON }).expect(200);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: 'credits.grant', workspaceId: owner.workspaceId } })).reason).toBe(REASON);
  });
});
