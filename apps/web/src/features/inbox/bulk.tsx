'use client';
// Inbox selection bar — Figma "DLG — Inbox & queue" (Actions groupées (sélection): Marquer résolues · Archiver ·
// Assigner · Reprendre l'IA · Bloquer les clients; "Résultat par conversation"). `POST /conversations/bulk/{action}`
// answers one result per conversation (never all-or-nothing): failures are listed with their code and can be retried.
import { BulkBar, Button, Dialog, FormAlert, Pill, Select, toast, type BulkAction } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useCredits } from '@/features/credits/api';
import { useMembers } from '@/features/workspace/api';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { inboxApi, useInboxRefresh, type BulkOutcome } from './api';
import type { InboxBulkAction } from './contracts';
import { userName } from './ui';

type Run = { action: InboxBulkAction; title: string; body: { assigneeId?: string | null }; outcome: BulkOutcome };

export function InboxBulkBar({ ids, names, visibleIds, onSelect, onClear }: { ids: string[]; names: Record<string, string>; visibleIds: string[]; onSelect: (ids: string[]) => void; onClear: () => void }) {
  const t = useT();
  const { me, can, readOnly } = useSession();
  const creditsOut = !!useCredits().data?.exhausted;
  const refresh = useInboxRefresh();
  const members = useMembers(true);
  const [busy, setBusy] = useState<InboxBulkAction | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [assign, setAssign] = useState(false);
  const [block, setBlock] = useState(false);
  const [assignee, setAssignee] = useState('me');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (assign || block) setError(null);
  }, [assign, block]);

  /** Runs one bulk action; resolves true when the request itself went through (per-item failures included). */
  const exec = async (action: InboxBulkAction, title: string, body: { assigneeId?: string | null } = {}, inDialog = false): Promise<boolean> => {
    setBusy(action);
    setError(null);
    try {
      const outcome = await inboxApi.bulk(action, { ids, ...body });
      void refresh();
      if (outcome.failed === 0) {
        toast(t('inbox.bulk.done', { count: outcome.ok }));
        onClear();
      } else {
        // the failed ones stay selected
        onSelect(outcome.results.filter((r) => !r.ok).map((r) => r.id));
        setRun({ action, title, body, outcome });
      }
      return true;
    } catch (e) {
      const text = e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t);
      if (inDialog) setError(text);
      else toast({ tone: 'danger', message: text });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const forbidden = readOnly ? `${t('error.READ_ONLY_MEMBER')} (READ_ONLY_MEMBER)` : undefined;
  const actions: BulkAction[] = [
    { key: 'resolve', label: t('action.markResolved'), onSelect: () => void exec('resolve', t('action.markResolved')), disabledReason: forbidden },
    { key: 'archive', label: t('action.archive'), onSelect: () => void exec('archive', t('action.archive')), disabledReason: forbidden },
    { key: 'assign', label: t('action.assign'), onSelect: () => setAssign(true), disabledReason: forbidden },
    { key: 'resume-ai', label: t('action.resumeAi'), onSelect: () => void exec('resume-ai', t('action.resumeAi')), disabledReason: forbidden ?? (creditsOut ? t('error.INSUFFICIENT_CREDITS') : undefined) },
    ...(can('safety.block') ? [{ key: 'block', label: t('inbox.bulk.block'), onSelect: () => setBlock(true), destructive: true, disabledReason: forbidden }] : []),
  ];
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => ids.includes(id));
  const assigneeId = assignee === 'me' ? (me?.id ?? null) : assignee === 'none' ? null : assignee;

  return (
    <div className="px-4 pb-3" data-testid="inbox-bulk">
      <BulkBar
        label={t('inbox.bulk.label')}
        summary={t('inbox.bulk.selected', { count: ids.length })}
        actions={actions.map((a) => ({ ...a, disabledReason: a.disabledReason ?? (busy ? t('common.saving') : undefined) }))}
        note={t('inbox.bulk.note')}
        selectAll={allVisible ? undefined : { label: t('action.selectAll', { count: visibleIds.length }), onSelect: () => onSelect(visibleIds) }}
        deselectLabel={t('action.deselect')}
        onDeselect={onClear}
      />

      <Dialog
        open={assign}
        onOpenChange={(o) => !o && busy !== 'assign' && setAssign(false)}
        title={t('dialog.assign.title')}
        description={t('inbox.bulk.selected', { count: ids.length })}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssign(false)} disabled={busy === 'assign'}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={busy === 'assign'}
              data-testid="bulk-assign-submit"
              onClick={async () => {
                if (await exec('assign', t('action.assign'), { assigneeId }, true)) setAssign(false);
              }}
            >
              {t('action.assignCount', { count: ids.length })}
            </Button>
          </>
        }
      >
        <label htmlFor="bulk-assignee" className="ts-label-meta uppercase text-text-secondary">
          {t('inbox.bulk.assignee')}
        </label>
        <Select id="bulk-assignee" className="mt-1.5" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={busy === 'assign'}>
          <option value="me">{t('action.assignMe')}</option>
          {(members.data ?? [])
            .filter((m) => m.user.id !== me?.id && !m.readOnly)
            .map((m) => (
              <option key={m.id} value={m.user.id}>
                {userName(m.user)}
              </option>
            ))}
          <option value="none">{t('action.unassign')}</option>
        </Select>
        {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
      </Dialog>

      <Dialog
        open={block}
        onOpenChange={(o) => !o && busy !== 'block' && setBlock(false)}
        title={t('inbox.bulk.block.title', { count: ids.length })}
        description={t('inbox.bulk.block.description')}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBlock(false)} disabled={busy === 'block'}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busy === 'block'}
              data-testid="bulk-block-submit"
              onClick={async () => {
                if (await exec('block', t('inbox.bulk.block'), {}, true)) setBlock(false);
              }}
            >
              {t('inbox.bulk.block')}
            </Button>
          </>
        }
      >
        {error ? <FormAlert>{error}</FormAlert> : null}
      </Dialog>

      <BulkResultDialog
        run={run}
        names={names}
        onClose={() => {
          // everything went through after a retry: the selection is released with the dialog (the bar lives on it)
          if (run?.outcome.failed === 0) onClear();
          setRun(null);
        }}
        onRetried={(outcome) => {
          void refresh();
          if (outcome.failed > 0) onSelect(outcome.results.filter((r) => !r.ok).map((r) => r.id));
          setRun((r) => (r ? { ...r, outcome } : r));
        }}
      />
    </div>
  );
}

/** "Résultat par conversation": OK / ERREUR code rows, "Réessayer les n erreurs", Fermer. */
function BulkResultDialog({ run, names, onClose, onRetried }: { run: Run | null; names: Record<string, string>; onClose: () => void; onRetried: (o: BulkOutcome) => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const failed = run?.outcome.results.filter((r) => !r.ok) ?? [];
  const retry = useMutation({ mutationFn: (ids: string[]) => inboxApi.bulk(run!.action, { ids, ...run!.body }) });
  const again = async () => {
    setError(null);
    try {
      const next = await retry.mutateAsync(failed.map((f) => f.id));
      // conversations that succeeded before stay OK; the retried ones take their new result
      const byId = new Map(next.results.map((r) => [r.id, r]));
      const results = run!.outcome.results.map((r) => byId.get(r.id) ?? r);
      onRetried({ results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
    } catch (e) {
      setError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
    }
  };
  return (
    <Dialog
      open={!!run}
      onOpenChange={(o) => !o && !retry.isPending && onClose()}
      title={run?.title ?? ''}
      description={run ? t('inbox.bulk.result.summary', { ok: run.outcome.ok, failed: run.outcome.failed }) : undefined}
      closeLabel={t('action.close')}
      footer={
        <>
          {failed.length ? (
            <Button onClick={() => void again()} loading={retry.isPending} data-testid="bulk-retry">
              {t('inbox.bulk.result.retry', { count: failed.length })}
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose} disabled={retry.isPending}>
            {t('action.close')}
          </Button>
        </>
      }
    >
      <ul className="max-h-72 divide-y divide-line-hairline overflow-y-auto" data-testid="bulk-results">
        {(run?.outcome.results ?? []).map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2 text-[13px]" data-ok={r.ok}>
            <Pill tone={r.ok ? 'success' : 'danger'} className="!rounded-[4px]">
              {r.ok ? t('inbox.bulk.result.ok') : t('inbox.bulk.result.error')}
            </Pill>
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {names[r.id] ?? r.id}
            </span>
            {r.error ? <span className="max-w-[55%] text-end ts-label-meta text-accent-alert">{`${r.error.message} (${r.error.code})`}</span> : null}
          </li>
        ))}
      </ul>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}
