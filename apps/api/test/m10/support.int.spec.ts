// M10 — support tickets (merchant HELP + ADM-12) and the help center (D38, D46): AT-HELP-02, AT-HELP-03, AT-HELP-04 (API),
// canned replies, roles per platform role and merchant role, cross-workspace 404, TICKET_CLOSED, audit rows, attachments.
import request from 'supertest';
import { rawPrisma as db } from '@djaber/db';
import { SupportTicketService } from '../../src/modules/admin-ops/support/support-ticket.service';
import { asAdmin, asOperator, asOwner, anonymous, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { drain } from '../support/m2';
import { platformUser } from '../support/m10-ops';
import { TokenService } from '../../src/core/auth/token.service';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const MSG = 'Ma page Facebook ne reçoit plus les messages depuis ce matin.';
/** Platform users have 2FA (TWO_FA_REQUIRED_FOR_ROLE): shared fixture of the M10 suites. */
const platform = (role: string) => platformUser(app, role);
const ticket = async (actor: Actor, over: Record<string, unknown> = {}) => {
  const res = await actor.post('/support/tickets', { category: 'meta_connection', message: MSG, context: { page: '/channels', plan: 'pro' }, ...over });
  if (res.status !== 201) throw new Error(`create ticket ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; number: string; slaDueAt: string };
};
const uploadFile = (actor: { headers: Record<string, string> }, kind: string, buffer: Buffer, name: string, type: string) =>
  request(app.http()).post('/api/v1/uploads').set(actor.headers).field('kind', kind).attach('file', buffer, { filename: name, contentType: type });
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

describe('merchant tickets (HELP-03 / HELP-04)', () => {
  it('AT-HELP-02 contact form: < 20 chars ⇒ 422; valid ⇒ open ticket with an auto-context message (no customer messages), list row; Operator: no billing (403), own tickets only, Admin+ all', async () => {
    const owner = await asOwner(app);
    const short = await owner.post('/support/tickets', { category: 'other', message: 'trop court' }).expect(422);
    expect(short.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { message: 'validation.length' } });

    const created = await ticket(owner);
    expect(created.number).toMatch(/^T-\d{4}-\d{5}$/);
    const row = await db.supportTicket.findUniqueOrThrow({ where: { id: created.id }, include: { messages: { orderBy: { at: 'asc' } } } });
    expect(row).toMatchObject({ status: 'open', channel: 'web', priority: 'normal', slaHours: 1, workspaceId: owner.workspaceId, userId: owner.userId });
    expect(row.messages.map((m) => m.authorKind)).toEqual(['system', 'user']);
    expect(row.messages[0]!.body).toContain('page: /channels');
    expect(row.messages[1]!.body).toBe(MSG);
    const second = await ticket(owner, { category: 'billing', priority: 'urgent', subject: 'Facture introuvable' });
    expect(Number(second.number.slice(-5))).toBe(Number(created.number.slice(-5)) + 1);

    const op = await asOperator(app, owner.workspaceId);
    expect((await op.post('/support/tickets', { category: 'billing', message: MSG }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const mine = await ticket(op, { category: 'stock' });
    const opList = (await op.get('/support/tickets').expect(200)).body;
    expect(opList.data.map((t: any) => t.id)).toEqual([mine.id]);
    await op.get('/support/tickets?scope=workspace').expect(403);
    await op.get(`/support/tickets/${created.id}`).expect(404);

    const admin = await asAdmin(app, owner.workspaceId);
    const all = (await admin.get('/support/tickets?scope=workspace').expect(200)).body;
    expect(all.meta.total).toBe(3);
    const detail = (await admin.get(`/support/tickets/${created.id}`).expect(200)).body.data;
    expect(detail).toMatchObject({ number: created.number, status: 'open', awaitingMe: false, category: 'meta_connection', context: { page: '/channels' } });
    expect(detail.messages).toHaveLength(2);

    const stranger = await asOwner(app);
    await stranger.get(`/support/tickets/${created.id}`).expect(404);
    await stranger.post(`/support/tickets/${created.id}/messages`, { body: 'hello' }).expect(404);
  });

  it('AT-HELP-03 support answer ⇒ firstResponseAt + support.reply + pending_customer; merchant reply ⇒ open; resolve ⇒ resolved; rate ⇒ closed; closed ⇒ TICKET_CLOSED; 30 d after resolvedAt the job closes', async () => {
    const owner = await asOwner(app);
    const t = await ticket(owner);
    const support = await platform('support');

    const answered = (await support.post(`/admin/support/tickets/${t.id}/messages`, { body: 'Bonjour, reconnectez la page depuis Pages connectées.', cannedReplyKey: undefined }).expect(201)).body.data;
    expect(answered).toMatchObject({ status: 'pending_customer', assignee: { id: support.userId } });
    expect(answered.firstResponseAt).not.toBeNull();
    await support.post(`/admin/support/tickets/${t.id}/messages`, { body: 'Note interne : vérifier le token', isInternal: true }).expect(201);
    await drain(app, owner.workspaceId, ['notification']);
    const notes = await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'support_reply', userId: owner.userId } });
    expect(notes).toHaveLength(1);
    const seen = (await owner.get(`/support/tickets/${t.id}`).expect(200)).body.data;
    expect(seen).toMatchObject({ status: 'pending_customer', awaitingMe: true });
    expect(seen.messages.map((m: any) => m.authorKind)).toEqual(['system', 'user', 'support']); // internal note hidden
    const adminView = (await support.get(`/admin/support/tickets/${t.id}`).expect(200)).body.data;
    expect(adminView.internalNotes).toBe(true);
    expect(adminView.messages.filter((m: any) => m.isInternal)).toHaveLength(1);

    const replied = (await owner.post(`/support/tickets/${t.id}/messages`, { body: 'C’est fait, merci !' }).expect(201)).body.data;
    expect(replied).toMatchObject({ status: 'open', awaitingMe: false });
    await owner.post(`/support/tickets/${t.id}/rate`, { score: 5 }).expect(409); // not resolved yet
    const resolved = (await support.post(`/admin/support/tickets/${t.id}/resolve`, { note: 'Page reconnectée' }).expect(200)).body.data;
    expect(resolved.status).toBe('resolved');
    await owner.post(`/support/tickets/${t.id}/rate`, { score: 6 }).expect(422);
    const rated = (await owner.post(`/support/tickets/${t.id}/rate`, { score: 5, note: 'Rapide' }).expect(200)).body.data;
    expect(rated).toMatchObject({ status: 'closed', satisfaction: 5, satisfactionNote: 'Rapide' });
    expect((await owner.post(`/support/tickets/${t.id}/messages`, { body: 'Encore une question' }).expect(409)).body.error.code).toBe('TICKET_CLOSED');
    expect((await support.post(`/admin/support/tickets/${t.id}/messages`, { body: 'Réponse' }).expect(409)).body.error.code).toBe('TICKET_CLOSED');
    // admin can reopen a closed ticket
    expect((await support.post(`/admin/support/tickets/${t.id}/reopen`, {}).expect(200)).body.data.status).toBe('open');

    // daily close job
    const old = await ticket(owner);
    await db.supportTicket.update({ where: { id: old.id }, data: { status: 'resolved', resolvedAt: new Date(Date.now() - 31 * 86400_000) } });
    const recent = await ticket(owner);
    await db.supportTicket.update({ where: { id: recent.id }, data: { status: 'resolved', resolvedAt: new Date(Date.now() - 5 * 86400_000) } });
    await app.app.get(SupportTicketService).autoClose();
    expect((await db.supportTicket.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('closed');
    expect((await db.supportTicket.findUniqueOrThrow({ where: { id: recent.id } })).status).toBe('resolved');

    // merchant close
    const c = await ticket(owner);
    expect((await owner.post(`/support/tickets/${c.id}/close`).expect(200)).body.data.status).toBe('closed');
  });

  it('AT-HELP-04 SLA from the plan (Pro 1 business hour, Free one business day); overdue ⇒ slaBreached, sorted first, counted in stats and the SLA sweep', async () => {
    const pro = await asOwner(app, 'pro');
    const free = await asOwner(app, 'free');
    const a = await ticket(pro);
    const b = await ticket(free);
    expect((await db.supportTicket.findUniqueOrThrow({ where: { id: a.id } })).slaHours).toBe(1);
    expect((await db.supportTicket.findUniqueOrThrow({ where: { id: b.id } })).slaHours).toBe(24);
    await db.supportTicket.update({ where: { id: b.id }, data: { slaDueAt: new Date(Date.now() - 10 * 60_000) } });
    const read = await platform('read');
    const late = (await read.get('/admin/support/tickets?slaBreached=true&pageSize=100').expect(200)).body;
    expect(late.data.map((t: any) => t.id)).toContain(b.id);
    expect(late.data.every((t: any) => t.slaBreached)).toBe(true);
    const row = late.data.find((t: any) => t.id === b.id);
    expect(row.slaRemainingMin).toBeLessThan(0);
    expect(row.messages).toEqual([]);
    expect(row).toMatchObject({ workspace: { id: free.workspaceId, plan: 'free' }, user: { id: free.userId, role: 'owner' } });
    const open = (await read.get('/admin/support/tickets?status=open&pageSize=100').expect(200)).body.data;
    const firstBreached = open.findIndex((t: any) => t.slaBreached);
    const firstOk = open.findIndex((t: any) => !t.slaBreached);
    expect(firstBreached).toBeLessThan(firstOk === -1 ? Infinity : firstOk);
    const stats = (await read.get('/admin/support/stats?period=30d').expect(200)).body.data;
    expect(stats.overSla).toBeGreaterThanOrEqual(1);
    expect(stats.tabs.open).toBeGreaterThanOrEqual(2);
    const sweep = await app.app.get(SupportTicketService).slaSweep();
    expect(sweep.breached).toBeGreaterThanOrEqual(1);
    const queue = await db.outbox.findMany({ where: { topic: 'ws' }, orderBy: { createdAt: 'desc' }, take: 50 });
    expect(queue.some((r) => (r.payload as any).event === 'tickets.queue')).toBe(true);
    expect(queue.some((r) => (r.payload as any).event === 'platform.alert' && (r.payload as any).payload.kind === 'sla_breach')).toBe(true);
  });
});

describe('admin tickets (ADM-12)', () => {
  it('roles: read for every platform role, writes for support + super_admin only, merchant users 403; audit rows', async () => {
    const owner = await asOwner(app);
    const t = await ticket(owner);
    for (const role of ['moderator', 'finance', 'read']) {
      const a = await platform(role);
      await a.get(`/admin/support/tickets/${t.id}`).expect(200);
      expect((await a.post(`/admin/support/tickets/${t.id}/messages`, { body: 'Bonjour' }).expect(403)).body.error.code).toBe('FORBIDDEN');
      await a.post(`/admin/support/tickets/${t.id}/resolve`, {}).expect(403);
      await a.post('/admin/support/canned-replies', { key: '/x-test', title: 'X', body: { fr: 'x' } }).expect(403);
    }
    await owner.get('/admin/support/tickets').expect(403);
    await owner.post(`/admin/support/tickets/${t.id}/messages`, { body: 'Bonjour' }).expect(403);

    const sa = await platform('super_admin');
    const detail = (await sa.get(`/admin/support/tickets/${t.id}`).expect(200)).body.data;
    expect(detail.actions.find((x: any) => x.key === 'reply')).toMatchObject({ enabled: true, primary: true });
    const read = await platform('read');
    const ro = (await read.get(`/admin/support/tickets/${t.id}`).expect(200)).body.data;
    expect(ro.actions.find((x: any) => x.key === 'reply')).toMatchObject({ enabled: false, reasonCode: 'FORBIDDEN' });

    await sa.post(`/admin/support/tickets/${t.id}/assign`, { assigneeId: owner.userId }).expect(422); // not a support agent
    const support = await platform('support');
    expect((await sa.post(`/admin/support/tickets/${t.id}/assign`, { assigneeId: support.userId }).expect(200)).body.data.assignee.id).toBe(support.userId);
    await sa.post(`/admin/support/tickets/${t.id}/escalate`, {}).expect(422);
    const esc = (await sa.post(`/admin/support/tickets/${t.id}/escalate`, { note: 'Bug webhook Meta côté plateforme' }).expect(200)).body.data;
    expect(esc).toMatchObject({ escalationNote: 'Bug webhook Meta côté plateforme', priority: 'high' });
    expect(esc.escalatedAt).not.toBeNull();
    const inc = await db.incident.create({ data: { title: { fr: 'Webhooks Meta en retard' }, createdById: sa.userId } });
    expect((await sa.post(`/admin/support/tickets/${t.id}/link-incident`, { incidentId: inc.id }).expect(200)).body.data.incident).toEqual({ id: inc.id, title: 'Webhooks Meta en retard' });
    await sa.post(`/admin/support/tickets/${t.id}/link-incident`, { incidentId: '00000000-0000-7000-8000-000000000000' }).expect(422);
    expect((await sa.post(`/admin/support/tickets/${t.id}/wait-customer`, {}).expect(200)).body.data.status).toBe('pending_customer');
    await sa.post(`/admin/support/tickets/${t.id}/wait-customer`, {}).expect(409);
    await sa.get('/admin/support/tickets/00000000-0000-7000-8000-000000000000').expect(404);

    const audit = await db.auditLog.findMany({ where: { entity: 'SupportTicket', entityId: t.id }, orderBy: { at: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['support.assign', 'support.escalate', 'support.link_incident', 'support.wait_customer']));
    const escAudit = audit.find((a) => a.action === 'support.escalate')!;
    expect(escAudit).toMatchObject({ actorType: 'admin', actorId: sa.userId, actorRole: 'super_admin', reason: 'Bug webhook Meta côté plateforme', workspaceId: owner.workspaceId });
  });

  it('admin creates a ticket for a member (e-mail / chat); filters; 422 for a non-member', async () => {
    const owner = await asOwner(app);
    const support = await platform('support');
    await support.post('/admin/support/tickets', { workspaceId: owner.workspaceId, userId: support.userId, subject: 'Appel entrant', category: 'other', channel: 'chat' }).expect(422);
    await support.post('/admin/support/tickets', { workspaceId: owner.workspaceId, userId: owner.userId, subject: 'Appel entrant', category: 'other', channel: 'phone' }).expect(422);
    const created = (await support.post('/admin/support/tickets', { workspaceId: owner.workspaceId, userId: owner.userId, subject: 'Appel entrant', category: 'credits', channel: 'email', message: 'Le client demande un remboursement de crédits.' }).expect(201)).body.data;
    expect(created).toMatchObject({ channel: 'email', category: 'credits', status: 'open', assignee: { id: support.userId } });
    expect(created.messages).toHaveLength(1);
    const filtered = (await support.get(`/admin/support/tickets?channel=email&category=credits&workspaceId=${owner.workspaceId}&assigneeId=me`).expect(200)).body;
    expect(filtered.data.map((t: any) => t.id)).toEqual([created.id]);
    const q = (await support.get(`/admin/support/tickets?q=${created.number}`).expect(200)).body;
    expect(q.data[0].id).toBe(created.id);
    await support.get('/admin/support/tickets?status=nope').expect(422);
  });

  it('canned replies CRUD (409 duplicate key, 422 invalid key) and use in an answer', async () => {
    const sa = await platform('super_admin');
    const key = `/test-${Date.now().toString(36)}`;
    await sa.post('/admin/support/canned-replies', { key: 'no-slash', title: 'X', body: { fr: 'x' } }).expect(422);
    const c = (await sa.post('/admin/support/canned-replies', { key, title: 'Test', body: { fr: 'Bonjour', ar: 'مرحبا', en: 'Hello' }, category: 'other' }).expect(201)).body.data;
    expect(c).toMatchObject({ key, title: 'Test', body: { fr: 'Bonjour' } });
    await sa.post('/admin/support/canned-replies', { key, title: 'Again', body: { fr: 'x' } }).expect(409);
    expect((await sa.patch(`/admin/support/canned-replies/${c.id}`, { title: 'Renamed' }).expect(200)).body.data.title).toBe('Renamed');
    expect((await sa.get('/admin/support/canned-replies').expect(200)).body.data.map((x: any) => x.key)).toContain(key);
    const owner = await asOwner(app);
    const t = await ticket(owner);
    await sa.post(`/admin/support/tickets/${t.id}/messages`, { body: 'x', cannedReplyKey: '/missing' }).expect(422);
    await sa.post(`/admin/support/tickets/${t.id}/messages`, { body: 'Bonjour', cannedReplyKey: key }).expect(201);
    expect((await db.supportMessage.findFirstOrThrow({ where: { ticketId: t.id, authorKind: 'support' } })).cannedReplyKey).toBe(key);
    await sa.delete(`/admin/support/canned-replies/${c.id}`).expect(200);
    await sa.delete(`/admin/support/canned-replies/${c.id}`).expect(404);
    expect(await db.auditLog.count({ where: { entity: 'CannedReply', entityId: c.id } })).toBe(3);
  });
});

describe('attachments and help center', () => {
  it('ticket attachments: images / PDF / CSV for every member, other workspace upload ⇒ 422, binary ⇒ 415; appeal attachment accepts PDF', async () => {
    const owner = await asOwner(app);
    const op = await asOperator(app, owner.workspaceId);
    const pdf = (await uploadFile(op, 'ticket_attachment', PDF, 'facture.pdf', 'application/pdf').expect(201)).body.data;
    expect(pdf).toMatchObject({ mime: 'application/pdf' });
    const csv = (await uploadFile(op, 'ticket_attachment', Buffer.from('a,b\n1,2\n'), 'export.csv', 'text/csv').expect(201)).body.data;
    expect(csv.mime).toBe('text/csv');
    await uploadFile(op, 'ticket_attachment', Buffer.from([0, 1, 2, 3, 4, 5]), 'x.bin', 'application/octet-stream').expect(415);
    const t = await ticket(op, { attachments: [pdf.id, csv.id] });
    const msgs = (await op.get(`/support/tickets/${t.id}`).expect(200)).body.data.messages;
    expect(msgs.at(-1).attachments).toHaveLength(2);
    const other = await asOwner(app);
    const foreign = (await uploadFile(other, 'ticket_attachment', PDF, 'f.pdf', 'application/pdf').expect(201)).body.data;
    expect((await op.post(`/support/tickets/${t.id}/messages`, { body: 'Voici', attachments: [foreign.id] }).expect(422)).body.error.fields.attachments).toBe('validation.invalid');
    // tester report 25/10 UX-002: the merchant attaches files to a reply too
    const shot = (await uploadFile(op, 'ticket_attachment', PDF, 'capture.pdf', 'application/pdf').expect(201)).body.data;
    await op.post(`/support/tickets/${t.id}/messages`, { body: 'Voici la capture', attachments: [shot.id] }).expect(201);
    expect((await op.get(`/support/tickets/${t.id}`).expect(200)).body.data.messages.at(-1)).toMatchObject({ body: 'Voici la capture', attachments: [expect.objectContaining({ url: expect.stringContaining('/ticket_attachment/') })] });
    // platform user answer with its own attachment (no workspace)
    const support = await platform('support');
    const { token } = await app.app.get(TokenService).signAccess({ sub: support.userId, pr: 'support' });
    const own = (await uploadFile({ headers: { Authorization: `Bearer ${token}` } }, 'ticket_attachment', PDF, 'guide.pdf', 'application/pdf').expect(201)).body.data;
    await support.post(`/admin/support/tickets/${t.id}/messages`, { body: 'Le guide', attachments: [own.id] }).expect(201);
    await support.post(`/admin/support/tickets/${t.id}/messages`, { body: 'Le guide', attachments: [foreign.id] }).expect(422);
    // UX-012 (2026-10-21): a payment proof (manual billing payment, D71) is a platform file of finance; merchants are refused
    const fin = await platform('finance');
    const { token: finToken } = await app.app.get(TokenService).signAccess({ sub: fin.userId, pr: 'finance' });
    const proof = (await uploadFile({ headers: { Authorization: `Bearer ${finToken}` } }, 'payment_proof', PDF, 'recu.pdf', 'application/pdf').expect(201)).body.data;
    expect(await db.upload.findUnique({ where: { id: proof.id } })).toMatchObject({ workspaceId: null, kind: 'payment_proof', createdById: fin.userId });
    expect((await uploadFile(owner, 'payment_proof', PDF, 'x.pdf', 'application/pdf').expect(422)).body.error.fields.kind).toBe('validation.invalid');
    // carry-over M2: appeal attachment PDF (Admin+)
    expect((await uploadFile(owner, 'appeal_attachment', PDF, 'certificat.pdf', 'application/pdf').expect(201)).body.data.mime).toBe('application/pdf');
  });

  it('help articles (public): published only, locale fallback to FR, category / context / search filters, 404 for drafts', async () => {
    const admin = await db.user.findFirstOrThrow({ where: { platformRole: 'super_admin' } });
    const k = `help-test-${Date.now().toString(36)}`;
    await db.cmsEntry.create({
      data: {
        key: k,
        type: 'help',
        category: 'stock',
        target: { pages: ['inventory-test'] },
        status: 'published',
        currentVersion: 2,
        createdById: admin.id,
        locales: { create: [{ locale: 'fr', title: 'Lancer un inventaire', body: 'Ouvrez **Stock** puis Inventaire.', status: 'published', updatedById: admin.id }, { locale: 'ar', title: 'مسودة', body: 'مسودة', status: 'draft', updatedById: admin.id }] },
      },
    });
    await db.cmsEntry.create({ data: { key: `${k}-draft`, type: 'help', category: 'stock', status: 'draft', createdById: admin.id, locales: { create: [{ locale: 'fr', title: 'Brouillon', body: 'x', status: 'draft', updatedById: admin.id }] } } });
    const anon = anonymous(app);
    const ar = (await anon.get(`/help/articles?context=inventory-test&lang=ar`).expect(200)).body.data;
    expect(ar).toHaveLength(1);
    expect(ar[0]).toMatchObject({ key: k, locale: 'fr', requestedLocale: 'ar', fallback: true, title: 'Lancer un inventaire', category: 'stock', contexts: ['inventory-test'], version: 2 });
    expect(ar[0].body).toBeUndefined();
    expect(ar[0].excerpt).toBe('Ouvrez Stock puis Inventaire.');
    const search = (await anon.get('/help/articles?q=inventaire&category=stock').expect(200)).body.data;
    expect(search.map((a: any) => a.key)).toContain(k);
    expect(search.map((a: any) => a.key)).not.toContain(`${k}-draft`);
    await anon.get('/help/articles?category=nope').expect(422);
    const one = (await anon.get(`/help/articles/${k}`).set('Accept-Language', 'en').expect(200)).body.data;
    expect(one).toMatchObject({ fallback: true, body: 'Ouvrez **Stock** puis Inventaire.' });
    await anon.get(`/help/articles/${k}-draft`).expect(404);
    const owner = await asOwner(app);
    expect((await owner.get('/help/articles').expect(200)).body.data.map((a: any) => a.key)).toContain(k);
  });
});
