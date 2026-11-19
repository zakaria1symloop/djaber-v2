'use client';
// ADM-11 header sheets (03 SAFE-06/07/08): "Mots bloqués" = the platform list (`GET|PUT /admin/blocked-words`, an AI reply
// containing one is never sent) and "Règles automatiques" = the read-only rules of `sched-abuse-auto-rules`, the
// platform blacklist they feed (`GET|POST /admin/blacklist`, `DELETE /admin/blacklist/:id { reason }`) and the monthly
// compliance export for the stores (`GET /admin/safety/export?month` → 202 job).
import { formatDateTime, formatNumber, type AppLocale, type BlacklistRowDto, type PlatformBlockedWordDto } from '@djaber/shared';
import { Button, FormAlert, IconButton, Input, Ltr, PhoneInput, SideSheet, Skeleton, toast, updateToast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AdminQueryError } from '@/features/admin/admin-page';
import { AdminDialog, ReasonField, reasonOk, useOnOpen } from '@/features/admin/dialog-kit';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { safetyApi, useAutoRules, useBlacklist, useBlockedWords, useSafetyRefresh } from './api';
import { previousMonth } from './logic';
import { formatPhoneOnBlur, phonePreviewLine } from '@/lib/phone';

/* ---------- Mots bloqués ---------- */
export function BlockedWordsSheet({ open, onClose, canWrite }: { open: boolean; onClose: () => void; canWrite: boolean }) {
  const t = useT();
  const q = useBlockedWords(open);
  const refresh = useSafetyRefresh();
  const [words, setWords] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const initial = (q.data ?? []).map((w: PlatformBlockedWordDto) => w.word);
  // (re)opening the sheet starts from the saved list: closing it drops the unsaved edits
  useEffect(() => {
    if (open && q.data) setWords(q.data.map((w) => w.word));
  }, [open, q.data]);
  const dirty = JSON.stringify([...words].sort()) !== JSON.stringify([...initial].sort());
  const { guard } = useLeaveGuard(open && dirty, t('adminSafety.header.words'));
  const save = useMutation({ mutationFn: () => safetyApi.saveWords({ words: words.map((word) => ({ word })), reason: reason.trim() || undefined }) });
  const add = () => {
    const w = draft.trim().toLowerCase();
    if (w && !words.includes(w)) setWords([...words, w]);
    setDraft('');
  };
  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync();
      setReason('');
      void refresh();
      toast({ tone: 'success', message: t('adminSafety.words.saved', { count: words.length }) });
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={t('adminSafety.header.words')}
      subtitle={t('adminSafety.words.subtitle')}
      width={460}
      closeLabel={t('action.close')}
      footer={
        canWrite ? (
          <Button variant="primary" onClick={() => void submit()} loading={save.isPending} disabled={!dirty} data-testid="words-save">
            {t('action.save')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3" data-testid="blocked-words">
        {q.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : q.isError ? (
          <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            {canWrite ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  add();
                }}
              >
                <Input aria-label={t('adminSafety.words.add')} placeholder={t('adminSafety.words.add')} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} data-testid="word-input" />
                <Button type="submit" disabled={!draft.trim()}>
                  {t('action.add')}
                </Button>
              </form>
            ) : null}
            {words.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {words.map((w) => (
                  <li key={w} className="inline-flex items-center gap-1 rounded-full border border-line-hairline px-2.5 py-1 text-[13px]" data-testid="word">
                    {w}
                    {canWrite ? (
                      <button type="button" aria-label={t('adminSafety.words.remove', { word: w })} onClick={() => setWords(words.filter((x) => x !== w))} className="text-text-muted hover:text-text-primary">
                        <X className="size-3" aria-hidden />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-text-muted">{t('adminSafety.words.empty')}</p>
            )}
            {canWrite && dirty ? <Input aria-label={t('adminSafety.words.reason')} placeholder={t('adminSafety.words.reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /> : null}
            {error ? <FormAlert>{error}</FormAlert> : null}
            <p className="ts-label-micro text-text-muted">{t('adminSafety.words.note')}</p>
          </>
        )}
      </div>
      {guard}
    </SideSheet>
  );
}

/* ---------- Règles automatiques + liste noire + export ---------- */
export function AutoRulesSheet({ open, onClose, canWrite }: { open: boolean; onClose: () => void; canWrite: boolean }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const rules = useAutoRules(open);
  const [page, setPage] = useState(1);
  const blacklist = useBlacklist({ page, pageSize: 25, active: true }, open);
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<BlacklistRowDto | null>(null);
  const [month, setMonth] = useState(previousMonth());
  const [exporting, setExporting] = useState(false);
  /** 202 job → polls `GET /admin/safety/export/:jobId` with a progress toast, then the download link (24 h). */
  const exportMonth = async () => {
    setExporting(true);
    let id: number | null = null;
    try {
      const { jobId } = await safetyApi.exportMonth(month);
      id = toast({ tone: 'info', message: t('adminSafety.export.running', { month }), progress: null, durationMs: 0 });
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, i < 5 ? 800 : 2000));
        const job = await safetyApi.exportJob(jobId);
        if (job.status === 'queued' || job.status === 'running') {
          updateToast(id, { progress: job.progress || null });
          continue;
        }
        const url = job.resultUrl;
        if (job.status === 'done' || job.status === 'partial') {
          updateToast(id, { tone: 'success', message: t('adminSafety.export.done', { month }), progress: undefined, durationMs: 15_000, action: url ? { label: t('action.download'), onClick: () => window.open(url, '_blank', 'noopener') } : undefined });
        } else updateToast(id, { tone: 'danger', message: t(`error.${job.error?.code ?? 'REPORT_EXPORT_FAILED'}`, { ref: jobId.slice(0, 8) }), progress: undefined, durationMs: 8000 });
        return;
      }
    } catch (e) {
      if (id !== null) updateToast(id, { tone: 'danger', message: errorMessage(e, t), progress: undefined, durationMs: 8000 });
      else toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <SideSheet open={open} onClose={onClose} title={t('adminSafety.header.rules')} subtitle={t('adminSafety.rules.subtitle')} width={460} closeLabel={t('action.close')}>
      <div className="flex flex-col gap-6" data-testid="auto-rules">
        <section className="flex flex-col gap-2">
          {rules.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : rules.isError ? (
            <AdminQueryError error={rules.error} onRetry={() => void rules.refetch()} />
          ) : (
            <ul className="flex flex-col divide-y divide-line-hairline rounded-card border border-line-edge">
              {(rules.data ?? []).map((r) => (
                <li key={r.key} className="px-3 py-2.5" data-testid="auto-rule">
                  <div className="text-[14px]">{t(`adminSafety.rule.${r.key}`, { threshold: r.threshold, days: r.windowDays })}</div>
                  <div className="mt-0.5 ts-label-micro text-text-muted">
                    {t('adminSafety.rules.hits', { count: formatNumber(r.hits30d), countN: r.hits30d })}
                    {r.lastRunAt ? ` · ${t('adminSafety.rules.lastRun', { date: formatDateTime(r.lastRunAt, locale) })}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="ts-label-section uppercase text-text-muted">{t('adminSafety.blacklist.title')}</h3>
            {canWrite ? (
              <Button size="sm" onClick={() => setAdding(true)} data-testid="blacklist-add">
                {t('adminSafety.blacklist.add')}
              </Button>
            ) : null}
          </div>
          {blacklist.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : blacklist.isError ? (
            <AdminQueryError error={blacklist.error} onRetry={() => void blacklist.refetch()} />
          ) : (blacklist.data?.rows ?? []).length === 0 ? (
            <p className="text-[13px] text-text-muted">{t('adminSafety.blacklist.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line-hairline rounded-card border border-line-edge">
              {(blacklist.data?.rows ?? []).map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-3 py-2" data-testid="blacklist-row">
                  <div className="min-w-0 flex-1">
                    <Ltr className="text-[14px]">{b.phone}</Ltr>
                    <div className="truncate ts-label-micro text-text-muted">{[b.reason, t('adminSafety.blacklist.workspaces', { count: b.workspaceCount }), formatDateTime(b.createdAt, locale)].join(' · ')}</div>
                  </div>
                  {canWrite ? (
                    <IconButton size="sm" variant="ghost" label={t('adminSafety.blacklist.revoke')} onClick={() => setRevoking(b)}>
                      <X className="size-3.5" aria-hidden />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {(blacklist.data?.total ?? 0) > 25 ? (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('action.previousPage')}
              </Button>
              <Button size="sm" variant="ghost" disabled={page * 25 >= (blacklist.data?.total ?? 0)} onClick={() => setPage(page + 1)}>
                {t('action.nextPage')}
              </Button>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="ts-label-section uppercase text-text-muted">{t('adminSafety.export.title')}</h3>
          <div className="flex items-end gap-2">
            <Input type="month" aria-label={t('adminSafety.export.month')} value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
            <Button onClick={() => void exportMonth()} loading={exporting} disabled={!/^\d{4}-\d{2}$/.test(month)} data-testid="safety-export">
              {t('action.export')}
            </Button>
          </div>
          <p className="ts-label-micro text-text-muted">{t('adminSafety.export.note')}</p>
        </section>
      </div>
      <BlacklistAddDialog open={adding} onClose={() => setAdding(false)} />
      <BlacklistRevokeDialog row={revoking} onClose={() => setRevoking(null)} />
    </SideSheet>
  );
}

function BlacklistAddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const refresh = useSafetyRefresh();
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useOnOpen(open, () => {
    setPhone('');
    setReason('');
    setError(null);
  });
  const send = useMutation({ mutationFn: () => safetyApi.addBlacklist({ phone: phone.trim(), reason: reason.trim() }) });
  const submit = async () => {
    setError(null);
    try {
      await send.mutateAsync();
      void refresh();
      toast({ tone: 'success', message: t('adminSafety.blacklist.added') });
      onClose();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <AdminDialog open={open} onClose={onClose} title={t('adminSafety.blacklist.add')} context={t('adminSafety.blacklist.context')} submitLabel={t('adminSafety.blacklist.addSubmit')} onSubmit={() => void submit()} destructive pending={send.isPending} disabled={!phone.trim() || !reasonOk(reason)} error={error} testId="blacklist-add-dialog">
      <PhoneInput aria-label={t('adminSafety.blacklist.phone')} placeholder="0550 12 34 56" autoComplete="off" value={phone} format={formatPhoneOnBlur} onChange={(e) => setPhone(e.target.value)} maxLength={30} preview={phonePreviewLine(t, phone)} />
      <ReasonField value={reason} onChange={setReason} />
    </AdminDialog>
  );
}

function BlacklistRevokeDialog({ row, onClose }: { row: BlacklistRowDto | null; onClose: () => void }) {
  const t = useT();
  const refresh = useSafetyRefresh();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useOnOpen(!!row, () => {
    setReason('');
    setError(null);
  });
  const send = useMutation({ mutationFn: () => safetyApi.revokeBlacklist(row!.id, reason.trim()) });
  const submit = async () => {
    setError(null);
    try {
      await send.mutateAsync();
      void refresh();
      toast({ tone: 'success', message: t('adminSafety.blacklist.revoked') });
      onClose();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <AdminDialog open={!!row} onClose={onClose} title={t('adminSafety.blacklist.revokeTitle')} context={row?.phone} submitLabel={t('adminSafety.blacklist.revoke')} onSubmit={() => void submit()} pending={send.isPending} disabled={!reasonOk(reason)} error={error} testId="blacklist-revoke-dialog">
      <ReasonField value={reason} onChange={setReason} />
    </AdminDialog>
  );
}
