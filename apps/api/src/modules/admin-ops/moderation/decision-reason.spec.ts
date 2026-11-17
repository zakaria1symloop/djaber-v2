// journeys 16/11 J13-5: the audit reason of a moderation decision is never the action slug.
import { decisionReason } from './moderation.service';

describe('decisionReason', () => {
  it('approval without a message ⇒ no reason', () => {
    expect(decisionReason({ merchantMessage: null, reasonTemplateKey: null }, 'approve')).toBeNull();
    expect(decisionReason({ merchantMessage: '  ', reasonTemplateKey: 'other' }, 'approve')).toBeNull();
  });
  it('the moderator message first, else the motif of a refusal / change request', () => {
    expect(decisionReason({ merchantMessage: 'Marque protégée', reasonTemplateKey: 'counterfeit' }, 'reject')).toBe('Marque protégée');
    expect(decisionReason({ merchantMessage: null, reasonTemplateKey: 'counterfeit' }, 'reject')).toBe('counterfeit');
    expect(decisionReason({ merchantMessage: null, reasonTemplateKey: 'missing_info' }, 'request_changes')).toBe('missing_info');
  });
});
