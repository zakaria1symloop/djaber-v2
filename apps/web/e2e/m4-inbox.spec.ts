// M4 — inbox additions on the REAL API (fake AI provider, fake Meta pages, worker running): UI side of AT-AI-17
// (inspector of one AI turn, `GET /messages/:id/ai-run`), AT-AI-14 (thread state "crédits épuisés"), AT-AI-10 (handoff
// reason on the À TRAITER banner), the IA INDISPONIBLE banner and its priority (12 §23), and the "Insights IA de ce fil"
// dialog (AT-AGT-07 from the thread). Every conversation, AI reply, run, handoff and insight is produced by a real
// customer message (`POST /dev/meta/inbound`, `GET /dev/ai/help`). `page.route` only where the fake drivers cannot
// produce the state over HTTP; each use says why.
import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, expectUrl, type Account } from './support/m1';
import { patchAnswer, type E2eConversation } from './support/m3-inbox';
import { NAV } from './support/m4-agents';
import { signIn } from './support/m4-credits';
import {
  activateAgent,
  conversationOf,
  createAgent,
  idem,
  inject,
  INSIGHT_TRIGGERS,
  insightsOf,
  linkPage,
  messagesOf,
  nextSender,
  patchAgent,
  realGet,
  realPost,
  setCredits,
  setupShop,
  waitAiMessages,
  waitInsights,
  type RealAgent,
  type RealMessage,
  type Shop,
} from './support/m4-real';

test.describe.configure({ mode: 'serial', timeout: 300_000 });
// the shared `next dev` server is slow under load: assertions get 15 s instead of 5
const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

type Conversation = E2eConversation & { handoffReason: string | null; creditsExhausted: boolean; aiUnavailable: boolean };
type AiRun = { status: string; intent: string | null; model: string; provider: string; usedFallback: boolean; tokens: { input: number; output: number }; credits: number; toolCalls: { name: string }[]; error: string | null };

const NAME = `Vendeur inbox ${Date.now().toString(36)}`;
const KEYWORD = 'avocat';
const thread = (page: Page) => page.getByTestId('thread');
const composer = (page: Page) => page.locator('[data-composer-input]');
const banners = (page: Page) => page.locator('[data-banner]');
const bubble = (page: Page, id: string) => thread(page).locator(`[data-message-id="${id}"]`);
const n = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s');
const req = (page: Page) => page.context().request;
/** Opens a thread; the shared `next dev` server recompiles routes after every restart / edit, so attempts get room */
const open = (page: Page, id: string) =>
  expect(async () => {
    await page.goto(`/fr/inbox/${id}`, { timeout: 90_000 });
    // a navigation aborted on the busy dev server can lose the rotated refresh cookie: the app then lands on the
    // sign-in page after loading, and the owner signs in again
    const login = page.locator('#email');
    await expect(thread(page).or(login)).toBeVisible({ timeout: 60_000 });
    if (await login.isVisible()) {
      await signIn(page, owner);
      await page.goto(`/fr/inbox/${id}`, { timeout: 90_000 });
    }
    await expect(thread(page)).toHaveAttribute('data-conversation', id, { timeout: 60_000 });
  }).toPass({ timeout: 240_000 });
const threadMenu = async (page: Page) => {
  await thread(page).getByRole('button', { name: 'Actions', exact: true }).click();
  return page.getByRole('menu');
};
const conversationUrl = (id: string) => new RegExp(`/api/v1/conversations/${id}$`);

let shop: Shop;
let owner: Account;
let agent: RealAgent;
/** one fake customer per state */
const conv: Record<'price' | 'refund' | 'angry' | 'human' | 'keyword' | 'insights' | 'noAgent', Conversation> = {} as never;
let priceText: RealMessage; // the AI text reply of the price question (with its run)
let refundReply: RealMessage; // the AI reply of the refund handoff (run status HANDOFF)

const getConversation = (request: APIRequestContext, id: string) => realGet<Conversation>(request, owner, `/conversations/${id}`);
async function waitStatus(request: APIRequestContext, id: string, status: string) {
  await expect.poll(async () => (await getConversation(request, id)).status, { timeout: 60_000, message: `status of ${id}` }).toBe(status);
  return getConversation(request, id);
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000);
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  shop = await setupShop(request, 'm4inb');
  owner = shop.owner;
  // the agent answers the first Facebook page, with a handoff keyword; the second page has no agent
  const draft = await createAgent(request, owner, { name: NAME });
  await patchAgent(request, owner, draft.id, { wizard: { handoffKeywords: [KEYWORD] } });
  await linkPage(request, owner, shop.facebook.id, draft.id);
  agent = await activateAgent(request, owner, draft.id);

  const says = {
    price: 'chhal le prix de la robe satin ?',
    refund: 'je veux être remboursé',
    angry: "c'est une arnaque",
    human: INSIGHT_TRIGGERS.handoff,
    keyword: `je vais appeler mon ${KEYWORD}`,
    insights: INSIGHT_TRIGGERS.unclear,
  } as const;
  const senders: Record<string, string> = {};
  for (const [key, text] of Object.entries(says)) {
    senders[key] = nextSender();
    await inject(request, owner, { channelId: shop.facebook.id, sender: senders[key]!, text });
  }
  senders.noAgent = nextSender();
  await inject(request, owner, { channelId: shop.facebook2.id, sender: senders.noAgent, text: 'Salam, vous êtes ouverts ?' });
  for (const key of Object.keys(senders)) conv[key as keyof typeof conv] = (await conversationOf(request, owner, senders[key]!)) as Conversation;
  await Promise.all(Object.keys(says).map((key) => waitAiMessages(request, owner, conv[key as keyof typeof conv].id)));

  // the unclear "??" leaves the thread with the agent; an unknown product then sends it to the queue (2 insights)
  await inject(request, owner, { channelId: shop.facebook.id, sender: senders.insights!, text: INSIGHT_TRIGGERS.unknown_topic });
  await waitAiMessages(request, owner, conv.insights.id, 2);
  await waitInsights(request, owner, `?conversationId=${conv.insights.id}`, 2);

  for (const key of ['refund', 'angry', 'human', 'keyword', 'insights'] as const) conv[key] = await waitStatus(request, conv[key].id, 'needs_human');
  const price = await messagesOf(request, owner, conv.price.id);
  priceText = price.find((m) => m.author === 'ai' && m.type === 'text' && m.aiRunId)!;
  refundReply = (await messagesOf(request, owner, conv.refund.id)).find((m) => m.author === 'ai' && m.aiRunId)!;
  expect(priceText, 'AI text reply of the price question').toBeTruthy();
  expect(refundReply, 'AI reply of the refund question').toBeTruthy();
});

test('AT-AI-17 the "IA" tag opens the inspector of the turn: status, intent + confidence, model, tokens, latency, credits, tool call; axe with the inspector open', async ({ page }) => {
  const run = await realGet<AiRun>(req(page), owner, `/messages/${priceText.id}/ai-run`);
  expect(run.toolCalls.map((c) => c.name)).toContain('search_products');
  const asked: string[] = [];
  page.on('request', (r) => {
    const m = /\/api\/v1\/messages\/([^/]+)\/ai-run$/.exec(r.url());
    if (m && r.method() === 'GET') asked.push(m[1]!);
  });
  await signIn(page, owner);
  await open(page, conv.price.id);

  const ai = bubble(page, priceText.id);
  await expect(ai).toContainText(NAME);
  await expect(ai).toContainText(/Robe satin/i);
  // default state of the thread: an active conversation the agent answers, no banner
  await expect(banners(page)).toHaveCount(0);

  const tag = ai.getByTestId('ai-run-open');
  await expect(tag).toHaveText('IA');
  await expect(tag).toHaveAccessibleName('Détail du tour IA');
  await tag.click();
  const dialog = page.getByRole('dialog', { name: 'Détail du tour IA' });
  await expect(dialog).toContainText(`Agent ${NAME}`);
  const panel = dialog.getByTestId('ai-run');
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  expect(asked).toEqual([priceText.id]);

  const rowOf = (key: string) => panel.locator(`[data-testid=inspector] [data-row="${key}"]`);
  await expect(rowOf('status')).toContainText('STATUT');
  await expect(rowOf('status')).toContainText('OK');
  await expect(rowOf('intent')).toContainText(/SALE · confiance 0[,.]9/);
  await expect(rowOf('model')).toContainText(`${run.model} · ${run.provider}`);
  await expect(rowOf('model')).not.toContainText('modèle de secours');
  await expect(rowOf('tokens')).toContainText(new RegExp(`${n(run.tokens.input)} entrée · ${n(run.tokens.output)} sortie`));
  await expect(rowOf('latency')).not.toBeEmpty();
  await expect(rowOf('tools')).toContainText(run.toolCalls.length === 1 ? '1 appel' : `${run.toolCalls.length} appels`);
  await expect(rowOf('credits')).toContainText('1 crédit');
  await expect(rowOf('error')).toHaveCount(0);
  await expect(panel.locator('[data-tool]')).toHaveCount(run.toolCalls.length);
  await expect(panel.locator('[data-tool="search_products"]')).toContainText('robe satin');
  await expectNoA11yViolations(page);

  await dialog.getByRole('button', { name: 'Fermer' }).last().click();
  await expect(dialog).toHaveCount(0);
});

test('AT-AI-17 the message menu opens the same inspector (a handoff turn); a fallback model is flagged; a human reply has no entry', async ({ page }) => {
  const run = await realGet<AiRun>(req(page), owner, `/messages/${refundReply.id}/ai-run`);
  expect([run.status, run.toolCalls.length, run.credits]).toEqual(['handoff', 0, 1]);
  const human = `Réponse de l'équipe ${Date.now().toString(36)}`;
  await realPost(req(page), owner, `/conversations/${conv.refund.id}/messages`, { text: human }, idem());
  await signIn(page, owner);
  await open(page, conv.refund.id);

  // a human reply: no run behind it, no inspector entry and no message menu
  const mine = thread(page).locator('[data-message="human"]').filter({ hasText: human });
  await expect(mine).toBeVisible({ timeout: 30_000 });
  await expect(mine.getByTestId('ai-run-open')).toHaveCount(0);
  await expect(mine.getByRole('button', { name: 'Actions du message' })).toHaveCount(0);

  const ai = bubble(page, refundReply.id);
  await ai.hover();
  await ai.getByRole('button', { name: 'Actions du message' }).click();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Signaler une réponse IA incorrecte' })).toBeVisible();
  await page.getByRole('menu').locator('[data-action=aiRun]').click();
  const panel = page.getByRole('dialog', { name: 'Détail du tour IA' }).getByTestId('ai-run');
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(panel.locator('[data-row="status"]')).toContainText('HANDOFF');
  await expect(panel.locator('[data-row="intent"]')).toContainText('COMPLAINT');
  await expect(panel.locator('[data-row="tools"]')).toContainText('aucun appel');
  await expect(panel.locator('[data-row="credits"]')).toContainText('1 crédit');
  await expect(panel.locator('[data-row="error"]')).toHaveCount(0);
  await expect(panel.locator('[data-tool]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // mock: the fallback model answers only when the primary provider fails, which the fake provider cannot be asked
  // for over HTTP; since M10 the admin can force the text route into failover (`PUT /admin/ai-routes/text`), but that
  // switches every workspace of the shared dev API — the real run is answered with `usedFallback` and the primary's error
  await patchAnswer(page, new RegExp(`/api/v1/messages/${refundReply.id}/ai-run$`), (r: AiRun) => ({ ...r, usedFallback: true, error: 'primary: 500' }));
  await page.reload();
  await expect(thread(page)).toHaveAttribute('data-conversation', conv.refund.id, NAV);
  await bubble(page, refundReply.id).getByTestId('ai-run-open').click();
  await expect(panel).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(panel.locator('[data-row="model"]')).toContainText(`${run.model} · ${run.provider} · modèle de secours`);
  await expect(panel.locator('[data-row="error"]')).toContainText('primary: 500');
});

test('AT-AI-17 a message whose run is not stored (404) shows "Aucun détail pour ce message"', async ({ page }) => {
  const human = (await messagesOf(req(page), owner, conv.refund.id)).find((m) => m.author === 'human')!;
  // the real API answers 404 for a message without run
  const res = await req(page).get(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4010'}/api/v1/messages/${human.id}/ai-run`, { headers: { Authorization: `Bearer ${owner.accessToken}`, 'X-Workspace-Id': owner.workspaceId ?? '' } });
  expect(res.status()).toBe(404);
  // mock: a stored AI message always keeps its run, so the page never offers the inspector on a message without one —
  // the human reply is shown as an AI message carrying a run id, and the page asks the real API, which answers 404
  await patchAnswer(page, new RegExp(`/api/v1/conversations/${conv.refund.id}/messages(\\?.*)?$`), (list: RealMessage[]) =>
    list.map((m) => (m.id === human.id ? { ...m, author: 'ai', authorUser: null, agent: { id: agent.id, name: NAME, status: 'active' }, aiRunId: '00000000-0000-7000-8000-000000000404' } : m)),
  );
  await signIn(page, owner);
  await open(page, conv.refund.id);
  await bubble(page, human.id).getByTestId('ai-run-open').click();
  const dialog = page.getByRole('dialog', { name: 'Détail du tour IA' });
  await expect(dialog.getByTestId('ai-run')).toHaveAttribute('data-state', 'none', { timeout: 30_000 });
  await expect(dialog.getByRole('heading', { name: 'Aucun détail pour ce message' })).toBeVisible();
  await expect(dialog).toContainText('Le tour IA de ce message n’est plus disponible (404).');
  await expect(dialog.getByTestId('inspector')).toHaveCount(0);
});

let exhausted: Conversation;
test('AT-AI-14 credits exhausted: banner "IA arrêtée : crédits épuisés" with "Renouveler", the composer still sends a manual reply', async ({ page }) => {
  const r = req(page);
  await setCredits(r, owner, 0);
  try {
    const sender = nextSender();
    await inject(r, owner, { channelId: shop.facebook.id, sender, text: 'chhal le prix de la robe satin ?' });
    exhausted = (await conversationOf(r, owner, sender)) as Conversation;
    exhausted = await waitStatus(r, exhausted.id, 'needs_human');
    expect([exhausted.creditsExhausted, exhausted.aiUnavailable]).toEqual([true, false]);
  } finally {
    await setCredits(r, owner, 300);
  }
  await signIn(page, owner);
  await open(page, exhausted.id);

  const banner = page.locator('[data-banner="credits"]');
  await expect(banner).toContainText('IA arrêtée : crédits épuisés');
  await expect(banner).toContainText('Répondez manuellement ou renouvelez vos crédits.');
  await expect(banners(page)).toHaveCount(1);
  const renew = page.getByTestId('thread-renew-credits');
  await expect(renew).toHaveText('Renouveler');
  // Owner (`billing.write`): straight to the pack purchase of the credits page (M9)
  await expect(renew).toHaveAttribute('href', '/fr/settings/credits?buy=1');
  // the customer got the fixed "unavailable" text, never an AI answer
  expect((await messagesOf(r, owner, exhausted.id)).filter((m) => m.author === 'ai')).toHaveLength(0);

  // manual replies keep working
  await expect(thread(page).locator('[data-composer="ready"]')).toBeVisible();
  const text = `Réponse manuelle ${Date.now().toString(36)}`;
  await composer(page).fill(text);
  await composer(page).press('Enter');
  const mine = thread(page).locator('[data-message="human"]').filter({ hasText: text });
  await expect(mine).toHaveCount(1);
  await expect(thread(page).locator('[data-message="human"][data-pending]')).toHaveCount(0, { timeout: 15_000 });
  await expect(mine.getByLabel('Envoyé')).toBeVisible({ timeout: 15_000 });

  // the banner stays after the manual reply; its link leads to the pack purchase of the credits page
  await expect(page.locator('[data-banner="credits"]')).toBeVisible();
  // a click on the busy dev server can be lost while the thread re-renders (WS updates): repeated until it navigates
  await expect(async () => {
    if (!/\/fr\/settings\/credits\?buy=1$/.test(page.url())) await page.getByTestId('thread-renew-credits').click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/fr\/settings\/credits\?buy=1$/, { timeout: 30_000 });
  }).toPass({ timeout: 120_000 });
});

test('IA INDISPONIBLE banner (AI_PROVIDER_ERROR) on a handoff; the credits banner wins when both flags are set', async ({ page }) => {
  // mock: `aiUnavailable` is set when the provider fails on the last attempt, which the fake provider cannot be asked
  // for over HTTP; since M10 deactivating the route models (admin) would make the AI unavailable for every workspace
  // of the shared dev API — the real handed-off conversation (status needs_human) is answered with the flag
  await patchAnswer(page, conversationUrl(conv.angry.id), (c: Conversation) => ({ ...c, aiUnavailable: true }));
  await signIn(page, owner);
  await open(page, conv.angry.id);
  const down = page.locator('[data-banner="aiUnavailable"]');
  await expect(down).toContainText('IA indisponible');
  await expect(down).toContainText('L’IA ne répond pas : la conversation passe en file d’attente.');
  await expect(banners(page)).toHaveCount(1);
  await expect(thread(page).locator('[data-composer="ready"]')).toBeVisible();

  // the real credits-exhausted conversation, with the provider flag on top (same mock reason)
  await patchAnswer(page, conversationUrl(exhausted.id), (c: Conversation) => ({ ...c, aiUnavailable: true }));
  await open(page, exhausted.id);
  await expect(page.locator('[data-banner="credits"]')).toContainText('IA arrêtée : crédits épuisés', { timeout: 30_000 });
  await expect(banners(page)).toHaveCount(1);
  await expect(page.locator('[data-banner="aiUnavailable"]')).toHaveCount(0);
});

test('AT-AI-10 needs_human: the À TRAITER banner names the handoff reason (refund, angry, customer request, keyword, off catalogue)', async ({ page }) => {
  const cases = [
    { c: conv.refund, reason: 'refund', label: 'demande de remboursement' },
    { c: conv.angry, reason: 'angry', label: 'client en colère' },
    { c: conv.human, reason: 'customer_request', label: 'le client demande un humain' },
    { c: conv.keyword, reason: 'keyword', label: 'mot-clé de transfert' },
    { c: conv.insights, reason: 'off_catalogue', label: 'question hors catalogue' },
  ];
  // seven thread navigations on the shared dev server
  test.setTimeout(600_000);
  expect(cases.map((x) => x.c.handoffReason)).toEqual(cases.map((x) => x.reason));
  await signIn(page, owner);
  const banner = page.locator('[data-banner="needsHuman"]');
  for (const { c, label } of cases) {
    await open(page, c.id);
    // the reason is a bidi-isolated part of the title
    await expect(banner).toContainText('L’agent a transmis la conversation :', { timeout: 30_000 });
    await expect(banner).toContainText(label);
    await expect(banner).toContainText('L’IA est en pause. Répondez ou reprenez l’IA.');
    await expect(page.getByTestId('resume-ai')).toBeVisible();
    await expect(banners(page)).toHaveCount(1);
    await expect(thread(page).getByText('À TRAITER', { exact: true }).first()).toBeVisible();
  }

  // mock: the AI pipeline writes known reason codes only; a shop rule's own text (shown as the server wrote it) and a
  // handoff without reason are patched into the real handed-off conversation
  await patchAnswer(page, conversationUrl(conv.human.id), (x: Conversation) => ({ ...x, handoffReason: 'Cliente VIP à rappeler' }));
  await open(page, conv.human.id);
  await expect(banner).toContainText('Cliente VIP à rappeler', { timeout: 30_000 });
  await expect(banner).toContainText('L’agent a transmis la conversation :');
  await expect(banner).not.toContainText('le client demande un humain');
  await page.unroute(conversationUrl(conv.human.id));
  await patchAnswer(page, conversationUrl(conv.human.id), (x: Conversation) => ({ ...x, handoffReason: null }));
  await page.reload();
  await expect(banner).toContainText('L’agent a transmis la conversation', { timeout: 60_000 });
  await expect(banner).not.toContainText('transmis la conversation :');
});

test('"Insights IA de ce fil": lists the insights of the conversation; "Résoudre" posts an instruction, "Ignorer" posts ignored_30d', async ({ page }) => {
  const r = req(page);
  const mine = await insightsOf(r, owner, `?conversationId=${conv.insights.id}`);
  const unknown = mine.find((i) => i.type === 'unknown_topic')!;
  const unclear = mine.find((i) => i.type === 'unclear')!;
  expect(unknown && unclear, `insights of the thread: ${mine.map((i) => i.type).join(', ')}`).toBeTruthy();
  const queries: string[] = [];
  page.on('request', (x) => {
    if (/\/api\/v1\/agent-insights\?/.test(x.url())) queries.push(x.url());
  });
  await signIn(page, owner);
  await open(page, conv.insights.id);

  await (await threadMenu(page)).locator('[data-action=insights]').click();
  const dialog = page.getByRole('dialog', { name: 'Insights IA de ce fil' });
  await expect(dialog).toContainText('Ce que l’agent n’a pas su faire dans cette conversation.');
  const list = dialog.getByTestId('thread-insights');
  // the other conversations' insights (refund, angry… handoffs) are not listed
  await expect(list.locator('[data-insight]')).toHaveCount(mine.length, { timeout: 30_000 });
  expect(queries.some((q) => q.includes(`conversationId=${conv.insights.id}`))).toBeTruthy();
  const one = list.locator(`[data-insight="${unknown.id}"]`);
  await expect(one).toContainText(`Client : « ${INSIGHT_TRIGGERS.unknown_topic} »`);
  await expect(one).toContainText('IA : « ');
  await expect(one).toContainText('Cause : question hors catalogue');
  await expect(one).toContainText('EN ATTENTE');
  await expect(list.locator(`[data-insight="${unclear.id}"]`)).toContainText(`Client : « ${INSIGHT_TRIGGERS.unclear} »`);

  // Résoudre ⇒ the resolve dialog (instruction by default); an empty instruction is refused in place
  await one.locator('[data-action=resolve]').click();
  const resolve = page.getByRole('dialog', { name: "Résoudre l'insight" });
  await expect(resolve.getByRole('radio', { name: /Ajouter une instruction à l'agent/ })).toBeChecked();
  await resolve.getByTestId('resolve-insight-submit').click();
  await expect(resolve.locator('#insight-instruction')).toHaveAttribute('aria-invalid', 'true');
  expect((await insightsOf(r, owner, `?conversationId=${conv.insights.id}`)).find((i) => i.id === unknown.id)!.status).toBe('pending');
  await resolve.locator('#insight-instruction').fill('Nous ne vendons pas de téléphones ; proposer le catalogue mode.');
  await resolve.getByTestId('resolve-insight-submit').click();
  await expect(page.getByText('Insight résolu')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await insightsOf(r, owner, `?conversationId=${conv.insights.id}`)).find((i) => i.id === unknown.id)!.status).toBe('resolved');

  // back on the list: the resolved row has no actions any more, the other one can be ignored
  await expect(list.locator(`[data-insight="${unknown.id}"]`)).toHaveAttribute('data-status', 'resolved', { timeout: 30_000 });
  await expect(list.locator(`[data-insight="${unknown.id}"] [data-action]`)).toHaveCount(0);
  await list.locator(`[data-insight="${unclear.id}"] [data-action=ignore]`).click();
  await expect(page.getByText('Insight ignoré pendant 30 jours')).toBeVisible({ timeout: 30_000 });
  await expect(list.locator(`[data-insight="${unclear.id}"]`)).toHaveAttribute('data-status', 'dismissed', { timeout: 30_000 });
  expect((await insightsOf(r, owner, `?conversationId=${conv.insights.id}`)).find((i) => i.id === unclear.id)!.status).toBe('dismissed');
});

test('"Insights IA de ce fil": empty state when the agent raised nothing; the item is hidden on a conversation without agent', async ({ page }) => {
  expect(await insightsOf(req(page), owner, `?conversationId=${conv.price.id}`)).toHaveLength(0);
  await signIn(page, owner);
  await open(page, conv.price.id);
  await (await threadMenu(page)).locator('[data-action=insights]').click();
  const dialog = page.getByRole('dialog', { name: 'Insights IA de ce fil' });
  await expect(dialog.getByRole('heading', { name: 'Aucun insight sur ce fil' })).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText('L’agent n’a signalé aucun problème dans cette conversation.');
  await expect(dialog.locator('[data-insight]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // a page without agent: its conversation has none, no entry
  expect((await realGet<{ agent: unknown }>(req(page), owner, `/conversations/${conv.noAgent.id}`)).agent).toBeNull();
  await open(page, conv.noAgent.id);
  const menu = await threadMenu(page);
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  await expect(menu.locator('[data-action=insights]')).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Insights IA de ce fil' })).toHaveCount(0);
});
