'use client';
// ADM-02 detail sheet (`?sheet=<id>`, tab in `?stab=`): Résumé · Membres · Abonnement · Crédits · Canaux · Agents · Audit.
// Résumé = 3 KPI tiles, labelled rows (owner, subscription, credits, channels, agents, integrations, stock mode, last
// activity) and the 4 main actions; Canaux carries "Libérer la page" (CHN-05, AT-CHN-08).
import type { AdminCreditRowDto, AdminWorkspaceAgentDto, AdminWorkspaceChannelDto, AdminWorkspaceDetailDto, AdminWorkspaceMemberDto, AuditLogDto } from '@djaber/shared';
import { ActionsMenu, Button, Card, ListSkeleton, OpsKpiTile, PillTabs, SideSheet } from '@djaber/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { useT } from '@/lib/i18n';
import { AdminQueryError } from '../admin-page';
import { useAdminGet, useAdminList } from '../api';
import { usePlatform } from '../platform';
import { AdminPill, fullName, useFormats } from '../ui';
import { ReleaseDialog } from './dialogs';
import type { WsDialog } from './actions';
import type { MenuAction } from '@djaber/ui';
import { WorkspaceStatusPill } from './status';

const TABS = ['summary', 'members', 'subscription', 'credits', 'channels', 'agents', 'audit'] as const;
type Tab = (typeof TABS)[number];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 text-[13px]">
      <dt className="pt-0.5 ts-label-micro uppercase text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function WorkspaceSheet({
  id,
  onClose,
  nav,
  menu,
  onAction,
}: {
  id: string | null;
  onClose: () => void;
  nav?: { onPrev?: () => void; onNext?: () => void; position?: string };
  menu: (ws: AdminWorkspaceDetailDto) => MenuAction[];
  onAction: (kind: WsDialog, ws: AdminWorkspaceDetailDto) => void;
}) {
  const t = useT();
  const f = useFormats();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('stab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'summary';
  const setTab = (k: string) => {
    const p = new URLSearchParams(params.toString());
    if (k === 'summary') p.delete('stab');
    else p.set('stab', k);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const q = useAdminGet<AdminWorkspaceDetailDto>(id ? `/admin/workspaces/${id}` : null);
  const ws = q.data;
  const title = ws?.name ?? (q.isError ? t('state.detail.notFound.title') : t('common.loading'));
  const subtitle = ws ? [`${ws.id.slice(0, 8)}…`, ws.plan.name, t(`enum.Subscription.status.${ws.subscriptionStatus}`), t('admin.ws.sheet.created', { date: f.date(ws.createdAt) })].join(' · ') : undefined;
  return (
    <SideSheet
      open={!!id}
      onClose={onClose}
      title={title}
      subtitle={subtitle ? <span className="uppercase">{subtitle}</span> : undefined}
      width={460}
      closeLabel={t('action.close')}
      nav={nav ? { ...nav, prevLabel: t('admin.common.prev'), nextLabel: t('admin.common.next') } : undefined}
      headerAction={ws ? <ActionsMenu label={t('action.actions')} actions={menu(ws)} heading={ws.name} /> : undefined}
    >
      {q.isPending ? (
        <ListSkeleton rows={6} columns={2} label={t('common.loading')} />
      ) : q.isError || !ws ? (
        <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-4" data-testid="ws-sheet">
          <PillTabs
            label={t('admin.ws.sheet.tabs')}
            value={tab}
            onChange={setTab}
            tabs={TABS.map((k) => ({ key: k, label: t(`admin.ws.tab.${k}`), count: k === 'members' ? ws.counts.members : k === 'channels' ? ws.channels.length : null }))}
          />
          {tab === 'summary' ? <Summary ws={ws} onAction={onAction} /> : null}
          {tab === 'members' ? <Members id={ws.id} /> : null}
          {tab === 'subscription' ? <Subscription ws={ws} /> : null}
          {tab === 'credits' ? <Credits id={ws.id} /> : null}
          {tab === 'channels' ? <Channels ws={ws} /> : null}
          {tab === 'agents' ? <Agents id={ws.id} /> : null}
          {tab === 'audit' ? <Audit id={ws.id} /> : null}
        </div>
      )}
    </SideSheet>
  );
}

function Summary({ ws, onAction }: { ws: AdminWorkspaceDetailDto; onAction: (kind: WsDialog, ws: AdminWorkspaceDetailDto) => void }) {
  const t = useT();
  const f = useFormats();
  const { can } = usePlatform();
  const has = (k: string) => ws.actions.find((a) => a.key === k);
  const btn = (k: WsDialog, label: string, o: { primary?: boolean; danger?: boolean; perm: boolean }) => {
    const d = has(k);
    if (!d || !o.perm) return null;
    return (
      <Button variant={o.primary ? 'primary' : o.danger ? 'danger' : 'secondary'} disabled={!d.enabled} title={d.enabled ? undefined : t(`error.${d.reasonCode ?? 'FORBIDDEN'}`)} onClick={() => onAction(k, ws)} data-testid={`ws-btn-${k}`}>
        {label}
      </Button>
    );
  };
  const owner = ws.owner;
  const sub = ws.subscription;
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <OpsKpiTile value={f.num(ws.kpis30d.orders)} unit={t('admin.ws.kpi.orders')} />
        <OpsKpiTile value={f.num(ws.kpis30d.conversations)} unit={t('admin.ws.kpi.conversations')} />
        <OpsKpiTile value={`${ws.kpis30d.creditsUsedPct} %`} unit={t('admin.ws.kpi.credits')} />
      </div>
      <dl className="flex flex-col gap-3">
        <Row label={t('admin.ws.row.owner')}>
          {[fullName(owner), owner.email, owner.emailVerified ? t('admin.ws.verified') : t('enum.Admin.unverified'), owner.totpEnabled ? '2FA' : null].filter(Boolean).join(' · ')}
        </Row>
        <Row label={t('admin.ws.row.subscription')}>
          {/* tester report 22/10 UX-018: a trial / the free plan has no billing cycle (billingCycle=none): no « mensuel · 0 DA » */}
          {sub ? [sub.cycle === 'none' ? sub.planName : `${sub.planName} ${t(`admin.common.cycleOpt.${sub.cycle}`).toLowerCase()}`, sub.cycle === 'none' && !sub.appliedPrice ? null : f.money(sub.appliedPrice), sub.trialEndsAt ? t('admin.ws.trialEnds', { date: f.short(sub.trialEndsAt) }) : t('admin.ws.renews', { date: f.short(sub.currentPeriodEnd) }), sub.dunningStage ? t(`enum.Subscription.dunningStage.${sub.dunningStage}`) : null, sub.method].filter(Boolean).join(' · ') : '—'}
        </Row>
        <Row label={t('admin.ws.row.credits')}>
          {[`${f.num(ws.credits.used)} / ${f.num(ws.credits.limit)}`, t('admin.ws.packsBought', { count: ws.creditsDetail.packsBought }), ws.creditsDetail.lastGrant ? t('admin.ws.lastGrant', { credits: f.num(ws.creditsDetail.lastGrant.credits), reason: ws.creditsDetail.lastGrant.reason ?? '—', date: f.short(ws.creditsDetail.lastGrant.at) }) : null].filter(Boolean).join(' · ')}
        </Row>
        <Row label={t('admin.ws.row.channels')}>{ws.channels.length ? ws.channels.map((c) => `${c.name} (${t(`enum.Channel.platform.${c.platform}`)}, ${t(`enum.Channel.status.${c.status}`)})`).join(' · ') : '—'}</Row>
        <Row label={t('admin.ws.row.agents')}>{ws.agents.length ? ws.agents.map((a) => `${a.name} (${t(`enum.Agent.status.${a.status}`)})`).join(' · ') : '—'}</Row>
        <Row label={t('admin.ws.row.integrations')}>
          {[`Sheets ${ws.integrations.sheets ? '✓' : '✗'}`, ...ws.integrations.couriers.map((c) => `${c.provider} ${c.ok ? '✓' : '✗'}`), t('admin.ws.apiKeys', { count: ws.integrations.apiKeys }), t('admin.ws.webhooks', { count: ws.integrations.webhooks, disabled: ws.integrations.webhooksDisabled })].join(' · ')}
        </Row>
        <Row label={t('admin.ws.row.stock')}>
          {[t(`admin.ws.stockMode.${ws.stockMode}`), t('admin.ws.products', { count: ws.counts.products }), ws.stockMode === 'advanced' ? t('admin.ws.purchases', { count: ws.counts.purchases }) : null, ws.stockMode === 'advanced' ? t('admin.ws.sales', { count: ws.counts.sales }) : null].filter(Boolean).join(' · ')}
        </Row>
        <Row label={t('admin.ws.row.activity')}>
          {[ws.lastActivity.web ? t('admin.ws.activityWeb', { ago: f.ago(ws.lastActivity.web) }) : null, ws.lastActivity.mobile ? t('admin.ws.activityMobile', { ago: f.ago(ws.lastActivity.mobile) }) : null].filter(Boolean).join(' · ') || '—'}
        </Row>
        {ws.status === 'suspended' ? <Row label={t('admin.ws.row.suspended')}>{[ws.suspendReason ? t(`admin.ws.suspend.reason.${ws.suspendReason}`) : null, ws.suspendNote, f.date(ws.suspendedAt)].filter(Boolean).join(' · ')}</Row> : null}
        {ws.deletionScheduledAt ? <Row label={t('admin.ws.row.deletion')}>{f.date(ws.deletionScheduledAt)}</Row> : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        {btn('impersonate', t('admin.ws.btn.impersonate'), { primary: true, perm: can('admin.workspaces.impersonate') })}
        {btn('add_credits', t('admin.ws.action.add_credits'), { perm: can('admin.workspaces.credits') })}
        {btn('change_plan', t('admin.ws.action.change_plan'), { perm: can('admin.workspaces.write') })}
        {btn('suspend', t('admin.ws.action.suspend'), { danger: true, perm: can('admin.workspaces.write') })}
        {btn('reactivate', t('admin.ws.action.reactivate'), { perm: can('admin.workspaces.write') })}
      </div>
      <Link href={`/admin/viewers/products?workspaceId=${ws.id}`} className="w-fit ts-label-meta text-accent-inbound hover:underline" data-testid="ws-viewers">
        {t('admin.ws.viewers')}
      </Link>
      <div className="flex items-center gap-2">
        <WorkspaceStatusPill ws={ws} />
        <AdminPill group="Workspace.trustLevel" value={ws.trustLevel}>
          {t(`enum.Workspace.trustLevel.${ws.trustLevel}`)}
        </AdminPill>
      </div>
    </>
  );
}

function SubList<T>({ path, render, empty }: { path: string; render: (rows: T[]) => ReactNode; empty: string }) {
  const t = useT();
  const q = useAdminList<T>(path);
  if (q.isPending) return <ListSkeleton rows={4} columns={2} label={t('common.loading')} />;
  if (q.isError) return <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.rows.length) return <p className="py-6 text-center ts-label-meta text-text-muted">{empty}</p>;
  return <>{render(q.data.rows)}</>;
}

const listCls = 'flex flex-col divide-y divide-line-hairline rounded-card border border-line-hairline';
const itemCls = 'flex items-center gap-3 px-3 py-2.5 text-[13px]';

function Members({ id }: { id: string }) {
  const t = useT();
  const f = useFormats();
  return (
    <SubList<AdminWorkspaceMemberDto>
      path={`/admin/workspaces/${id}/members`}
      empty={t('admin.ws.empty.members')}
      render={(rows) => (
        <ul className={listCls}>
          {rows.map((m) => (
            <li key={m.userId} className={itemCls}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{fullName(m)}</span>
                <span className="block truncate ts-label-micro text-text-muted" dir="ltr">
                  {m.email}
                </span>
              </span>
              <span className="text-text-secondary">{t(`enum.Membership.role.${m.role}`)}</span>
              <span className="ts-label-micro text-text-muted">{m.totpEnabled ? '2FA' : '—'}</span>
              <span className="ts-label-micro text-text-muted">{f.ago(m.lastLoginAt)}</span>
            </li>
          ))}
        </ul>
      )}
    />
  );
}

function Subscription({ ws }: { ws: AdminWorkspaceDetailDto }) {
  const t = useT();
  const f = useFormats();
  const s = ws.subscription;
  if (!s) return <p className="py-6 text-center ts-label-meta text-text-muted">{t('admin.ws.empty.subscription')}</p>;
  return (
    <dl className="flex flex-col gap-3">
      <Row label={t('admin.common.plan')}>{s.planName}</Row>
      <Row label={t('admin.common.status')}>
        <AdminPill group="Subscription.status" value={ws.subscriptionStatus}>
          {s.dunningStage && ws.subscriptionStatus === 'dunning' ? t(`enum.Subscription.dunningStage.${s.dunningStage}`) : t(`enum.Subscription.status.${ws.subscriptionStatus}`)}
        </AdminPill>
      </Row>
      <Row label={t('admin.common.cycle')}>{s.cycle === 'none' ? '—' : t(`admin.common.cycleOpt.${s.cycle}`)}</Row>
      <Row label={t('admin.ws.row.price')}>{f.money(s.appliedPrice)}</Row>
      <Row label={t('admin.ws.row.periodEnd')}>{f.date(s.currentPeriodEnd)}</Row>
      {s.trialEndsAt ? <Row label={t('admin.ws.row.trialEnd')}>{f.date(s.trialEndsAt)}</Row> : null}
      <Row label={t('admin.ws.row.method')}>{s.method ?? '—'}</Row>
    </dl>
  );
}

function Credits({ id }: { id: string }) {
  const t = useT();
  const f = useFormats();
  return (
    <SubList<AdminCreditRowDto>
      path={`/admin/workspaces/${id}/credits`}
      empty={t('admin.ws.empty.credits')}
      render={(rows) => (
        <ul className={listCls}>
          {rows.map((r) => (
            <li key={r.id} className={itemCls}>
              <span className="ts-label-micro w-24 shrink-0 text-text-muted">{f.shortTime(r.at)}</span>
              <span className="min-w-0 flex-1 truncate">{t.has(`enum.CreditLedger.action.${r.action}`) ? t(`enum.CreditLedger.action.${r.action}`) : r.action}{r.reason ? ` · ${r.reason}` : ''}</span>
              <span dir="ltr" className={r.credits >= 0 ? 'tabular-nums text-accent-money' : 'tabular-nums'}>
                {r.credits >= 0 ? '+' : ''}
                {f.num(r.credits)}
              </span>
            </li>
          ))}
        </ul>
      )}
    />
  );
}

function Channels({ ws }: { ws: AdminWorkspaceDetailDto }) {
  const t = useT();
  const { can } = usePlatform();
  const [release, setRelease] = useState<AdminWorkspaceChannelDto | null>(null);
  return (
    <>
      <SubList<AdminWorkspaceChannelDto>
        path={`/admin/workspaces/${ws.id}/channels`}
        empty={t('admin.ws.empty.channels')}
        render={(rows) => (
          <ul className={listCls}>
            {rows.map((c) => (
              <li key={c.id} className={itemCls} data-channel={c.id}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.name}</span>
                  <span className="block truncate ts-label-micro text-text-muted" dir="ltr">
                    {t(`enum.Channel.platform.${c.platform}`)} · {c.externalId}
                  </span>
                </span>
                <span className="ts-label-micro text-text-secondary">{t(`enum.Channel.status.${c.status}`)}</span>
                {can('admin.workspaces.write') && c.status !== 'disconnected' ? (
                  <Button size="sm" variant="danger" onClick={() => setRelease(c)} data-testid={`release-${c.id}`}>
                    {t('admin.ws.release.submit')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      />
      <ReleaseDialog channel={release} workspaceName={ws.name} open={!!release} onClose={() => setRelease(null)} />
    </>
  );
}

function Agents({ id }: { id: string }) {
  const t = useT();
  const f = useFormats();
  return (
    <SubList<AdminWorkspaceAgentDto>
      path={`/admin/workspaces/${id}/agents`}
      empty={t('admin.ws.empty.agents')}
      render={(rows) => (
        <ul className={listCls}>
          {rows.map((a) => (
            <li key={a.id} className={itemCls}>
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="ts-label-micro text-text-muted">{a.presetKey ? `${a.presetKey} v${a.presetVersion ?? '—'}` : '—'}</span>
              <span className="text-text-secondary">{t(`enum.Agent.status.${a.status}`)}</span>
              <span className="ts-label-micro text-text-muted">{f.short(a.updatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    />
  );
}

function Audit({ id }: { id: string }) {
  const t = useT();
  const f = useFormats();
  return (
    <SubList<AuditLogDto>
      path={`/admin/workspaces/${id}/audit`}
      empty={t('admin.ws.empty.audit')}
      render={(rows) => (
        <Card className="p-0">
          <ul className="divide-y divide-line-hairline">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 px-3 py-2.5 text-[13px]">
                <span className="flex items-center gap-2">
                  <span className="ts-label-micro uppercase text-text-muted">{f.shortTime(r.at)}</span>
                  <span className="ts-label-micro uppercase">{r.action}</span>
                </span>
                <span className="text-text-secondary">
                  {r.actor.name} · {r.target.label}
                  {r.reason ? ` · ${r.reason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    />
  );
}

