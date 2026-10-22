'use client';
// ADM-15 pieces — pack dialog (store ids read-only once created, store prices are set in the consoles), promo code dialog
// (CODE · EFFET · VALEUR · PÉRIODES · PLANS · CIBLE · LIMITE · VALIDITÉ), redemptions and pricing history dialogs.
import type { CreditPackAdminDto, CreditPricingDto, PlanAdminDto, PromoCodeDto, PromoRedemptionRowDto } from '@djaber/shared';
import { Checkbox, Dialog, Field, FormAlert, Input, NumberInput, Select, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { adminWrite, useAdminGet, useAdminInvalidate, useAdminList } from '../api';
import { AdminDialog, NO_ERRORS, toServerErrors, useOnOpen, type ServerErrors } from '../dialog-kit';
import { WorkspacePicker } from '../pickers';
import { fullName, useFormats } from '../ui';

export function PackDialog({ pack, open, onClose }: { pack: CreditPackAdminDto | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [credits, setCredits] = useState('');
  const [price, setPrice] = useState('');
  const [google, setGoogle] = useState('');
  const [apple, setApple] = useState('');
  const [active, setActive] = useState(true);
  const [web, setWeb] = useState(true);
  const [mobile, setMobile] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  useOnOpen(open, () => {
    setSlug(pack?.slug ?? '');
    setName(pack?.nameI18n?.fr ?? pack?.name ?? '');
    setCredits(pack ? String(pack.credits) : '');
    setPrice(pack ? String(pack.priceWebDzd) : '');
    setGoogle(pack?.googleProductId ?? '');
    setApple(pack?.appleProductId ?? '');
    setActive(pack?.isActive ?? true);
    setWeb(pack?.visibleWeb ?? true);
    setMobile(pack?.visibleMobile ?? true);
    setFeatured(pack?.isFeatured ?? false);
    setErrors(NO_ERRORS);
  });
  const submit = async () => {
    setErrors(NO_ERRORS);
    const common = { name: { fr: name.trim() }, credits: Number(credits), priceWebDzd: Number(price), isActive: active, visibleWeb: web, visibleMobile: mobile, isFeatured: featured };
    try {
      if (pack) await m.mutateAsync(() => adminWrite(`/admin/credit-packs/${pack.id}`, 'PATCH', common));
      else await m.mutateAsync(() => adminWrite('/admin/credit-packs', 'POST', { slug: slug.trim(), ...common, googleProductId: google.trim() || null, appleProductId: apple.trim() || null }, true));
      void invalidate('/admin/credit-packs');
      toast(t('admin.credits.pack.saved'));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['slug', 'name', 'credits', 'priceWebDzd', 'googleProductId', 'appleProductId']));
    }
  };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-pack"
      title={pack ? t('admin.credits.pack.editTitle', { name: pack.name }) : t('admin.credits.pack.newTitle')}
      submitLabel={t('action.save')}
      disabled={!name.trim() || !Number(credits) || (!pack && !slug.trim())}
      pending={m.isPending}
      error={errors.form}
      note={t('admin.credits.pack.note')}
      onSubmit={() => void submit()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.credits.pack.slug')} required htmlFor="pk-slug" error={errors.fields.slug}>
          <Input id="pk-slug" dir="ltr" value={slug} disabled={!!pack} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
        </Field>
        <Field label={t('admin.credits.col.pack')} required htmlFor="pk-name" error={errors.fields.name}>
          <Input id="pk-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('admin.credits.col.credits')} required htmlFor="pk-credits" error={errors.fields.credits}>
          <NumberInput id="pk-credits" value={credits} onValueChange={setCredits} />
        </Field>
        <Field label={t('admin.credits.col.priceWeb')} required htmlFor="pk-price" error={errors.fields.priceWebDzd}>
          <NumberInput id="pk-price" value={price} onValueChange={setPrice} />
        </Field>
        <Field label={t('admin.credits.col.google')} htmlFor="pk-google" error={errors.fields.googleProductId}>
          <Input id="pk-google" dir="ltr" value={google} disabled={!!pack} onChange={(e) => setGoogle(e.target.value)} />
        </Field>
        <Field label={t('admin.credits.col.apple')} htmlFor="pk-apple" error={errors.fields.appleProductId}>
          <Input id="pk-apple" dir="ltr" value={apple} disabled={!!pack} onChange={(e) => setApple(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ['active', active, setActive],
            ['featured', featured, setFeatured],
            ['web', web, setWeb],
            ['mobile', mobile, setMobile],
          ] as const
        ).map(([k, v, s]) => (
          <label key={k} className="flex cursor-pointer items-center gap-2.5 text-[14px]">
            <Checkbox checked={v} onChange={(e) => s(e.target.checked)} />
            {t(`admin.credits.pack.flag.${k}`)}
          </label>
        ))}
      </div>
    </AdminDialog>
  );
}

const KINDS = ['percent_discount', 'fixed_discount', 'credits', 'trial_extension'] as const;
const TARGETS = ['all', 'new_workspaces', 'existing', 'workspace'] as const;

/**
 * Promo code dialog (new or ✎ edit) — a dialog like the pack one (tester report 2026-10-21 UX-006: the inline form opened
 * below the table, out of sight); the effect and its value are two fields so the chosen effect stays readable (UX-009: the
 * effect select was squeezed to zero width). Kind / value / periods are fixed once the code was used.
 */
export function PromoDialog({ promo, open, onClose }: { promo: PromoCodeDto | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const plans = useAdminGet<PlanAdminDto[]>('/admin/plans');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('percent_discount');
  const [value, setValue] = useState('');
  const [periods, setPeriods] = useState('');
  const [planSlugs, setPlanSlugs] = useState<string[]>([]);
  const [target, setTarget] = useState<(typeof TARGETS)[number]>('all');
  const [ws, setWs] = useState<{ id: string; name: string } | null>(null);
  const [maxUses, setMaxUses] = useState('');
  const [perWs, setPerWs] = useState('1');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  useOnOpen(open, () => {
    setCode(promo?.code ?? '');
    setKind(promo?.kind ?? 'percent_discount');
    setValue(promo ? String(promo.value) : '');
    setPeriods(promo?.periods ? String(promo.periods) : '');
    setPlanSlugs(promo?.planSlugs ?? []);
    setTarget(promo?.target ?? 'all');
    setWs(promo?.targetWorkspace ?? null);
    setMaxUses(promo?.maxUses ? String(promo.maxUses) : '');
    setPerWs(String(promo?.perWorkspaceLimit ?? 1));
    setFrom(promo?.validFrom?.slice(0, 10) ?? '');
    setTo(promo?.validTo?.slice(0, 10) ?? '');
    setErrors(NO_ERRORS);
  });
  const used = !!promo && promo.uses > 0;
  const submit = async () => {
    setErrors(NO_ERRORS);
    const window = { validFrom: from || null, validTo: to || null, maxUses: maxUses ? Number(maxUses) : null };
    try {
      if (promo) await m.mutateAsync(() => adminWrite(`/admin/promo-codes/${promo.id}`, 'PATCH', { ...window, planSlugs, ...(used ? {} : { value: Number(value), periods: periods ? Number(periods) : null }) }));
      else
        await m.mutateAsync(() =>
          adminWrite('/admin/promo-codes', 'POST', { code: code.trim(), kind, value: Number(value), periods: periods ? Number(periods) : null, planSlugs, target, targetWorkspaceId: target === 'workspace' ? (ws?.id ?? null) : null, perWorkspaceLimit: Number(perWs || 1), ...window }, true),
        );
      void invalidate('/admin/promo-codes', '/admin/credit-packs');
      toast(t('admin.credits.promo.saved', { code: code.trim() }));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['code', 'value', 'periods', 'targetWorkspaceId', 'maxUses', 'validFrom', 'validTo'], { CONFLICT: 'code' }));
    }
  };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="promo-form"
      size="lg"
      title={promo ? t('admin.credits.promo.editTitle', { code: promo.code }) : t('admin.credits.promo.newTitle')}
      submitLabel={promo ? t('action.save') : t('admin.credits.promo.create')}
      disabled={!code.trim() || !Number(value) || (target === 'workspace' && !promo && !ws)}
      pending={m.isPending}
      error={errors.form}
      note={t('admin.credits.promo.note')}
      onSubmit={() => void submit()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.credits.col.code')} required htmlFor="promo-code" error={errors.fields.code}>
          <Input id="promo-code" dir="ltr" value={code} disabled={!!promo} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LANCEMENT-IG" />
        </Field>
        <Field label={t('admin.credits.col.effect')} required htmlFor="promo-kind">
          <Select id="promo-kind" value={kind} disabled={!!promo} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`admin.credits.kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.credits.promo.value')} required htmlFor="promo-value" error={errors.fields.value} hint={t(`admin.credits.promo.unit.${kind}`)}>
          <NumberInput id="promo-value" value={value} disabled={used} onValueChange={setValue} />
        </Field>
        <Field label={t('admin.credits.promo.periods')} htmlFor="promo-periods" error={errors.fields.periods}>
          <NumberInput id="promo-periods" value={periods} disabled={used || kind === 'credits'} onValueChange={setPeriods} />
        </Field>
        <Field label={t('admin.credits.col.plans')} htmlFor="promo-plans" className="sm:col-span-2">
          <div id="promo-plans" className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-card border border-line-edge px-2 py-1.5">
            {(plans.data ?? []).filter((p) => !p.archivedAt && p.priceMonthly > 0).map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                <Checkbox checked={planSlugs.includes(p.slug)} onChange={(e) => setPlanSlugs((x) => (e.target.checked ? [...x, p.slug] : x.filter((s) => s !== p.slug)))} />
                {p.name}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('admin.credits.col.target')} htmlFor="promo-target" error={errors.fields.targetWorkspaceId}>
          <Select id="promo-target" value={target} disabled={!!promo} onChange={(e) => setTarget(e.target.value as (typeof TARGETS)[number])}>
            {TARGETS.map((k) => (
              <option key={k} value={k}>
                {t(`admin.credits.target.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        {target === 'workspace' && !promo ? (
          <Field label={t('admin.subs.edit.workspace')} required htmlFor="promo-ws">
            <WorkspacePicker id="promo-ws" value={ws?.id ?? null} onChange={(_, w) => setWs(w)} />
          </Field>
        ) : (
          <span aria-hidden className="max-sm:hidden" />
        )}
        <Field label={t('admin.credits.col.limit')} htmlFor="promo-max" error={errors.fields.maxUses}>
          <NumberInput id="promo-max" value={maxUses} onValueChange={setMaxUses} placeholder={t('admin.common.unlimited')} />
        </Field>
        <Field label={t('admin.credits.promo.perWorkspace')} htmlFor="promo-per-ws">
          <NumberInput id="promo-per-ws" value={perWs} disabled={!!promo} onValueChange={setPerWs} />
        </Field>
        <Field label={t('admin.credits.col.validity')} htmlFor="promo-from" error={errors.fields.validFrom ?? errors.fields.validTo} className="sm:col-span-2">
          <div className="flex items-center gap-2">
            <Input id="promo-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="[color-scheme:dark]" />
            <span aria-hidden className="text-text-muted">→</span>
            <Input aria-label={t('common.to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="[color-scheme:dark]" />
          </div>
        </Field>
      </div>
    </AdminDialog>
  );
}

export function RedemptionsDialog({ promo, onClose }: { promo: PromoCodeDto | null; onClose: () => void }) {
  const t = useT();
  const f = useFormats();
  const q = useAdminList<PromoRedemptionRowDto>(`/admin/promo-codes/${promo?.id}/redemptions`, undefined, { enabled: !!promo });
  return (
    <Dialog open={!!promo} onOpenChange={(o) => !o && onClose()} title={t('admin.credits.promo.redemptionsTitle', { code: promo?.code ?? '' })} closeLabel={t('action.close')}>
      {q.isPending ? (
        <p className="ts-label-meta text-text-muted">{t('common.loading')}</p>
      ) : q.isError ? (
        <FormAlert>{t('state.list.error.title')}</FormAlert>
      ) : q.data.rows.length === 0 ? (
        <p className="ts-label-meta text-text-muted">{t('admin.credits.promo.noRedemption')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-hairline">
          {q.data.rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 text-[13px]">
              <span className="flex-1">{r.workspace.name}</span>
              <span className="text-text-secondary">{fullName(r.user)}</span>
              <span className="ts-label-micro text-text-muted">{f.short(r.redeemedAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {promo && (promo.kind === 'percent_discount' || promo.kind === 'fixed_discount') ? <p className="mt-3 ts-label-micro !normal-case text-text-muted">{t('admin.credits.promo.redemptionsNote')}</p> : null}
    </Dialog>
  );
}

export function PricingHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const f = useFormats();
  const q = useAdminGet<CreditPricingDto[]>(open ? '/admin/credit-pricing/versions' : null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('admin.credits.history.title')} closeLabel={t('action.close')} size="lg">
      {q.isPending ? (
        <p className="ts-label-meta text-text-muted">{t('common.loading')}</p>
      ) : q.isError ? (
        <FormAlert>{t('state.list.error.title')}</FormAlert>
      ) : (
        <ul className="flex flex-col divide-y divide-line-hairline" data-testid="pricing-history">
          {(q.data ?? []).map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
              <span className="font-mono">v{v.version}</span>
              <span className="flex-1 text-text-secondary">{t('admin.credits.history.row', { text: v.costs.text, image: v.costs.image, voice: v.costs.voice, price: v.creditPriceDzd })}</span>
              <span className="ts-label-micro text-text-muted">{t('admin.credits.history.effective', { date: f.date(v.effectiveAt) })}</span>
              {v.current ? <span className="ts-label-micro text-accent-money">{t('admin.credits.history.current')}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
