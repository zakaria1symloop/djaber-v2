'use client';
// Client dialogs — Figma "DLG — Orders, delivery & clients II — dialogs catalogue" (Nouveau client, Supprimer le client,
// Tags) and "DLG — Orders & delivery — dialogs catalogue" (Fusionner les clients). Server errors render inside the open
// dialog and the typed content is kept (AT-UX-04).
import { CreateClientSchema, formatNumber, UpdateClientSchema } from '@djaber/shared';
import { Button, Checkbox, Combobox, Dialog, EmailInput, Field, FormAlert, Input, MergeCard, PhoneInput, TagToggle, Textarea, toast, type ComboOption, type TagToggleState } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { CommuneCombobox, WilayaCombobox } from '@/features/delivery/geo';
import { ApiError } from '@/lib/api';
import { errorMessage, fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { emailError, emailOrNull } from '@/lib/email';
import { formatPhoneOnBlur, phonePreviewLine, searchTerm } from '@/lib/phone';
import { clientsApi, useClientsRefresh, useClientTags, type BulkResponse } from './api';
import { ClientTagInput } from './client-tag-input';
import { CLIENT_TAG_MAX_CHARS, type Client, type ClientListItem, type ClientMergePreview } from './contracts';

const errText = (e: unknown, t: ReturnType<typeof useT>) => (e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));

/** Id of the client that owns the phone, from `409 CLIENT_PHONE_EXISTS` (`details.clientId` / `details.client.id`). */
export const phoneOwnerId = (e: unknown): string | null => {
  if (!(e instanceof ApiError) || e.code !== 'CLIENT_PHONE_EXISTS') return null;
  const d = (e.body.details ?? {}) as { clientId?: string; client?: { id?: string }; id?: string };
  const p = e.body.params as { clientId?: string };
  return d.clientId ?? d.client?.id ?? d.id ?? (typeof p.clientId === 'string' ? p.clientId : null);
};

/* ---------- Nouveau client / Modifier / Compléter la fiche ---------- */
type FormState = { name: string; phone: string; phone2: string; email: string; tags: string[]; wilayaId: number | null; communeId: number | null; address: string; notes: string };
const blank: FormState = { name: '', phone: '', phone2: '', email: '', tags: [], wilayaId: null, communeId: null, address: '', notes: '' };
const fromClient = (c: Client): FormState => {
  const a = c.addresses.find((x) => x.isDefault) ?? c.addresses[0];
  // « Compléter la fiche »: what is known is kept (a name the AI collected); only the generic « FB User ·123456 » is cleared
  return { name: c.isPlaceholder && /^(FB|IG) User ·/.test(c.name) ? '' : c.name, phone: c.phone ?? '', phone2: c.phone2 ?? '', email: c.email ?? '', tags: c.tags, wilayaId: a?.wilayaId ?? null, communeId: a?.communeId ?? null, address: a?.address ?? '', notes: c.notes ?? '' };
};
const FIELDS = ['name', 'phone', 'phone2', 'email', 'tags', 'notes', 'address', 'wilayaId', 'communeId'] as const;

export function ClientFormDialog({ open, client, onClose, onSaved, onUseExisting }: { open: boolean; client?: Client | null; onClose: () => void; onSaved: (c: Client) => void; onUseExisting: (clientId: string) => void }) {
  const t = useT();
  const refresh = useClientsRefresh();
  const edit = !!client;
  const [v, setV] = useState<FormState>(blank);
  const [errors, setErrors] = useState<Partial<Record<(typeof FIELDS)[number], string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [owner, setOwner] = useState<{ id: string; message: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    setV(client ? fromClient(client) : blank);
    setErrors({});
    setFormError(null);
    setOwner(null);
  }, [open, client]);
  const set = <K extends keyof FormState>(k: K, value: FormState[K]) => {
    setV((s) => ({ ...s, [k]: value }));
    // a field being corrected loses its error; it is checked again on blur / submit
    setErrors((e) => (e[k as (typeof FIELDS)[number]] ? { ...e, [k]: undefined } : e));
    if (k === 'phone') setOwner(null);
  };

  const address = v.wilayaId ? { wilayaId: v.wilayaId, communeId: v.communeId, address: v.address.trim() || null, isStopdesk: false } : null;
  const body = { name: v.name, phone: v.phone, phone2: v.phone2.trim() || null, email: emailOrNull(v.email), notes: v.notes || null, tags: v.tags };
  const save = useMutation({
    mutationFn: async () => {
      if (edit) return clientsApi.update(client!.id, { ...body, defaultAddress: address });
      return clientsApi.create({ ...body, address } as never);
    },
  });
  const submit = async () => {
    setFormError(null);
    setOwner(null);
    // same rules as the API (shared schema), shown inline before any request
    const parsed = edit ? UpdateClientSchema.safeParse({ ...body, defaultAddress: address }) : CreateClientSchema.safeParse({ ...body, address });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const i of parsed.error.issues) {
        const path = i.path.filter((p) => p !== 'address' && p !== 'defaultAddress');
        const key = (path[path.length - 1] ?? i.path[0]) as (typeof FIELDS)[number];
        if (FIELDS.includes(key) && !next[key]) next[key] = i.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      const saved = await save.mutateAsync();
      await refresh({ clientId: saved.id });
      toast(edit ? t('clients.toast.saved', { name: saved.name }) : t('clients.toast.created', { name: saved.name }));
      onSaved(saved);
    } catch (e) {
      const id = phoneOwnerId(e);
      if (id && id !== client?.id) return setOwner({ id, message: errorMessage(e, t) });
      if (e instanceof ApiError && Object.keys(e.body.fields).length) {
        const next: typeof errors = {};
        for (const [f, key] of Object.entries(e.body.fields)) {
          const k = f.split('.').pop() as (typeof FIELDS)[number];
          if (FIELDS.includes(k)) next[k] = key;
        }
        setErrors(next);
        if (Object.keys(next).length === Object.keys(e.body.fields).length) return;
      }
      setFormError(errText(e, t));
    }
  };
  const fe = (k: (typeof FIELDS)[number]) => fieldError(t, errors[k]);
  const title = !edit ? t('dialog.newClient.title') : client?.isPlaceholder ? t('clients.dialog.complete.title') : t('clients.dialog.edit.title', { name: client!.name });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={title}
      description={edit ? (client?.isPlaceholder ? t('clients.dialog.complete.context', { name: client.name }) : t('clients.dialog.edit.context')) : t('clients.dialog.new.context')}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        <>
          <span className="me-auto ts-label-micro text-text-muted">{t('clients.dialog.new.note')}</span>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={save.isPending} data-testid="client-save">
            {edit ? t('action.save') : t('action.create')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        aria-busy={save.isPending || undefined}
      >
        <fieldset disabled={save.isPending} className="contents">
          <Field label={t('common.name')} htmlFor="client-name" required error={fe('name')}>
            <Input id="client-name" value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name || undefined} autoComplete="off" />
          </Field>
          <Field label={t('common.phone')} htmlFor="client-phone" required error={fe('phone')}>
            <PhoneInput id="client-phone" value={v.phone} format={formatPhoneOnBlur} onChange={(e) => set('phone', e.target.value)} aria-invalid={!!errors.phone || !!owner || undefined} preview={owner ? null : phonePreviewLine(t, v.phone)} />
            {owner ? (
              <p role="alert" className="flex flex-wrap items-center gap-2 text-[12px] text-accent-alert" data-testid="phone-conflict">
                {owner.message}
                <button type="button" className="underline hover:text-text-primary" onClick={() => onUseExisting(owner.id)}>
                  {t('clients.dialog.useExisting')}
                </button>
              </p>
            ) : null}
          </Field>
          <Field label={t('common.email')} htmlFor="client-email" error={fe('email')}>
            <EmailInput
              id="client-email"
              value={v.email}
              onChange={(e) => set('email', e.target.value)}
              // trimmed + lower-cased by the field, then checked with the API rule (shared `email`)
              onBlur={(e) => {
                const key = emailError(e.currentTarget.value);
                setErrors((x) => ({ ...x, email: key ?? undefined }));
              }}
              aria-invalid={!!errors.email || undefined}
              data-testid="client-email"
            />
          </Field>
          <Field label={t('common.tags')} htmlFor="client-tags" error={fe('tags')}>
            <ClientTagInput id="client-tags" value={v.tags} onChange={(x) => set('tags', x)} invalid={!!errors.tags} />
          </Field>
          <Field label={t('common.wilaya')} htmlFor="client-wilaya" error={fe('wilayaId')}>
            <WilayaCombobox id="client-wilaya" value={v.wilayaId} onChange={(id) => setV((s) => ({ ...s, wilayaId: id, communeId: null }))} clearable invalid={!!errors.wilayaId} />
          </Field>
          <Field label={t('common.commune')} htmlFor="client-commune" error={fe('communeId')}>
            <CommuneCombobox id="client-commune" wilayaId={v.wilayaId} value={v.communeId} onChange={(id) => set('communeId', id)} invalid={!!errors.communeId} />
          </Field>
          <Field label={t('common.address')} htmlFor="client-address" error={fe('address')} className="sm:col-span-2">
            <Input id="client-address" value={v.address} onChange={(e) => set('address', e.target.value)} disabled={!v.wilayaId} aria-invalid={!!errors.address || undefined} placeholder={t('clients.dialog.addressPlaceholder')} />
          </Field>
          <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
            <Checkbox checked={!!v.wilayaId} disabled readOnly />
            {t('clients.dialog.defaultAddress')}
          </label>
          <Field label={t('clients.dialog.notes')} htmlFor="client-notes" error={fe('notes')} className="sm:col-span-2">
            <Textarea id="client-notes" value={v.notes} onChange={(e) => set('notes', e.target.value)} className="min-h-16" />
          </Field>
        </fieldset>
      </form>
      {formError ? <FormAlert className="mt-3">{formError}</FormAlert> : null}
    </Dialog>
  );
}

/* ---------- Supprimer le client « … » ? (soft; with orders ⇒ CUSTOMER_HAS_ORDERS → Archiver) ---------- */
export function DeleteClientDialog({ client, onClose, onDone }: { client: Pick<ClientListItem, 'id' | 'name' | 'orderCount' | 'blocked'> & { conversations?: number } | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const refresh = useClientsRefresh();
  const [error, setError] = useState<string | null>(null);
  const [archive, setArchive] = useState(false);
  useEffect(() => {
    setError(null);
    setArchive(false);
  }, [client?.id]);
  const m = useMutation({ mutationFn: (o: { archive: boolean }) => clientsApi.remove(client!.id, o) });
  const run = async () => {
    setError(null);
    try {
      await m.mutateAsync({ archive });
      await refresh({ clientId: client!.id });
      toast(archive ? t('clients.toast.archived', { name: client!.name }) : t('clients.toast.deleted', { name: client!.name }));
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CUSTOMER_HAS_ORDERS') setArchive(true);
      setError(errText(e, t));
    }
  };
  const context = client ? [t('clients.dialog.delete.orders', { count: client.orderCount }), client.conversations !== undefined ? t('clients.dialog.delete.conversations', { count: client.conversations }) : null, client.blocked ? t('enum.Client.blocked').toLowerCase() : null].filter(Boolean).join(' · ') : undefined;
  return (
    <Dialog
      open={!!client}
      onOpenChange={(o) => !o && !m.isPending && onClose()}
      title={client ? t('dialog.deleteClient.title', { name: client.name }) : ''}
      description={context}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            {t('action.cancel')}
          </Button>
          <Button variant={archive ? 'primary' : 'danger'} onClick={() => void run()} loading={m.isPending} data-testid="client-delete-confirm">
            {archive ? t('action.archive') : t('action.delete')}
          </Button>
        </>
      }
    >
      <p className="ts-label-meta text-text-muted">{t('clients.dialog.delete.body')}</p>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}

/* ---------- Fusionner les clients (409 CUSTOMER_MERGE_IRREVERSIBLE preview → confirm) ---------- */
export function MergeClientsDialog({ client, onClose, onDone }: { client: Pick<ClientListItem, 'id' | 'name' | 'phone' | 'orderCount' | 'isPlaceholder' | 'riskLevel'> | null; onClose: () => void; onDone: (keptId: string) => void }) {
  const t = useT();
  const refresh = useClientsRefresh();
  const [q, setQ] = useState('');
  const [other, setOther] = useState<ClientListItem | null>(null);
  const [options, setOptions] = useState<ClientListItem[]>([]);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ClientMergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setQ('');
    setOther(null);
    setOptions([]);
    setKeepId(null);
    setPreview(null);
    setError(null);
  }, [client?.id]);
  useEffect(() => {
    if (!client || q.trim().length < 2) return setOptions([]);
    let live = true;
    const id = window.setTimeout(() => {
      void clientsApi
        .clients({ q: searchTerm(q), pageSize: 25 })
        .then((r) => live && setOptions(r.rows.filter((x) => x.id !== client.id)))
        .catch(() => live && setOptions([]));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [q, client]);
  const comboOptions: ComboOption[] = useMemo(() => options.map((o) => ({ value: o.id, label: o.name, hint: o.phone ?? t('clients.noPhone') })), [options, t]);
  const pick = (id: string | null) => {
    const o = options.find((x) => x.id === id) ?? null;
    setOther(o);
    setPreview(null);
    setError(null);
    // default: the complete record is kept (a placeholder "FB User …" is merged into the real client)
    if (o && client) setKeepId(client.isPlaceholder && !o.isPlaceholder ? o.id : !client.isPlaceholder && o.isPlaceholder ? client.id : o.orderCount > client.orderCount ? o.id : client.id);
  };
  const m = useMutation({ mutationFn: (confirm: boolean) => clientsApi.merge({ keepId: keepId!, mergeId: keepId === client!.id ? other!.id : client!.id, confirm }) });
  const run = async () => {
    setError(null);
    try {
      const kept = await m.mutateAsync(!!preview);
      await refresh({ clientId: kept.id });
      toast(t('clients.toast.merged', { name: kept.name }));
      onDone(kept.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CUSTOMER_MERGE_IRREVERSIBLE') {
        const d = e.body.details as ClientMergePreview | null;
        setPreview(d && d.keep ? d : { keep: { id: keepId!, name: '', phone: null, riskLevel: 'normal', isPlaceholder: false, blocked: false, orderCount: 0, conversations: 0 }, merge: { id: '', name: '', phone: null, riskLevel: 'normal', isPlaceholder: false, blocked: false, orderCount: 0, conversations: 0 } });
        return;
      }
      setError(errText(e, t));
    }
  };
  const card = (c: { id: string; name: string; phone: string | null; orderCount: number; isPlaceholder: boolean; riskLevel: string }, conversations?: number) => (
    <MergeCard
      key={c.id}
      name={c.name}
      meta={[t('clients.dialog.merge.orders', { count: c.orderCount }), conversations !== undefined ? t('clients.dialog.merge.conversations', { count: conversations }) : null, c.isPlaceholder ? t('enum.Client.placeholder').toLowerCase() : c.phone, c.riskLevel === 'high' ? t('enum.Client.riskLevel.high').toLowerCase() : null].filter(Boolean).join(' · ')}
      badge={keepId === c.id ? t('clients.dialog.merge.kept') : t('clients.dialog.merge.merged')}
      kept={keepId === c.id}
      onSelect={preview ? undefined : () => setKeepId(c.id)}
      selectLabel={t('clients.dialog.merge.keep')}
    />
  );
  const convOf = (id: string) => (preview ? (preview.keep.id === id ? preview.keep.conversations : preview.merge.id === id ? preview.merge.conversations : undefined) : undefined);
  return (
    <Dialog
      open={!!client}
      onOpenChange={(o) => !o && !m.isPending && onClose()}
      title={t('dialog.mergeClients.title')}
      description={client ? (other ? t('clients.dialog.merge.context', { a: client.name, b: other.name }) : t('clients.dialog.merge.pick', { name: client.name })) : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            {t('action.cancel')}
          </Button>
          <Button variant={preview ? 'danger' : 'primary'} onClick={() => void run()} loading={m.isPending} disabled={!other || !keepId} data-testid="merge-submit">
            {preview ? t('clients.dialog.merge.confirm') : t('action.merge')}
          </Button>
        </>
      }
    >
      {client ? (
        <div className="flex flex-col gap-3">
          {!preview ? (
            <Field label={t('clients.dialog.merge.with')} htmlFor="merge-with">
              <Combobox id="merge-with" value={other?.id ?? null} onChange={pick} options={comboOptions} onSearch={setQ} placeholder={t('clients.dialog.merge.search')} searchPlaceholder={t('clients.list.search')} emptyLabel={q.trim().length < 2 ? t('clients.dialog.merge.typeMore') : t('geo.empty')} />
            </Field>
          ) : null}
          {other ? (
            <div role="radiogroup" aria-label={t('clients.dialog.merge.keep')} className="flex flex-col gap-2 sm:flex-row">
              {card(client, convOf(client.id))}
              {card(other, convOf(other.id))}
            </div>
          ) : null}
          <p className="ts-label-meta text-text-muted">{t('clients.dialog.merge.note')}</p>
          {preview ? (
            <FormAlert tone="warning">
              {t('error.CUSTOMER_MERGE_IRREVERSIBLE')} (CUSTOMER_MERGE_IRREVERSIBLE)
            </FormAlert>
          ) : null}
          {error ? <FormAlert>{error}</FormAlert> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/* ---------- Tags (bulk add / remove; also the row "Étiquettes" with one id) ---------- */
export function TagsDialog({ ids, known, onClose, onDone }: { ids: string[] | null; known: string[]; onClose: () => void; onDone: (r: BulkResponse, retry: (ids: string[]) => Promise<BulkResponse>) => void }) {
  const t = useT();
  const refresh = useClientsRefresh();
  const [states, setStates] = useState<Record<string, TagToggleState>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setStates({});
    setExtra([]);
    setDraft('');
    setError(null);
  }, [ids]);
  // the tags of the selected rows + the 30 most used tags of the workspace (`GET /clients/tags`)
  const workspaceTags = useClientTags('', !!ids);
  const tags = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of [...known, ...(workspaceTags.data ?? []).slice(0, 30).map((w) => w.tag), ...extra]) {
      if (seen.has(x.toLowerCase())) continue;
      seen.add(x.toLowerCase());
      out.push(x);
    }
    return out;
  }, [known, extra, workspaceTags.data]);
  const add = tags.filter((x) => states[x] === 'add');
  const remove = tags.filter((x) => states[x] === 'remove');
  const m = useMutation({ mutationFn: () => clientsApi.bulkTags({ ids: ids!, add, remove }) });
  const run = async () => {
    setError(null);
    try {
      const r = await m.mutateAsync();
      await refresh();
      onDone(r, (retryIds) => clientsApi.bulkTags({ ids: retryIds, add, remove }));
    } catch (e) {
      setError(errText(e, t));
    }
  };
  const newTag = () => {
    const tag = draft.trim().slice(0, CLIENT_TAG_MAX_CHARS);
    if (!tag) return;
    if (!tags.some((x) => x.toLowerCase() === tag.toLowerCase())) setExtra((x) => [...x, tag]);
    setStates((s) => ({ ...s, [tags.find((x) => x.toLowerCase() === tag.toLowerCase()) ?? tag]: 'add' }));
    setDraft('');
  };
  const count = ids?.length ?? 0;
  return (
    <Dialog
      open={!!ids}
      onOpenChange={(o) => !o && !m.isPending && onClose()}
      title={t('clients.dialog.tags.title')}
      description={t('clients.dialog.tags.context', { count: formatNumber(count) })}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void run()} loading={m.isPending} disabled={!add.length && !remove.length} data-testid="tags-apply">
            {t('action.applyCount', { count })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('common.tags')}>
          {tags.map((x) => (
            <TagToggle key={x} tag={x} state={states[x] ?? 'unchanged'} onChange={(s) => setStates((m2) => ({ ...m2, [x]: s }))} labels={{ unchanged: t('clients.dialog.tags.unchanged'), add: t('clients.dialog.tags.add'), remove: t('clients.dialog.tags.remove') }} />
          ))}
          {!tags.length ? <span className="ts-label-meta text-text-muted">{t('clients.filter.noTags')}</span> : null}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            newTag();
          }}
        >
          <Input aria-label={t('clients.dialog.tags.new')} placeholder={t('clients.dialog.tags.new')} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={CLIENT_TAG_MAX_CHARS} className="!h-9 max-w-56 text-[13px]" />
          <Button type="submit" size="sm" disabled={!draft.trim()}>
            {t('action.add')}
          </Button>
        </form>
        <p className="ts-label-meta text-text-muted">{t('clients.dialog.tags.note')}</p>
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
