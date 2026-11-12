'use client';
// "Nouvelle unité" / edit of a custom unit — Figma "DLG — GDS (stock) — dialogs catalogue": NOM *, ABRÉVIATION *,
// CONTIENT (`containsQty` × `baseUnitId`, conversion for bulk purchases). System units are read-only.
import { CreateUnitSchema, UpdateUnitSchema } from '@djaber/shared';
import { Button, Dialog, Field, FormAlert, Input, NumberInput, Select, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { applyServerErrors, fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { digitsToInt } from '@/lib/money';
import { catalogApi, useCatalogRefresh } from '../api';
import type { Unit } from '../contracts';
import { unitLabel } from './logic';

type Values = { name: string; abbreviation: string; containsQty: string; baseUnitId: string };
const FIELDS = ['name', 'abbreviation', 'containsQty', 'baseUnitId'] as const;

export function UnitDialog({ unit, units, onClose }: { /** null = new unit */ unit: Unit | null; units: readonly Unit[]; onClose: () => void }) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const form = useForm<Values>({
    defaultValues: { name: unit?.name ?? '', abbreviation: unit?.abbreviation ?? '', containsQty: unit?.containsQty ? String(unit.containsQty) : '', baseUnitId: unit?.baseUnitId ?? '' },
  });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (b: ReturnType<typeof CreateUnitSchema.parse>) => (unit ? catalogApi.updateUnit(unit.id, UpdateUnitSchema.parse(b)) : catalogApi.createUnit(b)),
  });
  const busy = save.isPending;
  const errors = form.formState.errors;
  const bases = units.filter((u) => u.id !== unit?.id);

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const qty = digitsToInt(values.containsQty);
    // a conversion needs both parts: "6 × Pièce"
    if (qty !== null && !values.baseUnitId) return form.setError('baseUnitId', { message: 'validation.required' }, { shouldFocus: true });
    if (qty === null && values.baseUnitId) return form.setError('containsQty', { message: 'validation.required' }, { shouldFocus: true });
    const parsed = CreateUnitSchema.safeParse({ name: values.name, abbreviation: values.abbreviation, containsQty: qty, baseUnitId: values.baseUnitId });
    if (!parsed.success) {
      parsed.error.issues.forEach((issue, i) => {
        const field = FIELDS.find((f) => f === issue.path[0]);
        if (field) form.setError(field, { message: issue.message }, { shouldFocus: i === 0 });
      });
      return;
    }
    try {
      const saved = await save.mutateAsync(parsed.data);
      await refresh({ taxonomies: true });
      toast(unit ? t('toast.saved') : t('units.created', { name: saved.name }));
      onClose();
    } catch (e) {
      const text = applyServerErrors(form, e, t, { fields: FIELDS });
      setFormError(text);
    }
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={unit ? t('units.editTitle', { name: unit.name }) : t('dialog.newUnit.title')}
      description={t('units.dialog.note')}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} data-testid="unit-save">
            {unit ? t('action.save') : t('action.create')}
          </Button>
        </>
      }
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Field label={t('common.name')} htmlFor="unit-name" required error={fieldError(t, errors.name?.message, { max: 50 })}>
            <Input id="unit-name" maxLength={50} disabled={busy} aria-invalid={!!errors.name} placeholder={t('units.field.namePlaceholder')} {...form.register('name')} />
          </Field>
          <Field label={t('units.field.abbreviation')} htmlFor="unit-abbreviation" required error={fieldError(t, errors.abbreviation?.message, { max: 10 })}>
            <Input id="unit-abbreviation" maxLength={10} disabled={busy} aria-invalid={!!errors.abbreviation} placeholder={t('units.field.abbreviationPlaceholder')} {...form.register('abbreviation')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Field label={t('units.field.contains')} htmlFor="unit-contains" error={fieldError(t, errors.containsQty?.message)}>
            <Controller
              control={form.control}
              name="containsQty"
              render={({ field }) => <NumberInput id="unit-contains" ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} disabled={busy} maxDigits={7} suffix="×" aria-invalid={!!errors.containsQty} />}
            />
          </Field>
          <Field label={t('units.field.baseUnit')} htmlFor="unit-base" error={fieldError(t, errors.baseUnitId?.message)}>
            <Select id="unit-base" disabled={busy} aria-invalid={!!errors.baseUnitId} {...form.register('baseUnitId')}>
              <option value="">{t('units.field.baseNone')}</option>
              {bases.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitLabel(u)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="-mt-2 ts-label-meta text-text-muted">{t('units.field.containsHint')}</p>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('action.save')}
        </button>
      </form>
    </Dialog>
  );
}
