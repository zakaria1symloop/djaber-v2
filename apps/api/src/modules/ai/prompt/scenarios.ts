// 04-ai-pipeline §8 — the 8 playground scenarios (`TestScenarioKey`): the seeded first customer message of each, and
// what the wizard's step 5 checks on the answer. `photo` / `voice` use a generated attachment note instead of a file.
import type { TestScenarioKey } from '@djaber/db';

export type ScenarioCheck = 'replied' | 'language_respected' | 'no_invented_product' | 'handoff_on_complaint' | 'order_created_simulated' | 'limits_respected';
export type Scenario = { key: TestScenarioKey; message: string; language: 'ar' | 'arabizi' | 'fr' | 'en'; attachment?: 'image' | 'audio'; expect: { handoff?: boolean; checks: ScenarioCheck[] } };

export const SCENARIOS: Record<TestScenarioKey, Scenario> = {
  darija_price: { key: 'darija_price', message: 'سلام، بشحال هذا المنتوج؟', language: 'ar', expect: { checks: ['replied', 'language_respected', 'no_invented_product'] } },
  arabizi_delivery: { key: 'arabizi_delivery', message: 'salam, chhal tawsil l Oran ?', language: 'arabizi', expect: { checks: ['replied', 'language_respected'] } },
  photo: { key: 'photo', message: 'Vous avez ce produit ?', language: 'fr', attachment: 'image', expect: { checks: ['replied', 'no_invented_product'] } },
  voice: { key: 'voice', message: 'Bonjour, je voudrais connaître le prix', language: 'fr', attachment: 'audio', expect: { checks: ['replied', 'language_respected'] } },
  off_catalog: { key: 'off_catalog', message: 'Est-ce que vous vendez des voitures neuves ?', language: 'fr', expect: { checks: ['replied', 'no_invented_product'] } },
  anger: { key: 'anger', message: "C'est une arnaque votre boutique, je veux parler à un humain !", language: 'fr', expect: { handoff: true, checks: ['replied', 'handoff_on_complaint'] } },
  qty_limit: { key: 'qty_limit', message: 'Je veux commander 500 pièces de votre premier produit', language: 'fr', expect: { checks: ['replied', 'limits_respected'] } },
  refund: { key: 'refund', message: 'Je veux un remboursement de ma commande', language: 'fr', expect: { handoff: true, checks: ['replied', 'handoff_on_complaint'] } },
};
/** journey re-run J03r-2 (18/11): the quantity a scenario's message asks for — `limits_respected` needs the limit hand-off above the agent's max. */
export const SCENARIO_QUANTITY: Partial<Record<TestScenarioKey, number>> = { qty_limit: 500 };
