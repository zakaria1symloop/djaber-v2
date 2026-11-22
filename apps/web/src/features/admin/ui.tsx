'use client';
// Small display pieces of the admin core screens: square mono status pills (Figma admin frames), short dates, numbers,
// money and relative times, the "who · when" line.
import { formatDate, formatDateTime, formatMoney, formatNumber, type AppLocale } from '@djaber/shared';
import { Ltr, MonoChip } from '@djaber/ui';
import type { ReactNode } from 'react';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { relativeTime } from '@/lib/time';

type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Tone of each admin status value (REF — Component sheet: money = done, inbound = in progress, starred = attention, alert = blocking). */
export const ADMIN_TONES: Record<string, Record<string, ChipTone>> = {
  'Workspace.status': { active: 'success', suspended: 'danger', deletion_scheduled: 'danger' },
  'Subscription.status': { trial: 'info', active: 'success', dunning: 'warning', expired: 'danger', cancelled: 'neutral' },
  'Subscription.dunningStage': { d_minus_7: 'warning', d0: 'warning', d_plus_3: 'warning', expired: 'danger' },
  'Workspace.trustLevel': { new: 'neutral', standard: 'info', trusted: 'success', watch: 'danger' },
  'Invoice.status': { upcoming: 'neutral', unpaid: 'danger', paid: 'success', void: 'neutral', refunded: 'neutral' },
  'User.status': { active: 'success', blocked: 'danger', deletion_scheduled: 'danger', unverified: 'warning' },
  'Promo.state': { active: 'success', used: 'neutral', expired: 'neutral', inactive: 'neutral' },
  'Cms.status': { published: 'success', missing: 'danger', draft: 'warning', scheduled: 'info', archived: 'neutral' },
  'Preset.status': { published: 'info', draft: 'neutral', archived: 'danger' },
  'Deletion.status': { pending_confirmation: 'neutral', grace: 'warning', blocked: 'danger', anonymised: 'neutral', cancelled: 'neutral' },
  'DataDeletion.status': { pending: 'warning', done: 'success', no_data: 'neutral', not_found: 'danger' },
  'Audit.action': { danger: 'danger', money: 'success', warn: 'warning', info: 'info' },
};

export function AdminPill({ group, value, children, className }: { group: keyof typeof ADMIN_TONES | string; value: string; children: ReactNode; className?: string }) {
  return (
    <span data-pill={`${group}:${value}`} className="inline-flex max-w-full">
      <MonoChip tone={ADMIN_TONES[group]?.[value] ?? 'neutral'} className={className}>
        {children}
      </MonoChip>
    </span>
  );
}

/** "12 mars" — day + month (Africa/Algiers); `—` when null. */
export function ShortDate({ iso, muted }: { iso: string | null | undefined; muted?: boolean }) {
  const locale = useLocaleCode() as AppLocale;
  if (!iso) return <span className="text-text-muted">—</span>;
  const full = formatDate(iso, locale);
  return (
    <span className={muted ? 'whitespace-nowrap text-text-muted' : 'whitespace-nowrap'} title={full}>
      {full.split(' ').slice(0, 2).join(' ')}
    </span>
  );
}

export const useFormats = () => {
  const locale = useLocaleCode() as AppLocale;
  return {
    locale,
    date: (iso: string | null | undefined) => (iso ? formatDate(iso, locale) : '—'),
    short: (iso: string | null | undefined) => (iso ? formatDate(iso, locale).split(' ').slice(0, 2).join(' ') : '—'),
    dateTime: (iso: string | null | undefined) => (iso ? formatDateTime(iso, locale) : '—'),
    /** "05 oct. 11:42" */
    shortTime: (iso: string | null | undefined) => {
      if (!iso) return '—';
      const full = formatDateTime(iso, locale).split(' ');
      return `${full[0]} ${full[1]} ${full[3] ?? ''}`.trim();
    },
    ago: (iso: string | null | undefined) => relativeTime(iso, locale),
    num: (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatNumber(n)),
    money: (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatMoney(n)),
    /** « 0,39 » in French / Arabic (Latin digits), « 0.39 » in English — decimals of rates and credit prices (ADMIN-19) */
    dec: (n: number | null | undefined, digits = 2) => (n === null || n === undefined ? '—' : n.toLocaleString(locale === 'en' ? 'en-US' : 'fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits }).replace(/\s/g, '\u00a0')),
  };
};

export function Num({ value, className }: { value: number | null | undefined; className?: string }) {
  return <Ltr className={className ?? 'tabular-nums'}>{value === null || value === undefined ? '—' : formatNumber(value)}</Ltr>;
}

export function Money({ value, className }: { value: number | null | undefined; className?: string }) {
  return <Ltr className={className ?? 'whitespace-nowrap tabular-nums'}>{value === null || value === undefined ? '—' : formatMoney(value)}</Ltr>;
}

/** Limit value with −1 = illimité. */
export function useLimit() {
  const t = useT();
  return (n: number | null | undefined) => (n === null || n === undefined ? '—' : n < 0 ? t('admin.common.unlimited') : formatNumber(n));
}

export const fullName = (u: { firstName?: string | null; lastName?: string | null } | null | undefined) => (u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : '');
/** "Zakaria A." */
export const shortName = (u: { firstName?: string | null; lastName?: string | null } | null | undefined) => {
  if (!u) return '';
  const last = (u.lastName ?? '').trim();
  return `${(u.firstName ?? '').trim()}${last ? ` ${last[0]}.` : ''}`.trim();
};

/**
 * Full-test 15/11 ADMIN-19 — values the API keeps as codes, read as words on the admin screens (admin screens keep error
 * codes, never raw data values): payment method / provider, courier, credit-ledger reason (`renewal`, `pack:pack-500`).
 */
export const paymentMethodLabel = (t: TFunction, m: string | null | undefined): string =>
  !m ? '—' : t.has(`admin.subs.method.${m}`) ? t(`admin.subs.method.${m}`) : t.has(`admin.subs.provider.${m}`) ? t(`admin.subs.provider.${m}`) : m;
export const courierLabel = (t: TFunction, provider: string): string => (t.has(`couriers.provider.${provider}`) ? t(`couriers.provider.${provider}`) : provider);
export function ledgerReason(t: TFunction, action: string, reason: string | null | undefined, credits: number): string | null {
  if (!reason || reason === action) return null;
  if (t.has(`credits.reason.${reason}`)) return t(`credits.reason.${reason}`);
  const m = /^([a-z_]+):(.*)$/.exec(reason);
  if (!m) return reason;
  const prefix = m[1]!;
  const rest = m[2] ?? '';
  if (prefix === 'pack') return t.has('credits.reason.pack') ? t('credits.reason.pack', { credits: formatNumber(Math.abs(credits)), creditsN: Math.abs(credits) }) : rest;
  if (prefix === 'store_refund') return t.has('credits.reason.storeRefund') ? t('credits.reason.storeRefund') : null;
  if (prefix === 'upgrade') return t.has('credits.reason.upgrade') ? t('credits.reason.upgrade') : rest;
  if (prefix === 'promo' || prefix === 'referral') return t.has(`credits.reason.${prefix}`) ? t(`credits.reason.${prefix}`, { code: rest }) : rest;
  if (prefix === 'admin') return rest.replace(/^[a-z_]+:/, '').trim() || null;
  return reason;
}
