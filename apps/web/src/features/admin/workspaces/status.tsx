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
 * Column « Abonnement » of the list (tester report 22/10 UX-016: the « Statut » filter is the workspace status, the column
 * showed the subscription under the same name): the subscription pill, after the workspace pill when it is not active.
 */
export function WorkspaceSubscriptionCell({ ws }: { ws: Pick<AdminWorkspaceRowDto, 'status' | 'subscriptionStatus'> }) {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {ws.status !== 'active' ? <WorkspaceStatusPill ws={ws} /> : null}
      <AdminPill group="Subscription.status" value={ws.subscriptionStatus}>
        {t(`enum.Subscription.status.${ws.subscriptionStatus}`)}
      </AdminPill>
    </span>
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
