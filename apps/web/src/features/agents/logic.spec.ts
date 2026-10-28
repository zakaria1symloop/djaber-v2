import { describe, expect, it } from 'vitest';
import type { Agent, AgentPreset, PlaygroundTurn } from './contracts';
import {
  blockingChecks,
  localDateTimeInput,
  canOpenStep,
  cardState,
  confidenceLabel,
  creditsPerConversation,
  defaultDraft,
  diffDraft,
  dirtySections,
  draftFromAgent,
  draftFromPreset,
  enabledRuleCount,
  handledPct,
  issueMap,
  limitReached,
  mergeBySection,
  minutesOf,
  missingKeys,
  monthlyCreditEstimate,
  nextStep,
  policyCount,
  previewReply,
  previousStep,
  resumePath,
  ruleOn,
  secondsLabel,
  sectionsPatch,
  setOrderField,
  setRule,
  stepSlug,
  stepState,
  toolCallView,
  turnView,
  validateBehaviour,
  validateIdentity,
  validateKnowledge,
  validateSchedule,
  validateStep,
  withinHours,
  wizardChecklist,
} from './logic';

const valid = () => ({ ...defaultDraft(), name: 'Vendeur Pro — Boutique Amel' });
const agent = (over: Partial<Agent> = {}): Agent =>
  ({
    id: 'a1',
    name: 'Vendeur Pro',
    description: null,
    status: 'active',
    pausedReason: null,
    isActive: true,
    personality: 'friendly',
    customInstructions: '',
    productCardTemplate: null,
    closingInstructions: null,
    humanHandoffRules: null,
    model: { id: 'm', label: 'gpt-4o-mini', provider: 'openai' },
    temperature: 0.6,
    maxTokens: 1200,
    responseDelaySec: 3,
    sellAllProducts: true,
    productCount: 142,
    imageRecognition: true,
    voiceTranscription: false,
    channels: [],
    preset: { key: 'vendeur-pro', name: 'Vendeur Pro', version: 1, updateAvailable: null },
    currentVersion: 3,
    lastActiveAt: null,
    scheduledActivateAt: null,
    wizardStep: 2,
    wizard: null,
    metrics30d: { conversations: 0, handledWithoutHuman: 0, orders: 0, confirmedPct: 0, delivered: 0, avgLatencyMs: 0, p95LatencyMs: 0, credits: 0, satisfaction: null },
    pendingInsights: 0,
    version: 7,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    actions: [],
    ...over,
  }) as Agent;

describe('wizard steps', () => {
  it('maps the saved step to the slug to resume', () => {
    expect(stepSlug(0)).toBe('identity');
    expect(stepSlug(3)).toBe('behaviour');
    expect(stepSlug(9)).toBe('activate');
    expect(resumePath({ id: 'x', wizardStep: 2 })).toBe('/agents/new/behaviour?draft=x');
    expect(resumePath({ id: 'x', wizardStep: null })).toBe('/agents/new/identity?draft=x');
    expect(resumePath({ id: 'x', wizardStep: 5 })).toBe('/agents/new/activate?draft=x');
  });
  it('marks steps done / active / upcoming and allows going back', () => {
    expect(stepState('identity', 'behaviour', 2)).toBe('done');
    expect(stepState('behaviour', 'behaviour', 2)).toBe('active');
    expect(stepState('channels', 'behaviour', 2)).toBe('upcoming');
    expect(canOpenStep('identity', 0, false)).toBe(true);
    expect(canOpenStep('knowledge', 0, false)).toBe(false);
    expect(canOpenStep('behaviour', 2, true)).toBe(true);
    expect(canOpenStep('activate', 2, true)).toBe(false);
    expect(nextStep('identity')).toBe('knowledge');
    expect(nextStep('activate')).toBeNull();
    expect(previousStep('identity')).toBeNull();
    expect(previousStep('channels')).toBe('behaviour');
  });
});

describe('step validation', () => {
  it('step 1: name required and ≤ 100, at least one language, default among them', () => {
    expect(validateIdentity(valid())).toEqual([]);
    expect(validateIdentity({ ...valid(), name: '  ' }).map((i) => i.key)).toContain('agents.validation.nameRequired');
    expect(validateIdentity({ ...valid(), name: 'x'.repeat(101) })[0]).toMatchObject({ field: 'name', key: 'agents.validation.tooLong', params: { max: 100 } });
    expect(validateIdentity({ ...valid(), languages: [] }).map((i) => i.field)).toEqual(['languages']);
    expect(validateIdentity({ ...valid(), languages: ['fr'], defaultLanguage: 'darija' })[0]?.key).toBe('agents.validation.defaultLanguage');
  });
  it('step 2: a category is needed for a category scope, rules stay short', () => {
    expect(validateKnowledge(valid())).toEqual([]);
    expect(validateKnowledge({ ...valid(), catalogScope: 'categories' })[0]?.field).toBe('scopeCategoryIds');
    expect(validateKnowledge({ ...valid(), catalogScope: 'categories', scopeCategoryIds: ['c1'] })).toEqual([]);
    expect(validateKnowledge({ ...valid(), policies: { returns: 'x'.repeat(501) } })[0]).toMatchObject({ field: 'policies.returns', params: { max: 500 } });
  });
  it('step 3: max qty ≥ 1, amount ≥ 1, keyword rule needs a keyword, hours and delay in range', () => {
    expect(validateBehaviour(valid())).toEqual([]);
    expect(validateBehaviour({ ...valid(), maxQtyPerOrder: 0 })[0]?.key).toBe('agents.validation.qtyMin');
    expect(validateBehaviour({ ...valid(), maxQtyPerOrder: null })).toEqual([]);
    expect(validateBehaviour({ ...valid(), maxAmountPerOrder: 0 })[0]?.field).toBe('maxAmountPerOrder');
    const withKeyword = { ...valid(), handoffRules: setRule(valid(), 'keyword', true) };
    expect(validateBehaviour(withKeyword)[0]?.key).toBe('agents.validation.keywordRequired');
    expect(validateBehaviour({ ...withKeyword, handoffKeywords: ['avocat'] })).toEqual([]);
    expect(validateBehaviour({ ...valid(), businessHours: { days: [], from: '09:00', to: '20:00' } })[0]?.key).toBe('agents.validation.hoursDays');
    expect(validateBehaviour({ ...valid(), responseDelaySec: 11 })[0]?.field).toBe('responseDelaySec');
    expect(validateBehaviour({ ...valid(), productCardTemplate: 'x'.repeat(5001) })[0]?.field).toBe('productCardTemplate');
  });
  it('steps 4 and 5 carry no draft field', () => {
    expect(validateStep('channels', { ...valid(), name: '' })).toEqual([]);
    expect(validateStep('activate', valid())).toEqual([]);
    expect(validateStep('identity', { ...valid(), name: '' })).toHaveLength(1);
  });
  it('keeps the first issue of a field for the inline message', () => {
    const map = issueMap(validateIdentity({ ...valid(), name: '', languages: [] }));
    expect(Object.keys(map).sort()).toEqual(['languages', 'name']);
  });
});

describe('checklist and summary', () => {
  it('a step is done once saved without error; channels need one linked page', () => {
    const list = wizardChecklist(valid(), { savedStep: 2, channelCount: 0 });
    expect(list.map((s) => s.done)).toEqual([true, true, false, false, false]);
    expect(wizardChecklist(valid(), { savedStep: 4, channelCount: 1 })[3]?.done).toBe(true);
    expect(wizardChecklist({ ...valid(), name: '' }, { savedStep: 3, channelCount: 1 })[0]).toMatchObject({ done: false, issues: 1 });
  });
  it('counts policies and the handoff rows as drawn (grouped rule counts once)', () => {
    expect(policyCount({ policies: { delivery: 'a', payment: ' ', returns: 'b' } })).toBe(2);
    const d = valid();
    expect(enabledRuleCount(d)).toBe(5);
    const off = { ...d, handoffRules: setRule(d, 'human_request', false) };
    expect(ruleOn(off, 'refund')).toBe(false);
    expect(ruleOn(off, 'complaint')).toBe(false);
    expect(enabledRuleCount(off)).toBe(4);
  });
  it('locked order fields cannot be switched off', () => {
    const d = valid();
    expect(setOrderField(d, 'phone', false).find((f) => f.key === 'phone')?.required).toBe(true);
    expect(setOrderField(d, 'note', true).find((f) => f.key === 'note')?.required).toBe(true);
  });
  it('estimates credits like the frame: ≈ 1,4 / conversation, ≈ 1 700 for 1 200 conversations', () => {
    const d = valid();
    expect(creditsPerConversation(d)).toBe(1.4);
    expect(monthlyCreditEstimate(d, 1200)).toBe(1700);
    expect(creditsPerConversation({ capabilities: { ...d.capabilities, imageRecognition: false, voiceTranscription: false } })).toBe(1);
    expect(monthlyCreditEstimate(d, 100)).toBe(140);
  });
  it('applies the emoji level to the preview', () => {
    expect(previewReply('Salam 👋 kayna', 'none')).toBe('Salam kayna');
    expect(previewReply('Salam 👋', 'moderate')).toBe('Salam 👋');
    expect(previewReply('Salam', 'many')).toContain('🙏');
  });
});

describe('draft diff and patch', () => {
  it('reads an agent into a draft and keeps the defaults for missing fields', () => {
    const d = draftFromAgent(agent({ wizard: { displayName: 'Amel', languages: ['fr'], defaultLanguage: 'fr', maxQtyPerOrder: 8 } as Agent['wizard'] }));
    expect(d).toMatchObject({ name: 'Vendeur Pro', displayName: 'Amel', languages: ['fr'], maxQtyPerOrder: 8, responseDelaySec: 3, presetKey: 'vendeur-pro' });
    expect(d.capabilities.voiceTranscription).toBe(false);
    expect(d.orderFields).toHaveLength(9);
  });
  it('starts from a preset with its capabilities and tone', () => {
    const preset = { key: 'reponse-express', name: 'Réponse Express', tagline: 'Court', personality: 'casual', imageRecognition: false, voiceTranscription: true, responseDelaySec: 1 } as AgentPreset;
    const d = draftFromPreset(preset, { name: 'Mon agent', description: '', displayName: '' });
    expect(d).toMatchObject({ presetKey: 'reponse-express', tone: 'casual', responseDelaySec: 1, name: 'Mon agent', description: 'Court' });
    expect(d.capabilities.imageRecognition).toBe(false);
    expect(draftFromPreset(null).presetKey).toBeNull();
  });
  it('finds the dirty sections and the changed fields', () => {
    const base = valid();
    expect(dirtySections(base, { ...base })).toEqual([]);
    expect(dirtySections(base, { ...base, name: `${base.name}  ` })).toEqual([]);
    const edited = { ...base, maxQtyPerOrder: 8, policies: { delivery: '2–5 jours' } };
    expect(dirtySections(base, edited)).toEqual(['knowledge', 'behaviour']);
    expect(diffDraft(base, edited).map((c) => c.field)).toEqual(['policies', 'maxQtyPerOrder']);
    expect(diffDraft(base, edited)[1]).toMatchObject({ before: null, after: 8 });
  });
  it('builds the PATCH body of the dirty sections only', () => {
    const d = { ...valid(), description: ' ', displayName: ' Amel ', policies: { delivery: ' 2–5 j ', payment: '' } };
    const identity = sectionsPatch(d, ['identity']);
    expect(identity).toMatchObject({ name: 'Vendeur Pro — Boutique Amel', description: null });
    expect(identity.wizard).toMatchObject({ displayName: 'Amel', languages: d.languages });
    expect(identity.wizard).not.toHaveProperty('policies');
    expect(identity.wizard).not.toHaveProperty('avatarUploadId');
    expect(sectionsPatch(d, ['knowledge']).wizard?.policies).toEqual({ delivery: '2–5 j' });
    const behaviour = sectionsPatch(d, ['behaviour']);
    expect(behaviour).toMatchObject({ responseDelaySec: 2, imageRecognition: true, voiceTranscription: true, productCardTemplate: null });
    expect(behaviour.wizard?.orderFields?.[0]).toEqual({ key: 'product', required: true });
    expect(sectionsPatch({ ...d, avatarMode: 'upload', avatarUploadId: 'u1' }, ['identity']).wizard).toMatchObject({ avatarUploadId: 'u1' });
  });
  it('merges by section after a 409: my sections stay, the others take the fresh values', () => {
    const base = valid();
    const mine = { ...base, maxQtyPerOrder: 8 };
    const theirs = { ...base, name: 'Renommé', maxQtyPerOrder: 3, policies: { payment: 'COD' } };
    const merged = mergeBySection(mine, base, theirs);
    expect(merged.name).toBe('Renommé');
    expect(merged.policies).toEqual({ payment: 'COD' });
    expect(merged.maxQtyPerOrder).toBe(8);
  });
});

describe('business hours', () => {
  it('validates days, format and order', () => {
    expect(validateSchedule(null)).toBeNull();
    expect(validateSchedule({ days: [0, 1], from: '09:00', to: '20:00' })).toBeNull();
    expect(validateSchedule({ days: [], from: '09:00', to: '20:00' })).toBe('agents.validation.hoursDays');
    expect(validateSchedule({ days: [1], from: '9h', to: '20:00' })).toBe('agents.validation.hoursFormat');
    expect(validateSchedule({ days: [1], from: '20:00', to: '09:00' })).toBe('agents.validation.hoursOrder');
    expect(minutesOf('09:30')).toBe(570);
  });
  it('tells whether an instant is inside the hours', () => {
    const s = { days: [0, 1, 2, 3, 4, 6], from: '09:00', to: '20:00' };
    expect(withinHours(null, 5, 0)).toBe(true);
    expect(withinHours(s, 1, 9 * 60)).toBe(true);
    expect(withinHours(s, 1, 20 * 60)).toBe(false);
    expect(withinHours(s, 5, 12 * 60)).toBe(false);
  });
});

describe('playground view models', () => {
  it('renders a tool call like the frame and flags a simulated write', () => {
    expect(toolCallView({ name: 'search_products', args: { query: 'robe satin' }, result: { count: 3 }, simulated: false })).toEqual({ name: 'search_products', simulated: false, failed: false, args: '{ query: "robe satin" }', result: '{ count: 3 }' });
    const order = toolCallView({ name: 'create_order', args: { qty: 1 }, result: { ok: true, number: 'TEST-4821', simulated: true } });
    expect(order.simulated).toBe(true);
    expect(order.result).toContain('TEST-4821');
    expect(toolCallView({ name: 'get_shipping_fee', args: {}, result: { ok: false, error: 'WILAYA_NOT_SERVED' }, simulated: false }).failed).toBe(true);
    expect(toolCallView({ name: 'x', args: null, result: null }).result).toBe('—');
    expect(toolCallView({ name: 'x', args: {}, result: 'x'.repeat(700) }).result).toHaveLength(600);
  });
  it('normalises a turn', () => {
    const turn = {
      turnId: 't1',
      sessionId: 's',
      reply: 'نعم',
      status: 'OK',
      statusDetail: null,
      intent: 'sale',
      confidence: 0.97,
      model: 'gpt-4o-mini',
      modelDetail: { id: 'm', temperature: 0.6, maxTokens: 1200 },
      tokens: { input: 2140, output: 186 },
      latencyMs: 2300,
      toolCalls: [
        { name: 'search_products', args: {}, result: {}, simulated: false },
        { name: 'create_order', args: {}, result: {}, simulated: true },
      ],
      cards: [{ productId: 'p1', name: 'La Robe satin', price: 4900, imageUrl: null, variantLabel: 'Rouge · M' }],
      creditsInProd: 1,
      language: 'ar',
      promptPreview: ['Personnalité · amical'],
      promptSections: [],
      systemMessages: [],
    } satisfies PlaygroundTurn;
    const v = turnView(turn);
    expect(v).toMatchObject({ intent: 'SALE', model: 'gpt-4o-mini', simulatedTools: 1, creditsInProd: 1, turnId: 't1', prompt: ['Personnalité · amical'] });
    expect(v.cards[0]).toEqual({ id: 'p1', name: 'La Robe satin', price: 4900, imageUrl: null, variants: 'Rouge · M' });
    expect(turnView({ ...turn, promptPreview: [], promptSections: [{ key: 'catalogue', chars: 1240 }] }).prompt).toEqual(['catalogue · 1240']);
  });
  it('formats confidence and latency per locale', () => {
    expect(confidenceLabel(0.97, 'fr')).toBe('0,97');
    expect(confidenceLabel(0.9, 'en')).toBe('0.90');
    expect(secondsLabel(2300, 'fr')).toBe('2,3 s');
    expect(secondsLabel(null, 'fr')).toBe('—');
  });
});

describe('list helpers', () => {
  it('derives the card state and the plan limit', () => {
    expect(cardState({ status: 'paused', pausedReason: 'plan' })).toBe('paused_plan');
    expect(cardState({ status: 'paused', pausedReason: 'manual' })).toBe('paused');
    expect(cardState({ status: 'draft', pausedReason: null })).toBe('draft');
    expect(limitReached({ limit: 2, current: 2 })).toBe(true);
    expect(limitReached({ limit: 3, current: 2 })).toBe(false);
    expect(limitReached({ limit: -1, current: 9 })).toBe(false);
    expect(limitReached(null)).toBe(false);
  });
  it('computes the share handled without a human', () => {
    expect(handledPct({ conversations: 1010, handledWithoutHuman: 879 })).toBe(87);
    expect(handledPct({ conversations: 0, handledWithoutHuman: 0 })).toBeNull();
  });
  it('reads the missing items of AGENT_DRAFT_INCOMPLETE from params or details', () => {
    expect(missingKeys({ missing: 'channels, policies' }, null)).toEqual(['channels', 'policies']);
    expect(missingKeys({}, { missing: ['catalog'] })).toEqual(['catalog']);
    expect(missingKeys(undefined, null)).toEqual([]);
  });
});

describe('activation (AGT-02 step 5)', () => {
  it('blockingChecks keeps the blocking rows that are not ok (✕), in order', () => {
    const checks = [
      { key: 'catalog', ok: false, label: 'Catalogue', blocking: false },
      { key: 'channels', ok: false, label: 'Pages rattachées', blocking: true },
      { key: 'emailVerified', ok: true, label: 'E-mail vérifié', blocking: true },
      { key: 'credits', ok: false, label: 'Crédits' },
    ];
    expect(blockingChecks(checks).map((c) => c.key)).toEqual(['channels']);
    expect(blockingChecks(undefined)).toEqual([]);
  });
  it('localDateTimeInput formats a datetime-local value (min of "Activer à une date")', () => {
    expect(localDateTimeInput(new Date(2031, 0, 5, 9, 7))).toBe('2031-01-05T09:07');
    expect(localDateTimeInput(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31T23:59');
  });
});
