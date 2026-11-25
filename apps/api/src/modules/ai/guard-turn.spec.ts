import { AiRunService, guardFlags, type TurnRequest } from './ai-run.service';
import { GUARD_MARK } from './ai.constants';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { buildGuardFacts, SAFE_SENTENCES, type GuardFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import type { ToolRegistry } from './tools/tool-registry';

// 04-ai-pipeline §4.3: the reply guard inside the model loop — one corrective turn (no tool offered), then the guard's last
// word; the first answer's status, cards and handoff never change, and the guard never hands off.
describe('AiRunService.turn — reply guard', () => {
  const model = { id: 'm1', providerId: 'p1', provider: 'anthropic', modelId: 'claude-haiku-4-5', label: 'Haiku', contextTokens: null, supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-4-5' } } as unknown as RoutedModel;
  const facts = (o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}): GuardFacts =>
    buildGuardFacts({
      lang: 'fr',
      products: [{ name: 'Robe satin bordeaux', sku: 'ROB-001', price: 4500, oldPrice: null, hasVariants: false, variants: [], also: [], description: null }],
      shopTexts: [],
      freeDeliveryThreshold: null,
      agentName: 'Amina',
      shopName: 'Boutique Lina',
      customerText: 'prix de la robe ?',
      answeredBefore: true,
      freshStart: false,
      ...o,
    });
  const setup = (toolResult: unknown = { ok: true }) => {
    const gateway = new FakeAiGateway();
    const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
    const tools = { defsFor: async () => [{ name: 'quote_delivery', description: '', parameters: {} }, { name: 'create_order', description: '', parameters: {} }], forcedHandoff: () => null, execute: async () => toolResult } as unknown as ToolRegistry;
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    const req = (guard: GuardFacts | undefined, customerText = 'prix de la robe ?'): TurnRequest => ({
      runId: 'r1',
      prompt: { system: 'SYSTEM', messages: [{ role: 'user', content: customerText }] },
      toolCtx: { workspaceId: 'w1', agent: { humanHandoffRules: null, handoffKeywords: [] } as never, conversationId: 'c1', clientId: null, channelId: 'ch1', runId: 'r1', dryRun: false, customerText },
      temperature: 0.5,
      maxTokens: 500,
      deadline: Date.now() + 30_000,
      persist: false,
      guard,
    });
    return { gateway, svc, req };
  };

  it('a clean reply goes through with no extra model call', async () => {
    const { gateway, svc, req } = setup();
    gateway.script('reply', { reply: 'La robe est à 4500 DA.', intent: 'SALE', productCards: ['p1'] });
    const t = await svc.turn(req(facts()));
    expect(t).toMatchObject({ ok: true, output: { reply: 'La robe est à 4\u00a0500\u00a0DA.' } });
    expect((t as { guard?: unknown }).guard).toBeUndefined();
    expect(gateway.calls).toHaveLength(1);
  });

  it('a broken reply ⇒ one corrective turn without tools; the rewrite is sent with the first answer’s status and cards', async () => {
    const { gateway, svc, req } = setup();
    gateway.script('reply', { reply: 'Bonjour ! La robe est à 3900 DA.', intent: 'SALE', productCards: ['p1'] }, { reply: 'La robe est à 4500 DA.', status: 'HANDOFF', statusDetail: 'customer_request', intent: 'OTHER', productCards: [] });
    const t = await svc.turn(req(facts()));
    expect(t).toMatchObject({ ok: true, output: { reply: 'La robe est à 4\u00a0500\u00a0DA.', status: 'OK', intent: 'SALE', productCards: ['p1'] }, guard: { retried: true, action: 'rewritten', remaining: [] } });
    const g = (t as { guard: { violations: { rule: string; value?: number }[] } }).guard;
    expect(g.violations).toEqual([{ rule: 'unknown_amount', value: 3900 }, { rule: 'repeat_greeting' }]);
    expect(gateway.calls).toHaveLength(2);
    expect(gateway.calls[1]!.tools).toBeUndefined();
    const last = gateway.calls[1]!.messages.at(-1)! as { content?: unknown };
    expect(String(last.content)).toContain(GUARD_MARK);
    expect(String(last.content)).toContain('Robe satin bordeaux 4500 DA');
    expect(guardFlags((t as { guard?: never }).guard)).toEqual(['guard_rewritten']);
  });

  it('still broken after the rewrite ⇒ the offending sentence is dropped (the rest answers)', async () => {
    const { gateway, svc, req } = setup();
    gateway.script('reply', { reply: 'Oui elle est disponible. Il en reste 2.', intent: 'SALE' }, { reply: 'Oui elle est disponible. Il en reste 2 pièces.', intent: 'SALE' });
    const t = await svc.turn(req(facts()));
    expect(t).toMatchObject({ ok: true, output: { reply: 'Oui elle est disponible.' }, guard: { retried: true, action: 'stripped', remaining: [{ rule: 'stock_count', value: 2 }] } });
    expect(guardFlags((t as { guard?: never }).guard)).toEqual(['guard_enforced']);
  });

  it('nothing usable left ⇒ the neutral sentence, status unchanged (no handoff)', async () => {
    const { gateway, svc, req } = setup();
    gateway.script('reply', { reply: 'La livraison coûte 650 DA.', intent: 'INFO' }, { text: 'not json at all {' });
    const t = await svc.turn(req(facts()));
    expect(t).toMatchObject({ ok: true, output: { status: 'OK', reply: SAFE_SENTENCES.which.fr }, guard: { action: 'safe_sentence' } });
  });

  it("this turn's tool results are facts: a fee from quote_delivery passes", async () => {
    const { gateway, svc, req } = setup({ ok: true, wilayaName: 'Oran', fee: 650, stopdeskFee: 450, freeFrom: null });
    gateway.script('reply', { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Oran' } }] }, { reply: 'Oran : 650 DA à domicile, 450 DA en stop-desk.', intent: 'INFO' });
    const t = await svc.turn(req(facts()));
    expect(t).toMatchObject({ ok: true, output: { reply: 'Oran : 650 DA à domicile, 450 DA en stop-desk.' } });
    expect((t as { guard?: unknown }).guard).toBeUndefined();
  });

  // journey retest R18-3 (18/11): the server writes the missing fee itself — no corrective model turn (AUTO_FIX_RULES)
  it('journey 16/11 J03-2: quote_delivery answered but the reply gives no fee ⇒ the server adds the fee sentence (no corrective turn); a handoff answer is not checked', async () => {
    const setif = { ok: true, wilayaName: 'Sétif', isStopdesk: false, fee: 650, free: false, stopdeskAvailable: true, stopdeskFee: 350, freeFrom: null };
    const { gateway, svc, req } = setup(setif);
    gateway.script('reply', { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Sétif' } }] }, { reply: 'Merci 3la sbr ! Goulli-li wach t7ebb.', intent: 'INFO' }, { reply: 'Tawsil l Sétif 650 DA l dar, 350 DA f stop-desk.', intent: 'INFO' });
    const t = await svc.turn(req(facts({ lang: 'arabizi', customerText: 'ch7al tawsil l setif ?' }), 'ch7al tawsil l setif ?'));
    expect(t).toMatchObject({ ok: true, guard: { violations: [{ rule: 'fee_missing' }], retried: false, action: 'stripped' } });
    expect(t.ok && t.output.reply).toMatch(/^Tawsil l Sétif: 650\sDA l dar, 350\sDA f l bureau\. Merci 3la sbr ! Goulli-li wach t7ebb\.$/u);
    expect(gateway.calls).toHaveLength(2);
    const h = setup(setif);
    h.gateway.script('reply', { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Sétif' } }] }, { reply: 'Je transmets à un collègue.', status: 'HANDOFF', statusDetail: 'customer_request', evidence: 'parler à un humain', intent: 'OTHER' });
    const handed = await h.svc.turn(req(facts(), 'je veux parler à un humain'));
    expect((handed as { guard?: unknown }).guard).toBeUndefined();
  });

  it('no corrective turn when less than GUARD_RETRY_MIN_MS of the run budget is left: enforced at once', async () => {
    const { gateway, svc, req } = setup();
    const call = { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Alger' } }] };
    gateway.script('reply', call, { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Blida' } }] }, { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Oran' } }] }, { reply: 'Bonjour ! La robe est à 4500 DA.', intent: 'SALE' });
    const r = req(facts());
    const t = await svc.turn({ ...r, deadline: Date.now() + 5_000 });
    expect(t).toMatchObject({ ok: true, output: { reply: 'La robe est à 4\u00a0500\u00a0DA.' }, guard: { retried: false, action: 'stripped' } });
  });

  it('without facts (guard off) the reply is untouched', async () => {
    const { gateway, svc, req } = setup();
    gateway.script('reply', { reply: 'Il en reste 2, à 3900 DA.', intent: 'SALE' });
    const t = await svc.turn(req(undefined));
    expect(t).toMatchObject({ ok: true, output: { reply: 'Il en reste 2, à 3\u00a0900\u00a0DA.' } });
    expect(gateway.calls).toHaveLength(1);
  });

  it('the fake model rewrites by dropping its greeting (eval plumbing)', async () => {
    const { gateway, svc, req } = setup();
    gateway.script('reply', { reply: 'Bonjour ! La robe est à 4500 DA.', intent: 'SALE' });
    const t = await svc.turn(req(facts()));
    expect(t).toMatchObject({ ok: true, output: { reply: 'La robe est à 4\u00a0500\u00a0DA.' }, guard: { retried: true, action: 'rewritten' } });
  });

  it('full-test 15/11 proposal 4: once create_order placed an order, the customer gets the server confirmation (the model text is never checked nor sent)', async () => {
    const placed = { ok: true, number: 'CMD-1042', subtotal: 4500, deliveryFee: 400, total: 4900, items: [{ name: 'Robe satin bordeaux', variant: null, quantity: 1, unitPrice: 4500 }], duplicateOf: null, etaDays: '2–5' };
    const { gateway, svc, req } = setup(placed);
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: {} }] }, { reply: "Je dois corriger : j'ai utilisé des coordonnées inventées pour CMD-1042.", intent: 'SALE' });
    const t = await svc.turn(req(facts(), 'oui'));
    expect(t.ok && t.output.reply.split(String.fromCharCode(10))[0]).toBe('Votre commande CMD-1042 est bien enregistrée ✅');
    expect((t as { guard?: unknown }).guard).toBeUndefined();
    // journey retest R19-1 (18/11): the reply is the server's once the order is placed — no model step after the call
    expect(gateway.calls).toHaveLength(1);
  });

  it('full-test 15/11 AI-CHAT-07: a message that is only an order field is not offered handoff_to_human', async () => {
    const { gateway, svc, req } = setup();
    (svc as unknown as { tools: { defsFor: () => Promise<unknown[]> } }).tools.defsFor = async () => [{ name: 'quote_delivery', description: '', parameters: {} }, { name: 'handoff_to_human', description: '', parameters: {} }];
    gateway.script('reply', { reply: 'Merci, quelle est votre commune ?', intent: 'SALE' });
    const r = req(facts({ customerText: 'Sétif' }), 'Sétif');
    await svc.turn({ ...r, toolCtx: { ...r.toolCtx, ordering: true } });
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).toEqual(['quote_delivery']);
  });
});

