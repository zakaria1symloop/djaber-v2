// UX-059 (retest 12/11): the versions « Diff » never shows raw JSON or a camelCase field name.
import { describe, expect, it } from 'vitest';
import { makeT } from '@/lib/format-message';
import { diffFieldLabel, diffValue } from './version-diff';

const t = makeT('en', {
  'agents.field.handoffRules': 'Handoff rules',
  'agents.field.productCardTemplate': 'Product card',
  'agents.field.policies': 'Shop rules',
  'agents.field.other': 'Other setting',
  'agents.handoff.rule.human_request': 'The customer asks for a human',
  'agents.handoff.rule.anger': 'The customer is angry',
  'agents.tone.warm': 'Warm & concise',
  'agents.language.fr': 'French',
  'agents.language.darija': 'Darija',
  'agents.policies.delivery': 'DELIVERY',
  'agents.capability.short.takeOrders': 'Orders',
  'agents.versions.modified': 'changed',
  'agents.versions.items': '{count, plural, one {# item} other {# items}}',
  'common.yes': 'Yes',
  'common.no': 'No',
});

describe('agent version diff in words', () => {
  it('field labels, never the camelCase name', () => {
    expect(diffFieldLabel(t, 'productCardTemplate')).toBe('Product card');
    expect(diffFieldLabel(t, 'someNewField')).toBe('Other setting');
  });
  it('values as the configuration names them', () => {
    expect(diffValue(t, 'handoffRules', [{ kind: 'human_request', enabled: true }, { kind: 'anger', enabled: false }])).toBe('The customer asks for a human');
    expect(diffValue(t, 'tone', 'warm')).toBe('Warm & concise');
    expect(diffValue(t, 'languages', ['fr', 'darija'])).toBe('French, Darija');
    expect(diffValue(t, 'policies', { delivery: '2–5 days' })).toBe('DELIVERY : 2–5 days');
    expect(diffValue(t, 'policies', {})).toBe('—');
    expect(diffValue(t, 'capabilities', { takeOrders: true, crossSell: false })).toBe('Orders');
    expect(diffValue(t, 'productIds', ['a', 'b', 'c'])).toBe('3 items');
    expect(diffValue(t, 'imageRecognition', true)).toBe('Yes');
    expect(diffValue(t, 'productCardTemplate', null)).toBe('—');
  });
  it('anything else is « changed », never JSON', () => {
    const out = diffValue(t, 'businessHours', { mon: [{ from: '09:00', to: '18:00' }] });
    expect(out).toBe('changed');
    expect(diffValue(t, 'orderFields', [{ key: 'phone', required: true }])).not.toMatch(/[{}[\]"]/);
  });
});
