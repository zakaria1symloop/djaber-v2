'use client';
// Small shared pieces of ADM-10: labels of trust levels / AI flags / decisions, the queue row of an item.
import type { ModerationAiFlagView, ModerationItemDto } from '@djaber/shared';
import { ActionsMenu, IconButton, ModerationRow, type MenuAction } from '@djaber/ui';
import { Check, X } from 'lucide-react';
import { reasonText } from '@/lib/actions';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { decisionState, formatScore, formatWaiting, scoreTone } from './logic';

export const trustLabel = (t: TFunction, level: string | null | undefined) => (level && t.has(`adminMod.trust.${level}`) ? t(`adminMod.trust.${level}`) : (level ?? '—'));

/** AI flag sentence: the label of its code with the matched value, or the server message when it is an i18n key. */
export function flagText(t: TFunction, f: ModerationAiFlagView): string {
  if (f.message && t.has(f.message)) return t(f.message);
  const label = t.has(`adminMod.flag.${f.code}`) ? t(`adminMod.flag.${f.code}`) : f.code;
  // the pre-screen puts the matched value in `message` (brand, word): "Marque protégée (dior)"
  return f.message && f.message !== f.code ? `${label} (${f.message})` : label;
}
/** "IA : Marque protégée dans le titre · prix 1 800 DA (−80 % vs référence)"; failed pre-screen ⇒ "pré-filtrage indisponible". */
export function aiReason(t: TFunction, item: Pick<ModerationItemDto, 'aiFlags' | 'aiScore'>): string | null {
  const flags = item.aiFlags.map((f) => flagText(t, f));
  if (item.aiScore === null && !item.aiFlags.some((f) => f.code === 'prescreen_unavailable')) flags.unshift(t('adminMod.flag.prescreen_unavailable'));
  return flags.length ? t('adminMod.row.ai', { reasons: flags.join(' · ') }) : null;
}
export const itemTitle = (t: TFunction, item: Pick<ModerationItemDto, 'product' | 'agent' | 'category' | 'type'>) =>
  item.product?.name ?? item.agent?.name ?? item.category?.name ?? t(`adminMod.type.${item.type}`);
export const decisionLabel = (t: TFunction, d: string | null | undefined) => (d && t.has(`adminMod.decision.${d}`) ? t(`adminMod.decision.${d}`) : (d ?? '—'));

/** Row of the queue (À vérifier, Urgents, Rejetés, Auto-approuvés, Agents IA): ✓ approve · ✕ reject · ⋯ menu. */
export function ItemRow({
  item,
  active,
  selected,
  onToggle,
  onOpen,
  onApprove,
  onReject,
  menu,
  canWrite,
}: {
  item: ModerationItemDto;
  active: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
  menu: MenuAction[];
  canWrite: boolean;
}) {
  const t = useT();
  const locale = useLocaleCode();
  const title = itemTitle(t, item);
  const approve = decisionState(item, 'approve', canWrite);
  const reject = decisionState(item, 'reject', canWrite);
  const thumb = item.product?.images[0]?.url;
  return (
    <ModerationRow
      data-testid="mod-row"
      data-id={item.id}
      data-status={item.status}
      active={active}
      selection={onToggle ? { checked: !!selected, onChange: onToggle, label: t('adminMod.row.select', { name: title }) } : undefined}
      thumbnail={thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <span aria-hidden className="block size-full" />}
      title={title}
      urgentLabel={item.priority === 'urgent' || item.slaBreached ? t('enum.Admin.urgent') : undefined}
      // retest 12/11 (Badro): each row says what is reviewed — « Nom d'agent », « Produit », « Prompt d'agent »…
      meta={`${t(`adminMod.type.${item.type}`)} · ${item.workspace.name} · ${t('adminMod.row.trust', { level: trustLabel(t, item.workspace.trustLevel) })}`}
      reason={aiReason(t, item)}
      score={formatScore(item.aiScore, locale)}
      scoreTone={scoreTone(item.aiScore)}
      scoreMeta={t('adminMod.row.scoreMeta', { time: formatWaiting(item.waitingMinutes) })}
      onOpen={onOpen}
      actions={
        <>
          {canWrite ? (
            <>
              <IconButton size="sm" label={t('adminMod.action.approve')} onClick={onApprove} disabledReason={approve.enabled ? undefined : reasonText(t, approve.reasonCode)} data-testid="mod-row-approve">
                <Check className="size-4 text-accent-money" aria-hidden />
              </IconButton>
              <IconButton size="sm" label={t('adminMod.action.reject')} onClick={onReject} disabledReason={reject.enabled ? undefined : reasonText(t, reject.reasonCode)} data-testid="mod-row-reject">
                <X className="size-4 text-accent-alert" aria-hidden />
              </IconButton>
            </>
          ) : null}
          <ActionsMenu iconOnly label={t('action.actions')} heading={title} actions={menu} />
        </>
      }
    />
  );
}
