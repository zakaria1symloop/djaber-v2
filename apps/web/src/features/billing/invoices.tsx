'use client';
// Invoices card — Figma "BIL-04 / BIL-03 — … Invoices" (N° · DATE · LIBELLÉ · MONTANT · STATUT, "PAYÉE · CIB", PDF ↓,
// À VENIR, IMPAYÉE + "Payer maintenant") and "BIL-01 FACTURES". `GET /billing/invoices?status&page` (status filter and
// page in the URL), `GET /billing/invoices/:id/pdf`, `POST /billing/invoices/:id/pay → { checkoutUrl }` (`billing.write`),
// "Infos de facturation" (`GET|PUT /billing/info`, `billing.plan`).
import { BillingInfoSchema, formatDate, formatMoney, type AppLocale } from '@djaber/shared';
import { ActionsMenu, ActiveFilters, Button, Card, cn, CodeInput, Dialog, EmptyState, Field, FilterChips, FilterDropdown, FormAlert, Input, Ltr, StatusPill, Table, Td, Textarea, Th, toast, Tr, type ActiveFilter, type MenuAction } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ListFilteredEmpty, ListLoading, QueryError } from '@/components/global-states';
import { ListPagination } from '@/features/catalog/ui';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterList, type ApiQuery, type ListSpec } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { uuid } from '@/lib/uuid';
import { billingApi, goToCheckout, openPdf, useBillingInfo, useBillingRefresh, useInvoices } from './api';
import type { Invoice } from './contracts';
import { canPayInvoice, INVOICE_STATUSES, methodGroup } from './logic';

/** `GET /billing/invoices` parameters in the URL (`?status=unpaid,paid&page=2`). */
export const INVOICES_SPEC: ListSpec = { filters: { status: 'list' }, sorts: ['date'], defaultSort: '-date' };

/** "Payer maintenant": `POST /billing/invoices/:id/pay` (Idempotency-Key per attempt) → Chargily checkout. */
export function usePayInvoice() {
  const t = useT();
  const pay = useMutation({ mutationFn: ({ id, key }: { id: string; key: string }) => billingApi.payInvoice(id, key) });
  const run = async (id: string) => {
    try {
      const r = await pay.mutateAsync({ id, key: uuid() });
      toast({ tone: 'info', message: t('billing.change.redirecting') });
      goToCheckout(r.checkoutUrl);
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  return { run, pending: pay.isPending ? pay.variables?.id ?? null : null };
}

export function InvoicesCard({ owner }: { owner: boolean }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { can } = useSession();
  const list = useListState(INVOICES_SPEC);
  const s = list.state;
  const statuses = filterList(s, 'status');
  const query = useMemo<ApiQuery>(() => {
    const q: ApiQuery = { page: s.page, pageSize: s.pageSize };
    if (statuses.length) q.status = statuses;
    return q;
  }, [s.page, s.pageSize, statuses]);
  const q = useInvoices(query);
  const rows = q.data?.rows ?? [];
  const pay = usePayInvoice();
  const [info, setInfo] = useState(false);
  const canPay = can('billing.write');

  const statusOptions = INVOICE_STATUSES.map((v) => ({ value: v, label: t(`enum.Invoice.status.${v}`) }));
  const chips: ActiveFilter[] = statuses.length
    ? [{ key: 'status', label: `${t('billing.invoices.filter.status')} : ${statuses.map((v) => statusOptions.find((o) => o.value === v)?.label ?? v).join(', ')}`, onRemove: () => list.setFilter('status', null) }]
    : [];

  const pdf = async (i: Invoice) => {
    try {
      // `pdfUrl` is the authenticated API route itself: the file is fetched with the bearer and opened as a blob
      await openPdf(() => billingApi.invoicePdf(i.id), `${i.number}.pdf`);
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const menu = (i: Invoice): MenuAction[] => {
    const out: MenuAction[] = [];
    if (i.status === 'unpaid') out.push({ key: 'pay', label: t('billing.invoices.payNow'), primary: true, onSelect: () => void pay.run(i.id), disabledReason: !canPay ? t('billing.writeOnly') : !canPayInvoice(i) ? t('error.CONFLICT') : undefined });
    if (i.status !== 'upcoming') out.push({ key: 'pdf', label: t('billing.invoices.pdf'), onSelect: () => void pdf(i), hint: 'PDF' });
    return out;
  };

  return (
    <Card id="billing-invoices" className="flex scroll-mt-20 flex-col gap-3 p-5" data-testid="invoices-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="ts-title">{t('billing.invoices.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown label={t('billing.invoices.filter.status')} count={statuses.length || undefined}>
            <FilterChips multiple label={t('billing.invoices.filter.status')} options={statusOptions} value={statuses} onChange={(next) => list.setFilter('status', next.length ? next : null)} />
          </FilterDropdown>
          <Button variant="ghost" size="sm" onClick={() => setInfo(true)} data-testid="open-billing-info">
            {t('billing.info.action')}
          </Button>
        </div>
      </div>
      <ActiveFilters items={chips} label={t('action.filters')} clearLabel={t('action.clearAll')} onClear={list.clear} removeLabel={(label) => `${t('action.remove')} ${label}`} />
      {q.isPending ? (
        <ListLoading rows={4} columns={5} />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        list.filtered ? (
          <ListFilteredEmpty entity={t('billing.invoices.entity')} filters={chips.map((c) => c.label).join(' · ')} onClear={list.clear} />
        ) : (
          <EmptyState icon={<FileText className="size-5" />} title={t('billing.invoices.empty.title')} description={t('billing.invoices.empty.description')} />
        )
      ) : (
        <div className={cn('overflow-x-auto rounded-card border border-line-edge', q.isPlaceholderData && 'opacity-70')}>
          <Table aria-label={t('billing.invoices.title')}>
            <thead>
              <tr>
                <Th>{t('billing.invoices.col.number')}</Th>
                <Th>{t('billing.invoices.col.date')}</Th>
                <Th>{t('billing.invoices.col.label')}</Th>
                <Th className="text-end">{t('billing.invoices.col.amount')}</Th>
                <Th>{t('billing.invoices.col.status')}</Th>
                <Th className="w-0">
                  <span className="sr-only">{t('action.actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const m = methodGroup(i.method);
                return (
                  <Tr key={i.id} data-testid="invoice-row" data-status={i.status} data-number={i.number}>
                    <Td className="whitespace-nowrap">
                      <Ltr>{i.status === 'upcoming' && !i.number ? '—' : i.number}</Ltr>
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(i.date, locale)}</Td>
                    <Td className="max-w-[24rem]">
                      <span dir="auto" className="break-words">
                        {i.label}
                      </span>
                      {i.status === 'unpaid' && i.dueAt ? <span className="block ts-label-meta text-accent-alert">{t('billing.invoices.due', { date: formatDate(i.dueAt, locale) })}</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap text-end tabular-nums">
                      <Ltr>{formatMoney(i.amount)}</Ltr>
                      {(i.status === 'unpaid' || i.status === 'upcoming') && i.remaining > 0 && i.remaining < i.amount ? <span className="block ts-label-meta text-text-muted">{t('billing.invoices.remaining', { amount: formatMoney(i.remaining) })}</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <StatusPill enumKey="Invoice.status" value={i.status} className="!rounded-[4px]">
                        {t(`enum.Invoice.status.${i.status}`)}
                        {i.status === 'paid' && m ? ` · ${t(`billing.invoices.method.${m}`)}` : ''}
                      </StatusPill>
                    </Td>
                    <Td className="whitespace-nowrap text-end">
                      <span className="inline-flex items-center gap-2">
                        {i.status === 'unpaid' ? (
                          <Button size="sm" variant="primary" onClick={() => void pay.run(i.id)} loading={pay.pending === i.id} disabled={!canPayInvoice(i)} disabledReason={canPay ? undefined : t('billing.writeOnly')} data-testid="invoice-pay">
                            {t('billing.invoices.payNow')}
                          </Button>
                        ) : null}
                        {menu(i).length ? <ActionsMenu label={t('action.actions')} actions={menu(i)} /> : null}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <ListPagination page={s.page} pageSize={s.pageSize} total={q.data?.total ?? rows.length} onChange={(p) => list.set(p)} />
        </div>
      )}
      <p className="ts-label-meta text-text-muted">{t('billing.invoices.note')}</p>
      <BillingInfoDialog open={info} owner={owner} onClose={() => setInfo(false)} />
    </Card>
  );
}

/* ---------- Infos de facturation (printed on the PDF) ---------- */
type InfoForm = { companyName: string; nif: string; address: string };
function BillingInfoDialog({ open, owner, onClose }: { open: boolean; owner: boolean; onClose: () => void }) {
  const t = useT();
  const q = useBillingInfo(open);
  const refresh = useBillingRefresh();
  const [form, setForm] = useState<InfoForm>({ companyName: '', nif: '', address: '' });
  const [fields, setFields] = useState<Partial<Record<keyof InfoForm, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: billingApi.saveInfo });
  // seeded once per opening, when the saved values are there: a background refetch never wipes what is being typed
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current || q.isPending) return;
    seeded.current = true;
    setFields({});
    setError(null);
    const d = q.data;
    setForm({ companyName: d?.companyName ?? '', nif: d?.nif ?? '', address: d?.address ?? '' });
  }, [open, q.data, q.isPending]);

  const submit = async () => {
    setError(null);
    const parsed = BillingInfoSchema.safeParse({ companyName: form.companyName, nif: form.nif, address: form.address });
    if (!parsed.success) {
      const f: Partial<Record<keyof InfoForm, string>> = {};
      for (const i of parsed.error.issues) f[i.path[0] as keyof InfoForm] = t(i.message);
      return setFields(f);
    }
    try {
      await save.mutateAsync(parsed.data);
      await refresh();
      toast({ tone: 'success', message: t('billing.info.saved') });
      onClose();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  const set = (k: keyof InfoForm) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFields((f) => ({ ...f, [k]: undefined }));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={t('billing.info.title')}
      description={t('billing.info.description')}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={save.isPending} disabled={q.isPending} disabledReason={owner ? undefined : t('billing.ownerOnly')} data-testid="billing-info-save">
            {t('action.save')}
          </Button>
        </>
      }
    >
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="flex flex-col gap-3" data-testid="billing-info-dialog">
          <Field label={t('billing.info.companyName')} htmlFor="bi-company" error={fields.companyName}>
            <Input id="bi-company" value={form.companyName} onChange={(e) => set('companyName')(e.target.value)} maxLength={160} disabled={!owner || q.isPending} dir="auto" />
          </Field>
          <Field label={t('billing.info.nif')} htmlFor="bi-nif" error={fields.nif}>
            <CodeInput id="bi-nif" value={form.nif} onChange={(e) => set('nif')(e.target.value)} maxLength={40} disabled={!owner || q.isPending} inputMode="numeric" pattern="[0-9 ]*" />
          </Field>
          <Field label={t('billing.info.address')} htmlFor="bi-address" error={fields.address}>
            <Textarea id="bi-address" rows={3} value={form.address} onChange={(e) => set('address')(e.target.value)} maxLength={300} disabled={!owner || q.isPending} dir="auto" />
          </Field>
          {error ? <FormAlert>{error}</FormAlert> : null}
        </div>
      )}
    </Dialog>
  );
}
