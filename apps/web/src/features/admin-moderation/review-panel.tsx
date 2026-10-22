'use client';
// ADM-10 review panel (03 MOD-07): merchant context, images with their AI flag, flagged fields with the AI evidence
// (refused fields toggled by the moderator → `rejectedFields`), merchant history, decision reason (one
// `ModerationDecision`), message to the merchant (FR, auto-translated AR by the API), Rejeter / Demander une
// modification / Approuver. Errors stay in the panel (MODERATION_REASON_REQUIRED, MODERATION_ITEM_ALREADY_DECIDED ⇒
// the item and the queue are refetched), the typed message is kept and guarded on leave.
import { formatDateTime, formatMoney, MODERATION_REASON_TEMPLATES, type AppLocale, type ModerationDecision, type ModerationItemDetailDto, type ModerationItemDto } from '@djaber/shared';
import { Button, DecisionChip, FlaggedField, FlagImageTile, FormAlert, Ltr, NotFoundState, Pill, Skeleton, Textarea, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { AdminQueryError } from '@/features/admin/admin-page';
import { ApiError } from '@/lib/api';
import { reasonText } from '@/lib/actions';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { modApi, useModerationItem, useModerationRefresh, type DecisionKind } from './api';
import { decisionState, flaggedFields, formatScore, formatWaiting, normaliseField, priceGapPct, refusableFields } from './logic';
import { decisionLabel, flagText, itemTitle, trustLabel } from './ui';

export function ReviewPanel({ id, fallback, canWrite, onDecided }: { id: string; fallback?: ModerationItemDto; canWrite: boolean; onDecided: (id: string) => void }) {
  const t = useT();
  const q = useModerationItem(id);
  // a conflict (409 already decided) refetches the item: the body remounts in its decided state and keeps the notice
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  if (q.isPending && !fallback) {
    return (
      <PanelFrame>
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
          <Skeleton className="h-24 w-full" />
        </div>
      </PanelFrame>
    );
  }
  if (q.isError && !q.data) {
    return (
      <PanelFrame>
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <NotFoundState title={t('state.detail.notFound.title')} description={t('adminMod.panel.notFound')} />
        ) : (
          <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
        )}
      </PanelFrame>
    );
  }
  const item = (q.data ?? fallback) as ModerationItemDetailDto;
  return (
    <PanelBody
      key={`${item.id}:${item.status}`}
      item={item}
      canWrite={canWrite}
      onDecided={onDecided}
      notice={notice?.id === item.id ? notice.text : null}
      onConflict={(text) => {
        setNotice({ id: item.id, text });
        void q.refetch();
      }}
    />
  );
}

function PanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <section data-testid="mod-panel" className="rounded-card border border-line-edge bg-ink-surface p-4 md:p-5">
      {children}
    </section>
  );
}

function PanelBody({
  item,
  canWrite,
  onDecided,
  notice,
  onConflict,
}: {
  item: ModerationItemDetailDto;
  canWrite: boolean;
  onDecided: (id: string) => void;
  notice: string | null;
  onConflict: (text: string) => void;
}) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const refresh = useModerationRefresh();
  const [decision, setDecision] = useState<string | null>(item.decision);
  const [message, setMessage] = useState('');
  const [fields, setFields] = useState<string[]>(() => (item.rejectedFields.length ? item.rejectedFields.map(normaliseField) : flaggedFields(item)));
  const [error, setError] = useState<string | null>(null);
  const open = item.status === 'pending' || item.status === 'changes_requested';
  const { guard } = useLeaveGuard(open && message.trim().length > 0, itemTitle(t, item));

  const send = useMutation({
    mutationFn: (kind: DecisionKind) =>
      modApi.decide(
        item.id,
        kind,
        kind === 'approve'
          ? message.trim()
            ? { merchantMessage: message.trim() }
            : {}
          : {
              decision: (decision ?? (kind === 'request-changes' ? 'missing_info' : undefined)) as ModerationDecision | undefined,
              reasonTemplateKey: decision ?? (kind === 'request-changes' ? 'missing_info' : undefined),
              merchantMessage: message.trim() || undefined,
              rejectedFields: fields,
            },
      ),
  });
  const run = async (kind: DecisionKind) => {
    setError(null);
    try {
      await send.mutateAsync(kind);
      toast({ tone: 'success', message: t(`adminMod.toast.${kind}`, { name: itemTitle(t, item) }) });
      setMessage('');
      void refresh();
      onDecided(item.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MODERATION_ITEM_ALREADY_DECIDED') {
        void refresh();
        onConflict(errorMessage(e, t));
      } else setError(errorMessage(e, t));
    }
  };

  const p = item.product;
  const gap = p ? priceGapPct(p.price, p.marketReference) : null;
  const flagsOf = (field: string) => item.aiFlags.filter((f) => f.field && normaliseField(f.field) === field);
  const isRefused = (f: string) => fields.includes(f);
  const toggleField = (f: string) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  const refusable = new Set(refusableFields(item));
  const fieldToggle = (f: string) => (open && canWrite && refusable.has(f) ? { checked: isRefused(f), onChange: () => toggleField(f), label: t('adminMod.panel.refused') } : undefined);
  const approve = decisionState(item, 'approve', canWrite);
  const reject = decisionState(item, 'reject', canWrite);
  const changes = decisionState(item, 'request-changes', canWrite);
  const statusLabel = t(`adminMod.status.${item.status}`);
  const head = open ? `${statusLabel} · ${formatWaiting(item.waitingMinutes)}` : statusLabel;
  const unflaggedImages = (p?.images ?? []).length;
  // PV1: keyword-list hits in the variant names / search keywords (no field row of their own)
  const otherFlags = [...flagsOf('variants'), ...flagsOf('keywords')];

  return (
    <PanelFrame>
      <div data-item={item.id} data-status={item.status}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="ts-display-s min-w-0 flex-1">{itemTitle(t, item)}</h2>
          <Pill tone={item.status === 'rejected' || item.status === 'appeal_rejected' ? 'danger' : open ? 'warning' : item.status === 'appealed' ? 'violet' : 'success'}>{head}</Pill>
        </header>
        <p className="mt-2 ts-label-micro text-text-muted" data-testid="mod-panel-context">
          {[
            item.workspace.name,
            t('adminMod.panel.plan', { plan: item.workspace.plan }),
            t('adminMod.panel.trust', { level: trustLabel(t, item.workspace.trustLevel).toLowerCase() }),
            t('adminMod.panel.priorRejections', { count: item.workspace.priorRejections }),
            t('adminMod.panel.approved', { count: item.workspace.approvedProducts }),
          ].join(' · ')}
        </p>

        {p && unflaggedImages ? (
          <div className="mt-4 grid grid-cols-4 gap-2">
            {p.images.map((img, i) => (
              <div key={i} className="flex flex-col gap-1">
                <FlagImageTile src={img.url} alt={t('adminMod.panel.image', { n: i + 1 })} flag={img.flag} />
                {fieldToggle(`image:${i + 1}`) ? (
                  <label className="inline-flex items-center gap-1 ts-label-micro text-text-muted">
                    <input type="checkbox" className="size-3 accent-white" checked={isRefused(`image:${i + 1}`)} onChange={() => toggleField(`image:${i + 1}`)} />
                    {t('adminMod.panel.refused')}
                  </label>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-3">
          {p ? (
            <>
              <FlaggedField label={t('adminMod.panel.title')} flagged={isRefused('name')} evidence={flagsOf('name').map((f) => flagText(t, f)).join(' · ') || undefined} toggle={fieldToggle('name')} data-testid="mod-field-name">
                {p.name}
              </FlaggedField>
              {p.description ? (
                <FlaggedField label={t('adminMod.panel.description')} flagged={isRefused('description')} evidence={flagsOf('description').map((f) => flagText(t, f)).join(' · ') || undefined} toggle={fieldToggle('description')}>
                  {p.description}
                </FlaggedField>
              ) : null}
              <FlaggedField label={t('adminMod.panel.price')} flagged={isRefused('price')} evidence={flagsOf('price').map((f) => flagText(t, f)).join(' · ') || undefined} toggle={fieldToggle('price')}>
                <Ltr>{p.marketReference ? t('adminMod.panel.priceRef', { price: formatMoney(p.price), ref: formatMoney(p.marketReference), gap: gap === null ? '—' : `${gap > 0 ? '+' : '−'}${Math.abs(gap)}` }) : formatMoney(p.price)}</Ltr>
              </FlaggedField>
              <FlaggedField label={t('adminMod.panel.category')} flagged={isRefused('category')} toggle={fieldToggle('category')}>
                {t('adminMod.panel.categoryValue', { category: p.category ?? '—', count: p.variants })}
              </FlaggedField>
              {otherFlags.length ? (
                <FlaggedField label={t('adminMod.panel.otherTexts')} flagged evidence={otherFlags.map((f) => flagText(t, f)).join(' · ')} data-testid="mod-field-other">
                  {[...new Set(otherFlags.map((f) => t(`adminMod.panel.source.${f.field}`)))].join(' · ')}
                </FlaggedField>
              ) : null}
            </>
          ) : item.agent ? (
            <>
              <FlaggedField label={t('adminMod.panel.agent')}>{item.agent.name}</FlaggedField>
              <FlaggedField label={t('adminMod.panel.prompt')} flagged evidence={item.aiFlags.map((f) => flagText(t, f)).join(' · ') || undefined}>
                {item.agent.excerpt}
              </FlaggedField>
            </>
          ) : item.category ? (
            <FlaggedField label={t('adminMod.panel.category')} flagged evidence={item.aiFlags.map((f) => flagText(t, f)).join(' · ') || undefined}>
              {item.category.name}
            </FlaggedField>
          ) : null}
          {item.aiScore === null ? <FormAlert tone="warning">{t('adminMod.flag.prescreen_unavailable')}</FormAlert> : (
            <p className="ts-label-micro text-text-muted">{t('adminMod.panel.score', { score: formatScore(item.aiScore, locale) })}</p>
          )}
          {item.history?.length ? (
            <FlaggedField label={t('adminMod.panel.history')}>
              <ul className="flex flex-col gap-0.5 text-[13px] text-accent-starred" data-testid="mod-history">
                {item.history.map((h) => (
                  <li key={h.id}>
                    {[t(`adminMod.status.${h.status}`), h.decision ? decisionLabel(t, h.decision) : null, formatDateTime(h.decidedAt ?? h.submittedAt, locale), h.reviewer ? `${h.reviewer.firstName} ${h.reviewer.lastName}`.trim() : null].filter(Boolean).join(' · ')}
                  </li>
                ))}
              </ul>
            </FlaggedField>
          ) : null}
        </div>

        {item.appeal ? (
          <div className="mt-4 rounded-card border border-line-hairline px-3 py-2.5" data-testid="mod-panel-appeal">
            <div className="ts-label-micro uppercase text-text-muted">{t('adminMod.appeal.message')}</div>
            <p className="mt-1 text-[14px]">{item.appeal.message}</p>
            {item.appeal.attachmentUrl ? (
              <a href={item.appeal.attachmentUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block ts-label-meta text-accent-inbound hover:underline">
                {t(item.appeal.attachmentMime === 'application/pdf' ? 'adminMod.appeal.attachmentPdf' : 'adminMod.appeal.attachmentImage')}
              </a>
            ) : null}
          </div>
        ) : null}

        {open ? (
          <div className="mt-5">
            <div className="ts-label-micro uppercase text-text-muted">{t('adminMod.panel.decision')}</div>
            <div role="radiogroup" aria-label={t('adminMod.panel.decision')} className="mt-2 flex flex-wrap gap-2" data-testid="mod-decision">
              {MODERATION_REASON_TEMPLATES.map((r) => (
                <DecisionChip key={r} name={`decision-${item.id}`} value={r} checked={decision === r} onChange={() => setDecision(r)} disabled={!canWrite}>
                  {t(`adminMod.reason.${r}`)}
                </DecisionChip>
              ))}
            </div>
            <Textarea
              className="mt-3 min-h-24 py-2.5"
              aria-label={t('adminMod.panel.message')}
              placeholder={t('adminMod.panel.messagePlaceholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={!canWrite}
              maxLength={2000}
              data-testid="mod-message"
            />
            {error || notice ? (
              <FormAlert className="mt-3">
                <span data-testid={error ? 'mod-error' : 'mod-conflict'}>{error ?? notice}</span>
              </FormAlert>
            ) : null}
            {canWrite ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  className="border-accent-alert/60 text-accent-alert hover:border-accent-alert"
                  onClick={() => void run('reject')}
                  loading={send.isPending && send.variables === 'reject'}
                  disabledReason={reject.enabled ? undefined : reasonText(t, reject.reasonCode)}
                  data-testid="mod-reject"
                >
                  {t('adminMod.action.reject')}
                </Button>
                <Button onClick={() => void run('request-changes')} loading={send.isPending && send.variables === 'request-changes'} disabledReason={changes.enabled ? undefined : reasonText(t, changes.reasonCode)} data-testid="mod-changes">
                  {t('adminMod.action.requestChanges')}
                </Button>
                <span className="flex-1" />
                <Button variant="primary" onClick={() => void run('approve')} loading={send.isPending && send.variables === 'approve'} disabledReason={approve.enabled ? undefined : reasonText(t, approve.reasonCode)} data-testid="mod-approve">
                  {t('adminMod.action.approve')}
                </Button>
              </div>
            ) : (
              <p className="mt-3 ts-label-meta text-text-muted" data-testid="mod-readonly">
                {t('adminMod.panel.readOnly')}
              </p>
            )}
            <p className="mt-5 ts-label-micro text-text-muted">{t('adminMod.panel.rule')}</p>
          </div>
        ) : (
          <div className="mt-5 rounded-card border border-line-hairline px-3 py-2.5 text-[13px]" data-testid="mod-decided">
            <div className="ts-label-micro uppercase text-text-muted">{t('adminMod.panel.decided')}</div>
            <p className="mt-1">
              {[statusLabel, item.decision ? decisionLabel(t, item.decision) : null, item.decidedAt ? formatDateTime(item.decidedAt, locale) : null, item.reviewer ? `${item.reviewer.firstName} ${item.reviewer.lastName}`.trim() : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {item.merchantMessage ? <p className="mt-1 text-text-secondary">« {item.merchantMessage} »</p> : null}
            {item.rejectedFields.length ? <p className="mt-1 ts-label-meta text-accent-alert">{t('adminMod.panel.refusedFields', { fields: item.rejectedFields.join(', ') })}</p> : null}
            {notice ? (
              <FormAlert className="mt-3">
                <span data-testid="mod-conflict">{notice}</span> <span className="text-text-muted">{t('adminMod.panel.conflict')}</span>
              </FormAlert>
            ) : null}
          </div>
        )}
      </div>
      {guard}
    </PanelFrame>
  );
}
