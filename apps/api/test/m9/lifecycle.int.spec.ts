// M9 — subscription lifecycle: the 02 §5 single expiry rule (pauses newest first, restores oldest first), trial end,
// dunning R-J (J−7 → J0 → J+3 → J+7, never a suspension), renewal from the unpaid invoice, manual payment (D71), debt
// guard on deletion, monthly credit periods of a yearly plan, limit enforcement. AT-BIL-02, AT-BIL-05, AT-BIL-10,
// AT-BIL-11, AT-BIL-13.
import { asOperator, asOwner, asPlatform } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually, register, setPassword, PASSWORD } from '../support/m1';
import { forbidNetwork } from '../support/m3';
import { balanceOf, inTenant } from '../support/m4';
import { CreditService } from '../../src/modules/credits/credit.service';
import { agents, channels, currentSubOf, DAY, db, idem, makePaid, members, outboxNotifications, payFake, planId, runDunning, runExpiry, setPeriod } from '../support/m9';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  app = await createTestApp();
  net = forbidNetwork();
});
afterAll(async () => {
  net.restore();
  await app.close();
});

const subsOf = (workspaceId: string) => db.subscription.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, include: { plan: true } });

describe('02 §5 single rule', () => {
  it('AT-BIL-13 sign-up ⇒ trial (pro, 14 d, 300 credits, provider none); J−7 reminder once; day 15 ⇒ free plan, same instant', async () => {
    const owner = await register(app);
    const [trial] = await subsOf(owner.workspaceId);
    expect(trial).toMatchObject({ status: 'trial', billingCycle: 'none', provider: 'none', plan: { slug: 'pro' } });
    expect(Math.round((trial!.trialEndsAt!.getTime() - Date.now()) / DAY)).toBe(14);
    expect((await owner.get('/credits').expect(200)).body.data.plan.limit).toBe(300);
    await runExpiry(app, new Date(Date.now() + 8 * DAY));
    await runExpiry(app, new Date(Date.now() + 9 * DAY));
    expect(await outboxNotifications(owner.workspaceId, 'subscription_expiring')).toHaveLength(1);
    await runExpiry(app, new Date(Date.now() + 15 * DAY));
    const [old, free] = await subsOf(owner.workspaceId);
    expect(old).toMatchObject({ status: 'expired' });
    expect(free).toMatchObject({ status: 'active', provider: 'none', billingCycle: 'none', plan: { slug: 'free' } });
    expect(Math.abs(free!.createdAt.getTime() - old!.updatedAt.getTime())).toBeLessThan(5000);
    expect(await outboxNotifications(owner.workspaceId, 'subscription_expired')).toHaveLength(1);
    expect((await owner.get('/billing/subscription').expect(200)).body.data).toMatchObject({ plan: { slug: 'free' }, expiredFrom: { planSlug: 'pro', planName: 'Pro' } });
    expect((await owner.get('/workspace').expect(200)).body.data.plan).toMatchObject({ slug: 'free', status: 'active', expired: { planName: 'Pro' }, paused: { channels: 0, agents: 0, members: 0 } });
    // the job is idempotent
    expect(await runExpiry(app, new Date(Date.now() + 16 * DAY))).toBe(0);
  });

  it('AT-BIL-02 paid plan cancelled at period end: paid row expired + free row active; 3 pages with free max 1 ⇒ 2 newest paused (notified); agents / members beyond limits; no read-only workspace; renewal ⇒ un-paused oldest first', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    await makePaid(app, owner.workspaceId, 'pro', 'monthly');
    const pages = await channels(owner.workspaceId, 3);
    const bots = await agents(owner.workspaceId, 2);
    const extra = await members(owner.workspaceId, 1);
    await owner.post('/billing/cancel', {}).expect(200);
    await setPeriod(app, owner.workspaceId, new Date(Date.now() - 60_000));
    await runExpiry(app);
    const subs = await subsOf(owner.workspaceId);
    expect(subs.map((s) => [s.plan.slug, s.status])).toEqual([['pro', 'expired'], ['free', 'active']]);
    const rows = await db.channel.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((c) => [c.name, c.status, c.pausedReason])).toEqual([['Page 1', 'active', null], ['Page 2', 'paused', 'plan'], ['Page 3', 'paused', 'plan']]);
    expect(await db.agent.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { createdAt: 'asc' }, select: { status: true, pausedReason: true } })).toEqual([{ status: 'active', pausedReason: null }, { status: 'paused', pausedReason: 'plan' }]);
    // members: free = 1 ⇒ only the Owner keeps writing
    const ms = await db.membership.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { createdAt: 'asc' } });
    expect(ms.filter((m) => m.role !== 'owner').every((m) => m.readOnly)).toBe(true);
    expect(ms.find((m) => m.role === 'owner')!.readOnly).toBe(false);
    expect((await outboxNotifications(owner.workspaceId, 'channel_paused_by_plan')).map((n) => (n.payload as any).data.page).sort()).toEqual(['Page 2', 'Page 3']);
    // no read-only at workspace level, never suspended
    expect((await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).status).toBe('active');
    await owner.patch('/workspace', { name: 'Boutique toujours ouverte' }).expect(200);
    expect((await operator.post('/clients', { name: 'Client Test', phone: '0555000111' }).expect(403)).body.error.code).toBe('READ_ONLY_MEMBER');
    const sub = (await owner.get('/billing/subscription').expect(200)).body.data;
    expect(sub.pausedResources.map((p: any) => `${p.type}:${p.name}`)).toEqual(expect.arrayContaining(['channel:Page 2', 'channel:Page 3', `agent:${bots[1]!.name}`]));
    expect((await owner.get('/workspace').expect(200)).body.data.plan.paused).toEqual({ channels: 2, agents: 1, members: 2 });
    // the agent paused by the plan cannot come back while the free slot is taken: "Reprendre" greyed with PLAN_LIMIT
    const paused = (await owner.get(`/agents/${bots[1]!.id}`).expect(200)).body.data;
    expect(paused.actions.find((x: any) => x.key === 'resume')).toMatchObject({ enabled: false, reasonCode: 'PLAN_LIMIT' });
    expect(pages).toHaveLength(3);
    // renewal (Starter: 2 pages, 2 agents, 3 members) ⇒ restored oldest first up to the new limits
    const r = (await owner.post('/billing/checkout', { planId: await planId('starter'), cycle: 'monthly' }).set(idem()).expect(200)).body.data;
    await payFake(app, r.checkoutUrl, 'paid');
    const after = await db.channel.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { createdAt: 'asc' } });
    expect(after.map((c) => [c.name, c.status])).toEqual([['Page 1', 'active'], ['Page 2', 'active'], ['Page 3', 'paused']]);
    expect(await db.agent.count({ where: { workspaceId: owner.workspaceId, status: 'active' } })).toBe(2);
    expect(await db.membership.count({ where: { workspaceId: owner.workspaceId, readOnly: true } })).toBe(0);
    expect(extra).toHaveLength(1);
    expect((await owner.get('/billing/subscription').expect(200)).body.data).toMatchObject({ plan: { slug: 'starter' }, expiredFrom: null });
  });
});

describe('dunning R-J (D49)', () => {
  it('AT-BIL-10 J−7 upcoming invoice + subscription.expiring → J0 dunning + invoice.unpaid (paid limits kept) → J+3 → J+7 expired ⇒ free (never suspended, nothing deleted); paying the unpaid invoice ⇒ active, new period, pauses lifted', async () => {
    const owner = await asOwner(app);
    const end = new Date(Date.now() + 6 * DAY);
    await makePaid(app, owner.workspaceId, 'starter', 'monthly', end);
    await channels(owner.workspaceId, 2);
    await runDunning(app);
    let sub = await currentSubOf(owner.workspaceId);
    expect(sub).toMatchObject({ status: 'active', dunningStage: 'd_minus_7' });
    const upcoming = await db.invoice.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, subscriptionId: sub.id } });
    expect(upcoming).toMatchObject({ kind: 'subscription', status: 'upcoming', amount: 1900, dunningStage: 'd_minus_7' });
    expect((await owner.get('/billing/invoices').expect(200)).body.data[0]).toMatchObject({ status: 'upcoming', pdfUrl: expect.stringMatching(/\/billing\/invoices\/.+\/pdf$/), dueAt: end.toISOString() }); // retest 11/11 M-20
    expect(await outboxNotifications(owner.workspaceId, 'subscription_expiring')).toHaveLength(1);
    expect(await runDunning(app)).toBe(0); // idempotent per stage

    await runDunning(app, new Date(end.getTime() + 3600_000));
    sub = await currentSubOf(owner.workspaceId);
    expect(sub).toMatchObject({ status: 'dunning', dunningStage: 'd0', plan: { slug: 'starter' } });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: upcoming.id } })).status).toBe('unpaid');
    const unpaid = await outboxNotifications(owner.workspaceId, 'invoice_unpaid');
    expect(unpaid.map((n) => (n.payload as any).data)).toEqual([expect.objectContaining({ invoiceId: upcoming.id, amount: 1900, checkoutUrl: expect.stringContaining(`/settings/billing?pay=${upcoming.id}`) })]);
    expect((await owner.get('/billing/subscription').expect(200)).body.data).toMatchObject({ status: 'dunning', dunningStage: 'd0', unpaidInvoice: { id: upcoming.id, remaining: 1900 }, actions: expect.arrayContaining([{ key: 'pay_invoice', enabled: true }]) });
    expect((await owner.get('/workspace').expect(200)).body.data.plan).toMatchObject({ slug: 'starter', status: 'dunning', dunningStage: 'd0' });

    await runDunning(app, new Date(end.getTime() + 3 * DAY + 3600_000));
    expect(await currentSubOf(owner.workspaceId)).toMatchObject({ dunningStage: 'd_plus_3' });
    expect(await outboxNotifications(owner.workspaceId, 'invoice_unpaid')).toHaveLength(2);

    await runDunning(app, new Date(end.getTime() + 7 * DAY + 3600_000));
    const subs = await subsOf(owner.workspaceId);
    expect(subs.map((s) => [s.plan.slug, s.status, s.dunningStage])).toEqual([['starter', 'expired', 'expired'], ['free', 'active', null]]);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: upcoming.id } })).status).toBe('unpaid');
    expect((await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).status).toBe('active');
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId, status: 'paused', pausedReason: 'plan' } })).toBe(1);
    await owner.get('/orders').expect(200);
    await owner.patch('/workspace', { name: 'Toujours là' }).expect(200);
    expect(await outboxNotifications(owner.workspaceId, 'workspace_suspended')).toHaveLength(0);

    // "Payer maintenant" after J+7: renewal from the unpaid invoice, the free row ends, the page comes back
    const pay = (await owner.post(`/billing/invoices/${upcoming.id}/pay`).expect(200)).body.data;
    expect(pay.checkoutUrl).toContain('/dev-payments/');
    expect((await owner.get(`/billing/checkout/return?ref=${pay.ref}`).expect(200)).body.data).toMatchObject({ status: 'verifying', kind: 'invoice' });
    await payFake(app, pay.checkoutUrl, 'paid');
    expect((await owner.get(`/billing/checkout/return?ref=${pay.ref}`).expect(200)).body.data).toMatchObject({ status: 'success', kind: 'invoice', invoiceId: upcoming.id });
    const now = await currentSubOf(owner.workspaceId);
    expect(now).toMatchObject({ status: 'active', dunningStage: null, plan: { slug: 'starter' }, billingCycle: 'monthly' });
    expect(now.currentPeriodEnd.getTime() - Date.now()).toBeGreaterThan(27 * DAY);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: upcoming.id } })).status).toBe('paid');
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId, status: 'active' } })).toBe(2);
    // no credit-note model exists in v2
    expect('creditNote' in db).toBe(false);
  });

  it('AT-BIL-10 manual payment by finance (D71): over ⇒ 422 fields.amount; partial ⇒ 200 ⚠ INVOICE_PARTIAL_PAYMENT {remaining} and still unpaid; the remaining amount ⇒ paid + immediate reactivation; reason required; roles', async () => {
    const owner = await asOwner(app);
    const end = new Date(Date.now() - 3600_000);
    await makePaid(app, owner.workspaceId, 'pro', 'monthly', new Date(Date.now() + 6 * DAY));
    await runDunning(app);
    await setPeriod(app, owner.workspaceId, end);
    await runDunning(app);
    const inv = await db.invoice.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, status: 'unpaid' } });
    const finance = await asPlatform(app, 'finance');
    const support = await asPlatform(app, 'support');
    const body = { method: 'manual_ccp', amount: 1000, reference: 'CCP-0042', paidAt: new Date().toISOString(), reason: 'Virement CCP reçu le matin' };
    expect((await support.post(`/admin/invoices/${inv.id}/mark-paid`, body).expect(403)).body.error.code).toBe('FORBIDDEN');
    await owner.post(`/admin/invoices/${inv.id}/mark-paid`, body).expect(403);
    expect((await finance.post(`/admin/invoices/${inv.id}/mark-paid`, { ...body, reason: 'court' }).expect(422)).body.error.code).toBe('ADMIN_REASON_REQUIRED');
    const over = await finance.post(`/admin/invoices/${inv.id}/mark-paid`, { ...body, amount: 6000 }).expect(422);
    expect(over.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { amount: 'validation.range' }, params: { max: 4900 } });
    const partial = await finance.post(`/admin/invoices/${inv.id}/mark-paid`, body).expect(200);
    expect(partial.body.meta.warnings).toEqual([{ code: 'INVOICE_PARTIAL_PAYMENT', params: { remaining: 3900 } }]);
    expect(partial.body.data).toMatchObject({ remaining: 3900, reactivated: false, invoice: { status: 'unpaid', remaining: 3900 } });
    expect((await currentSubOf(owner.workspaceId)).status).toBe('dunning');
    const full = await finance.post(`/admin/invoices/${inv.id}/mark-paid`, { ...body, amount: 3900, reference: 'CCP-0043' }).expect(200);
    expect(full.body.data).toMatchObject({ remaining: 0, reactivated: true, invoice: { status: 'paid', method: 'manual_ccp' } });
    expect(full.body.meta.warnings).toEqual([]);
    expect(await currentSubOf(owner.workspaceId)).toMatchObject({ status: 'active', dunningStage: null });
    expect((await finance.post(`/admin/invoices/${inv.id}/mark-paid`, body).expect(409)).body.error.code).toBe('CONFLICT');
    await finance.post('/admin/invoices/00000000-0000-4000-8000-000000000000/mark-paid', body).expect(404);
    expect(await eventually(() => db.auditLog.count({ where: { action: 'invoice.mark_paid', entityId: inv.id } }))).toBe(2);
    expect(await db.billingPayment.count({ where: { invoiceId: inv.id, provider: 'manual', status: 'paid' } })).toBe(2);
  });

  it('AT-BIL-11 deleting a workspace with an unpaid invoice ⇒ WORKSPACE_HAS_DEBT; after payment ⇒ allowed; the deletion cancels the subscription, cancelling the deletion restores it', async () => {
    const owner = await asOwner(app);
    await setPassword(app, owner.userId);
    await makePaid(app, owner.workspaceId, 'starter', 'monthly', new Date(Date.now() + 6 * DAY));
    await runDunning(app);
    await setPeriod(app, owner.workspaceId, new Date(Date.now() - 3600_000));
    await runDunning(app);
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
    const del = await owner.delete('/workspace').send({ password: PASSWORD, confirmName: ws.name }).expect(409);
    expect(del.body.error).toMatchObject({ code: 'WORKSPACE_HAS_DEBT', params: { amount: 1900 } });
    const inv = await db.invoice.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, status: 'unpaid' } });
    const pay = (await owner.post(`/billing/invoices/${inv.id}/pay`).expect(200)).body.data;
    await payFake(app, pay.checkoutUrl, 'paid');
    await owner.delete('/workspace').send({ password: PASSWORD, confirmName: ws.name }).expect(200);
    expect(await currentSubOf(owner.workspaceId)).toMatchObject({ cancelAtPeriodEnd: true, cancelReason: 'workspace_deletion' });
    await owner.post('/workspace/deletion/cancel', {}).expect(200);
    expect(await currentSubOf(owner.workspaceId)).toMatchObject({ cancelAtPeriodEnd: false, cancelReason: null });
  });
});

describe('credit periods & limits', () => {
  it('AT-BIL-05 yearly plan: credits and the conversation quota reset every month on the period day; the free plan advances monthly too', async () => {
    const owner = await asOwner(app);
    const start = new Date(Date.now() - 40 * DAY);
    await makePaid(app, owner.workspaceId, 'pro', 'yearly', new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes())));
    const b = await balanceOf(app, owner.workspaceId);
    expect(b.planLimit).toBe(5000);
    const days = (b.periodStart.getTime() - start.getTime()) / DAY;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    expect(b.periodEnd.getTime() - b.periodStart.getTime()).toBeLessThan(32 * DAY);
    const credits = app.app.get(CreditService);
    await credits.openPeriods();
    expect(await db.creditLedger.count({ where: { workspaceId: owner.workspaceId, action: 'renewal', periodStart: b.periodStart } })).toBe(1);
    expect((await inTenant(app, owner.workspaceId, () => credits.quota(owner.workspaceId))).periodStart.toISOString()).toBe(b.periodStart.toISOString());
    // free plan: 12 monthly periods, the row rolls on its 12-month anniversary
    const free = await asOwner(app, 'free');
    const fs = await currentSubOf(free.workspaceId);
    await db.subscription.update({ where: { id: fs.id }, data: { billingCycle: 'none', provider: 'none', currentPeriodStart: new Date(Date.now() - 400 * DAY), currentPeriodEnd: new Date(Date.now() - 35 * DAY) } });
    await runExpiry(app);
    const rolled = await currentSubOf(free.workspaceId);
    expect(rolled.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    const fb = await balanceOf(app, free.workspaceId);
    expect(fb.planLimit).toBe(100);
    expect(fb.periodEnd.getTime() - fb.periodStart.getTime()).toBeLessThan(32 * DAY);
  });
});
