// Helpers of the M2 suites: run the worker side synchronously (outbox → registered job handlers), build files.
import sharp from 'sharp';
import request from 'supertest';
import { rawPrisma as db, TenantContext } from '@djaber/db';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import type { Actor } from './actors';
import type { TestApp } from './app';

type OutboxRow = { id: string; topic: string; key: string; payload: any; workspaceId: string | null };

/**
 * What the worker does, without BullMQ: pending outbox rows of the given workspace are dispatched — `job` rows straight to
 * the handler registered for their queue / job name (ProcessorRegistry), the other topics to their outbox handler.
 * Loops until nothing is pending (a job may schedule another one: re-encode → caption). Returns the job names run.
 */
export const drain = async (app: TestApp, workspaceId: string, topics = ['job', 'notification', 'webhook']): Promise<string[]> => {
  const registry = app.app.get(ProcessorRegistry);
  const ran: string[] = [];
  for (let round = 0; round < 20; round++) {
    const rows = (await db.outbox.findMany({ where: { workspaceId, processedAt: null, topic: { in: topics } }, orderBy: { createdAt: 'asc' } })) as unknown as OutboxRow[];
    if (!rows.length) break;
    for (const row of rows) {
      if (row.topic === 'job') {
        const handler = registry.handlers.get(row.payload.queue)?.get(row.payload.name);
        if (!handler) throw new Error(`no handler for ${row.payload.queue}/${row.payload.name}`);
        await TenantContext.runSystem(() => handler(row.payload.data, { id: row.key, name: row.payload.name, attemptsMade: 0 } as never));
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

/** WS events written to the outbox for a workspace room (newest last). */
export const wsEvents = async (workspaceId: string, event: string) => {
  const rows = await db.outbox.findMany({ where: { topic: 'ws' }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => r.payload as { room: string; event: string; payload: any }).filter((p) => p.room === `ws:${workspaceId}` && p.event === event);
};

export const image = (width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') => {
  const img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } });
  return (format === 'png' ? img.png() : format === 'webp' ? img.webp() : img.jpeg()).toBuffer();
};

/** Multipart upload with the actor's headers. */
export const upload = (actor: Actor, app: TestApp, url: string, field: string, files: { buffer: Buffer; name: string; type: string }[], fields: Record<string, string> = {}) => {
  let r = request(app.http()).post(`/api/v1${url}`).set(actor.headers);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  for (const f of files) r = r.attach(field, f.buffer, { filename: f.name, contentType: f.type });
  return r;
};

let seq = 0;
/** Minimal valid body of `POST /products`. */
export const productBody = (over: Record<string, unknown> = {}) => ({ name: `Produit ${++seq}`, price: 2500, stock: 10, ...over });

export const createProduct = async (actor: Actor, over: Record<string, unknown> = {}): Promise<{ id: string; name: string } & Record<string, any>> => {
  const res = await actor.post('/products', productBody(over));
  if (res.status !== 201) throw new Error(`create product failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};

export const key = () => `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** `POST /stock/adjustments` with a fresh Idempotency-Key. */
export const adjust = (actor: Actor, body: Record<string, unknown>) => actor.post('/stock/adjustments', body).set('Idempotency-Key', key());

export const csv = (rows: (string | number)[][]) => Buffer.from(rows.map((r) => r.map((c) => (/[",;\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n'), 'utf8');

export const jobOf = async (actor: Actor, jobId: string) => (await actor.get(`/jobs/${jobId}`).expect(200)).body.data as Record<string, any>;

/** An agent row (the agents module arrives in M4): provider + model are created on first use. */
export const testAgent = async (workspaceId: string, name = 'Vendeur') => {
  const provider = await db.aiProvider.upsert({ where: { key: 'openai' }, create: { key: 'openai', displayName: 'OpenAI' }, update: {} });
  const model = await db.aiModel.upsert({
    where: { providerId_modelId: { providerId: provider.id, modelId: 'test-model' } },
    create: { providerId: provider.id, modelId: 'test-model', displayName: 'Test model', capabilities: ['text'], inputPricePerM: 1, outputPricePerM: 1 },
    update: {},
  });
  return db.agent.create({ data: { workspaceId, name, modelId: model.id, status: 'active', approvedName: name, nameStatus: 'approved' } });
};

/** An order with one line on a product (orders arrive in M5): enough for "has orders" / reserved / sales figures. */
export const testOrder = async (workspaceId: string, product: { id: string; name: string }, o: { quantity?: number; unitPrice?: number; status?: string; number?: string } = {}) => {
  const quantity = o.quantity ?? 1;
  const unitPrice = o.unitPrice ?? 1000;
  const client = await db.client.create({ data: { workspaceId, name: 'Client test', phone: `05${Math.floor(10000000 + Math.random() * 89999999)}` } });
  const order = await db.order.create({
    data: {
      workspaceId,
      number: o.number ?? `CMD-T-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      clientId: client.id,
      source: 'manual',
      clientName: client.name,
      clientPhone: client.phone!,
      subtotal: quantity * unitPrice,
      total: quantity * unitPrice,
      status: (o.status ?? 'confirmed') as never,
    },
  });
  await db.orderItem.create({ data: { orderId: order.id, productId: product.id, productName: product.name, unitPrice, quantity, total: quantity * unitPrice } });
  return order;
};

export { db };
