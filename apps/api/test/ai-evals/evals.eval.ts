// 04-ai-pipeline §15 / 07-non-functional §9 — the eval runner (`pnpm test:evals`).
//
// It replays the fixture conversations of `fixtures/{darija,arabizi,fr,en,mixed,vision,voice}/*.json` through the real
// turn of the pipeline (prompt assembly → model loop with tools → structured output → cards), as dry runs on a seeded
// catalogue: nothing is sent, no order is written, no credit is charged. One line per case: PASS / FAIL, tool sequence,
// latency, tokens, cost. Thresholds: 95 % per fixture group, language respect 100 %.
//
// DRIVER
//   EVAL_DRIVER=fake (default, CI) — the deterministic fake adapter. In this mode the suite is a REGRESSION TEST OF THE
//     PLUMBING (routing, prompt sections, tool schemas and execution, replay bookkeeping, parsing, language detection,
//     scope filtering). It says NOTHING about model quality: the fake "model" is a keyword table.
//   EVAL_DRIVER=live — the real providers through the Vercel AI SDK (needs AI_ALLOW_LIVE=true and provider keys in the
//     environment or in `AiProvider`; costs money; never run in CI without intent). Only then do the pass rates measure
//     the prompts and the models. Vision / voice fixtures use self-describing fake media and are skipped in live mode
//     until real photos and recordings are added next to them (`imageFile` / `audioFile`).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PlaygroundTurnDto, PlaygroundTurnInput } from '@djaber/shared';
import { TenantContext } from '@djaber/db';
import { StorageService } from '../../src/core/storage/storage.service';
import { TenantResolver } from '../../src/core/tenancy/tenant.resolver';
import { detectLanguage } from '../../src/modules/ai/language';
import { PlaygroundService } from '../../src/modules/ai/playground.service';
import { AI_GATEWAY, type AiGateway } from '../../src/modules/ai/provider/ai.gateway';
import { asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { forbidNetwork } from '../support/m3';
import { closeOutbox, db, feeRule, linkedAgent } from '../support/m4';

type FixtureMessage = { role: 'user' | 'assistant'; text: string; image?: string; audio?: string };
type Fixture = {
  messages: FixtureMessage[];
  expect: { status: string; intent?: string; language?: string; toolCalls?: string[]; cards?: string[]; replyContains?: string[]; noPriceInReply?: boolean; creditsInProd?: number; noProductOutsideCatalogue?: boolean; orderCreated?: boolean };
};
type Result = { group: string; name: string; pass: boolean; languageOk: boolean; failures: string[]; turn: PlaygroundTurnDto | null; costUsd: number };

const DRIVER = process.env.EVAL_DRIVER === 'live' ? 'live' : 'fake';
const ROOT = join(__dirname, 'fixtures');
const GROUPS = ['darija', 'arabizi', 'fr', 'en', 'mixed', 'vision', 'voice'];
const PASS_THRESHOLD = 0.95;
/** An amount in DA as the customer reads it: digit groups separated by a space, U+00A0 or U+202F (`formatMoney`). */
const AMOUNT = /(\d(?:[\d \u00A0\u202F]*\d)?)\s*(DA|دج)/g;
/** « 6 200 » ⇒ « 6200 » (any space between two digits), so a fixture writes amounts without separators. */
const joinDigits = (text: string) => text.replace(/(\d)[ \u00A0\u202F](?=\d)/g, '$1');
const fixtures = GROUPS.flatMap((group) =>
  readdirSync(join(ROOT, group))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ group, name: file.replace(/\.json$/, ''), fixture: JSON.parse(readFileSync(join(ROOT, group, file), 'utf8')) as Fixture })),
);

let app: TestApp;
let net: ReturnType<typeof forbidNetwork> | null = null;
let workspaceId: string;
let agentId: string;
let userId: string;
const skuToId = new Map<string, string>();
const idToSku = new Map<string, string>();
const catalogueNumbers = new Set<string>();
const results: Result[] = [];

const upload = async (bytes: Buffer, mime: string) => {
  const key = `ws/${workspaceId}/evals/${randomUUID()}`;
  const stored = await app.app.get(StorageService).put(key, bytes, mime);
  return (await db.upload.create({ data: { workspaceId, storageKey: key, url: stored.url, mime, size: bytes.length, kind: 'reply', createdById: userId } })).id;
};

beforeAll(async () => {
  app = await createTestApp();
  const gateway = app.app.get<AiGateway>(AI_GATEWAY);
  if (gateway.driver !== DRIVER) throw new Error(`EVAL_DRIVER=${DRIVER} but the application runs the ${gateway.driver} adapter (set AI_DRIVER / AI_ALLOW_LIVE accordingly)`);
  // with the fake adapter nothing may leave the process
  if (DRIVER === 'fake') net = forbidNetwork();
  const owner = await asOwner(app);
  workspaceId = owner.workspaceId;
  userId = owner.userId;
  const robes = await db.category.create({ data: { workspaceId, name: 'Robes' } });
  const seed = [
    { sku: 'ROB-001', name: 'Robe satin bordeaux', price: 4500, oldPrice: 5200, stock: 7, categoryId: robes.id, description: 'Robe longue en satin, coupe droite, tailles S à XL.', keywords: ['روب', 'ساتان', 'dress', 'robe'] },
    { sku: 'SAC-002', name: 'Sac cuir noir', price: 6200, stock: 3, description: 'Sac à main en cuir véritable.', keywords: ['ساك', 'الجلد', 'bag', 'leather'] },
    { sku: 'ENS-003', name: 'Ensemble sport gris', price: 3900, stock: 0, description: 'Ensemble jogging coton.', keywords: ['survêtement'] },
    { sku: 'MON-004', name: 'Montre classique dorée', price: 12000, stock: 2, description: 'Montre analogique, bracelet métal.', keywords: ['ساعة', 'watch'] },
  ];
  for (const p of seed) {
    const row = await db.product.create({ data: { workspaceId, ...p } });
    skuToId.set(p.sku, row.id);
    idToSku.set(row.id, p.sku);
    for (const n of [p.price, p.oldPrice]) if (n) catalogueNumbers.add(String(n));
  }
  await feeRule(workspaceId, 16, 400, 300);
  await feeRule(workspaceId, 31, 700, 450);
  for (const n of [400, 300, 700, 450]) catalogueNumbers.add(String(n));
  const agent = await linkedAgent(workspaceId, [], { name: 'Agent évaluation', policies: { delivery: 'Livraison 58 wilayas en 2 à 5 jours', payment: 'Paiement à la livraison', returns: 'Échange sous 7 jours' } } as never);
  agentId = agent.id;
  await db.agentFaq.create({ data: { workspaceId, agentId, question: 'Livrez-vous le vendredi ?', answer: 'Non, du samedi au jeudi.' } });
});

afterAll(async () => {
  const line = (r: Result) =>
    `${r.pass ? 'PASS' : 'FAIL'}  ${`${r.group}/${r.name}`.padEnd(40)} ${String(r.turn?.status ?? '-').padEnd(8)} ${(r.turn?.toolCalls.map((t) => t.name).join('>') || '-').padEnd(18)} ${String(r.turn?.latencyMs ?? '-').padStart(5)} ms  ${String(r.turn ? r.turn.tokens.input + r.turn.tokens.output : '-').padStart(6)} tok  $${r.costUsd.toFixed(5)}${r.failures.length ? `  ← ${r.failures.join('; ')}` : ''}`;
  const groups = GROUPS.map((g) => {
    const rows = results.filter((r) => r.group === g);
    return { group: g, total: rows.length, passed: rows.filter((r) => r.pass).length };
  }).filter((g) => g.total);
  const language = results.filter((r) => r.turn);
  const report = [
    '',
    `AI evals — driver: ${DRIVER}${DRIVER === 'fake' ? ' (pipeline regression; NOT a measure of model quality)' : ''}`,
    ...results.map(line),
    '',
    ...groups.map((g) => `${g.group.padEnd(10)} ${g.passed}/${g.total}  ${((g.passed / g.total) * 100).toFixed(0)} %  ${g.passed / g.total >= PASS_THRESHOLD ? 'ok' : 'BELOW 95 %'}`),
    `language   ${language.filter((r) => r.languageOk).length}/${language.length} (must be 100 %)`,
    `total      ${results.filter((r) => r.pass).length}/${results.length} passed · cost $${results.reduce((n, r) => n + r.costUsd, 0).toFixed(4)} · p95 latency ${[...results.map((r) => r.turn?.latencyMs ?? 0)].sort((a, b) => a - b)[Math.max(0, Math.ceil(results.length * 0.95) - 1)] ?? 0} ms`,
    '',
  ];
  process.stdout.write(`${report.join('\n')}\n`);
  if (net) {
    expect(net.spy).not.toHaveBeenCalled();
    net.restore();
  }
  await closeOutbox();
  await app.close();
});

describe(`AI evals (${DRIVER})`, () => {
  it.each(fixtures.map((f) => [`${f.group}/${f.name}`, f] as const))('%s', async (_id, f) => {
    const { expect: want, messages } = f.fixture;
    const media = messages.some((m) => m.image || m.audio);
    // self-describing fake media mean nothing to a real model
    if (DRIVER === 'live' && media) return;
    const input: PlaygroundTurnInput['messages'] = [];
    for (const m of messages) {
      input.push({
        role: m.role,
        text: m.text,
        ...(m.image ? { imageUploadId: await upload(Buffer.from(m.image, 'utf8'), 'image/jpeg') } : {}),
        ...(m.audio ? { audioUploadId: await upload(Buffer.from(m.audio, 'utf8'), 'audio/mpeg') } : {}),
      });
    }
    const failures: string[] = [];
    const result: Result = { group: f.group, name: f.name, pass: false, languageOk: true, failures, turn: null, costUsd: 0 };
    results.push(result);
    const tenant = await app.app.get(TenantResolver).forWorker(workspaceId);
    const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId } });
    const turn = await TenantContext.run({ ...tenant, userId }, () => app.app.get(PlaygroundService).turn(agent, { workspaceId, agentId, userId, sessionId: `eval:${f.group}:${f.name}`, turnId: randomUUID(), messages: input, kind: 'test' }));
    result.turn = turn;
    const run = await db.aiRun.findUniqueOrThrow({ where: { id: turn.turnId } });
    result.costUsd = Number((run.meta as { costUsd?: number } | null)?.costUsd ?? 0);

    const said = messages.at(-1)!.audio ?? messages.at(-1)!.text;
    const tools = turn.toolCalls.map((t) => t.name);
    const cards = turn.cards.map((c) => idToSku.get(c.productId) ?? `UNKNOWN:${c.productId}`);
    if (turn.status !== want.status) failures.push(`status ${turn.status} ≠ ${want.status}`);
    if (want.intent && turn.intent.toUpperCase() !== want.intent) failures.push(`intent ${turn.intent} ≠ ${want.intent}`);
    if (want.toolCalls && JSON.stringify(tools) !== JSON.stringify(want.toolCalls)) failures.push(`tools [${tools}] ≠ [${want.toolCalls}]`);
    if (want.cards && JSON.stringify([...cards].sort()) !== JSON.stringify([...want.cards].sort()) && !(want.cards.length && want.cards.every((c) => cards.includes(c)))) failures.push(`cards [${cards}] ≠ [${want.cards}]`);
    // amounts reach the customer formatted by the server (`formatMoney`: « 6 200 DA », U+00A0 / U+202F between the digit
    // groups, CLAUDE.md rule 11): « 6200 » in a fixture matches « 6 200 »
    for (const s of want.replyContains ?? []) if (!joinDigits(turn.reply).includes(joinDigits(s))) failures.push(`reply misses "${s}"`);
    if (want.creditsInProd !== undefined && turn.creditsInProd !== want.creditsInProd) failures.push(`credits ${turn.creditsInProd} ≠ ${want.creditsInProd}`);
    if (want.noPriceInReply && /\d{3,}\s*(DA|دج)/.test(turn.reply)) failures.push('a price was stated for an unconfirmed product');
    // grounding: only catalogue products in the cards, only catalogue prices / grid fees in the text
    if (want.noProductOutsideCatalogue) {
      if (cards.some((c) => c.startsWith('UNKNOWN:'))) failures.push('a card points outside the catalogue');
      const prices = [...turn.reply.matchAll(AMOUNT)].map((m) => m[1]!.replace(/\s/g, '')).filter((p) => p.length >= 3);
      const invented = prices.filter((p) => !catalogueNumbers.has(p));
      if (invented.length) failures.push(`invented amount ${invented.join(', ')}`);
    }
    const created = turn.toolCalls.some((t) => t.name === 'create_order' && (t.result as { ok?: boolean } | null)?.ok === true);
    if (want.orderCreated !== undefined && created !== want.orderCreated) failures.push(`orderCreated ${created} ≠ ${want.orderCreated}`);
    // language respect (AI-01): the script of the reply follows the customer, and the declared language is the detected one
    const customer = detectLanguage(said);
    if (customer && turn.reply.trim()) {
      const arabicReply = /[؀-ۿ]/.test(turn.reply);
      if (customer === 'ar' && !arabicReply) result.languageOk = false;
      if ((customer === 'fr' || customer === 'en' || customer === 'arabizi') && arabicReply) result.languageOk = false;
    }
    if (want.language && turn.language !== want.language) result.languageOk = false;
    if (!result.languageOk) failures.push(`language not respected (customer ${customer ?? '?'}, reply declared ${turn.language})`);
    result.pass = failures.length === 0;
    if (DRIVER === 'fake') expect(failures).toEqual([]);
  });

  it('thresholds: ≥ 95 % per fixture group, language respect 100 %', () => {
    const ran = results.filter((r) => r.turn);
    expect(ran.length).toBeGreaterThan(0);
    for (const g of GROUPS) {
      const rows = ran.filter((r) => r.group === g);
      if (!rows.length) continue;
      expect([g, rows.filter((r) => r.pass).length / rows.length >= PASS_THRESHOLD]).toEqual([g, true]);
    }
    expect(ran.filter((r) => !r.languageOk).map((r) => `${r.group}/${r.name}`)).toEqual([]);
  });
});
