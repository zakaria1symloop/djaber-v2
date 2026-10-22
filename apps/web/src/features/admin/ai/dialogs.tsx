'use client';
// ADM-06 dialogs — DLG "Clé fournisseur IA" (test states TEST… / OK latency / REJETÉE AI_PROVIDER_KEY_REJECTED /
// INJOIGNABLE AI_PROVIDER_UNREACHABLE (save anyway) / AUCUNE CLÉ AI_PROVIDER_NO_KEY; the key is never shown again),
// DLG "Modèle IA" (costs feed the calculator), route editor (primary / fallback, credits, timeout, threshold, bascule)
// and "Enregistrer une version de grille" (CreditPricing, applied at each workspace's next period).
import type { AiModelAdminDto, AiPricingSimulateInput, AiProviderAdminDto, AiProviderTestDto, AiRouteDto } from '@djaber/shared';
import { Checkbox, Field, Input, KeyTestRow, Select, Switch, toast, type KeyTestState } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@djaber/ui';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { adminWrite, useAdminInvalidate } from '../api';
import { AdminDialog, NO_ERRORS, ReasonField, reasonOk, toServerErrors, useOnOpen, type ServerErrors } from '../dialog-kit';

/** `reason` / `status`: why it failed (`details` of AI_PROVIDER_UNREACHABLE); `missing`: models the provider does not list (UX-013). */
type TestResult = { state: KeyTestState; latency?: number; reason?: string; status?: number; missing?: string[] };
const testState = (e: unknown): KeyTestState => (e instanceof ApiError ? (e.code === 'AI_PROVIDER_KEY_REJECTED' ? 'rejected' : e.code === 'AI_PROVIDER_UNREACHABLE' ? 'unreachable' : e.code === 'AI_PROVIDER_NO_KEY' ? 'no_key' : 'rejected') : 'unreachable');

/** The reason of a failed test, from the API error (`details.reason`, `details.status`). */
export const testFailureOf = (e: unknown): Pick<TestResult, 'reason' | 'status'> => {
  const d = e instanceof ApiError ? (e.body.details as { reason?: unknown; status?: unknown } | null | undefined) : null;
  return { reason: typeof d?.reason === 'string' ? d.reason : e instanceof ApiError ? undefined : 'network', status: typeof d?.status === 'number' ? d.status : undefined };
};

export function KeyResult({ r }: { r: TestResult }) {
  const t = useT();
  const pill = r.state === 'ok' ? t('admin.ai.key.pill.ok', { ms: r.latency ?? 0 }) : t(`admin.ai.key.pill.${r.state}`);
  return (
    <KeyTestRow state={r.state} pill={pill}>
      {t(`admin.ai.key.state.${r.state}`)}
      {r.reason && t.has(`admin.ai.key.reason.${r.reason}`) ? <span className="block" data-testid="key-test-reason">{t(`admin.ai.key.reason.${r.reason}`, { status: r.status ?? '' })}</span> : null}
      {r.missing?.length ? <span className="block text-accent-starred" data-testid="key-test-missing">{t('admin.ai.key.missingModels', { models: r.missing.join(', ') })}</span> : null}
    </KeyTestRow>
  );
}

export function ProviderKeyDialog({ providers, initial, open, onClose }: { providers: AiProviderAdminDto[]; initial: AiProviderAdminDto | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [key, setKey] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const test = useMutation({ mutationFn: (b: { key: string; apiKey: string }) => adminWrite<AiProviderTestDto>(`/admin/ai-providers/${b.key}/test`, 'POST', { apiKey: b.apiKey }) });
  const save = useMutation({ mutationFn: (b: { key: string; apiKey: string }) => adminWrite(`/admin/ai-providers/${b.key}`, 'PATCH', { apiKey: b.apiKey }) });
  useOnOpen(open, () => {
    setKey(initial?.key ?? providers.find((p) => !p.keyHint)?.key ?? providers[0]?.key ?? 'openai');
    setApiKey('');
    setResult(null);
    setErrors(NO_ERRORS);
  });
  const provider = providers.find((p) => p.key === key);
  const runTest = async () => {
    setErrors(NO_ERRORS);
    setResult({ state: 'testing' });
    try {
      const r = await test.mutateAsync({ key, apiKey: apiKey.trim() });
      setResult({ state: 'ok', latency: r.latencyMs, missing: r.missingModels });
    } catch (e) {
      setResult({ state: testState(e), ...testFailureOf(e) });
    }
  };
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      await save.mutateAsync({ key, apiKey: apiKey.trim() });
      void invalidate('/admin/ai-providers', '/admin/ai-routes', '/admin/ai-pricing');
      toast(t('admin.ai.key.saved', { name: provider?.displayName ?? key }));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['apiKey']));
    }
  };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-provider-key"
      title={t('admin.ai.key.title')}
      context={t('admin.ai.key.context', { name: provider?.displayName ?? key })}
      submitLabel={t('action.save')}
      disabled={apiKey.trim().length < 8 || result?.state === 'testing' || result?.state === 'rejected'}
      pending={save.isPending}
      error={errors.form}
      extra={
        <Button onClick={() => void runTest()} disabled={apiKey.trim().length < 8} loading={test.isPending} data-testid="key-test">
          {t('admin.ai.key.test')}
        </Button>
      }
      onSubmit={() => void submit()}
    >
      {!initial ? (
        <Field label={t('admin.ai.key.provider')} htmlFor="k-provider">
          <Select id="k-provider" value={key} onChange={(e) => { setKey(e.target.value); setResult(null); }}>
            {providers.map((p) => (
              <option key={p.key} value={p.key}>
                {p.displayName}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t('admin.ai.key.newKey')} htmlFor="k-key" hint={t('admin.ai.key.hint')} error={errors.fields.apiKey}>
        <Input id="k-key" type="password" autoComplete="off" dir="ltr" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setResult(null); }} placeholder="sk-…" />
      </Field>
      {result ? <KeyResult r={result} /> : null}
    </AdminDialog>
  );
}

const CAPS = ['text', 'vision', 'transcription', 'embeddings'] as const;

export function ModelDialog({ model, providers, open, onClose }: { model: AiModelAdminDto | null; providers: AiProviderAdminDto[]; open: boolean; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [providerKey, setProviderKey] = useState('openai');
  const [modelId, setModelId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [caps, setCaps] = useState<string[]>(['text']);
  const [inPrice, setInPrice] = useState('');
  const [outPrice, setOutPrice] = useState('');
  const [context, setContext] = useState('');
  const [timeout, setTimeoutSec] = useState('20');
  const [threshold, setThreshold] = useState('2');
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  useOnOpen(open, () => {
    setProviderKey(model?.providerKey ?? providers[0]?.key ?? 'openai');
    setModelId(model?.modelId ?? '');
    setDisplayName(model?.displayName ?? '');
    setCaps(model?.capabilities ?? ['text']);
    setInPrice(model ? String(model.inputPricePerM) : '');
    setOutPrice(model ? String(model.outputPricePerM) : '');
    setContext(model?.contextTokens ? String(model.contextTokens) : '');
    setTimeoutSec(String(model?.timeoutSec ?? 20));
    setThreshold(String(model?.failoverThresholdPct ?? 2));
    setActive(model?.isActive ?? true);
    setErrors(NO_ERRORS);
  });
  const dec = (v: string) => Number(v.replace(',', '.'));
  const submit = async () => {
    setErrors(NO_ERRORS);
    const body = { displayName: displayName.trim() || modelId.trim(), capabilities: caps, inputPricePerM: dec(inPrice || '0'), outputPricePerM: dec(outPrice || '0'), contextTokens: context ? Number(context) : null, timeoutSec: Number(timeout), failoverThresholdPct: Number(threshold), isActive: active };
    try {
      if (model) await m.mutateAsync(() => adminWrite(`/admin/ai-models/${model.id}`, 'PATCH', body));
      else await m.mutateAsync(() => adminWrite('/admin/ai-models', 'POST', { providerKey, modelId: modelId.trim(), ...body }, true));
      void invalidate('/admin/ai-models', '/admin/ai-providers', '/admin/ai-routes', '/admin/ai-pricing');
      toast(t('admin.ai.model.saved'));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['modelId', 'capabilities', 'inputPricePerM', 'outputPricePerM', 'contextTokens', 'timeoutSec', 'failoverThresholdPct']));
    }
  };
  const decimal = (v: string) => v.replace(/[^\d.,]/g, '');
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-model"
      title={t('admin.ai.model.title')}
      context={t('admin.ai.model.context')}
      submitLabel={t('action.save')}
      disabled={!modelId.trim() || caps.length === 0}
      pending={m.isPending}
      error={errors.form}
      note={t('admin.ai.model.note')}
      onSubmit={() => void submit()}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('admin.ai.model.provider')} htmlFor="m-provider">
          <Select id="m-provider" value={providerKey} disabled={!!model} onChange={(e) => setProviderKey(e.target.value)}>
            {providers.map((p) => (
              <option key={p.key} value={p.key}>
                {p.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.ai.model.modelId')} required htmlFor="m-id" error={errors.fields.modelId}>
          <Input id="m-id" dir="ltr" value={modelId} disabled={!!model} onChange={(e) => setModelId(e.target.value)} />
        </Field>
        <Field label={t('admin.ai.model.capabilities')} htmlFor="m-caps" error={errors.fields.capabilities}>
          <div id="m-caps" className="flex flex-wrap gap-2 pt-2">
            {CAPS.map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                <Checkbox checked={caps.includes(c)} onChange={(e) => setCaps((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))} />
                {t(`admin.ai.cap.${c}`)}
              </label>
            ))}
          </div>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('admin.ai.model.inPrice')} htmlFor="m-in" error={errors.fields.inputPricePerM}>
          <Input id="m-in" inputMode="decimal" dir="ltr" value={inPrice} onChange={(e) => setInPrice(decimal(e.target.value))} />
        </Field>
        <Field label={t('admin.ai.model.outPrice')} htmlFor="m-out" error={errors.fields.outputPricePerM}>
          <Input id="m-out" inputMode="decimal" dir="ltr" value={outPrice} onChange={(e) => setOutPrice(decimal(e.target.value))} />
        </Field>
        <Field label={t('admin.ai.model.context')} htmlFor="m-ctx" error={errors.fields.contextTokens}>
          <Input id="m-ctx" inputMode="numeric" dir="ltr" value={context} onChange={(e) => setContext(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('admin.ai.model.timeout')} htmlFor="m-timeout" error={errors.fields.timeoutSec}>
          <Input id="m-timeout" inputMode="numeric" dir="ltr" value={timeout} onChange={(e) => setTimeoutSec(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={t('admin.ai.model.threshold')} htmlFor="m-th" error={errors.fields.failoverThresholdPct}>
          <Input id="m-th" inputMode="numeric" dir="ltr" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={t('admin.ai.model.state')} htmlFor="m-state">
          <Select id="m-state" value={active ? 'on' : 'off'} onChange={(e) => setActive(e.target.value === 'on')}>
            <option value="on">{t('admin.ai.model.active')}</option>
            <option value="off">{t('admin.ai.model.inactive')}</option>
          </Select>
        </Field>
      </div>
      <Field label={t('admin.ai.model.displayName')} htmlFor="m-name">
        <Input id="m-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
    </AdminDialog>
  );
}

export function RouteDialog({ route, models, open, onClose }: { route: AiRouteDto | null; models: AiModelAdminDto[]; open: boolean; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [primary, setPrimary] = useState('');
  const [fallback, setFallback] = useState('');
  const [credits, setCredits] = useState('');
  const [timeout, setTimeoutSec] = useState('20');
  const [threshold, setThreshold] = useState('2');
  const [failover, setFailover] = useState(false);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (b: { cap: string; body: unknown }) => adminWrite(`/admin/ai-routes/${b.cap}`, 'PUT', b.body) });
  const idOf = (modelId: string | undefined) => models.find((x) => x.modelId === modelId)?.id ?? '';
  useOnOpen(open, () => {
    setPrimary(idOf(route?.primary.modelId));
    setFallback(idOf(route?.fallback?.modelId));
    setCredits(String(route?.credits ?? 1));
    setTimeoutSec(String(route?.timeoutSec ?? 20));
    setThreshold(String(route?.errorThresholdPct ?? 2));
    setFailover(route?.state === 'failover');
    setErrors(NO_ERRORS);
  });
  if (!route) return null;
  const eligible = models.filter((x) => x.isActive && x.capabilities.includes(route.capability));
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      await m.mutateAsync({ cap: route.capability, body: { primaryModelId: primary, fallbackModelId: fallback || null, creditCost: Number(credits), timeoutSec: Number(timeout), errorThresholdPct: Number(threshold), failoverActive: failover } });
      void invalidate('/admin/ai-routes', '/admin/ai-providers', '/admin/ai-pricing');
      toast(t('admin.ai.route.saved'));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['primaryModelId', 'fallbackModelId', 'creditCost', 'timeoutSec', 'errorThresholdPct']));
    }
  };
  return (
    <AdminDialog open={open} onClose={onClose} testId="dlg-route" title={t('admin.ai.route.title', { cap: t(`admin.ai.capLong.${route.capability}`) })} submitLabel={t('action.save')} disabled={!primary} pending={m.isPending} error={errors.form} onSubmit={() => void submit()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.ai.col.primary')} required htmlFor="r-primary" error={errors.fields.primaryModelId}>
          <Select id="r-primary" value={primary} onChange={(e) => setPrimary(e.target.value)}>
            <option value="">—</option>
            {eligible.map((x) => (
              <option key={x.id} value={x.id}>
                {x.provider} · {x.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.ai.route.fallback')} htmlFor="r-fallback" error={errors.fields.fallbackModelId}>
          <Select id="r-fallback" value={fallback} onChange={(e) => setFallback(e.target.value)}>
            <option value="">—</option>
            {eligible.filter((x) => x.id !== primary).map((x) => (
              <option key={x.id} value={x.id}>
                {x.provider} · {x.displayName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('admin.ai.col.credits')} htmlFor="r-credits" error={errors.fields.creditCost}>
          <Input id="r-credits" inputMode="numeric" dir="ltr" value={credits} onChange={(e) => setCredits(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={t('admin.ai.model.timeout')} htmlFor="r-timeout" error={errors.fields.timeoutSec}>
          <Input id="r-timeout" inputMode="numeric" dir="ltr" value={timeout} onChange={(e) => setTimeoutSec(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={t('admin.ai.model.threshold')} htmlFor="r-th" error={errors.fields.errorThresholdPct}>
          <Input id="r-th" inputMode="numeric" dir="ltr" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      <label className="flex items-center gap-3 text-[14px]">
        <Switch checked={failover} onCheckedChange={setFailover} label={t('admin.ai.route.failover')} />
        {t('admin.ai.route.failover')}
      </label>
    </AdminDialog>
  );
}

export function PricingVersionDialog({ input, open, onClose }: { input: AiPricingSimulateInput & { costs: { text: number; image: number; voice: number; order: number } }; open: boolean; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [effectiveAt, setEffectiveAt] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (b: unknown) => adminWrite('/admin/ai-pricing/versions', 'POST', b, true) });
  useOnOpen(open, () => {
    setEffectiveAt('');
    setReason('');
    setErrors(NO_ERRORS);
  });
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      await m.mutateAsync({ ...input, ...(effectiveAt ? { effectiveAt } : {}), reason: reason.trim() });
      void invalidate('/admin/ai-pricing', '/admin/credit-pricing');
      toast(t('admin.ai.pricing.versionSaved'));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['reason', 'effectiveAt', 'costs'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  return (
    <AdminDialog open={open} onClose={onClose} testId="dlg-pricing-version" size="sm" title={t('admin.ai.pricing.versionTitle')} note={t('admin.ai.pricing.note')} submitLabel={t('admin.ai.pricing.versionSubmit')} disabled={!reasonOk(reason)} pending={m.isPending} error={errors.form} onSubmit={() => void submit()}>
      <p className="ts-label-meta text-text-muted">{t('admin.ai.pricing.versionSummary', { text: input.costs.text, image: input.costs.image, voice: input.costs.voice, price: input.creditPriceDzd })}</p>
      <Field label={t('admin.ai.pricing.effectiveAt')} htmlFor="pv-date" hint={t('admin.ai.pricing.effectiveHint')} error={errors.fields.effectiveAt}>
        <Input id="pv-date" type="date" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} className="[color-scheme:dark]" />
      </Field>
      <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
    </AdminDialog>
  );
}
