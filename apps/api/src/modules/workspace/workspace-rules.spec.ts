// Unit tests of the pure rules of M1 (no database): Africa/Algiers periods, defaults, slugs, preferences, system messages.
import { DEFAULT_SYSTEM_MESSAGES } from '@djaber/db';
import { renderMail } from '../../core/mail/templates';
import { algiersDayStart } from '../auth/auth.scheduler';
import { prefsOf } from '../auth/me.service';
import { toInvitationDto } from './invitation.service';
import { defaultWorkspaceName, slugify } from './provisioning.service';
import { SystemMessagesService } from './settings.service';
import { algiersMonthStart } from './workspace.service';

describe('Africa/Algiers periods (CLAUDE.md rule 11)', () => {
  it.each([
    // 23:30 UTC on the 31st is already the 1st in Algiers (UTC+1)
    ['2026-10-31T23:30:00.000Z', '2026-10-31T23:00:00.000Z'],
    ['2026-10-31T22:59:59.000Z', '2026-09-30T23:00:00.000Z'],
    ['2026-01-01T00:00:00.000Z', '2025-12-31T23:00:00.000Z'],
    ['2025-12-31T22:00:00.000Z', '2025-11-30T23:00:00.000Z'],
  ])('month start of %s is %s', (now, expected) => {
    expect(algiersMonthStart(new Date(now)).toISOString()).toBe(expected);
  });

  it.each([
    ['2026-10-11T22:59:00.000Z', '2026-10-10T23:00:00.000Z'],
    ['2026-10-11T23:00:00.000Z', '2026-10-11T23:00:00.000Z'],
    ['2026-03-29T01:30:00.000Z', '2026-03-28T23:00:00.000Z'], // no DST in Algeria
  ])('day start of %s is %s', (now, expected) => {
    expect(algiersDayStart(new Date(now)).toISOString()).toBe(expected);
  });
});

describe('workspace defaults', () => {
  it('slugify keeps a-z 0-9 and dashes, strips accents, caps the length', () => {
    expect(slugify('Boutique Sétif & Co')).toBe('boutique-setif-co');
    expect(slugify('متجر أمين')).toBe('');
    expect(slugify('x'.repeat(80))).toHaveLength(40);
  });

  it('default workspace name per locale', () => {
    expect(defaultWorkspaceName('Amine', 'fr')).toBe('Boutique de Amine');
    expect(defaultWorkspaceName('Amine', 'en')).toBe("Amine's shop");
    expect(defaultWorkspaceName('أمين', 'ar')).toBe('متجر أمين');
  });

  it('system messages are always 4 keys × 3 locales, stored values win over the defaults', () => {
    expect(SystemMessagesService.complete(null)).toEqual(DEFAULT_SYSTEM_MESSAGES);
    expect(SystemMessagesService.complete({})).toEqual(DEFAULT_SYSTEM_MESSAGES);
    const out = SystemMessagesService.complete({ welcome: { fr: '' }, handoff: { ar: 'نص', de: 'x' }, other: { fr: 'x' } });
    expect(Object.keys(out).sort()).toEqual(['handoff', 'out_of_hours', 'out_of_stock', 'welcome']);
    expect(out.welcome).toEqual({ ...DEFAULT_SYSTEM_MESSAGES.welcome, fr: '' });
    expect(out.handoff).toEqual({ ...DEFAULT_SYSTEM_MESSAGES.handoff, ar: 'نص' });
    // the defaults themselves are never mutated
    out.handoff.fr = 'changed';
    expect(DEFAULT_SYSTEM_MESSAGES.handoff.fr).not.toBe('changed');
  });

  it('invitation: resend is available 60 s after the last send', () => {
    const sent = new Date('2026-10-11T10:00:00.000Z');
    const dto = toInvitationDto({ id: 'i', workspaceId: 'w', email: 'a@b.dz', role: 'operator', tokenHash: 'h', invitedById: 'u', expiresAt: new Date('2026-10-18T10:00:00.000Z'), acceptedAt: null, revokedAt: null, lastSentAt: sent, createdAt: sent });
    expect(dto).toEqual({ id: 'i', email: 'a@b.dz', role: 'operator', sentAt: '2026-10-11T10:00:00.000Z', expiresAt: '2026-10-18T10:00:00.000Z', resendAvailableAt: '2026-10-11T10:01:00.000Z' });
    expect(JSON.stringify(dto)).not.toContain('tokenHash');
  });
});

describe('user preferences', () => {
  it('fills the defaults and ignores unknown or malformed values', () => {
    expect(prefsOf({})).toEqual({ listDensity: 'comfortable', soundOnMessage: true, dismissedAnnouncementIds: [], reportFavorites: [] });
    expect(prefsOf(null)).toEqual(prefsOf({}));
    expect(prefsOf({ listDensity: 'compact', soundOnMessage: false, dismissedAnnouncementIds: [1, 'a'], reportFavorites: 'x', extra: 1 })).toEqual({
      listDensity: 'compact',
      soundOnMessage: false,
      dismissedAnnouncementIds: ['1', 'a'],
      reportFavorites: [],
    });
  });
});

describe('mail templates', () => {
  it('escapes interpolated values and keeps the link out of the body text when there is no call to action', () => {
    const m = renderMail('workspace/invitation', 'en', { inviterName: '<script>', workspaceName: 'A&B', role: 'admin', url: 'https://x.test/invitations/t' });
    expect(m.subject).toBe('<script> invites you to A&B'); // subjects are plain text
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('A&amp;B');
    expect(m.html).toContain('as Admin');
    expect(m.html).toContain('href="https://x.test/invitations/t"');
    const notice = renderMail('workspace/deleted', 'ar', { workspaceName: 'متجر' });
    expect(notice.html).toContain('dir="rtl"');
    expect(notice.html).not.toContain('<a ');
  });
});
