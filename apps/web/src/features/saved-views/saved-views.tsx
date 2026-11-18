'use client';
// Saved views of a list (LST-03, D42 / D47, 04 §24) — Figma "REF — Deep-link map … + remaining list mechanics" panel
// « Vues enregistrées (toutes les listes) » (rows · DÉFAUT · ⋯ menu · « + Enregistrer la vue courante… »), opened from
// the « Vues ⌄ » chip next to the filter bar of every list of 05 §16. One component for every list: it reads and writes
// the list state of `useListState` (filters, tab, search, sort, visible columns, density).
// · open `/orders?view=<id>` (shared link, mobile deep link) ⇒ the view is applied and `view` leaves the URL;
// · a list opened with a clean URL opens on the member's default view;
// · menu ⋯: rename · set / remove default · share to the team (Admin+, `views.share`) · duplicate · delete (the count of
//   members who lose a shared view is in the confirmation); a view shared by another member is read-only (duplicate).
import type { SavedViewDto, SavedViewPage } from '@djaber/shared';
import { Button, Checkbox, ConfirmDialog, Dialog, Field, FormAlert, Input, SavedViewsMenu, toast, type MenuAction, type SavedViewRow } from '@djaber/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOffline } from '@/features/orders/offline';
import { errorCode, errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { listQueryString, type ListSpec, type ListState } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import type { ListController } from '@/lib/use-list-state';
import { useSavedViewMutations, useSavedViews } from './api';
import { copyName, isCurrentView, isPristine, stateFromView, viewFromState } from './logic';

type NameDialog = { mode: 'create' } | { mode: 'rename'; view: SavedViewDto } | null;

export function SavedViews({ page, list, spec, columnKeys }: { page: SavedViewPage; list: ListController; spec: ListSpec; columnKeys?: readonly string[] }) {
  const t = useT();
  const { can, readOnly: readOnlyMember } = useSession();
  const offline = useOffline();
  const views = useSavedViews(page);
  const m = useSavedViewMutations(page);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [dialog, setDialog] = useState<NameDialog>(null);
  const [deleting, setDeleting] = useState<SavedViewDto | null>(null);

  /** Writes the view's state in the URL (replacing the list params, dropping `view`). */
  const apply = (view: SavedViewDto, current: ListState = list.state) => {
    const next = stateFromView(spec, view, { columnKeys, current });
    const rest = [...params.entries()].filter(([k]) => k !== 'view');
    const qs = listQueryString(spec, next, rest);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // `?view=<id>` on arrival, else the default view on a clean URL — once per visit of the list
  const opened = useRef(false);
  const viewParam = params.get('view');
  useEffect(() => {
    if (opened.current || !views.data) return;
    opened.current = true;
    if (viewParam) {
      const v = views.data.find((x) => x.id === viewParam);
      if (v) apply(v);
      else {
        toast({ tone: 'danger', message: t('error.NOT_FOUND') });
        const rest = new URLSearchParams([...params.entries()].filter(([k]) => k !== 'view'));
        router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
      }
      return;
    }
    const def = views.data.find((x) => x.isDefault && !x.readOnly);
    if (def && isPristine(spec, params)) apply(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the views arrive
  }, [views.data]);

  const rows: SavedViewRow[] = useMemo(
    () =>
      (views.data ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        isDefault: v.isDefault,
        isShared: v.isShared,
        readOnly: v.readOnly,
        current: isCurrentView(spec, list.state, v),
        meta: v.readOnly && v.sharedBy ? t('savedViews.sharedBy', { name: v.sharedBy.name }) : undefined,
      })),
    [views.data, spec, list.state, t],
  );
  const byId = (id: string) => views.data?.find((v) => v.id === id);
  const offlineReason = offline ? t('banner.offline') : undefined;
  const writeReason = offlineReason ?? (readOnlyMember ? t('error.READ_ONLY_MEMBER') : undefined);
  const lockedReason = t('error.SAVED_VIEW_SHARED_READONLY');

  const fail = (e: unknown) => toast({ tone: 'danger', message: errorMessage(e, t) });
  const duplicate = (v: SavedViewDto) =>
    m.create.mutate(
      { page, name: copyName(v.name, (views.data ?? []).filter((x) => !x.readOnly).map((x) => x.name), (n) => (n === 1 ? t('savedViews.copy') : t('savedViews.copyN', { n }))), filters: v.filters, sort: v.sort, columns: v.columns, density: v.density },
      { onSuccess: (created) => toast(t('savedViews.toast.duplicated', { name: created.name })), onError: fail },
    );

  const rowActions = (row: SavedViewRow): MenuAction[] => {
    const v = byId(row.id);
    if (!v) return [];
    const locked = v.readOnly ? lockedReason : undefined;
    const shareReason = locked ?? (can('views.share') ? writeReason : t('savedViews.shareAdminOnly'));
    return [
      { key: 'rename', label: t('savedViews.action.rename'), onSelect: () => setDialog({ mode: 'rename', view: v }), disabledReason: locked ?? writeReason },
      {
        key: 'default',
        label: v.isDefault ? t('savedViews.action.unsetDefault') : t('savedViews.action.setDefault'),
        onSelect: () => m.update.mutate({ id: v.id, body: { isDefault: !v.isDefault } }, { onSuccess: (r) => toast(r.isDefault ? t('savedViews.toast.default', { name: r.name }) : t('savedViews.toast.noDefault')), onError: fail }),
        disabledReason: locked ?? writeReason,
      },
      {
        key: 'share',
        label: v.isShared ? t('savedViews.action.unshare') : t('savedViews.action.share'),
        onSelect: () => m.share.mutate({ id: v.id, isShared: !v.isShared }, { onSuccess: (r) => toast(r.isShared ? t('savedViews.toast.shared', { name: r.name }) : t('savedViews.toast.unshared', { name: r.name })), onError: fail }),
        disabledReason: shareReason,
      },
      { key: 'duplicate', label: t('savedViews.action.duplicate'), onSelect: () => duplicate(v), disabledReason: writeReason },
      { key: 'delete', label: t('savedViews.action.delete'), destructive: true, separated: true, onSelect: () => setDeleting(v), disabledReason: locked ?? writeReason },
    ];
  };

  return (
    <>
      <SavedViewsMenu
        views={views.data ? rows : undefined}
        loading={views.isPending}
        error={views.isError}
        onRetry={() => void views.refetch()}
        onSelect={(id) => {
          const v = byId(id);
          if (v) apply(v);
        }}
        rowActions={rowActions}
        onSaveCurrent={() => setDialog({ mode: 'create' })}
        saveDisabledReason={writeReason}
        labels={{
          trigger: t('savedViews.trigger'),
          title: t('savedViews.title'),
          saveCurrent: t('savedViews.saveCurrent'),
          empty: t('savedViews.empty'),
          note: t('savedViews.note'),
          defaultPill: t('common.default'),
          sharedPill: t('savedViews.sharedPill'),
          rowMenu: (name) => t('savedViews.rowMenu', { name }),
          loading: t('savedViews.loading'),
          error: t('savedViews.error'),
          retry: t('action.retry'),
        }}
      />
      {dialog ? <SaveViewDialog key={dialog.mode === 'rename' ? dialog.view.id : 'create'} dialog={dialog} page={page} list={list} spec={spec} columnKeys={columnKeys} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('savedViews.delete.title', { name: deleting?.name ?? '' })}
        description={deleting?.isShared ? t('savedViews.delete.shared', { count: deleting.sharedWith }) : t('savedViews.delete.description')}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        loading={m.remove.isPending}
        onConfirm={() =>
          deleting &&
          m.remove.mutate(deleting.id, {
            onSuccess: () => {
              toast(t('savedViews.toast.deleted', { name: deleting.name }));
              setDeleting(null);
            },
            onError: fail,
          })
        }
      />
    </>
  );
}

/** « Enregistrer la vue courante… » (name + « Définir par défaut ») and « Renommer… »: errors inline, input kept. */
function SaveViewDialog({ dialog, page, list, spec, columnKeys, onClose }: { dialog: Exclude<NameDialog, null>; page: SavedViewPage; list: ListController; spec: ListSpec; columnKeys?: readonly string[]; onClose: () => void }) {
  const t = useT();
  const m = useSavedViewMutations(page);
  const [name, setName] = useState(dialog.mode === 'rename' ? dialog.view.name : '');
  const [isDefault, setIsDefault] = useState(false);
  const [nameError, setNameError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const pending = m.create.isPending || m.update.isPending;
  const onError = (e: unknown) => {
    const code = errorCode(e);
    if (code === 'SAVED_VIEW_NAME_TAKEN' || code === 'VALIDATION_ERROR') setNameError(code === 'VALIDATION_ERROR' ? t('validation.length', { max: 60 }) : errorMessage(e, t));
    else setFormError(errorMessage(e, t));
  };
  const submit = () => {
    setNameError(undefined);
    setFormError(undefined);
    const trimmed = name.trim();
    if (!trimmed) return setNameError(t('validation.required'));
    if (dialog.mode === 'rename') {
      m.update.mutate({ id: dialog.view.id, body: { name: trimmed } }, { onSuccess: (r) => (toast(t('savedViews.toast.renamed', { name: r.name })), onClose()), onError });
      return;
    }
    const content = viewFromState(spec, list.state, { columnKeys, density: list.state.density });
    m.create.mutate({ page, name: trimmed, ...content, isDefault }, { onSuccess: (r) => (toast(t('savedViews.toast.saved', { name: r.name })), onClose()), onError });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={dialog.mode === 'rename' ? t('savedViews.rename.title') : t('savedViews.save.title')}
      description={dialog.mode === 'create' ? t('savedViews.save.description') : undefined}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} data-testid="saved-view-submit">
            {t('action.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <Field label={t('savedViews.save.name')} htmlFor="saved-view-name" error={nameError} required>
          <Input id="saved-view-name" value={name} maxLength={60} autoFocus aria-invalid={!!nameError || undefined} onChange={(e) => setName(e.target.value)} placeholder={t('savedViews.save.placeholder')} />
        </Field>
        {dialog.mode === 'create' ? (
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            {t('savedViews.save.default')}
          </label>
        ) : null}
      </form>
    </Dialog>
  );
}
