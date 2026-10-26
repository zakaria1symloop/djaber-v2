'use client';
// /delivery/couriers — Figma "DLV-01/03 — Delivery — fee grid + couriers settings" (couriers half), DLG II "Ajouter un
// transporteur" (provider tabs ZR Express / EcoTrack / Yalidine / Livraison propre, per-provider fields, sender block,
// default / active, test: en cours ≤ 10 s / OK latency + wilayas / refusé COURIER_CREDENTIALS_INVALID / injoignable
// COURIER_UNAVAILABLE — save allowed) and "Supprimer le transporteur" (blocked COURIER_HAS_ACTIVE_SHIPMENTS → Désactiver).
// States: skeleton · [E] no account (provider cards with "+ Ajouter") · cards · 403 without `delivery.manage`.
import { formatNumber, formatPhoneDz, type AppLocale, type ZrPlatform } from '@djaber/shared';
import { Button, Card, Checkbox, ConfirmDialog, CourierCard, CourierTestResult, Dialog, EmptyState, Field, FormAlert, Input, Ltr, PhoneInput, SegmentedControl, Skeleton, Switch, toast, type CourierTestState, type Tone } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { conflictOf, usePatchWorkspace, useWorkspaceCache } from '@/features/workspace/api';
import type { WorkspaceDto } from '@/lib/contracts';
import { errorMessage } from '@/lib/forms';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useCloseGuard, useTypedFlag } from '@/components/close-guard';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { DialogFooter, refusal, useOnOpen } from '@/features/orders/dialogs/common';
import { usePathname, useRouter } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { ApiError } from '@/lib/api';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { COURIER_ACTION } from './action-keys';
import { deliveryApi, deliveryKeys, useCourierProviders, useCouriers, useGeoWilayas } from './api';
import type { CourierAccount, CourierInput, CourierPatch, CourierProvider, CourierProviderInfo, CourierTestResult as TestResult } from './contracts';
import { WilayaCombobox, wilayaLabel } from './geo';
import { credentialErrors } from './logic';
import { formatPhoneOnBlur, phonePreviewLine } from '@/lib/phone';

type ProviderKey = CourierProvider | 'manual';
const PROVIDER_ORDER: ProviderKey[] = ['zrexpress', 'ecotrack', 'yalidine', 'manual'];

/** Card pill: INACTIF · IDENTIFIANTS REFUSÉS · INJOIGNABLE · CONNECTÉ · NON TESTÉ. */
function courierState(c: CourierAccount, t: TFunction): { label: string; tone: Tone } {
  if (!c.isActive) return { label: t('couriers.state.inactive'), tone: 'neutral' };
  if (!c.lastTest) return { label: t('couriers.state.untested'), tone: 'warning' };
  if (c.lastTest.ok) return { label: t('couriers.state.connected'), tone: 'success' };
  return c.lastTest.error === 'COURIER_UNAVAILABLE' ? { label: t('couriers.state.unreachable'), tone: 'warning' } : { label: t('couriers.state.invalid'), tone: 'danger' };
}
/** "OK · 420 MS · 58 WILAYAS" / "REFUSÉ" / "INJOIGNABLE" from a test answer. */
export function testView(r: Pick<TestResult, 'ok' | 'latencyMs' | 'error' | 'message' | 'accountName' | 'wilayasServed'>, t: TFunction): { state: CourierTestState; label: string; detail: string } {
  if (r.ok)
    return {
      state: 'ok',
      label: t('couriers.test.ok', { ms: r.latencyMs ?? '—' }),
      detail: [r.accountName ? t('couriers.test.account', { name: r.accountName }) : null, r.wilayasServed ? t('couriers.test.wilayas', { count: r.wilayasServed }) : null].filter(Boolean).join(' · '),
    };
  if (r.error === 'COURIER_UNAVAILABLE') return { state: 'unreachable', label: t('couriers.test.unreachable'), detail: `COURIER_UNAVAILABLE · ${t('couriers.test.unreachableHint')}` };
  return { state: 'rejected', label: t('couriers.test.rejected'), detail: `${r.error ?? 'COURIER_CREDENTIALS_INVALID'} · ${r.message ?? t('couriers.test.rejectedHint')}` };
}

const yes = (v: boolean) => (v ? '✓' : '✗');
/** Card meta "TOKEN + KEY" — per platform for ZR Express. */
const credentialsLabel = (provider: string, platform: ZrPlatform | null | undefined, t: TFunction) => t(provider === 'zrexpress' && platform !== 'procolis' ? 'couriers.credentials.zrexpress_app' : `couriers.credentials.${provider}`);

export function CouriersPage() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const couriers = useCouriers();
  const providers = useCourierProviders();
  const wilayas = useGeoWilayas();
  const [edit, setEdit] = useState<{ account: CourierAccount | null; provider: ProviderKey } | null>(null);
  const [remove, setRemove] = useState<CourierAccount | null>(null);
  // deactivating stops new sends through this courier: confirmed first (delete already has its dialog)
  const [deactivate, setDeactivate] = useState<CourierAccount | null>(null);
  const [tests, setTests] = useState<Record<string, { state: CourierTestState; label: string; detail?: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const list = useMemo(() => couriers.data ?? [], [couriers.data]);

  // deep link `/delivery/couriers?add=1` (no-courier CTA of the overview)
  useEffect(() => {
    if (params.get('add') === '1' && !edit) {
      setEdit({ account: null, provider: 'zrexpress' });
      router.replace(pathname);
    }
  }, [params, edit, router, pathname]);

  const write = (c: CourierAccount) => qc.setQueryData<CourierAccount[]>(deliveryKeys.couriers(ws), (old) => (old ? old.map((x) => (x.id === c.id ? c : c.isDefault ? { ...x, isDefault: false } : x)) : old));
  const reload = () => Promise.all([qc.invalidateQueries({ queryKey: deliveryKeys.couriers(ws) }), qc.invalidateQueries({ queryKey: deliveryKeys.overview(ws) }), qc.invalidateQueries({ queryKey: deliveryKeys.fees(ws) })]);
  const test = async (c: CourierAccount) => {
    setTests((m) => ({ ...m, [c.id]: { state: 'testing', label: t('couriers.test.testing'), detail: t('couriers.test.testingHint') } }));
    try {
      const r = await deliveryApi.testCourier(c.id);
      setTests((m) => ({ ...m, [c.id]: testView(r, t) }));
      if (r.account) write(r.account);
    } catch (e) {
      setTests((m) => ({ ...m, [c.id]: { state: 'unreachable', label: t('couriers.test.unreachable'), detail: refusal(e, t) } }));
    }
  };
  const patch = async (c: CourierAccount, body: CourierPatch, done: string) => {
    setBusy(c.id);
    try {
      write(await deliveryApi.updateCourier(c.id, body));
      toast(done);
      void reload();
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    } finally {
      setBusy(null);
    }
  };

  const byProvider = new Map(list.map((c) => [c.provider, c]));
  const infos = providers.data ?? [];
  const missing = infos.filter((p) => p.account && !byProvider.has(p.provider as CourierProvider));
  const manual = infos.find((p) => p.provider === 'manual');
  const wilayaName = (id: number | null) => {
    const w = id ? wilayas.data?.find((x) => x.id === id) : null;
    return w ? wilayaLabel(w, locale) : null;
  };

  return (
    <AppPage permission="delivery.manage" title={t('delivery.title.couriers')} bare>
      <div className="flex flex-col gap-5" data-testid="couriers-page">
        {infos.some((p) => p.simulated) ? (
          <FormAlert tone="warning">
            <span data-testid="couriers-simulated">{t('couriers.simulated')}</span>
          </FormAlert>
        ) : null}
        <AutoSendCard />
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 ts-label-meta text-text-muted">{t('couriers.intro')}</p>
          <Button variant="primary" onClick={() => setEdit({ account: null, provider: (missing[0]?.provider as ProviderKey) ?? 'zrexpress' })} data-testid="add-courier">
            {t('couriers.add')}
          </Button>
        </div>
        {couriers.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        ) : couriers.isError ? (
          <QueryError error={couriers.error} onRetry={() => couriers.refetch()} />
        ) : (
          <>
            {list.length === 0 ? (
              <EmptyState icon={<Truck className="size-5" />} title={t('couriers.empty.title')} description={t('couriers.empty.description')} action={{ label: t('couriers.add'), onClick: () => setEdit({ account: null, provider: 'zrexpress' }) }} />
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((c) => {
                const st = courierState(c, t);
                const caps = c.capabilities;
                const del = actionState(c.actions, COURIER_ACTION.delete, t);
                const def = actionState(c.actions, COURIER_ACTION.setDefault, t);
                const tr = tests[c.id];
                const sender = [c.sender.name, c.sender.phone ? formatPhoneDz(c.sender.phone) : null, wilayaName(c.sender.wilayaId)].filter(Boolean).join(' · ');
                return (
                  <CourierCard
                    key={c.id}
                    data-courier={c.provider}
                    data-testid="courier-card"
                    name={c.displayName}
                    status={st}
                    muted={!c.isActive}
                    meta={[c.isDefault ? t('couriers.default') : null, credentialsLabel(c.provider, c.platform, t), c.lastTest ? t('couriers.testedAgo', { ago: relativeTime(c.lastTest.at, locale) }) : t('couriers.neverTested')].filter(Boolean).join(' · ').toUpperCase()}
                    actions={
                      <>
                        <Button onClick={() => void test(c)} loading={tr?.state === 'testing'} data-testid="courier-test-btn">
                          {t('couriers.test')}
                        </Button>
                        <Button onClick={() => setEdit({ account: c, provider: c.provider })}>{t('action.edit')}</Button>
                        {c.isActive && !c.isDefault ? (
                          <Button variant="ghost" onClick={() => void patch(c, { isDefault: true }, t('couriers.toast.default', { name: c.displayName }))} loading={busy === c.id} disabledReason={def.present && !def.enabled ? def.reason : undefined} data-testid="courier-default">
                            {t('couriers.setDefault')}
                          </Button>
                        ) : null}
                        <Button variant="ghost" onClick={() => (c.isActive ? setDeactivate(c) : void patch(c, { isActive: true }, t('couriers.toast.activated', { name: c.displayName })))} loading={busy === c.id} data-testid="courier-toggle">
                          {c.isActive ? t('couriers.deactivate') : t('couriers.activate')}
                        </Button>
                        {del.present ? (
                          <Button className="!border-accent-alert/60 !text-accent-alert hover:!border-accent-alert" onClick={() => setRemove(c)} data-testid="courier-delete">
                            {t('action.delete')}
                          </Button>
                        ) : null}
                      </>
                    }
                  >
                    {c.provider === 'ecotrack' && c.baseUrl ? (
                      <p>
                        {t('couriers.instance')} <Ltr className="!inline">{c.baseUrl}</Ltr>
                      </p>
                    ) : null}
                    {sender ? <p>{t('couriers.sender', { sender })}</p> : null}
                    <p>{t('couriers.capabilities', { parcel: yes(caps.parcel), tracking: yes(caps.tracking), rates: yes(caps.rates), label: yes(caps.label) }) + (caps.label ? '' : ` ${t('couriers.djaberLabel')}`)}</p>
                    <p>{t('couriers.stats', { sent: c.stats.sent, failed: c.stats.failed30d, active: formatNumber(c.stats.activeShipments) })}</p>
                    {tr ? <CourierTestResult state={tr.state} label={tr.label} detail={tr.detail} /> : c.lastTest && !c.lastTest.ok ? <CourierTestResult {...testView({ ok: false, latencyMs: null, error: c.lastTest.error, message: null, accountName: null, wilayasServed: null }, t)} /> : null}
                  </CourierCard>
                );
              })}
              {missing.map((p) => (
                <CourierCard
                  key={p.provider}
                  data-courier={p.provider}
                  data-testid="courier-provider-card"
                  name={p.name}
                  status={{ label: t('couriers.state.notConfigured'), tone: 'neutral' }}
                  meta={credentialsLabel(p.provider, p.platforms?.[0]?.key, t).toUpperCase()}
                  actions={
                    <Button variant="primary" onClick={() => setEdit({ account: null, provider: p.provider as ProviderKey })}>
                      {t('couriers.addProvider', { name: p.name })}
                    </Button>
                  }
                >
                  <p>{t('couriers.capabilities', { parcel: yes(p.capabilities.parcel), tracking: yes(p.capabilities.tracking), rates: yes(p.capabilities.rates), label: yes(p.capabilities.label) }) + (p.capabilities.stopdesk ? ` · ${t('couriers.stopdeskCap')}` : '')}</p>
                </CourierCard>
              ))}
              {manual ? (
                <CourierCard key="manual" data-courier="manual" name={t('couriers.provider.manual')} status={{ label: t('couriers.state.always'), tone: 'success' }} meta={t('couriers.credentials.manual').toUpperCase()}>
                  <p>{t('couriers.manual.description')}</p>
                </CourierCard>
              ) : null}
            </div>
          </>
        )}
      </div>
      <CourierDialog
        open={!!edit}
        account={edit?.account ?? null}
        provider={edit?.provider ?? 'zrexpress'}
        providers={infos}
        existing={list}
        onClose={() => setEdit(null)}
        onSaved={(c) => {
          write(c);
          void reload();
        }}
      />
      <ConfirmDialog
        open={!!deactivate}
        onOpenChange={(o) => !o && setDeactivate(null)}
        title={t('couriers.deactivateConfirm.title', { name: deactivate?.displayName ?? '' })}
        description={t('couriers.deactivateConfirm.description')}
        confirmLabel={t('couriers.deactivate')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        loading={!!deactivate && busy === deactivate.id}
        onConfirm={() => {
          const c = deactivate;
          if (!c) return;
          void patch(c, { isActive: false }, t('couriers.toast.deactivated', { name: c.displayName })).finally(() => setDeactivate(null));
        }}
      />
      <DeleteCourierDialog
        account={remove}
        onClose={() => setRemove(null)}
        onDeactivate={async (c) => {
          await patch(c, { isActive: false }, t('couriers.toast.deactivated', { name: c.displayName }));
          setRemove(null);
        }}
        onDeleted={() => {
          setRemove(null);
          void reload();
        }}
      />
    </AppPage>
  );
}

/* ---------- Ajouter / modifier un transporteur ---------- */
type Form = { displayName: string; creds: Record<string, string>; senderName: string; senderPhone: string; senderAddress: string; senderWilayaId: number | null; isDefault: boolean; isActive: boolean };
const formOf = (c: CourierAccount | null, existing: CourierAccount[]): Form => ({
  displayName: c?.displayName ?? '',
  creds: {},
  senderName: c?.sender.name ?? existing[0]?.sender.name ?? '',
  senderPhone: c?.sender.phone ?? existing[0]?.sender.phone ?? '',
  senderAddress: c?.sender.address ?? existing[0]?.sender.address ?? '',
  senderWilayaId: c?.sender.wilayaId ?? existing[0]?.sender.wilayaId ?? null,
  isDefault: c ? c.isDefault : existing.filter((x) => x.isActive).length === 0,
  isActive: c ? c.isActive : true,
});

/** Add / edit a courier account; also opened in place from the send dialog when no courier is configured. */
export function CourierDialog({ open, account, provider: initial, providers, existing, onClose, onSaved }: { open: boolean; account: CourierAccount | null; provider: ProviderKey; providers: CourierProviderInfo[]; existing: CourierAccount[]; onClose: () => void; onSaved: (c: CourierAccount) => void }) {
  const t = useT();
  const typed = useTypedFlag(open);
  const [provider, setProvider] = useState<ProviderKey>(initial);
  // ZR Express: new platform (API key + tenant id) or Procolis (token + key)
  const [platform, setPlatform] = useState<ZrPlatform>(account?.platform ?? 'app');
  const [f, setF] = useState<Form>(() => formOf(account, existing));
  const [current, setCurrent] = useState<CourierAccount | null>(account);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [test, setTest] = useState<{ state: CourierTestState; label: string; detail?: string } | null>(null);
  useOnOpen(open, () => {
    setProvider(account?.provider ?? initial);
    setPlatform(account?.platform ?? 'app');
    setF(formOf(account, existing));
    setCurrent(account);
    setTouched(false);
    setBusy(null);
    setError(null);
    setServerFields({});
    setTest(null);
  });
  const info = providers.find((p) => p.provider === provider);
  const plat = info?.platforms?.find((p) => p.key === platform) ?? null;
  const fields = plat?.fields ?? info?.fields ?? [];
  const editing = !!current;
  const credErr = provider === 'manual' ? {} : credentialErrors(fields.map((x) => ({ name: x.key, secret: x.type === 'secret', url: x.type === 'url' })), f.creds, editing);
  const err = (k: string) => (touched ? (credErr[k] ? t(credErr[k]!) : undefined) : undefined) ?? (serverFields[k] ? (t.has(serverFields[k]!) ? t(serverFields[k]!, { max: '', min: '' }) : serverFields[k]) : undefined);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const taken = !current && provider !== 'manual' && provider !== 'ecotrack' && existing.some((c) => c.provider === provider && (!plat || (c.platform ?? 'procolis') === platform));

  const save = async (): Promise<CourierAccount | null> => {
    setTouched(true);
    setError(null);
    setServerFields({});
    if (provider === 'manual' || Object.keys(credErr).length) return null;
    const anyCred = fields.some((x) => (f.creds[x.key] ?? '').trim());
    const creds = Object.fromEntries(fields.map((x) => [x.key, (f.creds[x.key] ?? '').trim()]));
    const sender = { name: f.senderName.trim() || null, phone: f.senderPhone.trim() || null, address: f.senderAddress.trim() || null, wilayaId: f.senderWilayaId };
    try {
      const saved = current
        ? await deliveryApi.updateCourier(current.id, { displayName: f.displayName.trim() || null, sender, isDefault: f.isDefault, isActive: f.isActive, ...(anyCred ? { credentials: creds as CourierPatch['credentials'] } : {}) })
        : await deliveryApi.createCourier({ provider, credentials: creds, displayName: f.displayName.trim() || null, sender, isDefault: f.isDefault, isActive: f.isActive } as CourierInput);
      setCurrent(saved);
      set({ creds: {} });
      setTouched(false);
      typed.reset();
      onSaved(saved);
      return saved;
    } catch (e) {
      setError(refusal(e, t));
      if (e instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.body.fields ?? {})) map[k.replace(/^credentials\./, '').replace(/^sender\./, 'sender_')] = v;
        setServerFields(map);
      }
      return null;
    }
  };
  const runTest = async (c: CourierAccount) => {
    setTest({ state: 'testing', label: t('couriers.test.testing'), detail: t('couriers.test.testingHint') });
    try {
      const r = await deliveryApi.testCourier(c.id);
      setTest(testView(r, t));
      if (r.account) onSaved(r.account);
      return r.ok;
    } catch (e) {
      setTest({ state: 'unreachable', label: t('couriers.test.unreachable'), detail: refusal(e, t) });
      return false;
    }
  };
  const onTest = async () => {
    setBusy('test');
    const c = Object.values(f.creds).some((v) => v.trim()) || !current ? await save() : current;
    if (c) await runTest(c);
    setBusy(null);
  };
  const onSave = async () => {
    setBusy('save');
    const creating = !current;
    const c = await save();
    if (!c) return setBusy(null);
    // a new account is tested right away; a refused / unreachable courier keeps the dialog open (saved anyway)
    const ok = creating ? await runTest(c) : true;
    setBusy(null);
    toast(creating ? t('couriers.toast.added', { name: c.displayName }) : t('couriers.toast.saved', { name: c.displayName }));
    if (ok) onClose();
  };

  const title = current ? t('couriers.edit.title', { name: current.displayName }) : t('dialog.addCourier.title');
  // typed credentials are lost on close: asked first
  const guard = useCloseGuard(typed.dirty, title, onClose);
  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && guard.requestClose()}
      title={title}
      description={t('couriers.dialog.context')}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        provider === 'manual' ? (
          <Button variant="ghost" onClick={guard.requestClose}>
            {t('action.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={guard.requestClose} disabled={!!busy}>
              {t('action.cancel')}
            </Button>
            <Button onClick={() => void onTest()} loading={busy === 'test'} disabled={!!busy || taken} data-testid="courier-dialog-test">
              {t('couriers.test')}
            </Button>
            <Button variant="primary" onClick={() => void onSave()} loading={busy === 'save'} disabled={!!busy || taken} data-testid="dialog-submit">
              {t('action.save')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4" data-testid="courier-dialog" data-provider={provider} onChange={typed.onChange}>
        {current ? null : (
          <SegmentedControl<ProviderKey>
            label={t('common.courier')}
            value={provider}
            onChange={(p) => {
              setProvider(p);
              set({ creds: {} });
              setTouched(false);
              setTest(null);
              setServerFields({});
              setError(null);
            }}
            options={PROVIDER_ORDER.filter((p) => p === 'manual' || providers.some((x) => x.provider === p) || !providers.length).map((p) => ({ value: p, label: t(`couriers.provider.${p}`) }))}
          />
        )}
        {provider === 'manual' ? (
          <FormAlert tone="info">{t('couriers.manual.dialog')}</FormAlert>
        ) : (
          <>
            {info?.platforms?.length ? (
              current ? (
                <p className="ts-label-micro !normal-case text-text-muted">{t('couriers.platform.current', { name: t(`couriers.platform.${platform}`) })}</p>
              ) : (
                <SegmentedControl<ZrPlatform>
                  label={t('couriers.platform')}
                  value={platform}
                  onChange={(p) => {
                    setPlatform(p);
                    set({ creds: {} });
                    setTouched(false);
                    setTest(null);
                    setServerFields({});
                    setError(null);
                  }}
                  options={info.platforms.map((p) => ({ value: p.key, label: t(`couriers.platform.${p.key}`) }))}
                />
              )
            ) : null}
            {plat ? <FormAlert tone="info">{t(`couriers.platform.${plat.key}.hint`)}</FormAlert> : null}
            {taken ? <FormAlert tone="warning">{t('couriers.taken', { name: plat ? t(`couriers.platform.${platform}`) : t(`couriers.provider.${provider}`) })}</FormAlert> : null}
            <p className="ts-label-micro !normal-case text-text-muted">{t('couriers.fieldsHint')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((x) => (
                <Field key={x.key} label={`${t(`couriers.field.${x.key}`)} *`} htmlFor={`cr-${x.key}`} error={err(x.key)} hint={x.type === 'secret' ? (current?.credentialHints[x.key] ? t('couriers.field.keep', { hint: current.credentialHints[x.key]! }) : t('couriers.field.encrypted')) : undefined}>
                  <Input
                    id={`cr-${x.key}`}
                    type={x.type === 'secret' ? 'password' : x.type === 'url' ? 'url' : 'text'}
                    autoComplete="off"
                    dir="ltr"
                    value={f.creds[x.key] ?? ''}
                    placeholder={x.type !== 'secret' && current?.credentialHints[x.key] ? current.credentialHints[x.key] : (x.placeholder ?? undefined)}
                    aria-invalid={!!err(x.key) || undefined}
                    onChange={(e) => set({ creds: { ...f.creds, [x.key]: e.target.value } })}
                  />
                </Field>
              ))}
              <Field label={t('couriers.field.displayName')} htmlFor="cr-name" error={err('displayName')}>
                <Input id="cr-name" maxLength={60} value={f.displayName} placeholder={info?.name} onChange={(e) => set({ displayName: e.target.value })} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('couriers.field.senderName')} htmlFor="cr-sname" error={err('sender_name')}>
                <Input id="cr-sname" maxLength={80} value={f.senderName} onChange={(e) => set({ senderName: e.target.value })} />
              </Field>
              <Field label={t('couriers.field.senderPhone')} htmlFor="cr-sphone" error={err('sender_phone')}>
                <PhoneInput id="cr-sphone" value={f.senderPhone} format={formatPhoneOnBlur} onChange={(e) => set({ senderPhone: e.target.value })} preview={phonePreviewLine(t, f.senderPhone)} />
              </Field>
              <Field label={t('couriers.field.senderWilaya')} htmlFor="cr-swilaya" error={err('sender_wilayaId')}>
                <WilayaCombobox id="cr-swilaya" value={f.senderWilayaId} onChange={(id) => set({ senderWilayaId: id })} clearable />
              </Field>
              <Field label={t('couriers.field.senderAddress')} htmlFor="cr-saddress" error={err('sender_address')}>
                <Input id="cr-saddress" maxLength={300} value={f.senderAddress} onChange={(e) => set({ senderAddress: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={f.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} />
              {t('couriers.field.default')}
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
              {t('couriers.field.active')}
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="ts-label-micro text-text-muted">{t('couriers.test.section')}</span>
              {test ? <CourierTestResult state={test.state} label={test.label} detail={test.detail} /> : <span className="ts-label-micro !normal-case text-text-muted">{t('couriers.test.none')}</span>}
            </div>
            {error ? <FormAlert>{error}</FormAlert> : null}
          </>
        )}
      </div>
    </Dialog>
    {guard.element}
    </>
  );
}

/* ---------- Supprimer le transporteur (blocked while parcels are on the way) ---------- */
function DeleteCourierDialog({ account, onClose, onDeactivate, onDeleted }: { account: CourierAccount | null; onClose: () => void; onDeactivate: (c: CourierAccount) => Promise<void>; onDeleted: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState<'delete' | 'deactivate' | null>(null);
  const [blocked, setBlocked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useOnOpen(!!account, () => {
    setBusy(null);
    setError(null);
    const d = account ? actionState(account.actions, COURIER_ACTION.delete, t) : null;
    setBlocked(account && (account.stats.activeShipments > 0 || (d?.present && !d.enabled)) ? account.stats.activeShipments : null);
  });
  if (!account) return null;
  const remove = async () => {
    setBusy('delete');
    setError(null);
    try {
      await deliveryApi.deleteCourier(account.id);
      toast(t('couriers.toast.deleted', { name: account.displayName }));
      onDeleted();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'COURIER_HAS_ACTIVE_SHIPMENTS') setBlocked(Number(e.body.params.count) || account.stats.activeShipments);
      else setError(refusal(e, t));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('dialog.deleteCourier.title', { name: account.displayName })}
      closeLabel={t('action.close')}
      size="md"
      footer={
        blocked !== null ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={!!busy}>
              {t('action.close')}
            </Button>
            {account.isActive ? (
              <Button variant="primary" loading={busy === 'deactivate'} onClick={async () => (setBusy('deactivate'), await onDeactivate(account), setBusy(null))} data-testid="courier-deactivate">
                {t('couriers.deactivate')}
              </Button>
            ) : null}
            <Button variant="danger" disabled disabledReason={`${t('error.COURIER_HAS_ACTIVE_SHIPMENTS', { count: blocked })} (COURIER_HAS_ACTIVE_SHIPMENTS)`}>
              {t('action.delete')}
            </Button>
          </>
        ) : (
          <DialogFooter onClose={onClose} busy={busy === 'delete'} onSubmit={() => void remove()} label={t('action.delete')} danger />
        )
      }
    >
      <div className="flex flex-col gap-3" data-testid="delete-courier-dialog" data-blocked={blocked !== null}>
        {blocked !== null ? (
          <FormAlert tone="danger">
            <span data-testid="courier-delete-blocked">{t('couriers.delete.blocked', { count: blocked })}</span>
          </FormAlert>
        ) : (
          <p className="text-[13px] text-text-secondary">{t('couriers.delete.confirm')}</p>
        )}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Envoi automatique (D9, DLV-05): a confirmed order is sent to the default courier ---------- */
function AutoSendCard() {
  const t = useT();
  const { workspace, can } = useSession();
  const patch = usePatchWorkspace();
  const write = useWorkspaceCache();
  const [error, setError] = useState<string | null>(null);
  if (!workspace) return null;
  const set = async (v: boolean, version = workspace.version) => {
    setError(null);
    try {
      await patch.mutateAsync({ autoSendToCourier: v, version });
      toast(v ? t('couriers.autoSend.on') : t('couriers.autoSend.off'));
    } catch (e) {
      const c = conflictOf<WorkspaceDto>(e);
      if (c?.current && version === workspace.version) {
        write(c.current);
        return set(v, c.current.version);
      }
      setError(errorMessage(e, t));
    }
  };
  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="auto-send">
      <div className="flex flex-wrap items-center gap-3">
        <Switch checked={workspace.autoSendToCourier} onCheckedChange={(v) => void set(v)} label={t('couriers.autoSend.label')} disabled={patch.isPending || !can('workspace.settings')} />
        <span className="text-[14px] font-medium">{t('couriers.autoSend.label')}</span>
        <span className="ts-label-meta text-text-muted">{t('couriers.autoSend.hint')}</span>
      </div>
      {error ? <FormAlert>{error}</FormAlert> : null}
    </Card>
  );
}
