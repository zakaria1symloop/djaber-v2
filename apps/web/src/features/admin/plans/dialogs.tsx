'use client';
// ADM-04 dialogs — DLG "Créer un plan" (slug unique PLAN_SLUG_TAKEN, ≥ 1 limit > 0, card preview), "Supprimer le plan
// « … »" (PLAN_IN_USE n ⇒ migrate then archive) and "Migrer les abonnés" (same target + when + reason).
import { formatNumber, type PlanAdminDto } from '@djaber/shared';
import { Button, Checkbox, Field, FormAlert, Input, PlanCard, Select, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { adminWrite, useAdminInvalidate } from '../api';
import { AdminDialog, NO_ERRORS, ReasonField, reasonOk, toServerErrors, useOnOpen, type ServerErrors } from '../dialog-kit';
import { useLimit } from '../ui';
import { EMPTY_PLAN, FeatureChips, hasOneLimit, MoneyField, SignedField, toPlanInput, yearlyDiscount, type PlanDraft } from './form';

const LIMIT_FIELDS = ['maxPages', 'maxAgents', 'maxProducts', 'maxConversationsPerMonth', 'maxMembers', 'monthlyCredits'] as const;
const EXTRA_FIELDS = ['maxApiKeys', 'maxWebhooks', 'syncHistoryDays'] as const;

export function PlanPreview({ d }: { d: PlanDraft }) {
  const t = useT();
  const limit = useLimit();
  const n = (v: string) => (v.trim() === '' ? 0 : Number(v));
  return (
    <PlanCard
      data-testid="plan-preview"
      name={d.nameFr || '—'}
      price={d.priceMonthly ? formatNumber(Number(d.priceMonthly)) : '0'}
      unit={t('admin.plans.perMonthUnit')}
      description={d.description || undefined}
      badge={d.isFeatured ? t('admin.plans.pill.popular') : undefined}
      features={[
        t('admin.plans.preview.pages', { value: limit(n(d.maxPages)) }),
        t('admin.plans.preview.agents', { value: limit(n(d.maxAgents)) }),
        t('admin.plans.preview.products', { value: limit(n(d.maxProducts)) }),
        t('admin.plans.preview.members', { value: limit(n(d.maxMembers)) }),
        t('admin.plans.preview.credits', { value: limit(n(d.monthlyCredits)) }),
      ]}
    />
  );
}

export function CreatePlanDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: PlanDraft | null }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [d, setD] = useState<PlanDraft>(EMPTY_PLAN);
  const [preview, setPreview] = useState(false);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (b: unknown) => adminWrite<PlanAdminDto>('/admin/plans', 'POST', b, true) });
  useOnOpen(open, () => {
    setD(initial ? { ...initial, slug: '' } : EMPTY_PLAN);
    setPreview(false);
    setErrors(NO_ERRORS);
  });
  const set = <K extends keyof PlanDraft>(k: K, v: PlanDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const limitsOk = hasOneLimit(d);
  const disc = yearlyDiscount(d);
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      const p = await m.mutateAsync({ ...toPlanInput(d), slug: d.slug.trim().toLowerCase() });
      void invalidate('/admin/plans');
      toast(t('admin.plans.create.done', { name: p.name }));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['slug', 'name', 'priceMonthly', 'priceYearly', ...LIMIT_FIELDS], { PLAN_SLUG_TAKEN: 'slug' }));
    }
  };
  const fe = (k: string) => errors.fields[k];
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-plan-create"
      size="xl"
      title={t('admin.plans.create.title')}
      context={t('admin.plans.create.context')}
      submitLabel={t('admin.plans.create.submit')}
      disabled={!d.slug.trim() || !d.nameFr.trim() || !limitsOk}
      pending={m.isPending}
      error={errors.form}
      note={t('admin.plans.create.note')}
      extra={
        <Button onClick={() => setPreview((v) => !v)} aria-pressed={preview} data-testid="plan-preview-toggle">
          {t('admin.plans.create.preview')}
        </Button>
      }
      onSubmit={() => void submit()}
    >
      <div className={preview ? 'grid gap-4 lg:grid-cols-[1fr_260px]' : ''}>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t('admin.plans.form.slug')} required htmlFor="p-slug" hint={t('admin.plans.form.slugHint')} error={fe('slug')}>
              <Input id="p-slug" dir="ltr" value={d.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} />
            </Field>
            <Field label={t('admin.plans.form.nameFr')} required htmlFor="p-fr" error={fe('name')}>
              <Input id="p-fr" value={d.nameFr} onChange={(e) => set('nameFr', e.target.value)} />
            </Field>
            <Field label={t('admin.plans.form.nameAr')} htmlFor="p-ar">
              <Input id="p-ar" dir="rtl" lang="ar" value={d.nameAr} onChange={(e) => set('nameAr', e.target.value)} />
            </Field>
            <Field label={t('admin.plans.form.nameEn')} htmlFor="p-en">
              <Input id="p-en" value={d.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
            </Field>
          </div>
          <Field label={t('admin.plans.form.description')} htmlFor="p-desc">
            <Input id="p-desc" value={d.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-4">
            <MoneyField id="p-pm" label={t('admin.plans.form.priceMonthly')} required value={d.priceMonthly} onChange={(v) => set('priceMonthly', v)} error={fe('priceMonthly')} />
            <MoneyField id="p-py" label={t('admin.plans.form.priceYearly')} value={d.priceYearly} onChange={(v) => set('priceYearly', v)} error={fe('priceYearly')} hint={disc !== null ? t('admin.plans.form.discount', { pct: disc }) : undefined} />
            <MoneyField id="p-trial" label={t('admin.plans.form.trial')} value={d.trialDays} onChange={(v) => set('trialDays', v)} />
            <MoneyField id="p-order" label={t('admin.plans.form.order')} value={d.sortOrder} onChange={(v) => set('sortOrder', v)} />
          </div>
          <div className="ts-label-micro uppercase text-text-muted">{t('admin.plans.form.limits')}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {LIMIT_FIELDS.map((k) => (
              <SignedField key={k} id={`p-${k}`} label={t(`admin.plans.form.${k}`)} value={d[k]} onChange={(v) => set(k, v)} error={fe(k)} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {EXTRA_FIELDS.map((k) => (
              <SignedField key={k} id={`p-${k}`} label={t(`admin.plans.form.${k}`)} value={d[k]} onChange={(v) => set(k, v)} />
            ))}
          </div>
          {!limitsOk && (d.maxPages || d.maxAgents) ? <FormAlert tone="warning">{t('admin.plans.form.oneLimit')}</FormAlert> : null}
          <div className="ts-label-micro uppercase text-text-muted">{t('admin.plans.form.features')}</div>
          <FeatureChips value={d.features} onChange={(v) => set('features', v)} />
          <div className="ts-label-micro uppercase text-text-muted">{t('admin.plans.form.visibility')}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(['isActive', 'isFeatured', 'isVisible'] as const).map((k) => (
              <label key={k} className="flex cursor-pointer items-start gap-2.5 text-[14px]">
                <Checkbox checked={d[k]} onChange={(e) => set(k, e.target.checked)} className="mt-0.5" />
                <span>
                  {t(`admin.plans.form.${k}`)}
                  <span className="block ts-label-micro text-text-muted">{t(`admin.plans.form.${k}Hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        {preview ? <PlanPreview d={d} /> : null}
      </div>
    </AdminDialog>
  );
}

/** "Supprimer le plan" — deletes a plan without subscribers; `PLAN_IN_USE {count}` turns it into migrate-then-archive. */
export function DeletePlanDialog({ plan, plans, open, onClose }: { plan: PlanAdminDto | null; plans: PlanAdminDto[]; open: boolean; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [blocked, setBlocked] = useState<number | null>(null);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const del = useMutation({ mutationFn: (id: string) => adminWrite(`/admin/plans/${id}`, 'DELETE') });
  const migrate = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: unknown }) => {
      await adminWrite(`/admin/plans/${id}/migrate`, 'POST', body);
      await adminWrite(`/admin/plans/${id}/archive`, 'POST', {});
    },
  });
  useOnOpen(open, () => {
    setTarget('');
    setReason('');
    setErrors(NO_ERRORS);
    setBlocked(plan && plan.subscribers > 0 ? plan.subscribers : null);
  });
  if (!plan) return null;
  const others = plans.filter((p) => p.id !== plan.id && !p.archivedAt);
  const onDelete = async () => {
    setErrors(NO_ERRORS);
    try {
      await del.mutateAsync(plan.id);
      void invalidate('/admin/plans');
      toast(t('admin.plans.delete.done'));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PLAN_IN_USE') setBlocked(Number(e.body.params.count ?? plan.subscribers));
      else setErrors(toServerErrors(e, t, []));
    }
  };
  const onMigrate = async () => {
    setErrors(NO_ERRORS);
    try {
      await migrate.mutateAsync({ id: plan.id, body: { toPlanId: target, when: 'next_period', reason: reason.trim() } });
      void invalidate('/admin/plans', '/admin/subscriptions');
      toast(t('admin.plans.migrate.done'));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['toPlanId', 'reason'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  const inUse = blocked !== null && blocked > 0;
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-plan-delete"
      title={t('admin.plans.delete.title', { name: plan.name })}
      submitLabel={inUse ? t('admin.plans.delete.migrate') : t('admin.plans.delete.submit')}
      destructive={!inUse}
      disabled={inUse ? !target || !reasonOk(reason) : false}
      pending={del.isPending || migrate.isPending}
      error={errors.form}
      extra={inUse ? <Button variant="ghost" disabled title={t('error.PLAN_IN_USE', { count: blocked })}>{t('admin.plans.delete.submit')}</Button> : undefined}
      onSubmit={() => void (inUse ? onMigrate() : onDelete())}
    >
      {inUse ? (
        <>
          <FormAlert>{t('admin.plans.delete.inUse', { count: blocked })}</FormAlert>
          <Field label={t('admin.plans.delete.target')} required htmlFor="p-target" error={errors.fields.toPlanId}>
            <Select id="p-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">—</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {t('admin.plans.delete.targetOpt', { name: p.name })}
                </option>
              ))}
            </Select>
          </Field>
          <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
        </>
      ) : (
        <p className="text-[14px] text-text-secondary">{t('admin.plans.delete.confirm')}</p>
      )}
    </AdminDialog>
  );
}

export function MigratePlanDialog({ plan, plans, open, onClose }: { plan: PlanAdminDto | null; plans: PlanAdminDto[]; open: boolean; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [target, setTarget] = useState('');
  const [when, setWhen] = useState<'now' | 'next_period'>('next_period');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => adminWrite<{ migrated: number }>(`/admin/plans/${id}/migrate`, 'POST', body) });
  useOnOpen(open, () => {
    setTarget('');
    setWhen('next_period');
    setReason('');
    setErrors(NO_ERRORS);
  });
  if (!plan) return null;
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      const r = await m.mutateAsync({ id: plan.id, body: { toPlanId: target, when, reason: reason.trim() } });
      void invalidate('/admin/plans', '/admin/subscriptions');
      toast(t('admin.plans.migrate.doneCount', { count: r?.migrated ?? plan.subscribers }));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['toPlanId', 'reason'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-plan-migrate"
      size="sm"
      title={t('admin.plans.migrate.title')}
      context={t('admin.plans.migrate.context', { name: plan.name, count: plan.subscribers })}
      submitLabel={t('admin.plans.migrate.submit')}
      disabled={!target || !reasonOk(reason)}
      pending={m.isPending}
      error={errors.form}
      onSubmit={() => void submit()}
    >
      <Field label={t('admin.plans.delete.target')} required htmlFor="m-target" error={errors.fields.toPlanId}>
        <Select id="m-target" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">—</option>
          {plans
            .filter((p) => p.id !== plan.id && !p.archivedAt)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
      </Field>
      <div role="radiogroup" aria-label={t('admin.ws.plan.when')} className="flex flex-col gap-2.5">
        {(['next_period', 'now'] as const).map((w) => (
          <label key={w} className="flex cursor-pointer items-center gap-2.5 text-[14px]">
            <input type="radio" name="migrateWhen" checked={when === w} onChange={() => setWhen(w)} className="size-4 accent-white" />
            {t(`admin.ws.plan.whenOpt.${w}`)}
          </label>
        ))}
      </div>
      <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
    </AdminDialog>
  );
}
