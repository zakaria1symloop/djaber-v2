'use client';
// Shell pieces of the credits module (02-next-route-map §2.1): the header pill `used / limit` (amber from 80 %, red
// when exhausted, links to /settings/credits), the banners `credits100` / `credits80` / `negativeCredits`, and the WS
// `credits.updated` handler that keeps the cached balance fresh. Mounted once by MerchantShell.
import { formatDate, formatNumber, type AppLocale } from '@djaber/shared';
import { CreditsPill } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { ShellBanner } from '@/components/shell/banner-stack';
import { Link, useRouter } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { useWsEvent } from '@/lib/ws';
import { creditKeys, useCredits } from './api';
import type { Credits, WsCreditsUpdated } from './contracts';
import { applyCreditsEvent, creditsBanner, creditsLevel, levelOf, packLeft, runningOnPacks, warningDate } from './logic';

/**
 * "⚡ 3 760 / 5 000" — `GET /credits`, or the plan usage of `GET /workspace` until it answers; with bought packs left
 * "⚡ 2 000 / 2 000 + 5 000" (recette 11/11: a pack used to change the colour only).
 */
export function CreditsPillLink() {
  const t = useT();
  const { can, workspace } = useSession();
  const q = useCredits();
  const plan = workspace?.plan;
  if (!can('billing.read_credits')) return null;
  const used = q.data?.plan.used ?? plan?.usage.creditsUsed;
  const limit = q.data?.plan.limit ?? plan?.limits.monthlyCredits;
  // an unlimited plan (-1) has no pill
  if (used === undefined || limit === undefined || limit < 0) return null;
  const level = q.data ? levelOf(q.data) : creditsLevel(used, limit);
  const pack = packLeft(q.data);
  const p = { used: formatNumber(used), limit: formatNumber(limit), pack: formatNumber(pack) };
  const text = pack > 0 ? t('topbar.creditsPacks', p) : t('topbar.credits', p);
  const title = level === 'exhausted' ? t('credits.pill.exhausted') : pack > 0 ? t('credits.pill.packs', p) : level === 'warning' ? t('credits.pill.warning') : t('credits.pill.title');
  return (
    <Link href="/settings/credits" aria-label={pack > 0 ? t('credits.pill.labelPacks', p) : t('credits.pill.label', p)} className="inline-flex rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-inbound">
      <CreditsPill text={text} level={level} title={title} />
    </Link>
  );
}

/** `credits100` (AI stopped) · `credits80` (warning with the projected date) · `negativeCredits` (store refund). */
export function useCreditsBanners(): ShellBanner[] {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const { can } = useSession();
  const q = useCredits();
  const c = q.data;
  const id = creditsBanner(c);
  if (!c || !id) return [];
  const used = formatNumber(c.plan.used);
  const limit = formatNumber(c.plan.limit);
  // "Acheter des crédits" opens the pack purchase for Owner / Admin (`billing.write`), the credits page otherwise
  const open = { label: t('action.buyCredits'), onClick: () => router.push(can('billing.write') ? '/settings/credits?buy=1' : '/settings/credits') };
  const see = () => router.push('/settings/credits');
  if (id === 'negativeCredits') return [{ id, tone: 'danger', content: t('banner.negativeCredits'), action: can('billing.write') ? open : { label: t('credits.banner.see'), onClick: see } }];
  if (id === 'credits100') return [{ id, tone: 'danger', content: t('banner.credits100', { used, limit, date: formatDate(c.plan.periodEnd, locale) }), action: open }];
  if (runningOnPacks(c)) return [{ id, tone: 'warning', content: t('banner.creditsPacks', { used, limit, pack: formatNumber(packLeft(c)), date: formatDate(c.plan.periodEnd, locale) }), action: { label: t('credits.banner.see'), onClick: see } }];
  return [{ id, tone: 'warning', content: t('banner.credits80', { used, limit, date: formatDate(warningDate(c), locale) }), action: { label: t('credits.banner.see'), onClick: see } }];
}

/**
 * WS `credits.updated { planUsed, planLimit, packBalance, exhausted }` (settle / release / grant / pack purchase /
 * period reset): the balance is patched in place; the ledger, the derived figures (ETA, burn rate) and the workspace
 * usage are refetched.
 */
export function useCreditsEvents() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  useWsEvent<WsCreditsUpdated>('credits.updated', (p) => {
    if (!p) return;
    qc.setQueryData<Credits>(creditKeys.balance(ws), (old) => (old ? applyCreditsEvent(old, p) : old));
    void qc.invalidateQueries({ queryKey: creditKeys.all(ws) });
    void qc.invalidateQueries({ queryKey: [ws, 'workspace'] });
    // the open conversation's « Reprendre l'IA » follows the balance (INSUFFICIENT_CREDITS descriptor, recette 11/11)
    if (p.exhausted !== undefined) void qc.invalidateQueries({ queryKey: [ws, 'conversation'] });
  });
}
