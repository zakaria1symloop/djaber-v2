// Helpers of the M8 suites (analytics & reports): rows written directly in the database at chosen instants, so that past
// days, rollups and comparisons can be checked without waiting for time to pass.
import { randomUUID } from 'node:crypto';
import { rawPrisma as db } from '@djaber/db';
import { algiersDayStart } from '../../src/core/time/algiers';
import { addDays } from '../../src/modules/analytics/range';

export const DAY = 86_400_000;
/** An instant inside an Algiers day (default 10:00 local). */
export const at = (day: string, hour = 10) => new Date(algiersDayStart(day).getTime() + hour * 3600_000);
export const todayAlgiers = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
export const daysAgo = (n: number) => addDays(todayAlgiers(), -n);

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(++seq).toString(36)}${randomUUID().slice(0, 4)}`;

export const channel = (workspaceId: string, userId: string, platform: 'facebook' | 'instagram' = 'facebook', over: Record<string, unknown> = {}) =>
  db.channel.create({ data: { workspaceId, platform, externalId: `ext-${uniq()}`, name: `Page ${uniq()}`, connectedById: userId, status: 'active', ...over } });

export const aiModel = async () => db.aiModel.findFirstOrThrow({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });

export const agent = async (workspaceId: string, name = 'Vendeur Pro') => {
  const m = await aiModel();
  return db.agent.create({ data: { workspaceId, name, approvedName: name, nameStatus: 'approved', modelId: m.id, status: 'active', customInstructions: '' } as never });
};

export const client = (workspaceId: string, over: Record<string, unknown> = {}) =>
  db.client.create({ data: { workspaceId, name: `Client ${uniq()}`, phone: `05${String(Math.floor(10000000 + Math.random() * 89999999))}`, ...over } });

/** An order written directly (no effects), with optional event instants. */
export const order = async (
  workspaceId: string,
  o: { total: number; status?: string; source?: string; orderedAt: Date; confirmedAt?: Date; shippedAt?: Date; deliveredAt?: Date; cancelledAt?: Date; cancelReason?: string; channelId?: string; agentId?: string; wilayaId?: number; deliveryFee?: number; amountPaid?: number; productId?: string; productName?: string; quantity?: number; costPrice?: number; clientId?: string; conversationId?: string; paymentMethod?: string },
) => {
  const c = o.clientId ? { id: o.clientId, name: 'Client', phone: '0550000000' } : await client(workspaceId);
  const row = await db.order.create({
    data: {
      workspaceId,
      number: `CMD-M8-${uniq()}`,
      clientId: c.id,
      source: (o.source ?? 'manual') as never,
      status: (o.status ?? 'new') as never,
      clientName: c.name,
      clientPhone: c.phone ?? '0550000000',
      subtotal: o.total - (o.deliveryFee ?? 0),
      deliveryFee: o.deliveryFee ?? 0,
      total: o.total,
      amountPaid: o.amountPaid ?? 0,
      orderedAt: o.orderedAt,
      confirmedAt: o.confirmedAt ?? null,
      shippedAt: o.shippedAt ?? null,
      deliveredAt: o.deliveredAt ?? null,
      cancelledAt: o.cancelledAt ?? null,
      cancelReason: (o.cancelReason ?? null) as never,
      channelId: o.channelId ?? null,
      agentId: o.agentId ?? null,
      wilayaId: o.wilayaId ?? null,
      conversationId: o.conversationId ?? null,
      paymentMethod: (o.paymentMethod ?? 'cash') as never,
    },
  });
  if (o.productId) {
    const q = o.quantity ?? 1;
    await db.orderItem.create({ data: { orderId: row.id, productId: o.productId, productName: o.productName ?? 'Produit', unitPrice: Math.round((o.total - (o.deliveryFee ?? 0)) / q), costPrice: o.costPrice ?? null, quantity: q, total: o.total - (o.deliveryFee ?? 0) } });
  }
  if (o.status === 'returned') await db.orderStatusHistory.create({ data: { orderId: row.id, field: 'status', from: 'delivered', to: 'returned', actorType: 'system', at: o.deliveredAt ?? o.orderedAt } });
  return row;
};

export const conversation = (workspaceId: string, channelId: string, createdAt: Date, over: Record<string, unknown> = {}) =>
  db.conversation.create({ data: { workspaceId, channelId, externalSenderId: `s-${uniq()}`, createdAt, lastMessageAt: createdAt, ...over } });

export const message = (workspaceId: string, conversationId: string, sentAt: Date, over: { direction?: 'in' | 'out'; author?: 'customer' | 'ai' | 'human' | 'system'; customerReaction?: 'like' | 'dislike'; authorUserId?: string } = {}) =>
  db.message.create({ data: { workspaceId, conversationId, direction: over.direction ?? 'in', author: over.author ?? 'customer', text: 'msg', sentAt, customerReaction: over.customerReaction ?? null, authorUserId: over.authorUserId ?? null } });

export const aiRun = async (workspaceId: string, startedAt: Date, over: { conversationId?: string; agentId?: string; status?: string; kind?: string; inputTokens?: number; outputTokens?: number; latencyMs?: number; language?: string; intent?: string; flags?: string[] } = {}) => {
  const m = await aiModel();
  return db.aiRun.create({
    data: {
      workspaceId,
      kind: (over.kind ?? 'reply') as never,
      modelId: m.id,
      providerId: m.providerId,
      status: (over.status ?? 'ok') as never,
      conversationId: over.conversationId ?? null,
      agentId: over.agentId ?? null,
      inputTokens: over.inputTokens ?? 0,
      outputTokens: over.outputTokens ?? 0,
      latencyMs: over.latencyMs ?? null,
      intent: (over.intent ?? null) as never,
      flags: over.flags ?? [],
      batchKey: `b-${uniq()}`,
      startedAt,
      meta: over.language ? { language: over.language } : undefined,
    },
  });
};

export const creditDebit = (workspaceId: string, createdAt: Date, credits: number, action: 'text_reply' | 'image_recognition' | 'voice_transcription' = 'text_reply', over: { agentId?: string; channelId?: string } = {}) =>
  db.creditLedger.create({ data: { workspaceId, bucket: 'plan', action, kind: 'debit', credits: -credits, balanceAfter: 0, idempotencyKey: `m8-${uniq()}`, createdAt, agentId: over.agentId ?? null, channelId: over.channelId ?? null } });

export const shipment = (workspaceId: string, orderId: string, o: { status: string; createdAt: Date; lastEventAt?: Date; provider?: string; courierAccountId?: string; codAmount?: number; courierCost?: number; deliveryAttempts?: number }) =>
  db.shipment.create({
    data: {
      workspaceId,
      orderId,
      provider: (o.provider ?? 'manual') as never,
      courierAccountId: o.courierAccountId ?? null,
      status: o.status as never,
      publicTrackingToken: `t-${uniq()}`,
      codAmount: o.codAmount ?? 0,
      courierCost: o.courierCost ?? null,
      deliveryAttempts: o.deliveryAttempts ?? 1,
      createdAt: o.createdAt,
      lastEventAt: o.lastEventAt ?? null,
    },
  });

export { db };
