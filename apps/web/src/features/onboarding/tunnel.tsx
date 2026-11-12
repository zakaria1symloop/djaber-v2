'use client';
// ONB-01 — Onboarding tunnel, steps 1–6 (Figma "ONB-01 — Onboarding — step 1…6"). Progress = Workspace.onboardingStep:
// leaving step n writes n + 1, "Passer la configuration" writes 99, so the next login resumes at the saved step.
// Step 3 creates the first product (`POST /products`, M2; "Remplir avec l'IA" = `POST /products/ai-fill`). Step 4
// creates the draft agent from a preset (`GET /agents/presets`, `POST /agents`, M4) or opens the agent wizard for a
// from-scratch agent (steps 1–3 run inside the tunnel, then it comes back at step 5). Step 5 starts the page connect
// flow (M3). A reopened step shows what already exists (product, agent, pages) and continues without creating twice;
// leaving a reopened step never moves the saved progress back.
import { CreateProductSchema } from '@djaber/shared';
import { Button, buttonClass, Card, ChecklistRow, cn, Field, FormAlert, Input, MoneyInput, NumberInput, OptionCard, Skeleton, Steps, toast, Tooltip, type StepItem } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Bot, Box, Check, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RESEND_COOLDOWN_S } from '@/components/auth/forgot-form';
import { QueryError } from '@/components/global-states';
import { agentsApi, useAgents, useAgentsRefresh, usePresets } from '@/features/agents/api';
import { authApi } from '@/features/auth/api';
import { catalogApi, catalogKeys, useProducts } from '@/features/catalog/api';
import { useAppReviewStatus, useChannels } from '@/features/channels/api';
import { useConnectFlow } from '@/features/channels/connect';
import { reportCounts } from '@/features/channels/logic';
import { aiFillUnavailable, FromPhotoDialog } from '@/features/catalog/product-form/from-photo-dialog';
import { checkImageFile, IMAGE_ACCEPT } from '@/features/catalog/product-form/images';
import { useOnboarding, useOnboardingStep, usePatchWorkspace } from '@/features/workspace/api';
import { agentTestPath, agentToTest, connectedChannels, limitReached, SCRATCH_WIZARD_PATH } from './logic';
import { presetCards, type PresetCard } from './presets';
import { Link, useRouter } from '@/i18n/navigation';
import { checklistOf } from '@/lib/contracts';
import { formatClock, retryAfterSeconds, useCooldown } from '@/lib/countdown';
import { ApiError } from '@/lib/api';
import { errorMessage, fieldError } from '@/lib/forms';
import { ONBOARDING_STEPS, onboardingPath, onboardingWrite, stepNumber, type OnboardingSlug } from '@/lib/guards';
import { useT } from '@/lib/i18n';
import { digitsToInt } from '@/lib/money';
import { useSession, useWorkspaceId } from '@/lib/session';

const STEP_LABEL: Record<OnboardingSlug, string> = {
  welcome: 'onboarding.step.welcome',
  'stock-mode': 'onboarding.step.stock',
  'first-product': 'onboarding.step.product',
  agent: 'onboarding.step.agent',
  connect: 'onboarding.step.page',
  ready: 'onboarding.step.ready',
};

/** first rows only: "does the workspace already have one?" */
/** the smallest page the list endpoints accept (api-contract §1.6: 25 | 50 | 100); only the first row is read */
const FIRST: Record<string, number> = { pageSize: 25 };

function useAdvance(slug: OnboardingSlug) {
  const router = useRouter();
  const t = useT();
  const { workspace } = useSession();
  const step = useOnboardingStep();
  const n = stepNumber(slug);
  const go = async () => {
    try {
      // a step reopened from the stepper (or "← Back") never moves the saved progress back
      const write = onboardingWrite(workspace?.onboardingStep ?? n, n);
      if (write !== null) await step.mutateAsync(write);
      router.push(onboardingPath(n + 1));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  return { go, saving: step.isPending };
}

function Shell({ slug, title, description, children }: { slug: OnboardingSlug; title: string; description: ReactNode; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const { workspace } = useSession();
  const current = stepNumber(slug);
  // a step reopened behind the saved progress keeps the steps already passed reachable from the stepper
  const reached = Math.max(current, Math.min(workspace?.onboardingStep ?? 0, ONBOARDING_STEPS.length));
  const items: StepItem[] = ONBOARDING_STEPS.map((s, i) => ({
    key: s,
    label: t(STEP_LABEL[s]),
    state: i + 1 === current ? 'active' : i + 1 < reached ? 'done' : 'upcoming',
    onSelect: () => router.push(`/onboarding/${s}`),
  }));
  return (
    <Card className="mx-auto w-full max-w-[680px] p-6 sm:p-9">
      <Steps items={items} label={t('onboarding.stepsLabel')} />
      <h1 className="ts-display-m mt-5">{title}</h1>
      <p className="ts-body mt-4 text-text-secondary">{description}</p>
      <div className="mt-5">{children}</div>
      <p className="ts-label-micro mt-10 text-text-muted">{t('onboarding.progress', { step: current, total: ONBOARDING_STEPS.length })}</p>
    </Card>
  );
}

function Nav({ back, backLabel, onLater, saving, primary }: { back: OnboardingSlug; backLabel: string; onLater: () => void; saving: boolean; primary: ReactNode }) {
  const t = useT();
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <Link href={`/onboarding/${back}`} className={buttonClass({ variant: 'ghost', className: 'me-auto' })}>
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        {backLabel}
      </Link>
      <Button variant="ghost" onClick={onLater} disabled={saving}>
        {t('action.later')}
      </Button>
      {primary}
    </div>
  );
}

/* ---------- 1. Welcome ---------- */
function Welcome() {
  const t = useT();
  const { me } = useSession();
  const { go, saving } = useAdvance('welcome');
  const tiles = ['stock', 'product', 'agent', 'page', 'ready'] as const;
  return (
    <Shell slug="welcome" title={t('onboarding.welcome.title', { name: me?.firstName ?? '' })} description={t('onboarding.welcome.description')}>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {tiles.map((k) => (
          <li key={k} className="rounded-card bg-ink-raised px-2.5 py-2.5">
            <div className="text-[14px] font-medium">{t(`onboarding.welcome.tile.${k}.title`)}</div>
            <div className="ts-label-meta mt-1 text-text-muted [overflow-wrap:anywhere]">{t(`onboarding.welcome.tile.${k}.hint`)}</div>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={go} loading={saving}>
          {saving ? t('onboarding.continuing') : t('onboarding.welcome.start')}
        </Button>
      </div>
    </Shell>
  );
}

/* ---------- 2. Stock mode ---------- */
function StockMode() {
  const t = useT();
  const { workspace } = useSession();
  const [mode, setMode] = useState<'simple' | 'advanced'>(workspace?.stockMode ?? 'simple');
  const patch = usePatchWorkspace();
  const { go, saving } = useAdvance('stock-mode');
  const [error, setError] = useState<string | null>(null);
  const busy = patch.isPending || saving;
  const save = async () => {
    setError(null);
    try {
      if (workspace && mode !== workspace.stockMode) await patch.mutateAsync({ stockMode: mode, version: workspace.version });
      await go();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <Shell slug="stock-mode" title={t('onboarding.stock.title')} description={t('onboarding.stock.description')}>
      <div role="radiogroup" aria-label={t('nav.settings.stockMode')} className="flex flex-col gap-5">
        {(['simple', 'advanced'] as const).map((m) => (
          <OptionCard
            key={m}
            name={m}
            selected={mode === m}
            onSelect={() => setMode(m)}
            disabled={busy}
            icon={<Box className="size-5" aria-hidden />}
            title={t(`settings.stockMode.${m}.title`)}
            description={t(`settings.stockMode.${m}.description`)}
            badge={t('enum.Workspace.status.active')}
          />
        ))}
      </div>
      {error ? <FormAlert className="mt-4">{error}</FormAlert> : null}
      <Nav
        back="welcome"
        backLabel={t('onboarding.step.welcome')}
        onLater={go}
        saving={busy}
        primary={
          <Button variant="primary" onClick={save} loading={busy}>
            {busy ? t('onboarding.continuing') : t('onboarding.continue')}
          </Button>
        }
      />
    </Shell>
  );
}

/** "Already done" notice of a reopened step: what exists, with an optional action (`role="status"`). */
function DoneNotice({ testId, children, action }: { testId: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" data-testid={testId} className="flex flex-wrap items-center gap-3 rounded-card border-s-2 border-s-accent-money bg-ink-raised px-3.5 py-3 text-[13px]">
      <Check className="size-4 shrink-0 text-accent-money" aria-hidden />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</span>
      {action}
    </div>
  );
}

/* ---------- 3. First product: the main button creates it (`POST /products`, CAT-01), then moves on ---------- */
type FirstProductErrors = { name?: string; price?: string; stock?: string; photo?: string; form?: string };
function FirstProduct() {
  const t = useT();
  const { go, saving } = useAdvance('first-product');
  // reopened step: the product created earlier is shown, "Continuer" never creates a second one
  const products = useProducts(FIRST);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [errors, setErrors] = useState<FirstProductErrors>({});
  const [aiOpen, setAiOpen] = useState(false);
  const [aiOff, setAiOff] = useState(aiFillUnavailable());
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  // the cached list (15 s fresh) must know the new product: reopening the step offers it instead of a second form
  const create = useMutation({ mutationFn: catalogApi.createProduct, onSuccess: () => qc.invalidateQueries({ queryKey: catalogKeys.products(ws) }) });
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    const code = checkImageFile(file);
    if (code) return setErrors((e) => ({ ...e, photo: t(`error.${code}`) }));
    setErrors((e) => ({ ...e, photo: undefined }));
    setPhoto({ file, url: URL.createObjectURL(file) });
  };
  const submit = async () => {
    const parsed = CreateProductSchema.safeParse({ name, price: digitsToInt(price) ?? undefined, stock: digitsToInt(stock), trackStock: true });
    if (!parsed.success) {
      const next: FirstProductErrors = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0];
        if (k === 'name' || k === 'price' || k === 'stock') next[k] ??= fieldError(t, issue.message, { max: 255 });
        else next.form ??= fieldError(t, issue.message);
      }
      return setErrors(next);
    }
    setErrors({});
    try {
      const { data } = await create.mutateAsync(parsed.data);
      if (photo) {
        // the product exists: a refused picture never blocks the tunnel (it can be added from the product form)
        await catalogApi.uploadImage(data.id, photo.file).catch((e: unknown) => toast({ tone: 'warning', message: errorMessage(e, t) }));
      }
      await go();
    } catch (e) {
      if (e instanceof ApiError) {
        const next: FirstProductErrors = {};
        for (const [field, key] of Object.entries(e.body.fields ?? {})) {
          if (field === 'name' || field === 'price' || field === 'stock') next[field] = fieldError(t, key, { max: 255 });
        }
        // PRODUCT_SKU_ALREADY_EXISTS, PLAN_LIMIT and every other refusal: inline, the typed values stay
        if (!Object.keys(next).length) next.form = errorMessage(e, t);
        return setErrors(next);
      }
      setErrors({ form: errorMessage(e, t) });
    }
  };
  const busy = create.isPending || saving;
  // the list only prevents a duplicate: while it loads the step waits, when it fails the form is offered
  const checking = products.isLoading;
  const existing = !adding && !create.isSuccess ? (products.data?.rows[0] ?? null) : null;
  const aiReason = aiOff ? t('error.IMAGE_ANALYSIS_UNAVAILABLE') : undefined;
  return (
    <Shell slug="first-product" title={t('onboarding.product.title')} description={t('onboarding.product.description')}>
      {checking ? (
        <div role="status" aria-label={t('common.loading')} className="grid gap-4 sm:grid-cols-[140px_1fr]">
          <Skeleton className="h-[140px]" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        </div>
      ) : existing ? (
        <DoneNotice
          testId="first-product-existing"
          action={
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)} disabled={busy} data-testid="first-product-add-another">
              <Plus className="size-4" aria-hidden />
              {t('onboarding.product.addAnother')}
            </Button>
          }
        >
          {t('onboarding.product.existing', { name: existing.name })}
        </DoneNotice>
      ) : (
        <form
          noValidate
          aria-busy={busy}
          className="grid gap-4 sm:grid-cols-[140px_1fr]"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              aria-label={t('onboarding.product.photo')}
              className={cn(
                'relative flex h-[140px] flex-col items-center justify-center gap-1 overflow-hidden rounded-card border border-dashed text-text-muted hover:text-text-primary disabled:opacity-50',
                errors.photo ? 'border-accent-alert' : 'border-line-lit',
              )}
            >
              {photo ? (
                <img src={photo.url} alt="" className="absolute inset-0 size-full object-cover" />
              ) : (
                <>
                  <Plus className="size-4" aria-hidden />
                  <span className="ts-label-micro">{t('onboarding.product.photo')}</span>
                </>
              )}
            </button>
            <input
              ref={input}
              type="file"
              accept={IMAGE_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              data-upload="first-product-photo"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {/* the AI reads the photo and proposes the name (never the price, AT-CAT-10) */}
            <Button size="sm" variant="ghost" className="text-accent-money" onClick={() => setAiOpen(true)} disabled={busy} disabledReason={aiReason} data-testid="first-product-ai">
              <Sparkles className="size-4" aria-hidden />
              {t('onboarding.product.aiFill')}
            </Button>
            {errors.photo ? (
              <p role="alert" className="text-[12px] text-accent-alert">
                {errors.photo}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <Field label={t('common.name')} htmlFor="p-name" required error={errors.name}>
              <Input id="p-name" dir="auto" maxLength={255} value={name} disabled={busy} aria-invalid={!!errors.name} placeholder={t('onboarding.product.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('onboarding.product.price')} htmlFor="p-price" required error={errors.price}>
                <MoneyInput id="p-price" value={price} onValueChange={setPrice} disabled={busy} aria-invalid={!!errors.price} />
              </Field>
              <Field label={t('onboarding.product.stock')} htmlFor="p-stock" required error={errors.stock}>
                <NumberInput id="p-stock" value={stock} onValueChange={setStock} maxDigits={8} disabled={busy} aria-invalid={!!errors.stock} />
              </Field>
            </div>
          </div>
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
            {t('onboarding.product.submit')}
          </button>
        </form>
      )}
      {errors.form ? (
        <FormAlert className="mt-3">
          <span data-testid="first-product-error">{errors.form}</span>
        </FormAlert>
      ) : null}
      <Nav
        back="stock-mode"
        backLabel={t('onboarding.step.stock')}
        onLater={go}
        saving={busy}
        primary={
          existing ? (
            <Button variant="primary" onClick={go} loading={saving} data-testid="first-product-continue">
              {saving ? t('onboarding.continuing') : t('onboarding.continue')}
            </Button>
          ) : (
            <Button variant="primary" onClick={submit} loading={busy} disabled={checking} data-testid="first-product-submit">
              {busy ? t('onboarding.continuing') : t('onboarding.product.submit')}
            </Button>
          )
        }
      />
      <FromPhotoDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        initialFiles={photo ? [photo.file] : []}
        current={{ name: name.trim() }}
        onResult={(r) => {
          // the step has a name field only: the suggestion fills it when it is empty
          if (name.trim() || !r.name) return [];
          setName(r.name.slice(0, 255));
          setErrors((e) => ({ ...e, name: undefined }));
          return ['name'];
        }}
        onUnavailable={() => setAiOff(true)}
      />
    </Shell>
  );
}

/* ---------- 4. Agent preset: the main button creates the draft agent (`POST /agents`), then the tunnel advances ---------- */
function AgentPreset() {
  const t = useT();
  const { can } = useSession();
  const { go, saving } = useAdvance('agent');
  const refreshAgents = useAgentsRefresh();
  // the published presets; the four of the frame stay as the fallback while loading or when the list fails
  const presets = usePresets(can('agents.manage'));
  const cards = presetCards(presets.data);
  // reopened step (or back from the wizard): the agent created earlier is offered, no second draft by accident
  const agents = useAgents(FIRST);
  const create = useMutation({ mutationFn: agentsApi.create });
  const existing = !create.isSuccess ? (agents.data?.rows[0] ?? null) : null;
  const [picked, setPicked] = useState<string | null>(null);
  // with an agent already there, no card is preselected: picking one asks for a second agent
  const selected = cards.find((c) => c.key === picked) ?? (existing ? null : (cards.find((c) => c.recommended) ?? cards[0]!));
  const [error, setError] = useState<string | null>(null);
  const nameOf = (c: PresetCard) => c.name ?? (c.staticKey ? t(`onboarding.agent.preset.${c.staticKey}.name`) : c.key);
  const busy = saving || create.isPending;

  /** creates the draft (drafts never count toward the plan limit), then moves on; a refusal stays on the step */
  const start = async (body: { presetKey: string; name: string }) => {
    setError(null);
    try {
      await create.mutateAsync(body);
      // progress first: the refresh refetches the workspace, and a refetch racing the PATCH would bring back step 4
      await go();
      void refreshAgents();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };

  return (
    <Shell slug="agent" title={t('onboarding.agent.title')} description={t('onboarding.agent.description')}>
      {existing ? (
        <DoneNotice testId="onboarding-agent-existing">{t('onboarding.agent.existing', { name: existing.name })}</DoneNotice>
      ) : null}
      <div role="radiogroup" aria-label={t('onboarding.agent.title')} className={cn('grid gap-3 sm:grid-cols-2', existing && 'mt-4')} data-testid="onboarding-presets" data-source={cards[0]?.live ? 'server' : 'static'}>
        {cards.map((c) => {
          const on = selected?.key === c.key;
          return (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={on}
              data-preset={c.key}
              disabled={busy}
              onClick={() => setPicked(c.key)}
              className={cn('flex flex-col rounded-card border bg-ink-surface p-4 text-start disabled:cursor-not-allowed', on ? 'border-accent-money' : 'border-line-hairline hover:border-line-edge')}
            >
              <span className="flex w-full items-start justify-between">
                <span className="flex size-10 items-center justify-center rounded-card bg-ink-raised text-accent-money">
                  <Bot className="size-5" aria-hidden />
                </span>
                {c.recommended ? <span className="ts-label-micro text-text-muted">{t('onboarding.agent.recommended')}</span> : null}
              </span>
              <span className="ts-display-s mt-3">{nameOf(c)}</span>
              <span className="mt-1 text-[13px] text-text-muted">{c.tagline ?? (c.staticKey ? t(`onboarding.agent.preset.${c.staticKey}.tagline`) : '')}</span>
              {c.staticKey ? (
                <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-text-secondary">
                  {[1, 2, 3].map((n) => (
                    <li key={n} className="flex items-center gap-2">
                      <span className="size-1 rounded-full bg-text-muted" aria-hidden />
                      {t(`onboarding.agent.preset.${c.staticKey}.point${n}`)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <span className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-medium">
                {t('onboarding.agent.use')}
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </span>
            </button>
          );
        })}
      </div>
      {/* the from-scratch agent is built in the agent wizard (steps 1–3 run in the tunnel, then it comes back at step 5) */}
      <Link href={SCRATCH_WIZARD_PATH} className={buttonClass({ variant: 'ghost', className: cn('mt-4 !h-auto min-h-10 !whitespace-normal py-2 text-start', busy && 'pointer-events-none opacity-45') })} aria-disabled={busy || undefined} data-testid="onboarding-agent-scratch">
        {t('onboarding.agent.scratch')}
      </Link>
      {error ? (
        <FormAlert className="mt-3">
          {error} · {t('onboarding.agent.errorHint')}
        </FormAlert>
      ) : null}
      <Nav
        back="first-product"
        backLabel={t('onboarding.step.product')}
        onLater={go}
        saving={busy}
        primary={
          selected ? (
            <Button variant="primary" onClick={() => void start({ presetKey: selected.key, name: nameOf(selected) })} loading={busy || agents.isLoading} data-testid="onboarding-agent-create">
              {busy ? t('onboarding.continuing') : t('onboarding.agent.create', { name: nameOf(selected) })}
            </Button>
          ) : (
            <Button variant="primary" onClick={go} loading={saving} data-testid="onboarding-agent-continue">
              {saving ? t('onboarding.continuing') : t('onboarding.agent.continueWith', { name: existing?.name ?? '' })}
            </Button>
          )
        }
      />
    </Shell>
  );
}

/* ---------- 5. Connect a page: the main button starts the connect flow (FL-05), the step advances once a page is connected ---------- */
function Connect() {
  const t = useT();
  const { me, can } = useSession();
  const { go, saving } = useAdvance('connect');
  // same outcomes as `/channels`: pop-up blocked, waiting, refused, invalid state, e-mail unverified, per-page report
  const connect = useConnectFlow({ onReportClosed: (report) => void (reportCounts(report).connected > 0 ? go() : undefined) });
  // reopened step: the pages already connected are listed and the step can be left with "Continuer"
  const channels = useChannels(can('channels.read'));
  const pages = connectedChannels(channels.data?.rows);
  // "approval pending" only while Meta has not approved Instagram messaging (CHN-11)
  const review = useAppReviewStatus(can('channels.read'));
  const [platform, setPlatform] = useState<'facebook' | 'instagram'>('facebook');
  const [cooldown, startCooldown] = useCooldown();
  const resend = useMutation({ mutationFn: authApi.resendVerification });
  const unverified = !!me && !me.emailVerifiedAt;
  const onResend = async () => {
    try {
      await resend.mutateAsync();
      toast(t('auth.verify.resent', { email: me?.email ?? '' }));
      startCooldown(RESEND_COOLDOWN_S);
    } catch (e) {
      const wait = retryAfterSeconds(e, RESEND_COOLDOWN_S);
      if (wait > 0) startCooldown(wait);
      else toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const connectButton = (
    <Button variant={pages.length ? 'secondary' : 'primary'} onClick={() => void connect.start(platform)} loading={connect.busy || (!pages.length && saving)} disabled={saving} disabledReason={unverified ? t('error.AUTH_EMAIL_UNVERIFIED') : undefined} data-testid="onboarding-connect">
      {!pages.length && saving ? t('onboarding.continuing') : t(`onboarding.connect.${platform}.submit`)}
    </Button>
  );
  return (
    <Shell slug="connect" title={t('onboarding.connect.title')} description={t('onboarding.connect.description')}>
      {pages.length ? (
        <DoneNotice testId="onboarding-connect-existing">
          {t('onboarding.connect.existing', { count: pages.length })}{' '}
          {pages.map((c, i) => (
            <span key={c.id}>
              {i ? ', ' : ''}
              <bdi>{c.name}</bdi>
            </span>
          ))}
        </DoneNotice>
      ) : null}
      <div role="radiogroup" aria-label={t('onboarding.connect.title')} className={cn('flex flex-col gap-5', pages.length && 'mt-4')}>
        {(['facebook', 'instagram'] as const).map((p) => (
          <OptionCard
            key={p}
            name={p}
            selected={platform === p}
            onSelect={() => setPlatform(p)}
            disabled={connect.busy || saving}
            icon={<Box className="size-5" aria-hidden />}
            title={t(`onboarding.connect.${p}.title`)}
            description={t(`onboarding.connect.${p}.description`)}
            badge={t('enum.Workspace.status.active')}
          />
        ))}
      </div>
      <div className="mt-5 rounded-card bg-ink-raised px-3.5 py-3">
        <div className="ts-label-micro text-text-muted">{t('onboarding.connect.never.title')}</div>
        <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-text-secondary">
          {[1, 2, 3].map((n) => (
            <li key={n} className="flex items-center gap-2">
              <X className="size-3.5 shrink-0" aria-hidden />
              {t(`onboarding.connect.never.item${n}`)}
            </li>
          ))}
        </ul>
      </div>
      {review.data && !review.data.instagramApproved ? (
        <div className="mt-4 rounded-card border-s-2 border-s-accent-starred bg-ink-raised px-3.5 py-3 text-[13px] text-text-secondary" data-testid="onboarding-instagram-pending">
          {t('onboarding.connect.instagramPending')}
        </div>
      ) : null}
      {unverified ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-card border-s-2 border-s-accent-alert bg-ink-raised px-3.5 py-3 text-[13px]">
          <span className="min-w-0 flex-1">{t('onboarding.connect.unverified', { email: me?.email ?? '' })}</span>
          <Button size="sm" onClick={onResend} loading={resend.isPending} disabled={cooldown > 0}>
            {cooldown > 0 ? t('action.resendIn', { time: formatClock(cooldown) }) : t('action.resend')}
          </Button>
        </div>
      ) : null}
      <Nav
        back="agent"
        backLabel={t('onboarding.step.agent')}
        onLater={go}
        saving={saving}
        primary={
          pages.length ? (
            <>
              {connectButton}
              <Button variant="primary" onClick={go} loading={saving} disabled={connect.busy} data-testid="onboarding-connect-continue">
                {saving ? t('onboarding.continuing') : t('onboarding.continue')}
              </Button>
            </>
          ) : (
            connectButton
          )
        }
      />
      {connect.element}
    </Shell>
  );
}

/**
 * A next action of the Ready step: a link to a working screen, or — when it cannot work yet — a disabled button with
 * its reason (tooltip, CLAUDE.md rule 7).
 */
function NextAction({ href, reason, loading, variant = 'secondary', testId, children }: { href: string | null; reason?: string; loading?: boolean; variant?: 'secondary' | 'ghost'; testId: string; children: ReactNode }) {
  if (loading)
    return (
      <Button variant={variant} loading data-testid={testId}>
        {children}
      </Button>
    );
  if (reason || !href)
    return (
      <Tooltip content={reason}>
        <span tabIndex={0} className="inline-flex" data-testid={`${testId}-off`}>
          <Button variant={variant} disabledReason={reason} data-testid={testId}>
            {children}
          </Button>
        </span>
      </Tooltip>
    );
  return (
    <Link href={href} className={buttonClass({ variant })} data-testid={testId}>
      {children}
    </Link>
  );
}

/* ---------- 6. Ready: what is done / skipped, from the Get Started checklist ---------- */
function Ready() {
  const t = useT();
  const { workspace, can } = useSession();
  const home = useOnboarding();
  const list = checklistOf(home.data);
  // "Tester mon agent" opens the playground of the agent (the draft's test lives on wizard step 5)
  const agents = useAgents();
  const agent = agentToTest(agents.data?.rows);
  const plan = workspace?.plan;
  const membersFull = limitReached(plan, 'members');
  const productsFull = limitReached(plan, 'products');
  const limitReason = (l: { current: number; limit: number }, resource: string) => t('error.PLAN_LIMIT', { current: l.current, limit: l.limit, resource });
  const testReason = agents.isError ? errorMessage(agents.error, t) : !agent ? t('onboarding.ready.noAgent') : !can('agents.test') ? t('error.FORBIDDEN') : undefined;
  const rows: { key: string; done: boolean; title: string; hint: string }[] = [
    { key: 'stock', done: true, title: t('onboarding.ready.stock', { mode: t(`settings.stockMode.${workspace?.stockMode ?? 'simple'}.title`) }), hint: t('onboarding.ready.stockHint') },
    { key: 'product', done: list.product, title: t(list.product ? 'onboarding.ready.productDone' : 'onboarding.ready.productTodo'), hint: t('onboarding.ready.productHint') },
    { key: 'agent', done: list.agent, title: t(list.agent ? 'onboarding.ready.agentDone' : 'onboarding.ready.agentTodo'), hint: t('onboarding.ready.agentHint') },
    { key: 'page', done: list.channel, title: t(list.channel ? 'onboarding.ready.pageDone' : 'onboarding.ready.pageTodo'), hint: t('onboarding.ready.pageHint') },
    { key: 'sale', done: list.sale, title: t('onboarding.ready.sale'), hint: t('onboarding.ready.saleHint') },
  ];
  return (
    <Shell slug="ready" title={t('onboarding.ready.title')} description={t('onboarding.ready.description', { workspace: workspace?.name ?? '' })}>
      {home.isPending ? (
        <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : home.isError ? (
        <QueryError error={home.error} onRetry={() => home.refetch()} />
      ) : (
        <ul className="divide-y divide-line-hairline rounded-card bg-ink-raised px-3.5">
          {rows.map((r) => (
            <li key={r.key} data-step={r.key}>
              <ChecklistRow done={r.done} title={r.title} description={r.hint} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <NextAction href={agent ? agentTestPath(agent) : null} reason={testReason} loading={agents.isLoading} testId="ready-test-agent">
          {t('onboarding.ready.testAgent')}
        </NextAction>
        <NextAction href="/products/import" reason={!can('catalog.write') ? t('error.FORBIDDEN') : productsFull ? limitReason(productsFull, t('products.form.planResource')) : undefined} testId="ready-import">
          {t('onboarding.ready.importCatalogue')}
        </NextAction>
        <NextAction href="/settings/members" variant="ghost" reason={!can('members.write') ? t('error.FORBIDDEN') : membersFull ? limitReason(membersFull, t('onboarding.ready.membersResource')) : undefined} testId="ready-invite">
          {t('onboarding.ready.inviteTeam')}
        </NextAction>
      </div>
      <div className="mt-5 flex justify-end">
        <Link href="/home" className={buttonClass({ variant: 'primary' })}>
          {t('onboarding.ready.goHome')}
        </Link>
      </div>
    </Shell>
  );
}

export function OnboardingStep({ slug }: { slug: OnboardingSlug }) {
  switch (slug) {
    case 'welcome':
      return <Welcome />;
    case 'stock-mode':
      return <StockMode />;
    case 'first-product':
      return <FirstProduct />;
    case 'agent':
      return <AgentPreset />;
    case 'connect':
      return <Connect />;
    case 'ready':
      return <Ready />;
  }
}
