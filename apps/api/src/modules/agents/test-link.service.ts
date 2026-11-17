// 06 §8.7 / §12 — shared playground link: `POST /agents/:id/test-links { expiresInHours }` gives a URL anyone can open
// for 24 h (`/agent-test/<token>`). Only the SHA-256 of the token is stored. The public page talks to the agent through
// the same dry-run turn as the playground (no order, nothing sent, no credit). Full-test 15/11 AI-CHAT-09 / -10, AGENTS-16:
// the turns count in the workspace's 60 / h (no extra budget per link), each visitor page has its own session, the header
// shows the moderated name only (none while in review, like the AI itself) and the system texts of a turn are returned.
import { Injectable } from '@nestjs/common';
import type { AgentTestLinkDto, PlaygroundTurnInput, SharedTestInfoDto, SharedTestReplyDto } from '@djaber/shared';
import { prisma, TenantContext } from '@djaber/db';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { PlaygroundService } from '../ai/playground.service';

type SharedTestMessage = { text: string; history?: { role: 'user' | 'assistant'; text: string }[]; sessionId?: string; turnKey?: string };

@Injectable()
export class TestLinkService {
  constructor(
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly tenants: TenantResolver,
    private readonly playground: PlaygroundService,
  ) {}

  async create(agentId: string, expiresInHours: number): Promise<AgentTestLinkDto> {
    const t = TenantContext.get();
    const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true } });
    if (!agent || !t.userId) throw notFound();
    const token = this.crypto.randomToken(24);
    const expiresAt = new Date(Date.now() + expiresInHours * 3600_000);
    await prisma.agentTestLink.create({ data: { workspaceId: t.workspaceId, agentId, tokenHash: this.crypto.sha256(token), createdById: t.userId, expiresAt } });
    return { url: `${this.config.get('PUBLIC_WEB_URL')}/agent-test/${token}`, expiresAt: expiresAt.toISOString() };
  }

  /** Public side: resolves the link (system scope), then runs `fn` inside the link's workspace. */
  private async withLink<T>(token: string, fn: (link: { id: string; agentId: string; expiresAt: Date }) => Promise<T>): Promise<T> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw notFound();
    const link = await TenantContext.runSystem(() => prisma.agentTestLink.findUnique({ where: { tokenHash: this.crypto.sha256(token) } }));
    if (!link) throw notFound();
    if (link.expiresAt <= new Date()) throw new AppException('AGENT_TEST_LINK_EXPIRED');
    const tenant = await this.tenants.forWorker(link.workspaceId).catch(() => null);
    if (!tenant || tenant.suspended) throw notFound();
    return TenantContext.run(tenant, () => fn(link));
  }

  info(token: string): Promise<SharedTestInfoDto> {
    return this.withLink(token, async (link) => {
      const agent = await prisma.agent.findFirst({ where: { id: link.agentId, deletedAt: null }, select: { approvedName: true, approvedDisplayName: true, avatar: { select: { url: true } } } });
      if (!agent) throw notFound();
      // the name a moderator approved (empty while it is in review: the page then says « Assistant de <shop> »)
      return { agentName: agent.approvedDisplayName?.trim() || agent.approvedName?.trim() || '', avatarUrl: agent.avatar?.url ?? null, expiresAt: link.expiresAt.toISOString() };
    });
  }

  async message(token: string, input: SharedTestMessage): Promise<SharedTestReplyDto> {
    return (await this.messageTurn(token, input)).reply;
  }

  /** `message`, with the server's timing (`Server-Timing`, journey retest R10-1). */
  messageTurn(token: string, input: SharedTestMessage): Promise<{ reply: SharedTestReplyDto; replayed: boolean; timing: { waitMs: number; totalMs: number } }> {
    return this.withLink(token, async (link) => {
      const messages: PlaygroundTurnInput['messages'] = [...(input.history ?? []), { role: 'user' as const, text: input.text }];
      // one session per visitor page (the reply guard and the simulated orders read the session's earlier turns)
      const sessionId = `link:${link.id.slice(0, 8)}:${input.sessionId ?? 'shared'}`.slice(0, 80);
      // journey retest R10-1: the page sends a turn again with the same key when its answer did not arrive — the same turn
      const r = await this.playground.requestTurn(link.agentId, { sessionId, messages, ...(input.turnKey ? { turnKey: input.turnKey } : {}) }, { userId: null });
      if (!r.replayed) await prisma.agentTestLink.update({ where: { id: link.id }, data: { usedCount: { increment: 1 } } });
      // the visitor sees what a customer would see: the text, the cards and the shop's system texts — nothing about the model or the tools
      return { reply: { reply: r.turn.reply, cards: r.turn.cards, systemMessages: r.turn.systemMessages }, replayed: r.replayed, timing: r.timing };
    });
  }
}
