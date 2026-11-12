'use client';
// /delivery/fees body — Figma "DLV-01/03 — Delivery — fee grid + couriers settings" (grid half) and
// "DLG — Orders, delivery & clients II — dialogs catalogue" (Grille des frais — actions). The client always pays this
// grid (D15); courier rates feed cost and margin and can be copied into the grid (DLV-07, M6). 69 rows, inline edit saved on blur, ↺ back to the default
// row, "Compléter les manquants", "Tout réinitialiser" (confirm), free-delivery rule (`Workspace.freeDeliveryThreshold`).
import { formatMoney, formatNumber } from '@djaber/shared';
import { Banner, Button, Card, ConfirmDialog, FeeCell, FreeDeliveryBar, IconButton, Ltr, RowSaveState, SearchInput, Skeleton, StatusPill, Switch, Td, Th, Table, Tooltip, toast, type CellState } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { conflictOf, usePatchWorkspace, useWorkspaceCache } from '@/features/workspace/api';
import { actionState, reasonText } from '@/lib/actions';
import type { WorkspaceDto } from '@/lib/contracts';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { FEE_ACTIONS } from '@/features/clients/action-keys';
import { deliveryApi, deliveryKeys, useCouriers, useFees, type FeeGrid } from './api';
import { CopyRatesDialog } from './copy-rates-dialog';
import type { FeeRule } from './contracts';
import { canReset, filterRows, freeRule, isChange, rowBody, seedCount, thresholdOnToggle, type FeeField } from './fee-logic';

export function FeeGridView() {
  const t = useT();
  const locale = useLocaleCode();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { can, workspace } = useSession();
  const editable = can('delivery.manage');
  const readOnlyReason = editable ? undefined : t('fees.readOnly');
  const fees = useFees();
  const [q, setQ] = useState('');
  const [states, setStates] = useState<Record<number, CellState>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [seeding, setSeeding] = useState<'fill' | 'reset' | null>(null);
  const patch = usePatchWorkspace();
  const writeWorkspace = useWorkspaceCache();
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const couriers = useCouriers(editable);
  const rateCouriers = (couriers.data ?? []).filter((c) => c.isActive && c.capabilities.rates);

  const rows = useMemo(() => filterRows(fees.data?.rows ?? [], q), [fees.data, q]);
  const meta = fees.data?.meta;
  const rule = freeRule(workspace?.freeDeliveryThreshold);

  const setRow = (row: FeeRule) => qc.setQueryData<FeeGrid>(deliveryKeys.fees(ws), (old) => (old ? { ...old, rows: old.rows.map((r) => (r.wilayaId === row.wilayaId ? row : r)) } : old));
  const mark = (id: number, s: CellState, error?: string) => {
    setStates((m) => ({ ...m, [id]: s }));
    setErrors((m) => {
      const next = { ...m };
      if (error) next[id] = error;
      else delete next[id];
      return next;
    });
  };
  const refreshCounters = () => qc.invalidateQueries({ queryKey: deliveryKeys.fees(ws) });

  const save = async (row: FeeRule, change: Partial<Pick<FeeRule, FeeField | 'isActive'>>) => {
    mark(row.wilayaId, 'saving');
    // optimistic: the typed value stays on screen while it is written
    setRow({ ...row, ...change });
    try {
      const saved = await deliveryApi.saveFee(row.wilayaId, rowBody(row, change));
      setRow(saved);
      mark(row.wilayaId, 'saved');
      void refreshCounters();
    } catch (e) {
      setRow(row);
      mark(row.wilayaId, 'error', errorMessage(e, t));
    }
  };
  const reset = async (row: FeeRule) => {
    mark(row.wilayaId, 'saving');
    try {
      setRow(await deliveryApi.resetFee(row.wilayaId));
      mark(row.wilayaId, 'saved');
      toast(t('fees.toast.rowReset', { wilaya: locale === 'ar' ? row.nameAr : row.nameFr }));
      void refreshCounters();
    } catch (e) {
      mark(row.wilayaId, 'idle');
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const seed = async (overwrite: boolean) => {
    const before = meta ?? { missing: 0, custom: 0 };
    setSeeding(overwrite ? 'reset' : 'fill');
    try {
      const grid = await deliveryApi.seedFees(overwrite);
      qc.setQueryData(deliveryKeys.fees(ws), grid);
      setStates({});
      setErrors({});
      const n = seedCount(before, grid.meta, overwrite);
      toast(overwrite ? t('fees.toast.resetAll') : n > 0 ? t('fees.toast.filled', { count: n }) : t('fees.toast.nothingMissing'));
      setConfirmReset(false);
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setSeeding(null);
    }
  };
  const setThreshold = async (threshold: number | null, version = workspace?.version) => {
    if (!workspace) return;
    setRuleError(null);
    try {
      await patch.mutateAsync({ freeDeliveryThreshold: threshold, version });
      toast(threshold === null ? t('fees.toast.freeOff') : t('fees.toast.freeOn', { amount: formatMoney(threshold) }));
    } catch (e) {
      // one field: on a version conflict the change is replayed on the fresh version
      const c = conflictOf<WorkspaceDto>(e);
      if (c?.current && version === workspace.version) {
        writeWorkspace(c.current);
        return setThreshold(threshold, c.current.version);
      }
      setRuleError(errorMessage(e, t));
    }
  };

  if (fees.isError) return <QueryError error={fees.error} onRetry={() => fees.refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} label={t('action.search')} placeholder={t('fees.search')} clearLabel={t('list.clearSearch')} className="max-w-80" />
        <span className="flex-1" />
        <Button onClick={() => void seed(false)} loading={seeding === 'fill'} disabledReason={readOnlyReason} disabled={!!seeding} data-testid="fees-fill">
          {t('fees.fillMissing')}
        </Button>
        {/* DLV-07: courier rates copied into the grid (`POST /delivery/fees/copy-from-courier`, diff preview) */}
        <Button variant="ghost" onClick={() => setCopying(true)} disabledReason={readOnlyReason ?? (rateCouriers.length ? undefined : t('fees.copyCourier.unavailable'))} data-testid="fees-copy">
          {rateCouriers.length === 1 ? t('fees.copyCourierNamed', { courier: rateCouriers[0]!.displayName }) : t('fees.copyCourier')}
        </Button>
        <Button onClick={() => setConfirmReset(true)} disabledReason={readOnlyReason} disabled={!!seeding} className="!border-accent-alert/60 !text-accent-alert hover:!border-accent-alert" data-testid="fees-reset-all">
          {t('fees.resetAll')}
        </Button>
      </div>

      {meta && meta.missing > 0 ? (
        <Banner tone="warning" action={editable ? { label: t('fees.fillMissing'), onClick: () => void seed(false) } : undefined}>
          {t('fees.missingBanner', { count: meta.missing })}
        </Banner>
      ) : null}

      <FreeDeliveryBar
        enabled={rule.enabled}
        onEnabledChange={(v) => void setThreshold(thresholdOnToggle(v, rule.amount))}
        amount={rule.amount}
        onAmountCommit={(n) => void setThreshold(n)}
        label={t('fees.free.label')}
        hint={t('fees.free.hint')}
        switchLabel={t('fees.free.switch')}
        amountLabel={t('fees.free.amount')}
        currency={t('common.currency')}
        disabled={!editable || !can('workspace.settings') || !workspace}
        saving={patch.isPending}
        error={ruleError}
      />

      <Card className="overflow-hidden">
        {fees.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : (
          <>
            <Table aria-label={t('fees.table')} data-testid="fee-grid">
              <thead>
                <tr>
                  <Th className="w-12">{t('fees.col.code')}</Th>
                  <Th>{t('common.wilaya')}</Th>
                  <Th>{t('fees.col.home')}</Th>
                  <Th>{t('fees.col.stopdesk')}</Th>
                  <Th>{t('fees.col.return')}</Th>
                  <Th className="max-lg:hidden">{t('fees.col.courierCost')}</Th>
                  <Th>{t('common.source')}</Th>
                  <Th>{t('fees.col.active')}</Th>
                  <Th className="w-16">
                    <span className="sr-only">{t('action.actions')}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const state = states[r.wilayaId] ?? 'idle';
                  const name = locale === 'ar' ? r.nameAr : r.nameFr;
                  const resetState = actionState(r.actions, FEE_ACTIONS.reset, t);
                  const resetReason = !editable ? readOnlyReason : resetState.present ? resetState.reason : canReset(r) ? undefined : reasonText(t, 'FEE_RULE_NOT_FOUND');
                  return (
                    <tr key={r.wilayaId} data-wilaya={r.code} data-source={r.source} className={!r.isActive ? 'text-text-muted' : undefined}>
                      <Td className="ts-label-meta text-text-muted">
                        <Ltr>{r.code}</Ltr>
                      </Td>
                      <Td>
                        <div className="flex flex-col">
                          <span className="text-[14px]">{name}</span>
                          <span className="self-start ts-label-meta text-text-muted" dir={locale === 'ar' ? 'ltr' : 'rtl'}>
                            {locale === 'ar' ? r.nameFr : r.nameAr}
                          </span>
                        </div>
                      </Td>
                      {(['homePrice', 'stopdeskPrice', 'returnPrice'] as const).map((f) => (
                        <Td key={f}>
                          <FeeCell
                            value={r[f]}
                            label={t('fees.cellLabel', { field: t(`fees.col.${f === 'homePrice' ? 'home' : f === 'stopdeskPrice' ? 'stopdesk' : 'return'}`), wilaya: name })}
                            disabled={!editable || state === 'saving'}
                            state={state === 'error' ? 'error' : 'idle'}
                            onCommit={(v) => isChange(r, f, v) && void save(r, { [f]: v })}
                          />
                        </Td>
                      ))}
                      <Td className="max-lg:hidden">{r.courierCost === null ? <span className="text-text-muted">—</span> : <Ltr>{formatMoney(r.courierCost)}</Ltr>}</Td>
                      <Td>
                        <StatusPill enumKey="FeeRule.source" value={r.source} className="!rounded-[4px]">
                          {t(`fees.source.${r.source}`)}
                        </StatusPill>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Switch checked={r.isActive} onCheckedChange={(v) => void save(r, { isActive: v })} label={t('fees.activeLabel', { wilaya: name })} disabled={!editable || state === 'saving'} />
                          {!r.isActive ? <span className="ts-label-meta whitespace-nowrap text-accent-starred">{t('fees.notServed')}</span> : null}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1.5">
                          <RowSaveState state={state} labels={{ saving: t('common.saving'), saved: t('state.form.saved'), error: errors[r.wilayaId] ?? t('state.list.error.title') }} />
                          <Tooltip content={resetReason ?? t('fees.resetRow')}>
                            <span>
                              <IconButton size="sm" variant="ghost" label={t('fees.resetRow')} disabled={!!resetReason || state === 'saving'} onClick={() => void reset(r)}>
                                <RotateCcw className="size-3.5" aria-hidden />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </div>
                        {errors[r.wilayaId] ? (
                          <p role="alert" className="mt-1 max-w-56 text-end text-[12px] text-accent-alert">
                            {errors[r.wilayaId]}
                          </p>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {rows.length === 0 ? <p className="px-3 py-6 text-center ts-label-meta text-text-muted">{t('fees.noMatch', { q })}</p> : null}
            <p className="border-t border-line-hairline px-3 py-2.5 ts-label-meta text-text-muted">
              {meta ? t('fees.footer', { count: formatNumber(fees.data?.rows.length ?? 0), custom: meta.custom, inactive: meta.inactive }) : null}
            </p>
          </>
        )}
      </Card>

      <CopyRatesDialog open={copying} couriers={couriers.data ?? []} onClose={() => setCopying(false)} />
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={(o) => !o && !seeding && setConfirmReset(false)}
        title={t('fees.resetAll.title')}
        description={t('fees.resetAll.description')}
        confirmLabel={t('fees.resetAll.confirm')}
        cancelLabel={t('action.cancel')}
        onConfirm={() => void seed(true)}
        destructive
        loading={seeding === 'reset'}
        closeLabel={t('action.close')}
      />
    </div>
  );
}
