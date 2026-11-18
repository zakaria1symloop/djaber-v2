'use client';
// Platform write confirmed with « Raison * » — journeys 16/11 J13-4: « Dépublier « key » ? » (CMS) and « Archiver / Restaurer
// le préréglage » ask a reason (≥ 10 chars) like every other platform write; it is sent as `{ reason }` and logged
// (AuditLog.reason). The server error stays inline, the typed reason is kept.
import { toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { adminWrite, useAdminInvalidate } from './api';
import { AdminDialog, NO_ERRORS, ReasonField, reasonOk, toServerErrors, useOnOpen, type ServerErrors } from './dialog-kit';

/**
 * `path` (+ `body`) is POSTed with `{ ...body, reason }`; or `run(reason)` performs the write itself (journey J13r J13-4: the
 * CMS editor saves its draft first). `onError` returning true closes the dialog (the caller shows that error itself).
 */
export type ReasonConfirm = { title: string; context?: string; submitLabel: string; destructive?: boolean; path?: string; body?: Record<string, unknown>; run?: (reason: string) => Promise<unknown>; onError?: (e: unknown) => boolean; done: string; invalidate: string };

export function ReasonConfirmDialog({ req, onClose, testId = 'dlg-reason-confirm' }: { req: ReasonConfirm | null; onClose: () => void; testId?: string }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  useOnOpen(!!req, () => {
    setReason('');
    setErrors(NO_ERRORS);
  });
  const m = useMutation({ mutationFn: (b: { req: ReasonConfirm; reason: string }) => (b.req.run ? b.req.run(b.reason) : adminWrite(b.req.path ?? '', 'POST', { ...(b.req.body ?? {}), reason: b.reason })) });
  const submit = async () => {
    if (!req) return;
    setErrors(NO_ERRORS);
    try {
      await m.mutateAsync({ req, reason: reason.trim() });
      void invalidate(req.invalidate);
      toast(req.done);
      onClose();
    } catch (e) {
      if (req.onError?.(e)) return onClose();
      setErrors(toServerErrors(e, t, ['reason'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  return (
    <AdminDialog
      open={!!req}
      onClose={onClose}
      testId={testId}
      size="sm"
      title={req?.title ?? ''}
      context={req?.context}
      submitLabel={req?.submitLabel ?? ''}
      destructive={req?.destructive}
      disabled={!reasonOk(reason)}
      pending={m.isPending}
      error={errors.form}
      onSubmit={() => void submit()}
    >
      <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
    </AdminDialog>
  );
}

/** « Dépublier « key » ? » with its reason. */
export function UnpublishCmsDialog({ entry, onClose }: { entry: { id: string; key: string } | null; onClose: () => void }) {
  const t = useT();
  const req: ReasonConfirm | null = entry
    ? { title: t('admin.cms.unpublishConfirm.title', { key: entry.key }), context: t('admin.cms.unpublishConfirm.description'), submitLabel: t('admin.cms.action.unpublish'), destructive: true, path: `/admin/cms/${entry.id}/unpublish`, done: t('admin.cms.unpublished'), invalidate: '/admin/cms' }
    : null;
  return <ReasonConfirmDialog req={req} onClose={onClose} testId="dlg-cms-unpublish" />;
}

/** Journey J13r (J13-4): « Publier « key » ? » from the row menu — the publication is logged with its reason. */
export function PublishCmsDialog({ entry, onClose }: { entry: { id: string; key: string } | null; onClose: () => void }) {
  const t = useT();
  const req: ReasonConfirm | null = entry
    ? { title: t('admin.cms.publishConfirm.title', { key: entry.key }), context: t('admin.cms.publishConfirm.description'), submitLabel: t('admin.cms.action.publish'), path: `/admin/cms/${entry.id}/publish`, done: t('admin.cms.publishedToast'), invalidate: '/admin/cms' }
    : null;
  return <ReasonConfirmDialog req={req} onClose={onClose} testId="dlg-cms-publish" />;
}
