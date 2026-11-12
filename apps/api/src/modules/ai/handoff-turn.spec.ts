import { AiRunService, type TurnRequest } from './ai-run.service';
import { HANDOFF_REFUSED_MARK } from './handoff-judge';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import type { RoutedModel } from './routing.service';
import type { ToolRegistry } from './tools/tool-registry';

// retest 12/11: `status = HANDOFF` in the model's answer is checked like the tool (it never was): refused ⇒ the model is told
// why and answers; insisting with a reply ⇒ that reply is sent and the AI keeps the conversation
describe('AiRunService.turn — handoff check of the answer', () => {
  const model = { id: 'm1', providerId: 'p1', provider: 'anthropic', modelId: 'claude-haiku-4-5', label: 'Haiku', contextTokens: null, supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-4-5' } } as unknown as RoutedModel;
  const setup = () => {
    const gateway = new FakeAiGateway();
    const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
    const tools = { defsFor: async () => [], forcedHandoff: () => null, execute: async () => ({ ok: true }) } as unknown as ToolRegistry;
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    const req = (customerText: string): TurnRequest => ({
      runId: 'r1',
      prompt: { system: 'SYSTEM', messages: [{ role: 'user', content: customerText }] },
      toolCtx: { workspaceId: 'w1', agent: { humanHandoffRules: null, handoffKeywords: [] } as never, conversationId: 'c1', clientId: null, channelId: 'ch1', runId: 'r1', dryRun: false, customerText },
      temperature: 0.5,
      maxTokens: 500,
      deadline: Date.now() + 30_000,
      persist: false,
    });
    return { gateway, svc, req };
  };

  it('a handoff on a greeting is refused: the model is told why and its answer is sent', async () => {
    const { gateway, svc, req } = setup();
    gateway.script('reply', { reply: '', status: 'HANDOFF', statusDetail: 'customer_request', evidence: 'salam', intent: 'OTHER' }, { reply: 'Salam ! Comment je peux vous aider ?', intent: 'GREETING' });
    const t = await svc.turn(req('salam'));
    expect(t).toMatchObject({ ok: true, output: { status: 'OK', reply: 'Salam ! Comment je peux vous aider ?' }, handoffRefused: 'greeting' });
    const second = gateway.calls[1]!.messages.at(-1)! as { content?: unknown };
    expect(String(second.content)).toContain(HANDOFF_REFUSED_MARK);
  });

  it('a handoff quoting the customer goes through at once', async () => {
    const { gateway, svc, req } = setup();
    gateway.script('reply', { reply: '', status: 'HANDOFF', statusDetail: 'customer_request', evidence: 'parler à un conseiller', intent: 'OTHER' });
    const t = await svc.turn(req('je veux parler à un conseiller svp'));
    expect(t).toMatchObject({ ok: true, output: { status: 'HANDOFF', statusDetail: 'customer_request' } });
    expect(gateway.calls).toHaveLength(1);
    expect((t as { handoffRefused?: unknown }).handoffRefused).toBeUndefined();
  });

  it('insisting with a reply ⇒ the reply is sent and the AI keeps the thread; insisting with nothing ⇒ the handoff goes through', async () => {
    const a = setup();
    a.gateway.script('reply', { reply: 'Je vérifie.', status: 'HANDOFF', statusDetail: 'customer_request', intent: 'OTHER' }, { reply: 'Je regarde avec l’équipe.', status: 'HANDOFF', statusDetail: 'customer_request', intent: 'OTHER' });
    const kept = await a.svc.turn(a.req('bch7al la robe ?'));
    expect(kept).toMatchObject({ ok: true, output: { status: 'OK', reply: 'Je regarde avec l’équipe.' }, handoffRefused: 'no_evidence' });
    expect((kept as { output: { statusDetail?: string } }).output.statusDetail).toBeUndefined();

    const b = setup();
    b.gateway.script('reply', { reply: '', status: 'HANDOFF', statusDetail: 'off_catalogue', intent: 'OTHER' }, { reply: '', status: 'HANDOFF', statusDetail: 'off_catalogue', intent: 'OTHER' });
    expect(await b.svc.turn(b.req('prix de gros ?'))).toMatchObject({ ok: true, output: { status: 'HANDOFF' }, handoffRefused: 'no_evidence' });
  });
});
