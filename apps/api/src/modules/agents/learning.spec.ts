// Owner decision 26/11 — the agent learns from the team's replies: the pure rules of the `learn-from-reply` job.
import { learnableHandoffAt, learnJobId } from '../messaging/learning-trigger';
import { exchangeOf, foldQuestion, LEARN_ANSWER_MAX, LEARN_QUESTION_MAX, mentionsName, parseLearnAnswer, sameQuestion, type LearnMessage } from './learning';

describe('parseLearnAnswer — the model\'s answer, read strictly', () => {
  const ok = { learn: true, question: 'Livrez-vous à Tamanrasset ?', answer: 'Oui, nous livrons à Tamanrasset sous 5 à 7 jours.' };

  it('a valid answer is kept as it is (spaces tidied)', () => {
    expect(parseLearnAnswer(JSON.stringify(ok))).toEqual(ok);
    expect(parseLearnAnswer(JSON.stringify({ ...ok, question: '  Livrez-vous   à Tamanrasset ?\n' }))).toEqual(ok);
    // fenced, or with a sentence around the object, as models sometimes write it
    expect(parseLearnAnswer('```json\n' + JSON.stringify(ok) + '\n```')).toEqual(ok);
    expect(parseLearnAnswer(`Here is the result: ${JSON.stringify(ok)}`)).toEqual(ok);
    // Arabic, in the language the team answered in
    const ar = { learn: true, question: 'هل التوصيل متوفر لولاية تمنراست؟', answer: 'نعم، التوصيل متوفر في 5 إلى 7 أيام.' };
    expect(parseLearnAnswer(JSON.stringify(ar))).toEqual(ar);
  });

  it('`learn: false` teaches nothing, the reason is kept', () => {
    expect(parseLearnAnswer('{"learn": false, "reason": "about this customer\'s parcel"}')).toEqual({ learn: false, reason: "about this customer's parcel" });
    expect(parseLearnAnswer('{"learn": false}')).toEqual({ learn: false, reason: 'declined' });
    // anything but the boolean true is a no
    expect(parseLearnAnswer(JSON.stringify({ ...ok, learn: 'true' }))).toEqual({ learn: false, reason: 'declined' });
    expect(parseLearnAnswer(JSON.stringify({ question: ok.question, answer: ok.answer }))).toEqual({ learn: false, reason: 'declined' });
  });

  it('malformed JSON, or a missing text, teaches nothing', () => {
    for (const raw of ['', 'Je ne sais pas.', '{"learn": true, "question": "Livrez-vous', '[1, 2]', '{"learn": true}', JSON.stringify({ learn: true, question: ok.question }), JSON.stringify({ learn: true, question: '   ', answer: ok.answer }), JSON.stringify({ learn: true, question: 12, answer: ok.answer })]) {
      expect([raw, parseLearnAnswer(raw)]).toEqual([raw, { learn: false, reason: 'malformed' }]);
    }
  });

  it('a text too long is refused, never cut', () => {
    expect(parseLearnAnswer(JSON.stringify({ ...ok, question: `${'a'.repeat(LEARN_QUESTION_MAX)} ?` }))).toEqual({ learn: false, reason: 'too_long' });
    expect(parseLearnAnswer(JSON.stringify({ ...ok, answer: 'b'.repeat(LEARN_ANSWER_MAX + 1) }))).toEqual({ learn: false, reason: 'too_long' });
    // exactly at the limits: kept
    const edge = { learn: true, question: `${'a'.repeat(LEARN_QUESTION_MAX - 2)} ?`, answer: 'b'.repeat(LEARN_ANSWER_MAX) };
    expect(parseLearnAnswer(JSON.stringify(edge))).toEqual(edge);
  });

  it('a phone number, an address or a person\'s name in the text is refused (personal data never becomes knowledge)', () => {
    const personal = { learn: false, reason: 'personal' };
    expect(parseLearnAnswer(JSON.stringify({ ...ok, answer: 'Oui, appelez le 0661 23 45 67 pour confirmer.' }))).toEqual(personal);
    expect(parseLearnAnswer(JSON.stringify({ ...ok, question: 'Livrez-vous au 0550123456 ?' }))).toEqual(personal);
    expect(parseLearnAnswer(JSON.stringify({ ...ok, answer: 'نعم، اتصل على ٠٦٦١٢٣٤٥٦٧' }))).toEqual(personal);
    expect(parseLearnAnswer(JSON.stringify({ ...ok, answer: 'Oui, on livre à la cité 200 logements bloc 4.' }))).toEqual(personal);
    expect(parseLearnAnswer(JSON.stringify({ ...ok, question: 'Cliente Samira Benali veut savoir si vous livrez ?' }))).toEqual(personal);
    // the name the shop knows this customer by, whatever its case or accents
    expect(parseLearnAnswer(JSON.stringify({ ...ok, answer: 'Oui Yasmine, nous livrons à Tamanrasset.' }), { names: ['Yasmine Khelifi'] })).toEqual(personal);
    expect(parseLearnAnswer(JSON.stringify({ ...ok, answer: 'Oui, nous livrons chez les KHÉLIFI.' }), { names: [null, 'yasmine khelifi'] })).toEqual(personal);
    // the same answer without the name is learnt; a name of two letters is not looked for (« Li » is in « livrons »… as a word it is too short to tell)
    expect(parseLearnAnswer(JSON.stringify(ok), { names: ['Yasmine Khelifi', undefined, 'Li'] })).toEqual(ok);
  });

  it('mentionsName looks for whole words only', () => {
    expect(mentionsName('Nous livrons partout', ['Ivr'])).toBe(false);
    expect(mentionsName('Merci Amine !', ['amine'])).toBe(true);
    expect(mentionsName('شكرا أمينة', ['امينه'])).toBe(true);
    expect(mentionsName('Merci', [])).toBe(false);
  });
});

describe('sameQuestion — a learnt question the agent already has', () => {
  const existing = [
    { id: 'a', question: 'Livrez-vous à Tamanrasset ?' },
    { id: 'b', question: 'هل الدفع عند الاستلام متوفر؟' },
  ];

  it('case, accents, punctuation and repeated spaces are ignored', () => {
    expect(foldQuestion('  LIVREZ-VOUS   a Tamanrasset ?? ')).toBe(foldQuestion('Livrez-vous à Tamanrasset ?'));
    expect(sameQuestion(existing, 'livrez vous a tamanrasset')?.id).toBe('a');
    expect(sameQuestion(existing, '« Livrez-vous à Tamanrasset » !')?.id).toBe('a');
    // Arabic: the marks, the hamza seats and the question mark do not count
    expect(sameQuestion(existing, 'هَل الدفع عند الإستلام متوفر')?.id).toBe('b');
  });

  it('another question is a new one; an empty one matches nothing', () => {
    expect(sameQuestion(existing, 'Livrez-vous à Adrar ?')).toBeNull();
    expect(sameQuestion(existing, ' ?! ')).toBeNull();
    expect(sameQuestion([], 'Livrez-vous à Tamanrasset ?')).toBeNull();
  });
});

describe('exchangeOf — what the model reads of a hand-off', () => {
  const t0 = Date.parse('2026-11-26T10:00:00Z');
  const m = (author: LearnMessage['author'], text: string | null, min: number): LearnMessage => ({ author, text, at: new Date(t0 + min * 60_000) });

  it('the last 5 customer messages before the hand-off, then the team\'s replies and the customer messages up to the last of them', () => {
    const before = [-9, -8, -7, -6, -5, -4, -3].map((min) => m('customer', `avant ${min}`, min));
    const after = [m('human', 'Oui, nous livrons à Tamanrasset.', 2), m('customer', 'Et le délai ?', 3), m('human', '5 à 7 jours.', 4), m('customer', 'merci (après la dernière réponse)', 9)];
    expect(exchangeOf(before, after)).toEqual([
      ...[-7, -6, -5, -4, -3].map((min) => ({ from: 'customer', text: `avant ${min}` })),
      { from: 'team', text: 'Oui, nous livrons à Tamanrasset.' },
      { from: 'customer', text: 'Et le délai ?' },
      { from: 'team', text: '5 à 7 jours.' },
    ]);
  });

  it('at most 5 team replies; the order given does not matter; a picture (no text) is not read', () => {
    const replies = [6, 1, 3, 2, 5, 4, 7].map((min) => m('human', `réponse ${min}`, min));
    const out = exchangeOf([m('customer', 'Vous livrez ?', -1), m('customer', null, -2)], [...replies, m('human', '  ', 0.5)]);
    expect(out).toEqual([{ from: 'customer', text: 'Vous livrez ?' }, ...[1, 2, 3, 4, 5].map((min) => ({ from: 'team', text: `réponse ${min}` }))]);
  });

  it('nothing to learn without a customer text or without a team text', () => {
    expect(exchangeOf([m('customer', 'Vous livrez ?', -1)], [])).toBeNull();
    expect(exchangeOf([m('customer', 'Vous livrez ?', -1)], [m('human', null, 1), m('customer', 'allo ?', 2)])).toBeNull();
    expect(exchangeOf([], [m('human', 'Bonjour', 1)])).toBeNull();
    expect(exchangeOf([m('customer', null, -1)], [m('human', 'Bonjour', 1)])).toBeNull();
    // the question came after the hand-off: read
    expect(exchangeOf([], [m('customer', 'Vous livrez ?', 1), m('human', 'Oui.', 2)])).toEqual([{ from: 'customer', text: 'Vous livrez ?' }, { from: 'team', text: 'Oui.' }]);
  });
});

describe('learnableHandoffAt — which replies of the team are read', () => {
  const at = '2026-11-26T10:00:00.000Z';
  const conv = (status: string, context: Record<string, unknown>) => ({ status, context }) as never;

  it('a hand-off the AI (or a server rule on its behalf) decided, still open', () => {
    for (const reason of ['customer_request', 'off_catalogue', 'unclear_streak', 'order_limits', 'other']) expect([reason, learnableHandoffAt(conv('needs_human', { handoffReason: reason, handoffAt: at }))]).toEqual([reason, at]);
  });

  it('never a hand-off by hand, the pause of the agent, a paused thread, a thread out of the queue', () => {
    expect(learnableHandoffAt(conv('needs_human', { handoffReason: 'manual', handoffAt: at }))).toBeNull();
    expect(learnableHandoffAt(conv('needs_human', { handoffReason: 'manual', handoffAt: at, pausedWithAgent: { id: 'x', at } }))).toBeNull();
    expect(learnableHandoffAt(conv('active', { handoffReason: 'off_catalogue', handoffAt: at }))).toBeNull();
    expect(learnableHandoffAt(conv('active', { aiPausedAt: at }))).toBeNull();
    expect(learnableHandoffAt(conv('resolved', { handoffReason: 'off_catalogue', handoffAt: at }))).toBeNull();
    expect(learnableHandoffAt(conv('needs_human', {}))).toBeNull();
    expect(learnableHandoffAt(conv('needs_human', { handoffReason: 'off_catalogue', handoffAt: 'hier' }))).toBeNull();
  });

  it('one job per hand-off', () => {
    expect(learnJobId('c1', at)).toBe(`learn:c1:${at}`);
  });
});
