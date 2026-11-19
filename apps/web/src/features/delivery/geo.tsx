'use client';
// Wilaya / commune / stop-desk pickers fed by `/geo/*` and `/delivery/stopdesks` (02-next-route-map §5 "Combobox
// variants: WilayaCombobox, CommuneCombobox wilayaId"). Used by the order form, the address dialog and the client form.
import { communeDisplayName } from '@djaber/shared';
import { Combobox } from '@djaber/ui';
import { useState } from 'react';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useCommunes, useGeoWilayas, useStopdesks } from './api';
import type { Commune, Wilaya } from './contracts';
import { geoFilter } from './logic';

/** "19 · Sétif" (Arabic name in the Arabic UI) */
export const wilayaLabel = (w: Pick<Wilaya, 'code' | 'nameFr' | 'nameAr'>, locale: string) => `${w.code} · ${locale === 'ar' ? w.nameAr : w.nameFr}`;
/** journey J05v-3: the display form (« Ain Sebt » like « Ain Arnat », the seat « Sétif »); the stored name is kept for search. */
export const communeLabel = (c: Pick<Commune, 'nameFr' | 'nameAr'>, locale: string, wilaya?: Pick<Wilaya, 'nameFr' | 'nameAr'> | null) =>
  communeDisplayName(locale === 'ar' ? c.nameAr || c.nameFr : c.nameFr, wilaya) ?? '';

export function WilayaCombobox({ id, value, onChange, invalid, disabled, clearable }: { id?: string; value: number | null; onChange: (id: number | null, w: Wilaya | null) => void; invalid?: boolean; disabled?: boolean; clearable?: boolean }) {
  const t = useT();
  const locale = useLocaleCode();
  const q = useGeoWilayas();
  const list = q.data ?? [];
  const [search, setSearch] = useState('');
  return (
    <Combobox
      onSearch={setSearch}
      id={id}
      value={value === null ? null : String(value)}
      onChange={(v) => {
        const w = v ? (list.find((x) => String(x.id) === v) ?? null) : null;
        onChange(w ? w.id : null, w);
      }}
      options={geoFilter(list.map((w) => ({ value: String(w.id), label: wilayaLabel(w, locale), hint: locale === 'ar' ? w.nameFr : w.nameAr })), search)}
      placeholder={t('geo.wilaya.placeholder')}
      searchPlaceholder={t('geo.wilaya.search')}
      emptyLabel={q.isPending ? t('common.loading') : t('geo.empty')}
      clearLabel={clearable ? t('geo.clear') : undefined}
      loading={q.isPending}
      invalid={invalid}
      disabled={disabled}
    />
  );
}

export function CommuneCombobox({ id, wilayaId, value, onChange, invalid, disabled }: { id?: string; wilayaId: number | null; value: number | null; onChange: (id: number | null, c: Commune | null) => void; invalid?: boolean; disabled?: boolean }) {
  const t = useT();
  const locale = useLocaleCode();
  const q = useCommunes(wilayaId);
  const list = q.data ?? [];
  const wilaya = useGeoWilayas().data?.find((w) => w.id === wilayaId) ?? null;
  const [search, setSearch] = useState('');
  // sorted by the shown name (the stored « Ain-Legradj » sorted after « Ain Oulmene »)
  const options = list.map((c) => ({ value: String(c.id), label: communeLabel(c, locale, wilaya), hint: c.postalCode ?? undefined, keywords: [c.nameFr, c.nameAr].join(' ') })).sort((a, b) => a.label.localeCompare(b.label, locale));
  return (
    <Combobox
      onSearch={setSearch}
      id={id}
      value={value === null ? null : String(value)}
      onChange={(v) => {
        const c = v ? (list.find((x) => String(x.id) === v) ?? null) : null;
        onChange(c ? c.id : null, c);
      }}
      options={geoFilter(options, search)}
      placeholder={wilayaId ? t('geo.commune.placeholder') : t('geo.commune.pickWilaya')}
      searchPlaceholder={t('geo.commune.search')}
      emptyLabel={q.isPending && wilayaId ? t('common.loading') : t('geo.empty')}
      loading={q.isPending && !!wilayaId}
      invalid={invalid}
      disabled={disabled || !wilayaId}
    />
  );
}

/** Stop-desk agencies of the commune (courier `CourierStopdesk`), of one provider when given (send dialog). */
export function StopdeskCombobox({ id, communeId, provider, value, onChange, invalid, disabled }: { id?: string; communeId: number | null; provider?: string; value: string | null; onChange: (id: string | null, name: string | null) => void; invalid?: boolean; disabled?: boolean }) {
  const t = useT();
  const q = useStopdesks(communeId, provider === 'manual' ? undefined : provider);
  const list = q.data ?? [];
  const [search, setSearch] = useState('');
  return (
    <Combobox
      onSearch={setSearch}
      id={id}
      value={value}
      onChange={(v, o) => onChange(v, o?.label ?? null)}
      options={geoFilter(list.map((s) => ({ value: s.id, label: s.name, hint: t(`couriers.provider.${s.provider}`) })), search)}
      placeholder={t('geo.stopdesk.placeholder')}
      searchPlaceholder={t('geo.stopdesk.search')}
      emptyLabel={q.isPending && communeId ? t('common.loading') : t('geo.stopdesk.empty')}
      clearLabel={t('geo.clear')}
      invalid={invalid}
      disabled={disabled || !communeId}
    />
  );
}
