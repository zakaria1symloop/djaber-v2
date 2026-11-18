// Journey re-run J04r (18/11, docs/audit/journeys-2026-11-18/journeys/J04.md): a phone corrected in the next message never accepted
// (J04r-1, Blocker), a doubt after a real cancellation and a cancellation claimed with none (J04r-2), a beyond-stock product asked in Arabic
// with no name nor price (J04r-3), an MSA customer answered in darija (J04r-4). Transcripts: .local/qa/journeys/J04r/out/transcripts/.
import { prisma } from '@djaber/db';
import { digitsBeyondPhones } from './ai-run.service';
import { AiRunService, type TurnRequest } from './ai-run.service';
import { msaRegister, withMsaWording } from './msa';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { cancelClaimed, cancelledReply, cancelQuestion } from './reply-fixes';
import { buildGuardFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { orderRecapText, pendingRecap } from './tools/order-confirmation-text';
import { cancelledAsked, cancelledBefore, lastCancelled, latestPhone, phonesIn, simulatedOrderStates, simulatedOrders, type OrderCallHistory } from './tools/order-confirmation';
import { resetPlaceIndex } from './tools/place-index';
import { otherPhoneGiven, TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

afterEach(() => {
  jest.restoreAllMocks();
  resetPlaceIndex();
});

describe('J04r-1 (Blocker) — a wrong phone then the right one: the right one is the customer’s phone', () => {
  it('phonesIn never runs a number across a line break (each message is a line); whole digit groups only', () => {
    // P5: « … Amine Kaci 0698765 » then « 0698765432 » — read as « 0698765069 » before
    expect([...phonesIn('Je veux 1 hijab soie, livraison Alger Bab Ezzouar rue des frères Bouadou n 5, Amine Kaci 0698765\n0698765432')]).toEqual(['0698765432']);
    // C2 (Arabic script): « 0661234 », « 06612345678 » (11 digits), « 0661234567 »
    expect([...phonesIn('اسمي نادية بن علي\n0661234\n06612345678\n0661234567')]).toEqual(['0661234567']);
    expect([...phonesIn('06612345678')]).toEqual([]);
    // L3 (arabizi): « 0555 12 34 » then « 0555123456 »
    expect([...phonesIn('nheb hijab soie wahed, smiti Amina Saadi, Alger Bab Ezzouar rue des frères Bouadou n 5, 0555 12 34\n0555123456')]).toEqual(['0555123456']);
    // what stays read: spaced, dotted, dashed, +213, 00213, Arabic digits, two numbers on one line
    for (const [text, phones] of [
      ['0555 12 34 56', ['0555123456']],
      ['06.61.23.45.67', ['0661234567']],
      ['0770-11-22-33', ['0770112233']],
      ['+213 555 12 34 56', ['0555123456']],
      ['00213555123456', ['0555123456']],
      ['٠٦٦١٢٣٤٥٦٧', ['0661234567']],
      ['Nadia Kaci, 0661234568 ou 0770998877', ['0661234568', '0770998877']],
      ['0661 23 45 68 / 0770 99 88 77', ['0661234568', '0770998877']],
      ['rue 5 0661234567', ['0661234567']],
      ['Cité 500 logements bloc 12, 12 500 DA', []],
    ] as [string, string[]][])
      expect([...phonesIn(text)]).toEqual(phones);
  });

  it('latestPhone: the last message with one valid number wins; a message adding a second number keeps none', () => {
    expect(latestPhone('Amine Kaci 0698765\n0698765432\noui')).toBe('0698765432');
    expect(latestPhone('0661234567\nnon pardon c’est 0770998877')).toBe('0770998877');
    expect(latestPhone('0661234567\net aussi 0770998877')).toBeNull();
    expect(latestPhone('0661234568 ou 0770998877')).toBeNull();
    expect(latestPhone('bonjour')).toBeNull();
    expect(otherPhoneGiven('0661234568 ou 0770998877\nBlida', '0661234568')).toBe('0770998877');
  });

  it('digitsBeyondPhones: a batch of two messages « 0698765 » / « 0698765432 » leaves a digit (no number across the line break)', () => {
    expect(digitsBeyondPhones('Karim Haddad 0770112233')).toBe(false);
    expect(digitsBeyondPhones('0698765\n0698765432')).toBe(true);
  });

  const HIJAB = { id: '01a1ef58-0000-7000-8000-00000000a1ab', name: 'Hijab soie', price: 1500, hasVariants: false, variants: [], stock: 20, sellOutOfStock: false };
  const registry = () => {
    const reg = new ToolRegistry({ byIds: async () => [HIJAB] } as never, {} as never, {} as never, {} as never, {} as never);
    jest.spyOn(prisma.wilaya, 'findUnique').mockResolvedValue({ id: 16, code: '16', nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] } as never);
    jest.spyOn(prisma.aiToolCall, 'findMany').mockResolvedValue([] as never);
    const r = reg as unknown as { wilayaGiven: () => Promise<boolean>; quote: () => Promise<Record<string, unknown>> };
    jest.spyOn(r, 'wilayaGiven').mockResolvedValue(true);
    jest.spyOn(r, 'quote').mockResolvedValue({ ok: true, wilayaId: 16, wilayaName: 'Alger', fee: 400, free: false });
    return reg;
  };
  const ctx = (history: string[], said: string): ToolRunContext => ({ workspaceId: 'w', agent: { orderFields: [], maxQtyPerOrder: 5, maxAmountPerOrder: null } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText: said, customerHistory: [...history, said].join('\n'), orderHistory: [], ordering: true });
  const args = (phone: string) => ({ clientName: 'Amine Kaci', clientPhone: phone, wilayaId: 16, communeName: 'Bab Ezzouar', address: 'rue des frères Bouadou n 5', isStopdesk: false, items: [{ productId: HIJAB.id, quantity: 1 }], customerConfirmed: true });
  const P5_T1 = 'Je veux 1 hijab soie, livraison Alger Bab Ezzouar rue des frères Bouadou n 5, Amine Kaci 0698765';

  it('P5 T2 reproduction: create_order with « 0698765432 » after « 0698765 » ⇒ the server recap (was VALIDATION clientPhone missing, 3 / 3)', async () => {
    const r = await registry().prepareOrder(args('0698765432'), ctx([P5_T1], '0698765432'));
    const result = (r as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' }, recap: { clientPhone: '0698765432', total: 1900 } });
    expect(orderRecapText(pendingRecap([{ name: 'create_order', result }])!, 'fr')).toContain('Téléphone : 0698765432');
  });

  it('the model copying an earlier number: the last one the customer gave goes into the recap', async () => {
    const r = await registry().prepareOrder(args('0661234567'), ctx([P5_T1.replace('0698765', '0661234567'), 'non pardon, mon numéro c’est 0770998877'], 'oui'));
    expect((r as { result: { recap?: { clientPhone?: string } } }).result.recap?.clientPhone).toBe('0770998877');
  });

  it('a number the customer never wrote is still asked for', async () => {
    const r = await registry().prepareOrder(args('0555000000'), ctx([P5_T1], '0698765432'));
    expect((r as { result: Record<string, unknown> }).result).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'clientPhone', missing: true } });
  });
});

describe('J04r-2 (Major) — after a cancellation the AI says it is cancelled; it never claims one the server did not make', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 18, 16, m));
  // C6: TEST-4458 → replaced by TEST-1210 → cancelled
  const C6: OrderCallHistory = [
    { name: 'create_order', at: at(1), result: { ok: true, simulated: true, number: 'TEST-4458', total: 1900 } },
    { name: 'create_order', at: at(3), result: { ok: true, simulated: true, number: 'TEST-1210', total: 3400, replaced: { number: 'TEST-4458' } } },
    { name: 'cancel_order', at: at(6), result: { ok: true, simulated: true, cancelled: 'TEST-1210' } },
  ];

  it('the playground lookup sees the cancelled / replaced TEST orders with their status; the open list is empty', () => {
    expect(simulatedOrders(C6)).toEqual([]);
    expect(simulatedOrderStates(C6).map((o) => [o.number, o.status, o.replacedBy ?? null])).toEqual([
      ['TEST-4458', 'cancelled', 'TEST-1210'],
      ['TEST-1210', 'cancelled', null],
    ]);
    expect(lastCancelled(C6)).toBe('TEST-1210');
    expect(lastCancelled([...C6, { name: 'create_order', at: at(9), result: { ok: true, simulated: true, number: 'TEST-7000', total: 1900 } }])).toBeNull();
    // live cancel result shape
    expect(lastCancelled([{ name: 'cancel_order', at: at(1), result: { ok: true, cancelled: { number: 'CMD-1042' } } }])).toBe('CMD-1042');
    expect(cancelledBefore(C6, 'test-4458')).toBe('TEST-4458');
    expect(cancelledBefore(C6, 'TEST-9999')).toBeNull();
  });

  it('cancelledAsked: « elle est bien annulée ? » and its forms; a cancel request is not', () => {
    for (const t of ['elle est bien annulée ?', "c'est annulé ?", 'is it cancelled?', 'tbatlet ?', 'راهي ملغية ؟', 'تلغات ؟', 'Elle est bien annulée'])
      expect(cancelledAsked(t)).toBe(true);
    for (const t of ['annulez la commande s’il vous plaît', 'je veux annuler', 'bonjour', 'la commande annulée hier, je peux en refaire une avec 2 hijabs et livraison à Oran ?'])
      expect(cancelledAsked(t)).toBe(false);
  });

  const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
  const routing = {
    call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }),
    route: async () => ({ capability: 'text', primary: model, fallback: null, failoverActive: false }),
  };
  const turn = async (said: string, lang: 'fr' | 'ar' | 'arabizi' | 'en', history: OrderCallHistory, answers: Parameters<FakeAiGateway['script']>[1][], results: Record<string, unknown> = {}) => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', ...answers);
    const execute = jest.fn(async (name: string) => results[name] ?? {});
    const defs = (['lookup_order', 'cancel_order', 'search_products'] as const).map((d) => TOOL_DEFS[d]);
    const tools = { defsFor: async () => defs, execute, forcedHandoff: () => null, soldProductNamed: async () => null } as unknown as ToolRegistry;
    const guard = buildGuardFacts({ lang, products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText: said, answeredBefore: true, freshStart: false });
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: said }] } as never, toolCtx: { workspaceId: 'w', agent: { maxQtyPerOrder: null } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText: said, customerHistory: `annulez la commande s'il vous plaît\n${said}`, orderHistory: history, ordering: false }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard };
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
    if (!r.ok) throw new Error('turn failed');
    return { r, gateway, execute };
  };

  it('C6 T11 / R1 T6 reproduction: « elle est bien annulée ? » ⇒ « Oui, la commande TEST-1210 est bien annulée. », no model call', async () => {
    const { r, gateway } = await turn('elle est bien annulée ?', 'fr', C6, [{ reply: 'Je dois être honnête : je ne peux pas confirmer que la commande TEST-1210 est annulée.', intent: 'TRACKING' }]);
    expect(gateway.calls).toHaveLength(0);
    expect(r.output.reply).toBe('Oui, la commande TEST-1210 est bien annulée.');
    expect(cancelledReply('TEST-1210', 'ar')).toBe('إيه، الطلبية TEST-1210 راهي ملغية.');
    expect(cancelledReply('TEST-1210', 'arabizi')).toBe('Ih, la commande TEST-1210 rahi mbatla.');
  });

  it('C1 T13 reproduction: `cancel_order {}` ⇒ candidates (nothing cancelled) and « … est annulée » ⇒ the server asks instead', async () => {
    const open: OrderCallHistory = [{ name: 'create_order', at: at(1), result: { ok: true, simulated: true, number: 'TEST-1525', total: 10_450 } }];
    const { r } = await turn('je veux annuler, vous pouvez ?', 'fr', open, [{ toolCalls: [{ name: 'cancel_order', args: {} }] }, { reply: 'La commande TEST-1525 (2 × Robe kabyle brodée, taille M, 10 450 DA) est annulée.', intent: 'TRACKING' }], { cancel_order: { ok: true, simulated: true, candidates: [{ number: 'TEST-1525', total: 10_450 }] } });
    expect(r.output.reply).toBe("Voulez-vous que j'annule la commande TEST-1525 ?");
  });

  it('cancelClaimed / cancelQuestion', () => {
    expect(cancelClaimed('La commande TEST-1525 est annulée.')).toBe(true);
    expect(cancelClaimed("J'ai annulé votre commande.")).toBe(true);
    expect(cancelClaimed('Your order has been cancelled.')).toBe(true);
    expect(cancelClaimed('الطلبية تلغات')).toBe(true);
    expect(cancelClaimed("La commande n'est pas annulée.")).toBe(false);
    expect(cancelClaimed('Voulez-vous annuler la commande ?')).toBe(false);
    expect(cancelQuestion(['TEST-1', 'TEST-2'], 'fr')).toBe('Quelle commande voulez-vous annuler : TEST-1 ou TEST-2 ?');
    expect(cancelQuestion([], 'en')).toBe("I can't find an open order to cancel.");
  });

  it('the cancel tool: an already cancelled order is said so; « annulez la commande » with one open order cancels it', async () => {
    const reg = new ToolRegistry({} as never, {} as never, {} as never, {} as never, {} as never);
    jest.spyOn(prisma.aiToolCall, 'findMany').mockResolvedValue([] as never);
    const base = { workspaceId: 'w', agent: {} as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, ordering: false };
    expect(await reg.execute('cancel_order', { orderNumber: 'TEST-1210' }, { ...base, customerText: 'annulez TEST-1210', customerHistory: 'annulez TEST-1210', orderHistory: C6 })).toMatchObject({ ok: true, alreadyCancelled: 'TEST-1210' });
    expect(await reg.execute('cancel_order', {}, { ...base, customerText: 'annulez la commande', customerHistory: 'annulez la commande', orderHistory: C6 })).toMatchObject({ ok: true, alreadyCancelled: 'TEST-1210' });
    const open: OrderCallHistory = [{ name: 'create_order', at: at(1), result: { ok: true, simulated: true, number: 'TEST-1525', total: 10_450 } }];
    expect(await reg.execute('cancel_order', {}, { ...base, customerText: "annulez la commande s'il vous plaît", customerHistory: "annulez la commande s'il vous plaît", orderHistory: open })).toEqual({ ok: true, cancelled: 'TEST-1525', simulated: true });
    // a question is never a cancellation
    expect(await reg.execute('cancel_order', {}, { ...base, customerText: 'je peux annuler ?', customerHistory: 'je peux annuler ?', orderHistory: open })).toMatchObject({ ok: true, candidates: [{ number: 'TEST-1525' }] });
  });
});

describe('J04r-4 — an MSA customer gets MSA wording', () => {
  const C4 = ['مرحباً، ما هي طرق الدفع المتاحة؟', 'هل يمكنني إرجاع المنتج إذا لم يناسبني؟', 'أريد عباية مطرزة واحدة، كم سعرها؟'];
  it('msaRegister: MSA words and no darija word', () => {
    expect(msaRegister(C4.join('\n'))).toBe(true);
    expect(msaRegister('السلام عليكم، بشحال الجلابة؟\nنحب وحدة')).toBe(false);
    expect(msaRegister('هل عندكم جلابة؟ واش كاين التوصيل')).toBe(false);
    expect(msaRegister('Bonjour, vous avez des robes ?')).toBe(false);
  });
  it('the server recap and questions in MSA words; no darija word left', () => {
    expect(withMsaWording('جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو.')).toBe('أجبني بـ « نعم » لتأكيد الطلب، أو أخبرني بما يجب تغييره.');
    expect(withMsaWording('واش سميتك ؟')).toBe('ما اسمك؟');
    expect(withMsaWording('إيه، يمكنك استبدال المنتج خلال 7 أيام.')).toBe('نعم، يمكنك استبدال المنتج خلال 7 أيام.');
    expect(withMsaWording('التوصيل للدار (وهران): 600 دج')).toBe('التوصيل إلى المنزل (وهران): 600 دج');
    const out = withMsaWording('تقدر تتوصل للبيت لوهران بـ 600 دج. واش سميتك ؟');
    for (const w of ['واش', 'تقدر', 'سميتك']) expect(out).not.toContain(w);
  });
});

describe('J04r-3 — a beyond-stock product asked in Arabic script: its name and price before the name question', () => {
  const MONTRE = { id: '01a1ef58-ebc8-734f-94a0-459be330eb7d', name: 'Montre connectée', price: 15_900, hasVariants: false, variants: [], stock: 0, sellOutOfStock: true };
  const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
  const routing = {
    call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }),
    route: async () => ({ capability: 'text', primary: model, fallback: null, failoverActive: false }),
  };
  it('P3 T1 reproduction: the search found the Montre ⇒ « … 15 900 دج … واش سميتك ؟ »', async () => {
    const said = 'عندكم الساعة الذكية؟ نحب نطلبها';
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'search_products', args: { query: 'Montre connectée', limit: 3 } }] }, { reply: 'التوصيل ممكن يطول شوية. واش سميتك ؟', intent: 'SALE' });
    const execute = jest.fn(async (name: string) => (name === 'search_products' ? { products: [{ id: MONTRE.id, name: MONTRE.name, price: MONTRE.price, stock: 'orderable (delivery may take longer)' }] } : {}));
    const tools = { defsFor: async () => [TOOL_DEFS.search_products], execute, forcedHandoff: () => null, soldProductNamed: async () => null } as unknown as ToolRegistry;
    const guard = buildGuardFacts({ lang: 'ar', products: [{ ...MONTRE, sku: 'S', oldPrice: null, also: [], description: null, imageUrl: null }] as never, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText: said, answeredBefore: false, freshStart: true });
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: said }] } as never, toolCtx: { workspaceId: 'w', agent: { maxQtyPerOrder: 5 } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText: said, customerHistory: said, orderHistory: [], ordering: false }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard };
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
    if (!r.ok) throw new Error('turn failed');
    const reply = r.output.reply.replace(/[^\S\n]/gu, ' ');
    expect(reply).toContain('15 900');
    expect(reply).toContain('Montre connectée');
    expect(reply.indexOf('15 900')).toBeLessThan(reply.indexOf('واش سميتك'));
  });
});
