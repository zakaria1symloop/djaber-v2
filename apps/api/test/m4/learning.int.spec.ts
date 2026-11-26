// Owner decision 26/11 — « i want to let ai learn from human intervention » + « Autonomie de l'IA ».
// AI hand-off → a team member answers → `jobs / learn-from-reply` (one per hand-off, delayed 10 min) → an FAQ SUGGESTION
// (`source = human_reply`, inactive) the shop approves or ignores in Agent › Connaissances; the percentage of the agent's
// conversations the AI kept without asking a person, on the agents list and the agent page. AT ids from 13-acceptance-tests.md.
// The AI adapter is the scriptable fake (`faq_learn` scripted per test); nothing here talks to a provider.
import { LEARN_SYSTEM } from '../../src/modules/agents/learning';
import { LearningService } from '../../src/modules/agents/learning.service';
import { RoutingService } from '../../src/modules/ai/routing.service';
import { LEARN_DELAY_MS, learnJobId } from '../../src/modules/messaging/learning-trigger';
import { asOperator, asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct, image, upload } from '../support/m2';
import { connectedPage, delivery, forbidNetwork, mid, newSender, postWebhook, receive, reply, work } from '../support/m3';
import { answer, closeOutbox, db, fakeAi, ledger, linkedAgent, textRoute } from '../support/m4';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
type Shop = { owner: Actor; page: Awaited<ReturnType<typeof connectedPage>>; agent: Awaited<ReturnType<typeof linkedAgent>> };

const QUESTION = 'Peut-on retourner un article ?';
const ANSWER = 'Oui, les retours sont acceptés sous 7 jours, article non porté.';
const TEAM_REPLY = 'Bonjour, oui : les retours sont acceptés sous 7 jours si l’article n’a pas été porté.';
const learns = (question = QUESTION, answer = ANSWER) => fakeAi(app).script('faq_learn', { object: { learn: true, question, answer } });
const learnCalls = () => fakeAi(app).callsOf('faq_learn');

const shop = async (): Promise<Shop> => {
  const owner = await asOwner(app);
  const page = await connectedPage(owner, app);
  const agent = await linkedAgent(owner.workspaceId, [page.id]);
  await createProduct(owner, { name: 'Robe satin bordeaux', price: 4500, stock: 5 });
  return { owner, page, agent };
};
const conversationOf = (id: string) => db.conversation.findUniqueOrThrow({ where: { id } });
/** A customer message answered by the AI (the fake brain: a refund request ⇒ HANDOFF `refund`). */
const ask = async (s: Shop, text: string, sender = newSender()) => {
  const { conversation } = await receive(app, s.page, sender, { text });
  await answer(app, s.owner.workspaceId, conversation.id);
  return { id: conversation.id, sender };
};
/** A conversation the AI handed to the team; returns its id and the `handoffAt` of the episode. */
const handedOff = async (s: Shop, text = 'Je veux un remboursement, vous faites les retours ?') => {
  const c = await ask(s, text);
  const row = await conversationOf(c.id);
  const ctx = row.context as { handoffAt: string; handoffReason: string };
  expect([row.status, ctx.handoffReason]).toEqual(['needs_human', 'refund']);
  return { ...c, handoffAt: ctx.handoffAt };
};
const learnJobs = (conversationId: string) => db.outbox.findMany({ where: { topic: 'job', key: { startsWith: `learn:${conversationId}:` } } });
const faqsOf = (agentId: string) => db.agentFaq.findMany({ where: { agentId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
const getAgent = async (actor: Actor, id: string) => (await actor.get(`/agents/${id}`).expect(200)).body.data;
const lastPrompt = () => fakeAi(app).callsOf('reply').at(-1)!.system;

beforeAll(async () => {
  app = await createTestApp();
  net = forbidNetwork();
});
afterAll(async () => {
  expect(net.spy).not.toHaveBeenCalled();
  net.restore();
  await closeOutbox();
  await app.close();
});
beforeEach(async () => {
  fakeAi(app).reset();
  const route = await textRoute();
  const routing = app.app.get(RoutingService);
  await routing.resetBreaker(route.primaryModelId);
  if (route.fallbackModelId) await routing.resetBreaker(route.fallbackModelId);
});

describe('the agent learns from the team\'s replies', () => {
  it('AT-LRN-01 AI hand-off → team reply → one job per hand-off (10 min) → one `human_reply` suggestion, inactive, not in the prompt; the job run twice stores nothing more', async () => {
    const s = await shop();
    const c = await handedOff(s);
    const runsBefore = await db.aiRun.count({ where: { workspaceId: s.owner.workspaceId } });
    const debitsBefore = (await ledger(s.owner.workspaceId)).length;

    // the team answers — twice: the job is queued once, in the reply's transaction, through the outbox
    await reply(s.owner, c.id, { text: TEAM_REPLY }).expect(201);
    await reply(s.owner, c.id, { text: 'Il suffit de nous écrire ici.' }).expect(201);
    const jobs = await learnJobs(c.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ key: learnJobId(c.id, c.handoffAt), workspaceId: s.owner.workspaceId });
    expect(jobs[0]!.payload).toMatchObject({ queue: 'jobs', name: 'learn-from-reply', data: { workspaceId: s.owner.workspaceId, conversationId: c.id, handoffAt: c.handoffAt }, opts: { delay: LEARN_DELAY_MS } });
    expect(LEARN_DELAY_MS).toBe(600_000);

    // the worker runs it: one call to the text model, with the customer's question and the team's replies only
    learns();
    expect(await work(app, [s.owner.workspaceId])).toContain('learn-from-reply');
    expect(learnCalls()).toHaveLength(1);
    const call = learnCalls()[0]!;
    expect(call.system).toBe(LEARN_SYSTEM);
    const input = String((call.messages[0] as { content?: unknown }).content);
    expect(input).toContain('"from":"customer","text":"Je veux un remboursement, vous faites les retours ?"');
    expect(input).toContain(`"from":"team","text":${JSON.stringify(TEAM_REPLY)}`);
    expect(input).toContain('"from":"team","text":"Il suffit de nous écrire ici."');
    // what the AI and the platform said in the thread is not part of the exchange
    expect(input).not.toContain('conseiller');

    const rows = await faqsOf(s.agent.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workspaceId: s.owner.workspaceId, agentId: s.agent.id, source: 'human_reply', isActive: false, question: QUESTION, answer: ANSWER, sourceConversationId: c.id, askedCount: 1 });
    // no credit charged to the shop, no AiRun for the platform's call
    expect(await db.aiRun.count({ where: { workspaceId: s.owner.workspaceId } })).toBe(runsBefore);
    expect(await ledger(s.owner.workspaceId)).toHaveLength(debitsBefore);

    // the API shows it as a suggestion; the agent carries the count
    const listed = (await s.owner.get(`/agents/${s.agent.id}/faq`).expect(200)).body.data;
    expect(listed).toEqual([expect.objectContaining({ id: rows[0]!.id, source: 'human_reply', isActive: false, sourceConversationId: c.id, question: QUESTION, answer: ANSWER })]);
    expect((await getAgent(s.owner, s.agent.id)).learningPending).toBe(1);

    // a suggestion is not knowledge yet: the next customer's prompt does not carry it
    await ask(s, 'Bonjour');
    expect(lastPrompt()).not.toContain(QUESTION);
    expect(lastPrompt()).not.toContain(ANSWER);

    // the job a second time (BullMQ retry, duplicate): the hand-off was read — no model call, nothing stored
    const data = { workspaceId: s.owner.workspaceId, conversationId: c.id, handoffAt: c.handoffAt };
    learns('Autre question ?', 'Autre réponse.');
    expect(await app.app.get(LearningService).run(data)).toBe('already');
    expect(learnCalls()).toHaveLength(1);
    expect(await faqsOf(s.agent.id)).toHaveLength(1);
    // and a later reply in the same hand-off queues nothing more
    await reply(s.owner, c.id, { text: 'Bonne journée !' }).expect(201);
    expect(await learnJobs(c.id)).toHaveLength(1);
  });

  it('AT-LRN-02 nothing is queued for a hand-off by hand, a thread a member paused, a picture alone, or a page without an agent', async () => {
    const s = await shop();
    const version = async (id: string) => (await conversationOf(id)).version;

    // « À traiter » by hand (reason `manual`)
    const manual = await ask(s, 'Bonjour');
    await s.owner.patch(`/conversations/${manual.id}`, { status: 'needs_human', version: await version(manual.id) }).expect(200);
    expect(((await conversationOf(manual.id)).context as any).handoffReason).toBe('manual');
    await reply(s.owner, manual.id, { text: 'Bonjour, je prends votre demande.' }).expect(201);
    expect(await learnJobs(manual.id)).toHaveLength(0);

    // the AI paused by a member, then the member answers
    const paused = await ask(s, 'Bonsoir');
    await s.owner.patch(`/conversations/${paused.id}`, { aiPaused: true, version: await version(paused.id) }).expect(200);
    await reply(s.owner, paused.id, { text: 'Je m’en occupe.' }).expect(201);
    expect(await learnJobs(paused.id)).toHaveLength(0);

    // a thread the AI still holds: a member's reply is not an answer to a hand-off
    const held = await ask(s, 'Salam');
    await reply(s.owner, held.id, { text: 'Bienvenue !' }).expect(201);
    expect(await learnJobs(held.id)).toHaveLength(0);

    // a picture alone answers a hand-off of the AI: nothing to read — the text that follows queues the hand-off's job
    const pictured = await handedOff(s);
    const up = await upload(s.owner, app, '/uploads', 'file', [{ buffer: await image(600, 600), name: 'photo.jpg', type: 'image/jpeg' }], { kind: 'reply' }).expect(201);
    await reply(s.owner, pictured.id, { uploadId: up.body.data.id }).expect(201);
    expect(await learnJobs(pictured.id)).toHaveLength(0);
    await reply(s.owner, pictured.id, { text: TEAM_REPLY }).expect(201);
    expect(await learnJobs(pictured.id)).toHaveLength(1);
    fakeAi(app).script('faq_learn', { object: { learn: false, reason: 'nothing general' } });

    // the page lost its agent after the hand-off
    const orphan = await handedOff(s);
    await db.agentChannel.deleteMany({ where: { agentId: s.agent.id } });
    await reply(s.owner, orphan.id, { text: TEAM_REPLY }).expect(201);
    expect(await learnJobs(orphan.id)).toHaveLength(0);
    // … and a job queued before the agent left stores nothing
    expect(await app.app.get(LearningService).run({ workspaceId: s.owner.workspaceId, conversationId: orphan.id, handoffAt: orphan.handoffAt })).toBe('no_agent');

    await work(app, [s.owner.workspaceId]);
    // the only job that ran is the one of the thread answered with a text after the picture
    expect(learnCalls()).toHaveLength(1);
    expect(await faqsOf(s.agent.id)).toHaveLength(0);
  });

  it('AT-LRN-03 `learn: false`, a malformed answer, personal data, a provider failure ⇒ no suggestion; a question the agent already has ⇒ its `askedCount` + 1', async () => {
    const s = await shop();
    const run = async (script: Parameters<ReturnType<typeof fakeAi>['script']>[1], team = TEAM_REPLY) => {
      const c = await handedOff(s);
      await reply(s.owner, c.id, { text: team }).expect(201);
      fakeAi(app).script('faq_learn', script);
      const before = learnCalls().length;
      await work(app, [s.owner.workspaceId]);
      expect(learnCalls()).toHaveLength(before + 1);
      return c;
    };
    // about this customer only
    const declined = await run({ object: { learn: false, reason: 'refund of this customer' } });
    // not JSON
    await run({ text: 'Je pense que oui.' });
    // the customer's phone in the answer; then « Cliente Samira … » in the question
    await run({ object: { learn: true, question: QUESTION, answer: 'Oui, appelez le 0661 23 45 67.' } });
    await run({ object: { learn: true, question: 'Cliente Samira Benali peut-elle retourner sa robe ?', answer: ANSWER } });
    // too long
    await run({ object: { learn: true, question: QUESTION, answer: 'a'.repeat(601) } });
    expect(await faqsOf(s.agent.id)).toHaveLength(0);
    expect((await getAgent(s.owner, s.agent.id)).learningPending).toBe(0);
    // a hand-off that taught nothing is read once all the same
    expect(await app.app.get(LearningService).run({ workspaceId: s.owner.workspaceId, conversationId: declined.id, handoffAt: declined.handoffAt })).toBe('already');

    // the provider does not answer: the job does not fail, nothing is stored, the hand-off stays unread
    const down = await handedOff(s);
    await reply(s.owner, down.id, { text: TEAM_REPLY }).expect(201);
    const route = await textRoute();
    // (one failure per model of the route: the primary, then the fallback when there is one)
    fakeAi(app).script('faq_learn', ...Array.from({ length: route.fallbackModelId ? 2 : 1 }, () => ({ error: 'provider_error' as const })));
    const callsBefore = learnCalls().length;
    expect(await work(app, [s.owner.workspaceId])).toContain('learn-from-reply');
    expect(learnCalls()).toHaveLength(callsBefore + (route.fallbackModelId ? 2 : 1));
    expect(await faqsOf(s.agent.id)).toHaveLength(0);
    expect(((await conversationOf(down.id)).context as any).learnedHandoffAt).toBeUndefined();
    expect(await app.app.get(LearningService).run({ workspaceId: s.owner.workspaceId, conversationId: 'not-a-uuid', handoffAt: 'hier' })).toBe('noop');

    // the agent already answers this question (another spelling): no second entry, one more customer asked it
    const known = (await s.owner.post(`/agents/${s.agent.id}/faq`, { question: 'PEUT ON RETOURNER UN ARTICLE', answer: 'Oui, sous 7 jours.' }).expect(201)).body.data;
    await run({ object: { learn: true, question: QUESTION, answer: ANSWER } });
    const rows = await faqsOf(s.agent.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: known.id, source: 'manual', isActive: true, answer: 'Oui, sous 7 jours.', askedCount: 1 });
    await run({ object: { learn: true, question: '« Peut-on retourner un article » ?!', answer: ANSWER } });
    expect((await faqsOf(s.agent.id)).map((f) => [f.source, f.askedCount])).toEqual([['manual', 2]]);
  });

  // tester 26/11 14:34: the AI also recorded the question it could not answer (`add_faq_candidate`) in the turn of the hand-off
  it('AT-LRN-07 the open question the AI recorded is filled by the team answer: it becomes the suggestion to approve, never a lost answer', async () => {
    const s = await shop();
    const open = await db.agentFaq.create({ data: { workspaceId: s.owner.workspaceId, agentId: s.agent.id, question: 'Est-ce que vous livrez le vendredi ?', answer: '', source: 'ai_suggested', isActive: false, askedCount: 1, sortOrder: 1000 } });
    const c = await handedOff(s);
    await reply(s.owner, c.id, { text: 'Oui, nous livrons du samedi au jeudi, et le vendredi matin uniquement.' }).expect(201);
    fakeAi(app).script('faq_learn', { object: { learn: true, question: 'Vous livrez le vendredi ?', answer: 'Oui, du samedi au jeudi, et le vendredi matin uniquement.' } });
    await work(app, [s.owner.workspaceId]);
    const rows = await faqsOf(s.agent.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: open.id, source: 'human_reply', isActive: false, answer: 'Oui, du samedi au jeudi, et le vendredi matin uniquement.', sourceConversationId: c.id, askedCount: 2 });
    expect((await getAgent(s.owner, s.agent.id)).learningPending).toBe(1);
  });

  it('AT-LRN-04 an answer typed in the Page inbox (echo) to a hand-off of the AI teaches the agent too', async () => {
    const s = await shop();
    const c = await handedOff(s);
    learns();
    const echo = { sender: { id: s.page.externalId }, recipient: { id: c.sender }, timestamp: Date.now(), message: { mid: mid(), is_echo: true, text: TEAM_REPLY, app_id: 263902037430900 } };
    await postWebhook(app, delivery(s.page, [echo])).expect(200);
    await work(app, [s.owner.workspaceId]);
    expect(await learnJobs(c.id)).toHaveLength(1);
    expect((await faqsOf(s.agent.id)).map((f) => [f.source, f.isActive, f.question, f.sourceConversationId])).toEqual([['human_reply', false, QUESTION, c.id]]);
  });

  it('AT-LRN-05 review by the shop: « Approuver » (answer edited) makes it an entry the agent uses, counted in the limits (existing AGENT_FAQ_LIMIT); « Ignorer » deletes it; operator 403; another workspace 404', async () => {
    const s = await shop();
    const operator = await asOperator(app, s.owner.workspaceId);
    const other = await asOwner(app);
    await s.owner.post(`/agents/${s.agent.id}/faq`, { question: 'Quels sont vos horaires ?', answer: 'De 9h à 18h.' }).expect(201);
    const suggest = async (question: string, answer = ANSWER) => {
      const c = await handedOff(s);
      await reply(s.owner, c.id, { text: TEAM_REPLY }).expect(201);
      learns(question, answer);
      await work(app, [s.owner.workspaceId]);
      const row = (await faqsOf(s.agent.id)).find((f) => f.question === question);
      expect(row).toMatchObject({ source: 'human_reply', isActive: false });
      return { ...row!, conversation: c };
    };
    const first = await suggest(QUESTION);
    const second = await suggest('Livrez-vous le vendredi ?', 'Non, pas le vendredi.');
    const path = (id: string) => `/agents/${s.agent.id}/faq/${id}`;
    expect((await getAgent(s.owner, s.agent.id)).learningPending).toBe(2);

    // permissions and tenancy: an operator reads the suggestions (agents.read) but does not review them (agents.manage)
    expect((await operator.get(`/agents/${s.agent.id}/faq`).expect(200)).body.data).toHaveLength(3);
    expect((await operator.patch(path(first.id), { isActive: true }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await operator.delete(path(first.id)).expect(403);
    await other.get(`/agents/${s.agent.id}/faq`).expect(404);
    await other.patch(path(first.id), { isActive: true }).expect(404);
    await other.delete(path(first.id)).expect(404);
    expect(await faqsOf(s.agent.id)).toHaveLength(3);

    // editing the proposed answer alone keeps it a suggestion (only the approval makes the agent use it)
    const edited = (await s.owner.patch(path(first.id), { answer: 'Oui, sous 7 jours.' }).expect(200)).body.data;
    expect(edited).toMatchObject({ isActive: false, source: 'human_reply', answer: 'Oui, sous 7 jours.' });
    await s.owner.patch(path(first.id), { isActive: true, answer: '   ' }).expect(422);

    // « Approuver », with the answer the shop corrected
    const approved = (await s.owner.patch(path(first.id), { isActive: true, answer: 'Oui, sous 7 jours, article non porté.' }).expect(200)).body.data;
    expect(approved).toMatchObject({ id: first.id, isActive: true, source: 'human_reply', question: QUESTION, answer: 'Oui, sous 7 jours, article non porté.', sourceConversationId: first.conversation.id, sortOrder: 1 });
    expect((await getAgent(s.owner, s.agent.id)).learningPending).toBe(1);
    // … the next customer who asks gets it from the AI: it is in the agent's knowledge
    await ask(s, 'Bonjour');
    expect(lastPrompt()).toContain(`Q: ${QUESTION}\nA: Oui, sous 7 jours, article non porté.`);
    expect(lastPrompt()).not.toContain('Livrez-vous le vendredi ?');
    // … and it is copied with the agent, the suggestion still waiting is not
    const copy = (await s.owner.post(`/agents/${s.agent.id}/duplicate`).expect(201)).body.data;
    expect((await faqsOf(copy.id)).map((f) => [f.question, f.source, f.isActive])).toEqual([['Quels sont vos horaires ?', 'manual', true], [QUESTION, 'human_reply', true]]);
    expect((await s.owner.get(`/agents/${s.agent.id}/export`).expect(200)).body.data.faqs.map((f: any) => f.question)).toEqual(['Quels sont vos horaires ?', QUESTION]);

    // a suggestion does not count in the limit (50 entries) until it is approved; approving past it is the existing error
    await db.agentFaq.createMany({ data: Array.from({ length: 47 }, (_, i) => ({ workspaceId: s.owner.workspaceId, agentId: s.agent.id, question: `Q${i} ?`, answer: 'R', sortOrder: 10 + i })) });
    await s.owner.post(`/agents/${s.agent.id}/faq`, { question: 'La 50e ?', answer: 'oui' }).expect(201);
    expect((await s.owner.patch(path(second.id), { isActive: true }).expect(422)).body.error.code).toBe('AGENT_FAQ_LIMIT');
    expect((await faqsOf(s.agent.id)).find((f) => f.id === second.id)).toMatchObject({ isActive: false });

    // « Ignorer »: gone, and the same hand-off never proposes it again
    await s.owner.delete(path(second.id)).expect(204);
    await s.owner.delete(path(second.id)).expect(404);
    expect((await faqsOf(s.agent.id)).some((f) => f.id === second.id)).toBe(false);
    expect((await getAgent(s.owner, s.agent.id)).learningPending).toBe(0);
    learns('Livrez-vous le vendredi ?', 'Non, pas le vendredi.');
    expect(await app.app.get(LearningService).run({ workspaceId: s.owner.workspaceId, conversationId: second.conversation.id, handoffAt: second.conversation.handoffAt })).toBe('already');
    expect((await faqsOf(s.agent.id)).some((f) => f.question === 'Livrez-vous le vendredi ?')).toBe(false);
  });
});

describe('« Autonomie de l\'IA »', () => {
  it('AT-LRN-06 the list and the detail carry `autonomy` (30 days) and `learningPending`; a thread the team took by hand does not count against the AI; the agent metrics tell the same number', async () => {
    const s = await shop();
    const fresh = await getAgent(s.owner, s.agent.id);
    expect(fresh.autonomy).toEqual({ pct: null, conversations: 0, handoffs: 0, days: 30 });
    expect(fresh.learningPending).toBe(0);

    // three conversations: one the AI kept, one it handed to the team, one a member took by hand and answered
    await ask(s, 'Bonjour, la robe satin ?');
    const handed = await handedOff(s);
    const taken = await ask(s, 'Bonsoir');
    await s.owner.patch(`/conversations/${taken.id}`, { status: 'needs_human', version: (await conversationOf(taken.id)).version }).expect(200);
    await reply(s.owner, taken.id, { text: 'Je vous réponds moi-même.' }).expect(201);
    // the team answers the hand-off: a suggestion waits
    await reply(s.owner, handed.id, { text: TEAM_REPLY }).expect(201);
    learns();
    await work(app, [s.owner.workspaceId]);

    const expected = { pct: 67, conversations: 3, handoffs: 1, days: 30 };
    const detail = await getAgent(s.owner, s.agent.id);
    expect(detail.autonomy).toEqual(expected);
    expect(detail.learningPending).toBe(1);
    expect(detail.metrics30d).toMatchObject({ conversations: 3, handledWithoutHuman: 2 });
    const list = (await s.owner.get('/agents').expect(200)).body.data;
    expect(list.map((a: any) => [a.id, a.autonomy, a.learningPending])).toEqual([[s.agent.id, expected, 1]]);
    const m = (await s.owner.get(`/agents/${s.agent.id}/metrics`).expect(200)).body.data;
    expect(m).toMatchObject({ conversations: 3, handoffs: 1, handledWithoutHuman: 2, resolutionRate: 67 });

    // a second hand-off in the same conversation is still one conversation handed to the team
    await s.owner.patch(`/conversations/${handed.id}`, { aiPaused: false, version: (await conversationOf(handed.id)).version }).expect(200);
    await ask(s, 'remboursement svp', handed.sender);
    expect((await conversationOf(handed.id)).status).toBe('needs_human');
    expect((await getAgent(s.owner, s.agent.id)).autonomy).toEqual(expected);

    // an operator reads the figure (agents.read); another workspace does not see the agent
    const operator = await asOperator(app, s.owner.workspaceId);
    expect((await getAgent(operator, s.agent.id)).autonomy).toEqual(expected);
    await (await asOwner(app)).get(`/agents/${s.agent.id}`).expect(404);
  });
});
