// The order-writing side of the AI tools sits behind this port. M4 ships the tool schemas, the argument validation,
// the limits and the dry run; M5 (orders module: `OrderService.createFromAi`, `OrderEffects.cancel`) binds the real
// implementation to `ORDER_TOOLS` — nothing else of the pipeline changes.
import { Injectable } from '@nestjs/common';

export const ORDER_TOOLS = Symbol('ORDER_TOOLS');
/** M9: the `create_payment_link` tool, bound to the billing module's OrderPaymentService. */
export const PAYMENT_LINK_TOOL = Symbol('PAYMENT_LINK_TOOL');
export interface PaymentLinkTool {
  enabledFor(workspaceId: string): Promise<boolean>;
  forAi(ctx: { workspaceId: string; clientId: string | null; dryRun: boolean }, orderRef: string): Promise<Record<string, unknown>>;
}

export type OrderToolContext = { workspaceId: string; agentId: string; conversationId: string | null; clientId: string | null; channelId: string | null; runId: string; callId: string };
/** Arguments of `create_order` after validation (phone normalised, products and variants checked, limits respected). */
export type CreateOrderRequest = {
  clientName: string;
  clientPhone: string;
  secondPhone: string | null;
  wilayaId: number;
  communeName: string | null;
  address: string | null;
  isStopdesk: boolean;
  stopdeskId: string | null;
  notes: string | null;
  items: { productId: string; variantId: string | null; quantity: number; name: string; variant: string | null; unitPrice: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** 04 §21: the customer confirmed the phone number again (required after a "faux numéro" on that phone) */
  phoneConfirmed?: boolean;
  /** A9: the customer's order (still `new`) this one replaces — created first, then that one is cancelled */
  replaces?: { id: string; number: string } | null;
};
export type CancellableOrder = { id: string; number: string; total: number; status: string; orderedAt: string };
export type ToolResult = Record<string, unknown>;

export interface OrderTools {
  /** false ⇒ the registry answers for the tool itself (dry run / unavailable) */
  readonly available: boolean;
  /** Idempotent on `runId:callId` (api-contract §1.7). */
  createOrder(ctx: OrderToolContext, req: CreateOrderRequest): Promise<ToolResult>;
  cancelOrder(ctx: OrderToolContext, order: CancellableOrder, reason: string | null): Promise<ToolResult>;
}

/**
 * M4: the orders module does not exist yet. Both tools answer with a clear result the model cannot mistake for a
 * success, and the run hands the conversation to the team (`hint: 'handoff'`), so no customer is told an order exists.
 */
@Injectable()
export class UnavailableOrderTools implements OrderTools {
  readonly available = false;
  async createOrder(): Promise<ToolResult> {
    return { ok: false, error: { code: 'ORDERS_UNAVAILABLE', message: 'orders module not available: the order was NOT created' }, hint: 'handoff' };
  }
  async cancelOrder(): Promise<ToolResult> {
    return { ok: false, error: { code: 'ORDERS_UNAVAILABLE', message: 'orders module not available: the order was NOT cancelled' }, hint: 'handoff' };
  }
}
