'use client';
// ADM-07 editor "{preset} — brouillon v{n}": locale pills FR / AR / EN (⚠ manquant), name · tagline · badge · order,
// system prompt per locale with the 5 variables, tone · capabilities · handoff rules · max reply, publication checks
// (from `POST …/versions/:v/test`), Historique des versions, Tester (bac à essai), Publier v{n}
// (PRESET_LOCALE_INCOMPLETE). Published versions are immutable (PRESET_PUBLISHED_IMMUTABLE): a draft is created first.
import { PRESET_PROMPT_VARIABLES, type AgentPresetAdminDto, type AgentPresetVersionDto } from '@djaber/shared';
import { Button, Card, Dialog, Field, FormAlert, Input, ReadinessRow, Select, Textarea, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { adminWrite, useAdminInvalidate } from '../api';
import { useFormats } from '../ui';

type Loc = 'fr' | 'ar' | 'en';
const LOCALES: Loc[] = ['fr', 'ar', 'en'];
const TONES = ['friendly', 'professional', 'direct', 'expert'] as const;
const BADGES = ['recommended', 'popular', 'beta'] as const;
type Draft = {
  locales: Record<Loc, { name: string; tagline: string; systemPrompt: string }>;
  badge: string;
  sortOrder: string;
  tone: string;
  capabilities: string;
  handoffRules: string;
  maxReplyChars: string;
};
const draftOf = (p: AgentPresetAdminDto, v: AgentPresetVersionDto | null): Draft => {
  const c = (v?.config ?? {}) as Record<string, unknown>;
  return {
    locales: {
      fr: { name: v?.locales.fr?.name ?? p.name.fr ?? '', tagline: v?.locales.fr?.tagline ?? p.tagline.fr ?? '', systemPrompt: v?.locales.fr?.systemPrompt ?? '' },
      ar: { name: v?.locales.ar?.name ?? p.name.ar ?? '', tagline: v?.locales.ar?.tagline ?? p.tagline.ar ?? '', systemPrompt: v?.locales.ar?.systemPrompt ?? '' },
      en: { name: v?.locales.en?.name ?? p.name.en ?? '', tagline: v?.locales.en?.tagline ?? p.tagline.en ?? '', systemPrompt: v?.locales.en?.systemPrompt ?? '' },
    },
    badge: p.badge ?? '',
    sortOrder: String(p.sortOrder ?? 0),
    tone: typeof c.tone === 'string' ? c.tone : 'friendly',
    capabilities: Array.isArray(c.capabilities) ? (c.capabilities as string[]).join(', ') : '',
    handoffRules: Array.isArray(c.handoffRules) ? (c.handoffRules as string[]).join('\n') : '',
    maxReplyChars: c.maxReplyChars ? String(c.maxReplyChars) : '',
  };
};

export function PresetEditor({ preset, locale, onLocale, canWrite }: { preset: AgentPresetAdminDto; locale: Loc; onLocale: (l: Loc) => void; canWrite: boolean }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const versions = preset.versions ?? [];
  const draftV = versions.find((v) => v.status === 'draft') ?? null;
  const current = draftV ?? versions.find((v) => v.version === preset.currentVersion) ?? versions[0] ?? null;
  const editable = canWrite && !!draftV && preset.status !== 'archived';
  const base = useMemo(() => draftOf(preset, current), [preset, current]);
  const [d, setD] = useState<Draft>(base);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  useEffect(() => setD(base), [base]);
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const { guard } = useLeaveGuard(dirty, preset.name.fr);
  const setLoc = (k: 'name' | 'tagline' | 'systemPrompt', v: string) => setD((x) => ({ ...x, locales: { ...x.locales, [locale]: { ...x.locales[locale], [k]: v } } }));
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  const refresh = () => invalidate('/admin/agent-presets');
  const saveDraft = async () => {
    if (!draftV) return;
    await adminWrite(`/admin/agent-presets/${preset.id}/versions/${draftV.version}`, 'PATCH', {
      locales: Object.fromEntries(LOCALES.map((l) => [l, { name: d.locales[l].name, tagline: d.locales[l].tagline, systemPrompt: d.locales[l].systemPrompt }])),
      config: {
        tone: d.tone,
        capabilities: d.capabilities.split(',').map((s) => s.trim()).filter((s): s is 'text' => ['text', 'image', 'voice', 'orders', 'handoff'].includes(s)),
        handoffRules: d.handoffRules.split('\n').map((s) => s.trim()).filter(Boolean),
        ...(d.maxReplyChars ? { maxReplyChars: Number(d.maxReplyChars) } : {}),
      },
    });
    if (d.badge !== base.badge || d.sortOrder !== base.sortOrder) await adminWrite(`/admin/agent-presets/${preset.id}`, 'PATCH', { badge: d.badge || null, sortOrder: Number(d.sortOrder || 0) });
  };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await run.mutateAsync(fn);
      // the saved version becomes the baseline before the button is released (no "unsaved" flash after saving)
      await refresh();
      toast(done);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PRESET_LOCALE_INCOMPLETE') setError(t('admin.presets.localeIncomplete', { locales: String(e.body.params.locales ?? '').toUpperCase() }));
      else setError(errorMessage(e, t));
    }
  };
  const missing = current?.missingLocales ?? [];
  const checks = current?.testResults?.checks ?? [];
  const title = draftV ? t('admin.presets.editor.draftTitle', { name: preset.name.fr, version: draftV.version }) : t('admin.presets.editor.publishedTitle', { name: preset.name.fr, version: preset.currentVersion });
  const L = d.locales[locale];
  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="preset-editor">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="ts-display-s me-auto text-[18px]">{title}</h2>
        <Button variant="ghost" onClick={() => setHistory(true)}>
          {t('admin.presets.editor.history')}
        </Button>
        {editable ? (
          <>
            <Button onClick={() => void act(async () => { if (dirty) await saveDraft(); await adminWrite(`/admin/agent-presets/${preset.id}/versions/${draftV!.version}/test`, 'POST', {}); }, t('admin.presets.tested'))} loading={run.isPending} data-testid="preset-test">
              {t('admin.presets.editor.test')}
            </Button>
            <Button variant="primary" onClick={() => void act(async () => { if (dirty) await saveDraft(); await adminWrite(`/admin/agent-presets/${preset.id}/versions/${draftV!.version}/publish`, 'POST', {}); }, t('admin.presets.published', { version: draftV!.version }))} loading={run.isPending} data-testid="preset-publish">
              {t('admin.presets.editor.publish', { version: draftV!.version })}
            </Button>
          </>
        ) : canWrite && preset.status !== 'archived' ? (
          <Button variant="primary" onClick={() => void act(() => adminWrite(`/admin/agent-presets/${preset.id}/versions`, 'POST', {}), t('admin.presets.draftCreated'))} loading={run.isPending} data-testid="preset-new-draft">
            {t('admin.presets.editor.newDraft', { version: preset.currentVersion + 1 })}
          </Button>
        ) : null}
      </div>
      <div role="tablist" aria-label={t('admin.presets.editor.locales')} className="flex gap-2">
        {LOCALES.map((l) => {
          const miss = missing.includes(l);
          return (
            <button key={l} type="button" role="tab" aria-selected={locale === l} data-locale={l} onClick={() => onLocale(l)} className={`inline-flex h-9 items-center gap-1.5 rounded-card border px-3 text-[13px] ${locale === l ? 'border-white bg-white text-black' : 'border-line-hairline text-text-secondary hover:text-text-primary'}`}>
              {l.toUpperCase()} {miss ? <span className={locale === l ? '' : 'text-accent-starred'}>⚠ {t('admin.presets.missing')}</span> : '✓'}
            </button>
          );
        })}
      </div>
      {missing.length && !missing.includes('fr') ? <p className="ts-label-micro !normal-case text-text-muted" data-testid="preset-fallback-note">{t('admin.presets.missingFallback', { locales: missing.map((l) => l.toUpperCase()).join(', ') })}</p> : null}
      <fieldset disabled={!editable || run.isPending} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          <Field label={t('admin.presets.field.name', { locale: locale.toUpperCase() })} htmlFor="ps-name">
            <Input id="ps-name" dir={locale === 'ar' ? 'rtl' : 'ltr'} value={L.name} onChange={(e) => setLoc('name', e.target.value)} />
          </Field>
          <Field label={t('admin.presets.field.tagline', { locale: locale.toUpperCase() })} htmlFor="ps-tag">
            <Textarea id="ps-tag" rows={2} dir={locale === 'ar' ? 'rtl' : 'ltr'} value={L.tagline} onChange={(e) => setLoc('tagline', e.target.value)} />
          </Field>
          <Field label={t('admin.presets.field.badge')} htmlFor="ps-badge">
            <Select id="ps-badge" value={d.badge} onChange={(e) => setD((x) => ({ ...x, badge: e.target.value }))}>
              <option value="">—</option>
              {BADGES.map((b) => (
                <option key={b} value={b}>
                  {t(`admin.presets.badge.${b}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.presets.field.order')} htmlFor="ps-order">
            <Input id="ps-order" inputMode="numeric" dir="ltr" value={d.sortOrder} onChange={(e) => setD((x) => ({ ...x, sortOrder: e.target.value.replace(/\D/g, '') }))} />
          </Field>
        </div>
        <Field label={t('admin.presets.field.prompt', { locale: locale.toUpperCase(), vars: PRESET_PROMPT_VARIABLES.map((v) => `{{${v}}}`).join(' ') })} htmlFor="ps-prompt">
          <Textarea id="ps-prompt" rows={7} dir={locale === 'ar' ? 'rtl' : 'ltr'} value={L.systemPrompt} onChange={(e) => setLoc('systemPrompt', e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          <Field label={t('admin.presets.field.tone')} htmlFor="ps-tone">
            <Select id="ps-tone" value={d.tone} onChange={(e) => setD((x) => ({ ...x, tone: e.target.value }))}>
              {TONES.map((x) => (
                <option key={x} value={x}>
                  {t(`admin.presets.tone.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.presets.field.capabilities')} htmlFor="ps-caps" hint="text, image, voice, orders, handoff">
            <Input id="ps-caps" dir="ltr" value={d.capabilities} onChange={(e) => setD((x) => ({ ...x, capabilities: e.target.value }))} />
          </Field>
          <Field label={t('admin.presets.field.handoff')} htmlFor="ps-handoff">
            <Textarea id="ps-handoff" rows={3} value={d.handoffRules} onChange={(e) => setD((x) => ({ ...x, handoffRules: e.target.value }))} />
          </Field>
          <Field label={t('admin.presets.field.maxReply')} htmlFor="ps-max">
            <Input id="ps-max" inputMode="numeric" dir="ltr" value={d.maxReplyChars} onChange={(e) => setD((x) => ({ ...x, maxReplyChars: e.target.value.replace(/\D/g, '') }))} />
          </Field>
        </div>
      </fieldset>
      <div className="rounded-card border border-line-hairline p-3" data-testid="preset-checks">
        <div className="ts-label-micro uppercase text-text-muted">{t('admin.presets.checks.title')}</div>
        {checks.length ? (
          <ul className="flex flex-col">
            {checks.map((c) => (
              <ReadinessRow key={c.key} name={c.key} state={c.ok ? 'ok' : 'missing'}>
                {t(`admin.presets.check.${c.key}.${c.ok ? 'ok' : 'ko'}`, { ...c.params, missing: String(c.params.missing ?? '') || '—', unknown: String(c.params.unknown ?? '') || '—' })}
              </ReadinessRow>
            ))}
          </ul>
        ) : (
          <p className="pt-2 ts-label-meta text-text-muted">{draftV ? t('admin.presets.checks.notRun') : t('admin.presets.checks.published')}</p>
        )}
      </div>
      {error ? <FormAlert>{error}</FormAlert> : null}
      {editable ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setD(base)}>
            {t('action.cancel')}
          </Button>
          <Button onClick={() => void act(saveDraft, t('admin.presets.saved'))} disabled={!dirty} loading={run.isPending} data-testid="preset-save">
            {t('admin.presets.editor.save')}
          </Button>
        </div>
      ) : null}
      {guard}
      <HistoryDialog versions={versions} name={preset.name.fr} open={history} onClose={() => setHistory(false)} />
    </Card>
  );
}

function HistoryDialog({ versions, name, open, onClose }: { versions: AgentPresetVersionDto[]; name: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const f = useFormats();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('admin.presets.history.title', { name })} closeLabel={t('action.close')}>
      <ul className="flex flex-col divide-y divide-line-hairline">
        {[...versions].sort((a, b) => b.version - a.version).map((v) => (
          <li key={v.version} className="flex flex-col gap-0.5 py-2 text-[13px]">
            <span className="flex items-center gap-2">
              <span className="font-mono">v{v.version}</span>
              <span className="ts-label-micro uppercase text-text-muted">{t(`admin.presets.status.${v.status}`)}</span>
              <span className="ms-auto ts-label-micro text-text-muted">{f.dateTime(v.publishedAt ?? v.updatedAt)}</span>
            </span>
            {v.changelog ? <span className="text-text-secondary">{v.changelog}</span> : null}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
