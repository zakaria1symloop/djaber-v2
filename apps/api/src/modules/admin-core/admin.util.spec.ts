// Unit rules of the admin core helpers: PII masking of the viewers (07-non-functional) and the reason rule (06 §9).
import { STATE_REFUSED, entityName, maskEmail, maskName, maskPhone, maskText, offered, requireReason } from './admin.util';

describe('admin PII masking', () => {
  it('phones keep the first 2 and last 2 digits', () => {
    expect(maskPhone('0661987654')).toBe('06•• •• •• 54');
    expect(maskPhone('06 61 98 76 54')).toBe('06•• •• •• 54');
    expect(maskPhone('123')).toBe('••••');
    expect(maskPhone(null)).toBeNull();
  });
  it('names keep the first name and the initial of the last one', () => {
    expect(maskName('Mehdi Hadj Ali')).toBe('Mehdi A.');
    expect(maskName('Mehdi')).toBe('Mehdi');
    expect(maskName('  ')).toBe('—');
  });
  it('phone numbers inside a text are masked, other digits kept', () => {
    expect(maskText('Appelez-moi au 0661987654 pour 2 pièces')).toBe('Appelez-moi au 06•• •• •• 54 pour 2 pièces');
    expect(maskText('+213 661 98 76 54')).toBe('+2•• •• •• 54');
    expect(maskText(null)).toBeNull();
  });
  it('e-mails keep the first letter and the domain', () => {
    expect(maskEmail('nadia@boutique.dz')).toBe('n•••@boutique.dz');
  });
});

describe('admin reason rule (06 §9)', () => {
  it('≥ 10 chars after trim, else 422 ADMIN_REASON_REQUIRED on the field', () => {
    expect(requireReason('  Ticket #4821 ok  ')).toBe('Ticket #4821 ok');
    expect(() => requireReason('123456789')).toThrow(expect.objectContaining({ code: 'ADMIN_REASON_REQUIRED' }));
    expect(() => requireReason(undefined, 'note')).toThrow(expect.objectContaining({ fields: { note: 'validation.length' } }));
  });
});

describe('admin action descriptors (12 §16 UX-060, full-test 15/11 ADMIN-05)', () => {
  it('an action the state refuses is left out; permission and named blockers stay greyed with their reason', () => {
    const list = [
      { key: 'open', enabled: true },
      { key: 'resend_verification', enabled: false, reasonCode: STATE_REFUSED },
      { key: 'reset_password', enabled: false, reasonCode: 'FORBIDDEN' },
      { key: 'schedule_deletion', enabled: false, reasonCode: 'ACCOUNT_OWNS_WORKSPACE' },
    ];
    expect(offered(list).map((d) => d.key)).toEqual(['open', 'reset_password', 'schedule_deletion']);
  });
});

describe('audit entity slug (journeys 16/11 J13-1)', () => {
  it('the « Type de cible » slugs map onto the stored model names', () => {
    expect(entityName('agent_preset')).toBe('AgentPreset');
    expect(entityName('cms_entry')).toBe('CmsEntry');
    expect(entityName('plan')).toBe('Plan');
  });
});
