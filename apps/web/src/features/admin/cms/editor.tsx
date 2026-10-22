'use client';
// ADM-08 entry editor "{type} — « {title} »": one card per locale (FR · AR RTL Changa · EN) with its status pill and
// "Traduire avec l'IA depuis FR" (job), then CIBLE · CANAUX · DÉBUT · FIN · LIEN. Publish / schedule blocked by
// CMS_LOCALE_MISSING unless "replier sur FR"; preview link 24 h; versions. Leave guard while dirty.
import type { CmsEntryAdminDto, CmsPreviewLinkDto, CmsVersionDto } from '@djaber/shared';
import { Button, Card, Checkbox, Dialog, Field, FormAlert, FrameNote, Input, MonoChip, Select, Textarea, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useConfirmAction } from '@/components/confirm-action';
import { ApiError, api } from '@/lib/api';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { adminWrite, useAdminGet, useAdminInvalidate, useAdminJobToast } from '../api';
import { AdminPill, useFormats } from '../ui';

type Loc = 'fr' | 'ar' | 'en';
const LOCALES: Loc[] = ['fr', 'ar', 'en'];
const CHANNELS = ['banner', 'in_app', 'email', 'push', 'web'] as const;
type Draft = { locales: Record<Loc, { title: string; body: string }>; target: string; channels: string[]; startsAt: string; endsAt: string; link: string };

/** ISO → value of a datetime-local input in Africa/Algiers (UTC+1, no DST). */
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 3_600_000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(`${v}:00+01:00`).toISOString() : null);
const draftOf = (e: CmsEntryAdminDto): Draft => ({
  locales: Object.fromEntries(LOCALES.map((l) => {
    const x = e.locales.find((y) => y.locale === l);
    return [l, { title: x?.title ?? '', body: x?.body ?? '' }];
  })) as Draft['locales'],
  target: typeof e.target.scope === 'string' ? e.target.scope : 'all',
  channels: e.channels,
  startsAt: toLocal(e.startsAt),
  endsAt: toLocal(e.endsAt),
  link: e.link ?? '',
});

export function CmsEditor({ entry, canWrite, onClose }: { entry: CmsEntryAdminDto; canWrite: boolean; onClose: () => void }) {
  const confirm = useConfirmAction();
  const t = useT();
  const f = useFormats();
  const invalidate = useAdminInvalidate();
  const track = useAdminJobToast();
  const base = useMemo(() => draftOf(entry), [entry]);
  const [d, setD] = useState<Draft>(base);
  const [fallback, setFallback] = useState(entry.locales.some((l) => l.fallbackToFr));
  const [missing, setMissing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState(false);
  const [preview, setPreview] = useState(false);
  useEffect(() => setD(base), [base]);
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const { guard } = useLeaveGuard(dirty, entry.key);
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  const status = (l: Loc) => entry.locales.find((x) => x.locale === l)?.status ?? 'missing';
  const save = async () => {
    for (const l of LOCALES) {
      const b = base.locales[l];
      const n = d.locales[l];
      if (b.title !== n.title || b.body !== n.body) await adminWrite(`/admin/cms/${entry.id}/locales/${l}`, 'PUT', { title: n.title, body: n.body, fallbackToFr: fallback });
    }
    if (d.target !== base.target || d.channels.join() !== base.channels.join() || d.startsAt !== base.startsAt || d.endsAt !== base.endsAt || d.link !== base.link)
      await adminWrite(`/admin/cms/${entry.id}`, 'PATCH', { target: { scope: d.target }, channels: d.channels, startsAt: fromLocal(d.startsAt), endsAt: fromLocal(d.endsAt), link: d.link.trim() || null });
  };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    setMissing(null);
    try {
      await m.mutateAsync(fn);
      void invalidate('/admin/cms');
      toast(done);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CMS_LOCALE_MISSING') setMissing(String(e.body.params.locales ?? '').toUpperCase());
      else setError(errorMessage(e, t));
    }
  };
  const future = d.startsAt && new Date(fromLocal(d.startsAt)!).getTime() > Date.now();
  const publish = () =>
    act(async () => {
      if (dirty) await save();
      if (future) await adminWrite(`/admin/cms/${entry.id}/schedule`, 'POST', { startsAt: fromLocal(d.startsAt), endsAt: fromLocal(d.endsAt), fallbackToFr: fallback });
      else await adminWrite(`/admin/cms/${entry.id}/publish`, 'POST', { fallbackToFr: fallback });
    }, future ? t('admin.cms.scheduled', { date: f.dateTime(fromLocal(d.startsAt)) }) : t('admin.cms.publishedToast'));
  const openPreview = async () => {
    try {
      const r = await api<CmsPreviewLinkDto>(`/admin/cms/${entry.id}/preview-link`);
      window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  // the job translates the saved French text and the refetch remounts the editor: unsaved edits are saved first
  const translate = async (to: Loc) => {
    if (dirty) {
      setError(null);
      try {
        await m.mutateAsync(save);
      } catch (e) {
        setError(errorMessage(e, t));
        return;
      }
    }
    await track(() => adminWrite<{ jobId: string }>(`/admin/cms/${entry.id}/translate`, 'POST', { to: [to] }), { running: t('admin.cms.translating'), done: t('admin.cms.translated') });
    await invalidate('/admin/cms');
  };
  const title = d.locales.fr.title || entry.key;
  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="cms-editor">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="ts-display-s me-auto text-[18px]">{t('admin.cms.editor.title', { type: t(`admin.cms.typeOne.${entry.type}`), title })}</h2>
        <Button variant="ghost" size="sm" onClick={() => setVersions(true)}>
          {t('admin.cms.editor.versions', { count: entry.versions.length })}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('action.close')}
        </Button>
      </div>
      <fieldset disabled={!canWrite || m.isPending} className="grid gap-3 lg:grid-cols-3">
        {LOCALES.map((l) => (
          <div key={l} className="flex flex-col gap-2 rounded-card border border-line-edge bg-ink-surface p-3" data-cms-locale={l} lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
            <div className="flex items-center justify-between gap-2">
              <span className="ts-label-micro uppercase text-text-muted">{l === 'ar' ? t('admin.cms.editor.arLabel') : l.toUpperCase()}</span>
              <AdminPill group="Cms.status" value={status(l)}>{t(`admin.cms.localeStatus.${status(l)}`)}</AdminPill>
            </div>
            <Input aria-label={t('admin.cms.editor.titleField', { locale: l.toUpperCase() })} value={d.locales[l].title} onChange={(e) => setD((x) => ({ ...x, locales: { ...x.locales, [l]: { ...x.locales[l], title: e.target.value } } }))} />
            <Textarea aria-label={t('admin.cms.editor.bodyField', { locale: l.toUpperCase() })} rows={5} value={d.locales[l].body} onChange={(e) => setD((x) => ({ ...x, locales: { ...x.locales, [l]: { ...x.locales[l], body: e.target.value } } }))} />
            {l !== 'fr' && canWrite ? (
              <Button size="sm" variant="ghost" className="w-fit" onClick={() => void translate(l)} disabled={!d.locales.fr.body.trim()}>
                {t('admin.cms.editor.translate')}
              </Button>
            ) : null}
          </div>
        ))}
      </fieldset>
      <fieldset disabled={!canWrite || m.isPending} className="grid gap-3 md:grid-cols-5">
        <Field label={t('admin.cms.field.target')} htmlFor="cm-target">
          <Select id="cm-target" value={d.target} onChange={(e) => setD((x) => ({ ...x, target: e.target.value }))}>
            {['all', 'paid', 'free', 'trial'].map((v) => (
              <option key={v} value={v}>
                {t(`admin.cms.target.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.cms.field.channels')} htmlFor="cm-channels">
          <div id="cm-channels" className="flex min-h-10 flex-wrap items-center gap-2 rounded-card border border-line-edge px-2 py-1.5">
            {CHANNELS.map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                <Checkbox checked={d.channels.includes(c)} onChange={(e) => setD((x) => ({ ...x, channels: CHANNELS.filter((y) => (y === c ? e.target.checked : x.channels.includes(y))) }))} />
                {t(`admin.cms.channel.${c}`)}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('admin.cms.field.start')} htmlFor="cm-start">
          <Input id="cm-start" type="datetime-local" value={d.startsAt} onChange={(e) => setD((x) => ({ ...x, startsAt: e.target.value }))} className="[color-scheme:dark]" />
        </Field>
        <Field label={t('admin.cms.field.end')} htmlFor="cm-end">
          <Input id="cm-end" type="datetime-local" value={d.endsAt} onChange={(e) => setD((x) => ({ ...x, endsAt: e.target.value }))} className="[color-scheme:dark]" />
        </Field>
        <Field label={t('admin.cms.field.link')} htmlFor="cm-link">
          <Input id="cm-link" dir="ltr" inputMode="url" autoComplete="off" spellCheck={false} autoCapitalize="none" value={d.link} onChange={(e) => setD((x) => ({ ...x, link: e.target.value }))} />
        </Field>
      </fieldset>
      {entry.type === 'announcement' ? <p className="ts-label-micro !normal-case text-text-muted" data-testid="cms-channels-hint">{t('admin.cms.channelsHint')}</p> : null}
      {missing !== null ? (
        <FormAlert tone="warning">
          <span data-testid="cms-locale-missing">{t('admin.cms.localeMissing', { locales: missing })}</span>
          <label className="mt-2 flex cursor-pointer items-center gap-2">
            <Checkbox checked={fallback} onChange={(e) => setFallback(e.target.checked)} />
            {t('admin.cms.fallback')}
          </label>
        </FormAlert>
      ) : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <FrameNote className="me-auto max-w-xl">{t('admin.cms.editor.note', { count: entry.versions.length })}</FrameNote>
        {entry.type === 'announcement' ? (
          <Button variant="ghost" onClick={() => setPreview(true)}>
            {t('admin.cms.editor.previewBanner')}
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => void openPreview()}>
            {t('admin.cms.editor.preview')}
          </Button>
        )}
        {canWrite ? (
          <>
            <Button onClick={() => void act(save, t('admin.cms.saved'))} disabled={!dirty} loading={m.isPending} data-testid="cms-save">
              {t('admin.cms.editor.saveDraft')}
            </Button>
            {entry.status === 'published' ? (
              <Button
                variant="danger"
                onClick={() => confirm.ask({ title: t('admin.cms.unpublishConfirm.title', { key: entry.key }), description: t('admin.cms.unpublishConfirm.description'), confirmLabel: t('admin.cms.action.unpublish'), destructive: true, run: () => act(() => adminWrite(`/admin/cms/${entry.id}/unpublish`, 'POST', {}), t('admin.cms.unpublished')) })}
                loading={m.isPending}
              >
                {t('admin.cms.action.unpublish')}
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => void publish()} loading={m.isPending} data-testid="cms-publish">
              {future ? t('admin.cms.editor.schedule') : t('admin.cms.editor.publish')}
            </Button>
          </>
        ) : null}
      </div>
      {guard}
      {confirm.element}
      <VersionsDialog id={entry.id} open={versions} onClose={() => setVersions(false)} />
      <Dialog open={preview} onOpenChange={setPreview} title={t('admin.cms.editor.previewBanner')} closeLabel={t('action.close')} size="lg">
        <div className="flex flex-col gap-2">
          {LOCALES.map((l) => (
            <div key={l} lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'} className="flex items-center gap-3 border-s-[3px] border-accent-inbound bg-ink-raised px-4 py-2.5 text-[13px]">
              <MonoChip className="shrink-0">{l.toUpperCase()}</MonoChip>
              <span className="min-w-0 flex-1">
                <strong>{d.locales[l].title || (fallback ? d.locales.fr.title : '—')}</strong> {d.locales[l].body || (fallback ? d.locales.fr.body : '')}
              </span>
            </div>
          ))}
        </div>
      </Dialog>
    </Card>
  );
}

function VersionsDialog({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const f = useFormats();
  const q = useAdminGet<CmsVersionDto[]>(open ? `/admin/cms/${id}/versions` : null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('admin.cms.versions.title')} closeLabel={t('action.close')}>
      {q.isPending ? (
        <p className="ts-label-meta text-text-muted">{t('common.loading')}</p>
      ) : q.isError ? (
        <FormAlert>{t('state.list.error.title')}</FormAlert>
      ) : (q.data ?? []).length === 0 ? (
        <p className="ts-label-meta text-text-muted">{t('admin.cms.versions.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-hairline">
          {(q.data ?? []).map((v) => (
            <li key={v.version} className="flex items-center gap-3 py-2 text-[13px]">
              <span className="font-mono">v{v.version}</span>
              <span className="flex-1 text-text-secondary">{v.createdBy ? `${v.createdBy.firstName} ${v.createdBy.lastName}` : '—'}</span>
              <span className="ts-label-micro text-text-muted">{f.dateTime(v.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
