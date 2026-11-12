'use client';
// Connect / reconnect flow (FL-05, Figma "DLG — Agents & channels": Connecter une page — explications, Reconnexion
// Meta — issues, Rapport de connexion). The web never calls Meta: it asks our API for a URL, opens it in a pop-up and
// waits for the callback page to `postMessage` the report. Pop-up blocked ⇒ "Ouvrir dans cet onglet" (the callback
// then lands on `/channels/connect/return`, which comes back here with `?connectReport=` / `?connectError=`).
// Meta's login pages cut the pop-up's link to this window (Cross-Origin-Opener-Policy): the pop-up then has no opener,
// lands on `/channels/connect/return` and hands the result over a BroadcastChannel (`CONNECT_HANDOFF_CHANNEL`).
import { Button, buttonClass, Dialog, FormAlert, Ltr, Pill, SegmentedControl, Select, Spinner, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RESEND_COOLDOWN_S } from '@/components/auth/forgot-form';
import { useAgents, useAgentsRefresh } from '@/features/agents/api';
import { authApi } from '@/features/auth/api';
import { Link } from '@/i18n/navigation';
import { API_URL, ApiError } from '@/lib/api';
import { formatClock, retryAfterSeconds, useCooldown } from '@/lib/countdown';
import { errorMessage } from '@/lib/forms';
import { useT, type TFunction } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { channelsApi, useChannelsRefresh } from './api';
import type { Channel, ConnectReport, ConnectReportPage, ConnectStart, Platform, PlanLimit } from './contracts';
import { connectOutcome, errorReport, normalizeReport, parseConnectMessage, REPORT_ROW_TONE, reportCounts, reportRowKind } from './logic';

/** where the same-tab return route sends the browser back (the screen that started the flow) */
export const CONNECT_RETURN_KEY = 'djaber.connect.returnTo';
export const CONNECT_REPORT_PARAM = 'connectReport';
export const CONNECT_ERROR_PARAM = 'connectError';
const POPUP_FEATURES = 'popup=yes,width=620,height=760';
/** pop-up without opener → the window that started the flow: `{ type: 'handoff', reportId?, error? }`, answered by `{ type: 'ack' }` */
export const CONNECT_HANDOFF_CHANNEL = 'djaber.connect.handoff';
export type ConnectHandoff = { type: 'handoff'; reportId: string | null; error: string | null } | { type: 'ack' };
/** a flow started in this window accepts a hand-off for this long (the merchant may take time on Meta's pages) */
const HANDOFF_WINDOW_MS = 15 * 60_000;

type Run = () => Promise<ConnectStart>;
type Phase =
  | { kind: 'idle' }
  | { kind: 'explainer'; platform: Platform }
  | { kind: 'waiting' }
  | { kind: 'blocked'; url: string }
  | { kind: 'invalid' }
  | { kind: 'unverified' }
  | { kind: 'report'; report: ConnectReport };

const safeUrl = (raw: string): string | null => {
  try {
    const u = new URL(raw, window.location.origin);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
};
const apiOrigin = () => {
  try {
    return new URL(API_URL, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
};

export function useConnectFlow(o: { planLimit?: PlanLimit | null; onReport?: (report: ConnectReport) => void; /** the merchant closed "Rapport de connexion" */ onReportClosed?: (report: ConnectReport) => void } = {}) {
  const t = useT();
  const { me } = useSession();
  const refresh = useChannelsRefresh();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  /** when this window started a flow (0 = none pending): only that window accepts a hand-off */
  const started = useRef(0);
  const last = useRef<Run | null>(null);
  const onReport = useRef(o.onReport);
  onReport.current = o.onReport;

  const settle = useCallback(
    (report: ConnectReport) => {
      popup.current = null;
      const outcome = connectOutcome(report);
      setError(null);
      if (outcome.kind === 'cancelled') {
        setPhase({ kind: 'idle' });
        toast({ tone: 'neutral', message: t('toast.connectionCancelled') });
      } else if (outcome.kind === 'state-invalid') setPhase({ kind: 'invalid' });
      else if (outcome.kind === 'unverified') setPhase({ kind: 'unverified' });
      else if (outcome.kind === 'error') {
        setPhase({ kind: 'idle' });
        const key = `error.${outcome.code}`;
        toast({ tone: 'danger', message: outcome.message || (t.has(key) ? t(key, { retryAfter: '', current: '', limit: '', resource: '' }) : t('state.list.error.title')) });
      } else {
        setPhase({ kind: 'report', report: outcome.report });
        void refresh();
        onReport.current?.(outcome.report);
      }
    },
    [t, refresh],
  );

  const run = useCallback(
    async (get: Run) => {
      last.current = get;
      setError(null);
      if (me && !me.emailVerifiedAt) return setPhase({ kind: 'unverified' });
      // opened inside the click, before the request: browsers block a window opened after an await
      const w = window.open('', 'djaber-connect', POPUP_FEATURES);
      popup.current = w;
      started.current = Date.now();
      const before = phase;
      setPhase({ kind: 'waiting' });
      try {
        const url = safeUrl((await get()).url);
        if (!url) throw new Error('invalid url');
        if (!w || w.closed) return setPhase({ kind: 'blocked', url });
        w.location.href = url;
      } catch (e) {
        w?.close();
        popup.current = null;
        started.current = 0;
        if (e instanceof ApiError && e.code === 'AUTH_EMAIL_UNVERIFIED') return setPhase({ kind: 'unverified' });
        if (e instanceof ApiError && e.code === 'OAUTH_STATE_INVALID') return setPhase({ kind: 'invalid' });
        // the explainer stays open with the error inside it (content preserved); elsewhere a toast
        if (before.kind === 'explainer') {
          setPhase(before);
          setError(errorMessage(e, t));
        } else {
          setPhase({ kind: 'idle' });
          toast({ tone: 'danger', message: errorMessage(e, t) });
        }
      }
    },
    [me, phase, t],
  );

  // waiting: the callback page posts the report. A pop-up that looks closed is not a cancellation: once Meta's pages
  // have cut the link, `window.closed` reads true while the merchant is still choosing pages; "Annuler" stays available.
  useEffect(() => {
    if (phase.kind !== 'waiting') return;
    const origins = [apiOrigin(), window.location.origin];
    const onMessage = (e: MessageEvent) => {
      const report = parseConnectMessage(e.data, e.origin, origins);
      if (!report) return;
      started.current = 0;
      try {
        popup.current?.close();
      } catch {}
      settle(report);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [phase.kind, settle]);

  // hand-off from a pop-up that lost its opener (see the header)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CONNECT_HANDOFF_CHANNEL);
    channel.onmessage = (e: MessageEvent<ConnectHandoff>) => {
      const m = e.data;
      if (!m || m.type !== 'handoff' || !started.current || Date.now() - started.current > HANDOFF_WINDOW_MS) return;
      started.current = 0;
      popup.current = null;
      channel.postMessage({ type: 'ack' } satisfies ConnectHandoff);
      if (m.error || !m.reportId) return settle(errorReport(m.error || 'OAUTH_CANCELLED'));
      channelsApi
        .connectReport(m.reportId)
        .then((r) => settle(normalizeReport(r) ?? errorReport('OAUTH_STATE_INVALID')))
        .catch((err) => {
          setPhase({ kind: 'idle' });
          toast({ tone: 'danger', message: errorMessage(err, t) });
        });
    };
    return () => channel.close();
  }, [settle, t]);

  // same-tab return: `?connectReport=<id>` (report kept by the API) or `?connectError=<CODE>`
  const reportId = params.get(CONNECT_REPORT_PARAM);
  const errorCode = params.get(CONNECT_ERROR_PARAM);
  const returned = useRef<string | null>(null);
  useEffect(() => {
    if (!reportId && !errorCode) return;
    // once per returned flow (effects run twice in development, and the URL is rewritten below)
    const token = `${reportId ?? ''}|${errorCode ?? ''}`;
    if (returned.current === token) return;
    returned.current = token;
    const rest = new URLSearchParams(params.toString());
    rest.delete(CONNECT_REPORT_PARAM);
    rest.delete(CONNECT_ERROR_PARAM);
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
    if (errorCode) return settle(errorReport(errorCode));
    channelsApi
      .connectReport(reportId!)
      .then((r) => settle(normalizeReport(r) ?? errorReport('OAUTH_STATE_INVALID')))
      .catch((e) => toast({ tone: 'danger', message: errorMessage(e, t) }));
    // run once per returned report
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, errorCode]);

  const cancel = () => {
    started.current = 0;
    try {
      popup.current?.close();
    } catch {}
    popup.current = null;
    setPhase({ kind: 'idle' });
  };
  const sameTab = (url: string) => {
    try {
      window.sessionStorage.setItem(CONNECT_RETURN_KEY, window.location.pathname);
    } catch {}
    window.location.assign(url);
  };
  const close = () => {
    setError(null);
    setPhase({ kind: 'idle' });
  };

  const element = (
    <>
      <ExplainerDialog
        platform={phase.kind === 'explainer' ? phase.platform : null}
        planLimit={o.planLimit ?? null}
        error={error}
        onPlatform={(platform) => {
          setError(null);
          setPhase({ kind: 'explainer', platform });
        }}
        onClose={close}
        onContinue={(platform) => void run(() => channelsApi.connect(platform))}
      />
      <Dialog
        open={phase.kind === 'waiting'}
        onOpenChange={(open) => !open && cancel()}
        title={t('channels.connect.waiting.title')}
        description={t('channels.connect.waiting.description')}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <Button variant="ghost" onClick={cancel}>
            {t('action.cancel')}
          </Button>
        }
      >
        <div data-testid="connect-waiting" className="flex items-center gap-3 text-[13px] text-text-secondary">
          <Spinner label={t('common.connecting')} />
          {t('common.connecting')}
        </div>
      </Dialog>
      <Dialog
        open={phase.kind === 'blocked'}
        onOpenChange={(open) => !open && close()}
        title={t('channels.connect.blocked.title')}
        description={t('channels.connect.blocked.description')}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => phase.kind === 'blocked' && sameTab(phase.url)}>
              {t('channels.connect.blocked.sameTab')}
            </Button>
          </>
        }
      />
      <Dialog
        open={phase.kind === 'invalid'}
        onOpenChange={(open) => !open && close()}
        title={t('channels.connect.invalid.title')}
        description={t('channels.connect.invalid.description')}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => (last.current ? void run(last.current) : close())}>
              {t('channels.connect.invalid.restart')}
            </Button>
          </>
        }
      >
        <FormAlert tone="warning">
          {t('error.OAUTH_STATE_INVALID')}
        </FormAlert>
      </Dialog>
      <UnverifiedDialog open={phase.kind === 'unverified'} onClose={close} />
      <ReportDialog
        report={phase.kind === 'report' ? phase.report : null}
        onClose={() => {
          const report = phase.kind === 'report' ? phase.report : null;
          close();
          if (report) o.onReportClosed?.(report);
        }}
      />
    </>
  );

  return {
    /** "Connecter Facebook / Instagram" of the list: the explainer first */
    openExplainer: (platform: Platform) => {
      setError(null);
      setPhase({ kind: 'explainer', platform });
    },
    /** onboarding step 5: the step itself is the explainer */
    start: (platform: Platform) => run(() => channelsApi.connect(platform)),
    /** same flow with a new Meta token for one page (history kept) */
    reconnect: (channel: Pick<Channel, 'id'>) => run(() => channelsApi.reconnect(channel.id)),
    busy: phase.kind === 'waiting',
    element,
  };
}
export type ConnectFlow = ReturnType<typeof useConnectFlow>;

const PERMISSIONS: Record<Platform, readonly string[]> = {
  facebook: ['messaging', 'catalog', 'instagram', 'never'],
  instagram: ['igProfile', 'igMessages', 'never'],
};

function ExplainerDialog({
  platform,
  planLimit,
  error,
  onPlatform,
  onClose,
  onContinue,
}: {
  platform: Platform | null;
  planLimit: PlanLimit | null;
  error: string | null;
  onPlatform: (p: Platform) => void;
  onClose: () => void;
  onContinue: (p: Platform) => void;
}) {
  const t = useT();
  const { can } = useSession();
  const p = platform ?? 'facebook';
  // FL-05 F-2: at the page limit Meta still lets the merchant pick pages, but the new ones are skipped with
  // `PLAN_LIMIT` (a page already connected can still be reconnected): said before leaving for Facebook
  const atLimit = !!planLimit && planLimit.limit >= 0 && planLimit.current >= planLimit.limit;
  return (
    <Dialog
      open={platform !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('channels.connect.explainer.title')}
      closeLabel={t('action.close')}
      footer={
        <>
          {planLimit && planLimit.limit >= 0 ? (
            <span className="me-auto ts-label-meta text-text-muted" data-testid="connect-plan">
              <Ltr>{t('channels.connect.explainer.plan', { current: planLimit.current, limit: planLimit.limit })}</Ltr>
            </span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={() => onContinue(p)} data-testid="connect-continue">
            {t(`onboarding.connect.${p}.submit`)}
          </Button>
        </>
      }
    >
      <SegmentedControl
        label={t('channels.connect.explainer.platform')}
        value={p}
        onChange={onPlatform}
        options={[
          { value: 'facebook', label: t('channels.connect.explainer.facebook') },
          { value: 'instagram', label: t('channels.connect.explainer.instagram') },
        ]}
      />
      <p className="ts-label-meta mt-4 text-text-muted">{t(`channels.connect.explainer.note.${p}`)}</p>
      <div className="ts-label-micro mt-4 text-text-muted">{t('channels.connect.explainer.permissions')}</div>
      <ul className="mt-2 flex list-disc flex-col gap-2 ps-4 text-[13px] text-text-secondary">
        {PERMISSIONS[p].map((k) => (
          <li key={k}>{t(`channels.connect.explainer.permission.${k}`)}</li>
        ))}
      </ul>
      {atLimit ? (
        <FormAlert tone="warning" className="mt-4">
          <span data-testid="connect-at-limit">
            {t('gaps.channels.connect.atLimit', { current: planLimit!.current, limit: planLimit!.limit })}
          </span>
          {can('billing.read') ? (
            <>
              {' '}
              <Link href="/settings/billing" className="underline">
                {t('gaps.channels.connect.upgrade')}
              </Link>
            </>
          ) : null}
        </FormAlert>
      ) : null}
      {error ? <FormAlert className="mt-4">{error}</FormAlert> : null}
    </Dialog>
  );
}

/** GLOBAL "Vérifiez votre e-mail" (`AUTH_EMAIL_UNVERIFIED`): OK + Renvoyer with the 60 s cooldown. */
function UnverifiedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { me } = useSession();
  const [cooldown, startCooldown] = useCooldown();
  const [error, setError] = useState<string | null>(null);
  const resend = useMutation({ mutationFn: authApi.resendVerification });
  const onResend = async () => {
    setError(null);
    try {
      await resend.mutateAsync();
      toast(t('auth.verify.resent', { email: me?.email ?? '' }));
      startCooldown(RESEND_COOLDOWN_S);
    } catch (e) {
      const wait = retryAfterSeconds(e, RESEND_COOLDOWN_S);
      if (wait > 0) startCooldown(wait);
      else setError(errorMessage(e, t));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('channels.connect.unverified.title')}
      description={t('onboarding.connect.unverified', { email: me?.email ?? '' })}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button onClick={onResend} loading={resend.isPending} disabled={cooldown > 0}>
            {cooldown > 0 ? t('action.resendIn', { time: formatClock(cooldown) }) : t('action.resend')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('action.ok')}
          </Button>
        </>
      }
    >
      <FormAlert tone="warning">
        {t('error.AUTH_EMAIL_UNVERIFIED')}
      </FormAlert>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}

const rowNote = (t: TFunction, p: ConnectReportPage, limit: PlanLimit): ReactNode => {
  const kind = reportRowKind(p);
  if (kind === 'connected') return t(p.reconnected ? 'channels.report.note.reconnected' : 'channels.report.note.connected');
  const code = p.code ?? '';
  const key = `error.${code}`;
  const text = kind === 'limit' ? t('channels.report.note.limit', { current: limit.current, limit: limit.limit }) : t.has(key) ? t(key, { current: limit.current, limit: limit.limit, resource: '' }) : t(`channels.report.note.${kind}`);
  // UX-059: the sentence only, never the code before it
  return text;
};

/** "Rapport de connexion": one row per page found on the Meta account, with its outcome and code. */
function ReportDialog({ report, onClose }: { report: ConnectReport | null; onClose: () => void }) {
  const t = useT();
  const { can } = useSession();
  const refreshChannels = useChannelsRefresh();
  const refreshAgents = useAgentsRefresh();
  // pages of the report that now exist as channels: the agent chosen below is attached to each of them
  const linkable = (report?.pages ?? []).filter((p) => !!p.channelId && ['connected', 'pending', 'warning'].includes(reportRowKind(p)));
  const canLink = can('channels.manage') && linkable.length > 0;
  const agents = useAgents(undefined, report !== null && canLink);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const agentRows = agents.data?.rows ?? [];
  const chosen = agentRows.find((a) => a.id === agentId) ?? null;
  const finish = () => {
    setAgentId(null);
    setLinkError(null);
    onClose();
  };
  /**
   * "Rattacher et terminer": `PUT /channels/:id/agent` for each connected page. A page that already answers with
   * another agent (reconnection) keeps it — moving a page is always an explicit confirmation (AGT-05), done from the page.
   */
  const attach = async () => {
    if (!chosen) return finish();
    setLinking(true);
    setLinkError(null);
    try {
      let linked = 0;
      for (const p of linkable) {
        try {
          await channelsApi.setAgent(p.channelId!, { agentId: chosen.id });
          linked++;
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'AGENT_PAGE_ALREADY_ASSIGNED')) throw e;
        }
      }
      await Promise.all([refreshChannels(), refreshAgents(chosen.id)]);
      toast(linked < linkable.length ? { tone: 'warning', message: t('channels.report.agent.linkedSome', { count: linked, kept: linkable.length - linked, agent: chosen.name }) } : t('channels.report.agent.linked', { count: linked, agent: chosen.name }));
      finish();
    } catch (e) {
      setLinkError(errorMessage(e, t));
      void refreshChannels();
    } finally {
      setLinking(false);
    }
  };
  const counts = report ? reportCounts(report) : { found: 0, connected: 0 };
  const hasLimit = !!report?.pages.some((p) => reportRowKind(p) === 'limit');
  return (
    <Dialog
      open={report !== null}
      onOpenChange={(o) => !o && !linking && finish()}
      title={t('channels.report.title')}
      description={t('channels.report.found', { count: counts.found })}
      closeLabel={t('action.close')}
      footer={
        <>
          {hasLimit ? (
            <Link href="/settings/billing" className={buttonClass({ variant: 'ghost' })}>
              {t('action.comparePlans')}
            </Link>
          ) : null}
          {canLink && agentRows.length ? (
            <>
              <Button variant="ghost" onClick={finish} disabled={linking} data-testid="report-later">
                {t('action.later')}
              </Button>
              <Button variant="primary" onClick={attach} loading={linking} disabledReason={chosen ? undefined : t('channels.link.picker.choose')} data-testid="report-attach">
                {t('channels.report.agent.submit')}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={finish}>
              {t('action.close')}
            </Button>
          )}
        </>
      }
    >
      {report && report.pages.length === 0 ? <p className="text-[13px] text-text-secondary">{t('channels.report.empty')}</p> : null}
      <ul data-testid="connect-report" className="flex flex-col gap-4">
        {report?.pages.map((p) => {
          const kind = reportRowKind(p);
          return (
            <li key={`${p.platform}:${p.externalId}`} data-row={kind} className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{t(`channels.report.page.${p.platform}`, { name: p.name })}</div>
                <div className="ts-label-meta mt-1 text-text-muted">{rowNote(t, p, report.planLimit)}</div>
              </div>
              <Pill tone={REPORT_ROW_TONE[kind]} className="!rounded-[4px]">
                {t(`channels.report.status.${kind}`)}
              </Pill>
            </li>
          );
        })}
      </ul>
      {canLink && agentRows.length ? (
        <div className="mt-5 flex flex-col gap-1.5" data-testid="report-agent">
          <label htmlFor="report-agent-select" className="ts-label-meta uppercase text-text-secondary">
            {t('channels.report.agent.label')}
          </label>
          <Select id="report-agent-select" value={agentId ?? ''} disabled={linking} onChange={(e) => setAgentId(e.target.value || null)}>
            <option value="">{t('channels.report.agent.none')}</option>
            {agentRows.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <p className="ts-label-meta text-text-muted">{t('channels.report.agent.hint')}</p>
        </div>
      ) : null}
      {linkError ? <FormAlert className="mt-3">{linkError}</FormAlert> : null}
    </Dialog>
  );
}
