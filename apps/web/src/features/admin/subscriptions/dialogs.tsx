'use client';
// ADM-05 dialogs — "Paiement manuel — {workspace} · {n°} · {montant}" (method manual_transfer / manual_ccp / manual_cash,
// reference, amount, date, proof; amount = remaining ⇒ paid + reactivation "Confirmer et réactiver"; less ⇒
// 200 ⚠ INVOICE_PARTIAL_PAYMENT {remaining}; more ⇒ 422 on `amount`), "Abonnement — créer / modifier"
// (SUBSCRIPTION_ALREADY_ACTIVE → edit the existing one), Prolonger la période, Accorder une remise, Résilier, Renvoyer
// la relance, Exporter comptabilité.
import type { AdminInvoiceRowDto, AdminSubscriptionRowDto, PlanAdminDto } from '@djaber/shared';
import { Field, FormAlert, Input, NumberInput, Select, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { uploadWithProgress } from '@/lib/upload';
import { adminWrite, adminWriteRaw, useAdminGet, useAdminInvalidate, useAdminJobToast, useAdminList } from '../api';
import { AdminDialog, NO_ERRORS, ReasonField, reasonOk, toServerErrors, useOnOpen, type ServerErrors } from '../dialog-kit';
import { WorkspacePicker } from '../pickers';
import { useFormats } from '../ui';

export type InvoiceRef = { id: string; number: string; amount: number; remaining: number; workspace: { id: string; name: string } };
const METHODS = ['manual_transfer', 'manual_ccp', 'manual_cash'] as const;
const today = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

export function ManualPaymentDialog({ invoice, open, onClose }: { invoice: InvoiceRef | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const f = useFormats();
  const invalidate = useAdminInvalidate();
  const [method, setMethod] = useState<(typeof METHODS)[number]>('manual_transfer');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(today());
  const [proof, setProof] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => adminWriteRaw<{ remaining: number; reactivated: boolean }>(`/admin/invoices/${id}/mark-paid`, 'POST', body, true) });
  useOnOpen(open, () => {
    setMethod('manual_transfer');
    setReference('');
    setAmount(invoice ? String(invoice.remaining) : '');
    setPaidAt(today());
    setProof(null);
    setErrors(NO_ERRORS);
  });
  if (!invoice) return null;
  const n = Number(amount || 0);
  const partial = n > 0 && n < invoice.remaining;
  const upload = async (file: File) => {
    setErrors(NO_ERRORS);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'payment_proof');
      setUploading(0);
      const r = await uploadWithProgress<{ id: string }>('/uploads', fd, { onProgress: setUploading, platform: true });
      setProof({ id: r.data.id, name: file.name });
    } catch (e) {
      setErrors(toServerErrors(e, t, []));
    } finally {
      setUploading(null);
    }
  };
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      const r = await m.mutateAsync({ id: invoice.id, body: { method, reference: reference.trim(), amount: n, paidAt, ...(proof ? { proofUploadId: proof.id } : {}), reason: t('admin.subs.pay.auditReason', { reference: reference.trim() }) } });
      void invalidate('/admin/subscriptions', '/admin/invoices', '/admin/payments', '/admin/workspaces', '/admin/audit-logs');
      const warn = r.meta.warnings?.find((w) => w.code === 'INVOICE_PARTIAL_PAYMENT');
      if (warn) toast({ tone: 'warning', message: t('admin.subs.pay.partial', { remaining: f.money(Number(warn.params?.remaining ?? r.data?.remaining ?? 0)) }) });
      else toast(r.data?.reactivated ? t('admin.subs.pay.doneReactivated') : t('admin.subs.pay.done'));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['method', 'reference', 'amount', 'paidAt', 'proofUploadId']));
    }
  };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-manual-payment"
      size="lg"
      title={t('admin.subs.pay.title', { workspace: invoice.workspace.name, number: invoice.number, amount: f.money(invoice.remaining) })}
      submitLabel={partial ? t('admin.subs.pay.submitPartial') : t('admin.subs.pay.submit')}
      disabled={!reference.trim() || n <= 0 || !paidAt || uploading !== null}
      pending={m.isPending}
      error={errors.form}
      note={t('admin.subs.pay.note')}
      onSubmit={() => void submit()}
    >
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label={t('admin.subs.pay.method')} htmlFor="mp-method" error={errors.fields.method}>
          <Select id="mp-method" value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}>
            {METHODS.map((x) => (
              <option key={x} value={x}>
                {t(`admin.subs.method.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.subs.pay.reference')} required htmlFor="mp-ref" error={errors.fields.reference}>
          <Input id="mp-ref" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label={t('admin.subs.pay.amount')} required htmlFor="mp-amount" error={errors.fields.amount}>
          <NumberInput id="mp-amount" value={amount} onValueChange={setAmount} />
        </Field>
        <Field label={t('admin.subs.pay.date')} required htmlFor="mp-date" error={errors.fields.paidAt}>
          <Input id="mp-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="[color-scheme:dark]" />
        </Field>
        <Field label={t('admin.subs.pay.proof')} htmlFor="mp-proof" error={errors.fields.proofUploadId}>
          <label className="flex h-10 cursor-pointer items-center truncate rounded-card border border-line-edge bg-ink-surface px-3 text-[13px] text-text-secondary hover:border-line-lit">
            <input id="mp-proof" type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            {uploading !== null ? `${uploading} %` : proof ? `${proof.name} ✓` : t('admin.subs.pay.proofPick')}
          </label>
        </Field>
      </div>
      {partial ? <FormAlert tone="warning">{t('admin.subs.pay.partialHint', { remaining: f.money(invoice.remaining - n) })}</FormAlert> : null}
    </AdminDialog>
  );
}

/** "Abonnement — créer / modifier": create; `SUBSCRIPTION_ALREADY_ACTIVE` ⇒ the inline warning offers to edit the existing one. */
export function SubscriptionDialog({ open, onClose, editing, onEditExisting }: { open: boolean; onClose: () => void; editing?: AdminSubscriptionRowDto | null; onEditExisting?: (workspaceId: string) => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const plans = useAdminGet<PlanAdminDto[]>(open ? '/admin/plans' : null);
  const [ws, setWs] = useState<{ id: string; name: string } | null>(null);
  const [planId, setPlanId] = useState('');
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [startsAt, setStartsAt] = useState(today());
  const [price, setPrice] = useState('');
  const [provider, setProvider] = useState<'manual' | 'none'>('manual');
  const [reason, setReason] = useState('');
  const [already, setAlready] = useState(false);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  useOnOpen(open, () => {
    setWs(editing ? editing.workspace : null);
    setPlanId(editing?.plan.id ?? '');
    setCycle(editing && editing.cycle !== 'none' ? editing.cycle : 'monthly');
    setStartsAt(today());
    setPrice(editing ? String(editing.appliedPrice) : '');
    setProvider('manual');
    setReason('');
    setAlready(false);
    setErrors(NO_ERRORS);
  });
  const submit = async () => {
    setErrors(NO_ERRORS);
    setAlready(false);
    try {
      if (editing) await m.mutateAsync(() => adminWrite(`/admin/subscriptions/${editing.id}`, 'PATCH', { ...(price ? { appliedPrice: Number(price) } : {}), cycle, reason: reason.trim() }));
      else await m.mutateAsync(() => adminWrite('/admin/subscriptions', 'POST', { workspaceId: ws?.id, planId, cycle, startsAt, ...(price ? { appliedPrice: Number(price) } : {}), provider, reason: reason.trim() }, true));
      void invalidate('/admin/subscriptions', '/admin/workspaces');
      toast(t('admin.subs.edit.done'));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SUBSCRIPTION_ALREADY_ACTIVE') setAlready(true);
      else setErrors(toServerErrors(e, t, ['workspaceId', 'planId', 'cycle', 'startsAt', 'appliedPrice', 'reason'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-subscription"
      title={t('admin.subs.edit.title')}
      context={ws ? `${ws.name}${editing ? ` · ${t(`enum.Subscription.status.${editing.status}`).toLowerCase()}` : ''}` : undefined}
      submitLabel={t('action.save')}
      disabled={(!editing && (!ws || !planId)) || !reasonOk(reason)}
      pending={m.isPending}
      error={errors.form}
      onSubmit={() => void submit()}
    >
      {!editing ? (
        <Field label={t('admin.subs.edit.workspace')} required htmlFor="s-ws" error={errors.fields.workspaceId}>
          <WorkspacePicker id="s-ws" value={ws?.id ?? null} onChange={(_, w) => setWs(w)} />
        </Field>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('admin.common.plan')} required htmlFor="s-plan" error={errors.fields.planId}>
          <Select id="s-plan" value={planId} disabled={!!editing} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">—</option>
            {(plans.data ?? []).filter((p) => !p.archivedAt).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.common.cycle')} htmlFor="s-cycle">
          <Select id="s-cycle" value={cycle} onChange={(e) => setCycle(e.target.value as 'monthly' | 'yearly')}>
            <option value="monthly">{t('admin.common.cycleOpt.monthly')}</option>
            <option value="yearly">{t('admin.common.cycleOpt.yearly')}</option>
          </Select>
        </Field>
        <Field label={t('admin.subs.edit.start')} htmlFor="s-start" error={errors.fields.startsAt}>
          <Input id="s-start" type="date" value={startsAt} disabled={!!editing} onChange={(e) => setStartsAt(e.target.value)} className="[color-scheme:dark]" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('admin.subs.edit.price')} htmlFor="s-price" hint={t('admin.subs.edit.priceHint')} error={errors.fields.appliedPrice}>
          <NumberInput id="s-price" value={price} onValueChange={setPrice} />
        </Field>
        <Field label={t('admin.subs.edit.provider')} htmlFor="s-provider">
          <Select id="s-provider" value={provider} disabled={!!editing} onChange={(e) => setProvider(e.target.value as 'manual' | 'none')}>
            <option value="manual">{t('admin.subs.edit.providerManual')}</option>
            <option value="none">{t('admin.subs.edit.providerNone')}</option>
          </Select>
        </Field>
        <Field label={t('admin.subs.edit.trialEnd')} htmlFor="s-trial">
          <Input id="s-trial" disabled value={editing?.trialEndsAt ? editing.trialEndsAt.slice(0, 10) : '—'} />
        </Field>
      </div>
      <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} placeholder={t('admin.subs.edit.reasonPlaceholder')} />
      {already ? (
        <FormAlert tone="warning">
          {t('admin.subs.edit.already')}{' '}
          {onEditExisting && ws ? (
            <button type="button" className="underline" onClick={() => onEditExisting(ws.id)}>
              {t('admin.subs.edit.editExisting')}
            </button>
          ) : null}
        </FormAlert>
      ) : null}
    </AdminDialog>
  );
}

export type SubAction = 'resend_dunning' | 'extend' | 'discount' | 'cancel' | 'cancel_now';

/** Reason dialogs of the subscription row menu (extend +3 / +7 j, discount, cancel at period end / now, resend dunning). */
export function SubscriptionActionDialog({ sub, action, onClose }: { sub: AdminSubscriptionRowDto | null; action: SubAction | null; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<3 | 7>(7);
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [periods, setPeriods] = useState('1');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  useOnOpen(!!action, () => {
    setReason('');
    setDays(7);
    setKind('percent');
    setValue('');
    setPeriods('1');
    setCode('');
    setErrors(NO_ERRORS);
  });
  if (!sub || !action) return null;
  const call = () => {
    const r = reason.trim();
    if (action === 'extend') return adminWrite(`/admin/subscriptions/${sub.id}`, 'PATCH', { extendDays: days, reason: r });
    if (action === 'discount') return adminWrite(`/admin/subscriptions/${sub.id}/discount`, 'POST', { kind, value: Number(value), periods: Number(periods), ...(code.trim() ? { promoCode: code.trim() } : {}), reason: r });
    return adminWrite(`/admin/subscriptions/${sub.id}/${action.replace('_', '-')}`, 'POST', { reason: r });
  };
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      await m.mutateAsync(call);
      void invalidate('/admin/subscriptions', '/admin/workspaces', '/admin/audit-logs');
      toast(t(`admin.subs.${action}.done`));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['reason', 'value', 'periods', 'extendDays'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  const destructive = action === 'cancel' || action === 'cancel_now';
  return (
    <AdminDialog
      open
      onClose={onClose}
      testId={`dlg-sub-${action}`}
      size="sm"
      title={t(`admin.subs.action.${action}`)}
      context={`${sub.workspace.name} · ${sub.plan.name}`}
      note={t(`admin.subs.${action}.note`)}
      destructive={destructive}
      submitLabel={t(`admin.subs.${action}.submit`)}
      disabled={!reasonOk(reason) || (action === 'discount' && !Number(value))}
      pending={m.isPending}
      error={errors.form}
      onSubmit={() => void submit()}
    >
      {action === 'extend' ? (
        <div role="radiogroup" aria-label={t('admin.subs.action.extend')} className="flex gap-4">
          {([3, 7] as const).map((d) => (
            <label key={d} className="flex cursor-pointer items-center gap-2 text-[14px]">
              <input type="radio" name="extendDays" checked={days === d} onChange={() => setDays(d)} className="size-4 accent-white" />
              {t('admin.subs.extend.days', { days: d })}
            </label>
          ))}
        </div>
      ) : null}
      {action === 'discount' ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('admin.subs.discount.kind')} htmlFor="d-kind">
            <Select id="d-kind" value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'fixed')}>
              <option value="percent">%</option>
              <option value="fixed">DA</option>
            </Select>
          </Field>
          <Field label={t('admin.subs.discount.value')} required htmlFor="d-value" error={errors.fields.value}>
            <NumberInput id="d-value" value={value} onValueChange={setValue} />
          </Field>
          <Field label={t('admin.subs.discount.periods')} htmlFor="d-periods" error={errors.fields.periods}>
            <Select id="d-periods" value={periods} onChange={(e) => setPeriods(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.subs.discount.code')} htmlFor="d-code" className="col-span-3">
            <Input id="d-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
        </div>
      ) : null}
      <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
    </AdminDialog>
  );
}

/** "Exporter comptabilité": invoices of a period → 202 job → signed download link (24 h). */
export function AccountingExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const track = useAdminJobToast();
  const month = new Date().toISOString().slice(0, 7);
  const [from, setFrom] = useState(`${month}-01`);
  const [to, setTo] = useState(today());
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  useOnOpen(open, () => {
    setFrom(`${month}-01`);
    setTo(today());
    setFormat('csv');
  });
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-accounting-export"
      size="sm"
      title={t('admin.subs.export.title')}
      note={t('admin.subs.export.note')}
      submitLabel={t('admin.common.export')}
      disabled={!from || !to}
      onSubmit={() => {
        onClose();
        void track(() => adminWrite<{ jobId: string }>(`/admin/invoices/export?from=${from}&to=${to}&format=${format}`, 'GET'), { running: t('admin.subs.export.running'), done: t('admin.subs.export.done') });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('common.from')} htmlFor="x-from">
          <Input id="x-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="[color-scheme:dark]" />
        </Field>
        <Field label={t('common.to')} htmlFor="x-to">
          <Input id="x-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="[color-scheme:dark]" />
        </Field>
      </div>
      <Field label={t('admin.subs.export.format')} htmlFor="x-format">
        <Select id="x-format" value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'xlsx')}>
          <option value="csv">CSV</option>
          <option value="xlsx">XLSX</option>
        </Select>
      </Field>
    </AdminDialog>
  );
}

/**
 * « + Paiement manuel » (tester report 2026-10-21 UX-007: the button only switched to the Factures tab). D71: a manual
 * payment settles an invoice — pick the workspace, then one of its open invoices (unpaid or upcoming renewal); the
 * payment itself is `ManualPaymentDialog`. No open invoice ⇒ says so and where the payment belongs instead.
 */
export function RecordPaymentDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (invoice: InvoiceRef) => void }) {
  const t = useT();
  const f = useFormats();
  const [ws, setWs] = useState<{ id: string; name: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useOnOpen(open, () => {
    setWs(null);
    setPicked(null);
  });
  const q = useAdminList<AdminInvoiceRowDto>('/admin/invoices', { workspaceId: ws?.id ?? '', status: 'unpaid,upcoming', pageSize: 20 }, { enabled: open && !!ws });
  const rows = (q.data?.rows ?? []).filter((i) => i.remaining > 0);
  const chosen = rows.find((i) => i.id === picked) ?? null;
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-record-payment"
      title={t('admin.subs.pay.pickTitle')}
      submitLabel={t('action.continue')}
      disabled={!chosen}
      note={t('admin.subs.pay.pickNote')}
      onSubmit={() => chosen && onPick({ id: chosen.id, number: chosen.number, amount: chosen.amount, remaining: chosen.remaining, workspace: chosen.workspace })}
    >
      <Field label={t('admin.subs.edit.workspace')} required htmlFor="rp-ws">
        <WorkspacePicker
          id="rp-ws"
          value={ws?.id ?? null}
          onChange={(_, w) => {
            setWs(w);
            setPicked(null);
          }}
        />
      </Field>
      {!ws ? null : q.isPending ? (
        <p className="ts-label-meta text-text-muted">{t('common.loading')}</p>
      ) : q.isError ? (
        <FormAlert>{t('state.list.error.title')}</FormAlert>
      ) : rows.length === 0 ? (
        <FormAlert tone="info">
          <span data-testid="rp-no-invoice">{t('admin.subs.pay.noOpenInvoice', { workspace: ws.name })}</span>
        </FormAlert>
      ) : (
        <fieldset className="flex flex-col gap-1.5" data-testid="rp-invoices">
          <legend className="mb-1 ts-label-micro uppercase text-text-muted">{t('admin.subs.pay.pickInvoice')}</legend>
          {rows.map((i) => (
            <label key={i.id} className="flex cursor-pointer items-center gap-3 rounded-card border border-line-edge px-3 py-2 text-[13px] has-[:checked]:border-line-lit">
              <input type="radio" name="rp-invoice" value={i.id} checked={picked === i.id} onChange={() => setPicked(i.id)} />
              <span dir="ltr" className="font-mono text-[12px]">{i.number}</span>
              <span className="min-w-0 flex-1 truncate text-text-secondary">{i.label}</span>
              <span className="text-text-muted">{t(`enum.Invoice.status.${i.status}`)}</span>
              <span dir="ltr">{f.money(i.remaining)}</span>
            </label>
          ))}
        </fieldset>
      )}
    </AdminDialog>
  );
}
