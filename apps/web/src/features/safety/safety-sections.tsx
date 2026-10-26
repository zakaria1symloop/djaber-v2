'use client';
// Settings › Sécurité — trust & safety part of the route (Figma "SAFE — Trust & safety (merchant)"):
// "Clients bloqués" (`GET /safety/blocks`, one explicit "Débloquer" per row — allowed exception to the Actions ⌄
// rule; platform rows are locked) and "Règles automatiques" (`GET|PUT /safety/rules`, `GET|PUT /safety/blocked-words`).
// Operators block and report; only Admin+ (`safety.manage`) unblocks and edits the rules.
import { BLOCKED_WORDS_MAX, DEFAULT_SAFETY_RULES, formatDate, formatPhoneDz, type AppLocale, type CustomerBlockView, type SafetyRules } from '@djaber/shared';
import { Button, Card, Checkbox, ConfirmDialog, FormAlert, Input, Ltr, NumberInput, Pagination, Pill, SearchInput, Select, Skeleton, StatusPill, toast, Tooltip } from '@djaber/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { ListFilteredEmpty, ListLoading, QueryError } from '@/components/global-states';
import { Section } from '@/features/settings/common';
import { usePathname, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { safetyApi, safetyKeys, type BlocksQuery } from './api';
import { BlockNumberDialog } from './dialogs';
import { addBlockedWords, AUTO_BLOCK_MAX, AUTO_BLOCK_MIN, isUnblockable, parseThreshold, setAutoBlock, setRiskRule } from './logic';

const SOURCES = ['manual', 'auto_rule', 'platform'] as const;

export function SafetySections() {
  const { can } = useSession();
  if (!can('safety.block')) return null;
  return (
    <>
      <BlockedCustomers />
      {can('safety.manage') ? <AutoRules /> : null}
    </>
  );
}

/* ---------- Clients bloqués ---------- */
function BlockedCustomers() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { can } = useSession();
  const canManage = can('safety.manage');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // list state in the URL: ?blockQ=&blockSource=&blockPage=
  const query = useMemo<BlocksQuery>(() => {
    const source = params.get('blockSource') ?? '';
    return { q: params.get('blockQ') ?? '', source: (SOURCES as readonly string[]).includes(source) ? source : undefined, page: Math.max(1, Number(params.get('blockPage')) || 1) };
  }, [params]);
  const setQuery = useCallback(
    (patch: Partial<BlocksQuery>) => {
      const next = { ...query, page: 1, ...patch };
      const p = new URLSearchParams(params.toString());
      const put = (k: string, v: string | undefined) => (v ? p.set(k, v) : p.delete(k));
      put('blockQ', next.q?.trim() || undefined);
      put('blockSource', next.source);
      put('blockPage', next.page && next.page > 1 ? String(next.page) : undefined);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [query, params, pathname, router],
  );
  const filtered = !!(query.q && query.q.trim().length >= 2) || !!query.source;

  const blocks = useQuery({ queryKey: safetyKeys.blocks(ws, query), queryFn: () => safetyApi.blocks(query), enabled: !!ws, placeholderData: keepPreviousData });
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<CustomerBlockView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unblock = useMutation({ mutationFn: safetyApi.unblock });

  const onUnblock = async () => {
    if (!target) return;
    setError(null);
    try {
      await unblock.mutateAsync(target.id);
      await qc.invalidateQueries({ queryKey: safetyKeys.blocks(ws) });
      toast(t('safety.unblock.done', { name: blockName(target, t('safety.blocks.noName')) }));
      setTarget(null);
    } catch (e) {
      setError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
    }
  };

  const rows = blocks.data?.rows ?? [];
  return (
    <Section title={t('safety.blocks.title')} description={t('safety.blocks.description')}>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query.q ?? ''} onChange={(q) => setQuery({ q })} placeholder={t('safety.blocks.search')} label={t('action.search')} clearLabel={t('action.clearFilters')} className="min-w-48 md:max-w-xs" />
        <Select aria-label={t('common.source')} className="!w-auto" value={query.source ?? ''} onChange={(e) => setQuery({ source: e.target.value || undefined })}>
          <option value="">{t('safety.blocks.allSources')}</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`safety.sourceOpt.${s}`)}
            </option>
          ))}
        </Select>
        <span className="flex-1" />
        <Button onClick={() => setAdding(true)} data-testid="block-number">
          {t('safety.blocks.add')}
        </Button>
      </div>

      {/* tester notes 25/10: what each source means (all three are used: members, the rule below, the Djaber blacklist) */}
      <p className="mt-2 ts-label-meta text-text-muted" data-testid="block-sources-hint">
        {t('safety.blocks.sourcesHint')}
      </p>
      <div className="mt-3">
        {blocks.isPending ? (
          <Card>
            <ListLoading rows={5} columns={3} />
          </Card>
        ) : blocks.isError ? (
          <QueryError error={blocks.error} onRetry={() => void blocks.refetch()} />
        ) : rows.length === 0 && filtered ? (
          <ListFilteredEmpty entity={t('safety.blocks.entity')} filters={[query.q?.trim() ? `« ${query.q.trim()} »` : null, query.source ? t(`safety.source.${query.source}`) : null].filter(Boolean).join(' · ')} onClear={() => setQuery({ q: '', source: undefined })} />
        ) : rows.length === 0 ? (
          <p className="rounded-card border border-line-edge px-3 py-6 text-center text-[13px] text-text-muted" data-testid="blocks-empty">
            {t('safety.blocks.empty')}
          </p>
        ) : (
          <Card>
            <ul className="divide-y divide-line-hairline" data-testid="blocks">
              {rows.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-3" data-block={b.id} data-source={b.source}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      {b.client?.name ? <span className="truncate font-medium">{b.client.name}</span> : null}
                      {blockPhone(b) ? (
                        <Ltr className="text-text-secondary">{formatPhoneDz(blockPhone(b)!)}</Ltr>
                      ) : null}
                      {!b.client?.name ? <span className="text-text-muted">{t('safety.blocks.noName')}</span> : null}
                    </div>
                    <div className="mt-1 ts-label-meta text-text-muted">
                      {[
                        b.reason ? t(`safety.blockReason.${b.reason}`) : null,
                        b.blockedBy
                          ? t('safety.blocks.blockedBy', { date: formatDate(b.blockedAt, locale), name: `${b.blockedBy.firstName} ${b.blockedBy.lastName}`.trim() })
                          : t(b.source === 'manual' ? 'safety.blocks.blockedOn' : 'safety.blocks.blockedAuto', { date: formatDate(b.blockedAt, locale) }),
                        b.reportStatus === 'open' || b.reportStatus === 'reviewing' ? t('safety.blocks.reported') : null,
                        b.note,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <StatusPill enumKey="CustomerBlock.source" value={b.source} className="!rounded-[4px]">
                    {t(`safety.source.${b.source}`)}
                    {b.source === 'platform' ? <Lock className="size-2.5" aria-hidden /> : null}
                  </StatusPill>
                  {!canManage ? null : isUnblockable(b) ? (
                    <Button variant="ghost" size="sm" onClick={() => setTarget(b)} data-testid="unblock">
                      {t('action.unblock')}
                    </Button>
                  ) : (
                    <Tooltip content={`${t('error.CUSTOMER_BLOCKED_BY_PLATFORM')} (CUSTOMER_BLOCKED_BY_PLATFORM)`}>
                      <span tabIndex={0} className="ts-label-meta uppercase text-text-muted" data-testid="unblock-locked">
                        {t('safety.blocks.locked')}
                      </span>
                    </Tooltip>
                  )}
                </li>
              ))}
            </ul>
            {(blocks.data?.total ?? 0) > (blocks.data?.pageSize ?? 25) ? (
              <Pagination
                page={blocks.data!.page}
                pageSize={blocks.data!.pageSize}
                total={blocks.data!.total}
                onPageChange={(page) => setQuery({ page })}
                labels={{ previous: t('action.previousPage'), next: t('action.nextPage'), perPage: (n) => t('common.perPage', { count: n }), range: (from, to, total) => t('common.rangeOf', { from, to, total }) }}
              />
            ) : null}
          </Card>
        )}
      </div>
      <p className="mt-3 ts-label-meta text-text-muted">{t('safety.block.roles')}</p>

      <BlockNumberDialog open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && !unblock.isPending && (setTarget(null), setError(null))}
        title={t('safety.unblock.title', { name: target ? blockName(target, t('safety.blocks.noName')) : '' })}
        description={t('safety.unblock.description')}
        confirmLabel={t('action.unblock')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        onConfirm={() => void onUnblock()}
        loading={unblock.isPending}
      >
        {error ? <FormAlert>{error}</FormAlert> : null}
      </ConfirmDialog>
    </Section>
  );
}

const blockPhone = (b: CustomerBlockView) => b.phone ?? b.client?.phone ?? null;
const blockName = (b: CustomerBlockView, fallback: string) => b.client?.name || (blockPhone(b) ? formatPhoneDz(blockPhone(b)!) : fallback);

/** Threshold of the auto-block rule (1–50 unclaimed parcels): saved when the field is left; kept while the rule is off. */
function ThresholdField({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (n: number) => void }) {
  const t = useT();
  const [digits, setDigits] = useState(String(value));
  const parsed = parseThreshold(digits);
  const invalid = parsed === null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="auto-block-threshold" className="ts-label-meta uppercase text-text-secondary">
        {t('safety.rules.autoBlock.threshold')}
      </label>
      <div className="w-16">
        <NumberInput
          id="auto-block-threshold"
          data-testid="auto-block-threshold"
          value={digits}
          onValueChange={setDigits}
          maxDigits={2}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'auto-block-threshold-error' : undefined}
          className="!h-8 text-center"
          onBlur={() => {
            if (parsed !== null && parsed !== value) onCommit(parsed);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </div>
      {invalid ? (
        <span id="auto-block-threshold-error" role="alert" className="text-[12px] text-accent-alert">
          {t('safety.rules.autoBlock.range', { min: AUTO_BLOCK_MIN, max: AUTO_BLOCK_MAX })}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- Règles automatiques + mots bloqués ---------- */
function AutoRules() {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { readOnly } = useSession();
  const rules = useQuery({ queryKey: safetyKeys.rules(ws), queryFn: safetyApi.rules, enabled: !!ws });
  const words = useQuery({ queryKey: safetyKeys.words(ws), queryFn: safetyApi.blockedWords, enabled: !!ws });
  const saveRules = useMutation({ mutationFn: safetyApi.saveRules });
  const saveWords = useMutation({ mutationFn: safetyApi.saveBlockedWords });
  const [draft, setDraft] = useState('');
  const [wordError, setWordError] = useState<string | null>(null);

  const onRules = async (next: SafetyRules) => {
    const previous = rules.data;
    qc.setQueryData(safetyKeys.rules(ws), next);
    try {
      qc.setQueryData(safetyKeys.rules(ws), await saveRules.mutateAsync(next));
      toast(t('toast.saved'));
    } catch (e) {
      qc.setQueryData(safetyKeys.rules(ws), previous);
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const onWords = async (next: string[]) => {
    setWordError(null);
    try {
      qc.setQueryData(safetyKeys.words(ws), await saveWords.mutateAsync(next));
      toast(t('toast.saved'));
      return true;
    } catch (e) {
      setWordError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
      return false;
    }
  };
  const addWords = async () => {
    const r = addBlockedWords(words.data?.words ?? [], draft);
    if (r.full) setWordError(t('safety.words.full', { max: BLOCKED_WORDS_MAX }));
    if (r.added === 0) return r.full ? undefined : setDraft('');
    if (await onWords(r.words)) setDraft('');
  };

  const r = rules.data;
  const locked = readOnly || saveRules.isPending;
  return (
    <Section title={t('safety.rules.title')}>
      {rules.isPending ? (
        <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : rules.isError || !r ? (
        <QueryError error={rules.error} onRetry={() => void rules.refetch()} />
      ) : (
        <div className="flex flex-col gap-3.5" data-testid="safety-rules">
          <label className="flex cursor-pointer items-center gap-3 text-[13px]">
            <Checkbox checked={r.riskAfterReturns > 0} disabled={locked} data-rule="riskAfterReturns" onChange={(e) => void onRules(setRiskRule(r, e.target.checked))} />
            <span>{t('safety.rules.riskAfterReturns', { count: r.riskAfterReturns || DEFAULT_SAFETY_RULES.riskAfterReturns })}</span>
          </label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex min-w-0 flex-1 basis-64 cursor-pointer items-center gap-3 text-[13px]">
              <Checkbox checked={r.autoBlockEnabled} disabled={locked} data-rule="autoBlockEnabled" onChange={(e) => void onRules(setAutoBlock(r, e.target.checked))} />
              <span>{t('safety.rules.autoBlock', { count: r.autoBlockAfterUncollected })}</span>
            </label>
            <ThresholdField key={r.autoBlockAfterUncollected} value={r.autoBlockAfterUncollected} disabled={locked} onCommit={(n) => void onRules({ ...r, autoBlockAfterUncollected: n })} />
          </div>
          <label className="flex cursor-pointer items-center gap-3 text-[13px]">
            <Checkbox checked={r.handoffOnRisk} disabled={locked} data-rule="handoffOnRisk" onChange={(e) => void onRules({ ...r, handoffOnRisk: e.target.checked })} />
            <span>{t('safety.rules.handoffOnRisk')}</span>
          </label>
        </div>
      )}

      <div className="mt-5 border-t border-line-hairline pt-4">
        <h3 className="text-[13px] font-medium">{t('safety.words.title')}</h3>
        <p className="mt-1 ts-label-meta text-text-muted">{t('safety.words.note')}</p>
        {words.isPending ? (
          <Skeleton className="mt-3 h-8 w-1/2" />
        ) : words.isError ? (
          <div className="mt-3">
            <QueryError error={words.error} onRetry={() => void words.refetch()} />
          </div>
        ) : (
          <>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('safety.words.title')} data-testid="blocked-words">
              {words.data.words.map((w) => (
                <li key={w}>
                  <Pill className="!normal-case gap-1 rounded-[4px] text-text-primary">
                    <bdi>{w}</bdi>
                    <button type="button" aria-label={t('safety.words.remove', { word: w })} disabled={readOnly || saveWords.isPending} onClick={() => void onWords(words.data.words.filter((x) => x !== w))} className="text-text-muted hover:text-text-primary">
                      <X className="size-3" aria-hidden />
                    </button>
                  </Pill>
                </li>
              ))}
              {words.data.words.length === 0 ? <li className="text-[13px] text-text-muted">{t('safety.words.empty')}</li> : null}
            </ul>
            <form
              className="mt-3 flex max-w-md items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addWords();
              }}
            >
              <Input aria-label={t('safety.words.add')} placeholder={t('safety.words.placeholder')} value={draft} maxLength={200} disabled={readOnly || saveWords.isPending} onChange={(e) => setDraft(e.target.value)} />
              <Button type="submit" loading={saveWords.isPending} disabled={readOnly || !draft.trim()}>
                {t('action.add')}
              </Button>
            </form>
            {wordError ? <FormAlert className="mt-3">{wordError}</FormAlert> : null}
          </>
        )}
      </div>
    </Section>
  );
}
