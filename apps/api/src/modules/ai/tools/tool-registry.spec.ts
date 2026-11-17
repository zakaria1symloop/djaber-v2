// Tool schemas must be accepted by every provider: Anthropic refuses a top-level oneOf / allOf / anyOf in input_schema.
import { personalNote, TOOL_DEFS, ToolRegistry } from './tool-registry';

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

describe('full-test 15/11 proposal 2 — check_availability (create_order is never a probe)', () => {
  const product = (o: Partial<{ stock: number | null; sellOutOfStock: boolean; hasVariants: boolean; variants: { id: string; name: string; price: number; stock: number }[] }> = {}) => ({ id: 'p1', name: 'Robe kabyle', price: 4900, stock: 2, sellOutOfStock: false, hasVariants: false, variants: [], ...o });
  const reg = (p: unknown) => Object.assign(Object.create(ToolRegistry.prototype) as object, { catalogue: { byIds: async () => (p ? [p] : []) } }) as unknown as ToolRegistry;
  const ctx = { workspaceId: 'w', agent: {} as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true };
  it('enough stock ⇒ available, no count', async () => {
    const r = await reg(product()).execute('check_availability', { productId: 'p1', quantity: 2 }, ctx);
    expect(r).toMatchObject({ ok: true, available: true });
    expect(r).not.toHaveProperty('availableQuantity');
  });
  it('short ⇒ not available with the quantity left (the only count the reply may give) and the other variants', async () => {
    const variants = [{ id: 'xl', name: 'XL', price: 5200, stock: 2 }, { id: 'm', name: 'M', price: 4900, stock: 4 }, { id: 'l', name: 'L', price: 4900, stock: 0 }];
    const r = await reg(product({ hasVariants: true, variants, stock: null })).execute('check_availability', { productId: 'p1', variantId: 'xl', quantity: 3 }, ctx);
    expect(r).toMatchObject({ ok: true, available: false, availableQuantity: 2, variant: 'XL', otherVariants: [{ variantId: 'm', name: 'M' }] });
  });
  it('sold beyond the stock ⇒ orderable; a variant product without a variant ⇒ the variants; unknown ⇒ not available', async () => {
    expect(await reg(product({ stock: 0, sellOutOfStock: true })).execute('check_availability', { productId: 'p1', quantity: 3 }, ctx)).toMatchObject({ available: true, beyondStock: true });
    expect(await reg(product({ hasVariants: true, variants: [{ id: 's', name: 'S', price: 4900, stock: 0 }] })).execute('check_availability', { productId: 'p1' }, ctx)).toMatchObject({ variantRequired: true, variants: [{ id: 's', available: false }] });
    expect(await reg(null).execute('check_availability', { productId: 'zz' }, ctx)).toMatchObject({ ok: false, error: { code: 'PRODUCT_NOT_AVAILABLE' } });
  });
  it('AI-CHAT-16: the playground sees its own TEST-n orders (lookup_order, cancel_order candidates)', async () => {
    const orderHistory = [{ name: 'create_order', result: { ok: true, number: 'TEST-8354', simulated: true, total: 7300, items: [] }, at: new Date() }];
    const r = reg(product());
    expect(await r.execute('lookup_order', {}, { ...ctx, orderHistory })).toMatchObject({ orders: [{ number: 'TEST-8354', status: 'new', simulated: true }] });
    expect(await r.execute('cancel_order', {}, { ...ctx, orderHistory })).toMatchObject({ ok: true, candidates: [{ number: 'TEST-8354' }], simulated: true });
  });
});

describe('journey 16/11 J04-7 — add_faq_candidate is never a note about one customer', () => {
  it.each([
    'Cliente Samira Benali (Sétif, El Eulma, cité 500 logements bloc 12) souhaite commander, mais aucun article n’est disponible actuellement.',
    'Rappeler le 0661234567 quand la robe revient',
    'Samira souhaite être livrée à la cité 20 août villa 3',
  ])('refused: « %s »', async (question) => {
    expect(personalNote(question)).toBe(true);
    const reg = Object.create(ToolRegistry.prototype) as ToolRegistry;
    const r = await reg.execute('add_faq_candidate', { question }, { workspaceId: 'w', agent: { id: 'a' } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true });
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'question' } });
  });
  it.each(['Quelle est l’adresse de la boutique ?', 'Le client demande si vous livrez à Illizi', 'Quand les produits seront-ils de nouveau disponibles ?', 'واش عندكم محل؟'])('a general question: « %s »', (q) => expect(personalNote(q)).toBe(false));
});

describe('journey 16/11 J09-14 — the dry run (playground, shared test link) refuses a blocked phone like live', () => {
  const request = { clientName: 'Nadia', clientPhone: '0661000909', secondPhone: null, wilayaId: 9, communeName: 'Blida', address: 'rue 14', isStopdesk: false, stopdeskId: null, notes: null, items: [], subtotal: 1200, deliveryFee: 450, total: 1650 };
  const reg = (blocked: boolean) =>
    Object.assign(Object.create(ToolRegistry.prototype) as object, {
      prepareOrder: async () => ({ ok: true, request, draft: 'd' }),
      orders: { isBlocked: async (_ctx: unknown, phone: string) => blocked && phone === '0661000909' },
    }) as unknown as ToolRegistry;
  const ctx = { workspaceId: 'w', agent: { id: 'a' } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true };
  it('blocked ⇒ CUSTOMER_BLOCKED + handoff, no TEST-n order', async () => {
    const r = await reg(true).execute('create_order', {}, ctx);
    expect(r).toEqual({ ok: false, error: { code: 'CUSTOMER_BLOCKED' }, hint: 'handoff' });
  });
  it('not blocked ⇒ the simulated TEST-n order', async () => {
    expect(await reg(false).execute('create_order', {}, ctx)).toMatchObject({ ok: true, simulated: true, total: 1650 });
  });
});
