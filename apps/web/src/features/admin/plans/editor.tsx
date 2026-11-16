'use client';
// ADM-04 inline editor "Modifier « {plan} » (Plan.version n → n+1)": the impact warning comes from the server dry-run
// (`PATCH /admin/plans/:id { dryRun: true }`: subscribers, over-limit counts PLAN_LIMIT_GRANDFATHERED, price notice
// 30 d); saving creates version n+1. Leave guard while dirty; archive = hide, subscribers kept. Versions history.
import type { PlanAdminDto, PlanImpactDto, PlanUpdateResultDto, PlanVersionDto } from '@djaber/shared';
import { Button, Card, Checkbox, Dialog, Field, FormAlert, Input, toast } from '@djaber/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ConflictDialog } from '@/components/global-states';
import { api, ApiError } from '@/lib/api';
import { useLeaveGuard } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { adminWrite, useAdminGet, useAdminInvalidate } from '../api';
import { NO_ERRORS, toServerErrors, type ServerErrors } from '../dialog-kit';
import { useFormats } from '../ui';
import { draftOf, FeatureChips, MoneyField, SignedField, toPlanInput, yearlyDiscount, type PlanDraft } from './form';

const GRID = ['monthlyCredits', 'maxPages', 'maxAgents', 'maxMembers', 'maxProducts', 'maxApiKeys'] as const;
// full-test 15/11 ADMIN-11: the editor changes what the create form sets (names AR / EN, description, order, every limit,
// « Populaire » / « Visible ») — a typo in the Arabic name or moving « Populaire » never needs a new plan
const MORE = ['maxConversationsPerMonth', 'maxWebhooks', 'syncHistoryDays'] as const;
const FLAGS = ['isFeatured', 'isVisible'] as const;

export function PlanEditor({ plan, onClose, onArchive, canWrite }: { plan: PlanAdminDto; onClose: () => void; onArchive: () => void; canWrite: boolean }) {
  const t = useT();
  const f = useFormats();
  const invalidate = useAdminInvalidate();
  const base = useMemo(() => draftOf(plan), [plan]);
  const [d, setD] = useState<PlanDraft>(base);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const [conflict, setConflict] = useState(false);
  const [versions, setVersions] = useState(false);
  useEffect(() => setD(base), [base]);
  const set = <K extends keyof PlanDraft>(k: K, v: PlanDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const { guard } = useLeaveGuard(dirty, plan.name);
  const body = useMemo(() => {
    const { slug: _slug, ...rest } = toPlanInput(d);
    // the editor edits the French description: its AR / EN texts are sent back unchanged (never wiped)
    return d.description.trim() ? { ...rest, description: { ...plan.descriptionI18n, fr: d.description.trim() } } : rest;
  }, [d, plan.descriptionI18n]);
  // impact preview (debounced through the query key; only while something changed)
  const [debounced, setDebounced] = useState(body);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(body), 400);
    return () => window.clearTimeout(id);
  }, [body]);
  const impact = useQuery({
    queryKey: ['admin', 'plan-impact', plan.id, debounced],
    queryFn: () => api<PlanUpdateResultDto>(`/admin/plans/${plan.id}`, { method: 'PATCH', body: { ...debounced, dryRun: true } }).then((r) => r.impact),
    enabled: dirty && canWrite,
    retry: false,
    staleTime: 30_000,
  });
  const save = useMutation({ mutationFn: (b: unknown) => adminWrite<PlanUpdateResultDto>(`/admin/plans/${plan.id}`, 'PATCH', b) });
  const onSave = async () => {
    setErrors(NO_ERRORS);
    try {
      await save.mutateAsync(body);
      void invalidate('/admin/plans');
      toast(t('admin.plans.edit.saved', { version: plan.version + 1 }));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'CONFLICT') setConflict(true);
      else setErrors(toServerErrors(e, t, ['name', 'description', 'priceMonthly', 'priceYearly', 'trialDays', 'sortOrder', ...GRID, ...MORE]));
    }
  };
  const disc = yearlyDiscount(d);
  const im: PlanImpactDto | undefined = impact.data;
  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="plan-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="ts-display-s text-[18px]">{t('admin.plans.edit.title', { name: plan.name, from: plan.version, to: plan.version + 1 })}</h2>
        <Button variant="ghost" size="sm" onClick={() => setVersions(true)}>
          {t('admin.plans.edit.versions')}
        </Button>
      </div>
      <fieldset disabled={!canWrite || save.isPending} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('admin.plans.form.nameFr')} htmlFor="e-name" error={errors.fields.name}>
            <Input id="e-name" value={d.nameFr} onChange={(e) => set('nameFr', e.target.value)} />
          </Field>
          <Field label={t('admin.plans.form.nameAr')} htmlFor="e-ar">
            <Input id="e-ar" dir="rtl" lang="ar" value={d.nameAr} onChange={(e) => set('nameAr', e.target.value)} />
          </Field>
          <Field label={t('admin.plans.form.nameEn')} htmlFor="e-en">
            <Input id="e-en" value={d.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
          </Field>
        </div>
        <Field label={t('admin.plans.form.description')} htmlFor="e-desc" error={errors.fields.description}>
          <Input id="e-desc" value={d.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <MoneyField id="e-pm" label={t('admin.plans.form.priceMonthly')} value={d.priceMonthly} onChange={(v) => set('priceMonthly', v)} error={errors.fields.priceMonthly} />
          <MoneyField id="e-py" label={t('admin.plans.form.priceYearly')} value={d.priceYearly} onChange={(v) => set('priceYearly', v)} error={errors.fields.priceYearly} hint={disc !== null ? t('admin.plans.form.discountAuto', { pct: disc }) : undefined} />
          <MoneyField id="e-trial" label={t('admin.plans.form.trial')} value={d.trialDays} onChange={(v) => set('trialDays', v)} error={errors.fields.trialDays} />
          <MoneyField id="e-order" label={t('admin.plans.form.order')} value={d.sortOrder} onChange={(v) => set('sortOrder', v)} error={errors.fields.sortOrder} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          {GRID.map((k) => (
            <SignedField key={k} id={`e-${k}`} label={t(`admin.plans.edit.${k}`)} value={d[k]} onChange={(v) => set(k, v)} error={errors.fields[k]} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {MORE.map((k) => (
            <SignedField key={k} id={`e-${k}`} label={t(`admin.plans.form.${k}`)} value={d[k]} onChange={(v) => set(k, v)} error={errors.fields[k]} />
          ))}
        </div>
        <div className="ts-label-micro uppercase text-text-muted">{t('admin.plans.form.featuresJson')}</div>
        <FeatureChips value={d.features} onChange={(v) => set('features', v)} disabled={!canWrite} />
        <div className="ts-label-micro uppercase text-text-muted">{t('admin.plans.form.visibility')}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {FLAGS.map((k) => (
            <label key={k} className="flex cursor-pointer items-start gap-2.5 text-[14px]">
              <Checkbox checked={d[k]} onChange={(e) => set(k, e.target.checked)} className="mt-0.5" />
              <span>
                {t(`admin.plans.form.${k}`)}
                <span className="block ts-label-micro text-text-muted">{t(`admin.plans.form.${k}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {dirty ? (
        <div className="rounded-card border-s-2 border-accent-starred bg-ink-raised px-4 py-3 text-[13px]" data-testid="plan-impact">
          {impact.isPending ? (
            t('admin.plans.edit.impactLoading')
          ) : impact.isError ? (
            t('admin.plans.edit.impactError')
          ) : im ? (
            <>
              {t('admin.plans.edit.impact', { count: im.subscribers })}{' '}
              {im.overLimit.map((o) => t('admin.plans.edit.overLimit', { limit: t(`admin.plans.edit.${o.limit}`), count: o.count })).join(' ')}{' '}
              {im.priceChangeAt ? t('admin.plans.edit.priceNotice', { date: f.date(im.priceChangeAt) }) : t('admin.plans.edit.priceRule')}
            </>
          ) : null}
        </div>
      ) : null}
      {errors.form ? <FormAlert>{errors.form}</FormAlert> : null}
      <div className="flex flex-wrap items-center gap-2">
        {canWrite && !plan.archivedAt && plan.actions.some((a) => a.key === 'archive') ? (
          <Button variant="danger" onClick={onArchive}>
            {t('admin.plans.edit.archive')}
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          {t('action.cancel')}
        </Button>
        {canWrite ? (
          <Button variant="primary" onClick={() => void onSave()} loading={save.isPending} disabled={!dirty} data-testid="plan-save">
            {t('admin.plans.edit.save', { version: plan.version + 1 })}
          </Button>
        ) : null}
      </div>
      {guard}
      <ConflictDialog open={conflict} name={plan.name} ago="—" onReload={() => { setConflict(false); void invalidate('/admin/plans'); }} onClose={() => setConflict(false)} />
      <VersionsDialog planId={plan.id} name={plan.name} open={versions} onClose={() => setVersions(false)} />
    </Card>
  );
}

function VersionsDialog({ planId, name, open, onClose }: { planId: string; name: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const f = useFormats();
  const q = useAdminGet<PlanVersionDto[]>(open ? `/admin/plans/${planId}/versions` : null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('admin.plans.versions.title', { name })} closeLabel={t('action.close')} size="md">
      {q.isPending ? (
        <p className="ts-label-meta text-text-muted">{t('common.loading')}</p>
      ) : q.isError ? (
        <FormAlert>{t('state.list.error.title')}</FormAlert>
      ) : (
        <ul className="flex flex-col divide-y divide-line-hairline">
          {(q.data ?? []).map((v) => (
            <li key={v.version} className="flex items-center gap-3 py-2 text-[13px]">
              <span className="font-mono">v{v.version}</span>
              <span className="flex-1 text-text-secondary">{f.dateTime(v.createdAt)}{v.changedBy ? ` · ${v.changedBy.firstName}` : ''}</span>
              <span className="ts-label-micro text-text-muted">{t('admin.plans.versions.impact', { count: v.impactCount })}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
