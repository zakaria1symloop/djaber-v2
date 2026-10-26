'use client';
// /products/new · /products/[id]/edit — Figma "CAT-01 — Product form — edit with variants" (+ AR RTL), DLG GDS II
// "Créer depuis une photo" / "Images — erreurs inline", "MOD — Merchant side" (form banner). CAT-01/02/03/07/10.
// The form keeps strings (`./model`), the payloads are the shared zod inputs. Product fields and changed variant rows
// are saved by "Enregistrer"; image operations, stock adjustments, generated variants and deletions are immediate.
import { zodResolver } from '@hookform/resolvers/zod';
import { formatDate, formatNumber } from '@djaber/shared';
import { Banner, Button, buttonClass, cn, CodeInput, Combobox, Field, FormAlert, Input, Ltr, MoneyInput, NumberInput, Pill, SectionLabel, Switch, Textarea, toast, Tooltip } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller, useFieldArray, useForm, type FieldErrors, type Path } from 'react-hook-form';
import { AppPage } from '@/components/app-page';
import { ConflictDialog } from '@/components/global-states';
import { gdsApi } from '@/features/gds/api';
import { Link, useRouter } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { ApiError, apiSession } from '@/lib/api';
import { isOwnChange } from '@/lib/origin';
import { conflictOf } from '@/lib/conflict';
import { errorMessage, fieldError, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { digitsToInt, marginPct } from '@/lib/money';
import { useSession, useWorkspaceId } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { AdjustStockDialog } from '../adjust-stock-dialog';
import { catalogApi, catalogKeys, useCatalogRefresh, useCategories, useUnits } from '../api';
import { flattenCategories, type AiFillResult, type Product } from '../contracts';
import { GenerateVariantsDialog, type GeneratedVariants } from '../generate-variants-dialog';
import { ArchiveProductDialog, PlanLimitDialog, planLimitOf, type PlanLimitInfo } from '../product-dialogs';
import { ModerationPill, ProductStatePill } from '../ui';
import { clearDraft, readDraft, writeDraft } from './draft';
import { aiFillUnavailable, FromPhotoDialog } from './from-photo-dialog';
import { imageHandover } from './images';
import { LocalImagesSection, ProductImagesSection, uploadLocalImages, useLocalImages } from './images-section';
import {
  DESCRIPTION_MAX,
  dirtyItems,
  dirtyLabels,
  emptyForm,
  emptyVariantRow,
  KEYWORD_MAX_LENGTH,
  mergeAiFill,
  productFormSchema,
  rebaseForm,
  rejectedFieldSet,
  SCALAR_FIELDS,
  serverFieldTarget,
  targetPath,
  toCreatePayload,
  toForm,
  toUpdatePayload,
  VARIANT_FIELDS,
  variantCreatePayload,
  variantUpdatePayload,
  WEIGHT_MAX,
  type AiFillField,
  type AiFillPatch,
  type ProductFormValues,
  type RejectedField,
  type ScalarField,
  type VariantRow,
} from './model';
import { ModerationBanner } from './moderation-banner';
import { StockSection } from './stock-section';
import { QuickCategoryDialog, QuickUnitDialog } from './taxonomy-dialogs';

type Props = { mode: 'create'; product?: null } | { mode: 'edit'; product: Product };
type Locale = 'fr' | 'ar' | 'en';
/** A translated sentence with one left-to-right value inside (the margin keeps its order in Arabic). */
function WithLtr({ text, value }: { text: string; value: string }) {
  const [before, after] = text.split(SLOT);
  return (
    <>
      {before}
      <Ltr>{value}</Ltr>
      {after}
    </>
  );
}
const SLOT = '@@';

function Section({ title, name, children }: { title: string; name: string; children: ReactNode }) {
  return (
    <section data-section={name} className="rounded-card border border-line-edge bg-ink-surface p-5">
      <SectionLabel className="mb-4">{title}</SectionLabel>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function ProductForm(props: Props) {
  const { mode } = props;
  const product = props.mode === 'edit' ? props.product : null;
  const t = useT();
  const locale = useLocaleCode() as Locale;
  const router = useRouter();
  const route = usePathname();
  const search = useSearchParams();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = useCatalogRefresh();
  const { can, workspace } = useSession();
  const advanced = workspace?.stockMode === 'advanced';
  const editable = can('catalog.write');
  const archived = !!product?.archived;
  const categories = useCategories();
  const units = useUnits();
  const local = useLocalImages();

  /* ---------- values, baseline, draft ---------- */
  const [start] = useState(() => {
    const initial = product ? toForm(product) : emptyForm({ service: search.get('type') === 'service' });
    const draft = typeof window === 'undefined' || archived ? null : readDraft(route);
    return { initial, values: draft ? rebaseForm(draft.base, initial, draft.values) : initial, restored: !!draft };
  });
  const resolver = useMemo(() => zodResolver(productFormSchema(mode)), [mode]);
  const form = useForm<ProductFormValues>({ resolver, defaultValues: start.values });
  const rows = useFieldArray({ control: form.control, name: 'variants', keyName: 'rhfId' });
  const [base, setBase] = useState(start.initial);
  const baseRef = useRef(base);
  const [restored, setRestored] = useState(start.restored);
  const values = form.watch();
  const errors = form.formState.errors;

  // A fresh server version reaches the form in two ways (12-screen-states F "conflict"):
  //  - our own write (save, adjustment, generated variants, images) or a clean form: untouched fields follow it and the
  //    form takes its version;
  //  - someone else's change (WS `product.updated`) while the form is dirty: nothing is rebased and the form keeps the
  //    version it was loaded with, so that saving answers 409 and the conflict dialog is shown.
  const serverForm = useMemo(() => (product ? toForm(product) : null), [product]);
  const signature = serverForm ? JSON.stringify(serverForm) : '';
  const versionRef = useRef(product?.version ?? 0);
  const serverVersion = product?.version ?? 0;
  const cleanNow = dirtyItems(base, values, mode).length === 0;
  useEffect(() => {
    if (!serverForm) return;
    const untouched = dirtyItems(baseRef.current, form.getValues(), mode).length === 0;
    // M11: `product.updated.originSessionId` vs this tab's JWT `sid` (the 5 s window only for events without an origin)
    if (!untouched && serverVersion !== versionRef.current && !isOwnChange(product?.id)) return;
    versionRef.current = serverVersion;
    if (JSON.stringify(baseRef.current) === signature) return;
    const merged = rebaseForm(baseRef.current, serverForm, form.getValues());
    baseRef.current = serverForm;
    setBase(serverForm);
    form.reset(merged, { keepErrors: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the server values, its version and the clean flag
  }, [signature, serverVersion, cleanNow]);

  const [done, setDone] = useState(false);
  const changes = useMemo(() => dirtyItems(base, values, mode), [base, values, mode]);
  const localCount = local.images.filter((i) => !i.rejected).length;
  // tester report 25/10 UX-001: in « Modifier », a picture is stored as soon as it is added but goes to moderation with
  // « Enregistrer »: until then the form counts it as an unsaved change
  const imageIds = useMemo(() => (product?.images ?? []).map((i) => i.id), [product?.images]);
  const [savedImages, setSavedImages] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (product && savedImages === null) setSavedImages(new Set(imageIds));
  }, [product, imageIds, savedImages]);
  const addedImages = mode === 'edit' && savedImages ? imageIds.filter((id) => !savedImages.has(id)).length : 0;
  const dirty = !done && !archived && (changes.length > 0 || (mode === 'create' && localCount > 0) || addedImages > 0);
  const changeLabels = useMemo(() => {
    const list = dirtyLabels(changes, { field: (f) => t(`products.form.dirty.${f}`), variant: (name) => t('products.form.dirty.variant', { name: name || t('products.form.variants.unnamed') }) });
    return (mode === 'create' && localCount > 0) || addedImages > 0 ? [...list, t('products.form.dirty.images')] : list;
  }, [changes, localCount, addedImages, mode, t]);

  const snapshot = JSON.stringify(values);
  useEffect(() => {
    if (done || archived) return;
    if (changes.length === 0) return clearDraft(route);
    const id = window.setTimeout(() => writeDraft(route, { values: form.getValues(), base: baseRef.current }), 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- written when the values change
  }, [snapshot, changes.length, done, archived, route]);
  // leaving the page (saved, cancelled, navigated away) drops the draft; an expired session keeps it for the re-login
  useEffect(
    () => () => {
      if (apiSession.get().accessToken) clearDraft(route);
    },
    [route],
  );

  /* ---------- screen state ---------- */
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: Product | null; changedBy: string; changedAt: string | null } | null>(null);
  const [planLimit, setPlanLimit] = useState<PlanLimitInfo | null>(null);
  const [serverBelowCost, setServerBelowCost] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [aiFilled, setAiFilled] = useState<AiFillPatch>({});
  const [aiOff, setAiOff] = useState(aiFillUnavailable());
  const [dialog, setDialog] = useState<null | 'photo' | 'generate' | 'category' | 'unit' | 'archive'>(null);
  const [adjust, setAdjust] = useState<{ variantId: string | null } | null>(null);
  const locked = saving || !editable || archived;
  const { guard } = useLeaveGuard(dirty, product?.name ?? t('products.form.newTitle'));

  const toggleRow = useCallback((key: string, open?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  /* ---------- server errors → fields ---------- */
  const applyErrors = (e: unknown) => {
    if (!(e instanceof ApiError)) return setFormError(errorMessage(e, t));
    const variants = form.getValues('variants');
    let mapped = 0;
    let unknown = 0;
    let first: string | null = null;
    for (const [path, key] of Object.entries(e.body.fields ?? {})) {
      const target = serverFieldTarget(path, variants.length);
      if (!target) {
        unknown++;
        continue;
      }
      const p = targetPath(target);
      form.setError(p as Path<ProductFormValues>, { type: 'server', message: key });
      if (target.kind === 'variant') toggleRow(variants[target.index]!.key, true);
      first ??= p;
      mapped++;
    }
    if (e.code === 'PRODUCT_SKU_ALREADY_EXISTS' && mapped === 0) {
      form.setError('sku', { type: 'server', message: 'validation.sku_taken' });
      first = 'sku';
      mapped++;
    }
    // the row editor is rendered by the state change above: focus once it is there
    if (first) window.setTimeout(() => form.setFocus(first as Path<ProductFormValues>), 50);
    setFormError(mapped > 0 && unknown === 0 ? null : `${errorMessage(e, t)} (${e.code})`);
  };
  const applyRowError = (index: number, row: VariantRow, e: unknown) => {
    toggleRow(row.key, true);
    let mapped = false;
    if (e instanceof ApiError) {
      for (const [path, key] of Object.entries(e.body.fields ?? {})) {
        const field = path.split('.').pop() ?? '';
        if ((VARIANT_FIELDS as readonly string[]).includes(field)) {
          form.setError(`variants.${index}.${field}` as Path<ProductFormValues>, { type: 'server', message: key });
          mapped = true;
        }
      }
    }
    if (!mapped) form.setError(`variants.${index}.name`, { type: 'server', message: e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t) });
  };
  const afterSave = (warnings: { code: string; params?: Record<string, unknown> }[]) => {
    setServerBelowCost(warnings.some((w) => w.code === 'SELLING_BELOW_COST'));
    const near = warnings.find((w) => w.code === 'PLAN_NEAR_LIMIT');
    if (near) {
      const plan = workspace?.plan;
      toast({ tone: 'warning', message: t('toast.planNearLimit', { current: Number(near.params?.current ?? plan?.usage.products ?? 0), limit: Number(near.params?.limit ?? plan?.limits.maxProducts ?? 0), resource: t('products.form.planResource') }) });
    }
  };

  /* ---------- save ---------- */
  const create = async (v: ProductFormValues) => {
    setSaving(true);
    setFormError(null);
    try {
      const r = await catalogApi.createProduct(toCreatePayload(v, { advanced }));
      const id = r.data.id;
      setDone(true);
      clearDraft(route);
      // the pictures chosen before the product existed are sent now, in order
      const failed = await uploadLocalImages(id, local.images, local.patch, t);
      imageHandover.put(
        id,
        failed.map((img) => ({ ...img, url: URL.createObjectURL(img.file) })),
      );
      void refresh();
      toast(t('toast.saved'));
      afterSave(r.warnings);
      if (r.warnings.some((w) => w.code === 'SELLING_BELOW_COST')) toast({ tone: 'warning', message: `${t('error.SELLING_BELOW_COST')} (SELLING_BELOW_COST)` });
      router.push(failed.length ? `/products/${id}/edit` : `/products/${id}`);
    } catch (e) {
      setSaving(false);
      const plan = planLimitOf(e);
      if (plan) return setPlanLimit(plan);
      applyErrors(e);
    }
  };

  const update = async (v: ProductFormValues, version: number) => {
    if (!product) return;
    const key = catalogKeys.product(ws, product.id);
    const from = baseRef.current;
    setSaving(true);
    setFormError(null);
    // `?reco=` (stock recommendation "Modifier le prix" / "Créer une promo"): applied once a price is really saved
    let priceSaved = false;
    try {
      const patch = toUpdatePayload(from, v, version, { advanced });
      if (Object.keys(patch).length > 1) {
        const r = await catalogApi.updateProduct(product.id, patch);
        priceSaved = 'price' in patch || 'oldPrice' in patch;
        versionRef.current = r.data.version;
        qc.setQueryData<Product>(key, r.data);
        afterSave(r.warnings);
      }
    } catch (e) {
      setSaving(false);
      const c = conflictOf<Product>(e);
      if (c) return setConflict(c);
      return applyErrors(e);
    }
    // variant rows: one call per new or changed row; a refused row keeps its values and shows its error
    const saved = new Map(from.variants.map((r) => [r.key, r]));
    const refused: { key: string; error: unknown }[] = [];
    for (const [i, row] of v.variants.entries()) {
      try {
        if (!row.id) {
          const created = await catalogApi.createVariant(product.id, variantCreatePayload(row, { advanced }));
          form.setValue(`variants.${i}.id`, created.id);
        } else {
          const before = saved.get(row.key);
          const body = before ? variantUpdatePayload(before, row, { advanced }) : {};
          if (Object.keys(body).length) {
            await catalogApi.updateVariant(product.id, row.id, body);
            if ('price' in body) priceSaved = true;
          }
        }
      } catch (e) {
        refused.push({ key: row.key, error: e });
      }
    }
    const failed = refused.length;
    // the moderation request of this save (fields, variants and the pictures added since the last one), if anything changed
    await catalogApi.submitChanges(product.id).catch(() => undefined);
    setSavedImages(new Set((qc.getQueryData<Product>(key)?.images ?? []).map((i) => i.id)));
    const reco = search.get('reco');
    if (reco && priceSaved) await gdsApi.applyStockReco(reco, { refType: search.get('recoRef') === 'promo' ? 'promo' : 'product', refId: product.id }).catch(() => undefined);
    await refresh({ productId: product.id });
    // The saved version becomes the baseline right here (not only through the WS / own-write heuristics of the effect
    // above): after a successful save the form is clean — no "unsaved" note, "Enregistrer" disabled, no leave guard.
    // A refused row keeps its values (no id yet, or still different from the server) and stays unsaved.
    const fresh = qc.getQueryData<Product>(key);
    if (fresh) {
      const next = toForm(fresh);
      const nextValues = failed ? rebaseForm(baseRef.current, next, form.getValues()) : next;
      baseRef.current = next;
      versionRef.current = fresh.version;
      setBase(next);
      form.reset(nextValues);
    }
    // row errors are placed after the rebase: the rows may have moved (saved rows first, unsaved ones at the end)
    const current = form.getValues('variants');
    for (const r of refused) {
      const index = current.findIndex((row) => row.key === r.key);
      if (index >= 0) applyRowError(index, current[index]!, r.error);
    }
    setSaving(false);
    if (failed) return setFormError(t('products.form.variants.someFailed', { count: failed }));
    setExpanded(new Set());
    toast(t('toast.saved'));
  };

  const onInvalid = (errs: FieldErrors<ProductFormValues>) => {
    const labels: string[] = [];
    for (const f of SCALAR_FIELDS) if (errs[f]) labels.push(t(`products.form.dirty.${f}`));
    const current = form.getValues('variants');
    const rowErrors = Array.isArray(errs.variants) ? errs.variants : [];
    rowErrors.forEach((rowError, i) => {
      const row = current[i];
      if (!rowError || !row) return;
      labels.push(t('products.form.dirty.variant', { name: row.name.trim() || t('products.form.variants.unnamed') }));
      toggleRow(row.key, true);
    });
    setSummary(labels.length ? t('state.form.validationSummary', { count: labels.length, list: labels.join(', ') }) : null);
  };
  const submit = form.handleSubmit((v) => {
    setSummary(null);
    return mode === 'create' ? create(v) : update(v, versionRef.current || product!.version);
  }, onInvalid);

  /* ---------- "Remplir depuis la photo" ---------- */
  const categoryOptions = useMemo(() => {
    const list = flattenCategories(categories.data ?? []).map((c) => ({ value: c.id, label: c.label }));
    // the saved value stays selectable while the list loads
    if (product?.category && !list.some((o) => o.value === product.category!.id)) list.unshift({ value: product.category.id, label: product.category.name });
    return list;
  }, [categories.data, product?.category]);
  const unitOptions = useMemo(() => {
    const list = (units.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.abbreviation})` }));
    if (product?.unit && !list.some((o) => o.value === product.unit!.id)) list.unshift({ value: product.unit.id, label: product.unit.abbreviation });
    return list;
  }, [units.data, product?.unit]);
  const applyAi = (result: AiFillResult): AiFillField[] => {
    const { patch, filled } = mergeAiFill(form.getValues(), result, { categoryIds: categoryOptions.map((o) => o.value), unitIds: unitOptions.map((o) => o.value) });
    for (const k of filled) form.setValue(k, patch[k]!, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    setAiFilled((prev) => ({ ...prev, ...patch }));
    return filled;
  };
  // highlighted until the merchant edits the suggestion
  const ai = (f: AiFillField) => aiFilled[f] !== undefined && values[f] === aiFilled[f];

  /* ---------- derived display ---------- */
  const rejected = useMemo(() => (product?.moderation?.status === 'rejected' ? rejectedFieldSet(product.moderationDetail?.rejectedFields) : new Set<RejectedField>()), [product]);
  const price = digitsToInt(values.price);
  const cost = advanced ? digitsToInt(values.costPrice) : (product?.costPrice ?? null);
  const margin = price !== null && cost !== null && price < cost ? marginPct(price, cost) : null;
  const belowCost = margin !== null || (serverBelowCost && !changes.some((c) => c.kind === 'field' && (c.field === 'price' || c.field === 'costPrice')));
  const mark = (f: RejectedField | AiFillField) =>
    rejected.has(f as RejectedField) ? (
      <span className="ts-label-micro text-accent-alert" data-rejected={f}>
        {t('products.form.moderation.rejectedMark')}
      </span>
    ) : (f === 'name' || f === 'description' || f === 'categoryId' || f === 'unitId') && ai(f) ? (
      <span className="ts-label-micro text-accent-money" data-ai-filled={f}>
        ✦ {t('products.form.photo.prefilled')}
      </span>
    ) : null;
  const tint = (f: RejectedField | AiFillField) => (rejected.has(f as RejectedField) ? 'border-accent-alert' : (f === 'name' || f === 'description' || f === 'categoryId' || f === 'unitId') && ai(f) ? 'border-accent-money' : undefined);
  const params = (f: ScalarField): Record<string, string | number> => (f === 'description' ? { max: formatNumber(DESCRIPTION_MAX) } : f === 'keywords' ? { max: KEYWORD_MAX_LENGTH } : f === 'weightGrams' ? { min: 0, max: formatNumber(WEIGHT_MAX) } : { max: 255 });
  const err = (f: ScalarField) => fieldError(t, errors[f]?.message, params(f));

  const archive = actionState(product?.actions, 'archive', t);
  const adjustAction = actionState(product?.actions, 'adjust_stock', t);
  const canAdjust = can('stock.adjust') && !!product?.trackStock && !archived && (!adjustAction.present || adjustAction.enabled);
  const backHref = product ? `/products/${product.id}` : '/products';
  const title = product ? values.name.trim() || product.name : t('products.form.newTitle');
  const agents = product?.agents ?? [];

  const subline = product ? (
    <span className="flex flex-wrap items-center gap-x-1.5" data-testid="product-subline">
      <span>
        {t('products.form.sku')} <Ltr>{product.sku}</Ltr>
      </span>
      <span aria-hidden>·</span>
      <span>{t('products.form.header.updated', { date: formatDate(product.updatedAt, locale) })}</span>
      {agents.length ? (
        <>
          <span aria-hidden>·</span>
          <span>{t('products.form.header.agents', { count: agents.length })}</span>
        </>
      ) : null}
    </span>
  ) : undefined;

  const photoButton =
    locked || aiOff ? (
      aiOff && !locked ? (
        <Tooltip content={`${t('error.IMAGE_ANALYSIS_UNAVAILABLE')} (IMAGE_ANALYSIS_UNAVAILABLE)`}>
          <span tabIndex={0} className="inline-flex" data-testid="photo-fill-off">
            <Button disabledReason={`${t('error.IMAGE_ANALYSIS_UNAVAILABLE')} (IMAGE_ANALYSIS_UNAVAILABLE)`}>
              <Sparkles className="size-4" aria-hidden />
              {t('products.form.photo.button')}
            </Button>
          </span>
        </Tooltip>
      ) : null
    ) : (
      <Button onClick={() => setDialog('photo')} data-testid="photo-fill">
        <Sparkles className="size-4" aria-hidden />
        {t('products.form.photo.button')}
      </Button>
    );

  return (
    <AppPage
      permission="catalog.write"
      back={{ href: '/products', label: t('nav.products') }}
      title={title}
      badges={
        product ? (
          <>
            <ProductStatePill product={{ archived: product.archived, isActive: product.isActive }} />
            {product.variants?.length ? <Pill className="rounded-[4px]">{t('products.form.header.variants', { count: product.variants.length })}</Pill> : null}
            <ModerationPill status={product.moderation?.status} />
          </>
        ) : undefined
      }
      description={subline}
      actions={
        product && !archived ? (
          <>
            {archive.present || editable ? (
              <Button className="!border-accent-alert/60 !text-accent-alert hover:!border-accent-alert" onClick={() => setDialog('archive')} disabledReason={!editable ? t('toast.forbidden') : archive.present && !archive.enabled ? archive.reason : undefined} data-testid="product-archive">
                {t('action.archive')}
              </Button>
            ) : null}
            {product.trackStock && can('stock.adjust') ? (
              <Button onClick={() => setAdjust({ variantId: null })} disabledReason={canAdjust ? undefined : adjustAction.reason} data-testid="product-adjust">
                {t('action.adjustStock')}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {product ? <ModerationBanner product={product} dirty={dirty} canWrite={editable && !archived} /> : null}
      {archived && product ? (
        <Banner tone="warning">
          <div className="flex flex-wrap items-center gap-3" data-testid="archived-banner">
            <span className="min-w-0 flex-1">{t('products.form.archived')}</span>
            <Link href={`/products/${product.id}`} className={buttonClass({ size: 'sm' })}>
              {t('action.restore')}
            </Link>
          </div>
        </Banner>
      ) : null}
      {!editable && !archived ? <Banner tone="warning">{t('error.READ_ONLY_MEMBER')}</Banner> : null}
      {restored && dirty ? (
        <Banner tone="info" onDismiss={() => setRestored(false)} dismissLabel={t('action.close')}>
          <span data-testid="draft-restored">{t('products.form.draftRestored')}</span>
        </Banner>
      ) : null}

      <form id="product-form" onSubmit={submit} noValidate aria-busy={saving} className="grid items-start gap-5 lg:grid-cols-3" data-mode={mode}>
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          <Section title={t('products.form.info.title')} name="info">
            <Field label={t('common.name')} htmlFor="name" required error={err('name')}>
              <Input id="name" dir="auto" maxLength={255} disabled={locked} aria-invalid={!!errors.name} className={tint('name')} {...form.register('name')} />
              {mark('name')}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('products.form.sku')} htmlFor="sku" required={mode === 'edit'} error={err('sku')} hint={t(mode === 'create' ? 'products.form.skuHintCreate' : 'products.form.skuHint')}>
                <CodeInput id="sku" maxLength={255} disabled={locked} aria-invalid={!!errors.sku} {...form.register('sku')} />
              </Field>
              <Field label={t('products.form.keywords')} htmlFor="keywords" error={err('keywords')} hint={t('products.form.keywordsHint')}>
                <Input id="keywords" dir="auto" disabled={locked} aria-invalid={!!errors.keywords} {...form.register('keywords')} />
              </Field>
            </div>
            <Field label={t('products.form.description')} htmlFor="description" error={err('description')}>
              <Textarea id="description" dir="auto" rows={3} disabled={locked} aria-invalid={!!errors.description} className={tint('description')} {...form.register('description')} />
              <span className="flex items-center justify-between gap-2">
                {mark('description') ?? <span />}
                <Ltr className={cn('ts-label-micro tabular-nums', values.description.trim().length > DESCRIPTION_MAX ? 'text-accent-alert' : 'text-text-muted')}>{`${formatNumber(values.description.trim().length)} / ${formatNumber(DESCRIPTION_MAX)}`}</Ltr>
              </span>
            </Field>
          </Section>

          <Section title={t('products.form.price.title')} name="price">
            <div className={cn('grid gap-4', advanced ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
              <Field label={t('products.form.price.selling')} htmlFor="price" required error={err('price')}>
                <Controller
                  control={form.control}
                  name="price"
                  render={({ field }) => <MoneyInput id="price" ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} disabled={locked} aria-invalid={!!errors.price} className={tint('price')} />}
                />
                {mark('price')}
              </Field>
              <Field label={t('products.form.price.old')} htmlFor="oldPrice" error={err('oldPrice')}>
                <Controller
                  control={form.control}
                  name="oldPrice"
                  render={({ field }) => <MoneyInput id="oldPrice" ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} disabled={locked} aria-invalid={!!errors.oldPrice} />}
                />
              </Field>
              {advanced ? (
                <Field label={t('products.form.price.cost')} htmlFor="costPrice" error={err('costPrice')}>
                  <Controller
                    control={form.control}
                    name="costPrice"
                    render={({ field }) => <MoneyInput id="costPrice" ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} disabled={locked} aria-invalid={!!errors.costPrice} />}
                  />
                </Field>
              ) : null}
            </div>
            {belowCost ? (
              <p role="status" data-testid="below-cost" className="rounded-[6px] border-s-2 border-s-accent-starred bg-ink-raised px-3 py-2.5 text-[13px] text-accent-starred">
                {margin !== null ? <WithLtr text={t('products.form.price.belowCost', { margin: SLOT })} value={`${margin < 0 ? '−' : ''}${Math.abs(margin)} %`} /> : t('products.form.price.belowCostSaved')}
              </p>
            ) : null}
          </Section>

          {product ? (
            <ProductImagesSection product={product} disabled={!editable || archived} rejected={rejected.has('images')} footer={photoButton} />
          ) : (
            <LocalImagesSection state={local} disabled={locked} footer={photoButton} />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <StockSection
            form={form}
            rows={rows}
            values={values}
            mode={mode}
            product={product}
            advanced={advanced}
            locked={locked}
            canAdjust={canAdjust}
            expanded={expanded}
            onToggle={toggleRow}
            onAdjust={(variantId) => setAdjust({ variantId })}
            onGenerate={() => setDialog('generate')}
          />

          <Section title={t('products.form.organisation.title')} name="organisation">
            <Field label={t('products.form.organisation.category')} htmlFor="categoryId" error={err('categoryId')}>
              <Controller
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <Combobox
                    id="categoryId"
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? '')}
                    options={categoryOptions}
                    placeholder={t('products.form.organisation.noCategory')}
                    clearLabel={t('products.form.organisation.noCategory')}
                    searchPlaceholder={t('action.search')}
                    emptyLabel={t('products.form.organisation.categoryEmpty')}
                    loading={categories.isPending}
                    disabled={locked}
                    invalid={!!errors.categoryId}
                    className={tint('categoryId')}
                    footer={
                      <button type="button" className="w-full rounded-[6px] px-2.5 py-2 text-start text-[13px] text-accent-inbound hover:bg-ink-raised-high" onClick={() => setDialog('category')} data-testid="category-create">
                        {t('products.form.organisation.createCategory')}
                      </button>
                    }
                  />
                )}
              />
              {mark('categoryId')}
            </Field>
            <Field label={t('products.form.organisation.unit')} htmlFor="unitId" error={err('unitId')}>
              <Controller
                control={form.control}
                name="unitId"
                render={({ field }) => (
                  <Combobox
                    id="unitId"
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? '')}
                    options={unitOptions}
                    placeholder={t('products.form.organisation.noUnit')}
                    clearLabel={t('products.form.organisation.noUnit')}
                    searchPlaceholder={t('action.search')}
                    emptyLabel={t('products.form.organisation.unitEmpty')}
                    loading={units.isPending}
                    disabled={locked}
                    invalid={!!errors.unitId}
                    className={tint('unitId')}
                  />
                )}
              />
              <span className="flex flex-wrap items-center justify-between gap-2">
                {locked ? (
                  <span />
                ) : (
                  <button type="button" className="ts-label-meta text-text-secondary hover:text-text-primary" onClick={() => setDialog('unit')} data-testid="unit-create">
                    {t('products.form.organisation.customUnit')}
                  </button>
                )}
                {mark('unitId')}
              </span>
            </Field>
            <Field label={t('products.form.organisation.weight')} htmlFor="weightGrams" error={err('weightGrams')}>
              <Controller
                control={form.control}
                name="weightGrams"
                render={({ field }) => <NumberInput id="weightGrams" ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} maxDigits={7} suffix="g" disabled={locked} aria-invalid={!!errors.weightGrams} />}
              />
            </Field>
          </Section>

          <Section title={t('products.form.visibility.title')} name="visibility">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">
                <Controller control={form.control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label={t('products.form.visibility.active')} disabled={locked} />} />
              </span>
              <div className="min-w-0">
                <div className="text-[14px] font-medium">{t('products.form.visibility.active')}</div>
                <p className="ts-label-meta mt-0.5 text-text-muted">
                  {agents.length ? `${t('products.form.visibility.usedBy', { agents: agents.map((a) => a.name).join(', ') })} ` : ''}
                  {t('products.form.visibility.hint')}
                </p>
              </div>
            </div>
          </Section>
        </div>
      </form>

      {mode === 'edit' && !archived ? <p className="ts-label-meta text-text-muted">{t('products.form.moderation.reviewNote')}</p> : null}
      {summary ? (
        <FormAlert>
          <span data-testid="validation-summary">{summary}</span>
        </FormAlert>
      ) : null}
      {formError ? <FormAlert>{formError}</FormAlert> : null}

      {archived ? null : (
        <div className="sticky -bottom-6 z-20 -mx-4 -mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-hairline bg-ink-base px-4 py-3 md:-mx-8 md:px-8" data-testid="form-footer">
          <p className={cn('min-w-0 flex-1 ts-label-meta', dirty ? 'text-accent-starred' : 'text-text-muted')} aria-live="polite" data-testid="dirty-note">
            {dirty ? `● ${t('products.form.unsaved', { list: changeLabels.join(', ') })}` : ''}
          </p>
          {saving ? (
            <Button variant="ghost" disabled>
              {t('action.cancel')}
            </Button>
          ) : (
            <Link href={backHref} className={buttonClass({ variant: 'ghost' })} data-testid="form-cancel">
              {t('action.cancel')}
            </Link>
          )}
          <Button type="submit" form="product-form" variant="primary" loading={saving} disabled={mode === 'edit' && !dirty} disabledReason={editable ? undefined : t('error.READ_ONLY_MEMBER')} data-testid="form-save">
            {saving ? t('common.saving') : t('action.save')}
          </Button>
        </div>
      )}

      {/* dialogs live outside the <form>: their own forms must not submit the product */}
      <FromPhotoDialog
        open={dialog === 'photo'}
        onClose={() => setDialog(null)}
        initialFiles={mode === 'create' ? local.images.filter((i) => !i.rejected).map((i) => i.file) : []}
        current={{ name: values.name.trim(), description: values.description.trim(), categoryId: values.categoryId || null, unitId: values.unitId || null }}
        onResult={applyAi}
        onUnavailable={() => setAiOff(true)}
      />
      <GenerateVariantsDialog
        open={dialog === 'generate'}
        onClose={() => setDialog(null)}
        productId={product?.id ?? null}
        productName={values.name.trim() || t('products.form.newTitle')}
        existing={values.variants.map((r) => ({ name: r.name, attributes: r.attributes }))}
        defaultPrice={digitsToInt(values.price)}
        onLocal={(g: GeneratedVariants) => {
          for (const c of g.combos) rows.append(emptyVariantRow({ name: c.name, attributes: c.attributes, price: String(g.price), stock: String(g.stock), costPrice: advanced ? values.costPrice : '' }), { shouldFocus: false });
        }}
      />
      <QuickCategoryDialog open={dialog === 'category'} onClose={() => setDialog(null)} onCreated={(c) => form.setValue('categoryId', c.id, { shouldDirty: true })} />
      <QuickUnitDialog open={dialog === 'unit'} onClose={() => setDialog(null)} onCreated={(u) => form.setValue('unitId', u.id, { shouldDirty: true })} />
      {product ? (
        <>
          <ArchiveProductDialog
            product={dialog === 'archive' ? product : null}
            onClose={() => setDialog(null)}
            onDone={() => {
              setDone(true);
              clearDraft(route);
              router.push('/products');
            }}
          />
          <AdjustStockDialog open={!!adjust} onClose={() => setAdjust(null)} product={product} variantId={adjust?.variantId} />
        </>
      ) : null}
      <PlanLimitDialog info={planLimit} onClose={() => setPlanLimit(null)} />
      <ConflictDialog
        open={!!conflict}
        name={conflict?.changedBy || t('products.form.conflictSomeone')}
        ago={relativeTime(conflict?.changedAt, locale)}
        onClose={() => setConflict(null)}
        onReload={() => {
          // "Recharger": take the server version, drop the draft
          const current = conflict?.current;
          setConflict(null);
          if (!product) return;
          if (current) {
            const next = toForm(current);
            baseRef.current = next;
            versionRef.current = current.version;
            setBase(next);
            form.reset(next);
            qc.setQueryData<Product>(catalogKeys.product(ws, product.id), current);
          } else {
            const untouched = baseRef.current;
            form.reset(untouched);
            void refresh({ productId: product.id });
          }
          setServerBelowCost(false);
        }}
        onOverwrite={
          conflict?.current && !conflict.current.archived
            ? () => {
                // "Écraser": the same changes, sent on top of the current version
                const current = conflict.current!;
                setConflict(null);
                void update(form.getValues(), current.version);
              }
            : undefined
        }
      />
      {guard}
    </AppPage>
  );
}
