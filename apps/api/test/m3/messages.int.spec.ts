// M3 — MSG-02…09: inbound message types, attachment download, echoes of manual replies, the batching hook, outbound
// sends (24 h window, tags, skipped_window, retries, error mapping), product cards, retention purge.
import { getMessages } from '@djaber/shared';
import { prisma, TenantContext, type Tx } from '@djaber/db';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import { jobId, QueueService } from '../../src/core/queue/queue.service';
import { FakeMetaGateway } from '../../src/modules/meta/fake-meta.gateway';
import { MetaError } from '../../src/modules/meta/meta-errors';
import { DataLifecycleService } from '../../src/modules/messaging/data-lifecycle.service';
import { InboundProcessor } from '../../src/modules/messaging/inbound.processor';
import { OutboundSendService } from '../../src/modules/messaging/outbound-send.service';
import { asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct, testAgent } from '../support/m2';
import { connectedPage, db, delivery, fakeMeta, forbidNetwork, instagramChild, messageItem, mid, newSender, OWN_APP_ID, postWebhook, receive, reply, work, wsOf } from '../support/m3';

let app: TestApp;
let meta: FakeMetaGateway;
let outbound: OutboundSendService;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  net = forbidNetwork();
  app = await createTestApp();
  meta = fakeMeta(app);
  outbound = app.app.get(OutboundSendService);
});
afterAll(async () => {
  expect(net.spy).not.toHaveBeenCalled();
  net.restore();
  await app.close();
});

const HOUR = 3600_000;
const sendsTo = (sender: string) => meta.callsOf('send').filter((c) => c.args.recipientId === sender);
/** A workspace with one active page that has an active agent linked (the threads the AI would answer). */
const withAgent = async () => {
  const owner = await asOwner(app);
  const channel = await connectedPage(owner, app);
  const agent = await testAgent(owner.workspaceId);
  await db.agentChannel.create({ data: { agentId: agent.id, channelId: channel.id } });
  return { owner, channel, agent };
};
const inWorkspace = <T>(workspaceId: string, fn: () => Promise<T>) => TenantContext.runAs(workspaceId, fn);

describe('MSG-02 inbound types', () => {
  it('AT-MSG-08 each inbound type (image, audio, video, file, location, sticker, postback) is stored with the right attachment type and returned by the thread', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const sender = newSender();
    const base = Date.now() - 60_000;
    const media = (type: string, file: string) => ({ attachments: [{ type, payload: { url: `https://fake.meta.local/${file}` } }] });
    const cases: [string, Record<string, unknown>][] = [
      ['text', { text: 'Salam khouya' }],
      ['image', media('image', 'photo.jpg')],
      ['audio', media('audio', 'vocal.mp3')],
      ['video', media('video', 'clip.mp4')],
      ['file', media('file', 'facture.pdf')],
      ['location', { attachments: [{ type: 'location', payload: { coordinates: { lat: 36.7538, long: 3.0588 } } }] }],
      ['sticker', { sticker_id: 369239263222822, attachments: [{ type: 'image', payload: { url: 'https://fake.meta.local/sticker.png', sticker_id: 369239263222822 } }] }],
      ['quick_reply', { text: 'Oui', quick_reply: { payload: 'CONFIRM_YES' } }],
      ['story', { text: 'C\'est dispo ?', reply_to: { story: { url: 'https://fake.meta.local/story.jpg', id: '1789' } } }],
      ['unsupported', { is_unsupported: true }],
    ];
    const items = cases.map(([, message], i) => messageItem(channel, sender, message, base + i * 1000));
    const postback = { sender: { id: sender }, recipient: { id: channel.externalId }, timestamp: base + 20_000, postback: { mid: mid(), title: 'Commander', payload: 'ORDER:abc' } };
    // one delivery batching several events, as Meta does under load
    await postWebhook(app, delivery(channel, [...items, postback])).expect(200);
    expect(await work(app, [owner.workspaceId])).toEqual(expect.arrayContaining(['process-event', 'fetch-attachment']));

    const conversation = await db.conversation.findFirstOrThrow({ where: { channelId: channel.id, externalSenderId: sender } });
    const thread: any[] = (await owner.get(`/conversations/${conversation.id}/messages`).expect(200)).body.data.reverse(); // oldest first
    expect(thread.map((m) => m.type)).toEqual(['text', 'image', 'audio', 'video', 'file', 'location', 'sticker', 'text', 'text', 'file', 'postback']);
    expect(thread.every((m) => m.direction === 'in' && m.author === 'customer' && m.deliveryStatus === 'sent')).toBe(true);
    const by = (i: number) => thread[i];
    // media copied to our storage by the `media` job: our URL, real size, no trace of the Meta URL
    for (const [i, type, mime] of [[1, 'image', 'image/jpeg'], [2, 'audio', 'audio/mpeg'], [3, 'video', 'video/mp4'], [4, 'file', 'application/pdf'], [6, 'sticker', 'image/jpeg']] as const) {
      expect(by(i).attachments).toHaveLength(1);
      expect(by(i).attachments[0]).toMatchObject({ type, mime, pending: false });
      expect(by(i).attachments[0].url).toContain('/api/v1/files/ws/');
      expect(by(i).attachments[0].size).toBeGreaterThan(0);
      expect(JSON.stringify(by(i))).not.toContain('fake.meta.local');
    }
    expect(by(1).attachments[0]).toMatchObject({ width: 640, height: 480 });
    expect(by(5).attachments[0]).toMatchObject({ type: 'location', lat: 36.7538, lng: 3.0588 });
    expect(by(5).payload).toMatchObject({ location: { lat: 36.7538, lng: 3.0588 } });
    expect(by(7)).toMatchObject({ text: 'Oui', payload: { quickReply: 'CONFIRM_YES' } });
    expect(by(8).payload).toMatchObject({ story: { kind: 'reply', url: 'https://fake.meta.local/story.jpg' } });
    expect(by(9)).toMatchObject({ text: null, attachments: [], payload: { unsupported: true } });
    expect(by(10)).toMatchObject({ type: 'postback', text: 'Commander', payload: { postback: 'ORDER:abc' } });

    // conversation and client were created once, with the profile name; unread counts every message
    const view = (await owner.get(`/conversations/${conversation.id}`).expect(200)).body.data;
    expect(view).toMatchObject({ unreadCount: 11, status: 'active', lastMessagePreview: 'Commander', client: { name: `Client ${sender.slice(-4)}`, isPlaceholder: true } });
    expect(meta.callsOf('userProfile').filter((c) => c.args.senderId === sender)).toHaveLength(1);
    expect((await wsOf(`ws:${owner.workspaceId}`, 'message.created')).filter((e) => e.payload.conversationId === conversation.id)).toHaveLength(11);
    expect((await wsOf(`ws:${owner.workspaceId}`, 'message.updated')).filter((e) => e.payload.conversationId === conversation.id && e.payload.attachments).length).toBe(5);

    // a reaction of the customer on a message is kept on that message; removing it clears it
    const target = await db.message.findFirstOrThrow({ where: { conversationId: conversation.id, type: 'image' } });
    const react = (reaction: Record<string, unknown>) => ({ sender: { id: sender }, recipient: { id: channel.externalId }, timestamp: Date.now(), reaction: { mid: target.externalId, ...reaction } });
    await postWebhook(app, delivery(channel, [react({ action: 'react', reaction: 'love', emoji: '❤' })])).expect(200);
    await work(app, [owner.workspaceId]);
    expect((await db.message.findUniqueOrThrow({ where: { id: target.id } })).customerReaction).toBe('like');
    await postWebhook(app, delivery(channel, [react({ action: 'unreact' })])).expect(200);
    await work(app, [owner.workspaceId]);
    expect((await db.message.findUniqueOrThrow({ where: { id: target.id } })).customerReaction).toBeNull();
    // read receipts are acknowledged and ignored
    await postWebhook(app, delivery(channel, [{ sender: { id: sender }, recipient: { id: channel.externalId }, timestamp: Date.now(), read: { watermark: Date.now() } }])).expect(200);
    await work(app, [owner.workspaceId]);
    expect(await db.message.count({ where: { conversationId: conversation.id } })).toBe(11);
  });

  it('Instagram deliveries (object = instagram) land on the linked child channel; profile failure gives the placeholder name', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const ig = (await instagramChild(page.id))!;
    const sender = newSender();
    meta.failNext('userProfile', new MetaError('unknown', 'Unsupported get request', 100, 33, 400));
    const { conversation, message } = await receive(app, ig, sender, { text: 'واش السعر؟' });
    expect(message).toMatchObject({ type: 'text', text: 'واش السعر؟' });
    expect(conversation.channelId).toBe(ig.id);
    const view = (await owner.get(`/conversations/${conversation.id}`).expect(200)).body.data;
    expect(view.client.name).toBe(`IG User ·${sender.slice(-6)}`);
    expect(view.language).toBe('ar'); // last customer language, used for the system texts
    expect(view.channel).toMatchObject({ platform: 'instagram', id: ig.id });
  });

  it('a download that keeps failing leaves the message readable with "media unavailable"', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const sender = newSender();
    const item = messageItem(channel, sender, { attachments: [{ type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/v/t1/blocked.jpg' } }] });
    await postWebhook(app, delivery(channel, [item])).expect(200);
    // the fake adapter never fetches a real host: a retryable failure, which the queue retries
    await work(app, [owner.workspaceId], { tolerate: ['fetch-attachment'] });
    const m = await db.message.findFirstOrThrow({ where: { externalId: (item.message as { mid: string }).mid } });
    expect((m.attachments as any[])[0]).toMatchObject({ pending: true });
    const processor = app.app.get(InboundProcessor);
    const data = { workspaceId: owner.workspaceId, messageId: m.id, index: 0 };
    await expect(processor.fetchAttachment(data, { attemptsMade: 0, opts: { attempts: 3 } } as never)).rejects.toBeInstanceOf(MetaError);
    expect(await processor.fetchAttachment(data, { attemptsMade: 2, opts: { attempts: 3 } } as never)).toBe('failed');
    const view = (await owner.get(`/conversations/${m.conversationId}/messages`).expect(200)).body.data[0];
    expect(view.attachments[0]).toMatchObject({ type: 'image', pending: false, error: 'unavailable' });
    expect(await processor.fetchAttachment(data, { attemptsMade: 0, opts: { attempts: 3 } } as never)).toBe('noop');
  });

  it('inbound text containing a blocked word is flagged, never blocked (04 §13)', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    await owner.put('/safety/blocked-words', { words: ['Arnaque', 'نصاب'] }).expect(200);
    const { message } = await receive(app, channel, newSender(), { text: 'c\'est une ARNAQUE ça' });
    expect(message!.containsBlockedWord).toBe(true);
    const clean = await receive(app, channel, newSender(), { text: 'merci beaucoup' });
    expect(clean.message!.containsBlockedWord).toBe(false);
    expect((await owner.get(`/conversations/${message!.conversationId}/messages`).expect(200)).body.data[0].flags).toEqual(['blocked_word']);
  });
});

describe('echo of a manual reply from the Page inbox', () => {
  it('is stored as a human message and pauses the AI per the workspace setting; our own echoes are ignored', async () => {
    const { owner, channel } = await withAgent();
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'Bonjour' });
    const echo = (message: Record<string, unknown>) => ({ sender: { id: channel.externalId }, recipient: { id: sender }, timestamp: Date.now(), message: { mid: mid(), is_echo: true, ...message } });

    // echo of a message our app sent: nothing
    await postWebhook(app, delivery(channel, [echo({ text: 'envoyé par Djaber', app_id: Number(OWN_APP_ID) })])).expect(200);
    await work(app, [owner.workspaceId]);
    expect(await db.message.count({ where: { conversationId: conversation.id } })).toBe(1);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).aiPaused).toBe(false);

    // typed in the Meta Business Suite (another app id): a human reply ⇒ AI paused
    await postWebhook(app, delivery(channel, [echo({ text: 'Je vous réponds depuis la page', app_id: 263902037430900 })])).expect(200);
    await work(app, [owner.workspaceId]);
    const stored = await db.message.findFirstOrThrow({ where: { conversationId: conversation.id, direction: 'out' } });
    expect(stored).toMatchObject({ author: 'human', authorUserId: null, aiRunId: null, deliveryStatus: 'sent', text: 'Je vous réponds depuis la page' });
    expect(stored.payload).toMatchObject({ external: true });
    const paused = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(paused).toMatchObject({ aiPaused: true, unreadCount: 1, version: conversation.version + 1 });
    expect((await wsOf(`ws:${owner.workspaceId}`, 'conversation.updated')).some((e) => e.payload.conversation.id === conversation.id && e.payload.conversation.aiPaused === true)).toBe(true);
    expect(sendsTo(sender)).toHaveLength(0); // an echo is never sent again

    // setting off ⇒ stored, AI stays on
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { autoPauseOnManualReply: false } });
    const other = newSender();
    const second = await receive(app, channel, other, { text: 'Salam' });
    await postWebhook(app, delivery(channel, [{ ...echo({ text: 'manuel', app_id: 263902037430900 }), recipient: { id: other } }])).expect(200);
    await work(app, [owner.workspaceId]);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: second.conversation.id } })).aiPaused).toBe(false);
    expect(await db.message.count({ where: { conversationId: second.conversation.id, direction: 'out', author: 'human' } })).toBe(1);

    // the echo of a reply sent from our inbox (no app id, as on Instagram) is recognised and not duplicated
    const sent = await reply(owner, second.conversation.id, { text: 'depuis Djaber' }).expect(201);
    await postWebhook(app, delivery(channel, [{ ...echo({ text: 'depuis Djaber' }), recipient: { id: other } }])).expect(200);
    await work(app, [owner.workspaceId]);
    expect(await db.message.count({ where: { conversationId: second.conversation.id, text: 'depuis Djaber' } })).toBe(1);
    expect((await db.message.findUniqueOrThrow({ where: { id: sent.body.data.id } })).deliveryStatus).toBe('sent');
  });
});

describe('MSG-05 batching hook and MSG-09 unsupported media', () => {
  it('AT-MSG-03 three messages within 3 s ⇒ one reply job for the conversation (the AI of M4 answers all three)', async () => {
    const registry = app.app.get(ProcessorRegistry);
    const queue = app.app.get(QueueService).queue('ai-reply');
    const { owner, channel } = await withAgent();
    const sender = newSender();

    // the reply processor of M4 is registered: one delayed job per conversation, pushed back by each message
    expect(registry.handlers.get('ai-reply')?.has('reply') ?? false).toBe(true);
    const first = await receive(app, channel, sender, { text: 'Salam' });
    expect(await queue.getJob(jobId(`ai:${first.conversation.id}`))).toBeDefined();

    try {
      const typing = meta.callsOf('senderAction').length;
      const a = await receive(app, channel, sender, { text: 'vous avez le modèle rouge ?' });
      await receive(app, channel, sender, { text: 'taille 42' });
      await receive(app, channel, sender, { text: 'livraison à Oran ?' });
      const job = await queue.getJob(jobId(`ai:${first.conversation.id}`));
      expect(job).toBeDefined();
      expect(await job!.getState()).toBe('delayed');
      expect(job!.data).toMatchObject({ workspaceId: owner.workspaceId, conversationId: first.conversation.id, batchKey: first.message!.id });
      expect(a.message!.id).not.toBe(first.message!.id);
      const mine = (await queue.getJobs(['delayed', 'waiting', 'active'])).filter((j) => j.data.conversationId === first.conversation.id);
      expect(mine).toHaveLength(1);
      expect(job!.opts.delay).toBe(3000); // agent.responseDelaySec default
      expect(meta.callsOf('senderAction').slice(typing).every((c) => c.args.action === 'typing_on' && c.args.recipientId === sender)).toBe(true);
      expect(meta.callsOf('senderAction').length - typing).toBe(3);

      // a paused thread, a blocked customer or a page without agent schedules nothing
      await db.conversation.update({ where: { id: first.conversation.id }, data: { aiPaused: true } });
      await job!.remove();
      await receive(app, channel, sender, { text: 'allo ?' });
      expect(await queue.getJob(jobId(`ai:${first.conversation.id}`))).toBeUndefined();
      const noAgent = await asOwner(app);
      const bare = await connectedPage(noAgent, app);
      const lone = await receive(app, bare, newSender(), { text: 'Salam' });
      expect(await queue.getJob(jobId(`ai:${lone.conversation.id}`))).toBeUndefined();
    } finally {
      for (const j of await queue.getJobs(['delayed', 'waiting'])) await j.remove().catch(() => undefined);
    }
  });

  it('AT-MSG-04 video only ⇒ unsupported-media message once; second video in 24 h ⇒ silent', async () => {
    const { owner, channel } = await withAgent();
    const sender = newSender();
    const video = { attachments: [{ type: 'video', payload: { url: 'https://fake.meta.local/clip.mp4' } }] };
    const { conversation } = await receive(app, channel, sender, video);
    await work(app, [owner.workspaceId]);
    const out = await db.message.findMany({ where: { conversationId: conversation.id, direction: 'out' } });
    expect(out).toHaveLength(1);
    // fixed platform text, in the customer's language (default FR), stored as a system message and sent as a plain response
    expect(out[0]).toMatchObject({ author: 'system', type: 'text', text: getMessages('fr')['customer.unsupportedMedia'], deliveryStatus: 'sent' });
    expect(sendsTo(sender)).toHaveLength(1);
    expect(sendsTo(sender)[0]!.args).toMatchObject({ messagingType: 'RESPONSE', message: { kind: 'text', text: getMessages('fr')['customer.unsupportedMedia'] } });

    await receive(app, channel, sender, video);
    await receive(app, channel, sender, { sticker_id: 1, attachments: [{ type: 'image', payload: { url: 'https://fake.meta.local/s.png', sticker_id: 1 } }] });
    await work(app, [owner.workspaceId]);
    expect(await db.message.count({ where: { conversationId: conversation.id, direction: 'out' } })).toBe(1);
    expect(sendsTo(sender)).toHaveLength(1);

    // a day later it may be sent again
    const ctx = (await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).context as Record<string, any>;
    await db.conversation.update({ where: { id: conversation.id }, data: { context: { ...ctx, lastSystemTextAt: { unsupportedMedia: new Date(Date.now() - 25 * HOUR).toISOString() } } } });
    await receive(app, channel, sender, video);
    await work(app, [owner.workspaceId]);
    expect(sendsTo(sender)).toHaveLength(2);

    // a page without an active agent is a human inbox only: no automatic text
    const human = await asOwner(app);
    const bare = await connectedPage(human, app);
    const lone = newSender();
    await receive(app, bare, lone, video);
    await work(app, [human.workspaceId]);
    expect(sendsTo(lone)).toHaveLength(0);
  });

  it('abuse guard (D33): 50 messages in 10 minutes ⇒ handed to a human once, with the workspace handoff text', async () => {
    const { owner, channel } = await withAgent();
    const sender = newSender();
    const items = Array.from({ length: 50 }, (_, i) => messageItem(channel, sender, { text: `spam ${i}` }, Date.now() + i));
    await postWebhook(app, delivery(channel, items)).expect(200);
    await work(app, [owner.workspaceId]);
    const conversation = await db.conversation.findFirstOrThrow({ where: { channelId: channel.id, externalSenderId: sender } });
    expect(conversation).toMatchObject({ status: 'needs_human', aiPaused: true });
    const handoff = await db.message.findMany({ where: { conversationId: conversation.id, direction: 'out' } });
    expect(handoff).toHaveLength(1);
    expect(handoff[0]!.text).toBe('Je transmets à un membre de l\'équipe qui vous répondra très vite.');
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'conversation_handoff' } })).toBe(1);
    expect((await owner.get(`/conversations/${conversation.id}`).expect(200)).body.data.handoffReason).toBe('abuse_guard');
  });
});

describe('MSG-06 outbound rules', () => {
  it('AT-MSG-05 transactional notification > 24 h after last customer message ⇒ skipped_window on FB (POST_PURCHASE_UPDATE retired by Meta) and on IG', async () => {
    const owner = await asOwner(app);
    const page = await connectedPage(owner, app);
    const ig = (await instagramChild(page.id))!;
    const fbSender = newSender();
    const igSender = newSender();
    const fb = await receive(app, page, fbSender, { text: 'commande' });
    const insta = await receive(app, ig, igSender, { text: 'commande' });
    const old = new Date(Date.now() - 25 * HOUR);
    await db.conversation.updateMany({ where: { id: { in: [fb.conversation.id, insta.conversation.id] } }, data: { lastCustomerMessageAt: old } });
    const params = { number: '1042', tracking: 'ZR-778', courier: 'ZR Express' };

    const sentFb = await inWorkspace(owner.workspaceId, () => outbound.sendSystemText(fb.conversation.id, 'orderShipped', params, { kind: 'transactional' }));
    const sentIg = await inWorkspace(owner.workspaceId, () => outbound.sendSystemText(insta.conversation.id, 'orderShipped', params, { kind: 'transactional' }));
    await work(app, [owner.workspaceId]);

    // Messenger: Meta answers #100 to every POST_PURCHASE_UPDATE since 2026-04-27 (changelog 2026-03-27) ⇒ stored, labelled, never attempted
    expect(await db.message.findUniqueOrThrow({ where: { id: sentFb!.id } })).toMatchObject({ deliveryStatus: 'skipped_window', author: 'system', text: 'Votre commande #1042 est en route · suivi ZR-778 (ZR Express).' });
    expect(sendsTo(fbSender)).toHaveLength(0);
    // Instagram outside the window: stored, labelled, never attempted
    expect(await db.message.findUniqueOrThrow({ where: { id: sentIg!.id } })).toMatchObject({ deliveryStatus: 'skipped_window', error: null });
    expect(sendsTo(igSender)).toHaveLength(0);
    const thread = (await owner.get(`/conversations/${insta.conversation.id}/messages`).expect(200)).body.data;
    expect(thread[0]).toMatchObject({ id: sentIg!.id, deliveryStatus: 'skipped_window', author: 'system' });

    // inside the window both leave as plain responses; the AI / system texts never use a tag outside it
    await db.conversation.updateMany({ where: { id: { in: [fb.conversation.id, insta.conversation.id] } }, data: { lastCustomerMessageAt: new Date() } });
    await inWorkspace(owner.workspaceId, () => outbound.sendSystemText(insta.conversation.id, 'orderDelivered', { number: '1042' }, { kind: 'transactional' }));
    await work(app, [owner.workspaceId]);
    expect(sendsTo(igSender).map((c) => c.args.messagingType)).toEqual(['RESPONSE']);
    await db.conversation.update({ where: { id: fb.conversation.id }, data: { lastCustomerMessageAt: old } });
    const ai = await inWorkspace(owner.workspaceId, () => prisma.$transaction((tx) => outbound.store(tx as Tx, fb.conversation.id, { author: 'ai', kind: 'ai', text: 'réponse IA tardive' })));
    await work(app, [owner.workspaceId]);
    expect(ai.message.deliveryStatus).toBe('skipped_window');
    expect(sendsTo(fbSender)).toHaveLength(0);
  });

  it('AT-MSG-06 AI reply send fails with 10/2018278 ⇒ no tag retry, message failed, conversation needs_human', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'Salam' });
    const { message } = await inWorkspace(owner.workspaceId, () => prisma.$transaction((tx) => outbound.store(tx as Tx, conversation.id, { author: 'ai', kind: 'ai', text: 'Bonjour ! Oui c\'est disponible.' })));
    expect(message.deliveryStatus).toBe('pending');
    meta.failNext('send', new MetaError('window', '(#10) This message is sent outside of allowed window', 10, 2018278, 400));
    await work(app, [owner.workspaceId]);

    expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ deliveryStatus: 'failed', error: 'REPLY_OUTSIDE_WINDOW', author: 'ai' });
    // exactly one attempt, without any tag: the AI never falls back to HUMAN_AGENT
    expect(sendsTo(sender)).toHaveLength(1);
    expect(sendsTo(sender)[0]!.args).toMatchObject({ messagingType: 'RESPONSE' });
    expect(sendsTo(sender)[0]!.args.tag).toBeUndefined();
    const after = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after).toMatchObject({ status: 'needs_human', aiPaused: true });
    const thread = (await owner.get(`/conversations/${conversation.id}/messages`).expect(200)).body.data;
    expect(thread[0]).toMatchObject({ type: 'system', payload: { system: { kind: 'send_failed_outside_window' } } });
    expect((await owner.get(`/conversations/${conversation.id}`).expect(200)).body.data.handoffReason).toBe('outside_window');
    expect((await wsOf(`ws:${owner.workspaceId}`, 'conversation.updated')).some((e) => e.payload.conversation.id === conversation.id && e.payload.conversation.status === 'needs_human')).toBe(true);
    // the channel is fine: this is not a token problem
    expect((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).status).toBe('active');
  });

  it('retries only what Meta may accept later (rate limit / network), resumes after a partial send, and is safe to run twice', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'Salam' });
    const job = (attemptsMade: number) => ({ attemptsMade, opts: { attempts: 5 } }) as never;
    const draft = (text: string) => inWorkspace(owner.workspaceId, () => prisma.$transaction((tx) => outbound.store(tx as Tx, conversation.id, { author: 'human', kind: 'human', text, attachments: [{ type: 'image', url: 'https://cdn.djaber.test/p.webp', mime: 'image/webp', size: 10 }] })));
    const dataOf = async (id: string) => (await db.outbox.findUniqueOrThrow({ where: { topic_key: { topic: 'job', key: `send:${id}` } } })).payload as { data: any; opts: any };

    // image accepted, text hits the rate limit ⇒ the job fails for a retry; the retry sends only the text
    const one = await draft('deux parties');
    const payload = await dataOf(one.message.id);
    expect(payload.opts).toMatchObject({ attempts: 5, backoff: { type: 'exponential', delay: 15000 } });
    const before = sendsTo(sender).length;
    meta.failNext('send', new MetaError('rate_limit', 'Calls to this api have exceeded the rate limit', 613, null, 400));
    // the failure is scripted for the next call = the image; let the image through first by queueing a success-less order
    await expect(outbound.process(payload.data, job(0))).rejects.toBeInstanceOf(MetaError);
    expect((await db.message.findUniqueOrThrow({ where: { id: one.message.id } })).deliveryStatus).toBe('pending');
    expect(await outbound.process(payload.data, job(1))).toBe('sent');
    const calls = sendsTo(sender).slice(before).map((c) => (c.args.message as { kind: string }).kind);
    expect(calls).toEqual(['attachment', 'attachment', 'text']); // refused image, then image + text
    expect(await outbound.process(payload.data, job(2))).toBe('noop'); // a duplicate run sends nothing
    expect(sendsTo(sender).length - before).toBe(3);
    const stored = await db.message.findUniqueOrThrow({ where: { id: one.message.id } });
    expect(stored.deliveryStatus).toBe('sent');
    expect(stored.externalId).toMatch(/^m_fake_/);

    // partial success: the image is accepted, the text fails ⇒ the retry does not send the image twice
    const two = await draft('reprise');
    const p2 = await dataOf(two.message.id);
    const start = sendsTo(sender).length;
    const realSend = meta.send.bind(meta);
    let n = 0;
    jest.spyOn(meta, 'send').mockImplementation(async (auth, input) => {
      if (++n === 2) {
        meta.calls.push({ op: 'send', args: { externalId: auth.externalId, ...input } });
        throw new MetaError('network', 'socket hang up');
      }
      return realSend(auth, input);
    });
    await expect(outbound.process(p2.data, job(0))).rejects.toBeInstanceOf(MetaError);
    jest.restoreAllMocks();
    expect(await outbound.process(p2.data, job(1))).toBe('sent');
    expect(sendsTo(sender).slice(start).map((c) => (c.args.message as { kind: string }).kind)).toEqual(['attachment', 'text', 'text']);

    // last attempt of a retryable error ⇒ failed META_UNAVAILABLE; a non-retryable one fails at once
    const three = await draft('jamais');
    const p3 = await dataOf(three.message.id);
    meta.failNext('send', new MetaError('unavailable', 'Service temporarily unavailable', 2, null, 500));
    expect(await outbound.process(p3.data, job(4))).toBe('failed');
    expect(await db.message.findUniqueOrThrow({ where: { id: three.message.id } })).toMatchObject({ deliveryStatus: 'failed', error: 'META_UNAVAILABLE' });
    const four = await draft('bloqué');
    const p4 = await dataOf(four.message.id);
    meta.failNext('send', new MetaError('user_unavailable', 'This person isn\'t available right now', 551, 1545041, 400));
    expect(await outbound.process(p4.data, job(0))).toBe('failed');
    expect(await db.message.findUniqueOrThrow({ where: { id: four.message.id } })).toMatchObject({ deliveryStatus: 'failed', error: 'PROVIDER_UNAVAILABLE', payload: { _sendError: { kind: 'user_unavailable', code: 551, subcode: 1545041, http: 400, message: "This person isn't available right now" } } });
    // Meta's own answer stays on the row for the diagnosis (tester account 26/10), never in the message DTO
    const thread4 = await owner.get(`/conversations/${four.message.conversationId}/messages`).expect(200);
    expect(JSON.stringify(thread4.body.data)).not.toContain('sendError');
    // an unknown error is retried 3 times at most
    const five = await draft('inconnu');
    const p5 = await dataOf(five.message.id);
    meta.failNext('send', new MetaError('unknown', 'Unexpected', 9999, null, 400));
    await expect(outbound.process(p5.data, job(1))).rejects.toBeInstanceOf(MetaError);
    meta.failNext('send', new MetaError('unknown', 'Unexpected', 9999, null, 400));
    expect(await outbound.process(p5.data, job(2))).toBe('failed');
    await work(app, [owner.workspaceId]); // leftovers of this test: every message is already settled
  });

  it('AT-MSG-09 AI reply mentions 7 products ⇒ 5 cards sent', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'vous avez quoi ?' });
    const products: { id: string; name: string }[] = [];
    for (let i = 0; i < 7; i++) products.push(await createProduct(owner, { name: `Robe ${i + 1}`, price: 2500 + i * 100 }));
    const archived = await createProduct(owner, { name: 'Ancien', price: 900 });
    await db.product.update({ where: { id: archived.id }, data: { deletedAt: new Date() } });
    await db.productImage.create({ data: { productId: products[0]!.id, storageKey: 'ws/x/p.webp', url: 'https://cdn.djaber.test/p1.webp', width: 800, height: 800, isPrimary: true } });
    // an AI card shows approved pictures only (tester report 25/10 UX-006): this one is part of the approved snapshot
    const approved = await db.product.findUniqueOrThrow({ where: { id: products[0]!.id } });
    await db.product.update({ where: { id: approved.id }, data: { approvedSnapshot: { ...(approved.approvedSnapshot as object), images: ['https://cdn.djaber.test/p1.webp'] } } });

    const message = await inWorkspace(owner.workspaceId, () => outbound.sendCards(conversation.id, [archived.id, ...products.map((p) => p.id)], { author: 'ai', kind: 'ai' }));
    const cards = (message!.payload as { cards: { productId: string; name: string; price: number; imageUrl: string | null }[] }).cards;
    expect(cards).toHaveLength(5); // MSG-07; the archived product is skipped (FL-01 F-9)
    expect(cards.map((c) => c.name)).toEqual(['Robe 1', 'Robe 2', 'Robe 3', 'Robe 4', 'Robe 5']);
    expect(message).toMatchObject({ type: 'product_cards', author: 'ai' });
    await work(app, [owner.workspaceId]);
    const calls = sendsTo(sender).map((c) => c.args.message as { kind: string; text?: string; url?: string });
    // card = image (when the product has one) + "name / price DA" text
    expect(calls.filter((c) => c.kind === 'text')).toHaveLength(5);
    expect(calls.filter((c) => c.kind === 'attachment')).toEqual([{ kind: 'attachment', type: 'image', url: 'https://cdn.djaber.test/p1.webp' }]);
    expect(calls[1]!.text).toBe('Robe 1\n2 500 DA');
    const view = (await owner.get(`/conversations/${conversation.id}/messages`).expect(200)).body.data[0];
    expect(view).toMatchObject({ type: 'product_cards', deliveryStatus: 'sent' });
    expect(view.payload.cards).toHaveLength(5);
    // nothing to show ⇒ nothing stored
    expect(await inWorkspace(owner.workspaceId, () => outbound.sendCards(conversation.id, [archived.id]))).toBeNull();
  });
});

describe('MSG-08 retention (sched-retention step)', () => {
  it('purges messages older than 12 months, anonymises emptied conversations, drops raw events after 7 days', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const oldSender = newSender();
    const liveSender = newSender();
    const old = await receive(app, channel, oldSender, { text: 'vieux', attachments: [{ type: 'image', payload: { url: 'https://fake.meta.local/old.jpg' } }] });
    const live = await receive(app, channel, liveSender, { text: 'récent' });
    const longAgo = new Date(Date.now() - 400 * 86400_000);
    await db.message.updateMany({ where: { conversationId: old.conversation.id }, data: { sentAt: longAgo } });
    await db.conversation.update({ where: { id: old.conversation.id }, data: { lastMessageAt: longAgo } });
    await db.inboundEvent.updateMany({ where: { externalId: old.mid }, data: { receivedAt: new Date(Date.now() - 8 * 86400_000) } });

    // the purge is a step of the existing nightly job
    const cron = app.app.get(ProcessorRegistry).crons.find((c) => c.name === 'sched-retention')!;
    await TenantContext.runSystem(() => cron.handler());

    expect(await db.message.count({ where: { conversationId: old.conversation.id } })).toBe(0);
    const anonymised = await db.conversation.findUniqueOrThrow({ where: { id: old.conversation.id } });
    expect(anonymised.externalSenderId).toMatch(/^anon:[0-9a-f]{40}$/);
    expect(anonymised.lastMessagePreview).toBeNull();
    expect(await db.inboundEvent.count({ where: { externalId: old.mid } })).toBe(0);
    // recent data untouched
    expect(await db.message.count({ where: { conversationId: live.conversation.id } })).toBe(1);
    expect(await db.inboundEvent.count({ where: { externalId: live.mid } })).toBe(1);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: live.conversation.id } })).externalSenderId).toBe(liveSender);
    // a second run changes nothing; the same customer writing again simply opens a new thread
    expect(await app.app.get(DataLifecycleService).purge()).toMatchObject({ messages: 0, conversations: 0 });
    const back = await receive(app, channel, oldSender, { text: 'me revoilà' });
    expect(back.conversation.id).not.toBe(old.conversation.id);
  });
});
