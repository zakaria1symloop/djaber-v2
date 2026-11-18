// Helpers of the M3 suites: the fake Meta adapter, signed webhook deliveries, the worker side run synchronously.
// Nothing here (nor anywhere in the tests) talks to Meta: `META_DRIVER=fake` (test/setup/env.cjs) and a `fetch` guard.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ConnectReport } from '@djaber/shared';
import { rawPrisma as db, TenantContext } from '@djaber/db';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import { FakeMetaGateway } from '../../src/modules/meta/fake-meta.gateway';
import { signWebhookBody } from '../../src/modules/meta/meta-signature';
import { META_GATEWAY } from '../../src/modules/meta/meta.gateway';
import type { Actor } from './actors';
import type { TestApp } from './app';

export const APP_SECRET = 'test-meta-app-secret';
export const VERIFY_TOKEN = 'test-meta-verify-token';
export const OWN_APP_ID = '100000000000001';

export const fakeMeta = (app: TestApp): FakeMetaGateway => {
  const gateway = app.app.get(META_GATEWAY);
  if (!(gateway instanceof FakeMetaGateway)) throw new Error('tests must run with the fake Meta adapter');
  return gateway;
};

/** Makes any real network call fail the test run: the suites must never leave the process. */
export const forbidNetwork = () => {
  const original = globalThis.fetch;
  const spy = jest.fn(async (input: unknown) => {
    throw new Error(`unexpected network call in tests: ${String(input).slice(0, 80)}`);
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return { spy, restore: () => (globalThis.fetch = original) };
};

type OutboxRow = { id: string; topic: string; key: string; payload: any; workspaceId: string | null };

/**
 * The worker, synchronously: pending outbox rows of the given workspaces — plus the workspace-less rows of the Meta
 * intake (webhook events, data-deletion jobs) — go to their registered handler. Loops until nothing is pending.
 * `tolerate` = job names whose thrown error is swallowed (a retryable Meta failure that BullMQ would retry later).
 */
export const work = async (app: TestApp, workspaceIds: string[], o: { tolerate?: string[] } = {}): Promise<string[]> => {
  const registry = app.app.get(ProcessorRegistry);
  const ran: string[] = [];
  for (let round = 0; round < 30; round++) {
    const rows = (await db.outbox.findMany({
      where: { processedAt: null, topic: { in: ['job', 'notification', 'webhook'] }, OR: [{ workspaceId: { in: workspaceIds } }, { workspaceId: null, topic: 'job' }] },
      orderBy: { createdAt: 'asc' },
    })) as unknown as OutboxRow[];
    const mine = rows.filter((r) => r.workspaceId !== null || ['meta-inbound'].includes(r.payload.queue) || r.payload.name === 'meta-data-deletion');
    if (!mine.length) break;
    for (const row of mine) {
      if (row.topic === 'job') {
        const handler = registry.handlers.get(row.payload.queue)?.get(row.payload.name);
        if (!handler) throw new Error(`no handler for ${row.payload.queue}/${row.payload.name}`);
        try {
          await TenantContext.runSystem(() => handler(row.payload.data, { id: row.key, name: row.payload.name, attemptsMade: 0, opts: row.payload.opts ?? {} } as never));
        } catch (e) {
          if (!o.tolerate?.includes(row.payload.name)) throw e;
        }
        ran.push(row.payload.name);
      } else {
        const handler = registry.outbox.get(row.topic);
        if (!handler) throw new Error(`no outbox handler for ${row.topic}`);
        await TenantContext.runSystem(() => handler(row));
      }
      await db.outbox.update({ where: { id: row.id }, data: { processedAt: new Date() } });
    }
  }
  return ran;
};

/**
 * WS events written to the outbox for a room, oldest first. Always read events through this helper when the order matters
 * (`.at(-1)` = the latest): a `findMany` without `orderBy` returns heap order, which stops being insertion order once
 * earlier tests have updated / vacuumed outbox rows (the AT-BIL-04 flake, full suite 18/11).
 */
export const wsOf = async (room: string, event: string) => {
  const rows = await db.outbox.findMany({ where: { topic: 'ws' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return rows.map((r) => r.payload as { room: string; event: string; payload: any }).filter((p) => p.room === room && p.event === event);
};

// --- connect -----------------------------------------------------------------------------------------------------------------
/** Query string of the URL returned by `GET /channels/connect/:platform` (the fake dialog points at our own callback). */
export const startConnect = async (actor: Actor, platform: 'facebook' | 'instagram' = 'facebook') => {
  const res = await actor.get(`/channels/connect/${platform}`).expect(200);
  const url = new URL(res.body.data.url as string);
  return { url, code: url.searchParams.get('code')!, state: url.searchParams.get('state')!, seed: url.searchParams.get('code')!.split('.').slice(1).join('.') };
};
/** Calls the OAuth callback as the browser would (no bearer), asking for the JSON report. */
export const callback = async (app: TestApp, platform: 'facebook' | 'instagram', query: Record<string, string>): Promise<ConnectReport> => {
  const res = await request(app.http()).get(`/api/v1/channels/callback/${platform}`).query(query).set('Accept', 'application/json').expect(200);
  return res.body.data as ConnectReport;
};
/** Full fake connect of the default pages (two Facebook pages, the first with a linked Instagram account). */
export const connect = async (actor: Actor, app: TestApp, platform: 'facebook' | 'instagram' = 'facebook') => {
  const s = await startConnect(actor, platform);
  return callback(app, platform, { code: s.code, state: s.state });
};
/** One active Facebook page of the actor's workspace, connected through the fake flow. */
export const connectedPage = async (actor: Actor, app: TestApp) => {
  const report = await connect(actor, app);
  const row = report.pages.find((p) => p.platform === 'facebook' && p.channelId);
  if (!row) throw new Error(`connect failed: ${JSON.stringify(report)}`);
  return db.channel.findUniqueOrThrow({ where: { id: row.channelId! } });
};
export const instagramChild = (pageChannelId: string) => db.channel.findFirst({ where: { parentChannelId: pageChannelId } });

// --- webhook deliveries --------------------------------------------------------------------------------------------------------
let senderSeq = 0;
/** A page-scoped sender id (digits only), unique within the run. */
export const newSender = () => `8${String(Date.now()).slice(-10)}${String(++senderSeq).padStart(5, '0')}`;
export const mid = () => `m_${randomUUID().replace(/-/g, '')}`;

export type Delivery = { object: 'page' | 'instagram'; entry: { id: string; time: number; messaging: Record<string, unknown>[] }[] };
export const delivery = (channel: { platform: string; externalId: string }, items: Record<string, unknown>[]): Delivery => ({
  object: channel.platform === 'instagram' ? 'instagram' : 'page',
  entry: [{ id: channel.externalId, time: Date.now(), messaging: items }],
});
export const messageItem = (channel: { externalId: string }, sender: string, message: Record<string, unknown>, at = Date.now()) => ({
  sender: { id: sender },
  recipient: { id: channel.externalId },
  timestamp: at,
  message: { mid: mid(), ...message },
});

/** POST /webhooks/meta with the exact raw body and its `X-Hub-Signature-256` (or the given header / none). */
export const postWebhook = (app: TestApp, body: unknown, signature?: string | null) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const r = request(app.http()).post('/api/v1/webhooks/meta').set('Content-Type', 'application/json');
  if (signature !== null) r.set('X-Hub-Signature-256', signature ?? signWebhookBody(APP_SECRET, raw));
  return r.send(raw);
};

/** A customer message delivered, acknowledged and processed; returns the conversation and the stored message. */
export const receive = async (app: TestApp, channel: { id: string; workspaceId: string; platform: string; externalId: string }, sender: string, message: Record<string, unknown>, at = Date.now()) => {
  const item = messageItem(channel, sender, message, at);
  await postWebhook(app, delivery(channel, [item])).expect(200);
  await work(app, [channel.workspaceId]);
  const conversation = await db.conversation.findFirstOrThrow({ where: { channelId: channel.id, externalSenderId: sender } });
  const stored = await db.message.findFirst({ where: { conversationId: conversation.id, externalId: (item.message as { mid: string }).mid } });
  return { conversation, message: stored, mid: (item.message as { mid: string }).mid };
};

export const idem = () => ({ 'Idempotency-Key': randomUUID() });
/** `POST /conversations/:id/messages` with a fresh Idempotency-Key. */
export const reply = (actor: Actor, conversationId: string, body: Record<string, unknown>) => actor.post(`/conversations/${conversationId}/messages`, body).set(idem());

export { db };
