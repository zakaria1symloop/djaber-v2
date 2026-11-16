'use client';
// One banner at a time, by priority (02-next-route-map §2.1, GLOBAL frame "Bandeaux").
import { Banner, type StateAction, type Tone } from '@djaber/ui';
import type { ReactNode } from 'react';

export const BANNER_PRIORITY = [
  'maintenance',
  'suspended',
  'deletionScheduled',
  'reconnect',
  'credits100',
  'negativeCredits',
  'planExpired',
  // unpaid renewal invoice (Subscription.status = dunning, R-J): same level as "plan expiré" (12 §0)
  'dunning',
  'credits80',
  'planExpiring',
  'approvalPending',
  // plan picked on the pricing page before sign-up (dismissable, once): above the e-mail notice, which every new account
  // has — below it the offer was never seen (full-test 15/11 ONBOARDING-02)
  'planIntent',
  'emailUnverified',
  'readOnly',
  'newVersion',
  'offline',
  'announcement',
] as const;
export type BannerId = (typeof BANNER_PRIORITY)[number];

export type ShellBanner = {
  id: BannerId;
  tone: Tone;
  content: ReactNode;
  action?: StateAction;
  onDismiss?: () => void;
};

/** Picks the highest-priority banner of the list. */
export const pickBanner = (banners: ShellBanner[]): ShellBanner | undefined =>
  [...banners].sort((a, b) => BANNER_PRIORITY.indexOf(a.id) - BANNER_PRIORITY.indexOf(b.id))[0];

export function BannerStack({ banners, dismissLabel }: { banners: ShellBanner[]; dismissLabel: string }) {
  const b = pickBanner(banners);
  if (!b) return null;
  return (
    <div className="px-4 pt-3 md:px-8" data-shell-banner={b.id}>
      <Banner tone={b.tone} action={b.action} onDismiss={b.onDismiss} dismissLabel={dismissLabel}>
        {b.content}
      </Banner>
    </div>
  );
}
