// 04 §3 "Sale created / payment changed / deleted" — the ONE writer of a counter sale's side effects (CLAUDE.md rule 5,
// 01-nest-module-map §4.4): stock (`out` reason `sale`, conditional ⇒ 422 SALE_INSUFFICIENT_STOCK; given back as `return`
// reason `sale_cancelled`), automatic cash rows (PaymentEntry → locked income `sale`, refund row), client aggregates
// (recomputed). Always inside the caller's transaction.
import { storedText } from '@djaber/shared';
import { Injectable } from '@nestjs/common';
import type { PaymentMethod, Sale, Tx } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import { OutboxService } from '../../core/outbox/outbox.service';
import { StockService } from '../catalog/stock.service';
import { ClientAggregatesService } from '../clients/client-aggregates.service';
import { stockDeltas, stockKey, type StockLine } from '../orders/order-rules';
import { clearPayments, recomputePaid, writePayment, writeRefund } from './cash-rows';

@Injectable()
export class SaleEffects {
  constructor(
    private readonly stock: StockService,
    private readonly aggregates: ClientAggregatesService,
    private readonly outbox: OutboxService,
  ) {}

  /** Net quantity this sale took per product / variant (Σ of its movements, ≤ 0). */
  private async net(tx: Tx, saleId: string) {
    const rows = await tx.stockMovement.groupBy({ by: ['productId', 'variantId'], where: { refType: 'sale', refId: saleId }, _sum: { quantity: true } });
    return new Map(rows.map((r) => [stockKey(r.productId, r.variantId), r._sum.quantity ?? 0]));
  }

  /**
   * Brings the sale's stock to `lines` (validation) or to nothing (`[]`: cancel with restock, delete).
   * `lineIndex` maps a product / variant to its line for the inline error (`fields.items.N.quantity`).
   */
  async syncStock(tx: Tx, sale: Pick<Sale, 'id' | 'number'>, lines: (StockLine & { name?: string })[]) {
    const deltas = stockDeltas(lines, await this.net(tx, sale.id));
    deltas.sort((a, b) => a.productId.localeCompare(b.productId) || (a.variantId ?? '').localeCompare(b.variantId ?? ''));
    for (const d of deltas) {
      const n = lines.findIndex((l) => l.productId === d.productId && (l.variantId ?? null) === (d.variantId ?? null));
      await this.stock.move(tx, {
        productId: d.productId,
        variantId: d.variantId,
        change: { delta: d.delta },
        type: d.delta < 0 ? 'out' : 'return',
        reason: d.delta < 0 ? 'sale' : 'sale_cancelled',
        note: sale.number,
        refType: 'sale',
        refId: sale.id,
        insufficient: (available, p) => new AppException('SALE_INSUFFICIENT_STOCK', { product: p.name, available }, n >= 0 ? { [`items.${n}.quantity`]: 'validation.quantity' } : {}, { productId: d.productId, variantId: d.variantId, available }),
      });
    }
  }

  async addPayment(tx: Tx, sale: Pick<Sale, 'id' | 'number'>, p: { amount: number; method: PaymentMethod; reference?: string | null; note?: string | null; paidAt?: Date; description: string }) {
    return writePayment(tx, this.outbox, { sourceType: 'sale', sourceId: sale.id, number: sale.number, ...p });
  }

  /** Removes the sale's payment entries and their automatic income rows (delete, cancel without refund). */
  clearPayments(tx: Tx, saleId: string) {
    return clearPayments(tx, this.outbox, 'sale', saleId);
  }

  /** Cancel with refund: the money taken goes back out through one locked `refund` expense row. */
  refund(tx: Tx, sale: Pick<Sale, 'id' | 'number' | 'amountPaid' | 'paymentMethod'>, reason: string) {
    return writeRefund(tx, this.outbox, { sourceId: sale.id, number: sale.number, amount: sale.amountPaid, method: sale.paymentMethod, description: storedText('stored.cash.saleRefund', { number: sale.number, reason }) });
  }

  recomputePaid(tx: Tx, sale: Pick<Sale, 'id' | 'total'>) {
    return recomputePaid(tx, 'sale', sale.id, sale.total);
  }

  /** CLI-04: `orderCount`, `totalSpent`, `lastOrderAt` recomputed from orders + completed sales. */
  async recomputeClient(tx: Tx, clientId: string | null | undefined) {
    if (clientId) await this.aggregates.recompute(tx, clientId);
  }
}
