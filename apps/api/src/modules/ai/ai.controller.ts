// 06 §8.7 — AI reads that are not tied to one agent:
//   GET /ai/routes               capability → model label (the read-only model badge of the agent form, R-H)
//   GET /messages/:id/ai-run     detail of the AI turn behind a message [FIG REF "Clic sur IA → détail du tour"]
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { AiRunDto } from '@djaber/shared';
import { prisma, TenantContext } from '@djaber/db';
import { RequirePermission } from '../../core/auth/decorators';
import { ConfigService } from '../../core/config/config.service';
import { notFound } from '../../core/errors/app.exception';
import { CreditService } from '../credits/credit.service';
import { AI_GATEWAY, type AiGateway } from './provider/ai.gateway';
import { RoutingService } from './routing.service';

@Controller()
export class AiController {
  constructor(private readonly routing: RoutingService) {}

  @Get('ai/routes')
  @RequirePermission('agents.read')
  routes() {
    return this.routing.badges();
  }

  @Get('messages/:id/ai-run')
  @RequirePermission('inbox.read')
  async runOfMessage(@Param('id', ParseUUIDPipe) id: string): Promise<AiRunDto> {
    const message = await prisma.message.findFirst({ where: { id }, select: { aiRunId: true } });
    if (!message?.aiRunId) throw notFound();
    const run = await prisma.aiRun.findFirst({ where: { id: message.aiRunId }, include: { model: { include: { provider: true } }, toolCalls: { orderBy: [{ executedAt: 'asc' }, { id: 'asc' }] } } });
    if (!run) throw notFound();
    return {
      id: run.id,
      kind: run.kind,
      status: run.status,
      intent: run.intent,
      model: run.model.displayName,
      provider: run.model.provider.displayName,
      usedFallback: run.usedFallback,
      tokens: { input: run.inputTokens, output: run.outputTokens },
      latencyMs: run.latencyMs,
      confidence: run.confidence === null ? null : Number(run.confidence),
      credits: run.creditsCharged,
      toolCalls: run.toolCalls.map((c) => ({ name: c.name, args: c.args, result: c.result })),
      error: run.error,
      startedAt: run.startedAt.toISOString(),
    };
  }
}

/**
 * Manual testing of the AI states without touching the database by hand. Exists only outside production AND with the
 * fake AI adapter (anywhere else the routes answer 404):
 *   POST /dev/ai/credits { balance }   sets the workspace credit balance (0 ⇒ the next customer message meets F-4)
 *   GET  /dev/ai/help                  what the fake "model" answers to which words
 */
@Controller('dev/ai')
export class DevAiController {
  constructor(
    private readonly config: ConfigService,
    private readonly credits: CreditService,
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
  ) {}

  private assertDev() {
    if (this.config.isProd || this.gateway.driver !== 'fake') throw notFound();
  }

  @Post('credits')
  @HttpCode(200)
  @RequirePermission('workspace.settings')
  async setCredits(@Body() body: { balance?: number }) {
    this.assertDev();
    const balance = Number.isInteger(body?.balance) && body.balance! >= 0 && body.balance! <= 1_000_000 ? body.balance! : 0;
    const workspaceId = TenantContext.workspaceId();
    const now = await this.credits.balance(workspaceId);
    if (!now.unlimited && now.total !== balance) await this.credits.grant(workspaceId, balance - now.total, { key: `dev:${workspaceId}:${Date.now()}`, reason: 'dev', grantedById: TenantContext.get().userId ?? null });
    return this.credits.summary();
  }

  @Get('help')
  @RequirePermission('agents.read')
  help() {
    this.assertDev();
    return {
      driver: this.gateway.driver,
      note: 'Deterministic keyword rules, not a model: the same message always gives the same answer, in the language and script of the message.',
      triggers: [
        { say: 'bonjour · salam · hello · سلام', does: 'greeting (status OK, intent GREETING)' },
        { say: 'prix / combien / chhal / بشحال / kayen / how much + words of a product name', does: 'tool search_products → reply with the 3 best products and their cards; nothing found ⇒ status UNKNOWN (thread goes to the queue)' },
        { say: 'livraison / tawsil / توصيل / delivery + a wilaya (Alger, wahran, Sétif…)', does: 'tool quote_delivery on the fee grid; no rule for the wilaya ⇒ "not served"' },
        { say: 'où est / suivi / win rahi / وين الطلبية', does: 'tool lookup_order (the orders of this customer)' },
        { say: 'annuler / cancel / نلغي', does: 'tool cancel_order (candidates first; no open order ⇒ HANDOFF)' },
        { say: 'je confirme / نعم / n3am, after a phone number was given', does: 'tool create_order with the first catalogue product ⇒ M4: "orders module not available" + HANDOFF' },
        { say: 'remboursement / refund / استرجاع · arnaque / voleur · humain / conseiller / insan', does: 'status HANDOFF (refund · angry · customer_request): reply, workspace handoff text, needs_human, insight, notification' },
        { say: 'a handoff keyword of the agent', does: 'status HANDOFF (keyword)' },
        { say: '?? or fewer than 3 letters', does: 'status UNCLEAR (insight; 3 in a row ⇒ HANDOFF)' },
        { say: 'a photo (simulator: image=true)', does: '2-pass vision: the fake recognises a photo whose bytes equal a product image, otherwise asks for confirmation' },
        { say: 'a voice note (simulator: audio=true)', does: 'transcribed as "Bonjour" ⇒ greeting (3 credits)' },
      ],
      credits: 'POST /dev/ai/credits { "balance": 0 } then send a customer message: fixed "unavailable" text once, thread needs_human with creditsExhausted, Owner notification, WS credits.updated on the next debit.',
    };
  }
}
