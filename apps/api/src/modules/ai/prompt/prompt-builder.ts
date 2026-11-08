// 04-ai-pipeline §3 — prompt assembly. 14 sections in a fixed order (each one a pure function of `prompt/sections`,
// snapshot-tested), then the conversation: the last 30 messages and the current batch as the final `user` message.
// Token budget: `contextTokens − maxTokens − 512`; when exceeded the oldest history goes first, then the FAQ is
// truncated, then the catalogue descriptions are cut to 100 characters.
import type { AgentBusinessHours, AgentCapabilities, AgentHandoffRule, AgentOrderField, AgentPolicies } from '@djaber/shared';
import type { Agent } from '@djaber/db';
import { algiersClock } from '../../../core/time/algiers';
import { DEFAULT_CONTEXT_TOKENS, DESCRIPTION_MAX, DESCRIPTION_TRUNCATED, FAQ_MAX_CHARS, HISTORY_MESSAGES, PROMPT_RESERVE_TOKENS } from '../ai.constants';
import type { AiMessage } from '../provider/ai.gateway';
import type { PromptAgent, PromptContext, PromptSection } from './prompt.types';
import { cardTemplateSection, closingSection, crossSellSection, handoffSection, imageRuleSection } from './sections/behaviour';
import { catalogueSection } from './sections/catalogue';
import { languageSection, outputContractSection } from './sections/contract';
import { identitySection } from './sections/identity';
import { customInstructionsSection, faqSection, policiesSection } from './sections/knowledge';
import { deliverySection, orderRulesSection } from './sections/orders';

export type HistoryMessage = { author: 'customer' | 'ai' | 'human'; text: string; humanName?: string | null };
export type BuiltPrompt = { system: string; messages: AiMessage[]; sections: PromptSection[]; estimatedTokens: number; dropped: { history: number; faqChars: number; descriptions: boolean } };

/** The 14 sections of §3, in order. */
export const SECTION_ORDER = ['identity', 'policies', 'custom_instructions', 'faq', 'catalogue', 'delivery', 'order_rules', 'image_rule', 'cross_sell', 'card_template', 'closing', 'handoff', 'language', 'output_contract'] as const;
export type SectionKey = (typeof SECTION_ORDER)[number];

const obj = <T>(v: unknown, fallback: T): T => (v && typeof v === 'object' ? (v as T) : fallback);

/** `Agent` row → what the sections read (JSON columns typed, defaults applied). */
export const promptAgentOf = (a: Agent): PromptAgent => ({
  name: a.name,
  displayName: a.displayName,
  personality: a.personality,
  customInstructions: a.customInstructions,
  productCardTemplate: a.productCardTemplate,
  closingInstructions: a.closingInstructions,
  humanHandoffRules: a.humanHandoffRules,
  imageRecognition: a.imageRecognition,
  policies: obj<AgentPolicies>(a.policies, {}),
  capabilities: obj<Partial<AgentCapabilities>>(a.capabilities, {}),
  orderFields: Array.isArray(a.orderFields) ? (a.orderFields as unknown as AgentOrderField[]) : [],
  maxQtyPerOrder: a.maxQtyPerOrder,
  maxAmountPerOrder: a.maxAmountPerOrder,
  riskyClientBehavior: a.riskyClientBehavior,
  recapMode: a.recapMode,
  handoffRules: Array.isArray(a.handoffRules) ? (a.handoffRules as unknown as AgentHandoffRule[]) : [],
  handoffKeywords: a.handoffKeywords,
  businessHours: a.businessHours && typeof a.businessHours === 'object' ? (a.businessHours as unknown as AgentBusinessHours) : null,
  outOfStockBehavior: a.outOfStockBehavior,
  showMissingVariants: a.showMissingVariants,
});

/** §3.2: true when business hours are set and `now` (Africa/Algiers) is outside them. A `to` before `from` spans midnight. */
export const isOutOfHours = (hours: AgentBusinessHours | null, now: Date): boolean => {
  if (!hours || !Array.isArray(hours.days) || !hours.from || !hours.to) return false;
  const { weekday, hour, minute } = algiersClock(now);
  const at = hour * 60 + minute;
  const min = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const from = min(hours.from);
  const to = min(hours.to);
  if (from === to) return !hours.days.includes(weekday);
  if (from < to) return !(hours.days.includes(weekday) && at >= from && at < to);
  // overnight: the evening part belongs to today, the morning part to yesterday's opening
  const yesterday = (weekday + 6) % 7;
  return !((hours.days.includes(weekday) && at >= from) || (hours.days.includes(yesterday) && at < to));
};

/** ~3 characters per token (Arabic script and digits tokenise worse than English prose). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

const sectionsOf = (c: PromptContext, faqChars: number): PromptSection[] =>
  (
    [
      ['identity', identitySection(c)],
      ['policies', policiesSection(c)],
      ['custom_instructions', customInstructionsSection(c)],
      ['faq', faqSection(c, faqChars)],
      ['catalogue', catalogueSection(c)],
      ['delivery', deliverySection(c)],
      ['order_rules', orderRulesSection(c)],
      ['image_rule', imageRuleSection(c)],
      ['cross_sell', crossSellSection(c)],
      ['card_template', cardTemplateSection(c)],
      ['closing', closingSection(c)],
      ['handoff', handoffSection(c)],
      ['language', languageSection(c)],
      ['output_contract', outputContractSection(c)],
    ] as [SectionKey, string][]
  )
    .filter(([, text]) => text)
    .map(([key, text]) => ({ key, text }));

const toMessages = (history: HistoryMessage[], batch: string): AiMessage[] => {
  const out: AiMessage[] = [];
  const push = (role: 'user' | 'assistant', text: string) => {
    const last = out[out.length - 1];
    // providers expect alternating roles: neighbours of the same role are merged
    if (last && last.role === role && typeof last.content === 'string') last.content = `${last.content}\n${text}`;
    else out.push({ role, content: text });
  };
  for (const m of history) {
    if (!m.text.trim()) continue;
    if (m.author === 'customer') push('user', m.text);
    else push('assistant', m.author === 'human' ? `[human: ${m.humanName?.trim() || 'team'}] ${m.text}` : m.text);
  }
  push('user', batch);
  return out;
};

export class PromptBuilder {
  /**
   * `history` = earlier messages of the conversation (oldest first, the batch excluded); `batch` = the customer messages
   * being answered, joined by newlines (voice notes as transcripts, images as `[image]` + their vision note).
   */
  static build(ctx: Omit<PromptContext, 'descriptionMax'>, history: HistoryMessage[], batch: string, model: { contextTokens: number | null; maxTokens: number }): BuiltPrompt {
    const budget = Math.max(2000, (model.contextTokens ?? DEFAULT_CONTEXT_TOKENS) - model.maxTokens - PROMPT_RESERVE_TOKENS);
    let kept = history.slice(-HISTORY_MESSAGES);
    let faqChars = FAQ_MAX_CHARS;
    let descriptionMax = DESCRIPTION_MAX;
    const assemble = () => {
      const sections = sectionsOf({ ...ctx, firstReply: ctx.firstReply ?? !history.some((m) => m.author === 'ai' || m.author === 'human'), descriptionMax }, faqChars);
      const system = sections.map((s) => s.text).join('\n\n');
      const messages = toMessages(kept, batch);
      const tokens = estimateTokens(system) + messages.reduce((n, m) => n + estimateTokens(typeof (m as { content?: unknown }).content === 'string' ? (m as { content: string }).content : ''), 0);
      return { sections, system, messages, tokens };
    };
    let out = assemble();
    while (out.tokens > budget && kept.length) {
      kept = kept.slice(Math.max(1, Math.ceil(kept.length / 4)));
      out = assemble();
    }
    while (out.tokens > budget && faqChars > 0) {
      faqChars = faqChars > 1000 ? Math.floor(faqChars / 2) : 0;
      out = assemble();
    }
    if (out.tokens > budget) {
      descriptionMax = DESCRIPTION_TRUNCATED;
      out = assemble();
    }
    return { system: out.system, messages: out.messages, sections: out.sections, estimatedTokens: out.tokens, dropped: { history: Math.min(history.length, HISTORY_MESSAGES) - kept.length, faqChars: FAQ_MAX_CHARS - faqChars, descriptions: descriptionMax !== DESCRIPTION_MAX } };
  }
}
