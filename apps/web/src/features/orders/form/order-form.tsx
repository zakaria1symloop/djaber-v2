'use client';
// /orders/new — Figma "ORD-02 — New order — form (client conflict, variant, fee quote)" + "ORD-02 — … AR (RTL)".
// 12 §5 "New order": client picker (results, "Utiliser ce client" on a phone conflict, create inline), items (variant
// required, stock warnings), delivery (wilaya, commune, domicile / stop-desk, address, fee quote: grid / free / not served
// / Admin override), payment, status Nouvelle / Confirmée, notes, saving, inline validation + summary, leave guard,
// draft kept in sessionStorage. `POST /orders` with an Idempotency-Key per submit attempt (reused on a retried attempt).
// Prefill: `?clientId=` (client card + default address), `?conversationId=`, `?duplicate=<orderId>`.
import { formatMoney, formatNumber } from '@djaber/shared';
import {
  Banner,
  Button,
  buttonClass,
  cn,
  ConfirmDialog,
  Field,
  FormAlert,
  MoneyInput,
  OrderFormCard,
  OrderTotalsCard,
  RadioCards,
  Select,
  Textarea,
  toast,
  ValidationChecklist,
  ValidationSummary,
} from '@djaber/ui';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppPage } from '@/components/app-page';
import type { ClientListItem } from '@/features/clients/contracts';
import { useFeeQuote, useGeoWilayas } from '@/features/delivery/api';
import { PAYMENT_METHODS, type PaymentMethod } from '@/features/orders/contracts';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError, apiSession } from '@/lib/api';
import { errorMessage, fieldError, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { uuid } from '@/lib/uuid';
import { orderFormApi, useOrderCreatedRefresh } from './api';
import { ClientSection } from './client-section';
import { DeliverySection } from './delivery-section';
import { ItemsSection, lineFromProduct } from './items-section';
import {
  cancelHref,
  clearOrderDraft,
  draftToForm,
  emptyOrderForm,
  firstErrorField,
  isFormDirty,
  lineIndexOf,
  NOTES_MAX,
  orderTotals,
  readOrderDraft,
  serverField,
  toCreatePayload,
  validateOrderForm,
  validationChecklist,
  writeOrderDraft,
  type FieldKey,
  type FormClient,
  type FormErrors,
  type OrderFormValues,
} from './model';

/** Element to focus for a field of the form (scroll to the first error). */
const FIELD_ELEMENT = (f: FieldKey): string => {
  const line = /^lines\.(\d+)\.(variantId|quantity|unitPrice)$/.exec(f);
  if (line) return line[2] === 'variantId' ? `line-${line[1]}-variant` : `line-${line[1]}-price`;
  const map: Partial<Record<FieldKey, string>> = {
    'client.name': 'client-name',
    'client.phone': 'client-phone',
    'client.phone2': 'client-phone',
    lines: 'product-search',
    wilayaId: 'wilayaId',
    communeId: 'communeId',
    address: 'address',
    amountPaid: 'amountPaid',
    discount: 'discount',
    feeOverride: 'feeOverride',
    notes: 'notes',
  };
  return map[f] ?? 'order-form';
};
const LABEL_KEY = (f: FieldKey): string => {
  if (f.startsWith('lines.')) return 'orderForm.summary.lines';
  return `orderForm.summary.${f.replace('.', '_')}`;
};

type Attempt = { key: string; body: string };

export function NewOrderForm() {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const route = usePathname();
  const search = useSearchParams();
  const { can, readOnly } = useSession();
  const canMoney = can('orders.money');
  const refresh = useOrderCreatedRefresh();
  const wilayas = useGeoWilayas();
  const clientId = search.get('clientId');
  const conversationId = search.get('conversationId');
  const duplicateId = search.get('duplicate');

  /* ---------- values, draft, prefill ---------- */
  const [initial] = useState(() => emptyOrderForm({ conversationId }));
  const [values, setValues] = useState<OrderFormValues>(() => {
    if (typeof window === 'undefined' || clientId || duplicateId) return initial;
    return readOrderDraft(route) ?? initial;
  });
  const [restored, setRestored] = useState(() => typeof window !== 'undefined' && !clientId && !duplicateId && !!readOrderDraft(route));
  const [prefilling, setPrefilling] = useState(!!clientId || !!duplicateId);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [addressPrefilled, setAddressPrefilled] = useState(false);
  const set = (patch: Partial<OrderFormValues>) => setValues((v) => ({ ...v, ...patch }));

  /** A client of the workspace: its facts + its default address when the delivery block is still empty. */
  const applyClient = async (pick: Pick<ClientListItem, 'id' | 'name' | 'phone' | 'riskLevel' | 'isPlaceholder' | 'blocked' | 'orderCount'>) => {
    const facts: FormClient = {
      id: pick.id,
      name: pick.name,
      phone: pick.phone ?? '',
      phone2: '',
      hasPhone: !!pick.phone,
      riskLevel: pick.riskLevel,
      isPlaceholder: pick.isPlaceholder,
      blocked: pick.blocked,
      orderCount: pick.orderCount,
    };
    setValues((v) => ({ ...v, client: facts }));
    setConflict(null);
    setServerErrors({});
    try {
      const card = await orderFormApi.client(pick.id);
      const address = card.addresses.find((a) => a.isDefault) ?? card.addresses[0];
      setValues((v) => {
        if (v.client.id !== pick.id) return v;
        const next = {
          ...v,
          client: {
            ...v.client,
            name: card.name,
            phone: card.phone ?? '',
            hasPhone: !!card.phone,
            riskLevel: card.riskLevel,
            isPlaceholder: card.isPlaceholder,
            blocked: card.blocked,
            orderCount: card.orderCount,
          },
        };
        if (!address || v.wilayaId || v.address.trim()) return next;
        setAddressPrefilled(true);
        return {
          ...next,
          wilayaId: address.wilayaId,
          communeId: address.communeId,
          isStopdesk: address.isStopdesk,
          stopdeskId: address.stopdeskId,
          address: address.address ?? '',
        };
      });
    } catch {
      // the card is a convenience: the order is still linked to the client id
    }
  };

  useEffect(() => {
    let off = false;
    const run = async () => {
      try {
        if (duplicateId) {
          const draft = await orderFormApi.duplicate(duplicateId);
          const lines = await Promise.all(
            draft.items.map(async (it) => {
              const p = await orderFormApi.product(it.productId);
              const line = lineFromProduct(p, p.variants);
              return {
                ...line,
                variantId: it.variantId ?? line.variantId,
                quantity: it.quantity,
                unitPrice: String(it.unitPrice ?? p.variants.find((x) => x.id === it.variantId)?.price ?? p.price),
              };
            }),
          );
          if (off) return;
          const next = draftToForm(draft, lines);
          setValues({
            ...next,
            conversationId: next.conversationId ?? conversationId,
            discount: canMoney ? next.discount : '',
          });
          const cid = (draft.client as { id?: string }).id;
          if (cid) {
            const card = await orderFormApi.client(cid);
            if (!off)
              setValues((v) => ({
                ...v,
                client: {
                  id: card.id,
                  name: card.name,
                  phone: card.phone ?? '',
                  phone2: '',
                  hasPhone: !!card.phone,
                  riskLevel: card.riskLevel,
                  isPlaceholder: card.isPlaceholder,
                  blocked: card.blocked,
                  orderCount: card.orderCount,
                },
              }));
          }
        } else if (clientId) {
          const card = await orderFormApi.client(clientId);
          if (!off) await applyClient(card);
        }
      } catch (e) {
        if (!off) setPrefillError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
      } finally {
        if (!off) setPrefilling(false);
      }
    };
    if (clientId || duplicateId) void run();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, from the query string of the page
  }, []);

  /* ---------- derived ---------- */
  const [done, setDone] = useState(false);
  const dirty = !done && isFormDirty(values, initial);
  const totalsBeforeFee = orderTotals({ ...values, feeOverride: '' }, 0);
  const quoteQ = useFeeQuote({
    wilayaId: values.wilayaId,
    stopdesk: values.isStopdesk,
    subtotal: totalsBeforeFee.subtotal - totalsBeforeFee.discount,
  });
  const quote = values.wilayaId && quoteQ.data && quoteQ.data.wilayaId === values.wilayaId ? quoteQ.data : null;
  const quotedFee = quote && quote.wilayaServed ? quote.fee : null;
  const totals = orderTotals(values, quotedFee);
  const wilaya = wilayas.data?.find((w) => w.id === values.wilayaId) ?? null;
  const wilayaName = wilaya ? (locale === 'ar' ? wilaya.nameAr : wilaya.nameFr) : null;

  // draft: written while the merchant types, dropped when the form is saved or left (kept on an expired session)
  const snapshot = JSON.stringify(values);
  useEffect(() => {
    if (done || prefilling) return;
    if (!isFormDirty(values, initial)) return clearOrderDraft(route);
    const id = window.setTimeout(() => writeOrderDraft(route, values), 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- written when the values change
  }, [snapshot, done, prefilling, route]);
  useEffect(
    () => () => {
      if (apiSession.get().accessToken) clearOrderDraft(route);
    },
    [route],
  );

  /* ---------- validation & errors ---------- */
  const [submitted, setSubmitted] = useState<null | 'new' | 'confirmed'>(null);
  const [serverErrors, setServerErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ id: string | null; name: string } | null>(null);
  const [blocked, setBlocked] = useState<{ status: 'new' | 'confirmed'; name: string } | null>(null);
  const [saving, setSaving] = useState<null | 'new' | 'confirmed'>(null);
  const attempt = useRef<Attempt | null>(null);
  const clientErrors = useMemo(() => (submitted ? validateOrderForm(values, { status: submitted, quotedFee }) : {}), [submitted, values, quotedFee]);
  const errors: FormErrors = { ...serverErrors, ...clientErrors };
  const summary = submitted ? Object.keys(clientErrors).map((f) => t(LABEL_KEY(f as FieldKey))) : [];
  const uniqueSummary = [...new Set(summary)];
  const locked = !!saving || prefilling || readOnly;
  const { guard } = useLeaveGuard(dirty && !saving, t('orderForm.title'));

  // a server error disappears from a field as soon as the merchant changes it
  const change = (patch: Partial<OrderFormValues>, fields: FieldKey[]) => {
    set(patch);
    if (fields.some((f) => serverErrors[f]) || fields.some((f) => f === 'lines')) {
      setServerErrors((e) => {
        const next = { ...e };
        for (const f of fields) delete next[f];
        if (fields.includes('lines')) for (const k of Object.keys(next)) if (k.startsWith('lines')) delete next[k as FieldKey];
        return next;
      });
    }
  };

  const focus = (f: FieldKey | null) => {
    if (!f) return;
    window.setTimeout(() => {
      const el = document.getElementById(FIELD_ELEMENT(f));
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (el as HTMLElement | null)?.focus?.();
    }, 30);
  };

  const applyServerError = (e: unknown) => {
    if (!(e instanceof ApiError)) return setFormError(errorMessage(e, t));
    const next: FormErrors = {};
    let unknown = 0;
    for (const [path, key] of Object.entries(e.body.fields ?? {})) {
      const f = serverField(path);
      if (f) next[f] = { key };
      else unknown++;
    }
    const params = e.body.params ?? {};
    const details = e.body.details;
    const message = `${errorMessage(e, t)} (${e.code})`;
    switch (e.code) {
      case 'CLIENT_PHONE_EXISTS': {
        const d = (details ?? {}) as { clientId?: string; client?: { id?: string; name?: string } };
        setConflict({
          id: d.clientId ?? d.client?.id ?? null,
          name: String(params.clientName ?? d.client?.name ?? ''),
        });
        next['client.phone'] = { key: message };
        break;
      }
      case 'VARIANT_REQUIRED':
      case 'ORDER_INSUFFICIENT_STOCK':
      case 'STOCK_INSUFFICIENT': {
        if (!Object.keys(next).some((k) => k.startsWith('lines.'))) {
          const i = lineIndexOf(values.lines, details, params);
          const field: FieldKey = i >= 0 ? (e.code === 'VARIANT_REQUIRED' ? `lines.${i}.variantId` : `lines.${i}.quantity`) : 'lines';
          next[field] = { key: message };
        }
        break;
      }
      case 'ORDER_ADDRESS_REQUIRED':
        if (!values.wilayaId) next.wilayaId = { key: message };
        else if (!values.communeId) next.communeId = { key: message };
        else next.address = { key: message };
        break;
      case 'WILAYA_NOT_SERVED':
        next.wilayaId = { key: message };
        break;
      default:
        break;
    }
    setServerErrors(next);
    const mapped = Object.keys(next).length;
    setFormError(mapped > 0 && unknown === 0 ? null : message);
    focus(firstErrorField(next));
  };

  const save = async (status: 'new' | 'confirmed', o: { confirm?: boolean } = {}) => {
    setSubmitted(status);
    setFormError(null);
    const errs = validateOrderForm(values, { status, quotedFee });
    if (Object.keys(errs).length) return focus(firstErrorField(errs));
    const payload = toCreatePayload(values, { status, canMoney, confirm: o.confirm });
    const body = JSON.stringify(payload);
    // a new submit attempt gets a new key; the same attempt retried after a network failure reuses it (api-contract §1.7)
    const key = attempt.current && attempt.current.body === body ? attempt.current.key : uuid();
    attempt.current = { key, body };
    setSaving(status);
    try {
      const order = await orderFormApi.create(payload, key);
      attempt.current = null;
      setDone(true);
      clearOrderDraft(route);
      void refresh();
      toast(t('orderForm.toast.created', { number: order.number }));
      router.push(`/orders/${order.id}`);
    } catch (e) {
      setSaving(null);
      // an answer from the server ends the attempt: the next click is a new attempt
      if (e instanceof ApiError) attempt.current = null;
      if (e instanceof ApiError && e.code === 'CUSTOMER_BLOCKED')
        return setBlocked({
          status,
          name: String(e.body.params?.clientName ?? values.client.name),
        });
      applyServerError(e);
    }
  };

  const checklist = validationChecklist(values, quote);
  const checkLabel = (k: (typeof checklist)[number]) => t(`orderForm.check.${k.key}${k.key === 'address' ? (values.status === 'confirmed' ? '' : 'Later') : ''}`, k.params as Record<string, string>);
  const paidErr = errors.amountPaid ? fieldError(t, errors.amountPaid.key) : undefined;
  const subtitle = [t('orderForm.subtitle'), conversationId ? t('orderForm.fromConversation') : null].filter(Boolean).join(' · ');

  return (
    <AppPage permission="orders.write" back={{ href: '/orders', label: t('nav.orders') }} title={t('orderForm.title')} description={subtitle}>
      {readOnly ? <Banner tone="warning">{t('error.READ_ONLY_MEMBER')}</Banner> : null}
      {restored && dirty ? (
        <Banner tone="info" onDismiss={() => setRestored(false)} dismissLabel={t('action.close')}>
          <span data-testid="draft-restored">{t('orderForm.draftRestored')}</span>
        </Banner>
      ) : null}
      {prefillError ? (
        <FormAlert>
          <span data-testid="prefill-error">{t('orderForm.prefillError', { message: prefillError })}</span>
        </FormAlert>
      ) : null}

      <form
        id="order-form"
        noValidate
        aria-busy={!!saving || prefilling}
        onSubmit={(e) => {
          e.preventDefault();
          void save(values.status);
        }}
        className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]"
      >
        <div className="flex min-w-0 flex-col gap-5">
          <ClientSection
            client={values.client}
            locked={locked}
            errors={errors}
            conflict={conflict}
            onChange={(client) => {
              setConflict(null);
              change({ client }, ['client.name', 'client.phone', 'client.phone2']);
            }}
            onPick={(c) => void applyClient(c)}
            onUseConflict={async () => {
              if (conflict?.id) {
                const card = await orderFormApi.client(conflict.id).catch(() => null);
                if (card) return applyClient(card);
              }
              const found = await orderFormApi.searchClients(values.client.phone).catch(() => []);
              const owner = found.find((c) => c.phone && values.client.phone.replace(/\D/g, '').endsWith(c.phone.slice(1)));
              if (owner) void applyClient(owner);
            }}
          />
          <ItemsSection lines={values.lines} locked={locked} errors={errors} onChange={(lines) => change({ lines }, ['lines'])} />
          <DeliverySection
            value={values}
            locked={locked}
            errors={errors}
            required={values.status === 'confirmed' || submitted === 'confirmed'}
            quote={quote}
            quoting={quoteQ.isFetching}
            quoteError={quoteQ.isError && values.wilayaId ? `${errorMessage(quoteQ.error, t)}${quoteQ.error instanceof ApiError ? ` (${quoteQ.error.code})` : ''}` : null}
            wilayaName={wilayaName}
            canOverride={canMoney}
            prefilled={addressPrefilled}
            onChange={(patch) => {
              if ('address' in patch) setAddressPrefilled(false);
              change(patch, Object.keys(patch).map((k) => (k === 'stopdeskId' || k === 'isStopdesk' ? 'address' : k)) as FieldKey[]);
            }}
          />

          <OrderFormCard index={4} title={t('orderForm.payment.title')} data-section="payment">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('orderForm.payment.method')} htmlFor="paymentMethod">
                <Select id="paymentMethod" disabled={locked} value={values.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as PaymentMethod })}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`orderForm.payment.method.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('orderForm.payment.paid')}
                htmlFor="amountPaid"
                error={paidErr}
                hint={t(values.paymentMethod === 'cash' ? 'orderForm.payment.remainingCod' : 'orderForm.payment.remaining', { amount: formatMoney(totals.remaining) })}
              >
                <MoneyInput
                  id="amountPaid"
                  disabled={locked}
                  aria-invalid={!!errors.amountPaid}
                  value={values.amountPaid}
                  onValueChange={(v) => change({ amountPaid: v }, ['amountPaid'])}
                  placeholder="0"
                />
              </Field>
              {canMoney ? (
                <Field label={t('orderForm.payment.discount')} htmlFor="discount" hint={t('orderForm.payment.discountHint')}>
                  <MoneyInput id="discount" disabled={locked} value={values.discount} onValueChange={(v) => change({ discount: v }, ['discount'])} placeholder="0" />
                </Field>
              ) : null}
            </div>
            <RadioCards<'new' | 'confirmed'>
              label={t('orderForm.status.label')}
              columns={2}
              value={values.status}
              onChange={(status) => set({ status })}
              options={[
                {
                  value: 'new',
                  label: t('orderForm.status.new'),
                  description: t('orderForm.status.newHint'),
                },
                {
                  value: 'confirmed',
                  label: t('orderForm.status.confirmed'),
                  description: t('orderForm.status.confirmedHint'),
                },
              ]}
            />
            <Field label={t('orderForm.notes')} htmlFor="notes" error={errors.notes ? fieldError(t, errors.notes.key, { max: NOTES_MAX }) : undefined}>
              <Textarea
                id="notes"
                dir="auto"
                rows={2}
                maxLength={NOTES_MAX}
                disabled={locked}
                value={values.notes}
                onChange={(e) => change({ notes: e.target.value }, ['notes'])}
                placeholder={t('orderForm.notesPlaceholder')}
              />
            </Field>
          </OrderFormCard>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4" aria-label={t('orderForm.summary.title')}>
          <OrderTotalsCard
            title={t('orderForm.summary.title')}
            rows={[
              {
                key: 'subtotal',
                label: t('orderForm.summary.subtotal', { count: totals.itemCount }),
                value: formatMoney(totals.subtotal),
              },
              {
                key: 'discount',
                label: t('common.discount').toUpperCase(),
                value: `− ${formatMoney(totals.discount)}`,
              },
              {
                key: 'fee',
                label: t('orderForm.summary.delivery'),
                value:
                  quote?.free && values.feeOverride === ''
                    ? t('orderForm.summary.freeFee', { amount: formatMoney(0) })
                    : values.wilayaId && (quotedFee !== null || values.feeOverride !== '')
                      ? formatMoney(totals.fee)
                      : '—',
              },
              {
                key: 'total',
                label: t('common.total'),
                value: formatMoney(totals.total),
                strong: true,
              },
              {
                key: 'paid',
                label: t('orderForm.summary.paidRemaining'),
                value: `${formatNumber(totals.paid)} · ${formatMoney(totals.remaining)}`,
              },
            ]}
          />
          <ValidationChecklist title={t('orderForm.check.title')} items={checklist.map((c) => ({ key: c.key, state: c.state, label: checkLabel(c) }))} />
          <div className="rounded-card border border-line-edge bg-ink-surface p-4">
            <div className="ts-label-micro text-text-muted">{t('orderForm.onSave.title')}</div>
            <p className="mt-2 text-[13px] text-text-secondary">{t('orderForm.onSave.text')}</p>
          </div>
        </aside>
      </form>

      {uniqueSummary.length ? <ValidationSummary title={t('orderForm.summary.errors', { count: uniqueSummary.length })} items={uniqueSummary} /> : null}
      {formError ? (
        <FormAlert>
          <span data-testid="form-error">{formError}</span>
        </FormAlert>
      ) : null}

      <div className="sticky -bottom-6 z-20 -mx-4 -mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-hairline bg-ink-base px-4 py-3 md:-mx-8 md:px-8" data-testid="form-footer">
        <p className={cn('min-w-0 flex-1 ts-label-micro', dirty ? 'text-text-secondary' : 'text-text-muted')} aria-live="polite" data-testid="draft-note">
          {saving ? t('common.saving') : dirty ? t('orderForm.footer.draft') : t('orderForm.footer.idle')}
        </p>
        {saving ? (
          <Button variant="ghost" disabled>
            {t('action.cancel')}
          </Button>
        ) : (
          <Link href={cancelHref({ conversationId, clientId, duplicateId })} className={buttonClass({ variant: 'ghost' })} data-testid="form-cancel">
            {t('action.cancel')}
          </Link>
        )}
        <Button
          onClick={() => void save('new')}
          loading={saving === 'new'}
          disabled={!!saving || prefilling}
          disabledReason={readOnly ? t('error.READ_ONLY_MEMBER') : undefined}
          data-testid="save-later"
        >
          {t('orderForm.footer.saveLater')}
        </Button>
        <Button
          type="submit"
          form="order-form"
          variant="primary"
          loading={saving === values.status && saving !== null}
          disabled={!!saving || prefilling}
          disabledReason={readOnly ? t('error.READ_ONLY_MEMBER') : undefined}
          data-testid="form-save"
        >
          {saving ? t('common.saving') : t('orderForm.footer.save')}
        </Button>
      </div>

      <ConfirmDialog
        open={!!blocked}
        onOpenChange={(o) => !o && setBlocked(null)}
        title={t('orderForm.blocked.title')}
        description={`${t('error.CUSTOMER_BLOCKED', { clientName: blocked?.name ?? '' })} (CUSTOMER_BLOCKED)`}
        confirmLabel={t('orderForm.blocked.confirm')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        onConfirm={() => {
          const s = blocked?.status ?? 'new';
          setBlocked(null);
          void save(s, { confirm: true });
        }}
      >
        <p className="text-[13px] text-text-secondary">{t('orderForm.blocked.text', { name: blocked?.name ?? '' })}</p>
      </ConfirmDialog>
      {guard}
    </AppPage>
  );
}
