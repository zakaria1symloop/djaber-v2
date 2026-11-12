'use client';
// Clients list — selection bar (Étiquettes · Exporter · Supprimer) and its dialogs. Bulk endpoints answer one result per
// client (never all-or-nothing): the result dialog lists OK / ERREUR code rows and can retry the errors (12 §19).
import { BulkBar, Button, Dialog, FormAlert, Pill, toast, type BulkAction } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { clientsApi, useClientsExport, useClientsRefresh, type BulkResponse } from './api';
import type { ClientListItem } from './contracts';
import { TagsDialog } from './dialogs';

type Outcome = { title: string; response: BulkResponse; retry: (ids: string[]) => Promise<BulkResponse> };

export function ClientsBulkBar({ rows, selected, total, knownTags, onSelectAllPage, onClear }: { rows: ClientListItem[]; selected: ReadonlySet<string>; total: number; knownTags: string[]; onSelectAllPage: () => void; onClear: () => void }) {
  const t = useT();
  const { can } = useSession();
  const refresh = useClientsRefresh();
  const exportClients = useClientsExport();
  const [dialog, setDialog] = useState<'tags' | 'delete' | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const ids = useMemo(() => [...selected], [selected]);
  // names of every row seen on screen: a deleted client leaves the list before the result dialog opens
  const seen = useRef<Record<string, string>>({});
  for (const r of rows) seen.current[r.id] = r.name;
  const writeReason = can('clients.write') ? undefined : t('toast.forbidden');
  const deleteReason = can('clients.delete') ? undefined : t('toast.forbidden');

  const done = async (title: string, response: BulkResponse, retry: Outcome['retry']) => {
    setDialog(null);
    await refresh();
    if (response.failed === 0) {
      toast(t('clients.bulk.done', { count: response.ok }));
      onClear();
    } else setOutcome({ title, response, retry });
  };
  const actions: BulkAction[] = [
    { key: 'tags', label: t('clients.bulk.tags'), onSelect: () => setDialog('tags'), disabledReason: writeReason },
    { key: 'export', label: t('action.export'), onSelect: () => void exportClients(() => clientsApi.bulkExport(ids)), disabledReason: deleteReason },
    { key: 'delete', label: t('action.delete'), onSelect: () => setDialog('delete'), destructive: true, disabledReason: deleteReason },
  ];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <>
      <BulkBar
        label={t('clients.bulk.label')}
        summary={t('clients.bulk.selected', { count: ids.length })}
        actions={actions}
        note={t('clients.bulk.note')}
        selectAll={allOnPage ? undefined : { label: t('action.selectAll', { count: Math.min(rows.length, total) }), onSelect: onSelectAllPage }}
        deselectLabel={t('action.deselect')}
        onDeselect={onClear}
      />
      <TagsDialog ids={dialog === 'tags' ? ids : null} known={knownTags} onClose={() => setDialog(null)} onDone={(r, retry) => void done(t('clients.bulk.tagsTitle', { count: ids.length }), r, retry)} />
      <BulkDeleteDialog open={dialog === 'delete'} ids={ids} onClose={() => setDialog(null)} onDone={(r) => void done(t('clients.bulk.deleteTitle', { count: ids.length }), r, (retryIds) => clientsApi.bulkDelete(retryIds))} />
      <BulkResultDialog
        outcome={outcome}
        names={seen.current}
        onClose={() => {
          setOutcome(null);
          onClear();
        }}
        onRetried={async (response) => {
          await refresh();
          setOutcome((o) => (o ? { ...o, response } : o));
        }}
      />
    </>
  );
}

function BulkDeleteDialog({ open, ids, onClose, onDone }: { open: boolean; ids: string[]; onClose: () => void; onDone: (r: BulkResponse) => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => clientsApi.bulkDelete(ids) });
  const run = async () => {
    setError(null);
    try {
      onDone(await m.mutateAsync());
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !m.isPending && onClose()}
      title={t('clients.bulk.deleteTitle', { count: ids.length })}
      description={t('clients.bulk.selected', { count: ids.length })}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            {t('action.cancel')}
          </Button>
          <Button variant="danger" onClick={() => void run()} loading={m.isPending} data-testid="bulk-submit">
            {t('action.delete')}
          </Button>
        </>
      }
    >
      <p className="ts-label-meta text-text-muted">{t('clients.bulk.deleteBody')}</p>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}

function BulkResultDialog({ outcome, names, onClose, onRetried }: { outcome: Outcome | null; names: Record<string, string>; onClose: () => void; onRetried: (r: BulkResponse) => Promise<void> }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const failed = outcome?.response.results.filter((r) => !r.ok) ?? [];
  const retry = useMutation({ mutationFn: (ids: string[]) => outcome!.retry(ids) });
  const again = async () => {
    setError(null);
    try {
      const next = await retry.mutateAsync(failed.map((f) => f.id));
      const byId = new Map(next.results.map((r) => [r.id, r]));
      const results = outcome!.response.results.map((r) => byId.get(r.id) ?? r);
      await onRetried({ results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <Dialog
      open={!!outcome}
      onOpenChange={(o) => !o && !retry.isPending && onClose()}
      title={outcome?.title ?? ''}
      description={outcome ? t('clients.bulk.result.summary', { ok: outcome.response.ok, failed: outcome.response.failed }) : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          {failed.length ? (
            <Button onClick={() => void again()} loading={retry.isPending}>
              {t('clients.bulk.result.retry', { count: failed.length })}
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose} disabled={retry.isPending}>
            {t('action.close')}
          </Button>
        </>
      }
    >
      <ul className="max-h-72 divide-y divide-line-hairline overflow-y-auto" data-testid="bulk-results">
        {(outcome?.response.results ?? []).map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2 text-[13px]" data-ok={r.ok}>
            <Pill tone={r.ok ? 'success' : 'danger'} className="!rounded-[4px]">
              {r.ok ? t('clients.bulk.result.ok') : t('clients.bulk.result.error')}
            </Pill>
            <span className="min-w-0 flex-1 truncate">{names[r.id] ?? r.id}</span>
            {r.error ? <span className="max-w-[55%] text-end ts-label-meta text-accent-alert">{r.error.message}</span> : null}
          </li>
        ))}
      </ul>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}
