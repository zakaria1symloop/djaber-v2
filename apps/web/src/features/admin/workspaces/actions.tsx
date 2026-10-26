'use client';
// ADM-02 row / sheet `Actions ⌄`: items from the server `actions` descriptors (D42), in the Figma menu order; a disabled
// one stays visible with its reason; keys the role does not hold are hidden (impersonate, credits, write keys).
import type { AdminWorkspaceRowDto } from '@djaber/shared';
import type { MenuAction } from '@djaber/ui';
import { useState } from 'react';
import { toMenuActions } from '@/lib/actions';
import { useT } from '@/lib/i18n';
import { usePlatform } from '../platform';
import { ChangePlanDialog, CreditsDialog, ExtendDialog, RemoveCreditsDialog, ImpersonateDialog, ReasonOnlyDialog, ScheduleDeletionDialog, SuspendDialog, TrustLevelDialog } from './dialogs';

export type WsDialog = 'impersonate' | 'change_plan' | 'add_credits' | 'remove_credits' | 'extend_trial' | 'suspend' | 'reactivate' | 'schedule_deletion' | 'cancel_deletion' | 'trust_level';

export function useWorkspaceActions({ openSheet }: { openSheet: (id: string) => void }) {
  const t = useT();
  const { can } = usePlatform();
  const [state, setState] = useState<{ kind: WsDialog; ws: AdminWorkspaceRowDto } | null>(null);
  const open = (kind: WsDialog, ws: AdminWorkspaceRowDto) => setState({ kind, ws });
  const close = () => setState(null);
  const write = can('admin.workspaces.write');

  const menu = (ws: AdminWorkspaceRowDto, o: { sheet?: boolean } = {}): MenuAction[] =>
    toMenuActions(
      ws.actions,
      {
        open: { label: t('admin.ws.action.open'), onSelect: () => openSheet(ws.id), hidden: o.sheet, local: true },
        impersonate: { label: t('admin.ws.action.impersonate'), onSelect: () => open('impersonate', ws), hidden: !can('admin.workspaces.impersonate') },
        change_plan: { label: t('admin.ws.action.change_plan'), onSelect: () => open('change_plan', ws), hidden: !write },
        add_credits: { label: t('admin.ws.action.add_credits'), onSelect: () => open('add_credits', ws), hidden: !can('admin.workspaces.credits') },
        remove_credits: { label: t('admin.ws.action.remove_credits'), onSelect: () => open('remove_credits', ws), hidden: !can('admin.billing.write') },
        extend_trial: { label: t('admin.ws.action.extend_trial'), onSelect: () => open('extend_trial', ws), hidden: !write },
        trust_level: { label: t('admin.ws.action.trust_level'), onSelect: () => open('trust_level', ws), hidden: !can('admin.moderation.write') },
        suspend: { label: t('admin.ws.action.suspend'), onSelect: () => open('suspend', ws), destructive: true, hidden: !write, separated: true },
        reactivate: { label: t('admin.ws.action.reactivate'), onSelect: () => open('reactivate', ws), hidden: !write, separated: true },
        schedule_deletion: { label: t('admin.ws.action.schedule_deletion'), onSelect: () => open('schedule_deletion', ws), destructive: true, hidden: !write },
        cancel_deletion: { label: t('admin.ws.action.cancel_deletion'), onSelect: () => open('cancel_deletion', ws), hidden: !write },
      },
      t,
    );

  const ws = state?.ws ?? null;
  const is = (k: WsDialog) => state?.kind === k;
  const dialogs = (
    <>
      <ImpersonateDialog ws={ws} open={is('impersonate')} onClose={close} />
      <ChangePlanDialog ws={ws} open={is('change_plan')} onClose={close} />
      <CreditsDialog ws={ws} open={is('add_credits')} onClose={close} />
      <RemoveCreditsDialog ws={ws} open={is('remove_credits')} onClose={close} />
      <ExtendDialog ws={ws} open={is('extend_trial')} onClose={close} />
      <TrustLevelDialog ws={ws} open={is('trust_level')} onClose={close} />
      <SuspendDialog ws={ws} open={is('suspend')} onClose={close} />
      <ReasonOnlyDialog ws={ws} open={is('reactivate')} onClose={close} kind="reactivate" />
      <ReasonOnlyDialog ws={ws} open={is('cancel_deletion')} onClose={close} kind="cancel_deletion" />
      <ScheduleDeletionDialog ws={ws} open={is('schedule_deletion')} onClose={close} />
    </>
  );
  return { menu, open, dialogs };
}
