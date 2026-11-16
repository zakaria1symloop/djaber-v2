'use client';
// Small display pieces of the clients screens: list pill (FIABLE · INCONNU · RISQUE · BLOQUÉ · À COMPLÉTER), source
// pill (IA / MANUEL / IMPORT / API), phone, relative dates, avatar initials.
import { formatDate, formatPhoneDz, type AppLocale } from '@djaber/shared';
import { Avatar, Ltr, StatusPill } from '@djaber/ui';
import { useLocaleCode, useT } from '@/lib/i18n';
import type { ClientListItem } from './contracts';
import { CLIENT_PILL_VIEW, clientPill } from './spec';

export function ClientPillView({ client }: { client: Parameters<typeof clientPill>[0] }) {
  const t = useT();
  const pill = clientPill(client);
  if (!pill) return null;
  const v = CLIENT_PILL_VIEW[pill];
  return (
    <span data-pill={pill} className="inline-flex">
      <StatusPill enumKey={v.enumKey} value={v.value} className="!rounded-[4px]">
        {t(v.key)}
      </StatusPill>
    </span>
  );
}

export function ClientSourcePill({ source }: { source: ClientListItem['source'] }) {
  const t = useT();
  return (
    <StatusPill enumKey="Client.source" value={source} className="!rounded-[4px] whitespace-nowrap">
      {t(`clients.source.${source}`)}
    </StatusPill>
  );
}

/** `0555 12 34 56` (LTR) or `—`. */
export function Phone({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-text-muted">—</span>;
  return <Ltr className={className ?? 'whitespace-nowrap tabular-nums'}>{formatPhoneDz(value)}</Ltr>;
}

/** "2 oct." — day + month of the last order (Africa/Algiers); `—` when never. */
export function ShortDate({ iso }: { iso: string | null | undefined }) {
  const locale = useLocaleCode() as AppLocale;
  if (!iso) return <span className="text-text-muted">—</span>;
  const full = formatDate(iso, locale);
  return (
    <span className="ts-label-meta whitespace-nowrap uppercase text-text-muted" title={full}>
      {full.split(' ').slice(0, 2).join(' ')}
    </span>
  );
}

export function ClientAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return <Avatar name={name} size={size} />;
}
