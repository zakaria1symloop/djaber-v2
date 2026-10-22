'use client';
// /admin/presets — Figma "ADM-07 — Platform admin — agent presets editor" + DLG "Nouveau préréglage d'agent".
// List (V7 PUBLIÉE · BROUILLON V8 · n AGENTS, RECOMMANDÉ / PUBLIÉ / BROUILLON / ARCHIVÉ) with a row menu (Modifier ·
// Dupliquer · Aperçu · Archiver (PRESET_ARCHIVED) · Restaurer · Supprimer when never published), editor per locale
// (`?preset=<id>&locale=fr`).
import type { AgentPresetAdminDto } from '@djaber/shared';
import { ActionsMenu, Button, Card, EmptyState, Field, FrameNote, Input, ListSkeleton, MonoChip, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useConfirmAction } from '@/components/confirm-action';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { adminWrite, useAdminGet, useAdminInvalidate } from '@/features/admin/api';
import { AdminDialog, NO_ERRORS, toServerErrors, useOnOpen, type ServerErrors } from '@/features/admin/dialog-kit';
import { usePlatform } from '@/features/admin/platform';
import { PresetEditor } from '@/features/admin/presets/editor';
import { toMenuActions } from '@/lib/actions';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';

type Loc = 'fr' | 'ar' | 'en';

export default function AdminPresetsPage() {
  const t = useT();
  const locale = useLocaleCode();
  const { can } = usePlatform();
  const write = can('admin.presets.write');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const list = useAdminGet<AgentPresetAdminDto[]>('/admin/agent-presets');
  const rows = list.data ?? [];
  const selected = params.get('preset') ?? rows[0]?.id ?? null;
  const editLocale = (['fr', 'ar', 'en'].includes(params.get('locale') ?? '') ? params.get('locale') : 'fr') as Loc;
  const detail = useAdminGet<AgentPresetAdminDto>(selected ? `/admin/agent-presets/${selected}` : null);
  const invalidate = useAdminInvalidate();
  const [create, setCreate] = useState<{ copyFrom: AgentPresetAdminDto | null } | null>(null);
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  const confirm = useConfirmAction();
  const setParam = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await m.mutateAsync(fn);
      void invalidate('/admin/agent-presets');
      toast(done);
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const meta = (p: AgentPresetAdminDto) =>
    [p.status === 'archived' ? t('admin.presets.meta.archived', { version: p.currentVersion }) : p.currentVersion ? t('admin.presets.meta.published', { version: p.currentVersion }) : null, p.draftVersion ? t('admin.presets.meta.draft', { version: p.draftVersion }) : null, t('admin.presets.meta.agents', { count: p.agents })]
      .filter(Boolean)
      .join(' · ');
  const pill = (p: AgentPresetAdminDto) =>
    p.status === 'archived' ? <MonoChip tone="danger">{t('admin.presets.status.archived')}</MonoChip> : p.badge === 'recommended' && p.status === 'published' ? <MonoChip tone="success">{t('admin.presets.badge.recommended')}</MonoChip> : p.status === 'published' ? <MonoChip tone="info">{t('admin.presets.status.published')}</MonoChip> : <MonoChip>{t('admin.presets.status.draft')}</MonoChip>;
  const menu = (p: AgentPresetAdminDto) =>
    toMenuActions(
      p.actions,
      {
        edit: { label: t('admin.presets.action.edit'), onSelect: () => setParam({ preset: p.id }) },
        duplicate: { label: t('admin.presets.action.duplicate'), onSelect: () => setCreate({ copyFrom: p }), hidden: !write },
        preview: { label: t('admin.presets.action.preview'), onSelect: () => window.open(`/${locale}/agents/new`, '_blank', 'noopener') },
        archive: { label: t('admin.presets.action.archive'), onSelect: () => void act(() => adminWrite(`/admin/agent-presets/${p.id}/archive`, 'POST', {}), t('admin.presets.archived')), hidden: !write, separated: true },
        restore: { label: t('admin.presets.action.restore'), onSelect: () => void act(() => adminWrite(`/admin/agent-presets/${p.id}/restore`, 'POST', {}), t('admin.presets.restored')), hidden: !write, separated: true },
        delete: { label: t('admin.presets.action.delete'), destructive: true, onSelect: () => confirm.ask({ title: t('admin.presets.deleteConfirm.title', { name: p.key }), description: t('admin.presets.deleteConfirm.description'), confirmLabel: t('admin.presets.action.delete'), destructive: true, run: () => act(() => adminWrite(`/admin/agent-presets/${p.id}`, 'DELETE'), t('admin.presets.deleted')) }), hidden: !write },
      },
      t,
    );
  return (
    <AdminPage
      permission="admin.presets.read"
      title={t('nav.admin.presets')}
      description={t('admin.presets.description')}
      actions={
        <>
          <Button variant="ghost" onClick={() => window.open(`/${locale}/onboarding/agent`, '_blank', 'noopener')}>
            {t('admin.presets.previewOnboarding')}
          </Button>
          {write ? (
            <Button variant="primary" onClick={() => setCreate({ copyFrom: null })} data-testid="new-preset">
              {t('admin.presets.new')}
            </Button>
          ) : null}
        </>
      }
    >
      {list.isPending ? (
        <Card><ListSkeleton rows={5} columns={2} label={t('common.loading')} /></Card>
      ) : list.isError ? (
        <AdminQueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <Card className="py-6">
          <EmptyState title={t('admin.presets.empty')} action={write ? { label: t('admin.presets.new'), onClick: () => setCreate({ copyFrom: null }), variant: 'primary' } : undefined} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <ul className="flex h-fit flex-col divide-y divide-line-hairline overflow-hidden rounded-card border border-line-edge bg-ink-surface" data-testid="preset-list">
            {rows.map((p) => (
              <li key={p.id} data-preset={p.key} className={`flex items-center gap-2 px-4 py-3 ${p.id === selected ? 'bg-ink-raised' : ''}`}>
                <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setParam({ preset: p.id })} aria-current={p.id === selected ? 'true' : undefined}>
                  <span className="block truncate text-[14px]">{p.name[locale as Loc] || p.name.fr}</span>
                  <span className="block truncate ts-label-micro uppercase text-text-muted">{meta(p)}</span>
                </button>
                {pill(p)}
                {menu(p).length ? <ActionsMenu label={t('action.actions')} heading={p.name.fr} actions={menu(p)} iconOnly variant="ghost" /> : null}
              </li>
            ))}
          </ul>
          {detail.isPending ? (
            <Card><ListSkeleton rows={6} columns={2} label={t('common.loading')} /></Card>
          ) : detail.isError ? (
            <AdminQueryError error={detail.error} onRetry={() => void detail.refetch()} />
          ) : detail.data ? (
            <PresetEditor key={`${detail.data.id}:${detail.data.draftVersion ?? detail.data.currentVersion}`} preset={detail.data} locale={editLocale} onLocale={(l) => setParam({ locale: l === 'fr' ? null : l })} canWrite={write} />
          ) : null}
        </div>
      )}
      <FrameNote>{t('admin.presets.menuNote')}</FrameNote>
      <NewPresetDialog open={!!create} copyFrom={create?.copyFrom ?? null} presets={rows} onClose={() => setCreate(null)} onCreated={(id) => setParam({ preset: id })} />
      {confirm.element}
    </AdminPage>
  );
}

function NewPresetDialog({ open, copyFrom, presets, onClose, onCreated }: { open: boolean; copyFrom: AgentPresetAdminDto | null; presets: AgentPresetAdminDto[]; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const source = copyFrom ?? presets.find((p) => p.badge === 'recommended' && p.status === 'published') ?? presets.find((p) => p.status === 'published') ?? null;
  const [name, setName] = useState('');
  // AR / EN names (UX-008: French only before; a blank one falls back to French)
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [key, setKey] = useState('');
  const [from, setFrom] = useState<'copy' | 'empty'>('copy');
  const [sectors, setSectors] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (b: unknown) => adminWrite<AgentPresetAdminDto>('/admin/agent-presets', 'POST', b, true) });
  useOnOpen(open, () => {
    setName('');
    setNameAr('');
    setNameEn('');
    setKey('');
    setFrom(source ? 'copy' : 'empty');
    setSectors('');
    setErrors(NO_ERRORS);
  });
  const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      const p = await m.mutateAsync({ key: key.trim() || slugify(name), name: { fr: name.trim(), ...(nameAr.trim() ? { ar: nameAr.trim() } : {}), ...(nameEn.trim() ? { en: nameEn.trim() } : {}) }, sectors: sectors.split(/[·,]/).map((s) => s.trim()).filter(Boolean), ...(from === 'copy' && source ? { copyFromPresetId: source.id } : {}) });
      void invalidate('/admin/agent-presets');
      toast(t('admin.presets.created', { name: name.trim() }));
      onClose();
      onCreated(p.id);
    } catch (e) {
      setErrors(toServerErrors(e, t, ['key', 'name'], { CONFLICT: 'key' }));
    }
  };
  return (
    <AdminDialog open={open} onClose={onClose} testId="dlg-preset" title={t('admin.presets.dialog.title')} context={t('admin.presets.dialog.context')} submitLabel={t('admin.presets.dialog.submit')} disabled={!name.trim()} pending={m.isPending} error={errors.form} note={t('admin.presets.dialog.note')} onSubmit={() => void submit()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.presets.dialog.name')} required htmlFor="np-name" error={errors.fields.name}>
          <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('admin.presets.dialog.nameAr')} htmlFor="np-name-ar" hint={t('admin.presets.dialog.nameFallback')}>
          <Input id="np-name-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('admin.presets.dialog.nameEn')} htmlFor="np-name-en" hint={t('admin.presets.dialog.nameFallback')}>
          <Input id="np-name-en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label={t('admin.presets.dialog.key')} htmlFor="np-key" error={errors.fields.key}>
          <Input id="np-key" dir="ltr" value={key} placeholder={slugify(name)} onChange={(e) => setKey(e.target.value.toLowerCase())} />
        </Field>
      </div>
      <div role="radiogroup" aria-label={t('admin.presets.dialog.from')} className="flex flex-col gap-2.5">
        {source ? (
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px]">
            <input type="radio" name="presetFrom" checked={from === 'copy'} onChange={() => setFrom('copy')} className="size-4 accent-white" />
            {t('admin.presets.dialog.copy', { name: source.name.fr, version: source.currentVersion })}
          </label>
        ) : null}
        <label className="flex cursor-pointer items-center gap-2.5 text-[14px]">
          <input type="radio" name="presetFrom" checked={from === 'empty'} onChange={() => setFrom('empty')} className="size-4 accent-white" />
          {t('admin.presets.dialog.empty')}
        </label>
      </div>
      <Field label={t('admin.presets.dialog.sectors')} htmlFor="np-sectors">
        <Input id="np-sectors" value={sectors} onChange={(e) => setSectors(e.target.value)} />
      </Field>
    </AdminDialog>
  );
}
