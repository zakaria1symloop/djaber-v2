// The M5 binding of the AI order port (`ORDER_TOOLS`, modules/ai/tools/order-tools.ts): `create_order` and
// `cancel_order` of 04-ai-pipeline §4.2 run through the orders service (OrderEffects inside one transaction).
import { Injectable } from '@nestjs/common';
import { prisma } from '@djaber/db';
import type { CancellableOrder, CreateOrderRequest, OrderToolContext, OrderTools, ToolResult } from '../ai/tools/order-tools';
import { OrderWorkflowService } from './order-workflow.service';
import { OrderService } from './order.service';

@Injectable()
export class OrderToolsService implements OrderTools {
  readonly available = true;
  constructor(
    private readonly orders: OrderService,
    private readonly workflow: OrderWorkflowService,
  ) {}

  /**
   * A9 (tester report 2026-10-20: the bot cancelled the order and never created the replacement): the new order is
   * created first — the replaced order's units count as free — then the replaced one is cancelled. A cancel that no
   * longer applies (the shop confirmed it meanwhile) is reported (`replaced: null`) so the model hands off.
   */
  async createOrder(ctx: OrderToolContext, req: CreateOrderRequest): Promise<ToolResult> {
    const r = await this.orders.createFromAi(ctx, req);
    if (!req.replaces || r.ok !== true || r.duplicateOf) return r;
    const old = await prisma.order.findFirst({ where: { id: req.replaces.id }, select: { id: true, number: true, total: true, status: true, orderedAt: true, clientId: true } });
    if (old?.status === 'cancelled') return { ...r, replaced: { number: old.number } };
    if (!old) return { ...r, replaced: null };
    const cancelled = await this.workflow.cancelFromAi({ ...ctx, clientId: old.clientId }, { id: old.id, number: old.number, total: old.total, status: old.status, orderedAt: old.orderedAt.toISOString() }, `remplacée par ${String(r.number)}`);
    return { ...r, replaced: cancelled.ok === true ? { number: old.number } : null, ...(cancelled.ok === true ? {} : { hint: 'handoff' }) };
  }

  cancelOrder(ctx: OrderToolContext, order: CancellableOrder, reason: string | null): Promise<ToolResult> {
    return this.workflow.cancelFromAi(ctx, order, reason);
  }
}
