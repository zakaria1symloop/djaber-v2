'use client';
// One hook for the client `Actions ⌄` (list rows, side sheet, full page): handlers, dialogs and their outcomes.
import { toast, type MenuAction } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useConfirmAction } from '@/components/confirm-action';
import { safetyApi, safetyKeys } from '@/features/safety/api';
import { BlockCustomerDialog } from '@/features/safety/dialogs';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { clientsApi, useClientsExport, useClientsRefresh } from './api';
import { clientMenuActions } from './client-actions';
import type { Client, ClientListItem } from './contracts';
import { ClientFormDialog, DeleteClientDialog, MergeClientsDialog, TagsDialog } from './dialogs';

type Row = ClientListItem | Client;
const isFull = (c: Row): c is Client => 'addresses' in c;

export function useClientActions(o: { openSheet: (id: string) => void; afterDelete?: (id: string) => void; knownTags?: string[] }) {
  const t = useT();
  const router = useRouter();
  const { can } = useSession();
  const refresh = useClientsRefresh();
  const exportClients = useClientsExport();
  const [form, setForm] = useState<{ client: Client | null } | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [merge, setMerge] = useState<Row | null>(null);
  const [tags, setTags] = useState<Row | null>(null);
  const [blockFor, setBlockFor] = useState<Row | null>(null);
  const confirm = useConfirmAction();
  const qc = useQueryClient();
  const ws = useWorkspaceId();

  const perms = { write: can('clients.write'), remove: can('clients.delete'), orders: can('orders.read'), ordersWrite: can('orders.write'), inbox: can('inbox.read') };
  const fail = (e: unknown) => toast({ tone: 'danger', message: e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t) });

  const edit = async (c: Row) => {
    try {
      setForm({ client: isFull(c) ? c : await clientsApi.client(c.id) });
    } catch (e) {
      fail(e);
    }
  };
  const risk = async (c: Row) => {
    const next = c.riskLevel === 'high' ? 'normal' : 'high';
    try {
      await clientsApi.risk(c.id, next);
      await refresh({ clientId: c.id });
      toast(t(next === 'high' ? 'clients.toast.markedRisk' : 'clients.toast.markedReliable', { name: c.name }));
    } catch (e) {
      fail(e);
    }
  };

  // UX-015: unblock from the list — the block id is in the detail view only
  const unblock = (c: Row) =>
    confirm.ask({
      title: t('safety.unblock.title', { name: c.name }),
      description: t('safety.unblock.description'),
      confirmLabel: t('clients.action.unblock'),
      run: async () => {
        try {
          const full = isFull(c) ? c : await clientsApi.client(c.id);
          if (!full.block) return void (await refresh({ clientId: c.id }));
          await safetyApi.unblock(full.block.id);
          void qc.invalidateQueries({ queryKey: safetyKeys.blocks(ws) });
          await refresh({ clientId: c.id });
          toast(t('safety.unblock.done', { name: c.name }));
        } catch (e) {
          fail(e);
        }
      },
    });

  const menu = (c: Row, opts: { sheet?: boolean } = {}): MenuAction[] => {
    const conversationId = isFull(c) ? (c.conversations[0]?.id ?? null) : null;
    return clientMenuActions(
      c,
      {
        open: () => o.openSheet(c.id),
        edit: () => void edit(c),
        complete: () => void edit(c),
        merge: () => setMerge(c),
        openConversation: conversationId ? () => router.push(`/inbox/${conversationId}`) : undefined,
        newOrder: () => router.push(`/orders/new?clientId=${c.id}`),
        orders: () => router.push(`/orders?clientId=${c.id}`),
        tags: () => setTags(c),
        export: () => void exportClients(() => clientsApi.bulkExport([c.id])),
        risk: () => void risk(c),
        block: () => setBlockFor(c),
        unblock: () => unblock(c),
        delete: () => setDel(c),
      },
      perms,
      t,
      opts,
    );
  };

  const dialogs: ReactNode = (
    <>
      <ClientFormDialog
        open={!!form}
        client={form?.client ?? null}
        onClose={() => setForm(null)}
        onSaved={(saved) => {
          setForm(null);
          o.openSheet(saved.id);
        }}
        onUseExisting={(id) => {
          setForm(null);
          o.openSheet(id);
        }}
      />
      <DeleteClientDialog
        client={del ? { id: del.id, name: del.name, orderCount: del.orderCount, blocked: del.blocked, conversations: isFull(del) ? del.metrics.conversations : undefined } : null}
        onClose={() => setDel(null)}
        onDone={() => {
          const id = del?.id;
          setDel(null);
          if (id) o.afterDelete?.(id);
        }}
      />
      <MergeClientsDialog
        client={merge}
        onClose={() => setMerge(null)}
        onDone={(keptId) => {
          setMerge(null);
          o.openSheet(keptId);
        }}
      />
      <BlockCustomerDialog
        open={!!blockFor}
        clientId={blockFor?.id}
        clientName={blockFor?.name ?? ''}
        onClose={() => setBlockFor(null)}
        onDone={() => {
          if (blockFor) void refresh({ clientId: blockFor.id });
        }}
      />
      {confirm.element}
      <TagsDialog
        ids={tags ? [tags.id] : null}
        known={[...new Set([...(o.knownTags ?? []), ...(tags?.tags ?? [])])]}
        onClose={() => setTags(null)}
        onDone={(r) => {
          setTags(null);
          if (r.failed === 0) toast(t('clients.toast.tagsSaved', { name: tags?.name ?? '' }));
          else toast({ tone: 'danger', message: r.results.find((x) => !x.ok)?.error?.message ?? t('state.list.error.title') });
        }}
      />
    </>
  );
  return { menu, openNew: () => setForm({ client: null }), edit: (c: Row) => void edit(c), dialogs, perms };
}
