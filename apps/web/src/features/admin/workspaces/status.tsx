'use client';
// ADM-02 status pill (12 §26): SUSPENDU / SUPPRESSION J+30 (Workspace.status, admin action) win over the subscription
// state ESSAI / ACTIF / RELANCE / EXPIRÉ (limites du plan gratuit) / RÉSILIÉ.
import type { AdminWorkspaceRowDto } from '@djaber/shared';
import { useT } from '@/lib/i18n';
import { AdminPill } from '../ui';

export const workspacePill = (ws: Pick<AdminWorkspaceRowDto, 'status' | 'subscriptionStatus'>): { group: string; value: string; key: string } =>
  ws.status !== 'active'
    ? { group: 'Workspace.status', value: ws.status, key: `enum.Workspace.status.${ws.status}` }
    : { group: 'Subscription.status', value: ws.subscriptionStatus, key: `enum.Subscription.status.${ws.subscriptionStatus}` };

/**
 * Columns of the list: « Statut » = the workspace status of every row (ACTIF / SUSPENDU / SUPPRESSION J+30), the value the
 * « Statut » filter uses (tester log 26/10 UX-041); « Abonnement » = the subscription state only (tester report 22/10
 * UX-016 had both in one column).
 */
export function WorkspaceStateCell({ ws }: { ws: Pick<AdminWorkspaceRowDto, 'status'> }) {
  const t = useT();
  return (
    <AdminPill group="Workspace.status" value={ws.status}>
      {t(`enum.Workspace.status.${ws.status}`)}
    </AdminPill>
  );
}

export function WorkspaceSubscriptionCell({ ws }: { ws: Pick<AdminWorkspaceRowDto, 'subscriptionStatus'> }) {
  const t = useT();
  return (
    <AdminPill group="Subscription.status" value={ws.subscriptionStatus}>
      {t(`enum.Subscription.status.${ws.subscriptionStatus}`)}
    </AdminPill>
  );
}

export function WorkspaceStatusPill({ ws }: { ws: Pick<AdminWorkspaceRowDto, 'status' | 'subscriptionStatus'> }) {
  const t = useT();
  const p = workspacePill(ws);
  return (
    <AdminPill group={p.group} value={p.value}>
      {t(p.key)}
    </AdminPill>
  );
}
