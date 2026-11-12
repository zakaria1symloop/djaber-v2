'use client';
// "Confirmer la commande #CMD-1042" (Figma ORD-07 — Confirm order dialog — outcome step; 12 §5 "Confirm dialog"):
// 1 · VÉRIFIER (contact, region, items, totals, last calls; address missing ⇒ blocked ORDER_ADDRESS_REQUIRED) →
// 2 · APPEL (CallResult + note; `picked_up` confirms the order server-side) → 3 · RÉSULTAT (status result, Préparer,
// Envoyer au transporteur enabled only with a courier — server descriptor — , Fermer). Also "Résultat de l'appel".
import { formatMoney, formatPhoneDz } from '@djaber/shared';
import { Button, ChecksNote, Dialog, FormAlert, Ltr, StepChips, toast, Tooltip, type StepChip } from '@djaber/ui';
import { Phone } from 'lucide-react';
import { useState } from 'react';
import { actionState } from '@/lib/actions';
import { useT } from '@/lib/i18n';
import { ORDER_ACTION } from '../action-keys';
import { ordersApi } from '../api';
import { ORDER_NO_ANSWER_PROPOSAL_AT, type Order } from '../contracts';
import { addressMissing, algiersTime, confirmChecks, newestFirst, unansweredCalls } from '../logic';
import { CallResultPill } from '../ui';
import { useDialogSubmit, useOnOpen, type DialogBaseProps } from './common';
import { emptyOutcome, OutcomeFields, outcomeErrors, type OutcomeValue } from './outcome';

type Step = 'review' | 'call' | 'result';

/** Contact card shared by the steps: name, phone (tel: link), region · address, total and the items line. */
function ContactCard({ order }: { order: Order }) {
  const t = useT();
  const misses = unansweredCalls(order);
  const a = order.address;
  const region = a ? [a.wilayaName, a.communeText, a.isStopdesk ? (a.stopdeskName ?? t('common.stopdesk')) : a.address].filter(Boolean).join(' · ') : t('orders.confirm.noAddress');
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-ink-raised px-4 py-3" data-testid="confirm-contact">
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{order.clientName}</div>
        <a href={`tel:${order.clientPhone}`} className="inline-flex items-center gap-1.5 text-[13px] text-accent-inbound hover:underline">
          <Ltr>{formatPhoneDz(order.clientPhone)}</Ltr>
          <Phone className="size-3.5" aria-hidden />
          {t('orders.confirm.call')}
        </a>
        <div className={a ? 'text-[13px] text-text-secondary' : 'text-[13px] text-accent-alert'}>{region}</div>
      </div>
      <div className="text-end">
        <Ltr className="ts-numeral-l">{formatMoney(order.total)}</Ltr>
        <div className="ts-label-micro text-text-muted">
          {[t('orders.confirm.items', { count: order.itemCount }), order.deliveryFee === 0 ? t('orders.confirm.freeDelivery') : t('orders.confirm.delivery', { amount: formatMoney(order.deliveryFee) }), t(`enum.Order.paymentMethod.${order.paymentMethod}`)].join(' · ')}
        </div>
        {misses ? <div className="ts-label-micro text-accent-starred">{t('orders.confirm.previousMisses', { count: misses })}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmOrderDialog({ order, open, onClose, onDone, onAddress, onPrepare, onSendToCourier, mode = 'confirm' }: DialogBaseProps & { open: boolean; onAddress: () => void; onPrepare: (o: Order) => void; onSendToCourier: (o: Order) => void; mode?: 'confirm' | 'log' }) {
  const t = useT();
  const [step, setStep] = useState<Step>(mode === 'log' ? 'call' : 'review');
  const [outcome, setOutcome] = useState<OutcomeValue>(emptyOutcome());
  const [touched, setTouched] = useState(false);
  const [fresh, setFresh] = useState<Order | null>(null);
  useOnOpen(open, () => {
    setStep(mode === 'log' ? 'call' : 'review');
    setOutcome(mode === 'confirm' ? { ...emptyOutcome(), result: 'picked_up' } : emptyOutcome());
    setTouched(false);
    setFresh(null);
  });
  const missing = addressMissing(order);
  const checks = confirmChecks(order);
  const errors = touched ? outcomeErrors(outcome) : {};
  const s = useDialogSubmit(async () => {
    await ordersApi.logCall(order.id, { result: outcome.result!, callbackAt: outcome.callbackAt ?? undefined, notes: outcome.notes.trim() || undefined });
    // the call answer is the order (or the call row): the result step needs the new state and its actions
    const next = await ordersApi.order(order.id);
    await onDone(next);
    return next;
  });
  const logCall = async () => {
    setTouched(true);
    if (Object.keys(outcomeErrors(outcome)).length) return;
    if (outcome.result === 'picked_up' && missing) return s.setError(t('error.ORDER_ADDRESS_REQUIRED'));
    const next = await s.submit();
    if (!next) return;
    setFresh(next);
    if (mode === 'log') {
      toast(t('orders.call.saved'));
      return onClose();
    }
    setStep('result');
  };

  const title = mode === 'log' ? t('dialog.callResult.title') : t('orders.confirm.title', { number: order.number });
  const stepIndex = step === 'review' ? 1 : step === 'call' ? 2 : 3;
  const chips: StepChip[] = (['review', 'call', 'result'] as Step[]).map((k, i) => ({ key: k, label: t(`orders.confirm.step.${k}`), state: i + 1 < stepIndex ? 'done' : i + 1 === stepIndex ? 'active' : 'upcoming' }));
  const description = mode === 'log' ? `#${order.number} · ${order.clientName} · ${t('orders.call.attempt', { count: order.callAttempts + 1 })}` : t('orders.confirm.stepOf', { step: stepIndex, label: t(`orders.confirm.stepTitle.${step}`) });

  const result = fresh ?? order;
  const prepare = actionState(result.actions, ORDER_ACTION.prepare, t);
  const send = actionState(result.actions, ORDER_ACTION.sendToCourier, t);
  const resultText = (() => {
    if (!fresh) return '';
    if (fresh.status === 'cancelled') return t('orders.confirm.result.cancelled', { number: fresh.number });
    // `order` is already the refreshed order here (the page re-renders after `onDone`): read the outcome, not the old status
    if (outcome.result === 'picked_up' && fresh.confirmationStatus === 'confirmed' && fresh.status === 'confirmed') return t('toast.order.confirmed', { number: fresh.number });
    if (fresh.confirmationStatus === 'callback' && fresh.callbackAt) return t('orders.confirm.result.callback', { time: algiersTime(fresh.callbackAt) });
    if (fresh.confirmationStatus === 'no_answer') return t('orders.confirm.result.noAnswer', { count: fresh.callAttempts });
    return t('orders.call.saved');
  })();

  const footer =
    step === 'review' ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          {t('action.close')}
        </Button>
        <Button variant="primary" onClick={() => setStep('call')} data-testid="confirm-next">
          {t('action.continue')}
        </Button>
      </>
    ) : step === 'call' ? (
      <>
        {mode === 'confirm' ? (
          <Button variant="ghost" onClick={() => setStep('review')} disabled={s.busy}>
            {t('action.back')}
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose} disabled={s.busy}>
            {t('action.cancel')}
          </Button>
        )}
        <Button variant="primary" onClick={() => void logCall()} loading={s.busy} data-testid="dialog-submit">
          {outcome.result === 'picked_up' && order.status === 'new' ? t('orders.confirm.submit') : t('orders.call.submit')}
        </Button>
      </>
    ) : (
      <>
        {prepare.present ? (
          <Button onClick={() => onPrepare(result)} disabledReason={prepare.enabled ? undefined : prepare.reason}>
            {t('action.prepare')}
          </Button>
        ) : null}
        {send.present ? (
          <Tooltip content={send.reason ?? t('action.sendToCourier')}>
            <span>
              <Button onClick={() => onSendToCourier(result)} disabled={!send.enabled} data-testid="confirm-send">
                {t('action.sendToCourier')}
              </Button>
            </span>
          </Tooltip>
        ) : null}
        <Button variant="primary" onClick={onClose}>
          {t('action.close')}
        </Button>
      </>
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !s.busy && onClose()} title={title} description={description} closeLabel={t('action.close')} size="lg" footer={footer}>
      <div className="flex flex-col gap-4" data-testid="confirm-dialog" data-step={step}>
        {mode === 'confirm' ? <StepChips steps={chips} label={t('orders.confirm.steps')} /> : null}
        <ContactCard order={result} />
        {step === 'review' ? (
          <>
            {missing ? (
              <FormAlert>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t('orders.confirm.addressMissing')}</span>
                  <Button size="sm" onClick={onAddress} data-testid="confirm-address">
                    {t('orders.confirm.completeAddress')}
                  </Button>
                </span>
              </FormAlert>
            ) : null}
            <ul className="divide-y divide-line-hairline rounded-card border border-line-edge" aria-label={t('common.items')}>
              {order.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <span className="min-w-0 truncate">
                    {i.productName}
                    {i.variantName ? <span className="text-text-muted"> · {i.variantName}</span> : null}
                    <span className="text-text-muted"> ×{i.quantity}</span>
                  </span>
                  <Ltr className="tabular-nums">{formatMoney(i.total)}</Ltr>
                </li>
              ))}
            </ul>
            {order.calls.length ? (
              <div className="flex flex-col gap-1.5">
                <span className="ts-label-section text-text-muted">{t('orders.confirm.lastCalls')}</span>
                {newestFirst(order.calls, (c) => c.calledAt)
                  .slice(0, 3)
                  .map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                      <CallResultPill result={c.result} />
                      <span className="ts-label-micro text-text-muted">
                        {c.user.firstName} · <Ltr>{algiersTime(c.calledAt)}</Ltr>
                      </span>
                      {c.notes ? <span className="text-text-secondary">{c.notes}</span> : null}
                    </div>
                  ))}
              </div>
            ) : null}
          </>
        ) : null}
        {step === 'call' ? (
          <>
            {order.status === 'cancelled' || order.status === 'returned' ? <FormAlert tone="warning">{t('orders.call.terminalWarning')}</FormAlert> : null}
            <OutcomeFields value={outcome} onChange={setOutcome} disabled={s.busy} errors={{ result: errors.result && t(errors.result), callbackAt: errors.callbackAt && t(errors.callbackAt, { min: '', max: '' }) }} />
            {outcome.result === 'picked_up' ? (
              <ChecksNote
                tone={missing ? 'danger' : 'success'}
                items={[
                  { label: t('orders.confirm.check.address'), ok: checks.address },
                  { label: t('orders.confirm.check.wilaya'), ok: checks.wilaya },
                  { label: t('orders.confirm.check.phone'), ok: checks.phone },
                ]}
                text={missing ? t('orders.confirm.checksMissing') : t('orders.confirm.checksOk')}
              />
            ) : null}
            {outcome.result === 'no_answer' && order.callAttempts + 1 >= ORDER_NO_ANSWER_PROPOSAL_AT ? <FormAlert tone="warning">{t('orders.call.thirdNoAnswer')}</FormAlert> : null}
            {s.error ? <FormAlert>{s.error}</FormAlert> : null}
          </>
        ) : null}
        {step === 'result' ? (
          <div className="flex flex-col gap-2" data-testid="confirm-result">
            <p className="text-[14px] font-medium">{resultText}</p>
            {fresh?.status === 'confirmed' ? <p className="ts-label-meta text-text-muted">{t('orders.confirm.result.next')}</p> : null}
            {send.present && !send.enabled && send.reason ? <p className="ts-label-micro !normal-case text-text-muted">{t('action.sendToCourier')} : {send.reason}</p> : null}
            {fresh?.confirmationStatus === 'no_answer' && fresh.callAttempts >= ORDER_NO_ANSWER_PROPOSAL_AT ? <p className="ts-label-meta text-accent-starred">{t('orders.call.thirdNoAnswer')}</p> : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

