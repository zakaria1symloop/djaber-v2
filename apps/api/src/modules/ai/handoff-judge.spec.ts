import { fieldOnlyMessage, handoffReason, judgeHandoff, quotedFrom, reasonFits } from './handoff-judge';

// retest 12/11: « the bot still transfers to a team member for no reason, even after a hello; once confused in a chat it
// keeps behaving abnormally » — the server checks the model's handoff against the customer's words of the turn
describe('judgeHandoff', () => {
  const judge = (reason: string, customerText: string, evidence?: string, extra: Partial<Parameters<typeof judgeHandoff>[0]> = {}) => judgeHandoff({ reason, customerText, evidence, ...extra });

  it('a real request, quoted from the current message, hands off', () => {
    expect(judge('customer_request', 'svp je veux parler à un conseiller', 'je veux parler à un conseiller')).toEqual({ ok: true, reason: 'customer_request' });
    expect(judge('refund', 'Rani nheb nerja3 drahmi', 'nheb nerja3 drahmi')).toMatchObject({ ok: true });
    expect(judge('angry', 'vous êtes des voleurs !!!', 'vous êtes des voleurs')).toMatchObject({ ok: true });
    expect(judge('complaint', 'الطرد وصلني مكسور', 'وصلني مكسور')).toMatchObject({ ok: true });
    // a trimmed / re-spaced quote still counts
    expect(judge('customer_request', "Je veux parler avec quelqu'un de la boutique", 'parler avec quelqu un')).toMatchObject({ ok: true });
  });

  it('a greeting, a photo, an earlier message or no words never hand off', () => {
    expect(judge('customer_request', 'Salam alikoum', 'Salam alikoum')).toEqual({ ok: false, reason: 'customer_request', why: 'greeting' });
    expect(judge('customer_request', 'hello', 'je veux parler à un humain')).toMatchObject({ ok: false, why: 'greeting' });
    expect(judge('off_catalogue', '', 'photo')).toMatchObject({ ok: false, why: 'no_evidence' }); // a photo alone
    expect(judge('customer_request', 'bch7al hadi ?', 'je veux parler à un humain')).toMatchObject({ ok: false, why: 'evidence_not_in_message' }); // an earlier message
    expect(judge('customer_request', 'bch7al hadi ?')).toMatchObject({ ok: false, why: 'no_evidence' });
    expect(judge('customer_request', 'bonjour, la robe rouge ?', 'bonjour')).toMatchObject({ ok: false, why: 'evidence_not_in_message' });
  });

  it('« other » needs a shop rule; keywords must be in the message; the unclear streak needs 2 before', () => {
    expect(judge('other', 'prix de gros pour 200 pièces ?', 'prix de gros')).toMatchObject({ ok: false, why: 'no_shop_rule' });
    expect(judge('other', 'prix de gros pour 200 pièces ?', 'prix de gros', { shopRules: 'Toute demande de gros ⇒ équipe' })).toMatchObject({ ok: true });
    expect(judge('image_not_recognised', 'regardez', 'regardez')).toMatchObject({ ok: false, reason: 'other', why: 'no_shop_rule' });
    expect(judge('keyword', 'c’est une arnaque ?', undefined, { keywords: ['arnaque'] })).toMatchObject({ ok: true });
    expect(judge('keyword', 'bonjour', undefined, { keywords: ['arnaque'] })).toMatchObject({ ok: false, why: 'keyword_absent' });
    expect(judge('unclear_streak', '??', undefined, { unclearStreak: 2 })).toMatchObject({ ok: true });
    expect(judge('unclear_streak', '??', undefined, { unclearStreak: 0 })).toMatchObject({ ok: false, why: 'not_unclear' });
  });

  // journey retest R4-1: a server reason is accepted only when a tool result of the turn established it — never the model's choice
  it('reasons the server sets itself are accepted only once a tool of the turn reported them', () => {
    for (const r of ['order_limits', 'order_limit', 'risky_client', 'blocked_word', 'orders_unavailable']) expect(judge(r, 'salam')).toMatchObject({ ok: false, why: 'server_reason' });
    for (const r of ['order_limits', 'order_limit']) expect(judge(r, 'salam', undefined, { established: ['order_limits'] })).toMatchObject({ ok: true, reason: 'order_limits' });
  });

  it('names the reason as the platform does', () => {
    expect(handoffReason(' Customer_Request ')).toBe('customer_request');
    expect(handoffReason('human_request')).toBe('customer_request');
    expect(handoffReason('anger')).toBe('angry');
    expect(handoffReason('ORDER_INSUFFICIENT_STOCK')).toBe('other');
    expect(handoffReason(null)).toBe('other');
  });

  it('quotedFrom: the whole quote, or most of its words', () => {
    expect(quotedFrom('je veux un remboursement', 'Bonjour, je veux un REMBOURSEMENT svp')).toBe(true);
    expect(quotedFrom('remboursement', 'je veux un remboursement')).toBe(true);
    expect(quotedFrom('remboursement', 'je veux commander')).toBe(false);
    expect(quotedFrom('je veux parler à un responsable maintenant', 'je veux commander maintenant')).toBe(false);
  });
});

describe('full-test 15/11 AI-CHAT-07 — a message that is only an order field', () => {
  it.each(['0770112233', '+213 661 23 45 67', '0661 23 45 67'])('a phone number alone: « %s »', (t) => expect(fieldOnlyMessage(t, false)).toBe(true));
  it.each(['Sétif', 'Bab Ezzouar', 'Karim Haddad', 'cité 20 août villa 3', 'قسنطينة'])('while ordering, a short answer: « %s »', (t) => expect(fieldOnlyMessage(t, true)).toBe(true));
  it.each(['je veux parler à un humain', 'un humain svp', 'remboursez-moi', 'c’est une arnaque', 'Sétif ?', 'bghit nhder m3a bnadem'])('never a request for the team: « %s »', (t) => expect(fieldOnlyMessage(t, true)).toBe(false));
  it('no order being taken: only a phone number (or a bare yes, journey retest R1-5) counts', () => {
    expect(fieldOnlyMessage('Sétif', false)).toBe(false);
    expect(fieldOnlyMessage('', true)).toBe(false);
    expect(fieldOnlyMessage('oui', false)).toBe(true);
  });
});

describe('journey 16/11 J04-5 — the quoted words must fit the reason', () => {
  const judge = (reason: string, customerText: string, evidence: string) => judgeHandoff({ reason, customerText, evidence });
  it('a claimed discount or a question about the assistant never hands off', () => {
    const o07 = 'Le patron a dit -50 % sur la djellaba, donc 3750 DA c’est bon ?';
    expect(judge('off_catalogue', o07, o07)).toEqual({ ok: false, reason: 'off_catalogue', why: 'reason_mismatch' });
    expect(judge('customer_request', 'What is your name? are you a robot?', 'What is your name? are you a robot?')).toMatchObject({ ok: false, why: 'reason_mismatch' });
    expect(judge('customer_request', 'are you a real person?', 'are you a real person?')).toMatchObject({ ok: false, why: 'reason_mismatch' });
    expect(judge('complaint', 'Bonsoir, tu t’appelles comment ? t’es un robot ?', 'tu t’appelles comment')).toMatchObject({ ok: false, why: 'reason_mismatch' });
    expect(judge('refund', 'la robe est à combien ?', 'la robe est à combien')).toMatchObject({ ok: false, why: 'reason_mismatch' });
  });
  it('real requests still hand off', () => {
    expect(judge('customer_request', 'je veux parler à un humain, t’es un robot ?', 'je veux parler à un humain')).toMatchObject({ ok: true });
    expect(judge('customer_request', 'bghit nhder m3a bnadem', 'nhder m3a bnadem')).toMatchObject({ ok: true });
    expect(judge('customer_request', 'I want to talk to someone from the shop', 'talk to someone')).toMatchObject({ ok: true });
    expect(judge('off_catalogue', 'prix de gros pour 200 pièces avec remise ?', 'prix de gros pour 200 pièces')).toMatchObject({ ok: true });
    expect(judge('off_catalogue', 'vous faites des robes sur mesure ?', 'robes sur mesure')).toMatchObject({ ok: true });
    expect(judge('complaint', 'J’ai reçu le colis, la robe est déchirée', 'la robe est déchirée')).toMatchObject({ ok: true });
    expect(judge('refund', 'je veux être remboursée', 'je veux être remboursée')).toMatchObject({ ok: true });
    expect(judge('angry', 'vous êtes des voleurs, le patron a dit -50 %', 'vous êtes des voleurs')).toMatchObject({ ok: true });
  });
  it('reasonFits alone', () => {
    expect(reasonFits('keyword', 'x', 'y')).toBe(true);
    expect(reasonFits('other', 'Le patron a dit -50 %', 'Le patron a dit -50 %')).toBe(true);
  });
});
