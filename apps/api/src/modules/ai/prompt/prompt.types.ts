// Input of the prompt sections (04-ai-pipeline §3). Plain data: the sections are pure functions.
import type { AgentBusinessHours, AgentCapabilities, AgentHandoffRule, AgentOrderField, AgentPolicies, AppLocale } from '@djaber/shared';
import type { Personality } from '@djaber/db';
import type { CatalogueSlice } from '../catalogue.service';
import type { AiLanguage } from '../language';

export type PromptAgent = {
  name: string;
  displayName: string | null;
  personality: Personality;
  customInstructions: string;
  productCardTemplate: string | null;
  closingInstructions: string | null;
  humanHandoffRules: string | null;
  imageRecognition: boolean;
  policies: AgentPolicies;
  capabilities: Partial<AgentCapabilities>;
  orderFields: AgentOrderField[];
  maxQtyPerOrder: number | null;
  maxAmountPerOrder: number | null;
  riskyClientBehavior: 'take_and_flag' | 'handoff' | null;
  recapMode: 'always' | 'when_unsure' | null;
  handoffRules: AgentHandoffRule[];
  handoffKeywords: string[];
  businessHours: AgentBusinessHours | null;
  outOfStockBehavior: 'say_unavailable' | 'suggest_alternative';
  showMissingVariants: boolean;
};
export type PromptFaq = { question: string; answer: string };
export type PromptContext = {
  agent: PromptAgent;
  workspace: { name: string; freeDeliveryThreshold: number | null; senderWilaya: string | null; systemMessages: Record<string, Record<string, string>> };
  faqs: PromptFaq[];
  catalogue: CatalogueSlice;
  lang: AiLanguage;
  locale: AppLocale;
  now: Date;
  outOfHours: boolean;
  unclearStreak: number;
  /** catalogue descriptions cut to this many characters (token budget step 3) */
  descriptionMax: number;
  /** A4: what is already known of the customer (client record + details given in the conversation) */
  customer?: { name?: string; phone?: string; phone2?: string; wilaya?: string; commune?: string; address?: string } | null;
};
export type PromptSection = { key: string; text: string };
