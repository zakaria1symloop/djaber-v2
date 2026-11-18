import { AiRunService, FIELD_ONLY_NOTE, type TurnRequest } from './ai-run.service';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { handoffReply } from './reply-fixes';
import type { AiGateway, AiGenerateRequest, AiGenerateResult } from './provider/ai.gateway';
import { buildGuardFacts, type GuardFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { orderRecapText, pendingRecap } from './tools/order-confirmation-text';
import type { ToolRegistry } from './tools/tool-registry';

// Journey retest R1 (17/11): the model loop — a call to a tool the step did not offer is never run and never fails the
// turn (R1-1: 5 of 59 turns ended in 503 when the model called the withheld handoff_to_human), and a recap create_order
// returned is sent as the server wrote it (R1-6 / R1-7).
describe('AiRunService.turn — journey retest R1', () => {
  const model = { id: 'm1', providerId: 'p1', provider: 'anthropic', modelId: 'claude-haiku-5-5', label: 'Haiku', contextTokens: null, supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
  const facts = (o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}): GuardFacts =>
    buildGuardFacts({ lang: 'fr', products: [{ name: 'Djellaba homme', sku: 'DJ-1', price: 7500, oldPrice: null, hasVariants: false, variants: [], also: [], description: null }], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Nassim', customerText: 'x', answeredBefore: true, freshStart: false, ...o });
  const DEFS = ['quote_delivery', 'create_order', 'handoff_to_human'].map((name) => ({ name, description: '', parameters: {} }));
  const setup = (gateway: AiGateway, toolResult: unknown = { ok: true }) => {
    const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
    const execute = jest.fn(async () => toolResult);
    const tools = { defsFor: async () => DEFS, forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    const req = (customerText: string, guard: GuardFacts | undefined = facts({ customerText }), ordering = true): TurnRequest => ({
      runId: 'r1',
      prompt: { system: 'SYSTEM', messages: [{ role: 'user', content: customerText }] },
      toolCtx: { workspaceId: 'w1', agent: { humanHandoffRules: 'clients VIP', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r1', dryRun: true, customerText, ordering },
      temperature: 0.5,
      maxTokens: 500,
      deadline: Date.now() + 30_000,
      persist: false,
      guard,
    });
    return { svc, req, execute };
  };

  it('R1-1: on a phone-only message handoff_to_human is not offered; the model calling it anyway gets « not available », nothing runs, the turn answers', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'handoff_to_human', args: { reason: 'other', evidence: '0770112233' } }] }, { reply: 'Merci Karim, dans quelle wilaya souhaitez-vous être livré ?', intent: 'SALE' });
    const { svc, req, execute } = setup(gateway);
    const t = await svc.turn(req('0770112233'));
    expect(t).toMatchObject({ ok: true, output: { reply: 'Merci Karim, dans quelle wilaya souhaitez-vous être livré ?' }, tools: [] });
    expect(execute).not.toHaveBeenCalled();
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).toEqual(['quote_delivery', 'create_order']);
    // the note follows the cached start of the system prompt
    expect(gateway.calls[0]!.system).toBe(`SYSTEM\n\n${FIELD_ONLY_NOTE}`);
    const told = String((gateway.calls[1]!.messages.at(-1) as { content: unknown }).content);
    expect(told).toContain('[tool result handoff_to_human]');
    expect(told).toContain('TOOL_NOT_AVAILABLE');
  });

  it('R1-1: calls the SDK refused (`rejectedToolCalls` of the live gateway) are told to the model as well — no provider error', async () => {
    const answers: AiGenerateResult[] = [
      { text: '', toolCalls: [], rejectedToolCalls: [{ id: 'toolu_1', name: 'handoff_to_human', args: { reason: 'other' } }], usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'tool-calls' },
      { text: JSON.stringify({ reply: 'Parfait, c’est noté. Quelle est votre commune ?', status: 'OK', intent: 'SALE', confidence: 0.9, language: 'fr', productCards: [] }), toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, finishReason: 'stop' },
    ];
    const seen: AiGenerateRequest[] = [];
    const gateway: AiGateway = { driver: 'fake', generate: async (r) => (seen.push(r), answers.shift()!), transcribe: async () => ({ text: '', language: null, durationSec: null }) };
    const { svc, req, execute } = setup(gateway);
    const t = await svc.turn(req('Sétif'));
    // (journey retest R18-4: « c'est noté » before any recap reads like an order step — it goes)
    expect(t).toMatchObject({ ok: true, output: { reply: 'Parfait. Quelle est votre commune ?' } });
    expect(execute).not.toHaveBeenCalled();
    expect(String((seen[1]!.messages.at(-2) as { content: unknown }).content)).toContain('[tool call handoff_to_human');
  });

  it('R1-1: a message that asks for the team still gets the handoff tool and no note', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Je préviens l’équipe.', intent: 'OTHER' });
    const { svc, req } = setup(gateway);
    await svc.turn(req('je veux parler à un humain'));
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).toContain('handoff_to_human');
    expect(gateway.calls[0]!.system).toBe('SYSTEM');
  });

  const recap = {
    ok: false,
    error: { code: 'CONFIRMATION_REQUIRED', draft: 'd1', core: 'c1' },
    recapToShow: true,
    recap: { items: [{ name: 'Tapis de prière', variant: null, quantity: 3, unitPrice: 2800 }], subtotal: 8400, deliveryFee: 700, total: 9100, clientName: 'Samira Benali', clientPhone: '0661234567', wilaya: 'Constantine', communeName: 'El Khroub', address: 'Cité 1000 logements bloc 5', isStopdesk: false },
  };
  const recapText = (lang: string) => orderRecapText(pendingRecap([{ name: 'create_order', result: recap }])!, lang);

  it('R1-6: a one-sentence « recap » of the model (no lines, name or phone) is replaced by the server recap', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { items: [] } }] }, { reply: 'Votre commande de 3 tapis de prière (total 9100 DA, livraison incluse) attend votre confirmation : répondez oui.', intent: 'SALE' });
    const { svc, req } = setup(gateway, recap);
    const t = await svc.turn(req('Finalement mettez 3 tapis au lieu de 2'));
    expect(t.ok && t.output.reply).toBe(recapText('fr'));
    expect((t as { guard?: unknown }).guard).toBeUndefined();
    // no corrective turn for a text the server replaces — journey retest R19-1 (18/11): nor the answer step (the message asks nothing)
    expect(gateway.calls).toHaveLength(1);
  });

  it('R1-3 / R1-7: an arabizi customer gets the arabizi recap — the model’s French recap is not sent', async () => {
    const gateway = new FakeAiGateway();
    const french = 'Voici le récapitulatif : 3 × Tapis de prière : 8400 DA, livraison à domicile 700 DA, total 9100 DA. Nom : Samira Benali, téléphone 0661234567. Ça vous convient ? Répondez oui pour valider la commande.';
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { items: [] } }] }, { reply: french, intent: 'SALE' });
    const { svc, req } = setup(gateway, recap);
    const t = await svc.turn(req('cite 1000 logements bloc 5', facts({ lang: 'arabizi', customerText: 'cite 1000 logements bloc 5' })));
    expect(t.ok && t.output.reply).toBe(recapText('arabizi'));
  });

  it('R1-6 / R4-3: a whole recap of the model is replaced by the server recap; a handoff answer is never turned into a recap', async () => {
    const whole = 'Voici le récapitulatif : 3 × Tapis de prière : 8 400 DA, livraison à domicile (El Khroub) 700 DA, total 9 100 DA. Nom : Samira Benali, téléphone 0661234567. Répondez oui pour valider.';
    const g2 = new FakeAiGateway();
    g2.script('reply', { toolCalls: [{ name: 'create_order', args: { items: [] } }] }, { reply: whole, intent: 'SALE' });
    const s2 = setup(g2, recap);
    const kept = await s2.svc.turn(s2.req('cité 1000 logements bloc 5'));
    expect(kept.ok && kept.output.reply).toBe(recapText('fr'));
    const g3 = new FakeAiGateway();
    g3.script('reply', { toolCalls: [{ name: 'create_order', args: { items: [] } }] }, { reply: '', status: 'HANDOFF', statusDetail: 'customer_request', evidence: 'parler à un humain', intent: 'OTHER' });
    const s3 = setup(g3, recap);
    const handed = await s3.svc.turn(s3.req('je veux parler à un humain'));
    // journey retest R14-4: a handoff answer with no text gets the server's short sentence — R15-2: the one of its reason (a person)
    expect(handed.ok && handed.output.reply).toBe(handoffReply('customer_request', 'fr'));
    expect(handoffReply('customer_request', 'fr')).toBe("Bien sûr, je vous mets en relation avec l'équipe de la boutique.");
  });
});
