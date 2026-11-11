'use client';
// Delete a category or a custom unit — Figma "CAT-04 — … reassign dialog" (SUPPRIMER « ACCESSOIRES » ?) and
// DLG GDS II "Supprimer la catégorie « Parfums » ?": plain confirmation when unused; `409 CATEGORY_IN_USE {count}` /
// `UNIT_IN_USE {count}` (or a count already known) ⇒ choose where the products go, sub-categories move to the root.
// UX-051 (10/11): the counts are fetched again when the dialog opens (a product changed elsewhere), « Réassigner à »
// starts on « Choisir… » (nothing preselected) and the button waits for a choice; no error code in the texts.
import { Button, Checkbox, Dialog, Field, FormAlert, Pill, Select, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { catalogApi, useCatalogRefresh } from '../api';
import type { Category, Unit } from '../contracts';
import { categoryDeleteMode, findCategory, reassignCategoryOptions, reassignUnitOptions, unitDeleteMode } from './logic';

export type DeleteTarget = { kind: 'category'; category: Category } | { kind: 'unit'; unit: Unit };

export function DeleteTaxonomyDialog({ target, tree, units, onClose }: { target: DeleteTarget; tree: readonly Category[]; units: readonly Unit[]; onClose: () => void }) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const isCategory = target.kind === 'category';
  const id = isCategory ? target.category.id : target.unit.id;
  const name = isCategory ? target.category.name : target.unit.name;
  const children = isCategory ? (target.category.children?.length ?? 0) : 0;
  const options = isCategory ? reassignCategoryOptions(tree, id) : reassignUnitOptions(units, id);
  const [mode, setMode] = useState<'confirm' | 'reassign'>(() => (isCategory ? categoryDeleteMode(target.category) : unitDeleteMode(target.unit)));
  const [count, setCount] = useState(isCategory ? (target.category.productCount ?? 0) : (target.unit.productCount ?? 0));
  // '' = not chosen yet; 'none' = « Sans catégorie »
  const [reassignTo, setReassignTo] = useState('');
  const [moveChildren, setMoveChildren] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () =>
      isCategory
        ? catalogApi.deleteCategory(id, { reassignTo: count > 0 ? reassignTo || 'none' : undefined, moveChildrenToRoot: children > 0 && moveChildren })
        : catalogApi.deleteUnit(id, { reassignTo: count > 0 ? reassignTo : undefined }),
  });
  const busy = remove.isPending;
  // fresh counts: the list may have been loaded before a product was moved into / out of this category
  useEffect(() => {
    void refresh({ taxonomies: true });
  }, [refresh]);
  const freshCount = isCategory ? findCategory(tree, id)?.productCount : units.find((u) => u.id === id)?.productCount;
  useEffect(() => {
    if (freshCount === undefined || busy) return;
    setCount(freshCount);
    if (freshCount > 0) setMode('reassign');
    else if (children === 0) setMode('confirm');
  }, [freshCount, busy, children]);
  // the API keeps a parent while its sub-categories are attached; a unit in use needs a replacement
  const blocked =
    children > 0 && !moveChildren
      ? t('categories.delete.childrenRequired')
      : mode === 'reassign' && count > 0 && !reassignTo
        ? t(isCategory ? 'categories.delete.noTarget' : 'units.delete.noTarget')
        : undefined;

  const submit = async () => {
    setError(null);
    try {
      await remove.mutateAsync();
      await refresh({ taxonomies: true });
      toast(t(isCategory ? 'categories.deleted' : 'units.deleted', { name }));
      onClose();
    } catch (e) {
      const inUse = e instanceof ApiError && (e.code === 'CATEGORY_IN_USE' || e.code === 'UNIT_IN_USE');
      if (inUse && mode === 'confirm') {
        // used since the list was loaded: the same dialog becomes the reassign dialog
        const details = (e.body.details ?? {}) as { products?: number; reason?: string };
        if (details.reason !== 'HAS_SUBCATEGORIES') setCount(Number(details.products ?? e.body.params.count ?? 1) || 1);
        setMode('reassign');
        void refresh({ taxonomies: true });
        return;
      }
      setError(errorMessage(e, t));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={isCategory ? t('dialog.deleteCategory.title', { name }) : t('units.delete.title', { name })}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy} disabledReason={blocked} data-testid="taxonomy-delete">
            {mode === 'reassign' && count > 0 ? t('categories.delete.reassignSubmit') : t('action.delete')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="delete-dialog" data-mode={mode}>
        <Pill tone="danger" className="w-fit rounded-[4px]">
          {t('common.destructive')}
        </Pill>
        {mode === 'confirm' ? (
          <p className="text-[13px] text-text-secondary">{t(isCategory ? 'categories.delete.unused' : 'units.delete.unused')}</p>
        ) : (
          <>
            {count > 0 ? (
              <>
                <p className="text-[13px] text-text-secondary">{t(isCategory ? 'categories.delete.inUse' : 'units.delete.inUse', { count })}</p>
                <Field label={t(isCategory ? 'categories.delete.reassignTo' : 'units.delete.reassignTo')} htmlFor="reassign-to">
                  <Select id="reassign-to" value={reassignTo} disabled={busy} onChange={(e) => setReassignTo(e.target.value)}>
                    <option value="" disabled>
                      {t('categories.delete.choose')}
                    </option>
                    {isCategory ? <option value="none">{t('categories.delete.none')}</option> : null}
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            ) : null}
            {children > 0 ? (
              <>
                {count === 0 ? <p className="text-[13px] text-text-secondary">{t('categories.delete.children', { count: children })}</p> : null}
                <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                  <Checkbox checked={moveChildren} disabled={busy} onChange={(e) => setMoveChildren(e.target.checked)} />
                  {t('categories.delete.moveChildren')}
                </label>
              </>
            ) : null}
          </>
        )}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
