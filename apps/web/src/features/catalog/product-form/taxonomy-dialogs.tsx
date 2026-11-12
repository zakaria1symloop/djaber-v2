'use client';
// Inline creation from the product form (Figma CAT-01 ORGANISATION: "+ Unité personnalisée"; DLG GDS "Nouvelle
// catégorie" / "Nouvelle unité", short versions): name only for a category, name + abbreviation for a unit.
// Errors stay inside the dialog (CATEGORY_ALREADY_EXISTS under the name).
import { CreateCategorySchema, CreateUnitSchema } from '@djaber/shared';
import { Button, Dialog, Field, FormAlert, Input } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { errorMessage, fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { catalogApi, catalogKeys, useCatalogRefresh } from '../api';
import type { Category, Unit } from '../contracts';

type Errors = { name?: string; abbreviation?: string; form?: string };

export function QuickCategoryDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Category) => void }) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = useCatalogRefresh();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  useEffect(() => {
    if (open) {
      setName('');
      setErrors({});
    }
  }, [open]);
  const create = useMutation({ mutationFn: catalogApi.createCategory });
  const submit = async () => {
    const parsed = CreateCategorySchema.safeParse({ name });
    if (!parsed.success) return setErrors({ name: fieldError(t, parsed.error.issues[0]?.message, { max: 80 }) });
    setErrors({});
    try {
      const created = await create.mutateAsync(parsed.data);
      // selectable at once; the refetch brings the server order
      qc.setQueryData<Category[]>(catalogKeys.categories(ws), (old) => (old && !old.some((c) => c.id === created.id) ? [...old, { ...created, children: created.children ?? [] }] : old));
      void refresh({ taxonomies: true });
      onCreated(created);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'CATEGORY_ALREADY_EXISTS' || e.body.fields?.name)) {
        return setErrors({ name: e.code === 'CATEGORY_ALREADY_EXISTS' ? errorMessage(e, t) : fieldError(t, e.body.fields.name, { max: 80 }) });
      }
      setErrors({ form: errorMessage(e, t) });
    }
  };
  const busy = create.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('dialog.newCategory.title')}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="quick-category-submit">
            {t('action.create')}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void submit();
        }}
      >
        <Field label={t('common.name')} htmlFor="quick-category-name" required error={errors.name}>
          <Input id="quick-category-name" value={name} maxLength={80} disabled={busy} aria-invalid={!!errors.name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {errors.form ? <FormAlert>{errors.form}</FormAlert> : null}
      </form>
    </Dialog>
  );
}

export function QuickUnitDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (u: Unit) => void }) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = useCatalogRefresh();
  const [name, setName] = useState('');
  const [abbreviation, setAbbreviation] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  useEffect(() => {
    if (open) {
      setName('');
      setAbbreviation('');
      setErrors({});
    }
  }, [open]);
  const create = useMutation({ mutationFn: catalogApi.createUnit });
  const submit = async () => {
    const parsed = CreateUnitSchema.safeParse({ name, abbreviation });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] === 'abbreviation' ? 'abbreviation' : 'name';
        next[k] ??= fieldError(t, issue.message, { max: k === 'name' ? 50 : 10 });
      }
      return setErrors(next);
    }
    setErrors({});
    try {
      const created = await create.mutateAsync(parsed.data);
      qc.setQueryData<Unit[]>(catalogKeys.units(ws), (old) => (old && !old.some((u) => u.id === created.id) ? [...old, created] : old));
      void refresh({ taxonomies: true });
      onCreated(created);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && (e.body.fields?.name || e.body.fields?.abbreviation)) {
        return setErrors({
          // a unit with this name already exists: the API answers `validation.invalid` on `name`
          name: e.body.fields.name ? (e.body.fields.name === 'validation.invalid' ? t('products.form.unit.exists') : fieldError(t, e.body.fields.name, { max: 50 })) : undefined,
          abbreviation: e.body.fields.abbreviation ? fieldError(t, e.body.fields.abbreviation, { max: 10 }) : undefined,
        });
      }
      setErrors({ form: errorMessage(e, t) });
    }
  };
  const busy = create.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('dialog.newUnit.title')}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="quick-unit-submit">
            {t('action.create')}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="grid grid-cols-[1fr_7rem] gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void submit();
        }}
      >
        <Field label={t('common.name')} htmlFor="quick-unit-name" required error={errors.name}>
          <Input id="quick-unit-name" value={name} maxLength={50} disabled={busy} aria-invalid={!!errors.name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('products.form.unit.abbreviation')} htmlFor="quick-unit-abbr" required error={errors.abbreviation}>
          <Input id="quick-unit-abbr" value={abbreviation} maxLength={10} disabled={busy} aria-invalid={!!errors.abbreviation} onChange={(e) => setAbbreviation(e.target.value)} />
        </Field>
        {errors.form ? <FormAlert className="col-span-2">{errors.form}</FormAlert> : null}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('action.create')}
        </button>
      </form>
    </Dialog>
  );
}
