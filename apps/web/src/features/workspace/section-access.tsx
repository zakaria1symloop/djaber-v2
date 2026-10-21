'use client';
// Settings › Membres « Accès par section » (owner decision 2026-10-21, tester report: "a table to choose which sections
// each member can see"): one row per member, one column per section the Owner can hide. The API refuses every key of a
// hidden section (FORBIDDEN) and the member's menu drops it; a section the role never opens is shown greyed.
import { MEMBER_SECTIONS, MERCHANT_PERMISSIONS, roleCan, sectionOf, type MemberSection, type MerchantPermission } from '@djaber/shared';
import { Card, Checkbox, Pill, SectionLabel, toast, type Tone } from '@djaber/ui';
import { useState } from 'react';
import type { MemberDto } from '@/lib/contracts';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { workspaceApi } from './api';

/** Label of each section: the menu entry the member sees (`nav.*`), or a key of its own. */
export const SECTION_LABEL: Record<MemberSection, string> = {
  inbox: 'nav.inbox',
  orders: 'nav.orders',
  delivery: 'nav.delivery',
  clients: 'nav.clients',
  catalog: 'nav.products',
  stock: 'members.section.stock',
  gds: 'members.section.gds',
  reports: 'nav.reports',
  analytics: 'nav.analytics',
  agents: 'nav.agents',
  channels: 'nav.channels',
};

/** The role opens the section at all (holds one of its keys). */
export const roleOpens = (role: MemberDto['role'], section: MemberSection) => (Object.keys(MERCHANT_PERMISSIONS) as MerchantPermission[]).some((k) => sectionOf(k) === section && roleCan(role, k));

const ROLE_TONE: Record<MemberDto['role'], Tone> = { owner: 'success', admin: 'violet', operator: 'info' };

export function SectionAccess({ members, canWrite, onSaved }: { members: MemberDto[]; canWrite: boolean; onSaved: () => Promise<unknown> }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const rows = members.filter((m) => m.role !== 'owner');
  const toggle = async (m: MemberDto, section: MemberSection, visible: boolean) => {
    const next = visible ? m.hiddenSections.filter((s) => s !== section) : [...m.hiddenSections, section];
    setBusy(`${m.id}:${section}`);
    try {
      await workspaceApi.updateMember(m.id, { hiddenSections: next });
      await onSaved();
      toast(t(visible ? 'members.section.shown' : 'members.section.hidden', { section: t(SECTION_LABEL[section]), name: `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email }));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="flex flex-col gap-2" data-testid="section-access">
      <SectionLabel className="mt-3">{t('members.section.title')}</SectionLabel>
      <p className="ts-label-meta text-text-muted">{t(canWrite ? 'members.section.help' : 'members.section.helpReadOnly')}</p>
      {rows.length === 0 ? (
        <Card className="px-4 py-6 text-center ts-label-meta text-text-muted">{t('members.section.empty')}</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="ts-label-micro text-text-muted">
                <th scope="col" className="sticky start-0 bg-ink-surface px-3 py-2 text-start font-normal">
                  {t('members.section.member')}
                </th>
                {MEMBER_SECTIONS.map((s) => (
                  <th key={s} scope="col" className="whitespace-nowrap px-2 py-2 text-center font-normal">
                    {t(SECTION_LABEL[s])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hairline">
              {rows.map((m) => (
                <tr key={m.id} data-member={m.user.email}>
                  <td className="sticky start-0 bg-ink-surface px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{`${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email}</span>
                      <Pill tone={ROLE_TONE[m.role]}>{t(`enum.Membership.role.${m.role}`)}</Pill>
                    </div>
                  </td>
                  {MEMBER_SECTIONS.map((s) => {
                    const opens = roleOpens(m.role, s);
                    const visible = opens && !m.hiddenSections.includes(s);
                    const label = `${t(SECTION_LABEL[s])} · ${`${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email}`;
                    return (
                      <td key={s} className="px-2 py-2.5 text-center" title={opens ? undefined : t('members.section.notInRole')}>
                        <Checkbox
                          aria-label={label}
                          checked={visible}
                          disabled={!canWrite || !opens || busy === `${m.id}:${s}`}
                          onChange={(e) => void toggle(m, s, e.target.checked)}
                          data-section={s}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
