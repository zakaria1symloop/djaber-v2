import { resetConfigCache } from '../config/config.service';
import { twoFaExempt } from './tenant.resolver';

describe('D41 testing exemption (PLATFORM_2FA_EXEMPT_EMAILS)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    resetConfigCache();
  });
  const withEnv = (nodeEnv: string, list: string) => {
    process.env.NODE_ENV = nodeEnv;
    process.env.PLATFORM_2FA_EXEMPT_EMAILS = list;
    resetConfigCache();
  };

  it('exempts only the listed e-mails, case-insensitively, outside production', () => {
    withEnv('staging', ' Super@Test.local , other@x.dz');
    expect(twoFaExempt('super@test.local')).toBe(true);
    expect(twoFaExempt('OTHER@x.dz')).toBe(true);
    expect(twoFaExempt('admin@djaber.local')).toBe(false);
  });
  it('exempts nobody when the list is empty', () => {
    withEnv('staging', '');
    expect(twoFaExempt('super@test.local')).toBe(false);
  });
  it('is ignored in production', () => {
    withEnv('production', 'super@test.local');
    expect(twoFaExempt('super@test.local')).toBe(false);
  });
  it('owner decision 10/11: PLATFORM_2FA_OFF_UNTIL pauses the rule for everyone, production included, until the end of that day', () => {
    withEnv('production', '');
    process.env.PLATFORM_2FA_OFF_UNTIL = '2026-11-30';
    resetConfigCache();
    expect(twoFaExempt('anyone@djaber.local', new Date('2026-11-10T10:00:00Z'))).toBe(true);
    expect(twoFaExempt('anyone@djaber.local', new Date('2026-11-30T22:00:00Z'))).toBe(true);
    // the next day (Algiers) the rule is back by itself
    expect(twoFaExempt('anyone@djaber.local', new Date('2026-11-30T23:30:00Z'))).toBe(false);
    process.env.PLATFORM_2FA_OFF_UNTIL = '';
    resetConfigCache();
    expect(twoFaExempt('anyone@djaber.local', new Date('2026-11-10T10:00:00Z'))).toBe(false);
  });
});
