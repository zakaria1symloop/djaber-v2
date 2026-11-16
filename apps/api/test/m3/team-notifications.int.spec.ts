// Carry-over M1 → M3: in-app notifications for team events (`member.invited`, `member.joined`, `member.role_changed`,
// `workspace.deletion_scheduled`), produced through the notification producer and read through the notification centre.
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { db, mailsTo, PASSWORD, register, setPassword, tokenOf, uniqEmail } from '../support/m1';
import { NotificationProducer } from '../../src/modules/notifications/notification.producer';
import { adjust, createProduct } from '../support/m2';
import { work } from '../support/m3';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const typesOf = async (actor: { get: (url: string) => any }) => ((await actor.get('/notifications').expect(200)).body.data as { type: string }[]).map((n) => n.type);

describe('team notifications', () => {
  it('invitation sent / accepted, role changed, deletion scheduled reach the right members', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    await setPassword(app, owner.userId);

    // member.invited → Owner + Admins
    const email = uniqEmail('invite');
    const inv = await owner.post('/workspace/invitations', { email, role: 'operator' }).expect(201);
    await work(app, [owner.workspaceId]);
    expect(await typesOf(owner)).toEqual(['member_invited']);
    expect(await typesOf(admin)).toEqual(['member_invited']);
    expect(await typesOf(operator)).toEqual([]);
    const invited = (await owner.get('/notifications').expect(200)).body.data[0];
    expect(invited).toMatchObject({ group: 'members', deepLink: { web: '/settings/members' }, data: expect.objectContaining({ invitationId: inv.body.data.id, email, role: 'operator' }) });
    expect(invited.title).toContain(email);
    // a resend does not notify again
    await db.invitation.update({ where: { id: inv.body.data.id }, data: { lastSentAt: new Date(Date.now() - 120_000) } });
    await owner.post(`/workspace/invitations/${inv.body.data.id}/resend`).expect(200);
    await work(app, [owner.workspaceId]);
    expect(await typesOf(owner)).toEqual(['member_invited']);

    // member.joined → Owner + Admins, not the newcomer
    const newcomer = await register(app, { email });
    const token = tokenOf((await mailsTo(app, email, 'workspace/invitation'))[0]);
    await newcomer.post(`/invitations/${token}/accept`).expect(200);
    await work(app, [owner.workspaceId]);
    expect(await typesOf(owner)).toEqual(['member_joined', 'member_invited']);
    expect(await typesOf(admin)).toEqual(['member_joined', 'member_invited']);
    const joined = await db.notification.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, type: 'member_joined', userId: owner.userId } });
    expect(joined.data).toMatchObject({ userId: newcomer.userId, role: 'operator', name: 'Amine Benali' });
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, userId: newcomer.userId } })).toBe(0);

    // member.role_changed → the member concerned
    const opMembership = await db.membership.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, userId: operator.userId } });
    await owner.patch(`/workspace/members/${opMembership.id}`, { role: 'admin' }).expect(200);
    await work(app, [owner.workspaceId]);
    const changed = await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'member_role_changed' } });
    expect(changed.map((n) => [n.userId, (n.data as { from: string; to: string }).from, (n.data as { to: string }).to])).toEqual([[operator.userId, 'operator', 'admin']]);

    // workspace.deletion_scheduled → the Owner
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
    await owner.delete('/workspace').send({ password: PASSWORD, confirmName: ws.name }).expect(200);
    await work(app, [owner.workspaceId]);
    const scheduled = await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'workspace_deletion_scheduled' } });
    expect(scheduled.map((n) => n.userId)).toEqual([owner.userId]);
    expect((await owner.get('/notifications?group=platform').expect(200)).body.data[0]).toMatchObject({ type: 'workspace_deletion_scheduled', deepLink: { web: '/settings/danger' } });
  });

  it('notification texts reach the reader fully rendered: no {placeholder} in titles or bodies (centre and WebSocket)', async () => {
    const owner = await asOwner(app);
    const product = await createProduct(owner, { name: 'Théière en cuivre', stock: 10, minStock: 4 });
    await adjust(owner, { productId: product.id, type: 'set', quantity: 3, reason: 'inventory' }).expect(201); // low
    const other = await createProduct(owner, { name: 'Plateau', stock: 2, minStock: 1 });
    await adjust(owner, { productId: other.id, type: 'set', quantity: 0, reason: 'inventory' }).expect(201); // out
    const exported = await owner.get('/products/export').expect(202); // a job that finishes
    await work(app, [owner.workspaceId]);

    const rows = (await owner.get('/notifications').expect(200)).body.data as { type: string; title: string; body: string }[];
    const by = (type: string) => rows.find((n) => n.type === type)!;
    expect(by('stock_low')).toMatchObject({ title: 'Stock faible : Théière en cuivre (stock 3)', body: 'Seuil : 4. Une seule alerte par jour et par produit.' });
    expect(by('stock_out')).toMatchObject({ title: 'Rupture : Plateau' });
    expect(by('job_finished').title).toBe('Tâche terminée : Export'); // UX-059: the job kind in words
    expect(exported.body.data.jobId).toBeTruthy();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const locale of ['fr', 'ar', 'en']) {
      const localized = (await owner.get('/notifications').set('Accept-Language', locale).expect(200)).body.data as { title: string; body: string }[];
      for (const n of localized) expect(`${n.title}\n${n.body}`).not.toMatch(/[{}]/);
    }
    // a row stored before the parameters were named like the placeholders (M2 data) still reads correctly
    await db.notification.create({ data: { workspaceId: owner.workspaceId, userId: owner.userId, type: 'stock_low', title: {}, body: {}, data: { productId: product.id, name: 'Ancien produit', stock: 1, minStock: 2 } } });
    await db.notification.create({ data: { workspaceId: owner.workspaceId, userId: owner.userId, type: 'stock_out', title: {}, body: {}, data: {} } });
    const again = (await owner.get('/notifications').expect(200)).body.data as { type: string; title: string; body: string }[];
    expect(again.map((n) => n.title)).toEqual(expect.arrayContaining(['Stock faible : Ancien produit (stock 1)', 'Rupture :']));
    for (const n of again) expect(`${n.title}\n${n.body}`).not.toMatch(/[{}]/);
    // a producer that forgets a declared text parameter is caught when it emits (tests) instead of showing "{product}"
    const producer = app.app.get(NotificationProducer);
    await expect(db.$transaction((tx) => producer.emit(tx as never, { type: 'stock_low', workspaceId: owner.workspaceId, key: 'k', data: { stock: 1 } }))).rejects.toThrow(/stock_low: missing text parameters product, min/);
  });
});
