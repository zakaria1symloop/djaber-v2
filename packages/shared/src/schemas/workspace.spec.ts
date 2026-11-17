// Settings › Espace de travail form (journey J12-2 / J12-10.2): a negative amount is refused, never saved as « empty ».
import { describe, expect, it } from 'vitest';
import { WorkspaceProfileSchema } from './workspace';

const base = { name: 'Boutique QA', phone: '', address: '', senderWilayaId: '', locale: 'fr' as const, autoPauseOnManualReply: true, handoffReminderMin: '15', freeDeliveryThreshold: '' };
const fieldErrors = (patch: Partial<typeof base>): Record<string, string> => {
  const r = WorkspaceProfileSchema.safeParse({ ...base, ...patch });
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe('WorkspaceProfileSchema', () => {
  it('free delivery: empty (= none) and whole DA amounts pass, a negative or decimal amount is refused', () => {
    expect(fieldErrors({ freeDeliveryThreshold: '' })).toEqual({});
    expect(fieldErrors({ freeDeliveryThreshold: '10000' })).toEqual({});
    expect(fieldErrors({ freeDeliveryThreshold: '-5' })).toEqual({ freeDeliveryThreshold: 'validation.price' });
    expect(fieldErrors({ freeDeliveryThreshold: '-' })).toEqual({ freeDeliveryThreshold: 'validation.price' });
    expect(fieldErrors({ freeDeliveryThreshold: '1.5' })).toEqual({ freeDeliveryThreshold: 'validation.price' });
  });
  it('handoff reminder: empty → required, negative / above 1440 → range', () => {
    expect(fieldErrors({ handoffReminderMin: '0' })).toEqual({});
    expect(fieldErrors({ handoffReminderMin: '1440' })).toEqual({});
    expect(fieldErrors({ handoffReminderMin: '' })).toEqual({ handoffReminderMin: 'validation.required' });
    expect(fieldErrors({ handoffReminderMin: '-5' })).toEqual({ handoffReminderMin: 'validation.range' });
    expect(fieldErrors({ handoffReminderMin: '1441' })).toEqual({ handoffReminderMin: 'validation.range' });
  });
});
