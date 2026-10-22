// §3.2 Shop policies · §3.3 Custom instructions · §3.4 FAQ.
import { AGENT_FAQ_MAX_ENTRIES, AGENT_INSTRUCTIONS_MAX, AGENT_POLICY_MAX } from '@djaber/shared';
import { FAQ_MAX_CHARS } from '../../ai.constants';
import type { PromptContext } from '../prompt.types';

const LABELS = [
  ['delivery', 'DELIVERY'],
  ['payment', 'PAYMENT'],
  ['returns', 'RETURNS'],
  ['hours', 'HOURS'],
] as const;

export const policiesSection = (c: PromptContext): string => {
  const lines = LABELS.map(([k, label]) => [label, (c.agent.policies[k] ?? '').trim().slice(0, AGENT_POLICY_MAX)] as const)
    .filter(([, v]) => v)
    .map(([label, v]) => `${label}: ${v}`);
  if (c.outOfHours) lines.push('OUT_OF_HOURS: true — keep answering and taking orders');
  return lines.length ? `SHOP POLICIES\n${lines.join('\n')}` : '';
};

export const customInstructionsSection = (c: PromptContext): string => {
  const text = c.agent.customInstructions.trim().slice(0, AGENT_INSTRUCTIONS_MAX);
  // A5 (tester report 2026-10-20: owner rules such as « no emoji » were not followed): the owner's rules come first
  return text ? `OWNER INSTRUCTIONS (they override the personality and every style habit; follow them in every reply, e.g. emoji use, tone, length)\n${text}` : '';
};

/** `maxChars` shrinks when the token budget is tight (§3 "then truncate FAQ"). */
export const faqSection = (c: PromptContext, maxChars = FAQ_MAX_CHARS): string => {
  const out: string[] = [];
  let used = 0;
  for (const f of c.faqs.slice(0, AGENT_FAQ_MAX_ENTRIES)) {
    const block = `Q: ${f.question.trim()}\nA: ${f.answer.trim()}`;
    if (used + block.length > maxChars) break;
    out.push(block);
    used += block.length;
  }
  return out.length ? `FAQ\n${out.join('\n')}` : '';
};
