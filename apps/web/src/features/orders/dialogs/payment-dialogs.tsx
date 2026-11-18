'use client';
// Order page dialogs of the online payment (P2, D4) — Figma "DLG — Orders, delivery & clients II":
// - "Lien de paiement" (PAY-02, FL-10): CRÉER (amount = order total, valid 15 min, one active link, posted in the
//   conversation) → creating… → CRÉÉ (url · Copier · expires at) → PAYÉ (date · commande → payée) / EXPIRÉ / ÉCHEC
//   (Générer un nouveau lien) / MONTANT DIFFÉRENT (`PAYMENT_AMOUNT_MISMATCH`, not marked paid). `POST|GET
//   /orders/:id/payment-link` (`orders.money`); the link follows WS `order.updated` and a short poll while it is created.
// - "Rembourser" (PAY-03): amount ≤ paid, reason, note, method → `POST /orders/:id/refunds` (recorded refund: locked
//   `refund` cash row, order → remboursée).
import { formatDateTime, formatMoney, PAYMENT_LINK_MINUTES, type OrderPaymentLinkDto } from '@djaber/shared';
import { Button, Checkbox, Dialog, EstimateBox, Field, FormAlert, Input, Ltr, MoneyInput, Select, Skeleton, StatusPill, Textarea, toast } from '@djaber/ui';
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { ClosedDayHint } from '@/components/closed-day-hint';
import { digitsToInt, moneyDigits } from '@/lib/money';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { ordersApi } from '../api';
import { PAYMENT_METHODS, type PaymentMethod } from '../contracts';
import { DialogFooter, useDialogSubmit, useOnOpen, type DialogBaseProps } from './common';

type Props = DialogBaseProps & { open: boolean };
type LinkStatus = OrderPaymentLinkDto['status'];
/** Pill tone key of a link status (`PaymentLink.status` in the kit map). */
const pillValue = (s: LinkStatus): string => (s === 'creating' ? 'pending' : s === 'refunded' ? 'cancelled' : s);
/** A link that can be replaced by a new one (nothing open, nothing paid). */
export const linkClosed = (l: Pick<OrderPaymentLinkDto, 'status'> | null | undefined): boolean => !l || l.status === 'expired' || l.status === 'failed';

/* ---------- Lien de paiement ---------- */
export function PaymentLinkDialog({ order, open, onClose, onDone }: Props) {
  const t = useT();
  const locale = useLocaleCode();
  const ws = useWorkspaceId();
  const [send, setSend] = useState(true);
  useOnOpen(open, () => setSend(!!order.conversationId));
  const link = useQuery({
    queryKey: [ws, 'order', order.id, 'payment-link'],
    queryFn: () => ordersApi.paymentLink(order.id),
    enabled: open,
    initialData: order.paymentLink ? ({ ...order.paymentLink, orderId: order.id, paidAt: null, sentToCustomer: false, createdAt: '' } as OrderPaymentLinkDto) : undefined,
    initialDataUpdatedAt: 0,
    // `creating` lasts about a second (the worker calls the gateway); an open link is re-read for its outcome
    refetchInterval: (q) => (q.state.data?.status === 'creating' ? 1_000 : q.state.data?.status === 'pending' ? 10_000 : false),
  });
  const l = link.data ?? null;
  const s = useDialogSubmit(() => ordersApi.createPaymentLink(order.id, { send: send && !!order.conversationId }));
  const create = async () => {
    const r = await s.submit();
    if (r === undefined) return;
    await link.refetch();
    await onDone();
  };
  const copy = async () => {
    if (!l?.url) return;
    try {
      await navigator.clipboard.writeText(l.url);
      toast(t('orders.paymentLink.copied'));
    } catch {
      toast({ tone: 'danger', message: t('orders.paymentLink.copyFailed') });
    }
  };
  const fresh = linkClosed(l);
  const status = l?.status ?? null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.paymentLink.title')}
      description={t('orders.paymentLink.context', { number: order.number, total: formatMoney(order.remaining > 0 ? order.remaining : order.total) })}
      closeLabel={t('action.close')}
      footer={
        fresh ? (
          <DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void create()} label={l ? t('orders.paymentLink.regenerate') : t('orders.paymentLink.create')} closeLabel={t('action.close')} />
        ) : (
          <>
            {status === 'pending' ? (
              <Button variant="ghost" onClick={() => void create()} loading={s.busy} data-testid="payment-link-renew">
                {t('orders.paymentLink.regenerate')}
              </Button>
            ) : null}
            <Button variant="primary" onClick={onClose}>
              {t('action.close')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3" data-testid="payment-link-dialog" data-status={status ?? 'none'}>
        {link.isPending && !l ? <Skeleton className="h-16" /> : null}
        {!l || fresh ? (
          <EstimateBox>
            <span className="me-2 rounded-[4px] border border-line-edge px-1.5 py-0.5 ts-label-micro">{t('orders.paymentLink.label.create')}</span>
            {t('orders.paymentLink.createText', { minutes: PAYMENT_LINK_MINUTES })}
          </EstimateBox>
        ) : null}
        {l && status !== 'creating' ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill enumKey="PaymentLink.status" value={pillValue(l.status)} className="!rounded-[4px]">
              {t(`orders.paymentLink.status.${l.status}`)}
            </StatusPill>
            <Ltr className="text-[13px] font-medium tabular-nums">{formatMoney(l.amount)}</Ltr>
          </div>
        ) : null}
        {status === 'creating' ? (
          <p role="status" className="ts-label-meta text-text-muted" data-testid="payment-link-creating">
            {t('orders.paymentLink.creating')}
          </p>
        ) : null}
        {status === 'pending' && l?.url ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input readOnly value={l.url} dir="ltr" className="font-mono text-[12px]" aria-label={t('orders.paymentLink.url')} data-testid="payment-link-url" onFocus={(e) => e.currentTarget.select()} />
              <Button onClick={() => void copy()} data-testid="payment-link-copy">
                <Copy className="size-3.5" aria-hidden />
                {t('orders.paymentLink.copy')}
              </Button>
            </div>
            <p className="ts-label-meta text-text-muted">
              {l.expiresAt ? t('orders.paymentLink.expires', { at: formatDateTime(l.expiresAt, locale as 'fr') }) : null}
              {l.sentToCustomer ? ` · ${t('orders.paymentLink.sent')}` : ''}
            </p>
          </div>
        ) : null}
        {status === 'paid' ? <p className="text-[13px] text-accent-money">{t('orders.paymentLink.paid', { date: l?.paidAt ? formatDateTime(l.paidAt, locale as 'fr') : '—' })}</p> : null}
        {status === 'expired' ? <p className="text-[13px] text-text-secondary">{t('orders.paymentLink.expired')}</p> : null}
        {status === 'failed' ? <p className="text-[13px] text-accent-alert">{t('orders.paymentLink.failed')}</p> : null}
        {status === 'mismatch' ? <FormAlert tone="warning">{t('orders.paymentLink.mismatch')}</FormAlert> : null}
        {status === 'refunded' ? <p className="text-[13px] text-text-secondary">{t('orders.paymentLink.refunded')}</p> : null}
        {fresh ? (
          <label className="flex items-start gap-2.5 text-[13px]">
            <Checkbox checked={send && !!order.conversationId} disabled={!order.conversationId} onChange={(e) => setSend(e.target.checked)} className="mt-0.5" data-testid="payment-link-send" />
            <span>
              {t('orders.paymentLink.send')}
              {!order.conversationId ? <span className="block ts-label-meta text-text-muted">{t('orders.paymentLink.noConversation')}</span> : null}
            </span>
          </label>
        ) : null}
        {s.error ? (
          <FormAlert>
            {s.error}
            <ClosedDayHint day={s.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Rembourser ---------- */
const REFUND_REASONS = ['return', 'defective', 'cancelled', 'goodwill', 'other'] as const;
type RefundReason = (typeof REFUND_REASONS)[number];

export function RefundDialog({ order, open, onClose, onDone }: Props) {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<RefundReason>('return');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [touched, setTouched] = useState(false);
  const online = order.paymentLink?.status === 'paid';
  useOnOpen(open, () => {
    setAmount(moneyDigits(order.amountPaid));
    setReason('return');
    setNote('');
    setMethod(online ? 'card' : (order.paymentMethod ?? 'cash'));
    setTouched(false);
  });
  const value = digitsToInt(amount);
  const err = value === null || value <= 0 ? 'validation.required' : value > order.amountPaid ? 'orders.refund.overPaid' : null;
  const reasonText = reason === 'other' ? note.trim() : `${t(`orders.refund.reason.${reason}`)}${note.trim() ? ` — ${note.trim()}` : ''}`;
  const reasonErr = reasonText.length < 3 ? 'orders.refund.reasonRequired' : null;
  const s = useDialogSubmit(() => ordersApi.refund(order.id, { amount: value!, reason: reasonText.slice(0, 500), method }));
  const submit = async () => {
    setTouched(true);
    if (err || reasonErr) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.refund.done', { amount: formatMoney(value!) }));
    await onDone(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.refund.title')}
      description={t(online ? 'orders.refund.contextOnline' : 'orders.refund.context', { number: order.number, amount: formatMoney(order.amountPaid) })}
      closeLabel={t('action.close')}
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.refund')} danger />}
    >
      <div className="flex flex-col gap-4" data-testid="refund-dialog">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('orders.refund.amount')} htmlFor="refund-amount" error={touched && err ? t(err, { amount: formatMoney(order.amountPaid) }) : s.fieldError('amount')} hint={t('orders.refund.amountHint', { amount: formatMoney(order.amountPaid) })}>
            <MoneyInput id="refund-amount" value={amount} onValueChange={setAmount} aria-invalid={(touched && !!err) || undefined} data-testid="refund-amount" />
          </Field>
          <Field label={t('orders.refund.reason')} htmlFor="refund-reason">
            <Select id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value as RefundReason)} data-testid="refund-reason">
              {REFUND_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`orders.refund.reason.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={reason === 'other' ? t('orders.refund.noteRequired') : t('common.note')} htmlFor="refund-note" error={touched && reasonErr ? t(reasonErr) : s.fieldError('reason')}>
          <Textarea id="refund-note" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} className="min-h-14" />
        </Field>
        <Field label={t('orders.payment.method')} htmlFor="refund-method">
          <Select id="refund-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`orders.payment.method.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <p className="ts-label-micro !normal-case text-text-muted">{t('orders.refund.info')}</p>
        {s.error ? (
          <FormAlert>
            {s.error}
            <ClosedDayHint day={s.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}
