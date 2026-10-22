'use client';
// ADM-11 data layer (02-next-route-map `/admin/reports`, api-contract §3.13 ReportAdminDto + §4 AdminReportsQuery,
// contract-b): abuse reports (list, detail, decide, assign), KPIs, platform blacklist, platform blocked words, the
// automatic rules and the monthly compliance export (202 job read at `GET /admin/safety/export/:jobId`).
import type {
  AdminBlockedWordsInput,
  AdminJobDto,
  AssignInput,
  BlacklistCreateInput,
  BlacklistRowDto,
  MerchantBlockRowDto,
  PlatformBlockedWordDto,
  ReportAdminDto,
  ReportDecideInput,
  ReportStatsDto,
  SafetyAutoRuleDto,
} from '@djaber/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adminKey, adminList, adminWrite, useAdminInvalidate } from '@/features/admin/api';
import { api } from '@/lib/api';
import type { ApiQuery } from '@/lib/list-state';
import { useWsEvent } from '@/lib/ws';

export const REPORTS_PATH = '/admin/reports';

export const safetyApi = {
  reports: (q: ApiQuery) => adminList<ReportAdminDto, { stats?: ReportStatsDto }>(REPORTS_PATH, q),
  report: (id: string) => api<ReportAdminDto>(`${REPORTS_PATH}/${id}`),
  stats: () => api<ReportStatsDto>(`${REPORTS_PATH}/stats`),
  /** the blocks behind the « clients bloqués par les marchands · 7 j » tile (UX-014) */
  merchantBlocks: () => api<MerchantBlockRowDto[]>(`${REPORTS_PATH}/blocks`),
  decide: (id: string, body: ReportDecideInput) => adminWrite<ReportAdminDto>(`${REPORTS_PATH}/${id}/decide`, 'POST', body),
  assign: (id: string, body: AssignInput) => adminWrite<ReportAdminDto>(`${REPORTS_PATH}/${id}/assign`, 'POST', body),
  blacklist: (q: ApiQuery) => adminList<BlacklistRowDto>('/admin/blacklist', q),
  addBlacklist: (body: BlacklistCreateInput) => adminWrite<BlacklistRowDto>('/admin/blacklist', 'POST', body, true),
  revokeBlacklist: (id: string, reason: string) => adminWrite<null>(`/admin/blacklist/${id}`, 'DELETE', { reason }),
  words: async () => (await api<{ words: PlatformBlockedWordDto[] }>('/admin/blocked-words')).words ?? [],
  saveWords: (body: AdminBlockedWordsInput) => adminWrite<{ words: PlatformBlockedWordDto[] }>('/admin/blocked-words', 'PUT', body),
  autoRules: () => api<SafetyAutoRuleDto[]>('/admin/safety/auto-rules'),
  exportMonth: (month: string) => api<{ jobId: string }>('/admin/safety/export', { query: { month } }),
  /** the export job is read through its own route (contract-b), not `GET /admin/jobs/:id` */
  exportJob: (jobId: string) => api<AdminJobDto>(`/admin/safety/export/${jobId}`),
};

export const useReports = (q: ApiQuery) => useQuery({ queryKey: adminKey(REPORTS_PATH, q), queryFn: () => safetyApi.reports(q), placeholderData: keepPreviousData });
export const useReport = (id: string | null) =>
  useQuery({ queryKey: adminKey(`${REPORTS_PATH}/${id}`), queryFn: () => safetyApi.report(id!), enabled: !!id, retry: (n, e) => n < 2 && (e as { status?: number }).status !== 404 });
export const useReportStats = () => useQuery({ queryKey: adminKey(`${REPORTS_PATH}/stats`), queryFn: safetyApi.stats, staleTime: 15_000, refetchOnWindowFocus: true });
export const useMerchantBlocks = (enabled: boolean) => useQuery({ queryKey: adminKey(`${REPORTS_PATH}/blocks`), queryFn: safetyApi.merchantBlocks, enabled });
export const useBlacklist = (q: ApiQuery, enabled: boolean) => useQuery({ queryKey: adminKey('/admin/blacklist', q), queryFn: () => safetyApi.blacklist(q), enabled, placeholderData: keepPreviousData });
export const useBlockedWords = (enabled: boolean) => useQuery({ queryKey: adminKey('/admin/blocked-words'), queryFn: safetyApi.words, enabled });
export const useAutoRules = (enabled: boolean) => useQuery({ queryKey: adminKey('/admin/safety/auto-rules'), queryFn: safetyApi.autoRules, enabled });

export function useSafetyRefresh() {
  const invalidate = useAdminInvalidate();
  return () => invalidate(REPORTS_PATH, '/admin/blacklist', '/admin/blocked-words', '/admin/safety');
}

/** Admin room events: `reports.queue` (counts) and `report.updated { id, status }`. */
export function useSafetyEvents() {
  const refresh = useSafetyRefresh();
  useWsEvent('reports.queue', () => void refresh());
  useWsEvent('report.updated', () => void refresh());
}
