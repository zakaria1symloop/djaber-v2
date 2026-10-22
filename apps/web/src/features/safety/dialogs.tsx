'use client';
// Trust & safety dialogs — Figma "SAFE — Trust & safety (merchant)" + "DLG — Inbox & queue" (conversation menu):
// "Bloquer ce client" (confirmation, optional reason, reversible by an admin), "Signaler à Djaber — {name}" (reasons,
// details, "Bloquer aussi ce client maintenant", 24 h note) and "Bloquer un numéro" (Settings › Sécurité).
// Server errors stay inside the dialog and the content is kept (11 §10).
import { CreateBlockSchema, type BlockReason, type CreateReportInput, type ReportReason } from '@djaber/shared';
import { Button, Checkbox, Dialog, Field, FormAlert, PhoneInput, Select, Textarea, toast } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { errorMessage, fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { safetyApi, safetyKeys } from './api';
import { BLOCK_REASONS, canBlockAlso, reportReasons } from './logic';
import { formatPhoneOnBlur, phonePreviewLine } from '@/lib/phone';

const withCode = (e: unknown, text: string) => (e instanceof ApiError ? `${text} (${e.code})` : text);

function ReasonSelect({ id, value, onChange, disabled }: { id: string; value: BlockReason | ''; onChange: (v: BlockReason | '') => void; disabled?: boolean }) {
  const t = useT();
  return (
    <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as BlockReason | '')}>
      <option value="">{t('safety.reason.none')}</option>
      {BLOCK_REASONS.map((r) => (
        <option key={r} value={r}>
          {t(`safety.blockReason.${r}`)}
        </option>
      ))}
    </Select>
  );
}

/**
 * "Bloquer ce client" from the conversation menu (`POST /conversations/:id/block { reason, note? }`) or from the clients
 * list / client sheet (`clientId`: `POST /safety/blocks { clientId, reason?, note? }`, tester report 2026-10-21 UX-015).
 */
export function BlockCustomerDialog({
  open,
  onClose,
  conversationId,
  clientId,
  clientName,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  conversationId?: string;
  clientId?: string;
  clientName: string;
  onDone?: () => void;
}) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const [reason, setReason] = useState<BlockReason | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const block = useMutation({
    mutationFn: () =>
      clientId ? safetyApi.createBlock({ clientId, ...(reason ? { reason } : {}), ...(note.trim() ? { note: note.trim() } : {}) }) : safetyApi.blockConversation(conversationId!, { reason: reason || 'other', note: note.trim() || undefined }),
  });
  useEffect(() => {
    if (open) {
      setReason('');
      setNote('');
      setError(null);
    }
  }, [open, conversationId, clientId]);

  const submit = async () => {
    setError(null);
    try {
      await block.mutateAsync();
      void qc.invalidateQueries({ queryKey: safetyKeys.blocks(ws) });
      toast(t('safety.block.done', { name: clientName }));
      onDone?.();
      onClose();
    } catch (e) {
      setError(withCode(e, errorMessage(e, t)));
    }
  };
  const busy = block.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('dialog.blockCustomer.title')}
      description={t('safety.block.context', { name: clientName })}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy} data-testid="block-confirm">
            {t('action.block')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-text-secondary">{t('safety.block.consequences')}</p>
        <Field label={t('safety.field.reasonOptional')} htmlFor="block-reason">
          <ReasonSelect id="block-reason" value={reason} onChange={setReason} disabled={busy} />
        </Field>
        <Field label={t('common.noteOptional')} htmlFor="block-note">
          <Textarea id="block-note" className="!min-h-16" maxLength={500} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="ts-label-meta text-text-muted">{t('safety.block.roles')}</p>
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

export type ReportTarget = { type: CreateReportInput['type']; conversationId?: string; clientId?: string; messageId?: string; productId?: string };

/** "Signaler à Djaber — {name}": `POST /safety/reports`; acknowledged at once, decision under 24 h. */
export function ReportCustomerDialog({ open, onClose, target, name, onDone }: { open: boolean; onClose: () => void; target: ReportTarget; name: string; onDone?: (o: { blocked: boolean }) => void }) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const reasons = reportReasons(target.type);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [blockAlso, setBlockAlso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState(false);
  /** ABUSE_REPORT_ALREADY_OPEN: the dialog explains it and offers nothing but closing */
  const [alreadyOpen, setAlreadyOpen] = useState(false);
  const send = useMutation({ mutationFn: (b: CreateReportInput) => safetyApi.report(b) });
  const targetKey = `${target.type}:${target.conversationId ?? ''}:${target.clientId ?? ''}:${target.messageId ?? ''}:${target.productId ?? ''}`;
  useEffect(() => {
    if (open) {
      setReason(target.type === 'ai_message' ? 'ai_incorrect' : null);
      setDetails('');
      setBlockAlso(false);
      setError(null);
      setReasonError(false);
      setAlreadyOpen(false);
    }
    // the fields are reset when the dialog opens on another target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetKey]);

  const withBlock = canBlockAlso(target.type);
  const submit = async () => {
    setError(null);
    if (!reason) return setReasonError(true);
    try {
      await send.mutateAsync({ ...target, reason, details: details.trim() || undefined, blockAlso: withBlock && blockAlso ? true : undefined });
      if (blockAlso) void qc.invalidateQueries({ queryKey: safetyKeys.blocks(ws) });
      toast(t(blockAlso && withBlock ? 'safety.report.sentAndBlocked' : 'safety.report.sent'));
      onDone?.({ blocked: withBlock && blockAlso });
      onClose();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      if (code === 'ABUSE_REPORT_ALREADY_OPEN') return setAlreadyOpen(true);
      if (code === 'ABUSE_REPORT_RATE_LIMITED' || code === 'ABUSE_REPORT_SELF') return void toast({ tone: 'danger', message: withCode(e, errorMessage(e, t)) });
      setError(withCode(e, errorMessage(e, t)));
    }
  };
  const busy = send.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('dialog.reportCustomer.title', { name })}
      description={t('safety.report.note')}
      closeLabel={t('action.close')}
      footer={
        alreadyOpen ? (
          <Button variant="primary" onClick={onClose}>
            {t('action.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void submit()} loading={busy} data-testid="report-send">
              {t('safety.report.submit')}
            </Button>
          </>
        )
      }
    >
      {alreadyOpen ? (
        <FormAlert tone="warning">
          <span data-testid="report-already-open">{t('safety.report.alreadyOpen')} (ABUSE_REPORT_ALREADY_OPEN)</span>
        </FormAlert>
      ) : (
        <div className="flex flex-col gap-4">
          <fieldset disabled={busy}>
            <legend className="ts-label-meta uppercase text-text-secondary">{t('common.reason')}</legend>
            <div role="radiogroup" aria-label={t('common.reason')} className="mt-2 flex flex-col gap-0.5">
              {reasons.map((r) => (
                <label key={r} className="flex cursor-pointer items-center gap-3 rounded-card px-2 py-1.5 text-[13px] hover:bg-ink-raised">
                  <input
                    type="radio"
                    name="report-reason"
                    value={r}
                    checked={reason === r}
                    onChange={() => {
                      setReason(r);
                      setReasonError(false);
                    }}
                    className="size-4 accent-white"
                  />
                  <span>{t(`safety.reportReason.${r}`)}</span>
                </label>
              ))}
            </div>
            {reasonError ? (
              <p role="alert" className="mt-1 text-[12px] text-accent-alert">
                {fieldError(t, 'validation.required')}
              </p>
            ) : null}
          </fieldset>
          <Field label={t('safety.report.details')} htmlFor="report-details">
            <Textarea id="report-details" className="!min-h-20" maxLength={2000} value={details} disabled={busy} placeholder={t('safety.report.detailsPlaceholder')} onChange={(e) => setDetails(e.target.value)} />
          </Field>
          {withBlock ? (
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
              <Checkbox checked={blockAlso} disabled={busy} onChange={(e) => setBlockAlso(e.target.checked)} />
              <span>{t('safety.report.blockAlso')}</span>
            </label>
          ) : null}
          <p className="ts-label-meta text-text-muted">{t('safety.report.extract')}</p>
          {error ? <FormAlert>{error}</FormAlert> : null}
        </div>
      )}
    </Dialog>
  );
}

/** "+ Bloquer un numéro" (Settings › Sécurité): `POST /safety/blocks { phone, reason?, note? }`. */
export function BlockNumberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState<BlockReason | ''>('');
  const [note, setNote] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({ mutationFn: safetyApi.createBlock });
  useEffect(() => {
    if (open) {
      setPhone('');
      setReason('');
      setNote('');
      setPhoneError(undefined);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    setPhoneError(undefined);
    const parsed = CreateBlockSchema.safeParse({ phone: phone.trim() || undefined, reason: reason || undefined, note: note.trim() || undefined });
    if (!parsed.success) return setPhoneError('validation.required');
    try {
      await create.mutateAsync(parsed.data);
      await qc.invalidateQueries({ queryKey: safetyKeys.blocks(ws) });
      toast(t('safety.blockNumber.done', { phone: phone.trim() }));
      onClose();
    } catch (e) {
      const field = e instanceof ApiError ? e.body.fields?.phone : undefined;
      if (field) setPhoneError(field);
      else setError(withCode(e, errorMessage(e, t)));
    }
  };
  const busy = create.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('safety.blockNumber.title')}
      description={t('safety.blockNumber.note')}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy} data-testid="block-number-save">
            {t('action.block')}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('common.phone')} htmlFor="block-phone" required error={fieldError(t, phoneError)}>
          <PhoneInput
            id="block-phone"
            autoComplete="off"
            maxLength={20}
            placeholder="0555 12 34 56"
            value={phone}
            format={formatPhoneOnBlur}
            disabled={busy}
            aria-invalid={!!phoneError}
            onChange={(e) => setPhone(e.target.value)}
            preview={phonePreviewLine(t, phone)}
          />
        </Field>
        <Field label={t('safety.field.reasonOptional')} htmlFor="block-number-reason">
          <ReasonSelect id="block-number-reason" value={reason} onChange={setReason} disabled={busy} />
        </Field>
        <Field label={t('common.noteOptional')} htmlFor="block-number-note">
          <Textarea id="block-number-note" className="!min-h-16" maxLength={500} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('action.block')}
        </button>
      </form>
    </Dialog>
  );
}
