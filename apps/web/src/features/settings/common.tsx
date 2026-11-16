'use client';
// Building blocks of the Settings pages (Figma "SET — Settings — …"): page frame with permission gate, section card, image upload.
import { useDocumentTitle } from '@/lib/document-title';
import { roleCan, type MerchantPermission } from '@djaber/shared';
import { Card, cn, PageHeader } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Page403 } from '@/components/global-states';
import { workspaceApi } from '@/features/workspace/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import type { UploadDto } from '@/lib/contracts';
import { useSession } from '@/lib/session';
import { CropDialog } from './crop-dialog';
import { checkImage, IMAGE_TYPES } from './image';

/**
 * Page frame: title, description, actions. A role without the permission gets the 403 state (the API also refuses).
 * Read-only members (plan limit) keep the page; its controls are disabled through `useCan`.
 */
export function SettingsPage({
  title,
  description,
  actions,
  permission,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  permission?: MerchantPermission;
  children: ReactNode;
}) {
  useDocumentTitle(title);
  const t = useT();
  const locale = useLocaleCode();
  const { role } = useSession();
  if (permission && !roleCan(role, permission)) return <Page403 role={role ? t(`enum.Membership.role.${role}`) : '—'} homeHref={`/${locale}/home`} permissions={[permission]} />;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </div>
  );
}

export function Section({ title, description, children, className, tone }: { title?: string; description?: string; children: ReactNode; className?: string; tone?: 'danger' }) {
  return (
    <Card className={cn('p-5', tone === 'danger' && 'border-accent-alert/40', className)}>
      {title ? <h2 className="ts-display-s">{title}</h2> : null}
      {description ? <p className="ts-body mt-2 text-text-secondary">{description}</p> : null}
      <div className={cn((title || description) && 'mt-4')}>{children}</div>
    </Card>
  );
}

/**
 * Hidden file input + crop step (M11, Figma "Logo de l'espace & avatar": RECADRER) + upload (`POST /uploads`): returns
 * the upload id to attach with a PATCH. A refused file (type / size) is reported before the crop dialog opens.
 */
export function useImageUpload(kind: 'avatar' | 'logo' | 'category_image', onUploaded: (uploadId: string, upload: UploadDto) => Promise<unknown> | void) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const up = await workspaceApi.upload(file, kind);
      await onUploaded(up.id, up);
    },
  });
  const onFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setCropError(null);
    const bad = checkImage(file);
    if (bad) return setError(t(`error.${bad}`));
    setPicked(file);
  };
  const onCropped = async (file: File) => {
    setCropError(null);
    try {
      await upload.mutateAsync(file);
      setPicked(null);
    } catch (e) {
      // shown inside the crop dialog, the picture kept (AT-UX-04)
      setCropError(errorMessage(e, t));
    }
  };
  const input = (
    <>
      <CropDialog file={picked} kind={kind} uploading={upload.isPending} error={cropError} onCancel={() => (setPicked(null), setCropError(null))} onConfirm={(f) => void onCropped(f)} />
      <input
      ref={ref}
      type="file"
      accept={IMAGE_TYPES.join(',')}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-upload={kind}
      onChange={(e) => {
        onFile(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
    </>
  );
  return { input, open: () => ref.current?.click(), uploading: upload.isPending, error, clearError: () => setError(null) };
}
