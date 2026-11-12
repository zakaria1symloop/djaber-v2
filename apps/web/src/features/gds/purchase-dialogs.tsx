'use client';
// Purchase actions and dialogs — Figma "GDS-07 — Purchases — list + receive dialog" (Réceptionner #ACH-…), DLG GDS II
// "Achats — verrous & confirmations" (Annuler #ACH: "0 article reçu · aucun stock à reprendre" / "si partiel : les n u
// reçues restent en stock"; Supprimer: brouillon seulement; Marquer payé: montant ≤ solde · mode · date · ligne caisse;
// Paiement verrouillé; Sur-réception accepted with a warning; Produit non suivi refused). The menu items come from the
// server descriptors (`actions`), greyed with their code.
import { formatMoney, formatNumber } from '@djaber/shared';
import { Button, CodeInput, ConfirmDialog, Dialog, Field, FormAlert, Input, Ltr, MoneyInput, NumberInput, Pill, Select, toast, type MenuAction } from '@djaber/ui';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useCloseGuard, useTypedFlag } from '@/components/close-guard';
import { algiersDay } from '@/features/catalog/stock/logic';
import { DialogFooter, refusal, useDialogSubmit, useOnOpen } from '@/features/orders/dialogs/common';
import { useRouter } from '@/i18n/navigation';
import { offlineMenu, toMenuActions } from '@/lib/actions';
import { useOffline } from '@/features/orders/offline';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl } from '@/lib/jobs';
import { digitsToInt, moneyDigits } from '@/lib/money';
import { gdsApi, useGdsRefresh } from './api';
import { PAYMENT_METHODS, type CashMethod, type Purchase, type PurchaseRow } from './contracts';
import { defaultReceiveQty, int, receiveSummary } from './logic';
import { ProductPicker, type PickedProduct } from './product-picker';

type Dlg = { kind: 'receive' | 'cancel' | 'pay' | 'delete'; id: string; number: string } | null;

/**
 * Menu + dialogs of a purchase (row of `/purchases`, detail page). `load` reads the full purchase when the dialog needs
 * its lines (the list row has none).
 */
export function usePurchaseActions(o: { onDeleted?: () => void } = {}) {
  const t = useT();
  const offline = useOffline();
  const router = useRouter();
  const locale = useLocaleCode();
  const refresh = useGdsRefresh();
  const [dlg, setDlg] = useState<Dlg>(null);
  const simple = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      await refresh();
      toast(done);
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    }
  };
  const menu = (p: PurchaseRow, extra: { onOpen?: () => void } = {}): MenuAction[] =>
    offlineMenu(toMenuActions(
      p.actions,
      {
        order: { label: t('purchases.action.order'), onSelect: () => void simple(() => gdsApi.orderPurchase(p.id), t('purchases.ordered', { number: p.number })) },
        receive: { label: t('purchases.action.receive'), hint: t('gds.hint.dialog'), onSelect: () => setDlg({ kind: 'receive', id: p.id, number: p.number }) },
        open: { label: t('action.open'), local: true, hidden: !extra.onOpen, onSelect: () => extra.onOpen?.() },
        edit: { label: t('action.edit'), hint: t('gds.hint.page'), onSelect: () => router.push(`/purchases/${p.id}/edit`) },
        record_payment: { label: p.remaining > 0 ? t('purchases.action.paySolde') : t('action.recordPayment'), hint: t('gds.hint.dialog'), onSelect: () => setDlg({ kind: 'pay', id: p.id, number: p.number }) },
        duplicate: {
          label: t('action.duplicate'),
          onSelect: () =>
            void (async () => {
              try {
                const copy = await gdsApi.duplicatePurchase(p.id);
                await refresh();
                toast(t('purchases.duplicated', { number: copy.number }));
                router.push(`/purchases/${copy.id}`);
              } catch (e) {
                toast({ tone: 'danger', message: refusal(e, t) });
              }
            })(),
        },
        print: {
          label: t('purchases.action.print'),
          onSelect: () =>
            void (async () => {
              try {
                const f = await gdsApi.printPurchase(p.id, locale);
                downloadUrl(f.url, f.fileName);
              } catch (e) {
                toast({ tone: 'danger', message: refusal(e, t) });
              }
            })(),
        },
        cancel: { label: t('purchases.action.cancel'), separated: true, destructive: true, onSelect: () => setDlg({ kind: 'cancel', id: p.id, number: p.number }) },
        delete: { label: t('action.delete'), destructive: true, onSelect: () => setDlg({ kind: 'delete', id: p.id, number: p.number }) },
      },
      t,
    ), offline ? t('banner.offline') : undefined, ['open', 'edit', 'print']);
  const close = () => setDlg(null);
  const element = (
    <>
      <ReceiveDialog purchaseId={dlg?.kind === 'receive' ? dlg.id : null} onClose={close} />
      <CancelPurchaseDialog purchaseId={dlg?.kind === 'cancel' ? dlg.id : null} onClose={close} />
      <PurchasePaymentDialog purchaseId={dlg?.kind === 'pay' ? dlg.id : null} onClose={close} />
      <ConfirmDialog
        open={dlg?.kind === 'delete'}
        onOpenChange={(v) => !v && close()}
        title={t('purchases.delete.title', { number: dlg?.number ?? '' })}
        description={t('purchases.delete.description')}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        destructive
        closeLabel={t('action.close')}
        onConfirm={() =>
          void (async () => {
            if (!dlg) return;
            try {
              await gdsApi.deletePurchase(dlg.id);
              await refresh();
              toast(t('purchases.deleted', { number: dlg.number }));
              close();
              o.onDeleted?.();
            } catch (e) {
              close();
              toast({ tone: 'danger', message: refusal(e, t) });
            }
          })()
        }
      />
    </>
  );
  return { menu, element, open: setDlg };
}

/** Reads the full purchase of a dialog (the list row carries no lines). */
function usePurchaseFor(id: string | null) {
  const [p, setP] = useState<Purchase | null>(null);
  const [error, setError] = useState<unknown>(null);
  const t = useT();
  useOnOpen(!!id, () => {
    setP(null);
    setError(null);
    if (id)
      gdsApi
        .purchase(id)
        .then(setP)
        .catch((e) => setError(e));
  });
  return { purchase: p, error: error ? refusal(error, t) : null };
}

/* ---------- Réceptionner #ACH-… ---------- */
type RLine = { id: string | null; productId: string; variantId: string | null; name: string; ordered: number; already: number; now: string; cost: string; added: boolean; variants: PickedProduct['variants']; hasVariants: boolean };

export function ReceiveDialog({ purchaseId, onClose }: { purchaseId: string | null; onClose: () => void }) {
  const t = useT();
  const refresh = useGdsRefresh();
  const { purchase: p, error: loadError } = usePurchaseFor(purchaseId);
  const [lines, setLines] = useState<RLine[] | null>(null);
  const [date, setDate] = useState(algiersDay());
  const [invoice, setInvoice] = useState('');
  const [payNow, setPayNow] = useState('');
  const [method, setMethod] = useState<CashMethod>('cash');
  if (p && lines === null) {
    setLines(
      p.items.map((i) => ({
        id: i.id,
        productId: i.product.id,
        variantId: i.variantId,
        name: [i.productName, i.variantName].filter(Boolean).join(' · '),
        ordered: i.quantity,
        already: i.receivedQty,
        now: String(defaultReceiveQty(i.quantity, i.receivedQty)),
        cost: moneyDigits(i.unitCost),
        added: false,
        variants: [],
        hasVariants: false,
      })),
    );
    setInvoice(p.supplierInvoiceRef ?? '');
  }
  useOnOpen(!!purchaseId, () => {
    setLines(null);
    setDate(algiersDay());
    setInvoice('');
    setPayNow('');
    setMethod('cash');
  });
  const ls = lines ?? [];
  const sum = receiveSummary(ls.map((l) => ({ ordered: l.ordered, alreadyReceived: l.already, now: int(l.now), added: l.added })));
  const missingVariant = ls.some((l) => l.added && l.hasVariants && !l.variantId);
  const pay = digitsToInt(payNow) ?? 0;
  const remainingAfter = p ? Math.max(0, p.remaining - pay) : 0;
  // the field already says "au-delà du reste dû": the submit is blocked the same way
  const overPay = !!p && pay > p.remaining;
  const typed = useTypedFlag(!!purchaseId);
  const s = useDialogSubmit((key) =>
    gdsApi.receivePurchase(
      purchaseId!,
      {
        items: ls.filter((l) => !l.added).map((l) => ({ id: l.id!, receivedQty: int(l.now), unitCost: int(l.cost) })),
        newItems: ls.filter((l) => l.added && int(l.now) > 0).map((l) => ({ productId: l.productId, variantId: l.variantId, receivedQty: int(l.now), unitCost: int(l.cost) })),
        receivedAt: new Date(`${date}T12:00:00Z`).toISOString(),
        supplierInvoiceRef: invoice.trim() || null,
        paymentNow: pay > 0 ? { amount: pay, method } : null,
      },
      key,
    ),
  );
  const submit = async () => {
    if (sum.units <= 0 || missingVariant || overPay) return;
    const r = await s.submit();
    if (!r) return;
    const over = r.warnings.filter((w) => w.code === 'PURCHASE_OVER_RECEIVE');
    toast(
      over.length
        ? { tone: 'warning', message: `${t('purchases.receive.done', { number: r.purchase.number, count: sum.units })} · ${t('error.PURCHASE_OVER_RECEIVE', { ordered: String(over[0]!.params?.ordered ?? ''), received: String(over[0]!.params?.received ?? '') })}` }
        : t('purchases.receive.done', { number: r.purchase.number, count: sum.units }),
    );
    await refresh();
    onClose();
  };
  const patch = (i: number, next: Partial<RLine>) => setLines((x) => (x ?? []).map((l, j) => (j === i ? { ...l, ...next } : l)));
  const add = (pp: PickedProduct) =>
    setLines((x) => [
      ...(x ?? []),
      {
        id: null,
        productId: pp.id,
        variantId: pp.variants.length === 1 ? pp.variants[0]!.id : null,
        name: pp.name,
        ordered: 0,
        already: 0,
        now: '1',
        cost: moneyDigits(pp.costPrice ?? 0),
        added: true,
        variants: pp.variants,
        hasVariants: pp.hasVariants,
      },
    ]);
  const title = p ? t('purchases.receive.title', { number: p.number, supplier: p.supplier?.name ?? '—' }) : t('purchases.action.receive');
  const guard = useCloseGuard(typed.dirty || ls.some((l) => l.added), title, onClose);
  return (
    <>
    <Dialog
      open={!!purchaseId}
      onOpenChange={(o) => !o && !s.busy && guard.requestClose()}
      title={title}
      description={p ? t('purchases.receive.description', { remaining: formatNumber(sum.remainingBefore), ordered: formatNumber(sum.orderedTotal) }) : undefined}
      closeLabel={t('action.close')}
      size="xl"
      footer={
        <DialogFooter
          onClose={guard.requestClose}
          busy={s.busy}
          onSubmit={() => void submit()}
          label={t('purchases.receive.submit', { count: sum.units })}
          disabled={!p || sum.units <= 0 || missingVariant || overPay}
          note={p ? t('purchases.receive.note', { count: sum.movements, number: p.number }) : undefined}
        />
      }
    >
      <div className="flex flex-col gap-4" data-testid="receive-dialog" onChange={typed.onChange}>
        {loadError ? <FormAlert>{loadError}</FormAlert> : null}
        {!p && !loadError ? <p className="ts-label-meta text-text-muted">{t('common.loading')}</p> : null}
        {p ? (
          <>
            <div className="overflow-x-auto rounded-card border border-line-edge">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="ts-label-micro text-text-muted">
                    <th className="px-3 py-2 text-start font-normal">{t('purchases.col.productVariant')}</th>
                    <th className="px-3 py-2 text-end font-normal">{t('purchases.receive.ordered')}</th>
                    <th className="px-3 py-2 text-end font-normal">{t('purchases.receive.already')}</th>
                    <th className="px-3 py-2 text-end font-normal">{t('purchases.receive.today')}</th>
                    <th className="px-3 py-2 text-end font-normal">{t('purchases.col.unitCost')}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-hairline">
                  {ls.map((l, i) => {
                    const over = !l.added && l.already + int(l.now) > l.ordered;
                    return (
                      <tr key={l.id ?? `new-${i}`} data-line={l.productId} data-over={over || undefined}>
                        <td className="px-3 py-2">
                          <div>
                            {l.name}
                            {l.added ? <span className="text-text-muted"> {t('purchases.receive.added')}</span> : null}
                          </div>
                          {l.added && l.hasVariants ? (
                            <Select aria-label={t('orderForm.items.pickVariant')} value={l.variantId ?? ''} onChange={(e) => patch(i, { variantId: e.target.value || null })} className="mt-1 !h-7 w-auto min-w-32 text-[12px]" aria-invalid={!l.variantId || undefined}>
                              <option value="">{t('orderForm.items.pickVariant')}</option>
                              {l.variants.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name}
                                </option>
                              ))}
                            </Select>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-end">
                          <Ltr className="tabular-nums">{formatNumber(l.ordered)}</Ltr>
                        </td>
                        <td className="px-3 py-2 text-end">
                          <Ltr className="tabular-nums">{formatNumber(l.already)}</Ltr>
                        </td>
                        <td className="px-3 py-2">
                          <NumberInput aria-label={t('purchases.receive.todayFor', { name: l.name })} value={l.now} onValueChange={(v) => patch(i, { now: v })} maxDigits={6} className={`!h-8 ms-auto w-24 text-end ${over ? '!border-accent-starred' : ''}`} />
                        </td>
                        <td className="px-3 py-2">
                          <MoneyInput aria-label={t('purchases.receive.costFor', { name: l.name })} value={l.cost} onValueChange={(v) => patch(i, { cost: v })} className="!h-8 ms-auto w-32 text-end" />
                        </td>
                        <td className="px-1">
                          {l.added ? (
                            <button type="button" aria-label={t('orderForm.items.remove', { name: l.name })} onClick={() => setLines((x) => (x ?? []).filter((_, j) => j !== i))} className="p-1 text-text-muted hover:text-text-primary">
                              <X className="size-3.5" aria-hidden />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="text-[13px]">
              <summary className="inline-flex cursor-pointer items-center gap-1 text-text-secondary hover:text-text-primary">
                <Plus className="size-3.5" aria-hidden />
                {t('purchases.receive.addLine')}
              </summary>
              <div className="mt-2">
                <ProductPicker id="receive-product" onPick={add} refuse={(x) => (x.trackStock ? null : t('error.PURCHASE_UNTRACKED_PRODUCT', { product: x.name }))} />
              </div>
            </details>
            {sum.over.length ? (
              <p className="ts-label-meta !normal-case text-accent-starred" data-testid="over-receive-warning">
                ⚠ {t('purchases.receive.overWarning', { names: ls.filter((l) => !l.added && l.already + int(l.now) > l.ordered).map((l) => l.name).join(', ') })}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('purchases.receive.date')} htmlFor="rcv-date">
                <Input id="rcv-date" type="date" value={date} max={algiersDay()} onChange={(e) => setDate(e.target.value || algiersDay())} className="[color-scheme:dark]" />
              </Field>
              <Field label={t('purchases.receive.invoice')} htmlFor="rcv-invoice" error={s.fieldError('supplierInvoiceRef')}>
                <CodeInput id="rcv-invoice" value={invoice} maxLength={120} onChange={(e) => setInvoice(e.target.value)} placeholder="F-2026-118" />
              </Field>
              <Field label={t('purchases.receive.payNow')} htmlFor="rcv-pay" hint={t('purchases.receive.dueAfter', { amount: formatMoney(remainingAfter) })} error={pay > p.remaining ? t('suppliers.payment.overDue', { amount: formatMoney(p.remaining) }) : s.fieldError('paymentNow.amount')}>
                <div className="flex gap-2">
                  <MoneyInput id="rcv-pay" value={payNow} onValueChange={setPayNow} />
                  {pay > 0 ? (
                    <Select aria-label={t('gds.method')} value={method} onChange={(e) => setMethod(e.target.value as CashMethod)} className="w-28">
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {t(`orders.payment.method.${m}`)}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </div>
              </Field>
            </div>
            {missingVariant ? <FormAlert tone="warning">{t('error.VARIANT_REQUIRED')}</FormAlert> : null}
          </>
        ) : null}
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
    {guard.element}
    </>
  );
}

/* ---------- Annuler #ACH-… ---------- */
export function CancelPurchaseDialog({ purchaseId, onClose }: { purchaseId: string | null; onClose: () => void }) {
  const t = useT();
  const refresh = useGdsRefresh();
  const { purchase: p, error: loadError } = usePurchaseFor(purchaseId);
  const [reason, setReason] = useState('');
  useOnOpen(!!purchaseId, () => setReason(''));
  const s = useDialogSubmit(() => gdsApi.cancelPurchase(purchaseId!, reason.trim() || null));
  const received = p ? p.units.received : 0;
  const submit = async () => {
    const r = await s.submit();
    if (!r) return;
    toast(t('purchases.cancelled', { number: r.number }));
    await refresh();
    onClose();
  };
  return (
    <Dialog
      open={!!purchaseId}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={p ? t('purchases.cancel.title', { number: p.number }) : t('purchases.action.cancel')}
      description={p ? `${p.supplier?.name ?? '—'} · ${formatMoney(p.total)} · ${t(`enum.Purchase.status.${p.status}`)}` : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('purchases.action.cancel')} danger closeLabel={t('action.keep')} disabled={!p} />}
    >
      <div className="flex flex-col gap-4" data-testid="cancel-purchase-dialog">
        <Pill tone="danger" className="w-fit !rounded-[4px]">
          {t('common.destructive')}
        </Pill>
        {loadError ? <FormAlert>{loadError}</FormAlert> : null}
        {p ? <p className="text-[13px] text-text-secondary">{received > 0 ? t('purchases.cancel.partial', { count: received }) : t('purchases.cancel.none')}</p> : null}
        <Field label={t('common.noteOptional')} htmlFor="pc-reason" error={s.fieldError('reason')}>
          <Input id="pc-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={t('purchases.cancel.reasonPlaceholder')} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Payer le solde / Enregistrer un paiement ---------- */
export function PurchasePaymentDialog({ purchaseId, onClose }: { purchaseId: string | null; onClose: () => void }) {
  const t = useT();
  const refresh = useGdsRefresh();
  const { purchase: p, error: loadError } = usePurchaseFor(purchaseId);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CashMethod>('cash');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(algiersDay());
  const [touched, setTouched] = useState(false);
  const [filled, setFilled] = useState<string | null>(null);
  useOnOpen(!!purchaseId, () => {
    setAmount('');
    setMethod('cash');
    setReference('');
    setDate(algiersDay());
    setTouched(false);
    setFilled(null);
  });
  if (p && filled !== p.id) {
    setFilled(p.id);
    setAmount(moneyDigits(p.remaining));
    setMethod(p.paymentMethod ?? 'cash');
  }
  const value = digitsToInt(amount);
  const err = !value ? 'validation.required' : p && value > p.remaining ? 'suppliers.payment.overDue' : null;
  const s = useDialogSubmit((key) => gdsApi.purchasePayment(purchaseId!, { amount: value!, method, reference: reference.trim() || null, paidAt: date === algiersDay() ? undefined : new Date(`${date}T12:00:00Z`).toISOString() }, key));
  const submit = async () => {
    setTouched(true);
    if (err) return;
    const r = await s.submit();
    if (!r) return;
    toast(t('purchases.payment.done', { amount: formatMoney(value!), number: r.number }));
    await refresh();
    onClose();
  };
  return (
    <Dialog
      open={!!purchaseId}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={p ? t('purchases.payment.title', { number: p.number }) : t('action.recordPayment')}
      description={p ? t('purchases.payment.context', { total: formatMoney(p.total), paid: formatMoney(p.amountPaid), remaining: formatMoney(p.remaining) }) : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} disabled={!p} note={p ? t('purchases.payment.note', { number: p.number }) : undefined} />}
    >
      <div className="flex flex-col gap-4" data-testid="purchase-payment-dialog">
        {loadError ? <FormAlert>{loadError}</FormAlert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('gds.amount')} htmlFor="pp-amount" required error={touched && err ? t(err, { amount: formatMoney(p?.remaining ?? 0) }) : s.fieldError('amount')}>
            <MoneyInput id="pp-amount" value={amount} onValueChange={setAmount} aria-invalid={(touched && !!err) || undefined} />
          </Field>
          <Field label={t('gds.method')} htmlFor="pp-method">
            <Select id="pp-method" value={method} onChange={(e) => setMethod(e.target.value as CashMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`orders.payment.method.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.date')} htmlFor="pp-date">
            <Input id="pp-date" type="date" value={date} max={algiersDay()} onChange={(e) => setDate(e.target.value || algiersDay())} className="[color-scheme:dark]" />
          </Field>
          <Field label={t('suppliers.payment.reference')} htmlFor="pp-ref">
            <CodeInput id="pp-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/** Header button helper: a single server action as a button (greyed with its reason). */
export function ActionButton({ action, label, onClick, variant = 'secondary', testId }: { action: { present: boolean; enabled: boolean; reason?: string }; label: string; onClick: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; testId?: string }) {
  if (!action.present) return null;
  return (
    <Button variant={variant} onClick={onClick} disabledReason={action.enabled ? undefined : action.reason} data-testid={testId}>
      {label}
    </Button>
  );
}
