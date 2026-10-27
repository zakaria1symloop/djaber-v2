'use client';
// /admin/cms — Figma "ADM-08 — Platform admin — CMS per locale" + DLG "Nouvelle entrée CMS". Type tabs with counts
// (`?tab=`), filters in the URL, rows with FR / AR / EN pills (PUBLIÉ / MANQUANT / BROUILLON), window, last change,
// `Actions ⌄`; editor of the open entry (`?sheet=<id>`).
import type { AdminCmsCounts, CmsEntryAdminDto, CmsPreviewLinkDto } from '@djaber/shared';
import { ActionsMenu, Button, Checkbox, Field, Input, PillTabs, Select, toast, type Column } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useConfirmAction } from '@/components/confirm-action';
import { AdminPage } from '@/features/admin/admin-page';
import { adminWrite, useAdminGet, useAdminInvalidate, useAdminJobToast, useAdminList } from '@/features/admin/api';
import { AnnouncementPreviewDialog, entryText } from '@/features/admin/cms/announcement-preview';
import { CmsEditor } from '@/features/admin/cms/editor';
import { AdminDialog, NO_ERRORS, toServerErrors, useOnOpen, type ServerErrors } from '@/features/admin/dialog-kit';
import { AdminFilterBar, AdminListBody, type AdminFilter } from '@/features/admin/list-kit';
import { usePlatform } from '@/features/admin/platform';
import { CMS_LIST } from '@/features/admin/specs';
import { AdminPill, useFormats } from '@/features/admin/ui';
import { toMenuActions } from '@/lib/actions';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useListState } from '@/lib/use-list-state';

const TYPES = ['announcement', 'legal', 'help', 'email', 'plan_text', 'system_message_default'] as const;
type CmsType = (typeof TYPES)[number] | 'page';

export default function AdminCmsPage() {
  const t = useT();
  const f = useFormats();
  const locale = useLocaleCode();
  const { can } = usePlatform();
  const write = can('admin.cms.write');
  const list = useListState(CMS_LIST);
  const type = (list.state.tab as CmsType | null) ?? 'announcement';
  const query = useAdminList<CmsEntryAdminDto, { counts?: AdminCmsCounts }>('/admin/cms', { ...list.apiQuery(), type });
  const counts = query.data?.meta?.counts;
  const open = useAdminGet<CmsEntryAdminDto>(list.state.sheet ? `/admin/cms/${list.state.sheet}` : null);
  const invalidate = useAdminInvalidate();
  const track = useAdminJobToast();
  const [create, setCreate] = useState(false);
  const [previewed, setPreviewed] = useState<CmsEntryAdminDto | null>(null);
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await m.mutateAsync(fn);
      void invalidate('/admin/cms');
      toast(done);
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const quick: AdminFilter[] = useMemo(
    () => [
      { kind: 'multi', key: 'status', label: t('admin.common.status'), options: (['draft', 'scheduled', 'published', 'archived'] as const).map((v) => ({ value: v, label: t(`admin.cms.status.${v}`) })) },
      { kind: 'single', key: 'missingLocale', label: t('admin.cms.filter.missing'), options: (['fr', 'ar', 'en'] as const).map((v) => ({ value: v, label: v.toUpperCase() })) },
      { kind: 'single', key: 'target', label: t('admin.cms.field.target'), options: ['all', 'paid', 'free', 'trial'].map((v) => ({ value: v, label: t(`admin.cms.target.${v}`) })) },
    ],
    [t],
  );
  const pill = (e: CmsEntryAdminDto, l: 'fr' | 'ar' | 'en') => {
    const s = e.locales.find((x) => x.locale === l)?.status ?? 'missing';
    return <AdminPill group="Cms.status" value={s}>{t(`admin.cms.localeStatus.${s}`)}</AdminPill>;
  };
  const windowOf = (e: CmsEntryAdminDto) =>
    e.status === 'scheduled' && e.startsAt ? t('admin.cms.window.scheduled', { date: f.shortTime(e.startsAt) }) : e.startsAt || e.endsAt ? `${e.startsAt ? f.shortTime(e.startsAt) : '…'} → ${e.endsAt ? f.shortTime(e.endsAt) : t('admin.cms.window.noEnd')}` : '—';
  const preview = async (e: CmsEntryAdminDto) => {
    // UX-035: an announcement has no public page — it is shown as the clients see it (banner, notification, public site)
    if (e.type === 'announcement') return setPreviewed(e);
    try {
      const r = await api<CmsPreviewLinkDto>(`/admin/cms/${e.id}/preview-link`);
      window.open(r.url, '_blank', 'noopener');
    } catch (err) {
      toast({ tone: 'danger', message: errorMessage(err, t) });
    }
  };
  const confirm = useConfirmAction();
  const menu = (e: CmsEntryAdminDto) => (
    <ActionsMenu
      label={t('action.actions')}
      heading={e.key}
      actions={toMenuActions(
        e.actions,
        {
          edit: { label: t('admin.cms.action.edit'), onSelect: () => list.openSheet(e.id) },
          publish: { label: t('admin.cms.action.publish'), onSelect: () => void act(() => adminWrite(`/admin/cms/${e.id}/publish`, 'POST', {}), t('admin.cms.publishedToast')), hidden: !write },
          schedule: { label: t('admin.cms.action.schedule'), onSelect: () => list.openSheet(e.id), hidden: !write },
          unpublish: { label: t('admin.cms.action.unpublish'), onSelect: () => confirm.ask({ title: t('admin.cms.unpublishConfirm.title', { key: e.key }), description: t('admin.cms.unpublishConfirm.description'), confirmLabel: t('admin.cms.action.unpublish'), destructive: true, run: () => act(() => adminWrite(`/admin/cms/${e.id}/unpublish`, 'POST', {}), t('admin.cms.unpublished')) }), destructive: true, hidden: !write },
          translate: { label: t('admin.cms.action.translate'), onSelect: () => void track(() => adminWrite<{ jobId: string }>(`/admin/cms/${e.id}/translate`, 'POST', {}), { running: t('admin.cms.translating'), done: t('admin.cms.translated') }), hidden: !write },
          preview: { label: t(e.type === 'announcement' ? 'admin.cms.action.previewAnnouncement' : 'admin.cms.action.preview'), onSelect: () => void preview(e) },
          versions: { label: t('admin.cms.action.versions'), onSelect: () => list.openSheet(e.id) },
        },
        t,
      )}
    />
  );
  const columns: Column<CmsEntryAdminDto>[] = [
    { key: 'entry', header: t('admin.cms.col.entry'), hideable: false, className: 'max-w-[280px]', cell: (e) => <span className="block truncate">{e.locales.find((l) => l.locale === 'fr')?.title || e.key}</span> },
    { key: 'target', header: t('admin.cms.field.target'), hideBelow: 'lg', cell: (e) => [t(`admin.cms.target.${typeof e.target.scope === 'string' ? e.target.scope : 'all'}`), ...e.channels.map((c) => t(`admin.cms.channel.${c}`))].join(' · ') },
    { key: 'fr', header: 'FR', cell: (e) => pill(e, 'fr') },
    { key: 'ar', header: 'AR', cell: (e) => pill(e, 'ar') },
    { key: 'en', header: 'EN', cell: (e) => pill(e, 'en') },
    { key: 'window', header: t('admin.cms.col.window'), hideBelow: 'lg', cell: windowOf },
    { key: 'updated', header: t('admin.cms.col.updated'), sortKey: 'updatedAt', hideBelow: 'xl', cell: (e) => `${f.ago(e.updatedAt)}${e.updatedBy ? ` · ${e.updatedBy.firstName}` : ''}` },
  ];
  return (
    <AdminPage
      permission="admin.cms.read"
      title={t('nav.admin.cms')}
      description={t('admin.cms.description')}
      actions={
        <>
          <Button variant="ghost" onClick={() => window.open(`/${locale}`, '_blank', 'noopener')}>
            {t('admin.cms.previewSite')}
          </Button>
          {write ? (
            <Button variant="primary" onClick={() => setCreate(true)} data-testid="new-cms">
              {t('admin.cms.new')}
            </Button>
          ) : null}
        </>
      }
    >
      <PillTabs label={t('admin.cms.tabs')} value={type} onChange={(k) => list.set({ tab: k === 'announcement' ? null : k, sheet: null })} tabs={TYPES.map((k) => ({ key: k, label: t(`admin.cms.type.${k}`), count: counts?.[k] ?? null }))} />
      <AdminFilterBar list={list} search={t('admin.cms.search')} quick={quick} count={query.data ? t(`admin.cms.count`, { count: query.data.total }) : undefined} />
      <AdminListBody testId="cms-list" query={query} list={list} columns={columns} rowKey={(e) => e.id} label={t('nav.admin.cms')} entity={t('admin.cms.entity')} empty={{ title: t('admin.cms.empty', { type: t(`admin.cms.type.${type}`) }), action: write ? { label: t('admin.cms.new'), onClick: () => setCreate(true) } : undefined }} rowActions={menu} onRowClick={(e) => list.openSheet(e.id)} />
      {list.state.sheet && open.data ? <CmsEditor key={`${open.data.id}:${open.data.updatedAt}`} entry={open.data} canWrite={write} onClose={() => list.openSheet(null)} /> : null}
      <NewCmsDialog open={create} type={type} onClose={() => setCreate(false)} onCreated={(id, ty) => list.set({ tab: ty === 'announcement' ? null : ty, sheet: id })} />
      {previewed ? <AnnouncementPreviewDialog open onClose={() => setPreviewed(null)} text={entryText(previewed)} channels={previewed.channels} link={previewed.link} /> : null}
      {confirm.element}
    </AdminPage>
  );
}

function NewCmsDialog({ open, type, onClose, onCreated }: { open: boolean; type: CmsType; onClose: () => void; onCreated: (id: string, type: string) => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [ty, setTy] = useState<CmsType>('announcement');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [all, setAll] = useState(true);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (b: unknown) => adminWrite<CmsEntryAdminDto>('/admin/cms', 'POST', b, true) });
  useOnOpen(open, () => {
    setTy(type);
    setSlug('');
    setTitle('');
    setAll(true);
    setErrors(NO_ERRORS);
  });
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      const e = await m.mutateAsync({ key: slug.trim(), type: ty, locales: { fr: { title: title.trim(), body: '' }, ...(all ? { ar: { title: '', body: '', fallbackToFr: true }, en: { title: '', body: '', fallbackToFr: true } } : {}) } });
      void invalidate('/admin/cms');
      toast(t('admin.cms.created'));
      onClose();
      onCreated(e.id, e.type);
    } catch (err) {
      setErrors(toServerErrors(err, t, ['key', 'type', 'locales'], { CMS_SLUG_INVALID: 'key', CMS_SLUG_TAKEN: 'key' }));
    }
  };
  return (
    <AdminDialog open={open} onClose={onClose} testId="dlg-cms" title={t('admin.cms.dialog.title')} context={t('admin.cms.dialog.context')} submitLabel={t('admin.cms.dialog.submit')} disabled={!slug.trim() || !title.trim()} pending={m.isPending} error={errors.form} note={t(ty === 'legal' || ty === 'help' || ty === 'page' ? 'admin.cms.dialog.note' : ty === 'announcement' ? 'admin.cms.dialog.noteAnnouncement' : 'admin.cms.dialog.noteOther')} onSubmit={() => void submit()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.cms.dialog.type')} htmlFor="nc-type">
          <Select id="nc-type" value={ty} onChange={(e) => setTy(e.target.value as CmsType)}>
            {[...TYPES, 'page' as const].map((k) => (
              <option key={k} value={k}>
                {t(`admin.cms.typeOne.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.cms.dialog.slug')} required htmlFor="nc-slug" hint={t('admin.cms.dialog.slugHint')} error={errors.fields.key}>
          <Input id="nc-slug" dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
      </div>
      <Field label={t('admin.cms.dialog.titleFr')} required htmlFor="nc-title">
        <Input id="nc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <label className="flex cursor-pointer items-center gap-2.5 text-[14px]">
        <Checkbox checked={all} onChange={(e) => setAll(e.target.checked)} />
        {t('admin.cms.dialog.allLocales')}
      </label>
    </AdminDialog>
  );
}
