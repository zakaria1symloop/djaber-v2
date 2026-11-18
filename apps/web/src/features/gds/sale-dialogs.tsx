'use client';
// Sale actions and dialogs — Figma DLG GDS "Annuler la vente #VTE-…" (motif, réintégrer le stock, rembourser,
// > 7 j `SALE_CANNOT_CANCEL_AFTER_7D`), "Encaisser le reste" (montant, mode, note · Vente → PAYÉE · ligne de caisse),
// DLG GDS II "Ventes — verrous & confirmations" (modifier le paiement · mode, Supprimer: brouillon ou non payée
// uniquement `SALE_DELETE_PAID` → Annuler la vente) and "Lier à un client" (GDS-07 fix). Menu items come from the
// server descriptors (`actions`), greyed with their code.
import { formatMoney, formatPhoneDz, storedText } from '@djaber/shared';
import { Checkbox, ConfirmDialog, Dialog, Field, focusSoon, FormAlert, Input, Ltr, MoneyInput, Pill, PickerSearch, Select, Textarea, toast, useComboboxList, type MenuAction } from '@djaber/ui';
import { useState } from 'react';
import { ClosedDayHint } from '@/components/closed-day-hint';
import { ApiError } from '@/lib/api';
import type { ClientListItem } from '@/features/clients/contracts';
import { DialogFooter, refusal, useDialogSubmit, useOnOpen } from '@/features/orders/dialogs/common';
import { useClientSearch } from '@/features/orders/form/api';
import { useRouter } from '@/i18n/navigation';
import { offlineMenu, toMenuActions } from '@/lib/actions';
import { useOffline } from '@/features/orders/offline';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl } from '@/lib/jobs';
import { digitsToInt, moneyDigits } from '@/lib/money';
import { gdsApi, useGdsRefresh } from './api';
import { PAYMENT_METHODS, type CashMethod, type Sale, type SaleRow } from './contracts';

type SaleRef = Pick<SaleRow, 'id' | 'number' | 'status' | 'actions'>;
type Dlg = { kind: 'collect' | 'cancel' | 'link' | 'edit' | 'delete' | 'validate'; id: string; number: string } | null;
export const CANCEL_SALE_REASONS = ['entry_error', 'customer_return', 'defective', 'other'] as const;

export function useSaleActions(o: { onDeleted?: () => void; onEditDraft?: (id: string) => void } = {}) {
  const t = useT();
  const offline = useOffline();
  const router = useRouter();
  const locale = useLocaleCode();
  const refresh = useGdsRefresh();
  const [dlg, setDlg] = useState<Dlg>(null);
  const receipt = async (id: string) => {
    try {
      const f = await gdsApi.saleReceipt(id, locale);
      downloadUrl(f.url, f.fileName);
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    }
  };
  const [validating, setValidating] = useState(false);
  // CLAUDE rule 8 (journeys 16/11 J06-2): a refused validate / delete stays inside its confirm dialog, with the way out
  const [dlgError, setDlgError] = useState<{ message: string; code: string | null } | null>(null);
  const refused = (e: unknown) => setDlgError({ message: refusal(e, t), code: e instanceof ApiError ? e.code : null });
  // validating a draft takes the stock out and the money in: confirmed first (cancel / delete confirm too)
  const validate = async (s: { id: string }) => {
    setValidating(true);
    setDlgError(null);
    try {
      const r = await gdsApi.updateSale(s.id, { status: 'completed' });
      await refresh();
      toast(t('sales.validated', { number: r.number }));
      setDlg(null);
    } catch (e) {
      refused(e);
    } finally {
      setValidating(false);
    }
  };
  const open = (d: Dlg) => {
    setDlgError(null);
    setDlg(d);
  };
  const close = () => {
    setDlgError(null);
    setDlg(null);
  };
  const menu = (s: SaleRef): MenuAction[] =>
    offlineMenu(toMenuActions(
      s.actions,
      {
        validate: { label: t('sales.action.validate'), hint: t('gds.hint.dialog'), onSelect: () => open({ kind: 'validate', id: s.id, number: s.number }) },
        collect: { label: t('sales.action.collect'), hint: t('gds.hint.dialog'), onSelect: () => open({ kind: 'collect', id: s.id, number: s.number }) },
        open: { label: t('action.open'), hint: t('gds.hint.page'), onSelect: () => router.push(`/sales/${s.id}`) },
        receipt: { label: t('sales.action.receipt'), onSelect: () => void receipt(s.id) },
        link_client: { label: t('sales.action.linkClient'), hint: t('gds.hint.dialog'), onSelect: () => open({ kind: 'link', id: s.id, number: s.number }) },
        edit: { label: s.status === 'draft' ? t('action.edit') : t('sales.action.editPayment'), onSelect: () => (s.status === 'draft' && o.onEditDraft ? o.onEditDraft(s.id) : open({ kind: 'edit', id: s.id, number: s.number })) },
        cancel: { label: t('sales.action.cancel'), separated: true, destructive: true, onSelect: () => open({ kind: 'cancel', id: s.id, number: s.number }) },
        delete: { label: t('action.delete'), destructive: true, onSelect: () => open({ kind: 'delete', id: s.id, number: s.number }) },
      },
      t,
    ), offline ? t('banner.offline') : undefined, ['open', 'receipt']);
  // the partial walk-in draft is finished from the sheet, where the client is added (04 §20 « Draft sale client »)
  const editDraft = dlgError?.code === 'SALE_PARTIAL_REQUIRES_CUSTOMER' && dlg && o.onEditDraft ? dlg.id : null;
  const errorBox = dlgError ? (
    <FormAlert>
      {dlgError.message}
      {editDraft ? (
        <>
          {' '}
          <button type="button" className="font-semibold underline" onClick={() => { close(); o.onEditDraft!(editDraft); }}>
            {t('action.edit')}
          </button>
        </>
      ) : null}
    </FormAlert>
  ) : null;
  const element = (
    <>
      <CollectDialog saleId={dlg?.kind === 'collect' ? dlg.id : null} onClose={close} />
      <CancelSaleDialog saleId={dlg?.kind === 'cancel' ? dlg.id : null} onClose={close} />
      <LinkClientDialog saleId={dlg?.kind === 'link' ? dlg.id : null} number={dlg?.number ?? ''} onClose={close} />
      <EditSaleDialog saleId={dlg?.kind === 'edit' ? dlg.id : null} onClose={close} />
      <ConfirmDialog
        open={dlg?.kind === 'validate'}
        onOpenChange={(v) => !v && close()}
        title={t('sales.validateConfirm.title', { number: dlg?.number ?? '' })}
        description={t('sales.validateConfirm.description')}
        confirmLabel={t('sales.action.validate')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        loading={validating}
        onConfirm={() => dlg?.kind === 'validate' && void validate(dlg)}
      >
        {dlg?.kind === 'validate' ? errorBox : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={dlg?.kind === 'delete'}
        onOpenChange={(v) => !v && close()}
        title={t('sales.delete.title', { number: dlg?.number ?? '' })}
        description={t('sales.delete.description')}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        destructive
        closeLabel={t('action.close')}
        onConfirm={() =>
          void (async () => {
            if (!dlg) return;
            try {
              await gdsApi.deleteSale(dlg.id);
              await refresh();
              toast(t('sales.deleted', { number: dlg.number }));
              close();
              o.onDeleted?.();
            } catch (e) {
              refused(e);
            }
          })()
        }
      >
        {dlg?.kind === 'delete' ? errorBox : null}
      </ConfirmDialog>
    </>
  );
  return { menu, element, open, receipt };
}

function useSaleFor(id: string | null) {
  const t = useT();
  const [s, setS] = useState<Sale | null>(null);
  const [error, setError] = useState<unknown>(null);
  useOnOpen(!!id, () => {
    setS(null);
    setError(null);
    if (id)
      gdsApi
        .sale(id)
        .then(setS)
        .catch((e) => setError(e));
  });
  return { sale: s, error: error ? refusal(error, t) : null };
}

const saleContext = (t: ReturnType<typeof useT>, s: Sale) =>
  [s.client?.name ?? s.customerName ?? t('sales.walkIn'), formatMoney(s.total), s.paymentStatus !== 'paid' ? `${t(`enum.Sale.paymentStatus.${s.paymentStatus}`).toLowerCase()} (${t('sales.collected', { amount: formatMoney(s.amountPaid) })})` : null].filter(Boolean).join(' · ');

/* ---------- Encaisser le reste ---------- */
export function CollectDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const t = useT();
  const refresh = useGdsRefresh();
  const { sale: s, error: loadError } = useSaleFor(saleId);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CashMethod>('cash');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [filled, setFilled] = useState<string | null>(null);
  // journeys 16/11 J06-3: the prefill (remaining, the sale's method) arrives with the sale; a field the seller already
  // typed in or picked before that moment keeps what they chose (« 3400 » became « 3 400 400 »)
  const [edited, setEdited] = useState({ amount: false, method: false });
  useOnOpen(!!saleId, () => {
    setAmount('');
    setNote('');
    setTouched(false);
    setFilled(null);
    setEdited({ amount: false, method: false });
  });
  if (s && filled !== s.id) {
    setFilled(s.id);
    if (!edited.amount) setAmount(moneyDigits(s.remaining));
    if (!edited.method) setMethod(s.paymentMethod);
  }
  const value = digitsToInt(amount);
  // full-test 15/11 SALES-CASH-22: « 0 » is not « empty »: it says the amount must be above 0
  const err = value === null ? 'validation.required' : value === 0 ? 'validation.amount_positive' : s && value > s.remaining ? 'suppliers.payment.overDue' : null;
  const sub = useDialogSubmit((key) => gdsApi.salePayment(saleId!, { amount: value!, method, note: note.trim() || null }, key));
  const submit = async () => {
    setTouched(true);
    if (err) return;
    const r = await sub.submit();
    if (!r) return;
    toast(t('sales.collect.done', { amount: formatMoney(value!), number: r.number }));
    await refresh();
    onClose();
  };
  return (
    <Dialog
      open={!!saleId}
      onOpenChange={(o) => !o && !sub.busy && onClose()}
      title={t('sales.collect.title')}
      description={s ? t('sales.collect.context', { number: s.number, amount: formatMoney(s.remaining) }) : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={sub.busy} onSubmit={() => void submit()} label={t('sales.collect.submit')} disabled={!s} note={s && value !== null && value > 0 && value < s.remaining ? t('sales.collect.notePartial', { amount: formatMoney(s.remaining - value) }) : t('sales.collect.note')} />}
    >
      <div className="flex flex-col gap-4" data-testid="collect-dialog">
        {loadError ? <FormAlert>{loadError}</FormAlert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('gds.amount')} htmlFor="col-amount" error={(touched || err === 'suppliers.payment.overDue') && err ? t(err, { amount: formatMoney(s?.remaining ?? 0) }) : sub.fieldError('amount')}>
            <MoneyInput
              id="col-amount"
              value={amount}
              onValueChange={(v) => {
                setAmount(v);
                setEdited((x) => (x.amount ? x : { ...x, amount: true }));
              }}
            />
          </Field>
          <Field label={t('gds.method')} htmlFor="col-method">
            <Select
              id="col-method"
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as CashMethod);
                setEdited((x) => (x.method ? x : { ...x, method: true }));
              }}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`sales.method.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('common.note')} htmlFor="col-note">
          <Input id="col-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {sub.error ? (
          <FormAlert>
            {sub.error}
            <ClosedDayHint day={sub.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Annuler la vente ---------- */
export function CancelSaleDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const t = useT();
  const refresh = useGdsRefresh();
  const { sale: s, error: loadError } = useSaleFor(saleId);
  const [reason, setReason] = useState<(typeof CANCEL_SALE_REASONS)[number]>('entry_error');
  const [other, setOther] = useState('');
  const [restock, setRestock] = useState(true);
  const [refund, setRefund] = useState(true);
  const [touched, setTouched] = useState(false);
  useOnOpen(!!saleId, () => {
    setReason('entry_error');
    setOther('');
    setRestock(true);
    setRefund(true);
    setTouched(false);
  });
  // full-test 15/11 SALES-CASH-14: a reason picked in the list is stored as its key (read in each viewer's language);
  // « Autre motif » stays as typed
  const text = reason === 'other' ? other.trim() : storedText(`sales.cancel.reason.${reason}`);
  const invalid = text.length < 2;
  const sub = useDialogSubmit(() => gdsApi.cancelSale(saleId!, { reason: text, restoreStock: restock, refund: refund && (s?.amountPaid ?? 0) > 0 }));
  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    const r = await sub.submit();
    if (!r) return;
    toast(t('sales.cancelled', { number: r.number }));
    await refresh();
    onClose();
  };
  const units = s ? s.items.reduce((n, i) => n + i.quantity, 0) : 0;
  return (
    <Dialog
      open={!!saleId}
      onOpenChange={(o) => !o && !sub.busy && onClose()}
      title={s ? t('sales.cancel.title', { number: s.number }) : t('sales.action.cancel')}
      description={s ? saleContext(t, s) : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={sub.busy} onSubmit={() => void submit()} label={t('sales.action.cancel')} danger closeLabel={t('action.keep')} disabled={!s} note={t('sales.cancel.note')} />}
    >
      <div className="flex flex-col gap-4" data-testid="cancel-sale-dialog">
        <Pill tone="danger" className="w-fit !rounded-[4px]">
          {t('common.destructive')}
        </Pill>
        {loadError ? <FormAlert>{loadError}</FormAlert> : null}
        <Field label={t('common.reasonRequired')} htmlFor="cs-reason" error={touched && invalid ? t('validation.required') : sub.fieldError('reason')}>
          <Select id="cs-reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            {CANCEL_SALE_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`sales.cancel.reason.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        {reason === 'other' ? <Input aria-label={t('sales.cancel.reason.other')} value={other} maxLength={500} onChange={(e) => setOther(e.target.value)} /> : null}
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          {t('sales.cancel.restock', { count: units })}
        </label>
        {s && s.amountPaid > 0 ? (
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={refund} onChange={(e) => setRefund(e.target.checked)} />
            {t('sales.cancel.refund', { amount: formatMoney(s.amountPaid) })}
          </label>
        ) : null}
        {sub.error ? (
          <FormAlert>
            {sub.error}
            <ClosedDayHint day={sub.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Lier à un client ---------- */
export function ClientPicker({ value, onPick, id = 'client-picker' }: { value: ClientListItem | null; onPick: (c: ClientListItem | null) => void; id?: string }) {
  const t = useT();
  const [q, setQ] = useState('');
  const search = useClientSearch(q);
  const rows = search.data ?? [];
  const open = !value && q.trim().length >= 2;
  // journeys J14-2 / J14-3: ↓ ↑ Enter in the search, Esc closes the list only; the focus follows search ⇄ picked card
  const pick = (c: ClientListItem | null) => {
    setQ('');
    onPick(c);
    focusSoon(c ? '[data-testid="picked-client"] button' : `#${id}`);
  };
  const list = useComboboxList({ count: rows.length, open, onSelect: (i) => pick(rows[i]!), onClose: () => setQ('') });
  if (value)
    return (
      <div className="flex items-center gap-2 rounded-card border border-line-edge px-3 py-2 text-[13px]" data-testid="picked-client">
        <span className="min-w-0 flex-1 truncate [text-align:match-parent]" dir="auto">
          {value.name}
          {/* the « · » outside the left-to-right number, so it keeps its spaces in Arabic (SALES-CASH-22) */}
          {value.phone ? (
            <span className="text-text-muted">
              {' · '}
              <Ltr>{formatPhoneDz(value.phone)}</Ltr>
            </span>
          ) : null}
        </span>
        <button type="button" className="ts-label-meta text-text-muted hover:text-text-primary" onClick={() => pick(null)}>
          {t('action.remove')}
        </button>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <PickerSearch id={id} value={q} onChange={setQ} placeholder={t('sales.client.search')} label={t('sales.client.search')} active={open} combobox={list.comboboxProps} onKeyDown={list.onKeyDown} />
      {open ? (
        <ul id={list.listId} role="listbox" tabIndex={-1} aria-label={t('sales.client.search')} className="max-h-56 divide-y divide-line-hairline overflow-y-auto rounded-card border border-line-edge bg-ink-surface" data-testid="client-results">
          {search.isPending ? <li role="option" aria-disabled="true" aria-selected={false} className="px-3 py-2 text-[13px] text-text-muted">{t('common.loading')}</li> : null}
          {!search.isPending && rows.length === 0 ? <li role="option" aria-disabled="true" aria-selected={false} className="px-3 py-2 text-[13px] text-text-muted">{t('sales.client.none')}</li> : null}
          {rows.map((c, i) => (
            <li key={c.id} role="none">
              <button type="button" {...list.optionProps(i)} className="flex w-full items-center gap-3 px-3 py-2 text-start text-[13px] hover:bg-ink-raised aria-selected:bg-ink-raised" onClick={() => pick(c)}>
                <span className="min-w-0 flex-1 truncate [text-align:match-parent]" dir="auto">{c.name}</span>
                {c.phone ? <Ltr className="ts-label-micro text-text-muted">{formatPhoneDz(c.phone)}</Ltr> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function LinkClientDialog({ saleId, number, onClose }: { saleId: string | null; number: string; onClose: () => void }) {
  const t = useT();
  const refresh = useGdsRefresh();
  const [client, setClient] = useState<ClientListItem | null>(null);
  useOnOpen(!!saleId, () => setClient(null));
  const sub = useDialogSubmit(() => gdsApi.linkSaleClient(saleId!, client!.id));
  const submit = async () => {
    if (!client) return;
    const r = await sub.submit();
    if (!r) return;
    toast(t('sales.linked', { number: r.number, name: client.name }));
    await refresh();
    onClose();
  };
  return (
    <Dialog
      open={!!saleId}
      onOpenChange={(o) => !o && !sub.busy && onClose()}
      title={t('sales.link.title', { number })}
      description={t('sales.link.description')}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={sub.busy} onSubmit={() => void submit()} label={t('sales.action.linkClient')} disabled={!client} />}
    >
      <div className="flex flex-col gap-4" data-testid="link-client-dialog">
        <ClientPicker id="link-client" value={client} onPick={setClient} />
        {sub.error ? (
          <FormAlert>
            {sub.error}
            <ClosedDayHint day={sub.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Modifier le paiement (completed sale: mode + note only, SALE_IMMUTABLE otherwise) ---------- */
export function EditSaleDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const t = useT();
  const refresh = useGdsRefresh();
  const { sale: s, error: loadError } = useSaleFor(saleId);
  const [method, setMethod] = useState<CashMethod>('cash');
  const [notes, setNotes] = useState('');
  const [filled, setFilled] = useState<string | null>(null);
  useOnOpen(!!saleId, () => setFilled(null));
  if (s && filled !== s.id) {
    setFilled(s.id);
    setMethod(s.paymentMethod);
    setNotes(s.notes ?? '');
  }
  const sub = useDialogSubmit(() => gdsApi.updateSale(saleId!, { paymentMethod: method, notes: notes.trim() || null }));
  const submit = async () => {
    const r = await sub.submit();
    if (!r) return;
    toast(t('sales.saved', { number: r.number }));
    await refresh();
    onClose();
  };
  return (
    <Dialog
      open={!!saleId}
      onOpenChange={(o) => !o && !sub.busy && onClose()}
      title={t('sales.edit.title')}
      description={s ? t('sales.edit.description', { number: s.number }) : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={sub.busy} onSubmit={() => void submit()} label={t('action.save')} disabled={!s} />}
    >
      <div className="flex flex-col gap-4" data-testid="edit-sale-dialog">
        {loadError ? <FormAlert>{loadError}</FormAlert> : null}
        <Field label={t('gds.method')} htmlFor="es-method">
          <Select id="es-method" value={method} disabled={!s} onChange={(e) => setMethod(e.target.value as CashMethod)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`sales.method.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.noteOptional')} htmlFor="es-notes">
          <Textarea id="es-notes" value={notes} maxLength={2000} disabled={!s} onChange={(e) => setNotes(e.target.value)} className="min-h-14" />
        </Field>
        <p className="ts-label-micro !normal-case text-text-muted">{t('sales.edit.immutable')}</p>
        {sub.error ? (
          <FormAlert>
            {sub.error}
            <ClosedDayHint day={sub.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}
