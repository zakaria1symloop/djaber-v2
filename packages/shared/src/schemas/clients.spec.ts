// Client inputs (CLI-01, 04 §2): the email and phone rules the web form shows inline are the ones the API applies.
import { describe, expect, it } from 'vitest';
import { clientPillOf, CreateClientSchema, isReliableClient, orderRiskPill, UpdateClientSchema } from './clients';

const base = { name: 'Amina Belkacem', phone: '+213 555 12 34 56' };

describe('CreateClientSchema / UpdateClientSchema — email and phones', () => {
  it('email is trimmed and lower-cased; empty or blank means "no email"', () => {
    expect(CreateClientSchema.parse({ ...base, email: '  Amina@Boutique.DZ ' }).email).toBe('amina@boutique.dz');
    expect(CreateClientSchema.parse({ ...base, email: '' }).email).toBeNull();
    expect(CreateClientSchema.parse({ ...base, email: '   ' }).email).toBeNull();
    expect(CreateClientSchema.parse({ ...base, email: null }).email).toBeNull();
  });
  it('an invalid email answers validation.email on the email field', () => {
    const r = CreateClientSchema.safeParse({ ...base, email: 'amina@boutique' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues).toEqual([expect.objectContaining({ path: ['email'], message: 'validation.email' })]);
  });
  it('phones are normalised to 0XXXXXXXXX; a blank second phone is null', () => {
    const v = UpdateClientSchema.parse({ ...base, phone2: '  ', email: 'a@b.dz', tags: [], notes: '', riskLevel: 'normal' });
    expect(v.phone).toBe('0555123456');
    expect(v.phone2).toBeNull();
    expect(v.notes).toBeNull();
  });
});

describe('journey J05v-2 — one risk / reliability rule (clients list, orders list, orders export)', () => {
  const base = { blocked: false, riskLevel: 'normal', isPlaceholder: false, orderCount: 1, returnCount: 0, deliveredCount: 0 };
  it('clientPillOf: blocked > risk > placeholder > reliable > unknown > none', () => {
    expect(clientPillOf({ ...base, blocked: true, riskLevel: 'high' })).toBe('blocked');
    expect(clientPillOf({ ...base, riskLevel: 'high', isPlaceholder: true })).toBe('risk');
    expect(clientPillOf({ ...base, isPlaceholder: true, deliveredCount: 1 })).toBe('placeholder');
    expect(clientPillOf({ ...base, deliveredCount: 1 })).toBe('reliable');
    expect(clientPillOf({ ...base, deliveredCount: 1, returnCount: 1 })).toBeNull();
    expect(clientPillOf({ ...base, orderCount: 0 })).toBe('unknown');
    expect(clientPillOf(base)).toBeNull();
  });
  it('orderRiskPill: « normal » is not « FIABLE » — only a delivered client without return is', () => {
    const o = { blocked: false, orderRisk: 'normal', clientRisk: 'normal', reliable: false };
    expect(orderRiskPill(o)).toBeNull();
    expect(orderRiskPill({ ...o, reliable: true })).toBe('reliable');
    expect(orderRiskPill({ ...o, orderRisk: 'high', reliable: true })).toBe('risk');
    expect(orderRiskPill({ ...o, clientRisk: 'high' })).toBe('risk');
    expect(orderRiskPill({ ...o, blocked: true, clientRisk: 'high' })).toBe('blocked');
    expect(isReliableClient({ deliveredCount: 0, returnCount: 0 })).toBe(false);
  });
});
