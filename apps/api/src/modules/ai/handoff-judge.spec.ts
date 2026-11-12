import { handoffReason, judgeHandoff, quotedFrom } from './handoff-judge';

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

  it('reasons the server sets itself are not re-judged', () => {
    for (const r of ['order_limits', 'order_limit', 'risky_client', 'blocked_word', 'orders_unavailable']) expect(judge(r, 'salam')).toMatchObject({ ok: true });
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
