// M3 — INB-01…09 (API side of AT-INB-01…13): inbox list with tabs / counts / filters / search, thread, composer,
// pause / resume AI, statuses, assignment, notes, client panel, soft delete, bulk actions, block / report (D37),
// handoff reminder, notification centre. Role matrix and cross-workspace 404 on every id.
import sharp from 'sharp';
import { REPLY_MAX_CHARS } from '@djaber/shared';
import { TenantContext } from '@djaber/db';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import { FakeMetaGateway } from '../../src/modules/meta/fake-meta.gateway';
import { ConversationService } from '../../src/modules/messaging/conversation.service';
import { OutboundSendService } from '../../src/modules/messaging/outbound-send.service';
import { asAdmin, asOperator, asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually } from '../support/m1';
import { createProduct, testAgent, testOrder, upload } from '../support/m2';
import { connectedPage, db, fakeMeta, forbidNetwork, idem, instagramChild, newSender, receive, reply, work, wsOf } from '../support/m3';

let app: TestApp;
let meta: FakeMetaGateway;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  net = forbidNetwork();
  app = await createTestApp();
  meta = fakeMeta(app);
});
afterAll(async () => {
  expect(net.spy).not.toHaveBeenCalled();
  net.restore();
  await app.close();
});

const HOUR = 3600_000;
const sendsTo = (sender: string) => meta.callsOf('send').filter((c) => c.args.recipientId === sender);
const setup = async (plan = 'pro') => {
  const owner = await asOwner(app, plan);
  const channel = await connectedPage(owner, app);
  return { owner, channel };
};
const thread = async (actor: Actor, id: string) => (await actor.get(`/conversations/${id}/messages`).expect(200)).body.data as any[];
const detail = async (actor: Actor, id: string) => (await actor.get(`/conversations/${id}`).expect(200)).body.data;
const ago = (ms: number) => new Date(Date.now() - ms);

describe('INB-07 real time (events leave through the outbox)', () => {
  it('AT-INB-01 a message arrives ⇒ message.created for the workspace room; read mark clears unread for everyone', async () => {
    const { owner, channel } = await setup();
    const op = await asOperator(app, owner.workspaceId);
    const { conversation, message } = await receive(app, channel, newSender(), { text: 'Salam, dispo ?' });
    const created = (await wsOf(`ws:${owner.workspaceId}`, 'message.created')).filter((e) => e.payload.conversationId === conversation.id);
    expect(created).toHaveLength(1);
    expect(created[0]!.payload).toMatchObject({
      message: { id: message!.id, direction: 'in', author: 'customer', text: 'Salam, dispo ?', deliveryStatus: 'sent', attachments: [] },
      conversation: { id: conversation.id, status: 'active', unreadCount: 1, aiPaused: false, lastMessagePreview: 'Salam, dispo ?' },
    });
    // both members see it unread
    for (const who of [owner, op]) expect((await who.get('/conversations').expect(200)).body.data[0]).toMatchObject({ id: conversation.id, unreadCount: 1 });
    // one opens the thread ⇒ unread 0, pushed to the other browser
    expect((await op.post(`/conversations/${conversation.id}/read`).expect(200)).body.data).toEqual({ id: conversation.id, unreadCount: 0 });
    const updated = (await wsOf(`ws:${owner.workspaceId}`, 'conversation.updated')).filter((e) => e.payload.conversation.id === conversation.id);
    expect(updated[updated.length - 1]!.payload.conversation).toMatchObject({ unreadCount: 0 });
    expect((await owner.get('/conversations').expect(200)).body.data[0].unreadCount).toBe(0);
    // mark unread again
    expect((await owner.post(`/conversations/${conversation.id}/unread`).expect(200)).body.data.unreadCount).toBe(1);
    expect((await owner.get('/conversations/counts').expect(200)).body.data.unread).toBe(1);
  });

  it('AT-INB-06 after a disconnection the list and the thread return everything that was missed (polling fallback / resync)', async () => {
    const { owner, channel } = await setup();
    const sender = newSender();
    const first = await receive(app, channel, sender, { text: 'un' });
    const seen = (await owner.get('/conversations').expect(200)).body.data[0];
    // while the socket is down: two more messages and a status change by a teammate
    await receive(app, channel, sender, { text: 'deux' });
    await receive(app, channel, sender, { text: 'trois' });
    const admin = await asAdmin(app, owner.workspaceId);
    await admin.patch(`/conversations/${first.conversation.id}`, { status: 'resolved', version: seen.version }).expect(200);
    const polled = (await owner.get('/conversations').expect(200)).body.data[0];
    expect(polled).toMatchObject({ id: first.conversation.id, status: 'resolved', unreadCount: 3, lastMessagePreview: 'trois' });
    expect(polled.version).toBeGreaterThan(seen.version);
    expect((await thread(owner, first.conversation.id)).map((m) => m.text)).toEqual(['trois', 'deux', 'un']);
  });
});

describe('INB-03 / INB-04 composer', () => {
  it('no agent on the page: "pause / resume the AI" are greyed with CONVERSATION_NO_AGENT (`pageHasAgent` on rows); linking an agent enables them', async () => {
    const { owner, channel } = await setup();
    const { conversation } = await receive(app, channel, newSender(), { text: 'Salam' });
    const row = (await owner.get('/conversations').expect(200)).body.data.find((c: any) => c.id === conversation.id);
    expect(row).toMatchObject({ pageHasAgent: false, agent: null });
    const before = await detail(owner, conversation.id);
    expect(before).toMatchObject({ pageHasAgent: false, agent: null });
    expect(before.actions.find((a: any) => a.key === 'pauseAi')).toEqual({ key: 'pauseAi', enabled: false, reasonCode: 'CONVERSATION_NO_AGENT' });
    expect(before.actions.find((a: any) => a.key === 'resumeAi')).toEqual({ key: 'resumeAi', enabled: false, reasonCode: 'CONVERSATION_NO_AGENT' });

    const agent = await testAgent(owner.workspaceId);
    await db.agentChannel.create({ data: { agentId: agent.id, channelId: channel.id } });
    const after = await detail(owner, conversation.id);
    expect(after.pageHasAgent).toBe(true);
    expect(after.actions.find((a: any) => a.key === 'pauseAi')).toEqual({ key: 'pauseAi', enabled: true });
    // resuming an AI that is not paused stays a state refusal, without a reason code
    expect(after.actions.find((a: any) => a.key === 'resumeAi')).toEqual({ key: 'resumeAi', enabled: false });
    expect((await owner.get('/conversations').expect(200)).body.data.find((c: any) => c.id === conversation.id).pageHasAgent).toBe(true);
  });

  it('AT-INB-02 human reply ⇒ AI paused; customer replies ⇒ AI silent, notification to the assignee; Resume ⇒ AI back on', async () => {
    const { owner, channel } = await setup();
    const agent = await testAgent(owner.workspaceId);
    await db.agentChannel.create({ data: { agentId: agent.id, channelId: channel.id } });
    const op = await asOperator(app, owner.workspaceId);
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'Bonjour' });
    expect(await detail(op, conversation.id)).toMatchObject({ aiPaused: false, assignee: null, agent: { id: agent.id } });

    const sent = await reply(op, conversation.id, { text: 'Bonjour, je regarde ça.' }).expect(201);
    expect(sent.body.data).toMatchObject({ direction: 'out', author: 'human', deliveryStatus: 'pending', authorUser: { id: op.userId } });
    const paused = await detail(op, conversation.id);
    expect(paused).toMatchObject({ aiPaused: true, status: 'active', assignee: { id: op.userId }, aiPausedBy: { id: op.userId }, unreadCount: 0 });
    await work(app, [owner.workspaceId]);
    expect((await thread(op, conversation.id))[0]).toMatchObject({ id: sent.body.data.id, deliveryStatus: 'sent' });
    expect(sendsTo(sender)[0]!.args).toMatchObject({ messagingType: 'RESPONSE', message: { kind: 'text', text: 'Bonjour, je regarde ça.' } });

    // the customer answers while a human handles the thread: no automatic text, the assignee is told (once per 10 minutes)
    await receive(app, channel, sender, { text: 'merci' });
    await receive(app, channel, sender, { text: 'vous êtes là ?' });
    expect(sendsTo(sender)).toHaveLength(1);
    const notes = await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'conversation_needs_human_message' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: op.userId, data: expect.objectContaining({ conversationId: conversation.id, preview: 'merci' }) });
    const centre = (await op.get('/notifications').expect(200)).body.data;
    expect(centre[0]).toMatchObject({ type: 'conversation_needs_human_message', group: 'queue', deepLink: { web: `/inbox/${conversation.id}`, mobile: `djaber://inbox/${conversation.id}` }, readAt: null });
    expect(centre[0].title).toContain('a répondu');
    expect((await owner.get('/notifications').expect(200)).body.data).toEqual([]); // only the assignee

    // Resume AI
    const before = await detail(op, conversation.id);
    const resumed = await op.patch(`/conversations/${conversation.id}`, { aiPaused: false, version: before.version }).expect(200);
    expect(resumed.body.data).toMatchObject({ aiPaused: false, status: 'active', aiPausedBy: null });
    await receive(app, channel, sender, { text: 'et maintenant ?' });
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'conversation_needs_human_message' } })).toBe(1);

    // workspace setting off ⇒ a manual reply does not pause
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { autoPauseOnManualReply: false } });
    await reply(op, conversation.id, { text: 'encore moi' }).expect(201);
    expect((await detail(op, conversation.id)).aiPaused).toBe(false);
  });

  it('AT-INB-03 reply outside 24 h on IG ⇒ REPLY_OUTSIDE_WINDOW, nothing stored; on Messenger ⇒ HUMAN_AGENT tag up to 7 days once the app is approved (META_HUMAN_AGENT_TAG), refused before', async () => {
    const { owner, channel } = await setup();
    const ig = (await instagramChild(channel.id))!;
    const igSender = newSender();
    const fbSender = newSender();
    const insta = await receive(app, ig, igSender, { text: 'Salam' });
    const fb = await receive(app, channel, fbSender, { text: 'Salam' });
    await db.conversation.updateMany({ where: { id: { in: [insta.conversation.id, fb.conversation.id] } }, data: { lastCustomerMessageAt: ago(25 * HOUR) } });

    const refused = await reply(owner, insta.conversation.id, { text: 'Désolé du retard' }).expect(422);
    expect(refused.body.error.code).toBe('REPLY_OUTSIDE_WINDOW');
    expect(await db.message.count({ where: { conversationId: insta.conversation.id, direction: 'out' } })).toBe(0);
    expect(await detail(owner, insta.conversation.id)).toMatchObject({ within24h: false, composer: { canSend: false, reasonCode: 'REPLY_OUTSIDE_WINDOW', humanAgentTag: false }, aiPaused: false, assignee: null });

    // Messenger, app not approved for Human Agent (the default — Meta refuses the tag with #100/2018276, tester account
    // 26/10): refused at once like on Instagram, nothing stored
    expect((await detail(owner, fb.conversation.id)).composer).toMatchObject({ canSend: false, reasonCode: 'REPLY_OUTSIDE_WINDOW', within24h: false, humanAgentTag: false });
    expect((await reply(owner, fb.conversation.id, { text: 'Désolé du retard' }).expect(422)).body.error.code).toBe('REPLY_OUTSIDE_WINDOW');
    expect(await db.message.count({ where: { conversationId: fb.conversation.id, direction: 'out' } })).toBe(0);
    // Messenger, app approved: allowed for a human with the HUMAN_AGENT tag
    jest.spyOn(app.app.get(OutboundSendService), 'humanAgentTag', 'get').mockReturnValue(true);
    expect((await detail(owner, fb.conversation.id)).composer).toMatchObject({ canSend: true, reasonCode: null, within24h: false, humanAgentTag: true });
    const tagged = await reply(owner, fb.conversation.id, { text: 'Désolé du retard' }).expect(201);
    expect(tagged.body.data.payload).toMatchObject({ tag: 'HUMAN_AGENT' });
    await work(app, [owner.workspaceId]);
    expect(sendsTo(fbSender)[0]!.args).toMatchObject({ messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
    // beyond 7 days even a human cannot open the thread
    await db.conversation.update({ where: { id: fb.conversation.id }, data: { lastCustomerMessageAt: ago(8 * 24 * HOUR) } });
    expect((await reply(owner, fb.conversation.id, { text: 'trop tard' }).expect(422)).body.error.code).toBe('REPLY_OUTSIDE_WINDOW');
    expect(sendsTo(fbSender)).toHaveLength(1);
    jest.restoreAllMocks();
    // inside the window on Instagram: a plain response
    await db.conversation.update({ where: { id: insta.conversation.id }, data: { lastCustomerMessageAt: new Date() } });
    await reply(owner, insta.conversation.id, { text: 'Bonjour' }).expect(201);
    await work(app, [owner.workspaceId]);
    expect(sendsTo(igSender).map((c) => [c.args.platform, c.args.messagingType])).toEqual([['instagram', 'RESPONSE']]);
    // filter "Dernier message < 24 h (réponse possible)"
    expect((await owner.get('/conversations?lastMessage=lt24h').expect(200)).body.data.map((c: any) => c.id)).toEqual([insta.conversation.id]);
    expect((await owner.get('/conversations?lastMessage=gt24h').expect(200)).body.data.map((c: any) => c.id)).toEqual([fb.conversation.id]);
  });

  it('AT-INB-04 image 6 MB ⇒ error, nothing sent; 4 MB ⇒ sent as attachment with public URL', async () => {
    const { owner, channel } = await setup();
    const op = await asOperator(app, owner.workspaceId);
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'une photo ?' });

    const big = Buffer.alloc(6 * 1024 * 1024, 1);
    const tooLarge = await upload(op, app, '/uploads', 'file', [{ buffer: big, name: 'big.jpg', type: 'image/jpeg' }], { kind: 'reply' }).expect(413);
    expect(tooLarge.body.error.code).toBe('IMAGE_TOO_LARGE');
    expect(sendsTo(sender)).toHaveLength(0);

    const fourMb = await sharp({ create: { width: 1280, height: 1150, channels: 3, background: { r: 10, g: 120, b: 200 }, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png({ compressionLevel: 0 }).toBuffer();
    expect(fourMb.length).toBeGreaterThan(4 * 1024 * 1024);
    expect(fourMb.length).toBeLessThan(5 * 1024 * 1024);
    const up = await upload(op, app, '/uploads', 'file', [{ buffer: fourMb, name: 'photo.png', type: 'image/png' }], { kind: 'reply' }).expect(201);
    const sent = await reply(op, conversation.id, { text: 'Voici', uploadId: up.body.data.id }).expect(201);
    expect(sent.body.data).toMatchObject({ type: 'image', text: 'Voici', attachments: [{ type: 'image', url: up.body.data.url, mime: 'image/webp' }] });
    await work(app, [owner.workspaceId]);
    // Meta receives the image by its public URL, then the text
    expect(sendsTo(sender).map((c) => c.args.message)).toEqual([{ kind: 'attachment', type: 'image', url: up.body.data.url }, { kind: 'text', text: 'Voici' }]);
    // an upload of another workspace / another kind is not a reply image
    const stranger = await asOwner(app);
    const foreign = await upload(stranger, app, '/uploads', 'file', [{ buffer: await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).png().toBuffer(), name: 'x.png', type: 'image/png' }], { kind: 'reply' }).expect(201);
    expect((await reply(op, conversation.id, { uploadId: foreign.body.data.id }).expect(422)).body.error.fields).toEqual({ uploadId: 'validation.invalid' });
  });

  it('text limits, quick replies, template messages and the Idempotency-Key', async () => {
    const { owner, channel } = await setup();
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'Salam' });

    // Idempotency-Key is required; a replay returns the same message without sending twice
    expect((await owner.post(`/conversations/${conversation.id}/messages`, { text: 'x' }).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    const key = idem();
    const one = await owner.post(`/conversations/${conversation.id}/messages`, { text: 'une seule fois' }).set(key).expect(201);
    const two = await owner.post(`/conversations/${conversation.id}/messages`, { text: 'une seule fois' }).set(key).expect(201);
    expect(two.headers['idempotent-replayed']).toBe('true');
    expect(two.body.data.id).toBe(one.body.data.id);
    expect((await owner.post(`/conversations/${conversation.id}/messages`, { text: 'autre corps' }).set(key).expect(422)).body.error.code).toBe('IDEMPOTENCY_MISMATCH');
    await work(app, [owner.workspaceId]);
    expect(sendsTo(sender)).toHaveLength(1);

    // 2000 characters max; empty; unknown fields
    expect((await reply(owner, conversation.id, { text: 'a'.repeat(REPLY_MAX_CHARS + 1) }).expect(422)).body.error.code).toBe('REPLY_TOO_LONG');
    await reply(owner, conversation.id, { text: 'a'.repeat(REPLY_MAX_CHARS) }).expect(201);
    expect((await reply(owner, conversation.id, { text: '   ' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await reply(owner, conversation.id, { text: 'x', workspaceId: 'other' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    // quick reply: the template body is what is sent
    const qr = await owner.post('/workspace/quick-replies', { title: 'Livraison', body: 'Livraison 58 wilayas, 400 à 900 DA.', locale: 'fr' }).expect(201);
    const quick = await reply(owner, conversation.id, { quickReplyId: qr.body.data.id }).expect(201);
    expect(quick.body.data.text).toBe('Livraison 58 wilayas, 400 à 900 DA.');
    const strangerQr = await (await asOwner(app)).post('/workspace/quick-replies', { title: 'Autre', body: 'ailleurs', locale: 'fr' }).expect(201);
    expect((await reply(owner, conversation.id, { quickReplyId: strangerQr.body.data.id }).expect(422)).body.error.fields).toEqual({ quickReplyId: 'validation.invalid' });

    // template message: placeholders from the conversation's last order
    expect((await reply(owner, conversation.id, { templateKey: 'orderDelivered' }).expect(422)).body.error.fields).toEqual({ templateKey: 'validation.invalid' });
    const product = await createProduct(owner);
    const order = await testOrder(owner.workspaceId, product, { number: 'CMD-1042' });
    await db.order.update({ where: { id: order.id }, data: { conversationId: conversation.id } });
    const tpl = await reply(owner, conversation.id, { templateKey: 'orderDelivered' }).expect(201);
    expect(tpl.body.data).toMatchObject({ text: 'Votre commande #CMD-1042 a été livrée. Merci !', payload: { templateKey: 'orderDelivered' }, author: 'human' });
    expect((await reply(owner, conversation.id, { templateKey: 'orderShipped', text: 'en plus' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    await work(app, [owner.workspaceId]);
  });
});

describe('INB-02 / INB-05 / INB-06 thread, statuses, assignment, notes', () => {
  it('AT-INB-07 manual replies after reload are labelled with the author\'s name, not AI', async () => {
    const { owner, channel } = await setup();
    const agent = await testAgent(owner.workspaceId, 'Vendeur IA');
    await db.agentChannel.create({ data: { agentId: agent.id, channelId: channel.id } });
    const op = await asOperator(app, owner.workspaceId);
    await db.user.update({ where: { id: op.userId }, data: { firstName: 'Nadia', lastName: 'Ferhat' } });
    const { conversation } = await receive(app, channel, newSender(), { text: 'Salam' });
    await reply(op, conversation.id, { text: 'Réponse de Nadia' }).expect(201);
    // an AI message of the same thread (written by the pipeline of M4) for contrast
    await db.message.create({ data: { workspaceId: owner.workspaceId, conversationId: conversation.id, direction: 'out', author: 'ai', text: 'Réponse IA', sentAt: new Date(Date.now() + 1000) } });
    await work(app, [owner.workspaceId]);

    const rows = await thread(owner, conversation.id); // a fresh read = "after reload"
    const human = rows.find((m) => m.text === 'Réponse de Nadia');
    expect(human).toMatchObject({ author: 'human', authorUser: { id: op.userId, firstName: 'Nadia', lastName: 'Ferhat' }, agent: null, aiRunId: null });
    expect(rows.find((m) => m.text === 'Réponse IA')).toMatchObject({ author: 'ai', authorUser: null, agent: { id: agent.id, name: 'Vendeur IA' } });
    expect(rows.find((m) => m.text === 'Salam')).toMatchObject({ author: 'customer', authorUser: null, agent: null });
    // cursor pagination of the thread (newest first)
    const page1 = await owner.get(`/conversations/${conversation.id}/messages?limit=2`).expect(200);
    expect(page1.body.meta).toMatchObject({ hasMore: true });
    const page2 = await owner.get(`/conversations/${conversation.id}/messages?limit=2&cursor=${page1.body.meta.nextCursor}`).expect(200);
    expect([...page1.body.data, ...page2.body.data].map((m: any) => m.text)).toEqual(['Réponse IA', 'Réponse de Nadia', 'Salam']);
    expect(page2.body.meta).toEqual(expect.objectContaining({ hasMore: false, nextCursor: null }));
  });

  it('AT-INB-08 new customer message on a resolved conversation ⇒ active; on archived ⇒ active; a paused AI stays paused', async () => {
    const { owner, channel } = await setup();
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'Salam' });
    for (const status of ['resolved', 'archived'] as const) {
      const before = await detail(owner, conversation.id);
      const closed = await owner.patch(`/conversations/${conversation.id}`, { status, version: before.version }).expect(200);
      expect(closed.body.data.status).toBe(status);
      await receive(app, channel, sender, { text: `encore (${status})` });
      const reopened = await detail(owner, conversation.id);
      expect(reopened).toMatchObject({ status: 'active', aiPaused: false });
      expect(reopened.version).toBe(closed.body.data.version + 1);
    }
    const events = (await wsOf(`ws:${owner.workspaceId}`, 'conversation.updated')).filter((e) => e.payload.conversation.id === conversation.id).map((e) => e.payload.conversation.status);
    expect(events).toEqual(['resolved', 'active', 'archived', 'active']);
    // manual pause survives the reopening (the AI resumes only if it was not paused)
    let v = (await detail(owner, conversation.id)).version;
    v = (await owner.patch(`/conversations/${conversation.id}`, { aiPaused: true, version: v }).expect(200)).body.data.version;
    await owner.patch(`/conversations/${conversation.id}`, { status: 'resolved', version: v }).expect(200);
    await receive(app, channel, sender, { text: 'toujours là' });
    expect(await detail(owner, conversation.id)).toMatchObject({ status: 'active', aiPaused: true });
    expect((await owner.get('/conversations/counts').expect(200)).body.data).toMatchObject({ all: 1, active: 1, resolved: 0, archived: 0 });
  });

  it('AT-INB-09 first human reply auto-assigns; reassign; note not sent to customer', async () => {
    const { owner, channel } = await setup();
    const op = await asOperator(app, owner.workspaceId);
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'Bonjour' });
    await reply(op, conversation.id, { text: 'Je m\'en occupe' }).expect(201);
    let view = await detail(owner, conversation.id);
    expect(view.assignee).toMatchObject({ id: op.userId });
    // a second replier does not steal the assignment (FL-03 F-3)
    await reply(owner, conversation.id, { text: 'moi aussi' }).expect(201);
    expect((await detail(owner, conversation.id)).assignee.id).toBe(op.userId);

    // reassign ⇒ the new assignee is notified, not the one who did it
    view = await detail(owner, conversation.id);
    const admin = await asAdmin(app, owner.workspaceId);
    const assigned = await owner.patch(`/conversations/${conversation.id}`, { assigneeId: admin.userId, version: view.version }).expect(200);
    expect(assigned.body.data.assignee.id).toBe(admin.userId);
    await work(app, [owner.workspaceId]);
    expect((await admin.get('/notifications?type=conversation_assigned').expect(200)).body.data).toHaveLength(1);
    expect((await owner.get('/notifications?type=conversation_assigned').expect(200)).body.data).toHaveLength(0);
    expect((await owner.get('/conversations?assigneeId=me').expect(200)).body.data).toHaveLength(0);
    expect((await admin.get('/conversations?assigneeId=me').expect(200)).body.data).toHaveLength(1);
    // unassign; a user of another workspace cannot be assigned
    const stranger = await asOwner(app);
    expect((await owner.patch(`/conversations/${conversation.id}`, { assigneeId: stranger.userId, version: assigned.body.data.version }).expect(422)).body.error.fields).toEqual({ assigneeId: 'validation.invalid' });
    const none = await owner.patch(`/conversations/${conversation.id}`, { assigneeId: null, version: assigned.body.data.version }).expect(200);
    expect(none.body.data.assignee).toBeNull();
    expect((await owner.get('/conversations?assigneeId=none').expect(200)).body.data).toHaveLength(1);

    // internal note: stored for the team, never sent, not part of the thread
    const sentBefore = sendsTo(sender).length;
    await work(app, [owner.workspaceId]);
    const calls = sendsTo(sender).length;
    const note = await op.post(`/conversations/${conversation.id}/notes`, { body: 'Client pressé, rappeler demain' }).expect(201);
    expect(note.body.data).toMatchObject({ body: 'Client pressé, rappeler demain', author: { id: op.userId } });
    await work(app, [owner.workspaceId]);
    expect(sendsTo(sender).length).toBe(calls);
    expect(sentBefore).toBeLessThanOrEqual(calls);
    expect((await thread(owner, conversation.id)).some((m) => m.text?.includes('rappeler demain'))).toBe(false);
    expect((await owner.get(`/conversations/${conversation.id}/notes`).expect(200)).body.data.map((n: any) => n.body)).toEqual(['Client pressé, rappeler demain']);
    expect((await detail(owner, conversation.id)).notesCount).toBe(1);
    expect((await op.post(`/conversations/${conversation.id}/notes`, { body: ' ' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AT-INB-05 teammate resolves while I edit ⇒ WS update; my stale PATCH ⇒ 409 with the current resource', async () => {
    const { owner, channel } = await setup();
    const mate = await asOperator(app, owner.workspaceId);
    const { conversation } = await receive(app, channel, newSender(), { text: 'Salam' });
    const mine = await detail(owner, conversation.id);
    await mate.patch(`/conversations/${conversation.id}`, { status: 'resolved', version: mine.version }).expect(200);
    const ws = (await wsOf(`ws:${owner.workspaceId}`, 'conversation.updated')).filter((e) => e.payload.conversation.id === conversation.id);
    expect(ws[ws.length - 1]!.payload.conversation).toMatchObject({ status: 'resolved', version: mine.version + 1 });

    const stale = await owner.patch(`/conversations/${conversation.id}`, { aiPaused: true, version: mine.version }).expect(409);
    expect(stale.body.error.code).toBe('CONFLICT');
    expect(stale.body.error.details.current).toMatchObject({ id: conversation.id, status: 'resolved', version: mine.version + 1, aiPaused: false });
    expect(stale.body.error.details.changedAt).toBeTruthy();
    expect((await detail(owner, conversation.id)).aiPaused).toBe(false); // nothing applied
    // with the fresh version it goes through; `version` is mandatory
    await owner.patch(`/conversations/${conversation.id}`, { aiPaused: true, version: mine.version + 1 }).expect(200);
    expect((await owner.patch(`/conversations/${conversation.id}`, { aiPaused: false }).expect(422)).body.error.fields).toHaveProperty('version');
    expect((await owner.patch(`/conversations/${conversation.id}`, { version: mine.version + 2 }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('INB-01 list, tabs, filters, search', () => {
  it('AT-INB-12 tabs show server counts from /conversations/counts; search matches phone, name and message text', async () => {
    const { owner, channel } = await setup();
    const ig = (await instagramChild(channel.id))!;
    const senders = [newSender(), newSender(), newSender(), newSender(), newSender()];
    const convs = [];
    for (const [i, s] of senders.entries()) convs.push((await receive(app, i === 4 ? ig : channel, s, { text: i === 2 ? 'je cherche une théière rouge' : `message ${i}` }, Date.now() - (10 - i) * 1000)).conversation);
    const v = async (id: string) => (await detail(owner, id)).version;
    await owner.patch(`/conversations/${convs[0]!.id}`, { status: 'resolved', version: await v(convs[0]!.id) }).expect(200);
    await owner.patch(`/conversations/${convs[1]!.id}`, { status: 'archived', version: await v(convs[1]!.id) }).expect(200);
    await owner.patch(`/conversations/${convs[2]!.id}`, { status: 'needs_human', version: await v(convs[2]!.id) }).expect(200);
    await owner.post(`/conversations/${convs[3]!.id}/read`).expect(200);
    await db.client.update({ where: { id: convs[3]!.clientId! }, data: { name: 'Karim Bensalem', phone: '0555123456', isPlaceholder: false } });

    expect((await owner.get('/conversations/counts').expect(200)).body.data).toEqual({ all: 5, active: 2, needs_human: 1, resolved: 1, archived: 1, unread: 4, blocked: 0 });
    expect((await owner.get(`/conversations/counts?channelId=${ig.id}`).expect(200)).body.data).toMatchObject({ all: 1, active: 1, unread: 1 });
    // the list of each tab matches its count
    for (const [status, n] of [['active', 2], ['needs_human', 1], ['resolved', 1], ['archived', 1]] as const) {
      expect((await owner.get(`/conversations?status=${status}`).expect(200)).body.data).toHaveLength(n);
    }
    const all = (await owner.get('/conversations').expect(200)).body.data;
    expect(all.map((c: any) => c.id)).toEqual([...convs].reverse().map((c) => c.id)); // newest message first
    expect(all[0]).toMatchObject({ channel: { platform: 'instagram' }, lastMessageDirection: 'in', within24h: true, blocked: false, cart: null });
    expect(all[2]).toMatchObject({ status: 'needs_human', aiPaused: true, handoffReason: 'manual' });

    // search: phone (with or without spaces), client name, message text; min 2 characters
    const ids = async (q: string) => (await owner.get(`/conversations?q=${encodeURIComponent(q)}`).expect(200)).body.data.map((c: any) => c.id);
    expect(await ids('0555123456')).toEqual([convs[3]!.id]);
    expect(await ids('0555 12 34')).toEqual([convs[3]!.id]);
    expect(await ids('bensalem')).toEqual([convs[3]!.id]);
    expect(await ids('théière')).toEqual([convs[2]!.id]);
    expect(await ids('introuvable')).toEqual([]);
    expect((await owner.get('/conversations?q=a').expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    // filters of the sheet
    expect((await owner.get('/conversations?unread=true').expect(200)).body.data).toHaveLength(4);
    expect((await owner.get('/conversations?unread=false').expect(200)).body.data.map((c: any) => c.id)).toEqual([convs[3]!.id]);
    expect((await owner.get(`/conversations?channelId=${channel.id}`).expect(200)).body.data).toHaveLength(4);
    expect((await owner.get(`/conversations?channelIds=${channel.id},${ig.id}`).expect(200)).body.data).toHaveLength(5);
    expect((await owner.get('/conversations?ai=paused').expect(200)).body.data.map((c: any) => c.id)).toEqual([convs[2]!.id]);
    expect((await owner.get('/conversations?ai=no_agent').expect(200)).body.data).toHaveLength(5);
    expect((await owner.get('/conversations?client=placeholder').expect(200)).body.data).toHaveLength(4);
    expect((await owner.get('/conversations?order=without').expect(200)).body.data).toHaveLength(5);
    expect((await owner.get('/conversations?sort=oldestWaiting').expect(200)).body.data[0].id).toBe(convs[0]!.id);
    expect((await owner.get('/conversations?sort=unreadFirst').expect(200)).body.data.at(-1).id).toBe(convs[3]!.id);
    expect((await owner.get('/conversations?sort=price').expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    // cursor pagination, stable under inserts
    const p1 = await owner.get('/conversations?limit=2').expect(200);
    expect(p1.body.meta.hasMore).toBe(true);
    await receive(app, channel, newSender(), { text: 'nouveau pendant la pagination' });
    const p2 = await owner.get(`/conversations?limit=2&cursor=${p1.body.meta.nextCursor}`).expect(200);
    const p3 = await owner.get(`/conversations?limit=2&cursor=${p2.body.meta.nextCursor}`).expect(200);
    expect([...p1.body.data, ...p2.body.data, ...p3.body.data].map((c: any) => c.id)).toEqual([...convs].reverse().map((c) => c.id));
    expect(p3.body.meta).toEqual(expect.objectContaining({ hasMore: false, nextCursor: null }));
  });

  it('AT-INB-10 client panel shows client + orders; a placeholder client is flagged for completion', async () => {
    const { owner, channel } = await setup();
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'Salam' });
    const placeholder = await detail(owner, conversation.id);
    expect(placeholder.clientPanel).toMatchObject({
      client: { id: conversation.clientId, isPlaceholder: true, phone: null, orderCount: 0 },
      identity: { externalSenderId: sender, displayName: `Client ${sender.slice(-4)}` },
      orders: [],
      block: null,
    });
    // the client is completed and has orders
    const product = await createProduct(owner);
    const order = await db.order.create({ data: { workspaceId: owner.workspaceId, number: 'CMD-77', clientId: conversation.clientId!, conversationId: conversation.id, source: 'manual', clientName: 'Sara', clientPhone: '0661000001', subtotal: 5000, total: 5400, status: 'confirmed' } });
    await db.orderItem.create({ data: { orderId: order.id, productId: product.id, productName: product.name, unitPrice: 2500, quantity: 2, total: 5000 } });
    await db.client.update({ where: { id: conversation.clientId! }, data: { name: 'Sara Haddad', phone: '0661000001', isPlaceholder: false, orderCount: 1, totalSpent: 5400, tags: ['fidèle'] } });
    const known = await detail(owner, conversation.id);
    expect(known.client).toMatchObject({ name: 'Sara Haddad', phone: '0661000001', isPlaceholder: false, orderCount: 1 });
    expect(known.clientPanel.client).toMatchObject({ tags: ['fidèle'], totalSpent: 5400 });
    expect(known.clientPanel.orders).toEqual([expect.objectContaining({ id: order.id, number: 'CMD-77', status: 'confirmed', total: 5400 })]);
    expect((await owner.get('/conversations?order=with').expect(200)).body.data.map((c: any) => c.id)).toEqual([conversation.id]);
    // the panel never shows another workspace's orders
    const stranger = await setup();
    const theirs = await receive(app, stranger.channel, sender, { text: 'même client Meta, autre boutique' });
    expect((await detail(stranger.owner, theirs.conversation.id)).clientPanel.orders).toEqual([]);
  });

  it('AT-INB-13 channel needs_reconnect ⇒ composer disabled with reason; reading works', async () => {
    const { owner, channel } = await setup();
    const { conversation } = await receive(app, channel, newSender(), { text: 'Salam' });
    await db.channel.update({ where: { id: channel.id }, data: { status: 'needs_reconnect' } });
    const view = await detail(owner, conversation.id);
    expect(view.composer).toMatchObject({ canSend: false, reasonCode: 'REPLY_CHANNEL_INACTIVE', channelStatus: 'needs_reconnect' });
    expect(view.channel.status).toBe('needs_reconnect');
    expect(await thread(owner, conversation.id)).toHaveLength(1);
    await owner.get('/conversations').expect(200);
    const refused = await reply(owner, conversation.id, { text: 'bloqué' }).expect(422);
    expect(refused.body.error).toMatchObject({ code: 'REPLY_CHANNEL_INACTIVE', details: { status: 'needs_reconnect' } });
    expect(await db.message.count({ where: { conversationId: conversation.id } })).toBe(1);
    // the other statuses still work on the thread (resolve, notes)
    await owner.patch(`/conversations/${conversation.id}`, { status: 'resolved', version: view.version }).expect(200);
    for (const status of ['paused', 'disabled', 'disconnected'] as const) {
      await db.channel.update({ where: { id: channel.id }, data: { status } });
      expect((await detail(owner, conversation.id)).composer).toMatchObject({ canSend: false, reasonCode: 'REPLY_CHANNEL_INACTIVE', channelStatus: status });
    }
  });
});

describe('INB-09 delete, bulk actions, roles, tenancy', () => {
  it('AT-INB-11 admin deletes a conversation ⇒ hidden for everyone, data kept; Operator has no delete', async () => {
    const { owner, channel } = await setup();
    const admin = await asAdmin(app, owner.workspaceId);
    const op = await asOperator(app, owner.workspaceId);
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'Salam' });
    expect((await op.delete(`/conversations/${conversation.id}`).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await detail(op, conversation.id)).actions.find((a: any) => a.key === 'delete')).toMatchObject({ enabled: false, reasonCode: 'FORBIDDEN' });

    await admin.delete(`/conversations/${conversation.id}`).expect(200);
    for (const who of [owner, admin, op]) {
      expect((await who.get('/conversations').expect(200)).body.data).toEqual([]);
      await who.get(`/conversations/${conversation.id}`).expect(404);
      await who.get(`/conversations/${conversation.id}/messages`).expect(404);
    }
    expect((await owner.get('/conversations/counts').expect(200)).body.data.all).toBe(0);
    expect((await wsOf(`ws:${owner.workspaceId}`, 'conversation.deleted')).map((e) => e.payload.id)).toContain(conversation.id);
    // data kept
    expect(await db.message.count({ where: { conversationId: conversation.id } })).toBe(1);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).deletedAt).not.toBeNull();
    expect(await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'conversation.delete', entityId: conversation.id } }))).toBeTruthy();

    // restore (Admin+, ≤ 30 days)
    expect((await op.post(`/conversations/${conversation.id}/restore`).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await admin.post(`/conversations/${conversation.id}/restore`).expect(200)).body.data.deletedAt).toBeNull();
    expect((await op.get('/conversations').expect(200)).body.data).toHaveLength(1);
    await admin.delete(`/conversations/${conversation.id}`).expect(200);
    await db.conversation.update({ where: { id: conversation.id }, data: { deletedAt: ago(31 * 24 * HOUR) } });
    await admin.post(`/conversations/${conversation.id}/restore`).expect(404);
    // the customer writing again brings the thread back with its history
    await receive(app, channel, sender, { text: 'me revoilà' });
    expect(await thread(owner, conversation.id)).toHaveLength(2);
  });

  it('bulk resolve / archive / assign / resume-ai / block return per-item results', async () => {
    const { owner, channel } = await setup();
    const op = await asOperator(app, owner.workspaceId);
    const convs = [];
    for (let i = 0; i < 3; i++) convs.push((await receive(app, channel, newSender(), { text: `m${i}` })).conversation);
    const ghost = '0191a000-0000-7000-8000-000000000000';
    const ids = [...convs.map((c) => c.id), ghost];

    const resolved = await op.post('/conversations/bulk/resolve', { ids }).expect(200);
    expect(resolved.body.meta).toMatchObject({ ok: 3, failed: 1 });
    expect(resolved.body.data.results[3]).toMatchObject({ id: ghost, ok: false, error: { code: 'NOT_FOUND' } });
    expect((await owner.get('/conversations/counts').expect(200)).body.data.resolved).toBe(3);
    await op.post('/conversations/bulk/archive', { ids: [convs[0]!.id] }).expect(200);
    await op.post('/conversations/bulk/assign', { ids: [convs[1]!.id, convs[2]!.id], assigneeId: op.userId }).expect(200);
    expect((await owner.get('/conversations?assigneeId=' + op.userId).expect(200)).body.data).toHaveLength(2);
    await db.conversation.updateMany({ where: { id: { in: convs.map((c) => c.id) } }, data: { aiPaused: true } });
    await op.post('/conversations/bulk/resume-ai', { ids: convs.map((c) => c.id) }).expect(200);
    expect(await db.conversation.count({ where: { id: { in: convs.map((c) => c.id) }, aiPaused: true } })).toBe(0);
    const blocked = await op.post('/conversations/bulk/block', { ids: [convs[2]!.id] }).expect(200);
    expect(blocked.body.meta).toMatchObject({ ok: 1, failed: 0 });
    expect((await owner.get('/conversations/counts').expect(200)).body.data.blocked).toBe(1);
    // validation and unknown action
    expect((await op.post('/conversations/bulk/resolve', { ids: [] }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await op.post('/conversations/bulk/assign', { ids: [convs[0]!.id] }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    await op.post('/conversations/bulk/delete', { ids: [convs[0]!.id] }).expect(404);
  });

  it('cross-workspace 404 on every conversation / message / safety / notification id; read-only members cannot write', async () => {
    const a = await setup();
    const b = await setup();
    const { conversation, message } = await receive(app, a.channel, newSender(), { text: 'privé' });
    const note = await a.owner.post(`/conversations/${conversation.id}/notes`, { body: 'note' }).expect(201);
    expect(note.body.data.id).toBeTruthy();
    const block = await a.owner.post(`/conversations/${conversation.id}/block`, { reason: 'spam' }).expect(200);
    const report = await a.owner.post('/safety/reports', { type: 'conversation', conversationId: conversation.id, reason: 'harassment' }).expect(201);
    await work(app, [a.owner.workspaceId]);
    const s = b.owner;
    const id = conversation.id;
    await s.get(`/conversations/${id}`).expect(404);
    await s.patch(`/conversations/${id}`, { status: 'resolved', version: 1 }).expect(404);
    await s.delete(`/conversations/${id}`).expect(404);
    await s.post(`/conversations/${id}/restore`).expect(404);
    await s.get(`/conversations/${id}/messages`).expect(404);
    await reply(s, id, { text: 'intrus' }).expect(404);
    await s.post(`/conversations/${id}/read`).expect(404);
    await s.post(`/conversations/${id}/unread`).expect(404);
    await s.get(`/conversations/${id}/notes`).expect(404);
    await s.post(`/conversations/${id}/notes`, { body: 'x' }).expect(404);
    await s.post(`/conversations/${id}/block`, { reason: 'spam' }).expect(404);
    await s.post(`/conversations/${id}/unblock`).expect(404);
    await s.post(`/messages/${message!.id}/report`, {}).expect(404);
    await s.delete(`/safety/blocks/${block.body.data.id}`).expect(404);
    await s.get(`/safety/reports/${report.body.data.id}`).expect(404);
    await s.post('/safety/reports', { type: 'conversation', conversationId: id, reason: 'spam' }).expect(404);
    await s.post('/safety/blocks', { clientId: conversation.clientId, reason: 'spam' }).expect(404);
    expect((await s.post('/conversations/bulk/resolve', { ids: [id] }).expect(200)).body.data.results[0]).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect((await s.get(`/conversations?channelId=${a.channel.id}`).expect(200)).body.data).toEqual([]);
    expect((await s.get('/safety/blocks').expect(200)).body.data).toEqual([]);
    // nothing changed on the other side
    expect(await db.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'active', deletedAt: null });
    expect(await db.message.count({ where: { conversationId: id } })).toBe(1);

    // a read-only member (plan limit) reads everything and writes nothing
    const { asMember } = await import('../support/actors');
    const ro = await asMember(app, a.owner.workspaceId, 'operator', { readOnly: true });
    await ro.get(`/conversations/${id}`).expect(200);
    expect((await reply(ro, id, { text: 'non' }).expect(403)).body.error.code).toBe('READ_ONLY_MEMBER');
    expect((await ro.get(`/conversations/${id}`).expect(200)).body.data.composer).toMatchObject({ canSend: false, reasonCode: 'READ_ONLY_MEMBER' });
  });
});

describe('D37 block / report a customer (merchant side)', () => {
  it('block moves the thread to the "Bloqués" tab, stops notifications, keeps storing messages; unblock is Admin+', async () => {
    const { owner, channel } = await setup();
    const agent = await testAgent(owner.workspaceId);
    await db.agentChannel.create({ data: { agentId: agent.id, channelId: channel.id } });
    const op = await asOperator(app, owner.workspaceId);
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'insultes' });
    await db.client.update({ where: { id: conversation.clientId! }, data: { phone: '0770112233', isPlaceholder: false } });

    const block = await op.post(`/conversations/${conversation.id}/block`, { reason: 'harassment', note: 'insultes répétées' }).expect(200);
    expect(block.body.data).toMatchObject({ reason: 'harassment', source: 'manual', unblockable: true, phone: '0770112233', blockedBy: { id: op.userId }, client: { id: conversation.clientId, blocked: true } });
    // blocking twice is the same block
    expect((await op.post(`/conversations/${conversation.id}/block`, { reason: 'spam' }).expect(200)).body.data.id).toBe(block.body.data.id);
    expect((await op.post(`/conversations/${conversation.id}/block`, {}).expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    expect((await owner.get('/conversations').expect(200)).body.data).toEqual([]);
    expect((await owner.get('/conversations?blocked=1').expect(200)).body.data.map((c: any) => [c.id, c.blocked])).toEqual([[conversation.id, true]]);
    expect((await owner.get('/conversations/counts').expect(200)).body.data).toMatchObject({ all: 0, unread: 0, blocked: 1 });
    const view = await detail(owner, conversation.id);
    expect(view).toMatchObject({ blocked: true, blockSource: 'manual', blockedBy: { id: op.userId }, clientPanel: { block: { id: block.body.data.id, reason: 'harassment' } } });
    expect((await wsOf(`ws:${owner.workspaceId}`, 'conversation.updated')).some((e) => e.payload.conversation.id === conversation.id && e.payload.conversation.blocked === true)).toBe(true);

    // a blocked customer is not written to: composer disabled with the reason, the API refuses
    expect(view.composer).toMatchObject({ canSend: false, reasonCode: 'CUSTOMER_BLOCKED' });
    expect((await reply(owner, conversation.id, { text: 'non' }).expect(409)).body.error.code).toBe('CUSTOMER_BLOCKED');

    // messages are still stored; the AI hook and the notifications stay silent
    await db.conversation.update({ where: { id: conversation.id }, data: { aiPaused: true } });
    await receive(app, channel, sender, { attachments: [{ type: 'video', payload: { url: 'https://fake.meta.local/v.mp4' } }] });
    expect(await db.message.count({ where: { conversationId: conversation.id, direction: 'in' } })).toBe(2);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'conversation_needs_human_message' } })).toBe(0);
    expect(meta.callsOf('send').filter((c) => c.args.recipientId === sender)).toHaveLength(0);
    // a new thread of the same phone (another placeholder) is blocked too
    const other = await receive(app, channel, newSender(), { text: 'nouveau compte' });
    await db.client.update({ where: { id: other.conversation.clientId! }, data: { phone2: null } });
    await db.conversation.update({ where: { id: other.conversation.id }, data: { clientId: conversation.clientId } });
    expect((await owner.get('/conversations?blocked=true').expect(200)).body.data).toHaveLength(2);

    // list of blocked customers; unblock: Operator no, Admin yes
    const list = await owner.get('/safety/blocks?q=0770').expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta).toMatchObject({ total: 1, page: 1 });
    expect((await op.post(`/conversations/${conversation.id}/unblock`).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await op.delete(`/safety/blocks/${block.body.data.id}`).expect(403)).body.error.code).toBe('FORBIDDEN');
    // a platform block cannot be lifted by the merchant
    await db.customerBlock.update({ where: { id: block.body.data.id }, data: { source: 'platform' } });
    expect((await owner.delete(`/safety/blocks/${block.body.data.id}`).expect(403)).body.error.code).toBe('CUSTOMER_BLOCKED_BY_PLATFORM');
    expect((await detail(owner, conversation.id)).actions.find((a: any) => a.key === 'unblock')).toMatchObject({ enabled: false, reasonCode: 'CUSTOMER_BLOCKED_BY_PLATFORM' });
    await db.customerBlock.update({ where: { id: block.body.data.id }, data: { source: 'manual' } });
    await owner.post(`/conversations/${conversation.id}/unblock`).expect(200);
    expect((await owner.get('/conversations?blocked=1').expect(200)).body.data).toEqual([]);
    expect((await owner.get('/conversations').expect(200)).body.data).toHaveLength(2);
    expect(await eventually(async () => (await db.auditLog.count({ where: { workspaceId: owner.workspaceId, action: { in: ['customer.block', 'customer.unblock'] } } })) >= 2)).toBe(true);

    // block by phone / by client from Settings › Security
    const byPhone = await owner.post('/safety/blocks', { phone: '0550 99 88 77', reason: 'fraud' }).expect(201);
    expect(byPhone.body.data).toMatchObject({ phone: '0550998877', client: null, reason: 'fraud' });
    expect((await owner.post('/safety/blocks', {}).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    await owner.delete(`/safety/blocks/${byPhone.body.data.id}`).expect(200);
    await owner.delete(`/safety/blocks/${byPhone.body.data.id}`).expect(404);
  });

  it('report to Djaber: acknowledged, duplicate ⇒ 409, 21st of the day ⇒ 429, masked excerpt, optional block; rules and words are Admin+', async () => {
    const { owner, channel } = await setup();
    const op = await asOperator(app, owner.workspaceId);
    const sender = newSender();
    const { conversation, message } = await receive(app, channel, sender, { text: 'appelez-moi au 0661223344' });
    await db.client.update({ where: { id: conversation.clientId! }, data: { phone: '0661223344', isPlaceholder: false } });

    const res = await op.post('/safety/reports', { type: 'conversation', conversationId: conversation.id, reason: 'fraud', details: 'faux bon de commande', blockAlso: true }).expect(201);
    expect(res.body.data).toMatchObject({ type: 'conversation', reason: 'fraud', status: 'open', blockRequested: true, conversationId: conversation.id, reporter: { id: op.userId } });
    const row = await db.report.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row).toMatchObject({ workspaceId: owner.workspaceId, reporterKind: 'merchant_user', clientId: conversation.clientId });
    expect(JSON.stringify(row.excerpt)).not.toContain('0661223344'); // customer phone masked in the evidence
    expect(JSON.stringify(row.excerpt)).toContain('06•• •• •• 44');
    expect((await owner.get('/safety/blocks').expect(200)).body.data[0]).toMatchObject({ reason: 'fraud', reportStatus: 'open' });
    // same reporter, same target, still open
    expect((await op.post('/safety/reports', { type: 'conversation', conversationId: conversation.id, reason: 'spam' }).expect(409)).body.error.code).toBe('ABUSE_REPORT_ALREADY_OPEN');
    // shortcut for one message
    const msg = await op.post(`/messages/${message!.id}/report`, { details: 'réponse fausse' }).expect(201);
    expect(msg.body.data).toMatchObject({ type: 'ai_message', messageId: message!.id, reason: 'ai_incorrect' });
    // mine / workspace
    expect((await op.get('/safety/reports').expect(200)).body.data).toHaveLength(2);
    expect((await owner.get('/safety/reports').expect(200)).body.data).toHaveLength(0);
    expect((await owner.get('/safety/reports?scope=workspace').expect(200)).body.data).toHaveLength(2);
    expect((await op.get(`/safety/reports/${res.body.data.id}`).expect(200)).body.data.id).toBe(res.body.data.id);
    expect((await op.post('/safety/reports', { type: 'customer', reason: 'spam' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    // more than 20 reports a day for the workspace
    await db.report.createMany({ data: Array.from({ length: 18 }, () => ({ workspaceId: owner.workspaceId, type: 'customer' as const, reporterKind: 'merchant_user' as const, reason: 'spam' as const })) });
    expect((await owner.post('/safety/reports', { type: 'customer', clientId: conversation.clientId, reason: 'spam' }).expect(429)).body.error.code).toBe('ABUSE_REPORT_RATE_LIMITED');

    // auto-rules and blocked words
    // the auto-block rule is OFF by default; its threshold (3) is kept while it is off (04 §13)
    const defaults = { riskAfterReturns: 2, autoBlockEnabled: false, autoBlockAfterUncollected: 3, handoffOnRisk: true };
    expect((await owner.get('/safety/rules').expect(200)).body.data).toEqual(defaults);
    expect((await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).safetyRules).toEqual(defaults); // column default
    const on = { riskAfterReturns: 3, autoBlockEnabled: true, autoBlockAfterUncollected: 4, handoffOnRisk: false };
    expect((await owner.put('/safety/rules', on).expect(200)).body.data).toEqual(on);
    expect((await owner.get('/safety/rules').expect(200)).body.data).toEqual(on);
    expect((await owner.get('/workspace').expect(200)).body.data.safetyRules).toEqual(on);
    // switching it off keeps the threshold
    expect((await owner.put('/safety/rules', { ...on, autoBlockEnabled: false }).expect(200)).body.data).toEqual({ ...on, autoBlockEnabled: false });
    expect((await owner.put('/safety/rules', { ...on, riskAfterReturns: -1 }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await owner.put('/safety/rules', { ...on, autoBlockAfterUncollected: 0 }).expect(422)).body.error.fields).toEqual({ autoBlockAfterUncollected: 'validation.range' });
    expect((await owner.put('/safety/rules', { riskAfterReturns: 2, autoBlockAfterUncollected: 3, handoffOnRisk: true }).expect(422)).body.error.fields).toEqual({ autoBlockEnabled: 'validation.required' });
    // a workspace whose JSON predates the flag (0 meant "off") reads as OFF with the default threshold
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { safetyRules: { riskAfterReturns: 2, autoBlockAfterUncollected: 0, handoffOnRisk: true } } });
    expect((await owner.get('/safety/rules').expect(200)).body.data).toEqual(defaults);
    expect((await owner.get('/workspace').expect(200)).body.data.safetyRules).toEqual(defaults);
    expect((await owner.put('/safety/blocked-words', { words: ['Faux', 'faux', ' arnaque '] }).expect(200)).body.data.words).toEqual(['faux', 'arnaque']);
    expect((await owner.get('/safety/blocked-words').expect(200)).body.data.words).toEqual(['faux', 'arnaque']);
    for (const call of [() => op.get('/safety/rules'), () => op.put('/safety/rules', { riskAfterReturns: 1, autoBlockEnabled: false, autoBlockAfterUncollected: 1, handoffOnRisk: true }), () => op.get('/safety/blocked-words'), () => op.put('/safety/blocked-words', { words: [] })]) {
      expect((await call().expect(403)).body.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('FL-03 handoff reminder and the notification centre', () => {
  it('handoff unattended for handoffReminderMin ⇒ the Owner is told once; a human reply or a zero setting stops it', async () => {
    const { owner, channel } = await setup();
    const op = await asOperator(app, owner.workspaceId);
    const service = app.app.get(ConversationService);
    expect(app.app.get(ProcessorRegistry).crons.map((c) => c.name)).toContain('sched-handoff-unattended');
    const one = await receive(app, channel, newSender(), { text: 'je veux un humain' });
    const two = await receive(app, channel, newSender(), { text: 'moi aussi' });
    for (const c of [one, two]) await TenantContext.runAs(owner.workspaceId, () => service.handoff(c.conversation.id, 'customer_request'));
    await work(app, [owner.workspaceId]);
    // FL-03 step 2–3: needs_human, AI paused, the workspace handoff text once, members notified
    expect(await detail(owner, one.conversation.id)).toMatchObject({ status: 'needs_human', aiPaused: true, handoffReason: 'customer_request' });
    expect((await thread(owner, one.conversation.id))[0]).toMatchObject({ author: 'system', text: 'Je transmets à un membre de l\'équipe qui vous répondra très vite.' });
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'conversation_handoff' } })).toBe(4); // 2 conversations × 2 members
    expect(await TenantContext.runAs(owner.workspaceId, () => service.handoff(one.conversation.id, 'again'))).toBe(false);

    // the scheduler looks at every workspace: this one is read through its own rows
    const reminders = async () => {
      await work(app, [owner.workspaceId]);
      return db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'conversation_handoff_unattended' } });
    };
    // not yet due (30 minutes by default)
    await service.remindUnattended();
    expect(await reminders()).toHaveLength(0);
    // a human answered the second one
    await reply(op, two.conversation.id, { text: 'Je suis là' }).expect(201);
    expect(await service.remindUnattended(new Date(Date.now() + 31 * 60_000))).toBeGreaterThanOrEqual(1);
    await service.remindUnattended(new Date(Date.now() + 90 * 60_000)); // once per handoff
    expect((await reminders()).map((n) => [n.userId, (n.data as any).conversationId])).toEqual([[owner.userId, one.conversation.id]]);
    // 0 = reminders off
    const quiet = await setup();
    await db.workspace.update({ where: { id: quiet.owner.workspaceId }, data: { handoffReminderMin: 0 } });
    const q = await receive(app, quiet.channel, newSender(), { text: 'aide' });
    await TenantContext.runAs(quiet.owner.workspaceId, () => service.handoff(q.conversation.id, 'customer_request'));
    await service.remindUnattended(new Date(Date.now() + 24 * HOUR));
    await work(app, [quiet.owner.workspaceId]);
    expect(await db.notification.count({ where: { workspaceId: quiet.owner.workspaceId, type: 'conversation_handoff_unattended' } })).toBe(0);
  });

  it('GET /notifications, unread count, read, read-all — own rows only', async () => {
    const { owner, channel } = await setup();
    const op = await asOperator(app, owner.workspaceId);
    const service = app.app.get(ConversationService);
    const convs = [];
    for (let i = 0; i < 3; i++) {
      const c = await receive(app, channel, newSender(), { text: `aide ${i}` });
      await TenantContext.runAs(owner.workspaceId, () => service.handoff(c.conversation.id, 'customer_request'));
      convs.push(c.conversation);
    }
    await db.channel.update({ where: { id: channel.id }, data: { status: 'active' } });
    const { ChannelService } = await import('../../src/modules/channels/channel.service');
    await app.app.get(ChannelService).markNeedsReconnect(channel.id, 'test');
    await work(app, [owner.workspaceId]);

    expect((await owner.get('/notifications/unread-count').expect(200)).body.data).toEqual({ count: 4 });
    expect((await op.get('/notifications/unread-count').expect(200)).body.data).toEqual({ count: 3 }); // channel alerts go to Owner + Admins
    const all = await owner.get('/notifications').expect(200);
    expect(all.body.data.map((n: any) => n.type)).toEqual(['channel_needs_reconnect', 'conversation_handoff', 'conversation_handoff', 'conversation_handoff']);
    expect(all.body.data[0]).toMatchObject({ group: 'pages', deepLink: { web: `/channels/${channel.id}`, mobile: `djaber://channels/${channel.id}` } });
    expect(all.body.data[0].title).toContain('déconnectée par Meta');
    expect(all.body.data[1].title).toContain('Conversation à traiter');
    // rendered in the reader's language
    const en = await owner.get('/notifications').set('Accept-Language', 'en').expect(200);
    expect(en.body.data[0].title).not.toBe(all.body.data[0].title);
    // filters and cursor
    expect((await owner.get('/notifications?types=conversation_handoff').expect(200)).body.data).toHaveLength(3);
    expect((await owner.get('/notifications?group=pages').expect(200)).body.data).toHaveLength(1);
    const p1 = await owner.get('/notifications?limit=3').expect(200);
    expect(p1.body.meta.hasMore).toBe(true);
    const p2 = await owner.get(`/notifications?limit=3&cursor=${p1.body.meta.nextCursor}`).expect(200);
    expect([...p1.body.data, ...p2.body.data].map((n: any) => n.id)).toEqual(all.body.data.map((n: any) => n.id));
    expect((await owner.get('/notifications?types=nope').expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    // read one, then all; another user's row is a 404
    const mine = all.body.data[1].id;
    const read = await owner.post(`/notifications/${mine}/read`).expect(200);
    expect(read.body.data).toMatchObject({ id: mine, unreadCount: 3 });
    expect((await owner.get('/notifications?unread=true').expect(200)).body.data).toHaveLength(3);
    expect((await wsOf(`user:${owner.userId}`, 'notification.read')).pop()!.payload).toEqual({ ids: [mine], unreadCount: 3 });
    const theirs = (await op.get('/notifications').expect(200)).body.data[0].id;
    await owner.post(`/notifications/${theirs}/read`).expect(404);
    const stranger = await asOwner(app);
    await stranger.post(`/notifications/${mine}/read`).expect(404);
    expect((await stranger.get('/notifications').expect(200)).body.data).toEqual([]);
    expect((await owner.post('/notifications/read-all').expect(200)).body.data).toEqual({ updated: 3, unreadCount: 0 });
    expect((await owner.get('/notifications/unread-count').expect(200)).body.data).toEqual({ count: 0 });
    expect((await op.get('/notifications/unread-count').expect(200)).body.data).toEqual({ count: 3 });
    expect((await wsOf(`user:${owner.userId}`, 'notification.read')).pop()!.payload).toEqual({ ids: 'all', unreadCount: 0 });
  });
});
