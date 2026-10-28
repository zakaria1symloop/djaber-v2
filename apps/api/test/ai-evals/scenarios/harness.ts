// Live chatbot scenarios — the harness. A realistic shop (variants, stock-outs, products and variants waiting for
// moderation, inactive and rejected products, delivery grid with a wilaya not served, policies, FAQ, cross-sell) and
// customers who write to its Facebook page: every message goes through the real path (signed webhook → intake →
// batching → `ai-reply` with the REAL model and tools → orders → outbox → fake Meta send). Only the AI is real.
// Each scenario is written to a Markdown transcript (SCENARIO_OUT, default `.local/ai-scenarios/`) with its automatic
// checks; the transcripts are meant to be read by a person too.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rawPrisma as db } from '@djaber/db';
import { RoutingService } from '../../../src/modules/ai/routing.service';
import { asOwner, type Actor } from '../../support/actors';
import { createTestApp, type TestApp } from '../../support/app';
import { connectedPage, newSender, receive } from '../../support/m3';
import { answer, closeOutbox, feeRule, linkedAgent, setCredits } from '../../support/m4';

export const MODEL = process.env.EVAL_MODEL || 'claude-haiku-4-5';
const SIM_MODEL = process.env.EVAL_SIM_MODEL || 'claude-haiku-4-5';
const OUT = resolve(process.env.SCENARIO_OUT || resolve(__dirname, '../../../../../.local/ai-scenarios'));
const RUN = process.env.SCENARIO_RUN || new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

// --- network: only the AI provider may be reached ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
/** An Anthropic key that is not scoped to a workspace needs `anthropic-workspace-id` on every call (ANTHROPIC_WORKSPACE_ID). */
const withWorkspace = (url: string, init?: RequestInit): RequestInit | undefined => {
  const ws = process.env.ANTHROPIC_WORKSPACE_ID;
  if (!ws || !url.startsWith('https://api.anthropic.com/')) return init;
  const headers = new Headers(init?.headers);
  headers.set('anthropic-workspace-id', ws);
  return { ...init, headers };
};
const ALLOWED = ['https://api.anthropic.com/', 'https://api.openai.com/', 'https://generativelanguage.googleapis.com/', 'https://api.groq.com/'];
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as { url?: string }).url ?? input);
  if (!ALLOWED.some((a) => url.startsWith(a))) throw new Error(`[scenarios] network call refused: ${url.slice(0, 80)}`);
  return realFetch(input as never, withWorkspace(url, init as RequestInit | undefined) as never);
}) as typeof fetch;

// --- the shop -----------------------------------------------------------------------------------------------------------------
export type Shop = {
  app: TestApp;
  owner: Actor;
  page: Awaited<ReturnType<typeof connectedPage>>;
  agentId: string;
  p: Record<string, { id: string; name: string; v: Record<string, string> }>;
  /** Amounts a reply may state (prices, old prices, fees, free-delivery threshold); totals come from tool results. */
  known: Set<number>;
  /** Prices that exist only on hidden products / variants: never in a reply. */
  hiddenPrices: number[];
};

/** The Vendeur Pro preset (packages/db/seeds/ai.ts), as the wizard compiles it into the agent's instructions. */
const VENDEUR_PRO_FR = [
  "- Accueille chaleureusement le client et réponds d'abord à sa question (prix, disponibilité, livraison).",
  '- Mets en avant un avantage concret du produit, puis propose de passer commande.',
  "- Quand le client hésite, propose l'article le plus proche du catalogue ou une taille / couleur disponible.",
  '- Pour commander, demande une information à la fois : produit et variante, quantité, nom, téléphone, wilaya, commune, adresse ou point relais.',
  '- Récapitule toujours la commande (articles, livraison, total) et attends la confirmation avant de la créer.',
  "- Reste bref : 2 à 4 phrases par message, sans pression et sans promesse que la boutique n'a pas faite.",
].join('\n');

export const openShop = async (agentOver: Record<string, unknown> = {}): Promise<Shop> => {
  const app = await createTestApp();
  // the route of the run: the model under test, no fallback (a failure must show, not hide behind another model)
  const provider = await db.aiProvider.update({ where: { key: 'anthropic' }, data: { isActive: true } });
  const model = (await db.aiModel.findFirst({ where: { providerId: provider.id, modelId: MODEL } })) ?? (await db.aiModel.create({ data: { providerId: provider.id, modelId: MODEL, displayName: MODEL, capabilities: ['text', 'vision'], supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, contextTokens: 200_000 } }));
  await db.aiModel.update({ where: { id: model.id }, data: { isActive: true, timeoutSec: 60 } });
  for (const capability of ['text', 'vision'] as const) await db.aiRoute.update({ where: { capability }, data: { primaryModelId: model.id, fallbackModelId: null, timeoutSec: 60 } });
  await app.app.get(RoutingService).resetBreaker(model.id);

  const owner = await asOwner(app);
  const ws = owner.workspaceId;
  await db.workspace.update({ where: { id: ws }, data: { name: 'Lina Fashion', freeDeliveryThreshold: 20_000 } });
  const page = await connectedPage(owner, app);
  const robes = await db.category.create({ data: { workspaceId: ws, name: 'Robes' } });
  const sport = await db.category.create({ data: { workspaceId: ws, name: 'Sport' } });
  const acc = await db.category.create({ data: { workspaceId: ws, name: 'Accessoires' } });

  const p: Shop['p'] = {};
  let sku = 0;
  const product = async (key: string, data: Record<string, unknown>, variants: { name: string; price: number; stock: number }[] = []) => {
    const row = await db.product.create({ data: { workspaceId: ws, sku: `LF-${String(++sku).padStart(3, '0')}`, hasVariants: variants.length > 0, ...(variants.length ? { stock: variants.reduce((n, v) => n + v.stock, 0) } : {}), ...data } as never });
    const v: Record<string, string> = {};
    for (const x of variants) v[x.name] = (await db.productVariant.create({ data: { workspaceId: ws, productId: row.id, name: x.name, price: x.price, stock: x.stock, sku: `${row.sku}-${x.name}` } })).id;
    p[key] = { id: row.id, name: row.name, v };
    return row;
  };
  await product('robe', { name: 'Robe satin bordeaux', price: 4500, oldPrice: 5200, stock: 7, categoryId: robes.id, description: 'Robe longue en satin, coupe droite, doublée. Tailles S à XL (taille unique ajustable à la ceinture).', keywords: ['robe', 'satin', 'روب', 'ساتان', 'dress'] });
  await product('jogging', { name: 'Ensemble jogging', price: 3900, categoryId: sport.id, description: 'Ensemble sweat + pantalon en coton molletonné, gris chiné.', keywords: ['jogging', 'survêtement', 'survet', 'ensemble', 'تريكو'] }, [
    { name: 'S', price: 3900, stock: 4 },
    { name: 'M', price: 3900, stock: 0 },
    { name: 'L', price: 4200, stock: 2 },
    { name: 'XL', price: 4200, stock: 1 },
  ]);
  // the basket was approved with the sizes 40–43; the size 44 was added afterwards and waits for the review (D36)
  const basket = await product('basket', { name: 'Basket Runner blanche', price: 7500, categoryId: sport.id, description: 'Basket de course légère, semelle amortissante, blanche.', keywords: ['basket', 'sneakers', 'chaussure', 'سبادري', 'espadrille'] }, [
    { name: '40', price: 7500, stock: 3 },
    { name: '41', price: 7500, stock: 5 },
    { name: '42', price: 7500, stock: 0 },
    { name: '43', price: 7800, stock: 2 },
  ]);
  const approvedVariants = await db.productVariant.findMany({ where: { productId: basket.id }, select: { id: true, name: true, price: true } });
  p.basket!.v['44'] = (await db.productVariant.create({ data: { workspaceId: ws, productId: basket.id, name: '44', price: 7900, stock: 6, sku: `${basket.sku}-44` } })).id;
  await db.product.update({ where: { id: basket.id }, data: { moderationStatus: 'pending', approvedSnapshot: { title: basket.name, description: basket.description, price: basket.price, categoryId: sport.id, images: [], variants: approvedVariants } } });
  await product('sac', { name: 'Sac cuir noir', price: 6200, stock: 3, categoryId: acc.id, description: 'Sac à main en cuir véritable, bandoulière amovible.', keywords: ['sac', 'cuir', 'ساك', 'bag'] });
  await product('montre', { name: 'Montre classique dorée', price: 12_000, stock: 10, categoryId: acc.id, description: 'Montre analogique, bracelet métal doré, garantie 6 mois.', keywords: ['montre', 'ساعة', 'watch'] });
  await product('echarpe', { name: 'Écharpe laine grise', price: 1800, stock: 0, categoryId: acc.id, description: 'Écharpe en laine douce.', keywords: ['écharpe', 'echarpe', 'cache-cou'] });
  await product('hijab', { name: 'Hijab soie', price: 1500, stock: 0, sellOutOfStock: true, categoryId: acc.id, description: 'Hijab en soie, plusieurs coloris sur commande.', keywords: ['hijab', 'voile', 'خمار', 'حجاب'] });
  // invisible to the AI: pending without an approved version, inactive, rejected
  await product('parfum', { name: 'Parfum Oud Royal', price: 8900, stock: 9, categoryId: acc.id, description: 'Parfum oriental.', keywords: ['parfum', 'oud', 'عطر'], moderationStatus: 'pending' });
  await product('ancienne', { name: 'Robe fleurie été', price: 3300, stock: 4, categoryId: robes.id, isActive: false, keywords: ['robe', 'fleurie'] });
  await product('couteau', { name: 'Couteau de chasse', price: 2700, stock: 5, categoryId: acc.id, moderationStatus: 'rejected', keywords: ['couteau'] });
  await db.recommendation.create({ data: { workspaceId: ws, productId: p.robe!.id, recommendedId: p.sac!.id, type: 'cross_sell', reason: 'assorti à la robe pour une soirée' } });

  // delivery grid: Alger, Oran, Blida, Sétif (home only), Constantine; Tamanrasset (11) is not served
  await feeRule(ws, 16, 400, 300);
  await feeRule(ws, 31, 700, 450);
  await feeRule(ws, 9, 500, 350);
  await feeRule(ws, 19, 650, 0);
  await feeRule(ws, 25, 600, 400);

  const agent = await linkedAgent(ws, [page.id], {
    name: 'Lina',
    customInstructions: VENDEUR_PRO_FR,
    policies: { delivery: 'Livraison dans 58 wilayas en 2 à 5 jours ouvrables.', payment: 'Paiement à la livraison uniquement.', returns: "Échange sous 7 jours si l'article n'a pas été porté. Pas de remboursement.", hours: 'Samedi au jeudi, 9h–19h.' },
    ...agentOver,
  } as never);
  await db.agentFaq.create({ data: { workspaceId: ws, agentId: agent.id, question: 'Livrez-vous le vendredi ?', answer: 'Non, les livraisons se font du samedi au jeudi.' } });
  await db.agentFaq.create({ data: { workspaceId: ws, agentId: agent.id, question: 'Les robes taillent-elles grand ?', answer: 'Non, elles taillent normalement : prenez votre taille habituelle.' } });
  await setCredits(app, ws, 5000);

  const known = new Set([4500, 5200, 3900, 4200, 7500, 7800, 6200, 12_000, 1800, 1500, 400, 300, 700, 450, 500, 350, 650, 600, 20_000]);
  return { app, owner, page, agentId: agent.id, p, known, hiddenPrices: [7900, 8900, 3300, 2700] };
};

export const closeShop = async (s: Shop) => {
  await closeOutbox();
  await s.app.close();
};

// --- a conversation --------------------------------------------------------------------------------------------------------
export type BotMessage = { author: string; type: string; text: string; cards: string[] };
export type ToolUse = { name: string; args: unknown; result: unknown };
export type Turn = { customer: string; outcome: string | null; bot: BotMessage[]; tools: ToolUse[]; runs: { status: string; intent: string | null; error: string | null; language?: string; handoff?: boolean; costUsd: number; latencyMs: number | null }[] };
export type OrderView = { number: string; status: string; total: number; subtotal: number; deliveryFee: number; wilayaId: number | null; isStopdesk: boolean; clientName: string; clientPhone: string; address: string | null; communeText: string | null; items: { name: string; variantName: string | null; quantity: number; unitPrice: number }[] };
export type Result = { turns: Turn[]; orders: OrderView[]; conversationStatus: string; aiPaused: boolean; botText: string; aiText: string; tools: string[]; lastAi: string };

export class Chat {
  readonly sender: string;
  conversationId: string | null = null;
  readonly turns: Turn[] = [];
  constructor(
    private readonly shop: Shop,
    sender?: string,
  ) {
    this.sender = sender ?? newSender();
  }

  say(text: string): Promise<Turn> {
    return this.send([{ text }], text);
  }

  /** Several Messenger messages (text, photo, voice note) received before the batching window closes, answered once. */
  async send(messages: Record<string, unknown>[], label: string): Promise<Turn> {
    const s = this.shop;
    const t0 = new Date();
    let first: Date | null = null;
    let conversationId = '';
    for (const m of messages) {
      const { conversation, message } = await receive(s.app, s.page, this.sender, m);
      conversationId = conversation.id;
      first ??= message?.createdAt ?? t0;
    }
    this.conversationId = conversationId;
    const r = await answer(s.app, s.owner.workspaceId, conversationId);
    const out = await db.message.findMany({ where: { conversationId, direction: 'out', createdAt: { gte: first ?? t0 } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const runs = await db.aiRun.findMany({ where: { conversationId, startedAt: { gte: t0 } }, orderBy: { startedAt: 'asc' }, include: { toolCalls: { orderBy: { executedAt: 'asc' } } } });
    const turn: Turn = {
      customer: label,
      outcome: r?.outcome ?? null,
      bot: out.map((m) => ({ author: m.author, type: m.type, text: m.text ?? '', cards: ((m.payload as { cards?: { name: string }[] } | null)?.cards ?? []).map((c) => c.name) })),
      tools: runs.flatMap((run) => run.toolCalls.map((c) => ({ name: c.name, args: c.args, result: c.result }))),
      runs: runs.map((run) => {
        const meta = (run.meta ?? {}) as { language?: string; handoff?: boolean; costUsd?: number };
        return { status: run.status, intent: run.intent, error: run.error, language: meta.language, handoff: meta.handoff, costUsd: Number(meta.costUsd ?? 0), latencyMs: run.latencyMs ?? null };
      }),
    };
    this.turns.push(turn);
    return turn;
  }

  async result(): Promise<Result> {
    const conv = this.conversationId ? await db.conversation.findUniqueOrThrow({ where: { id: this.conversationId } }) : null;
    const orders = conv?.clientId ? await db.order.findMany({ where: { clientId: conv.clientId }, orderBy: { orderedAt: 'asc' }, include: { items: true } }) : [];
    const ai = this.turns.flatMap((t) => t.bot.filter((b) => b.author === 'ai' && b.type === 'text'));
    return {
      turns: this.turns,
      orders: orders.map((o) => ({ number: o.number, status: o.status, total: o.total, subtotal: o.subtotal, deliveryFee: o.deliveryFee, wilayaId: o.wilayaId, isStopdesk: o.isStopdesk, clientName: o.clientName, clientPhone: o.clientPhone, address: o.address, communeText: o.communeText, items: o.items.map((i) => ({ name: i.productName, variantName: i.variantName, quantity: i.quantity, unitPrice: i.unitPrice })) })),
      conversationStatus: conv?.status ?? '-',
      aiPaused: conv?.aiPaused ?? false,
      botText: this.turns.flatMap((t) => t.bot.map((b) => b.text)).join('\n'),
      aiText: ai.map((b) => b.text).join('\n'),
      tools: this.turns.flatMap((t) => t.tools.map((x) => x.name)),
      lastAi: ai.at(-1)?.text ?? '',
    };
  }
}

// --- the simulated customer (for the long order flows) -----------------------------------------------------------------------
const SIM_RULES = `You play a CUSTOMER writing to an Algerian online shop on Facebook Messenger. Stay in character.
Write ONLY your next message to the shop: short, natural, like a real Messenger message (no quotes, no explanation).
Answer what the shop asks with the information of your persona, one or two pieces at a time, unless the persona says otherwise.
Never invent information that your persona does not give; if the shop asks something your persona does not cover, answer briefly and naturally.
When the shop shows a recap of the order and your persona wants to order, confirm clearly.
When your goal is reached (order confirmed by the shop, or question answered) or the shop handed you to a human, write exactly <END>.`;

export const simulate = async (persona: string, history: { from: 'customer' | 'shop'; text: string }[]): Promise<string | null> => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('[scenarios] the simulated customer needs ANTHROPIC_API_KEY');
  const msgs: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: '(The chat opens. Write your first message to the shop.)' }];
  for (const h of history) {
    const role = h.from === 'customer' ? 'assistant' : 'user';
    const last = msgs[msgs.length - 1]!;
    if (last.role === role) last.content += `\n${h.text}`;
    else msgs.push({ role, content: h.text || '(no answer)' });
  }
  if (msgs[msgs.length - 1]!.role === 'assistant') msgs.push({ role: 'user', content: '(no answer from the shop yet)' });
  const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: SIM_MODEL, max_tokens: 300, temperature: 0.7, system: `${SIM_RULES}\n\nYOUR PERSONA AND GOAL:\n${persona}`, messages: msgs }),
  });
  if (!res.ok) throw new Error(`[scenarios] customer simulator: HTTP ${res.status}`);
  const body = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = body.content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  return !text || text.includes('<END>') ? null : text;
};

/** Lets the simulated customer talk until it ends (or `max` messages). */
export const converse = async (chat: Chat, persona: string, max = 12) => {
  if (process.env.SCENARIO_DRIVER === 'fake') return;
  const history: { from: 'customer' | 'shop'; text: string }[] = chat.turns.flatMap((t) => [{ from: 'customer' as const, text: t.customer }, ...t.bot.filter((b) => b.text).map((b) => ({ from: 'shop' as const, text: b.text }))]);
  for (let i = 0; i < max; i++) {
    const next = await simulate(persona, history);
    if (!next) return;
    const turn = await chat.say(next);
    history.push({ from: 'customer', text: next }, ...turn.bot.filter((b) => b.text).map((b) => ({ from: 'shop' as const, text: b.text })));
    // nobody answers any more: the conversation is with the team
    if (!turn.bot.length && turn.outcome?.startsWith('skipped')) return;
  }
};

// --- checks ------------------------------------------------------------------------------------------------------------------
export const amounts = (text: string) => [...text.matchAll(/(\d[\d  .]{1,9}\d|\d{3,})\s*(?:DA|دج|DZD|dinars?)/gi)].map((m) => Number(m[1]!.replace(/[  .]/g, '')));
const arabic = (t: string) => /[؀-ۿ]/.test(t);

/** Checks every scenario gets: no AI failure, no hidden price, script of the reply = script of the customer. */
export const baseChecks = (s: Shop, r: Result, lang?: 'ar' | 'latin'): string[] => {
  const f: string[] = [];
  // ok / unclear / unknown / handoff are answers; error (or a run left running) is a failure
  for (const t of r.turns) for (const run of t.runs) if (run.status === 'error' || run.status === 'running') f.push(`AI run ${run.status}${run.error ? ` (${run.error})` : ''} on « ${t.customer.slice(0, 40)} »`);
  for (const t of r.turns) if (t.outcome && !['sent', 'noop', 'empty'].includes(t.outcome) && !t.outcome.startsWith('skipped')) f.push(`reply outcome ${t.outcome} on « ${t.customer.slice(0, 40)} »`);
  for (const n of s.hiddenPrices) if (amounts(r.botText).includes(n)) f.push(`hidden price ${n} DA stated`);
  if (lang)
    for (const t of r.turns)
      for (const b of t.bot.filter((x) => x.author === 'ai' && x.type === 'text' && x.text.trim())) {
        if (lang === 'ar' && !arabic(b.text)) f.push(`reply not in Arabic script: « ${b.text.slice(0, 60)} »`);
        if (lang === 'latin' && arabic(b.text)) f.push(`reply in Arabic script to a Latin-script customer: « ${b.text.slice(0, 60)} »`);
      }
  return f;
};

/** Amounts of the replies that are neither a catalogue / grid amount nor a total returned by a tool: to be read by a person. */
export const unexplainedAmounts = (s: Shop, r: Result): number[] => {
  const ok = new Set(s.known);
  for (const t of r.turns)
    for (const x of t.tools) {
      const res = (x.result ?? {}) as Record<string, unknown>;
      for (const k of ['subtotal', 'deliveryFee', 'total', 'fee', 'stopdeskFee', 'freeFrom']) if (typeof res[k] === 'number') ok.add(res[k] as number);
    }
  for (const o of r.orders) [o.total, o.subtotal, o.deliveryFee, ...o.items.map((i) => i.unitPrice * i.quantity)].forEach((n) => ok.add(n));
  return [...new Set(amounts(r.aiText))].filter((n) => !ok.has(n));
};

export const said = (r: Result, re: RegExp, what: string) => (re.test(r.aiText) ? [] : [`the bot never said ${what}`]);
export const never = (r: Result, re: RegExp, what: string) => (re.test(r.aiText) ? [`the bot said ${what}`] : []);
export const noOrder = (r: Result) => (r.orders.length ? [`unexpected order(s): ${r.orders.map((o) => `${o.number} ${o.items.map((i) => `${i.quantity}× ${i.name} ${i.variantName ?? ''}`).join(' + ')}`).join(' | ')}`] : []);
export const cardsOf = (r: Result) => r.turns.flatMap((t) => t.bot.flatMap((b) => b.cards));
export const handedOff = (r: Result) => r.conversationStatus === 'needs_human' || r.turns.some((t) => t.runs.some((x) => x.handoff || x.status === 'handoff'));
export const usedTool = (r: Result, name: string) => (r.tools.includes(name) ? [] : [`tool ${name} never called`]);

type WantOrder = { items: [product: string, variant: string | null, quantity: number][]; fee: number; total: number; wilayaId: number; stopdesk?: boolean; phone?: string; status?: string };
/** The (only, or `index`-th) order of the customer matches the expected one. */
export const expectOrder = (r: Result, want: WantOrder, o: { count?: number; index?: number } = {}): string[] => {
  const f: string[] = [];
  const count = o.count ?? 1;
  if (r.orders.length !== count) f.push(`${r.orders.length} order(s) instead of ${count}`);
  const order = r.orders.at(o.index ?? -1);
  if (!order) return f.length ? f : ['no order'];
  const items = order.items.map((i) => `${i.name}|${i.variantName ?? ''}|${i.quantity}`).sort();
  const expected = want.items.map(([n, v, q]) => `${n}|${v ?? ''}|${q}`).sort();
  if (JSON.stringify(items) !== JSON.stringify(expected)) f.push(`items ${items.join(', ')} ≠ ${expected.join(', ')}`);
  if (order.deliveryFee !== want.fee) f.push(`delivery fee ${order.deliveryFee} ≠ ${want.fee}`);
  if (order.total !== want.total) f.push(`total ${order.total} ≠ ${want.total}`);
  if (order.wilayaId !== want.wilayaId) f.push(`wilaya ${order.wilayaId} ≠ ${want.wilayaId}`);
  if (want.stopdesk !== undefined && order.isStopdesk !== want.stopdesk) f.push(`stop-desk ${order.isStopdesk} ≠ ${want.stopdesk}`);
  if (want.phone && order.clientPhone !== want.phone) f.push(`phone ${order.clientPhone} ≠ ${want.phone}`);
  if (want.status && order.status !== want.status) f.push(`status ${order.status} ≠ ${want.status}`);
  return f;
};

// --- the report ---------------------------------------------------------------------------------------------------------------
export type Verdict = { id: string; title: string; pass: boolean; failures: string[]; notes: string[]; costUsd: number; turns: number; ms: number };
const verdicts: Verdict[] = [];

export const report = (group: string, id: string, title: string, r: Result, failures: string[], notes: string[], ms: number) => {
  mkdirSync(OUT, { recursive: true });
  const costUsd = r.turns.reduce((n, t) => n + t.runs.reduce((m, x) => m + x.costUsd, 0), 0);
  const v: Verdict = { id, title, pass: failures.length === 0, failures, notes, costUsd, turns: r.turns.length, ms };
  verdicts.push(v);
  const lines = [`## ${v.pass ? '✅' : '❌'} ${id} — ${title}`, ''];
  for (const t of r.turns) {
    lines.push(`**Client :** ${t.customer.replace(/\n/g, ' / ')}`);
    for (const b of t.bot) {
      const who = b.author === 'ai' ? 'Bot' : b.author === 'system' ? 'Système' : b.author;
      if (b.type === 'product_cards') lines.push(`> _${who} — fiches produit :_ ${b.cards.join(', ')}`);
      else lines.push(`> **${who} :** ${b.text.replace(/\n/g, '\n> ')}`);
    }
    if (t.tools.length) lines.push(`> _outils :_ ${t.tools.map((x) => `${x.name}(${JSON.stringify(x.args).slice(0, 160)}) → ${JSON.stringify(x.result).slice(0, 220)}`).join(' · ')}`);
    if (!t.bot.length) lines.push(`> _(pas de réponse — ${t.outcome ?? 'aucun job'})_`);
    const meta = t.runs.map((x) => `${x.status}/${x.intent ?? '-'}${x.handoff ? '/HANDOFF' : ''} ${x.latencyMs ?? '?'} ms`).join(', ');
    if (meta) lines.push(`> _run :_ ${meta}`);
    lines.push('');
  }
  lines.push(`_Conversation :_ ${r.conversationStatus}${r.aiPaused ? ' (IA en pause)' : ''} · _commandes :_ ${r.orders.length ? r.orders.map((o) => `${o.number} ${o.status} ${o.items.map((i) => `${i.quantity}× ${i.name}${i.variantName ? ` (${i.variantName})` : ''} @${i.unitPrice}`).join(' + ')} + livraison ${o.deliveryFee} = ${o.total} DA · wilaya ${o.wilayaId}${o.isStopdesk ? ' stop-desk' : ''} · ${o.clientName} ${o.clientPhone} · ${o.communeText ?? ''} ${o.address ?? ''}`).join(' | ') : 'aucune'}`);
  if (failures.length) lines.push('', `**Échecs :**`, ...failures.map((x) => `- ${x}`));
  if (notes.length) lines.push('', `_À relire :_`, ...notes.map((x) => `- ${x}`));
  lines.push('', `_coût IA ≈ $${costUsd.toFixed(4)} · ${(ms / 1000).toFixed(0)} s_`, '', '---', '');
  appendFileSync(resolve(OUT, `${RUN}-${group}.md`), `${lines.join('\n')}\n`);
};

export const writeSummary = (group: string) => {
  mkdirSync(OUT, { recursive: true });
  const cost = verdicts.reduce((n, v) => n + v.costUsd, 0);
  const rows = verdicts.map((v) => `| ${v.pass ? '✅' : '❌'} | ${v.id} | ${v.title} | ${v.turns} | ${v.failures.join('<br>') || '—'} |`);
  writeFileSync(resolve(OUT, `${RUN}-${group}.summary.md`), [`# ${group} — ${MODEL}`, '', `${verdicts.filter((v) => v.pass).length}/${verdicts.length} réussis · coût IA ≈ $${cost.toFixed(3)}`, '', '| | id | scénario | tours | échecs |', '|---|---|---|---|---|', ...rows, ''].join('\n'));
  process.stdout.write(`\n[scenarios] ${group}: ${verdicts.filter((v) => v.pass).length}/${verdicts.length} passed · $${cost.toFixed(3)} · ${resolve(OUT, `${RUN}-${group}.md`)}\n`);
};

export type Scenario = {
  id: string;
  title: string;
  lang?: 'ar' | 'latin';
  /** Fixed customer messages, an action of the shop between two messages, or a simulated customer. */
  steps: (string | { act: (s: Shop, chat: Chat) => Promise<void> } | { sim: string; max?: number } | { send: Record<string, unknown>[]; label: string })[];
  /** Reuse the customer of another scenario (returning customer). */
  sender?: () => string;
  check?: (r: Result, s: Shop, chat: Chat) => string[] | Promise<string[]>;
  /** Things the automatic checks cannot judge: written to the report for a person. */
  review?: (r: Result, s: Shop) => string[];
};

/** Runs one scenario; hard failures fail the test, the transcript is always written. */
export const play = async (group: string, s: Shop, sc: Scenario) => {
  const t0 = Date.now();
  const chat = new Chat(s, sc.sender?.());
  let crash: string | null = null;
  try {
    for (const step of sc.steps) {
      if (typeof step === 'string') await chat.say(step);
      else if ('act' in step) await step.act(s, chat);
      else if ('send' in step) await chat.send(step.send, step.label);
      else await converse(chat, step.sim, step.max);
    }
  } catch (e) {
    crash = `crash: ${(e as Error).message}`;
  }
  const r = await chat.result();
  const failures = [...(crash ? [crash] : []), ...baseChecks(s, r, sc.lang), ...((await sc.check?.(r, s, chat)) ?? [])];
  const odd = unexplainedAmounts(s, r);
  const notes = [...(odd.length ? [`montants non expliqués : ${odd.join(', ')} DA`] : []), ...(sc.review?.(r, s) ?? [])];
  report(group, sc.id, sc.title, r, failures, notes, Date.now() - t0);
  return { chat, r, failures };
};
