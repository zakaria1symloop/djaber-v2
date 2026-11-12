// Tool schemas must be accepted by every provider: Anthropic refuses a top-level oneOf / allOf / anyOf in input_schema.
import { TOOL_DEFS, ToolRegistry } from './tool-registry';

describe('TOOL_DEFS', () => {
  it.each(Object.values(TOOL_DEFS).map((d) => [d.name, d] as const))('%s: an object schema without top-level oneOf / allOf / anyOf', (_name, def) => {
    const schema = def.parameters as Record<string, unknown>;
    expect(schema.type).toBe('object');
    for (const k of ['oneOf', 'allOf', 'anyOf']) expect(schema).not.toHaveProperty(k);
  });
});

describe('handoff_to_human without a rule (retest 11/11, Badro « hands off for no reason »)', () => {
  // the handoff check needs no injected service: the registry is used without its dependencies
  const reg = Object.create(ToolRegistry.prototype) as ToolRegistry;
  const ctx = (humanHandoffRules: string | null) => ({ workspaceId: 'w', agent: { humanHandoffRules } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: false });

  it('reason « other » (or no listed rule) and no shop rule ⇒ refused, the model answers, the thread stays with the AI', async () => {
    for (const reason of ['other', 'whatever', undefined]) {
      const args = reason === undefined ? {} : { reason };
      const result = await reg.execute('handoff_to_human', args, ctx(null));
      expect(result).toMatchObject({ ok: false, error: { code: 'HANDOFF_NOT_NEEDED' } });
      expect(String((result as { instruction?: string }).instruction)).toContain('status=UNKNOWN');
      expect(reg.forcedHandoff('handoff_to_human', args, result)).toBeNull();
    }
  });

  it('a listed rule hands off; « other » too when the shop wrote rules of its own', async () => {
    const asked = await reg.execute('handoff_to_human', { reason: 'customer_request' }, ctx(null));
    expect(asked).toEqual({ ok: true });
    expect(reg.forcedHandoff('handoff_to_human', { reason: 'customer_request' }, asked)).toBe('customer_request');
    const shopRule = await reg.execute('handoff_to_human', { reason: 'other' }, ctx('Toute demande de gros ⇒ équipe'));
    expect(shopRule).toEqual({ ok: true });
    expect(reg.forcedHandoff('handoff_to_human', { reason: 'other' }, shopRule)).toBe('other');
  });
});

describe('handoff_to_human checked against the customer words of the turn (retest 12/11, « even after a hello »)', () => {
  const reg = Object.create(ToolRegistry.prototype) as ToolRegistry;
  const ctx = (customerText: string) => ({ workspaceId: 'w', agent: { humanHandoffRules: null, handoffKeywords: [] } as never, conversationId: 'c', clientId: null, channelId: 'ch', runId: 'r', callId: 'c', dryRun: false, customerText });

  it('a greeting or words that are not in the current message ⇒ refused with the reason; the quoted request ⇒ handed off', async () => {
    const hello = await reg.execute('handoff_to_human', { reason: 'customer_request', evidence: 'salam' }, ctx('salam'));
    expect(hello).toMatchObject({ ok: false, error: { code: 'HANDOFF_NOT_NEEDED', why: 'greeting' } });
    expect(reg.forcedHandoff('handoff_to_human', { reason: 'customer_request' }, hello)).toBeNull();
    const earlier = await reg.execute('handoff_to_human', { reason: 'customer_request', evidence: 'je veux un conseiller' }, ctx('et la livraison à Oran ?'));
    expect(earlier).toMatchObject({ ok: false, error: { why: 'evidence_not_in_message' } });
    const asked = await reg.execute('handoff_to_human', { reason: 'customer_request', evidence: 'je veux un conseiller' }, ctx('svp je veux un conseiller'));
    expect(asked).toEqual({ ok: true });
    expect(reg.forcedHandoff('handoff_to_human', { reason: 'customer_request' }, asked)).toBe('customer_request');
  });
});
