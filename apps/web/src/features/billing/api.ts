// Billing calls (contract-ready M9 / api-contract §3.10, 02-next-route-map `/settings/billing`, `/settings/billing/return`,
// `/settings/credits`) + TanStack Query hooks and cache keys. Checkout calls carry an Idempotency-Key (contract §1.7)
// kept by the caller per submit attempt.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiBlob, apiRaw } from '@/lib/api';
import type { ApiQuery } from '@/lib/list-state';
import { useSession, useWorkspaceId } from '@/lib/session';
import type {
  BillingInfo,
  BillingInfoBody,
  Calculator,
  CheckoutBody,
  CheckoutPreview,
  CheckoutResult,
  CheckoutReturn,
  CreditPack,
  Invoice,
  InvoicePage,
  PackCheckoutResult,
  PayInvoiceResult,
  Plan,
  PromoRedeem,
  PromoValidation,
  Subscription,
} from './contracts';
import type { CalculatorInput } from './logic';

export const billingApi = {
  plans: () => api<Plan[]>('/plans'),
  subscription: () => api<Subscription>('/billing/subscription'),
  preview: (b: CheckoutBody) => api<CheckoutPreview>('/billing/preview', { method: 'POST', body: b }),
  checkout: (b: CheckoutBody, key: string) => api<CheckoutResult>('/billing/checkout', { method: 'POST', body: b, idempotent: key }),
  cancel: (b: { reason?: string }) => api<Subscription>('/billing/cancel', { method: 'POST', body: b }),
  /** "Annuler la résiliation": clears `cancelAtPeriodEnd` and a booked downgrade (`nextPlan`) */
  undoCancel: () => api<Subscription>('/billing/cancel', { method: 'DELETE' }),
  validatePromo: (b: { code: string; planId?: string }) => api<PromoValidation>('/billing/promo/validate', { method: 'POST', body: b }),
  redeemPromo: (b: { code: string }) => api<PromoRedeem>('/billing/promo/redeem', { method: 'POST', body: b }),
  invoices: async (q: ApiQuery): Promise<InvoicePage> => {
    const r = await apiRaw<Invoice[]>('/billing/invoices', { query: q });
    const rows = Array.isArray(r.data) ? r.data : [];
    return { rows, total: r.meta?.total ?? rows.length };
  },
  invoicePdf: (id: string) => apiBlob(`/billing/invoices/${id}/pdf`),
  payInvoice: (id: string, key: string) => api<PayInvoiceResult>(`/billing/invoices/${id}/pay`, { method: 'POST', body: {}, idempotent: key }),
  info: () => api<BillingInfo | null>('/billing/info'),
  saveInfo: (b: BillingInfoBody) => api<BillingInfo>('/billing/info', { method: 'PUT', body: b }),
  checkoutReturn: (ref: string) => api<CheckoutReturn>('/billing/checkout/return', { query: { ref } }),
  // credits side (packs, calculator, export)
  packs: () => api<CreditPack[]>('/credit-packs'),
  packCheckout: (packId: string, key: string) => api<PackCheckoutResult>('/credits/packs/checkout', { method: 'POST', body: { packId }, idempotent: key }),
  calculator: (i: CalculatorInput) => api<Calculator>('/credits/calculator', { query: i }),
  exportLedger: (q: ApiQuery) => api<{ jobId: string }>('/credits/ledger/export', { query: { format: 'csv', ...q } }),
};

export const billingKeys = {
  all: (ws: string) => [ws, 'billing'] as const,
  plans: (ws: string) => [ws, 'billing', 'plans'] as const,
  subscription: (ws: string) => [ws, 'billing', 'subscription'] as const,
  invoices: (ws: string, q?: ApiQuery) => (q ? ([ws, 'billing', 'invoices', q] as const) : ([ws, 'billing', 'invoices'] as const)),
  info: (ws: string) => [ws, 'billing', 'info'] as const,
  packs: (ws: string) => [ws, 'billing', 'packs'] as const,
  calculator: (ws: string, i: CalculatorInput) => [ws, 'billing', 'calculator', i] as const,
  checkoutReturn: (ws: string, ref: string) => [ws, 'billing', 'return', ref] as const,
};

export const usePlans = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: billingKeys.plans(ws), queryFn: billingApi.plans, enabled: !!ws && enabled, staleTime: 60_000 });
};
/** `GET /billing/subscription` (Owner + Admin); also feeds the plan banners of the shell for them. */
export const useSubscription = (enabled = true) => {
  const ws = useWorkspaceId();
  const { can, workspace } = useSession();
  return useQuery({ queryKey: billingKeys.subscription(ws), queryFn: billingApi.subscription, enabled: !!ws && enabled && can('billing.read') && workspace?.status !== 'suspended', staleTime: 15_000, retry: false });
};
export const useInvoices = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: billingKeys.invoices(ws, q), queryFn: () => billingApi.invoices(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useBillingInfo = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: billingKeys.info(ws), queryFn: billingApi.info, enabled: !!ws && enabled });
};
export const usePacks = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: billingKeys.packs(ws), queryFn: billingApi.packs, enabled: !!ws && enabled, staleTime: 60_000 });
};
export const useCalculator = (i: CalculatorInput, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: billingKeys.calculator(ws, i), queryFn: () => billingApi.calculator(i), enabled: !!ws && enabled, placeholderData: keepPreviousData, staleTime: 60_000 });
};

/** After a billing change: subscription, invoices, the workspace plan (limits, banners) and the credits are refetched. */
export function useBillingRefresh() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: billingKeys.all(ws) }),
      qc.invalidateQueries({ queryKey: [ws, 'workspace'] }),
      qc.invalidateQueries({ queryKey: [ws, 'credits'] }),
    ]);
  }, [qc, ws]);
}

/** Leaves for the gateway page (Chargily checkout, or the fake gateway page in development). */
export const goToCheckout = (url: string) => {
  window.location.assign(url);
};

/** Saves a PDF answered by the API under its own name (« F-2026-00008.pdf »), without leaving the page. */
export async function savePdf(load: () => Promise<Blob>, fileName: string) {
  const b = await load();
  const url = URL.createObjectURL(b.type ? b : new Blob([b], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Opens a PDF answered by the API in a new tab (blob URL, revoked after a minute). */
export async function openPdf(load: () => Promise<Blob>, fileName: string) {
  // the tab is opened synchronously (popup blockers), then pointed at the file once it arrived
  const tab = window.open('', '_blank');
  try {
    const b = await load();
    const url = URL.createObjectURL(b.type ? b : new Blob([b], { type: 'application/pdf' }));
    if (tab) tab.location.href = url;
    else {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
