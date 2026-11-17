'use client';
// "1 · CLIENTE" of the new order form (Figma ORD-02 "client conflict"): find a client by name or phone fragment, pick
// one ("UTILISER"), or create one inline. A typed phone that already belongs to a client shows the notice and the
// "Utiliser ce client" action (CLI-02: the server never creates a duplicate — 409 CLIENT_PHONE_EXISTS).
import { formatPhoneDz, normalizePhoneDz } from '@djaber/shared';
import { Banner, Button, ClientResultRow, Field, focusSoon, Input, Ltr, OrderFormCard, PhoneInput, PickerSearch, StatusPill } from '@djaber/ui';
import { useId, useMemo, useState } from 'react';
import type { ClientListItem } from '@/features/clients/contracts';
import { fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { formatPhoneOnBlur, looksLikePhone, phonePreview, phonePreviewLine } from '@/lib/phone';
import { useArchivedOwnerSearch, useClientSearch } from './api';
import { validPhone, type FormClient, type FormErrors } from './model';

/** The client of the list whose phone is exactly the typed one (normalised). */
export const exactPhoneMatch = (rows: readonly ClientListItem[] | undefined, phone: string): ClientListItem | null => {
  const p = phonePreview(phone);
  if (!p?.valid) return null;
  return rows?.find((r) => r.phone === p.normalized || r.phone2 === p.normalized) ?? null;
};

export function ClientSection({
  client,
  onChange,
  onPick,
  errors,
  locked,
  conflict,
  onUseConflict,
}: {
  client: FormClient;
  onChange: (next: FormClient) => void;
  /** a client of the workspace was chosen (the parent loads its card and default address) */
  onPick: (c: ClientListItem) => void;
  errors: FormErrors;
  locked: boolean;
  /** 409 CLIENT_PHONE_EXISTS of the last save: the existing client */
  conflict: { id: string | null; name: string } | null;
  onUseConflict: () => void;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const search = useClientSearch(q);
  const rows = useMemo(() => search.data ?? [], [search.data]);
  const open = q.trim().length >= 2 && !locked;
  // a phone typed in the "new client" fields: is it already someone's?
  const typed = !client.id && validPhone(client.phone) ? normalizePhoneDz(client.phone.trim()) : '';
  const typedSearch = useClientSearch(typed);
  const activeOwner = typed ? exactPhoneMatch(typedSearch.data, typed) : null;
  // journey J09-10: an archived card holding the phone gets the same notice (the order restores it)
  const archivedSearch = useArchivedOwnerSearch(typed && typedSearch.isSuccess && !activeOwner ? typed : '');
  const archivedOwner = typed && !activeOwner ? exactPhoneMatch(archivedSearch.data, typed) : null;
  const owner = activeOwner ?? archivedOwner;
  const matchInResults = exactPhoneMatch(rows, q);

  const meta = (r: ClientListItem) =>
    [
      r.phone ? formatPhoneDz(r.phone) : t('orderForm.client.noPhone'),
      t('orderForm.client.orders', { count: r.orderCount }),
      r.isPlaceholder ? t('orderForm.client.incomplete') : r.pill === 'reliable' ? t('orderForm.client.loyal') : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const pick = (r: ClientListItem) => {
    setQ('');
    onPick(r);
    // journey J14-3: the focus follows the field that replaces the search (the picked card)
    focusSoon('[data-testid="change-client"]');
  };
  const createNew = () => {
    const text = q.trim();
    setQ('');
    onChange({
      id: null,
      name: looksLikePhone(text) ? client.name : text,
      phone: looksLikePhone(text) ? text : client.phone,
      phone2: '',
    });
    window.setTimeout(() => document.getElementById(looksLikePhone(text) ? 'client-name' : 'client-phone')?.focus(), 30);
  };
  // the list shows 6 clients + « Créer » (the keys walk what is shown)
  const shown = rows.slice(0, 6);
  const options = shown.length + 1;
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active < shown.length) pick(shown[active]!);
      else createNew();
    } else if (e.key === 'Escape') setQ('');
  };
  // journeys J14-2 / J14-3: an ARIA combobox — the results are options of the field (`aria-activedescendant`), not Tab stops
  const listId = useId();
  const optionProps = (i: number) => ({ id: `${listId}-${i}`, role: 'option' as const, 'aria-selected': i === active, tabIndex: -1, onMouseDown: (e: React.MouseEvent) => e.preventDefault() });
  const err = (k: 'client.name' | 'client.phone') =>
    errors[k] ? fieldError(t, t.has(errors[k]!.key) ? errors[k]!.key : errors[k]!.key, errors[k]!.params as Record<string, string | number>) : undefined;
  const conflictName = conflict?.name ?? owner?.name ?? null;

  const phoneFixed = !!client.id && client.hasPhone !== false;
  return (
    <OrderFormCard index={1} title={t('orderForm.client.title')} badge={t('orderForm.client.badge')} data-section="client">
      {client.id ? (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-line-edge bg-ink-raised px-3 py-2.5" data-testid="picked-client">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[14px] font-medium">{client.name}</span>
              {client.riskLevel === 'high' ? (
                <StatusPill enumKey="Client.riskLevel" value="high" className="rounded-[4px]">
                  {t('enum.Client.riskLevel.high')}
                </StatusPill>
              ) : null}
              {client.blocked ? (
                <StatusPill enumKey="Client.riskLevel" value="high" className="rounded-[4px]">
                  {t('enum.Client.blocked')}
                </StatusPill>
              ) : null}
              {client.isPlaceholder ? (
                <StatusPill enumKey="Client.quality" value="placeholder" className="rounded-[4px]">
                  {t('enum.Client.placeholder')}
                </StatusPill>
              ) : null}
            </div>
            <div className="ts-label-micro text-text-muted">
              {client.phone ? <Ltr>{formatPhoneDz(client.phone)}</Ltr> : t('orderForm.client.noPhone')}
              {client.orderCount !== undefined ? ` · ${t('orderForm.client.orders', { count: client.orderCount })}` : null}
            </div>
          </div>
          {locked ? null : (
            <Button size="sm" variant="ghost" onClick={() => (onChange({ id: null, name: '', phone: '', phone2: '' }), focusSoon('#client-search'))} data-testid="change-client">
              {t('orderForm.client.change')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <PickerSearch
            id="client-search"
            value={q}
            onChange={(v) => (setQ(v), setActive(0))}
            onKeyDown={onKeyDown}
            placeholder={t('orderForm.client.search')}
            label={t('orderForm.client.search')}
            active={open}
            disabled={locked}
            combobox={{ listId, expanded: open, activeId: open ? `${listId}-${active}` : undefined }}
          />
          {open ? (
            <ul id={listId} role="listbox" aria-label={t('orderForm.client.results')} className="divide-y divide-line-hairline overflow-hidden rounded-card border border-line-edge bg-ink-surface" data-testid="client-results">
              {search.isPending ? <li role="option" aria-disabled="true" aria-selected={false} className="px-3 py-2.5 text-[13px] text-text-muted">{t('common.loading')}</li> : null}
              {shown.map((r, i) => (
                <ClientResultRow
                  key={r.id}
                  name={r.name}
                  muted={r.isPlaceholder}
                  meta={meta(r)}
                  highlighted={i === active}
                  optionProps={optionProps(i)}
                  onSelect={() => pick(r)}
                  badge={
                    r.id === matchInResults?.id ? (
                      <span className="rounded-[4px] border border-accent-money/50 px-2 py-0.5 ts-label-micro text-accent-money">{t('orderForm.client.use')}</span>
                    ) : r.riskLevel === 'high' ? (
                      <StatusPill enumKey="Client.riskLevel" value="high" className="rounded-[4px]">
                        {t('enum.Client.riskLevel.high')}
                      </StatusPill>
                    ) : undefined
                  }
                />
              ))}
              <li role="none">
                <button
                  type="button"
                  {...optionProps(shown.length)}
                  onClick={createNew}
                  className={`w-full px-3 py-2.5 text-start text-[13px] text-accent-inbound hover:bg-ink-raised ${active === shown.length ? 'bg-ink-raised' : ''}`}
                  data-testid="client-create"
                >
                  {t('orderForm.client.create', { q: q.trim() })}
                </button>
              </li>
            </ul>
          ) : null}
          {matchInResults && open ? (
            <Banner tone="info">
              <span data-testid="phone-conflict">{t('orderForm.client.conflict', { name: matchInResults.name })}</span>
            </Banner>
          ) : null}
        </div>
      )}

      {!client.id && (conflictName || owner) ? (
        <Banner
          tone="info"
          action={{
            label: t('orderForm.client.useThis'),
            onClick: () => (owner ? onPick(owner) : onUseConflict()),
          }}
        >
          <span data-testid="phone-conflict">{t(archivedOwner && !conflict ? 'orderForm.client.conflictArchived' : 'orderForm.client.conflict', { name: conflictName ?? '' })}</span>
        </Banner>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('orderForm.client.name')} htmlFor="client-name" required error={client.id ? undefined : err('client.name')}>
          <Input
            id="client-name"
            dir="auto"
            maxLength={80}
            autoComplete="off"
            disabled={locked || !!client.id}
            aria-invalid={!client.id && !!errors['client.name']}
            value={client.name}
            onChange={(e) => onChange({ ...client, name: e.target.value })}
          />
        </Field>
        {/* a picked client without a phone (« À compléter », often created by the AI) gives it here: no order without a
            phone, and the client's record is completed with it (tester report 2026-10-20) */}
        <Field
          label={t('orderForm.client.phone')}
          htmlFor="client-phone"
          required
          error={phoneFixed ? undefined : err('client.phone')}
          hint={client.id && !phoneFixed ? t('orderForm.client.completePhone') : undefined}
        >
          <PhoneInput
            id="client-phone"
            maxLength={20}
            disabled={locked || phoneFixed}
            aria-invalid={!phoneFixed && !!errors['client.phone']}
            value={phoneFixed ? formatPhoneDz(client.phone) : client.phone}
            format={phoneFixed ? undefined : formatPhoneOnBlur}
            onChange={(e) => onChange({ ...client, phone: e.target.value })}
            preview={phoneFixed ? null : phonePreviewLine(t, client.phone)}
          />
        </Field>
      </div>
      {client.id && client.orderCount !== undefined && client.orderCount > 0 ? (
        <p className="ts-label-meta text-text-muted">{t('orderForm.client.known', { count: client.orderCount })}</p>
      ) : null}
    </OrderFormCard>
  );
}
