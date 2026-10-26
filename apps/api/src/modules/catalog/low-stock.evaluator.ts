// CAT-09 / GDS-04 — low stock = `quantity ≤ minStock`, per product and per variant (`ProductVariant.minStock`).
// A crossing produces one notification per day per product at most (03-events §5.1: the day is part of the outbox key,
// `Outbox @@unique([topic, key])` does the throttling) and one `stock.low` / `stock.out` webhook event.
import { Injectable } from '@nestjs/common';
import { TenantContext, type Tx } from '@djaber/db';
import { OutboxService } from '../../core/outbox/outbox.service';
import { algiersDay } from '../../core/time/algiers';
import { NotificationProducer } from '../notifications/notification.producer';

export type StockCrossing = 'low' | 'out' | null;

/** Pure rule: which alert, if any, a change of quantity raises (alerts fire on the way down only). */
export const crossing = (before: number, after: number, minStock: number): StockCrossing => {
  if (after >= before) return null;
  if (after <= 0) return before > 0 ? 'out' : null;
  return after <= minStock && before > minStock ? 'low' : null;
};

export type StockChange = {
  product: { id: string; name: string; sku: string; minStock: number };
  variant?: { id: string; name: string; sku: string | null; minStock: number } | null;
  before: number;
  after: number;
};

@Injectable()
export class LowStockEvaluator {
  constructor(
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationProducer,
  ) {}

  /** Called by every stock writer (adjustments now; `OrderEffects` / `SaleEffects` from M5 / M7). */
  async evaluate(tx: Tx, c: StockChange, now = new Date()): Promise<StockCrossing> {
    const minStock = c.variant ? c.variant.minStock : c.product.minStock;
    const kind = crossing(c.before, c.after, minStock);
    if (!kind) return null;
    const workspaceId = TenantContext.workspaceId();
    const day = algiersDay(now);
    const data = {
      productId: c.product.id,
      ...(c.variant ? { variantId: c.variant.id, variantName: c.variant.name } : {}),
      name: c.product.name,
      sku: c.variant?.sku ?? c.product.sku,
      stock: c.after,
      minStock,
      // placeholders of `notification.stock.low|out` (title: {product} ({stock} restants) · body: Seuil : {min})
      product: c.variant ? `${c.product.name} · ${c.variant.name}` : c.product.name,
      min: minStock,
    };
    // one alert per day per product AND variant (tester notes 25/10: a second variant going low the same day said nothing)
    const item = c.variant ? `${c.product.id}:${c.variant.id}` : c.product.id;
    await this.notifications.emit(tx, { type: kind === 'out' ? 'stock_out' : 'stock_low', workspaceId, key: `stock_${kind}:${item}:${day}`, data });
    await this.outbox.enqueue(tx, {
      topic: 'webhook',
      key: `stock.${kind}:${item}:${day}`,
      workspaceId,
      payload: { event: `stock.${kind}`, workspaceId, data },
    });
    return kind;
  }
}
