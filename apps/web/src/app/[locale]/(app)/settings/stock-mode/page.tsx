'use client';
// /settings/stock-mode — Figma "SET — Settings — … Stock mode" (D12): two Option Cards · saving.
import { ConfirmDialog, FormAlert, OptionCard, Skeleton, Spinner, toast } from '@djaber/ui';
import { Box } from 'lucide-react';
import { useState } from 'react';
import { Section, SettingsPage } from '@/features/settings/common';
import { conflictOf, usePatchWorkspace, useWorkspaceCache } from '@/features/workspace/api';
import type { WorkspaceDto } from '@/lib/contracts';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function StockModePage() {
  const t = useT();
  const { workspace, can } = useSession();
  const editable = can('workspace.settings');
  const patch = usePatchWorkspace();
  const write = useWorkspaceCache();
  const [error, setError] = useState<string | null>(null);
  // advanced → simple hides Mouvements, Fournisseurs, Achats, Ventes, Caisse and Inventaires: asked first
  const [confirmSimple, setConfirmSimple] = useState(false);

  const choose = async (mode: 'simple' | 'advanced', version = workspace?.version) => {
    if (!workspace || mode === workspace.stockMode) return;
    setError(null);
    try {
      await patch.mutateAsync({ stockMode: mode, version });
      toast(t('toast.saved'));
    } catch (e) {
      // a single field: on a version conflict the choice is replayed on the fresh version
      const c = conflictOf<WorkspaceDto>(e);
      if (c?.current && version === workspace.version) {
        write(c.current);
        return choose(mode, c.current.version);
      }
      setError(errorMessage(e, t));
    }
  };

  return (
    <SettingsPage title={t('nav.settings.stockMode')} description={t('settings.stockMode.description')} permission="workspace.settings">
      <Section>
        {!workspace ? (
          <Skeleton className="h-28" />
        ) : (
          <div role="radiogroup" aria-label={t('nav.settings.stockMode')} className="grid gap-3 sm:grid-cols-2">
            {(['simple', 'advanced'] as const).map((m) => (
              <OptionCard
                key={m}
                name={m}
                selected={workspace.stockMode === m}
                onSelect={() => (m === 'simple' && workspace.stockMode === 'advanced' ? setConfirmSimple(true) : void choose(m))}
                disabled={patch.isPending || !editable}
                icon={<Box className="size-5" aria-hidden />}
                title={t(`settings.stockMode.${m}.title`)}
                description={t(`settings.stockMode.${m}.description`)}
                badge={t('enum.Workspace.status.active')}
                arrowSelects={false}
              />
            ))}
          </div>
        )}
        {patch.isPending ? <Spinner label={t('common.saving')} className="mt-3" /> : null}
        {!editable ? <p className="ts-label-meta mt-3 text-text-muted">{t('error.READ_ONLY_MEMBER')}</p> : null}
        {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
      </Section>
      <ConfirmDialog
        open={confirmSimple}
        onOpenChange={setConfirmSimple}
        title={t('settings.stockMode.toSimple.title')}
        description={t('settings.stockMode.toSimple.description')}
        confirmLabel={t('settings.stockMode.toSimple.confirm')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        loading={patch.isPending}
        onConfirm={() => {
          setConfirmSimple(false);
          void choose('simple');
        }}
      />
    </SettingsPage>
  );
}
