// Owner request 09/11 « des notifications pour l'admin, pour tout, en temps réel »: one `Notification(platform_admin)` per
// platform user allowed to act on the event (no workspace), pushed live (WS `admin.notification` on `user:<id>` through the
// outbox), listed / counted / read on `/admin/notifications`; a merchant never sees them.
import { prisma, rawPrisma as db, TenantContext } from '@djaber/db';
import { asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct } from '../support/m2';
import { platformUser, type PlatformActorT } from '../support/m10-ops';
import { ProvisioningService } from '../../src/modules/workspace/provisioning.service';

let app: TestApp;
let sa: PlatformActorT;
let mod: PlatformActorT;
let sup: PlatformActorT;
let fin: PlatformActorT;
beforeAll(async () => {
  app = await createTestApp();
  sa = await platformUser(app, 'super_admin');
  mod = await platformUser(app, 'moderator');
  sup = await platformUser(app, 'support');
  fin = await platformUser(app, 'finance');
});
afterAll(async () => {
  await app.close();
});

const kindsOf = async (actor: PlatformActorT) => ((await actor.get('/admin/notifications?limit=50').expect(200)).body.data as { kind: string }[]).map((n) => n.kind);
const live = (userId: string) => db.outbox.findMany({ where: { topic: 'ws', payload: { path: ['room'], equals: `user:${userId}` } }, orderBy: { createdAt: 'asc' } }).then((rows) => rows.map((r) => r.payload as { event: string; payload: any }).filter((p) => p.event === 'admin.notification'));

describe('super admin notifications (owner request 09/11)', () => {
  it('a new shop, a product to review, a support ticket and a report reach the platform users who act on them, live; list, count, read, read all; a merchant never sees them', async () => {
    // a new shop (signup → ProvisioningService): super admin + support
    const owner = await asOwner(app);
    const shop = await TenantContext.runSystem(() => prisma.$transaction((tx) => app.app.get(ProvisioningService).createWorkspace(tx as never, { ownerId: owner.userId, name: 'Boutique Nour', locale: 'fr' })));
    expect(await kindsOf(sa)).toContain('workspace_created');
    expect(await kindsOf(sup)).toContain('workspace_created');
    expect(await kindsOf(mod)).not.toContain('workspace_created');
    const event = (await live(sa.userId)).find((e) => e.payload.notification.kind === 'workspace_created')!;
    expect(event.payload).toMatchObject({ notification: { title: 'Nouvelle boutique : Boutique Nour', link: `/admin/workspaces?sheet=${shop.id}`, readAt: null }, unreadCount: expect.any(Number) });

    // a product waiting for review (manual review): super admin + moderators, never finance
    const kept = await db.platformSetting.findUniqueOrThrow({ where: { key: 'moderation_policy' } });
    await db.platformSetting.update({ where: { key: 'moderation_policy' }, data: { value: { manualReviewAll: true } } });
    try {
      const p = await createProduct(owner, { name: 'Sac tissé main', description: 'Fait main en Kabylie.' });
      expect(p.moderation.status).toBe('pending');
      const item = await db.moderationItem.findFirstOrThrow({ where: { productId: p.id }, orderBy: { submittedAt: 'desc' } });
      const list = (await mod.get('/admin/notifications').expect(200)).body;
      const pending = (list.data as any[]).find((n) => n.kind === 'moderation_pending');
      expect(pending).toMatchObject({ title: 'Produit à valider : Sac tissé main', link: `/admin/moderation?sheet=${item.id}` });
      expect(list.meta).toMatchObject({ hasMore: false, nextCursor: null });
      expect(await kindsOf(fin)).not.toContain('moderation_pending');
      // in the reader's language
      expect(((await mod.get('/admin/notifications').set('Accept-Language', 'ar').expect(200)).body.data as any[]).find((n) => n.kind === 'moderation_pending').title).toBe('منتج للمراجعة: Sac tissé main');
    } finally {
      await db.platformSetting.update({ where: { key: 'moderation_policy' }, data: { value: kept.value as never } });
    }

    // a support ticket: super admin + support
    await owner.post('/support/tickets', { category: 'other', message: 'Ma page Facebook ne reçoit plus les messages depuis ce matin.' }).expect(201);
    expect(await kindsOf(sup)).toContain('ticket_opened');
    expect(await kindsOf(mod)).not.toContain('ticket_opened');

    // a report: super admin + moderators
    const reported = await createProduct(owner, { name: 'Montre copie', price: 1500 });
    await owner.post('/safety/reports', { type: 'product', productId: reported.id, reason: 'fraud' }).expect(201);
    expect(await kindsOf(mod)).toContain('report_opened');

    // count, read one, read all (and the read is pushed to the admin's other tabs)
    const unread = (await mod.get('/admin/notifications/unread-count').expect(200)).body.data.count;
    expect(unread).toBeGreaterThanOrEqual(2);
    const first = (await mod.get('/admin/notifications?unread=true').expect(200)).body.data[0];
    expect((await mod.post(`/admin/notifications/${first.id}/read`, {}).expect(200)).body.data.unreadCount).toBe(unread - 1);
    await mod.post(`/admin/notifications/${(await sa.get('/admin/notifications').expect(200)).body.data[0].id}/read`, {}).expect(404); // someone else's
    expect((await mod.post('/admin/notifications/read-all', {}).expect(200)).body.data.unreadCount).toBe(0);
    expect((await mod.get('/admin/notifications/unread-count').expect(200)).body.data.count).toBe(0);

    // one notification per event, whatever runs twice
    const rows = await db.notification.count({ where: { type: 'platform_admin', userId: sa.userId, data: { path: ['kind'], equals: 'workspace_created' } } });
    expect(rows).toBe(1);
    // the merchant's own notifications never list them
    const mine = (await owner.get('/notifications').expect(200)).body.data as { type: string }[];
    expect(mine.some((n) => n.type === 'platform_admin')).toBe(false);
    expect(((await owner.get('/notification-preferences').expect(200)).body.data as { type: string }[]).some((p) => p.type === 'platform_admin')).toBe(false);
  });
});
