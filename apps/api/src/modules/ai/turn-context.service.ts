// What a turn needs besides the conversation: the agent's knowledge (FAQ, catalogue slice), the workspace texts and the
// model the platform routes this agent to (R-H). Shared by the reply job and the playground so both build the same prompt.
import { Injectable } from '@nestjs/common';
import type { AppLocale } from '@djaber/shared';
import { DEFAULT_SYSTEM_MESSAGES, prisma, TenantContext, type Agent } from '@djaber/db';
import { CatalogueService } from './catalogue.service';
import { systemLocale, type AiLanguage } from './language';
import { isOutOfHours, promptAgentOf } from './prompt/prompt-builder';
import type { PromptContext } from './prompt/prompt.types';
import { RoutingService, type RoutedModel } from './routing.service';

export type TurnContext = { prompt: Omit<PromptContext, 'descriptionMax'>; model: RoutedModel; temperature: number; maxTokens: number };

type KnownClient = { name: string; phone: string | null; phone2: string | null; isPlaceholder: boolean; addresses: { address: string | null; communeText: string | null; wilaya: { nameFr: string }; commune: { nameFr: string } | null }[] } | null;
/**
 * A4 (tester report 2026-10-20: details asked again after the conversation resumed): the client record of the conversation
 * (its name unless it is the generic « FB/IG User ·… », its phones, its last address) completed by what the customer gave
 * in the conversation (`context.customer`, which wins: it is the newest).
 */
export const knownCustomer = (c: KnownClient, said: PromptContext['customer']): PromptContext['customer'] => {
  const a = c?.addresses[0];
  const record: NonNullable<PromptContext['customer']> = {
    ...(c && !/^(FB|IG) User ·/.test(c.name) ? { name: c.name } : {}),
    ...(c?.phone ? { phone: c.phone } : {}),
    ...(c?.phone2 ? { phone2: c.phone2 } : {}),
    ...(a ? { wilaya: a.wilaya.nameFr, ...(a.commune?.nameFr || a.communeText ? { commune: a.commune?.nameFr ?? a.communeText ?? undefined } : {}), ...(a.address ? { address: a.address } : {}) } : {}),
  };
  const out = { ...record, ...Object.fromEntries(Object.entries(said ?? {}).filter(([, v]) => typeof v === 'string' && v.trim())) };
  return Object.keys(out).length ? out : null;
};

@Injectable()
export class TurnContextService {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly routing: RoutingService,
  ) {}

  /**
   * The agent's model when it is still usable, else the text route's current model — written back to `Agent.modelId`
   * (04-ai-pipeline §6; the merchant only sees a read-only badge).
   */
  async modelOf(agent: Pick<Agent, 'id' | 'modelId'>): Promise<RoutedModel> {
    const route = await this.routing.route('text');
    const usable = [route.primary, ...(route.fallback ? [route.fallback] : [])];
    const own = usable.find((m) => m.id === agent.modelId && m.supportsTools);
    if (own && !(await this.routing.isOpen(own.id))) return own;
    const next = route.failoverActive && route.fallback ? route.fallback : route.primary;
    if (next.id !== agent.modelId) await prisma.agent.updateMany({ where: { id: agent.id }, data: { modelId: next.id } });
    return next;
  }

  async load(agent: Agent, o: { text: string; lastProductIds?: string[]; lang: AiLanguage; unclearStreak?: number; now?: Date; clientId?: string | null; customer?: PromptContext['customer'] }): Promise<TurnContext> {
    const now = o.now ?? new Date();
    const [ws, faqs, catalogue, model, client] = await Promise.all([
      prisma.workspace.findUniqueOrThrow({ where: { id: TenantContext.workspaceId() }, select: { name: true, locale: true, freeDeliveryThreshold: true, systemMessages: true, senderWilaya: { select: { nameFr: true } } } }),
      prisma.agentFaq.findMany({ where: { agentId: agent.id, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { question: true, answer: true } }),
      this.catalogue.slice(agent, { text: o.text, lastProductIds: o.lastProductIds ?? [] }),
      this.modelOf(agent),
      o.clientId ? prisma.client.findFirst({ where: { id: o.clientId, deletedAt: null }, select: { name: true, phone: true, phone2: true, isPlaceholder: true, addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }], take: 1, select: { address: true, communeText: true, wilaya: { select: { nameFr: true } }, commune: { select: { nameFr: true } } } } } }) : null,
    ]);
    const a = promptAgentOf(agent);
    // a text the workspace never customised falls back to the platform default (D43), like the texts sent by the messaging module
    const stored = (ws.systemMessages ?? {}) as Record<string, Record<string, string>>;
    const systemMessages = Object.fromEntries(Object.entries(DEFAULT_SYSTEM_MESSAGES).map(([k, d]) => [k, { ...d, ...(stored[k] ?? {}) }])) as Record<string, Record<string, string>>;
    return {
      prompt: {
        agent: a,
        workspace: { name: ws.name, freeDeliveryThreshold: ws.freeDeliveryThreshold, senderWilaya: ws.senderWilaya?.nameFr ?? null, systemMessages },
        faqs: faqs.filter((f) => f.answer.trim()),
        catalogue,
        lang: o.lang,
        locale: systemLocale(o.lang, ws.locale as AppLocale),
        now,
        outOfHours: isOutOfHours(a.businessHours, now),
        unclearStreak: o.unclearStreak ?? 0,
        customer: knownCustomer(client, o.customer),
      },
      model,
      temperature: Number(agent.temperature),
      maxTokens: agent.maxTokens,
    };
  }
}
