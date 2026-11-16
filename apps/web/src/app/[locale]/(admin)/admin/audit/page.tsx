'use client';
// /admin/audit — Figma "ADM-09 — Platform admin — audit log + diff" + DLG "Exporter le journal d'audit". Filters
// (acteur, action, type de cible, espace, période, impersonation) in the URL, rows actor (role) · action pill · target ·
// reason · context, detail with the before / after diff (`?sheet=<id>`), linked impersonation entries, signed export job.
import type { AuditLogDto, PlatformTeamDto } from '@djaber/shared';
import { Card, CodeDiff, diffLines, FrameNote, ListSkeleton, MonoChip, type Column } from '@djaber/ui';
import { Button } from '@djaber/ui';
import { useMemo, useState } from 'react';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { adminWrite, useAdminGet, useAdminJobToast, useAdminList } from '@/features/admin/api';
import { AdminDialog, useOnOpen } from '@/features/admin/dialog-kit';
import { AdminFilterBar, AdminListBody, type AdminFilter } from '@/features/admin/list-kit';
import { WorkspacePicker } from '@/features/admin/pickers';
import { usePlatform } from '@/features/admin/platform';
import { AUDIT_LIST } from '@/features/admin/specs';
import { fullName, useFormats } from '@/features/admin/ui';
import { useT } from '@/lib/i18n';
import { filterText } from '@/lib/list-state';
import { useListState } from '@/lib/use-list-state';

/** offered while `GET /admin/audit-logs/actions` (every slug present in the log — full-test 15/11 ADMIN-14) loads */
const ACTIONS = ['workspace.suspend', 'workspace.reactivate', 'credits.grant', 'plan.change', 'plan.update', 'impersonation.start', 'impersonation.stop', 'user.block', 'preset.publish', 'pricing.version', 'invoice.mark_paid', 'member.role_change', 'viewer.open', 'viewer.unmask', 'audit.export'];
const ENTITIES = ['workspace', 'user', 'plan', 'subscription', 'invoice', 'channel', 'agent_preset', 'cms_entry', 'credit_pricing', 'promo_code', 'conversation', 'product'];
const PERIOD_DAYS: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
/** Colour family of an action slug (REF — Component sheet): destructive red, money green, changes amber, the rest blue. */
const tone = (a: string): 'danger' | 'success' | 'warning' | 'info' => (/suspend|block|delete|impersonation|unmask|release/.test(a) ? 'danger' : /credits|mark_paid|grant|payment/.test(a) ? 'success' : /update|change|publish|version|plan/.test(a) ? 'warning' : 'info');
const day = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);

export default function AdminAuditPage() {
  const t = useT();
  const f = useFormats();
  const { can } = usePlatform();
  const list = useListState(AUDIT_LIST);
  const s = list.state;
  const hasRange = !!(filterText(s, 'from') || filterText(s, 'to') || filterText(s, 'period'));
  const apiQuery = { ...list.apiQuery(), ...(hasRange ? {} : { period: '7d' }) };
  const query = useAdminList<AuditLogDto>('/admin/audit-logs', apiQuery);
  const team = useAdminGet<PlatformTeamDto>('/admin/platform-members');
  const logged = useAdminGet<string[]>('/admin/audit-logs/actions');
  const actionOptions = useMemo(() => [...(logged.data ?? ACTIONS)].sort(), [logged.data]);
  const detail = useAdminGet<AuditLogDto>(s.sheet ? `/admin/audit-logs/${s.sheet}` : null);
  const [exporting, setExporting] = useState(false);
  const [wsName, setWsName] = useState<string | undefined>(undefined);
  const period = filterText(s, 'period') || (hasRange ? '' : '7d');
  const wsId = filterText(s, 'workspaceId');
  const quick: AdminFilter[] = useMemo(
    () => [
      { kind: 'single', key: 'actorId', label: t('admin.audit.filter.actor'), options: (team.data?.members ?? []).map((m) => ({ value: m.userId, label: fullName(m) })) },
      { kind: 'multi', key: 'action', label: t('admin.audit.filter.action'), options: actionOptions.map((a) => ({ value: a, label: a })) },
      { kind: 'multi', key: 'entity', label: t('admin.audit.filter.entity'), options: ENTITIES.map((e) => ({ value: e, label: t(`admin.audit.entity.${e}`) })) },
      {
        kind: 'custom',
        key: 'workspaceId',
        label: t('admin.audit.filter.workspace'),
        active: wsId ? 1 : 0,
        chip: wsName ?? wsId.slice(0, 8),
        clear: () => list.setFilter('workspaceId', null),
        render: () => <WorkspacePicker value={wsId || null} initialLabel={wsName} onChange={(id, w) => { setWsName(w?.name); list.setFilter('workspaceId', id); }} />,
      },
      { kind: 'single', key: 'period', label: t('admin.audit.filter.period', { period: period ? t(`admin.audit.period.${period}`) : '…' }), options: Object.keys(PERIOD_DAYS).map((p) => ({ value: p, label: t(`admin.audit.period.${p}`) })) },
      { kind: 'single', key: 'impersonation', label: t('admin.audit.filter.impersonation'), options: (['only', 'exclude'] as const).map((v) => ({ value: v, label: t(`admin.audit.impersonation.${v}`) })) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, team.data, wsId, wsName, period, actionOptions],
  );
  const context = (r: AuditLogDto) => [r.context.ip, r.context.userAgent ? (/mobile|android|iphone/i.test(r.context.userAgent) ? 'mobile' : 'web') : r.actor.type === 'system' ? 'auto' : null].filter(Boolean).join(' · ') || '—';
  const columns: Column<AuditLogDto>[] = [
    { key: 'at', header: t('admin.audit.col.at'), sortKey: 'at', hideable: false, cell: (r) => <span className="whitespace-nowrap">{f.shortTime(r.at)}</span> },
    { key: 'actor', header: t('admin.audit.col.actor'), cell: (r) => (r.actor.type === 'system' ? t('admin.audit.system') : `${r.actor.name}${r.actor.role ? ` (${t.has(`enum.PlatformRole.${r.actor.role}`) ? t(`enum.PlatformRole.${r.actor.role}`).toLowerCase() : r.actor.role})` : ''}`) },
    { key: 'action', header: t('admin.audit.col.action'), cell: (r) => <MonoChip tone={tone(r.action)}>{r.action.toUpperCase()}</MonoChip> },
    { key: 'target', header: t('admin.audit.col.target'), className: 'max-w-[260px]', cell: (r) => <span className="line-clamp-2" title={r.target.label}>{r.target.label}</span> },
    { key: 'reason', header: t('admin.audit.col.reason'), hideBelow: 'lg', className: 'max-w-[260px]', cell: (r) => <span className="line-clamp-2" title={r.reason ?? undefined}>{r.reason ?? '—'}</span> },
    { key: 'context', header: t('admin.audit.col.context'), hideBelow: 'xl', cell: (r) => <span dir="ltr">{context(r)}</span> },
  ];
  const d = detail.data;
  return (
    <AdminPage
      permission="admin.audit.read"
      title={t('nav.admin.audit')}
      description={t('admin.audit.description')}
      actions={
        can('admin.audit.export') ? (
          <Button onClick={() => setExporting(true)} data-testid="audit-export">
            {t('admin.audit.export.cta')}
          </Button>
        ) : null
      }
    >
      <AdminFilterBar list={list} search={t('admin.audit.search')} quick={quick} count={query.data ? t('admin.audit.count', { count: query.data.total, period: period ? t(`admin.audit.period.${period}`) : t('admin.audit.customPeriod') }) : undefined} />
      <AdminListBody testId="audit-list" filters={quick} query={query} list={list} columns={columns} rowKey={(r) => r.id} label={t('nav.admin.audit')} entity={t('admin.audit.entity')} empty={{ title: t('admin.audit.empty') }} onRowClick={(r) => list.openSheet(r.id)} rowActions={() => <span aria-hidden className="text-text-muted rtl:-scale-x-100">›</span>} />
      {s.sheet ? (
        <Card className="flex flex-col gap-3 p-5" data-testid="audit-detail">
          {detail.isPending ? (
            <ListSkeleton rows={4} columns={2} label={t('common.loading')} />
          ) : detail.isError || !d ? (
            <AdminQueryError error={detail.error} onRetry={() => void detail.refetch()} />
          ) : (
            <>
              <h2 className="text-[15px] font-medium">
                {t('admin.audit.detail.title', { action: d.action.toUpperCase(), target: d.target.label, date: f.shortTime(d.at), actor: d.actor.name, ip: d.context.ip ?? '—', session: d.context.twoFactor ? t('admin.audit.detail.session2fa') : t('admin.audit.detail.session') })}
              </h2>
              <CodeDiff beforeLabel={t('admin.audit.detail.before')} afterLabel={t('admin.audit.detail.after')} empty={t('admin.audit.detail.noDiff')} lines={diffLines(d.before, d.after)} />
              {d.context.impersonationSessionId ? (
                <Button size="sm" variant="ghost" className="w-fit" onClick={() => list.set({ filters: { impersonationSessionId: d.context.impersonationSessionId! }, sheet: null })} data-testid="audit-session-link">
                  {t('admin.audit.detail.sessionEntries')}
                </Button>
              ) : null}
              <FrameNote>{t('admin.audit.detail.note')}</FrameNote>
            </>
          )}
        </Card>
      ) : null}
      <ExportDialog open={exporting} onClose={() => setExporting(false)} filters={{ period, from: filterText(s, 'from'), to: filterText(s, 'to'), workspaceId: wsId, actorId: filterText(s, 'actorId'), impersonation: filterText(s, 'impersonation') }} total={query.data?.total ?? 0} />
    </AdminPage>
  );
}

function ExportDialog({ open, onClose, filters, total }: { open: boolean; onClose: () => void; filters: Record<string, string>; total: number }) {
  const t = useT();
  const f = useFormats();
  const track = useAdminJobToast();
  const [format, setFormat] = useState<'csv_signed' | 'json'>('csv_signed');
  useOnOpen(open, () => setFormat('csv_signed'));
  const now = new Date();
  const from = filters.from || day(new Date(now.getTime() - (PERIOD_DAYS[filters.period || '7d'] ?? 7) * 86_400_000));
  const to = filters.to || day(now);
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-audit-export"
      size="sm"
      title={t('admin.audit.export.title')}
      context={t('admin.audit.export.context', { period: filters.period ? t(`admin.audit.period.${filters.period}`) : `${from} → ${to}`, count: f.num(total) })}
      note={t('admin.audit.export.note')}
      submitLabel={t('admin.common.export')}
      onSubmit={() => {
        onClose();
        void track(() => adminWrite<{ jobId: string }>('/admin/audit-logs/export', 'POST', { format, from, to, ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}), ...(filters.actorId ? { actorId: filters.actorId } : {}), ...(filters.impersonation ? { impersonation: filters.impersonation } : {}) }, true), { running: t('admin.audit.export.running'), done: t('admin.audit.export.done') });
      }}
    >
      <div role="radiogroup" aria-label={t('admin.audit.export.title')} className="flex flex-col gap-2.5">
        {(['csv_signed', 'json'] as const).map((x) => (
          <label key={x} className="flex cursor-pointer items-center gap-2.5 text-[14px]">
            <input type="radio" name="auditFormat" checked={format === x} onChange={() => setFormat(x)} className="size-4 accent-white" />
            {t(`admin.audit.export.format.${x}`)}
          </label>
        ))}
      </div>
    </AdminDialog>
  );
}
