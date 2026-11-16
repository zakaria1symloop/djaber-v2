'use client';
// /settings/stock-mode — Figma "SET — Settings — … Stock mode" (D12): two Option Cards · saving.
import { Button, ConfirmDialog, Field, FormAlert, NumberInput, OptionCard, radioTabIndex, Skeleton, Spinner, toast } from '@djaber/ui';
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
            {(['simple', 'advanced'] as const).map((m, i, all) => (
              <OptionCard
                key={m}
                name={m}
                selected={workspace.stockMode === m}
                tabIndex={radioTabIndex(i, all.indexOf(workspace.stockMode))}
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
      {workspace?.stockMode === 'advanced' ? <TargetMargin key={workspace.version} workspace={workspace} editable={editable} /> : null}
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

/**
 * journeys 16/11 J07-4 — 03 §Settings « target margin » (`Workspace.targetMarginPct`, default 35, advanced mode only): the
 * margin the PRIX stock recommendation aims at (04 §20, AT-GDS-16). 0–100 % (API range).
 */
function TargetMargin({ workspace, editable }: { workspace: WorkspaceDto; editable: boolean }) {
  const t = useT();
  const patch = usePatchWorkspace();
  const [value, setValue] = useState(String(workspace.targetMarginPct));
  const [error, setError] = useState<string | null>(null);
  const n = value.trim() === '' ? null : Number(value);
  const invalid = n === null || n > 100;
  const dirty = n !== workspace.targetMarginPct;
  const save = async () => {
    if (invalid || !dirty) return;
    setError(null);
    try {
      await patch.mutateAsync({ targetMarginPct: n!, version: workspace.version });
      toast(t('toast.saved'));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <Section title={t('settings.stockMode.targetMargin.title')} description={t('settings.stockMode.targetMargin.description')}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('settings.stockMode.targetMargin.label')} htmlFor="target-margin" error={value.trim() !== '' && invalid ? t('validation.range', { min: 0, max: 100 }) : undefined}>
          <NumberInput id="target-margin" value={value} onValueChange={setValue} maxDigits={3} suffix="%" disabled={!editable || patch.isPending} className="w-28" />
        </Field>
        <Button variant="primary" onClick={() => void save()} loading={patch.isPending} disabled={!editable || invalid || !dirty} disabledReason={!editable ? t('error.READ_ONLY_MEMBER') : undefined}>
          {t('action.save')}
        </Button>
      </div>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Section>
  );
}
